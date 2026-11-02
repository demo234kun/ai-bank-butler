import { Accessibility, ArrowLeft, Clock3, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { BRAND, formatDateTime } from '@bank/shared';
import clsx from 'clsx';
import type { BankAgentApi } from '../state/useBankAgent';
import { Badge } from './ui/primitives';

export function Header({ agent }: { agent: BankAgentApi }) {
  const { state } = agent;
  const brand = state.boot?.brand;
  const verification = state.stats?.audit.verification ?? state.auditVerification;
  const llmMode = state.stats?.llm.mode ?? state.snapshot?.session.llmMode ?? 'llm';
  const demoNow = state.snapshot?.demoNow;

  return (
    <header className="sticky top-0 z-30 border-b border-[#c7a667]/12 bg-[#0B1512]/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1480px] flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-full border border-[#c7a667]/40 bg-[#0f3d33] text-[13px] font-medium text-[#e3cfa5]">
            {brand?.monogram ?? '屿'}
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-[#0B1512] bg-[#c7a667]" />
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-[9px] uppercase tracking-[0.3em] text-[#c7a667]">
                {brand?.nameEn ?? BRAND.nameEn}
              </span>
              <span className="text-[13px] font-medium tracking-wide text-[#f0eadc]">
                {brand?.product ?? 'AI 银行管家'}
              </span>
              <span className="rounded-full border border-[#c7a667]/30 bg-[#c7a667]/10 px-1.5 py-0.5 text-[8.5px] text-[#e3cfa5]">
                评委模式
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[9px] text-[#7f9087]">
              <Sparkles size={8} className="text-[#c7a667]" />
              {brand?.slogan ?? '说话，就能办业务'} · 赛事原型
            </div>
          </div>
        </div>

        <div className="hidden items-center gap-2 lg:flex">
          <span className="flex items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.025] px-2.5 py-1.5 text-[9.5px] text-[#9eaaa1]">
            <Clock3 size={10} className="text-[#c7a667]" />
            演示时间 {demoNow ? formatDateTime(demoNow) : '2026-10-30 10:00'}
          </span>
          <span
            className={clsx(
              'flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[9.5px]',
              verification?.ok
                ? 'border-[#2f7d5b]/25 bg-[#2f7d5b]/8 text-[#9ed8bd]'
                : 'border-[#b3392e]/25 bg-[#b3392e]/8 text-[#eda49b]',
            )}
          >
            <ShieldCheck size={10} />
            审计链 {verification?.ok ? '完整' : '待验证'} · {Math.max(verification?.count ?? 0, state.audit.length)} 条
          </span>
          <Badge tone="dark">
            {state.snapshot?.dataSource?.mode === 'http'
              ? `${state.snapshot.dataSource.provider} · 已连接`
              : '合成数据 · 演示环境'}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/app"
            className="flex items-center gap-1 rounded-full border border-white/8 px-2.5 py-1.5 text-[9.5px] text-[#9eaaa1] transition hover:border-[#c7a667]/30 hover:text-[#e3cfa5]"
          >
            <ArrowLeft size={10} /> 返回 App
          </a>
          <div className="flex items-center rounded-full border border-white/8 bg-white/[0.02] p-0.5">
            <button
              onClick={() => agent.setLlmMode('llm')}
              className={clsx(
                'rounded-full px-2.5 py-1 text-[9.5px] transition',
                llmMode === 'llm'
                  ? 'bg-[#c7a667]/15 text-[#e3cfa5]'
                  : 'text-[#6f7d75] hover:text-[#9eaaa1]',
              )}
            >
              在线 LLM
            </button>
            <button
              onClick={() => agent.setLlmMode('offline')}
              className={clsx(
                'rounded-full px-2.5 py-1 text-[9.5px] transition',
                llmMode === 'offline'
                  ? 'bg-[#c9791f]/15 text-[#e0a259]'
                  : 'text-[#6f7d75] hover:text-[#9eaaa1]',
              )}
            >
              离线兜底
            </button>
          </div>

          <button
            onClick={() => agent.setElder(!state.elderMode)}
            className={clsx(
              'flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-[9.5px] transition',
              state.elderMode
                ? 'border-[#c7a667]/40 bg-[#c7a667]/10 text-[#e3cfa5]'
                : 'border-white/8 text-[#8b9a91] hover:text-[#c9d1cb]',
            )}
          >
            <Accessibility size={10} /> 适老
          </button>

          <button
            onClick={() => {
              if (window.confirm('重置演示数据并新建会话？')) void agent.resetDemo();
            }}
            className="flex items-center gap-1 rounded-full border border-white/8 px-2.5 py-1.5 text-[9.5px] text-[#8b9a91] transition hover:border-[#c7a667]/30 hover:text-[#e3cfa5]"
          >
            <RefreshCw size={10} /> 重置
          </button>
        </div>
      </div>
    </header>
  );
}
