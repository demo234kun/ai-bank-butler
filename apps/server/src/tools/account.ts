import type { ToolResult } from '@bank/shared';
import { availableCents } from '../core/state';
import { periodRange, periodTxns } from './helpers';
import type { ToolHandler } from './types';

export const getBalanceTool: ToolHandler = (ctx): ToolResult => {
  const accounts = ctx.state.accounts.map((a) => ({
    id: a.id,
    name: a.name,
    bank: a.bank,
    type: a.type,
    last4: a.last4,
    balanceCents: a.balanceCents,
    lockedCents: a.lockedCents,
    availableCents: availableCents(a),
    primary: a.primary,
    color: a.color,
  }));
  const assetAccounts = accounts.filter((a) => a.type !== 'credit');
  const totalCents = assetAccounts.reduce((sum, a) => sum + a.balanceCents, 0);
  const availableTotalCents = assetAccounts.reduce((sum, a) => sum + a.availableCents, 0);
  return {
    ok: true,
    data: { accounts, totalCents, availableTotalCents },
    summary: `名下 ${accounts.length} 个账户，总资产 ${(totalCents / 100).toFixed(2)} 元，可用 ${(availableTotalCents / 100).toFixed(2)} 元`,
  };
};

export const listTransactionsTool: ToolHandler = (ctx): ToolResult => {
  const args = ctx.node.args as any;
  const period = (args.period ?? 'currentMonth') as 'currentMonth' | 'lastMonth' | 'year';
  const range = periodRange(period);
  let txns = periodTxns(ctx.state, range);
  if (args.category) {
    txns = txns.filter((t) => String(t.category).includes(String(args.category)));
  }
  const limit = Math.min(Number(args.limit ?? 12), 30);
  const items = txns.slice(0, limit).map((t) => ({
    id: t.id,
    ts: t.ts,
    amountCents: t.amountCents,
    merchant: t.merchant,
    category: t.category,
    channel: t.channel,
  }));
  return {
    ok: true,
    data: { items, rangeLabel: range.label, total: txns.length, limited: txns.length > limit },
    evidence: items.map((t) => t.id),
    summary: `查询到 ${txns.length} 条流水`,
  };
};
