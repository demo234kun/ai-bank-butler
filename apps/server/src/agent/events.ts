import type { StreamEventType } from '@bank/shared';

export type EmitFn = (type: StreamEventType, data: any, runId?: string) => void;

export const nullEmitter: EmitFn = () => undefined;
