import type { FastifyReply } from 'fastify';
import type { EmitFn } from '../agent/events';
import * as hub from './hub';

export interface StreamOptions {
  sessionId: string;
  after?: number;
  task: (emit: EmitFn) => Promise<void>;
}

export function streamSession(reply: FastifyReply, options: StreamOptions): void {
  const raw = reply.raw;
  reply.hijack();
  const { sessionId } = options;
  const after = Number.isFinite(options.after) ? Number(options.after) : hub.currentSeq(sessionId);
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  raw.write(': connected\n\n');

  let finished = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;

  const cleanup = () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    unsubscribe?.();
    unsubscribe = null;
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    cleanup();
    try {
      raw.end();
    } catch {
      // 客户端可能已断开
    }
  };

  const sink = (event: unknown) => {
    if (finished || raw.writableEnded) return;
    try {
      raw.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      finish();
      return;
    }
    const type = (event as { type?: string }).type;
    if (type === 'run.paused' || type === 'run.end') {
      setTimeout(finish, 40);
    }
  };

  unsubscribe = hub.subscribe(sessionId, sink);
  for (const event of hub.eventsAfter(sessionId, after)) sink(event);

  heartbeat = setInterval(() => {
    if (!finished && !raw.writableEnded) {
      try {
        raw.write(`: ping ${Date.now()}\n\n`);
      } catch {
        finish();
      }
    }
  }, 15_000);

  raw.on('close', () => {
    finished = true;
    cleanup();
  });

  const emit = hub.createEmitter(sessionId);
  void options
    .task(emit)
    .catch((error) => {
      try {
        emit('run.end', {
          status: 'FAILED',
          runId: undefined,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // ignore
      }
    })
    .finally(() => {
      setTimeout(() => {
        if (!finished) finish();
      }, 160);
    });
}
