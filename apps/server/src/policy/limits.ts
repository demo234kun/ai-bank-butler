import { randomUUID } from 'node:crypto';
import { DAILY_TRANSFER_LIMIT_CENTS, RESERVATION_TTL_MS, type LimitSummary } from '@bank/shared';
import { clock } from '../core/clock';
import type { BankState, Reservation } from '../core/state';

const userLocks = new Map<string, Promise<unknown>>();

/** 同一用户的额度变更串行化，避免并发“读-判-写”双花 */
export function withUserLock<T>(userId: string, task: () => Promise<T> | T): Promise<T> {
  const previous = userLocks.get(userId) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  userLocks.set(userId, tail);
  return run.finally(() => {
    if (userLocks.get(userId) === tail) userLocks.delete(userId);
  });
}

export function cleanupReservations(state: BankState): void {
  const now = clock.wallNow().getTime();
  for (const r of state.limits) {
    if (r.state === 'HELD' && new Date(r.expiresAt).getTime() <= now) {
      r.state = 'RELEASED';
    }
  }
}

export function getLimitSummary(state: BankState): LimitSummary {
  cleanupReservations(state);
  const dayKey = clock.todayKey();
  const today = state.limits.filter((r) => r.dayKey === dayKey);
  const committed = today
    .filter((r) => r.state === 'COMMITTED')
    .reduce((sum, r) => sum + r.amountCents, 0);
  const held = today
    .filter((r) => r.state === 'HELD')
    .reduce((sum, r) => sum + r.amountCents, 0);
  const usedCents = committed + held;
  return {
    dayKey,
    dailyLimitCents: DAILY_TRANSFER_LIMIT_CENTS,
    usedCents,
    heldCents: held,
    remainingCents: Math.max(0, DAILY_TRANSFER_LIMIT_CENTS - usedCents),
    reservations: today
      .filter((r) => r.state !== 'RELEASED')
      .map((r) => ({
        id: r.id,
        amountCents: r.amountCents,
        state: r.state,
        expiresAt: r.expiresAt,
        nodeId: r.nodeId,
      })),
  };
}

export class LimitError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function reserve(
  state: BankState,
  input: { userId: string; nodeId: string; amountCents: number },
): Reservation {
  cleanupReservations(state);
  if (input.amountCents <= 0) throw new LimitError('INVALID_AMOUNT', '预留金额必须大于 0');
  // 注意：1000 元是“黄色 / 红色”的分界线，不是硬上限。
  // 红色大额转账经强验证后仍然执行，但必须占用额度台账，
  // 让后续并发请求看到累计已用金额并继续走强验证。
  const now = clock.wallNow();
  const reservation: Reservation = {
    id: `rsv_${randomUUID().slice(0, 8)}`,
    userId: input.userId,
    nodeId: input.nodeId,
    amountCents: input.amountCents,
    dayKey: clock.todayKey(),
    state: 'HELD',
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + RESERVATION_TTL_MS).toISOString(),
  };
  state.limits.push(reservation);
  return reservation;
}

export function commitReservation(state: BankState, reservationId: string): Reservation | null {
  const reservation = state.limits.find((r) => r.id === reservationId);
  if (!reservation || reservation.state !== 'HELD') return null;
  reservation.state = 'COMMITTED';
  reservation.committedAt = clock.nowIso();
  return reservation;
}

export function releaseReservation(state: BankState, reservationId: string): Reservation | null {
  const reservation = state.limits.find((r) => r.id === reservationId);
  if (!reservation || reservation.state !== 'HELD') return reservation ?? null;
  reservation.state = 'RELEASED';
  return reservation;
}

export function findReservationByNode(state: BankState, nodeId: string): Reservation | undefined {
  return state.limits.find((r) => r.nodeId === nodeId && r.state !== 'RELEASED');
}

export function resetLimitsForTest(state: BankState): void {
  state.limits = [];
}
