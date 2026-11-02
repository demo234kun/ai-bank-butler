import {
  DAILY_TRANSFER_LIMIT_CENTS,
  HARD_BLOCK_CENTS,
  HIGH_VALUE_CENTS,
  POLICY_REASON_TEXT,
  formatMoney,
  type DagNode,
  type PolicyDecision,
  type PolicyReason,
  type Risk,
} from '@bank/shared';
import { isLocked } from '../security/breaker';
import type { BankState } from '../core/state';
import { getLimitSummary } from './limits';

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

function decisionFor(risk: Risk): PolicyDecision['decision'] {
  return risk === 'GREEN' ? 'ALLOW' : risk === 'YELLOW' ? 'CONFIRM' : 'STEPUP';
}

export function evaluateNode(state: BankState, node: DagNode): PolicyDecision {
  const limit = getLimitSummary(state);
  const amountCents = amountOf(node);
  const baseRisk = node.risk;
  const reasons: PolicyReason[] = [];
  let risk = baseRisk;
  let denied = false;

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
      if (amount > HARD_BLOCK_CENTS) {
        reasons.push(reason('HARD_LIMIT', `金额 ${formatMoney(amount)} 超过演示硬限额 50000 元`));
        denied = true;
      } else if (amount <= limit.remainingCents) {
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
      if (risk !== 'GREEN') reasons.push(reason('REVERSIBLE_OP'));
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

  if (denied) {
    return {
      nodeId: node.id,
      tool: node.tool,
      baseRisk,
      effectiveRisk: 'RED',
      reasons,
      amountCents,
      limit,
      explanation: reasons.map((r) => r.detail ?? r.label).join('；'),
      decision: 'DENY',
    };
  }

  const effectiveRisk = RISK_RANK[risk] < RISK_RANK[baseRisk] ? baseRisk : risk;

  return {
    nodeId: node.id,
    tool: node.tool,
    baseRisk,
    effectiveRisk,
    reasons,
    amountCents,
    limit,
    explanation: reasons
      .map((r) => r.detail ?? r.label)
      .slice(0, 3)
      .join('；'),
    decision: decisionFor(effectiveRisk),
  };
}
