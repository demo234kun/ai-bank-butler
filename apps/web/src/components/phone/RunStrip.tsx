import { Activity, Ban, ChevronRight, Hand, LockKeyhole, RotateCcw } from 'lucide-react';
import type { BankAgentApi } from '../../state/useBankAgent';
import { ProgressBar } from '../ui/primitives';

export function RunStrip({ agent }: { agent: BankAgentApi }) {
  const { state } = agent;
  if (!state.pending && !state.dag && !['LOCKED', 'HUMAN_TAKEOVER', 'PARTIAL'].includes(state.flow)) {
    return null;
  }
  const nodes = state.dag?.nodes ?? [];
  const done = nodes.filter((node) =>
    ['SUCCESS', 'FAILED', 'SKIPPED', 'COMPENSATED', 'MANUAL'].includes(node.status),
  ).length;
  const current = nodes.find((node) => node.status === 'RUNNING') ?? nodes.find((node) => node.status === 'READY');
  const canRollback = nodes.some((node) => node.status === 'SUCCESS' && node.reversible);

  if (state.pending) {
    return (
      <div className="border-t border-[#c9791f]/20 bg-[#c9791f]/[0.07] px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[9px] text-[#8a5a1f]">
            <span className="h-1.5 w-1.5 animate-soft-pulse rounded-full bg-[#c9791f]" />
            等待{state.pending.kind === 'STEPUP' ? '强验证' : '确认'} · {state.pending.summary.title}
          </div>
          <button
            onClick={agent.openPending}
            className="flex items-center gap-0.5 rounded-full border border-[#c9791f]/25 bg-white/60 px-2 py-0.5 text-[9.5px] text-[#8a5a1f]"
          >
            查看 <ChevronRight size={9} />
          </button>
        </div>
      </div>
    );
  }

  if (state.flow === 'LOCKED') {
    return (
      <div className="border-t border-[#b3392e]/20 bg-[#b3392e]/[0.06] px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[9px] text-[#9e3f35]">
            <LockKeyhole size={10} /> 安全锁定 · 等待人工复核
          </div>
          <button
            onClick={() => agent.takeover('unlock')}
            className="rounded-full border border-[#b3392e]/20 bg-white/70 px-2 py-0.5 text-[9.5px] text-[#9e3f35]"
          >
            解锁
          </button>
        </div>
      </div>
    );
  }

  if (state.flow === 'HUMAN_TAKEOVER') {
    return (
      <div className="border-t border-[#c7a667]/25 bg-[#c7a667]/[0.07] px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[9px] text-[#7d5f27]">
            <Hand size={10} /> 人工接管中
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => agent.takeover('release')}
              className="rounded-full bg-[#0f3d33] px-2 py-0.5 text-[9.5px] text-white"
            >
              恢复
            </button>
            <button
              onClick={() => agent.takeover('abort')}
              className="rounded-full border border-[#b3392e]/20 bg-white/70 px-2 py-0.5 text-[9.5px] text-[#9e3f35]"
            >
              终止
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (state.flow === 'PARTIAL' && canRollback) {
    return (
      <div className="border-t border-[#2f7d5b]/20 bg-[#2f7d5b]/[0.055] px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[9px] text-[#2f5b4c]">
            <RotateCcw size={10} /> 任务部分完成，可回退
          </div>
          <button
            onClick={agent.rollback}
            className="rounded-full border border-[#2f7d5b]/25 bg-white/70 px-2 py-0.5 text-[9.5px] text-[#2f5b4c]"
          >
            回退
          </button>
        </div>
      </div>
    );
  }

  if (!['EXECUTING', 'PLANNING', 'PARSING'].includes(state.flow)) return null;

  return (
    <div className="border-t border-black/[0.055] bg-white/55 px-4 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[9.5px] text-[#5b675f]">
          <Activity size={10} className="animate-soft-pulse text-[#c7a667]" />
          <span className="truncate">
            {state.flow === 'PARSING'
              ? '解析意图中…'
              : state.flow === 'PLANNING'
                ? '规划任务 DAG…'
                : current
                  ? `执行 · ${current.label}`
                  : '执行任务中…'}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[9px] tabular text-[#6f7c74]">
            {done}/{nodes.length || 0}
          </span>
          <button
            onClick={() => agent.interrupt('abort')}
            className="flex items-center gap-0.5 rounded-full border border-black/10 px-1.5 py-0.5 text-[9px] text-[#7c8b82]"
          >
            <Ban size={8} /> 中断
          </button>
          <button
            onClick={() => agent.takeover('take')}
            className="flex items-center gap-0.5 rounded-full border border-black/10 px-1.5 py-0.5 text-[9px] text-[#7c8b82]"
          >
            <Hand size={8} /> 接管
          </button>
        </div>
      </div>
      <ProgressBar
        value={done}
        max={Math.max(1, nodes.length)}
        tone="gold"
        height={2}
        className="mt-1.5"
      />
    </div>
  );
}
