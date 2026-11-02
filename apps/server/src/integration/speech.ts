import { randomUUID } from 'node:crypto';
import { config } from '../config';

export interface TranscribeInput {
  bytes: Buffer;
  mime: string;
  userId: string;
}

export interface SpeechProvider {
  readonly mode: 'off' | 'http';
  readonly label: string;
  transcribe(input: TranscribeInput): Promise<{ text: string; durationSec?: number }>;
}

class DisabledSpeechProvider implements SpeechProvider {
  readonly mode = 'off' as const;
  readonly label = '未配置服务端语音识别';

  async transcribe(): Promise<{ text: string }> {
    const error = new Error('服务端语音识别未启用，请使用浏览器原生识别') as Error & { code?: string };
    error.code = 'ASR_DISABLED';
    throw error;
  }
}

/**
 * OpenAI 兼容的 /v1/audio/transcriptions 通道（Whisper、讯飞/阿里的兼容网关、
 * 自建 whisper.cpp 服务均可）。音频只在请求内存中使用，不落盘、不入审计。
 */
export class HttpSpeechProvider implements SpeechProvider {
  readonly mode = 'http' as const;
  readonly label: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly language: string;
  private readonly timeoutMs: number;

  constructor(options: {
    baseUrl: string;
    apiKey: string;
    model: string;
    language?: string;
    timeoutMs?: number;
    label?: string;
  }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.language = options.language || 'zh';
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.label = options.label ?? '签约语音识别服务';
  }

  async transcribe(input: TranscribeInput): Promise<{ text: string; durationSec?: number }> {
    const form = new FormData();
    const extension = input.mime.includes('wav')
      ? 'wav'
      : input.mime.includes('mpeg') || input.mime.includes('mp3')
        ? 'mp3'
        : input.mime.includes('mp4')
          ? 'm4a'
          : 'webm';
    form.append(
      'file',
      new Blob([new Uint8Array(input.bytes)], { type: input.mime || 'audio/webm' }),
      `voice-${randomUUID().slice(0, 8)}.${extension}`,
    );
    form.append('model', this.model);
    form.append('language', this.language);
    form.append('response_format', 'json');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/v1/audio/transcriptions`, {
        method: 'POST',
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : undefined,
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        const error = new Error(`语音识别服务返回 ${response.status}${detail ? `：${detail.slice(0, 120)}` : ''}`) as Error & {
          code?: string;
        };
        error.code = response.status === 401 || response.status === 403 ? 'ASR_UNAUTHORIZED' : 'ASR_UPSTREAM_ERROR';
        throw error;
      }
      const data = (await response.json()) as { text?: unknown; duration?: unknown };
      const text = typeof data.text === 'string' ? data.text.trim() : '';
      if (!text) {
        const error = new Error('没有识别到有效语音') as Error & { code?: string };
        error.code = 'ASR_EMPTY';
        throw error;
      }
      return {
        text: text.slice(0, 500),
        durationSec: typeof data.duration === 'number' ? data.duration : undefined,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        const timeout = new Error('语音识别超时，请重试') as Error & { code?: string };
        timeout.code = 'ASR_TIMEOUT';
        throw timeout;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function build(): SpeechProvider {
  if (config.asr.mode === 'http' && config.asr.baseUrl && config.asr.apiKey) {
    return new HttpSpeechProvider({
      baseUrl: config.asr.baseUrl,
      apiKey: config.asr.apiKey,
      model: config.asr.model,
      language: config.asr.language,
      timeoutMs: config.asr.timeoutMs,
    });
  }
  return new DisabledSpeechProvider();
}

export const speechProvider: SpeechProvider = build();

export function speechConfigErrors(): string[] {
  if (config.asr.mode !== 'http') return [];
  const errors: string[] = [];
  if (!config.asr.baseUrl) errors.push('ASR_MODE=http 需要 ASR_BASE_URL');
  if (!config.asr.apiKey) errors.push('ASR_MODE=http 需要 ASR_API_KEY');
  return errors;
}
