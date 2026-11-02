import { dayKey } from '@bank/shared';
import { clock } from '../core/clock';

const DAILY_LIMIT = Math.max(20, Number(process.env.LLM_DAILY_LIMIT ?? 500));

let usedDay = '';
let used = 0;

/** 公网演示的全局 LLM 日预算；超限后自动降级规则引擎，避免公开链接刷 token。 */
export function consumeLlmBudget(): boolean {
  const today = dayKey(clock.wallNow());
  if (today !== usedDay) {
    usedDay = today;
    used = 0;
  }
  if (used >= DAILY_LIMIT) return false;
  used += 1;
  return true;
}

export function llmBudgetState(): { day: string; used: number; limit: number } {
  const today = dayKey(clock.wallNow());
  if (today !== usedDay) return { day: today, used: 0, limit: DAILY_LIMIT };
  return { day: today, used, limit: DAILY_LIMIT };
}
