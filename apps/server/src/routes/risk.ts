import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  RISK_ASSESSMENT_VALID_DAYS,
  RISK_QUESTIONS,
  isProductSuitable,
  maxProductRiskForLevel,
  riskAssessmentExpired,
  scoreRiskAssessment,
  type RiskAssessmentView,
} from '@bank/shared';
import { getState, updateRiskAssessment } from '../core/store';
import { clock } from '../core/clock';
import { audit } from '../security/auditChain';
import { toPublicAuth } from '../security/auth';

const answersSchema = z.record(z.union([z.number(), z.string()])).default({});

export async function riskRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/risk/assessment', async (request): Promise<RiskAssessmentView> => {
    const auth = request.authUser!;
    const bank = getState(auth.id);
    const profile = bank.user.riskProfile;
    return {
      questions: RISK_QUESTIONS,
      profile,
      maxProductRisk: maxProductRiskForLevel(profile.level),
      expired: riskAssessmentExpired(profile.assessedAt, clock.nowIso()),
      validDays: RISK_ASSESSMENT_VALID_DAYS,
      businessNow: clock.nowIso(),
    };
  });

  app.post('/api/risk/assessment', async (request, reply) => {
    const auth = request.authUser!;
    const parsed = answersSchema.safeParse((request.body as any)?.answers ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        code: 'INVALID_ASSESSMENT',
        message: '测评答案格式不正确',
      });
    }
    let result: ReturnType<typeof scoreRiskAssessment>;
    try {
      result = scoreRiskAssessment(parsed.data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'RISK_ANSWER_INVALID';
      const missing = message.split(':')[1];
      const question = RISK_QUESTIONS.find((item) => item.id === missing);
      return reply.code(400).send({
        ok: false,
        code: 'RISK_ANSWER_INVALID',
        message: question ? `请完成「${question.label}」后再提交` : '请完成全部测评题目',
      });
    }

    const before = getState(auth.id).user.riskProfile;
    const bundle = updateRiskAssessment(auth.id, {
      score: result.score,
      level: result.level,
      assessedAt: clock.nowIso(),
    });
    const profile = getState(auth.id).user.riskProfile;

    audit.append(
      'RISK_ASSESSED',
      `完成风险测评：${profile.level} ${profile.score} 分`,
      {
        score: profile.score,
        level: profile.level,
        previousLevel: before.level,
        previousScore: before.score,
        maxProductRisk: maxProductRiskForLevel(profile.level),
        answers: result.answers,
        clock: clock.isReal() ? 'real' : 'demo',
      },
      {},
    );

    return {
      ok: true,
      profile,
      maxProductRisk: maxProductRiskForLevel(profile.level),
      levelChanged: before.level !== profile.level,
      user: toPublicAuth(bundle.auth),
    };
  });

  /**
   * 适当性预检：产品列表 / 申购前调用，返回是否可购买及原因。
   * 只做读校验，不改变任何账务状态。
   */
  app.get('/api/risk/suitability/:riskLevel', async (request, reply) => {
    const auth = request.authUser!;
    const parsed = z.enum(['R1', 'R2', 'R3', 'R4', 'R5']).safeParse(
      (request.params as { riskLevel?: string }).riskLevel,
    );
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        code: 'INVALID_RISK_LEVEL',
        message: '产品风险等级需为 R1–R5',
      });
    }
    const bank = getState(auth.id);
    const profile = bank.user.riskProfile;
    const now = clock.nowIso();
    return {
      ok: true,
      productRiskLevel: parsed.data,
      suitable: isProductSuitable(profile, parsed.data, now),
      expired: riskAssessmentExpired(profile.assessedAt, now),
      profile,
      maxProductRisk: maxProductRiskForLevel(profile.level),
    };
  });
}
