import { createHash } from 'node:crypto';
import type { PendingAction, StepUpChallenge } from '@bank/shared';
import { clock } from '../core/clock';
import { getState, persist } from '../core/store';
import { metrics } from '../metrics';
import { evaluateNode } from '../policy/engine';
import { issueGrant, operationDigest } from '../policy/grant';
import { getChallenge, verifyStepUp } from '../policy/stepup';
import { audit } from '../security/auditChain';
import { clearSecurity, lockSecurity, recordFailure } from '../security/breaker';
import { verifyPayeeEcho } from '../policy/safeguards';
import { preparePending } from './executor';
import {
  appendMessage,
  finishRunSummary,
  startRunSummary,
  touch,
  type SessionInternal,
} from './session';
import { compensateRun } from './compensation';
import { rollbackCompletedRun } from './orchestrator';
import { nullEmitter } from './events';

export interface ControlResult {
  ok: boolean;
  code?: string;
  message?: string;
  resume?: boolean;
  canceled?: boolean;
  locked?: boolean;
  needStepUp?: boolean;
  challenge?: StepUpChallenge;
  attemptsLeft?: number;
  accepted?: boolean;
  report?: unknown;
}

function nodeDigest(session: SessionInternal, nodeId: string): string | null {
  const node = session.dag?.nodes.find((n) => n.id === nodeId);
  if (!node || !session.dag) return null;
  return operationDigest({
    userId: session.userId,
    sessionId: session.id,
    runId: session.dag.runId,
    nodeId: node.id,
    tool: node.tool,
    args: node.args,
  });
}

function cancelPending(session: SessionInternal, reason: string): void {
  const pending = session.pending;
  if (!pending) return;
  const runId = session.dag?.runId;
  const nodeIds = pending.batchNodeIds?.length ? pending.batchNodeIds : [pending.nodeId];
  for (const id of nodeIds) {
    const node = session.dag?.nodes.find((n) => n.id === id);
    if (node && (node.status === 'AWAIT_CONFIRM' || node.status === 'AWAIT_STEPUP' || node.status === 'PENDING' || node.status === 'READY')) {
      node.status = 'SKIPPED';
    }
  }
  session.pending = null;
  session.state = 'CANCELLED';
  session.grants = {};
  appendMessage(session, {
    role: 'assistant',
    text: reason,
    meta: { tone: 'warning', runId },
  });
  audit.append('CONFIRM_CANCELLED', reason, { nodeIds }, { sessionId: session.id, runId });
  if (runId) finishRunSummary(session, 'CANCELLED', runId);
  persist();
  touch(session);
}

export function confirmPending(
  session: SessionInternal,
  input: { digest: string; approve: boolean; nodeId?: string; payeeEcho?: string },
): ControlResult {
  const pending = session.pending;
  if (!pending) return { ok: false, code: 'NO_PENDING', message: '当前没有待确认的操作' };
  if (input.nodeId && input.nodeId !== pending.nodeId) {
    return { ok: false, code: 'NODE_MISMATCH', message: '确认节点不匹配' };
  }
  if (input.digest !== pending.digest) {
    audit.append(
      'CONFIRM_DIGEST_MISMATCH',
      '确认摘要校验失败：可能是改单或重放攻击',
      { nodeId: pending.nodeId, expected: pending.digest.slice(0, 16), received: input.digest.slice(0, 16) },
      { sessionId: session.id, runId: session.dag?.runId },
    );
    return { ok: false, code: 'DIGEST_MISMATCH', message: '操作摘要不匹配，确认已拒绝' };
  }
  if (new Date(pending.expiresAt).getTime() <= clock.wallNow().getTime()) {
    cancelPending(session, '确认已超时，本次操作已取消。请重新发起。');
    return { ok: false, code: 'EXPIRED', message: '确认已超时', canceled: true };
  }

  if (!input.approve) {
    cancelPending(session, '已取消本次操作，未发生任何资金变动。');
    return { ok: true, canceled: true };
  }

  if (pending.kind === 'STEPUP') {
    return { ok: true, needStepUp: true, challenge: pending.challenge };
  }

  const bank = getState(session.userId);
  const dag = session.dag;
  if (!dag) return { ok: false, code: 'NO_DAG', message: '任务不存在' };

  // T2 及以上要求手输收款人姓名：比对在服务端完成，3 次不一致触发熔断
  if (pending.payeeEcho?.required) {
    const echoNode = dag.nodes.find((n) => n.id === pending.nodeId);
    if (echoNode && !verifyPayeeEcho(echoNode, input.payeeEcho)) {
      const failure = recordFailure(bank, '收款人姓名复述不一致');
      audit.append(
        'PAYEE_ECHO_MISMATCH',
        `收款人复述不一致：${pending.payeeEcho.masked ?? '—'}`,
        { nodeId: pending.nodeId, failures: failure.failures, tripped: failure.tripped },
        { sessionId: session.id, runId: dag.runId },
      );
      persist();
      touch(session);
      return {
        ok: false,
        code: 'PAYEE_ECHO_MISMATCH',
        message: failure.tripped
          ? '收款人姓名连续填错，会话已锁定，需人工复核解锁。'
          : '收款人姓名与确认单不一致，请重新输入或取消本次操作。',
      };
    }
    audit.append(
      'PAYEE_ECHO_VERIFIED',
      '收款人姓名复述通过',
      { nodeId: pending.nodeId },
      { sessionId: session.id, runId: dag.runId },
    );
  }
  const ids = pending.batchNodeIds?.length ? pending.batchNodeIds : [pending.nodeId];
  let needStepUp: StepUpChallenge | undefined;
  const grantedNodeIds: string[] = [];

  for (const id of ids) {
    const node = dag.nodes.find((n) => n.id === id);
    if (!node || (node.status !== 'AWAIT_CONFIRM' && node.status !== 'PENDING' && node.status !== 'READY')) {
      continue;
    }
    const policy = evaluateNode(bank, node);
    node.policy = policy;
    node.risk = policy.effectiveRisk;
    if (policy.decision === 'STEPUP') {
      if (node.id === pending.nodeId) {
        const next = preparePending(session, node, policy, dag.runId);
        node.status = 'AWAIT_STEPUP';
        session.pending = next;
        session.state = 'AWAIT_STEPUP';
        needStepUp = next.challenge;
        attachChallengeToSession(session, next.challenge);
        break;
      }
      continue;
    }
    if (policy.decision === 'DENY') continue;
    const digest = nodeDigest(session, node.id);
    if (!digest) continue;
    const grant = issueGrant({
      userId: session.userId,
      sessionId: session.id,
      runId: dag.runId,
      nodeId: node.id,
      tool: node.tool,
      risk: policy.effectiveRisk,
      amountCents: policy.amountCents,
      digest,
      authMethods: ['USER_CONFIRM'],
    });
    session.grants[node.id] = grant.id;
    node.status = 'READY';
    grantedNodeIds.push(node.id);
    audit.append(
      'GRANT_ISSUED',
      `用户确认后签发授权：${node.label}`,
      { nodeId: node.id, risk: policy.effectiveRisk, grantId: grant.id.slice(0, 12) },
      { sessionId: session.id, runId: dag.runId },
    );
  }

  if (!needStepUp) {
    session.pending = null;
    session.state = 'EXECUTING';
  }
  audit.append(
    'CONFIRM_APPROVED',
    needStepUp
      ? '确认期间额度变化，升级为强验证'
      : `用户确认 ${grantedNodeIds.length} 个操作`,
    { grantedNodeIds, needStepUp, summary: pending.summary },
    { sessionId: session.id, runId: dag.runId },
  );
  persist();
  touch(session);
  if (needStepUp) {
    return {
      ok: true,
      needStepUp: true,
      challenge: needStepUp,
      message: '额度发生变化，需要重新进行强验证',
    };
  }
  return { ok: true, resume: true };
}

function attachChallengeToSession(session: SessionInternal, challenge?: StepUpChallenge): void {
  if (!challenge) return;
  session.challenges[challenge.id] = challenge.nodeId;
}

export async function submitStepUp(
  session: SessionInternal,
  input: { challengeId: string; faceDone?: boolean; smsCode?: string },
): Promise<ControlResult> {
  const pending = session.pending;
  if (!pending || pending.kind !== 'STEPUP' || !pending.challenge) {
    return { ok: false, code: 'NO_STEPUP', message: '当前没有待验证的操作' };
  }
  if (pending.challenge.id !== input.challengeId) {
    return { ok: false, code: 'CHALLENGE_MISMATCH', message: '验证挑战不匹配' };
  }
  if (new Date(pending.expiresAt).getTime() <= clock.wallNow().getTime()) {
    cancelPending(session, '强验证已超时，本次操作已取消。');
    return { ok: false, code: 'EXPIRED', message: '验证已超时', canceled: true };
  }
  const verification = await verifyStepUp(input.challengeId, {
    faceDone: input.faceDone,
    smsCode: input.smsCode,
  });
  const bank = getState(session.userId);
  const runId = session.dag?.runId;

  if (!verification.ok) {
    audit.append(
      'STEPUP_FAILED',
      `强验证失败：${verification.error}`,
      { challengeId: input.challengeId, attemptsLeft: verification.attemptsLeft },
      { sessionId: session.id, runId },
    );
    if (verification.error === 'CHALLENGE_EXPIRED') {
      cancelPending(session, '强验证已超时，本次操作已取消。请重新发起。');
      return { ok: false, code: 'EXPIRED', message: '验证已超时', canceled: true };
    }
    if (verification.fatal && verification.error === 'SMS_ATTEMPTS_EXHAUSTED') {
      const node = session.dag?.nodes.find((n) => n.id === pending.nodeId);
      if (node) {
        node.status = 'FAILED';
        node.result = { ok: false, error: { code: 'STEPUP_EXHAUSTED', message: '短信验证码连续错误' } };
      }
      lockSecurity(bank, '短信验证码连续错误 3 次');
      session.pending = null;
      session.state = 'LOCKED';
      appendMessage(session, {
        role: 'assistant',
        text: '短信验证码连续错误，已触发安全熔断。本次操作未执行，请在控制台完成人工复核。',
        card: { type: 'locked', title: '安全锁定', detail: '短信验证码连续错误 3 次' },
        meta: { tone: 'danger', runId },
      });
      audit.append('BREAKER_TRIPPED', '短信验证连续失败，会话锁定', {}, { sessionId: session.id, runId });
      if (runId) finishRunSummary(session, 'LOCKED', runId);
      persist();
      return { ok: false, code: 'LOCKED', locked: true, message: '验证失败次数过多，已锁定' };
    }
    if (verification.fatal) {
      cancelPending(session, '验证挑战已失效，本次操作已取消。请重新发起。');
      return { ok: false, code: verification.error, message: '验证挑战已失效', canceled: true };
    }
    if (pending.challenge) pending.challenge.attemptsLeft = verification.attemptsLeft;
    return {
      ok: false,
      code: verification.error,
      message: verification.error === 'SMS_INVALID' ? '短信验证码错误' : '强验证未完成',
      attemptsLeft: verification.attemptsLeft,
    };
  }

  const node = session.dag?.nodes.find((n) => n.id === pending.nodeId);
  if (!node || !session.dag) {
    return { ok: false, code: 'NODE_NOT_FOUND', message: '待验证节点不存在' };
  }
  const policy = evaluateNode(bank, node);
  node.policy = policy;
  node.risk = policy.effectiveRisk;
  const digest = nodeDigest(session, node.id);
  if (!digest) return { ok: false, code: 'DIGEST_ERROR', message: '操作摘要异常' };
  const grant = issueGrant({
    userId: session.userId,
    sessionId: session.id,
    runId: session.dag.runId,
    nodeId: node.id,
    tool: node.tool,
    risk: policy.effectiveRisk,
    amountCents: policy.amountCents,
    digest,
    authMethods: verification.methods ?? ['FACE'],
  });
  session.grants[node.id] = grant.id;
  node.status = 'READY';
  session.pending = null;
  session.state = 'EXECUTING';
  audit.append(
    'STEPUP_SUCCESS',
    `强验证通过并签发授权：${node.label}`,
    { nodeId: node.id, methods: verification.methods, grantId: grant.id.slice(0, 12) },
    { sessionId: session.id, runId: session.dag.runId },
  );
  persist();
  touch(session);
  return { ok: true, resume: true };
}

export async function interruptRun(
  session: SessionInternal,
  mode: 'abort' | 'rollback',
): Promise<ControlResult> {
  const runId = session.dag?.runId;
  if (session.pending) {
    cancelPending(session, mode === 'rollback' ? '已取消待确认操作，尚未产生资金变动。' : '已取消本次操作。');
    return { ok: true, canceled: true };
  }
  if (session.state === 'EXECUTING' || session.state === 'PLANNING') {
    session.abortRequested = true;
    if (mode === 'rollback') session.rollbackRequested = true;
    audit.append(
      'INTERRUPT_REQUESTED',
      mode === 'rollback' ? '用户请求中断并回退' : '用户请求中断任务',
      { mode },
      { sessionId: session.id, runId },
    );
    touch(session);
    return { ok: true, accepted: true, message: '中断请求已发送，将在当前节点结束后生效' };
  }
  if (mode === 'rollback' && ['DONE', 'PARTIAL', 'FAILED'].includes(session.state)) {
    const reversible = session.dag?.nodes.some((n) => n.status === 'SUCCESS' && n.reversible);
    if (!reversible) {
      return { ok: false, code: 'NOTHING_TO_ROLLBACK', message: '当前任务没有可回退的操作' };
    }
    await rollbackCompletedRun(session, nullEmitter);
    return { ok: true, canceled: false, message: '已执行回退', report: { state: session.state } };
  }
  return { ok: false, code: 'NOTHING_TO_INTERRUPT', message: '当前没有可中断的任务' };
}

export function takeoverAction(
  session: SessionInternal,
  action: 'take' | 'release' | 'abort' | 'unlock',
): ControlResult {
  const bank = getState(session.userId);
  const runId = session.dag?.runId;
  if (action === 'take') {
    session.takeover = true;
    session.state = 'HUMAN_TAKEOVER';
    appendMessage(session, {
      role: 'system',
      text: '已切换为人工接管。自动执行会在当前节点结束后暂停，可在控制台选择恢复或终止。',
      meta: { tone: 'warning', runId },
    });
    audit.append('TAKEOVER_TAKE', '人工接管已生效', {}, { sessionId: session.id, runId });
    touch(session);
    return { ok: true };
  }
  if (action === 'release') {
    session.takeover = false;
    const pending = session.dag?.nodes.some(
      (n) => n.status === 'PENDING' || n.status === 'READY' || n.status === 'AWAIT_CONFIRM' || n.status === 'AWAIT_STEPUP' || n.status === 'RUNNING',
    );
    if (session.pending) {
      session.state = session.pending.kind === 'STEPUP' ? 'AWAIT_STEPUP' : 'AWAIT_CONFIRM';
    } else if (pending) {
      session.state = 'EXECUTING';
    } else {
      session.state = session.dag ? 'DONE' : 'IDLE';
    }
    appendMessage(session, {
      role: 'system',
      text: session.pending ? '已退出人工接管，请继续完成待确认操作。' : '已恢复自动执行，将从中断的节点继续。',
      meta: { tone: 'normal', runId },
    });
    audit.append('TAKEOVER_RELEASE', '人工接管解除', { pending: Boolean(session.pending) }, { sessionId: session.id, runId });
    touch(session);
    return {
      ok: true,
      resume: Boolean(!session.pending && pending),
      message: session.pending ? '已退出人工接管，请继续确认' : '已恢复自动执行',
    };
  }
  if (action === 'abort') {
    session.takeover = false;
    session.abortRequested = true;
    session.state = 'CANCELLED';
    session.pending = null;
    for (const node of session.dag?.nodes ?? []) {
      if (node.status === 'PENDING' || node.status === 'READY' || node.status === 'AWAIT_CONFIRM' || node.status === 'AWAIT_STEPUP') {
        node.status = 'SKIPPED';
      }
    }
    appendMessage(session, {
      role: 'assistant',
      text: '已终止任务。已完成的操作保留，未执行的步骤已跳过。',
      meta: { tone: 'warning', runId },
    });
    audit.append('TAKEOVER_ABORT', '人工终止任务', {}, { sessionId: session.id, runId });
    if (runId) finishRunSummary(session, 'CANCELLED', runId);
    touch(session);
    return { ok: true, canceled: true };
  }
  // unlock：人工复核解除熔断
  clearSecurity(bank);
  if (session.state === 'LOCKED') session.state = 'IDLE';
  appendMessage(session, {
    role: 'system',
    text: '人工复核完成，安全锁定已解除，可以继续操作。',
    meta: { tone: 'success' },
  });
  audit.append('MANUAL_UNLOCK', '人工复核解除安全锁定', {}, { sessionId: session.id });
  persist();
  touch(session);
  return { ok: true };
}

export function resetDemoSession(session: SessionInternal): void {
  session.dag = null;
  session.pending = null;
  session.state = 'IDLE';
  session.takeover = false;
  session.abortRequested = false;
  session.rollbackRequested = false;
  session.grants = {};
  session.challenges = {};
  session.clarifyDraft = null;
  session.clarifyOptions = null;
  session.lastNlu = null;
  session.runs = [];
  session.messages = [];
  touch(session);
}
