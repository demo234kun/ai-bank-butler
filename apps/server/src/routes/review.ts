import type { FastifyInstance } from 'fastify';
import { getState } from '../core/store';
import { approveManualReview, rejectManualReview } from '../policy/safeguards';

/**
 * T4 人工审核队列：交易被风控升档后不直接执行，也不直接拒绝。
 * - 用户可撤销（withdraw）
 * - 审核席位可批准（approve，批准后立即执行）或驳回（reject）
 * 生产环境 approve/reject 需要独立的角色权限与双人复核，当前对已登录用户开放，
 * 已在安全自评的已知风险清单中登记。
 */
export async function reviewRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/reviews', async (request) => {
    const auth = request.authUser!;
    const state = getState(auth.id);
    const items = state.schedules
      .filter((item) => item.kind === 'review')
      .sort((a, b) => new Date(b.executeAt).getTime() - new Date(a.executeAt).getTime())
      .slice(0, 20);
    return { ok: true, reviews: items };
  });

  app.post<{ Params: { id: string } }>('/api/reviews/:id/approve', async (request, reply) => {
    const auth = request.authUser!;
    const result = await approveManualReview(auth.id, String(request.params.id ?? ''));
    if (!result.ok) return reply.code(result.code === 'REVIEW_NOT_FOUND' ? 404 : 409).send(result);
    return result;
  });

  app.post<{ Params: { id: string }; Body: { reason?: string; by?: 'user' | 'bank' } }>(
    '/api/reviews/:id/reject',
    async (request, reply) => {
      const auth = request.authUser!;
      const by = request.body?.by === 'bank' ? 'bank' : 'user';
      const reason = String(request.body?.reason ?? '未通过').slice(0, 120);
      const result = await rejectManualReview(auth.id, String(request.params.id ?? ''), reason, by);
      if (!result.ok) return reply.code(result.code === 'REVIEW_NOT_FOUND' ? 404 : 409).send(result);
      return result;
    },
  );
}
