import type { ContextStack, Intent, NluResult, NluSlots, NluSource, UserProfile } from '@bank/shared';
import { clock } from '../core/clock';
import type { BankState } from '../core/state';
import { emptySlots } from './schema';

const CN_DIGITS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};
const CN_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

function parseChineseNumber(chars: string): number | undefined {
  let total = 0;
  let section = 0;
  let number = 0;
  let seen = false;
  for (const ch of chars) {
    if (ch in CN_DIGITS) {
      number = CN_DIGITS[ch]!;
      seen = true;
    } else if (ch in CN_UNITS) {
      section += (number || 1) * CN_UNITS[ch]!;
      number = 0;
      seen = true;
    } else if (ch === '万') {
      total += (section + number) * 10_000;
      section = 0;
      number = 0;
      seen = true;
    } else {
      return undefined;
    }
  }
  return seen ? total + section + number : undefined;
}

export function extractAmount(text: string, intent: Intent): number | undefined {
  const cleaned = text.replace(/,/g, '').replace(/¥|￥/g, '');
  const patterns: RegExp[] = [];
  if (intent === 'transfer') {
    patterns.push(
      /(?:转|转给|打给|打款|汇款|金额|还|给[^，。]{0,8}?转)\s*(?:人民币)?\s*(\d+(?:\.\d+)?)\s*(万|千)?/,
      /(\d+(?:\.\d+)?)\s*(?:元|块)/,
    );
  } else if (intent === 'wealth') {
    patterns.push(
      /(?:申购|买|买入|投|放|闲钱|金额|理财)\s*(?:人民币)?\s*(\d+(?:\.\d+)?)\s*(万|千)?/,
      /(\d+(?:\.\d+)?)\s*(?:元|块|万)/,
    );
  } else if (intent === 'card') {
    patterns.push(
      /(?:额度|限额|调到|提到|调整到)\s*(?:人民币)?\s*(\d+(?:\.\d+)?)\s*(万|千)?/,
      /(\d+(?:\.\d+)?)\s*(?:元|块|万)/,
    );
  } else if (intent === 'crossscene') {
    patterns.push(
      /(?:锁定|预算|准备|花|留)\s*(?:人民币)?\s*(\d+(?:\.\d+)?)\s*(万|千)?/,
      /(\d+(?:\.\d+)?)\s*(?:元|块|万)/,
    );
  } else {
    patterns.push(/(\d+(?:\.\d+)?)\s*(?:元|块|万)/);
  }

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (!match) continue;
    const index = match.index ?? 0;
    const after = cleaned.slice(index + match[0].length, index + match[0].length + 1);
    if (/[月日号年]/.test(after)) continue;
    const base = Number(match[1]);
    if (!Number.isFinite(base)) continue;
    const unit = match[2] === '万' ? 10_000 : match[2] === '千' ? 1_000 : 1;
    const value = base * unit;
    if (value > 0) return value;
  }

  const chineseUnit = cleaned.match(/([零一二两三四五六七八九十百千万]{1,8})\s*(万|千)/);
  if (chineseUnit) {
    const value = parseChineseNumber(chineseUnit[1]!);
    if (value && value > 0) {
      return value * (chineseUnit[2] === '万' ? 10_000 : 1_000);
    }
  }

  const chinese = cleaned.match(/([零一二两三四五六七八九十百千万]{1,8})\s*(?:元|块)/);
  if (chinese) {
    const value = parseChineseNumber(chinese[1]!);
    if (value && value > 0) return value;
  }
  return undefined;
}

function detectIntent(text: string): Intent {
  if (/账单|花了|消费|支出|开销|异常交易|异常消费|月报|年报|咖啡.*(多少|花)|外卖.*(多少|花)/.test(text)) {
    return 'bills';
  }
  if (/生日|纪念日|鲜花|蛋糕/.test(text)) return 'crossscene';
  if (/转账|转给|转\s*\d|给[^，。]{0,10}(转|打钱|汇款)|打款|汇款|AA|aa|分摊|收款|还钱|红包/.test(text)) {
    return 'transfer';
  }
  if (/理财|基金|申购|赎回|收益|稳健|风险测评|投资|闲钱|产品/.test(text)) return 'wealth';
  if (/虚拟卡|挂失|解冻|解挂|冻结|锁卡|额度|调额|卡片|银行卡|信用卡/.test(text)) return 'card';
  if (/订阅|续费|代扣|自动扣费|会员|取消.*(视频|音乐|网盘|健身)/.test(text)) return 'subscription';
  if (/余额|多少钱|账户|流水|交易记录|资产|存款/.test(text)) return 'account';
  if (/你好|您好|hi|hello|谢谢|再见|你是谁|能做什么|怎么用/i.test(text)) return 'chitchat';
  return 'unknown';
}

function extractPayee(text: string, user: UserProfile, state: BankState): string | undefined {
  if (/爱人|老婆|太太|配偶|先生|老公/.test(text) && /转|打|给/.test(text)) {
    return user.spouse.name;
  }
  const patterns = [
    /(?:给|向|帮)\s*([\u4e00-\u9fa5A-Za-z·]{2,6})\s*(?:转|打|发|还|付|汇)/,
    /转给\s*([\u4e00-\u9fa5A-Za-z·]{2,6})/,
    /(?:收款人|对方)[：:]\s*([\u4e00-\u9fa5]{2,6})/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const name = match[1].replace(/^(我的|我|给|向)/, '');
      if (!['银行卡', '账户', '信用卡', '理财', '余额'].includes(name) && name.length >= 2) return name;
    }
  }
  const mentioned = user.contacts.filter((c) => text.includes(c.name));
  const uniqueNames = [...new Set(mentioned.map((c) => c.name))];
  if (uniqueNames.length === 1) return uniqueNames[0];
  if (user.contacts.some((c) => text.trim() === c.name)) return text.trim();
  return undefined;
}

function mapCategory(text: string): string | undefined {
  if (/咖啡|奶茶|茶饮/.test(text)) return '咖啡茶饮';
  if (/吃饭|餐饮|外卖|餐厅/.test(text)) return '餐饮';
  if (/购物|衣服|鞋|数码/.test(text)) return '购物';
  if (/交通|打车|地铁|出行/.test(text)) return '交通出行';
  if (/订阅|会员|续费/.test(text)) return '订阅服务';
  if (/旅行|机票|酒店/.test(text)) return '旅行';
  if (/医疗|看病|牙科/.test(text)) return '医疗健康';
  if (/娱乐|酒吧|电影|演出/.test(text)) return '休闲娱乐';
  return undefined;
}

function mapSubscription(text: string, state: BankState): string | undefined {
  const exact = state.subscriptions.find((s) => text.includes(s.merchant));
  if (exact) return exact.merchant;
  const rules: Array<[RegExp, string]> = [
    [/健身|运动/, '悦动健身'],
    [/视频|星幕/, '星幕视频'],
    [/网盘|云盘/, '云端网盘'],
    [/音乐|声浪/, '声浪音乐'],
  ];
  for (const [pattern, name] of rules) {
    if (pattern.test(text)) return name;
  }
  return undefined;
}

function mapProduct(text: string, state: BankState): string | undefined {
  const exact = state.products.find((p) => text.includes(p.name));
  if (exact) return exact.name;
  const rules: Array<[RegExp, string]> = [
    [/现金宝/, '现金宝'],
    [/稳健\s*180|招银稳健/, '招银稳健 180 天'],
    [/瑞信|增强收益/, '瑞信增强收益 90 天'],
    [/臻选|均衡/, '臻选均衡混合'],
    [/环宇|QDII|科技/, '环宇科技 QDII'],
  ];
  for (const [pattern, name] of rules) {
    if (pattern.test(text)) return name;
  }
  return undefined;
}

function extractNote(text: string): string | undefined {
  const match = text.match(/(?:备注|附言|写着)[：:\s]*([^，。；;\n]{1,30})/);
  return match?.[1]?.trim();
}

function extractBirthday(text: string): string | undefined {
  const match = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/);
  if (match) return `${String(Number(match[1])).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}`;
  const dash = text.match(/(\d{1,2})-(\d{1,2})/);
  if (dash) return `${String(Number(dash[1])).padStart(2, '0')}-${String(Number(dash[2])).padStart(2, '0')}`;
  return undefined;
}

function tomorrowDate(): string {
  const d = new Date(clock.now().getTime() + 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function parseWithRules(
  text: string,
  input: { context: ContextStack; user: UserProfile; state: BankState; source?: NluSource },
): NluResult {
  const intent = detectIntent(text);
  const slots: NluSlots = emptySlots();
  const amount = extractAmount(text, intent);
  const references: string[] = [];
  const shortMemory = /再|就那个|还是|刚才|上次|老样子/.test(text);

  if (intent === 'transfer') {
    slots.amount = amount ?? null;
    const payee = extractPayee(text, input.user, input.state);
    slots.payee = payee ?? null;
    slots.phone = text.match(/1[3-9]\d{9}/)?.[0] ?? null;
    slots.note = extractNote(text) ?? null;
    slots.isScheduled = /定时|预约|每月|明天|后天|下周|下个?月\d+[日号]/.test(text);
    if (/明天/.test(text)) slots.scheduleDate = tomorrowDate();
    if (/AA|aa|分摊|收款/.test(text)) {
      const names = [...new Set(input.user.contacts.filter((c) => text.includes(c.name)).map((c) => c.name))];
      slots.splitNames = names.length ? names : null;
      slots.splitTotal = amount ?? null;
    }
    if (!slots.payee && shortMemory && input.context.lastPayee) references.push('lastPayee');
  }

  if (intent === 'bills') {
    if (/上个月|上月/.test(text)) slots.period = 'lastMonth';
    else if (/今年|年度|全年|年报/.test(text)) slots.period = 'year';
    else if (/本月|这个月|当月/.test(text)) slots.period = 'currentMonth';
    slots.category = mapCategory(text) ?? null;
  }

  if (intent === 'wealth') {
    slots.amount = amount ?? null;
    slots.productName = mapProduct(text, input.state) ?? null;
    slots.riskLevel = (text.toUpperCase().match(/R[1-5]/)?.[0] as NluSlots['riskLevel']) ?? null;
    slots.wealthAction = /赎回|卖出|取回/.test(text)
      ? 'redeem'
      : /申购|买入|下单|买/.test(text)
        ? 'purchase'
        : 'query';
  }

  if (intent === 'card') {
    if (/挂失|丢了|丢失/.test(text)) slots.cardAction = 'report_loss';
    else if (/解冻|解挂/.test(text)) slots.cardAction = 'unfreeze';
    else if (/冻结|锁卡/.test(text)) slots.cardAction = 'freeze';
    else if (/虚拟卡/.test(text)) slots.cardAction = 'apply_virtual';
    else if (/额度|调额|提到|调整/.test(text)) slots.cardAction = 'adjust_limit';
    else slots.cardAction = 'list';
    slots.cardLast4 = text.match(/尾号\s*(\d{4})/)?.[1] ?? text.match(/(\d{4})\s*(?:的)?卡/)?.[1] ?? null;
    slots.limitAmount = amount ?? null;
  }

  if (intent === 'subscription') {
    slots.subscriptionName = mapSubscription(text, input.state) ?? null;
  }

  if (intent === 'crossscene') {
    slots.birthdayDate = extractBirthday(text) ?? null;
    slots.budget = amount ?? (/(?:锁定|预算)[^0-9零一二两三四五六七八九十百千万]*([零一二两三四五六七八九十百千万]{1,8})/.test(text) ? 1000 : null);
    if (/爱人|老婆|太太|配偶/.test(text)) {
      slots.birthdayDate = slots.birthdayDate ?? input.user.spouse.birthday.slice(5);
    }
  }

  if (intent === 'account') {
    slots.query = /流水|交易记录|明细/.test(text) ? 'transactions' : 'balance';
  }

  if (shortMemory && input.context.lastPayee && intent === 'transfer') references.push('lastPayee');

  const confidence =
    intent === 'unknown'
      ? 0.32
      : amount !== undefined || intent === 'account' || intent === 'card' || intent === 'bills'
        ? 0.84
        : 0.7;

  return {
    intent,
    confidence,
    slots,
    utterance: text,
    ambiguity: null,
    needsClarification: false,
    clarification: null,
    injectionSuspicion: 0,
    references: [...new Set(references)],
    rationale: '规则引擎解析（离线安全模式）',
    source: input.source ?? 'rules',
  };
}

export function mergeClarification(
  draft: NluResult,
  text: string,
  input: { context: ContextStack; user: UserProfile; state: BankState },
): NluResult {
  const amount = extractAmount(text, draft.intent);
  const rule = parseWithRules(text, { ...input, source: 'cache' });
  const slots: NluSlots = { ...draft.slots };
  if (amount !== undefined) {
    if (draft.intent === 'card') slots.limitAmount = amount;
    else if (draft.intent === 'crossscene') slots.budget = amount;
    else slots.amount = amount;
  }
  const payee = extractPayee(text, input.user, input.state);
  if (payee) slots.payee = payee;
  if (rule.slots.phone) slots.phone = rule.slots.phone;
  if (rule.slots.note) slots.note = rule.slots.note;
  if (rule.slots.cardLast4) slots.cardLast4 = rule.slots.cardLast4;
  if (rule.slots.subscriptionName) slots.subscriptionName = rule.slots.subscriptionName;
  if (rule.slots.birthdayDate) slots.birthdayDate = rule.slots.birthdayDate;
  if (rule.slots.category) slots.category = rule.slots.category;
  if (rule.slots.period) slots.period = rule.slots.period;
  if (rule.slots.splitNames) slots.splitNames = rule.slots.splitNames;
  if (rule.slots.wealthAction && rule.slots.wealthAction !== 'query') slots.wealthAction = rule.slots.wealthAction;
  if (rule.slots.productName) slots.productName = rule.slots.productName;
  return {
    ...draft,
    slots,
    utterance: text,
    confidence: 0.8,
    source: 'cache',
    rationale: '结合上轮澄清补充槽位',
  };
}
