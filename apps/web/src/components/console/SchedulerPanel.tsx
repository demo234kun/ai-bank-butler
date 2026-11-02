import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, FastForward, Gift, Loader2, Lock, RefreshCw } from 'lucide-react';
import { formatDateTime, formatMoney, type AppNotification, type ScheduleItem } from '@bank/shared';
import clsx from 'clsx';
import { api } from '../../api/client';
import { Badge, Panel } from '../ui/primitives';

interface Feed {
  ok: boolean;
  items: AppNotification[];
  unreadCount: number;
  schedules: ScheduleItem[];
  lockedFunds: Array<{ id: string; amountCents: number; reason: string; releaseAt: string }>;
  giftOrders: Array<{ id: string; merchant: string; status: string; deliveryAt: string; amountCents: number }>;
  clock: { mode: 'demo' | 'real'; now: string; label: string };
}

interface AdvanceResult {
  ok: boolean;
  clock: Feed['clock'];
  result: { transfers: number; released: number; delivered: number; reminded: number; failures: number; skipped: number };
}

/** 真实调度器面板：展示到点任务与执行结果，演示时钟可前进并立即触发一轮扫描。 */
export function SchedulerPanel({ onExecuted }: { onExecuted?: () => void }) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<AdvanceResult['result'] | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get<Feed>('/api/notifications');
      setFeed(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '调度状态读取失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  const advance = async (days: number) => {
    setBusy(true);
    try {
      const result = await api.post<AdvanceResult>('/api/demo/advance-clock', { days });
      setLastRun(result.result);
      await load();
      onExecuted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '时钟推进失败');
    } finally {
      setBusy(false);
    }
  };

  const rows = [
    ...(feed?.schedules.map((item) => ({
      key: item.id,
      icon: <CalendarClock size={10} className="text-[#c7a667]" />,
      title: item.title,
      when: formatDateTime(item.executeAt),
      amount: item.amountCents ? formatMoney(item.amountCents) : '',
      tag: item.payload?.authorized ? '已授权' : '缺授权',
      ok: Boolean(item.payload?.authorized),
    })) ?? []),
    ...(feed?.lockedFunds.map((lock) => ({
      key: lock.id,
      icon: <Lock size={10} className="text-[#c7a667]" />,
      title: `预算锁定 · ${lock.reason}`,
      when: `${formatDateTime(lock.releaseAt)} 释放`,
      amount: formatMoney(lock.amountCents),
      tag: '锁定中',
      ok: true,
    })) ?? []),
    ...(feed?.giftOrders
      .filter((order) => order.status === 'scheduled')
      .map((order) => ({
        key: order.id,
        icon: <Gift size={10} className="text-[#c7a667]" />,
        title: `礼品订单 · ${order.merchant}`,
        when: `${formatDateTime(order.deliveryAt)} 送达`,
        amount: formatMoney(order.amountCents),
        tag: '待送达',
        ok: true,
      })) ?? []),
  ];

  return (
    <Panel
      eyebrow="SCHEDULER"
      title="计划任务与调度"
      action={
        <button
          onClick={() => void load()}
          className="flex items-center gap-1 rounded-full border border-white/10 px-2 py-1 text-[8.5px] text-[#93a49a] hover:bg-white/5"
        >
          <RefreshCw size={9} /> 刷新
        </button>
      }
    >
      <div className="flex items-center justify-between text-[9px] text-[#93a49a]">
        <span>
          业务时间 {feed?.clock.label ?? '…'} ·{' '}
          {feed?.clock.mode === 'real' ? '真实时钟（按自然时间执行）' : '演示时钟（可手动前进）'}
        </span>
        <span>未读提醒 {feed?.unreadCount ?? 0}</span>
      </div>

      <div className="mt-2 divide-y divide-white/6">
        {rows.length ? (
          rows.map((row) => (
            <div key={row.key} className="flex items-center justify-between gap-2 py-2">
              <div className="flex min-w-0 items-center gap-2">
                {row.icon}
                <div className="min-w-0">
                  <div className="truncate text-[9.5px] text-[#d9d2c3]">{row.title}</div>
                  <div className="mt-0.5 text-[8.5px] text-[#7f9087]">{row.when}</div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-[9.5px] tabular text-[#e0d8c8]">{row.amount}</span>
                <Badge tone={row.ok ? 'green' : 'amber'}>{row.tag}</Badge>
              </div>
            </div>
          ))
        ) : loading ? (
          <div className="flex items-center gap-1.5 py-4 text-[9px] text-[#7f9087]">
            <Loader2 size={10} className="animate-spin" /> 正在读取计划…
          </div>
        ) : (
          <div className="py-4 text-center text-[9px] text-[#7f9087]">当前没有待执行计划</div>
        )}
      </div>

      {error ? <div className="mt-2 text-[9px] text-[#e2a09a]">{error}</div> : null}

      {feed?.clock.mode !== 'real' ? (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-[8.5px] text-[#7f9087]">推进业务时间并立即扫描：</span>
          {[
            { label: '1 小时', days: 0 },
            { label: '1 天', days: 1 },
            { label: '3 天', days: 3 },
          ].map((option) => (
            <button
              key={option.label}
              disabled={busy}
              onClick={() => void advance(option.days)}
              className={clsx(
                'flex items-center gap-1 rounded-full border px-2.5 py-1 text-[9px] transition',
                'border-[#c7a667]/30 bg-[#c7a667]/10 text-[#e3cfa5] hover:bg-[#c7a667]/16',
                busy && 'opacity-50',
              )}
            >
              <FastForward size={9} /> {option.label}
            </button>
          ))}
        </div>
      ) : null}

      {lastRun ? (
        <div className="mt-2 rounded-lg bg-white/[0.03] px-2.5 py-2 text-[9px] leading-relaxed text-[#93a49a]">
          本轮执行：转账 {lastRun.transfers} 笔 · 释放预算 {lastRun.released} · 送达 {lastRun.delivered} ·
          提醒 {lastRun.reminded} · 待重试 {lastRun.skipped} · 失败 {lastRun.failures}
        </div>
      ) : null}

      {feed?.items.length ? (
        <div className="mt-3">
          <div className="text-[8.5px] uppercase tracking-[0.16em] text-[#7f9087]">最近执行记录</div>
          <div className="mt-1 space-y-1.5">
            {feed.items.slice(0, 4).map((item) => (
              <div key={item.id} className="rounded-lg bg-white/[0.03] px-2.5 py-1.5">
                <div className="text-[9px] text-[#d9d2c3]">{item.title}</div>
                <div className="mt-0.5 text-[8.5px] leading-relaxed text-[#7f9087]">{item.body}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Panel>
  );
}
