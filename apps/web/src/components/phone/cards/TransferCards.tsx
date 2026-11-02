import {
  ArrowUpRight,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock3,
  RotateCcw,
  Users,
} from 'lucide-react';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  type Risk,
} from '@bank/shared';
import { PhoneCard, CardTitle, Rows, CardFooter } from './PhoneCard';
import { Badge, RiskBadge } from '../../ui/primitives';

export function TransferReceipt({
  data,
  canUndo,
  onRollback,
}: {
  data: any;
  canUndo: boolean;
  onRollback: () => void;
}) {
  const recipients = data.recipients ?? [];
  const names = recipients.map((r: any) => r.name).join('、');
  return (
    <PhoneCard accent="linear-gradient(90deg,#0f3d33,#c7a667,transparent)" className="p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#2f7d5b]/10 text-[#2f7d5b]">
            <CheckCircle2 size={17} />
          </div>
          <div>
            <div className="text-[13px] font-semibold text-[#14251f]">转账成功</div>
            <div className="mt-0.5 text-[9px] text-[#6f7c74]">预计实时到账 · 已生成回单</div>
          </div>
        </div>
        <RiskBadge risk={(data.risk ?? 'YELLOW') as Risk} compact />
      </div>

      <div className="mt-4 text-center">
        <div className="text-[9px] uppercase tracking-[0.2em] text-[#6f7c74]">本次转出</div>
        <div className="mt-1 text-[30px] font-semibold leading-none tabular text-[#14251f]">
          {formatMoney(data.amountCents ?? 0)}
        </div>
        <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-[#0f3d33]/[0.055] px-2.5 py-1 text-[10px] text-[#3c5b4e]">
          转给 {names}
          <ArrowUpRight size={10} />
        </div>
      </div>

      <div className="mt-3">
        <Rows
          rows={[
            { label: '付款账户', value: `${data.from?.name ?? ''}（尾号 ${data.from?.last4 ?? ''}）` },
            { label: '交易时间', value: formatDateTime(data.executedAt) },
            ...(data.note ? [{ label: '备注', value: data.note }] : []),
            {
              label: '交易流水号',
              value: <span className="mono text-[9.5px]">{data.txnIds?.[0] ?? '—'}</span>,
            },
            {
              label: '当前可用余额',
              value: formatMoney(data.account?.availableCents ?? data.from?.availableCents ?? 0),
            },
          ]}
        />
      </div>

      {canUndo ? (
        <button
          onClick={onRollback}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-[#b3392e]/20 bg-[#b3392e]/[0.035] py-2 text-[10px] text-[#9e3f35] transition hover:bg-[#b3392e]/[0.07]"
        >
          <RotateCcw size={11} /> 撤销本次转账（当日可冲正）
        </button>
      ) : null}

      <CardFooter>
        <span className="flex items-center gap-1">
          <Check size={10} className="text-[#2f7d5b]" /> 回执由工具结果渲染
        </span>
        <span>{data.risk === 'RED' ? '红色 · 已强验证' : '黄色 · 已确认'}</span>
      </CardFooter>
    </PhoneCard>
  );
}

export function ScheduleReceipt({ data }: { data: any }) {
  const schedule = data.schedule ?? {};
  return (
    <PhoneCard accent="#c7a667" className="p-4">
      <CardTitle
        icon={<CalendarClock size={15} />}
        title="定时转账已创建"
        sub="执行前会再次校验余额与权限等级"
        action={<Badge tone="gold">计划中</Badge>}
      />
      <div className="mt-4 rounded-xl border border-[#0f3d33]/10 bg-[#0f3d33]/[0.025] px-3.5 py-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[9px] text-[#6f7c74]">收款人</div>
            <div className="mt-1 text-[12px] font-medium text-[#23352d]">{data.payee}</div>
          </div>
          <div className="text-right">
            <div className="text-[9px] text-[#6f7c74]">金额</div>
            <div className="mt-1 text-[16px] font-semibold tabular text-[#14251f]">
              {formatMoney(data.amountCents)}
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-1.5 border-t border-black/[0.05] pt-2.5 text-[10px] text-[#5b675f]">
          <Clock3 size={11} className="text-[#c7a667]" />
          {formatDateTime(schedule.executeAt)}
        </div>
      </div>
      <CardFooter>
        <span>计划编号 {schedule.id}</span>
        <span>可撤销</span>
      </CardFooter>
    </PhoneCard>
  );
}

export function SplitShareCard({ data }: { data: any }) {
  return (
    <PhoneCard accent="#0f3d33" className="p-4">
      <CardTitle
        icon={<Users size={15} />}
        title="AA 收款已发起"
        sub={`共 ${data.shares?.length ?? 0} 位联系人 · 总金额 ${formatMoney(data.totalCents ?? 0)}`}
        action={<Badge tone="gold">待收款</Badge>}
      />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-[#0f3d33] px-3 py-2.5 text-[#f4f1ec]">
          <div className="text-[9.5px] uppercase tracking-[0.16em] text-[#c7a667]">我的份额</div>
          <div className="mt-1 text-[17px] font-semibold tabular">{formatMoney(data.myShareCents ?? 0)}</div>
        </div>
        <div className="rounded-xl border border-[#c7a667]/30 bg-[#c7a667]/[0.06] px-3 py-2.5">
          <div className="text-[9.5px] uppercase tracking-[0.16em] text-[#8c6c2f]">待收总额</div>
          <div className="mt-1 text-[17px] font-semibold tabular text-[#7d5f27]">
            {formatMoney((data.totalCents ?? 0) - (data.myShareCents ?? 0))}
          </div>
        </div>
      </div>
      <div className="mt-3 space-y-1.5">
        {(data.shares ?? []).map((share: any) => (
          <div
            key={share.name}
            className="flex items-center justify-between rounded-xl border border-black/[0.05] bg-white/60 px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0f3d33]/[0.07] text-[9px] font-medium text-[#2f5b4c]">
                {share.name.slice(0, 1)}
              </div>
              <span className="text-[10.5px] text-[#23352d]">{share.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10.5px] font-medium tabular text-[#14251f]">
                {formatMoney(share.amountCents)}
              </span>
              <Badge tone="amber">待确认</Badge>
            </div>
          </div>
        ))}
      </div>
      <CardFooter>
        <span>请求编号 {data.requestId}</span>
        <span>{formatDate(data.createdAt)}</span>
      </CardFooter>
    </PhoneCard>
  );
}
