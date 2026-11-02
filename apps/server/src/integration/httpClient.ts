import { createHash, createHmac, randomBytes } from 'node:crypto';

export class IntegrationError extends Error {
  code: string;
  status?: number;
  retryable: boolean;

  constructor(
    code: string,
    message: string,
    options: { status?: number; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = 'IntegrationError';
    this.code = code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}

export interface SignedClientOptions {
  baseUrl: string;
  appId: string;
  appSecret: string;
  timeoutMs?: number;
  retries?: number;
  circuitFailures?: number;
  circuitCooldownMs?: number;
  fetchImpl?: typeof fetch;
}

export function canonicalRequest(input: {
  method: string;
  pathWithQuery: string;
  timestamp: string;
  nonce: string;
  body: string;
}): string {
  const bodyHash = createHash('sha256').update(input.body).digest('hex');
  return [
    input.method.toUpperCase(),
    input.pathWithQuery,
    input.timestamp,
    input.nonce,
    bodyHash,
  ].join('\n');
}

export function signRequest(secret: string, canonical: string): string {
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

interface Envelope<T> {
  ok?: boolean;
  data?: T;
  error?: { code?: string; message?: string };
  requestId?: string;
}

/**
 * 对接银行 / 核验服务的签名 HTTP 客户端。
 *
 * - HMAC-SHA256 覆盖 method + path + timestamp + nonce + body hash
 * - 写操作携带 Idempotency-Key，网络重试复用同一 key
 * - 连续网络/5xx 失败触发客户端熔断，避免拖垮 Agent
 * - 4xx 业务错误不重试、不熔断，原样映射给上层
 */
export class SignedHttpClient {
  private readonly options: Required<Omit<SignedClientOptions, 'fetchImpl'>> & {
    fetchImpl: typeof fetch;
  };
  private failures = 0;
  private openUntil = 0;

  constructor(options: SignedClientOptions) {
    this.options = {
      baseUrl: options.baseUrl.replace(/\/+$/, ''),
      appId: options.appId,
      appSecret: options.appSecret,
      timeoutMs: options.timeoutMs ?? 8000,
      retries: options.retries ?? 1,
      circuitFailures: options.circuitFailures ?? 5,
      circuitCooldownMs: options.circuitCooldownMs ?? 30_000,
      fetchImpl: options.fetchImpl ?? fetch,
    };
  }

  get baseUrl(): string {
    return this.options.baseUrl;
  }

  private recordFailure(): void {
    this.failures += 1;
    if (this.failures >= this.options.circuitFailures) {
      this.openUntil = Date.now() + this.options.circuitCooldownMs;
    }
  }

  private recordSuccess(): void {
    this.failures = 0;
    this.openUntil = 0;
  }

  async request<T>(
    method: 'GET' | 'POST',
    path: string,
    options: {
      body?: unknown;
      query?: Record<string, string | number | undefined>;
      idempotencyKey?: string;
      retries?: number;
    } = {},
  ): Promise<T> {
    if (Date.now() < this.openUntil) {
      throw new IntegrationError('UPSTREAM_CIRCUIT_OPEN', '银行核心连续失败，连接已暂时熔断', {
        retryable: false,
      });
    }

    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== '') query.set(key, String(value));
    }
    const pathWithQuery = `${path}${query.size ? `?${query.toString()}` : ''}`;
    const url = `${this.options.baseUrl}${pathWithQuery}`;
    const body = options.body === undefined ? '' : JSON.stringify(options.body);
    const retries = options.retries ?? (method === 'GET' ? this.options.retries : this.options.retries);
    const idempotencyKey =
      options.idempotencyKey ??
      (method === 'POST' ? `idem_${randomBytes(12).toString('hex')}` : undefined);

    let lastError: IntegrationError | null = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const timestamp = Date.now().toString();
      const nonce = randomBytes(16).toString('hex');
      const canonical = canonicalRequest({
        method,
        pathWithQuery,
        timestamp,
        nonce,
        body,
      });
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'X-App-Id': this.options.appId,
        'X-Timestamp': timestamp,
        'X-Nonce': nonce,
        'X-Signature': signRequest(this.options.appSecret, canonical),
      };
      if (body) headers['Content-Type'] = 'application/json';
      if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

      let response: Response;
      try {
        response = await this.options.fetchImpl(url, {
          method,
          headers,
          body: body || undefined,
          signal: AbortSignal.timeout(this.options.timeoutMs),
        });
      } catch (error) {
        const message =
          error instanceof Error && error.name === 'TimeoutError'
            ? '银行核心响应超时'
            : '银行核心网络不可达';
        lastError = new IntegrationError('UPSTREAM_UNAVAILABLE', message, { retryable: true });
        if (attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, 120 * (attempt + 1)));
          continue;
        }
        this.recordFailure();
        throw lastError;
      }

      const text = await response.text();
      let payload: Envelope<T> | null = null;
      try {
        payload = text ? (JSON.parse(text) as Envelope<T>) : null;
      } catch {
        payload = null;
      }

      if (response.ok && payload && payload.ok !== false && payload.error === undefined) {
        this.recordSuccess();
        return (payload.data ?? (payload as unknown)) as T;
      }

      const code =
        payload?.error?.code ??
        (response.status === 429 ? 'UPSTREAM_RATE_LIMITED' : `UPSTREAM_HTTP_${response.status}`);
      const message =
        payload?.error?.message ??
        (response.status === 429 ? '银行核心限流，请稍后再试' : `银行核心返回 HTTP ${response.status}`);
      const retryable = response.status === 429 || response.status >= 500;
      lastError = new IntegrationError(code, message, {
        status: response.status,
        retryable,
      });
      if (retryable && attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 120 * (attempt + 1)));
        continue;
      }
      if (retryable) this.recordFailure();
      throw lastError;
    }

    this.recordFailure();
    throw lastError ?? new IntegrationError('UPSTREAM_UNAVAILABLE', '银行核心不可用', { retryable: true });
  }
}
