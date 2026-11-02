import type { Txn, ToolResult } from '@bank/shared';
import { buildCategoryInsightCode, runInSandbox } from '../security/sandbox/pool';
import type { ToolContext, ToolHandler } from './types';
import { inRange, isLivingExpense, periodRange, periodTxns, sumCents } from './helpers';

function compactTxn(t: Txn) {
  return {
    id: t.id,
    ts: t.ts,
    amountCents: t.amountCents,
    merchant: t.merchant,
    category: t.category,
    anomaly: t.anomaly ?? false,
    anomalyReason: t.anomalyReason,
    location: t.location,
    accountId: t.accountId,
  };
}

export const fetchTransactionsTool: ToolHandler = (ctx): ToolResult => {
  const period = ((ctx.node.args as any).period ?? 'currentMonth') as
    | 'currentMonth'
    | 'lastMonth'
    | 'year';
  const range = periodRange(period);
  const txns = periodTxns(ctx.state, range);
  return {
    ok: true,
    data: {
      period,
      range,
      txns: txns.map(compactTxn),
      count: txns.length,
    },
    summary: `${range.label}共读取 ${txns.length} 条流水`,
  };
};

export const aggregateBillsTool: ToolHandler = (ctx): ToolResult => {
  const fetch = ctx.resultOf(ctx.node.deps[0]!);
  if (!fetch?.ok) return { ok: false, error: { code: 'UPSTREAM_FAILED', message: '流水读取失败' } };
  const { txns, range } = fetch.data as { txns: ReturnType<typeof compactTxn>[]; range: any };
  const all = ctx.state.transactions;
  const expenses = txns.filter((t) => t.amountCents < 0 && t.category !== '投资理财' && t.category !== '转账');
  const totalExpenseCents = expenses.reduce((sum, t) => sum + Math.abs(t.amountCents), 0);
  const incomeCents = txns
    .filter((t) => t.amountCents > 0)
    .reduce((sum, t) => sum + t.amountCents, 0);
  const categoryMap = new Map<string, number>();
  const merchantMap = new Map<string, number>();
  for (const t of expenses) {
    categoryMap.set(t.category, (categoryMap.get(t.category) ?? 0) + Math.abs(t.amountCents));
    merchantMap.set(t.merchant, (merchantMap.get(t.merchant) ?? 0) + Math.abs(t.amountCents));
  }
  const categories = [...categoryMap.entries()]
    .map(([name, amountCents]) => ({
      name,
      amountCents,
      ratio: totalExpenseCents ? amountCents / totalExpenseCents : 0,
    }))
    .sort((a, b) => b.amountCents - a.amountCents);
  const topMerchants = [...merchantMap.entries()]
    .map(([merchant, amountCents]) => ({ merchant, amountCents }))
    .sort((a, b) => b.amountCents - a.amountCents)
    .slice(0, 5);

  const prevRange = {
    ...range,
    start: range.prevStart,
    end: range.prevEnd,
    label: range.prevLabel,
  };
  const prevAll = all.filter((t) => inRange(t, prevRange.start, prevRange.end));
  const prevExpenseCents = sumCents(prevAll, isLivingExpense);
  const deltaPct =
    prevExpenseCents > 0 ? ((totalExpenseCents - prevExpenseCents) / prevExpenseCents) * 100 : 0;

  return {
    ok: true,
    data: {
      periodLabel: range.label,
      prevLabel: range.prevLabel,
      totalExpenseCents,
      incomeCents,
      prevExpenseCents,
      deltaPct: Number(deltaPct.toFixed(2)),
      categories,
      topMerchants,
      txCount: txns.length,
    },
    summary: `生活支出 ${(totalExpenseCents / 100).toFixed(2)} 元，分类 ${categories.length} 个`,
  };
};

function detectDuplicate(txns: { ts: string; merchant: string; amountCents: number; category: string }[]) {
  const seen = new Map<string, number>();
  for (const t of txns) {
    if (t.amountCents >= 0) continue;
    const day = t.ts.slice(0, 10);
    const key = `${day}|${t.merchant}|${t.amountCents}|${t.category}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return new Set([...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key));
}

export const detectAnomaliesTool: ToolHandler = (ctx): ToolResult => {
  const fetch = ctx.resultOf(ctx.node.deps[0]!);
  if (!fetch?.ok) return { ok: false, error: { code: 'UPSTREAM_FAILED', message: '流水读取失败' } };
  const txns = fetch.data.txns as ReturnType<typeof compactTxn>[];
  const duplicates = detectDuplicate(txns);
  const EXCLUDED = new Set(['转账', '投资理财', '住房', '工资']);
  const anomalies = txns
    .filter((t) => t.amountCents < 0 && !EXCLUDED.has(t.category))
    .map((t) => {
      const hour = new Date(t.ts).getUTCHours() + 8 >= 24 ? (new Date(t.ts).getUTCHours() + 8) % 24 : new Date(t.ts).getUTCHours() + 8;
      const abs = Math.abs(t.amountCents);
      const reasons: string[] = [];
      let severity: 'high' | 'medium' = 'medium';
      if (t.anomaly) {
        reasons.push(t.anomalyReason ?? '已命中风险规则');
        severity = 'high';
      }
      const day = t.ts.slice(0, 10);
      if (duplicates.has(`${day}|${t.merchant}|${t.amountCents}|${t.category}`)) {
        reasons.push('同日同商户同金额重复扣费');
        severity = 'high';
      }
      if ((hour >= 0 && hour < 5) && abs >= 100_000) {
        reasons.push(`凌晨 ${String(hour).padStart(2, '0')} 点发生 ${Math.round(abs / 100)} 元以上交易`);
        severity = 'high';
      }
      if (abs >= 300_000) {
        reasons.push(`单笔 ${(abs / 100).toFixed(0)} 元，高于日常消费分布`);
      }
      return { ...t, reasons, severity };
    })
    .filter((t) => t.reasons.length > 0);
  return {
    ok: true,
    data: { anomalies, count: anomalies.length },
    evidence: anomalies.map((a) => a.id),
    summary: `发现 ${anomalies.length} 笔可疑交易`,
  };
};

export const sandboxAnalyzeTool: ToolHandler = async (ctx): Promise<ToolResult> => {
  const fetch = ctx.resultOf(ctx.node.deps[0]!);
  if (!fetch?.ok) return { ok: false, error: { code: 'UPSTREAM_FAILED', message: '流水读取失败' } };
  const txns = fetch.data.txns as any[];
  // 没有指定分类时，从当前数据集中选择支出最高的分类，而不是写死样例品类。
  const requestedCategory = (ctx.node.args as any).category;
  const byCategory = new Map<string, number>();
  for (const txn of txns) {
    if (txn.amountCents >= 0) continue;
    byCategory.set(
      txn.category,
      (byCategory.get(txn.category) ?? 0) + Math.abs(txn.amountCents),
    );
  }
  const topCategory = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const category = String(requestedCategory ?? topCategory ?? '其他');
  const code = buildCategoryInsightCode(category);
  const result = await runInSandbox(code, {
    txns: txns.map((t) => ({
      category: t.category,
      merchant: t.merchant,
      amountCents: t.amountCents,
      ts: t.ts,
    })),
  });
  if (!result.ok) {
    return {
      ok: false,
      error: { code: 'SANDBOX_FAILED', message: result.error ?? '沙箱执行失败' },
      data: { engine: result.engine, durationMs: result.durationMs },
    };
  }
  return {
    ok: true,
    data: {
      insight: result.result,
      engine: result.engine,
      durationMs: result.durationMs,
      code,
      category,
    },
    summary: `沙箱完成「${category}」统计`,
  };
};

export function billsCtxHelpers(ctx: ToolContext) {
  return {
    fetch: ctx.resultOf(ctx.node.deps[0]!),
  };
}
