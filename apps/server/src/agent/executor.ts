import { createHash } from 'node:crypto';
import {
  CONFIRM_TTL_MS,
  type DagNode,
  type FlowState,
  type PolicyDecision,
  type PendingAction,
  type ToolResult,
} from '@bank/shared';
import { clock } from '../core/clock';
import { getState, persist } from '../core/store';
import {
  commitReservation,
  getLimitSummary,
  releaseReservation,
  reserve,
} from '../policy/limits';
import { evaluateNode } from '../policy/engine';
import {
  recordFailure,
  recordSuccess,
  lockSecurity,
} from '../security/breaker';
import { audit } from '../security/auditChain';
import { assertAndConsumeGrant, operationDigest } from '../policy/grant';
import { createStepUpChallenge, toPublicChallenge } from '../policy/stepup';
import { deferToManualReview, nodePayee, payeeEchoFor } from '../policy/safeguards';
import type { RiskCallContext } from '../policy/riskAgent';
import { MANUAL_REVIEW_WINDOW_MS } from '@bank/shared';
import { banking } from '../integration/banking';
import { toolHandler, usesBankData } from '../tools/registry';
import { buildPendingSummary, combineBatchSummary } from './summary';
import type { SessionInternal } from './session';
import { appendMessage } from './session';
import type { EmitFn } from './events';

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function nodeDigest(session: SessionInternal, runId: string, node: DagNode): string {
  return operationDigest({
    userId: session.userId,
    sessionId: session.id,
    runId,
    nodeId: node.id,
    tool: node.tool,
    args: node.args,
  });
}

function batchDigest(digests: string[]): string {
  return createHash('sha256').update(digests.join('|')).digest('hex');
}

/** 风控智能体需要的会话侧事实：模型置信度、注入嫌疑、收款人是否刚被替换。 */
function riskContextFor(session: SessionInternal, node: DagNode): RiskCallContext {
  const nlu = session.lastNlu;
  const payee = nodePayee(node);
  const utterance = nlu?.utterance ?? '';
  const replaced = Boolean(
    payee &&
      session.context.lastPayee &&
      payee !== session.context.lastPayee &&
      /换|改成|改为|另一个/.test(utterance),
  );
  return {
    nluConfidence: nlu?.confidence,
    injectionSuspicion: nlu?.injectionSuspicion,
    payeeJustChanged: replaced,
  };
}

function emitNode(emit: EmitFn, runId: string, node: DagNode, extra: Record<string, unknown> = {}) {
  emit(
    'node.state',
    {
      nodeId: node.id,
      status: node.status,
      tool: node.tool,
      label: node.label,
      risk: node.risk,
      reversible: node.reversible,
      attempts: node.attempts,
      durationMs:
        node.startedAt && node.finishedAt
          ? new Date(node.finishedAt).getTime() - new Date(node.startedAt).getTime()
          : undefined,
      resultSummary: node.result?.summary,
      error: node.result?.error,
      ...extra,
    },
    runId,
  );
}

export function preparePending(
  session: SessionInternal,
  node: DagNode,
  policy: PolicyDecision,
  runId: string,
): PendingAction {
  const bank = getState(session.userId);
  const now = clock.wallNow();
  if (policy.decision === 'STEPUP') {
    const digest = nodeDigest(session, runId, node);
    const challenge = createStepUpChallenge({
      userId: session.userId,
      sessionId: session.id,
      nodeId: node.id,
      digest,
      tool: node.tool,
      amountCents: policy.amountCents,
    });
    session.challenges[challenge.id] = node.id;
    return {
      nodeId: node.id,
      kind: 'STEPUP',
      digest,
      expiresAt: challenge.expiresAt,
      policy,
      summary: buildPendingSummary(bank, node, policy),
      challenge: toPublicChallenge(challenge),
      batchNodeIds: [node.id],
      payeeEcho: payeeEchoFor(node, policy),
    };
  }

  const dag = session.dag!;
  const index = dag.nodes.findIndex((n) => n.id === node.id);
  const policies = new Map<string, PolicyDecision>();
  policies.set(node.id, policy);
  const batch = [node];
  for (const candidate of dag.nodes.slice(index + 1)) {
    if (candidate.status !== 'PENDING') continue;
    const candidatePolicy = evaluateNode(bank, candidate, riskContextFor(session, candidate));
    if (candidatePolicy.decision === 'CONFIRM' && candidatePolicy.effectiveRisk === 'YELLOW') {
      policies.set(candidate.id, candidatePolicy);
      batch.push(candidate);
    }
  }
  const digests = batch.map((n) => nodeDigest(session, runId, n));
  const summary =
    batch.length > 1 ? combineBatchSummary(bank, batch, policies) : buildPendingSummary(bank, node, policy);
  return {
    nodeId: node.id,
    kind: 'CONFIRM',
    digest: batchDigest(digests),
    expiresAt: new Date(now.getTime() + CONFIRM_TTL_MS).toISOString(),
    policy,
    summary,
    batchNodeIds: batch.map((n) => n.id),
    payeeEcho: payeeEchoFor(node, policy),
  };
}

function pauseForNode(
  session: SessionInternal,
  node: DagNode,
  policy: PolicyDecision,
  emit: EmitFn,
  runId: string,
): FlowState {
  const pending = preparePending(session, node, policy, runId);
  node.status = pending.kind === 'STEPUP' ? 'AWAIT_STEPUP' : 'AWAIT_CONFIRM';
  session.pending = pending;
  session.state = pending.kind === 'STEPUP' ? 'AWAIT_STEPUP' : 'AWAIT_CONFIRM';
  emitNode(emit, runId, node);
  audit.append(
    pending.kind === 'STEPUP' ? 'STEPUP_REQUIRED' : 'CONFIRM_REQUIRED',
    pending.kind === 'STEPUP'
      ? `红色操作需强验证：${node.label}`
      : `黄色操作需确认：${node.label}`,
    {
      nodeId: node.id,
      tool: node.tool,
      risk: policy.effectiveRisk,
      digest: pending.digest,
      summary: pending.summary,
      batchNodeIds: pending.batchNodeIds,
    },
    { sessionId: session.id, runId },
  );
  emit('run.paused', { pending, nodeId: node.id }, runId);
  return session.state;
}

function depsSatisfied(node: DagNode, dagNodes: DagNode[]): 'ready' | 'blocked' | 'failed' {
  let blocked = false;
  for (const depId of node.deps) {
    const dep = dagNodes.find((n) => n.id === depId);
    if (!dep) return 'failed';
    if (dep.status === 'FAILED' || dep.status === 'SKIPPED' || dep.status === 'MANUAL') return 'failed';
    if (dep.status !== 'SUCCESS' && dep.status !== 'COMPENSATED') blocked = true;
  }
  return blocked ? 'blocked' : 'ready';
}

const NODE_DELAY_MS = Math.max(0, Math.min(2000, Number(process.env.DEMO_NODE_DELAY_MS ?? 220)));
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function executeDag(session: SessionInternal, emit: EmitFn): Promise<FlowState> {
  const bank = getState(session.userId);
  const dag = session.dag;
  if (!dag) return session.state;
  const runId = dag.runId;
  session.state = 'EXECUTING';
  session.updatedAt = clock.nowIso();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const live = getState(session.userId);
    if (session.takeover) {
      session.state = 'HUMAN_TAKEOVER';
      audit.append('TAKEOVER_ACTIVE', '执行暂停，等待人工接管', {}, { sessionId: session.id, runId });
      emit('takeover.required', { message: '执行已暂停，等待人工接管' }, runId);
      return session.state;
    }
    if (session.abortRequested) {
      for (const node of dag.nodes) {
        if (node.status === 'PENDING' || node.status === 'READY') {
          node.status = 'SKIPPED';
          emitNode(emit, runId, node);
        }
      }
      session.state = 'PARTIAL';
      audit.append('ABORT', '用户中断任务，未执行节点已跳过', {}, { sessionId: session.id, runId });
      return session.state;
    }

    const node = dag.nodes.find((candidate) => {
      if (candidate.status !== 'PENDING' && candidate.status !== 'READY') return false;
      const depState = depsSatisfied(candidate, dag.nodes);
      return depState === 'ready';
    });
    if (!node) {
      // 处理仍然 PENDING 但上游失败的节点
      for (const candidate of dag.nodes) {
        if (candidate.status === 'PENDING' || candidate.status === 'READY') {
          if (depsSatisfied(candidate, dag.nodes) === 'failed') {
            candidate.status = 'SKIPPED';
            emitNode(emit, runId, candidate, { reason: 'UPSTREAM_FAILED' });
          }
        }
      }
      const unresolved = dag.nodes.some(
        (n) => n.status === 'PENDING' || n.status === 'READY' || n.status === 'RUNNING',
      );
      if (unresolved) {
        session.state = 'FAILED';
        return session.state;
      }
      const failed = dag.nodes.some((n) => n.status === 'FAILED' || n.status === 'MANUAL');
      const success = dag.nodes.some((n) => n.status === 'SUCCESS');
      const skipped = dag.nodes.some((n) => n.status === 'SKIPPED');
      session.state = failed || skipped ? (success ? 'PARTIAL' : 'FAILED') : 'DONE';
      return session.state;
    }

    node.startedAt = clock.nowIso();
    node.attempts += 1;
    node.status = 'RUNNING';
    emitNode(emit, runId, node);
    if (NODE_DELAY_MS > 0) await delay(NODE_DELAY_MS);

    // http 模式下每次进入银行数据节点前拉取最新快照；失败显式终止，绝不拿本地合成数据兜底。
    if (banking.mode === 'http' && usesBankData(node.tool)) {
      try {
        await banking.sync(session.userId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        node.result = {
          ok: false,
          error: { code: 'BANK_UNAVAILABLE', message: `银行核心暂不可用：${message}` },
        };
        node.status = 'FAILED';
        node.finishedAt = clock.nowIso();
        emitNode(emit, runId, node);
        audit.append('BANK_UNAVAILABLE', `银行核心同步失败：${message}`, { nodeId: node.id, tool: node.tool }, {
          sessionId: session.id,
          runId,
        });
        session.state = 'FAILED';
        persist();
        return session.state;
      }
    }

    const policy = evaluateNode(live, node, riskContextFor(session, node));
    node.policy = policy;
    node.risk = policy.effectiveRisk;
    emit(
      'policy.decision',
      {
        nodeId: node.id,
        tool: node.tool,
        baseRisk: policy.baseRisk,
        effectiveRisk: policy.effectiveRisk,
        decision: policy.decision,
        reasons: policy.reasons,
        limit: policy.limit,
        explanation: policy.explanation,
        amountCents: policy.amountCents,
      },
      runId,
    );
    audit.append(
      'POLICY_DECISION',
      `${node.label} → ${policy.effectiveRisk} / ${policy.decision}`,
      {
        tool: node.tool,
        reasons: policy.reasons.map((r) => r.code),
        amountCents: policy.amountCents,
        limit: policy.limit,
      },
      { sessionId: session.id, runId },
    );

    if (policy.decision === 'DENY') {
      node.status = 'FAILED';
      node.finishedAt = clock.nowIso();
      node.result = {
        ok: false,
        error: { code: 'POLICY_DENIED', message: policy.explanation || '策略拒绝执行' },
      };
      emitNode(emit, runId, node);
      audit.append('POLICY_DENY', `策略阻断：${node.label}`, { explanation: policy.explanation }, {
        sessionId: session.id,
        runId,
      });
      session.state = 'FAILED';
      return session.state;
    }

    if (policy.effectiveRisk !== 'GREEN') {
      const grantId = session.grants[node.id];
      if (!grantId) {
        return pauseForNode(session, node, policy, emit, runId);
      }
      const digest = nodeDigest(session, runId, node);
      const grantResult = assertAndConsumeGrant(grantId, {
        nodeId: node.id,
        digest,
        effectiveRisk: policy.effectiveRisk,
      });
      delete session.grants[node.id];
      if (!grantResult.ok) {
        audit.append(
          'GRANT_REJECTED',
          `授权校验失败：${grantResult.reason}（${node.label}）`,
          { nodeId: node.id, reason: grantResult.reason },
          { sessionId: session.id, runId },
        );
        if (grantResult.reason === 'DIGEST_MISMATCH' || grantResult.reason === 'NODE_MISMATCH') {
          lockSecurity(bank, `授权摘要异常：${grantResult.reason}`);
          session.state = 'LOCKED';
          emit(
            'breaker.tripped',
            { reason: `授权摘要异常：${grantResult.reason}`, failures: live.security.failures, injectionHits: live.security.injectionHits, lockedUntil: live.security.lockedUntil },
            runId,
          );
          persist();
          return session.state;
        }
        return pauseForNode(session, node, policy, emit, runId);
      }
      audit.append(
        'GRANT_CONSUMED',
        `授权令牌已使用：${node.label}`,
        { nodeId: node.id, grantId: grantId.slice(0, 12) },
        { sessionId: session.id, runId },
      );
    }

    // T4：资金交易不直接执行，转入人工审核队列，审核通过后由审核接口执行
    if (policy.decision === 'REVIEW' && node.tool === 'transfer') {
      const review = await deferToManualReview({
        userId: session.userId,
        node,
        policy,
        runId,
      });
      node.status = 'SUCCESS';
      node.startedAt = node.startedAt ?? clock.nowIso();
      node.finishedAt = clock.nowIso();
      node.result = {
        ok: true,
        data: { review, deferredToReview: true },
        evidence: [review.id],
        summary: `已受理并转入人工审核（${review.id}），审核通过后自动执行；${Math.round(
          MANUAL_REVIEW_WINDOW_MS / 60_000,
        )} 分钟内可撤销`,
      };
      emitNode(emit, runId, node, { deferredToReview: true, reviewId: review.id });
      continue;
    }

    // 幂等：同一节点、同一参数只可能成功一次
    const idemKey = createHash('sha256')
      .update(`${session.id}|${runId}|${node.id}|${node.tool}|${stableStringify(node.args)}`)
      .digest('hex');
    const replay = bank.idempotency[idemKey];
    if (replay) {
      node.result = replay.result as ToolResult;
      node.status = node.result.ok ? 'SUCCESS' : 'FAILED';
      node.finishedAt = clock.nowIso();
      emitNode(emit, runId, node, { idempotentReplay: true });
      audit.append('IDEMPOTENT_HIT', `命中幂等缓存：${node.label}`, { nodeId: node.id }, {
        sessionId: session.id,
        runId,
      });
      continue;
    }

    let reservationId: string | null = null;
    if (node.tool === 'transfer' && policy.amountCents) {
      try {
        const reservation = await reserve(live, {
          userId: session.userId,
          nodeId: node.id,
          amountCents: policy.amountCents,
        });
        reservationId = reservation.id;
        audit.append(
          'LIMIT_RESERVED',
          `额度预留 ${policy.amountCents / 100} 元`,
          { nodeId: node.id, remaining: getLimitSummary(live).remainingCents },
          { sessionId: session.id, runId },
        );
      } catch (error) {
        const message = (error as Error).message;
        node.result = { ok: false, error: { code: 'LIMIT_RESERVE_FAILED', message } };
        node.status = 'FAILED';
        node.finishedAt = clock.nowIso();
        emitNode(emit, runId, node);
        const failure = recordFailure(live, message);
        if (failure.tripped) {
          session.state = 'LOCKED';
          emit('breaker.tripped', { reason: message, ...failure }, runId);
          persist();
          return session.state;
        }
        persist();
        continue;
      }
    }

    try {
      const handler = toolHandler(node.tool);
      const runHandler = () =>
        handler({
          state: live,
          userId: session.userId,
          idempotencyKey: idemKey,
          sessionId: session.id,
          runId,
          node,
          resultOf: (nodeId: string) => dag.nodes.find((n) => n.id === nodeId)?.result,
        });
      let result = await runHandler();
      // 模板声明了重试次数：只重试上游瞬时故障，业务拒绝不重试
      const retryable = (r: typeof result) =>
        !r.ok && /BANK_UNAVAILABLE|TIMEOUT|_FAILED$|RATE_LIMITED/.test(r.error?.code ?? '');
      for (let attempt = 0; !result.ok && retryable(result) && attempt < 2; attempt += 1) {
        node.attempts += 1;
        audit.append(
          'TOOL_RETRY',
          `${node.label} 第 ${node.attempts} 次重试（${result.error?.code ?? '未知错误'}）`,
          { nodeId: node.id, tool: node.tool, code: result.error?.code },
          { sessionId: session.id, runId },
        );
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        result = await runHandler();
      }
      node.result = result;
      node.status = result.ok ? 'SUCCESS' : 'FAILED';
      node.finishedAt = clock.nowIso();
      if (reservationId) {
        if (result.ok) commitReservation(live, reservationId);
        else releaseReservation(live, reservationId);
      }
      if (result.ok) {
        bank.idempotency[idemKey] = { key: idemKey, result, at: clock.nowIso() };
        recordSuccess(live);
      } else {
        const failure = recordFailure(live, result.error?.message ?? '工具执行失败');
        persist();
        if (failure.tripped) {
          audit.append(
            'BREAKER_TRIPPED',
            `连续失败触发安全锁定：${result.error?.message ?? '未知错误'}`,
            { failures: failure.failures },
            { sessionId: session.id, runId },
          );
          session.state = 'LOCKED';
          emit('breaker.tripped', { reason: result.error?.message, ...failure }, runId);
          emitNode(emit, runId, node);
          return session.state;
        }
      }
      emitNode(emit, runId, node);
      audit.append(
        result.ok ? 'TOOL_SUCCESS' : 'TOOL_FAILED',
        `${node.label}：${result.summary ?? result.error?.message ?? ''}`,
        {
          nodeId: node.id,
          tool: node.tool,
          status: node.status,
          resultSummary: result.summary,
          error: result.error,
        },
        { sessionId: session.id, runId },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      node.result = { ok: false, error: { code: 'TOOL_EXCEPTION', message } };
      node.status = 'FAILED';
      node.finishedAt = clock.nowIso();
      if (reservationId) releaseReservation(live, reservationId);
      emitNode(emit, runId, node);
      const failure = recordFailure(live, message);
      audit.append('TOOL_EXCEPTION', `${node.label} 异常：${message}`, { nodeId: node.id }, {
        sessionId: session.id,
        runId,
      });
      persist();
      if (failure.tripped) {
        session.state = 'LOCKED';
        emit('breaker.tripped', { reason: message, ...failure }, runId);
        return session.state;
      }
    }
  }
}

export function addAbortNotice(session: SessionInternal): void {
  appendMessage(session, {
    role: 'system',
    text: '任务已中断。已完成的操作保留，未执行的步骤已跳过；如需冲正，可使用任务回退。',
    meta: { tone: 'warning' },
  });
}
