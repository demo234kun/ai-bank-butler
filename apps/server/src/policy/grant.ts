import { createHash, randomUUID } from 'node:crypto';
import { CONFIRM_TTL_MS, type Risk, type ToolName } from '@bank/shared';
import { clock } from '../core/clock';

export interface PolicyGrant {
  id: string;
  userId: string;
  sessionId: string;
  runId: string;
  nodeId: string;
  tool: ToolName;
  risk: Risk;
  amountCents?: number;
  digest: string;
  authMethods: string[];
  issuedAt: string;
  expiresAt: string;
  usedAt?: string;
}

const grants = new Map<string, PolicyGrant>();
const RISK_RANK: Record<Risk, number> = { GREEN: 0, YELLOW: 1, RED: 2 };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => `${JSON.stringify(key)}:${canonical(val)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** 操作摘要绑定用户、会话、节点、工具与规范化参数，确认后再改金额会被识别 */
export function operationDigest(input: {
  userId: string;
  sessionId: string;
  runId: string;
  nodeId: string;
  tool: ToolName;
  args: Record<string, unknown>;
}): string {
  const raw = [
    input.userId,
    input.sessionId,
    input.runId,
    input.nodeId,
    input.tool,
    canonical(input.args),
  ].join('|');
  return createHash('sha256').update(raw).digest('hex');
}

export function issueGrant(input: {
  userId: string;
  sessionId: string;
  runId: string;
  nodeId: string;
  tool: ToolName;
  risk: Risk;
  amountCents?: number;
  digest: string;
  authMethods: string[];
}): PolicyGrant {
  const now = clock.wallNow();
  const grant: PolicyGrant = {
    ...input,
    id: `grant_${randomUUID().slice(0, 8)}`,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CONFIRM_TTL_MS).toISOString(),
  };
  grants.set(grant.id, grant);
  return grant;
}

export function verifyGrant(
  grantId: string,
  expected: { nodeId: string; digest: string; effectiveRisk: Risk },
): { ok: boolean; reason?: string; grant?: PolicyGrant } {
  const grant = grants.get(grantId);
  if (!grant) return { ok: false, reason: 'GRANT_NOT_FOUND' };
  if (grant.usedAt) return { ok: false, reason: 'GRANT_ALREADY_USED' };
  if (grant.nodeId !== expected.nodeId) return { ok: false, reason: 'NODE_MISMATCH' };
  if (grant.digest !== expected.digest) return { ok: false, reason: 'DIGEST_MISMATCH' };
  if (new Date(grant.expiresAt).getTime() <= clock.wallNow().getTime()) {
    return { ok: false, reason: 'GRANT_EXPIRED' };
  }
  if (RISK_RANK[grant.risk] < RISK_RANK[expected.effectiveRisk]) {
    return { ok: false, reason: 'RISK_ESCALATED' };
  }
  return { ok: true, grant };
}

/** 校验并一次性消费，防止重放 */
export function assertAndConsumeGrant(
  grantId: string,
  expected: { nodeId: string; digest: string; effectiveRisk: Risk },
): { ok: boolean; reason?: string; grant?: PolicyGrant } {
  const result = verifyGrant(grantId, expected);
  if (!result.ok || !result.grant) return result;
  result.grant.usedAt = clock.nowIso();
  return result;
}

export function revokeGrantsForUser(userId: string): void {
  for (const [id, grant] of grants) {
    if (grant.userId === userId) grants.delete(id);
  }
}

export function revokeGrantsForSession(sessionId: string): void {
  for (const [id, grant] of grants) {
    if (grant.sessionId === sessionId) grants.delete(id);
  }
}

export function resetGrants(): void {
  grants.clear();
}

export function grantCount(): number {
  return grants.size;
}
