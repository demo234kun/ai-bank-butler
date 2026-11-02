import { formatMoney, type ToolResult } from '@bank/shared';
import { banking } from '../integration/banking';
import {
  productAllowed,
  productWithUserFit,
  resolveHolding,
  resolveProduct,
  suitabilityError,
  suitabilityFor,
  toToolError,
} from './helpers';
import type { ToolHandler } from './types';

export const assessRiskTool: ToolHandler = (ctx): ToolResult => {
  const suitability = suitabilityFor(ctx.state);
  return {
    ok: true,
    data: {
      profile: ctx.state.user.riskProfile,
      maxProductRisk: suitability.maxProductRisk,
      expired: suitability.expired,
    },
    summary: suitability.expired
      ? `风险测评已过期：上次结果为 ${suitability.level}（${suitability.score} 分），需在「我的 · 风险测评」重做`
      : `现有风险测评：${suitability.level}（${suitability.score} 分），可购买至 ${suitability.maxProductRisk}`,
  };
};

export const listProductsTool: ToolHandler = (ctx): ToolResult => {
  const suitability = suitabilityFor(ctx.state);
  return {
    ok: true,
    data: {
      products: ctx.state.products.map((product) => ({
        ...product,
        suitable: productAllowed(suitability, product),
      })),
      maxProductRisk: suitability.maxProductRisk,
    },
    summary: `在售理财产品 ${ctx.state.products.length} 款`,
  };
};

export const matchProductsTool: ToolHandler = (ctx): ToolResult => {
  const args = ctx.node.args as any;
  const suitability = suitabilityFor(ctx.state);
  const userLevel = suitability.level;
  const amountCents = Number(args.amountCents ?? 0);
  let candidates = ctx.state.products;
  if (args.productName) {
    const named = resolveProduct(ctx.state, { productName: args.productName });
    if (named) candidates = [named];
  }
  if (args.riskLevel) candidates = candidates.filter((p) => p.riskLevel === args.riskLevel);
  if (amountCents > 0) {
    const affordable = candidates.filter((p) => p.minAmountCents <= amountCents);
    if (affordable.length) candidates = affordable;
  }
  // 适当性硬过滤：超出测评等级或测评过期的产品不进入推荐
  const eligible = candidates.filter((product) => productAllowed(suitability, product));
  const blocked = candidates.filter((product) => !productAllowed(suitability, product));
  const scored = eligible
    .map((product) => {
      const fit = productWithUserFit(product, userLevel);
      const configured = args.riskLevel
        ? Number(args.riskLevel.slice(1)) - Number(product.riskLevel.slice(1))
        : 0;
      const score = Math.max(
        20,
        Math.min(99, fit + (args.riskLevel && configured === 0 ? 12 : 0) - Math.abs(configured) * 8),
      );
      return {
        product,
        fit,
        score,
        estimatedAnnualCents:
          amountCents > 0
            ? Math.round((amountCents * product.yieldPct) / 100)
            : Math.round((product.minAmountCents * product.yieldPct) / 100),
      };
    })
    .sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 3);
  if (!top.length) {
    if (suitability.expired) {
      return {
        ok: false,
        error: {
          code: 'RISK_ASSESSMENT_EXPIRED',
          message: '风险测评已超过有效期，请先在「我的 · 风险测评」完成测评',
        },
      };
    }
    if (blocked.length) {
      return {
        ok: false,
        error: {
          code: 'NO_SUITABLE_PRODUCT',
          message: `候选 ${blocked.length} 款产品超出您的适当性等级（最高可购 ${suitability.maxProductRisk}），没有可推荐的产品`,
        },
      };
    }
    return { ok: false, error: { code: 'NO_MATCHING_PRODUCT', message: '没有匹配的理财产品' } };
  }
  const selected = top[0]!;
  const rationale = args.riskLevel
    ? `您指定 ${args.riskLevel} 风险等级，在适当性范围内优先匹配「${selected.product.name}」`
    : `结合您的${userLevel}测评结果（${suitability.score} 分），适当性范围内「${selected.product.name}」的 ${selected.product.riskLevel} 风险与收益最匹配`;
  return {
    ok: true,
    data: {
      recommendations: top,
      selected: selected.product,
      rationale,
      userRiskLevel: userLevel,
      maxProductRisk: suitability.maxProductRisk,
      excludedBySuitability: blocked.map((product) => ({
        id: product.id,
        name: product.name,
        riskLevel: product.riskLevel,
      })),
      amountCents: amountCents || undefined,
    },
    evidence: top.map((t) => t.product.id),
    summary: `匹配到 ${top.length} 款产品，首选 ${selected.product.name}`,
  };
};

export const purchaseWealthTool: ToolHandler = async (ctx): Promise<ToolResult> => {
  const args = ctx.node.args as any;
  const amountCents = Number(args.amountCents ?? 0);
  if (!amountCents || amountCents <= 0) {
    return { ok: false, error: { code: 'MISSING_AMOUNT', message: '请补充申购金额' } };
  }
  const suitability = suitabilityFor(ctx.state);
  if (suitability.expired) {
    return { ok: false, error: suitabilityError(suitability) };
  }
  let product = resolveProduct(ctx.state, {
    productId: args.productId,
    productName: args.productName,
    riskLevel: args.riskLevel,
  });
  if (!product) {
    product = ctx.state.products
      .filter(
        (p) =>
          p.minAmountCents <= amountCents && productAllowed(suitability, p),
      )
      .sort((a, b) => productWithUserFit(b, suitability.level) - productWithUserFit(a, suitability.level))[0];
  }
  if (!product) {
    return { ok: false, error: { code: 'PRODUCT_NOT_FOUND', message: '未找到匹配的理财产品' } };
  }
  if (!productAllowed(suitability, product)) {
    return {
      ok: false,
      error: suitabilityError(suitability),
    };
  }
  try {
    const result = await banking.purchaseWealth(
      ctx.userId,
      {
        product,
        amountCents,
        fromAccountId: args.fromAccountId,
      },
      ctx.idempotencyKey,
    );
    const expectedAnnualCents = Math.round((amountCents * product.yieldPct) / 100);
    return {
      ok: true,
      data: {
        product,
        holding: result.holding,
        txn: result.txn,
        amountCents,
        expectedAnnualCents,
        fit: productWithUserFit(product, suitability.level),
        suitability: {
          level: suitability.level,
          score: suitability.score,
          maxProductRisk: suitability.maxProductRisk,
          productRiskLevel: product.riskLevel,
        },
        account: {
          id: result.account.id,
          name: result.account.name,
          last4: result.account.last4,
          balanceCents: result.account.balanceCents,
        },
        executedAt: result.txn.ts,
      },
      evidence: [result.txn.id, result.holding.id],
      summary: `申购 ${product.name} ${formatMoney(amountCents)}`,
    };
  } catch (error) {
    return { ok: false, error: toToolError(error, 'PURCHASE_FAILED', '理财申购失败') };
  }
};

export const redeemWealthTool: ToolHandler = async (ctx): Promise<ToolResult> => {
  const args = ctx.node.args as any;
  const { holding, product } = resolveHolding(ctx.state, {
    productId: args.productId,
    productName: args.productName,
  });
  if (!holding || !product) {
    return { ok: false, error: { code: 'HOLDING_NOT_FOUND', message: '未找到可赎回的持仓' } };
  }
  const amountCents = Math.min(
    Number(args.amountCents ?? holding.amountCents),
    holding.amountCents,
  );
  try {
    const result = await banking.redeemWealth(
      ctx.userId,
      {
        holding,
        product,
        amountCents,
        toAccountId: args.toAccountId,
      },
      ctx.idempotencyKey,
    );
    return {
      ok: true,
      data: {
        product,
        holding: result.holding,
        txn: result.txn,
        amountCents,
        account: {
          id: result.account.id,
          name: result.account.name,
          last4: result.account.last4,
          balanceCents: result.account.balanceCents,
        },
        executedAt: result.txn.ts,
      },
      evidence: [result.txn.id],
      summary: `赎回 ${product.name} ${formatMoney(amountCents)}`,
    };
  } catch (error) {
    return { ok: false, error: toToolError(error, 'REDEEM_FAILED', '理财赎回失败') };
  }
};
