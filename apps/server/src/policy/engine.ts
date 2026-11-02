import {
  DAILY_TRANSFER_LIMIT_CENTS,
  HIGH_VALUE_CENTS,
  POLICY_REASON_TEXT,
  TIER_META,
  TIER_THRESHOLDS_CENTS,
  controlsFor,
  formatMoney,
  higherTier,
  riskFromTier,
  tierFromAmount,
  type DagNode,
  type PolicyDecision,
  type PolicyReason,
  type Risk,
  type RiskTier,
} from '@bank/shared';
import { isLocked } from '../security/breaker';
import type { BankState } from '../core/state';
import { getLimitSummary } from './limits';
import { assessRisk, type RiskCallContext } from './riskAgent';

export type { RiskCallContext };

const RISK_RANK: Record<Risk, number> = { GREEN: 0, YELLOW: 1, RED: 2 };

function reason(code: string, detail?: string, label?: string): PolicyReason {
  return { code, label: label ?? POLICY_REASON_TEXT[code] ?? code, detail };
}

function amountOf(node: DagNode): number | undefined {
  const args = node.args as Record<string, any>;
  switch (node.tool) {
    case 'transfer':
      return typeof args.totalCents === 'number' ? args.totalCents : undefined;
    case 'schedule_transfer':
    case 'purchase_wealth':
    case 'redeem_wealth':
    case 'order_gift':
    case 'lock_funds':
    case 'split_request':
      return typeof args.amountCents === 'number'
        ? args.amountCents
        : typeof args.totalCents === 'number'
          ? args.totalCents
          : undefined;
    case 'adjust_card_limit':
      return typeof args.limitCents === 'number' ? args.limitCents : undefined;
    default:
      return undefined;
  }
}

/** 取收款人与备注，供风控智能体判断收款人新异性与话术风险。 */
function payeeAndNote(node: DagNode): { payeeName?: string; note?: string } {
  const args = node.args as Record<string, any>;
  const recipients = Array.isArray(args.recipients) ? args.recipients : [];
  const payeeName =
    (recipients[0]?.name as string | undefined) ??
    (typeof args.payeeName === 'string' ? args.payeeName : undefined) ??
    (typeof args.payee === 'string' ? args.payee : undefined);
  const note = typeof args.note === 'string' ? args.note : undefined;
  return { payeeName, note };
}

/** 操作类型决定的静态档位。 */
function toolTier(node: DagNode, amountCents?: number): RiskTier {
  if (node.risk === 'GREEN') return 'T0';
  if (node.risk === 'RED') {
    return amountCents ? higherTier('T3', tierFromAmount(amountCents)) : 'T3';
  }
  return amountCents ? tierFromAmount(amountCents) : 'T1';
}

function decisionForTier(tier: RiskTier, tool: DagNode['tool']): PolicyDecision['decision'] {
  if (tier === 'T0') return 'ALLOW';
  if (tier === 'T1' || tier === 'T2') return 'CONFIRM';
  if (tier === 'T3') return 'STEPUP';
  // 只有资金转出可以进人工审核队列；其余 T4 操作按 T3 强验证处理
  return tool === 'transfer' ? 'REVIEW' : 'STEPUP';
}

function explanationFor(tier: RiskTier, signals: string[], amountCents?: number): string {
  const meta = TIER_META[tier];
  const tail = signals.length ? `风控智能体命中：${signals.slice(0, 3).join('、')}。` : '风控智能体未命中异常信号。';
  const money = amountCents ? `本次金额 ${formatMoney(amountCents)}。` : '';
  return `${meta.label}（${meta.name}）。${money}要求：${meta.strategy}。${tail}`;
}

export function evaluateNode(
  state: BankState,
  node: DagNode,
  ctx: RiskCallContext = {},
): PolicyDecision {
  const limit = getLimitSummary(state);
  const amountCents = amountOf(node);
  const baseRisk = node.risk;
  const reasons: PolicyReason[] = [];
  let risk = baseRisk;

  if (isLocked(state)) {
    return {
      nodeId: node.id,
      tool: node.tool,
      baseRisk,
      effectiveRisk: 'RED',
      reasons: [reason('BREAKER_LOCKED', state.security.lastReason ?? undefined)],
      amountCents,
      limit,
      explanation: '当前会话处于安全锁定状态，所有操作暂停，需人工复核后解锁。',
      decision: 'DENY',
      tier: 'T4',
      controls: controlsFor('T4'),
    };
  }

  const pushHighValue = () => {
    if (amountCents !== undefined && amountCents > HIGH_VALUE_CENTS) {
      reasons.push(reason('HIGH_VALUE', `金额 ${formatMoney(amountCents)} 超过 5000 元，需要人脸 + 短信双因子`));
      risk = 'RED';
    }
  };

  switch (node.tool) {
    case 'transfer': {
      const amount = amountCents ?? 0;
      if (amount <= limit.remainingCents) {
        risk = 'YELLOW';
        reasons.push(
          reason(
            'SMALL_TRANSFER',
            `本次 ${formatMoney(amount)}，当日已用 ${formatMoney(limit.usedCents)}，小额剩余 ${formatMoney(limit.remainingCents)}`,
          ),
        );
        pushHighValue();
      } else {
        risk = 'RED';
        reasons.push(
          reason(
            'DAILY_LIMIT_EXCEEDED',
            `本次 ${formatMoney(amount)} 后当日累计将达到 ${formatMoney(limit.usedCents + amount)}，超过 ${formatMoney(DAILY_TRANSFER_LIMIT_CENTS)} 黄色上限`,
          ),
        );
        pushHighValue();
      }
      reasons.push(reason('REVERSIBLE_OP'));
      break;
    }
    case 'schedule_transfer': {
      risk = 'YELLOW';
      if ((amountCents ?? 0) > HIGH_VALUE_CENTS) {
        risk = 'RED';
        reasons.push(reason('HIGH_VALUE', `预约转账金额 ${formatMoney(amountCents ?? 0)} 超过 5000 元`));
      } else {
        reasons.push(reason('SMALL_TRANSFER', '定时转账将在未来执行，本次仅创建计划，执行前会再次校验额度'));
      }
      break;
    }
    case 'split_request': {
      risk = 'YELLOW';
      reasons.push(reason('SMALL_TRANSFER', '发起 AA 收款不会扣减账户资金，需确认后向联系人发送收款请求'));
      break;
    }
    case 'purchase_wealth':
    case 'redeem_wealth': {
      risk = 'RED';
      reasons.push(
        reason(
          'RED_BASE',
          node.tool === 'purchase_wealth'
            ? '理财产品申购属于红色操作，且成交后不可撤销'
            : '理财产品赎回属于红色操作，确认后进入清算流程',
        ),
      );
      pushHighValue();
      break;
    }
    case 'apply_virtual_card': {
      risk = 'YELLOW';
      reasons.push(reason('REVERSIBLE_OP', '虚拟卡申请可随时注销，执行前需确认额度与用途'));
      break;
    }
    case 'adjust_card_limit': {
      if ((amountCents ?? 0) > 200_000) {
        risk = 'RED';
        reasons.push(reason('RED_BASE', `调额至 ${formatMoney(amountCents ?? 0)} 超过 2000 元，升级为红色强验证`));
      } else {
        risk = 'YELLOW';
        reasons.push(reason('SMALL_TRANSFER', `调额至 ${formatMoney(amountCents ?? 0)}，在 2000 元以内，确认后生效`));
      }
      break;
    }
    case 'freeze_card':
    case 'cancel_subscription':
    case 'lock_funds':
    case 'order_gift': {
      risk = 'YELLOW';
      reasons.push(reason('REVERSIBLE_OP', '该操作可逆，执行前需确认详情'));
      if (node.tool === 'order_gift' && (amountCents ?? 0) > 30_000) {
        risk = 'RED';
        reasons.push(reason('RED_BASE', `礼品金额 ${formatMoney(amountCents ?? 0)} 超过 300 元，升级为红色`));
      }
      break;
    }
    case 'unfreeze_card':
    case 'report_loss': {
      risk = 'RED';
      reasons.push(reason('RED_BASE', '卡片挂失 / 解挂属于红色操作，需要人脸 + 短信双重验证'));
      break;
    }
    default: {
      if (baseRisk === 'GREEN') {
        reasons.push(reason('AUTO_QUERY'));
      } else if (baseRisk === 'RED') {
        reasons.push(reason('RED_BASE'));
      } else {
        reasons.push(reason('REVERSIBLE_OP'));
      }
      break;
    }
  }

  // 风控智能体评分：只读账本与会话事实，模型不参与打分
  const { payeeName, note } = payeeAndNote(node);
  const verdict = assessRisk({
    state,
    node,
    amountCents,
    payeeName,
    note,
    usedCentsToday: limit.usedCents,
    ...ctx,
  });
  const staticTier = toolTier(node, amountCents);
  let tier = higherTier(staticTier, verdict.tier);
  let effectiveRisk: Risk = higherRisk(risk, riskFromTier(tier));
  tier = higherTier(tier, tierFromRisk(effectiveRisk));

  for (const signal of verdict.signals.slice(0, 4)) {
    reasons.push(reason(`RISK_${signal.code}`, signal.detail));
  }
  reasons.push(
    reason(
      'TIER_FUSED',
      `静态档 ${staticTier} + 风控档 ${verdict.tier}（评分 ${verdict.score}）→ 执行档 ${tier}`,
    ),
  );

  // 产品额度绝对上限：超出直接拒绝并提示走柜面提额，其余大额一律进入人工审核
  const projectedDaily = limit.usedCents + (amountCents ?? 0);
  if (amountCents && amountCents > TIER_THRESHOLDS_CENTS.singleCeiling) {
    return {
      nodeId: node.id,
      tool: node.tool,
      baseRisk,
      effectiveRisk: 'RED',
      reasons: [
        reason('PRODUCT_CEILING', `单笔 ${formatMoney(amountCents)} 超过产品上限 ${formatMoney(TIER_THRESHOLDS_CENTS.singleCeiling)}`),
        ...reasons,
      ],
      amountCents,
      limit,
      explanation: `单笔金额超过产品额度上限 ${formatMoney(TIER_THRESHOLDS_CENTS.singleCeiling)}，智能体不执行该交易，请通过柜面或提额流程办理。`,
      decision: 'DENY',
      tier: 'T4',
      controls: controlsFor('T4'),
      risk: verdict,
    };
  }
  if (amountCents && projectedDaily > TIER_THRESHOLDS_CENTS.dailyCeiling) {
    return {
      nodeId: node.id,
      tool: node.tool,
      baseRisk,
      effectiveRisk: 'RED',
      reasons: [
        reason('DAILY_CEILING', `本次执行后当日累计 ${formatMoney(projectedDaily)} 超过 ${formatMoney(TIER_THRESHOLDS_CENTS.dailyCeiling)}`),
        ...reasons,
      ],
      amountCents,
      limit,
      explanation: `当日累计将超过产品额度上限 ${formatMoney(TIER_THRESHOLDS_CENTS.dailyCeiling)}，本次交易被拒绝，可次日再发起或走柜面提额。`,
      decision: 'DENY',
      tier: 'T4',
      controls: controlsFor('T4'),
      risk: verdict,
    };
  }

  const controls = controlsFor(tier);
  const decision = decisionForTier(tier, node.tool);
  const signalTexts = verdict.signals.map((s) => s.detail);

  return {
    nodeId: node.id,
    tool: node.tool,
    baseRisk,
    effectiveRisk,
    reasons,
    amountCents,
    limit,
    explanation: explanationFor(tier, signalTexts, amountCents),
    decision,
    tier,
    tierSource: { amount: staticTier, agent: verdict.tier, final: tier },
    controls,
    risk: verdict,
  };
}

function higherRisk(a: Risk, b: Risk): Risk {
  return RISK_RANK[a] >= RISK_RANK[b] ? a : b;
}

function tierFromRisk(risk: Risk): RiskTier {
  if (risk === 'GREEN') return 'T0';
  if (risk === 'YELLOW') return 'T1';
  return 'T3';
}
