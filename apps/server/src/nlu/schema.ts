import { z } from 'zod';
import type { Intent, NluResult, NluSlots, NluSource } from '@bank/shared';

const INTENTS: Intent[] = [
  'transfer',
  'bills',
  'wealth',
  'card',
  'subscription',
  'crossscene',
  'account',
  'chitchat',
  'unknown',
];

const RawNluSchema = z
  .object({
    intent: z.string().optional(),
    confidence: z.number().optional(),
    slots: z.record(z.unknown()).optional(),
    needsClarification: z.boolean().optional(),
    ambiguity: z.unknown().optional(),
    injectionSuspicion: z.number().optional(),
    references: z.array(z.string()).optional(),
    rationale: z.string().optional(),
  })
  .passthrough();

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[,¥￥\s]/g, '').replace(/元|块|人民币/g, '');
    const match = cleaned.match(/(-?\d+(?:\.\d+)?)\s*(万|千)?/);
    if (!match) return undefined;
    const base = Number(match[1]);
    if (!Number.isFinite(base)) return undefined;
    const unit = match[2] === '万' ? 10_000 : match[2] === '千' ? 1_000 : 1;
    return base * unit;
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed !== 'null' ? trimmed : undefined;
}

function normalizePeriod(value: unknown): NluSlots['period'] {
  const v = String(value ?? '').toLowerCase();
  if (!v) return null;
  if (['currentmonth', 'month', 'this_month', '本月', '这个月', '当月'].includes(v)) return 'currentMonth';
  if (['lastmonth', 'last_month', '上个月', '上月'].includes(v)) return 'lastMonth';
  if (['year', 'this_year', '年度', '今年', '全年'].includes(v)) return 'year';
  return null;
}

function normalizeCardAction(value: unknown, text: string): NluSlots['cardAction'] {
  const v = String(value ?? '').toLowerCase();
  if (v) {
    if (['list', 'query'].includes(v)) return 'list';
    if (['apply_virtual', 'applyvirtual', 'virtual'].includes(v)) return 'apply_virtual';
    if (['adjust_limit', 'adjustlimit', 'limit'].includes(v)) return 'adjust_limit';
    if (['report_loss', 'reportloss', 'loss', '挂失'].includes(v)) return 'report_loss';
    if (['freeze', '冻结'].includes(v)) return 'freeze';
    if (['unfreeze', '解冻', '解挂'].includes(v)) return 'unfreeze';
  }
  if (/挂失|丢了|丢失/.test(text)) return 'report_loss';
  if (/解冻|解挂/.test(text)) return 'unfreeze';
  if (/冻结|锁卡/.test(text)) return 'freeze';
  if (/虚拟卡/.test(text)) return 'apply_virtual';
  if (/额度|调额/.test(text)) return 'adjust_limit';
  return null;
}

function normalizeRisk(value: unknown): NluSlots['riskLevel'] {
  const match = String(value ?? '').toUpperCase().match(/R[1-5]/);
  return (match?.[0] as NluSlots['riskLevel']) ?? null;
}

function normalizeBirthday(value: unknown): string | null {
  const text = String(value ?? '');
  const iso = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${String(Number(iso[2])).padStart(2, '0')}-${String(Number(iso[3])).padStart(2, '0')}`;
  const md = text.match(/(\d{1,2})[-月/](\d{1,2})/);
  if (md) return `${String(Number(md[1])).padStart(2, '0')}-${String(Number(md[2])).padStart(2, '0')}`;
  return null;
}

function normalizeDate(value: unknown): string | null {
  const text = String(value ?? '');
  const full = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (full) {
    return `${full[1]}-${String(Number(full[2])).padStart(2, '0')}-${String(Number(full[3])).padStart(2, '0')}`;
  }
  return null;
}

function normalizeQuery(value: unknown, text: string): NluSlots['query'] {
  const v = String(value ?? '').toLowerCase();
  if (['transactions', 'records', '流水'].includes(v)) return 'transactions';
  if (['balance', '余额'].includes(v)) return 'balance';
  if (['schedules', 'plans', '计划'].includes(v)) return 'schedules';
  if (['cancel_schedule', 'cancelschedule'].includes(v)) return 'cancel_schedule';
  if (/取消|撤销|停掉/.test(text) && /计划|定时|预约|待办/.test(text)) return 'cancel_schedule';
  if (/计划|待办|定时任务|安排|到点/.test(text)) return 'schedules';
  if (/余额|多少钱|资产|存款/.test(text)) return 'balance';
  if (/流水|交易记录|明细/.test(text)) return 'transactions';
  return null;
}

function normalizeTxnAction(value: unknown, text: string): NluSlots['txnAction'] {
  const v = String(value ?? '').toLowerCase();
  if (['detail', 'details', '详情'].includes(v)) return 'detail';
  if (['dispute', 'chargeback', '申诉', '拒付'].includes(v)) return 'dispute';
  if (/申诉|拒付|争议|不是本人|没收到|未收到|重复扣|乱扣|退这笔/.test(text)) return 'dispute';
  if (/这笔|哪笔|详情|明细|怎么扣的|什么时间|付款方式/.test(text)) return 'detail';
  return null;
}

function normalizeDisputeReason(value: unknown, text: string): NluSlots['disputeReason'] {
  const v = String(value ?? '').toLowerCase();
  const known = ['duplicate', 'unauthorized', 'not_received', 'amount_wrong', 'other'];
  if (known.includes(v)) return v as NluSlots['disputeReason'];
  if (/重复|两笔|又扣/.test(text)) return 'duplicate';
  if (/不是本人|没签|盗|冒用| unauthorized/.test(text)) return 'unauthorized';
  if (/没收到|未收到|没到货|服务没/.test(text)) return 'not_received';
  if (/金额不对|多收|少退|价格不符/.test(text)) return 'amount_wrong';
  return null;
}

function normalizeTxnHint(value: unknown, text: string): NluSlots['txnHint'] {
  const direct = asString(value);
  if (direct) return direct.slice(0, 24);
  const merchant = text.match(/(?:星巴克|瑞幸|manner|滴滴|地铁|移动|联通|电信|山姆|京东|淘宝|美团|饿了么|盒马|网易云|爱奇艺|腾讯视频|keep|大麦|影院|酒吧|齿科)[^，。？]*/i);
  if (merchant) return merchant[0].slice(0, 24);
  return null;
}

function normalizeScheduleHint(value: unknown, text: string): NluSlots['scheduleHint'] {
  const direct = asString(value);
  if (direct) return direct.slice(0, 24);
  const match = text.match(/(?:房租|房贷|话费|会员|订阅|工资|转账|鲜花|蛋糕|生日|还款)/);
  return match ? match[0] : null;
}

function normalizeWealthAction(value: unknown, text: string): NluSlots['wealthAction'] {
  const v = String(value ?? '').toLowerCase();
  if (['purchase', 'buy', '申购'].includes(v)) return 'purchase';
  if (['redeem', 'sell', '赎回'].includes(v)) return 'redeem';
  if (['holdings', 'position', '持仓'].includes(v)) return 'holdings';
  if (['query', 'recommend', '推荐'].includes(v)) return 'query';
  if (/赎回|卖出|取回/.test(text)) return 'redeem';
  if (/申购|买入|下单|买/.test(text)) return 'purchase';
  if (/持仓|浮盈|浮亏|赚了多?少|收益如何|我买的理财|买过的理财/.test(text)) return 'holdings';
  return 'query';
}

export class NluParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NluParseError';
  }
}

export function stripJson(content: string): string {
  let text = content.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new NluParseError('未找到 JSON 对象');
  return text.slice(start, end + 1);
}

export function parseNluContent(content: string, input: { text: string; source: NluSource }): NluResult {
  let raw: unknown;
  try {
    raw = JSON.parse(stripJson(content));
  } catch (error) {
    throw new NluParseError(error instanceof Error ? error.message : 'JSON 解析失败');
  }
  const parsed = RawNluSchema.safeParse(raw);
  if (!parsed.success) throw new NluParseError(parsed.error.message);
  const data = parsed.data;
  const text = input.text;
  const intent = INTENTS.includes(data.intent as Intent) ? (data.intent as Intent) : 'unknown';
  const slotsRaw = (data.slots ?? {}) as Record<string, unknown>;
  const amount = asNumber(slotsRaw.amount);
  const slots: NluSlots = {
    amount: amount !== undefined && amount > 0 ? amount : null,
    payee: asString(slotsRaw.payee) ?? null,
    phone: asString(slotsRaw.phone)?.replace(/\D/g, '') ?? null,
    note: asString(slotsRaw.note) ?? null,
    period: normalizePeriod(slotsRaw.period),
    category: asString(slotsRaw.category) ?? null,
    productName: asString(slotsRaw.productName) ?? null,
    riskLevel: normalizeRisk(slotsRaw.riskLevel),
    cardAction: normalizeCardAction(slotsRaw.cardAction, text),
    cardLast4: asString(slotsRaw.cardLast4)?.match(/\d{4}/)?.[0] ?? null,
    limitAmount: asNumber(slotsRaw.limitAmount) ?? null,
    subscriptionName: asString(slotsRaw.subscriptionName) ?? null,
    birthdayDate: normalizeBirthday(slotsRaw.birthdayDate),
    budget: asNumber(slotsRaw.budget) ?? null,
    query: normalizeQuery(slotsRaw.query, text),
    isScheduled: typeof slotsRaw.isScheduled === 'boolean' ? slotsRaw.isScheduled : /定时|预约|每月/.test(text),
    scheduleDate: normalizeDate(slotsRaw.scheduleDate),
    splitNames: Array.isArray(slotsRaw.splitNames)
      ? slotsRaw.splitNames.map((n) => String(n).trim()).filter(Boolean).slice(0, 6)
      : null,
    splitTotal: asNumber(slotsRaw.splitTotal) ?? null,
    wealthAction: normalizeWealthAction(slotsRaw.wealthAction, text),
    txnAction: normalizeTxnAction(slotsRaw.txnAction, text),
    txnHint: normalizeTxnHint(slotsRaw.txnHint, text),
    disputeReason: normalizeDisputeReason(slotsRaw.disputeReason, text),
    scheduleHint: normalizeScheduleHint(slotsRaw.scheduleHint, text),
  };

  // 按意图清理无关槽位，避免控制台与提示词上下文被“空槽位噪声”污染
  if (intent !== 'transfer') {
    slots.payee = null;
    slots.phone = null;
    slots.note = null;
    slots.isScheduled = null;
    slots.scheduleDate = null;
    slots.splitNames = null;
    slots.splitTotal = null;
  }
  if (intent !== 'wealth') {
    slots.productName = null;
    slots.riskLevel = null;
    slots.wealthAction = null;
  }
  if (intent !== 'card') {
    slots.cardAction = null;
    slots.cardLast4 = null;
    slots.limitAmount = null;
  }
  if (intent !== 'subscription') slots.subscriptionName = null;
  if (intent !== 'crossscene') {
    slots.birthdayDate = null;
    slots.budget = null;
  }
  if (intent !== 'account') slots.query = null;
  if (intent === 'transfer') {
    if (!/AA|aa|分摊|拆分|收款/.test(text)) {
      slots.splitNames = null;
      slots.splitTotal = null;
    }
    if (!/定时|预约|每月|明天|后天|下周|周[一二三四五六日]/.test(text)) {
      slots.isScheduled = false;
    }
  }
  if (!['bills', 'account'].includes(intent)) {
    slots.period = null;
    slots.category = null;
  }
  if (!['transfer', 'wealth', 'card', 'crossscene'].includes(intent)) {
    slots.amount = null;
  }

  let ambiguity: NluResult['ambiguity'] = null;
  if (data.ambiguity && typeof data.ambiguity === 'object') {
    const amb = data.ambiguity as any;
    if (amb.slot && Array.isArray(amb.options)) {
      ambiguity = {
        slot: String(amb.slot),
        prompt: String(amb.prompt ?? '需要确认'),
        options: amb.options
          .filter((o: any) => o && o.label)
          .map((o: any) => ({ label: String(o.label), value: String(o.value ?? o.label) })),
      };
    }
  }

  return {
    intent,
    confidence: Math.max(0, Math.min(1, Number(data.confidence ?? 0.5))),
    slots,
    utterance: text,
    ambiguity,
    needsClarification: Boolean(data.needsClarification),
    clarification: null,
    injectionSuspicion: Math.max(0, Math.min(1, Number(data.injectionSuspicion ?? 0))),
    references: Array.isArray(data.references) ? data.references.map(String).slice(0, 5) : [],
    rationale: data.rationale,
    source: input.source,
  };
}

export function emptySlots(): NluSlots {
  return {
    amount: null,
    payee: null,
    phone: null,
    note: null,
    period: null,
    category: null,
    productName: null,
    riskLevel: null,
    cardAction: null,
    cardLast4: null,
    limitAmount: null,
    subscriptionName: null,
    birthdayDate: null,
    budget: null,
    query: null,
    isScheduled: null,
    scheduleDate: null,
    splitNames: null,
    splitTotal: null,
    wealthAction: null,
    txnAction: null,
    txnHint: null,
    disputeReason: null,
    scheduleHint: null,
  };
}
