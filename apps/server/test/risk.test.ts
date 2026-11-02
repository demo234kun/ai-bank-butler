import { describe, expect, it } from 'vitest';
import type { DagNode } from '@bank/shared';
import {
  RISK_QUESTIONS,
  levelFromRiskScore,
  maxProductRiskForLevel,
  productRiskRank,
  riskAssessmentExpired,
  scoreRiskAssessment,
} from '@bank/shared';
import { createSeededState } from '../src/core/seed';
import { clock } from '../src/core/clock';
import { matchProductsTool, purchaseWealthTool, assessRiskTool } from '../src/tools/wealth';
import type { ToolContext } from '../src/tools/types';

function ctxFor(
  state: ReturnType<typeof createSeededState>,
  tool: string,
  args: Record<string, unknown>,
): ToolContext {
  const node = {
    id: 'n1',
    tool,
    label: tool,
    intent: 'wealth',
    risk: 'GREEN',
    deps: [],
    args,
  } as unknown as DagNode;
  return {
    state,
    userId: 'u_risk_test',
    idempotencyKey: `idem_${tool}`,
    sessionId: 'ses_test',
    runId: 'run_test',
    node,
    resultOf: () => undefined,
  };
}

const riskAnswers = (pick: 'max' | 'min') =>
  Object.fromEntries(
    RISK_QUESTIONS.map((q) => [
      q.id,
      q.options.reduce(
        (best, option, index) =>
          pick === 'max'
            ? option.score > q.options[best]!.score
              ? index
              : best
            : option.score < q.options[best]!.score
              ? index
              : best,
        0,
      ),
    ]),
  );

describe('风险测评评分', () => {
  it('问卷满分 100 分映射到进取型，最低分映射到保守型', () => {
    const high = scoreRiskAssessment(riskAnswers('max'));
    const low = scoreRiskAssessment(riskAnswers('min'));
    expect(high.score).toBe(100);
    expect(high.level).toBe('进取型');
    expect(low.score).toBeLessThanOrEqual(39);
    expect(low.level).toBe('保守型');
    expect(levelFromRiskScore(39)).toBe('保守型');
    expect(levelFromRiskScore(40)).toBe('稳健型');
    expect(levelFromRiskScore(69)).toBe('平衡型');
    expect(levelFromRiskScore(70)).toBe('成长型');
    expect(levelFromRiskScore(84)).toBe('成长型');
    expect(levelFromRiskScore(85)).toBe('进取型');
  });

  it('缺答或越界答案直接拒绝，不做默认推断', () => {
    const partial: Record<string, number> = { age: 1, experience: 2 };
    expect(() => scoreRiskAssessment(partial)).toThrow(/RISK_ANSWER_INVALID:income/);
    expect(() =>
      scoreRiskAssessment({ ...partial, experience: 9, income: 1, tolerance: 1, horizon: 1 }),
    ).toThrow(/RISK_ANSWER_INVALID:experience/);
  });

  it('适当性上限与产品等级排序一致', () => {
    expect(maxProductRiskForLevel('保守型')).toBe('R1');
    expect(maxProductRiskForLevel('稳健型')).toBe('R2');
    expect(maxProductRiskForLevel('平衡型')).toBe('R3');
    expect(maxProductRiskForLevel('成长型')).toBe('R4');
    expect(maxProductRiskForLevel('进取型')).toBe('R5');
    expect(productRiskRank('R3')).toBe(3);
  });

  it('超过有效期即判定需重测', () => {
    const now = '2026-11-01T00:00:00+08:00';
    expect(riskAssessmentExpired('2026-06-18T10:30:00+08:00', now)).toBe(false);
    expect(riskAssessmentExpired('2024-06-18T10:30:00+08:00', now)).toBe(true);
    expect(riskAssessmentExpired(undefined, now)).toBe(true);
    expect(riskAssessmentExpired('不是时间', now)).toBe(true);
  });
});

describe('理财适当性校验', () => {
  const baseState = () => createSeededState({ riskLevel: '稳健型' });

  it('稳健型只推荐 R1–R2，超等级产品被排除并说明原因', async () => {
    const state = baseState();
    const result = await matchProductsTool(ctxFor(state, 'match_products', {}));
    expect(result.ok).toBe(true);
    expect(result.data?.maxProductRisk).toBe('R2');
    const levels = (result.data?.recommendations ?? []).map((r: any) => r.product.riskLevel);
    expect(levels.every((level: string) => Number(level.slice(1)) <= 2)).toBe(true);
    const excluded = (result.data?.excludedBySuitability ?? []).map((p: any) => p.riskLevel);
    expect(excluded).toContain('R3');
    expect(excluded).toContain('R4');
  });

  it('显式指定超适当性产品时申购被拒绝', async () => {
    const state = baseState();
    const result = await purchaseWealthTool(
      ctxFor(state, 'purchase_wealth', { amountCents: 100_000, productName: '臻选均衡混合' }),
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('RISK_SUITABILITY_REQUIRED');
    expect(result.error?.message).toContain('R2');
  });

  it('测评过期后申购一律拦下，先要求重测', async () => {
    const state = baseState();
    state.user.riskProfile = {
      ...state.user.riskProfile,
      assessedAt: '2020-01-01T10:00:00+08:00',
    };
    const purchase = await purchaseWealthTool(
      ctxFor(state, 'purchase_wealth', { amountCents: 100_000, productId: 'p_cash' }),
    );
    expect(purchase.ok).toBe(false);
    expect(purchase.error?.code).toBe('RISK_ASSESSMENT_EXPIRED');
    const match = await matchProductsTool(ctxFor(state, 'match_products', {}));
    expect(match.error?.code).toBe('RISK_ASSESSMENT_EXPIRED');
  });

  it('重测为进取型后可覆盖全部在售产品', async () => {
    const state = createSeededState({ riskLevel: '进取型' });
    state.user.riskProfile = {
      level: '进取型',
      score: scoreRiskAssessment(riskAnswers('max')).score,
      assessedAt: clock.nowIso(),
    };
    const result = await matchProductsTool(ctxFor(state, 'match_products', {}));
    expect(result.ok).toBe(true);
    expect(result.data?.maxProductRisk).toBe('R5');
    expect(result.data?.excludedBySuitability).toHaveLength(0);
    const assessed = await assessRiskTool(ctxFor(state, 'assess_risk', {}));
    expect(assessed.data?.expired).toBe(false);
    expect(assessed.data?.maxProductRisk).toBe('R5');
  });

  it('默认测评等级下仍可购买范围内的产品', async () => {
    const state = baseState();
    const assessed = await assessRiskTool(ctxFor(state, 'assess_risk', {}));
    expect(assessed.ok).toBe(true);
    expect(assessed.data?.maxProductRisk).toBe('R2');
    expect(assessed.summary).toContain('稳健型');
  });
});
