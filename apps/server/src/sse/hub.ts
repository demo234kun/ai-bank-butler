import type { AuditEntry, StreamEvent, StreamEventType } from '@bank/shared';
import { clock } from '../core/clock';
import type { EmitFn } from '../agent/events';

const BUFFER_LIMIT = 320;

interface Channel {
  seq: number;
  buffer: StreamEvent[];
  sinks: Set<(event: StreamEvent) => void>;
}

const channels = new Map<string, Channel>();

function channel(sessionId: string): Channel {
  let ch = channels.get(sessionId);
  if (!ch) {
    ch = { seq: 0, buffer: [], sinks: new Set() };
    channels.set(sessionId, ch);
  }
  return ch;
}

export function publish(
  sessionId: string,
  type: StreamEventType,
  data: any,
  runId?: string,
): StreamEvent {
  const ch = channel(sessionId);
  ch.seq += 1;
  const event: StreamEvent = {
    seq: ch.seq,
    ts: clock.nowIso(),
    type,
    sessionId,
    runId,
    data,
  };
  ch.buffer.push(event);
  if (ch.buffer.length > BUFFER_LIMIT) ch.buffer.splice(0, ch.buffer.length - BUFFER_LIMIT);
  for (const sink of [...ch.sinks]) {
    try {
      sink(event);
    } catch {
      ch.sinks.delete(sink);
    }
  }
  return event;
}

export function createEmitter(sessionId: string): EmitFn {
  return (type, data, runId) => {
    publish(sessionId, type, data, runId);
  };
}

export function subscribe(sessionId: string, sink: (event: StreamEvent) => void): () => void {
  const ch = channel(sessionId);
  ch.sinks.add(sink);
  return () => {
    ch.sinks.delete(sink);
  };
}

export function currentSeq(sessionId: string): number {
  return channel(sessionId).seq;
}

export function eventsAfter(sessionId: string, after: number): StreamEvent[] {
  const ch = channel(sessionId);
  return ch.buffer.filter((event) => event.seq > after);
}

export function publishAudit(entry: AuditEntry): void {
  if (!entry.sessionId) return;
  publish(entry.sessionId, 'audit.appended', { entry }, entry.runId);
}

export function resetSession(sessionId: string): void {
  const ch = channels.get(sessionId);
  ch?.sinks.clear();
  channels.delete(sessionId);
}

export function resetHub(): void {
  for (const ch of channels.values()) {
    ch.sinks.clear();
  }
  channels.clear();
}

export function hubStats(): { sessions: number; buffered: number } {
  let buffered = 0;
  for (const ch of channels.values()) buffered += ch.buffer.length;
  return { sessions: channels.size, buffered };
}
