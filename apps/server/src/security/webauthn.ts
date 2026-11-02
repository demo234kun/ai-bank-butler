import { randomBytes } from 'node:crypto';
import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import type { FastifyRequest } from 'fastify';
import { BRAND } from '@bank/shared';
import type { AuthUser, WebAuthnCredential } from '../core/store';

/** 挑战只在内存里存活 5 分钟，且一次性使用。 */
const PENDING_TTL_MS = 5 * 60_000;

interface PendingRegistration {
  userId: string;
  createdAt: number;
}

interface PendingAssertion {
  userId: string;
  challengeId: string;
  sessionId: string;
  credentialId: string;
  createdAt: number;
}

const pendingRegistrations = new Map<string, PendingRegistration>();
const pendingAssertions = new Map<string, PendingAssertion>();

function newChallenge(): string {
  return randomBytes(32).toString('base64url');
}

function prune<T extends { createdAt: number }>(map: Map<string, T>): void {
  const now = Date.now();
  for (const [key, value] of map) {
    if (now - value.createdAt > PENDING_TTL_MS) map.delete(key);
  }
}

/**
 * rpId 取当前访问域名，origin 必须与 Host 一致，避免跨站伪造。
 * 公网隧道换域名后需要重新注册通行密钥，这是 WebAuthn 的设计而非缺陷。
 */
export function relyingParty(request: FastifyRequest): { rpId: string; origin: string } {
  const host = String(request.headers.host ?? '').split(':')[0];
  const origin = String(request.headers.origin ?? '');
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (parsed.hostname === host) return { rpId: host, origin: parsed.origin };
    } catch {
      // fallthrough
    }
  }
  const proto = request.headers['x-forwarded-proto'] === 'https' ? 'https' : request.protocol;
  return { rpId: host, origin: `${proto}://${host}` };
}

export function webauthnEnabled(): boolean {
  return process.env.WEBAUTHN_STEPUP !== '0';
}

export async function createRegistrationOptions(user: AuthUser, request: FastifyRequest) {
  const { rpId, origin } = relyingParty(request);
  const options = await generateRegistrationOptions({
    rpName: BRAND.name,
    rpID: rpId,
    userName: user.phoneMasked,
    userDisplayName: user.name,
    attestationType: 'none',
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'required',
      residentKey: 'preferred',
    },
    excludeCredentials: (user.webauthn ?? []).map((credential) => ({
      id: credential.id,
      type: 'public-key' as const,
      transports: credential.transports as AuthenticatorTransportFuture[] | undefined,
    })),
  });
  pendingRegistrations.set(options.challenge, { userId: user.id, createdAt: Date.now() });
  prune(pendingRegistrations);
  return { options, origin, rpId };
}

export async function completeRegistration(input: {
  response: RegistrationResponseJSON;
  challenge: string;
  request: FastifyRequest;
  userId: string;
  label: string;
}): Promise<WebAuthnCredential> {
  const { origin, rpId } = relyingParty(input.request);
  const pending = pendingRegistrations.get(input.challenge);
  if (!pending || pending.userId !== input.userId) {
    throw Object.assign(new Error('注册挑战已过期，请重新发起'), { code: 'WEBAUTHN_CHALLENGE_EXPIRED' });
  }
  const verification = await verifyRegistrationResponse({
    response: input.response,
    expectedChallenge: input.challenge,
    expectedOrigin: origin,
    expectedRPID: rpId,
    requireUserVerification: true,
  });
  if (!verification.verified || !verification.registrationInfo) {
    pendingRegistrations.delete(input.challenge);
    throw Object.assign(new Error('通行密钥注册未通过校验'), { code: 'WEBAUTHN_REGISTRATION_FAILED' });
  }
  const info = verification.registrationInfo as unknown as {
    credential: { id: string; publicKey: ArrayBuffer | string; counter: number };
  };
  pendingRegistrations.delete(input.challenge);
  const transports = Array.from(
    new Set((input.response.response as unknown as { transports?: string[] }).transports ?? []),
  );
  return {
    id: info.credential.id,
    publicKey:
      typeof info.credential.publicKey === 'string'
        ? info.credential.publicKey
        : Buffer.from(info.credential.publicKey).toString('base64url'),
    counter: Number(info.credential.counter ?? 0),
    registeredAt: new Date().toISOString(),
    label: input.label.slice(0, 40),
    transports,
  };
}

export async function createAssertionOptions(user: AuthUser, request: FastifyRequest, stepUp: { challengeId: string; sessionId: string }) {
  const { rpId, origin } = relyingParty(request);
  const credentials = user.webauthn ?? [];
  if (!credentials.length) {
    throw Object.assign(new Error('尚未录入本机生物识别'), { code: 'WEBAUTHN_NOT_REGISTERED' });
  }
  const options = await generateAuthenticationOptions({
    rpID: rpId,
    userVerification: 'required',
    allowCredentials: credentials.map((credential) => ({
      id: credential.id,
      type: 'public-key' as const,
      transports: credential.transports as AuthenticatorTransportFuture[] | undefined,
    })),
  });
  pendingAssertions.set(options.challenge, {
    userId: user.id,
    challengeId: stepUp.challengeId,
    sessionId: stepUp.sessionId,
    credentialId: '',
    createdAt: Date.now(),
  });
  prune(pendingAssertions);
  return { options, origin, rpId };
}

export async function completeAssertion(input: {
  response: AuthenticationResponseJSON;
  request: FastifyRequest;
  userId: string;
  challengeId: string;
  sessionId: string;
  credentials: WebAuthnCredential[];
}): Promise<{ credentialId: string; counter: number; verified: true }> {
  const { origin, rpId } = relyingParty(input.request);
  const entry = [...pendingAssertions.entries()].find(
    ([, value]) => value.userId === input.userId && value.challengeId === input.challengeId,
  );
  if (!entry) {
    throw Object.assign(new Error('生物识别挑战已过期，请重新发起'), { code: 'WEBAUTHN_CHALLENGE_EXPIRED' });
  }
  const [challenge, pending] = entry;
  const credential = input.credentials.find((item) => item.id === input.response.id);
  if (!credential) {
    throw Object.assign(new Error('该通行密钥不属于当前账号'), { code: 'WEBAUTHN_CREDENTIAL_UNKNOWN' });
  }
  const verification = await verifyAuthenticationResponse({
    response: input.response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpId,
    expectedType: 'get',
    requireUserVerification: true,
    credential: {
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey, 'base64url'),
      counter: credential.counter ?? 0,
      transports: credential.transports as AuthenticatorTransportFuture[],
    },
  });
  if (!verification.verified) {
    throw Object.assign(new Error('生物识别签名校验未通过'), { code: 'WEBAUTHN_ASSERTION_FAILED' });
  }
  pendingAssertions.delete(challenge);
  return {
    credentialId: credential.id,
    counter: Number(verification.authenticationInfo?.newCounter ?? credential.counter ?? 0),
    verified: true,
  };
}

export function dropPendingForChallenge(challengeId: string): void {
  for (const [key, value] of pendingAssertions) {
    if (value.challengeId === challengeId) pendingAssertions.delete(key);
  }
}

export function resetWebAuthnState(): void {
  pendingRegistrations.clear();
  pendingAssertions.clear();
}
