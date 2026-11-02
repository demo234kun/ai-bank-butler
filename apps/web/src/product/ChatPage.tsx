import { ChevronLeft, ShieldCheck, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAgent } from './AgentContext';
import { useProductData } from './ProductDataContext';
import { MessageList } from '../components/phone/MessageList';
import { Composer } from '../components/phone/Composer';
import { RunStrip } from '../components/phone/RunStrip';
import { ConfirmSheet } from '../components/phone/ConfirmSheet';
import { StepUpSheet } from '../components/phone/StepUpSheet';

export function ChatPage() {
  const agent = useAgent();
  const { overview } = useProductData();
  const navigate = useNavigate();
  const { state } = agent;
  const boot = state.boot;
  const online = (state.stats?.llm.mode ?? state.snapshot?.session.llmMode) !== 'offline';
  const offline = !online;
  const name = overview?.user.name ?? '你';

  return (
    <div className="product-stage">
      <div className="product-frame" data-elder={state.elderMode}>
        <div className="relative flex h-full flex-col overflow-hidden bg-[#F4F1EC]">
          <header className="safe-top relative z-10 shrink-0 border-b border-black/[0.045] bg-[#F4F1EC]/94 px-3 pb-2.5 pt-1 backdrop-blur-xl">
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={() => navigate('/app')}
                className="flex h-8 w-8 items-center justify-center rounded-full text-[#5b675f] transition hover:bg-black/[0.04]"
                aria-label="返回首页"
              >
                <ChevronLeft size={18} />
              </button>
              <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
                <div className="relative flex h-8 w-8 items-center justify-center rounded-full border border-[#c7a667]/35 bg-[#0F3D33] text-[11px] font-medium text-[#e3cfa5]">
                  {boot?.brand.monogram ?? '屿'}
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#F4F1EC] ${
                      online ? 'bg-[#2f7d5b]' : 'bg-[#c9791f]'
                    }`}
                  />
                </div>
                <div className="min-w-0 text-center">
                  <div className="truncate text-[11px] font-semibold text-[#14251f]">
                    AI 银行管家
                  </div>
                  <div className="mt-0.5 flex items-center justify-center gap-1 text-[8.5px] text-[#6f7c74]">
                    <Sparkles size={8} className="text-[#c7a667]" />
                    {online ? '在线 · 安全会话' : '离线规则引擎'}
                  </div>
                </div>
              </div>
              <button
                onClick={() => navigate('/app/profile')}
                className="flex h-8 w-8 items-center justify-center rounded-full text-[#5b675f] transition hover:bg-black/[0.04]"
                title="账户与安全"
              >
                <ShieldCheck size={16} />
              </button>
            </div>
            <div className="mt-1 flex items-center justify-center gap-1 text-[8.5px] text-[#6f7c74]">
              你好，{name} · 绿色自动 · 黄色确认 · 红色强验证
            </div>
          </header>

          {boot ? (
            <MessageList
              messages={state.messages}
              dag={state.dag}
              busy={state.busy}
              monogram={boot.brand.monogram ?? '屿'}
              capabilities={boot.capabilities}
              dataSource={boot.dataSource}
              onSend={agent.send}
              onRollback={agent.rollback}
              onOpenPending={agent.openPending}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#0f3d33]/10 border-t-[#c7a667]" />
              <div className="text-[9px] text-[#6f7c74]">正在进入安全会话…</div>
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
            <div className="h-[3px] w-24 rounded-full bg-black/15" />
          </div>

          {state.sheet === 'confirm' && state.pending ? (
            <ConfirmSheet pending={state.pending} agent={agent} elderMode={state.elderMode} />
          ) : null}
          {state.sheet === 'stepup' && state.pending && state.challenge ? (
            <StepUpSheet pending={state.pending} challenge={state.challenge} agent={agent} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
