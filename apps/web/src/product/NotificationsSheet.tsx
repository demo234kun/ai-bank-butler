import { useCallback, useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  CheckCheck,
  Gift,
  Loader2,
  Lock,
  RefreshCw,
  X,
} from 'lucide-react';
import { formatDateTime, formatMoney, type AppNotification, type ScheduleItem } from '@bank/shared';
import { api } from '../api/client';
import { DEMO_LABELS } from '../lib/disclosure';

interface NotificationFeed {
  ok: boolean;
  items: AppNotification[];
  unreadCount: number;
  schedules: ScheduleItem[];
  lockedFunds: Array<{ id: string; amountCents: number; reason: string; releaseAt: string }>;
  giftOrders: Array<{ id: string; merchant: string; status: string; deliveryAt: string; amountCents: number }>;
  clock: { mode: 'demo' | 'real'; now: string; label: string };
}

const KIND_ICON = {
  schedule: CalendarClock,
  budget: Lock,
  gift: Gift,
  note: Bell,
  risk: AlertTriangle,
  dispute: AlertTriangle,
  review: AlertTriangle,
  system: Bell,
} as const;

export function NotificationsSheet({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<NotificationFeed | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const feed = await api.get<NotificationFeed>('/api/notifications');
      setData(feed);
      if (feed.unreadCount > 0) {
        await api.post('/api/notifications/read', {});
        onChanged?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '提醒加载失败');
    } finally {
      setLoading(false);
    }
  }, [onChanged]);

  useEffect(() => {
    if (open) void load();
  }, [load, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[74] flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center">
      <div className="flex max-h-[92vh] w-full max-w-[430px] flex-col rounded-t-[26px] bg-[#FBFAF7] shadow-2xl sm:rounded-[24px]">
        <header className="flex items-start justify-between border-b border-black/[0.05] px-5 py-4">
          <div>
            <div className="flex items-center gap-1.5 text-[15px] font-semibold text-[#14251f]">
              <Bell size={15} className="text-[#0f3d33]" />
              计划与提醒
            </div>
            <div className="mt-1 text-[9px] text-[#6f7c74]">
              调度器每 10 秒扫描到点任务 · 当前业务时间 {data?.clock.label ?? '…'}（
              {data?.clock.mode === 'real' || !DEMO_LABELS ? '系统时间' : '演示时间'}）
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => void load()}
              aria-label="刷新提醒"
              className="rounded-full p-1.5 text-[#95a099] transition hover:bg-black/[0.04]"
            >
              <RefreshCw size={14} />
            </button>
            <button
              onClick={onClose}
              aria-label="关闭提醒中心"
              className="rounded-full p-1.5 text-[#95a099] transition hover:bg-black/[0.04]"
            >
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="product-scroll flex-1 px-5 py-4">
          {loading && !data ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[10px] text-[#7c8b82]">
              <Loader2 size={14} className="animate-spin" /> 正在读取…
            </div>
          ) : error ? (
            <div className="rounded-xl border border-[#b3392e]/15 bg-[#b3392e]/[0.04] p-4 text-[10px] text-[#9e3f35]">
              {error}
            </div>
          ) : (
            <>
              <Section title="待执行计划" empty={!data?.schedules.length ? '暂无待执行计划' : undefined}>
                {data?.schedules.map((item) => (
                  <div key={item.id} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <div className="text-[10px] font-medium text-[#23352d]">{item.title}</div>
                      <div className="mt-0.5 text-[9px] leading-relaxed text-[#6f7c74]">
                        {formatDateTime(item.executeAt)} 执行 · {item.detail ?? '到点自动办理'}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5">
                        {item.payload?.authorized ? (
                          <span className="rounded-full bg-[#2f7d5b]/10 px-1.5 py-0.5 text-[8.5px] text-[#2f5b4c]">
                            已授权到点执行
                          </span>
                        ) : (
                          <span className="rounded-full bg-[#c9791f]/12 px-1.5 py-0.5 text-[8.5px] text-[#8a5a1f]">
                            未授权 · 到点不会扣款
                          </span>
                        )}
                        {item.attempts ? (
                          <span className="text-[8.5px] text-[#6f7c74]">已尝试 {item.attempts} 次</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      {item.amountCents ? (
                        <div className="text-[11px] font-semibold tabular text-[#14251f]">
                          {formatMoney(item.amountCents)}
                        </div>
                      ) : null}
                      <div className="mt-0.5 text-[8.5px] text-[#6f7c74]">{item.id}</div>
                    </div>
                  </div>
                ))}
              </Section>

              {data?.lockedFunds.length ? (
                <Section title="锁定中的预算">
                  {data.lockedFunds.map((lock) => (
                    <div key={lock.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-[10px] text-[#23352d]">
                          <Lock size={11} className="text-[#8c6c2f]" />
                          {lock.reason}
                        </div>
                        <div className="mt-0.5 text-[9px] text-[#6f7c74]">
                          {formatDateTime(lock.releaseAt)} 自动释放
                        </div>
                      </div>
                      <div className="shrink-0 text-[11px] font-semibold tabular text-[#14251f]">
                        {formatMoney(lock.amountCents)}
                      </div>
                    </div>
                  ))}
                </Section>
              ) : null}

              {data?.giftOrders.length ? (
                <Section title="生活服务订单">
                  {data.giftOrders.map((order) => (
                    <div key={order.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-[10px] text-[#23352d]">
                          <Gift size={11} className="text-[#8c6c2f]" />
                          {order.merchant}
                        </div>
                        <div className="mt-0.5 text-[9px] text-[#6f7c74]">
                          约定送达 {formatDateTime(order.deliveryAt)}
                        </div>
                      </div>
                      <span
                        className={clsx(
                          'shrink-0 rounded-full px-2 py-0.5 text-[8.5px]',
                          order.status === 'delivered'
                            ? 'bg-[#2f7d5b]/10 text-[#2f5b4c]'
                            : 'bg-[#c7a667]/12 text-[#8c6c2f]',
                        )}
                      >
                        {order.status === 'delivered' ? '已送达' : '待送达'}
                      </span>
                    </div>
                  ))}
                </Section>
              ) : null}

              <Section title="执行记录" empty="还没有到点执行的任务">
                {data?.items.map((item) => {
                  const Icon = KIND_ICON[item.kind] ?? Bell;
                  return (
                    <div key={item.id} className="flex items-start gap-2.5 py-2.5">
                      <span
                        className={clsx(
                          'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                          item.kind === 'risk' ? 'bg-[#b3392e]/[0.08] text-[#9e3f35]' : 'bg-[#0f3d33]/[0.06] text-[#0f3d33]',
                        )}
                      >
                        <Icon size={12} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] font-medium text-[#23352d]">{item.title}</div>
                        <div className="mt-0.5 text-[9px] leading-relaxed text-[#6f7c74]">{item.body}</div>
                        <div className="mt-1 text-[8.5px] text-[#95a099]">{formatDateTime(item.ts)}</div>
                      </div>
                    </div>
                  );
                })}
              </Section>
            </>
          )}
        </div>

        <footer className="border-t border-black/[0.05] px-5 py-3">
          <div className="flex items-center gap-1.5 text-[8.5px] leading-relaxed text-[#6f7c74]">
            <CheckCheck size={11} className="shrink-0 text-[#2f7d5b]" />
            到点执行只走已授权的计划，执行结果写入审计链；未通过额度或余额校验的计划会停止并提醒，不会伪造成功。
          </div>
        </footer>
      </div>
    </div>
  );
}

function Section({
  title,
  empty,
  children,
}: {
  title: string;
  empty?: string;
  children: ReactNode;
}) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <section className="mb-4 last:mb-0">
      <div className="text-[9.5px] font-medium text-[#7c8b82]">{title}</div>
      <div className="mt-1 divide-y divide-black/[0.045] rounded-xl border border-black/[0.055] bg-white/60 px-3.5 py-1">
        {items.length ? items : <div className="py-4 text-center text-[9px] text-[#95a099]">{empty}</div>}
      </div>
    </section>
  );
}
