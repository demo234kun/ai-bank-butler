import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { config } from '../config';
import { clock } from '../core/clock';
import { IntegrationError, SignedHttpClient } from './httpClient';

export interface OtpSendInput {
  externalRef: string;
  phone: string;
  scene: 'stepup' | 'register' | 'login' | 'reset';
  reference: string;
  expiresInSec: number;
}

export interface OtpSendResult {
  requestId: string;
  demoCode?: string;
}

export interface OtpVerifyInput {
  requestId: string;
  reference: string;
  code: string;
}

export interface OtpVerifyResult {
  ok: boolean;
  attemptsLeft?: number;
  reason?: string;
}

export interface OtpProvider {
  readonly mode: 'demo' | 'http';
  send(input: OtpSendInput): Promise<OtpSendResult>;
  verify(input: OtpVerifyInput): Promise<OtpVerifyResult>;
}

export interface FaceStartInput {
  externalRef: string;
  reference: string;
  returnUrl?: string;
}

export interface FaceStartResult {
  sessionId: string;
  verifyUrl?: string;
  expiresAt: string;
  demo?: boolean;
}

export interface FaceStatusResult {
  status: 'pending' | 'passed' | 'failed' | 'expired';
  score?: number;
}

export interface FaceProvider {
  readonly mode: 'demo' | 'http';
  start(input: FaceStartInput): Promise<FaceStartResult>;
  status(sessionId: string): Promise<FaceStatusResult>;
}

/**
 * 演示通道：不再使用万能固定码，而是一次一码的随机验证码，
 * 由服务端内存保存 5 分钟并在校验成功后立即作废——与真实短信通道的语义一致，
 * 差别只在于验证码直接回传给页面自动填入（生产接 SMS_MODE=http 后不再回传）。
 */
const demoCodes = new Map<string, { code: string; expiresAt: number }>();
const DEMO_CODE_TTL_MS = 5 * 60_000;

function issueDemoCode(reference: string): { requestId: string; code: string } {
  const requestId = `otp_demo_${Date.now().toString(36)}_${reference.slice(-6)}`;
  const code = String(Math.floor(100_000 + Math.random() * 900_000));
  demoCodes.set(requestId, { code, expiresAt: Date.now() + DEMO_CODE_TTL_MS });
  if (demoCodes.size > 500) {
    const now = Date.now();
    for (const [key, value] of demoCodes) {
      if (value.expiresAt < now) demoCodes.delete(key);
    }
  }
  return { requestId, code };
}

class DemoOtpProvider implements OtpProvider {
  readonly mode = 'demo' as const;

  async send(input: OtpSendInput): Promise<OtpSendResult> {
    const issued = issueDemoCode(input.reference);
    return { requestId: issued.requestId, demoCode: issued.code };
  }

  async verify(input: OtpVerifyInput): Promise<OtpVerifyResult> {
    const entry = input.requestId ? demoCodes.get(input.requestId) : undefined;
    if (!entry) return { ok: false, reason: 'SMS_NOT_SENT' };
    if (entry.expiresAt < Date.now()) {
      demoCodes.delete(input.requestId);
      return { ok: false, reason: 'SMS_EXPIRED' };
    }
    if (entry.code !== input.code) return { ok: false, reason: 'SMS_INVALID' };
    demoCodes.delete(input.requestId);
    return { ok: true };
  }
}

class HttpOtpProvider implements OtpProvider {
  readonly mode = 'http' as const;
  private readonly client: SignedHttpClient;

  constructor(options: { baseUrl: string; appId: string; appSecret: string; timeoutMs: number }) {
    this.client = new SignedHttpClient({
      baseUrl: options.baseUrl,
      appId: options.appId,
      appSecret: options.appSecret,
      timeoutMs: options.timeoutMs,
      retries: 1,
    });
  }

  async send(input: OtpSendInput): Promise<OtpSendResult> {
    const data = await this.client.request<{ requestId?: string }>(
      'POST',
      '/v1/otp/send',
      {
        body: input,
        idempotencyKey: `otp_send_${input.reference}_${Math.floor(Date.now() / 60_000)}`,
      },
    );
    if (!data.requestId) {
      throw new IntegrationError('SMS_BAD_RESPONSE', '短信服务未返回 requestId');
    }
    return { requestId: data.requestId };
  }

  async verify(input: OtpVerifyInput): Promise<OtpVerifyResult> {
    const data = await this.client.request<{
      ok?: boolean;
      attemptsLeft?: number;
      reason?: string;
    }>('POST', '/v1/otp/verify', {
      body: input,
      idempotencyKey: `otp_verify_${input.requestId}_${createHash('sha256').update(input.code).digest('hex').slice(0, 12)}`,
    });
    return {
      ok: Boolean(data.ok),
      attemptsLeft:
        typeof data.attemptsLeft === 'number'
          ? Math.max(0, Math.floor(data.attemptsLeft))
          : undefined,
      reason: data.reason,
    };
  }
}

class DemoFaceProvider implements FaceProvider {
  readonly mode = 'demo' as const;

  async start(): Promise<FaceStartResult> {
    return {
      sessionId: `face_demo_${randomUUID().slice(0, 8)}`,
      expiresAt: new Date(clock.wallNow().getTime() + 5 * 60_000).toISOString(),
      demo: true,
    };
  }

  async status(): Promise<FaceStatusResult> {
    return { status: 'passed', score: 0.99 };
  }
}

class HttpFaceProvider implements FaceProvider {
  readonly mode = 'http' as const;
  private readonly client: SignedHttpClient;

  constructor(options: { baseUrl: string; appId: string; appSecret: string; timeoutMs: number }) {
    this.client = new SignedHttpClient({
      baseUrl: options.baseUrl,
      appId: options.appId,
      appSecret: options.appSecret,
      timeoutMs: options.timeoutMs,
      retries: 1,
    });
  }

  async start(input: FaceStartInput): Promise<FaceStartResult> {
    const data = await this.client.request<{
      sessionId?: string;
      verifyUrl?: string;
      expiresAt?: string;
    }>('POST', '/v1/face/sessions', {
      body: input,
      idempotencyKey: `face_${input.reference}_${randomBytes(6).toString('hex')}`,
    });
    if (!data.sessionId) {
      throw new IntegrationError('FACE_BAD_RESPONSE', '人脸核验服务未返回 sessionId');
    }
    return {
      sessionId: data.sessionId,
      verifyUrl: data.verifyUrl,
      expiresAt:
        data.expiresAt ?? new Date(clock.wallNow().getTime() + 5 * 60_000).toISOString(),
    };
  }

  async status(sessionId: string): Promise<FaceStatusResult> {
    const data = await this.client.request<{
      status?: FaceStatusResult['status'];
      score?: number;
    }>('GET', `/v1/face/sessions/${encodeURIComponent(sessionId)}`);
    const status = data.status;
    if (!status || !['pending', 'passed', 'failed', 'expired'].includes(status)) {
      throw new IntegrationError('FACE_BAD_RESPONSE', '人脸核验服务返回状态不合法');
    }
    return { status, score: data.score };
  }
}

export const otpProvider: OtpProvider =
  config.integration.sms.mode === 'http'
    ? new HttpOtpProvider({
        baseUrl: config.integration.sms.baseUrl,
        appId: config.integration.sms.appId,
        appSecret: config.integration.sms.appSecret,
        timeoutMs: config.integration.sms.timeoutMs,
      })
    : new DemoOtpProvider();

export const faceProvider: FaceProvider =
  config.integration.face.mode === 'http'
    ? new HttpFaceProvider({
        baseUrl: config.integration.face.baseUrl,
        appId: config.integration.face.appId,
        appSecret: config.integration.face.appSecret,
        timeoutMs: config.integration.face.timeoutMs,
      })
    : new DemoFaceProvider();
