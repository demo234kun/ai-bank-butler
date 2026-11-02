import { useCallback, useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  AlertTriangle,
  CalendarClock,
  CreditCard,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react';
import {
  DISPUTE_REASON_TEXT,
  DISPUTE_STATUS_TEXT,
  disputeStageIndex,
  formatDateTime,
  formatMoney,
  type Dispute,
  type DisputeReason,
  type TxnDetailPayload,
} from '@bank/shared';
import { api, ApiError } from '../api/client';

const STAGES = ['已受理', '银行核查中', '结论反馈'];

export function TxnDetailSheet({
  txnId,
  onClose,
  onAsk,
  onDisputeChange,
}: {
  txnId: string | null;
  onClose: () => void;
  onAsk: (text: string) => void;
  onDisputeChange?: () => void;
}) {
  const [detail, setDetail] = useState<TxnDetailPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<DisputeReason>('duplicate');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!txnId) return;
    setLoading(true);
    setError(null);
    try {
      const payload = await api.get<TxnDetailPayload & { ok: boolean }>(
        `/api/transactions/${encodeURIComponent(txnId)}`,
      );
      setDetail(payload);
      if (payload.similar.length) setReason('duplicate');
    } catch (err) {
      setError(err instanceof Error ? err.message : '交易详情加载失败');
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [txnId]);

  useEffect(() => {
    if (txnId) void load();
    else setDetail(null);
  }, [load, txnId]);

  if (!txnId) return null;

  const txn = detail?.txn;
  const dispute = detail?.dispute ?? null;
  const stage = dispute ? disputeStageIndex(dispute.status) : -1;

  const submitDispute = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await api.post<{ dispute: Dispute }>(
        `/api/transactions/${encodeURIComponent(txnId)}/dispute`,
        { reason, note: note.trim() || undefined },
      );
      setDetail((current) => (current ? { ...current, dispute: response.dispute, disputeEligible: { ok: false, code: 'DISPUTE_EXISTS', message: '申诉已提交' } } : current));
      onDisputeChange?.();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DISPUTE_EXISTS') {
        setError(err.message);
        await load();
        return;
      }
      setError(err instanceof Error ? err.message : '申诉提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[72] flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center">
      <div className="flex max-h-[92vh] w-full max-w-[430px] flex-col rounded-t-[26px] bg-[#FBFAF7] shadow-2xl sm:rounded-[24px]">
        <header className="flex items-start justify-between border-b border-black/[0.05] px-5 py-4">
          <div>
            <div className="text-[15px] font-semibold text-[#14251f]">交易详情</div>
            <div className="mt-0.5 text-[9.5px] text-[#6f7c74]">
              {txn ? `流水号 ${txn.id}` : '正在读取银行核心记录'}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭交易详情"
            className="rounded-full p-1.5 text-[#6f7c74] transition hover:bg-black/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f3d33]/25"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && !detail ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[10px] text-[#7c8b82]">
              <Loader2 size={14} className="animate-spin" /> 正在读取…
            </div>
          ) : !txn ? (
            <div className="py-10 text-center text-[10px] text-[#6f7c74]">{error ?? '暂无交易记录'}</div>
          ) : (
            <>
              <div className="text-center">
                <div
                  className={clsx(
                    'text-[30px] font-semibold leading-none tabular',
                    txn.amountCents >= 0 ? 'text-[#2f7d5b]' : 'text-[#14251f]',
                  )}
                >
                  {txn.amountCents >= 0 ? '+' : '-'}
                  {formatMoney(Math.abs(txn.amountCents))}
                </div>
                <div className="mt-2 text-[11px] text-[#23352d]">{txn.merchant}</div>
                <div className="mt-1 text-[9.5px] text-[#6f7c74]">
                  {formatDateTime(txn.ts)} · {txn.category}
                </div>
              </div>

              {txn.anomaly ? (
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-[#c7a667]/30 bg-[#c7a667]/[0.07] px-3 py-2.5 text-[9px] leading-relaxed text-[#7a5c1f]">
                  <ShieldAlert size={12} className="mt-0.5 shrink-0" />
                  {txn.anomalyReason ?? '该笔交易被识别为异常，请核对是否本人操作'}
                </div>
              ) : null}

              <div className="mt-4 divide-y divide-black/[0.045] rounded-xl border border-black/[0.055] bg-white/60">
                <Row label="付款方式" value={txn.channel} />
                <Row label="交易状态" value={txn.status === 'posted' ? '已入账' : '已冲正'} />
                {detail?.account ? (
                  <Row
                    label="所属账户"
                    value={`${detail.account.name} · 尾号 ${detail.account.last4}`}
                    icon={<CreditCard size={11} />}
                  />
                ) : null}
                {txn.location ? <Row label="交易地点" value={txn.location} /> : null}
                {txn.note ? <Row label="附言" value={txn.note} /> : null}
                {detail?.product ? (
                  <Row label="关联产品" value={`${detail.product.name} · ${detail.product.riskLevel}`} />
                ) : null}
                {detail?.subscription ? (
                  <Row
                    label="关联订阅"
                    value={`${detail.subscription.merchant} · ${
                      detail.subscription.status === 'active' ? '自动续费中' : '已取消'
                    }`}
                    icon={<CalendarClock size={11} />}
                  />
                ) : null}
              </div>

              {detail && detail.similar.length ? (
                <div className="mt-3 rounded-xl border border-[#b3392e]/20 bg-[#b3392e]/[0.04] px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-[9.5px] font-medium text-[#9e3f35]">
                    <AlertTriangle size={11} /> 疑似重复扣费
                  </div>
                  <div className="mt-1 text-[9.5px] leading-relaxed text-[#7c8b82]">
                    同日同商户同金额还有 {detail.similar.length} 笔：
                    {detail.similar.map((item) => formatDateTime(item.ts)).join('、')}
                  </div>
                  <button
                    onClick={() =>
                      onAsk(
                        `这笔「${txn.merchant}」${formatMoney(Math.abs(txn.amountCents))} 出现多次，帮我看看是不是重复扣费`,
                      )
                    }
                    className="mt-2 flex items-center gap-1 text-[9.5px] font-medium text-[#0f3d33]"
                  >
                    <Sparkles size={9} /> 让 AI 管家核对
                  </button>
                </div>
              ) : null}

              {dispute ? (
                <div className="mt-4 rounded-xl border border-black/[0.06] bg-white/70 px-3.5 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[10px] font-medium text-[#23352d]">
                        争议工单 {dispute.reference}
                      </div>
                      <div className="mt-0.5 text-[9.5px] text-[#6f7c74]">
                        {DISPUTE_REASON_TEXT[dispute.reason]} · {formatMoney(Math.abs(dispute.amountCents))}
                      </div>
                    </div>
                    <span
                      className={clsx(
                        'shrink-0 rounded-full px-2 py-0.5 text-[9px] font-medium',
                        dispute.status === 'resolved_credit'
                          ? 'bg-[#2f7d5b]/10 text-[#2f5b4c]'
                          : dispute.status === 'rejected'
                            ? 'bg-[#b3392e]/10 text-[#9e3f35]'
                            : 'bg-[#c7a667]/12 text-[#8c6c2f]',
                      )}
                    >
                      {DISPUTE_STATUS_TEXT[dispute.status]}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center">
                    {STAGES.map((label, index) => (
                      <div key={label} className="flex flex-1 items-center last:flex-none">
                        <div className="flex flex-col items-center">
                          <span
                            className={clsx(
                              'h-2 w-2 rounded-full',
                              index <= stage ? 'bg-[#0f3d33]' : 'bg-black/15',
                            )}
                          />
                          <span className="mt-1 whitespace-nowrap text-[8.5px] text-[#7c8b82]">{label}</span>
                        </div>
                        {index < STAGES.length - 1 ? (
                          <span
                            className={clsx(
                              'mb-3 h-px flex-1',
                              index < stage ? 'bg-[#0f3d33]' : 'bg-black/10',
                            )}
                          />
                        ) : null}
                      </div>
                    ))}
                  </div>
                  {dispute.note ? (
                    <div className="mt-2 text-[9.5px] leading-relaxed text-[#5b675f]">补充说明：{dispute.note}</div>
                  ) : null}
                  <div className="mt-2 flex items-center justify-between text-[9px] text-[#6f7c74]">
                    <span>提交于 {formatDateTime(dispute.createdAt)}</span>
                    <span>预计 {formatDateTime(dispute.expectedFinishAt)}</span>
                  </div>
                  {dispute.resolution ? (
                    <div className="mt-2 rounded-lg bg-black/[0.03] px-2.5 py-2 text-[9.5px] leading-relaxed text-[#5b675f]">
                      {dispute.resolution}
                    </div>
                  ) : null}
                </div>
              ) : detail?.disputeEligible.ok ? (
                <div className="mt-4 rounded-xl border border-black/[0.06] bg-white/70 px-3.5 py-3">
                  <div className="text-[10px] font-medium text-[#23352d]">对这笔交易有疑问</div>
                  <div className="mt-0.5 text-[9px] leading-relaxed text-[#6f7c74]">
                    提交后由银行核心差错处理，AI 不直接改账；处理进度与结论都会回到这张工单。
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {(Object.keys(DISPUTE_REASON_TEXT) as DisputeReason[]).map((key) => (
                      <button
                        key={key}
                        onClick={() => setReason(key)}
                        aria-pressed={reason === key}
                        className={clsx(
                          'rounded-full border px-2.5 py-1 text-[9.5px] transition',
                          reason === key
                            ? 'border-[#0f3d33] bg-[#0f3d33] text-[#f4f1ec]'
                            : 'border-black/[0.08] bg-white text-[#7c8b82]',
                        )}
                      >
                        {DISPUTE_REASON_TEXT[key]}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value.slice(0, 300))}
                    placeholder="补充说明（选填，最多 300 字）"
                    aria-label="争议补充说明"
                    className="mt-2.5 w-full resize-none rounded-lg border border-black/[0.08] bg-white px-2.5 py-2 text-[9px] leading-relaxed text-[#23352d] placeholder:text-[#b2bab4] focus:border-[#0f3d33]/40 focus:outline-none"
                    rows={2}
                  />
                  <button
                    onClick={() => void submitDispute()}
                    disabled={submitting}
                    className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#0F3D33] py-2.5 text-[10px] text-[#f4f1ec] disabled:opacity-60"
                  >
                    {submitting ? (
                      <>
                        <Loader2 size={12} className="animate-spin" /> 提交中…
                      </>
                    ) : (
                      '提交争议申诉'
                    )}
                  </button>
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-black/[0.06] bg-black/[0.02] px-3.5 py-3 text-[9.5px] leading-relaxed text-[#7c8b82]">
                  {error ?? detail?.disputeEligible.message ?? '该交易不支持线上申诉'}
                </div>
              )}

              {error && dispute ? (
                <div className="mt-2 text-[9.5px] text-[#9e3f35]">{error}</div>
              ) : null}
            </>
          )}
        </div>

        <footer className="flex items-center gap-2 border-t border-black/[0.05] px-5 py-4">
          <button
            onClick={() => void load()}
            className="flex items-center gap-1 rounded-xl border border-black/10 bg-white px-3 py-2.5 text-[9px] text-[#7c8b82]"
          >
            <RefreshCw size={11} /> 刷新
          </button>
          {txn ? (
            <button
              onClick={() =>
                onAsk(`帮我核对这笔交易：${txn.merchant} ${formatMoney(Math.abs(txn.amountCents))}，${txn.category}`)
              }
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#0F3D33] py-2.5 text-[10px] text-[#f4f1ec]"
            >
              <Sparkles size={11} /> 问 AI 管家
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <span className="flex shrink-0 items-center gap-1 text-[9.5px] text-[#6f7c74]">
        {icon}
        {label}
      </span>
      <span className="min-w-0 truncate text-right text-[9.5px] text-[#23352d]">{value}</span>
    </div>
  );
}
