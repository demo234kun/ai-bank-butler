/**
 * 安全分级模型：五档权限 + 风控智能体评分。
 *
 * 设计要点：
 * 1. 大额交易不再"一刀切禁止"。超过阈值进入 T4 人工审核队列（延迟到账、可撤销），
 *    只有超出产品额度上限的交易才 DENY，并提示走柜面/提额流程。
 * 2. 权限档位由两个来源共同决定：金额与操作类型（静态档）+ 风控智能体评分（动态档），
 *    取较高档，风控只能升档不能降档。
 * 3. T2 起要求手输收款人姓名（payee echo），T3 起叠加多因子，T4 转人工审核。
 */

export type RiskTier = 'T0' | 'T1' | 'T2' | 'T3' | 'T4';

export type SecurityControl =
  | 'AUTO'
  | 'SUMMARY_CONFIRM'
  | 'PAYEE_ECHO'
  | 'STEPUP_MFA'
  | 'MANUAL_REVIEW';

export interface TierMeta {
  label: string;
  name: string;
  controls: SecurityControl[];
  strategy: string;
  color: string;
}

export const TIER_META: Record<RiskTier, TierMeta> = {
  T0: {
    label: 'T0 · 自动执行',
    name: '免打扰',
    controls: ['AUTO'],
    strategy: '只读查询与不动资金的分析，确认意图后直接执行',
    color: '#2F7D5B',
  },
  T1: {
    label: 'T1 · 摘要确认',
    name: '轻确认',
    controls: ['SUMMARY_CONFIRM'],
    strategy: '小额或可逆操作，展示参数摘要，一次确认即执行',
    color: '#7A9B3B',
  },
  T2: {
    label: 'T2 · 收款人复述',
    name: '强确认',
    controls: ['SUMMARY_CONFIRM', 'PAYEE_ECHO'],
    strategy: '手输收款人姓名通过后才执行，防止改名联系人、注入话术与误操作',
    color: '#C9791F',
  },
  T3: {
    label: 'T3 · 多因子',
    name: '强验证',
    controls: ['SUMMARY_CONFIRM', 'PAYEE_ECHO', 'STEPUP_MFA'],
    strategy: '在收款人复述之上叠加生物识别 / 活体 / 短信，大额需两项',
    color: '#B3392E',
  },
  T4: {
    label: 'T4 · 人工审核',
    name: '延迟放行',
    controls: ['SUMMARY_CONFIRM', 'PAYEE_ECHO', 'STEPUP_MFA', 'MANUAL_REVIEW'],
    strategy: '交易进入人工审核队列并延迟到账，审核期内用户可撤销；审核通过后按 T3 通道执行',
    color: '#7A2C4E',
  },
};

export const TIER_ORDER: RiskTier[] = ['T0', 'T1', 'T2', 'T3', 'T4'];

/** 金额档位（分）。T1/T2/T3/T4 之间按单笔金额与当日累计取较高档。 */
export const TIER_THRESHOLDS_CENTS = {
  /** 单笔不超过该值且当日累计未越线 → T1 */
  t1Max: 100_000,
  /** 单笔不超过该值 → T2，超过则 T3 */
  t2Max: 500_000,
  /** 单笔不超过该值 → T3，超过则进入 T4 人工审核 */
  t3Max: 5_000_000,
  /** 产品额度绝对上限：单笔超过直接拒绝，需走柜面或提额流程 */
  singleCeiling: 20_000_000,
  /** 产品额度绝对上限：当日累计超过直接拒绝 */
  dailyCeiling: 50_000_000,
} as const;

/** T4 交易的延迟审核窗口：期内用户可撤销，超时未审核自动退回。 */
export const MANUAL_REVIEW_WINDOW_MS = 10 * 60_000;

export type RiskSignalCode =
  | 'AMOUNT_RATIO'
  | 'BEHAVIOR_BASELINE'
  | 'NEW_PAYEE'
  | 'NIGHT_HOURS'
  | 'VELOCITY'
  | 'STRUCTURING'
  | 'SESSION_RISK'
  | 'INJECTION_SUSPICION'
  | 'LOW_CONFIDENCE'
  | 'BLOCKLIST_PAYEE'
  | 'FRAUD_KEYWORD'
  | 'PAYEE_JUST_CHANGED'
  | 'NEW_DEVICE'
  | 'DAILY_CEILING_NEAR';

export const RISK_SIGNAL_TEXT: Record<RiskSignalCode, string> = {
  AMOUNT_RATIO: '金额占可用资金比例偏高',
  BEHAVIOR_BASELINE: '明显高于近期消费基线',
  NEW_PAYEE: '首次收款人',
  NIGHT_HOURS: '深夜时段交易',
  VELOCITY: '短时间连续交易',
  STRUCTURING: '疑似拆分规避限额',
  SESSION_RISK: '会话风险状态异常',
  INJECTION_SUSPICION: '对话中出现诱导绕过安全校验的痕迹',
  LOW_CONFIDENCE: '意图解析置信度偏低',
  BLOCKLIST_PAYEE: '收款人在风险名单内',
  FRAUD_KEYWORD: '备注含典型诈骗话术关键词',
  PAYEE_JUST_CHANGED: '收款人在本次会话中刚被改动',
  NEW_DEVICE: '新设备或新浏览器会话',
  DAILY_CEILING_NEAR: '接近当日额度上限',
};

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface RiskSignal {
  code: RiskSignalCode;
  weight: number;
  detail: string;
}

export interface RiskVerdict {
  /** 0–100，越高越危险 */
  score: number;
  level: RiskLevel;
  /** 风控智能体建议的最低档位 */
  tier: RiskTier;
  signals: RiskSignal[];
  evaluatedAt: string;
  /** 评分来源：规则引擎 + 行为基线统计；模型不参与打分 */
  engine: 'risk-agent-v1';
  /** 命中即不可自动放行 */
  requiresReview: boolean;
}

export function riskLevelFromScore(score: number): RiskLevel {
  if (score >= 85) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
}

export function tierFromRiskScore(score: number): RiskTier {
  if (score >= 85) return 'T4';
  if (score >= 60) return 'T3';
  if (score >= 35) return 'T2';
  return 'T1';
}

export function tierFromAmount(amountCents: number): RiskTier {
  if (amountCents > TIER_THRESHOLDS_CENTS.t3Max) return 'T4';
  if (amountCents > TIER_THRESHOLDS_CENTS.t2Max) return 'T3';
  if (amountCents > TIER_THRESHOLDS_CENTS.t1Max) return 'T2';
  return 'T1';
}

export function higherTier(a: RiskTier, b: RiskTier): RiskTier {
  return TIER_ORDER.indexOf(a) >= TIER_ORDER.indexOf(b) ? a : b;
}

export function controlsFor(tier: RiskTier): SecurityControl[] {
  return TIER_META[tier].controls;
}

export function requiresPayeeEcho(tier: RiskTier): boolean {
  return controlsFor(tier).includes('PAYEE_ECHO');
}

export function requiresManualReview(tier: RiskTier): boolean {
  return controlsFor(tier).includes('MANUAL_REVIEW');
}

/** 档位 → 原有三档风险，保持界面、审计与授权链的向后兼容。 */
export function riskFromTier(tier: RiskTier): 'GREEN' | 'YELLOW' | 'RED' {
  if (tier === 'T0') return 'GREEN';
  // T2 是"强确认"：仍需用户确认，但多了手输收款人姓名；风险色仍为黄，避免与多因子档混淆
  if (tier === 'T1' || tier === 'T2') return 'YELLOW';
  return 'RED';
}

export const CONTROL_TEXT: Record<SecurityControl, string> = {
  AUTO: '自动执行',
  SUMMARY_CONFIRM: '参数摘要确认',
  PAYEE_ECHO: '手输收款人姓名',
  STEPUP_MFA: '多因子强验证',
  MANUAL_REVIEW: '人工审核（延迟到账）',
};
