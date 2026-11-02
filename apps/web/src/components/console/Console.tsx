import { useState } from 'react';
import { Activity, FlaskConical, Gauge, LockKeyhole, ScanSearch, ShieldCheck } from 'lucide-react';
import { formatMoney } from '@bank/shared';
import clsx from 'clsx';
import type { BankAgentApi } from '../../state/useBankAgent';
import { AuditMini, EventLog, GuardSummary, IntentPanel, PolicyPanel } from './TracePanels';
import { DagView } from './DagView';
import { AuditPanel } from './AuditPanel';
import { AttackLab } from './AttackLab';
import { MetricsPanel } from './MetricsPanel';
import { Badge } from '../ui/primitives';

type Tab = 'trace' | 'audit' | 'lab' | 'metrics';

const TABS: Array<{ id: Tab; label: string; icon: any; hint: string }> = [
  { id: 'trace', label: '实时链路', icon: Activity, hint: '意图 / DAG / 策略 / 审计' },
  { id: 'audit', label: '安全审计', icon: ScanSearch, hint: '哈希链 / 篡改检测 / 回放' },
  { id: 'lab', label: '攻防实验室', icon: FlaskConical, hint: '注入 / 熔断 / 沙箱' },
  { id: 'metrics', label: '运行指标', icon: Gauge, hint: 'LLM 成本 / 守卫 / 合规' },
];

export function Console({ agent }: { agent: BankAgentApi }) {
  const [tab, setTab] = useState<Tab>('trace');
  const { state } = agent;
  const limits = state.snapshot?.limits;
  const verification = state.stats?.audit.verification ?? state.auditVerification;
  const llmMode = state.stats?.llm.mode ?? state.snapshot?.session.llmMode ?? 'llm';
  const sessionShort = state.sessionId?.replace('sess_', '') ?? '—';

  return (
    <div className="flex min-h-[844px] w-full min-w-0 flex-col gap-4">
      <div className="console-card px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1">
            {TABS.map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setTab(item.id)}
                  title={item.hint}
                  className={clsx(
                    'tab-underline flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[9.5px] transition',
                    active
                      ? 'bg-white/[0.045] text-[#e9e2d3]'
                      : 'text-[#819187] hover:bg-white/[0.025] hover:text-[#c9d1cb]',
                  )}
                  data-active={active}
                >
                  <Icon size={12} className={active ? 'text-[#c7a667]' : ''} />
                  {item.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[9px] text-[#7f9087]">
            <span className="flex items-center gap-1 rounded-full border border-white/7 bg-white/[0.025] px-2 py-1">
              <span
                className={clsx(
                  'h-1.5 w-1.5 rounded-full',
                  state.busy ? 'animate-soft-pulse bg-[#c7a667]' : 'bg-[#2f7d5b]',
                )}
              />
              {state.busy ? 'RUNNING' : 'LIVE'} · {sessionShort}
            </span>
            <span className="flex items-center gap-1">
              <ShieldCheck size={9} className={verification?.ok ? 'text-[#8fd0b3]' : 'text-[#eda49b]'} />
              审计 {verification?.ok ? '完整' : '待验证'}
            </span>
            <span className="hidden items-center gap-1 sm:flex">
              额度剩余 <span className="tabular text-[#e3cfa5]">{formatMoney(limits?.remainingCents ?? 0)}</span>
            </span>
            <Badge tone={llmMode === 'offline' ? 'amber' : 'gold'}>
              {llmMode === 'offline' ? '离线规则' : 'DeepSeek'}
            </Badge>
            {state.pending ? (
              <button onClick={agent.openPending}>
                <Badge tone="amber">待确认</Badge>
              </button>
            ) : null}
            {state.flow === 'LOCKED' ? (
              <Badge tone="red">
                <LockKeyhole size={8} /> 锁定
              </Badge>
            ) : null}
          </div>
        </div>
      </div>

      {tab === 'trace' ? (
        <div className="min-w-0 space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
            <IntentPanel agent={agent} />
            <PolicyPanel agent={agent} />
            <GuardSummary agent={agent} />
          </div>
          <DagView agent={agent} />
          <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
            <EventLog agent={agent} />
            <AuditMini agent={agent} onOpenAudit={() => setTab('audit')} />
          </div>
        </div>
      ) : null}

      {tab === 'audit' ? <AuditPanel agent={agent} /> : null}
      {tab === 'lab' ? <AttackLab agent={agent} onViewTrace={() => setTab('trace')} /> : null}
      {tab === 'metrics' ? <MetricsPanel agent={agent} /> : null}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 text-[9.5px] text-[#93a49a]">
        <span>AI Banking Agent · 双屏演示控制台</span>
        <span>权限分级 / 幻觉守卫 / 注入防御 / 全链路审计 / 熔断 / 沙箱</span>
      </div>
    </div>
  );
}
