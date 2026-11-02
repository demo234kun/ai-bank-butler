import { ChartPie, CircleAlert, Coffee, ShieldQuestion, Sparkles, TriangleAlert } from 'lucide-react';
import {
  formatDateShort,
  formatDateTime,
  formatMoney,
  formatPercent,
} from '@bank/shared';
import { PhoneCard, CardTitle, CardFooter } from './PhoneCard';
import { Badge, Donut, ProgressBar } from '../../ui/primitives';
import { categoryColor } from '../../../lib/colors';

export function BillReportCard({ data }: { data: any }) {
  const categories: any[] = data.categories ?? [];
  const top = categories.slice(0, 4);
  const rest = categories.slice(4).reduce((sum, c) => sum + c.amountCents, 0);
  const segments = top.map((c) => ({ label: c.name, value: c.amountCents, color: categoryColor(c.name) }));
  if (rest > 0) segments.push({ label: '其他', value: rest, color: '#B8B1A5' });
  const delta = Number(data.deltaPct ?? 0);
  const up = delta > 0;
  const anomalies: any[] = data.anomalies ?? [];
  const insight = data.insight;

  return (
    <PhoneCard accent="linear-gradient(90deg,#0f3d33,#c7a667,transparent)" className="p-4">
      <CardTitle
        icon={<ChartPie size={15} />}
        title="账单分析"
        sub={data.periodLabel}
        action={
          <Badge tone={anomalies.length ? 'amber' : 'green'}>
            {anomalies.length ? `${anomalies.length} 笔可疑` : '未见异常'}
          </Badge>
        }
      />

      <div className="mt-3 flex items-end justify-between">
        <div>
          <div className="text-[9px] uppercase tracking-[0.16em] text-[#6f7c74]">生活支出</div>
          <div className="mt-1 text-[26px] font-semibold leading-none tabular text-[#14251f]">
            {formatMoney(data.totalExpenseCents ?? 0)}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-[9.5px]">
            <span
              className={`rounded-full px-1.5 py-0.5 ${
                up ? 'bg-[#c9791f]/10 text-[#a86218]' : 'bg-[#2f7d5b]/10 text-[#2f7d5b]'
              }`}
            >
              {up ? '↑' : '↓'} {formatPercent(Math.abs(delta))}
            </span>
            <span className="text-[#6f7c74]">较{data.prevLabel}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9px] text-[#6f7c74]">收入</div>
          <div className="mt-1 text-[12px] font-medium tabular text-[#2f7d5b]">
            +{formatMoney(data.incomeCents ?? 0)}
          </div>
          <div className="mt-2 text-[9px] text-[#6f7c74]">{data.txCount} 条流水</div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-4">
        <Donut
          segments={segments}
          center={formatMoney(data.totalExpenseCents ?? 0, false)}
          sub="本月支出"
          size={104}
          thickness={10}
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          {top.map((category) => (
            <div key={category.name} className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: categoryColor(category.name) }}
                />
                <span className="truncate text-[9.5px] text-[#5b675f]">{category.name}</span>
              </div>
              <span className="shrink-0 text-[9.5px] tabular text-[#3f4c45]">
                {formatMoney(category.amountCents, false)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 space-y-2 rounded-xl bg-black/[0.022] p-2.5">
        {top.slice(0, 3).map((category) => (
          <div key={category.name}>
            <div className="mb-1 flex items-center justify-between text-[9.5px] text-[#7c8b82]">
              <span>{category.name}</span>
              <span>{formatPercent(category.ratio * 100, 1)}</span>
            </div>
            <ProgressBar
              value={category.amountCents}
              max={data.totalExpenseCents || 1}
              tone="gold"
              height={3}
            />
          </div>
        ))}
      </div>

      {anomalies.length ? (
        <div className="mt-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[10px] font-medium text-[#8a4a1c]">
              <TriangleAlert size={11} />
              异常交易
            </div>
            <Badge tone="red">{anomalies.length} 笔</Badge>
          </div>
          <div className="mt-1.5 space-y-1.5">
            {anomalies.slice(0, 4).map((anomaly) => (
              <div
                key={anomaly.id}
                className="rounded-xl border border-[#c9791f]/15 bg-[#c9791f]/[0.045] px-2.5 py-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[10px] font-medium text-[#4a3a26]">
                      {anomaly.merchant}
                    </div>
                    <div className="mt-0.5 text-[9.5px] text-[#9a8460]">
                      {formatDateTime(anomaly.ts).slice(5)} · {anomaly.category}
                    </div>
                  </div>
                  <span className="shrink-0 text-[10px] font-semibold tabular text-[#8a4a1c]">
                    -{formatMoney(Math.abs(anomaly.amountCents), false)}
                  </span>
                </div>
                {(anomaly.reasons ?? []).length ? (
                  <div className="mt-1 flex items-start gap-1 text-[9.5px] leading-snug text-[#9a6a32]">
                    <CircleAlert size={9} className="mt-0.5 shrink-0" />
                    {anomaly.reasons[0]}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex items-start gap-1 rounded-lg bg-[#c9791f]/[0.05] px-2.5 py-1.5 text-[9px] leading-relaxed text-[#8a4a1c]">
            <ShieldQuestion size={10} className="mt-0.5 shrink-0" />
            不是本人操作？在「账单」页点开这笔交易，可在详情里提交争议申诉，由银行核心差错处理并回传工单结论。
          </div>
        </div>
      ) : null}

      {insight ? (
        <div className="mt-3 rounded-xl border border-[#0f3d33]/10 bg-[#0f3d33]/[0.032] px-3 py-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[9.5px] font-medium text-[#2f5b4c]">
              <Coffee size={11} /> 沙箱洞察 · {insight.category}
            </div>
            <Badge tone="gold">
              <Sparkles size={9} /> worker + vm
            </Badge>
          </div>
          <div className="mt-1.5 grid grid-cols-3 gap-1 text-center">
            <div>
              <div className="text-[13px] font-semibold tabular text-[#14251f]">{insight.count}</div>
              <div className="text-[9px] text-[#6f7c74]">消费笔数</div>
            </div>
            <div>
              <div className="text-[13px] font-semibold tabular text-[#14251f]">
                {formatMoney(insight.totalCents, false)}
              </div>
              <div className="text-[9px] text-[#6f7c74]">合计</div>
            </div>
            <div>
              <div className="text-[13px] font-semibold tabular text-[#14251f]">
                {formatMoney(insight.avgCents, false)}
              </div>
              <div className="text-[9px] text-[#6f7c74]">单笔均价</div>
            </div>
          </div>
          <div className="mt-1.5 text-[9.5px] leading-relaxed text-[#7d8b83]">
            {insight.durationMs}ms 内完成 · 脚本无文件 / 网络访问权限
          </div>
        </div>
      ) : null}

      <CardFooter>
        <span>上期支出 {formatMoney(data.prevExpenseCents ?? 0, false)}</span>
        <span className="flex items-center gap-1">
          <span className="h-1 w-1 rounded-full bg-[#2f7d5b]" /> 绿色 · 自动分析
        </span>
      </CardFooter>
    </PhoneCard>
  );
}
