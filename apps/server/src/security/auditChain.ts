import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import type { AuditEntry, AuditVerification } from '@bank/shared';
import { config, ensureDirs } from '../config';
import { clock } from '../core/clock';
import { redactPayload } from './redact';

const GENESIS = 'GENESIS';
const CHECKPOINT_EVERY = 50;

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

const auditContext = new AsyncLocalStorage<{ userId?: string }>();

export function enterAuditContext(userId?: string): void {
  auditContext.enterWith({ userId });
}

function computeHash(entry: Omit<AuditEntry, 'hash'>): string {
  const payloadHash = sha256(JSON.stringify(entry.payload ?? null));
  return sha256(
    [entry.seq, entry.prevHash, entry.userId ?? '', entry.type, entry.ts, entry.summary, payloadHash].join('|'),
  );
}

export function verifyEntries(entries: AuditEntry[]): AuditVerification {
  const errors: string[] = [];
  let prev = GENESIS;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    if (entry.seq !== i + 1) {
      errors.push(`第 ${i + 1} 条序号断裂：期望 ${i + 1}，实际 ${entry.seq}`);
    }
    if (entry.prevHash !== prev) {
      errors.push(`第 ${entry.seq} 条 prevHash 不匹配`);
    }
    const expected = computeHash({ ...entry, hash: undefined } as any);
    if (entry.hash !== expected) {
      errors.push(`第 ${entry.seq} 条内容哈希不匹配（可能被篡改）`);
    }
    prev = entry.hash;
  }
  const head = entries.length ? entries[entries.length - 1]!.hash : GENESIS;
  return {
    ok: errors.length === 0,
    count: entries.length,
    head,
    checkpointCount: 0,
    errors: errors.slice(0, 8),
    verifiedAt: clock.nowIso(),
  };
}

class AuditChain {
  private entries: AuditEntry[] = [];
  private head = GENESIS;
  private seq = 0;
  private loaded = false;
  private subscribers = new Set<(entry: AuditEntry) => void>();
  private filePath = path.join(config.auditDir, 'audit.jsonl');
  private checkpointPath = path.join(config.auditDir, 'checkpoint.json');
  private tamperPath = path.join(config.auditDir, 'audit.tampered.jsonl');
  private formatPath = path.join(config.auditDir, 'format-version');

  private ensureFormat(): void {
    ensureDirs();
    const current = fs.existsSync(this.formatPath)
      ? fs.readFileSync(this.formatPath, 'utf8').trim()
      : '';
    if (current === '2') return;
    // 从旧哈希格式升级时，保留原始文件作为 legacy，不静默丢弃
    if (fs.existsSync(this.filePath)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      try {
        fs.renameSync(this.filePath, path.join(config.auditDir, `audit.legacy-${stamp}.jsonl`));
      } catch {
        // 保留原文件，下面会重建成新链
      }
    }
    for (const file of [this.checkpointPath, this.tamperPath]) {
      try {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } catch {
        // ignore
      }
    }
    this.entries = [];
    this.head = GENESIS;
    this.seq = 0;
    try {
      fs.writeFileSync(this.formatPath, '2', 'utf8');
    } catch {
      // ignore
    }
  }

  init(): void {
    if (this.loaded) return;
    this.loaded = true;
    ensureDirs();
    this.ensureFormat();
    if (!fs.existsSync(this.filePath)) return;
    const lines = fs.readFileSync(this.filePath, 'utf8').split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as AuditEntry;
        this.entries.push(entry);
        this.seq = entry.seq;
        this.head = entry.hash;
      } catch {
        break;
      }
    }
  }

  append(
    type: string,
    summary: string,
    payload: unknown = {},
    meta: { sessionId?: string; runId?: string; userId?: string } = {},
  ): AuditEntry {
    this.init();
    const seq = this.seq + 1;
    const userId = meta.userId ?? auditContext.getStore()?.userId;
    const base: Omit<AuditEntry, 'hash'> = {
      seq,
      ts: clock.nowIso(),
      type,
      summary,
      prevHash: this.head,
      sessionId: meta.sessionId,
      runId: meta.runId,
      userId,
      payload: redactPayload(payload),
    };
    const entry: AuditEntry = { ...base, hash: computeHash(base) };
    this.entries.push(entry);
    this.seq = seq;
    this.head = entry.hash;
    try {
      fs.appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, 'utf8');
      if (seq % CHECKPOINT_EVERY === 0) {
        fs.writeFileSync(
          this.checkpointPath,
          JSON.stringify({ count: seq, head: entry.hash, updatedAt: entry.ts }, null, 2),
          'utf8',
        );
      }
    } catch {
      // 审计写盘失败时保留内存链，UI 会显示连续告警
    }
    for (const fn of this.subscribers) {
      try {
        fn(entry);
      } catch {
        // 订阅者失败不影响主链
      }
    }
    return entry;
  }

  subscribe(fn: (entry: AuditEntry) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  recent(limit = 60): AuditEntry[] {
    this.init();
    return this.entries.slice(-limit);
  }

  forRun(runId: string, userId?: string): AuditEntry[] {
    this.init();
    return this.entries.filter(
      (e) => e.runId === runId && (!userId || e.userId === userId),
    );
  }

  recentForUser(userId: string, limit = 80): AuditEntry[] {
    this.init();
    const mine = this.entries.filter((entry) => entry.userId === userId);
    let start = 0;
    for (let i = mine.length - 1; i >= 0; i -= 1) {
      if (mine[i]!.type === 'DEMO_RESET') {
        start = i;
        break;
      }
    }
    return mine.slice(start).slice(-limit);
  }

  countForUser(userId: string): number {
    this.init();
    return this.entries.filter((entry) => entry.userId === userId).length;
  }

  headHash(): string {
    this.init();
    return this.head;
  }

  count(): number {
    this.init();
    return this.entries.length;
  }

  verify(): AuditVerification {
    this.init();
    const result = verifyEntries(this.entries);
    let checkpointCount = 0;
    try {
      if (fs.existsSync(this.checkpointPath)) {
        const checkpoint = JSON.parse(fs.readFileSync(this.checkpointPath, 'utf8')) as {
          count: number;
          head: string;
        };
        checkpointCount = checkpoint.count;
        const entry = this.entries[checkpoint.count - 1];
        if (!entry || entry.hash !== checkpoint.head) {
          result.errors.push(`checkpoint #${checkpoint.count} 与链头不一致`);
          result.ok = false;
        }
      }
    } catch {
      result.errors.push('checkpoint 文件损坏');
      result.ok = false;
    }
    result.checkpointCount = checkpointCount;
    result.head = this.head;
    return result;
  }

  /** 演示“篡改检测”：只在副本链上修改，绝不触碰运行中的审计主链 */
  tamperDemo(): { ok: false; errors: string[]; modifiedSeq: number; file: string; checkpoint: string } {
    this.init();
    const copy = this.entries.slice(-Math.min(20, this.entries.length));
    if (copy.length < 3) {
      return {
        ok: false,
        errors: ['审计记录不足，先完成几笔操作再演示'],
        modifiedSeq: 0,
        file: this.tamperPath,
        checkpoint: this.head,
      };
    }
    const target = copy[Math.floor(copy.length / 2)]!;
    target.summary = `${target.summary} [已被篡改]`;
    const verification = verifyEntries(copy);
    const lines = copy.map((e) => JSON.stringify(e)).join('\n');
    try {
      fs.writeFileSync(this.tamperPath, `${lines}\n`, 'utf8');
    } catch {
      // ignore
    }
    return {
      ok: false,
      errors: verification.errors,
      modifiedSeq: target.seq,
      file: this.tamperPath,
      checkpoint: this.head,
    };
  }

  reset(): void {
    ensureDirs();
    try {
      fs.writeFileSync(this.formatPath, '2', 'utf8');
    } catch {
      // ignore
    }
    this.entries = [];
    this.head = GENESIS;
    this.seq = 0;
    this.loaded = true;
    for (const file of [this.filePath, this.checkpointPath, this.tamperPath]) {
      try {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } catch {
        // ignore
      }
    }
  }
}

export const audit = new AuditChain();
