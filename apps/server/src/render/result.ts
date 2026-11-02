import {
  RISK_META,
  formatDate,
  formatDateTime,
  formatMoney,
  type Card,
  type DagNode,
  type Intent,
  type Risk,
  type ToolName,
} from '@bank/shared';
import type { BankState } from '../core/state';
import type { SessionInternal } from '../agent/session';
import { guardNumbers } from './numberGuard';
import { metrics } from '../metrics';

export interface RenderedMessage {
  text: string;
  card?: Card;
  evidence: string[];
  intent: Intent;
  risk: Risk;
  tone: 'normal' | 'success' | 'warning' | 'danger';
}

function resultData(session: SessionInternal, tool: ToolName): any | undefined {
  return session.dag?.nodes.find((n) => n.tool === tool && n.status === 'SUCCESS')?.result?.data;
}

function failedNode(session: SessionInternal): DagNode | undefined {
  return session.dag?.nodes.find((n) => n.status === 'FAILED' || n.status === 'MANUAL');
}

function allRisk(session: SessionInternal): Risk {
  const nodes = session.dag?.nodes ?? [];
  if (nodes.some((n) => (n.policy?.effectiveRisk ?? n.risk) === 'RED')) return 'RED';
  if (nodes.some((n) => (n.policy?.effectiveRisk ?? n.risk) === 'YELLOW')) return 'YELLOW';
  return 'GREEN';
}

function errorRendered(session: SessionInternal, intent: Intent): RenderedMessage {
  const node = failedNode(session);
  const detail = node?.result?.error?.message ?? '操作未完成，请稍后重试';
  return {
    text: `本次操作未完成：${detail}`,
    card: {
      type: 'error',
      title: '操作未完成',
      detail,
      code: node?.result?.error?.code,
      nodeLabel: node?.label,
    },
    evidence: [node?.id ?? ''],
    intent,
    risk: 'RED',
    tone: 'danger',
  };
}

function transferRendered(session: SessionInternal): RenderedMessage {
  const schedule = resultData(session, 'schedule_transfer');
  if (schedule) {
    return {
      text: `已创建定时转账：${schedule.payee}，${formatMoney(schedule.amountCents)}，执行时间 ${formatDateTime(schedule.schedule.executeAt)}。执行前会再次校验余额和权限等级。`,
      card: {
        type: 'scheduleReceipt',
        schedule: schedule.schedule,
        payee: schedule.payee,
        amountCents: schedule.amountCents,
      },
      evidence: [schedule.schedule.id],
      intent: 'transfer',
      risk: 'YELLOW',
      tone: 'success',
    };
  }
  const split = resultData(session, 'split_request');
  if (split) {
    return {
      text: `已向 ${split.shares.map((s: any) => s.name).join('、')} 发起 AA 收款，总金额 ${formatMoney(split.totalCents)}，我的份额 ${formatMoney(split.myShareCents)}。`,
      card: { type: 'splitShare', ...split },
      evidence: [split.requestId],
      intent: 'transfer',
      risk: 'YELLOW',
      tone: 'success',
    };
  }
  const transfer = resultData(session, 'transfer');
  if (!transfer) return errorRendered(session, 'transfer');
  const names = transfer.recipients.map((r: any) => r.name).join('、');
  const primaryTxn = transfer.txns[0]?.id ?? '';
  const risk = allRisk(session);
  return {
    text: `已向 ${names} 转账 ${formatMoney(transfer.totalCents)}，使用${transfer.account.name}（尾号 ${transfer.account.last4}），预计实时到账。交易流水号 ${primaryTxn}。当前可用余额 ${formatMoney(transfer.account.availableCents)}。`,
    card: {
      type: 'transferReceipt',
      amountCents: transfer.totalCents,
      recipients: transfer.recipients,
      from: {
        name: transfer.account.name,
        last4: transfer.account.last4,
        availableCents: transfer.account.availableCents,
      },
      txnIds: transfer.txns.map((t: any) => t.id),
      note: transfer.note,
      executedAt: transfer.executedAt,
      runId: session.dag?.runId,
      undoable: true,
      risk,
    },
    evidence: transfer.txns.map((t: any) => t.id),
    intent: 'transfer',
    risk,
    tone: 'success',
  };
}

function billsRendered(session: SessionInternal, state: BankState): RenderedMessage {
  const aggregate = resultData(session, 'aggregate_bills');
  if (!aggregate) return errorRendered(session, 'bills');
  const anomalyData = resultData(session, 'detect_anomalies');
  const anomalies = anomalyData?.anomalies ?? [];
  const sandbox = resultData(session, 'sandbox_analyze');
  const delta = Number(aggregate.deltaPct ?? 0);
  const deltaText =
    Math.abs(delta) < 0.01
      ? '与上期基本持平'
      : `较${aggregate.prevLabel}${delta > 0 ? '上升' : '下降'} ${Math.abs(delta).toFixed(2)}%`;
  const insight = sandbox?.insight
    ? {
        category: sandbox.category,
        count: sandbox.insight.count,
        totalCents: sandbox.insight.totalCents,
        avgCents: sandbox.insight.avgCents,
        weeklyAvgCents: sandbox.insight.weeklyAvgCents,
        topMerchants: sandbox.insight.topMerchants,
        engine: sandbox.engine,
        durationMs: sandbox.durationMs,
      }
    : null;
  const text = `${aggregate.periodLabel}生活支出 ${formatMoney(aggregate.totalExpenseCents)}，${deltaText}。共 ${aggregate.txCount} 条流水，发现 ${anomalies.length} 笔可疑交易。`;
  return {
    text,
    card: {
      type: 'billReport',
      periodLabel: aggregate.periodLabel,
      prevLabel: aggregate.prevLabel,
      totalExpenseCents: aggregate.totalExpenseCents,
      incomeCents: aggregate.incomeCents,
      prevExpenseCents: aggregate.prevExpenseCents,
      deltaPct: delta,
      categories: aggregate.categories,
      topMerchants: aggregate.topMerchants,
      anomalies,
      insight,
      txCount: aggregate.txCount,
      accounts: state.accounts.filter((a) => a.type !== 'credit').map((a) => ({ name: a.name, last4: a.last4 })),
    },
    evidence: anomalies.map((a: any) => a.id),
    intent: 'bills',
    risk: 'GREEN',
    tone: anomalies.length ? 'warning' : 'success',
  };
}

function wealthRendered(session: SessionInternal, state: BankState): RenderedMessage {
  const purchase = resultData(session, 'purchase_wealth');
  if (purchase) {
    return {
      text: `已申购「${purchase.product.name}」${formatMoney(purchase.amountCents)}，风险等级 ${purchase.product.riskLevel}，业绩比较基准 ${purchase.product.yieldPct.toFixed(2)}%，测算年收益约 ${formatMoney(purchase.expectedAnnualCents)}。适当性校验：${purchase.suitability?.level ?? purchase.product.riskLevel} 可购至 ${purchase.suitability?.maxProductRisk ?? 'R5'}。交易流水号 ${purchase.txn.id}。`,
      card: {
        type: 'wealthReceipt',
        mode: 'purchase',
        product: purchase.product,
        amountCents: purchase.amountCents,
        expectedAnnualCents: purchase.expectedAnnualCents,
        suitability: purchase.suitability,
        txnId: purchase.txn.id,
        executedAt: purchase.executedAt,
        account: purchase.account,
      },
      evidence: [purchase.txn.id, purchase.holding.id],
      intent: 'wealth',
      risk: 'RED',
      tone: 'success',
    };
  }
  const redeem = resultData(session, 'redeem_wealth');
  if (redeem) {
    return {
      text: `已赎回「${redeem.product.name}」${formatMoney(redeem.amountCents)}，资金将按产品规则回到${redeem.account.name}（尾号 ${redeem.account.last4}）。交易流水号 ${redeem.txn.id}。`,
      card: {
        type: 'wealthReceipt',
        mode: 'redeem',
        product: redeem.product,
        amountCents: redeem.amountCents,
        txnId: redeem.txn.id,
        executedAt: redeem.executedAt,
        account: redeem.account,
      },
      evidence: [redeem.txn.id],
      intent: 'wealth',
      risk: 'RED',
      tone: 'success',
    };
  }
  const match = resultData(session, 'match_products');
  if (!match) return errorRendered(session, 'wealth');
  const selected = match.recommendations[0];
  const holdings = state.holdings
    .filter((h) => h.status === 'holding')
    .map((h) => ({
      ...h,
      product: state.products.find((p) => p.id === h.productId),
      estimatedValueCents: Math.round(h.amountCents * (1 + h.floatingPct / 100)),
    }));
  const excluded = (match.excludedBySuitability ?? []) as any[];
  const text = `结合您的${match.userRiskLevel}测评结果（适当性上限 ${match.maxProductRisk ?? 'R2'}），优先推荐「${selected.product.name}」（${selected.product.riskLevel}），业绩比较基准 ${selected.product.yieldPct.toFixed(2)}%。${selected.estimatedAnnualCents ? `按候选金额测算年收益约 ${formatMoney(selected.estimatedAnnualCents)}。` : ''}${excluded.length ? ` 另有 ${excluded.length} 款超出适当性等级的产品未纳入推荐。` : ''}`;
  return {
    text,
    card: {
      type: 'wealth',
      userRiskLevel: match.userRiskLevel,
      maxProductRisk: match.maxProductRisk,
      excludedBySuitability: excluded,
      rationale: match.rationale,
      recommendations: match.recommendations,
      holdings,
      allProducts: state.products,
      requestedAmountCents: match.amountCents,
    },
    evidence: match.recommendations.map((r: any) => r.product.id),
    intent: 'wealth',
    risk: 'GREEN',
    tone: 'success',
  };
}

function cardRendered(session: SessionInternal, state: BankState): RenderedMessage {
  const actionTools: ToolName[] = [
    'apply_virtual_card',
    'adjust_card_limit',
    'freeze_card',
    'unfreeze_card',
    'report_loss',
  ];
  for (const tool of actionTools) {
    const data = resultData(session, tool);
    if (!data) continue;
    if (tool === 'apply_virtual_card') {
      return {
        text: `虚拟卡申请成功，尾号 ${data.card.last4}，额度 ${formatMoney(data.card.limitCents ?? 0)}，仅用于线上支付，可随时注销。`,
        card: { type: 'cardReceipt', action: 'apply_virtual', card: data.card, limitCents: data.limitCents },
        evidence: [data.card.id],
        intent: 'card',
        risk: 'YELLOW',
        tone: 'success',
      };
    }
    if (tool === 'adjust_card_limit') {
      return {
        text: `卡片尾号 ${data.card.last4} 的额度已由 ${formatMoney(data.previousLimitCents)} 调整为 ${formatMoney(data.limitCents)}。`,
        card: { type: 'cardReceipt', action: 'adjust_limit', ...data },
        evidence: [data.card.id],
        intent: 'card',
        risk: allRisk(session),
        tone: 'success',
      };
    }
    return {
      text: `尾号 ${data.card.last4} 的卡片已${data.label}，状态更新为${data.card.status === 'lost' ? '已挂失' : data.card.status === 'frozen' ? '已冻结' : '正常'}。`,
      card: { type: 'cardReceipt', action: data.action, ...data },
      evidence: [data.card.id],
      intent: 'card',
      risk: allRisk(session),
      tone: 'success',
    };
  }

  const list = resultData(session, 'list_cards');
  if (!list) return errorRendered(session, 'card');
  return {
    text: `名下共有 ${list.items.length} 张卡片，其中 ${list.items.filter((c: any) => c.status === 'active').length} 张状态正常。你可以在下方查看额度，或直接说“申请虚拟卡”“把尾号 1234 挂失”。`,
    card: { type: 'cards', items: list.items },
    evidence: list.items.map((c: any) => c.id),
    intent: 'card',
    risk: 'GREEN',
    tone: 'normal',
  };
}

function subscriptionRendered(session: SessionInternal): RenderedMessage {
  const cancel = resultData(session, 'cancel_subscription');
  if (cancel) {
    return {
      text: `已取消「${cancel.subscription.merchant}」自动续费，每月可节省 ${formatMoney(cancel.monthlySavedCents)}，已购权益保留至到期。`,
      card: { type: 'subscriptionReceipt', ...cancel },
      evidence: [cancel.subscription.id],
      intent: 'subscription',
      risk: 'YELLOW',
      tone: 'success',
    };
  }
  const scan = resultData(session, 'scan_subscriptions');
  if (!scan) return errorRendered(session, 'subscription');
  const changes = resultData(session, 'detect_price_changes')?.changes ?? [];
  const duplicateText = scan.duplicateCharge ? `发现「${scan.duplicateMerchant}」疑似重复扣费，` : '';
  const changeText = changes.length
    ? `另有 ${changes.length} 个订阅涨价（最高每月多扣 ${formatMoney(Math.max(...changes.map((c: any) => c.deltaCents)))}）。`
    : '';
  return {
    text: `${duplicateText}识别到 ${scan.activeCount} 个自动续费，每月合计 ${formatMoney(scan.totalMonthlyCents)}。${changeText}`,
    card: {
      type: 'subscriptions',
      items: scan.items,
      totalMonthlyCents: scan.totalMonthlyCents,
      activeCount: scan.activeCount,
      duplicateCharge: scan.duplicateCharge,
      duplicateMerchant: scan.duplicateMerchant,
      priceChanges: changes,
    },
    evidence: scan.items.map((s: any) => s.id),
    intent: 'subscription',
    risk: 'GREEN',
    tone: scan.duplicateCharge || changes.length ? 'warning' : 'success',
  };
}

function crossSceneRendered(session: SessionInternal): RenderedMessage {
  const birthday = resultData(session, 'resolve_birthday');
  const lock = resultData(session, 'lock_funds');
  const orderNodes = session.dag?.nodes.filter((n) => n.tool === 'order_gift' && n.status === 'SUCCESS') ?? [];
  const orders = orderNodes.map((n) => n.result?.data?.order).filter(Boolean);
  const note = resultData(session, 'create_note');
  if (!birthday) return errorRendered(session, 'crossscene');
  const flower = orders.find((o: any) => o.type === 'flower');
  const cake = orders.find((o: any) => o.type === 'cake');
  const shortDay = (iso: string) => {
    const parts = formatDate(iso).split('-');
    return `${Number(parts[1])} 月 ${Number(parts[2])} 日`;
  };
  const parts: string[] = [];
  if (lock) parts.push(`锁定活期预算 ${formatMoney(lock.amountCents)}`);
  if (flower) parts.push(`${shortDay(flower.deliveryAt)}鲜花送达（${formatMoney(flower.amountCents)}）`);
  if (cake) parts.push(`${shortDay(cake.deliveryAt)}蛋糕送达（${formatMoney(cake.amountCents)}）`);
  const text = `已为${birthday.spouseName}安排生日（${birthday.birthdayLabel}）：${parts.join('；')}${note ? '，并写入生日提醒日程。' : '。'}`;
  return {
    text,
    card: {
      type: 'birthdayPlan',
      spouseName: birthday.spouseName,
      birthdayLabel: birthday.birthdayLabel,
      birthdayIso: birthday.birthdayIso,
      daysUntil: birthday.daysUntil,
      tMinus2: birthday.tMinus2Label,
      tMinus1: birthday.tMinus1Label,
      budgetCents: lock?.amountCents ?? 0,
      lock: lock?.lock,
      flowers: flower,
      cake,
      note: note?.item,
      state: session.state,
    },
    evidence: [lock?.lock?.id, flower?.id, cake?.id, note?.item?.id].filter(Boolean) as string[],
    intent: 'crossscene',
    risk: allRisk(session),
    tone: session.state === 'PARTIAL' ? 'warning' : 'success',
  };
}

function accountRendered(session: SessionInternal): RenderedMessage {
  const balance = resultData(session, 'get_balance');
  if (balance) {
    return {
      text: `你的账户合计总资产 ${formatMoney(balance.totalCents)}，其中可用 ${formatMoney(balance.availableTotalCents ?? balance.totalCents)}，共 ${balance.accounts.length} 个账户。已为你列出各账户余额与锁定资金。`,
      card: {
        type: 'balance',
        accounts: balance.accounts,
        totalCents: balance.totalCents,
        availableTotalCents: balance.availableTotalCents,
      },
      evidence: balance.accounts.map((a: any) => a.id),
      intent: 'account',
      risk: 'GREEN',
      tone: 'success',
    };
  }
  const transactions = resultData(session, 'list_transactions');
  if (!transactions) return errorRendered(session, 'account');
  return {
    text: `${transactions.rangeLabel}共查询到 ${transactions.total} 条交易，下方展示最近 ${transactions.items.length} 条。`,
    card: { type: 'transactions', items: transactions.items, rangeLabel: transactions.rangeLabel, total: transactions.total },
    evidence: transactions.items.map((t: any) => t.id),
    intent: 'account',
    risk: 'GREEN',
    tone: 'normal',
  };
}

export function renderRun(session: SessionInternal, state: BankState): RenderedMessage {
  if (session.state === 'LOCKED') {
    return {
      text: '会话已触发安全熔断，暂时无法继续操作。请在安全控制台完成人工复核后解锁。',
      card: { type: 'locked', title: '安全锁定', detail: state.security.lastReason ?? '连续失败或可疑行为' },
      evidence: [],
      intent: session.dag?.intent ?? 'unknown',
      risk: 'RED',
      tone: 'danger',
    };
  }

  let rendered: RenderedMessage;
  switch (session.dag?.intent) {
    case 'transfer':
      rendered = transferRendered(session);
      break;
    case 'bills':
      rendered = billsRendered(session, state);
      break;
    case 'wealth':
      rendered = wealthRendered(session, state);
      break;
    case 'card':
      rendered = cardRendered(session, state);
      break;
    case 'subscription':
      rendered = subscriptionRendered(session);
      break;
    case 'crossscene':
      rendered = crossSceneRendered(session);
      break;
    case 'account':
      rendered = accountRendered(session);
      break;
    default:
      rendered = {
        text: '任务已结束。',
        evidence: [],
        intent: 'unknown',
        risk: 'GREEN',
        tone: 'normal',
      };
  }

  const evidence = {
    results: session.dag?.nodes.map((n) => n.result).filter(Boolean),
    card: rendered.card,
    policies: session.dag?.nodes.map((n) => n.policy).filter(Boolean),
  };
  const guard = guardNumbers(rendered.text, evidence);
  metrics.recordGuard({ checked: guard.checked, blocked: !guard.ok });
  if (!guard.ok) {
    rendered.text = '操作已完成，明细见下方卡片。';
  }
  return rendered;
}
