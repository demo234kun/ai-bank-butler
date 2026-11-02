import { dayKey } from '@bank/shared';
import { config } from '../config';

/**
 * 演示时钟可注入：所有业务日期、到期、排期都从这里取，
 * 保证「生日前 2 天」「当月账单」等相对时间在任何机器上稳定。
 */
let current = new Date(config.demoNow);
const realBusinessClock = config.businessClock === 'real';

export const clock = {
  now(): Date {
    return realBusinessClock ? new Date() : new Date(current.getTime());
  },
  nowIso(): string {
    return realBusinessClock ? new Date().toISOString() : new Date(current.getTime()).toISOString();
  },
  /** 真实墙钟：仅用于确认/验证/预留等安全 TTL，避免演示时钟冻结导致“一打开就过期” */
  wallNow(): Date {
    return new Date();
  },
  wallNowIso(): string {
    return new Date().toISOString();
  },
  todayKey(): string {
    return dayKey(realBusinessClock ? new Date() : current);
  },
  reset(): void {
    current = new Date(config.demoNow);
  },
  isReal(): boolean {
    return realBusinessClock;
  },
  advanceDays(days: number): Date {
    current = new Date(current.getTime() + days * 86_400_000);
    return clock.now();
  },
};
