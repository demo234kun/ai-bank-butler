import type {
  AuditVerification,
  GuardStats,
  LlmMode,
  LlmStats,
  NluSource,
  StatsPayload,
} from '@bank/shared';
import { config } from './config';
import { clock } from './core/clock';
import type { BankState } from './core/state';
import { audit } from './security/auditChain';
import { breakerState } from './security/breaker';

interface LlmInternal {
  calls: number;
  failures: number;
  cacheHits: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  totalLatencyMs: number;
  lastLatencyMs: number;
  lastSource: NluSource | null;
  estimatedCostCents: number;
  lastModel: string;
}

const llm: LlmInternal = {
  calls: 0,
  failures: 0,
  cacheHits: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  totalLatencyMs: 0,
  lastLatencyMs: 0,
  lastSource: null,
  estimatedCostCents: 0,
  lastModel: config.llm.model,
};

let mode: LlmMode = config.llm.offline ? 'offline' : 'llm';

const guard: GuardStats = {
  rendered: 0,
  numbersChecked: 0,
  numbersBlocked: 0,
  injectionBlocked: 0,
  lastGuardAt: null,
};

let lastVerification: AuditVerification = audit.verify();

export const metrics = {
  get mode(): LlmMode {
    return mode;
  },
  setMode(next: LlmMode): void {
    mode = next;
  },
  llmEnabled(): boolean {
    return mode === 'llm' && Boolean(config.llm.apiKey && config.llm.baseUrl);
  },
  recordLlm(input: {
    ok: boolean;
    source: NluSource;
    latencyMs: number;
    promptTokens?: number;
    completionTokens?: number;
    model?: string;
  }): void {
    llm.calls += 1;
    llm.totalLatencyMs += input.latencyMs;
    llm.lastLatencyMs = input.latencyMs;
    llm.lastSource = input.source;
    if (input.model) llm.lastModel = input.model;
    if (!input.ok) {
      llm.failures += 1;
      return;
    }
    const promptTokens = input.promptTokens ?? 0;
    const completionTokens = input.completionTokens ?? 0;
    llm.promptTokens += promptTokens;
    llm.completionTokens += completionTokens;
    llm.totalTokens += promptTokens + completionTokens;
    // 成本仪表为估算：按输入 ¥2 / 百万 token、输出 ¥8 / 百万 token 折算成分
    llm.estimatedCostCents += promptTokens * 0.0002 + completionTokens * 0.0008;
  },
  recordCacheHit(): void {
    llm.cacheHits += 1;
  },
  recordGuard(input: { checked: number; blocked: boolean }): void {
    guard.rendered += 1;
    guard.numbersChecked += input.checked;
    if (input.blocked) guard.numbersBlocked += 1;
    guard.lastGuardAt = clock.nowIso();
  },
  recordInjectionBlocked(): void {
    guard.injectionBlocked += 1;
  },
  llmStats(): LlmStats {
    return {
      enabled: Boolean(config.llm.apiKey && config.llm.baseUrl),
      mode,
      model: llm.lastModel,
      calls: llm.calls,
      failures: llm.failures,
      cacheHits: llm.cacheHits,
      promptTokens: llm.promptTokens,
      completionTokens: llm.completionTokens,
      totalTokens: llm.totalTokens,
      avgLatencyMs: llm.calls ? Math.round(llm.totalLatencyMs / llm.calls) : 0,
      lastLatencyMs: llm.lastLatencyMs,
      lastSource: llm.lastSource,
      estimatedCostCents: Math.round(llm.estimatedCostCents * 100) / 100,
    };
  },
  guardStats(): GuardStats {
    return { ...guard };
  },
  reset(): void {
    llm.calls = 0;
    llm.failures = 0;
    llm.cacheHits = 0;
    llm.promptTokens = 0;
    llm.completionTokens = 0;
    llm.totalTokens = 0;
    llm.totalLatencyMs = 0;
    llm.lastLatencyMs = 0;
    llm.lastSource = null;
    llm.estimatedCostCents = 0;
    guard.rendered = 0;
    guard.numbersChecked = 0;
    guard.numbersBlocked = 0;
    guard.injectionBlocked = 0;
    guard.lastGuardAt = null;
    lastVerification = audit.verify();
  },
  stats(state: BankState, sessionCount: number): StatsPayload {
    try {
      lastVerification = audit.verify();
    } catch {
      // ignore
    }
    return {
      llm: metrics.llmStats(),
      guard: metrics.guardStats(),
      breaker: breakerState(state),
      sessions: sessionCount,
      audit: {
        count: audit.count(),
        head: audit.headHash(),
        checkpointCount: lastVerification.checkpointCount,
        verification: lastVerification,
      },
      demoNow: clock.nowIso(),
    };
  },
};
