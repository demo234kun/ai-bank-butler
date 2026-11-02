import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthUserPublic } from '@bank/shared';
import { config, ensureDirs } from '../config';
import { clock } from '../core/clock';
import {
  createAuthSession,
  getAuthSession,
  getAuthUser,
  getState,
  touchAuthSession,
  type AuthSession,
  type AuthUser,
} from '../core/store';
import { enterAuditContext } from './auditChain';

const COOKIE_NAME = 'bank_auth';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function loadSecret(): Buffer {
  const fromEnv = process.env.AUTH_SECRET;
  if (fromEnv && fromEnv.length >= 32) return Buffer.from(fromEnv, 'utf8');
  ensureDirs();
  const file = path.join(config.runtimeDir, 'auth-secret');
  try {
    if (fs.existsSync(file)) {
      const existing = fs.readFileSync(file, 'utf8').trim();
      if (existing.length >= 32) return Buffer.from(existing, 'utf8');
    }
    const generated = randomBytes(32).toString('hex');
    fs.writeFileSync(file, generated, { mode: 0o600 });
    return Buffer.from(generated, 'utf8');
  } catch {
    return Buffer.from('demo-bank-local-secret-change-in-production', 'utf8');
  }
}

const SECRET = loadSecret();

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export interface AuthTokenPayload {
  uid: string;
  sid: string;
  iat: number;
  exp: number;
}

export function signAuthToken(userId: string, sessionId: string): string {
  const payload = b64url(
    JSON.stringify({
      uid: userId,
      sid: sessionId,
      iat: Date.now(),
      exp: Date.now() + TOKEN_TTL_MS,
    } satisfies AuthTokenPayload),
  );
  const signature = createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyAuthToken(token: string): AuthTokenPayload | null {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', SECRET).update(payload).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<AuthTokenPayload>;
    if (!parsed.uid || !parsed.sid || !parsed.exp || parsed.exp < Date.now()) return null;
    return parsed as AuthTokenPayload;
  } catch {
    return null;
  }
}

function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=');
    if (index < 0) continue;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function readAuthSession(request: FastifyRequest): { user: AuthUser; session: AuthSession } | null {
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  const payload = verifyAuthToken(token);
  if (!payload) return null;
  const session = getAuthSession(payload.sid);
  if (!session || session.userId !== payload.uid || session.id !== payload.sid) return null;
  const user = getAuthUser(session.userId);
  if (!user) return null;
  touchAuthSession(session.id);
  return { user, session };
}

export function readAuthUser(request: FastifyRequest): AuthUser | null {
  return readAuthSession(request)?.user ?? null;
}

export function authCookie(userId: string, sessionId: string): string {
  const attributes = [
    `${COOKIE_NAME}=${encodeURIComponent(signAuthToken(userId, sessionId))}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(TOKEN_TTL_MS / 1000)}`,
  ];
  if (config.cookieSecure) attributes.push('Secure');
  return attributes.join('; ');
}

export function clearAuthCookie(): string {
  const attributes = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (config.cookieSecure) attributes.push('Secure');
  return attributes.join('; ');
}

export function startAuthSession(
  reply: FastifyReply,
  userId: string,
  request: FastifyRequest,
): AuthSession {
  const session = createAuthSession(userId, {
    userAgent: request.headers['user-agent'],
    ip: request.ip,
  });
  reply.header('Set-Cookie', authCookie(userId, session.id));
  return session;
}

export function clearAuthCookieOnReply(reply: FastifyReply): void {
  reply.header('Set-Cookie', clearAuthCookie());
}

export function toPublicAuth(user: AuthUser): AuthUserPublic {
  const bank = getState(user.id);
  return {
    id: user.id,
    name: user.name,
    phoneMasked: user.phoneMasked,
    spouseName: user.spouseName,
    spouseBirthday: user.spouseBirthday,
    riskLevel: user.riskLevel,
    tier: bank.user.tier,
    isGuest: user.isGuest,
    createdAt: user.createdAt,
  };
}

/** 登录/注册/游客接口的简单内存限流；生产应换 Redis/网关限流。 */
const attemptBuckets = new Map<string, { count: number; resetAt: number }>();

export function allowAuthAttempt(
  key: string,
  max = 12,
  windowMs = 15 * 60_000,
): { allowed: boolean; retryAfterSec: number } {
  const now = clock.wallNow().getTime();
  let bucket = attemptBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    attemptBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > max) {
    return { allowed: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

/** 所有非公开 API 的统一登录态检查 */
export async function authHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const pathname = request.url.split('?')[0] ?? '';
  if (!pathname.startsWith('/api/')) return;
  const publicPath =
    pathname.startsWith('/api/auth/') ||
    pathname === '/api/health' ||
    pathname === '/api/public/config' ||
    pathname === '/api/auth';
  const auth = readAuthSession(request);
  if (auth) {
    request.authUser = auth.user;
    request.authSession = auth.session;
    enterAuditContext(auth.user.id);
  }
  if (publicPath) return;
  if (!auth) {
    await reply.code(401).send({
      ok: false,
      code: 'AUTH_REQUIRED',
      message: '登录已失效，请重新登录',
    });
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser;
    authSession?: AuthSession;
  }
}
