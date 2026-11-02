import type { FastifyInstance } from 'fastify';
import { config } from '../config';
import { speechProvider } from '../integration/speech';
import { allowAuthAttempt } from '../security/auth';
import { audit } from '../security/auditChain';

const AUDIO_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'application/octet-stream',
];

export async function speechRoutes(app: FastifyInstance): Promise<void> {
  // 语音按二进制接收：不写盘、不入审计，只在内存里转给签约 ASR 服务。
  app.addContentTypeParser(AUDIO_TYPES, { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });

  app.get('/api/speech/status', async () => ({
    ok: true,
    serverAsr: speechProvider.mode,
    label: speechProvider.mode === 'http' ? speechProvider.label : '未启用（使用浏览器原生识别）',
    maxBytes: config.asr.maxBytes,
    languages: ['zh'],
  }));

  app.post(
    '/api/speech/transcribe',
    { config: { bodyLimit: config.asr.maxBytes } },
    async (request, reply) => {
      const auth = request.authUser!;
      const limit = allowAuthAttempt(`speech:${auth.id}`, 40, 10 * 60_000);
      if (!limit.allowed) {
        return reply.code(429).send({
          ok: false,
          code: 'RATE_LIMITED',
          message: `语音识别过于频繁，请 ${limit.retryAfterSec} 秒后再试`,
        });
      }
      const bytes = Buffer.isBuffer(request.body) ? (request.body as Buffer) : Buffer.alloc(0);
      if (!bytes.length) {
        return reply.code(400).send({ ok: false, code: 'EMPTY_AUDIO', message: '没有收到音频数据' });
      }
      if (bytes.length > config.asr.maxBytes) {
        return reply.code(413).send({
          ok: false,
          code: 'AUDIO_TOO_LARGE',
          message: `录音文件超过 ${Math.round(config.asr.maxBytes / 1024 / 1024)}MB 上限`,
        });
      }
      const mime = String(request.headers['content-type'] ?? 'audio/webm').split(';')[0] ?? 'audio/webm';
      const startedAt = Date.now();
      try {
        const result = await speechProvider.transcribe({ bytes, mime, userId: auth.id });
        audit.append('SPEECH_TRANSCRIBED', '语音已转写为文本', {
          provider: speechProvider.mode,
          bytes: bytes.length,
          mime,
          latencyMs: Date.now() - startedAt,
          characters: result.text.length,
        });
        return { ok: true, text: result.text, durationSec: result.durationSec };
      } catch (error) {
        const candidate = error as { code?: string; message?: string };
        const code = candidate?.code ?? 'ASR_FAILED';
        audit.append('SPEECH_FAILED', `语音转写失败：${code}`, {
          provider: speechProvider.mode,
          bytes: bytes.length,
          mime,
        });
        return reply.code(code === 'ASR_DISABLED' ? 503 : 502).send({
          ok: false,
          code,
          message: candidate?.message ?? '语音识别失败',
        });
      }
    },
  );
}
