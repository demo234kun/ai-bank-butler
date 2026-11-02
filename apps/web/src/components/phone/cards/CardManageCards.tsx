import {
  BadgeCheck,
  CreditCard,
  Lock,
  PlusCircle,
  ShieldOff,
  Snowflake,
  Unlock,
  Wallet,
} from 'lucide-react';
import { formatDateTime, formatMoney } from '@bank/shared';
import clsx from 'clsx';
import { PhoneCard, CardTitle, Rows, CardFooter } from './PhoneCard';
import { Badge } from '../../ui/primitives';

const STATUS_LABEL: Record<string, string> = {
  active: '正常',
  frozen: '已冻结',
  lost: '已挂失',
  cancelled: '已注销',
};

const TYPE_LABEL: Record<string, string> = {
  debit: '借记卡',
  credit: '信用卡',
  virtual: '虚拟卡',
};

export function CardsCard({ data }: { data: any }) {
  const items: any[] = data.items ?? [];
  return (
    <PhoneCard accent="linear-gradient(90deg,#0f3d33,#c7a667,transparent)" className="p-4">
      <CardTitle
        icon={<CreditCard size={15} />}
        title="卡片与额度"
        sub={`名下 ${items.length} 张卡片`}
        action={<Badge tone="green">绿色查询</Badge>}
      />
      <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar pb-1">
        {items.map((card) => (
          <div
            key={card.id}
            className="bank-card-face h-[88px] w-[168px] shrink-0 p-3"
            style={{ background: `linear-gradient(145deg, ${card.color ?? '#0F3D33'}, #0A1A15)` }}
          >
            <div className="flex items-start justify-between">
              <span className="text-[9px] uppercase tracking-[0.16em] text-white/55">
                {TYPE_LABEL[card.type] ?? card.type}
              </span>
              <span className="text-[9.5px] font-medium text-[#e3cfa5]">{card.network}</span>
            </div>
            <div className="mt-2 text-[12px] tracking-[0.18em] text-white/85">
              •••• {card.last4}
            </div>
            <div className="mt-2 flex items-end justify-between">
              <div>
                <div className="text-[8.5px] uppercase tracking-[0.14em] text-white/60">
                  {card.type === 'credit' ? '可用额度' : '有效期'}
                </div>
                <div className="mt-0.5 text-[9.5px] text-white/80 tabular">
                  {card.type === 'credit'
                    ? formatMoney(card.availableCents ?? 0)
                    : card.expiry}
                </div>
              </div>
              <span
                className={clsx(
                  'rounded-full px-1.5 py-0.5 text-[8.5px]',
                  card.status === 'active'
                    ? 'bg-[#8fd0b3]/15 text-[#a6e0c5]'
                    : 'bg-[#f0a49b]/15 text-[#f0a49b]',
                )}
              >
                {STATUS_LABEL[card.status] ?? card.status}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 divide-y divide-black/[0.045]">
        {items.map((card) => (
          <div key={`${card.id}_row`} className="flex items-center justify-between py-2">
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-[#7c8b82]">尾号 {card.last4}</span>
              <Badge tone={card.status === 'active' ? 'green' : 'red'}>
                {STATUS_LABEL[card.status]}
              </Badge>
              {card.virtual ? <Badge tone="gold">虚拟</Badge> : null}
            </div>
            <div className="text-right">
              {card.type === 'credit' ? (
                <div className="text-[9.5px] tabular text-[#5b675f]">
                  额度 {formatMoney(card.limitCents ?? 0)} · 已用 {formatMoney(card.usedCents ?? 0)}
                </div>
              ) : (
                <div className="text-[9.5px] tabular text-[#5b675f]">
                  账户余额 {formatMoney(card.accountBalanceCents ?? 0)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 rounded-xl border border-dashed border-[#c7a667]/30 bg-[#c7a667]/[0.045] px-3 py-2 text-[9.5px] leading-relaxed text-[#8c6c2f]">
        试试说：“申请一张虚拟卡，额度 3000” · “把尾号 1234 的卡挂失” · “信用卡额度调到 2000”
      </div>
      <CardFooter>
        <span className="flex items-center gap-1">
          <BadgeCheck size={9} className="text-[#2f7d5b]" /> 卡片状态实时同步
        </span>
        <span>申请 / 挂失需按等级验证</span>
      </CardFooter>
    </PhoneCard>
  );
}

export function CardReceipt({ data }: { data: any }) {
  const action = data.action;
  const Icon =
    action === 'apply_virtual'
      ? PlusCircle
      : action === 'report_loss'
        ? ShieldOff
        : action === 'freeze'
          ? Snowflake
          : action === 'unfreeze'
            ? Unlock
            : CreditCard;
  const title =
    action === 'apply_virtual'
      ? '虚拟卡申请成功'
      : action === 'report_loss'
        ? '卡片已挂失'
        : action === 'freeze'
          ? '卡片已临时冻结'
          : action === 'unfreeze'
            ? '卡片已解除冻结'
            : '卡片额度已调整';
  const card = data.card ?? {};
  return (
    <PhoneCard accent={action === 'report_loss' ? '#b3392e' : 'linear-gradient(90deg,#0f3d33,#c7a667,transparent)'} className="p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0f3d33]/[0.08] text-[#0f3d33]">
            <Icon size={16} />
          </div>
          <div>
            <div className="text-[13px] font-semibold text-[#14251f]">{title}</div>
            <div className="mt-0.5 text-[9px] text-[#6f7c74]">
              {TYPE_LABEL[card.type] ?? '卡片'} · 尾号 {card.last4}
            </div>
          </div>
        </div>
        <Badge tone={action === 'report_loss' ? 'red' : 'green'}>
          {STATUS_LABEL[card.status] ?? '已更新'}
        </Badge>
      </div>

      <div className="mt-3">
        <Rows
          rows={[
            ...(data.limitCents
              ? [{ label: '卡片额度', value: formatMoney(data.limitCents), emphasis: true }]
              : []),
            ...(data.previousLimitCents
              ? [{ label: '调整前额度', value: formatMoney(data.previousLimitCents) }]
              : []),
            ...(card.status
              ? [{ label: '当前状态', value: STATUS_LABEL[card.status] ?? card.status }]
              : []),
            ...(card.expiry ? [{ label: '有效期', value: card.expiry }] : []),
          ]}
        />
      </div>

      {action === 'report_loss' ? (
        <div className="mt-2 flex items-start gap-1.5 rounded-xl bg-[#b3392e]/[0.055] px-3 py-2 text-[9px] leading-relaxed text-[#8c3a31]">
          <Lock size={10} className="mt-0.5 shrink-0" />
          挂失立即生效，所有交易已停止；补办新卡请前往网点或视频柜员。
        </div>
      ) : null}

      <CardFooter>
        <span className="flex items-center gap-1">
          <Wallet size={9} /> 已写入审计链
        </span>
        <span>{data.label ?? '操作成功'}</span>
      </CardFooter>
    </PhoneCard>
  );
}
