import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DagNode, Risk, ToolName } from '@bank/shared';
import { createSeededState } from '../src/core/seed';
import type { BankState } from '../src/core/state';
import { evaluateNode } from '../src/policy/engine';
import {
  commitReservation,
  getLimitSummary,
  reserve,
  resetLimitsForTest,
} from '../src/policy/limits';
import {
  assertAndConsumeGrant,
  issueGrant,
  operationDigest,
  resetGrants,
  verifyGrant,
} from '../src/policy/grant';

function makeNode(tool: ToolName, args: Record<string, unknown>, risk: Risk): DagNode {
  return {
    id: `n_${tool}`,
    tool,
    label: tool,
    args,
    deps: [],
    risk,
    reversible: true,
    status: 'PENDING',
    attempts: 0,
  };
}

function freshState(): BankState {
  const state = createSeededState();
  state.limits = [];
  state.security = { failures: 0, injectionHits: 0, lockedUntil: null, lastReason: null };
  return state;
}

function transferNode(amountCents: number): DagNode {
  return makeNode(
    'transfer',
    {
      fromAccountId: 'acc_ys',
      recipients: [{ name: '林晚', amountCents }],
      totalCents: amountCents,
    },
    'YELLOW',
  );
}

describe('权限分级引擎', () => {
  let state: BankState;

  beforeEach(() => {
    state = freshState();
  });

  afterEach(() => {
    resetGrants();
    vi.useRealTimers();
  });

  it('查询类自动执行', () => {
    const policy = evaluateNode(state, makeNode('get_balance', {}, 'GREEN'));
    expect(policy.effectiveRisk).toBe('GREEN');
    expect(policy.decision).toBe('ALLOW');
  });

  it('500 元转账为黄色，执行前需确认', () => {
    const policy = evaluateNode(state, transferNode(50_000));
    expect(policy.effectiveRisk).toBe('YELLOW');
    expect(policy.decision).toBe('CONFIRM');
    expect(policy.limit.remainingCents).toBe(100_000);
  });

  it('精确边界：1000.00 元仍为黄色', () => {
    const policy = evaluateNode(state, transferNode(100_000));
    expect(policy.effectiveRisk).toBe('YELLOW');
  });

  it('精确边界：1000.01 元升级红色', () => {
    const policy = evaluateNode(state, transferNode(100_001));
    expect(policy.effectiveRisk).toBe('RED');
    expect(policy.decision).toBe('STEPUP');
    expect(policy.reasons.some((r) => r.code === 'DAILY_LIMIT_EXCEEDED')).toBe(true);
  });

  it('已用 1000 元后，再转 1 元也升级红色', async () => {
    const reservation = reserve(state, { userId: state.user.id, nodeId: 'n0', amountCents: 100_000 });
    commitReservation(state, reservation.id);
    const policy = evaluateNode(state, transferNode(100));
    expect(policy.limit.remainingCents).toBe(0);
    expect(policy.effectiveRisk).toBe('RED');
  });

  it('单笔超过 5 万不再一刀切禁止，转人工审核队列', () => {
    const policy = evaluateNode(state, transferNode(5_000_001));
    expect(policy.decision).toBe('REVIEW');
    expect(policy.tier).toBe('T4');
    expect(policy.controls).toContain('MANUAL_REVIEW');
  });

  it('超出产品单笔上限才拒绝', () => {
    const policy = evaluateNode(state, transferNode(20_000_001));
    expect(policy.decision).toBe('DENY');
    expect(policy.reasons.some((r) => r.code === 'PRODUCT_CEILING')).toBe(true);
  });

  it('档位由静态档与风控档共同决定，并在解释里给出来源', () => {
    const policy = evaluateNode(state, transferNode(50_000));
    expect(policy.tierSource).toBeDefined();
    expect(policy.tier).toBe(
      ['T0', 'T1', 'T2', 'T3', 'T4'].indexOf(policy.tierSource!.agent) >
        ['T0', 'T1', 'T2', 'T3', 'T4'].indexOf(policy.tierSource!.amount)
        ? policy.tierSource!.agent
        : policy.tierSource!.amount,
    );
    expect(policy.explanation).toContain(policy.tier!);
  });

  it('6000 元红色转账需要双因子', () => {
    const policy = evaluateNode(state, transferNode(600_000));
    expect(policy.effectiveRisk).toBe('RED');
    expect(policy.reasons.some((r) => r.code === 'HIGH_VALUE')).toBe(true);
  });

  it('理财申购固定红色', () => {
    const policy = evaluateNode(
      state,
      makeNode('purchase_wealth', { amountCents: 100_000, productId: 'p_cash' }, 'RED'),
    );
    expect(policy.effectiveRisk).toBe('RED');
    expect(policy.decision).toBe('STEPUP');
  });

  it('挂失固定红色', () => {
    const policy = evaluateNode(state, makeNode('report_loss', { cardId: 'card_ys' }, 'RED'));
    expect(policy.effectiveRisk).toBe('RED');
    expect(policy.decision).toBe('STEPUP');
  });

  it('熔断锁定后全部拒绝', () => {
    state.security.lockedUntil = new Date(Date.now() + 60_000).toISOString();
    const policy = evaluateNode(state, makeNode('get_balance', {}, 'GREEN'));
    expect(policy.decision).toBe('DENY');
    expect(policy.reasons[0]?.code).toBe('BREAKER_LOCKED');
  });
});

describe('额度台账', () => {
  let state: BankState;

  beforeEach(() => {
    state = freshState();
    resetLimitsForTest(state);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-30T10:00:00+08:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('预留后立即扣减剩余额度', () => {
    reserve(state, { userId: state.user.id, nodeId: 'n1', amountCents: 60_000 });
    const summary = getLimitSummary(state);
    expect(summary.usedCents).toBe(60_000);
    expect(summary.remainingCents).toBe(40_000);
    expect(summary.heldCents).toBe(60_000);
  });

  it('600 + 600 并发场景不会双黄：第二笔看到剩余 400 升级红色', () => {
    const first = reserve(state, { userId: state.user.id, nodeId: 'n1', amountCents: 60_000 });
    commitReservation(state, first.id);
    const second = reserve(state, { userId: state.user.id, nodeId: 'n2', amountCents: 60_000 });
    expect(second.state).toBe('HELD');
    const policy = evaluateNode(state, transferNode(60_000));
    expect(policy.effectiveRisk).toBe('RED');
  });

  it('未提交的预留 120 秒后释放', () => {
    reserve(state, { userId: state.user.id, nodeId: 'n1', amountCents: 60_000 });
    vi.advanceTimersByTime(121_000);
    const summary = getLimitSummary(state);
    expect(summary.heldCents).toBe(0);
    expect(summary.remainingCents).toBe(100_000);
  });

  it('提交后不会因时间过期而释放', () => {
    const r = reserve(state, { userId: state.user.id, nodeId: 'n1', amountCents: 60_000 });
    commitReservation(state, r.id);
    vi.advanceTimersByTime(121_000);
    const summary = getLimitSummary(state);
    expect(summary.usedCents).toBe(60_000);
    expect(summary.remainingCents).toBe(40_000);
  });
});

describe('一次性授权 PolicyGrant', () => {
  beforeEach(() => {
    resetGrants();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-30T10:00:00+08:00'));
  });

  afterEach(() => {
    resetGrants();
    vi.useRealTimers();
  });

  const baseArgs = { amountCents: 52_000, note: 'test' };

  it('摘要对参数顺序不敏感，对金额敏感', () => {
    const base = {
      userId: 'u1',
      sessionId: 's1',
      runId: 'r1',
      nodeId: 'n1',
      tool: 'transfer' as const,
    };
    const a = operationDigest({ ...base, args: { a: 1, b: 2 } });
    const b = operationDigest({ ...base, args: { b: 2, a: 1 } });
    const c = operationDigest({ ...base, args: { a: 1, b: 3 } });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('篡改摘要会被拒绝', () => {
    const digest = operationDigest({
      userId: 'u1',
      sessionId: 's1',
      runId: 'r1',
      nodeId: 'n1',
      tool: 'transfer',
      args: baseArgs,
    });
    const grant = issueGrant({
      userId: 'u1',
      sessionId: 's1',
      runId: 'r1',
      nodeId: 'n1',
      tool: 'transfer',
      risk: 'YELLOW',
      authMethods: ['TEST'],
      amountCents: 52_000,
      digest,
    });
    const result = verifyGrant(grant.id, {
      nodeId: 'n1',
      digest: '0'.repeat(64),
      effectiveRisk: 'YELLOW',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('DIGEST_MISMATCH');
  });

  it('授权一次性消费，重放被拒绝', () => {
    const digest = operationDigest({
      userId: 'u1',
      sessionId: 's1',
      runId: 'r1',
      nodeId: 'n1',
      tool: 'transfer',
      args: baseArgs,
    });
    const grant = issueGrant({
      userId: 'u1',
      sessionId: 's1',
      runId: 'r1',
      nodeId: 'n1',
      tool: 'transfer',
      risk: 'YELLOW',
      authMethods: ['TEST'],
      digest,
    });
    const first = assertAndConsumeGrant(grant.id, {
      nodeId: 'n1',
      digest,
      effectiveRisk: 'YELLOW',
    });
    const replay = assertAndConsumeGrant(grant.id, {
      nodeId: 'n1',
      digest,
      effectiveRisk: 'YELLOW',
    });
    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(false);
    expect(replay.reason).toBe('GRANT_ALREADY_USED');
  });

  it('风险等级升高时旧授权失效', () => {
    const digest = operationDigest({
      userId: 'u1',
      sessionId: 's1',
      runId: 'r1',
      nodeId: 'n1',
      tool: 'transfer',
      args: baseArgs,
    });
    const grant = issueGrant({
      userId: 'u1',
      sessionId: 's1',
      runId: 'r1',
      nodeId: 'n1',
      tool: 'transfer',
      risk: 'YELLOW',
      authMethods: ['TEST'],
      digest,
    });
    const result = verifyGrant(grant.id, {
      nodeId: 'n1',
      digest,
      effectiveRisk: 'RED',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('RISK_ESCALATED');
  });

  it('过期授权被拒绝', () => {
    const digest = operationDigest({
      userId: 'u1',
      sessionId: 's1',
      runId: 'r1',
      nodeId: 'n1',
      tool: 'schedule_transfer',
      args: baseArgs,
    });
    const grant = issueGrant({
      userId: 'u1',
      sessionId: 's1',
      runId: 'r1',
      nodeId: 'n1',
      tool: 'schedule_transfer',
      risk: 'YELLOW',
      authMethods: ['TEST'],
      digest,
    });
    vi.advanceTimersByTime(91_000);
    const result = verifyGrant(grant.id, {
      nodeId: 'n1',
      digest,
      effectiveRisk: 'YELLOW',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('GRANT_EXPIRED');
  });
});

