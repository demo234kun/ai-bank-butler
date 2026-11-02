import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Check,
  FileWarning,
  Play,
  ShieldCheck,
  Square,
  Terminal,
} from 'lucide-react';
import type { AuditEntry, AuditVerification } from '@bank/shared';
import { formatTime } from '@bank/shared';
import clsx from 'clsx';
import { api } from '../../api/client';
import type { BankAgentApi } from '../../state/useBankAgent';
import { Badge, EmptyState, Hash, Panel } from '../ui/primitives';

interface TamperResult {
  ok: false;
  errors: string[];
  modifiedSeq: number;
  file: string;
  checkpoint: string;
  mainChain?: AuditVerification;
}

export function AuditPanel({ agent }: { agent: BankAgentApi }) {
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<AuditVerification | null>(null);
  const [tampering, setTampering] = useState(false);
  const [tamper, setTamper] = useState<TamperResult | null>(null);
  const entries = agent.state.audit;
  const verification = verifyResult ?? agent.state.stats?.audit.verification ?? agent.state.auditVerification;

  const verify = async () => {
    setVerifying(true);
    try {
      const result = await agent.verifyAudit();
      if (result) setVerifyResult(result);
    } finally {
      setVerifying(false);
    }
  };

  const runTamper = async () => {
    setTampering(true);
    try {
      const result = await api.post<TamperResult>('/api/demo/tamper');
      setTamper(result);
    } catch {
      // ignore
    } finally {
      setTampering(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.25fr_0.75fr]">
      <Panel
        eyebrow="AUDIT CHAIN"
        title="追加式哈希链"
        action={
          <div className="flex items-center gap-1.5">
            <Badge tone={verification?.ok ? 'green' : 'red'}>
              {verification?.ok ? '链完整' : '异常'}
            </Badge>
            <Badge tone="neutral">{entries.length} 条</Badge>
          </div>
        }
        bodyClassName="p-0"
      >
        <div className="flex flex-wrap items-center gap-2 border-b hairline px-4 py-2.5">
          <button
            onClick={verify}
            disabled={verifying}
            className="flex items-center gap-1 rounded-full border border-[#2f7d5b]/30 bg-[#2f7d5b]/10 px-2.5 py-1 text-[9px] text-[#9ed8bd] transition hover:bg-[#2f7d5b]/15"
          >
            <ShieldCheck size={9} /> {verifying ? '校验中…' : '校验整条链'}
          </button>
          <button
            onClick={runTamper}
            disabled={tampering}
            className="flex items-center gap-1 rounded-full border border-[#b3392e]/30 bg-[#b3392e]/10 px-2.5 py-1 text-[9px] text-[#eda49b] transition hover:bg-[#b3392e]/15"
          >
            <FileWarning size={9} /> {tampering ? '演示中…' : '篡改副本链演示'}
          </button>
          <span className="ml-auto text-[9px] text-[#7f9087]">
            每 50 条 checkpoint · PII 脱敏 · 单写者
          </span>
        </div>

        {verifyResult ? (
          <div
            className={clsx(
              'mx-4 mt-3 rounded-lg border px-3 py-2 text-[9px]',
              verifyResult.ok
                ? 'border-[#2f7d5b]/25 bg-[#2f7d5b]/[0.07] text-[#9ed8bd]'
                : 'border-[#b3392e]/25 bg-[#b3392e]/[0.07] text-[#eda49b]',
            )}
          >
            {verifyResult.ok
              ? `校验通过：${verifyResult.count} 条记录，head ${verifyResult.head.slice(0, 14)}…`
              : `校验失败：${verifyResult.errors.join('；')}`}
          </div>
        ) : null}

        {tamper ? (
          <div className="mx-4 mt-3 rounded-lg border border-[#b3392e]/25 bg-[#b3392e]/[0.07] px-3 py-2">
            <div className="flex items-center gap-1.5 text-[9px] font-medium text-[#eda49b]">
              <AlertTriangle size={10} /> 副本链篡改已被检测到（主链未受影响）
            </div>
            <div className="mt-1 text-[9px] leading-relaxed text-[#c98b84]">
              修改第 #{tamper.modifiedSeq} 条后：{tamper.errors[0] ?? '哈希不一致'}
            </div>
            <div className="mt-1 text-[8.5px] text-[#8f6b67]">主链状态：{tamper.mainChain?.ok ? '完整' : '异常'}</div>
          </div>
        ) : null}

        <div className="console-scroll mt-3 max-h-[430px] overflow-y-auto px-4 pb-4">
          {entries.length === 0 ? (
            <div className="py-10 text-center text-[9px] text-[#7f9087]">暂无审计记录</div>
          ) : (
            <div className="relative">
              <div className="absolute bottom-2 left-[7px] top-2 w-px bg-gradient-to-b from-[#c7a667]/30 to-transparent" />
              {entries.map((entry) => (
                <AuditRow key={entry.seq} entry={entry} />
              ))}
            </div>
          )}
        </div>
      </Panel>

      <div className="space-y-4">
        <Panel
          eyebrow="CHAIN INFO"
          title="链状态"
          bodyClassName="p-4"
        >
          <div className="space-y-2 text-[9px]">
            <InfoRow label="记录数" value={verification?.count ?? 0} />
            <InfoRow label="Checkpoint" value={verification?.checkpointCount ?? 0} />
            <InfoRow label="链头" value={<Hash value={verification?.head ?? ''} />} />
            <InfoRow
              label="校验时间"
              value={verification?.verifiedAt ? formatTime(verification.verifiedAt) : '—'}
            />
            <InfoRow label="写入模式" value="append-only · 单例串行" />
            <InfoRow label="脱敏" value="手机号 / 卡号 / 令牌" />
          </div>
          <div className="mt-3 rounded-lg border border-white/5 bg-black/15 p-2.5 text-[9px] leading-relaxed text-[#7f9087]">
            hash = sha256(seq | prevHash | type | ts | summary | payloadHash)。
            任一条内容被修改，都会在该条及之后断链。
          </div>
        </Panel>

        <ReplayPanel agent={agent} />
      </div>
    </div>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  return (
    <div className="relative mb-2 pl-5">
      <span className="absolute left-[4px] top-2.5 h-1.5 w-1.5 rounded-full border border-[#c7a667]/50 bg-[#0b1512]" />
      <div className="rounded-lg border border-white/5 bg-white/[0.022] px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="tabular text-[8.5px] text-[#93a49a]">#{entry.seq}</span>
            <span className="truncate text-[9px] text-[#d9d2c3]">{entry.summary}</span>
          </div>
          <span className="shrink-0 text-[8.5px] text-[#93a49a]">{formatTime(entry.ts)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <Badge tone="neutral">{entry.type}</Badge>
          <div className="flex items-center gap-1.5">
            <Hash value={entry.prevHash} className="text-[8.5px]" />
            <span className="text-[8.5px] text-[#4f5c54]">→</span>
            <Hash value={entry.hash} className="text-[8.5px]" />
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/5 pb-1.5">
      <span className="text-[#7f9087]">{label}</span>
      <span className="text-right tabular text-[#c9d1cb]">{value}</span>
    </div>
  );
}

function ReplayPanel({ agent }: { agent: BankAgentApi }) {
  const runs = agent.state.snapshot?.session.runs ?? [];
  const [runId, setRunId] = useState(runs.at(-1)?.runId ?? '');
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  useEffect(() => {
    if (!runId && runs.length) setRunId(runs.at(-1)!.runId);
  }, [runId, runs]);

  const load = async () => {
    if (!runId) return;
    setLoading(true);
    try {
      const data = await api.get<{ runId: string; entries: AuditEntry[] }>(
        `/api/audit/replay/${runId}`,
      );
      setEntries(data.entries);
      setIndex(-1);
      setPlaying(false);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  const play = () => {
    if (!entries.length) return;
    if (timer.current) clearInterval(timer.current);
    setPlaying(true);
    setIndex(0);
    timer.current = setInterval(() => {
      setIndex((prev) => {
        if (prev >= entries.length - 1) {
          if (timer.current) clearInterval(timer.current);
          setPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 850);
  };

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    setPlaying(false);
  };

  const current = entries[index];

  return (
    <Panel
      eyebrow="REPLAY"
      title="审计回放器"
      action={<Badge tone="gold">按 run 重放</Badge>}
      bodyClassName="p-4"
    >
      <div className="flex gap-2">
        <select
          value={runId}
          onChange={(event) => setRunId(event.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#0b1512] px-2 py-1.5 text-[9.5px] text-[#c9d1cb] outline-none"
        >
          <option value="">选择任务</option>
          {runs
            .slice()
            .reverse()
            .map((run) => (
              <option key={run.runId} value={run.runId}>
                {run.title} · {run.runId}
              </option>
            ))}
        </select>
        <button
          onClick={load}
          disabled={!runId || loading}
          className="flex items-center gap-1 rounded-lg border border-[#c7a667]/30 bg-[#c7a667]/10 px-2.5 py-1.5 text-[9.5px] text-[#e3cfa5]"
        >
          <Terminal size={9} /> {loading ? '加载中' : '加载'}
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-white/10 px-3 py-5 text-center text-[9.5px] text-[#7f9087]">
          选择一次已结束的任务，从审计链重建执行时间线
        </div>
      ) : (
        <>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={playing ? stop : play}
              className="flex items-center gap-1 rounded-full bg-[#0f3d33] px-2.5 py-1 text-[9.5px] text-[#e3cfa5]"
            >
              {playing ? <Square size={8} /> : <Play size={8} />}
              {playing ? '暂停' : '播放'}
            </button>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/8">
              <div
                className="h-full rounded-full bg-[#c7a667] transition-all"
                style={{ width: `${((index + 1) / entries.length) * 100}%` }}
              />
            </div>
            <span className="tabular text-[9px] text-[#7f9087]">
              {index + 1}/{entries.length}
            </span>
          </div>
          <div className="mt-2 space-y-1">
            {entries.slice(0, 4).map((entry, i) => (
              <div
                key={entry.seq}
                className={clsx(
                  'flex items-center gap-2 rounded-md px-2 py-1 text-[9px]',
                  i === index ? 'bg-[#c7a667]/10 text-[#e3cfa5]' : 'text-[#7f9087]',
                )}
              >
                <span className="w-4 tabular">#{entry.seq}</span>
                <span className="flex-1 truncate">{entry.summary}</span>
              </div>
            ))}
          </div>
          {current ? (
            <div className="mt-2 rounded-lg border border-[#c7a667]/20 bg-black/20 px-2.5 py-2">
              <div className="flex items-center justify-between">
                <Badge tone="gold">{current.type}</Badge>
                <span className="text-[8.5px] text-[#7f9087]">{formatTime(current.ts)}</span>
              </div>
              <div className="mt-1 text-[9.5px] leading-relaxed text-[#c9d1cb]">{current.summary}</div>
              <div className="mt-1 flex items-center gap-1.5 text-[8.5px] text-[#93a49a]">
                <Check size={8} className="text-[#8fd0b3]" /> hash {current.hash.slice(0, 12)}…
              </div>
            </div>
          ) : null}
        </>
      )}
    </Panel>
  );
}
