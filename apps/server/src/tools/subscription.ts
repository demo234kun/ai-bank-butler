import { formatMoney, type ToolResult, type Txn } from '@bank/shared';
import { banking } from '../integration/banking';
import { resolveSubscription, toToolError } from './helpers';
import type { ToolHandler } from './types';

export const scanSubscriptionsTool: ToolHandler = (ctx): ToolResult => {
  const items = ctx.state.subscriptions.map((sub) => ({
    ...sub,
    priceIncreased:
      sub.previousAmountCents !== undefined && sub.amountCents > sub.previousAmountCents,
  }));
  const active = items.filter((s) => s.status === 'active');
  const totalMonthlyCents = active.reduce((sum, s) => sum + s.amountCents, 0);
  // 从真实/同步后的流水中识别“同日、同商户、同金额”的疑似重复扣费，不依赖固定样例数据。
  const groups = new Map<string, { merchant: string; amountCents: number; day: string; txns: Txn[] }>();
  for (const txn of ctx.state.transactions) {
    if (txn.category !== '订阅服务' || txn.amountCents >= 0) continue;
    const key = `${txn.ts.slice(0, 10)}|${txn.merchant}|${txn.amountCents}`;
    const group = groups.get(key) ?? {
      merchant: txn.merchant,
      amountCents: Math.abs(txn.amountCents),
      day: txn.ts.slice(0, 10),
      txns: [],
    };
    group.txns.push(txn);
    groups.set(key, group);
  }
  const duplicateCharges = [...groups.values()]
    .filter((group) => group.txns.length >= 2)
    .map((group) => ({
      merchant: group.merchant,
      amountCents: group.amountCents,
      day: group.day,
      count: group.txns.length,
      txnIds: group.txns.map((txn) => txn.id),
    }));
  const firstDuplicate = duplicateCharges[0];
  return {
    ok: true,
    data: {
      items,
      totalMonthlyCents,
      activeCount: active.length,
      duplicateCharge: Boolean(firstDuplicate),
      duplicateMerchant: firstDuplicate?.merchant ?? null,
      duplicateCharges,
    },
    evidence: [...active.map((s) => s.id), ...duplicateCharges.flatMap((d) => d.txnIds)],
    summary: `识别 ${active.length} 个自动续费，每月 ${formatMoney(totalMonthlyCents)}${
      firstDuplicate ? `；发现 ${duplicateCharges.length} 笔疑似重复扣费` : ''
    }`,
  };
};

export const detectPriceChangesTool: ToolHandler = (ctx): ToolResult => {
  const changes = ctx.state.subscriptions
    .filter((s) => s.previousAmountCents !== undefined && s.amountCents > s.previousAmountCents)
    .map((s) => ({
      subscription: s,
      deltaCents: s.amountCents - (s.previousAmountCents ?? 0),
      previousAmountCents: s.previousAmountCents,
      currentAmountCents: s.amountCents,
      annualExtraCents: (s.amountCents - (s.previousAmountCents ?? 0)) * 12,
    }));
  return {
    ok: true,
    data: { changes },
    evidence: changes.map((c) => c.subscription.id),
    summary: changes.length ? `发现 ${changes.length} 个订阅涨价` : '未发现订阅涨价',
  };
};

export const cancelSubscriptionTool: ToolHandler = async (ctx): Promise<ToolResult> => {
  const args = ctx.node.args as any;
  let { subscription, matches } = resolveSubscription(ctx.state, args.name);
  if (!subscription && args.subscriptionId) {
    subscription = ctx.state.subscriptions.find((s) => s.id === args.subscriptionId);
    matches = subscription ? [subscription] : [];
  }
  if (!subscription) {
    if (matches.length > 1) {
      return {
        ok: false,
        error: { code: 'SUBSCRIPTION_AMBIGUOUS', message: '匹配到多个订阅，请指定要取消的项目' },
        data: { options: matches.map((m) => ({ label: `${m.merchant} · ${formatMoney(m.amountCents)}/月`, value: m.id })) },
      };
    }
    return { ok: false, error: { code: 'SUBSCRIPTION_NOT_FOUND', message: '未找到要取消的订阅' } };
  }
  if (subscription.status !== 'active') {
    return { ok: false, error: { code: 'SUBSCRIPTION_INACTIVE', message: '该订阅已不是生效状态' } };
  }
  try {
    const result = await banking.cancelSubscription(
      ctx.userId,
      subscription.id,
      ctx.idempotencyKey,
    );
    return {
      ok: true,
      data: {
        subscription: result.subscription,
        previousStatus: result.previousStatus,
        monthlySavedCents: result.subscription.amountCents,
      },
      evidence: [subscription.id],
      summary: `已取消 ${subscription.merchant} 自动续费`,
    };
  } catch (error) {
    return { ok: false, error: toToolError(error, 'CANCEL_FAILED', '取消订阅失败') };
  }
};
