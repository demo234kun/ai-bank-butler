import {
  INTENT_LABELS,
  RISK_META,
  formatDateTime,
  type AuditEntry,
  type AuditVerification,
  type BootstrapPayload,
  type ChatMessage,
  type Dag,
  type DagNode,
  type FlowState,
  type NluResult,
  type PendingAction,
  type PolicyDecision,
  type SessionPublic,
  type SnapshotPayload,
  type StatsPayload,
  type StepUpChallenge,
  type StreamEvent,
  type ToolResult,
} from '@bank/shared';

export type TraceTone = 'normal' | 'success' | 'warning' | 'danger' | 'gold';

export interface TraceItem {
  id: string;
  at: string;
  type: string;
  title: string;
  detail?: string;
  tone: TraceTone;
}

export type SheetKind = 'confirm' | 'stepup' | null;

export interface ToastState {
  text: string;
  tone: 'normal' | 'success' | 'warning' | 'danger';
}

export interface AgentState {
  sessionId: string | null;
  snapshot: SnapshotPayload | null;
  boot: BootstrapPayload | null;
  messages: ChatMessage[];
  dag: Dag | null;
  policies: Record<string, PolicyDecision>;
  nlu: NluResult | null;
  flow: FlowState;
  pending: PendingAction | null;
  challenge: StepUpChallenge | null;
  sheet: SheetKind;
  busy: boolean;
  activeNodeId: string | null;
  events: TraceItem[];
  audit: AuditEntry[];
  auditVerification: AuditVerification | null;
  stats: StatsPayload | null;
  toast: ToastState | null;
  elderMode: boolean;
  lastRunId: string | null;
}

export type AgentAction =
  | { type: 'bootstrap'; payload: BootstrapPayload }
  | { type: 'snapshot'; payload: SnapshotPayload }
  | { type: 'event'; event: StreamEvent }
  | { type: 'user'; message: ChatMessage }
  | { type: 'stream-started' }
  | { type: 'stream-closed' }
  | { type: 'sheet'; value: SheetKind }
  | { type: 'challenge'; value: StepUpChallenge | null }
  | { type: 'toast'; toast: ToastState }
  | { type: 'clear-toast' }
  | { type: 'elder'; value: boolean }
  | { type: 'audit'; entries: AuditEntry[]; verification: AuditVerification }
  | { type: 'stats'; stats: StatsPayload }
  | { type: 'reset'; payload: BootstrapPayload };

const STATUS_LABEL: Record<string, string> = {
  PENDING: '等待中',
  READY: '就绪',
  RUNNING: '执行中',
  AWAIT_CONFIRM: '待确认',
  AWAIT_STEPUP: '待强验证',
  SUCCESS: '成功',
  FAILED: '失败',
  SKIPPED: '已跳过',
  COMPENSATED: '已冲正',
  MANUAL: '转人工',
};

function statusTone(status: string): TraceTone {
  if (status === 'SUCCESS' || status === 'COMPENSATED') return 'success';
  if (status === 'FAILED') return 'danger';
  if (status === 'RUNNING' || status === 'READY') return 'gold';
  if (status === 'AWAIT_CONFIRM' || status === 'AWAIT_STEPUP' || status === 'SKIPPED') return 'warning';
  return 'normal';
}

function flowTone(status: FlowState): TraceTone {
  if (status === 'DONE') return 'success';
  if (status === 'PARTIAL') return 'warning';
  if (status === 'FAILED' || status === 'LOCKED') return 'danger';
  if (status === 'HUMAN_TAKEOVER') return 'gold';
  return 'normal';
}

function nextTrace(state: AgentState, item: Omit<TraceItem, 'id'>): TraceItem[] {
  const trace: TraceItem = { ...item, id: `tr_${Date.now()}_${state.events.length}` };
  return [...state.events, trace].slice(-100);
}

function upsertMessage(messages: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  const idx = messages.findIndex((m) => m.id === incoming.id);
  if (idx < 0) return [...messages, incoming];
  const copy = messages.slice();
  copy[idx] = { ...copy[idx], ...incoming, card: incoming.card ?? copy[idx]?.card, text: incoming.text ?? copy[idx]?.text };
  return copy;
}

function updateNode(dag: Dag | null, event: StreamEvent): Dag | null {
  if (!dag) return dag;
  const data = event.data ?? {};
  return {
    ...dag,
    nodes: dag.nodes.map((node) => {
      if (node.id !== data.nodeId) return node;
      const result: ToolResult | undefined =
        data.status === 'SUCCESS'
          ? { ok: true, summary: data.resultSummary }
          : data.status === 'FAILED'
            ? { ok: false, error: data.error, summary: data.resultSummary }
            : node.result;
      return {
        ...node,
        status: data.status ?? node.status,
        risk: data.risk ?? node.risk,
        result,
        startedAt: data.status === 'RUNNING' ? new Date().toISOString() : node.startedAt,
        finishedAt: ['SUCCESS', 'FAILED', 'SKIPPED', 'COMPENSATED', 'MANUAL'].includes(data.status)
          ? new Date().toISOString()
          : node.finishedAt,
      } as DagNode;
    }),
  };
}

function sessionFromSnapshot(payload: SnapshotPayload): SessionPublic {
  return payload.session;
}

function initialStateFrom(payload: BootstrapPayload, prev?: AgentState): AgentState {
  const session = sessionFromSnapshot(payload);
  const pending = session.pending;
  return {
    sessionId: session.id,
    snapshot: payload,
    boot: payload,
    messages: session.messages,
    dag: session.dag,
    policies: {},
    nlu: null,
    flow: session.state,
    pending,
    challenge: pending?.challenge ?? null,
    sheet: pending ? 'confirm' : null,
    busy: false,
    activeNodeId: null,
    events: prev?.events ?? [],
    audit: prev?.audit ?? [],
    auditVerification: prev?.auditVerification ?? null,
    stats: payload.stats,
    toast: prev?.toast ?? null,
    elderMode: prev?.elderMode ?? false,
    lastRunId: session.dag?.runId ?? prev?.lastRunId ?? null,
  };
}

export const initialAgentState: AgentState = {
  sessionId: null,
  snapshot: null,
  boot: null,
  messages: [],
  dag: null,
  policies: {},
  nlu: null,
  flow: 'IDLE',
  pending: null,
  challenge: null,
  sheet: null,
  busy: false,
  activeNodeId: null,
  events: [],
  audit: [],
  auditVerification: null,
  stats: null,
  toast: null,
  elderMode: false,
  lastRunId: null,
};

export function agentReducer(state: AgentState, action: AgentAction): AgentState {
  switch (action.type) {
    case 'bootstrap':
      return initialStateFrom(action.payload, state);
    case 'reset':
      return {
        ...initialStateFrom(action.payload, { ...state, events: [], audit: [] }),
        events: [],
        audit: [],
        auditVerification: null,
        toast: { text: '演示数据已重置', tone: 'success' },
      };
    case 'snapshot': {
      const session = sessionFromSnapshot(action.payload);
      const pending = session.pending;
      const sheet = pending ? (state.sheet === 'stepup' ? 'stepup' : 'confirm') : null;
      const restoredPolicies: Record<string, PolicyDecision> = {};
      for (const node of session.dag?.nodes ?? []) {
        if (node.policy) restoredPolicies[node.id] = node.policy;
      }
      return {
        ...state,
        sessionId: session.id,
        snapshot: action.payload,
        messages: session.messages,
        dag: session.dag,
        policies: { ...state.policies, ...restoredPolicies },
        flow: session.state,
        pending,
        challenge: pending?.challenge ?? null,
        sheet,
        stats: action.payload.stats,
        busy: session.state === 'EXECUTING' ? state.busy : false,
        lastRunId: session.dag?.runId ?? state.lastRunId,
      };
    }
    case 'user':
      return {
        ...state,
        messages: upsertMessage(state.messages, action.message),
      };
    case 'stream-started':
      return { ...state, busy: true, flow: 'PARSING', events: nextTrace(state, {
        at: new Date().toISOString(),
        type: 'stream',
        title: '开始处理',
        detail: '建立安全会话流',
        tone: 'normal',
      }) };
    case 'stream-closed':
      if (['PARSING', 'PLANNING', 'EXECUTING'].includes(state.flow)) {
        return { ...state, busy: false };
      }
      return state;
    case 'sheet':
      return { ...state, sheet: action.value };
    case 'challenge':
      return { ...state, challenge: action.value };
    case 'toast':
      return { ...state, toast: action.toast };
    case 'clear-toast':
      return { ...state, toast: null };
    case 'elder':
      return { ...state, elderMode: action.value };
    case 'audit':
      return {
        ...state,
        audit: action.entries,
        auditVerification: action.verification,
      };
    case 'stats':
      return {
        ...state,
        stats: action.stats,
        snapshot: state.snapshot
          ? {
              ...state.snapshot,
              stats: action.stats,
              limits: state.snapshot.limits,
            }
          : state.snapshot,
      };
    case 'event': {
      const event = action.event;
      const data: any = event.data ?? {};
      switch (event.type) {
        case 'run.start': {
          const isResume = Boolean(data.resumed);
          return {
            ...state,
            sessionId: event.sessionId,
            busy: true,
            flow: isResume ? 'EXECUTING' : 'PARSING',
            dag: isResume ? state.dag : null,
            policies: isResume ? state.policies : {},
            nlu: isResume ? state.nlu : null,
            pending: isResume ? state.pending : null,
            challenge: isResume ? state.challenge : null,
            sheet: isResume ? state.sheet : null,
            activeNodeId: isResume ? state.activeNodeId : null,
            lastRunId: event.runId ?? state.lastRunId,
            events: nextTrace(state, {
              at: event.ts,
              type: event.type,
              title: isResume ? '继续执行任务' : '收到用户请求',
              detail: data.utterance,
              tone: 'normal',
            }),
          };
        }
        case 'nlu.result': {
          const nlu: NluResult = {
            intent: data.intent,
            confidence: data.confidence,
            slots: data.slots,
            utterance: data.utterance,
            needsClarification: false,
            ambiguity: null,
            clarification: null,
            injectionSuspicion: data.injectionSuspicion ?? 0,
            references: data.references ?? [],
            rationale: data.rationale,
            source: data.source,
            latencyMs: data.latencyMs,
          };
          return {
            ...state,
            nlu,
            flow: 'PLANNING',
            events: nextTrace(state, {
              at: event.ts,
              type: event.type,
              title: `意图解析 · ${INTENT_LABELS[nlu.intent] ?? nlu.intent}`,
              detail: `${nlu.source === 'llm' ? 'DeepSeek' : nlu.source === 'cache' ? '本地缓存' : nlu.source === 'offline' ? '离线规则' : '规则引擎'} · 置信度 ${(nlu.confidence * 100).toFixed(0)}%${nlu.latencyMs ? ` · ${nlu.latencyMs}ms` : ''}`,
              tone: nlu.source === 'llm' ? 'gold' : 'normal',
            }),
          };
        }
        case 'injection.flag':
          return {
            ...state,
            events: nextTrace(state, {
              at: event.ts,
              type: event.type,
              title: '提示词注入拦截',
              detail: `风险评分 ${data.score} · ${(data.patterns ?? []).join('；')}`,
              tone: 'danger',
            }),
          };
        case 'plan.ready': {
          const dag = data.dag as Dag;
          return {
            ...state,
            dag,
            policies: {},
            flow: 'EXECUTING',
            lastRunId: dag.runId,
            events: nextTrace(state, {
              at: event.ts,
              type: event.type,
              title: `任务规划 · ${dag.title}`,
              detail: `${dag.nodes.length} 个节点 · ${dag.summary}`,
              tone: 'gold',
            }),
          };
        }
        case 'node.state': {
          const node = state.dag?.nodes.find((n) => n.id === data.nodeId);
          return {
            ...state,
            dag: updateNode(state.dag, event),
            activeNodeId: ['RUNNING', 'AWAIT_CONFIRM', 'AWAIT_STEPUP'].includes(data.status)
              ? data.nodeId
              : state.activeNodeId === data.nodeId
                ? null
                : state.activeNodeId,
            events: nextTrace(state, {
              at: event.ts,
              type: event.type,
              title: `${node?.label ?? data.tool} · ${STATUS_LABEL[data.status] ?? data.status}`,
              detail: data.resultSummary ?? data.error?.message ?? (data.durationMs !== undefined ? `${data.durationMs}ms` : undefined),
              tone: statusTone(data.status),
            }),
          };
        }
        case 'policy.decision': {
          const node = state.dag?.nodes.find((n) => n.id === data.nodeId);
          const policy: PolicyDecision = {
            nodeId: data.nodeId,
            tool: data.tool,
            baseRisk: data.baseRisk,
            effectiveRisk: data.effectiveRisk,
            reasons: data.reasons ?? [],
            amountCents: data.amountCents,
            limit: data.limit,
            explanation: data.explanation,
            decision: data.decision,
          };
          return {
            ...state,
            policies: { ...state.policies, [data.nodeId]: policy },
            dag: state.dag
              ? {
                  ...state.dag,
                  nodes: state.dag.nodes.map((n) => (n.id === data.nodeId ? { ...n, policy, risk: policy.effectiveRisk } : n)),
                }
              : state.dag,
            activeNodeId: data.nodeId,
            events: nextTrace(state, {
              at: event.ts,
              type: event.type,
              title: `权限判定 · ${node?.label ?? data.tool} → ${RISK_META[data.effectiveRisk as keyof typeof RISK_META]?.short ?? data.effectiveRisk}`,
              detail: data.explanation,
              tone: data.effectiveRisk === 'RED' ? 'danger' : data.effectiveRisk === 'YELLOW' ? 'warning' : 'success',
            }),
          };
        }
        case 'run.paused': {
          const pending = data.pending as PendingAction;
          return {
            ...state,
            pending,
            challenge: pending.challenge ?? null,
            sheet: 'confirm',
            busy: false,
            activeNodeId: pending.nodeId,
            flow: pending.kind === 'STEPUP' ? 'AWAIT_STEPUP' : 'AWAIT_CONFIRM',
            events: nextTrace(state, {
              at: event.ts,
              type: event.type,
              title: pending.kind === 'STEPUP' ? '等待强验证' : '等待用户确认',
              detail: pending.summary.title,
              tone: pending.kind === 'STEPUP' ? 'danger' : 'warning',
            }),
          };
        }
        case 'stepup.challenge':
          return {
            ...state,
            challenge: data.challenge ?? data,
            sheet: 'stepup',
          };
        case 'stepup.result':
          return state;
        case 'render.card': {
          const message: ChatMessage = {
            id: data.messageId,
            role: 'assistant',
            ts: data.ts ?? event.ts,
            card: data.card,
          };
          return { ...state, messages: upsertMessage(state.messages, message) };
        }
        case 'message.final': {
          const message: ChatMessage = {
            id: data.messageId,
            role: data.role ?? 'assistant',
            text: data.text,
            ts: data.ts ?? event.ts,
            evidence: data.evidence,
            meta: data.meta,
            card: data.card,
          };
          return { ...state, messages: upsertMessage(state.messages, message) };
        }
        case 'breaker.tripped':
          return {
            ...state,
            flow: 'LOCKED',
            busy: false,
            sheet: null,
            pending: null,
            challenge: null,
            toast: { text: '安全熔断已触发，请在控制台人工复核', tone: 'danger' },
            events: nextTrace(state, {
              at: event.ts,
              type: event.type,
              title: '安全熔断',
              detail: data.reason,
              tone: 'danger',
            }),
          };
        case 'takeover.required':
          return {
            ...state,
            flow: 'HUMAN_TAKEOVER',
            busy: false,
            events: nextTrace(state, {
              at: event.ts,
              type: event.type,
              title: '已暂停，等待人工接管',
              detail: data.message,
              tone: 'gold',
            }),
          };
        case 'audit.appended': {
          const entry = data.entry as AuditEntry;
          if (!entry) return state;
          const exists = state.audit.some((e) => e.seq === entry.seq);
          return {
            ...state,
            audit: exists ? state.audit : [entry, ...state.audit].slice(0, 140),
            lastRunId: entry.runId ?? state.lastRunId,
          };
        }
        case 'run.end': {
          const status = (data.status ?? 'DONE') as FlowState;
          const terminal = ['DONE', 'PARTIAL', 'FAILED', 'CANCELLED', 'LOCKED'].includes(status);
          return {
            ...state,
            flow: status,
            busy: false,
            pending: terminal ? null : state.pending,
            challenge: terminal ? null : state.challenge,
            sheet: terminal ? null : state.sheet,
            activeNodeId: null,
            events: nextTrace(state, {
              at: event.ts,
              type: event.type,
              title: `任务结束 · ${status === 'DONE' ? '已完成' : status === 'PARTIAL' ? '部分完成' : status === 'FAILED' ? '失败' : status === 'CANCELLED' ? '已取消' : status === 'LOCKED' ? '安全锁定' : status}`,
              detail: data.canRollback ? '支持按逆序回退' : data.title,
              tone: flowTone(status),
            }),
          };
        }
        default:
          return state;
      }
    }
    default:
      return state;
  }
}

export function makeLocalUserMessage(text: string, ts?: string): ChatMessage {
  return {
    id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    role: 'user',
    text,
    ts: ts ?? new Date().toISOString(),
    meta: {},
  };
}

export function prettyTime(iso: string): string {
  try {
    return formatDateTime(iso).slice(11);
  } catch {
    return '—';
  }
}
