import type { FastifyInstance } from 'fastify';
import { createSession } from '../agent/session';
import { handleUserMessage, resumeRun } from '../agent/orchestrator';
import { metrics } from '../metrics';
import { streamSession } from '../sse/stream';
import { ownedSession, requestUser } from './access';

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/chat', async (request, reply) => {
    const body = (request.body ?? {}) as {
      sessionId?: string;
      message?: string;
      after?: number;
    };
    const text = String(body.message ?? '').trim();
    if (!text) {
      return reply.code(400).send({ ok: false, code: 'EMPTY_MESSAGE', message: '消息不能为空' });
    }
    const user = requestUser(request);
    let session = ownedSession(request, body.sessionId);
    if (!session) session = createSession(user.id);
    session.llmMode = metrics.mode;
    streamSession(reply, {
      sessionId: session.id,
      after: body.after,
      task: (emit) => handleUserMessage(session!, text, emit),
    });
  });

  app.post('/api/resume', async (request, reply) => {
    const body = (request.body ?? {}) as { sessionId?: string; after?: number };
    const session = ownedSession(request, body.sessionId);
    if (!session) {
      return reply.code(404).send({ ok: false, code: 'SESSION_NOT_FOUND', message: '会话不存在' });
    }
    if (!session.dag) {
      return reply.code(409).send({ ok: false, code: 'NO_RUN', message: '没有可继续的任务' });
    }
    if (session.pending) {
      return reply.code(409).send({ ok: false, code: 'PENDING_CONFIRMATION', message: '请先完成确认或强验证' });
    }
    streamSession(reply, {
      sessionId: session.id,
      after: body.after,
      task: (emit) => resumeRun(session, emit),
    });
  });
}
