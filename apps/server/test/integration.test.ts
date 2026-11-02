import { createHash, createHmac } from 'node:crypto';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalRequest, IntegrationError, SignedHttpClient, signRequest } from '../src/integration/httpClient';
import { applyBankSnapshot, parseBankSnapshot, SnapshotError } from '../src/integration/banking/snapshot';
import { externalRefFor } from '../src/integration/ids';
import { createSeededState } from '../src/core/seed';

const APP_ID = 'test-app';
const SECRET = 'test-secret';

function verify(request: any, secret = SECRET): string | null {
  const timestamp = String(request.headers['x-timestamp'] ?? '');
  const nonce = String(request.headers['x-nonce'] ?? '');
  const signature = String(request.headers['x-signature'] ?? '');
  if (request.headers['x-app-id'] !== APP_ID || !timestamp || !nonce || !signature) return 'MISSING';
  const body = String(request.rawBody ?? '');
  const canonical = `${request.method}\n${request.raw.url}\n${timestamp}\n${nonce}\n${createHash('sha256').update(body).digest('hex')}`;
  const expected = createHmac('sha256', secret).update(canonical).digest('hex');
  return expected === signature ? null : 'BAD_SIGNATURE';
}

describe('SignedHttpClient', () => {
  const app = Fastify({ logger: false });
  let baseUrl = '';
  let calls = 0;
  let flakyCalls = 0;
  let downCalls = 0;
  let lastIdempotencyKey = '';
  let seenPath = '';

  beforeAll(async () => {
    app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
      (request as any).rawBody = body;
      try {
        done(null, body ? JSON.parse(String(body)) : {});
      } catch (error) {
        done(error as Error);
      }
    });
    app.addHook('preHandler', async (request, reply) => {
      if (request.url.startsWith('/public')) return;
      const error = verify(request);
      if (error) {
        return reply.code(401).send({ ok: false, error: { code: error, message: '签名错误' } });
      }
    });
    app.get('/public/health', async () => ({ ok: true, data: { healthy: true } }));
    app.post('/v1/echo', async (request) => {
      calls += 1;
      seenPath = request.raw.url ?? '';
      lastIdempotencyKey = String(request.headers['idempotency-key'] ?? '');
      return { ok: true, data: { received: request.body, path: seenPath } };
    });
    app.post('/v1/business-error', async (_request, reply) =>
      reply.code(409).send({
        ok: false,
        error: { code: 'INSUFFICIENT_BALANCE', message: '余额不足' },
      }),
    );
    app.post('/v1/down', async (_request, reply) => {
      downCalls += 1;
      return reply.code(503).send({ ok: false, error: { code: 'UPSTREAM_DOWN', message: '不可用' } });
    });
    app.post('/v1/flaky', async (_request, reply) => {
      flakyCalls += 1;
      lastIdempotencyKey = String(_request.headers['idempotency-key'] ?? '');
      if (flakyCalls === 1) {
        return reply.code(503).send({ ok: false, error: { code: 'UPSTREAM_BUSY', message: '忙' } });
      }
      return { ok: true, data: { attempt: flakyCalls } };
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('signs method, path, timestamp, nonce and body hash', async () => {
    const client = new SignedHttpClient({
      baseUrl,
      appId: APP_ID,
      appSecret: SECRET,
      retries: 0,
    });
    const data = await client.request<{ received: unknown; path: string }>('POST', '/v1/echo', {
      body: { hello: '银行', amountCents: 100 },
      query: { b: 2, a: 1 },
      idempotencyKey: 'idem-fixed-1',
    });
    expect(data.path).toBe('/v1/echo?b=2&a=1');
    expect(data.received).toEqual({ hello: '银行', amountCents: 100 });
    expect(lastIdempotencyKey).toBe('idem-fixed-1');
    expect(calls).toBe(1);
  });

  it('rejects a wrong secret without retrying', async () => {
    const client = new SignedHttpClient({
      baseUrl,
      appId: APP_ID,
      appSecret: `${SECRET}-wrong`,
      retries: 2,
    });
    await expect(client.request('POST', '/v1/echo', { body: {}, idempotencyKey: 'x' })).rejects.toMatchObject({
      code: 'BAD_SIGNATURE',
      retryable: false,
    });
  });

  it('maps 4xx business errors without retrying', async () => {
    const client = new SignedHttpClient({
      baseUrl,
      appId: APP_ID,
      appSecret: SECRET,
      retries: 2,
    });
    await expect(
      client.request('POST', '/v1/business-error', { body: {}, idempotencyKey: 'x' }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE', status: 409, retryable: false });
  });

  it('retries 5xx with the same idempotency key', async () => {
    const client = new SignedHttpClient({
      baseUrl,
      appId: APP_ID,
      appSecret: SECRET,
      retries: 1,
    });
    const data = await client.request<{ attempt: number }>('POST', '/v1/flaky', {
      body: {},
      idempotencyKey: 'idem-retry',
    });
    expect(data.attempt).toBe(2);
    expect(flakyCalls).toBe(2);
    expect(lastIdempotencyKey).toBe('idem-retry');
  });

  it('does not count 4xx business errors toward the circuit', async () => {
    const client = new SignedHttpClient({
      baseUrl,
      appId: APP_ID,
      appSecret: SECRET,
      retries: 0,
      circuitFailures: 2,
      circuitCooldownMs: 10_000,
    });
    await expect(
      client.request('POST', '/v1/business-error', { body: {}, idempotencyKey: 'x' }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    await expect(
      client.request('POST', '/v1/business-error', { body: {}, idempotencyKey: 'y' }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
  });

  it('opens the circuit after consecutive 5xx failures', async () => {
    const client = new SignedHttpClient({
      baseUrl,
      appId: APP_ID,
      appSecret: SECRET,
      retries: 0,
      circuitFailures: 2,
      circuitCooldownMs: 10_000,
    });
    await expect(
      client.request('POST', '/v1/down', { body: {}, idempotencyKey: 'x' }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_DOWN' });
    await expect(
      client.request('POST', '/v1/down', { body: {}, idempotencyKey: 'y' }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_DOWN' });
    await expect(
      client.request('POST', '/v1/down', { body: {}, idempotencyKey: 'z' }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_CIRCUIT_OPEN' });
    expect(downCalls).toBe(2);
  });

  it('canonical string changes with any bound field', () => {
    const base = canonicalRequest({
      method: 'POST',
      pathWithQuery: '/v1/ops?a=1',
      timestamp: '1',
      nonce: 'n',
      body: '{}',
    });
    const other = canonicalRequest({
      method: 'POST',
      pathWithQuery: '/v1/ops?a=2',
      timestamp: '1',
      nonce: 'n',
      body: '{}',
    });
    expect(base).not.toBe(other);
    expect(base.split('\n')).toHaveLength(5);
    expect(signRequest('secret', base)).toHaveLength(64);
  });
});

describe('bank snapshot', () => {
  it('replaces bank data while preserving local identity profile', () => {
    const state = createSeededState({ userId: 'u_test', name: '本地客户' });
    const snapshot = {
      accounts: [
        {
          ...state.accounts[0]!,
          id: 'acc_real',
          balanceCents: 777_700,
          primary: true,
        },
      ],
      cards: [{ ...state.cards[0]!, id: 'card_real', status: 'frozen' as const }],
      transactions: [
        {
          ...state.transactions[0]!,
          id: 'txn_real',
          accountId: 'acc_real',
          amountCents: -1234,
        },
      ],
    };
    applyBankSnapshot(state, snapshot);
    expect(state.accounts).toHaveLength(1);
    expect(state.accounts[0]?.balanceCents).toBe(777_700);
    expect(state.cards[0]?.status).toBe('frozen');
    expect(state.transactions[0]?.id).toBe('txn_real');
    expect(state.user.name).toBe('本地客户');
    expect(state.user.contacts.length).toBeGreaterThan(0);
  });

  it('rejects malformed upstream snapshots instead of trusting them', () => {
    expect(() => parseBankSnapshot({ accounts: [{ id: 'x' }] })).toThrow(SnapshotError);
    expect(() =>
      parseBankSnapshot({
        accounts: [
          {
            id: 'acc',
            name: '账户',
            bank: '银行',
            type: 'savings',
            last4: '123',
            balanceCents: 1,
            lockedCents: 0,
            primary: true,
            color: '#000',
          },
        ],
      }),
    ).toThrow(SnapshotError);
  });

  it('uses a stable pseudonymous external reference', () => {
    const a = externalRefFor('u_123');
    const b = externalRefFor('u_123');
    expect(a).toBe(b);
    expect(a).toMatch(/^bref_[a-f0-9]{24}$/);
    expect(a).not.toContain('u_123');
    expect(externalRefFor('u_456')).not.toBe(a);
  });
});
