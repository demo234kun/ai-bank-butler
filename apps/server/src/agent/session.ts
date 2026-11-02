import { randomUUID } from 'node:crypto';
import {
  BRAND,
  type ChatMessage,
  type ContextStack,
  type Dag,
  type LlmMode,
  type NluResult,
  type PendingAction,
  type RunSummary,
  type SessionPublic,
} from '@bank/shared';
import { clock } from '../core/clock';
import { getState } from '../core/store';
import { config } from '../config';

export interface ClarifyMapping {
  label: string;
  slot: string;
  value: string;
}

export interface SessionInternal extends SessionPublic {
  userId: string;
  createdAt: string;
  updatedAt: string;
  grants: Record<string, string>;
  challenges: Record<string, string>;
  abortRequested: boolean;
  rollbackRequested: boolean;
  clarifyDraft: NluResult | null;
  clarifyOptions: ClarifyMapping[] | null;
  lastNlu: NluResult | null;
}

const sessions = new Map<string, SessionInternal>();

function welcomeMessage(name: string): ChatMessage {
  return {
    id: `msg_${randomUUID().slice(0, 8)}`,
    role: 'assistant',
    ts: clock.nowIso(),
    text: `上午好，${name}。我是 ${BRAND.product}，可以直接说出你的需求。我会先解析意图、规划任务，再按绿色自动、黄色确认、红色强验证的规则执行。`,
    card: { type: 'capabilities', title: '今天想办理什么？' },
    meta: { tone: 'normal' },
  };
}

export function createSession(userId: string = 'u_chenyu'): SessionInternal {
  const bank = getState(userId);
  const now = clock.nowIso();
  const context: ContextStack = {
    spouseName: bank.user.spouse.name,
    spouseBirthday: bank.user.spouse.birthday,
    references: [],
  };
  const session: SessionInternal = {
    id: `sess_${randomUUID().slice(0, 8)}`,
    userId: bank.user.id,
    state: 'IDLE',
    messages: [welcomeMessage(bank.user.name)],
    dag: null,
    pending: null,
    context,
    runs: [],
    llmMode: (config.llm.offline ? 'offline' : 'llm') as LlmMode,
    takeover: false,
    createdAt: now,
    updatedAt: now,
    grants: {},
    challenges: {},
    abortRequested: false,
    rollbackRequested: false,
    clarifyDraft: null,
    clarifyOptions: null,
    lastNlu: null,
  };
  sessions.set(session.id, session);
  return session;
}

export function getSession(id: string): SessionInternal | undefined {
  return sessions.get(id);
}

export function listSessions(): SessionInternal[] {
  return [...sessions.values()];
}

export function listSessionsForUser(userId: string): SessionInternal[] {
  return [...sessions.values()].filter((session) => session.userId === userId);
}

export function resetSessionsForUser(userId: string): void {
  for (const [id, session] of sessions) {
    if (session.userId === userId) sessions.delete(id);
  }
}

export function resetSessions(): void {
  sessions.clear();
}

export function touch(session: SessionInternal): void {
  session.updatedAt = clock.nowIso();
}

export function toPublic(session: SessionInternal): SessionPublic {
  const pendingRemainingMs = session.pending
    ? Math.max(0, new Date(session.pending.expiresAt).getTime() - clock.wallNow().getTime())
    : undefined;
  return {
    id: session.id,
    state: session.state,
    messages: session.messages.map((m) => ({ ...m })),
    dag: session.dag ? structuredClone(session.dag) : null,
    pending: session.pending ? structuredClone(session.pending) : null,
    context: structuredClone(session.context),
    runs: session.runs.map((r) => ({ ...r })),
    llmMode: session.llmMode,
    takeover: session.takeover,
    updatedAt: session.updatedAt,
    pendingRemainingMs,
  };
}

export function appendMessage(session: SessionInternal, message: Omit<ChatMessage, 'id' | 'ts'> & { id?: string; ts?: string }): ChatMessage {
  const full: ChatMessage = {
    id: message.id ?? `msg_${randomUUID().slice(0, 8)}`,
    ts: message.ts ?? clock.nowIso(),
    role: message.role,
    text: message.text,
    card: message.card,
    evidence: message.evidence,
    meta: message.meta,
  };
  session.messages.push(full);
  if (session.messages.length > 160) session.messages = session.messages.slice(-160);
  touch(session);
  return full;
}

export function startRunSummary(session: SessionInternal, dag: Dag): RunSummary {
  const riskCounts = dag.nodes.reduce(
    (acc, node) => {
      acc[node.risk] += 1;
      return acc;
    },
    { GREEN: 0, YELLOW: 0, RED: 0 } as RunSummary['riskCounts'],
  );
  const summary: RunSummary = {
    runId: dag.runId,
    intent: dag.intent,
    title: dag.title,
    status: 'EXECUTING',
    startedAt: dag.createdAt,
    nodeCount: dag.nodes.length,
    riskCounts,
    reversible: dag.nodes.some((n) => n.reversible),
  };
  session.runs.push(summary);
  if (session.runs.length > 30) session.runs = session.runs.slice(-30);
  return summary;
}

export function finishRunSummary(
  session: SessionInternal,
  status: SessionPublic['state'],
  runId?: string,
): void {
  const target = session.runs.find((r) => r.runId === (runId ?? session.dag?.runId));
  if (!target) return;
  target.status = status;
  target.finishedAt = clock.nowIso();
  if (session.dag) {
    target.riskCounts = session.dag.nodes.reduce(
      (acc, node) => {
        acc[node.risk] += 1;
        return acc;
      },
      { GREEN: 0, YELLOW: 0, RED: 0 } as RunSummary['riskCounts'],
    );
    target.reversible = session.dag.nodes.some((n) => n.reversible && n.status === 'SUCCESS');
  }
}
