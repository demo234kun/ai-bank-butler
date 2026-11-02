import { useCallback, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeftRight,
  Coffee,
  CreditCard,
  HeartPulse,
  Home,
  Landmark,
  Plane,
  ReceiptText,
  Repeat,
  ShoppingBag,
  ShoppingBasket,
  Sparkles,
  Ticket,
  TrainFront,
  TrendingUp,
  UserRound,
  Utensils,
  WalletCards,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { formatDateShort, formatSignedMoney, formatTime } from '@bank/shared';
import type { OverviewTxn } from '@bank/shared';
import { AgentProvider, useAgent } from './AgentContext';
import { ProductDataProvider } from './ProductDataContext';
import { useAuth } from '../auth/AuthContext';
import { useOnlineStatus } from '../pwa/useOnlineStatus';
import { Toast } from '../components/Toast';

const CATEGORY_ICON: Record<string, LucideIcon> = {
  咖啡茶饮: Coffee,
  餐饮: Utensils,
  商超买菜: ShoppingBasket,
  交通出行: TrainFront,
  购物: ShoppingBag,
  生活缴费: ReceiptText,
  住房: Home,
  订阅服务: Repeat,
  旅行: Plane,
  医疗健康: HeartPulse,
  休闲娱乐: Ticket,
  投资理财: TrendingUp,
  转账: ArrowLeftRight,
  工资: Landmark,
  其他: WalletCards,
};

const CATEGORY_TINT: Record<string, string> = {
  咖啡茶饮: '#8C5A4A',
  餐饮: '#B07A2A',
  商超买菜: '#2F7D5B',
  交通出行: '#3C6E63',
  购物: '#6B4E8C',
  生活缴费: '#5C6B8A',
  住房: '#0F3D33',
  订阅服务: '#A34B3E',
  旅行: '#2E6B8A',
  医疗健康: '#A34B3E',
  休闲娱乐: '#9A7A3E',
  投资理财: '#4F6B5E',
  转账: '#0F3D33',
  工资: '#2F7D5B',
};

export function categoryMeta(name: string): { Icon: LucideIcon; color: string } {
  return {
    Icon: CATEGORY_ICON[name] ?? WalletCards,
    color: CATEGORY_TINT[name] ?? '#6F7D75',
  };
}

export function useStartChat(): (prompt?: string) => void {
  const agent = useAgent();
  const navigate = useNavigate();
  return useCallback(
    (prompt?: string) => {
      navigate('/app/chat');
      if (agent.state.pending) {
        agent.openPending();
        return;
      }
      if (prompt) void agent.send(prompt);
    },
    [agent, navigate],
  );
}

export function ProductRoot() {
  const { user } = useAuth();
  return (
    <AgentProvider key={user?.id}>
      <ProductDataProvider>
        <Outlet />
        <ProductToast />
      </ProductDataProvider>
    </AgentProvider>
  );
}

function ProductToast() {
  const agent = useAgent();
  return <Toast toast={agent.state.toast} onClose={agent.clearToast} />;
}

export function ProductLayout() {
  const agent = useAgent();
  const { online } = useOnlineStatus();
  return (
    <div className="product-stage">
      <div className="product-frame" data-elder={agent.state.elderMode}>
        {!online ? <OfflineBanner /> : null}
        <div className="product-scroll flex-1">
          <Outlet />
        </div>
        <BottomNav />
      </div>
    </div>
  );
}

function OfflineBanner() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex shrink-0 items-center gap-1.5 border-b border-[#c7a667]/25 bg-[#c7a667]/[0.14] px-4 py-2 text-[9.5px] text-[#6c5320]"
    >
      <WifiOff size={11} className="shrink-0" />
      设备已离线：账户与账单只在联网时从银行核心读取，页面展示的是最后一次成功加载的数据，操作不会在本地排队执行。
    </div>
  );
}

const NAV_ITEMS: Array<{ to: string; label: string; icon: LucideIcon; exact?: boolean }> = [
  { to: '/app', label: '首页', icon: Home, exact: true },
  { to: '/app/activity', label: '账单', icon: ReceiptText },
  { to: '/app/chat', label: 'AI 管家', icon: Sparkles },
  { to: '/app/cards', label: '卡片', icon: CreditCard },
  { to: '/app/profile', label: '我的', icon: UserRound },
];

function BottomNav() {
  const location = useLocation();
  return (
    <nav className="product-nav">
      {NAV_ITEMS.map((item) => {
        const active = item.exact
          ? location.pathname === item.to
          : location.pathname.startsWith(item.to);
        const Icon = item.icon;
        if (item.to === '/app/chat') {
          return (
            <Link
              key={item.to}
              to={item.to}
              className="product-nav-center product-nav-item"
              data-active={active}
            >
              <span className="product-nav-center-inner">
                <Icon size={20} />
              </span>
              <span>{item.label}</span>
            </Link>
          );
        }
        return (
          <Link
            key={item.to}
            to={item.to}
            className="product-nav-item"
            data-active={active}
          >
            <Icon size={17} strokeWidth={active ? 2.1 : 1.7} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function ProductPageHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="safe-top bg-[#F4F1EC]/92 sticky top-0 z-20 border-b border-black/[0.045] px-5 pb-3 pt-2 backdrop-blur-xl">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-[21px] font-semibold tracking-[-0.02em] text-[#14251f]">{title}</h1>
          {subtitle ? <div className="mt-1 text-[9px] text-[#7c8b82]">{subtitle}</div> : null}
        </div>
        {action}
      </div>
    </header>
  );
}

export function TransactionRow({
  txn,
  onClick,
  dense = false,
  hideAmount = false,
}: {
  txn: OverviewTxn;
  onClick?: () => void;
  dense?: boolean;
  hideAmount?: boolean;
}) {
  const { Icon, color } = categoryMeta(txn.category);
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex w-full items-center gap-3 text-left transition active:bg-black/[0.025]',
        dense ? 'py-2.5' : 'py-3',
      )}
    >
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
        style={{ background: `${color}14`, color }}
      >
        <Icon size={14} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[11px] font-medium text-[#23352d]">{txn.merchant}</span>
          {txn.anomaly ? (
            <span className="shrink-0 rounded-full bg-[#b3392e]/10 px-1.5 py-0.5 text-[8.5px] text-[#a2342a]">
              异常
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 text-[9.5px] text-[#6f7c74]">
          {formatDateShort(txn.ts)} · {txn.category} · {formatTime(txn.ts).slice(0, 5)}
        </div>
      </div>
      <span
        className={clsx(
          'shrink-0 text-[11px] font-semibold tabular',
          txn.amountCents >= 0 ? 'text-[#2f7d5b]' : 'text-[#3f4c45]',
        )}
      >
        {hideAmount ? '••••' : formatSignedMoney(txn.amountCents)}
      </span>
    </button>
  );
}

export function LoadingCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2.5 rounded-2xl border border-black/[0.05] bg-white/60 p-4">
      {Array.from({ length: lines }).map((_, index) => (
        <div
          key={index}
          className="skeleton h-3"
          style={{ width: `${100 - index * 12}%` }}
        />
      ))}
    </div>
  );
}

export function ProductSkeletonPage() {
  return (
    <div className="space-y-4 px-4 pb-6 pt-20">
      <div className="skeleton h-32 rounded-2xl" />
      <div className="skeleton h-20 rounded-2xl" />
      <LoadingCard lines={4} />
      <LoadingCard lines={3} />
    </div>
  );
}

