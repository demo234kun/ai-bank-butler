import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AuditEntry } from '@bank/shared';
import { verifyEntries } from '../src/security/auditChain';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function entry(
  seq: number,
  prevHash: string,
  summary: string,
  payload: unknown,
  type = 'TEST',
): AuditEntry {
  const ts = `2026-10-30T02:00:0${seq}.000Z`;
  const payloadHash = sha256(JSON.stringify(payload ?? null));
  const hash = sha256([seq, prevHash, '', type, ts, summary, payloadHash].join('|'));
  return { seq, ts, type, summary, payload, prevHash, hash };
}

function buildChain(): AuditEntry[] {
  const first = entry(1, 'GENESIS', '用户发起转账', { amountCents: 52000 });
  const second = entry(2, first.hash, '策略判定 YELLOW', { risk: 'YELLOW' });
  const third = entry(3, second.hash, '用户确认执行', { nodeId: 'n3' });
  return [first, second, third];
}

describe('审计哈希链', () => {
  it('完整链校验通过', () => {
    const result = verifyEntries(buildChain());
    expect(result.ok).toBe(true);
    expect(result.count).toBe(3);
    expect(result.errors).toHaveLength(0);
  });

  it('修改摘要内容会被发现', () => {
    const chain = buildChain();
    chain[1]!.summary = '被篡改的摘要';
    const result = verifyEntries(chain);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('哈希不匹配'))).toBe(true);
  });

  it('修改 payload 会被发现', () => {
    const chain = buildChain();
    (chain[2]!.payload as any).nodeId = 'hacked';
    const result = verifyEntries(chain);
    expect(result.ok).toBe(false);
  });

  it('删除中间记录会断链', () => {
    const chain = buildChain();
    chain.splice(1, 1);
    const result = verifyEntries(chain);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('重算单条哈希仍无法掩盖后续断链', () => {
    const chain = buildChain();
    const target = chain[1]!;
    target.summary = '攻击者重新计算了本条哈希';
    const payloadHash = sha256(JSON.stringify(target.payload ?? null));
    target.hash = sha256(
      [target.seq, target.prevHash, target.userId ?? '', target.type, target.ts, target.summary, payloadHash].join('|'),
    );
    const result = verifyEntries(chain);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('prevHash'))).toBe(true);
  });

  it('空链返回 GENESIS', () => {
    const result = verifyEntries([]);
    expect(result.ok).toBe(true);
    expect(result.head).toBe('GENESIS');
  });
});
