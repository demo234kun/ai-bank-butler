import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Gavel, ReceiptText, Sparkles } from 'lucide-react';
import clsx from 'clsx';
import {
  DISPUTE_REASON_TEXT,
  DISPUTE_STATUS_TEXT,
  formatDateTime,
  formatMoney,
  type Dispute,
  type OverviewTxn,
  type TransactionListPayload,
} from '@bank/shared';
import { api } from '../api/client';
import {
  ProductPageHeader,
  ProductSkeletonPage,
  TransactionRow,
  categoryMeta,
  useStartChat,
} from './ProductChrome';
import { ProgressBar } from '../components/ui/primitives';
import { useProductData } from './ProductDataContext';
import { TxnDetailSheet } from './TxnDetailSheet';
import { DEMO_LABELS } from '../lib/disclosure';

type Period = 'currentMonth' | 'lastMonth' | 'year';

const PERIOD_TABS: Array<{ id: Period; label: string }> = [
  { id: 'currentMonth', label: '本月' },
  { id: 'lastMonth', label: '上月' },
  { id: 'year', label: '今年' },
];

export function ActivityPage() {
  const [period, setPeriod] = useState<Period>('currentMonth');
  const [data, setData] = useState<TransactionListPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [detailTxnId, setDetailTxnId] = useState<string | null>(null);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const startChat = useStartChat();
  const { overview } = useProductData();

  const loadDisputes = useCallback(async () => {
    try {
      const payload = await api.get<{ ok: boolean; items: Dispute[] }>('/api/disputes');
      setDisputes(payload.items);
    } catch {
      // 工单读取失败不影响账单主流程
      setDisputes([]);
    }
  }, []);

  useEffect(() => {
    void loadDisputes();
  }, [loadDisputes]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<TransactionListPayload>(`/api/transactions?period=${period}&limit=160`)
      .then((payload) => {
        if (!cancelled) {
          setData(payload);
          setCategory(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '账单加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period]);

  const categories = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, number>();
    for (const txn of data.items) {
      if (txn.amountCents >= 0) continue;
      map.set(txn.category, (map.get(txn.category) ?? 0) + Math.abs(txn.amountCents));
    }
    return [...map.entries()]
      .map(([name, amountCents]) => ({ name, amountCents }))
      .sort((a, b) => b.amountCents - a.amountCents)
      .slice(0, 6);
  }, [data]);

  const visible: OverviewTxn[] = useMemo(() => {
    if (!data) return [];
    return category
      ? data.items.filter((txn) => txn.category === category)
      : data.items;
  }, [data, category]);

  return (
    <div className="pb-6">
      <ProductPageHeader
        title="账单"
        subtitle={data?.periodLabel ?? '交易明细与分类洞察'}
        action={
          <button
            onClick={() => startChat('帮我分析这个月账单，重点看异常消费')}
            className="flex items-center gap-1 rounded-full bg-[#0F3D33] px-2.5 py-1.5 text-[9.5px] text-[#f4f1ec]"
          >
            <Sparkles size={9} /> 问管家
          </button>
        }
      />

      <div className="px-4 pt-3">
        <div className="flex gap-1 rounded-full border border-black/[0.06] bg-white/60 p-0.5">
          {PERIOD_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setPeriod(tab.id)}
              className={clsx(
                'flex-1 rounded-full py-1.5 text-[9px] transition',
                period === tab.id
                  ? 'bg-[#0F3D33] text-[#f4f1ec] shadow-sm'
                  : 'text-[#7c8b82]',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {loading && !data ? (
        <ProductSkeletonPage />
      ) : error ? (
        <div className="mx-4 mt-6 rounded-xl border border-[#b3392e]/15 bg-[#b3392e]/[0.04] p-4 text-[10px] text-[#9e3f35]">
          {error}
          <button onClick={() => setPeriod(period)} className="ml-2 underline">
            重试
          </button>
        </div>
      ) : data ? (
        <>
          <section className="mt-3 px-4">
            <div className="rounded-[20px] border border-black/[0.05] bg-[#0F3D33] p-4 text-[#F4F1EC] shadow-card">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[9px] uppercase tracking-[0.16em] text-[#c7a667]">
                    {data.periodLabel}
                  </div>
                  <div className="mt-1.5 text-[25px] font-semibold leading-none tabular">
                    {formatMoney(data.expenseCents)}
                  </div>
                  <div className="mt-1 text-[9px] text-white/65">总支出（含全部账户）</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.055] px-2.5 py-2 text-right">
                  <div className="text-[8.5px] text-white/65">收入</div>
                  <div className="mt-0.5 text-[11px] font-medium tabular text-[#a6e0c5]">
                    +{formatMoney(data.incomeCents)}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-2 text-[9px] text-white/60">
                <span>{data.total} 条交易 · {data.items.filter((txn) => txn.anomaly).length} 笔异常</span>
                <span className="flex items-center gap-1 text-[#8fd0b3]">
                  {DEMO_LABELS || overview?.dataSource?.mode === 'http' ? (
                    <>
                      <ReceiptText size={8} />{' '}
                      {overview?.dataSource?.mode === 'http' ? '数据来自合作银行核心' : '数据来自模拟核心'}
                    </>
                  ) : (
                    <>
                      <ReceiptText size={8} /> 数据实时同步
                    </>
                  )}
                </span>
              </div>
            </div>
          </section>

          {categories.length ? (
            <section className="mt-3 px-4">
              <div className="rounded-[18px] border border-black/[0.055] bg-[#FBFAF7] p-3.5 shadow-card">
                <div className="text-[10px] font-medium text-[#23352d]">支出构成</div>
                <div className="mt-2.5 space-y-2">
                  {categories.slice(0, 4).map((item) => {
                    const meta = categoryMeta(item.name);
                    const max = categories[0]?.amountCents ?? 1;
                    return (
                      <div key={item.name}>
                        <div className="mb-1 flex items-center justify-between text-[9.5px]">
                          <span className="flex items-center gap-1.5 text-[#5b675f]">
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ background: meta.color }}
                            />
                            {item.name}
                          </span>
                          <span className="tabular text-[#3f4c45]">
                            {formatMoney(item.amountCents)}
                          </span>
                        </div>
                        <ProgressBar value={item.amountCents} max={max} tone="gold" height={3} />
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          ) : null}

          <section className="mt-3 px-4">
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
              <button
                onClick={() => setCategory(null)}
                className={clsx(
                  'shrink-0 rounded-full border px-2.5 py-1 text-[9.5px]',
                  category === null
                    ? 'border-[#0f3d33] bg-[#0f3d33] text-[#f4f1ec]'
                    : 'border-black/[0.08] bg-white/60 text-[#7c8b82]',
                )}
              >
                全部
              </button>
              {categories.map((item) => (
                <button
                  key={item.name}
                  onClick={() => setCategory(item.name)}
                  className={clsx(
                    'shrink-0 rounded-full border px-2.5 py-1 text-[9.5px]',
                    category === item.name
                      ? 'border-[#0f3d33] bg-[#0f3d33] text-[#f4f1ec]'
                      : 'border-black/[0.08] bg-white/60 text-[#7c8b82]',
                  )}
                >
                  {item.name}
                </button>
              ))}
            </div>
          </section>

          <section className="mt-2 px-4">
            {disputes.length ? (
              <div className="mb-3 rounded-[18px] border border-black/[0.055] bg-[#FBFAF7] shadow-card">
                <div className="flex items-center justify-between border-b border-black/[0.045] px-4 py-2.5">
                  <div className="flex items-center gap-1.5 text-[9.5px] font-medium text-[#7c8b82]">
                    <Gavel size={11} className="text-[#8c6c2f]" /> 申诉工单
                  </div>
                  <button
                    onClick={() => void loadDisputes()}
                    className="rounded-full border border-black/[0.08] px-2 py-0.5 text-[9px] text-[#7c8b82] hover:bg-black/[0.025]"
                  >
                    刷新状态
                  </button>
                </div>
                <div className="divide-y divide-black/[0.045] px-4">
                  {disputes.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setDetailTxnId(item.txnId)}
                      className="flex w-full items-center justify-between gap-3 py-2.5 text-left"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[9.5px] font-medium text-[#23352d]">
                          {item.merchant} · {formatMoney(Math.abs(item.amountCents))}
                        </div>
                        <div className="mt-0.5 text-[8.5px] text-[#6f7c74]">
                          {item.reference} · {DISPUTE_REASON_TEXT[item.reason]} · 提交于{' '}
                          {formatDateTime(item.createdAt)}
                        </div>
                      </div>
                      <span
                        className={clsx(
                          'shrink-0 rounded-full px-2 py-0.5 text-[8.5px] font-medium',
                          item.status === 'resolved_credit'
                            ? 'bg-[#2f7d5b]/10 text-[#2f5b4c]'
                            : item.status === 'rejected'
                              ? 'bg-[#b3392e]/10 text-[#9e3f35]'
                              : 'bg-[#c7a667]/12 text-[#8c6c2f]',
                        )}
                      >
                        {DISPUTE_STATUS_TEXT[item.status]}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="rounded-[18px] border border-black/[0.055] bg-[#FBFAF7] px-4 pb-1 shadow-card">
              <div className="flex items-center justify-between border-b border-black/[0.045] py-2.5">
                <div className="text-[9.5px] font-medium text-[#7c8b82]">交易明细</div>
                <div className="text-[9px] text-[#6f7c74]">点击查看明细与申诉</div>
              </div>
              {visible.length === 0 ? (
                <div className="py-10 text-center text-[9px] text-[#6f7c74]">没有匹配的交易</div>
              ) : (
                <div className="divide-y divide-black/[0.045]">
                  {visible.map((txn) => (
                    <TransactionRow key={txn.id} txn={txn} onClick={() => setDetailTxnId(txn.id)} />
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => startChat('帮我分析今年账单，看看消费趋势')}
              className="mt-3 flex w-full items-center justify-center gap-1 rounded-xl border border-[#c7a667]/25 bg-[#c7a667]/[0.06] py-2.5 text-[9px] text-[#8c6c2f]"
            >
              让 AI 管家分析这份账单 <ChevronRight size={10} />
            </button>
          </section>
        </>
      ) : null}

      <TxnDetailSheet
        txnId={detailTxnId}
        onClose={() => setDetailTxnId(null)}
        onAsk={(text) => {
          setDetailTxnId(null);
          startChat(text);
        }}
        onDisputeChange={() => void loadDisputes()}
      />
    </div>
  );
}
