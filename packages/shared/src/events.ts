import type { FlowState, StreamEventType } from './types';

export const STREAM_EVENT_TYPES: StreamEventType[] = [
  'run.start',
  'nlu.result',
  'injection.flag',
  'plan.ready',
  'node.state',
  'policy.decision',
  'run.paused',
  'stepup.challenge',
  'stepup.result',
  'render.card',
  'message.final',
  'breaker.tripped',
  'takeover.required',
  'audit.appended',
  'run.end',
];

export const TERMINAL_STATES: FlowState[] = ['DONE', 'PARTIAL', 'CANCELLED', 'FAILED', 'LOCKED'];

export function isTerminalState(state: FlowState): boolean {
  return TERMINAL_STATES.includes(state);
}
