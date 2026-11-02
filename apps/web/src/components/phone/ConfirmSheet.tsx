import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Fingerprint,
  LockKeyhole,
  ShieldCheck,
  X,
} from 'lucide-react';
import { CONTROL_TEXT, RISK_META, TIER_META, formatMoney, type PendingAction } from '@bank/shared';
import clsx from 'clsx';
import { SheetShell } from '../ui/primitives';
import type { BankAgentApi } from '../../state/useBankAgent';

function useRemaining(expiresAt: string) {
  const [remaining, setRemaining] = useState(() => Math.max(0, new Date(expiresAt).getTime() - Date.now()));
  useEffect(() => {
    setRemaining(Math.max(0, new Date(expiresAt).getTime() - Date.now()));
    const timer = setInterval(() => {
      setRemaining(Math.max(0, new Date(expiresAt).getTime() - Date.now()));
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  return remaining;
}

export function ConfirmSheet({
  pending,
  agent,
  elderMode,
}: {
  pending: PendingAction;
  agent: BankAgentApi;
  elderMode: boolean;
}) {
  const remaining = useRemaining(pending.expiresAt);
  const [checked, setChecked] = useState(!elderMode);
  const [echo, setEcho] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const risk = pending.policy.effectiveRisk;
  const meta = RISK_META[risk];
  const isRed = risk === 'RED';
  const expired = remaining <= 0;
  const amount = pending.summary.amountCents;

  const methods = pending.challenge?.methods ?? [];
  const methodText = isRed
    ? methods.includes('SMS')
      ? '人脸识别 + 短信验证码'
      : '人脸识别'
    : '用户确认';

  const primaryLabel = isRed
    ? methods.includes('SMS')
      ? '人脸 + 短信验证'
      : '人脸识别并继续'
    : '确认执行';

  const confirm = async () => {
    if (expired || submitting) return;
    setSubmitting(true);
    try {
      await agent.confirm(true, echo.trim() || undefined);
    } finally {
      setSubmitting(false);
    }
  };

  const timerLabel = useMemo(() => {
    const sec = Math.ceil(remaining / 1000);
    return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  }, [remaining]);

  return (
    <SheetShell onClose={() => agent.setSheet(null)}>
      <div className="flex min-h-0 flex-col">
        <div className="flex items-start justify-between px-5 pb-2 pt-2">
          <div>
            <div
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[9px] font-medium"
              style={{ background: meta.bg, color: meta.color }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
              {meta.label}
            </div>
            <h3 className="mt-2.5 text-[17px] font-semibold text-[#14251f]">{pending.summary.title}</h3>
            <p className="mt-1 max-w-[280px] text-[9.5px] leading-relaxed text-[#7c8b82]">
              {pending.summary.subtitle ?? meta.strategy}
            </p>
          </div>
          <button
            onClick={() => agent.setSheet(null)}
            aria-label="关闭确认单"
            className="rounded-full p-1.5 text-[#6f7c74] transition hover:bg-black/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f3d33]/25"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-2">
          {amount && amount > 0 ? (
            <div className="mt-1 rounded-2xl bg-[#0F3D33] px-4 py-3.5 text-[#F4F1EC]">
              <div className="text-[9.5px] uppercase tracking-[0.18em] text-[#c7a667]">
                {pending.batchNodeIds && pending.batchNodeIds.length > 1 ? '本次任务合计' : '操作金额'}
              </div>
              <div className="mt-1 text-[28px] font-semibold leading-none tabular">
                {formatMoney(amount)}
              </div>
              {pending.summary.payee ? (
                <div className="mt-1.5 text-[9.5px] text-white/55">收款人 · {pending.summary.payee}</div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-3 divide-y divide-black/[0.045] rounded-xl border border-black/[0.055] bg-white/60 px-3">
            {pending.summary.rows.map((row, index) => (
              <div key={`${row.label}_${index}`} className="flex items-start justify-between gap-3 py-2.5">
                <span className="shrink-0 text-[10px] text-[#6f7c74]">{row.label}</span>
                <span
                  className={clsx(
                    'text-right text-[10.5px] leading-snug text-[#2f3d36]',
                    row.emphasis && 'font-semibold tabular text-[#14251f]',
                    row.tone === 'risk' && 'text-[#b3392e]',
                  )}
                >
                  {row.value}
                </span>
              </div>
            ))}
          </div>

          {pending.payeeEcho?.required ? (
            <div className="mt-3 rounded-xl border border-[#c9791f]/35 bg-[#c9791f]/[0.07] p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#8a5310]">
                <ShieldCheck size={13} /> 本次需复述收款人姓名
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-[#6f5a3b]">
                系统检测到该交易达到强确认档位，请输入收款人真实姓名（脱敏显示 {pending.payeeEcho.masked}）后才能执行。
              </p>
              <input
                value={echo}
                onChange={(event) => setEcho(event.target.value)}
                placeholder="请输入收款人姓名"
                autoComplete="off"
                className="mt-2 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-[13px] outline-none focus:border-[#c9791f]"
              />
            </div>
          ) : null}

          {pending.policy.tier ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="rounded-full border border-black/[0.08] bg-white/70 px-2 py-0.5 text-[9.5px] text-[#4c5a52]">
                安全档位 {pending.policy.tier} · {TIER_META[pending.policy.tier].name}
              </span>
              {(pending.policy.controls ?? []).map((control) => (
                <span
                  key={control}
                  className="rounded-full border border-black/[0.08] bg-white/70 px-2 py-0.5 text-[9.5px] text-[#4c5a52]"
                >
                  {CONTROL_TEXT[control]}
                </span>
              ))}
              {pending.policy.risk ? (
                <span className="rounded-full border border-black/[0.08] bg-white/70 px-2 py-0.5 text-[9.5px] text-[#4c5a52]">
                  风控评分 {pending.policy.risk.score}
                </span>
              ) : null}
            </div>
          ) : null}

          {(pending.summary.warnings ?? []).length ? (
            <div className="mt-2 space-y-1">
              {pending.summary.warnings?.map((warning) => (
                <div
                  key={warning}
                  className="flex items-start gap-1.5 rounded-lg bg-[#c9791f]/[0.055] px-2.5 py-2 text-[9px] leading-relaxed text-[#8a5a1f]"
                >
                  <AlertTriangle size={10} className="mt-0.5 shrink-0" />
                  {warning}
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-2 flex items-center justify-between rounded-lg bg-black/[0.022] px-2.5 py-2 text-[9.5px] text-[#6f7c74]">
            <span className="flex items-center gap-1">
              <LockKeyhole size={9} />
              操作摘要 <span className="mono">{pending.digest.slice(0, 10)}…</span>
            </span>
            <span className={expired ? 'text-[#b3392e]' : ''}>
              {expired ? '已超时' : `剩余 ${timerLabel}`}
            </span>
          </div>

          {elderMode ? (
            <button
              onClick={() => setChecked((v) => !v)}
              className="mt-2 flex w-full items-center gap-2 rounded-xl border border-black/[0.07] bg-white/70 px-3 py-2.5 text-left"
            >
              <span
                className={clsx(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                  checked ? 'border-[#0f3d33] bg-[#0f3d33] text-white' : 'border-black/20 bg-white',
                )}
              >
                {checked ? <Check size={10} /> : null}
              </span>
              <span className="text-[10px] text-[#5b675f]">适老模式：我已核对收款人与金额</span>
            </button>
          ) : null}
        </div>

        <div className="border-t border-black/[0.055] px-5 pb-5 pt-3">
          <div className="mb-2 flex items-center justify-between text-[9px] text-[#6f7c74]">
            <span className="flex items-center gap-1">
              <ShieldCheck size={9} className="text-[#2f7d5b]" /> 本次操作：{methodText}
            </span>
            <span>确认后才签发一次性授权</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => agent.cancel()}
              className="flex-1 rounded-xl border border-black/10 bg-white py-2.5 text-[11px] text-[#7c8b82] transition hover:bg-black/[0.02]"
            >
              取消
            </button>
            <button
              onClick={confirm}
              disabled={expired || submitting || !checked}
              className={clsx(
                'flex flex-[1.55] items-center justify-center gap-1.5 rounded-xl py-2.5 text-[11px] font-medium text-white transition',
                expired || submitting || !checked
                  ? 'cursor-not-allowed bg-[#9aa39d]'
                  : risk === 'RED'
                    ? 'bg-[#8e2c23] hover:bg-[#a2342a]'
                    : 'bg-[#0F3D33] hover:bg-[#155246]',
              )}
            >
              {isRed ? <Fingerprint size={13} /> : <Check size={13} />}
              {expired ? '操作已过期' : submitting ? '处理中…' : primaryLabel}
            </button>
          </div>
        </div>
      </div>
    </SheetShell>
  );
}
