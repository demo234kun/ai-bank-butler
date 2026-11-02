import type { FastifyInstance } from 'fastify';
import type { FastifyRequest } from 'fastify';
import { getSession } from '../agent/session';
import {
  confirmPending,
  interruptRun,
  submitStepUp,
  takeoverAction,
} from '../agent/control';
import { buildSnapshot } from './snapshot';
import {
  checkFaceVerification,
  getChallenge,
  sendStepUpCode,
  startFaceVerification,
  toPublicChallenge,
} from '../policy/stepup';

function requireSession(request: FastifyRequest, sessionId: unknown) {
  if (typeof sessionId !== 'string' || !request.authUser) return undefined;
  const session = getSession(sessionId);
  if (!session || session.userId !== request.authUser.id) return undefined;
  return session;
}

export async function controlRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/confirm', async (request, reply) => {
    const body = (request.body ?? {}) as {
      sessionId?: string;
      nodeId?: string;
      digest?: string;
      approve?: boolean;
      /** T2 及以上：手输收款人姓名 */
      payeeEcho?: string;
    };
    const session = requireSession(request, body.sessionId);
    if (!session) return reply.code(404).send({ ok: false, code: 'SESSION_NOT_FOUND', message: '会话不存在' });
    if (!body.digest) return reply.code(400).send({ ok: false, code: 'MISSING_DIGEST', message: '缺少操作摘要' });
    const result = confirmPending(session, {
      digest: String(body.digest),
      approve: Boolean(body.approve),
      nodeId: body.nodeId,
      payeeEcho: typeof body.payeeEcho === 'string' ? body.payeeEcho : undefined,
    });
    return { ...result, snapshot: buildSnapshot(session) };
  });

  app.post('/api/cancel', async (request, reply) => {
    const body = (request.body ?? {}) as { sessionId?: string; digest?: string; nodeId?: string };
    const session = requireSession(request, body.sessionId);
    if (!session) return reply.code(404).send({ ok: false, code: 'SESSION_NOT_FOUND', message: '会话不存在' });
    const digest = body.digest ?? session.pending?.digest;
    if (!digest) return reply.code(409).send({ ok: false, code: 'NO_PENDING', message: '没有待取消的操作' });
    const result = confirmPending(session, {
      digest: String(digest),
      approve: false,
      nodeId: body.nodeId,
    });
    return { ...result, snapshot: buildSnapshot(session) };
  });

  app.post('/api/stepup', async (request, reply) => {
    const body = (request.body ?? {}) as {
      sessionId?: string;
      challengeId?: string;
      faceDone?: boolean;
      smsCode?: string;
    };
    const session = requireSession(request, body.sessionId);
    if (!session) return reply.code(404).send({ ok: false, code: 'SESSION_NOT_FOUND', message: '会话不存在' });
    if (!body.challengeId) {
      return reply.code(400).send({ ok: false, code: 'MISSING_CHALLENGE', message: '缺少验证挑战' });
    }
    const result = await submitStepUp(session, {
      challengeId: String(body.challengeId),
      faceDone: Boolean(body.faceDone),
      smsCode: body.smsCode ? String(body.smsCode) : undefined,
    });
    return { ...result, snapshot: buildSnapshot(session) };
  });

  app.post('/api/stepup/send', async (request, reply) => {
    const body = (request.body ?? {}) as { sessionId?: string; challengeId?: string };
    const session = requireSession(request, body.sessionId);
    if (!session) return reply.code(404).send({ ok: false, code: 'SESSION_NOT_FOUND', message: '会话不存在' });
    const challengeId = String(body.challengeId ?? '');
    if (!challengeId || session.pending?.challenge?.id !== challengeId) {
      return reply.code(409).send({ ok: false, code: 'NO_STEPUP', message: '当前没有匹配的强验证挑战' });
    }
    const result = await sendStepUpCode(challengeId, session.id);
    const live = getChallenge(challengeId);
    if (live && session.pending?.challenge) {
      session.pending.challenge = toPublicChallenge(live);
    }
    return { ...result, snapshot: buildSnapshot(session) };
  });

  app.post('/api/stepup/face/start', async (request, reply) => {
    const body = (request.body ?? {}) as { sessionId?: string; challengeId?: string };
    const session = requireSession(request, body.sessionId);
    if (!session) return reply.code(404).send({ ok: false, code: 'SESSION_NOT_FOUND', message: '会话不存在' });
    const challengeId = String(body.challengeId ?? '');
    if (!challengeId || session.pending?.challenge?.id !== challengeId) {
      return reply.code(409).send({ ok: false, code: 'NO_STEPUP', message: '当前没有匹配的强验证挑战' });
    }
    const result = await startFaceVerification(challengeId, session.id);
    const live = getChallenge(challengeId);
    if (live && session.pending?.challenge) {
      session.pending.challenge = toPublicChallenge(live);
    }
    return { ...result, snapshot: buildSnapshot(session) };
  });

  app.post('/api/stepup/face/status', async (request, reply) => {
    const body = (request.body ?? {}) as { sessionId?: string; challengeId?: string };
    const session = requireSession(request, body.sessionId);
    if (!session) return reply.code(404).send({ ok: false, code: 'SESSION_NOT_FOUND', message: '会话不存在' });
    const challengeId = String(body.challengeId ?? '');
    if (!challengeId || session.pending?.challenge?.id !== challengeId) {
      return reply.code(409).send({ ok: false, code: 'NO_STEPUP', message: '当前没有匹配的强验证挑战' });
    }
    return checkFaceVerification(challengeId, session.id);
  });

  app.post('/api/interrupt', async (request, reply) => {
    const body = (request.body ?? {}) as { sessionId?: string; mode?: 'abort' | 'rollback' };
    const session = requireSession(request, body.sessionId);
    if (!session) return reply.code(404).send({ ok: false, code: 'SESSION_NOT_FOUND', message: '会话不存在' });
    const result = await interruptRun(session, body.mode === 'rollback' ? 'rollback' : 'abort');
    return { ...result, snapshot: buildSnapshot(session) };
  });

  app.post('/api/rollback', async (request, reply) => {
    const body = (request.body ?? {}) as { sessionId?: string };
    const session = requireSession(request, body.sessionId);
    if (!session) return reply.code(404).send({ ok: false, code: 'SESSION_NOT_FOUND', message: '会话不存在' });
    const result = await interruptRun(session, 'rollback');
    return { ...result, snapshot: buildSnapshot(session) };
  });

  app.post('/api/takeover', async (request, reply) => {
    const body = (request.body ?? {}) as {
      sessionId?: string;
      action?: 'take' | 'release' | 'abort' | 'unlock';
    };
    const session = requireSession(request, body.sessionId);
    if (!session) return reply.code(404).send({ ok: false, code: 'SESSION_NOT_FOUND', message: '会话不存在' });
    if (!body.action || !['take', 'release', 'abort', 'unlock'].includes(body.action)) {
      return reply.code(400).send({ ok: false, code: 'INVALID_ACTION', message: '未知接管动作' });
    }
    const result = takeoverAction(session, body.action);
    return { ...result, snapshot: buildSnapshot(session) };
  });
}
