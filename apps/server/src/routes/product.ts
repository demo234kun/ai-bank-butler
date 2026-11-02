import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  formatDate,
  type OverviewPayload,
  type OverviewTxn,
  type TransactionListPayload,
} from '@bank/shared';
import { getState, updateUserProfile } from '../core/store';
import { banking } from '../integration/banking';
import { clock } from '../core/clock';
import { getLimitSummary } from '../policy/limits';
import { maxProductRiskForLevel, riskAssessmentExpired } from '@bank/shared';
import { audit } from '../security/auditChain';
import { buildCapabilities, buildQuickPrompts } from '../agent/userContent';
import { listSessionsForUser } from '../agent/session';
import { toPublicAuth } from '../security/auth';
import { availableCents } from '../core/state';
import { isLivingExpense, periodRange, periodTxns } from '../tools/helpers';

function compactTxn(txn: any): OverviewTxn {
  return {
    id: txn.id,
    ts: txn.ts,
    amountCents: txn.amountCents,
    merchant: txn.merchant,
    category: txn.category,
    channel: txn.channel,
    accountId: txn.accountId,
    anomaly: Boolean(txn.anomaly),
  };
}

export async function productRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/overview', async (request, reply) => {
    const auth = request.authUser!;
    const source = await banking.sync(auth.id, { tolerant: true });
    if (banking.mode === 'http' && !source.healthy && !source.syncedAt) {
      return reply.code(503).send({
        ok: false,
        code: 'BANK_UNAVAILABLE',
        message: `银行核心暂不可用：${source.error ?? '尚未完成首次同步'}`,
      });
    }
    const bank = getState(auth.id);
    const range = periodRange('currentMonth');
    const monthTxns = periodTxns(bank, range);
    const living = monthTxns.filter(isLivingExpense);
    const expenseCents = living.reduce((sum, txn) => sum + Math.abs(txn.amountCents), 0);
    const incomeCents = monthTxns
      .filter((txn) => txn.amountCents > 0)
      .reduce((sum, txn) => sum + txn.amountCents, 0);
    const categoryMap = new Map<string, number>();
    for (const txn of living) {
      categoryMap.set(txn.category, (categoryMap.get(txn.category) ?? 0) + Math.abs(txn.amountCents));
    }
    const categories = [...categoryMap.entries()]
      .map(([name, amountCents]) => ({
        name,
        amountCents,
        ratio: expenseCents ? amountCents / expenseCents : 0,
      }))
      .sort((a, b) => b.amountCents - a.amountCents);
    const activeSubs = bank.subscriptions.filter((sub) => sub.status === 'active');
    const holdings = bank.holdings.filter((holding) => holding.status === 'holding');
    const verification = audit.verify();
    const now = clock.nowIso();
    const publicAuth = toPublicAuth(auth);

    const payload: OverviewPayload = {
      user: {
        name: bank.user.name,
        tier: bank.user.tier,
        phoneMasked: bank.user.phoneMasked,
        spouseName: bank.user.spouse.name,
        spouseBirthday: bank.user.spouse.birthday,
        riskProfile: bank.user.riskProfile,
        authUserId: auth.id,
        isGuest: auth.isGuest,
      },
      accounts: bank.accounts.map((account) => ({
        id: account.id,
        name: account.name,
        bank: account.bank,
        type: account.type,
        last4: account.last4,
        balanceCents: account.balanceCents,
        lockedCents: account.lockedCents,
        primary: account.primary,
        color: account.color,
      })),
      cards: bank.cards.map((card) => ({ ...card })),
      recentTransactions: [...bank.transactions]
        .filter((txn) => new Date(txn.ts).getTime() <= new Date(now).getTime())
        .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
        .slice(0, 6)
        .map(compactTxn),
      month: {
        label: range.label,
        expenseCents,
        incomeCents,
        anomalyCount: monthTxns.filter((txn) => txn.anomaly).length,
        transactionCount: monthTxns.length,
        categories: categories.slice(0, 8),
      },
      subscriptions: {
        activeCount: activeSubs.length,
        monthlyCents: activeSubs.reduce((sum, sub) => sum + sub.amountCents, 0),
        nextChargeAt:
          activeSubs
            .map((sub) => sub.nextChargeAt)
            .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] ?? null,
      },
      holdings: {
        count: holdings.length,
        valueCents: holdings.reduce((sum, holding) => sum + holding.amountCents, 0),
        productNames: holdings
          .map((holding) => bank.products.find((product) => product.id === holding.productId)?.name)
          .filter(Boolean)
          .slice(0, 3) as string[],
      },
      limits: getLimitSummary(bank),
      risk: {
        profile: bank.user.riskProfile,
        maxProductRisk: maxProductRiskForLevel(bank.user.riskProfile.level),
        expired: riskAssessmentExpired(bank.user.riskProfile.assessedAt, now),
      },
      notifications: {
        unreadCount: bank.notifications.filter((item) => !item.read).length,
        latest: bank.notifications.slice(0, 3),
      },
      plans: {
        scheduled: bank.schedules
          .filter((item) => item.status === 'scheduled')
          .sort((a, b) => new Date(a.executeAt).getTime() - new Date(b.executeAt).getTime())
          .slice(0, 4),
        lockedCents: bank.fundLocks
          .filter((lock) => lock.status === 'locked')
          .reduce((sum, lock) => sum + lock.amountCents, 0),
      },
      audit: {
        count: audit.countForUser(auth.id),
        verified: verification.ok,
        head: verification.head,
      },
      demoNow: now,
      quickPrompts: buildQuickPrompts(bank),
      capabilities: buildCapabilities(bank),
      dataSource: source,
    };

    // 让客户端拿到实时可用余额（含锁定资金）
    return {
      ...payload,
      user: {
        ...payload.user,
        phoneMasked: publicAuth.phoneMasked,
      },
      accounts: payload.accounts.map((account) => {
        const source = bank.accounts.find((item) => item.id === account.id);
        return {
          ...account,
          availableCents: source ? availableCents(source) : account.balanceCents,
        };
      }),
      todayLabel: formatDate(now),
      sessionCount: listSessionsForUser(auth.id).length,
    };
  });

  app.get('/api/transactions', async (request, reply) => {
    const auth = request.authUser!;
    const source = await banking.sync(auth.id, { tolerant: true });
    if (banking.mode === 'http' && !source.healthy && !source.syncedAt) {
      return reply.code(503).send({
        ok: false,
        code: 'BANK_UNAVAILABLE',
        message: `银行核心暂不可用：${source.error ?? '尚未完成首次同步'}`,
      });
    }
    const bank = getState(auth.id);
    const query = request.query as { period?: string; category?: string; limit?: string };
    const period =
      query.period === 'lastMonth' || query.period === 'year'
        ? query.period
        : 'currentMonth';
    const range = periodRange(period);
    let txns = periodTxns(bank, range);
    if (query.category) {
      txns = txns.filter((txn) => txn.category === query.category);
    }
    const expenseCents = txns
      .filter((txn) => txn.amountCents < 0)
      .reduce((sum, txn) => sum + Math.abs(txn.amountCents), 0);
    const incomeCents = txns
      .filter((txn) => txn.amountCents > 0)
      .reduce((sum, txn) => sum + txn.amountCents, 0);
    const limit = Math.max(1, Math.min(200, Number(query.limit ?? 120) || 120));
    const payload: TransactionListPayload = {
      period,
      periodLabel: range.label,
      items: txns.slice(0, limit).map(compactTxn),
      total: txns.length,
      expenseCents,
      incomeCents,
    };
    return payload;
  });

  app.post('/api/profile', async (request, reply) => {
    const auth = request.authUser!;
    const source = await banking.sync(auth.id, { tolerant: true });
    const body = (request.body ?? {}) as any;
    // 风险等级只能由测评得出，直接提交视为绕过适当性管理
    if (body.riskLevel !== undefined) {
      return reply.code(400).send({
        ok: false,
        code: 'RISK_ASSESSMENT_REQUIRED',
        message: '风险偏好需通过风险测评获得，请在「我的 · 风险测评」中完成',
      });
    }
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(20).optional(),
        spouseName: z.string().trim().max(20).optional(),
        spouseBirthday: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
      .strict()
      .safeParse(body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        code: 'INVALID_PROFILE',
        message: parsed.error.issues[0]?.message ?? '资料不合法',
      });
    }
    const bundle = updateUserProfile(auth.id, parsed.data);
    const bank = getState(auth.id);
    for (const session of listSessionsForUser(auth.id)) {
      session.context.spouseName = bank.user.spouse.name;
      session.context.spouseBirthday = bank.user.spouse.birthday;
    }
    audit.append(
      'PROFILE_UPDATED',
      '用户更新了个人资料',
      { fields: Object.keys(parsed.data) },
      {},
    );
    return {
      ok: true,
      user: toPublicAuth(bundle.auth),
      quickPrompts: buildQuickPrompts(bank),
      capabilities: buildCapabilities(bank),
      dataSource: source,
    };
  });
}
