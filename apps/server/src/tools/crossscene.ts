import { formatMoney, type ToolResult } from '@bank/shared';
import { clock } from '../core/clock';
import { addCalendarNote } from '../core/ledger';
import { persist } from '../core/store';
import { banking } from '../integration/banking';
import { nextBirthday, toToolError } from './helpers';
import type { ToolHandler } from './types';

export const resolveBirthdayTool: ToolHandler = (ctx): ToolResult => {
  const args = ctx.node.args as any;
  const spouse = ctx.state.user.spouse;
  const monthDay = args.birthdayDate ?? spouse.birthday.slice(5);
  const info = nextBirthday(monthDay);
  return {
    ok: true,
    data: {
      spouseName: spouse.name,
      birthday: monthDay,
      ...info,
      now: clock.nowIso(),
    },
    evidence: [spouse.name, monthDay],
    summary: `${spouse.name}的生日在 ${info.birthdayLabel}，距今 ${info.daysUntil} 天`,
  };
};

export const lockFundsTool: ToolHandler = async (ctx): Promise<ToolResult> => {
  const args = ctx.node.args as any;
  const account =
    ctx.state.accounts.find((a) => a.type === 'current') ??
    ctx.state.accounts.find((a) => a.primary) ??
    ctx.state.accounts[0];
  if (!account) {
    return { ok: false, error: { code: 'ACCOUNT_NOT_FOUND', message: '未找到可用账户' } };
  }
  const amountCents = Number(args.amountCents ?? 0);
  try {
    const result = await banking.lockFunds(
      ctx.userId,
      {
        accountId: account.id,
        amountCents,
        reason: args.reason ?? '生日预算锁定',
        releaseAt: args.releaseAt ?? clock.nowIso(),
      },
      ctx.idempotencyKey,
    );
    return {
      ok: true,
      data: {
        lock: result.lock,
        amountCents,
        account: {
          id: result.account.id,
          name: result.account.name,
          last4: result.account.last4,
          balanceCents: result.account.balanceCents,
          lockedCents: result.account.lockedCents,
        },
      },
      evidence: [result.lock.id],
      summary: `已锁定 ${formatMoney(amountCents)} 活期资金至生日后`,
    };
  } catch (error) {
    return { ok: false, error: toToolError(error, 'LOCK_FAILED', '锁定资金失败') };
  }
};

export const orderGiftTool: ToolHandler = async (ctx): Promise<ToolResult> => {
  const args = ctx.node.args as any;
  try {
    const result = await banking.orderGift(
      ctx.userId,
      {
        type: args.type,
        merchant: args.merchant,
        amountCents: Number(args.amountCents),
        deliveryAt: args.deliveryAt,
        note: args.note ?? '生日礼物',
        fromAccountId: args.fromAccountId,
      },
      ctx.idempotencyKey,
    );
    return {
      ok: true,
      data: {
        order: result.order,
        txn: result.txn,
        account: {
          id: result.account.id,
          name: result.account.name,
          last4: result.account.last4,
          balanceCents: result.account.balanceCents,
        },
      },
      evidence: [result.order.id, result.txn.id],
      summary: `已预约 ${result.order.merchant}，${formatMoney(result.order.amountCents)}，${args.deliveryAt.slice(0, 10)} 送达`,
    };
  } catch (error) {
    return { ok: false, error: toToolError(error, 'GIFT_ORDER_FAILED', '预约礼物失败') };
  }
};

export const createNoteTool: ToolHandler = (ctx): ToolResult => {
  const args = ctx.node.args as any;
  const item = addCalendarNote(
    ctx.state,
    args.title ?? '生日提醒',
    args.executeAt ?? clock.nowIso(),
    args.detail ?? '由 AI 管家创建',
  );
  persist();
  return {
    ok: true,
    data: { item },
    evidence: [item.id],
    summary: `已加入日程：${item.title}`,
  };
};
