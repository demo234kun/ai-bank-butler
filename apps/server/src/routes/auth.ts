import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  createGuestUser,
  createRegisteredUser,
  findUserByPhone,
  getAuthUser,
  listAuthSessions,
  revokeAuthSession,
  revokeUserSessions,
  updateUserPassword,
  type AuthSession,
} from '../core/store';
import { config } from '../config';
import {
  allowAuthAttempt,
  clearAuthCookieOnReply,
  readAuthSession,
  startAuthSession,
  toPublicAuth,
} from '../security/auth';
import {
  consumeResetToken,
  issueResetToken,
  sendOtpChallenge,
  verifyOtpChallenge,
} from '../security/authChallenges';
import { verifyPassword } from '../security/password';
import { audit, enterAuditContext } from '../security/auditChain';
import { clock } from '../core/clock';

const phoneSchema = z.string().regex(/^1[3-9]\d{9}$/, '请输入 11 位手机号');
const passwordSchema = z.string().min(6, '密码至少 6 位').max(64, '密码过长');
const nameSchema = z.string().trim().min(1, '请输入姓名').max(20, '姓名过长');
const birthdaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '生日格式应为 YYYY-MM-DD')
  .optional()
  .or(z.literal(''));
const codeSchema = z.string().regex(/^\d{6}$/, '请输入 6 位验证码');

function badRequest(reply: FastifyReply, code: string, message: string) {
  return reply.code(400).send({ ok: false, code, message });
}

function tooMany(reply: FastifyReply, retryAfterSec: number) {
  return reply.code(429).send({
    ok: false,
    code: 'RATE_LIMITED',
    message: `操作过于频繁，请 ${retryAfterSec} 秒后再试`,
  });
}

function publicSession(session: AuthSession, currentId?: string) {
  const ua = session.userAgent;
  let browser = '浏览器';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\//i.test(ua)) browser = 'Opera';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/MicroMessenger/i.test(ua)) browser = '微信';
  else if (/Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua)) browser = 'Safari';
  let os = '未知设备';
  if (/iPhone/i.test(ua)) os = 'iPhone';
  else if (/iPad/i.test(ua)) os = 'iPad';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';
  return {
    id: session.id,
    current: session.id === currentId,
    device: `${os} · ${browser}`,
    userAgent: session.userAgent.slice(0, 120),
    ip: session.ip,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.expiresAt,
  };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/otp/send', async (request, reply) => {
    const parsed = z
      .object({ phone: phoneSchema, scene: z.enum(['register', 'reset']) })
      .safeParse(request.body ?? {});
    if (!parsed.success) {
      return badRequest(reply, 'INVALID_INPUT', parsed.error.issues[0]?.message ?? '输入不合法');
    }
    const { phone, scene } = parsed.data;
    const limit = allowAuthAttempt(`otp-send:${scene}:${request.ip}:${phone}`, 6, 15 * 60_000);
    if (!limit.allowed) return tooMany(reply, limit.retryAfterSec);
    const bundle = findUserByPhone(phone);
    if (scene === 'register' && bundle) {
      // 不泄露手机号是否已注册，但也不会真的给已存在账号发码。
      return { ok: true, sent: true, cooldownSec: 60 };
    }
    if (scene === 'reset' && !bundle) {
      return { ok: true, sent: true, cooldownSec: 60 };
    }
    const result = await sendOtpChallenge({ phone, scene, userId: bundle?.auth.id });
    if (!result.ok) return reply.code(400).send({ ok: false, code: result.code, message: result.message });
    audit.append(
      'AUTH_OTP_SENT',
      scene === 'register' ? '注册短信验证码已发送' : '找回密码短信验证码已发送',
      { scene, provider: config.integration.sms.mode },
      { userId: bundle?.auth.id },
    );
    return { ok: true, sent: true, demoCode: result.demoCode, cooldownSec: result.cooldownSec };
  });

  app.post('/api/auth/register', async (request, reply) => {
    const body = (request.body ?? {}) as any;
    const parsed = z
      .object({
        name: nameSchema,
        phone: phoneSchema,
        password: passwordSchema,
        otpCode: codeSchema.optional(),
        spouseName: z.string().trim().max(20).optional().or(z.literal('')),
        spouseBirthday: birthdaySchema,
      })
      .safeParse(body);
    if (!parsed.success) {
      return badRequest(reply, 'INVALID_INPUT', parsed.error.issues[0]?.message ?? '输入不合法');
    }
    const { name, phone, password, otpCode, spouseName, spouseBirthday } = parsed.data;
    const limit = allowAuthAttempt(`register:${request.ip}`);
    if (!limit.allowed) return tooMany(reply, limit.retryAfterSec);
    if (findUserByPhone(phone)) {
      return reply.code(409).send({ ok: false, code: 'PHONE_EXISTS', message: '该手机号已注册，请直接登录' });
    }
    if (config.auth.requirePhoneVerify) {
      if (!otpCode) return badRequest(reply, 'OTP_REQUIRED', '请先获取并填写短信验证码');
      const verified = await verifyOtpChallenge({ scene: 'register', phone, code: otpCode });
      if (!verified.ok) {
        return reply.code(400).send({ ok: false, code: verified.code, message: verified.message });
      }
    }
    try {
      const bundle = createRegisteredUser({
        name,
        phone,
        password,
        spouseName,
        spouseBirthday,
      });
      const session = startAuthSession(reply, bundle.auth.id, request);
      enterAuditContext(bundle.auth.id);
      audit.append(
        'AUTH_REGISTER',
        '新用户完成手机号验证并注册',
        { isGuest: false, sessionId: session.id },
        { userId: bundle.auth.id },
      );
      return { ok: true, user: toPublicAuth(bundle.auth), created: true };
    } catch (error) {
      return reply.code(409).send({
        ok: false,
        code: 'REGISTER_FAILED',
        message: error instanceof Error && error.message === 'PHONE_EXISTS' ? '该手机号已注册' : '注册失败',
      });
    }
  });

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = z.object({ phone: phoneSchema, password: passwordSchema }).safeParse(request.body ?? {});
    if (!parsed.success) {
      return badRequest(reply, 'INVALID_INPUT', parsed.error.issues[0]?.message ?? '输入不合法');
    }
    const { phone, password } = parsed.data;
    const limit = allowAuthAttempt(`login:${request.ip}:${phone}`, 8, 15 * 60_000);
    if (!limit.allowed) return tooMany(reply, limit.retryAfterSec);
    const bundle = findUserByPhone(phone);
    if (!bundle || !verifyPassword(password, bundle.auth.passwordSalt, bundle.auth.passwordHash)) {
      return reply.code(401).send({ ok: false, code: 'INVALID_CREDENTIALS', message: '手机号或密码不正确' });
    }
    if (config.auth.loginMfa) {
      const challenge = await sendOtpChallenge({
        phone,
        scene: 'login',
        userId: bundle.auth.id,
      });
      if (!challenge.ok) {
        return reply.code(502).send({ ok: false, code: challenge.code, message: challenge.message });
      }
      enterAuditContext(bundle.auth.id);
      audit.append(
        'AUTH_MFA_SENT',
        '登录二次验证码已发送',
        { provider: config.integration.sms.mode },
        { userId: bundle.auth.id },
      );
      return {
        ok: false,
        mfaRequired: true,
        challengeId: challenge.challengeId,
        demoCode: challenge.demoCode,
        cooldownSec: challenge.cooldownSec,
      };
    }
    const session = startAuthSession(reply, bundle.auth.id, request);
    enterAuditContext(bundle.auth.id);
    audit.append('AUTH_LOGIN', '用户登录成功', { sessionId: session.id }, { userId: bundle.auth.id });
    return { ok: true, user: toPublicAuth(bundle.auth) };
  });

  app.post('/api/auth/login/mfa', async (request, reply) => {
    const parsed = z
      .object({ phone: phoneSchema, code: codeSchema, challengeId: z.string().max(80).optional() })
      .safeParse(request.body ?? {});
    if (!parsed.success) {
      return badRequest(reply, 'INVALID_INPUT', parsed.error.issues[0]?.message ?? '输入不合法');
    }
    const { phone, code, challengeId } = parsed.data;
    const limit = allowAuthAttempt(`login-mfa:${request.ip}:${phone}`, 8, 15 * 60_000);
    if (!limit.allowed) return tooMany(reply, limit.retryAfterSec);
    const bundle = findUserByPhone(phone);
    if (!bundle) {
      return reply.code(401).send({ ok: false, code: 'INVALID_CREDENTIALS', message: '登录状态已失效，请重新登录' });
    }
    const verified = await verifyOtpChallenge({ scene: 'login', phone, code, challengeId });
    if (!verified.ok) {
      return reply.code(401).send({ ok: false, code: verified.code, message: verified.message });
    }
    const session = startAuthSession(reply, bundle.auth.id, request);
    enterAuditContext(bundle.auth.id);
    audit.append('AUTH_MFA_SUCCESS', '登录二次验证通过', { sessionId: session.id }, { userId: bundle.auth.id });
    return { ok: true, user: toPublicAuth(bundle.auth) };
  });

  app.post('/api/auth/guest', async (request, reply) => {
    const limit = allowAuthAttempt(`guest:${request.ip}`, 12, 15 * 60_000);
    if (!limit.allowed) return tooMany(reply, limit.retryAfterSec);
    const bundle = createGuestUser();
    const session = startAuthSession(reply, bundle.auth.id, request);
    enterAuditContext(bundle.auth.id);
    audit.append('AUTH_GUEST', '访客体验账户创建', { isGuest: true, sessionId: session.id }, { userId: bundle.auth.id });
    return { ok: true, user: toPublicAuth(bundle.auth) };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const auth = readAuthSession(request);
    if (auth) {
      enterAuditContext(auth.user.id);
      revokeAuthSession(auth.session.id);
      audit.append('AUTH_LOGOUT', '用户退出登录', { sessionId: auth.session.id }, { userId: auth.user.id });
    }
    clearAuthCookieOnReply(reply);
    return { ok: true };
  });

  app.get('/api/auth/me', async (request, reply) => {
    const auth = readAuthSession(request);
    if (!auth) {
      return reply.code(401).send({ ok: false, code: 'AUTH_REQUIRED', message: '登录已失效，请重新登录' });
    }
    return { ok: true, user: toPublicAuth(auth.user), sessionId: auth.session.id };
  });

  app.post('/api/auth/password/reset/request', async (request, reply) => {
    const parsed = z.object({ phone: phoneSchema }).safeParse(request.body ?? {});
    if (!parsed.success) return badRequest(reply, 'INVALID_INPUT', '请输入 11 位手机号');
    const { phone } = parsed.data;
    const limit = allowAuthAttempt(`reset:${request.ip}:${phone}`, 5, 15 * 60_000);
    if (!limit.allowed) return tooMany(reply, limit.retryAfterSec);
    const bundle = findUserByPhone(phone);
    if (!bundle) return { ok: true, sent: true, cooldownSec: 60 };
    const result = await sendOtpChallenge({ phone, scene: 'reset', userId: bundle.auth.id });
    if (!result.ok) return reply.code(400).send({ ok: false, code: result.code, message: result.message });
    enterAuditContext(bundle.auth.id);
    audit.append('PASSWORD_RESET_SENT', '已发送找回密码验证码', {}, { userId: bundle.auth.id });
    return { ok: true, sent: true, demoCode: result.demoCode, cooldownSec: result.cooldownSec };
  });

  app.post('/api/auth/password/reset/verify', async (request, reply) => {
    const parsed = z.object({ phone: phoneSchema, code: codeSchema }).safeParse(request.body ?? {});
    if (!parsed.success) return badRequest(reply, 'INVALID_INPUT', '请输入手机号和 6 位验证码');
    const { phone, code } = parsed.data;
    const limit = allowAuthAttempt(`reset-verify:${request.ip}:${phone}`, 8, 15 * 60_000);
    if (!limit.allowed) return tooMany(reply, limit.retryAfterSec);
    const bundle = findUserByPhone(phone);
    if (!bundle) return reply.code(400).send({ ok: false, code: 'RESET_INVALID', message: '验证码或手机号不正确' });
    const verified = await verifyOtpChallenge({ scene: 'reset', phone, code });
    if (!verified.ok) return reply.code(400).send({ ok: false, code: verified.code, message: verified.message });
    const reset = issueResetToken(bundle.auth.id);
    enterAuditContext(bundle.auth.id);
    audit.append('PASSWORD_RESET_VERIFIED', '找回密码短信验证通过', {}, { userId: bundle.auth.id });
    return { ok: true, resetToken: reset.token, expiresAt: reset.expiresAt };
  });

  app.post('/api/auth/password/reset/confirm', async (request, reply) => {
    const parsed = z.object({ resetToken: z.string().min(10), password: passwordSchema }).safeParse(request.body ?? {});
    if (!parsed.success) return badRequest(reply, 'INVALID_INPUT', parsed.error.issues[0]?.message ?? '输入不合法');
    const consumed = consumeResetToken(parsed.data.resetToken);
    if (!consumed.ok) return reply.code(400).send({ ok: false, code: consumed.code, message: consumed.message });
    const bundle = getAuthUser(consumed.userId);
    if (!bundle) return reply.code(400).send({ ok: false, code: 'RESET_INVALID', message: '重置链接无效' });
    updateUserPassword(consumed.userId, parsed.data.password);
    const revoked = revokeUserSessions(consumed.userId);
    const session = startAuthSession(reply, consumed.userId, request);
    enterAuditContext(consumed.userId);
    audit.append('PASSWORD_RESET_COMPLETED', '密码重置成功，其他设备登录已失效', { revoked }, { userId: consumed.userId });
    const updated = getAuthUser(consumed.userId)!;
    return { ok: true, user: toPublicAuth(updated), revokedSessions: revoked, sessionId: session.id };
  });

  app.post('/api/auth/password/change', async (request, reply) => {
    const auth = readAuthSession(request);
    if (!auth) return reply.code(401).send({ ok: false, code: 'AUTH_REQUIRED', message: '登录已失效' });
    const parsed = z.object({ oldPassword: passwordSchema, newPassword: passwordSchema }).safeParse(request.body ?? {});
    if (!parsed.success) return badRequest(reply, 'INVALID_INPUT', '新密码至少 6 位');
    if (!verifyPassword(parsed.data.oldPassword, auth.user.passwordSalt, auth.user.passwordHash)) {
      return reply.code(401).send({ ok: false, code: 'INVALID_CREDENTIALS', message: '原密码不正确' });
    }
    updateUserPassword(auth.user.id, parsed.data.newPassword);
    const revoked = revokeUserSessions(auth.user.id, auth.session.id);
    enterAuditContext(auth.user.id);
    audit.append('PASSWORD_CHANGED', '密码修改成功，其他设备登录已失效', { revoked }, { userId: auth.user.id });
    return { ok: true, revokedSessions: revoked };
  });

  app.get('/api/auth/sessions', async (request, reply) => {
    const auth = readAuthSession(request);
    if (!auth) return reply.code(401).send({ ok: false, code: 'AUTH_REQUIRED', message: '登录已失效' });
    return {
      ok: true,
      sessions: listAuthSessions(auth.user.id).map((session) => publicSession(session, auth.session.id)),
    };
  });

  app.post('/api/auth/sessions/revoke', async (request, reply) => {
    const auth = readAuthSession(request);
    if (!auth) return reply.code(401).send({ ok: false, code: 'AUTH_REQUIRED', message: '登录已失效' });
    const sessionId = String((request.body as any)?.sessionId ?? '');
    const target = listAuthSessions(auth.user.id).find((session) => session.id === sessionId);
    if (!target) return reply.code(404).send({ ok: false, code: 'SESSION_NOT_FOUND', message: '登录设备不存在' });
    revokeAuthSession(sessionId);
    if (sessionId === auth.session.id) clearAuthCookieOnReply(reply);
    enterAuditContext(auth.user.id);
    audit.append('AUTH_SESSION_REVOKED', '用户撤销一台登录设备', { sessionId }, { userId: auth.user.id });
    return {
      ok: true,
      signedOut: sessionId === auth.session.id,
      sessions: listAuthSessions(auth.user.id).map((session) => publicSession(session, auth.session.id)),
    };
  });

  app.post('/api/auth/sessions/revoke-others', async (request, reply) => {
    const auth = readAuthSession(request);
    if (!auth) return reply.code(401).send({ ok: false, code: 'AUTH_REQUIRED', message: '登录已失效' });
    const revoked = revokeUserSessions(auth.user.id, auth.session.id);
    enterAuditContext(auth.user.id);
    audit.append('AUTH_SESSIONS_REVOKED', '用户撤销其他所有登录设备', { revoked }, { userId: auth.user.id });
    return {
      ok: true,
      revoked,
      sessions: listAuthSessions(auth.user.id).map((session) => publicSession(session, auth.session.id)),
      generatedAt: clock.nowIso(),
    };
  });
}
