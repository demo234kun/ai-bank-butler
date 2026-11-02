import { beforeEach, describe, expect, it } from 'vitest';
import type { DagNode, Risk } from '@bank/shared';
import { createSeededState } from '../src/core/seed';
import type { BankState } from '../src/core/state';
import { evaluateNode } from '../src/policy/engine';
import { assessRisk } from '../src/policy/riskAgent';
import {
  approveManualReview,
  deferToManualReview,
  maskName,
  normalizeName,
  rejectManualReview,
  verifyPayeeEcho,
} from '../src/policy/safeguards';

function node(amountCents: number, payee = '林晚', note?: string, risk: Risk = 'YELLOW'): DagNode {
  return {
    id: 'n1',
    tool: 'transfer',
    label: '转账',
    args: {
      fromAccountId: 'acc_ys',
      recipients: [{ name: payee, amountCents }],
      totalCents: amountCents,
      note,
    },
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
  state.schedules = [];
  state.notifications = [];
  state.security = { failures: 0, injectionHits: 0, lockedUntil: null, lastReason: null };
  return state;
}

describe('风控智能体评分', () => {
  let state: BankState;
  beforeEach(() => {
    state = freshState();
  });

  it('首次收款人 + 诈骗话术会被识别并升档', () => {
    const verdict = assessRisk({
      state,
      node: node(80_000, '陌生账户', '客服要求转到安全账户'),
      amountCents: 80_000,
      payeeName: '陌生账户',
      note: '客服要求转到安全账户',
    });
    const codes = verdict.signals.map((s) => s.code);
    expect(codes).toContain('NEW_PAYEE');
    expect(codes).toContain('FRAUD_KEYWORD');
    expect(verdict.score).toBeGreaterThanOrEqual(35);
    expect(['T2', 'T3', 'T4']).toContain(verdict.tier);
  });

  it('风险名单直接判为最高档并要求人工复核', () => {
    const verdict = assessRisk({
      state,
      node: node(120_000, '风险账户测试'),
      amountCents: 120_000,
      payeeName: '风险账户测试',
    });
    expect(verdict.tier).toBe('T4');
    expect(verdict.requiresReview).toBe(true);
    expect(verdict.signals.some((s) => s.code === 'BLOCKLIST_PAYEE')).toBe(true);
  });

  it('只读查询不进入评分', () => {
    const verdict = assessRisk({ state, node: { ...node(0), tool: 'get_balance', risk: 'GREEN' } });
    expect(verdict.score).toBe(0);
    expect(verdict.tier).toBe('T0');
  });

  it('注入嫌疑会加权', () => {
    const base = assessRisk({ state, node: node(120_000), amountCents: 120_000 });
    const injected = assessRisk({
      state,
      node: node(120_000),
      amountCents: 120_000,
      injectionSuspicion: 0.8,
    });
    expect(injected.score).toBeGreaterThan(base.score);
    expect(injected.signals.some((s) => s.code === 'INJECTION_SUSPICION')).toBe(true);
  });
});

describe('收款人复述', () => {
  it('规范化后忽略空格、全角与中间点', () => {
    expect(normalizeName(' 王　磊 ')).toBe(normalizeName('王磊'));
    expect(normalizeName('ＡＢＣ')).toBe('abc');
  });

  it('必须与收款人一致，脱敏值不能通过', () => {
    const target = node(120_000, '王磊');
    expect(verifyPayeeEcho(target, '王磊')).toBe(true);
    expect(verifyPayeeEcho(target, ' 王 磊 ')).toBe(true);
    expect(verifyPayeeEcho(target, '王*')).toBe(false);
    expect(verifyPayeeEcho(target, '')).toBe(false);
    expect(verifyPayeeEcho(target, undefined)).toBe(false);
  });

  it('脱敏只保留姓氏', () => {
    expect(maskName('王磊')).toBe('王*');
    expect(maskName('欧阳娜娜')).toBe('欧***');
  });
});

describe('五档分级与复述要求', () => {
  it('风控把 500 元转账升到 T2，并要求手输收款人姓名', () => {
    const state = freshState();
    const policy = evaluateNode(state, node(80_000, '陌生账户', '客服要求转到安全账户'));
    expect(['T2', 'T3']).toContain(policy.tier);
    expect(policy.controls).toContain('PAYEE_ECHO');
    expect(['CONFIRM', 'STEPUP']).toContain(policy.decision);
  });

  it('5 万元不给一刀切禁止，转人工审核', () => {
    const state = freshState();
    const policy = evaluateNode(state, node(5_000_001));
    expect(policy.decision).toBe('REVIEW');
    expect(policy.tier).toBe('T4');
    expect(policy.controls).toEqual(expect.arrayContaining(['PAYEE_ECHO', 'STEPUP_MFA', 'MANUAL_REVIEW']));
  });

  it('20 万以上才因产品上限拒绝', () => {
    const state = freshState();
    expect(evaluateNode(state, node(20_000_000)).decision).toBe('REVIEW');
    expect(evaluateNode(state, node(20_000_001)).decision).toBe('DENY');
  });
});

describe('人工审核队列', () => {
  it('转入审核时不扣款，批准后才执行且幂等', async () => {
    const { getState, resetUserState } = await import('../src/core/store');
    resetUserState('u_chenyu');
    const state = getState('u_chenyu');
    state.limits = [];
    const before = state.accounts.find((a) => a.id === 'acc_ys')!.balanceCents;

    const target = node(5_000_001);
    const policy = evaluateNode(state, target);
    const item = await deferToManualReview({ userId: 'u_chenyu', node: target, policy, runId: 'run1' });

    expect(item.kind).toBe('review');
    expect(item.payload?.authorized).toBe(false);
    expect(state.accounts.find((a) => a.id === 'acc_ys')!.balanceCents).toBe(before);
    expect(state.notifications.some((n) => n.kind === 'review')).toBe(true);

    const approved = await approveManualReview('u_chenyu', item.id);
    expect(approved.ok).toBe(true);
    const after = getState('u_chenyu').accounts.find((a) => a.id === 'acc_ys')!.balanceCents;
    expect(after).toBe(before - 5_000_001);

    const again = await approveManualReview('u_chenyu', item.id);
    expect(again.ok).toBe(false);
    expect(again.code).toBe('REVIEW_CLOSED');
    resetUserState('u_chenyu');
  });

  it('驳回不发生资金变动', async () => {
    const { getState, resetUserState } = await import('../src/core/store');
    resetUserState('u_chenyu');
    const state = getState('u_chenyu');
    state.limits = [];
    const before = state.accounts.find((a) => a.id === 'acc_ys')!.balanceCents;

    const target = node(5_000_001);
    const policy = evaluateNode(state, target);
    const item = await deferToManualReview({ userId: 'u_chenyu', node: target, policy, runId: 'run2' });
    const rejected = await rejectManualReview('u_chenyu', item.id, '审核未通过', 'bank');

    expect(rejected.ok).toBe(true);
    expect(getState('u_chenyu').accounts.find((a) => a.id === 'acc_ys')!.balanceCents).toBe(before);
    resetUserState('u_chenyu');
  });
});
