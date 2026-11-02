/**
 * 安全风控智能体：对每一笔触达资金或账户配置的操作打分，输出可解释的风险判定。
 *
 * 它不参与语言理解，也不接受模型给出的"风险等级"，只读服务端账本与会话事实：
 * 金额占比、行为基线、收款人新异性、时段、频次、拆分规避、会话风险、注入嫌疑、
 * 意图置信度、风险名单、话术关键词、设备与额度余量。
 *
 * 融合规则：最终档位 = max(静态档, 风控档)。风控只能升档，不能降档。
 */
import {
  TIER_THRESHOLDS_CENTS,
  tierFromAmount,
  tierFromRiskScore,
  higherTier,
  riskLevelFromScore,
  type DagNode,
  type RiskSignal,
  type RiskSignalCode,
  type RiskTier,
  type RiskVerdict,
} from '@bank/shared';
import { clock } from '../core/clock';
import { availableCents, totalAvailableCents, type BankState } from '../core/state';

const FRAUD_KEYWORDS = [
  '验证账户',
  '安全账户',
  '配合调查',
  '退款',
  '刷单',
  '垫付',
  '中奖',
  '解冻费',
  '客服要求',
  '屏幕共享',
];

/** 演示风险名单：真实接入时由行方反欺诈名单服务提供，配置 BLOCKED_PAYEES 覆盖。 */
const DEFAULT_BLOCKLIST = ['风险账户测试'];

/** 调用方传入的会话侧事实：模型置信度、注入嫌疑、设备与会话变更。 */
export interface RiskCallContext {
  nluConfidence?: number;
  injectionSuspicion?: number;
  payeeJustChanged?: boolean;
  newDeviceSession?: boolean;
  blocklist?: string[];
}

export interface RiskInput extends RiskCallContext {
  state: BankState;
  node: DagNode;
  amountCents?: number;
  payeeName?: string;
  note?: string;
  /** 本次对话的意图解析置信度 */
  nluConfidence?: number;
  /** 注入嫌疑度 0–1 */
  injectionSuspicion?: number;
  /** 收款人在本次会话中被改过（例如"换成李某"） */
  payeeJustChanged?: boolean;
  /** 当前会话是新设备/新浏览器 */
  newDeviceSession?: boolean;
  /** 当日已用额度（分） */
  usedCentsToday?: number;
  blocklist?: string[];
}

function centsOf(node: DagNode): number | undefined {
  const args = node.args as Record<string, any>;
  const raw = args.totalCents ?? args.amountCents ?? args.limitCents;
  return typeof raw === 'number' ? raw : undefined;
}

function dayStartIso(offsetDays = 0): number {
  const now = clock.now();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return start.getTime() + offsetDays * 86_400_000;
}

/** 近 30 天日均生活支出（分），用于行为基线对比。 */
function dailyBaseline(state: BankState): number {
  const from = dayStartIso(-30);
  const expenses = state.transactions.filter(
    (t) => t.amountCents < 0 && new Date(t.ts).getTime() >= from && t.status === 'posted',
  );
  if (!expenses.length) return 0;
  const total = expenses.reduce((sum, t) => sum + Math.abs(t.amountCents), 0);
  return Math.round(total / 30);
}

function transferHistoryNames(state: BankState, withinDays: number): string[] {
  const from = dayStartIso(-withinDays);
  return state.transactions
    .filter((t) => t.merchant.startsWith('转账 ·') && new Date(t.ts).getTime() >= from)
    .map((t) => t.merchant.replace('转账 ·', '').trim());
}

function recentOutflowCount(state: BankState, withinMs: number): number {
  const from = clock.now().getTime() - withinMs;
  return state.transactions.filter(
    (t) => t.amountCents < 0 && new Date(t.ts).getTime() >= from,
  ).length;
}

/** 拆分规避：24 小时内出现多笔贴近阈值的转出。 */
function structuringHits(state: BankState, amountCents?: number): number {
  const from = clock.now().getTime() - 86_400_000;
  const bands: Array<[number, number]> = [
    [90_000, 100_000],   // 贴近 1000 元 T1 上限
    [450_000, 500_000],  // 贴近 5000 元双因子上限
    [4_500_000, 5_000_000], // 贴近 5 万元人工审核线
  ];
  const inBand = (cents: number) => bands.some(([lo, hi]) => cents >= lo && cents <= hi);
  const txns = state.transactions.filter(
    (t) => t.amountCents < 0 && new Date(t.ts).getTime() >= from && inBand(Math.abs(t.amountCents)),
  );
  const nowInBand = amountCents !== undefined && inBand(amountCents);
  return txns.length + (nowInBand ? 1 : 0);
}

export function assessRisk(input: RiskInput): RiskVerdict {
  const { state, node } = input;
  const amountCents = input.amountCents ?? centsOf(node);

  // 只读查询不进入风控评分：没有资金变动可评估，避免历史流水误升档位
  if (node.risk === 'GREEN') {
    return {
      score: 0,
      level: 'low',
      tier: 'T0',
      signals: [],
      evaluatedAt: clock.nowIso(),
      engine: 'risk-agent-v1',
      requiresReview: false,
    };
  }
  const signals: RiskSignal[] = [];
  const blocklist = (input.blocklist ?? DEFAULT_BLOCKLIST).filter(Boolean);

  const add = (code: RiskSignalCode, weight: number, detail: string) =>
    signals.push({ code, weight, detail });

  // 1. 金额占可用资金比例
  const available = totalAvailableCents(state);
  if (amountCents && available > 0) {
    const ratio = amountCents / available;
    if (ratio > 0.8) add('AMOUNT_RATIO', 28, `本次金额占可用资金 ${(ratio * 100).toFixed(0)}%`);
    else if (ratio > 0.5) add('AMOUNT_RATIO', 18, `本次金额占可用资金 ${(ratio * 100).toFixed(0)}%`);
    else if (ratio > 0.3) add('AMOUNT_RATIO', 8, `本次金额占可用资金 ${(ratio * 100).toFixed(0)}%`);
  }

  // 2. 行为基线：与近 30 天日均支出比较
  const baseline = dailyBaseline(state);
  if (amountCents && baseline > 0) {
    const multiple = amountCents / baseline;
    if (multiple >= 5) add('BEHAVIOR_BASELINE', 30, `金额是近 30 天日均支出的 ${multiple.toFixed(1)} 倍`);
    else if (multiple >= 3) add('BEHAVIOR_BASELINE', 20, `金额是近 30 天日均支出的 ${multiple.toFixed(1)} 倍`);
    else if (multiple >= 2) add('BEHAVIOR_BASELINE', 10, `金额是近 30 天日均支出的 ${multiple.toFixed(1)} 倍`);
  }

  // 3. 收款人新异性
  if (input.payeeName) {
    const known = transferHistoryNames(state, 90);
    if (!known.includes(input.payeeName)) {
      const everKnown = transferHistoryNames(state, 3650).includes(input.payeeName);
      add('NEW_PAYEE', everKnown ? 8 : 15, everKnown ? '该收款人近 90 天无往来' : '首次向其转账的收款人');
    }
  }

  // 4. 时段
  const hour = new Date(clock.now()).getHours();
  if (hour >= 0 && hour < 5 && amountCents && amountCents > 100_000) {
    add('NIGHT_HOURS', 12, `${String(hour).padStart(2, '0')} 时段的非小额交易`);
  }

  // 5. 频次
  const tenMin = recentOutflowCount(state, 10 * 60_000);
  if (tenMin >= 3) add('VELOCITY', 15, `10 分钟内已有 ${tenMin} 笔转出`);
  else if (tenMin >= 2) add('VELOCITY', 8, `10 分钟内已有 ${tenMin} 笔转出`);

  // 6. 拆分规避
  const structuring = structuringHits(state, amountCents);
  if (structuring >= 3) add('STRUCTURING', 25, `24 小时内有 ${structuring} 笔贴近限额阈值的交易`);
  else if (structuring === 2) add('STRUCTURING', 12, `24 小时内有 ${structuring} 笔贴近限额阈值的交易`);

  // 7. 会话风险
  if (state.security.failures > 0 || state.security.injectionHits > 0) {
    add(
      'SESSION_RISK',
      10 + Math.min(15, (state.security.failures + state.security.injectionHits) * 5),
      `本会话累计 ${state.security.failures} 次失败、${state.security.injectionHits} 次注入命中`,
    );
  }

  // 8. 注入嫌疑
  if ((input.injectionSuspicion ?? 0) >= 0.5) {
    add('INJECTION_SUSPICION', 20, `本轮解析的注入嫌疑度 ${(input.injectionSuspicion ?? 0).toFixed(2)}`);
  }

  // 9. 意图置信度
  if (input.nluConfidence !== undefined && input.nluConfidence < 0.6 && (amountCents ?? 0) > 100_000) {
    add('LOW_CONFIDENCE', 12, `意图置信度 ${input.nluConfidence.toFixed(2)} 偏低`);
  }

  // 10. 风险名单
  if (input.payeeName && blocklist.includes(input.payeeName)) {
    add('BLOCKLIST_PAYEE', 100, '收款人命中风险名单');
  }

  // 11. 话术关键词
  const note = String(input.note ?? '');
  const hitKeyword = FRAUD_KEYWORDS.find((k) => note.includes(k));
  if (hitKeyword) add('FRAUD_KEYWORD', 25, `备注含高风险话术「${hitKeyword}」`);

  // 12. 收款人刚被改动
  if (input.payeeJustChanged) add('PAYEE_JUST_CHANGED', 15, '收款人在本次会话中被替换');

  // 13. 新设备
  if (input.newDeviceSession) add('NEW_DEVICE', 12, '当前为新设备或新浏览器会话');

  // 14. 接近当日额度上限
  const used = input.usedCentsToday ?? 0;
  if (amountCents && used + amountCents > TIER_THRESHOLDS_CENTS.dailyCeiling * 0.8) {
    add('DAILY_CEILING_NEAR', 15, '本次之后接近当日额度上限');
  }

  const score = Math.max(0, Math.min(100, signals.reduce((s, x) => s + x.weight, 0)));
  const agentTier = tierFromRiskScore(score);
  const amountTier = amountCents ? tierFromAmount(amountCents) : ('T1' as RiskTier);
  const finalTier = higherTier(agentTier, amountTier);
  const blocklisted = signals.some((s) => s.code === 'BLOCKLIST_PAYEE');

  return {
    score,
    level: riskLevelFromScore(score),
    tier: finalTier,
    signals: signals.sort((a, b) => b.weight - a.weight),
    evaluatedAt: clock.nowIso(),
    engine: 'risk-agent-v1',
    requiresReview: finalTier === 'T4' || blocklisted,
  };
}

/** 静态档：不动资金的操作固定 T0，其余按金额与操作类型给档，再由风控升档。 */
export function staticTierFor(node: DagNode, amountCents?: number): RiskTier {
  const meta = node.risk;
  if (meta === 'GREEN') return 'T0';
  if (amountCents === undefined) return 'T1';
  return tierFromAmount(amountCents);
}

export function primaryAvailableCents(state: BankState): number {
  return availableCents(state.accounts.find((a) => a.primary) ?? state.accounts[0]);
}
