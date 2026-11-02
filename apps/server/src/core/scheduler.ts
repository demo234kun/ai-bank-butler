import { HARD_BLOCK_CENTS, formatMoney } from '@bank/shared';
import { config } from '../config';
import { banking } from '../integration/banking';
import { audit, enterAuditContext } from '../security/auditChain';
import { clock } from './clock';
import { pushNotification } from './notify';
import { getState, listAuthUsers, persist } from './store';

export interface SchedulerResult {
  transfers: number;
  released: number;
  delivered: number;
  reminded: number;
  failures: number;
  skipped: number;
}

const emptyResult = (): SchedulerResult => ({
  transfers: 0,
  released: 0,
  delivered: 0,
  reminded: 0,
  failures: 0,
  skipped: 0,
});

function due(executeAt: string, nowMs: number): boolean {
  const at = new Date(executeAt).getTime();
  return Number.isFinite(at) && at <= nowMs;
}

let inFlight = false;

/**
 * 到点执行计划：定时转账真实扣款、预算锁定真实释放、礼品订单真实流转状态。
 *
 * 关键约束：
 * - 只执行用户在确认单上授权过的计划（payload.authorized），缺授权一律不动钱；
 * - 执行前重新校验当日额度与硬限额，不沿用创建时的判断；
 * - 幂等键绑定计划 id，重复 tick / 重启不会重复扣款；
 * - 银行核心不可用时按次计数，超过上限转 failed 并提醒用户，不伪造成功。
 */
export async function runDueTasks(nowIso: string = clock.nowIso()): Promise<SchedulerResult> {
  if (inFlight) return emptyResult();
  inFlight = true;
  const result = emptyResult();
  const nowMs = new Date(nowIso).getTime();
  try {
    for (const user of listAuthUsers()) {
      const state = getState(user.id);
      enterAuditContext(user.id);
      let touched = false;

      for (const lock of state.fundLocks) {
        if (lock.status !== 'locked' || !due(lock.releaseAt, nowMs)) continue;
        try {
          const outcome = await banking.unlockFunds(user.id, lock.id, `schedule:unlock:${lock.id}`);
          touched = true;
          result.released += 1;
          pushNotification(state, {
            kind: 'budget',
            title: '预算已按计划释放',
            body: `${outcome.lock.reason} 的 ${formatMoney(outcome.lock.amountCents)} 已回到可用余额。`,
            refId: outcome.lock.id,
            amountCents: outcome.lock.amountCents,
          });
          audit.append('FUNDS_RELEASED_BY_SCHEDULE', `计划释放预算 ${formatMoney(outcome.lock.amountCents)}`, {
            lockId: outcome.lock.id,
            amountCents: outcome.lock.amountCents,
            releaseAt: outcome.lock.releaseAt,
          });
        } catch (error) {
          touched = true;
          result.failures += 1;
          lock.status = 'released';
          // 解锁失败说明上游已不认这笔锁定，交给人工而不是反复重试
          pushNotification(state, {
            kind: 'system',
            title: '预算释放失败，需人工处理',
            body: error instanceof Error ? error.message : '银行核心拒绝了解除锁定请求',
            refId: lock.id,
          });
        }
      }

      for (const order of state.giftOrders) {
        if (order.status !== 'scheduled' || !due(order.deliveryAt, nowMs)) continue;
        order.status = 'delivered';
        touched = true;
        result.delivered += 1;
        pushNotification(state, {
          kind: 'gift',
          title: `${order.merchant} 已到送达时间`,
          body: `${order.note || order.type === 'flower' ? '鲜花' : '蛋糕'}订单已流转到「已送达」，实付 ${formatMoney(order.amountCents)}。`,
          refId: order.id,
          amountCents: order.amountCents,
        });
        audit.append('GIFT_ORDER_DELIVERED', `礼品订单到点流转：${order.merchant}`, {
          orderId: order.id,
          deliveryAt: order.deliveryAt,
          amountCents: order.amountCents,
        });
      }

      for (const item of state.schedules) {
        if (item.status !== 'scheduled' || !due(item.executeAt, nowMs)) continue;

        // T4 人工审核单：到点仍未批准即超时退回，不发生资金变动
        if (item.kind === 'review') {
          item.status = 'cancelled';
          item.lastError = 'REVIEW_TIMEOUT';
          touched = true;
          result.failures += 1;
          pushNotification(state, {
            kind: 'review',
            title: '人工审核超时未处理',
            body: `${item.title} 未在审核窗口内处理，交易已退回，未发生资金变动。`,
            refId: item.id,
            amountCents: item.amountCents,
          });
          audit.append('MANUAL_REVIEW_EXPIRED', `人工审核超时退回：${item.title}`, {
            scheduleId: item.id,
            amountCents: item.amountCents,
          });
          continue;
        }

        if (item.kind !== 'transfer') {
          item.status = 'done';
          touched = true;
          result.reminded += 1;
          pushNotification(state, {
            kind: item.kind === 'gift' ? 'gift' : 'note',
            title: item.title,
            body: item.detail ?? '计划时间已到。',
            refId: item.id,
            amountCents: item.amountCents,
          });
          audit.append('SCHEDULE_REMINDER', `计划提醒到期：${item.title}`, { scheduleId: item.id });
          continue;
        }

        const payload = item.payload;
        if (!payload || !payload.authorized || !payload.recipients.length) {
          item.status = 'failed';
          item.lastError = 'MISSING_AUTHORIZATION';
          touched = true;
          result.failures += 1;
          pushNotification(state, {
            kind: 'risk',
            title: '定时转账未执行',
            body: '该计划缺少到点执行授权，资金操作不会被自动放行，请重新发起并确认。',
            refId: item.id,
            amountCents: item.amountCents,
          });
          audit.append('SCHEDULE_BLOCKED', `定时转账缺授权，拒绝执行：${item.title}`, {
            scheduleId: item.id,
            amountCents: item.amountCents,
          });
          continue;
        }

        const totalCents = payload.recipients.reduce((sum, r) => sum + Math.abs(r.amountCents), 0);
        // 到点只复核"能不能付"和硬限额；黄色/红色额度已由创建时的确认单授权覆盖
        const account =
          (payload.fromAccountId ? state.accounts.find((a) => a.id === payload.fromAccountId) : undefined) ??
          state.accounts.find((a) => a.primary) ??
          state.accounts[0];
        const available = account ? account.balanceCents - account.lockedCents : 0;
        const blocked =
          totalCents > HARD_BLOCK_CENTS
            ? 'HARD_BLOCK'
            : !account || available < totalCents
              ? 'INSUFFICIENT_BALANCE'
              : null;
        if (blocked) {
          item.attempts = (item.attempts ?? 0) + 1;
          item.lastError = blocked;
          touched = true;
          if (item.attempts >= config.scheduler.maxAttempts) {
            item.status = 'failed';
            result.failures += 1;
            pushNotification(state, {
              kind: 'risk',
              title: '定时转账已终止',
              body: `连续 ${item.attempts} 次无法执行（${item.lastError === 'HARD_BLOCK' ? '超出单笔硬限额' : '可用余额不足'}），计划已终止，请重新发起。`,
              refId: item.id,
              amountCents: totalCents,
            });
            audit.append('SCHEDULE_ABANDONED', `定时转账额度持续不足，终止计划：${item.title}`, {
              scheduleId: item.id,
              attempts: item.attempts,
              reason: item.lastError,
            });
          } else {
            result.skipped += 1;
            audit.append('SCHEDULE_RETRY', `定时转账额度校验未过，稍后重试：${item.title}`, {
              scheduleId: item.id,
              attempts: item.attempts,
              reason: item.lastError,
            });
          }
          continue;
        }

        try {
          const outcome = await banking.transfer(
            user.id,
            {
              fromAccountId: payload.fromAccountId,
              recipients: payload.recipients,
              note: payload.note ?? item.detail ?? '定时转账',
            },
            `schedule:${item.id}`,
          );
          item.status = 'done';
          item.attempts = (item.attempts ?? 0) + 1;
          touched = true;
          result.transfers += 1;
          pushNotification(state, {
            kind: 'schedule',
            title: '定时转账已执行',
            body: `已向 ${outcome.recipients.map((r) => r.name).join('、')} 转出 ${formatMoney(outcome.totalCents)}，${outcome.account.name} 余额 ${formatMoney(outcome.account.balanceCents)}。`,
            refId: item.id,
            amountCents: outcome.totalCents,
          });
          audit.append(
            'SCHEDULE_EXECUTED',
            `定时转账到点执行 ${formatMoney(outcome.totalCents)}`,
            {
              scheduleId: item.id,
              authorizationRef: payload.authorizationRef,
              txnIds: outcome.txns.map((txn) => txn.id),
              executeAt: item.executeAt,
            },
            { runId: `schedule:${item.id}` },
          );
        } catch (error) {
          item.attempts = (item.attempts ?? 0) + 1;
          item.lastError = error instanceof Error ? error.message : 'TRANSFER_FAILED';
          touched = true;
          if (item.attempts >= config.scheduler.maxAttempts) {
            item.status = 'failed';
            result.failures += 1;
            pushNotification(state, {
              kind: 'risk',
              title: '定时转账多次失败',
              body: `${item.lastError}；已停止重试，请检查银行核心状态后重新发起。`,
              refId: item.id,
              amountCents: totalCents,
            });
          } else {
            result.skipped += 1;
          }
          audit.append('SCHEDULE_FAILED', `定时转账执行失败：${item.lastError}`, {
            scheduleId: item.id,
            attempts: item.attempts,
          });
        }
      }

      if (touched) persist();
    }
    return result;
  } finally {
    inFlight = false;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startScheduler(tickMs = config.scheduler.tickMs): void {
  if (tickMs <= 0 || timer) return;
  timer = setInterval(() => {
    runDueTasks().catch((error) => {
      console.error('[scheduler]', error);
    });
  }, tickMs);
  timer.unref?.();
  void runDueTasks().catch((error) => console.error('[scheduler]', error));
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
