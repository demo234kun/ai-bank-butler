import type { Risk } from './types';

export const DAILY_TRANSFER_LIMIT_CENTS = 100_000; // 黄色额度上限：日累计 ≤ 1000 元
export const HIGH_VALUE_CENTS = 500_000; // 超过 5000 元需双因子
/** 产品额度绝对上限：单笔超过直接拒绝；5 万元不再是一刀切禁止，而是转人工审核。 */
export const HARD_BLOCK_CENTS = 20_000_000;
/** 当日累计绝对上限 */
export const DAILY_CEILING_CENTS = 50_000_000;
export const RESERVATION_TTL_MS = 120_000;
export const CONFIRM_TTL_MS = 90_000;
export const STEPUP_TTL_MS = 90_000;
export const STEPUP_MAX_ATTEMPTS = 3;
export const BREAKER_FAILURE_LIMIT = 3;
export const BREAKER_INJECTION_LIMIT = 2;
export const BREAKER_LOCK_MS = 10 * 60_000;

export const RISK_META: Record<Risk, { label: string; short: string; strategy: string; color: string; bg: string }> = {
  GREEN: {
    label: '绿色 · 自动执行',
    short: '绿',
    strategy: '纯查询类操作，确认意图后直接执行，无需二次确认',
    color: '#2F7D5B',
    bg: 'rgba(47,125,91,.10)',
  },
  YELLOW: {
    label: '黄色 · 用户确认',
    short: '黄',
    strategy: '执行前展示操作详情，必须获得明确确认',
    color: '#C9791F',
    bg: 'rgba(201,121,31,.10)',
  },
  RED: {
    label: '红色 · 强验证',
    short: '红',
    strategy: '在用户确认基础上，增加人脸识别 / 短信验证码多因子认证',
    color: '#B3392E',
    bg: 'rgba(179,57,46,.10)',
  },
};

export const POLICY_REASON_TEXT: Record<string, string> = {
  AUTO_QUERY: '查询类操作，权限分级为绿色，自动执行',
  SMALL_TRANSFER: '本次转账计入当日累计后不超过 1000 元，执行前需确认',
  DAILY_LIMIT_EXCEEDED: '本次转账会使当日累计超过 1000 元，升级为红色强验证',
  RED_BASE: '该操作属于红色高风险操作，必须完成多因子认证',
  HIGH_VALUE: '单笔金额超过 5000 元，需人脸识别 + 短信验证双因子',
  HARD_LIMIT: '单笔金额超过 5 万元演示硬限额，系统直接阻断',
  REVERSIBLE_OP: '操作可逆，执行后支持在当日回退',
  LIMIT_REVALIDATE: '确认期间当日额度发生变化，需重新评估权限等级',
  BREAKER_LOCKED: '会话因连续失败或可疑行为被安全锁定',
  TIER_FUSED: '权限档位由静态档与风控智能体评分共同决定',
  PRODUCT_CEILING: '超出产品单笔额度上限，需走柜面或提额流程',
  DAILY_CEILING: '超出产品当日累计额度上限',
  MANUAL_REVIEW: '交易进入人工审核队列，延迟到账，审核期内可撤销',
  PAYEE_ECHO_REQUIRED: '需手输收款人姓名后才能继续',
  PAYEE_ECHO_MISMATCH: '收款人姓名填写不一致',
  RISK_AMOUNT_RATIO: '金额占可用资金比例偏高',
  RISK_BEHAVIOR_BASELINE: '明显高于近期消费基线',
  RISK_NEW_PAYEE: '首次收款人',
  RISK_NIGHT_HOURS: '深夜时段交易',
  RISK_VELOCITY: '短时间连续交易',
  RISK_STRUCTURING: '疑似拆分规避限额',
  RISK_SESSION_RISK: '会话风险状态异常',
  RISK_INJECTION_SUSPICION: '对话中出现诱导绕过安全校验的痕迹',
  RISK_LOW_CONFIDENCE: '意图解析置信度偏低',
  RISK_BLOCKLIST_PAYEE: '收款人在风险名单内',
  RISK_FRAUD_KEYWORD: '备注含典型诈骗话术关键词',
  RISK_PAYEE_JUST_CHANGED: '收款人在本次会话中刚被改动',
  RISK_NEW_DEVICE: '新设备或新浏览器会话',
  RISK_DAILY_CEILING_NEAR: '接近当日额度上限',
};

export function riskFromAmount(amountCents: number, usedCents: number): Risk {
  return amountCents <= Math.max(0, DAILY_TRANSFER_LIMIT_CENTS - usedCents) ? 'YELLOW' : 'RED';
}
