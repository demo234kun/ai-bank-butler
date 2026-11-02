import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { formatDateTime } from '@bank/shared';
import { clock } from '../core/clock';
import { markNotificationsRead } from '../core/notify';
import { runDueTasks } from '../core/scheduler';
import { getState } from '../core/store';
import { audit, enterAuditContext } from '../security/auditChain';

function upcoming(state: ReturnType<typeof getState>) {
  return [...state.schedules]
    .filter((item) => item.status === 'scheduled')
    .sort((a, b) => new Date(a.executeAt).getTime() - new Date(b.executeAt).getTime())
    .slice(0, 8);
}

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/notifications', async (request) => {
    const auth = request.authUser!;
    const state = getState(auth.id);
    const now = clock.nowIso();
    return {
      ok: true,
      items: state.notifications.slice(0, 40),
      unreadCount: state.notifications.filter((item) => !item.read).length,
      schedules: upcoming(state),
      lockedFunds: state.fundLocks
        .filter((lock) => lock.status === 'locked')
        .map((lock) => ({ id: lock.id, amountCents: lock.amountCents, reason: lock.reason, releaseAt: lock.releaseAt })),
      giftOrders: state.giftOrders
        .filter((order) => order.status !== 'cancelled')
        .map((order) => ({ id: order.id, merchant: order.merchant, status: order.status, deliveryAt: order.deliveryAt, amountCents: order.amountCents })),
      clock: { mode: clock.isReal() ? 'real' : 'demo', now, label: formatDateTime(now) },
    };
  });

  app.post('/api/notifications/read', async (request) => {
    const auth = request.authUser!;
    const parsed = z
      .object({ ids: z.array(z.string().max(40)).max(60).optional() })
      .safeParse(request.body ?? {});
    const state = getState(auth.id);
    const changed = markNotificationsRead(state, parsed.success ? parsed.data.ids : undefined);
    return { ok: true, changed, unreadCount: state.notifications.filter((item) => !item.read).length };
  });

  /**
   * 演示时钟推进：只在 demo 时钟下可用，用于把「明天/下周」的计划真正跑到执行时刻。
   * 真实业务时钟（BUSINESS_CLOCK=real）下直接拒绝，避免伪造时间。
   */
  app.post('/api/demo/advance-clock', async (request, reply) => {
    if (clock.isReal()) {
      return reply.code(400).send({
        ok: false,
        code: 'CLOCK_IS_REAL',
        message: '当前使用真实业务时间，计划任务会按真实时间自动执行',
      });
    }
    const parsed = z.object({ days: z.number().int().min(0).max(60) }).safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, code: 'INVALID_INPUT', message: 'days 需为 0–60 的整数' });
    }
    const auth = request.authUser!;
    const before = clock.nowIso();
    const after = clock.advanceDays(parsed.data.days).toISOString();
    const result = await runDueTasks(after);
    enterAuditContext(auth.id);
    audit.append('DEMO_CLOCK_ADVANCED', `演示时钟前进 ${parsed.data.days} 天`, {
      before,
      after,
      executed: result.transfers,
      released: result.released,
      delivered: result.delivered,
      reminded: result.reminded,
      failures: result.failures,
    });
    const state = getState(auth.id);
    return {
      ok: true,
      clock: { mode: 'demo', now: after, label: formatDateTime(after) },
      result,
      items: state.notifications.slice(0, 10),
      schedules: upcoming(state),
    };
  });
}
