import {
  RISK_META,
  formatDateTime,
  formatMoney,
  type DagNode,
  type OperationSummary,
  type PolicyDecision,
} from '@bank/shared';
import type { BankState } from '../core/state';
import { resolveProduct } from '../tools/helpers';

type Row = OperationSummary['rows'][number];

function row(label: string, value: string, emphasis = false, tone: Row['tone'] = 'normal'): Row {
  return { label, value, emphasis, tone };
}

export function buildPendingSummary(
  state: BankState,
  node: DagNode,
  policy: PolicyDecision,
): OperationSummary {
  const args = node.args as any;
  const rows: Row[] = [];
  const warnings: string[] = [];
  let title = node.label;
  let subtitle: string | undefined;
  let amountCents: number | undefined = policy.amountCents;
  let payee: string | undefined;
  let from: string | undefined;

  switch (node.tool) {
    case 'transfer': {
      title = '转账确认';
      const recipients: any[] = args.recipients ?? [];
      payee = recipients.map((r) => r.name).join('、');
      const account = state.accounts.find((a) => a.id === args.fromAccountId);
      from = account ? `${account.name}（尾号 ${account.last4}）` : undefined;
      rows.push(row('收款人', recipients.map((r) => `${r.name} · ${r.bank ?? '银行'} 尾号 ${r.last4 ?? '—'}`).join('；')));
      rows.push(row('付款账户', from ?? '—'));
      rows.push(row('转账金额', formatMoney(args.totalCents ?? 0), true));
      rows.push(row('手续费', '¥0.00'));
      rows.push(row('到账时间', '实时到账'));
      if (args.note) rows.push(row('备注', String(args.note)));
      rows.push(row('当日额度剩余', formatMoney(policy.limit.remainingCents)));
      rows.push(row('风险等级', RISK_META[policy.effectiveRisk].label, false, policy.effectiveRisk === 'RED' ? 'risk' : 'normal'));
      if (policy.effectiveRisk === 'RED') {
        warnings.push('该笔转账会使当日累计超过 1000 元，需要完成人脸识别');
        if ((args.totalCents ?? 0) > 500_000) warnings.push('单笔超过 5000 元，还需短信验证码');
      }
      break;
    }
    case 'schedule_transfer': {
      title = '定时转账确认';
      payee = args.payee;
      rows.push(row('收款人', args.payee));
      rows.push(row('转账金额', formatMoney(args.amountCents ?? 0), true));
      rows.push(row('执行时间', formatDateTime(args.executeAt)));
      rows.push(row('备注', args.note ?? 'AI 管家定时转账'));
      warnings.push('定时任务执行前会再次校验余额与权限等级');
      break;
    }
    case 'split_request': {
      title = 'AA 收款确认';
      const names: string[] = args.names ?? [];
      rows.push(row('参与人', names.join('、')));
      rows.push(row('总金额', formatMoney(args.totalCents ?? 0), true));
      rows.push(row('收款方式', '向联系人发送 AA 收款请求'));
      rows.push(row('说明', '仅发起收款，不扣减账户资金'));
      break;
    }
    case 'purchase_wealth': {
      title = '理财申购确认';
      const product = resolveProduct(state, { productName: args.productName, riskLevel: args.riskLevel });
      amountCents = args.amountCents;
      rows.push(row('产品', product?.name ?? args.productName ?? '智能匹配置信产品'));
      if (product) {
        rows.push(row('风险等级', `${product.riskLevel} · ${product.type}`));
        rows.push(row('业绩比较基准', `${product.yieldPct.toFixed(2)}%`));
        rows.push(row('期限 / 流动性', `${product.termDays ? `${product.termDays} 天` : '无固定期限'} · ${product.liquidity}`));
        rows.push(row('预计年收益', formatMoney(Math.round(((args.amountCents ?? 0) * product.yieldPct) / 100))));
      }
      rows.push(row('申购金额', formatMoney(args.amountCents ?? 0), true));
      rows.push(row('扣款账户', state.accounts.find((a) => a.id === args.fromAccountId)?.name ?? '主账户'));
      warnings.push('理财非存款，产品有风险，投资须谨慎；申购成交后不可撤销');
      break;
    }
    case 'redeem_wealth': {
      title = '理财赎回确认';
      const product = resolveProduct(state, { productName: args.productName });
      rows.push(row('产品', product?.name ?? args.productName ?? '持仓产品'));
      rows.push(row('赎回金额', formatMoney(args.amountCents ?? 0), true));
      rows.push(row('到账账户', '云杉银行 · 储蓄卡（尾号 1234）'));
      warnings.push('赎回确认后进入清算流程，到账时间以产品规则为准');
      break;
    }
    case 'apply_virtual_card': {
      title = '虚拟卡申请确认';
      rows.push(row('卡片类型', 'Visa 虚拟借记卡'));
      rows.push(row('申请额度', formatMoney(args.limitCents ?? 0), true));
      rows.push(row('使用范围', '仅线上支付 · 可随时注销'));
      warnings.push('虚拟卡将绑定当前实名信息，仅用于演示环境');
      break;
    }
    case 'adjust_card_limit': {
      title = '调整卡片额度';
      const card = state.cards.find((c) => c.id === args.cardId) ?? state.cards.find((c) => c.last4 === args.last4);
      rows.push(row('卡片', card ? `${card.type === 'credit' ? '信用卡' : '借记卡'} 尾号 ${card.last4}` : '—'));
      rows.push(row('当前额度', formatMoney(card?.limitCents ?? 0)));
      rows.push(row('调整后额度', formatMoney(args.limitCents ?? 0), true));
      if ((args.limitCents ?? 0) > 200_000) warnings.push('额度超过 2000 元，需要进行强验证');
      break;
    }
    case 'freeze_card':
    case 'unfreeze_card':
    case 'report_loss': {
      const card = state.cards.find((c) => c.id === args.cardId) ?? state.cards.find((c) => c.last4 === args.last4);
      title =
        node.tool === 'report_loss' ? '卡片挂失确认' : node.tool === 'freeze_card' ? '临时冻结确认' : '解除冻结确认';
      rows.push(row('卡片', card ? `${card.type === 'credit' ? '信用卡' : '借记卡'} 尾号 ${card.last4}` : '—'));
      rows.push(row('当前状态', card?.status === 'active' ? '正常' : card?.status === 'frozen' ? '已冻结' : card?.status === 'lost' ? '已挂失' : '已注销'));
      if (node.tool === 'report_loss') {
        rows.push(row('生效时间', '立即生效'));
        warnings.push('挂失后该卡将永久停用，需要到网点或视频柜员补办新卡');
      } else if (node.tool === 'freeze_card') {
        warnings.push('冻结期间该卡无法交易，可随时解冻');
      }
      break;
    }
    case 'cancel_subscription': {
      title = '取消订阅确认';
      const sub = state.subscriptions.find((s) => s.id === args.subscriptionId);
      rows.push(row('订阅服务', sub?.merchant ?? args.name));
      rows.push(row('当前月费', formatMoney(sub?.amountCents ?? 0), true));
      rows.push(row('下次扣款', sub ? formatDateTime(sub.nextChargeAt) : '—'));
      rows.push(row('取消后', '不再自动续费，已购会员权益保留至到期'));
      break;
    }
    case 'lock_funds': {
      title = '锁定预算确认';
      const account =
        state.accounts.find((a) => a.type === 'current') ??
        state.accounts.find((a) => a.primary) ??
        state.accounts[0];
      rows.push(row('锁定账户', account ? `${account.name}（尾号 ${account.last4}）` : '活期账户'));
      rows.push(row('锁定金额', formatMoney(args.amountCents ?? 0), true));
      rows.push(row('锁定用途', args.reason ?? '生日预算'));
      rows.push(row('释放日期', formatDateTime(args.releaseAt)));
      warnings.push('锁定期间这部分活期资金不可用于消费，可回退解锁');
      break;
    }
    case 'order_gift': {
      title = args.type === 'flower' ? '预约鲜花确认' : '预约蛋糕确认';
      rows.push(row('商户', args.merchant));
      rows.push(row('金额', formatMoney(args.amountCents ?? 0), true));
      rows.push(row('配送时间', formatDateTime(args.deliveryAt)));
      rows.push(row('配送地址', state.user.preferences.addressMasked));
      warnings.push('预约成功后可在当日回退取消');
      break;
    }
    default: {
      rows.push(row('操作', node.label));
      if (amountCents) rows.push(row('金额', formatMoney(amountCents), true));
      rows.push(row('风险等级', RISK_META[policy.effectiveRisk].label));
      break;
    }
  }

  return {
    title,
    subtitle,
    amountCents,
    payee,
    from,
    rows,
    warnings,
  };
}

export function combineBatchSummary(
  state: BankState,
  nodes: DagNode[],
  policies: Map<string, PolicyDecision>,
): OperationSummary {
  const rows: Row[] = [];
  let total = 0;
  for (const node of nodes) {
    const policy = policies.get(node.id);
    const summary = policy ? buildPendingSummary(state, node, policy) : null;
    const amount = summary?.amountCents ?? 0;
    total += amount;
    rows.push(
      row(
        node.label.replace(/\s*¥[\d,.]+\s*$/, ''),
        amount ? formatMoney(amount) : summary?.title ?? '执行',
        false,
      ),
    );
  }
  rows.push(row('合计', formatMoney(total), true));
  return {
    title: `确认本次任务（${nodes.length} 个操作）`,
    subtitle: '以下操作已在同一任务链中按依赖顺序排列，确认后按权限等级依次执行',
    amountCents: total,
    rows,
    warnings: ['本次批量确认覆盖全部黄色操作，操作摘要已哈希绑定，执行前会再次校验'],
  };
}
