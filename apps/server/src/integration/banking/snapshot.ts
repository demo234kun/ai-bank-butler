import { z } from 'zod';
import type { BankState } from '../../core/state';
import type { BankSnapshot } from './types';

const id = z.string().trim().min(1).max(80);
const isoText = z.string().trim().min(10).max(40);
const money = z.number().int().finite();
const positiveMoney = z.number().int().finite().nonnegative();

const accountSchema = z.object({
  id,
  name: z.string().max(80),
  bank: z.string().max(80),
  type: z.enum(['savings', 'current', 'credit']),
  last4: z.string().regex(/^\d{4}$/),
  balanceCents: money,
  lockedCents: positiveMoney,
  availableCents: positiveMoney.optional(),
  primary: z.boolean(),
  color: z.string().max(40),
});

const cardSchema = z.object({
  id,
  accountId: id.optional(),
  type: z.enum(['debit', 'credit', 'virtual']),
  network: z.enum(['银联', 'Visa']),
  last4: z.string().regex(/^\d{4}$/),
  status: z.enum(['active', 'frozen', 'lost', 'cancelled']),
  limitCents: positiveMoney.optional(),
  usedCents: positiveMoney.optional(),
  expiry: z.string().max(10),
  color: z.string().max(40),
  virtual: z.boolean(),
});

const txnSchema = z.object({
  id,
  accountId: id,
  ts: isoText,
  amountCents: money,
  merchant: z.string().max(120),
  category: z.string().max(40),
  channel: z.string().max(80),
  note: z.string().max(200).optional(),
  status: z.enum(['posted', 'reversed']),
  anomaly: z.boolean().optional(),
  anomalyReason: z.string().max(200).optional(),
  location: z.string().max(80).optional(),
});

const subscriptionSchema = z.object({
  id,
  merchant: z.string().max(80),
  amountCents: positiveMoney,
  previousAmountCents: positiveMoney.optional(),
  cycle: z.enum(['monthly', 'yearly']),
  nextChargeAt: isoText,
  lastChargedAt: isoText,
  status: z.enum(['active', 'paused', 'cancelled']),
  category: z.string().max(40),
  color: z.string().max(40),
});

const productSchema = z.object({
  id,
  name: z.string().max(80),
  issuer: z.string().max(80),
  type: z.string().max(40),
  riskLevel: z.enum(['R1', 'R2', 'R3', 'R4', 'R5']),
  yieldPct: z.number().finite().nonnegative(),
  minAmountCents: positiveMoney,
  termDays: z.number().int().nonnegative(),
  liquidity: z.string().max(80),
  tags: z.array(z.string().max(30)).max(20),
  description: z.string().max(400),
  color: z.string().max(40),
});

const holdingSchema = z.object({
  id,
  productId: id,
  amountCents: positiveMoney,
  purchasedAt: isoText,
  yieldPct: z.number().finite(),
  floatingPct: z.number().finite(),
  status: z.enum(['holding', 'redeemed']),
});

const fundLockSchema = z.object({
  id,
  accountId: id,
  amountCents: positiveMoney,
  reason: z.string().max(120),
  createdAt: isoText,
  releaseAt: isoText,
  status: z.enum(['locked', 'released']),
});

const giftOrderSchema = z.object({
  id,
  type: z.enum(['flower', 'cake']),
  merchant: z.string().max(80),
  amountCents: positiveMoney,
  deliveryAt: isoText,
  status: z.enum(['scheduled', 'delivered', 'cancelled']),
  note: z.string().max(200),
});

const scheduleSchema = z.object({
  id,
  kind: z.enum(['transfer', 'gift', 'note']),
  title: z.string().max(120),
  amountCents: positiveMoney.optional(),
  executeAt: isoText,
  status: z.enum(['scheduled', 'done', 'cancelled', 'failed']),
  detail: z.string().max(300).optional(),
  attempts: z.number().int().nonnegative().max(20).optional(),
  lastError: z.string().max(200).optional(),
  payload: z
    .object({
      recipients: z
        .array(
          z.object({
            name: z.string().max(60),
            amountCents: money,
            contactId: id.optional(),
            bank: z.string().max(60).optional(),
            last4: z.string().max(8).optional(),
          }),
        )
        .min(1)
        .max(20),
      fromAccountId: id.optional(),
      note: z.string().max(200).optional(),
      authorized: z.boolean(),
      authorizationRef: z.string().max(80).optional(),
    })
    .optional(),
});

const notificationSchema = z.object({
  id,
  ts: isoText,
  kind: z.enum(['schedule', 'budget', 'gift', 'note', 'risk', 'dispute', 'system']),
  title: z.string().max(120),
  body: z.string().max(400),
  read: z.boolean(),
  refId: z.string().max(80).optional(),
  amountCents: money.optional(),
});

const disputeSchema = z.object({
  id,
  reference: z.string().max(40),
  txnId: id,
  accountId: id,
  merchant: z.string().max(120),
  amountCents: money,
  currency: z.literal('CNY'),
  reason: z.enum(['duplicate', 'unauthorized', 'not_received', 'amount_wrong', 'other']),
  status: z.enum(['submitted', 'reviewing', 'resolved_credit', 'rejected']),
  note: z.string().max(300).optional(),
  createdAt: isoText,
  updatedAt: isoText,
  expectedFinishAt: isoText,
  channel: z.enum(['agent', 'app']),
  resolution: z.string().max(300).optional(),
});

const snapshotSchema = z.object({
  accounts: z.array(accountSchema).max(40).optional(),
  cards: z.array(cardSchema).max(80).optional(),
  transactions: z.array(txnSchema).max(5000).optional(),
  subscriptions: z.array(subscriptionSchema).max(200).optional(),
  products: z.array(productSchema).max(200).optional(),
  holdings: z.array(holdingSchema).max(300).optional(),
  fundLocks: z.array(fundLockSchema).max(200).optional(),
  giftOrders: z.array(giftOrderSchema).max(200).optional(),
  schedules: z.array(scheduleSchema).max(500).optional(),
  disputes: z.array(disputeSchema).max(200).optional(),
  notifications: z.array(notificationSchema).max(300).optional(),
});

export class SnapshotError extends Error {
  code = 'BANK_BAD_SNAPSHOT';
}

export function parseBankSnapshot(raw: unknown): BankSnapshot {
  const parsed = snapshotSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new SnapshotError(
      `银行核心返回的数据结构不合法${issue ? `：${issue.path.join('.')} ${issue.message}` : ''}`,
    );
  }
  return parsed.data;
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

/**
 * 将上游快照落到本地工作副本。账户、卡、订阅、持仓、产品、流水均以银行返回为准；
 * 用户资料（姓名、爱人、联系人）仍由本地身份域维护，不被核心覆盖。
 */
export function applyBankSnapshot(
  state: BankState,
  snapshot: BankSnapshot,
  options: { txnLimit?: number } = {},
): void {
  // 核心银行数据以快照为准；上游未返回时应清空，而不是保留本地种子数据。
  state.accounts = dedupeById(snapshot.accounts ?? []);
  if (state.accounts.length && !state.accounts.some((account) => account.primary)) {
    const fallback = state.accounts.find((account) => account.type !== 'credit') ?? state.accounts[0];
    if (fallback) fallback.primary = true;
  }
  state.cards = dedupeById(snapshot.cards ?? []);
  state.subscriptions = dedupeById(snapshot.subscriptions ?? []);
  state.products = dedupeById(snapshot.products ?? []);
  state.holdings = dedupeById(snapshot.holdings ?? []);
  if (snapshot.fundLocks) state.fundLocks = dedupeById(snapshot.fundLocks);
  if (snapshot.giftOrders) state.giftOrders = dedupeById(snapshot.giftOrders);
  if (snapshot.schedules) state.schedules = dedupeById(snapshot.schedules);
  if (snapshot.disputes) state.disputes = dedupeById(snapshot.disputes);
  // 提醒是本地体验层数据，银行不返回时保留；返回时以快照为准
  if (snapshot.notifications) state.notifications = dedupeById(snapshot.notifications);
  {
    const limit = Math.max(1, options.txnLimit ?? 1000);
    state.transactions = dedupeById(snapshot.transactions ?? [])
      .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
      .slice(0, limit);
  }
}
