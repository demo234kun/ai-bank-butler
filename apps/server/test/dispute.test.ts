import { describe, expect, it } from 'vitest';
import {
  DISPUTE_REASON_TEXT,
  DISPUTE_STATUS_TEXT,
  DISPUTE_WINDOW_DAYS,
  canDispute,
  disputeStageIndex,
  type Txn,
} from '@bank/shared';
import { applyBankSnapshot, parseBankSnapshot, SnapshotError } from '../src/integration/banking/snapshot';
import { createSeededState } from '../src/core/seed';

const NOW = '2026-11-01T10:00:00+08:00';

function txn(overrides: Partial<Txn> = {}): Txn {
  return {
    id: 't1',
    accountId: 'acc_ys',
    ts: '2026-10-30T09:00:00+08:00',
    amountCents: -12_800,
    merchant: 'Manner 咖啡',
    category: '咖啡茶饮',
    channel: '支付宝',
    status: 'posted',
    ...overrides,
  };
}

describe('争议申诉资格判定', () => {
  it('正常已入账交易可申诉', () => {
    expect(canDispute(txn(), NOW)).toEqual({ ok: true });
  });

  it('已冲正交易不再受理申诉', () => {
    const result = canDispute(txn({ status: 'reversed' }), NOW);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('TXN_NOT_DISPUTABLE');
  });

  it('超过 180 天申诉期后拒绝并提示人工', () => {
    const old = new Date(new Date(NOW).getTime() - (DISPUTE_WINDOW_DAYS + 5) * 86_400_000).toISOString();
    const result = canDispute(txn({ ts: old }), NOW);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('DISPUTE_WINDOW_CLOSED');
    expect(result.message).toContain('人工客服');
  });

  it('未来时间的流水视为未入账', () => {
    const future = new Date(new Date(NOW).getTime() + 3_600_000).toISOString();
    const result = canDispute(txn({ ts: future }), NOW);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('TXN_NOT_POSTED_YET');
  });

  it('非法时间不会被误判为可申诉', () => {
    const result = canDispute(txn({ ts: 'not-a-date' }), NOW);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('TXN_NOT_DISPUTABLE');
  });

  it('状态与原因文案齐备，阶段推进单调', () => {
    expect(Object.keys(DISPUTE_REASON_TEXT)).toHaveLength(5);
    expect(DISPUTE_STATUS_TEXT.resolved_credit).toBe('已退回入账');
    expect(disputeStageIndex('submitted')).toBe(0);
    expect(disputeStageIndex('reviewing')).toBe(1);
    expect(disputeStageIndex('rejected')).toBe(2);
  });
});

describe('争议工单随银行快照同步', () => {
  const dispute = {
    id: 'dsp_1',
    reference: 'DR20261101042',
    txnId: 't1',
    accountId: 'acc_ys',
    merchant: 'Manner 咖啡',
    amountCents: -12_800,
    currency: 'CNY',
    reason: 'duplicate',
    status: 'reviewing',
    createdAt: '2026-11-01T09:00:00+08:00',
    updatedAt: '2026-11-01T09:30:00+08:00',
    expectedFinishAt: '2026-11-06T09:00:00+08:00',
    channel: 'app',
    resolution: '差错核查中',
  };

  it('上游工单进入本地工作副本', () => {
    const state = createSeededState();
    const snapshot = parseBankSnapshot({ disputes: [dispute] });
    applyBankSnapshot(state, snapshot);
    expect(state.disputes).toHaveLength(1);
    expect(state.disputes[0]?.reference).toBe('DR20261101042');
    expect(state.disputes[0]?.status).toBe('reviewing');
  });

  it('上游未返回工单时保留本地已受理记录', () => {
    const state = createSeededState();
    state.disputes = [dispute as any];
    applyBankSnapshot(state, parseBankSnapshot({ accounts: state.accounts }));
    expect(state.disputes).toHaveLength(1);
  });

  it('拒绝非法工单结构而不是静默忽略', () => {
    expect(() => parseBankSnapshot({ disputes: [{ id: 'dsp_bad' }] })).toThrow(SnapshotError);
  });
});
