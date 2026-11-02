import { useState } from 'react';
import {
  Accessibility,
  Download,
  Gauge,
  RefreshCw,
  Sparkles,
  Timer,
  Wallet,
} from 'lucide-react';
import { formatDateTime, formatMoney, formatPercent } from '@bank/shared';
import clsx from 'clsx';
import { api } from '../../api/client';
import type { BankAgentApi } from '../../state/useBankAgent';
import { Badge, Hash, Panel, ProgressBar, Stat } from '../ui/primitives';
import { SchedulerPanel } from './SchedulerPanel';

export function MetricsPanel({ agent }: { agent: BankAgentApi }) {
  const stats = agent.state.stats;
  const llm = stats?.llm;
  const guard = stats?.guard;
  const limits = agent.state.snapshot?.limits;
  const references = agent.state.snapshot?.session.context.references ?? [];
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);

  const cacheRate =
    llm && llm.calls + llm.cacheHits > 0
      ? (llm.cacheHits / (llm.calls + llm.cacheHits)) * 100
      : 0;

  const exportCompliance = async () => {
    setExporting(true);
    try {
      const data = await api.get<{ markdown: string; generatedAt: string }>(
        '/api/compliance/summary',
      );
      const blob = new Blob([data.markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'bank-agent-compliance.md';
      anchor.click();
      URL.revokeObjectURL(url);
      setExported(true);
      await agent.refreshAudit();
    } catch {
      // ignore
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Panel
        eyebrow="LLM METER"
        title="意图解析成本与缓存"
        action={
          <div className="flex items-center gap-1">
            <button
              onClick={() => agent.setLlmMode('llm')}
              className={clsx(
                'rounded-full border px-2 py-1 text-[9px] transition',
                llm?.mode === 'llm'
                  ? 'border-[#c7a667]/45 bg-[#c7a667]/12 text-[#e3cfa5]'
                  : 'border-white/8 text-[#7f9087]',
              )}
            >
              在线 DeepSeek
            </button>
            <button
              onClick={() => agent.setLlmMode('offline')}
              className={clsx(
                'rounded-full border px-2 py-1 text-[9px] transition',
                llm?.mode === 'offline'
                  ? 'border-[#c9791f]/45 bg-[#c9791f]/12 text-[#e0a259]'
                  : 'border-white/8 text-[#7f9087]',
              )}
            >
              离线规则
            </button>
          </div>
        }
        bodyClassName="p-4"
      >
        <div className="grid grid-cols-2 gap-3">
          <Stat label="模型" value={<span className="text-[12px]">{llm?.model ?? '—'}</span>} sub={llm?.enabled ? 'API Key 已配置' : '未配置 Key，自动降级'} tone="gold" />
          <Stat label="调用 / 失败" value={`${llm?.calls ?? 0} / ${llm?.failures ?? 0}`} sub={`平均 ${llm?.avgLatencyMs ?? 0}ms`} />
          <Stat
            label="Token"
            value={(llm?.totalTokens ?? 0).toLocaleString()}
            sub={`输入 ${(llm?.promptTokens ?? 0).toLocaleString()} · 输出 ${(llm?.completionTokens ?? 0).toLocaleString()}`}
          />
          <Stat
            label="缓存命中"
            value={formatPercent(cacheRate, 0)}
            sub={`${llm?.cacheHits ?? 0} 次复用`}
            tone="green"
          />
        </div>
        <div className="mt-3 rounded-xl border border-white/6 bg-black/15 p-3">
          <div className="flex items-center justify-between text-[9.5px]">
            <span className="text-[#7f9087]">估算成本（按 ¥2 / ¥8 每百万 token）</span>
            <span className="tabular text-[#e3cfa5]">¥{(((llm?.estimatedCostCents ?? 0) / 100)).toFixed(4)}</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[9px] text-[#6c7a72]">
            <span>离线开关可一键切到规则引擎，6 个场景仍可完整演示</span>
            <span className="flex items-center gap-1">
              <Timer size={8} /> 最近 {llm?.lastLatencyMs ?? 0}ms
            </span>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between text-[9px] text-[#6c7a72]">
          <span>上次解析来源：{llm?.lastSource ?? '—'}</span>
          <span>缓存 LRU 120 条</span>
        </div>
      </Panel>

      <Panel eyebrow="GUARD" title="数字一致性守卫" bodyClassName="p-4">
        <div className="grid grid-cols-2 gap-3">
          <Stat label="渲染次数" value={guard?.rendered ?? 0} sub="模板化回复" />
          <Stat label="校验数字" value={guard?.numbersChecked ?? 0} sub="金额 / 百分比" tone="gold" />
          <Stat label="拦截" value={guard?.numbersBlocked ?? 0} sub="回退纯模板" tone={guard?.numbersBlocked ? 'red' : 'green'} />
          <Stat label="注入拦截" value={guard?.injectionBlocked ?? 0} sub="提示词注入" tone="amber" />
        </div>
        <div className="mt-3 rounded-xl border border-white/6 bg-black/15 p-3">
          <div className="text-[9.5px] leading-relaxed text-[#8b9a91]">
            所有面向用户的金额、余额、收益与百分比只能来自工具结果；
            LLM 只负责意图与槽位，从结构上消除“编造余额 / 交易结果”的可能。
          </div>
          <div className="mt-2 flex items-center justify-between text-[9px] text-[#6c7a72]">
            <span>最近校验</span>
            <span>{guard?.lastGuardAt ? formatDateTime(guard.lastGuardAt) : '—'}</span>
          </div>
        </div>
        <div className="mt-3">
          <div className="flex items-center justify-between text-[9.5px]">
            <span className="text-[#7f9087]">当日小额转账额度</span>
            <span className="tabular text-[#e3cfa5]">
              {formatMoney(limits?.usedCents ?? 0)} / {formatMoney(limits?.dailyLimitCents ?? 100000)}
            </span>
          </div>
          <ProgressBar
            value={limits?.usedCents ?? 0}
            max={limits?.dailyLimitCents ?? 100000}
            tone={(limits?.remainingCents ?? 0) <= 0 ? 'red' : 'gold'}
            height={4}
            className="mt-1.5"
          />
          <div className="mt-1 flex items-center justify-between text-[9px] text-[#6c7a72]">
            <span>预留中 {formatMoney(limits?.heldCents ?? 0)}</span>
            <span>剩余 {formatMoney(limits?.remainingCents ?? 0)}</span>
          </div>
        </div>
      </Panel>

      <Panel
        eyebrow="CONTEXT"
        title="指代消解 · 上下文栈"
        action={<Badge tone="gold">{references.length} 条</Badge>}
        bodyClassName="p-4"
      >
        {references.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-[9.5px] text-[#7f9087]">
            完成一笔转账或取消订阅后，上下文引用会在这里累积。
          </div>
        ) : (
          <div className="space-y-1.5">
            {references
              .slice()
              .reverse()
              .slice(0, 5)
              .map((ref, index) => (
                <div key={`${ref.at}_${index}`} className="rounded-lg border border-white/6 bg-white/[0.022] px-2.5 py-2">
                  <div className="flex items-center justify-between">
                    <span className="truncate text-[9.5px] text-[#c9d1cb]">“{ref.utterance}”</span>
                    <span className="text-[8.5px] text-[#93a49a]">{formatDateTime(ref.at).slice(5)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {Object.entries(ref.resolved).map(([key, value]) => (
                      <span key={key} className="rounded bg-[#c7a667]/8 px-1.5 py-0.5 text-[8.5px] text-[#c7a667]">
                        {key}: {value}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
        <div className="mt-3 flex items-center justify-between text-[9px] text-[#6c7a72]">
          <span>“再转 200”“就那个”会从栈顶补全</span>
          <span>最多保留 6 条</span>
        </div>
      </Panel>

      <SchedulerPanel onExecuted={() => void agent.refreshAudit()} />

      <Panel eyebrow="EXPORT" title="合规自评与系统设置" bodyClassName="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-[10px] font-medium text-[#e0d8c8]">
              <Download size={11} className="text-[#c7a667]" /> 安全自评摘要
            </div>
            <div className="mt-1 max-w-[260px] text-[9px] leading-relaxed text-[#7f9087]">
              导出权限分级的执行统计、审计链状态、数字守卫指标与监管要求映射（演示版，不构成合规意见）。
            </div>
          </div>
          <button
            onClick={exportCompliance}
            disabled={exporting}
            className="flex shrink-0 items-center gap-1 rounded-full border border-[#c7a667]/30 bg-[#c7a667]/10 px-2.5 py-1.5 text-[9.5px] text-[#e3cfa5]"
          >
            {exporting ? '生成中…' : exported ? '再次导出' : '导出 .md'}
          </button>
        </div>
        {exported ? (
          <div className="mt-2 text-[9px] text-[#8fd0b3]">已导出 bank-agent-compliance.md</div>
        ) : null}

        <div className="my-3 h-px bg-white/6" />

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => agent.setElder(!agent.state.elderMode)}
            className={clsx(
              'flex items-center justify-between rounded-xl border px-3 py-2.5 text-left transition',
              agent.state.elderMode
                ? 'border-[#c7a667]/35 bg-[#c7a667]/10'
                : 'border-white/8 bg-white/[0.02]',
            )}
          >
            <span>
              <span className="flex items-center gap-1 text-[9px] text-[#d9d2c3]">
                <Accessibility size={10} /> 适老模式
              </span>
              <span className="mt-0.5 block text-[8.5px] text-[#7f9087]">大字 + 二次核对</span>
            </span>
            <span
              className={clsx(
                'h-4 w-7 rounded-full p-0.5 transition',
                agent.state.elderMode ? 'bg-[#c7a667]' : 'bg-white/12',
              )}
            >
              <span
                className={clsx(
                  'block h-3 w-3 rounded-full bg-white transition',
                  agent.state.elderMode && 'translate-x-3',
                )}
              />
            </span>
          </button>
          <button
            onClick={() => {
              if (window.confirm('重置演示数据并新建会话？')) void agent.resetDemo();
            }}
            className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5 text-left"
          >
            <span>
              <span className="flex items-center gap-1 text-[9px] text-[#d9d2c3]">
                <RefreshCw size={10} /> 重置演示
              </span>
              <span className="mt-0.5 block text-[8.5px] text-[#7f9087]">恢复种子数据与额度</span>
            </span>
            <RefreshCw size={12} className="text-[#7f9087]" />
          </button>
        </div>

        <div className="mt-3 flex items-center justify-between rounded-lg bg-black/15 px-2.5 py-2 text-[9px] text-[#6c7a72]">
          <span className="flex items-center gap-1">
            <Wallet size={9} /> 演示时间固定为 {agent.state.snapshot ? formatDateTime(agent.state.snapshot.demoNow) : '2026-10-30 10:00'}
          </span>
          <span className="flex items-center gap-1">
            <Gauge size={9} /> 会话 {agent.state.sessionId ?? '—'}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between text-[8.5px] text-[#93a49a]">
          <span className="flex items-center gap-1">
            <Sparkles size={8} className="text-[#c7a667]" /> LLM 只出意图，事实由工具结果渲染
          </span>
          <Hash value={stats?.audit.head ?? ''} />
        </div>
      </Panel>
    </div>
  );
}
