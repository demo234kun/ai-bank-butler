import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { config } from '../config';
import {
  addWebAuthnCredential,
  bumpWebAuthnCounter,
  getAuthUser,
  listWebAuthnCredentials,
  removeWebAuthnCredential,
} from '../core/store';
import {
  completeAssertion,
  completeRegistration,
  createAssertionOptions,
  createRegistrationOptions,
} from '../security/webauthn';
import { allowAuthAttempt } from '../security/auth';
import { audit } from '../security/auditChain';
import { getChallenge, markBioVerified, toPublicChallenge } from '../policy/stepup';

function publicCredentials(userId: string) {
  return listWebAuthnCredentials(userId).map((credential) => ({
    id: credential.id.slice(0, 8),
    fullId: credential.id,
    label: credential.label,
    registeredAt: credential.registeredAt,
    counter: credential.counter,
    transports: credential.transports,
  }));
}

export async function passkeyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/passkey', async (request) => {
    const auth = request.authUser!;
    return {
      ok: true,
      enabled: config.auth.webauthnStepUp,
      secureContext: true,
      credentials: publicCredentials(auth.id),
    };
  });

  app.post('/api/passkey/register/start', async (request, reply) => {
    const auth = request.authUser!;
    if (!config.auth.webauthnStepUp) {
      return reply.code(400).send({ ok: false, code: 'WEBAUTHN_DISABLED', message: '服务端未开启生物识别强验证' });
    }
    const limit = allowAuthAttempt(`passkey:${auth.id}`, 8, 10 * 60_000);
    if (!limit.allowed) {
      return reply.code(429).send({ ok: false, code: 'RATE_LIMITED', message: `操作过于频繁，请 ${limit.retryAfterSec} 秒后再试` });
    }
    try {
      const { options } = await createRegistrationOptions(auth, request);
      return { ok: true, options };
    } catch (error) {
      return reply.code(500).send({
        ok: false,
        code: 'WEBAUTHN_START_FAILED',
        message: error instanceof Error ? error.message : '无法创建注册挑战',
      });
    }
  });

  app.post('/api/passkey/register/finish', async (request, reply) => {
    const auth = request.authUser!;
    const parsed = z
      .object({
        challenge: z.string().min(8).max(256),
        label: z.string().trim().max(40).optional(),
        response: z.unknown(),
      })
      .safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, code: 'INVALID_INPUT', message: '缺少通行密钥注册结果' });
    }
    try {
      const credential = await completeRegistration({
        response: parsed.data.response as RegistrationResponseJSON,
        challenge: parsed.data.challenge,
        request,
        userId: auth.id,
        label: parsed.data.label?.trim() || '本机生物识别',
      });
      const credentials = addWebAuthnCredential(auth.id, credential);
      audit.append('PASSKEY_REGISTERED', '已录入本机生物识别（指纹/面容）', {
        credentialId: credential.id.slice(0, 8),
        transports: credential.transports,
      });
      return { ok: true, credentials: publicCredentials(auth.id), count: credentials.length };
    } catch (error) {
      const candidate = error as { code?: string; message?: string };
      return reply.code(400).send({
        ok: false,
        code: candidate?.code ?? 'WEBAUTHN_REGISTRATION_FAILED',
        message: candidate?.message ?? '通行密钥注册失败',
      });
    }
  });

  app.post('/api/passkey/revoke', async (request, reply) => {
    const auth = request.authUser!;
    const id = String((request.body as any)?.id ?? '');
    const existing = listWebAuthnCredentials(auth.id).find((item) => item.id === id);
    if (!existing) {
      return reply.code(404).send({ ok: false, code: 'PASSKEY_NOT_FOUND', message: '未找到该通行密钥' });
    }
    removeWebAuthnCredential(auth.id, id);
    audit.append('PASSKEY_REVOKED', '已删除本机生物识别', { credentialId: id.slice(0, 8) });
    return { ok: true, credentials: publicCredentials(auth.id) };
  });

  /** 强验证：用已录入的生物识别替代活体人脸因子 */
  app.post('/api/stepup/bio/start', async (request, reply) => {
    const auth = request.authUser!;
    const body = (request.body ?? {}) as { sessionId?: string; challengeId?: string };
    const record = getChallenge(String(body.challengeId ?? ''));
    if (!record || record.sessionId !== body.sessionId || record.userId !== auth.id) {
      return reply.code(400).send({ ok: false, code: 'CHALLENGE_MISMATCH', message: '验证挑战无效' });
    }
    if (!config.auth.webauthnStepUp) {
      return reply.code(400).send({ ok: false, code: 'WEBAUTHN_DISABLED', message: '服务端未开启生物识别强验证' });
    }
    const user = getAuthUser(auth.id);
    if (!user) return reply.code(401).send({ ok: false, code: 'AUTH_REQUIRED', message: '登录已失效' });
    try {
      const { options } = await createAssertionOptions(user, request, {
        challengeId: record.id,
        sessionId: record.sessionId,
      });
      return { ok: true, options, challenge: toPublicChallenge(record) };
    } catch (error) {
      const candidate = error as { code?: string; message?: string };
      return reply.code(400).send({
        ok: false,
        code: candidate?.code ?? 'WEBAUTHN_START_FAILED',
        message: candidate?.message ?? '无法发起生物识别',
      });
    }
  });

  app.post('/api/stepup/bio/finish', async (request, reply) => {
    const auth = request.authUser!;
    const body = (request.body ?? {}) as {
      sessionId?: string;
      challengeId?: string;
      response?: unknown;
    };
    const record = getChallenge(String(body.challengeId ?? ''));
    if (!record || record.sessionId !== body.sessionId || record.userId !== auth.id) {
      return reply.code(400).send({ ok: false, code: 'CHALLENGE_MISMATCH', message: '验证挑战无效' });
    }
    const user = getAuthUser(auth.id);
    if (!user) return reply.code(401).send({ ok: false, code: 'AUTH_REQUIRED', message: '登录已失效' });
    try {
      const result = await completeAssertion({
        response: body.response as AuthenticationResponseJSON,
        request,
        userId: auth.id,
        challengeId: record.id,
        sessionId: record.sessionId,
        credentials: user.webauthn ?? [],
      });
      bumpWebAuthnCounter(auth.id, result.credentialId, result.counter);
      markBioVerified(record.id, result.credentialId);
      return { ok: true, verified: true, challenge: toPublicChallenge(record) };
    } catch (error) {
      const candidate = error as { code?: string; message?: string };
      audit.append('STEPUP_BIO_FAILED', `生物识别校验失败：${candidate?.code ?? 'UNKNOWN'}`, {
        challengeId: record.id,
        message: candidate?.message,
      });
      return reply.code(400).send({
        ok: false,
        code: candidate?.code ?? 'WEBAUTHN_ASSERTION_FAILED',
        message: candidate?.message ?? '生物识别校验失败',
      });
    }
  });
}
