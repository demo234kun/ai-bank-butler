import type { ReactNode } from 'react';
import { Cake, CalendarDays, Flower2, Gift, Lock, Sparkles } from 'lucide-react';
import { formatDate, formatMoney } from '@bank/shared';
import { PhoneCard, CardFooter } from './PhoneCard';
import { Badge } from '../../ui/primitives';

export function BirthdayPlanCard({ data }: { data: any }) {
  const flowers = data.flowers;
  const cake = data.cake;
  return (
    <PhoneCard accent="linear-gradient(90deg,#8c5a4a,#c7a667,transparent)" className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.18em] text-[#9a7a3e]">
            <Gift size={11} /> 跨场景联动
          </div>
          <div className="mt-1.5 text-[16px] font-semibold text-[#14251f]">
            为{data.spouseName}准备的生日
          </div>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-[#7c8b82]">
            <CalendarDays size={11} className="text-[#c7a667]" />
            {data.birthdayLabel}
            <span className="rounded-full bg-[#8c5a4a]/10 px-2 py-0.5 text-[9.5px] text-[#8c5a4a]">
              {data.daysUntil} 天后
            </span>
          </div>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[#c7a667]/30 bg-[#c7a667]/10 text-[#9a7a3e]">
          <Cake size={18} />
        </div>
      </div>

      <div className="mt-3 rounded-xl bg-[#0f3d33] px-3.5 py-3 text-[#f4f1ec]">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-1 text-[9.5px] uppercase tracking-[0.16em] text-[#c7a667]">
              <Lock size={9} /> 已锁定活期预算
            </div>
            <div className="mt-1 text-[22px] font-semibold leading-none tabular">
              {formatMoney(data.budgetCents ?? 0)}
            </div>
          </div>
          <Badge tone="dark">生日后释放</Badge>
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-2 text-[9.5px] text-white/55">
          <span>活期+ · 尾号 6601</span>
          <span className="flex items-center gap-1 text-[#a6e0c5]">
            <Sparkles size={9} /> 避免提前花掉
          </span>
        </div>
      </div>

      <div className="relative mt-3 pl-4">
        <div className="absolute bottom-2 left-[5px] top-2 w-px bg-gradient-to-b from-[#c7a667]/50 via-[#c7a667]/25 to-transparent" />
        <TimelineItem
          icon={<Lock size={9} />}
          day="今天"
          title="锁定生日预算"
          detail={`${formatMoney(data.budgetCents ?? 0)} 已转入锁定资金`}
          done
        />
        <TimelineItem
          icon={<Flower2 size={9} />}
          day={data.tMinus2 ?? 'T-2'}
          title={flowers ? flowers.merchant : '预约鲜花'}
          detail={flowers ? `${formatMoney(flowers.amountCents)} · ${formatDate(flowers.deliveryAt)} 送达` : '待预约'}
          done={Boolean(flowers)}
        />
        <TimelineItem
          icon={<Cake size={9} />}
          day={data.tMinus1 ?? 'T-1'}
          title={cake ? cake.merchant : '预约蛋糕'}
          detail={cake ? `${formatMoney(cake.amountCents)} · ${formatDate(cake.deliveryAt)} 送达` : '待预约'}
          done={Boolean(cake)}
        />
        <TimelineItem
          icon={<CalendarDays size={9} />}
          day={data.birthdayLabel}
          title="生日提醒已写入日程"
          detail={data.note?.title ?? '当天 08:00 提醒'}
          done={Boolean(data.note)}
          last
        />
      </div>

      <CardFooter>
        <span>鲜花 + 蛋糕 + 提醒，一次对话完成</span>
        <span className="text-[#9e3f35]">可回退</span>
      </CardFooter>
    </PhoneCard>
  );
}

function TimelineItem({
  icon,
  day,
  title,
  detail,
  done,
  last = false,
}: {
  icon: ReactNode;
  day: string;
  title: string;
  detail: string;
  done?: boolean;
  last?: boolean;
}) {
  return (
    <div className={`relative ${last ? '' : 'pb-3.5'}`}>
      <div
        className={`absolute -left-4 top-0.5 flex h-3 w-3 items-center justify-center rounded-full border ${
          done
            ? 'border-[#c7a667] bg-[#c7a667] text-white'
            : 'border-black/15 bg-[#f4f1ec] text-transparent'
        }`}
      >
        {icon}
      </div>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[10.5px] font-medium text-[#23352d]">{title}</div>
          <div className="mt-0.5 text-[9px] text-[#6f7c74]">{detail}</div>
        </div>
        <span className="shrink-0 rounded-full bg-black/[0.035] px-2 py-0.5 text-[9px] text-[#7c8b82]">
          {day}
        </span>
      </div>
    </div>
  );
}
