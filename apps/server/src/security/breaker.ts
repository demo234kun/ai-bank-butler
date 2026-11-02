import type { BreakerState } from '@bank/shared';
import { BREAKER_FAILURE_LIMIT, BREAKER_INJECTION_LIMIT, BREAKER_LOCK_MS } from '@bank/shared';
import { clock } from '../core/clock';
import type { BankState } from '../core/state';

export function isLocked(state: BankState): boolean {
  const until = state.security.lockedUntil;
  if (!until) return false;
  return new Date(until).getTime() > clock.wallNow().getTime();
}

export function breakerState(state: BankState): BreakerState {
  return {
    failures: state.security.failures,
    injectionHits: state.security.injectionHits,
    lockedUntil: isLocked(state) ? state.security.lockedUntil : null,
  };
}

export function lockSecurity(state: BankState, reason: string): string {
  const lockedUntil = new Date(clock.wallNow().getTime() + BREAKER_LOCK_MS).toISOString();
  state.security.lockedUntil = lockedUntil;
  state.security.lastReason = reason;
  return lockedUntil;
}

export function recordFailure(
  state: BankState,
  reason: string,
): { tripped: boolean; failures: number; lockedUntil: string | null } {
  state.security.failures += 1;
  state.security.lastReason = reason;
  let tripped = false;
  if (state.security.failures >= BREAKER_FAILURE_LIMIT) {
    lockSecurity(state, `连续失败 ${state.security.failures} 次：${reason}`);
    tripped = true;
  }
  return {
    tripped,
    failures: state.security.failures,
    lockedUntil: state.security.lockedUntil,
  };
}

export function recordInjectionHit(
  state: BankState,
  reason: string,
): { tripped: boolean; hits: number; lockedUntil: string | null } {
  state.security.injectionHits += 1;
  state.security.lastReason = reason;
  let tripped = false;
  if (state.security.injectionHits >= BREAKER_INJECTION_LIMIT) {
    lockSecurity(state, `注入攻击命中 ${state.security.injectionHits} 次：${reason}`);
    tripped = true;
  }
  return {
    tripped,
    hits: state.security.injectionHits,
    lockedUntil: state.security.lockedUntil,
  };
}

export function clearSecurity(state: BankState): void {
  state.security.failures = 0;
  state.security.injectionHits = 0;
  state.security.lockedUntil = null;
  state.security.lastReason = null;
}

export function recordSuccess(state: BankState): void {
  state.security.failures = 0;
}
