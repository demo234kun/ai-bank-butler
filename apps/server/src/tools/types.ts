import type { DagNode, ToolName, ToolResult, Risk } from '@bank/shared';
import type { BankState } from '../core/state';

export interface ToolContext {
  state: BankState;
  userId: string;
  idempotencyKey: string;
  sessionId: string;
  runId: string;
  node: DagNode;
  resultOf: (nodeId: string) => ToolResult | undefined;
}

export type ToolHandler = (ctx: ToolContext) => Promise<ToolResult> | ToolResult;

export interface ToolMeta {
  name: ToolName;
  label: string;
  description: string;
  baseRisk: Risk;
  reversible: boolean;
  group: 'transfer' | 'bills' | 'wealth' | 'card' | 'subscription' | 'crossscene' | 'account' | 'internal';
  compensator?: ToolName;
  internal?: boolean;
}
