import type { FastifyRequest } from 'fastify';
import { getSession, type SessionInternal } from '../agent/session';
import type { AuthUser } from '../core/store';

export function requestUser(request: FastifyRequest): AuthUser {
  if (!request.authUser) throw new Error('AUTH_REQUIRED');
  return request.authUser;
}

export function ownedSession(
  request: FastifyRequest,
  sessionId: unknown,
): SessionInternal | undefined {
  if (typeof sessionId !== 'string') return undefined;
  const session = getSession(sessionId);
  if (!session || session.userId !== requestUser(request).id) return undefined;
  return session;
}
