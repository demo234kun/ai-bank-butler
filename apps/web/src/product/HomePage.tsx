import {
  ArrowLeftRight,
  Bell,
  CalendarHeart,
  ChevronRight,
  CreditCard,
  Eye,
  EyeOff,
  ReceiptText,
  Repeat,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { formatMoney } from '@bank/shared';
import { useProductData } from './ProductDataContext';
import { useAgent } from './AgentContext';
import {
  ProductSkeletonPage,
  TransactionRow,
  useStartChat,
} from './ProductChrome';
import { Badge } from '../components/ui/primitives';
import { NotificationsSheet } from './NotificationsSheet';
import { DEMO_LABELS } from '../lib/disclosure';

function greetingFor(iso?: string): string {
  if (!iso) return '你好';
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      hour12: false,
    }).format(new Date(iso)),
  );
  if (hour < 6) return '夜深了';
  if (hour < 12) return '上午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

export function HomePage() {
  const { overview, loading, error, refresh } = useProductData();
  const agent = useAgent();
  const navigate = useNavigate();
  const startChat = useStartChat();
  const [hideAmount, setHideAmount] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  if (loading && !overview) return <ProductSkeletonPage />;
  if (!overview) {
    return (
      <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-3 px-8 text-center">
        <div className="text-[12px] text-[#7c8b82]">{error ?? '账户数据加载失败'}</div>
        <button
          onClick={() => void refresh()}
          className="rounded-full bg-[#0f3d33] px-4 py-2 text-[10px] text-[#f4f1ec]"
        >
          重新加载
        </button>
      </div>
    );
  }

  const assetAccounts = overview.accounts.filter((account) => account.type !== 'credit');
  const totalCents = assetAccounts.reduce((sum, account) => sum + account.balanceCents, 0);
  const availableTotalCents = assetAccounts.reduce(
    (sum, account) =>
      sum + (account.availableCents ?? account.balanceCents - account.lockedCents),
    0,
  );
  const lockedTotalCents = assetAccounts.reduce((sum, account) => sum + account.lockedCents, 0);
  const primary = overview.accounts.find((account) => account.primary) ?? overview.accounts[0];
  const name = overview.user.name;
  const prompts = overview.quickPrompts;
  const pending = agent.state.pending;

  const quickActions = [
    {
      label: '转账',
      icon: ArrowLeftRight,
      onClick: () => startChat(prompts[0]),
    },
    {
      label: '账单',
      icon: ReceiptText,
      onClick: () => navigate('/app/activity'),
    },
    {
      label: '理财',
      icon: TrendingUp,
      onClick: () => startChat(prompts[2]),
    },
    {
      label: '卡片',
      icon: CreditCard,
      onClick: () => navigate('/app/cards'),
    },
    {
      label: '订阅',
      icon: Repeat,
      onClick: () => startChat(prompts[3]),
    },
    {
      label: '生日',
      icon: CalendarHeart,
      onClick: () => startChat(prompts[5]),
    },
  ];

  return (
    <div className="pb-6">
      <section className="home-hero relative overflow-hidden rounded-b-[30px] px-5 pb-12 safe-top">
        <div className="pointer-events-none absolute -right-14 -top-16 h-44 w-44 rounded-full border border-[#c7a667]/15" />
        <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full border border-[#c7a667]/10" />

        {pending ? (
          <button
            onClick={() => {
              navigate('/app/chat');
              agent.openPending();
            }}
            className="mb-4 flex w-full items-center justify-between rounded-xl border border-[#e3cfa5]/25 bg-[#c7a667]/12 px-3 py-2 text-left"
          >
            <span className="flex items-center gap-1.5 text-[9px] text-[#f0dfb8]">
              <span className="h-1.5 w-1.5 animate-soft-pulse rounded-full bg-[#e3cfa5]" />
              有 1 个操作等待确认
            </span>
            <ChevronRight size={12} className="text-[#e3cfa5]" />
          </button>
        ) : agent.state.busy ? (
          <button
            onClick={() => navigate('/app/chat')}
            className="mb-4 flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-left"
          >
            <span className="flex items-center gap-1.5 text-[9px] text-white/70">
              <LoaderDots /> AI 管家正在执行任务
            </span>
            <ChevronRight size={12} className="text-[#e3cfa5]" />
          </button>
        ) : null}

        <div className="flex items-start justify-between">
          <div>
            <div className="text-[9px] tracking-[0.2em] text-[#c7a667]">
              {greetingFor(overview.demoNow)}
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[#f8f5ee]">
                {name}
              </h1>
              <span className="rounded-full border border-white/12 bg-white/[0.06] px-2 py-0.5 text-[8.5px] text-[#d9e4dc]">
                {overview.user.tier}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-1 text-[9px] text-white/65">
              <ShieldCheck size={9} className="text-[#8fd0b3]" />
              审计开启 ·{' '}
              {overview.dataSource?.mode === 'http'
                ? '银行核心直连'
                : DEMO_LABELS
                  ? '合成数据'
                  : '全程留痕'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setNotificationsOpen(true)}
              aria-label={`计划与提醒${(overview.notifications?.unreadCount ?? 0) > 0 ? `，${overview.notifications?.unreadCount} 条未读` : ''}`}
              className="relative flex h-10 w-10 items-center justify-center rounded-full border border-white/12 bg-white/[0.055] text-white/75 transition hover:text-white"
            >
              <Bell size={15} />
              {(overview.notifications?.unreadCount ?? 0) > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#c7a667] px-1 text-[8.5px] font-medium text-[#14251f] tabular">
                  {overview.notifications?.unreadCount}
                </span>
              ) : null}
            </button>
            <button
              onClick={() => navigate('/app/profile')}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-[#c7a667]/35 bg-[#c7a667]/10 text-[14px] font-medium text-[#f0dfb8]"
            >
              {name.slice(0, 1)}
            </button>
          </div>
        </div>

        <div className="mt-6">
          <div className="flex items-center gap-2 text-[9px] text-white/65">
            <span>总资产（元）</span>
            <button
              onClick={() => setHideAmount((value) => !value)}
              className="text-white/65 transition hover:text-white/80"
              title={hideAmount ? '显示金额' : '隐藏金额'}
            >
              {hideAmount ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          </div>
          <div className="mt-1.5 flex items-end gap-2">
            <span className="amount-display text-[34px] font-semibold leading-none text-[#fbf8f1]">
              {hideAmount ? '¥ ••••' : formatMoney(totalCents)}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-white/60">
            <Wallet size={9} />
            {primary ? `${primary.bank} 尾号 ${primary.last4}` : '主账户'}
            <span className="text-white/20">|</span>
            可用 {hideAmount ? '••••' : formatMoney(availableTotalCents)}
            {lockedTotalCents > 0 ? (
              <>
                <span className="text-white/20">|</span>
                锁定 {hideAmount ? '••••' : formatMoney(lockedTotalCents)}
              </>
            ) : null}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-white/8 bg-white/[0.055] px-3 py-2.5">
            <div className="text-[9px] text-white/65">本月支出</div>
            <div className="mt-1 text-[13px] font-semibold tabular text-[#f4f1ec]">
              {hideAmount ? '••••' : formatMoney(overview.month.expenseCents)}
            </div>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/[0.055] px-3 py-2.5">
            <div className="text-[9px] text-white/65">本月收入</div>
            <div className="mt-1 text-[13px] font-semibold tabular text-[#a6e0c5]">
              {hideAmount ? '••••' : formatMoney(overview.month.incomeCents)}
            </div>
          </div>
        </div>
      </section>

      <section className="-mt-7 px-4">
        <div className="grid grid-cols-6 gap-0.5 rounded-[20px] border border-black/[0.05] bg-[#FBFAF7] px-2 py-2 shadow-card">
          {quickActions.map((action) => (
            <button key={action.label} onClick={action.onClick} className="quick-tile">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0f3d33]/[0.055] text-[#0f3d33]">
                <action.icon size={16} strokeWidth={1.8} />
              </span>
              <span className="text-[9px] text-[#4f5d55]">{action.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-4 px-4">
        <div className="relative overflow-hidden rounded-[18px] border border-[#c7a667]/25 bg-[#c7a667]/[0.07] p-4">
          <div className="pointer-events-none absolute -right-5 -top-8 h-24 w-24 rounded-full border border-[#c7a667]/20" />
          <div className="flex items-start gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0f3d33] text-[#e3cfa5]">
              <Sparkles size={14} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold text-[#3f3a2c]">AI 管家提醒</span>
                <Badge tone="gold">本月</Badge>
              </div>
              <p className="mt-1 text-[9.5px] leading-relaxed text-[#6f654f]">
                本月生活支出 {hideAmount ? '••••' : formatMoney(overview.month.expenseCents)}，
                {overview.month.anomalyCount > 0
                  ? `发现 ${overview.month.anomalyCount} 笔可疑交易，建议先核对。`
                  : '目前未发现明显异常。'}
                订阅每月 {hideAmount ? '••••' : formatMoney(overview.subscriptions.monthlyCents)}。
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  onClick={() => startChat('帮我分析这个月账单，重点看异常消费')}
                  className="rounded-full bg-[#0f3d33] px-2.5 py-1.5 text-[9.5px] text-[#f4f1ec]"
                >
                  让管家分析
                </button>
                <button
                  onClick={() => navigate('/app/activity')}
                  className="rounded-full border border-[#0f3d33]/12 bg-white/60 px-2.5 py-1.5 text-[9.5px] text-[#5b675f]"
                >
                  查看账单
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-4 px-4">
        <div className="rounded-[18px] border border-black/[0.055] bg-[#FBFAF7] px-4 pb-1 pt-3.5 shadow-card">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <ReceiptText size={12} className="text-[#0f3d33]" />
              <span className="text-[11px] font-semibold text-[#23352d]">最近交易</span>
            </div>
            <button
              onClick={() => navigate('/app/activity')}
              className="flex items-center gap-0.5 text-[9px] text-[#8c6c2f]"
            >
              全部 <ChevronRight size={9} />
            </button>
          </div>
          <div className="mt-1 divide-y divide-black/[0.045]">
            {overview.recentTransactions.slice(0, 5).map((txn) => (
              <TransactionRow
                key={txn.id}
                txn={txn}
                dense
                hideAmount={hideAmount}
                onClick={() => navigate('/app/activity')}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="mt-3 px-4">
        <div className="flex items-center justify-between rounded-xl border border-black/[0.045] bg-white/45 px-3 py-2 text-[9px] text-[#7c8b82]">
          <span className="flex items-center gap-1">
            <ShieldCheck size={9} className="text-[#2f7d5b]" />
            审计链{overview.audit.verified ? '完整' : '待校验'} · {overview.audit.count} 条
          </span>
          <span>当日小额剩余 {hideAmount ? '••••' : formatMoney(overview.limits.remainingCents)}</span>
        </div>
      </section>

      <section className="mt-3 px-4">
        <button
          onClick={() => startChat()}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#0f3d33]/15 py-2.5 text-[9px] text-[#0f3d33]/70"
        >
          <Sparkles size={10} /> 直接和管家说一句话
        </button>
      </section>

      <NotificationsSheet
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        onChanged={() => void refresh()}
      />
    </div>
  );
}

function LoaderDots() {
  return (
    <span className="flex items-end gap-0.5">
      <span className="typing-dot !bg-[#e3cfa5]" />
      <span className="typing-dot !bg-[#e3cfa5]" />
      <span className="typing-dot !bg-[#e3cfa5]" />
    </span>
  );
}
