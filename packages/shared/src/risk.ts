import type { Risk } from './types';

export const DAILY_TRANSFER_LIMIT_CENTS = 100_000; // 黄色额度上限：日累计 ≤ 1000 元
export const HIGH_VALUE_CENTS = 500_000; // 超过 5000 元需双因子
export const HARD_BLOCK_CENTS = 5_000_000; // 单笔 5 万元硬阻断
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
};

export function riskFromAmount(amountCents: number, usedCents: number): Risk {
  return amountCents <= Math.max(0, DAILY_TRANSFER_LIMIT_CENTS - usedCents) ? 'YELLOW' : 'RED';
}
