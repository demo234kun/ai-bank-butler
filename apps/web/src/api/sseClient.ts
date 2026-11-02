import type { StreamEvent } from '@bank/shared';
import { ApiError } from './client';

export interface StreamResult {
  lastSeq: number;
  eventCount: number;
}

/**
 * fetch + ReadableStream 解析 SSE（EventSource 不支持 POST / 自定义 after）。
 * 每个 SSE data 行都是一个完整的 StreamEvent JSON。
 */
export async function streamEvents(
  path: string,
  body: unknown,
  onEvent: (event: StreamEvent) => void,
): Promise<StreamResult> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let code = 'HTTP_ERROR';
    let message = `请求失败（${response.status}）`;
    try {
      const data = await response.json();
      code = data.code ?? code;
      message = data.message ?? message;
    } catch {
      // ignore
    }
    throw new ApiError(response.status, code, message);
  }
  if (!response.body) throw new ApiError(500, 'NO_STREAM', '响应流不可用');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lastSeq = 0;
  let eventCount = 0;

  const consume = (chunk: string) => {
    for (const line of chunk.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload) continue;
      try {
        const event = JSON.parse(payload) as StreamEvent;
        lastSeq = event.seq;
        eventCount += 1;
        onEvent(event);
      } catch {
        // 忽略异常行，保持流可继续
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let index = buffer.indexOf('\n\n');
    while (index >= 0) {
      const chunk = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      consume(chunk);
      index = buffer.indexOf('\n\n');
    }
  }
  if (buffer.trim()) consume(buffer);
  return { lastSeq, eventCount };
}
