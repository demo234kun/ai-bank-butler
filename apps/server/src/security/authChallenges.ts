import { randomUUID } from 'node:crypto';
import { clock } from '../core/clock';
import { otpProvider } from '../integration/verification';

export type OtpScene = 'register' | 'reset' | 'login';

interface OtpChallenge {
  id: string;
  phone: string;
  scene: OtpScene;
  userId?: string;
  requestId: string;
  createdAt: number;
  expiresAt: number;
  attemptsLeft: number;
}

const challenges = new Map<string, OtpChallenge>();
const resetTokens = new Map<string, { userId: string; expiresAt: number }>();
const TTL_MS = 5 * 60_000;
const RESET_TTL_MS = 5 * 60_000;

function cleanup(): void {
  const now = Date.now();
  for (const [id, challenge] of challenges) {
    if (challenge.expiresAt < now) challenges.delete(id);
  }
  for (const [token, value] of resetTokens) {
    if (value.expiresAt < now) resetTokens.delete(token);
  }
}

export async function sendOtpChallenge(input: {
  phone: string;
  scene: OtpScene;
  userId?: string;
}): Promise<{ ok: boolean; code?: string; message?: string; challengeId?: string; demoCode?: string; cooldownSec?: number }> {
  cleanup();
  const key = `${input.scene}:${input.phone}`;
  for (const challenge of challenges.values()) {
    if (challenge.scene === input.scene && challenge.phone === input.phone) {
      const waitSec = Math.ceil((challenge.createdAt + 60_000 - Date.now()) / 1000);
      if (waitSec > 0) {
        return { ok: false, code: 'OTP_COOLDOWN', message: `验证码发送过于频繁，请 ${waitSec} 秒后再试`, cooldownSec: waitSec };
      }
      challenges.delete(challenge.id);
    }
  }
  try {
    const sent = await otpProvider.send({
      externalRef: `otp_${key}`,
      phone: input.phone,
      scene: input.scene,
      reference: key,
      expiresInSec: 300,
    });
    const challenge: OtpChallenge = {
      id: `otp_${randomUUID().slice(0, 10)}`,
      phone: input.phone,
      scene: input.scene,
      userId: input.userId,
      requestId: sent.requestId,
      createdAt: Date.now(),
      expiresAt: Date.now() + TTL_MS,
      attemptsLeft: 3,
    };
    challenges.set(challenge.id, challenge);
    return {
      ok: true,
      challengeId: challenge.id,
      demoCode: sent.demoCode,
      cooldownSec: 60,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, code: 'OTP_SEND_FAILED', message: `验证码发送失败：${message}` };
  }
}

export async function verifyOtpChallenge(input: {
  scene: OtpScene;
  phone: string;
  code: string;
  challengeId?: string;
}): Promise<{ ok: boolean; code?: string; message?: string; challenge?: OtpChallenge }> {
  cleanup();
  const candidates = [...challenges.values()]
    .filter((challenge) => challenge.scene === input.scene && challenge.phone === input.phone)
    .sort((a, b) => b.createdAt - a.createdAt);
  const challenge = input.challengeId
    ? candidates.find((item) => item.id === input.challengeId)
    : candidates[0];
  if (!challenge) return { ok: false, code: 'OTP_NOT_SENT', message: '请先获取短信验证码' };
  if (challenge.expiresAt < Date.now()) {
    challenges.delete(challenge.id);
    return { ok: false, code: 'OTP_EXPIRED', message: '验证码已过期，请重新获取' };
  }
  if (challenge.attemptsLeft <= 0) {
    challenges.delete(challenge.id);
    return { ok: false, code: 'OTP_ATTEMPTS_EXHAUSTED', message: '验证码错误次数过多，请重新获取' };
  }
  try {
    const result = await otpProvider.verify({
      requestId: challenge.requestId,
      reference: `${challenge.scene}:${challenge.phone}`,
      code: input.code,
    });
    if (!result.ok) {
      challenge.attemptsLeft -= 1;
      const fatal = challenge.attemptsLeft <= 0;
      return {
        ok: false,
        code: fatal ? 'OTP_ATTEMPTS_EXHAUSTED' : 'OTP_INVALID',
        message: fatal ? '验证码错误次数过多，请重新获取' : '验证码不正确',
      };
    }
    challenges.delete(challenge.id);
    return { ok: true, challenge };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, code: 'OTP_VERIFY_FAILED', message: `验证码校验失败：${message}` };
  }
}

export function issueResetToken(userId: string): { token: string; expiresAt: string } {
  cleanup();
  const token = `rst_${randomUUID().replace(/-/g, '')}`;
  const expiresAt = Date.now() + RESET_TTL_MS;
  resetTokens.set(token, { userId, expiresAt });
  return { token, expiresAt: new Date(expiresAt).toISOString() };
}

export function consumeResetToken(token: string): { ok: true; userId: string } | { ok: false; code: string; message: string } {
  cleanup();
  const value = resetTokens.get(token);
  if (!value) return { ok: false, code: 'RESET_INVALID', message: '重置链接无效或已过期' };
  resetTokens.delete(token);
  return { ok: true, userId: value.userId };
}

export function resetAuthChallenges(): void {
  challenges.clear();
  resetTokens.clear();
}
