/**
 * 银行核心接入的联调桩（仅用于本地验证 HTTP 适配层，不是生产核心）。
 *
 * 它实现 docs/openapi-banking.yaml 中的同一份契约：
 *   GET  /v1/snapshot
 *   POST /v1/ops
 *
 * 启动：
 *   BANKING_APP_ID=stub-app BANKING_APP_SECRET=stub-secret npx tsx scripts/bank-core-stub.ts
 */
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import type { BankState } from '../apps/server/src/core/state';
import { createSeededState } from '../apps/server/src/core/seed';
import {
  LedgerError,
  adjustCardLimit,
  applyVirtualCard,
  cancelGift,
  cancelSubscription,
  cancelVirtualCard,
  createSchedule,
  lockFunds,
  newId,
  orderGift,
  purchaseWealth,
  redeemWealth,
  restoreSubscription,
  reverseTransfer,
  setCardStatus,
  transfer,
  unlockFunds,
} from '../apps/server/src/core/ledger';

const PORT = Number(process.env.STUB_PORT ?? process.env.PORT ?? 8791);
const APP_ID = process.env.BANKING_APP_ID ?? 'stub-app';
const APP_SECRET = process.env.BANKING_APP_SECRET ?? 'stub-secret';
const MAX_SKEW_MS = 5 * 60_000;

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'warn' } });

app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
  (request as any).rawBody = body;
  try {
    done(null, body ? JSON.parse(String(body)) : {});
  } catch (error) {
    done(error as Error);
  }
});

const states = new Map<string, BankState>();
const idempotency = new Map<string, { data: unknown; at: number }>();
const seenNonces = new Map<string, number>();
const otpChallenges = new Map<string, { code: string; attemptsLeft: number; expiresAt: number }>();
const faceSessions = new Map<string, { createdAt: number; status: 'pending' | 'passed' }>();

function stateFor(ref: unknown): BankState {
  if (typeof ref !== 'string' || !/^bref_[a-f0-9]{24}$/.test(ref)) {
    throw new LedgerError('INVALID_EXTERNAL_REF', 'externalRef 不合法');
  }
  let state = states.get(ref);
  if (!state) {
    state = createSeededState({
      userId: ref,
      name: '联调客户',
      phoneMasked: '138****6677',
      seed: 20261030,
    });
    states.set(ref, state);
  }
  return state;
}

function snapshot(state: BankState) {
  return {
    accounts: state.accounts,
    cards: state.cards,
    transactions: state.transactions,
    subscriptions: state.subscriptions,
    products: state.products,
    holdings: state.holdings,
    fundLocks: state.fundLocks,
    giftOrders: state.giftOrders,
    schedules: state.schedules,
    disputes: state.disputes,
  };
}

function verify(request: any): { ok: true } | { ok: false; status: number; code: string; message: string } {
  if (request.headers['x-app-id'] !== APP_ID) {
    return { ok: false, status: 401, code: 'BAD_APP_ID', message: '应用标识不匹配' };
  }
  const timestamp = String(request.headers['x-timestamp'] ?? '');
  const nonce = String(request.headers['x-nonce'] ?? '');
  const signature = String(request.headers['x-signature'] ?? '');
  const ts = Number(timestamp);
  if (!timestamp || !nonce || !signature || !Number.isFinite(ts)) {
    return { ok: false, status: 401, code: 'MISSING_SIGNATURE', message: '缺少签名头' };
  }
  if (Math.abs(Date.now() - ts) > MAX_SKEW_MS) {
    return { ok: false, status: 401, code: 'CLOCK_SKEW', message: '时间戳超出允许范围' };
  }
  const now = Date.now();
  for (const [key, expiresAt] of seenNonces) {
    if (expiresAt < now) seenNonces.delete(key);
  }
  if (seenNonces.has(nonce)) {
    return { ok: false, status: 409, code: 'REPLAYED_NONCE', message: '请求 nonce 已使用' };
  }
  const rawUrl = request.raw.url as string;
  const body = (request as any).rawBody ?? '';
  const bodyHash = createHash('sha256').update(body).digest('hex');
  const canonical = `${request.method}\n${rawUrl}\n${timestamp}\n${nonce}\n${bodyHash}`;
  const expected = createHmac('sha256', APP_SECRET).update(canonical).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, 'hex');
  } catch {
    return { ok: false, status: 401, code: 'BAD_SIGNATURE', message: '签名格式错误' };
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { ok: false, status: 401, code: 'BAD_SIGNATURE', message: '签名校验失败' };
  }
  seenNonces.set(nonce, now + MAX_SKEW_MS);
  return { ok: true };
}

function reject(reply: any, status: number, code: string, message: string) {
  return reply.code(status).send({ ok: false, error: { code, message } });
}

function execute(state: BankState, op: string, payload: any): Record<string, unknown> {
  switch (op) {
    case 'transfer': {
      const result = transfer(state, {
        fromAccountId: payload.fromAccountId,
        recipients: payload.recipients,
        note: payload.note,
      });
      return {
        txnIds: result.txns.map((txn) => txn.id),
        totalCents: result.totalCents,
        accountId: result.account.id,
      };
    }
    case 'reverse_transfer': {
      const result = reverseTransfer(state, payload.txnIds ?? []);
      return {
        creditCents: result.creditCents,
        reversalTxnId: result.reversal.id,
        originalTxnIds: result.originals.map((txn) => txn.id),
      };
    }
    case 'purchase_wealth': {
      const product = state.products.find((item) => item.id === payload.productId);
      if (!product) throw new LedgerError('PRODUCT_NOT_FOUND', '理财产品不存在');
      const result = purchaseWealth(state, {
        product,
        amountCents: payload.amountCents,
        fromAccountId: payload.fromAccountId,
      });
      return {
        holdingId: result.holding.id,
        txnId: result.txn.id,
        amountCents: payload.amountCents,
      };
    }
    case 'redeem_wealth': {
      const holding = state.holdings.find((item) => item.id === payload.holdingId);
      if (!holding) throw new LedgerError('HOLDING_NOT_FOUND', '持仓不存在');
      const product = state.products.find((item) => item.id === holding.productId);
      if (!product) throw new LedgerError('PRODUCT_NOT_FOUND', '理财产品不存在');
      const result = redeemWealth(state, {
        holding,
        product,
        amountCents: payload.amountCents,
        toAccountId: payload.toAccountId,
      });
      return {
        holdingId: result.holding.id,
        txnId: result.txn.id,
        amountCents: result.amountCents,
      };
    }
    case 'apply_virtual_card': {
      const result = applyVirtualCard(state, { limitCents: payload.limitCents });
      return { cardId: result.card.id, last4: result.card.last4 };
    }
    case 'cancel_virtual_card': {
      const result = cancelVirtualCard(state, payload.cardId);
      return { cardId: result.card.id };
    }
    case 'adjust_card_limit': {
      const result = adjustCardLimit(state, {
        cardId: payload.cardId,
        limitCents: payload.limitCents,
      });
      return { cardId: result.card.id, previousLimitCents: result.previousLimitCents };
    }
    case 'set_card_status': {
      const result = setCardStatus(state, {
        cardId: payload.cardId,
        status: payload.status,
      });
      return { cardId: result.card.id, previousStatus: result.previousStatus };
    }
    case 'cancel_subscription': {
      const result = cancelSubscription(state, payload.subscriptionId);
      return {
        subscriptionId: result.subscription.id,
        previousStatus: result.previousStatus,
      };
    }
    case 'restore_subscription': {
      const subscription = restoreSubscription(
        state,
        payload.subscriptionId,
        payload.status ?? 'active',
      );
      return { subscriptionId: subscription.id };
    }
    case 'create_schedule': {
      const item = createSchedule(state, {
        kind: payload.kind ?? 'transfer',
        title: String(payload.title ?? '定时计划'),
        amountCents: payload.amountCents,
        executeAt: payload.executeAt,
        detail: payload.detail,
        payload: payload.payload,
      });
      return { scheduleId: item.id };
    }
    case 'cancel_schedule': {
      const schedule = state.schedules.find((item) => item.id === payload.scheduleId);
      if (!schedule) throw new LedgerError('SCHEDULE_NOT_FOUND', '定时计划不存在');
      schedule.status = 'cancelled';
      return { scheduleId: schedule.id };
    }
    case 'lock_funds': {
      const result = lockFunds(state, {
        accountId: payload.accountId,
        amountCents: payload.amountCents,
        reason: payload.reason,
        releaseAt: payload.releaseAt,
      });
      return { lockId: result.lock.id };
    }
    case 'unlock_funds': {
      const result = unlockFunds(state, payload.lockId);
      return { lockId: result.lock.id };
    }
    case 'order_gift': {
      const result = orderGift(state, {
        type: payload.type,
        merchant: payload.merchant,
        amountCents: payload.amountCents,
        deliveryAt: payload.deliveryAt,
        note: payload.note,
        fromAccountId: payload.fromAccountId,
      });
      return { orderId: result.order.id, txnId: result.txn.id };
    }
    case 'cancel_gift': {
      const result = cancelGift(state, payload.orderId);
      return { orderId: result.order.id, txnId: result.txn.id };
    }
    case 'create_split': {
      const names: string[] = Array.isArray(payload.names) ? payload.names : [];
      const total = Math.round(Number(payload.totalCents ?? 0));
      const base = Math.floor(total / (names.length + 1));
      const remainder = total - base * (names.length + 1);
      return {
        requestId: newId('aa'),
        totalCents: total,
        myShareCents: base,
        shares: names.map((name, index) => ({
          name,
          amountCents: base + (index === 0 ? remainder : 0),
          status: 'pending',
        })),
        createdAt: new Date().toISOString(),
        note: payload.note,
      };
    }
    case 'cancel_split':
      return { requestId: payload.requestId };
    case 'open_dispute': {
      const txn = state.transactions.find((item) => item.id === payload.txnId);
      if (!txn) throw new LedgerError('TXN_NOT_FOUND', '交易不存在');
      const existing = state.disputes.find(
        (item) => item.txnId === txn.id && item.status !== 'rejected',
      );
      if (existing) return { disputeId: existing.id, reference: existing.reference };
      const now = new Date();
      const dispute = {
        id: newId('dsp'),
        reference: `DR${now.toISOString().slice(0, 10).replace(/-/g, '')}0${String(
          state.disputes.length + 1,
        ).padStart(3, '0')}`,
        txnId: txn.id,
        accountId: txn.accountId,
        merchant: txn.merchant,
        amountCents: txn.amountCents,
        currency: 'CNY' as const,
        reason: payload.reason ?? 'other',
        status: 'reviewing' as const,
        note: typeof payload.note === 'string' ? payload.note.slice(0, 300) : undefined,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        expectedFinishAt: new Date(now.getTime() + 5 * 86_400_000).toISOString(),
        channel: payload.channel === 'agent' ? ('agent' as const) : ('app' as const),
        resolution: '银行核心已受理，进入差错核查流程',
      };
      state.disputes.unshift(dispute);
      return { disputeId: dispute.id, reference: dispute.reference };
    }
    default:
      throw new LedgerError('UNKNOWN_OP', `未知操作 ${op}`);
  }
}

app.get('/v1/health', async () => ({
  ok: true,
  data: { service: 'bank-core-stub', appId: APP_ID, now: new Date().toISOString() },
}));

app.get('/v1/snapshot', async (request, reply) => {
  const auth = verify(request);
  if (auth.ok === false) return reject(reply, auth.status, auth.code, auth.message);
  try {
    const state = stateFor((request.query as any).externalRef);
    return { ok: true, data: snapshot(state) };
  } catch (error) {
    if (error instanceof LedgerError) return reject(reply, 400, error.code, error.message);
    throw error;
  }
});

app.post('/v1/otp/send', async (request, reply) => {
  const auth = verify(request);
  if (auth.ok === false) return reject(reply, auth.status, auth.code, auth.message);
  const body = (request.body ?? {}) as { reference?: string };
  if (!body.reference) return reject(reply, 400, 'MISSING_REFERENCE', '缺少 reference');
  const idempotencyKey = String(request.headers['idempotency-key'] ?? '');
  if (idempotencyKey && idempotency.has(`otp:${idempotencyKey}`)) {
    return { ok: true, data: idempotency.get(`otp:${idempotencyKey}`)!.data };
  }
  const requestId = `otp_${randomUUID().slice(0, 8)}`;
  otpChallenges.set(requestId, {
    code: '246810',
    attemptsLeft: 3,
    expiresAt: Date.now() + 5 * 60_000,
  });
  const data = { requestId, expiresInSec: 300 };
  if (idempotencyKey) idempotency.set(`otp:${idempotencyKey}`, { data, at: Date.now() });
  return { ok: true, data };
});

app.post('/v1/otp/verify', async (request, reply) => {
  const auth = verify(request);
  if (auth.ok === false) return reject(reply, auth.status, auth.code, auth.message);
  const body = (request.body ?? {}) as { requestId?: string; code?: string };
  const challenge = body.requestId ? otpChallenges.get(body.requestId) : undefined;
  if (!challenge || challenge.expiresAt < Date.now()) {
    return { ok: true, data: { ok: false, reason: 'OTP_EXPIRED' } };
  }
  if (body.code !== challenge.code) {
    challenge.attemptsLeft -= 1;
    return {
      ok: true,
      data: {
        ok: false,
        attemptsLeft: Math.max(0, challenge.attemptsLeft),
        reason: challenge.attemptsLeft <= 0 ? 'OTP_ATTEMPTS_EXHAUSTED' : 'OTP_INVALID',
      },
    };
  }
  challenge.attemptsLeft = 0;
  return { ok: true, data: { ok: true } };
});

app.post('/v1/face/sessions', async (request, reply) => {
  const auth = verify(request);
  if (auth.ok === false) return reject(reply, auth.status, auth.code, auth.message);
  const sessionId = `face_${randomUUID().slice(0, 8)}`;
  faceSessions.set(sessionId, { createdAt: Date.now(), status: 'pending' });
  return {
    ok: true,
    data: {
      sessionId,
      verifyUrl: `http://127.0.0.1:${PORT}/verify-demo?session=${sessionId}`,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    },
  };
});

app.get('/verify-demo', async (request) => {
  const sessionId = String((request.query as any).session ?? '');
  return `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px;background:#0f3d33;color:#f4f1ec"><h2>联调人脸核验</h2><p>这是银行核验服务的联调页面，不是真实活体检测。</p><p>会话 ${sessionId || '未知'} 将在数秒内自动通过。</p></body>`;
});

app.get('/v1/face/sessions/:id', async (request, reply) => {
  const auth = verify(request);
  if (auth.ok === false) return reject(reply, auth.status, auth.code, auth.message);
  const { id } = request.params as { id: string };
  const session = faceSessions.get(id);
  if (!session) return { ok: true, data: { status: 'expired' } };
  if (session.createdAt + 1500 < Date.now()) session.status = 'passed';
  return { ok: true, data: { status: session.status, score: 0.99 } };
});

app.post('/v1/ops', async (request, reply) => {
  const auth = verify(request);
  if (auth.ok === false) return reject(reply, auth.status, auth.code, auth.message);
  const body = (request.body ?? {}) as { externalRef?: string; op?: string; payload?: any };
  const idem = String(request.headers['idempotency-key'] ?? '');
  const cacheKey = `${body.externalRef}:${idem}`;
  if (idem && idempotency.has(cacheKey)) {
    return { ok: true, data: idempotency.get(cacheKey)!.data, requestId: randomUUID() };
  }
  try {
    const state = stateFor(body.externalRef);
    if (!body.op) throw new LedgerError('MISSING_OP', '缺少 op');
    const data = {
      ...execute(state, body.op, body.payload ?? {}),
      snapshot: snapshot(state),
    };
    if (idem) idempotency.set(cacheKey, { data, at: Date.now() });
    return { ok: true, data, requestId: randomUUID() };
  } catch (error) {
    if (error instanceof LedgerError) return reject(reply, 409, error.code, error.message);
    request.log.error(error);
    return reject(reply, 500, 'STUB_ERROR', '联调桩内部错误');
  }
});

await app.listen({ port: PORT, host: '0.0.0.0' });
console.log(`bank-core-stub listening on http://127.0.0.1:${PORT} (appId=${APP_ID})`);
