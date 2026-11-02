import { randomUUID } from 'node:crypto';
import type {
  Account,
  BankCard,
  FundLock,
  GiftOrder,
  Holding,
  ScheduleItem,
  Subscription,
  Txn,
  WealthProduct,
} from '@bank/shared';
import { clock } from './clock';
import type { BankState } from './state';
import { availableCents, findAccount, primaryAccount } from './state';

export class LedgerError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export const newId = (prefix: string): string => `${prefix}_${randomUUID().slice(0, 8)}`;

function recordTxn(
  state: BankState,
  input: {
    accountId: string;
    amountCents: number;
    merchant: string;
    category: string;
    channel?: string;
    note?: string;
    ts?: string;
  },
): Txn {
  const txn: Txn = {
    id: newId('txn'),
    accountId: input.accountId,
    ts: input.ts ?? clock.nowIso(),
    amountCents: input.amountCents,
    merchant: input.merchant,
    category: input.category,
    channel: input.channel ?? '手机银行 · AI 管家',
    note: input.note,
    status: 'posted',
  };
  state.transactions.push(txn);
  return txn;
}

export interface TransferRecipient {
  name: string;
  amountCents: number;
  contactId?: string;
  bank?: string;
  last4?: string;
}

export interface TransferResult {
  txns: Txn[];
  totalCents: number;
  account: Account;
  recipients: TransferRecipient[];
}

export function transfer(
  state: BankState,
  input: { fromAccountId?: string; recipients: TransferRecipient[]; note?: string },
): TransferResult {
  const account = findAccount(state, input.fromAccountId);
  if (!account) throw new LedgerError('ACCOUNT_NOT_FOUND', '未找到付款账户');
  if (!input.recipients.length) throw new LedgerError('NO_RECIPIENT', '缺少收款人');
  const totalCents = input.recipients.reduce((sum, r) => sum + Math.round(r.amountCents), 0);
  if (totalCents <= 0) throw new LedgerError('INVALID_AMOUNT', '转账金额必须大于 0');
  if (availableCents(account) < totalCents) {
    throw new LedgerError('INSUFFICIENT_BALANCE', '账户可用余额不足');
  }

  account.balanceCents -= totalCents;
  const txns = input.recipients.map((r) =>
    recordTxn(state, {
      accountId: account.id,
      amountCents: -Math.round(r.amountCents),
      merchant: `转账 · ${r.name}`,
      category: '转账',
      note: input.note,
    }),
  );
  return { txns, totalCents, account, recipients: input.recipients };
}

export function reverseTransfer(
  state: BankState,
  txnIds: string[],
): { creditCents: number; reversal: Txn; originals: Txn[] } {
  const originals = state.transactions.filter((t) => txnIds.includes(t.id) && t.status === 'posted');
  if (!originals.length) throw new LedgerError('TXN_NOT_REVERSIBLE', '没有可冲正的交易');
  const creditCents = originals.reduce((sum, t) => sum + Math.abs(t.amountCents), 0);
  const account = state.accounts.find((a) => a.id === originals[0]!.accountId);
  if (!account) throw new LedgerError('ACCOUNT_NOT_FOUND', '原交易账户不存在');
  for (const t of originals) t.status = 'reversed';
  account.balanceCents += creditCents;
  const reversal = recordTxn(state, {
    accountId: account.id,
    amountCents: creditCents,
    merchant: '转账冲正',
    category: '转账',
    note: '当日撤销',
  });
  return { creditCents, reversal, originals };
}

export function purchaseWealth(
  state: BankState,
  input: { product: WealthProduct; amountCents: number; fromAccountId?: string },
): { holding: Holding; txn: Txn; account: Account } {
  const account = findAccount(state, input.fromAccountId);
  if (!account) throw new LedgerError('ACCOUNT_NOT_FOUND', '未找到扣款账户');
  const amount = Math.round(input.amountCents);
  if (amount < input.product.minAmountCents) {
    throw new LedgerError('BELOW_MIN_AMOUNT', `起购金额为 ${(input.product.minAmountCents / 100).toFixed(2)} 元`);
  }
  if (availableCents(account) < amount) throw new LedgerError('INSUFFICIENT_BALANCE', '账户可用余额不足');
  account.balanceCents -= amount;
  let holding = state.holdings.find((h) => h.productId === input.product.id && h.status === 'holding');
  if (holding) {
    holding.amountCents += amount;
  } else {
    holding = {
      id: newId('h'),
      productId: input.product.id,
      amountCents: amount,
      purchasedAt: clock.nowIso(),
      yieldPct: input.product.yieldPct,
      floatingPct: 0,
      status: 'holding',
    };
    state.holdings.push(holding);
  }
  const txn = recordTxn(state, {
    accountId: account.id,
    amountCents: -amount,
    merchant: `${input.product.name} · 申购`,
    category: '投资理财',
    note: `风险等级 ${input.product.riskLevel}`,
  });
  return { holding, txn, account };
}

export function redeemWealth(
  state: BankState,
  input: { holding: Holding; product: WealthProduct; amountCents: number; toAccountId?: string },
): { amountCents: number; txn: Txn; account: Account; holding: Holding } {
  const account = findAccount(state, input.toAccountId);
  if (!account) throw new LedgerError('ACCOUNT_NOT_FOUND', '未找到入账账户');
  const amount = Math.round(input.amountCents);
  if (amount <= 0 || amount > input.holding.amountCents) {
    throw new LedgerError('INVALID_AMOUNT', '赎回金额超出持仓');
  }
  input.holding.amountCents -= amount;
  if (input.holding.amountCents === 0) input.holding.status = 'redeemed';
  account.balanceCents += amount;
  const txn = recordTxn(state, {
    accountId: account.id,
    amountCents: amount,
    merchant: `${input.product.name} · 赎回`,
    category: '投资理财',
  });
  return { amountCents: amount, txn, account, holding: input.holding };
}

export function lockFunds(
  state: BankState,
  input: { accountId?: string; amountCents: number; reason: string; releaseAt: string },
): { lock: FundLock; account: Account } {
  const account = findAccount(state, input.accountId);
  if (!account) throw new LedgerError('ACCOUNT_NOT_FOUND', '未找到锁定账户');
  if (availableCents(account) < input.amountCents) {
    throw new LedgerError('INSUFFICIENT_BALANCE', '活期账户可用余额不足');
  }
  account.lockedCents += input.amountCents;
  const lock: FundLock = {
    id: newId('lock'),
    accountId: account.id,
    amountCents: input.amountCents,
    reason: input.reason,
    createdAt: clock.nowIso(),
    releaseAt: input.releaseAt,
    status: 'locked',
  };
  state.fundLocks.push(lock);
  return { lock, account };
}

export function unlockFunds(state: BankState, lockId: string): { lock: FundLock; account: Account } {
  const lock = state.fundLocks.find((l) => l.id === lockId && l.status === 'locked');
  if (!lock) throw new LedgerError('LOCK_NOT_FOUND', '未找到可释放的锁定资金');
  lock.status = 'released';
  const account = state.accounts.find((a) => a.id === lock.accountId);
  if (!account) throw new LedgerError('ACCOUNT_NOT_FOUND', '锁定账户不存在');
  account.lockedCents = Math.max(0, account.lockedCents - lock.amountCents);
  return { lock, account };
}

export function orderGift(
  state: BankState,
  input: {
    type: 'flower' | 'cake';
    merchant: string;
    amountCents: number;
    deliveryAt: string;
    note: string;
    fromAccountId?: string;
  },
): { order: GiftOrder; account: Account; txn: Txn } {
  const account = findAccount(state, input.fromAccountId);
  if (!account) throw new LedgerError('ACCOUNT_NOT_FOUND', '未找到付款账户');
  if (availableCents(account) < input.amountCents) {
    throw new LedgerError('INSUFFICIENT_BALANCE', '账户可用余额不足');
  }
  account.balanceCents -= input.amountCents;
  const order: GiftOrder = {
    id: newId('gift'),
    type: input.type,
    merchant: input.merchant,
    amountCents: input.amountCents,
    deliveryAt: input.deliveryAt,
    status: 'scheduled',
    note: input.note,
  };
  state.giftOrders.push(order);
  const txn = recordTxn(state, {
    accountId: account.id,
    amountCents: -input.amountCents,
    merchant: `${input.merchant} · 预约`,
    category: '生活服务',
    note: input.note,
  });
  return { order, account, txn };
}

export function cancelGift(
  state: BankState,
  orderId: string,
): { order: GiftOrder; account: Account; txn: Txn } {
  const order = state.giftOrders.find((o) => o.id === orderId && o.status === 'scheduled');
  if (!order) throw new LedgerError('ORDER_NOT_FOUND', '未找到可取消的预约订单');
  order.status = 'cancelled';
  const account = primaryAccount(state);
  account.balanceCents += order.amountCents;
  const txn = recordTxn(state, {
    accountId: account.id,
    amountCents: order.amountCents,
    merchant: `${order.merchant} · 取消退款`,
    category: '生活服务',
  });
  return { order, account, txn };
}

export function applyVirtualCard(
  state: BankState,
  input: { limitCents: number; network?: '银联' | 'Visa' },
): { card: BankCard } {
  const card: BankCard = {
    id: newId('card'),
    type: 'virtual',
    network: input.network ?? '银联',
    last4: String(Math.floor(1000 + Math.random() * 9000)),
    status: 'active',
    limitCents: input.limitCents,
    usedCents: 0,
    expiry: '10/29',
    color: '#4A3B2A',
    virtual: true,
  };
  state.cards.push(card);
  return { card };
}

export function cancelVirtualCard(state: BankState, cardId: string): { card: BankCard } {
  const card = state.cards.find((c) => c.id === cardId && c.type === 'virtual');
  if (!card) throw new LedgerError('CARD_NOT_FOUND', '虚拟卡不存在');
  card.status = 'cancelled';
  return { card };
}

export function adjustCardLimit(
  state: BankState,
  input: { cardId: string; limitCents: number },
): { card: BankCard; previousLimitCents: number } {
  const card = state.cards.find((c) => c.id === input.cardId);
  if (!card) throw new LedgerError('CARD_NOT_FOUND', '卡片不存在');
  const previousLimitCents = card.limitCents ?? 0;
  card.limitCents = input.limitCents;
  return { card, previousLimitCents };
}

export function setCardStatus(
  state: BankState,
  input: { cardId: string; status: BankCard['status'] },
): { card: BankCard; previousStatus: BankCard['status'] } {
  const card = state.cards.find((c) => c.id === input.cardId);
  if (!card) throw new LedgerError('CARD_NOT_FOUND', '卡片不存在');
  const previousStatus = card.status;
  card.status = input.status;
  return { card, previousStatus };
}

export function cancelSubscription(
  state: BankState,
  subscriptionId: string,
): { subscription: Subscription; previousStatus: Subscription['status'] } {
  const sub = state.subscriptions.find((s) => s.id === subscriptionId);
  if (!sub) throw new LedgerError('SUBSCRIPTION_NOT_FOUND', '未找到订阅');
  const previousStatus = sub.status;
  sub.status = 'cancelled';
  return { subscription: sub, previousStatus };
}

export function restoreSubscription(
  state: BankState,
  subscriptionId: string,
  previousStatus: Subscription['status'] = 'active',
): Subscription {
  const sub = state.subscriptions.find((s) => s.id === subscriptionId);
  if (!sub) throw new LedgerError('SUBSCRIPTION_NOT_FOUND', '未找到订阅');
  sub.status = previousStatus;
  return sub;
}

export function createSchedule(
  state: BankState,
  input: Omit<ScheduleItem, 'id' | 'status'>,
): ScheduleItem {
  const item: ScheduleItem = { ...input, id: newId('sch'), status: 'scheduled' };
  state.schedules.push(item);
  return item;
}

export function addCalendarNote(state: BankState, title: string, executeAt: string, detail?: string): ScheduleItem {
  return createSchedule(state, { kind: 'note', title, executeAt, detail });
}
