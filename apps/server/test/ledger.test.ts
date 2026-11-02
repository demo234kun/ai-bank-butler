import { describe, expect, it } from 'vitest';
import { createSeededState } from '../src/core/seed';
import {
  LedgerError,
  applyVirtualCard,
  cancelGift,
  cancelSubscription,
  cancelVirtualCard,
  lockFunds,
  orderGift,
  purchaseWealth,
  redeemWealth,
  restoreSubscription,
  reverseTransfer,
  transfer,
  unlockFunds,
} from '../src/core/ledger';

describe('银行仿真台账', () => {
  it('转账扣款并生成流水，冲正恢复余额', () => {
    const state = createSeededState();
    const account = state.accounts.find((a) => a.id === 'acc_ys')!;
    const before = account.balanceCents;
    const result = transfer(state, {
      fromAccountId: account.id,
      recipients: [{ name: '林晚', amountCents: 52_000 }],
      note: '爱你',
    });
    expect(account.balanceCents).toBe(before - 52_000);
    expect(result.txns).toHaveLength(1);
    expect(result.txns[0]!.amountCents).toBe(-52_000);
    const reversal = reverseTransfer(state, result.txns.map((t) => t.id));
    expect(account.balanceCents).toBe(before);
    expect(result.txns[0]!.status).toBe('reversed');
    expect(reversal.reversal.amountCents).toBe(52_000);
  });

  it('余额不足时拒绝转账', () => {
    const state = createSeededState();
    expect(() =>
      transfer(state, {
        fromAccountId: 'acc_qh',
        recipients: [{ name: '林晚', amountCents: 99_999_999 }],
      }),
    ).toThrow(LedgerError);
  });

  it('理财申购校验起购金额，赎回资金回到账户', () => {
    const state = createSeededState();
    const product = state.products.find((p) => p.id === 'p_ruixin90')!;
    const account = state.accounts.find((a) => a.id === 'acc_plus')!;
    const before = account.balanceCents;
    expect(() =>
      purchaseWealth(state, { product, amountCents: 100, fromAccountId: account.id }),
    ).toThrow(LedgerError);
    const purchase = purchaseWealth(state, {
      product,
      amountCents: 200_000,
      fromAccountId: account.id,
    });
    expect(account.balanceCents).toBe(before - 200_000);
    const redeem = redeemWealth(state, {
      holding: purchase.holding,
      product,
      amountCents: 50_000,
      toAccountId: account.id,
    });
    expect(redeem.amountCents).toBe(50_000);
    expect(account.balanceCents).toBe(before - 150_000);
    expect(purchase.holding.amountCents).toBe(150_000);
  });

  it('锁定活期资金与释放', () => {
    const state = createSeededState();
    const account = state.accounts.find((a) => a.id === 'acc_plus')!;
    const { lock } = lockFunds(state, {
      accountId: account.id,
      amountCents: 100_000,
      reason: '生日预算',
      releaseAt: '2026-11-03T23:59:59+08:00',
    });
    expect(account.lockedCents).toBe(100_000);
    unlockFunds(state, lock.id);
    expect(account.lockedCents).toBe(0);
    expect(lock.status).toBe('released');
  });

  it('取消订阅并恢复', () => {
    const state = createSeededState();
    const result = cancelSubscription(state, 'sub_fitness');
    expect(result.subscription.status).toBe('cancelled');
    restoreSubscription(state, 'sub_fitness', result.previousStatus);
    expect(state.subscriptions.find((s) => s.id === 'sub_fitness')!.status).toBe('active');
  });

  it('虚拟卡申请与注销', () => {
    const state = createSeededState();
    const { card } = applyVirtualCard(state, { limitCents: 300_000 });
    expect(card.type).toBe('virtual');
    expect(card.status).toBe('active');
    cancelVirtualCard(state, card.id);
    expect(card.status).toBe('cancelled');
  });

  it('预约礼物与取消退款', () => {
    const state = createSeededState();
    const account = state.accounts.find((a) => a.id === 'acc_ys')!;
    const before = account.balanceCents;
    const { order } = orderGift(state, {
      type: 'flower',
      merchant: '花间集',
      amountCents: 19_900,
      deliveryAt: '2026-10-31T10:00:00+08:00',
      note: '生日鲜花',
      fromAccountId: account.id,
    });
    expect(account.balanceCents).toBe(before - 19_900);
    cancelGift(state, order.id);
    expect(account.balanceCents).toBe(before);
    expect(order.status).toBe('cancelled');
  });
});
