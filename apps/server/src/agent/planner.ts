import {
  BUSINESS_TEMPLATES,
  selectTemplate,
  formatMoney,
  type Card,
  type ClarifyOption,
  type Contact,
  type ContextStack,
  type Dag,
  type DagNode,
  type Intent,
  type NluResult,
  type Risk,
  type ToolName,
} from '@bank/shared';
import { clock } from '../core/clock';
import type { BankState } from '../core/state';
import { availableCents, primaryAccount } from '../core/state';
import { nextBirthday, resolveContact } from '../tools/helpers';
import { toolMeta } from '../tools/registry';

export type PlanOutcome =
  | { kind: 'plan'; dag: Dag }
  | {
      kind: 'clarify';
      text: string;
      card: Card;
      slot?: string;
      options?: ClarifyOption[];
    }
  | { kind: 'reply'; text: string; card?: Card };

interface NodeSpec {
  tool: ToolName;
  label: string;
  args: Record<string, unknown>;
  deps: string[];
  risk?: Risk;
}

function makeDag(
  runId: string,
  intent: Intent,
  title: string,
  summary: string,
  specs: NodeSpec[],
): Dag {
  const nodes: DagNode[] = specs.map((spec, index) => {
    const meta = toolMeta(spec.tool);
    return {
      id: `n${index + 1}`,
      tool: spec.tool,
      label: spec.label,
      args: spec.args,
      deps: spec.deps,
      risk: spec.risk ?? meta.baseRisk,
      reversible: meta.reversible,
      status: 'PENDING',
      attempts: 0,
      compensator: meta.compensator,
    };
  });
  return { runId, intent, title, summary, nodes, createdAt: clock.nowIso() };
}

function clarify(
  text: string,
  slot: string | undefined,
  options: ClarifyOption[] | undefined,
  title = '需要补充一点信息',
): PlanOutcome {
  return {
    kind: 'clarify',
    text,
    slot,
    options,
    card: {
      type: 'clarify',
      title,
      prompt: text,
      options: options ?? [],
    },
  };
}

function toCents(yuan: number | null | undefined): number | undefined {
  if (yuan === null || yuan === undefined || Number.isNaN(Number(yuan))) return undefined;
  const cents = Math.round(Number(yuan) * 100);
  return cents > 0 ? cents : undefined;
}

function periodFrom(nlu: NluResult): 'currentMonth' | 'lastMonth' | 'year' {
  return nlu.slots.period ?? 'currentMonth';
}

function contactOption(contactId: string, name: string, bank: string, last4: string, relation: string): ClarifyOption {
  return {
    label: `${name} · ${bank} 尾号${last4}（${relation}）`,
    value: contactId,
    hint: bank,
  };
}

function contactOptions(state: BankState, contacts = state.user.contacts): ClarifyOption[] {
  return contacts.slice(0, 5).map((c) => contactOption(c.id, c.name, c.bank, c.last4, c.relation));
}

function resolvePayee(
  state: BankState,
  nlu: NluResult,
  context: ContextStack,
): { contact?: Contact; matches: Contact[] } {
  const slots = nlu.slots;
  if (slots.contactId) {
    const contact = state.user.contacts.find((c) => c.id === slots.contactId);
    return { contact, matches: contact ? [contact] : [] };
  }
  if (slots.payee || slots.phone) {
    return resolveContact(state, { name: slots.payee ?? undefined, phone: slots.phone ?? undefined });
  }
  if (context.lastPayee) {
    const contact = state.user.contacts.find(
      (c) => c.name === context.lastPayee && (!context.lastPayeeBank || c.bank === context.lastPayeeBank),
    );
    if (contact) return { contact, matches: [contact] };
    return resolveContact(state, { name: context.lastPayee });
  }
  return { matches: [] };
}

function toShanghaiDate(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function planTransfer(state: BankState, nlu: NluResult, context: ContextStack, runId: string): PlanOutcome {
  const slots = nlu.slots;
  const text = nlu.utterance ?? nlu.rationale ?? '';
  const split =
    Boolean(slots.splitNames?.length) || /AA|aa|分摊|拆分|收款/.test(text) || /AA|aa|分摊|拆分/.test(JSON.stringify(slots));
  const scheduled =
    Boolean(slots.isScheduled) || /定时|预约|每月|下个月.*转/.test(text);

  if (split) {
    const names = slots.splitNames?.filter(Boolean) ?? [];
    const totalCents = toCents(slots.splitTotal) ?? toCents(slots.amount);
    if (!names.length) {
      return clarify('好的，AA 收款需要知道向谁发起。可以补充姓名，例如：向王磊、李萌各收 300 元。', 'splitNames', []);
    }
    if (!totalCents) {
      return clarify('这次一共消费多少？我来按人数拆分并发送收款请求。', 'splitTotal', [
        { label: '¥600', value: '600' },
        { label: '¥900', value: '900' },
        { label: '¥1,200', value: '1200' },
      ]);
    }
    const specs: NodeSpec[] = [
      {
        tool: 'split_request',
        label: `AA 收款 ${formatMoney(totalCents)}`,
        args: { names, totalCents, note: slots.note ?? undefined },
        deps: [],
      },
    ];
    return {
      kind: 'plan',
      dag: makeDag(
        runId,
        'transfer',
        `AA 收款 · ${names.join('、')}`,
        `按 ${names.length + 1} 人拆分 ${formatMoney(totalCents)}，向 ${names.join('、')} 发起收款`,
        specs,
      ),
    };
  }

  const { contact, matches } = resolvePayee(state, nlu, context);
  if (!contact) {
    if (matches.length > 1) {
      return clarify('有多个同名联系人，请选择具体收款人。', 'contactId', contactOptions(state, matches));
    }
    return clarify(
      slots.payee
        ? `没有找到「${slots.payee}」这个联系人，可以从常用联系人里选择。`
        : '要转给谁？可以从常用联系人里选择。',
      'contactId',
      contactOptions(state),
      '选择收款人',
    );
  }
  const shortMemory = /再|就那个|还是|老样子|上次|刚才/.test(nlu.utterance ?? '');
  const amountCents = toCents(slots.amount) ?? (shortMemory ? context.lastAmountCents : undefined);
  if (!amountCents) {
    return clarify(`收到，转给${contact.name}。请补充金额。`, 'amount', [
      { label: '¥200', value: '200' },
      { label: '¥520', value: '520' },
      { label: '¥1,000', value: '1000' },
    ]);
  }

  const account = primaryAccount(state);
  if (availableCents(account) < amountCents) {
    return {
      kind: 'reply',
      text: `本次转账 ${formatMoney(amountCents)} 超过${account.name}可用余额 ${formatMoney(availableCents(account))}，请调整金额或更换账户。`,
      card: { type: 'error', title: '可用余额不足', detail: `${account.name} 尾号 ${account.last4}` },
    };
  }

  if (scheduled) {
    const executeAt = slots.scheduleDate
      ? `${slots.scheduleDate}T09:00:00+08:00`
      : `${toShanghaiDate(new Date(clock.now().getTime() + 86_400_000).toISOString())}T09:00:00+08:00`;
    return {
      kind: 'plan',
      dag: makeDag(
        runId,
        'transfer',
        `定时转账 · ${contact.name}`,
        `${slots.scheduleDate ?? '明天'} 09:00 向 ${contact.name} 转账 ${formatMoney(amountCents)}`,
        [
          {
            tool: 'resolve_contact',
            label: `解析联系人 · ${contact.name}`,
            args: { contactId: contact.id, name: contact.name },
            deps: [],
          },
          {
            tool: 'schedule_transfer',
            label: `创建定时转账 ${formatMoney(amountCents)}`,
            args: {
              payee: contact.name,
              contactId: contact.id,
              amountCents,
              executeAt,
              note: slots.note ?? 'AI 管家定时转账',
            },
            deps: ['n1'],
          },
        ],
      ),
    };
  }

  const note = slots.note ?? undefined;
  return {
    kind: 'plan',
    dag: makeDag(
      runId,
      'transfer',
      `转账 ${formatMoney(amountCents)} · ${contact.name}`,
      `从${account.name}（尾号 ${account.last4}）转给 ${contact.name}（${contact.bank} 尾号 ${contact.last4}）`,
      [
        {
          tool: 'resolve_contact',
          label: `解析联系人 · ${contact.name}`,
          args: { contactId: contact.id, name: contact.name },
          deps: [],
        },
        {
          tool: 'check_limit',
          label: '校验当日额度',
          args: { amountCents },
          deps: [],
        },
        {
          tool: 'transfer',
          label: `转账 ${formatMoney(amountCents)} · ${contact.name}`,
          args: {
            fromAccountId: account.id,
            recipients: [
              {
                name: contact.name,
                amountCents,
                contactId: contact.id,
                bank: contact.bank,
                last4: contact.last4,
              },
            ],
            totalCents: amountCents,
            note,
          },
          deps: ['n1', 'n2'],
        },
      ],
    ),
  };
}

function planBills(state: BankState, nlu: NluResult, runId: string): PlanOutcome {
  const period = periodFrom(nlu);
  const category = nlu.slots.category ?? undefined;
  const periodLabel = period === 'lastMonth' ? '上个月' : period === 'year' ? '今年' : '本月';
  return {
    kind: 'plan',
    dag: makeDag(
      runId,
      'bills',
      `${periodLabel}账单分析`,
      category
        ? `读取流水、分类聚合、异常检测，并在沙箱中统计「${category}」消费`
        : '读取流水、分类聚合、异常检测，并由沙箱分析主要消费分类',
      [
        {
          tool: 'fetch_transactions',
          label: '读取交易流水',
          args: { period },
          deps: [],
        },
        {
          tool: 'aggregate_bills',
          label: '分类聚合与环比',
          args: {},
          deps: ['n1'],
        },
        {
          tool: 'detect_anomalies',
          label: '异常交易检测',
          args: {},
          deps: ['n1'],
        },
        {
          tool: 'sandbox_analyze',
          label: `沙箱分析 · ${category ?? '主要分类'}`,
          args: category ? { category } : {},
          deps: ['n1'],
        },
      ],
    ),
  };
}

function planWealth(state: BankState, nlu: NluResult, runId: string): PlanOutcome {
  const slots = nlu.slots;
  const text = nlu.utterance ?? nlu.rationale ?? '';
  const wantsBuy = /申购|买入|下单|购买|买|投一万|投点|配置/.test(text);
  const wantsRedeem = /赎回|卖出|取回/.test(text);
  const action = wantsRedeem ? 'redeem' : wantsBuy ? 'purchase' : 'query';
  const amountCents = toCents(slots.amount);
  const fromAccountId = primaryAccount(state).id;
  const matchArgs = {
    amountCents,
    productName: slots.productName ?? undefined,
    riskLevel: slots.riskLevel ?? undefined,
  };
  const specs: NodeSpec[] = [
    {
      tool: 'assess_risk',
      label: '读取风险测评',
      args: {},
      deps: [],
    },
    {
      tool: 'list_products',
      label: '读取在售产品',
      args: {},
      deps: ['n1'],
    },
    {
      tool: 'match_products',
      label: '匹配产品',
      args: matchArgs,
      deps: ['n2'],
    },
  ];

  if (action === 'purchase') {
    if (!amountCents) {
      return clarify('准备申购多少？请补充金额。', 'amount', [
        { label: '¥1,000', value: '1000' },
        { label: '¥5,000', value: '5000' },
        { label: '¥10,000', value: '10000' },
      ]);
    }
    specs.push({
      tool: 'purchase_wealth',
      label: `申购 ${slots.productName ?? '匹配产品'} ${formatMoney(amountCents)}`,
      args: {
        productName: slots.productName ?? undefined,
        riskLevel: slots.riskLevel ?? undefined,
        amountCents,
        fromAccountId,
      },
      deps: ['n3'],
    });
    return {
      kind: 'plan',
      dag: makeDag(
        runId,
        'wealth',
        `理财申购 ${formatMoney(amountCents)}`,
        `按${state.user.riskProfile.level}测评结果在适当性范围内匹配产品，确认后申购`,
        specs,
      ),
    };
  }

  if (action === 'redeem') {
    specs.push({
      tool: 'redeem_wealth',
      label: `赎回 ${slots.productName ?? '持仓'}`,
      args: {
        productName: slots.productName ?? undefined,
        amountCents: amountCents ?? undefined,
        toAccountId: fromAccountId,
      },
      deps: ['n3'],
    });
    return {
      kind: 'plan',
      dag: makeDag(runId, 'wealth', '理财赎回', '读取持仓并提交赎回申请，确认后进行强验证', specs),
    };
  }

  return {
    kind: 'plan',
    dag: makeDag(
      runId,
      'wealth',
      '理财推荐与对比',
      `读取风险评估，匹配 3 款产品并给出理由`,
      specs,
    ),
  };
}

function planCard(state: BankState, nlu: NluResult, runId: string): PlanOutcome {
  const slots = nlu.slots;
  const text = nlu.utterance ?? nlu.rationale ?? '';
  let action = slots.cardAction ?? 'list';
  if (!slots.cardAction) {
    if (/挂失|丢了|丢失/.test(text)) action = 'report_loss';
    else if (/解冻|解挂|恢复用卡/.test(text)) action = 'unfreeze';
    else if (/冻结|锁卡/.test(text)) action = 'freeze';
    else if (/虚拟卡/.test(text) || /申请.*卡/.test(text)) action = 'apply_virtual';
    else if (/额度|调额|提到|调整/.test(text)) action = 'adjust_limit';
  }
  const activeCards = state.cards.filter((c) => c.status !== 'cancelled');
  const cardOptions: ClarifyOption[] = activeCards.map((c) => ({
    label: `${c.type === 'credit' ? '信用卡' : c.virtual ? '虚拟卡' : '借记卡'} · 尾号 ${c.last4}（${c.status === 'active' ? '正常' : c.status === 'frozen' ? '已冻结' : '已挂失'}）`,
    value: c.last4,
  }));

  if (action === 'list') {
    return {
      kind: 'plan',
      dag: makeDag(runId, 'card', '卡片与额度总览', '读取名下卡片、额度和状态', [
        { tool: 'list_cards', label: '读取卡片列表', args: {}, deps: [] },
      ]),
    };
  }

  if (action === 'apply_virtual') {
    const limitCents = toCents(slots.limitAmount) ?? 300_000;
    return {
      kind: 'plan',
      dag: makeDag(runId, 'card', '申请虚拟卡', `申请额度 ${formatMoney(limitCents)} 的虚拟卡`, [
        { tool: 'list_cards', label: '读取现有卡片', args: {}, deps: [] },
        {
          tool: 'apply_virtual_card',
          label: `申请虚拟卡 ${formatMoney(limitCents)}`,
          args: { limitCents },
          deps: ['n1'],
        },
      ]),
    };
  }

  const last4 = slots.cardLast4 ?? undefined;
  if (action === 'adjust_limit') {
    const target = last4
      ? activeCards.find((c) => c.last4 === last4)
      : activeCards.find((c) => c.type === 'credit') ?? activeCards[0];
    const limitCents = toCents(slots.limitAmount) ?? toCents(slots.amount);
    if (!limitCents) {
      return clarify('要把额度调整到多少？', 'limitAmount', [
        { label: '¥2,000', value: '2000' },
        { label: '¥5,000', value: '5000' },
        { label: '¥10,000', value: '10000' },
      ]);
    }
    return {
      kind: 'plan',
      dag: makeDag(
        runId,
        'card',
        `调整卡片额度 · 尾号 ${target?.last4 ?? '—'}`,
        `将${target?.type === 'credit' ? '信用卡' : '借记卡'}额度调整为 ${formatMoney(limitCents)}`,
        [
          { tool: 'list_cards', label: '读取卡片列表', args: {}, deps: [] },
          {
            tool: 'adjust_card_limit',
            label: `调整额度 ${formatMoney(limitCents)}`,
            args: { last4: target?.last4, limitCents },
            deps: ['n1'],
          },
        ],
      ),
    };
  }

  if (!last4) {
    return clarify('要操作哪张卡？请选择卡片。', 'cardLast4', cardOptions, '选择卡片');
  }
  const card = activeCards.find((c) => c.last4 === last4);
  if (!card) {
    return clarify(`没有找到尾号 ${last4} 的卡片，请重新选择。`, 'cardLast4', cardOptions, '选择卡片');
  }
  const tool: ToolName =
    action === 'report_loss' ? 'report_loss' : action === 'freeze' ? 'freeze_card' : 'unfreeze_card';
  const label =
    action === 'report_loss' ? '挂失卡片' : action === 'freeze' ? '临时冻结' : '解除冻结';
  return {
    kind: 'plan',
    dag: makeDag(runId, 'card', `${label} · 尾号 ${card.last4}`, `${label}${card.type === 'credit' ? '信用卡' : '借记卡'}尾号 ${card.last4}`, [
      { tool: 'list_cards', label: '读取卡片列表', args: {}, deps: [] },
      {
        tool,
        label: `${label} · 尾号 ${card.last4}`,
        args: { last4: card.last4, cardId: card.id },
        deps: ['n1'],
      },
    ]),
  };
}

function planSubscription(state: BankState, nlu: NluResult, runId: string): PlanOutcome {
  const slots = nlu.slots;
  const text = nlu.utterance ?? nlu.rationale ?? '';
  const wantsCancel = /取消|关掉|退订|停掉|不用了/.test(text);
  const active = state.subscriptions.filter((s) => s.status === 'active');
  const options: ClarifyOption[] = active.map((s) => ({
    label: `${s.merchant} · ${formatMoney(s.amountCents)}/月`,
    value: s.id,
    hint: s.category,
  }));
  const specs: NodeSpec[] = [
    { tool: 'scan_subscriptions', label: '扫描自动续费', args: {}, deps: [] },
    { tool: 'detect_price_changes', label: '识别涨价', args: {}, deps: ['n1'] },
  ];
  if (!wantsCancel) {
    return {
      kind: 'plan',
      dag: makeDag(runId, 'subscription', '订阅与代扣体检', '识别自动续费、重复扣费与异常涨价', specs),
    };
  }
  let subscription = slots.subscriptionId
    ? active.find((s) => s.id === slots.subscriptionId)
    : undefined;
  if (!subscription && slots.subscriptionName) {
    const needle = slots.subscriptionName.replace(/会员|自动续费|订阅/g, '').trim();
    const matches = active.filter(
      (s) => s.merchant.includes(needle) || s.category.includes(needle) || needle.includes(s.merchant),
    );
    if (matches.length === 1) subscription = matches[0];
    else if (matches.length > 1) {
      return clarify('匹配到多个订阅，请选择要取消的项目。', 'subscriptionId', options, '选择订阅');
    }
  }
  if (!subscription) {
    return clarify('要取消哪个订阅？请选择。', 'subscriptionId', options, '选择订阅');
  }
  specs.push({
    tool: 'cancel_subscription',
    label: `取消 ${subscription.merchant}`,
    args: { name: subscription.merchant, subscriptionId: subscription.id },
    deps: ['n1'],
  });
  return {
    kind: 'plan',
    dag: makeDag(
      runId,
      'subscription',
      `取消订阅 · ${subscription.merchant}`,
      `确认后停止 ${subscription.merchant} 的自动续费，每月节省 ${formatMoney(subscription.amountCents)}`,
      specs,
    ),
  };
}

function planCrossScene(state: BankState, nlu: NluResult, runId: string): PlanOutcome {
  const spouse = state.user.spouse;
  const monthDay = nlu.slots.birthdayDate ?? spouse.birthday.slice(5);
  const info = nextBirthday(monthDay);
  const budgetCents = toCents(nlu.slots.budget) ?? 100_000;
  const flowerDelivery = `${toShanghaiDate(new Date(new Date(info.birthdayIso).getTime() - 2 * 86_400_000).toISOString())}T10:00:00+08:00`;
  const cakeDelivery = `${toShanghaiDate(new Date(new Date(info.birthdayIso).getTime() - 1 * 86_400_000).toISOString())}T10:00:00+08:00`;
  const noteAt = `${toShanghaiDate(info.birthdayIso)}T08:00:00+08:00`;
  const releaseAt = `${toShanghaiDate(new Date(new Date(info.birthdayIso).getTime() + 86_400_000).toISOString())}T23:59:59+08:00`;
  return {
    kind: 'plan',
    dag: makeDag(
      runId,
      'crossscene',
      `为${spouse.name}安排生日`,
      `${info.birthdayLabel}生日，提前锁定 ${formatMoney(budgetCents)} 活期预算，${info.tMinus2Label}订花、${info.tMinus1Label}订蛋糕`,
      [
        {
          tool: 'resolve_birthday',
          label: `解析生日 · ${spouse.name}`,
          args: { birthdayDate: monthDay },
          deps: [],
        },
        {
          tool: 'lock_funds',
          label: `锁定活期预算 ${formatMoney(budgetCents)}`,
          args: {
            amountCents: budgetCents,
            reason: `${spouse.name}生日预算 · 锁定活期`,
            releaseAt,
          },
          deps: ['n1'],
        },
        {
          tool: 'order_gift',
          label: `预约鲜花 ${formatMoney(19_900)}`,
          args: {
            type: 'flower',
            merchant: '花间集 · 厄瓜多尔玫瑰',
            amountCents: 19_900,
            deliveryAt: flowerDelivery,
            note: `${spouse.name}生日鲜花`,
          },
          deps: ['n2'],
        },
        {
          tool: 'order_gift',
          label: `预约蛋糕 ${formatMoney(16_800)}`,
          args: {
            type: 'cake',
            merchant: '云朵烘焙 · 生日蛋糕',
            amountCents: 16_800,
            deliveryAt: cakeDelivery,
            note: `${spouse.name}生日蛋糕`,
          },
          deps: ['n2'],
        },
        {
          tool: 'create_note',
          label: '写入生日日程',
          args: {
            title: `${spouse.name}生日提醒`,
            executeAt: noteAt,
            detail: `鲜花 ${info.tMinus2Label} 送达，蛋糕 ${info.tMinus1Label} 送达`,
          },
          deps: ['n3', 'n4'],
        },
      ],
    ),
  };
}

function planAccount(state: BankState, nlu: NluResult, runId: string): PlanOutcome {
  const text = nlu.utterance ?? nlu.rationale ?? '';
  const wantsTransactions =
    nlu.slots.query === 'transactions' || /流水|交易记录|明细|最近.*消费/.test(text);
  if (wantsTransactions) {
    return {
      kind: 'plan',
      dag: makeDag(runId, 'account', '交易流水查询', '按周期查询最近交易记录', [
        {
          tool: 'list_transactions',
          label: '查询交易流水',
          args: { period: periodFrom(nlu), category: nlu.slots.category ?? undefined, limit: 12 },
          deps: [],
        },
      ]),
    };
  }
  return {
    kind: 'plan',
    dag: makeDag(runId, 'account', '账户余额查询', '读取名下账户余额与可用资金', [
      { tool: 'get_balance', label: '查询账户余额', args: {}, deps: [] },
    ]),
  };
}

export function buildPlan(
  state: BankState,
  nlu: NluResult,
  context: ContextStack,
  runId: string,
): PlanOutcome {
  const outcome = dispatchPlan(state, nlu, context, runId);
  if (outcome.kind === 'plan') {
    const template = BUSINESS_TEMPLATES[selectTemplate(nlu.intent, nlu.slots, nlu.utterance ?? '')];
    outcome.dag.template = { id: template.id, label: template.label, steps: template.steps };
  }
  return outcome;
}

function dispatchPlan(
  state: BankState,
  nlu: NluResult,
  context: ContextStack,
  runId: string,
): PlanOutcome {
  switch (nlu.intent) {
    case 'transfer':
      return planTransfer(state, nlu, context, runId);
    case 'bills':
      return planBills(state, nlu, runId);
    case 'wealth':
      return planWealth(state, nlu, runId);
    case 'card':
      return planCard(state, nlu, runId);
    case 'subscription':
      return planSubscription(state, nlu, runId);
    case 'crossscene':
      return planCrossScene(state, nlu, runId);
    case 'account':
      return planAccount(state, nlu, runId);
    case 'chitchat':
      return {
        kind: 'reply',
        text: `您好，我是 AI 银行管家。可以直接说“给${state.user.spouse.name || state.user.contacts[0]?.name || '联系人'}转 520”“分析这个月账单”“推荐稳健理财”，我会先规划任务，再按风险等级自动执行或请您确认。`,
        card: { type: 'capabilities', title: '我可以帮你办理' },
      };
    default:
      return {
        kind: 'reply',
        text: '没太理解你的意思。可以换一种说法，或者点下面的示例快速体验。',
        card: { type: 'capabilities', title: '试试这些指令' },
      };
  }
}
