import { randomUUID } from 'node:crypto';
import {
  HIGH_VALUE_CENTS,
  STEPUP_MAX_ATTEMPTS,
  STEPUP_TTL_MS,
  type StepUpChallenge,
  type ToolName,
} from '@bank/shared';
import { config } from '../config';
import { clock } from '../core/clock';
import { getAuthUser } from '../core/store';
import { externalRefFor } from '../integration/ids';
import { faceProvider, otpProvider } from '../integration/verification';
import { audit } from '../security/auditChain';

export interface ChallengeRecord extends StepUpChallenge {
  sessionId: string;
  userId: string;
  tool: ToolName;
  amountCents?: number;
  faceVerified: boolean;
  smsVerified: boolean;
  bioVerified: boolean;
  bioCredentialId?: string;
  completed: boolean;
  phone: string;
  externalRef: string;
  otpRequestId?: string;
  otpSentAt?: number;
  faceStartedAt?: number;
}

const challenges = new Map<string, ChallengeRecord>();

function methodsFor(tool: ToolName, amountCents?: number): Array<'FACE' | 'SMS'> {
  const needsSms =
    (amountCents ?? 0) > HIGH_VALUE_CENTS || tool === 'report_loss' || tool === 'unfreeze_card';
  return needsSms ? ['FACE', 'SMS'] : ['FACE'];
}

export function toPublicChallenge(record: ChallengeRecord): StepUpChallenge {
  return {
    id: record.id,
    nodeId: record.nodeId,
    digest: record.digest,
    methods: [...record.methods],
    expiresAt: record.expiresAt,
    attemptsLeft: record.attemptsLeft,
    faceMode: record.faceMode,
    smsMode: record.smsMode,
    smsSent: Boolean(record.otpRequestId),
    faceSessionId: record.faceSessionId,
    faceVerifyUrl: record.faceVerifyUrl,
    bioAvailable: record.methods.includes('FACE') && config.auth.webauthnStepUp,
    bioVerified: record.bioVerified,
  };
}

export function createStepUpChallenge(input: {
  userId: string;
  sessionId: string;
  nodeId: string;
  digest: string;
  tool: ToolName;
  amountCents?: number;
}): ChallengeRecord {
  const auth = getAuthUser(input.userId);
  if (!auth) throw new Error('USER_NOT_FOUND');
  const now = clock.wallNow();
  const record: ChallengeRecord = {
    id: `chal_${randomUUID().slice(0, 8)}`,
    sessionId: input.sessionId,
    userId: input.userId,
    nodeId: input.nodeId,
    digest: input.digest,
    tool: input.tool,
    amountCents: input.amountCents,
    methods: methodsFor(input.tool, input.amountCents),
    expiresAt: new Date(now.getTime() + STEPUP_TTL_MS).toISOString(),
    attemptsLeft: STEPUP_MAX_ATTEMPTS,
    faceVerified: false,
    smsVerified: false,
    bioVerified: false,
    completed: false,
    phone: auth.phone,
    externalRef: externalRefFor(input.userId),
    faceMode: faceProvider.mode,
    smsMode: otpProvider.mode,
  };
  challenges.set(record.id, record);
  return record;
}

export function getChallenge(id: string): ChallengeRecord | undefined {
  return challenges.get(id);
}

function validateChallenge(
  challengeId: string,
  sessionId: string,
): { ok: true; record: ChallengeRecord } | { ok: false; code: string; message: string } {
  const record = challenges.get(challengeId);
  if (!record) return { ok: false, code: 'CHALLENGE_NOT_FOUND', message: '验证挑战不存在' };
  if (record.sessionId !== sessionId) {
    return { ok: false, code: 'CHALLENGE_MISMATCH', message: '验证挑战与会话不匹配' };
  }
  if (record.completed) return { ok: false, code: 'CHALLENGE_USED', message: '验证挑战已使用' };
  if (new Date(record.expiresAt).getTime() <= clock.wallNow().getTime()) {
    return { ok: false, code: 'CHALLENGE_EXPIRED', message: '验证挑战已过期' };
  }
  return { ok: true, record };
}

export interface SendStepUpCodeResult {
  ok: boolean;
  code?: string;
  message?: string;
  demoCode?: string;
  cooldownSec?: number;
  expiresAt?: string;
}

export async function sendStepUpCode(
  challengeId: string,
  sessionId: string,
): Promise<SendStepUpCodeResult> {
  const checked = validateChallenge(challengeId, sessionId);
  if (!checked.ok) return { ok: false, code: checked.code, message: checked.message };
  const record = checked.record;
  if (!record.methods.includes('SMS')) {
    return { ok: false, code: 'SMS_NOT_REQUIRED', message: '本次操作无需短信验证' };
  }
  const cooldownMs = Math.max(1000, config.integration.sms.resendCooldownMs);
  if (record.otpSentAt && Date.now() - record.otpSentAt < cooldownMs) {
    return {
      ok: false,
      code: 'SMS_COOLDOWN',
      message: `验证码发送过于频繁，请 ${Math.ceil((cooldownMs - (Date.now() - record.otpSentAt)) / 1000)} 秒后再试`,
      cooldownSec: Math.ceil((cooldownMs - (Date.now() - record.otpSentAt)) / 1000),
    };
  }
  try {
    const sent = await otpProvider.send({
      externalRef: record.externalRef,
      phone: record.phone,
      scene: 'stepup',
      reference: record.id,
      expiresInSec: 5 * 60,
    });
    record.otpRequestId = sent.requestId;
    record.otpSentAt = Date.now();
    record.smsSent = true;
    audit.append(
      'STEPUP_OTP_SENT',
      '强验证短信验证码已发送',
      {
        challengeId: record.id,
        provider: otpProvider.mode,
        scene: 'stepup',
      },
      { sessionId: record.sessionId, runId: undefined },
    );
    return {
      ok: true,
      demoCode: sent.demoCode,
      cooldownSec: Math.ceil(cooldownMs / 1000),
      expiresAt: record.expiresAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    audit.append(
      'STEPUP_OTP_FAILED',
      '短信验证码发送失败',
      { challengeId: record.id, error: message },
      { sessionId: record.sessionId, runId: undefined },
    );
    return { ok: false, code: 'SMS_SEND_FAILED', message: '验证码发送失败，请稍后重试' };
  }
}

export interface FaceStartResponse {
  ok: boolean;
  code?: string;
  message?: string;
  mode?: 'demo' | 'http';
  verifyUrl?: string;
  sessionId?: string;
  expiresAt?: string;
}

export async function startFaceVerification(
  challengeId: string,
  sessionId: string,
  returnUrl?: string,
): Promise<FaceStartResponse> {
  const checked = validateChallenge(challengeId, sessionId);
  if (!checked.ok) return { ok: false, code: checked.code, message: checked.message };
  const record = checked.record;
  if (!record.methods.includes('FACE')) {
    return { ok: false, code: 'FACE_NOT_REQUIRED', message: '本次操作无需人脸核验' };
  }
  if (faceProvider.mode === 'demo') {
    return { ok: true, mode: 'demo' };
  }
  if (record.faceStartedAt && Date.now() - record.faceStartedAt < 15_000) {
    return {
      ok: false,
      code: 'FACE_COOLDOWN',
      message: `人脸核验会话创建过于频繁，请 ${Math.ceil((15_000 - (Date.now() - record.faceStartedAt)) / 1000)} 秒后再试`,
    };
  }
  try {
    const started = await faceProvider.start({
      externalRef: record.externalRef,
      reference: record.id,
      returnUrl,
    });
    record.faceSessionId = started.sessionId;
    record.faceVerifyUrl = started.verifyUrl;
    record.faceStartedAt = Date.now();
    audit.append(
      'STEPUP_FACE_STARTED',
      '已创建人脸核验会话',
      { challengeId: record.id, provider: faceProvider.mode },
      { sessionId: record.sessionId, runId: undefined },
    );
    return {
      ok: true,
      mode: 'http',
      verifyUrl: started.verifyUrl,
      sessionId: started.sessionId,
      expiresAt: started.expiresAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, code: 'FACE_START_FAILED', message: `人脸核验服务不可用：${message}` };
  }
}

export interface FaceStatusResponse {
  ok: boolean;
  code?: string;
  message?: string;
  status?: 'pending' | 'passed' | 'failed' | 'expired';
}

export async function checkFaceVerification(
  challengeId: string,
  sessionId: string,
): Promise<FaceStatusResponse> {
  const checked = validateChallenge(challengeId, sessionId);
  if (!checked.ok) return { ok: false, code: checked.code, message: checked.message };
  const record = checked.record;
  if (!record.methods.includes('FACE')) {
    return { ok: false, code: 'FACE_NOT_REQUIRED', message: '本次操作无需人脸核验' };
  }
  if (faceProvider.mode === 'demo') {
    record.faceVerified = true;
    return { ok: true, status: 'passed' };
  }
  if (!record.faceSessionId) {
    return { ok: true, status: 'pending' };
  }
  try {
    const result = await faceProvider.status(record.faceSessionId);
    if (result.status === 'passed') {
      record.faceVerified = true;
      audit.append(
        'STEPUP_FACE_PASSED',
        '人脸核验通过',
        { challengeId: record.id, score: result.score, provider: faceProvider.mode },
        { sessionId: record.sessionId, runId: undefined },
      );
    }
    return { ok: true, status: result.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, code: 'FACE_STATUS_FAILED', message: `查询人脸核验结果失败：${message}` };
  }
}

export interface StepUpVerification {
  ok: boolean;
  error?: string;
  attemptsLeft: number;
  fatal: boolean;
  methods?: Array<'FACE' | 'SMS'>;
  record?: ChallengeRecord;
}

export async function verifyStepUp(
  challengeId: string,
  input: { faceDone?: boolean; smsCode?: string },
): Promise<StepUpVerification> {
  const record = challenges.get(challengeId);
  if (!record) return { ok: false, error: 'CHALLENGE_NOT_FOUND', attemptsLeft: 0, fatal: true };
  if (record.completed) return { ok: false, error: 'CHALLENGE_USED', attemptsLeft: 0, fatal: true };
  if (new Date(record.expiresAt).getTime() <= clock.wallNow().getTime()) {
    return { ok: false, error: 'CHALLENGE_EXPIRED', attemptsLeft: 0, fatal: true };
  }

  if (record.methods.includes('FACE')) {
    if (record.bioVerified) {
      // 本机生物识别已由服务端校验过签名与计数器，等价于人脸因子且更强
    } else if (record.faceMode === 'demo') {
      if (input.faceDone) record.faceVerified = true;
    } else if (!record.faceVerified) {
      const status = await checkFaceVerification(challengeId, record.sessionId);
      if (!status.ok) {
        return {
          ok: false,
          error: status.code ?? 'FACE_STATUS_FAILED',
          attemptsLeft: record.attemptsLeft,
          fatal: false,
          methods: record.methods,
        };
      }
      if (status.status === 'failed' || status.status === 'expired') {
        return {
          ok: false,
          error: status.status === 'expired' ? 'CHALLENGE_EXPIRED' : 'FACE_FAILED',
          attemptsLeft: record.attemptsLeft,
          fatal: status.status === 'expired',
          methods: record.methods,
        };
      }
    }
    if (!record.faceVerified) {
      return {
        ok: false,
        error: 'FACE_REQUIRED',
        attemptsLeft: record.attemptsLeft,
        fatal: false,
        methods: record.methods,
      };
    }
  }

  if (record.methods.includes('SMS')) {
    if (!input.smsCode) {
      return {
        ok: false,
        error: 'SMS_REQUIRED',
        attemptsLeft: record.attemptsLeft,
        fatal: false,
        methods: record.methods,
      };
    }
    if (!record.otpRequestId) {
      return {
        ok: false,
        error: 'SMS_NOT_SENT',
        attemptsLeft: record.attemptsLeft,
        fatal: false,
        methods: record.methods,
      };
    }
    try {
      const result = await otpProvider.verify({
        requestId: record.otpRequestId,
        reference: record.id,
        code: input.smsCode,
      });
      if (!result.ok) {
        record.attemptsLeft =
          typeof result.attemptsLeft === 'number'
            ? Math.min(record.attemptsLeft - 1, result.attemptsLeft)
            : record.attemptsLeft - 1;
        const fatal = record.attemptsLeft <= 0;
        return {
          ok: false,
          error: fatal
            ? 'SMS_ATTEMPTS_EXHAUSTED'
            : result.reason === 'SMS_EXPIRED'
              ? 'SMS_EXPIRED'
              : 'SMS_INVALID',
          attemptsLeft: Math.max(0, record.attemptsLeft),
          fatal,
          methods: record.methods,
        };
      }
      record.smsVerified = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: 'SMS_VERIFY_FAILED',
        attemptsLeft: record.attemptsLeft,
        fatal: false,
        methods: record.methods,
      };
    }
  }

  record.completed = true;
  return { ok: true, attemptsLeft: record.attemptsLeft, fatal: false, methods: record.methods, record };
}

/** 生物识别（WebAuthn）通过：把 FACE 因子标记为已满足，并留痕。 */
export function markBioVerified(challengeId: string, credentialId: string): void {
  const record = challenges.get(challengeId);
  if (!record) return;
  record.bioVerified = true;
  record.bioCredentialId = credentialId;
  audit.append(
    'STEPUP_BIO_PASSED',
    '本机生物识别校验通过',
    { challengeId, credentialId, digest: record.digest },
    { sessionId: record.sessionId, userId: record.userId },
  );
}

export function cleanupChallenges(): void {
  const now = clock.wallNow().getTime();
  for (const [id, record] of challenges) {
    if (new Date(record.expiresAt).getTime() < now - 5 * 60_000) challenges.delete(id);
  }
}

export function resetChallengesForSessions(sessionIds: string[]): void {
  const set = new Set(sessionIds);
  for (const [id, challenge] of challenges) {
    if (set.has(challenge.sessionId)) challenges.delete(id);
  }
}

export function resetChallenges(): void {
  challenges.clear();
}
