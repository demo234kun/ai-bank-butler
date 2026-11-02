import { useMemo, useState } from 'react';
import {
  Ban,
  ChevronRight,
  Hand,
  LockKeyhole,
  Play,
  RotateCcw,
  ShieldCheck,
  Workflow,
} from 'lucide-react';
import {
  RISK_META,
  formatMoney,
  type Dag,
  type DagNode,
  type FlowState,
  type NodeStatus,
  type Risk,
} from '@bank/shared';
import clsx from 'clsx';
import type { BankAgentApi } from '../../state/useBankAgent';
import { Badge, EmptyState, Panel, RiskBadge } from '../ui/primitives';
import { riskColor } from '../../lib/colors';

const NODE_W = 164;
const NODE_H = 58;
const GAP_X = 192;
const GAP_Y = 76;

const STATUS_TEXT: Record<NodeStatus, string> = {
  PENDING: '等待',
  READY: '就绪',
  RUNNING: '执行中',
  AWAIT_CONFIRM: '待确认',
  AWAIT_STEPUP: '待强验证',
  SUCCESS: '成功',
  FAILED: '失败',
  SKIPPED: '跳过',
  COMPENSATED: '已冲正',
  MANUAL: '人工',
};

const FLOW_TEXT: Record<FlowState, string> = {
  IDLE: '空闲',
  PARSING: '解析中',
  PLANNING: '规划中',
  AWAIT_CONFIRM: '待确认',
  AWAIT_STEPUP: '待强验证',
  EXECUTING: '执行中',
  DONE: '已完成',
  PARTIAL: '部分完成',
  CANCELLED: '已取消',
  FAILED: '失败',
  LOCKED: '安全锁定',
  HUMAN_TAKEOVER: '人工接管',
};

interface Position {
  x: number;
  y: number;
  level: number;
}

function layout(dag: Dag): { positions: Map<string, Position>; width: number; height: number } {
  const levels = new Map<string, number>();
  for (const node of dag.nodes) {
    let level = 0;
    for (const dep of node.deps) {
      level = Math.max(level, (levels.get(dep) ?? 0) + 1);
    }
    levels.set(node.id, level);
  }
  const rows = new Map<number, number>();
  const positions = new Map<string, Position>();
  let maxLevel = 0;
  let maxRow = 0;
  for (const node of dag.nodes) {
    const level = levels.get(node.id) ?? 0;
    const row = rows.get(level) ?? 0;
    rows.set(level, row + 1);
    maxLevel = Math.max(maxLevel, level);
    maxRow = Math.max(maxRow, row);
    positions.set(node.id, { x: 18 + level * GAP_X, y: 18 + row * GAP_Y, level });
  }
  return {
    positions,
    width: 18 + maxLevel * GAP_X + NODE_W + 24,
    height: Math.max(120, 18 + maxRow * GAP_Y + NODE_H + 24),
  };
}

function nodeTone(status: NodeStatus): { border: string; bg: string; text: string; dot: string } {
  switch (status) {
    case 'SUCCESS':
      return { border: 'rgba(47,125,91,.55)', bg: 'rgba(47,125,91,.075)', text: '#9ed8bd', dot: '#2f7d5b' };
    case 'FAILED':
      return { border: 'rgba(179,57,46,.55)', bg: 'rgba(179,57,46,.08)', text: '#eda49b', dot: '#b3392e' };
    case 'RUNNING':
      return { border: 'rgba(199,166,103,.7)', bg: 'rgba(199,166,103,.10)', text: '#e3cfa5', dot: '#c7a667' };
    case 'AWAIT_CONFIRM':
    case 'AWAIT_STEPUP':
      return { border: 'rgba(201,121,31,.55)', bg: 'rgba(201,121,31,.08)', text: '#e0a259', dot: '#c9791f' };
    case 'COMPENSATED':
      return { border: 'rgba(143,208,179,.35)', bg: 'rgba(47,125,91,.045)', text: '#8fd0b3', dot: '#4f6b5e' };
    case 'MANUAL':
      return { border: 'rgba(201,121,31,.4)', bg: 'rgba(201,121,31,.05)', text: '#c9a36d', dot: '#c9791f' };
    case 'SKIPPED':
      return { border: 'rgba(255,255,255,.12)', bg: 'rgba(255,255,255,.025)', text: '#849189', dot: '#5b675f' };
    default:
      return { border: 'rgba(199,166,103,.20)', bg: 'rgba(255,255,255,.026)', text: '#a7b3ab', dot: '#5b675f' };
  }
}

export function DagView({ agent }: { agent: BankAgentApi }) {
  const { state } = agent;
  const dag = state.dag;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const computed = useMemo(() => (dag ? layout(dag) : null), [dag]);
  const selected = useMemo(
    () => dag?.nodes.find((node) => node.id === (selectedId ?? state.activeNodeId)) ?? dag?.nodes[0],
    [dag, selectedId, state.activeNodeId],
  );
  const doneCount = dag?.nodes.filter((node) =>
    ['SUCCESS', 'FAILED', 'SKIPPED', 'COMPENSATED', 'MANUAL'].includes(node.status),
  ).length;
  const canRollback = dag?.nodes.some((node) => node.status === 'SUCCESS' && node.reversible);

  return (
    <Panel
      eyebrow="AGENT PLAN"
      title="任务 DAG · 可解释执行链路"
      action={
        <div className="flex items-center gap-1.5">
          <Badge tone={state.flow === 'DONE' ? 'green' : state.flow === 'EXECUTING' ? 'gold' : 'neutral'}>
            {FLOW_TEXT[state.flow]}
          </Badge>
          {dag ? <Badge tone="neutral">{(doneCount ?? 0)}/{dag.nodes.length}</Badge> : null}
        </div>
      }
      bodyClassName="p-4"
    >
      {!dag || !computed ? (
        <EmptyState
          icon={<Workflow size={24} />}
          title="还没有任务 DAG"
          detail="在左侧手机里发送一句需求，Agent 会把意图拆成带依赖的节点，并在执行前展示每个节点的风险等级。"
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[12px] font-medium text-[#e9e2d3]">{dag.title}</div>
              <div className="mt-1 line-clamp-1 text-[9.5px] text-[#7f9087]">{dag.summary}</div>
              {dag.template ? (
                <div className="mt-1 text-[9px] text-[#7f9087]">
                  业务模板 <span className="text-[#c7a667]">{dag.template.label}</span>
                  <span className="ml-1 text-[#5c6b63]">({dag.template.id})</span>
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {(['GREEN', 'YELLOW', 'RED'] as Risk[]).map((risk) => (
                <Badge key={risk} tone={risk === 'RED' ? 'red' : risk === 'YELLOW' ? 'amber' : 'green'}>
                  {RISK_META[risk].short} {dag.nodes.filter((node) => node.risk === risk).length}
                </Badge>
              ))}
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5 border-b hairline pb-2">
            {state.pending ? (
              <button
                onClick={agent.openPending}
                className="flex items-center gap-1 rounded-full border border-[#c9791f]/30 bg-[#c9791f]/10 px-2.5 py-1 text-[9px] text-[#e0a259]"
              >
                <LockKeyhole size={9} /> 打开确认单
              </button>
            ) : null}
            {['EXECUTING', 'PLANNING', 'PARSING'].includes(state.flow) ? (
              <>
                <button
                  onClick={() => agent.interrupt('abort')}
                  className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[9px] text-[#b9c2bb] transition hover:border-[#b3392e]/40 hover:text-[#eda49b]"
                >
                  <Ban size={9} /> 中断
                </button>
                <button
                  onClick={() => agent.takeover('take')}
                  className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[9px] text-[#b9c2bb] transition hover:border-[#c7a667]/40 hover:text-[#e3cfa5]"
                >
                  <Hand size={9} /> 人工接管
                </button>
              </>
            ) : null}
            {state.flow === 'HUMAN_TAKEOVER' ? (
              <>
                <button
                  onClick={() => agent.takeover('release')}
                  className="flex items-center gap-1 rounded-full border border-[#c7a667]/30 bg-[#c7a667]/10 px-2.5 py-1 text-[9px] text-[#e3cfa5]"
                >
                  <Play size={9} /> 恢复执行
                </button>
                <button
                  onClick={() => agent.takeover('abort')}
                  className="flex items-center gap-1 rounded-full border border-[#b3392e]/30 bg-[#b3392e]/10 px-2.5 py-1 text-[9px] text-[#eda49b]"
                >
                  <Ban size={9} /> 终止
                </button>
              </>
            ) : null}
            {state.flow === 'LOCKED' ? (
              <button
                onClick={() => agent.takeover('unlock')}
                className="flex items-center gap-1 rounded-full border border-[#c7a667]/30 bg-[#c7a667]/10 px-2.5 py-1 text-[9px] text-[#e3cfa5]"
              >
                <ShieldCheck size={9} /> 人工复核解锁
              </button>
            ) : null}
            {['DONE', 'PARTIAL'].includes(state.flow) && canRollback ? (
              <button
                onClick={agent.rollback}
                className="flex items-center gap-1 rounded-full border border-[#2f7d5b]/30 bg-[#2f7d5b]/10 px-2.5 py-1 text-[9px] text-[#9ed8bd]"
              >
                <RotateCcw size={9} /> 逆序回退
              </button>
            ) : null}
            {state.flow === 'PARTIAL' ? (
              <Badge tone="amber">部分完成</Badge>
            ) : null}
          </div>

          <div className="console-scroll mt-2 overflow-x-auto overflow-y-hidden pb-1">
            <div className="relative" style={{ width: computed.width, height: computed.height }}>
              <svg
                className="absolute inset-0"
                width={computed.width}
                height={computed.height}
                viewBox={`0 0 ${computed.width} ${computed.height}`}
              >
                <defs>
                  <marker id="dag-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
                    <path d="M0,0 L8,4 L0,8 z" fill="rgba(199,166,103,.5)" />
                  </marker>
                </defs>
                {dag.nodes.flatMap((node) =>
                  node.deps.map((depId) => {
                    const from = computed.positions.get(depId);
                    const to = computed.positions.get(node.id);
                    if (!from || !to) return null;
                    const dep = dag.nodes.find((n) => n.id === depId);
                    const active = node.status === 'RUNNING' || dep?.status === 'RUNNING';
                    const done = dep?.status === 'SUCCESS';
                    const x1 = from.x + NODE_W;
                    const y1 = from.y + NODE_H / 2;
                    const x2 = to.x;
                    const y2 = to.y + NODE_H / 2;
                    const d = `M ${x1} ${y1} C ${x1 + 38} ${y1}, ${x2 - 38} ${y2}, ${x2} ${y2}`;
                    return (
                      <path
                        key={`${depId}-${node.id}`}
                        d={d}
                        fill="none"
                        stroke={active ? '#c7a667' : done ? 'rgba(47,125,91,.55)' : 'rgba(199,166,103,.22)'}
                        strokeWidth={active ? 1.6 : 1.1}
                        markerEnd="url(#dag-arrow)"
                        className={active ? 'edge-active' : undefined}
                      />
                    );
                  }),
                )}
              </svg>

              {dag.nodes.map((node) => {
                const pos = computed.positions.get(node.id)!;
                const tone = nodeTone(node.status);
                const isSelected = selected?.id === node.id;
                return (
                  <button
                    key={node.id}
                    onClick={() => setSelectedId(node.id)}
                    className={clsx(
                      'absolute rounded-xl border px-2.5 py-2 text-left transition',
                      node.status === 'RUNNING' && 'node-active',
                      isSelected && 'ring-1 ring-[#c7a667]/60',
                    )}
                    style={{
                      left: pos.x,
                      top: pos.y,
                      width: NODE_W,
                      height: NODE_H,
                      borderColor: tone.border,
                      background: tone.bg,
                    }}
                  >
                    <span
                      className="absolute bottom-0 left-0 top-0 w-[2px] rounded-l-xl"
                      style={{ background: riskColor(node.risk) }}
                    />
                    <div className="flex items-center justify-between gap-1">
                      <span className="console-label !text-[8.5px] !tracking-[0.12em]">
                        {node.id.toUpperCase()} · {node.tool}
                      </span>
                      <span className="flex items-center gap-1 text-[8.5px]" style={{ color: tone.text }}>
                        <span className="h-1 w-1 rounded-full" style={{ background: tone.dot }} />
                        {STATUS_TEXT[node.status]}
                      </span>
                    </div>
                    <div className="mt-1 truncate text-[10px] font-medium text-[#e4ded0]">{node.label}</div>
                    <div className="mt-0.5 flex items-center justify-between text-[8.5px] text-[#7f9087]">
                      <span>{RISK_META[node.risk].short} · {node.reversible ? '可逆' : '不可逆'}</span>
                      <span>{node.result?.summary ? '有结果' : node.deps.length ? `${node.deps.length} 依赖` : '起点'}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] text-[#7f9087]">
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[#2f7d5b]" /> 绿色</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[#c9791f]" /> 黄色</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[#b3392e]" /> 红色</span>
            <span className="ml-auto flex items-center gap-1">点击节点查看参数与策略 <ChevronRight size={9} /></span>
          </div>

          {selected ? <NodeDetail node={selected} policy={state.policies[selected.id] ?? selected.policy} /> : null}
        </>
      )}
    </Panel>
  );
}

function NodeDetail({ node, policy }: { node: DagNode; policy?: any }) {
  return (
    <div className="mt-2 grid grid-cols-1 gap-2 rounded-xl border border-[#c7a667]/12 bg-black/20 p-3 md:grid-cols-[1.1fr_0.9fr]">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-[10.5px] font-medium text-[#e4ded0]">{node.label}</span>
          <RiskBadge risk={node.risk} compact />
          <span className="text-[9px] text-[#7f9087]">{node.tool}</span>
        </div>
        <pre className="console-scroll mt-2 max-h-[74px] overflow-auto rounded-lg bg-black/25 p-2 text-[9.5px] leading-relaxed text-[#a7b3ab]">
{JSON.stringify(node.args, null, 2)}
        </pre>
        {node.result?.summary ? (
          <div className="mt-2 text-[9.5px] text-[#8fd0b3]">{node.result.summary}</div>
        ) : null}
        {node.result?.error ? (
          <div className="mt-2 text-[9.5px] text-[#f0a49b]">{node.result.error.message}</div>
        ) : null}
      </div>
      <div className="rounded-lg border border-white/5 bg-white/[0.025] p-2.5">
        <div className="console-label">策略理由</div>
        <div className="mt-1.5 space-y-1">
          {(policy?.reasons ?? []).map((reason: any) => (
            <div key={reason.code} className="text-[9.5px] leading-relaxed text-[#b9c2bb]">
              · {reason.detail ?? reason.label}
            </div>
          ))}
          {!policy ? <div className="text-[9.5px] text-[#7f9087]">尚未判定</div> : null}
        </div>
        {policy?.amountCents ? (
          <div className="mt-2 flex items-center justify-between border-t border-white/5 pt-1.5 text-[9px] text-[#7f9087]">
            <span>金额</span>
            <span className="tabular text-[#c7a667]">{formatMoney(policy.amountCents)}</span>
          </div>
        ) : null}
        {policy?.limit ? (
          <div className="mt-1 flex items-center justify-between text-[9px] text-[#7f9087]">
            <span>当日剩余额度</span>
            <span className="tabular text-[#e3cfa5]">{formatMoney(policy.limit.remainingCents)}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
