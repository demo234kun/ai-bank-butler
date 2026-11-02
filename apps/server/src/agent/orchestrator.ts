import { randomUUID } from 'node:crypto';
import {
  formatMoney,
  type Card,
  type ChatMessage,
  type ClarifyOption,
  type FlowState,
  type Intent,
  type NluResult,
} from '@bank/shared';
import { clock } from '../core/clock';
import { getState, persist } from '../core/store';
import type { BankState } from '../core/state';
import { metrics } from '../metrics';
import { combineInjection, scanInjection, type InjectionResult } from '../nlu/injection';
import { mergeClarification, parseWithRules } from '../nlu/fallbackRules';
import { understand } from '../nlu/understand';
import { audit } from '../security/auditChain';
import { isLocked, recordInjectionHit } from '../security/breaker';
import { executeDag } from './executor';
import { renderRun } from '../render/result';
import { buildPlan } from './planner';
import {
  appendMessage,
  finishRunSummary,
  startRunSummary,
  touch,
  type SessionInternal,
} from './session';
import { compensateRun } from './compensation';
import { addAbortNotice } from './executor';
import type { EmitFn } from './events';

const MAX_PENDING_MSG = '你还有一个待确认的操作。请先在确认单中完成或取消，再继续新的需求。';

function newRunId(): string {
  return `run_${randomUUID().slice(0, 8)}`;
}

export function emitAssistant(
  session: SessionInternal,
  emit: EmitFn,
  payload: {
    text?: string;
    card?: Card;
    evidence?: string[];
    meta?: ChatMessage['meta'];
  },
  runId?: string,
): ChatMessage {
  const message = appendMessage(session, {
    role: 'assistant',
    text: payload.text,
    card: payload.card,
    evidence: payload.evidence,
    meta: payload.meta,
  });
  if (message.card) {
    emit('render.card', { messageId: message.id, card: message.card, ts: message.ts }, runId);
  }
  emit(
    'message.final',
    {
      messageId: message.id,
      role: 'assistant',
      text: message.text,
      cardType: message.card?.type,
      evidence: message.evidence,
      meta: message.meta,
      ts: message.ts,
    },
    runId,
  );
  return message;
}

function emitRunEnd(
  session: SessionInternal,
  emit: EmitFn,
  runId: string,
  status: FlowState,
  extra: Record<string, unknown> = {},
): void {
  emit('run.end', { status, runId, ...extra }, runId);
  touch(session);
}

function blockedMessage(intent: Intent, injection: InjectionResult, locked: boolean): { text: string; card: Card } {
  return {
    text: locked
      ? '检测到疑似提示词注入，且已触发安全熔断。本次会话已锁定，请在控制台完成人工复核。'
      : '检测到疑似提示词注入，已阻断本次请求。权限校验在服务端独立执行，不受对话内容影响。',
    card: {
      type: 'blocked',
      title: '安全拦截',
      score: injection.score,
      patterns: injection.patterns,
      categories: injection.categories,
      explanation: injection.explanation,
      locked,
      intent,
    },
  };
}

function blockInput(
  session: SessionInternal,
  emit: EmitFn,
  runId: string,
  utterance: string,
  injection: InjectionResult,
  intent: Intent = 'unknown',
): void {
  const bank = getState(session.userId);
  metrics.recordInjectionBlocked();
  const hit = recordInjectionHit(bank, injection.explanation);
  const locked = hit.tripped;
  if (locked) {
    session.state = 'LOCKED';
  } else {
    session.state = 'CANCELLED';
  }
  audit.append(
    'INJECTION_BLOCK',
    `拦截疑似提示词注入：${injection.categories.join('、') || '未知类型'}`,
    {
      utterance,
      score: injection.score,
      patterns: injection.patterns,
      locked,
      failures: hit.hits,
    },
    { sessionId: session.id, runId },
  );
  emit(
    'injection.flag',
    {
      score: injection.score,
      patterns: injection.patterns,
      categories: injection.categories,
      action: 'block',
      explanation: injection.explanation,
      locked,
    },
    runId,
  );
  const payload = blockedMessage(intent, injection, locked);
  emitAssistant(
    session,
    emit,
    {
      text: payload.text,
      card: payload.card,
      meta: { tone: 'danger', blocked: true, intent },
    },
    runId,
  );
  if (locked) {
    emit(
      'breaker.tripped',
      { reason: injection.explanation, injectionHits: hit.hits, lockedUntil: hit.lockedUntil },
      runId,
    );
    audit.append('BREAKER_TRIPPED', '注入次数达到阈值，会话被锁定', { hits: hit.hits }, {
      sessionId: session.id,
      runId,
    });
  }
  persist();
  finishRunSummary(session, session.state, runId);
  emitRunEnd(session, emit, runId, session.state, { intent, blocked: true });
}

function applyClarifyOption(
  session: SessionInternal,
  option: { label: string; slot: string; value: string },
): NluResult {
  const draft = session.clarifyDraft!;
  const slots = { ...draft.slots };
  if (['amount', 'limitAmount', 'budget', 'splitTotal'].includes(option.slot)) {
    (slots as any)[option.slot] = Number(option.value);
  } else if (option.slot === 'contactId') {
    const contact = getState(session.userId).user.contacts.find((c) => c.id === option.value);
    slots.contactId = option.value;
    if (contact) {
      slots.payee = contact.name;
    }
  } else if (option.slot === 'subscriptionId') {
    const sub = getState(session.userId).subscriptions.find((s) => s.id === option.value);
    slots.subscriptionId = option.value;
    if (sub) slots.subscriptionName = sub.merchant;
  } else if (option.slot === 'cardLast4') {
    slots.cardLast4 = option.value;
  } else if (option.slot === 'splitNames') {
    slots.splitNames = [option.value];
  } else {
    (slots as any)[option.slot] = option.value;
  }
  return {
    ...draft,
    slots,
    utterance: option.label,
    confidence: 0.92,
    source: 'cache',
    rationale: '用户从澄清选项中选择',
  };
}

function updateContextFromRun(session: SessionInternal, nlu: NluResult | null): void {
  if (!nlu) return;
  const ctx = session.context;
  ctx.lastIntent = nlu.intent;
  const dag = session.dag;
  const resolved: Record<string, string> = {};
  const find = (tool: string, status = 'SUCCESS') =>
    dag?.nodes.find((n) => n.tool === tool && n.status === status);

  if (nlu.intent === 'transfer') {
    const transfer = find('transfer');
    const schedule = find('schedule_transfer');
    const split = find('split_request');
    if (transfer?.result?.data) {
      const data = transfer.result.data;
      const recipient = data.recipients?.[0];
      if (recipient) {
        ctx.lastPayee = recipient.name;
        ctx.lastPayeeBank = recipient.bank;
        resolved.payee = recipient.name;
      }
      ctx.lastAmountCents = data.totalCents;
      ctx.lastTxnIds = (data.txns ?? []).map((t: any) => t.id);
      resolved.amount = String((data.totalCents ?? 0) / 100);
    } else if (schedule?.result?.data) {
      const data = schedule.result.data;
      ctx.lastPayee = data.payee;
      ctx.lastAmountCents = data.amountCents;
      resolved.schedule = data.payee;
      resolved.amount = String((data.amountCents ?? 0) / 100);
    } else if (split?.result?.data) {
      resolved.aa = split.result.data.shares?.map((s: any) => s.name).join('、') ?? '';
    }
  }

  if (nlu.intent === 'wealth') {
    const purchase = find('purchase_wealth');
    const redeem = find('redeem_wealth');
    const match = find('match_products');
    const data = purchase?.result?.data ?? redeem?.result?.data;
    const productName = data?.product?.name ?? match?.result?.data?.selected?.name;
    if (productName) {
      ctx.lastProduct = productName;
      resolved.product = productName;
    }
    if (purchase?.result?.data) resolved.action = '申购';
    else if (redeem?.result?.data) resolved.action = '赎回';
    else resolved.action = '产品对比';
  }

  if (nlu.intent === 'bills') {
    ctx.lastPeriod = nlu.slots.period ?? 'currentMonth';
    resolved.period = nlu.slots.period === 'lastMonth' ? '上个月' : nlu.slots.period === 'year' ? '今年' : '本月';
    const category = nlu.slots.category;
    if (category) resolved.category = category;
  }

  if (nlu.intent === 'subscription') {
    const cancel = find('cancel_subscription');
    if (cancel?.result?.data?.subscription) {
      resolved.subscription = cancel.result.data.subscription.merchant;
    } else {
      resolved.subscription = '自动续费体检';
    }
  }

  if (nlu.intent === 'card') {
    const action = ['apply_virtual_card', 'adjust_card_limit', 'freeze_card', 'unfreeze_card', 'report_loss']
      .map((tool) => find(tool))
      .find(Boolean);
    if (action?.result?.data?.card) {
      resolved.card = `尾号 ${action.result.data.card.last4}`;
    } else {
      resolved.card = '卡片总览';
    }
  }

  if (nlu.intent === 'crossscene') {
    const birthday = find('resolve_birthday');
    if (birthday?.result?.data) {
      resolved.birthday = birthday.result.data.birthdayLabel;
      resolved.spouse = birthday.result.data.spouseName;
    }
  }

  if (nlu.intent === 'account') {
    resolved.query = nlu.slots.query === 'transactions' ? '交易流水' : '账户余额';
  }

  if (Object.keys(resolved).length || nlu.utterance) {
    ctx.references.push({
      at: clock.nowIso(),
      utterance: (nlu.utterance ?? '').slice(0, 60),
      resolved,
    });
  }
  if (ctx.references.length > 6) ctx.references = ctx.references.slice(-6);
}

function nodeCounts(session: SessionInternal): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const node of session.dag?.nodes ?? []) {
    counts[node.status] = (counts[node.status] ?? 0) + 1;
  }
  return counts;
}

export async function completeRun(session: SessionInternal, emit: EmitFn, status: FlowState): Promise<void> {
  const bank = getState(session.userId);
  const runId = session.dag?.runId ?? newRunId();
  const intent = session.dag?.intent ?? 'unknown';
  session.state = status;

  if (status === 'AWAIT_CONFIRM' || status === 'AWAIT_STEPUP') {
    touch(session);
    return;
  }

  if (session.rollbackRequested) {
    session.rollbackRequested = false;
    session.abortRequested = false;
    const report = await compensateRun(session, emit, runId);
    emitAssistant(
      session,
      emit,
      {
        text: `已按逆序回退本次任务：${report.compensated.length} 个操作已冲正${report.manual.length ? `，${report.manual.length} 个不可逆操作已转人工` : ''}${report.failed.length ? `，${report.failed.length} 个回退失败` : ''}。`,
        card: {
          type: 'compensation',
          title: '任务回退结果',
          compensated: report.compensated,
          manual: report.manual,
          failed: report.failed,
          runId,
        },
        meta: { tone: report.failed.length ? 'warning' : 'success', runId },
      },
      runId,
    );
    session.state = 'PARTIAL';
    finishRunSummary(session, 'PARTIAL', runId);
    audit.append('ROLLBACK', '用户请求回退任务，已执行逆序补偿', report as any, {
      sessionId: session.id,
      runId,
    });
    emitRunEnd(session, emit, runId, 'PARTIAL', { intent, counts: nodeCounts(session), rollback: true });
    return;
  }

  const aborted = session.abortRequested;
  session.abortRequested = false;

  if (status === 'HUMAN_TAKEOVER') {
    emitAssistant(
      session,
      emit,
      {
        text: '任务已暂停，等待人工接管。请在安全控制台选择恢复、终止或回退。',
        meta: { tone: 'warning', intent },
      },
      runId,
    );
    finishRunSummary(session, 'HUMAN_TAKEOVER', runId);
    audit.append('RUN_PAUSED', '任务转人工接管', {}, { sessionId: session.id, runId });
    emitRunEnd(session, emit, runId, 'HUMAN_TAKEOVER', { intent });
    return;
  }

  if (aborted) {
    addAbortNotice(session);
  }

  let rendered;
  try {
    rendered = renderRun(session, bank);
  } catch (error) {
    rendered = {
      text: '操作已结束，但生成回执时出现异常，请查看审计日志。',
      card: { type: 'error', title: '回执生成失败', detail: error instanceof Error ? error.message : String(error) },
      evidence: [],
      intent,
      risk: 'YELLOW' as const,
      tone: 'warning' as const,
    };
  }
  emitAssistant(
    session,
    emit,
    {
      text: rendered.text,
      card: rendered.card,
      evidence: rendered.evidence,
      meta: { intent: rendered.intent, risk: rendered.risk, tone: rendered.tone, runId },
    },
    runId,
  );

  if (status === 'PARTIAL' && session.dag) {
    const succeeded = session.dag.nodes.filter((n) => n.status === 'SUCCESS').length;
    const total = session.dag.nodes.length;
    audit.append('RUN_PARTIAL', `任务部分完成：${succeeded}/${total} 个节点成功`, nodeCounts(session), {
      sessionId: session.id,
      runId,
    });
  }
  finishRunSummary(session, status, runId);
  updateContextFromRun(session, session.lastNlu);
  session.pending = null;
  session.rollbackRequested = false;
  audit.append(
    'RUN_END',
    `任务结束：${session.dag?.title ?? '对话'}（${status}）`,
    {
      status,
      intent,
      counts: nodeCounts(session),
      guard: metrics.guardStats(),
      llm: metrics.llmStats(),
    },
    { sessionId: session.id, runId },
  );
  emitRunEnd(session, emit, runId, status, {
    intent,
    title: session.dag?.title,
    counts: nodeCounts(session),
    canRollback: (session.dag?.nodes ?? []).some((n) => n.status === 'SUCCESS' && n.reversible),
  });
}

async function executeRun(session: SessionInternal, emit: EmitFn): Promise<void> {
  const runId = session.dag?.runId ?? newRunId();
  session.state = 'EXECUTING';
  touch(session);
  const status = await executeDag(session, emit);
  await completeRun(session, emit, status);
}

export async function handleUserMessage(
  session: SessionInternal,
  rawText: string,
  emit: EmitFn,
): Promise<void> {
  const text = rawText.trim();
  if (!text) return;
  const bank = getState(session.userId);
  const runId = newRunId();

  appendMessage(session, { role: 'user', text, meta: {} });
  touch(session);

  if (isLocked(bank) || session.state === 'LOCKED') {
    session.state = 'LOCKED';
    emitAssistant(
      session,
      emit,
      {
        text: '当前会话处于安全锁定状态，无法发起新操作。请在安全控制台完成人工复核后解锁。',
        card: { type: 'locked', title: '安全锁定', detail: bank.security.lastReason ?? '触发熔断' },
        meta: { tone: 'danger' },
      },
      runId,
    );
    emitRunEnd(session, emit, runId, 'LOCKED', { intent: 'unknown' });
    return;
  }

  if (session.takeover || session.state === 'HUMAN_TAKEOVER') {
    emitAssistant(
      session,
      emit,
      {
        text: '任务处于人工接管状态，请先在控制台选择恢复或终止，再继续对话。',
        meta: { tone: 'warning' },
      },
      runId,
    );
    emitRunEnd(session, emit, runId, 'HUMAN_TAKEOVER', { intent: 'unknown' });
    return;
  }

  if (session.pending) {
    emitAssistant(
      session,
      emit,
      { text: MAX_PENDING_MSG, card: { type: 'pending', pending: session.pending }, meta: { tone: 'warning' } },
      runId,
    );
    emitRunEnd(session, emit, runId, session.state, { intent: 'unknown' });
    return;
  }

  emit('run.start', { utterance: text, llmMode: metrics.mode, at: clock.nowIso() }, runId);

  const preScan = scanInjection(text);
  if (preScan.verdict === 'block') {
    blockInput(session, emit, runId, text, preScan);
    return;
  }

  session.state = 'PARSING';
  touch(session);

  try {
    let nlu: NluResult;
    if (session.clarifyDraft) {
      const option = session.clarifyOptions?.find((o) => o.label === text);
      if (option) {
        nlu = applyClarifyOption(session, option);
      } else if (/^(取消|算了|不用了|先不|没事了)/.test(text)) {
        session.clarifyDraft = null;
        session.clarifyOptions = null;
        session.state = 'IDLE';
        emitAssistant(
          session,
          emit,
          { text: '好的，已取消这次补充。你可以继续描述新的需求。', meta: { tone: 'normal' } },
          runId,
        );
        audit.append('CLARIFY_CANCELLED', '用户取消补充信息', {}, { sessionId: session.id, runId });
        emitRunEnd(session, emit, runId, 'DONE', { intent: 'unknown' });
        return;
      } else {
        const quick = parseWithRules(text, {
          context: session.context,
          user: bank.user,
          state: bank,
          source: 'rules',
        });
        if (
          quick.intent !== 'unknown' &&
          quick.intent !== session.clarifyDraft.intent &&
          quick.confidence >= 0.8
        ) {
          session.clarifyDraft = null;
          session.clarifyOptions = null;
          nlu = await understand({
            text,
            context: session.context,
            user: bank.user,
            state: bank,
            history: session.messages,
          });
        } else {
          nlu = mergeClarification(session.clarifyDraft, text, {
            context: session.context,
            user: bank.user,
            state: bank,
          });
        }
      }
      session.clarifyDraft = null;
      session.clarifyOptions = null;
    } else {
      nlu = await understand({
        text,
        context: session.context,
        user: bank.user,
        state: bank,
        history: session.messages,
      });
    }

    session.lastNlu = nlu;
    emit(
      'nlu.result',
      {
        intent: nlu.intent,
        confidence: nlu.confidence,
        slots: nlu.slots,
        source: nlu.source,
        latencyMs: nlu.latencyMs,
        injectionSuspicion: nlu.injectionSuspicion,
        references: nlu.references,
        utterance: nlu.utterance,
        rationale: nlu.rationale,
      },
      runId,
    );
    audit.append(
      'NLU_RESULT',
      `意图 ${nlu.intent} · 来源 ${nlu.source} · 置信度 ${(nlu.confidence * 100).toFixed(0)}%`,
      {
        intent: nlu.intent,
        confidence: nlu.confidence,
        source: nlu.source,
        slots: nlu.slots,
        references: nlu.references,
      },
      { sessionId: session.id, runId },
    );

    const injection = combineInjection(preScan, nlu.injectionSuspicion);
    if (injection.verdict === 'block') {
      blockInput(session, emit, runId, text, injection, nlu.intent);
      return;
    }

    session.state = 'PLANNING';
    const outcome = buildPlan(bank, nlu, session.context, runId);

    if (outcome.kind === 'clarify') {
      session.clarifyDraft = nlu;
      session.clarifyOptions = (outcome.options ?? []).map((option: ClarifyOption) => ({
        label: option.label,
        slot: outcome.slot ?? '',
        value: option.value,
      }));
      session.state = 'IDLE';
      emitAssistant(
        session,
        emit,
        {
          text: outcome.text,
          card: outcome.card,
          meta: { intent: nlu.intent, tone: 'normal', source: nlu.source },
        },
        runId,
      );
      audit.append('CLARIFY', `需要补充信息：${outcome.text.slice(0, 60)}`, { intent: nlu.intent }, {
        sessionId: session.id,
        runId,
      });
      emitRunEnd(session, emit, runId, 'DONE', { intent: nlu.intent, clarify: true });
      return;
    }

    if (outcome.kind === 'reply') {
      session.state = 'IDLE';
      emitAssistant(
        session,
        emit,
        { text: outcome.text, card: outcome.card, meta: { intent: nlu.intent, tone: 'normal' } },
        runId,
      );
      audit.append('REPLY', `直接回复：${nlu.intent}`, { intent: nlu.intent }, {
        sessionId: session.id,
        runId,
      });
      emitRunEnd(session, emit, runId, 'DONE', { intent: nlu.intent });
      return;
    }

    const dag = outcome.dag;
    session.dag = dag;
    session.pending = null;
    session.grants = {};
    session.abortRequested = false;
    session.rollbackRequested = false;
    startRunSummary(session, dag);
    emit(
      'plan.ready',
      {
        dag,
        title: dag.title,
        summary: dag.summary,
        nodeCount: dag.nodes.length,
        riskCounts: dag.nodes.reduce(
          (acc, n) => {
            acc[n.risk] += 1;
            return acc;
          },
          { GREEN: 0, YELLOW: 0, RED: 0 },
        ),
      },
      runId,
    );
    audit.append('PLAN_READY', `任务规划：${dag.title}（${dag.nodes.length} 个节点）`, {
      nodes: dag.nodes.map((n) => ({ id: n.id, tool: n.tool, deps: n.deps, risk: n.risk })),
    }, { sessionId: session.id, runId });

    await executeRun(session, emit);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    session.state = 'FAILED';
    emitAssistant(
      session,
      emit,
      {
        text: '处理请求时出现异常，本次任务已终止。',
        card: { type: 'error', title: '系统异常', detail: message.slice(0, 200) },
        meta: { tone: 'danger' },
      },
      runId,
    );
    audit.append('ORCHESTRATOR_ERROR', message.slice(0, 200), {}, { sessionId: session.id, runId });
    emitRunEnd(session, emit, runId, 'FAILED', { intent: session.lastNlu?.intent ?? 'unknown' });
  }
}

export async function resumeRun(session: SessionInternal, emit: EmitFn): Promise<void> {
  if (!session.dag || session.pending) return;
  const runId = session.dag.runId;
  emit('run.start', { resumed: true, llmMode: metrics.mode, at: clock.nowIso() }, runId);
  const status = await executeDag(session, emit);
  await completeRun(session, emit, status);
}

export async function rollbackCompletedRun(session: SessionInternal, emit: EmitFn): Promise<void> {
  if (!session.dag) return;
  const reversible = session.dag.nodes.filter((n) => n.status === 'SUCCESS' && n.reversible);
  if (!reversible.length) return;
  const runId = session.dag.runId;
  const report = await compensateRun(session, emit, runId);
  emitAssistant(
    session,
    emit,
    {
      text: `已回退本次任务：${report.compensated.length} 个操作已冲正${report.manual.length ? `，${report.manual.length} 个不可逆操作已转人工` : ''}。`,
      card: { type: 'compensation', title: '任务回退结果', ...report, runId },
      meta: { tone: 'success', runId },
    },
    runId,
  );
  session.state = 'PARTIAL';
  finishRunSummary(session, 'PARTIAL', runId);
  audit.append('ROLLBACK', '用户回退已完成任务', report as any, { sessionId: session.id, runId });
  emitRunEnd(session, emit, runId, 'PARTIAL', { intent: session.dag.intent, rollback: true });
}
