import { useMemo, useState } from 'react';
import {
  CreditCard,
  Fingerprint,
  Lock,
  PlusCircle,
  ShieldCheck,
  Snowflake,
  Unlock,
} from 'lucide-react';
import clsx from 'clsx';
import { BRAND, formatMoney, type BankCard } from '@bank/shared';
import { useProductData } from './ProductDataContext';
import { ProductPageHeader, ProductSkeletonPage, useStartChat } from './ProductChrome';
import { Badge } from '../components/ui/primitives';

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

export function CardsPage() {
  const { overview, loading } = useProductData();
  const startChat = useStartChat();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const cards = overview?.cards ?? [];
  const selected = useMemo(
    () => cards.find((card) => card.id === selectedId) ?? cards[0],
    [cards, selectedId],
  );

  if (loading && !overview) return <ProductSkeletonPage />;

  return (
    <div className="pb-6">
      <ProductPageHeader
        title="卡片"
        subtitle="额度、冻结与挂失都由 AI 管家按风险等级处理"
        action={<Badge tone="green">绿色查询</Badge>}
      />

      <section className="mt-4 px-4">
        {cards.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-black/10 p-8 text-center text-[10px] text-[#6f7c74]">
            还没有卡片
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
            {cards.map((card) => {
              const active = selected?.id === card.id;
              return (
                <button
                  key={card.id}
                  onClick={() => setSelectedId(card.id)}
                  className={clsx(
                    'bank-card-face h-[178px] w-[300px] shrink-0 p-4 text-left transition',
                    active ? 'ring-2 ring-[#c7a667]/70 ring-offset-2 ring-offset-[#F4F1EC]' : 'opacity-85',
                  )}
                  style={{
                    background: `radial-gradient(ellipse at 85% -10%, rgba(199,166,103,.32), transparent 50%), linear-gradient(145deg, ${card.color ?? '#0F3D33'}, #091A15)`,
                  }}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-[9px] uppercase tracking-[0.18em] text-white/55">
                        {TYPE_LABEL[card.type] ?? card.type}
                      </div>
                      <div className="mt-1 text-[10px] text-[#e3cfa5]">{BRAND.nameEn}</div>
                    </div>
                    <span className="text-[9px] font-medium text-[#e3cfa5]">{card.network}</span>
                  </div>
                  <div className="mt-5 flex items-center gap-1.5 text-[15px] tracking-[0.22em] text-white/90">
                    •••• <span>{card.last4}</span>
                  </div>
                  <div className="mt-4 flex items-end justify-between">
                    <div>
                      <div className="text-[8.5px] uppercase tracking-[0.14em] text-white/60">
                        {card.type === 'credit' ? '可用额度' : '有效期'}
                      </div>
                      <div className="mt-0.5 text-[10px] tabular text-white/80">
                        {card.type === 'credit'
                          ? formatMoney(Math.max(0, (card.limitCents ?? 0) - (card.usedCents ?? 0)))
                          : card.expiry}
                      </div>
                    </div>
                    <span
                      className={clsx(
                        'rounded-full px-2 py-0.5 text-[8.5px]',
                        card.status === 'active'
                          ? 'bg-[#8fd0b3]/15 text-[#a6e0c5]'
                          : 'bg-[#f0a49b]/15 text-[#f0a49b]',
                      )}
                    >
                      {STATUS_LABEL[card.status] ?? card.status}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {selected ? (
        <>
          <section className="mt-2 px-4">
            <div className="rounded-[18px] border border-black/[0.055] bg-[#FBFAF7] p-4 shadow-card">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0f3d33]/[0.06] text-[#0f3d33]">
                    <CreditCard size={15} />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-[#23352d]">
                      {TYPE_LABEL[selected.type]} · 尾号 {selected.last4}
                    </div>
                    <div className="mt-0.5 text-[9px] text-[#6f7c74]">
                      {STATUS_LABEL[selected.status]} · {selected.network}
                    </div>
                  </div>
                </div>
                <Badge tone={selected.status === 'active' ? 'green' : 'red'}>
                  {STATUS_LABEL[selected.status]}
                </Badge>
              </div>

              <div className="mt-3 divide-y divide-black/[0.05]">
                {selected.type === 'credit' ? (
                  <>
                    <InfoRow label="总额度" value={formatMoney(selected.limitCents ?? 0)} />
                    <InfoRow label="已用额度" value={formatMoney(selected.usedCents ?? 0)} />
                    <InfoRow
                      label="可用额度"
                      value={formatMoney(
                        Math.max(0, (selected.limitCents ?? 0) - (selected.usedCents ?? 0)),
                      )}
                      emphasis
                    />
                  </>
                ) : (
                  <>
                    <InfoRow
                      label="账户余额"
                      value={formatMoney(
                        overview?.accounts.find((account) => account.id === selected.accountId)
                          ?.balanceCents ?? 0,
                      )}
                      emphasis
                    />
                    <InfoRow label="有效期" value={selected.expiry} />
                    <InfoRow label="卡片类型" value={TYPE_LABEL[selected.type]} />
                  </>
                )}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  onClick={() =>
                    startChat(`把尾号${selected.last4}的卡额度调整到 3000 元`)
                  }
                  className="rounded-xl border border-[#0f3d33]/12 bg-[#0f3d33]/[0.035] py-2 text-[9px] text-[#2f5b4c]"
                >
                  调整额度
                </button>
                {selected.status === 'frozen' ? (
                  <button
                    onClick={() => startChat(`把尾号${selected.last4}的卡解冻`)}
                    className="flex items-center justify-center gap-1 rounded-xl border border-[#b3392e]/15 bg-[#b3392e]/[0.035] py-2 text-[9px] text-[#9e3f35]"
                  >
                    <Unlock size={10} /> 解除冻结
                  </button>
                ) : (
                  <button
                    onClick={() => startChat(`把尾号${selected.last4}的卡临时冻结`)}
                    className="flex items-center justify-center gap-1 rounded-xl border border-[#c9791f]/20 bg-[#c9791f]/[0.045] py-2 text-[9px] text-[#8a5a1f]"
                  >
                    <Snowflake size={10} /> 临时冻结
                  </button>
                )}
                <button
                  onClick={() => startChat(`把尾号${selected.last4}的卡挂失`)}
                  className="flex items-center justify-center gap-1 rounded-xl border border-[#b3392e]/20 bg-white py-2 text-[9px] text-[#9e3f35]"
                >
                  <Lock size={10} /> 挂失（红色）
                </button>
                <button
                  onClick={() => startChat('申请一张虚拟卡，额度 3000')}
                  className="flex items-center justify-center gap-1 rounded-xl border border-[#c7a667]/30 bg-[#c7a667]/[0.07] py-2 text-[9px] text-[#8c6c2f]"
                >
                  <PlusCircle size={10} /> 申请虚拟卡
                </button>
              </div>
            </div>
          </section>

          <section className="mt-3 px-4">
            <div className="flex items-start gap-2 rounded-xl border border-[#c7a667]/20 bg-[#c7a667]/[0.055] px-3 py-2.5">
              <ShieldCheck size={12} className="mt-0.5 shrink-0 text-[#8c6c2f]" />
              <div className="text-[9.5px] leading-relaxed text-[#7d6a45]">
                调额不超过 2000 元为黄色确认，超过为红色；挂失/解挂必须人脸 + 短信验证。
                所有操作都会在安全控制台留下完整决策链路。
              </div>
            </div>
          </section>
        </>
      ) : null}

      <section className="mt-4 px-4">
        <button
          onClick={() => startChat('帮我看看名下卡片额度和状态')}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#0f3d33]/15 py-2.5 text-[9px] text-[#0f3d33]/70"
        >
          <Fingerprint size={10} /> 让管家做一次卡片体检
        </button>
      </section>
    </div>
  );
}

function InfoRow({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-[9px] text-[#6f7c74]">{label}</span>
      <span
        className={clsx(
          'tabular text-[10px]',
          emphasis ? 'font-semibold text-[#14251f]' : 'text-[#3f4c45]',
        )}
      >
        {value}
      </span>
    </div>
  );
}
