import { formatMoney, type ToolResult } from '@bank/shared';
import { clock } from '../core/clock';
import { banking } from '../integration/banking';
import { getLimitSummary } from '../policy/limits';
import { defaultCard, resolveContact, toToolError } from './helpers';
import type { ToolHandler } from './types';

export const resolveContactTool: ToolHandler = (ctx): ToolResult => {
  const args = ctx.node.args as any;
  const { contact, matches } = resolveContact(ctx.state, {
    contactId: args.contactId,
    name: args.name,
    phone: args.phone,
  });
  if (contact) {
    return {
      ok: true,
      data: { contact },
      evidence: [contact.id],
      summary: `匹配联系人 ${contact.name} · ${contact.bank} 尾号 ${contact.last4}`,
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      error: { code: 'CONTACT_AMBIGUOUS', message: '存在多个同名联系人' },
      data: { options: matches.map((m) => ({ label: `${m.name} · ${m.bank} 尾号 ${m.last4}`, value: m.id })) },
    };
  }
  return { ok: false, error: { code: 'CONTACT_NOT_FOUND', message: '未找到联系人，请先补充完整姓名或手机号' } };
};

export const checkLimitTool: ToolHandler = (ctx): ToolResult => {
  const amountCents = Number((ctx.node.args as any).amountCents ?? 0);
  const limit = getLimitSummary(ctx.state);
  return {
    ok: true,
    data: { limit, requestedCents: amountCents },
    summary: `当日小额额度剩余 ${formatMoney(limit.remainingCents)}`,
  };
};

export const transferTool: ToolHandler = async (ctx): Promise<ToolResult> => {
  const args = ctx.node.args as any;
  try {
    const result = await banking.transfer(
      ctx.userId,
      {
        fromAccountId: args.fromAccountId,
        recipients: args.recipients,
        note: args.note,
      },
      ctx.idempotencyKey,
    );
    const card = defaultCard(ctx.state, result.account.last4);
    return {
      ok: true,
      data: {
        txns: result.txns,
        totalCents: result.totalCents,
        recipients: result.recipients,
        account: {
          id: result.account.id,
          name: result.account.name,
          bank: result.account.bank,
          last4: result.account.last4,
          balanceCents: result.account.balanceCents,
          availableCents: result.account.balanceCents - result.account.lockedCents,
        },
        cardLast4: card?.last4,
        executedAt: clock.nowIso(),
        note: args.note,
      },
      evidence: result.txns.map((t) => t.id),
      summary: `转账 ${result.txns.length} 笔，共 ${formatMoney(result.totalCents)}`,
    };
  } catch (error) {
    return { ok: false, error: toToolError(error, 'TRANSFER_FAILED', '转账提交失败') };
  }
};

export const scheduleTransferTool: ToolHandler = async (ctx): Promise<ToolResult> => {
  const args = ctx.node.args as any;
  try {
    const amountCents = Number(args.amountCents ?? 0);
    const item = await banking.createSchedule(
      ctx.userId,
      {
        kind: 'transfer',
        title: `定时转账 · ${args.payee}`,
        amountCents,
        executeAt: args.executeAt,
        detail: args.note ?? '由 AI 管家创建，执行前再次校验额度',
        // 本节点是黄色/红色操作，走到这里说明用户已在确认单上授权这笔钱
        payload: {
          recipients: [
            {
              name: String(args.payee ?? '联系人'),
              amountCents,
              contactId: args.contactId ? String(args.contactId) : undefined,
            },
          ],
          fromAccountId: args.fromAccountId,
          note: args.note,
          authorized: true,
          authorizationRef: `${ctx.runId}:${ctx.node.id}`,
        },
      },
      ctx.idempotencyKey,
    );
    return {
      ok: true,
      data: { schedule: item, payee: args.payee, amountCents: args.amountCents },
      evidence: [item.id],
      summary: `已创建定时转账 ${formatMoney(args.amountCents)}，执行时间 ${args.executeAt}`,
    };
  } catch (error) {
    return { ok: false, error: toToolError(error, 'SCHEDULE_FAILED', '创建定时转账失败') };
  }
};

export const splitRequestTool: ToolHandler = async (ctx): Promise<ToolResult> => {
  const args = ctx.node.args as any;
  const totalCents = Number(args.totalCents ?? 0);
  const names: string[] = Array.isArray(args.names) ? args.names : [];
  if (!names.length) {
    return { ok: false, error: { code: 'MISSING_RECIPIENTS', message: '请告诉我要向哪些人发起 AA 收款' } };
  }
  try {
    const result = await banking.createSplitRequest(
      ctx.userId,
      { totalCents, names, note: args.note },
      ctx.idempotencyKey,
    );
    return {
      ok: true,
      data: {
        requestId: result.requestId,
        totalCents: result.totalCents,
        myShareCents: result.myShareCents,
        shares: result.shares,
        createdAt: result.createdAt,
        note: result.note,
      },
      evidence: [result.requestId],
      summary: `已向 ${names.join('、')} 发起 AA 收款，共 ${formatMoney(result.totalCents - result.myShareCents)}`,
    };
  } catch (error) {
    return { ok: false, error: toToolError(error, 'SPLIT_REQUEST_FAILED', '发起 AA 收款失败') };
  }
};
