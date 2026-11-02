import { Activity, ChevronRight, Fingerprint, ShieldCheck, Sparkles } from 'lucide-react';
import {
  INTENT_LABELS,
  RISK_META,
  formatMoney,
  formatTime,
  type FlowState,
} from '@bank/shared';
import clsx from 'clsx';
import type { BankAgentApi } from '../../state/useBankAgent';
import { Badge, EmptyState, Hash, Panel, ProgressBar, RiskBadge, Stat } from '../ui/primitives';
import { riskColor } from '../../lib/colors';

const SLOT_LABELS: Record<string, string> = {
  amount: '金额',
  payee: '收款人',
  phone: '手机号',
  note: '备注',
  period: '周期',
  category: '分类',
  productName: '产品',
  riskLevel: '风险等级',
  cardAction: '卡片动作',
  cardLast4: '卡号尾号',
  limitAmount: '目标额度',
  subscriptionName: '订阅',
  birthdayDate: '生日',
  budget: '预算',
  query: '查询类型',
  isScheduled: '定时',
  scheduleDate: '执行日期',
  splitNames: 'AA 参与人',
  splitTotal: 'AA 总额',
  wealthAction: '理财动作',
  contactId: '联系人ID',
  subscriptionId: '订阅ID',
  cardId: '卡片ID',
};

const PERIOD_LABEL: Record<string, string> = {
  currentMonth: '本月',
  lastMonth: '上个月',
  year: '今年',
};

const CARD_ACTION: Record<string, string> = {
  list: '查看卡片',
  apply_virtual: '申请虚拟卡',
  adjust_limit: '调整额度',
  report_loss: '挂失',
  freeze: '冻结',
  unfreeze: '解冻',
};

const WEALTH_ACTION: Record<string, string> = {
  query: '推荐对比',
  purchase: '申购',
  redeem: '赎回',
};

function formatSlot(key: string, value: any): string {
  if (value === null || value === undefined || value === '') return '—';
  if (key === 'amount' || key === 'limitAmount' || key === 'budget' || key === 'splitTotal') {
    return formatMoney(Number(value) * 100);
  }
  if (key === 'period') return PERIOD_LABEL[value] ?? String(value);
  if (key === 'cardAction') return CARD_ACTION[value] ?? String(value);
  if (key === 'wealthAction') return WEALTH_ACTION[value] ?? String(value);
  if (key === 'query') return value === 'balance' ? '余额' : value === 'transactions' ? '流水' : String(value);
  if (Array.isArray(value)) return value.join('、');
  if (typeof value === 'boolean') return value ? '是' : '否';
  return String(value);
}

export function IntentPanel({ agent }: { agent: BankAgentApi }) {
  const { state } = agent;
  const nlu = state.nlu;
  const context = state.snapshot?.session.context;
  const slotEntries = nlu
    ? Object.entries(nlu.slots).filter(([, value]) => value !== null && value !== undefined && value !== '')
    : [];

  return (
    <Panel
      eyebrow="NLU"
      title="意图与槽位"
      action={
        nlu ? (
          <Badge tone={nlu.source === 'llm' ? 'gold' : nlu.source === 'cache' ? 'green' : 'amber'}>
            {nlu.source === 'llm' ? 'DeepSeek' : nlu.source === 'cache' ? '本地缓存' : nlu.source === 'offline' ? '离线规则' : '规则引擎'}
          </Badge>
        ) : null
      }
      bodyClassName="p-4"
    >
      {!nlu ? (
        <EmptyState
          icon={<Sparkles size={22} />}
          title="等待用户输入"
          detail="意图解析结果、槽位与上下文栈会实时出现在这里。"
        />
      ) : (
        <>
          <div className="flex items-end justify-between">
            <div>
              <div className="text-[18px] font-semibold text-[#efe8d9]">{INTENT_LABELS[nlu.intent]}</div>
              <div className="mt-1 text-[9.5px] text-[#7f9087]">
                intent: {nlu.intent} · {nlu.latencyMs ? `${nlu.latencyMs}ms` : nlu.source}
              </div>
            </div>
            <div className="text-right">
              <div className="console-label">置信度</div>
              <div className="mt-1 tabular text-[16px] font-semibold text-[#e3cfa5]">
                {(nlu.confidence * 100).toFixed(0)}%
              </div>
            </div>
          </div>
          <ProgressBar value={nlu.confidence * 100} max={100} tone="gold" height={3} className="mt-2" />
          <div className="mt-2 rounded-lg border border-white/5 bg-black/15 px-2.5 py-2 text-[9px] leading-relaxed text-[#b9c2bb]">
            “{nlu.utterance ?? '—'}”
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {slotEntries.length ? (
              slotEntries.map(([key, value]) => (
                <span key={key} className="rounded-md border border-white/8 bg-white/[0.035] px-1.5 py-1 text-[9px] text-[#a7b3ab]">
                  {SLOT_LABELS[key] ?? key}
                  <span className="mx-1 text-[#5c6a62]">·</span>
                  <span className="text-[#e0d8c8]">{formatSlot(key, value)}</span>
                </span>
              ))
            ) : (
              <span className="text-[9.5px] text-[#7f9087]">无显式槽位，依赖上下文补全</span>
            )}
          </div>
          <div className="mt-2 border-t border-white/6 pt-2">
            <div className="flex items-center justify-between">
              <span className="console-label">上下文栈</span>
              <span className="text-[9px] text-[#7f9087]">{context?.references.length ?? 0} 条引用</span>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-1.5 text-[9.5px]">
              <div className="rounded-md bg-white/[0.025] px-2 py-1.5 text-[#a7b3ab]">
                上次收款人 <span className="text-[#e3cfa5]">{context?.lastPayee ?? '—'}</span>
              </div>
              <div className="rounded-md bg-white/[0.025] px-2 py-1.5 text-[#a7b3ab]">
                上次金额{' '}
                <span className="text-[#e3cfa5]">
                  {context?.lastAmountCents ? formatMoney(context.lastAmountCents) : '—'}
                </span>
              </div>
            </div>
            {nlu.references.length ? (
              <div className="mt-1.5 text-[9px] text-[#c7a667]">
                指代解析：{nlu.references.join('、')}
              </div>
            ) : null}
          </div>
        </>
      )}
    </Panel>
  );
}

export function PolicyPanel({ agent }: { agent: BankAgentApi }) {
  const { state } = agent;
  const latestPolicyId = Object.keys(state.policies).at(-1);
  const policyId =
    state.activeNodeId && state.policies[state.activeNodeId] ? state.activeNodeId : latestPolicyId;
  const node = state.dag?.nodes.find((n) => n.id === policyId);
  const policy =
    (policyId ? state.policies[policyId] : undefined) ??
    [...(state.dag?.nodes ?? [])].reverse().find((n) => n.policy)?.policy;
  const current = policy;
  const liveLimit = state.snapshot?.limits ?? current?.limit;

  return (
    <Panel eyebrow="POLICY" title="权限分级判定" bodyClassName="p-4">
      {!current ? (
        <EmptyState
          icon={<Fingerprint size={22} />}
          title="尚未产生策略判定"
          detail="执行节点前会计算基础等级、金额阈值、日累计额度与所需认证方式。"
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[10.5px] font-medium text-[#e4ded0]">{node?.label ?? current.tool}</div>
              <div className="mt-0.5 text-[9.5px] text-[#7f9087]">
                {current.decision} · 基础 {RISK_META[current.baseRisk].short}
              </div>
            </div>
            <RiskBadge risk={current.effectiveRisk} />
          </div>

          <div className="mt-2 grid grid-cols-3 gap-1">
            {(['GREEN', 'YELLOW', 'RED'] as const).map((risk) => {
              const active = current.effectiveRisk === risk;
              return (
                <div
                  key={risk}
                  className={clsx(
                    'rounded-lg border px-1.5 py-1.5 text-center text-[9px] transition',
                    active ? 'bg-white/[0.055]' : 'border-white/5 bg-transparent opacity-45',
                  )}
                  style={{ borderColor: active ? riskColor(risk) : undefined }}
                >
                  <span className="font-medium" style={{ color: riskColor(risk) }}>
                    {RISK_META[risk].short}
                  </span>
                  <span className="ml-1 text-[#a7b3ab]">{risk === 'GREEN' ? '自动' : risk === 'YELLOW' ? '确认' : '强验证'}</span>
                </div>
              );
            })}
          </div>

          {current.tool === 'transfer' ? (
            <div className="mt-2 rounded-lg border border-white/5 bg-black/15 p-2.5">
              <div className="flex items-center justify-between text-[9px] text-[#7f9087]">
                <span>当日小额转账额度</span>
                <span className="tabular text-[#e3cfa5]">
                  {formatMoney(liveLimit?.usedCents ?? current.limit.usedCents)} / {formatMoney(liveLimit?.dailyLimitCents ?? current.limit.dailyLimitCents)}
                </span>
              </div>
              <ProgressBar
                value={liveLimit?.usedCents ?? current.limit.usedCents}
                max={liveLimit?.dailyLimitCents ?? current.limit.dailyLimitCents}
                tone={(liveLimit?.remainingCents ?? current.limit.remainingCents) <= 0 ? 'red' : 'gold'}
                height={4}
                className="mt-1.5"
              />
              <div className="mt-1 flex items-center justify-between text-[9px] text-[#7f9087]">
                <span>已用 + 预留 {formatMoney(liveLimit?.heldCents ?? current.limit.heldCents)}</span>
                <span>剩余 {formatMoney(liveLimit?.remainingCents ?? current.limit.remainingCents)}</span>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-black/15 px-2.5 py-2 text-[9px] text-[#7f9087]">
              <span>该操作不占用小额转账额度</span>
              <span className="text-[#8fd0b3]">按工具等级 + 金额判定</span>
            </div>
          )}

          <div className="mt-2 space-y-1">
            {current.reasons.map((reason) => (
              <div key={reason.code} className="flex items-start gap-1.5 text-[9.5px] leading-relaxed text-[#a7b3ab]">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[#c7a667]" />
                <span>{reason.detail ?? reason.label}</span>
              </div>
            ))}
          </div>

          <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-[#0f3d33]/25 px-2.5 py-2 text-[9px] text-[#8fd0b3]">
            <ShieldCheck size={10} />
            {current.effectiveRisk === 'RED'
              ? '执行前需人脸识别 / 短信验证，签发一次性授权'
              : current.effectiveRisk === 'YELLOW'
                ? '确认后签发一次性 PolicyGrant，绑定操作摘要'
                : '查询类操作自动执行，无需二次确认'}
          </div>
        </>
      )}
    </Panel>
  );
}

export function GuardSummary({ agent }: { agent: BankAgentApi }) {
  const stats = agent.state.stats;
  const guard = stats?.guard;
  const breaker = stats?.breaker;
  const verification = stats?.audit.verification ?? agent.state.auditVerification;
  return (
    <Panel eyebrow="GUARD" title="安全态势" bodyClassName="p-4">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="数字一致性校验" value={guard?.numbersChecked ?? 0} sub={`拦截 ${guard?.numbersBlocked ?? 0} 次`} tone="gold" />
        <Stat label="注入拦截" value={guard?.injectionBlocked ?? 0} sub="提示词注入" tone="amber" />
        <Stat
          label="审计链"
          value={verification?.ok ? '完整' : '待验证'}
          sub={`${Math.max(verification?.count ?? 0, agent.state.audit.length)} 条 · append-only`}
          tone={verification?.ok ? 'green' : 'red'}
        />
        <Stat
          label="熔断状态"
          value={breaker?.lockedUntil ? '锁定' : '正常'}
          sub={`失败 ${breaker?.failures ?? 0} · 注入 ${breaker?.injectionHits ?? 0}`}
          tone={breaker?.lockedUntil ? 'red' : 'green'}
        />
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-white/6 pt-2 text-[9px] text-[#7f9087]">
        <span>链头</span>
        <Hash value={verification?.head ?? ''} />
      </div>
    </Panel>
  );
}

export function EventLog({ agent }: { agent: BankAgentApi }) {
  const events = [...agent.state.events].reverse().slice(0, 12);
  return (
    <Panel
      eyebrow="TRACE"
      title="决策事件流"
      action={<Badge tone="neutral">{agent.state.events.length} 条</Badge>}
      bodyClassName="p-0"
    >
      <div className="console-scroll max-h-[224px] overflow-y-auto">
        {events.length === 0 ? (
          <div className="px-4 py-8 text-center text-[9px] text-[#7f9087]">暂无事件</div>
        ) : (
          <div className="divide-y divide-white/5">
            {events.map((event) => (
              <div key={event.id} className="flex gap-2 px-3 py-2">
                <span
                  className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{
                    background:
                      event.tone === 'danger'
                        ? '#b3392e'
                        : event.tone === 'warning'
                          ? '#c9791f'
                          : event.tone === 'success'
                            ? '#2f7d5b'
                            : event.tone === 'gold'
                              ? '#c7a667'
                              : '#5b675f',
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[9px] text-[#c9d1cb]">{event.title}</span>
                    <span className="shrink-0 tabular text-[8.5px] text-[#93a49a]">{formatTime(event.at)}</span>
                  </div>
                  {event.detail ? (
                    <div className="mt-0.5 line-clamp-2 text-[9px] leading-relaxed text-[#7f9087]">{event.detail}</div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

export function AuditMini({
  agent,
  onOpenAudit,
}: {
  agent: BankAgentApi;
  onOpenAudit: () => void;
}) {
  const entries = agent.state.audit.slice(0, 5);
  const verification = agent.state.stats?.audit.verification ?? agent.state.auditVerification;
  return (
    <Panel
      eyebrow="AUDIT"
      title="审计哈希链"
      action={
        <button
          onClick={onOpenAudit}
          className="flex items-center gap-0.5 text-[9.5px] text-[#c7a667] transition hover:text-[#e3cfa5]"
        >
          查看全链 <ChevronRight size={9} />
        </button>
      }
      bodyClassName="p-0"
    >
      <div className="flex items-center justify-between px-3 py-2 text-[9px]">
        <span className="flex items-center gap-1 text-[#8fd0b3]">
          <ShieldCheck size={9} /> {verification?.ok ? '链校验通过' : '等待校验'}
        </span>
        <span className="text-[#7f9087]">{Math.max(verification?.count ?? 0, entries.length)} 条</span>
      </div>
      <div className="console-scroll max-h-[168px] overflow-y-auto border-t border-white/5">
        {entries.length === 0 ? (
          <div className="px-3 py-6 text-center text-[9.5px] text-[#7f9087]">暂无审计记录</div>
        ) : (
          entries.map((entry) => (
            <div key={entry.seq} className="flex items-center gap-2 border-b border-white/5 px-3 py-1.5 last:border-0">
              <span className="w-5 shrink-0 tabular text-[8.5px] text-[#93a49a]">#{entry.seq}</span>
              <span className="w-20 shrink-0 truncate text-[8.5px] text-[#c7a667]">{entry.type}</span>
              <span className="min-w-0 flex-1 truncate text-[9px] text-[#9eaaa1]">{entry.summary}</span>
              <Hash value={entry.hash} className="shrink-0 text-[8.5px]" />
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}

export function FlowBadge({ flow }: { flow: FlowState }) {
  const tone = flow === 'DONE' ? 'green' : flow === 'PARTIAL' ? 'amber' : flow === 'FAILED' || flow === 'LOCKED' ? 'red' : 'gold';
  return <Badge tone={tone}>{flow}</Badge>;
}
