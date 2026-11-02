import { CalendarClock, CheckCircle2, Repeat, TriangleAlert } from 'lucide-react';
import { formatDateShort, formatMoney, formatPercent } from '@bank/shared';
import clsx from 'clsx';
import { PhoneCard, CardTitle, Rows, CardFooter } from './PhoneCard';
import { Badge } from '../../ui/primitives';

export function SubscriptionsCard({
  data,
  onSend,
}: {
  data: any;
  onSend: (text: string) => void;
}) {
  const items: any[] = data.items ?? [];
  const active = items.filter((item) => item.status === 'active');
  const changes: any[] = data.priceChanges ?? [];
  return (
    <PhoneCard accent="linear-gradient(90deg,#0f3d33,#c7a667,transparent)" className="p-4">
      <CardTitle
        icon={<Repeat size={15} />}
        title="订阅与代扣体检"
        sub={`识别到 ${active.length} 个自动续费`}
        action={<Badge tone="gold">每月 {formatMoney(data.totalMonthlyCents ?? 0)}</Badge>}
      />

      {data.duplicateCharge ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-[#c9791f]/20 bg-[#c9791f]/[0.055] px-3 py-2">
          <TriangleAlert size={12} className="mt-0.5 shrink-0 text-[#c9791f]" />
          <div>
            <div className="text-[9.5px] font-medium text-[#7d5f27]">疑似重复扣费</div>
            <div className="mt-0.5 text-[9.5px] leading-relaxed text-[#9a8460]">
              「{data.duplicateMerchant}」本月出现两笔同额扣款，建议核对会员周期。
            </div>
          </div>
        </div>
      ) : null}

      {changes.length ? (
        <div className="mt-2 rounded-xl border border-[#c7a667]/25 bg-[#c7a667]/[0.055] px-3 py-2">
          <div className="text-[9.5px] font-medium text-[#7d5f27]">订阅涨价提醒</div>
          {changes.map((change) => (
            <div key={change.subscription.id} className="mt-1 flex items-center justify-between text-[9.5px] text-[#9a8460]">
              <span>
                {change.subscription.merchant}：{formatMoney(change.previousAmountCents)} →{' '}
                {formatMoney(change.currentAmountCents)}
              </span>
              <span>每年多 {formatMoney(change.annualExtraCents)}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-3 space-y-1.5">
        {active.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between gap-2 rounded-xl border border-black/[0.05] bg-white/60 px-2.5 py-2.5"
          >
            <div className="flex min-w-0 items-center gap-2">
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[9px] font-medium text-white"
                style={{ background: item.color ?? '#0f3d33' }}
              >
                {item.merchant.slice(0, 1)}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  <span className="truncate text-[10.5px] font-medium text-[#23352d]">
                    {item.merchant}
                  </span>
                  {item.priceIncreased ? <Badge tone="amber">涨价</Badge> : null}
                </div>
                <div className="mt-0.5 text-[9.5px] text-[#6f7c74]">
                  下次扣款 {formatDateShort(item.nextChargeAt)} · {item.category}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-[10px] font-medium tabular text-[#14251f]">
                {formatMoney(item.amountCents)}
                <span className="ml-0.5 text-[9px] font-normal text-[#6f7c74]">/月</span>
              </span>
              <button
                onClick={() => onSend(`取消${item.merchant}自动续费`)}
                className="rounded-full border border-[#b3392e]/20 px-2 py-1 text-[9.5px] text-[#9e3f35] transition hover:bg-[#b3392e]/[0.06]"
              >
                取消
              </button>
            </div>
          </div>
        ))}
      </div>

      <CardFooter>
        <span className="flex items-center gap-1">
          <CalendarClock size={9} className="text-[#c7a667]" /> 下次扣款前可随时取消
        </span>
        <span>黄色 · 取消需确认</span>
      </CardFooter>
    </PhoneCard>
  );
}

export function SubscriptionReceipt({ data }: { data: any }) {
  return (
    <PhoneCard accent="#2f7d5b" className="p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#2f7d5b]/10 text-[#2f7d5b]">
            <CheckCircle2 size={17} />
          </div>
          <div>
            <div className="text-[13px] font-semibold text-[#14251f]">已取消自动续费</div>
            <div className="mt-0.5 text-[9px] text-[#6f7c74]">{data.subscription?.merchant}</div>
          </div>
        </div>
        <Badge tone="green">生效</Badge>
      </div>
      <div className="mt-3">
        <Rows
          rows={[
            { label: '每月节省', value: formatMoney(data.monthlySavedCents ?? 0), emphasis: true },
            { label: '当前状态', value: data.subscription?.status === 'cancelled' ? '已取消续费' : '—' },
            {
              label: '权益说明',
              value: '已购会员权益保留至当前周期结束',
            },
          ]}
        />
      </div>
      <CardFooter>
        <span>可恢复代扣</span>
        <span>已记录审计</span>
      </CardFooter>
    </PhoneCard>
  );
}
