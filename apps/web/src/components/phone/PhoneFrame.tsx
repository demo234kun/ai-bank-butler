import { BatteryFull, ShieldCheck, SignalHigh, Wifi } from 'lucide-react';
import { BRAND, formatClock, formatMoney } from '@bank/shared';
import type { BankAgentApi } from '../../state/useBankAgent';
import { MessageList } from './MessageList';
import { Composer } from './Composer';
import { RunStrip } from './RunStrip';
import { ConfirmSheet } from './ConfirmSheet';
import { StepUpSheet } from './StepUpSheet';

export function PhoneFrame({ agent }: { agent: BankAgentApi }) {
  const { state } = agent;
  const snapshot = state.snapshot;
  const boot = state.boot;
  const primary = snapshot?.accounts.find((account) => account.primary);
  const offline = (state.stats?.llm.mode ?? snapshot?.session.llmMode) === 'offline';

  return (
    <div className="phone-shell" data-elder={state.elderMode}>
      <div className="phone-notch" />
      <div className="phone-screen">
        <header className="relative shrink-0 bg-[#0F3D33] text-[#F4F1EC]">
          <div className="flex items-center justify-between px-6 pt-3 text-[9px] font-medium">
            <span className="tabular tracking-wide">
              {snapshot ? formatClock(snapshot.demoNow) : '10:00'}
            </span>
            <div className="flex items-center gap-1.5 text-white/80">
              <SignalHigh size={11} />
              <Wifi size={11} />
              <BatteryFull size={13} />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between px-5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[#c7a667]/45 bg-[#c7a667]/10 text-[13px] font-medium text-[#e3cfa5] shadow-inner">
                {boot?.brand.monogram ?? '屿'}
              </div>
              <div>
                <div className="text-[8.5px] uppercase tracking-[0.26em] text-[#c7a667]">
                  {boot?.brand.nameEn ?? BRAND.nameEn}
                </div>
                <div className="mt-0.5 text-[13.5px] font-medium tracking-wide">
                  {boot?.brand.product ?? 'AI 银行管家'}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[8.5px] uppercase tracking-[0.16em] text-white/60">主账户可用</div>
              <div className="mt-0.5 text-[14px] font-semibold tabular text-[#F4F1EC]">
                {primary ? formatMoney(primary.balanceCents - primary.lockedCents) : '—'}
              </div>
            </div>
          </div>

          <div className="mx-4 mb-3 mt-3 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.055] px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-[10px] font-medium">{snapshot?.user.name ?? '陈屿'}</span>
              <span className="truncate text-[8.5px] text-[#e3cfa5]/75">
                {snapshot?.user.tier ?? '私人银行'}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1 text-[8.5px] text-white/50">
              <ShieldCheck size={9} className="text-[#8fd0b3]" />
              审计开启
              {offline ? <span className="ml-1 rounded-full bg-[#c9791f]/20 px-1.5 py-0.5 text-[#e0a259]">离线</span> : null}
            </div>
          </div>
        </header>

        {snapshot ? (
          <MessageList
            messages={state.messages}
            dag={state.dag}
            busy={state.busy}
            monogram={boot?.brand.monogram ?? '屿'}
            capabilities={boot?.capabilities}
            dataSource={snapshot?.dataSource}
            onSend={agent.send}
            onRollback={agent.rollback}
            onOpenPending={agent.openPending}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-[#F4F1EC]">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#0f3d33]/15 border-t-[#c7a667]" />
            <div className="text-[10px] text-[#6f7c74]">正在连接安全会话…</div>
          </div>
        )}

        <RunStrip agent={agent} />

        <Composer
          quickPrompts={boot?.quickPrompts ?? []}
          busy={state.busy}
          pending={Boolean(state.pending)}
          offline={offline}
          onSend={agent.send}
        />

        <div className="flex h-[9px] shrink-0 items-start justify-center bg-[#F4F1EC]">
          <div className="h-[3px] w-24 rounded-full bg-black/20" />
        </div>

        {state.sheet === 'confirm' && state.pending ? (
          <ConfirmSheet pending={state.pending} agent={agent} elderMode={state.elderMode} />
        ) : null}
        {state.sheet === 'stepup' && state.pending && state.challenge ? (
          <StepUpSheet pending={state.pending} challenge={state.challenge} agent={agent} />
        ) : null}
      </div>
    </div>
  );
}
