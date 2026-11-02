import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  DISPUTE_REASON_TEXT,
  canDispute,
  type Dispute,
  type DisputeListPayload,
  type TxnDetailPayload,
} from '@bank/shared';
import { getState, persist } from '../core/store';
import { clock } from '../core/clock';
import { banking } from '../integration/banking';
import { audit } from '../security/auditChain';
import { allowAuthAttempt } from '../security/auth';
import { toToolError } from '../tools/helpers';

const REASONS = ['duplicate', 'unauthorized', 'not_received', 'amount_wrong', 'other'] as const;

function dayKeyOf(ts: string): string {
  return ts.slice(0, 10);
}

async function ensureFresh(authId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const info = await banking.sync(authId, { tolerant: true });
  if (banking.mode === 'http' && !info.healthy && !info.syncedAt) {
    return { ok: false, message: `银行核心暂不可用：${info.error ?? '尚未完成首次同步'}` };
  }
  return { ok: true };
}

export async function transactionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/transactions/:id', async (request, reply) => {
    const auth = request.authUser!;
    const fresh = await ensureFresh(auth.id);
    if (!fresh.ok) return reply.code(503).send({ ok: false, code: 'BANK_UNAVAILABLE', message: fresh.message });
    const state = getState(auth.id);
    const id = String((request.params as { id?: string }).id ?? '');
    const txn = state.transactions.find((item) => item.id === id);
    if (!txn) {
      return reply.code(404).send({ ok: false, code: 'TXN_NOT_FOUND', message: '未找到该笔交易' });
    }
    const now = clock.nowIso();
    if (new Date(txn.ts).getTime() > new Date(now).getTime()) {
      return reply.code(404).send({ ok: false, code: 'TXN_NOT_FOUND', message: '该笔交易尚未入账' });
    }
    const account = state.accounts.find((item) => item.id === txn.accountId);
    const product = state.products.find((item) => txn.merchant.startsWith(item.name));
    const subscription =
      state.subscriptions.find(
        (item) =>
          txn.merchant.includes(item.merchant) &&
          Math.abs(Math.abs(txn.amountCents) - item.amountCents) < 1,
      ) ?? null;
    const similar = state.transactions
      .filter(
        (item) =>
          item.id !== txn.id &&
          item.merchant === txn.merchant &&
          item.amountCents === txn.amountCents &&
          dayKeyOf(item.ts) === dayKeyOf(txn.ts),
      )
      .map((item) => ({ id: item.id, ts: item.ts, amountCents: item.amountCents, merchant: item.merchant }));
    const dispute = [...state.disputes].reverse().find((item) => item.txnId === txn.id) ?? null;

    const payload: TxnDetailPayload = {
      txn,
      account: account
        ? { id: account.id, name: account.name, bank: account.bank, type: account.type, last4: account.last4 }
        : null,
      subscription: subscription
        ? {
            id: subscription.id,
            merchant: subscription.merchant,
            cycle: subscription.cycle,
            amountCents: subscription.amountCents,
            nextChargeAt: subscription.nextChargeAt,
            status: subscription.status,
          }
        : null,
      product: product ? { id: product.id, name: product.name, type: product.type, riskLevel: product.riskLevel } : null,
      similar,
      dispute,
      disputeEligible: canDispute(txn, now),
      dataSource: banking.status(auth.id),
    };
    return { ok: true, ...payload };
  });

  app.post('/api/transactions/:id/dispute', async (request, reply) => {
    const auth = request.authUser!;
    const limit = allowAuthAttempt(`dispute:${auth.id}`, 5, 60 * 60_000);
    if (!limit.allowed) {
      return reply.code(429).send({
        ok: false,
        code: 'RATE_LIMITED',
        message: `申诉提交过于频繁，请 ${limit.retryAfterSec} 秒后再试`,
      });
    }
    const parsed = z
      .object({
        reason: z.enum(REASONS),
        note: z.string().trim().max(300).optional(),
      })
      .safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        code: 'INVALID_DISPUTE',
        message: parsed.error.issues[0]?.message ?? '请选择争议原因',
      });
    }
    const fresh = await ensureFresh(auth.id);
    if (!fresh.ok) return reply.code(503).send({ ok: false, code: 'BANK_UNAVAILABLE', message: fresh.message });

    const state = getState(auth.id);
    const id = String((request.params as { id?: string }).id ?? '');
    const txn = state.transactions.find((item) => item.id === id);
    if (!txn) {
      return reply.code(404).send({ ok: false, code: 'TXN_NOT_FOUND', message: '未找到该笔交易' });
    }
    const now = clock.nowIso();
    const eligible = canDispute(txn, now);
    if (!eligible.ok) {
      return reply.code(400).send({ ok: false, code: eligible.code, message: eligible.message });
    }
    const open = state.disputes.find((item) => item.txnId === txn.id && item.status !== 'rejected');
    if (open) {
      return reply.code(409).send({
        ok: false,
        code: 'DISPUTE_EXISTS',
        message: `该笔交易已有工单 ${open.reference}，当前状态为处理中`,
        dispute: open,
      });
    }
    let dispute: Dispute;
    try {
      dispute = await banking.openDispute(
        auth.id,
        {
          txn,
          reason: parsed.data.reason,
          note: parsed.data.note,
          channel: 'app',
        },
        `dispute:${auth.id}:${txn.id}`,
      );
    } catch (error) {
      const mapped = toToolError(error, 'DISPUTE_FAILED', '争议提交失败，请稍后重试');
      return reply.code(502).send({ ok: false, code: mapped.code, message: mapped.message });
    }
    persist();
    audit.append(
      'TXN_DISPUTE_OPENED',
      `用户对「${txn.merchant}」${(Math.abs(txn.amountCents) / 100).toFixed(2)} 元交易发起争议`,
      {
        txnId: txn.id,
        disputeId: dispute.id,
        reference: dispute.reference,
        reason: dispute.reason,
        reasonText: DISPUTE_REASON_TEXT[dispute.reason],
        amountCents: dispute.amountCents,
        status: dispute.status,
        expectedFinishAt: dispute.expectedFinishAt,
      },
      {},
    );
    return { ok: true, dispute };
  });

  app.get('/api/disputes', async (request, reply) => {
    const auth = request.authUser!;
    const fresh = await ensureFresh(auth.id);
    if (!fresh.ok) return reply.code(503).send({ ok: false, code: 'BANK_UNAVAILABLE', message: fresh.message });
    let items: Dispute[];
    try {
      items = await banking.refreshDisputes(auth.id);
    } catch (error) {
      const mapped = toToolError(error, 'DISPUTE_READ_FAILED', '工单状态刷新失败');
      return reply.code(502).send({ ok: false, code: mapped.code, message: mapped.message });
    }
    persist();
    const payload: DisputeListPayload = {
      items: [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
      openCount: items.filter((item) => item.status === 'submitted' || item.status === 'reviewing').length,
    };
    return { ok: true, ...payload };
  });
}
