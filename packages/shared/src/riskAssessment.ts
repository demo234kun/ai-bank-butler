import type { UserProfile } from './types';

export interface RiskQuestionOption {
  label: string;
  score: number;
}

export interface RiskQuestion {
  id: string;
  label: string;
  options: RiskQuestionOption[];
}

export const RISK_QUESTIONS: RiskQuestion[] = [
  {
    id: 'age',
    label: '你的年龄段',
    options: [
      { label: '18–25 岁', score: 20 },
      { label: '26–40 岁', score: 16 },
      { label: '41–55 岁', score: 12 },
      { label: '56–65 岁', score: 7 },
      { label: '65 岁以上', score: 3 },
    ],
  },
  {
    id: 'experience',
    label: '投资理财经验',
    options: [
      { label: '几乎没有', score: 3 },
      { label: '买过存款 / 低风险理财', score: 8 },
      { label: '熟悉基金 / 债券', score: 14 },
      { label: '熟悉股票 / 期货', score: 20 },
    ],
  },
  {
    id: 'income',
    label: '家庭年收入与可投资资产',
    options: [
      { label: '可投资资产不足 10 万元', score: 4 },
      { label: '10–50 万元', score: 9 },
      { label: '50–200 万元', score: 14 },
      { label: '200 万元以上', score: 20 },
    ],
  },
  {
    id: 'tolerance',
    label: '如果一年内本金亏损，你能接受的最大回撤',
    options: [
      { label: '不能接受亏损', score: 2 },
      { label: '5% 以内', score: 7 },
      { label: '15% 以内', score: 13 },
      { label: '30% 以内', score: 18 },
      { label: '30% 以上', score: 20 },
    ],
  },
  {
    id: 'horizon',
    label: '这笔钱计划投资多久',
    options: [
      { label: '随时可能使用', score: 2 },
      { label: '3 个月以内', score: 6 },
      { label: '3–12 个月', score: 11 },
      { label: '1–3 年', score: 16 },
      { label: '3 年以上', score: 20 },
    ],
  },
];

export function levelFromRiskScore(score: number): UserProfile['riskProfile']['level'] {
  if (score <= 39) return '保守型';
  if (score <= 54) return '稳健型';
  if (score <= 69) return '平衡型';
  if (score <= 84) return '成长型';
  return '进取型';
}

/**
 * answers: 题目 id -> 选项下标（由前端/接口传入，避免用分值本身做 key 产生歧义）。
 */
export function scoreRiskAssessment(answers: Record<string, number | string>): {
  score: number;
  level: UserProfile['riskProfile']['level'];
  answers: Record<string, { label: string; score: number }>;
} {
  let score = 0;
  const picked: Record<string, { label: string; score: number }> = {};
  for (const question of RISK_QUESTIONS) {
    const raw = answers?.[question.id];
    const index = Number(raw);
    if (!Number.isInteger(index) || index < 0 || index >= question.options.length) {
      throw new Error(`RISK_ANSWER_INVALID:${question.id}`);
    }
    const option = question.options[index]!;
    score += option.score;
    picked[question.id] = { label: option.label, score: option.score };
  }
  return { score, level: levelFromRiskScore(score), answers: picked };
}

export type ProductRiskLevel = 'R1' | 'R2' | 'R3' | 'R4' | 'R5';

export function maxProductRiskForLevel(
  level: UserProfile['riskProfile']['level'],
): ProductRiskLevel {
  if (level === '保守型') return 'R1';
  if (level === '稳健型') return 'R2';
  if (level === '平衡型') return 'R3';
  if (level === '成长型') return 'R4';
  return 'R5';
}

export function productRiskRank(level: ProductRiskLevel): number {
  return Number(level.replace('R', '')) || 1;
}

/** 测评结果有效期：监管实践中一般按年度重评 */
export const RISK_ASSESSMENT_VALID_DAYS = 365;

export function riskAssessmentExpired(
  assessedAt: string | undefined,
  nowIso: string,
  validDays = RISK_ASSESSMENT_VALID_DAYS,
): boolean {
  if (!assessedAt) return true;
  const assessed = new Date(assessedAt).getTime();
  if (!Number.isFinite(assessed)) return true;
  return assessed + validDays * 86_400_000 < new Date(nowIso).getTime();
}

export function isProductSuitable(
  profile: UserProfile['riskProfile'],
  productRiskLevel: ProductRiskLevel,
  nowIso: string,
): boolean {
  if (riskAssessmentExpired(profile.assessedAt, nowIso)) return false;
  return (
    productRiskRank(productRiskLevel) <= productRiskRank(maxProductRiskForLevel(profile.level))
  );
}

export interface RiskAssessmentView {
  questions: RiskQuestion[];
  profile: UserProfile['riskProfile'];
  maxProductRisk: ProductRiskLevel;
  expired: boolean;
  validDays: number;
  businessNow: string;
}

