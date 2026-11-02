import type {
  BankCard,
  Contact,
  Holding,
  Subscription,
  Txn,
  UserProfile,
  WealthProduct,
} from '@bank/shared';
import { maxProductRiskForLevel, productRiskRank, riskAssessmentExpired } from '@bank/shared';
import { clock } from '../core/clock';
import { availableCents, findAccount, primaryAccount, type BankState } from '../core/state';

const TZ = 'Asia/Shanghai';

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** 统一把银行核心 / 本地账本的错误映射成工具错误，避免把内部堆栈透给模型。 */
export function toToolError(
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
): { code: string; message: string } {
  const candidate = error as { code?: unknown; message?: unknown };
  const code =
    typeof candidate?.code === 'string' && candidate.code.trim()
      ? candidate.code
      : fallbackCode;
  const message =
    typeof candidate?.message === 'string' && candidate.message.trim()
      ? candidate.message
      : fallbackMessage;
  return { code, message };
}

export function zonedParts(date: Date): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
  };
}

function shanghaiIso(y: number, m: number, d: number, h = 0, min = 0, sec = 0): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${y}-${p(m)}-${p(d)}T${p(h)}:${p(min)}:${p(sec)}+08:00`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export interface PeriodRange {
  period: 'currentMonth' | 'lastMonth' | 'year';
  label: string;
  start: string;
  end: string;
  prevLabel: string;
  prevStart: string;
  prevEnd: string;
}

export function periodRange(period: PeriodRange['period'] = 'currentMonth'): PeriodRange {
  const now = clock.now();
  const { year, month, day } = zonedParts(now);
  if (period === 'year') {
    const start = shanghaiIso(year, 1, 1, 0, 0, 0);
    const end = now.toISOString();
    return {
      period,
      label: `${year} 年至今`,
      start,
      end,
      prevLabel: `${year - 1} 年同期`,
      prevStart: shanghaiIso(year - 1, 1, 1, 0, 0, 0),
      prevEnd: new Date(now.getTime() - 365 * 86_400_000).toISOString(),
    };
  }
  const targetYear = period === 'lastMonth' ? (month === 1 ? year - 1 : year) : year;
  const targetMonth = period === 'lastMonth' ? (month === 1 ? 12 : month - 1) : month;
  const prevYear = targetMonth === 1 ? targetYear - 1 : targetYear;
  const prevMonth = targetMonth === 1 ? 12 : targetMonth - 1;
  const isCurrent = period === 'currentMonth';
  const endDay = isCurrent ? day : daysInMonth(targetYear, targetMonth);
  const prevEndDay = Math.min(endDay, daysInMonth(prevYear, prevMonth));
  const monthLabel = `${targetYear} 年 ${targetMonth} 月`;
  const prevMonthLabel = `${prevYear} 年 ${prevMonth} 月`;
  return {
    period,
    label: isCurrent ? `${monthLabel}（截至 ${day} 日）` : monthLabel,
    start: shanghaiIso(targetYear, targetMonth, 1),
    end: isCurrent ? now.toISOString() : shanghaiIso(targetYear, targetMonth, endDay, 23, 59, 59),
    prevLabel: `${prevMonthLabel}同期`,
    prevStart: shanghaiIso(prevYear, prevMonth, 1),
    prevEnd: shanghaiIso(prevYear, prevMonth, prevEndDay, 23, 59, 59),
  };
}

export function inRange(txn: Txn, start: string, end: string): boolean {
  const t = new Date(txn.ts).getTime();
  return t >= new Date(start).getTime() && t <= new Date(end).getTime();
}

export function periodTxns(state: BankState, range: PeriodRange): Txn[] {
  const accountIds = new Set(state.accounts.filter((a) => a.type !== 'credit').map((a) => a.id));
  return state.transactions
    .filter((t) => accountIds.has(t.accountId) && inRange(t, range.start, range.end))
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
}

export function isLivingExpense(txn: Txn): boolean {
  return txn.amountCents < 0 && txn.category !== '投资理财' && txn.category !== '转账';
}

export function sumCents(txns: Txn[], predicate: (t: Txn) => boolean): number {
  return txns.filter(predicate).reduce((sum, t) => sum + Math.abs(t.amountCents), 0);
}

export function resolveContact(
  state: BankState,
  input: { contactId?: string; name?: string; phone?: string },
): { contact?: Contact; matches: Contact[] } {
  const contacts = state.user.contacts;
  if (input.contactId) {
    const contact = contacts.find((c) => c.id === input.contactId);
    return { contact, matches: contact ? [contact] : [] };
  }
  if (input.phone) {
    const digits = input.phone.replace(/\D/g, '');
    const masked = `${digits.slice(0, 3)}****${digits.slice(-4)}`;
    const matches = contacts.filter((c) => c.phoneMasked === masked || c.phoneMasked === input.phone);
    return { contact: matches.length === 1 ? matches[0] : undefined, matches };
  }
  if (input.name) {
    const matches = contacts.filter((c) => c.name === input.name || c.name.includes(input.name!));
    return { contact: matches.length === 1 ? matches[0] : undefined, matches };
  }
  return { matches: [] };
}

export function defaultCard(state: BankState, last4?: string): BankCard | undefined {
  if (last4) return state.cards.find((c) => c.last4 === last4 && c.status !== 'cancelled');
  return (
    state.cards.find((c) => c.type === 'credit' && c.status !== 'cancelled') ??
    state.cards.find((c) => c.type === 'debit' && c.status !== 'cancelled')
  );
}

export function resolveProduct(
  state: BankState,
  input: { productId?: string; productName?: string; riskLevel?: string },
): WealthProduct | undefined {
  if (input.productId) return state.products.find((p) => p.id === input.productId);
  if (input.productName) {
    const name = input.productName.replace(/\s+/g, '');
    return state.products.find(
      (p) => p.name.replace(/\s+/g, '').includes(name) || name.includes(p.name.replace(/\s+/g, '')),
    );
  }
  if (input.riskLevel) {
    return state.products
      .filter((p) => p.riskLevel === input.riskLevel)
      .sort((a, b) => b.yieldPct - a.yieldPct)[0];
  }
  return undefined;
}

export function productWithUserFit(product: WealthProduct, userLevel: string): number {
  const fit: Record<string, Record<string, number>> = {
    保守型: { R1: 96, R2: 72, R3: 40, R4: 15, R5: 5 },
    稳健型: { R1: 78, R2: 96, R3: 66, R4: 28, R5: 10 },
    平衡型: { R1: 58, R2: 82, R3: 92, R4: 52, R5: 22 },
    成长型: { R1: 40, R2: 68, R3: 88, R4: 74, R5: 40 },
    进取型: { R1: 28, R2: 52, R3: 76, R4: 92, R5: 68 },
  };
  return fit[userLevel]?.[product.riskLevel] ?? 60;
}

/**
 * 适当性管理：可购买的产品风险等级由风险测评结果决定，
 * 测评过期（默认 1 年）后一律先要求重测，不做静默放行。
 */
export interface SuitabilityContext {
  level: UserProfile['riskProfile']['level'];
  score: number;
  assessedAt: string;
  maxProductRisk: 'R1' | 'R2' | 'R3' | 'R4' | 'R5';
  expired: boolean;
}

export function suitabilityFor(state: BankState): SuitabilityContext {
  const profile = state.user.riskProfile;
  return {
    level: profile.level,
    score: profile.score,
    assessedAt: profile.assessedAt,
    maxProductRisk: maxProductRiskForLevel(profile.level),
    expired: riskAssessmentExpired(profile.assessedAt, clock.nowIso()),
  };
}

export function productAllowed(suitability: SuitabilityContext, product: WealthProduct): boolean {
  if (suitability.expired) return false;
  return (
    productRiskRank(product.riskLevel) <= productRiskRank(suitability.maxProductRisk)
  );
}

export function suitabilityError(suitability: SuitabilityContext): {
  code: string;
  message: string;
} {
  if (suitability.expired) {
    return {
      code: 'RISK_ASSESSMENT_EXPIRED',
      message: '风险测评已超过有效期，请在「我的 · 风险测评」重新完成后再购买理财',
    };
  }
  return {
    code: 'RISK_SUITABILITY_REQUIRED',
    message: `您的风险测评为${suitability.level}（${suitability.score} 分），最多可购买 ${suitability.maxProductRisk} 产品；如需更高风险等级请先重做测评`,
  };
}

export function resolveHolding(
  state: BankState,
  input: { productId?: string; productName?: string },
): { holding?: Holding; product?: WealthProduct } {
  const product = resolveProduct(state, input);
  const active = state.holdings.filter((h) => h.status === 'holding');
  if (product) {
    return {
      holding: active.find((h) => h.productId === product.id),
      product,
    };
  }
  const largest = [...active].sort((a, b) => b.amountCents - a.amountCents)[0];
  return {
    holding: largest,
    product: largest ? state.products.find((p) => p.id === largest.productId) : undefined,
  };
}

export function resolveSubscription(
  state: BankState,
  name?: string,
): { subscription?: Subscription; matches: Subscription[] } {
  if (!name) return { matches: state.subscriptions.filter((s) => s.status === 'active') };
  const needle = name.replace(/\s+/g, '');
  const matches = state.subscriptions.filter((s) => {
    const merchant = s.merchant.replace(/\s+/g, '');
    return merchant.includes(needle) || needle.includes(merchant) || merchant.includes(needle.replace(/会员|自动续费|订阅/g, ''));
  });
  return { subscription: matches.length === 1 ? matches[0] : undefined, matches };
}

export function accountSnapshot(state: BankState, accountId?: string) {
  const account = findAccount(state, accountId) ?? primaryAccount(state);
  return {
    id: account.id,
    name: account.name,
    bank: account.bank,
    last4: account.last4,
    balanceCents: account.balanceCents,
    lockedCents: account.lockedCents,
    availableCents: availableCents(account),
  };
}

export function nextBirthday(monthDay: string): {
  birthdayIso: string;
  birthdayLabel: string;
  daysUntil: number;
  tMinus2Label: string;
  tMinus2Iso: string;
  tMinus1Label: string;
  tMinus1Iso: string;
} {
  const [mm, dd] = monthDay.split('-').map(Number);
  const now = clock.now();
  const y = zonedParts(now).year;
  let birthday = new Date(`${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}T10:00:00+08:00`);
  if (birthday.getTime() < now.getTime() - 86_400_000) {
    birthday = new Date(
      `${y + 1}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}T10:00:00+08:00`,
    );
  }
  const daysUntil = Math.max(0, Math.ceil((birthday.getTime() - now.getTime()) / 86_400_000));
  const tMinus2 = new Date(birthday.getTime() - 2 * 86_400_000);
  const tMinus1 = new Date(birthday.getTime() - 1 * 86_400_000);
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat('zh-CN', {
      timeZone: TZ,
      month: 'long',
      day: 'numeric',
    }).format(d);
  return {
    birthdayIso: birthday.toISOString(),
    birthdayLabel: fmt(birthday),
    daysUntil,
    tMinus2Label: fmt(tMinus2),
    tMinus2Iso: tMinus2.toISOString(),
    tMinus1Label: fmt(tMinus1),
    tMinus1Iso: tMinus1.toISOString(),
  };
}
