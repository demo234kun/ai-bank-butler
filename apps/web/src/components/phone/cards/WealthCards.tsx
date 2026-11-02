import {
  ArrowDownToLine,
  ArrowUpRight,
  BadgeCheck,
  ChevronRight,
  Sparkles,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { formatMoney, formatPercent, type Risk } from '@bank/shared';
import clsx from 'clsx';
import { PhoneCard, CardTitle, Rows, CardFooter } from './PhoneCard';
import { Badge, ProgressBar, RiskBadge } from '../../ui/primitives';

function productRisk(risk: string): Risk {
  const level = Number(String(risk).replace('R', ''));
  if (level >= 4) return 'RED';
  if (level === 3) return 'YELLOW';
  return 'GREEN';
}

export function WealthCard({
  data,
  onSend,
}: {
  data: any;
  onSend: (text: string) => void;
}) {
  const recommendations: any[] = data.recommendations ?? [];
  const holdings: any[] = data.holdings ?? [];
  const excluded: any[] = data.excludedBySuitability ?? [];
  const selected = recommendations[0];
  const requestedAmount = data.requestedAmountCents;
  const purchaseAmount = requestedAmount ?? selected?.product?.minAmountCents ?? 100_000;

  return (
    <PhoneCard accent="linear-gradient(90deg,#0f3d33,#c7a667,transparent)" className="p-4">
      <CardTitle
        icon={<TrendingUp size={15} />}
        title="为你匹配的理财产品"
        sub={data.rationale}
        action={
          <Badge tone="gold">
            {data.userRiskLevel} · 可购 {data.maxProductRisk ?? 'R2'}
          </Badge>
        }
      />

      <div className="mt-3 space-y-2">
        {recommendations.map((item, index) => {
          const product = item.product;
          const risk = productRisk(product.riskLevel);
          return (
            <div
              key={product.id}
              className={clsx(
                'rounded-xl border p-3',
                index === 0
                  ? 'border-[#c7a667]/45 bg-[#c7a667]/[0.055]'
                  : 'border-black/[0.055] bg-white/60',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[11.5px] font-semibold text-[#14251f]">
                      {product.name}
                    </span>
                    {index === 0 ? <Badge tone="gold">首选</Badge> : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <RiskBadge risk={risk} compact />
                    <span className="text-[9.5px] text-[#6f7c74]">
                      {product.riskLevel} · {product.type}
                    </span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[17px] font-semibold leading-none tabular text-[#0f3d33]">
                    {formatPercent(product.yieldPct)}
                  </div>
                  <div className="mt-1 text-[9px] text-[#6f7c74]">业绩比较基准</div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9.5px] text-[#7c8b82]">
                <span>{product.termDays ? `${product.termDays} 天` : '无固定期限'}</span>
                <span>{product.minAmountCents ? `${formatMoney(product.minAmountCents)} 起` : ''}</span>
                <span>匹配度 {item.score}</span>
                <span className="flex items-center gap-0.5 text-[#2f7d5b]">
                  <BadgeCheck size={9} /> 适当性通过
                </span>
              </div>
              {index === 0 ? (
                <div className="mt-2 flex items-center gap-2">
                  <ProgressBar value={item.score} max={100} tone="gold" height={3} className="flex-1" />
                  <button
                    onClick={() => onSend(`申购${product.name} ${(purchaseAmount / 100).toFixed(0)}元`)}
                    className="flex shrink-0 items-center gap-1 rounded-full bg-[#0f3d33] px-3 py-1.5 text-[9.5px] font-medium text-[#f4f1ec] transition hover:bg-[#155246]"
                  >
                    申购 {formatMoney(purchaseAmount)}
                    <ArrowUpRight size={10} />
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {excluded.length ? (
        <div className="mt-2 rounded-lg border border-black/[0.06] bg-black/[0.02] px-3 py-2 text-[9.5px] leading-relaxed text-[#7c8b82]">
          已按适当性规则排除 {excluded.length} 款更高风险产品：
          {excluded.map((item) => `${item.name}（${item.riskLevel}）`).join('、')}。
          如需投资，请先在「我的 · 风险测评」重新测评。
        </div>
      ) : null}

      {holdings.length ? (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between text-[9.5px] text-[#7c8b82]">
            <span>我的持仓</span>
            <span>浮动收益</span>
          </div>
          <div className="divide-y divide-black/[0.045] rounded-xl bg-black/[0.02] px-2.5">
            {holdings.map((holding) => (
              <div key={holding.id} className="flex items-center justify-between py-2">
                <div className="min-w-0">
                  <div className="truncate text-[10px] text-[#23352d]">
                    {holding.product?.name ?? holding.productId}
                  </div>
                  <div className="mt-0.5 text-[9.5px] text-[#6f7c74]">
                    {formatMoney(holding.amountCents)} · 市值约 {formatMoney(holding.estimatedValueCents ?? holding.amountCents)}
                  </div>
                </div>
                <span
                  className={clsx(
                    'text-[10px] font-medium tabular',
                    holding.floatingPct >= 0 ? 'text-[#2f7d5b]' : 'text-[#b3392e]',
                  )}
                >
                  {holding.floatingPct >= 0 ? '+' : ''}
                  {formatPercent(holding.floatingPct)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <CardFooter>
        <span className="flex items-center gap-1">
          <Sparkles size={9} className="text-[#c7a667]" /> 申购属于红色操作，需强验证
        </span>
        <span>非存款</span>
      </CardFooter>
    </PhoneCard>
  );
}

export function WealthReceipt({ data }: { data: any }) {
  const isPurchase = data.mode === 'purchase';
  return (
    <PhoneCard accent={isPurchase ? 'linear-gradient(90deg,#0f3d33,#c7a667,transparent)' : '#4F6B5E'} className="p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0f3d33]/[0.08] text-[#0f3d33]">
            {isPurchase ? <TrendingUp size={16} /> : <ArrowDownToLine size={16} />}
          </div>
          <div>
            <div className="text-[13px] font-semibold text-[#14251f]">
              {isPurchase ? '申购成功' : '赎回申请已提交'}
            </div>
            <div className="mt-0.5 text-[9px] text-[#6f7c74]">
              {isPurchase ? '份额将于 T+1 确认' : '资金按产品规则回到账户'}
            </div>
          </div>
        </div>
        <RiskBadge risk="RED" compact />
      </div>

      <div className="mt-4 text-center">
        <div className="text-[9px] uppercase tracking-[0.2em] text-[#6f7c74]">
          {isPurchase ? '申购金额' : '赎回金额'}
        </div>
        <div className="mt-1 text-[28px] font-semibold leading-none tabular text-[#14251f]">
          {formatMoney(data.amountCents ?? 0)}
        </div>
        <div className="mt-2 text-[10px] text-[#5b675f]">{data.product?.name}</div>
      </div>

      <div className="mt-3">
        <Rows
          rows={[
            { label: '产品风险等级', value: `${data.product?.riskLevel} · ${data.product?.type}` },
            ...(isPurchase && data.suitability
              ? [
                  {
                    label: '适当性校验',
                    value: `${data.suitability.level} ${data.suitability.score ?? ''} 分 · 上限 ${data.suitability.maxProductRisk}`,
                  },
                ]
              : []),
            ...(isPurchase
              ? [
                  { label: '业绩比较基准', value: formatPercent(data.product?.yieldPct ?? 0) },
                  {
                    label: '预计年收益',
                    value: formatMoney(data.expectedAnnualCents ?? 0),
                    emphasis: true,
                  },
                ]
              : []),
            {
              label: '交易流水号',
              value: <span className="mono text-[9.5px]">{data.txnId}</span>,
            },
            ...(data.account
              ? [
                  {
                    label: '账户余额',
                    value: formatMoney(data.account.balanceCents ?? 0),
                  },
                ]
              : []),
          ]}
        />
      </div>

      <CardFooter>
        <span className="flex items-center gap-1">
          <Wallet size={9} /> 已记录审计
        </span>
        <span>理财非存款 · 投资须谨慎</span>
      </CardFooter>
    </PhoneCard>
  );
}
