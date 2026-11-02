import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(HERE, '../../..');

function loadDotEnv(): void {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

const rawDataDir = process.env.DATA_DIR?.trim();
const dataDir = rawDataDir ? path.resolve(rawDataDir) : path.join(ROOT_DIR, 'data');

function envText(key: string, fallback = ''): string {
  return (process.env[key] ?? fallback).trim();
}

function envNumber(key: string, fallback: number): number {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function envInt(key: string, fallback: number, min = 0): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.floor(value)) : fallback;
}

function envMode(key: string, fallback: 'simulated' | 'http'): 'simulated' | 'http' {
  return envText(key, fallback).toLowerCase() === 'http' ? 'http' : fallback;
}

function trimBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

const bankingMode = envMode('BANKING_MODE', 'simulated');
const smsMode = envText('SMS_MODE', 'demo').toLowerCase() === 'http' ? 'http' : 'demo';
const faceMode = envText('FACE_MODE', 'demo').toLowerCase() === 'http' ? 'http' : 'demo';
const businessClock =
  envText('BUSINESS_CLOCK', bankingMode === 'http' ? 'real' : 'demo').toLowerCase() === 'real'
    ? 'real'
    : 'demo';

export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '0.0.0.0',
  demoNow: process.env.DEMO_NOW ?? '2026-10-30T10:00:00+08:00',
  /** demo：可注入演示日期；real：使用真实业务时间（HTTP 银行接入默认 real）。 */
  businessClock: businessClock as 'demo' | 'real',
  dataDir,
  runtimeDir: path.join(dataDir, 'runtime'),
  auditDir: path.join(dataDir, 'audit'),
  webDist: path.join(ROOT_DIR, 'apps/web/dist'),
  llm: {
    baseUrl: trimBaseUrl(envText('LLM_BASE_URL')),
    apiKey: process.env.LLM_API_KEY ?? '',
    model: process.env.LLM_MODEL ?? 'deepseek-chat',
    offline: process.env.LLM_OFFLINE === '1',
    timeoutMs: envNumber('LLM_TIMEOUT_MS', 8000),
    maxTokens: envNumber('LLM_MAX_TOKENS', 520),
  },
  /**
   * 生产接入位。默认 simulated 保持比赛演示零依赖；
   * 配成 http 后所有账户读写都走签约银行核心网关，失败即报错，绝不静默回退到仿真。
   */
  auth: {
    requirePhoneVerify: envText('AUTH_REQUIRE_PHONE_VERIFY', '1') !== '0',
    loginMfa: envText('LOGIN_MFA', '0') === '1',
    /** 红色强验证是否允许用设备生物识别（WebAuthn）替代活体人脸。 */
    webauthnStepUp: envText('WEBAUTHN_STEPUP', '1') !== '0',
  },
  /** 计划任务调度器：到点真正执行定时转账、预算解锁与礼品送达。0 表示关闭。 */
  scheduler: {
    tickMs: envInt('SCHEDULER_TICK_MS', 10_000),
    maxAttempts: envInt('SCHEDULER_MAX_ATTEMPTS', 5, 1),
  },
  /** 语音转写：off 表示只提供浏览器原生识别；http 走签约 ASR 服务。 */
  asr: {
    mode: envText('ASR_MODE', 'off').toLowerCase() === 'http' ? ('http' as const) : ('off' as const),
    baseUrl: trimBaseUrl(envText('ASR_BASE_URL')),
    apiKey: process.env.ASR_API_KEY ?? '',
    model: envText('ASR_MODEL', 'whisper-1'),
    language: envText('ASR_LANGUAGE', 'zh'),
    timeoutMs: envNumber('ASR_TIMEOUT_MS', 15_000),
    maxBytes: envNumber('ASR_MAX_BYTES', 2 * 1024 * 1024),
  },
  integration: {
    banking: {
      mode: bankingMode,
      baseUrl: trimBaseUrl(envText('BANKING_BASE_URL')),
      appId: envText('BANKING_APP_ID'),
      appSecret: envText('BANKING_APP_SECRET'),
      provider: envText('BANKING_PROVIDER', '合作银行核心'),
      timeoutMs: envNumber('BANKING_TIMEOUT_MS', 8000),
      retries: Math.min(3, envInt('BANKING_RETRIES', 1, 0)),
      syncTtlMs: envInt('BANKING_SYNC_TTL_MS', 2500, 0),
      txnLimit: Math.min(2000, envInt('BANKING_TXN_LIMIT', 600, 1)),
      circuitFailures: envInt('BANKING_CIRCUIT_FAILURES', 5, 1),
      circuitCooldownMs: envInt('BANKING_CIRCUIT_COOLDOWN_MS', 30_000, 1000),
    },
    sms: {
      mode: smsMode as 'demo' | 'http',
      baseUrl: trimBaseUrl(envText('SMS_BASE_URL')),
      appId: envText('SMS_APP_ID'),
      appSecret: envText('SMS_APP_SECRET'),
      timeoutMs: envNumber('SMS_TIMEOUT_MS', 6000),
      resendCooldownMs: envInt('SMS_RESEND_COOLDOWN_MS', 60_000, 1000),
    },
    face: {
      mode: faceMode as 'demo' | 'http',
      baseUrl: trimBaseUrl(envText('FACE_BASE_URL')),
      appId: envText('FACE_APP_ID'),
      appSecret: envText('FACE_APP_SECRET'),
      timeoutMs: envNumber('FACE_TIMEOUT_MS', 8000),
    },
  },
  seedVersion: 1,
  isDemo: bankingMode === 'simulated' && smsMode === 'demo' && faceMode === 'demo',
  cookieSecure: process.env.COOKIE_SECURE === '1',
} as const;

/** 启动时做显式校验，避免“配了个 http 但悄悄走仿真”的假接入。 */
export function integrationConfigErrors(): string[] {
  const errors: string[] = [];
  const check = (
    label: string,
    mode: string,
    baseUrl: string,
    appId: string,
    appSecret: string,
  ) => {
    if (mode !== 'http') return;
    if (!baseUrl) errors.push(`${label}: 缺少 baseUrl`);
    if (!appId) errors.push(`${label}: 缺少 appId`);
    if (!appSecret) errors.push(`${label}: 缺少 appSecret`);
    if (baseUrl && !/^https?:\/\//i.test(baseUrl)) errors.push(`${label}: baseUrl 必须是 http(s) 地址`);
  };
  check(
    'BANKING',
    config.integration.banking.mode,
    config.integration.banking.baseUrl,
    config.integration.banking.appId,
    config.integration.banking.appSecret,
  );
  check(
    'SMS',
    config.integration.sms.mode,
    config.integration.sms.baseUrl,
    config.integration.sms.appId,
    config.integration.sms.appSecret,
  );
  check(
    'FACE',
    config.integration.face.mode,
    config.integration.face.baseUrl,
    config.integration.face.appId,
    config.integration.face.appSecret,
  );
  return errors;
}

export function ensureDirs(): void {
  fs.mkdirSync(config.runtimeDir, { recursive: true });
  fs.mkdirSync(config.auditDir, { recursive: true });
}
