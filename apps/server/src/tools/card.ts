import { formatMoney, type ToolResult } from '@bank/shared';
import { banking } from '../integration/banking';
import { defaultCard, toToolError } from './helpers';
import type { ToolHandler } from './types';

export const listCardsTool: ToolHandler = (ctx): ToolResult => {
  const items = ctx.state.cards.map((card) => {
    const account = ctx.state.accounts.find((a) => a.id === card.accountId);
    return {
      ...card,
      accountName: account?.name,
      accountBalanceCents: account?.balanceCents,
      availableCents:
        card.type === 'credit'
          ? Math.max(0, (card.limitCents ?? 0) - (card.usedCents ?? 0))
          : account?.balanceCents,
    };
  });
  return {
    ok: true,
    data: { items },
    summary: `名下共有 ${items.length} 张卡片`,
  };
};

export const applyVirtualCardTool: ToolHandler = async (ctx): Promise<ToolResult> => {
  const args = ctx.node.args as any;
  const limitCents = Number(args.limitCents ?? 300_000);
  try {
    const card = await banking.applyVirtualCard(
      ctx.userId,
      { limitCents },
      ctx.idempotencyKey,
    );
    return {
      ok: true,
      data: { card, limitCents },
      evidence: [card.id],
      summary: `虚拟卡申请成功，尾号 ${card.last4}，额度 ${formatMoney(limitCents)}`,
    };
  } catch (error) {
    return { ok: false, error: toToolError(error, 'CARD_APPLY_FAILED', '虚拟卡申请失败') };
  }
};

export const adjustCardLimitTool: ToolHandler = async (ctx): Promise<ToolResult> => {
  const args = ctx.node.args as any;
  const card = defaultCard(ctx.state, args.last4);
  if (!card) return { ok: false, error: { code: 'CARD_NOT_FOUND', message: '未找到可调额的卡片' } };
  const limitCents = Number(args.limitCents ?? 0);
  if (!limitCents || limitCents <= 0) {
    return { ok: false, error: { code: 'MISSING_AMOUNT', message: '请补充目标额度' } };
  }
  try {
    const result = await banking.adjustCardLimit(
      ctx.userId,
      { cardId: card.id, limitCents },
      ctx.idempotencyKey,
    );
    return {
      ok: true,
      data: {
        card: result.card,
        previousLimitCents: result.previousLimitCents,
        limitCents,
      },
      evidence: [result.card.id],
      summary: `卡片尾号 ${result.card.last4} 额度调整为 ${formatMoney(limitCents)}`,
    };
  } catch (error) {
    return { ok: false, error: toToolError(error, 'LIMIT_ADJUST_FAILED', '调整卡片额度失败') };
  }
};

function statusTool(action: 'freeze' | 'unfreeze' | 'report_loss'): ToolHandler {
  return async (ctx): Promise<ToolResult> => {
    const args = ctx.node.args as any;
    const card = defaultCard(ctx.state, args.last4);
    if (!card) return { ok: false, error: { code: 'CARD_NOT_FOUND', message: '未找到目标卡片' } };
    const nextStatus =
      action === 'freeze' ? 'frozen' : action === 'unfreeze' ? 'active' : 'lost';
    if (action === 'report_loss' && card.status === 'lost') {
      return { ok: false, error: { code: 'ALREADY_LOST', message: '该卡片已是挂失状态' } };
    }
    try {
      const result = await banking.setCardStatus(
        ctx.userId,
        { cardId: card.id, status: nextStatus },
        ctx.idempotencyKey,
      );
      const label =
        action === 'freeze' ? '临时冻结' : action === 'unfreeze' ? '解除冻结' : '挂失';
      return {
        ok: true,
        data: {
          action,
          card: result.card,
          previousStatus: result.previousStatus,
          label,
        },
        evidence: [result.card.id],
        summary: `卡片尾号 ${result.card.last4} 已${label}`,
      };
    } catch (error) {
      return { ok: false, error: toToolError(error, 'CARD_STATUS_FAILED', '卡片状态变更失败') };
    }
  };
}

export const freezeCardTool = statusTool('freeze');
export const unfreezeCardTool = statusTool('unfreeze');
export const reportLossTool = statusTool('report_loss');
