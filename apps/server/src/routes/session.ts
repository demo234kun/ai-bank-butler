import type { FastifyInstance } from 'fastify';
import { createSession, getSession } from '../agent/session';
import { metrics } from '../metrics';
import { buildBootstrap, buildSnapshot } from './snapshot';
import { ownedSession, requestUser } from './access';
import { banking } from '../integration/banking';

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/bootstrap', async (request, reply) => {
    const { sessionId } = request.query as { sessionId?: string };
    const user = requestUser(request);
    const source = await banking.sync(user.id, { tolerant: true });
    if (banking.mode === 'http' && !source.healthy && !source.syncedAt) {
      return reply.code(503).send({
        ok: false,
        code: 'BANK_UNAVAILABLE',
        message: `银行核心暂不可用：${source.error ?? '尚未完成首次同步'}`,
      });
    }
    let session = ownedSession(request, sessionId);
    if (!session) session = createSession(user.id);
    session.llmMode = metrics.mode;
    return buildBootstrap(session);
  });

  app.get('/api/session/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = ownedSession(request, id);
    if (!session) return reply.code(404).send({ ok: false, code: 'SESSION_NOT_FOUND', message: '会话不存在或已重置' });
    const source = await banking.sync(session.userId, { tolerant: true });
    if (banking.mode === 'http' && !source.healthy && !source.syncedAt) {
      return reply.code(503).send({
        ok: false,
        code: 'BANK_UNAVAILABLE',
        message: `银行核心暂不可用：${source.error ?? '尚未完成首次同步'}`,
      });
    }
    session.llmMode = metrics.mode;
    return buildSnapshot(session);
  });
}
