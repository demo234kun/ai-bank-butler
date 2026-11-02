import { useState } from 'react';
import {
  AlertTriangle,
  Ban,
  Code2,
  FlaskConical,
  LockKeyhole,
  Play,
  ShieldCheck,
  Terminal,
  Unlock,
} from 'lucide-react';
import { LIU_ATTACKS, formatDateTime, formatMoney } from '@bank/shared';
import clsx from 'clsx';
import { api } from '../../api/client';
import type { BankAgentApi } from '../../state/useBankAgent';
import { Badge, EmptyState, Panel, ProgressBar, Stat } from '../ui/primitives';

interface AttackCheck {
  kind: string;
  label: string;
  blocked: boolean;
  detail: string;
}

const DEFAULT_CODE = `// 只拿到脱敏后的账单切片，没有 require / fs / net
const rows = data.txns.filter((t) => t.category === '咖啡茶饮');
const totalCents = rows.reduce((sum, t) => sum + Math.abs(t.amountCents), 0);
const avgCents = rows.length ? Math.round(totalCents / rows.length) : 0;
__out = { count: rows.length, totalCents, avgCents };`;

const MALICIOUS_CODE = `const fs = require('node:fs');
__out = fs.readFileSync('C:/secret.txt', 'utf8');`;

export function AttackLab({
  agent,
  onViewTrace,
}: {
  agent: BankAgentApi;
  onViewTrace: () => void;
}) {
  const [checks, setChecks] = useState<AttackCheck[] | null>(null);
  const [running, setRunning] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const runSelfTest = async () => {
    setRunning(true);
    try {
      const result = await api.post<{ checks: AttackCheck[] }>('/api/security/attack');
      setChecks(result.checks);
      await agent.refreshStats();
      await agent.refreshAudit();
    } catch {
      // ignore
    } finally {
      setRunning(false);
    }
  };

  const sendAttack = async (text: string) => {
    setSent(text);
    await agent.send(text);
    onViewTrace();
  };

  const breaker = agent.state.stats?.breaker;
  const locked = Boolean(breaker?.lockedUntil);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
      <div className="space-y-4">
        <Panel
          eyebrow="RED TEAM"
          title="提示词攻击实验室"
          action={<Badge tone="amber">4 类攻击 · 服务端兜底</Badge>}
          bodyClassName="p-4"
        >
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {LIU_ATTACKS.map((attack) => (
              <div
                key={attack.id}
                className="rounded-xl border border-white/7 bg-white/[0.022] p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[9.5px] font-medium text-[#e0d8c8]">
                    <AlertTriangle size={10} className="text-[#c9791f]" />
                    {attack.label}
                  </span>
                  <Badge tone="red">攻击</Badge>
                </div>
                <p className="mt-1.5 line-clamp-2 text-[9.5px] leading-relaxed text-[#8b9a91]">
                  “{attack.text}”
                </p>
                <div className="mt-1.5 text-[8.5px] text-[#6c7a72]">预期：{attack.expected}</div>
                <button
                  onClick={() => sendAttack(attack.text)}
                  className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-[#b3392e]/25 bg-[#b3392e]/[0.07] py-1.5 text-[9.5px] text-[#eda49b] transition hover:bg-[#b3392e]/12"
                >
                  <Play size={8} /> 发送到手机
                </button>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="text-[9px] text-[#7f9087]">
              端到端攻击会写入审计链，并触发输入侧拦截。
            </div>
            <button
              onClick={runSelfTest}
              disabled={running}
              className="flex items-center gap-1 rounded-full border border-[#c7a667]/30 bg-[#c7a667]/10 px-3 py-1.5 text-[9px] text-[#e3cfa5]"
            >
              <FlaskConical size={9} /> {running ? '自检中…' : '运行安全自检'}
            </button>
          </div>

          {checks ? (
            <div className="mt-3 overflow-hidden rounded-xl border border-white/7">
              <div className="grid grid-cols-[1fr_auto] border-b border-white/7 bg-white/[0.025] px-3 py-1.5 text-[8.5px] uppercase tracking-[0.12em] text-[#6c7a72]">
                <span>检查项</span>
                <span>结果</span>
              </div>
              {checks.map((check) => (
                <div
                  key={check.kind}
                  className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-white/5 px-3 py-2 last:border-0"
                >
                  <div className="min-w-0">
                    <div className="text-[9.5px] text-[#c9d1cb]">{check.label}</div>
                    <div className="mt-0.5 line-clamp-1 text-[8.5px] text-[#6c7a72]">{check.detail}</div>
                  </div>
                  <Badge tone={check.blocked ? 'green' : 'red'}>
                    {check.blocked ? '已拦截' : '未拦截'}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3">
              <EmptyState
                icon={<ShieldCheck size={20} />}
                title="尚未运行服务端自检"
                detail="自检会验证注入特征、授权摘要篡改、令牌重放与服务端策略独立性。"
              />
            </div>
          )}
        </Panel>

        <SandboxPanel />
      </div>

      <div className="space-y-4">
        <Panel
          eyebrow="BREAKER"
          title="异常熔断与人工复核"
          action={
            <Badge tone={locked ? 'red' : 'green'}>{locked ? '已锁定' : '正常'}</Badge>
          }
          bodyClassName="p-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <Stat label="连续失败" value={`${breaker?.failures ?? 0}/3`} tone={(breaker?.failures ?? 0) >= 2 ? 'amber' : 'default'} />
            <Stat label="注入命中" value={`${breaker?.injectionHits ?? 0}/2`} tone={(breaker?.injectionHits ?? 0) >= 1 ? 'amber' : 'default'} />
          </div>
          <ProgressBar
            value={breaker?.injectionHits ?? 0}
            max={2}
            tone="red"
            height={3}
            className="mt-3"
          />
          {breaker?.lockedUntil ? (
            <div className="mt-3 rounded-lg border border-[#b3392e]/25 bg-[#b3392e]/[0.07] px-3 py-2 text-[9.5px] leading-relaxed text-[#eda49b]">
              锁定至 {formatDateTime(breaker.lockedUntil)}。
              连续 3 次工具失败或 2 次注入命中将触发 10 分钟锁定。
            </div>
          ) : (
            <div className="mt-3 text-[9px] leading-relaxed text-[#7f9087]">
              连续失败 3 次或注入命中 2 次会锁定会话；锁定后所有工具调用被策略层拒绝。
            </div>
          )}
          <button
            onClick={() => agent.takeover('unlock')}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#c7a667]/30 bg-[#c7a667]/10 py-2 text-[9px] text-[#e3cfa5] transition hover:bg-[#c7a667]/15"
          >
            <Unlock size={9} /> 人工复核解锁
          </button>
          <div className="mt-2 text-center text-[8.5px] text-[#6c7a72]">
            真实系统应接入工单流与双人复核
          </div>
        </Panel>

        <Panel eyebrow="LIMITS" title="额度与确认状态" bodyClassName="p-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[9px]">
              <span className="text-[#7f9087]">当日已用</span>
              <span className="tabular text-[#e3cfa5]">
                {formatMoney(agent.state.snapshot?.limits.usedCents ?? 0)} / 1,000.00
              </span>
            </div>
            <ProgressBar
              value={agent.state.snapshot?.limits.usedCents ?? 0}
              max={agent.state.snapshot?.limits.dailyLimitCents ?? 100000}
              tone="gold"
              height={4}
            />
            <div className="flex items-center justify-between text-[9px] text-[#7f9087]">
              <span>预留中 {formatMoney(agent.state.snapshot?.limits.heldCents ?? 0)}</span>
              <span>剩余 {formatMoney(agent.state.snapshot?.limits.remainingCents ?? 0)}</span>
            </div>
          </div>
          <div className="mt-3 rounded-lg border border-white/5 bg-black/15 px-3 py-2 text-[9px] leading-relaxed text-[#7f9087]">
            两阶段“预留 → 提交”台账串行化同一用户的额度变更，避免并发请求同时卡在黄色阈值内。
          </div>
        </Panel>
      </div>
    </div>
  );
}

function SandboxPanel() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [result, setResult] = useState<any>(null);
  const [running, setRunning] = useState(false);

  const run = async (source = code) => {
    setRunning(true);
    try {
      const response = await api.post<any>('/api/sandbox/run', { code: source });
      setResult(response);
    } catch (error: any) {
      setResult({ ok: false, error: error.message, engine: 'worker_threads + node:vm' });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Panel
      eyebrow="SANDBOX"
      title="受限代码沙箱"
      action={<Badge tone="gold">无 IO · 2.2s 硬超时</Badge>}
      bodyClassName="p-4"
    >
      <textarea
        value={code}
        onChange={(event) => setCode(event.target.value)}
        spellCheck={false}
        className="console-scroll h-[132px] w-full resize-none rounded-lg border border-white/8 bg-[#0a120f] p-2.5 font-mono text-[9.5px] leading-relaxed text-[#a9d3bd] outline-none focus:border-[#c7a667]/35"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          onClick={() => run()}
          disabled={running}
          className="flex items-center gap-1 rounded-full bg-[#0f3d33] px-3 py-1.5 text-[9.5px] text-[#e3cfa5] transition hover:bg-[#155246]"
        >
          <Terminal size={9} /> {running ? '执行中…' : '在沙箱中运行'}
        </button>
        <button
          onClick={() => {
            setCode(MALICIOUS_CODE);
            void run(MALICIOUS_CODE);
          }}
          className="flex items-center gap-1 rounded-full border border-[#b3392e]/25 bg-[#b3392e]/[0.06] px-2.5 py-1.5 text-[9px] text-[#eda49b]"
        >
          <Ban size={8} /> 尝试 require('fs')
        </button>
        <button
          onClick={() => {
            setCode(DEFAULT_CODE);
            setResult(null);
          }}
          className="ml-auto flex items-center gap-1 rounded-full border border-white/10 px-2.5 py-1.5 text-[9px] text-[#9eaaa1]"
        >
          <Code2 size={8} /> 重置示例
        </button>
      </div>
      {result ? (
        <div className="mt-2 rounded-lg border border-white/7 bg-black/20 p-2.5">
          <div className="flex items-center justify-between">
            <span className={clsx('text-[9.5px]', result.ok ? 'text-[#8fd0b3]' : 'text-[#eda49b]')}>
              {result.ok ? '脚本执行成功' : `已拒绝 / 失败：${result.error}`}
            </span>
            <span className="text-[8.5px] text-[#7f9087]">
              {result.durationMs}ms · {result.datasetSize ?? 0} 条数据
            </span>
          </div>
          {result.ok ? (
            <pre className="console-scroll mt-1.5 max-h-[100px] overflow-auto font-mono text-[9px] text-[#a9d3bd]">
{JSON.stringify(result.result, null, 2)}
            </pre>
          ) : null}
          <div className="mt-1.5 text-[8.5px] text-[#6c7a72]">{result.engine ?? 'worker_threads + node:vm'}</div>
        </div>
      ) : null}
      <div className="mt-2 text-[8.5px] leading-relaxed text-[#6c7a72]">
        脚本只接收脱敏账单切片；静态检查拒绝 require / process / import，运行时由 vm 超时与 worker 硬终止兜底。
      </div>
    </Panel>
  );
}
