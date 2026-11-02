import {
  ArrowDownLeft,
  ArrowUpRight,
  Ban,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  CreditCard,
  Gift,
  Lock,
  MessageSquare,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Wallet,
  ChartPie,
  TrendingUp,
  ArrowLeftRight,
  Repeat,
} from 'lucide-react';
import {
  CAPABILITIES,
  RISK_META,
  formatDate,
  formatDateTime,
  formatMoney,
  formatSignedMoney,
  type Card,
  type DataSourceInfo,
  type Intent,
} from '@bank/shared';
import clsx from 'clsx';
import { DEMO_LABELS } from '../../../lib/disclosure';
import { PhoneCard, CardTitle, CardFooter } from './PhoneCard';
import { Badge, RiskBadge } from '../../ui/primitives';

const INTENT_ICON: Record<Intent, any> = {
  transfer: ArrowLeftRight,
  bills: ChartPie,
  wealth: TrendingUp,
  card: CreditCard,
  subscription: Repeat,
  crossscene: Gift,
  account: Wallet,
  chitchat: MessageSquare,
  unknown: Sparkles,
};

export function CapabilitiesCard({
  data,
  capabilities,
  onSend,
  dataSource,
}: {
  data: any;
  capabilities?: Array<{ intent: string; label: string; example: string }>;
  onSend: (text: string) => void;
  dataSource?: DataSourceInfo;
}) {
  const items = capabilities?.length
    ? capabilities.map((item) => ({ ...item, intent: item.intent as Intent }))
    : CAPABILITIES;
  return (
    <PhoneCard accent="linear-gradient(90deg,#c7a667,#e3cfa5,transparent)" className="p-4">
      <CardTitle
        icon={<Sparkles size={15} />}
        title={data.title ?? '今天想办理什么？'}
        sub="说出需求，Agent 会先拆解任务，再按风险分级执行"
        action={<Badge tone="gold">6 大场景</Badge>}
      />
      <div className="mt-3 grid grid-cols-2 gap-1.5">
        {items.map((cap) => {
          const Icon = INTENT_ICON[cap.intent] ?? Sparkles;
          return (
            <button
              key={cap.intent}
              onClick={() => onSend(cap.example)}
              className="group flex items-center gap-2 rounded-xl border border-black/[0.05] bg-white/70 px-2.5 py-2 text-left transition hover:border-[#c7a667]/40 hover:bg-[#c7a667]/[0.06]"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0f3d33]/[0.06] text-[#0f3d33]">
                <Icon size={12} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[10.5px] font-medium text-[#23352d]">{cap.label}</span>
                <span className="mt-0.5 block truncate text-[9.5px] text-[#6f7c74]">{cap.example}</span>
              </span>
            </button>
          );
        })}
      </div>
      <CardFooter>
        <span className="flex items-center gap-1">
          <ShieldCheck size={10} className="text-[#2f7d5b]" /> 绿色自动 · 黄色确认 · 红色强验证
        </span>
        <span>{dataSource?.mode === 'http' ? dataSource.provider : DEMO_LABELS ? '演示环境' : '已加密通道'}</span>
      </CardFooter>
    </PhoneCard>
  );
}

export function ClarifyCard({
  data,
  onSend,
}: {
  data: any;
  onSend: (text: string) => void;
}) {
  return (
    <PhoneCard accent="#c7a667" className="p-4">
      <CardTitle
        icon={<CircleAlert size={15} />}
        title={data.title ?? '需要补充一点信息'}
        sub={data.prompt}
      />
      {data.options?.length ? (
        <div className="mt-3 flex flex-col gap-1.5">
          {data.options.map((option: any) => (
            <button
              key={option.label}
              onClick={() => onSend(option.label)}
              className="flex items-center justify-between rounded-xl border border-[#0f3d33]/10 bg-[#0f3d33]/[0.025] px-3 py-2.5 text-left transition hover:border-[#c7a667]/50 hover:bg-[#c7a667]/[0.06]"
            >
              <span className="text-[11px] text-[#23352d]">{option.label}</span>
              <ChevronRight size={13} className="text-[#6f7c74]" />
            </button>
          ))}
        </div>
      ) : null}
      <CardFooter>
        <span>也可以直接在输入框补充</span>
        <Badge tone="gold">等待补充</Badge>
      </CardFooter>
    </PhoneCard>
  );
}

export function BalanceCard({ data, dataSource }: { data: any; dataSource?: DataSourceInfo }) {
  const accounts = data.accounts ?? [];
  return (
    <PhoneCard accent="linear-gradient(90deg,#0f3d33,#155246,transparent)" className="p-4">
      <CardTitle
        icon={<Wallet size={15} />}
        title="账户余额"
        sub={`${accounts.length} 个账户 · 绿色查询自动执行`}
        action={<Badge tone="green">实时</Badge>}
      />
      <div className="mt-3 rounded-xl bg-[#0f3d33] px-3.5 py-3 text-[#f4f1ec]">
        <div className="text-[9px] uppercase tracking-[0.18em] text-[#c7a667]">总资产</div>
        <div className="mt-1 text-[24px] font-semibold leading-none tabular">
          {formatMoney(data.totalCents ?? 0)}
        </div>
        <div className="mt-1.5 text-[9px] text-white/65">
          可用 {formatMoney(data.availableTotalCents ?? data.totalCents ?? 0)}
        </div>
      </div>
      <div className="mt-3 divide-y divide-black/[0.05]">
        {accounts.map((account: any) => (
          <div key={account.id} className="flex items-center justify-between gap-3 py-2.5">
            <div className="flex items-center gap-2.5">
              <div
                className="flex h-7 w-7 items-center justify-center rounded-full text-[9px] font-semibold text-white"
                style={{ background: account.color ?? '#0f3d33' }}
              >
                {account.bank?.slice(0, 1)}
              </div>
              <div>
                <div className="text-[11px] font-medium text-[#23352d]">{account.name}</div>
                <div className="mt-0.5 text-[9px] text-[#6f7c74]">
                  尾号 {account.last4}
                  {account.lockedCents > 0 ? ` · 锁定 ${formatMoney(account.lockedCents)}` : ''}
                  {account.primary ? ' · 主账户' : ''}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11.5px] font-semibold tabular text-[#14251f]">
                {formatMoney(account.balanceCents)}
              </div>
              <div className="mt-0.5 text-[9.5px] text-[#6f7c74]">
                可用 {formatMoney(account.availableCents ?? account.balanceCents)}
              </div>
            </div>
          </div>
        ))}
      </div>
      <CardFooter>
        <span className="flex items-center gap-1">
          <ShieldCheck size={10} className="text-[#2f7d5b]" />{' '}
          {dataSource?.mode === 'http'
            ? `数据来自${dataSource.provider}`
            : DEMO_LABELS
              ? '数据来自模拟银行核心'
              : '数据经银行核心网关读取'}
        </span>
        <span>绿色权限</span>
      </CardFooter>
    </PhoneCard>
  );
}

export function TransactionsCard({ data }: { data: any }) {
  return (
    <PhoneCard accent="#0f3d33" className="p-4">
      <CardTitle
        icon={<ArrowLeftRight size={15} />}
        title="交易流水"
        sub={data.rangeLabel}
        action={<Badge tone="green">共 {data.total} 笔</Badge>}
      />
      <div className="mt-2 divide-y divide-black/[0.045]">
        {(data.items ?? []).map((txn: any) => (
          <div key={txn.id} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-[11px] text-[#23352d]">{txn.merchant}</div>
              <div className="mt-0.5 text-[9px] text-[#6f7c74]">
                {formatDate(txn.ts)} · {txn.category}
              </div>
            </div>
            <div
              className={clsx(
                'shrink-0 text-[11px] font-semibold tabular',
                txn.amountCents >= 0 ? 'text-[#2f7d5b]' : 'text-[#3f4c45]',
              )}
            >
              {formatSignedMoney(txn.amountCents)}
            </div>
          </div>
        ))}
      </div>
      <CardFooter>
        <span>最近展示 {data.items?.length ?? 0} 条</span>
        <span>绿色权限</span>
      </CardFooter>
    </PhoneCard>
  );
}

export function ErrorCard({ data }: { data: any }) {
  return (
    <PhoneCard accent="#b3392e" className="p-4">
      <CardTitle
        icon={<CircleAlert size={15} />}
        title={data.title ?? '操作未完成'}
        sub={data.nodeLabel}
        action={<Badge tone="red">未执行</Badge>}
      />
      <p className="card-text mt-3 rounded-xl bg-[#b3392e]/[0.055] px-3 py-2.5 text-[11px] leading-relaxed text-[#7b3b34]">
        {data.detail}
      </p>
      {data.code ? <div className="mt-2 text-[9px] text-[#9a8c88]">错误码：{data.code}</div> : null}
      <CardFooter>
        <span>所有操作均记录审计链</span>
        <span>可重新发起</span>
      </CardFooter>
    </PhoneCard>
  );
}

export function BlockedCard({ data }: { data: any }) {
  return (
    <PhoneCard accent="#b3392e" className="p-4">
      <CardTitle
        icon={<ShieldAlert size={15} />}
        title="安全拦截"
        sub="检测到疑似提示词注入"
        action={<Badge tone="red">风险 {data.score ?? 0}</Badge>}
      />
      <div className="mt-3 space-y-1.5">
        {(data.patterns ?? []).map((pattern: string) => (
          <div key={pattern} className="flex items-start gap-2 rounded-lg bg-[#b3392e]/[0.05] px-2.5 py-2">
            <Ban size={11} className="mt-0.5 shrink-0 text-[#b3392e]" />
            <span className="text-[10.5px] leading-snug text-[#7b3b34]">{pattern}</span>
          </div>
        ))}
        {(data.patterns ?? []).length === 0 ? (
          <div className="text-[10.5px] text-[#7b3b34]">{data.explanation}</div>
        ) : null}
      </div>
      <div className="mt-3 rounded-xl border border-[#0f3d33]/10 bg-[#0f3d33]/[0.035] px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-[9.5px] font-medium text-[#2f5b4c]">
          <ShieldCheck size={11} /> 服务端权限校验独立执行
        </div>
        <p className="mt-1 text-[9.5px] leading-relaxed text-[#7d8b83]">
          即使模型被诱导，工具白名单、风险分级与一次性授权令牌仍会阻止越权资金操作。
        </p>
      </div>
      <CardFooter>
        <span>已写入审计链</span>
        <span>{data.locked ? '会话已锁定' : '本次请求已阻断'}</span>
      </CardFooter>
    </PhoneCard>
  );
}

export function LockedCard({ data }: { data: any }) {
  return (
    <PhoneCard accent="#b3392e" className="p-5">
      <div className="flex flex-col items-center py-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[#b3392e]/20 bg-[#b3392e]/[0.07] text-[#b3392e]">
          <Lock size={20} />
        </div>
        <div className="mt-3 text-[14px] font-semibold text-[#14251f]">{data.title ?? '安全锁定'}</div>
        <p className="mt-1.5 max-w-[250px] text-[10.5px] leading-relaxed text-[#7c8b82]">
          {data.detail ?? '连续失败或可疑行为触发熔断'}
        </p>
        <div className="mt-3 rounded-full border border-[#c7a667]/30 bg-[#c7a667]/10 px-3 py-1 text-[9.5px] text-[#8c6c2f]">
          在右侧安全控制台点击「人工复核解锁」
        </div>
      </div>
    </PhoneCard>
  );
}

export function PendingCard({
  data,
  onOpenPending,
}: {
  data: any;
  onOpenPending: () => void;
}) {
  const pending = data.pending;
  return (
    <PhoneCard accent="#c9791f" className="p-4">
      <CardTitle
        icon={<Clock3 size={15} />}
        title="还有待确认的操作"
        sub={pending?.summary?.title ?? '请先完成确认或取消'}
        action={<RiskBadge risk={pending?.policy?.effectiveRisk ?? 'YELLOW'} compact />}
      />
      <button
        onClick={onOpenPending}
        className="mt-3 flex w-full items-center justify-between rounded-xl border border-[#c7a667]/30 bg-[#c7a667]/[0.07] px-3 py-2.5 text-[10.5px] text-[#7d5f27]"
      >
        查看待确认操作
        <ChevronRight size={13} />
      </button>
    </PhoneCard>
  );
}

export function CompensationCard({ data }: { data: any }) {
  const items = data.compensated ?? [];
  return (
    <PhoneCard accent="#2f7d5b" className="p-4">
      <CardTitle
        icon={<RotateCcw size={15} />}
        title={data.title ?? '任务回退结果'}
        sub={`${items.length} 个操作已按逆序冲正`}
        action={<Badge tone="green">已回退</Badge>}
      />
      <div className="mt-3 space-y-1.5">
        {items.map((item: any) => (
          <div key={item.nodeId} className="flex items-start gap-2 rounded-lg bg-[#2f7d5b]/[0.05] px-2.5 py-2">
            <Check size={11} className="mt-0.5 shrink-0 text-[#2f7d5b]" />
            <div>
              <div className="text-[10px] font-medium text-[#2a4a3d]">{item.label}</div>
              <div className="mt-0.5 text-[9px] text-[#7c8b82]">{item.detail}</div>
            </div>
          </div>
        ))}
        {(data.manual ?? []).map((item: any) => (
          <div key={item.nodeId} className="flex items-start gap-2 rounded-lg bg-[#c9791f]/[0.06] px-2.5 py-2">
            <CircleAlert size={11} className="mt-0.5 shrink-0 text-[#c9791f]" />
            <div>
              <div className="text-[10px] text-[#7d5f27]">{item.label}</div>
              <div className="mt-0.5 text-[9px] text-[#9a8460]">{item.reason}</div>
            </div>
          </div>
        ))}
        {(data.failed ?? []).map((item: any) => (
          <div key={item.nodeId} className="text-[9.5px] text-[#b3392e]">
            {item.label}：{item.error}
          </div>
        ))}
      </div>
      <CardFooter>
        <span>补偿过程已写入审计链</span>
        <span>状态：部分完成</span>
      </CardFooter>
    </PhoneCard>
  );
}

export function GenericCard({ data }: { data: any }) {
  return (
    <PhoneCard accent="#c7a667" className="p-4">
      <CardTitle icon={<Sparkles size={15} />} title={data.title ?? '任务结果'} sub={data.type} />
      <pre className="mt-3 max-h-[160px] overflow-auto rounded-lg bg-black/[0.035] p-2 text-[9px] leading-relaxed text-[#5b675f]">
        {JSON.stringify(data, null, 2)}
      </pre>
    </PhoneCard>
  );
}
