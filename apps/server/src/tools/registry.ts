import type { ToolName } from '@bank/shared';
import { getBalanceTool, listTransactionsTool } from './account';
import {
  aggregateBillsTool,
  detectAnomaliesTool,
  fetchTransactionsTool,
  sandboxAnalyzeTool,
} from './bills';
import { adjustCardLimitTool, applyVirtualCardTool, freezeCardTool, listCardsTool, reportLossTool, unfreezeCardTool } from './card';
import { createNoteTool, lockFundsTool, orderGiftTool, resolveBirthdayTool } from './crossscene';
import { scanSubscriptionsTool, cancelSubscriptionTool, detectPriceChangesTool } from './subscription';
import { checkLimitTool, resolveContactTool, scheduleTransferTool, splitRequestTool, transferTool } from './transfer';
import type { ToolMeta } from './types';
import { assessRiskTool, listProductsTool, matchProductsTool, purchaseWealthTool, redeemWealthTool } from './wealth';

const META: ToolMeta[] = [
  {
    name: 'resolve_contact',
    label: '解析联系人',
    description: '按姓名或手机号匹配收款人，识别同名歧义',
    baseRisk: 'GREEN',
    reversible: false,
    group: 'transfer',
  },
  {
    name: 'check_limit',
    label: '检查限额',
    description: '读取当日小额转账剩余额度',
    baseRisk: 'GREEN',
    reversible: false,
    group: 'transfer',
  },
  {
    name: 'transfer',
    label: '转账提交',
    description: '从账户转出资金，生成交易流水',
    baseRisk: 'YELLOW',
    reversible: true,
    group: 'transfer',
    compensator: 'reverse_transfer',
  },
  {
    name: 'schedule_transfer',
    label: '创建定时转账',
    description: '创建未来执行的转账计划',
    baseRisk: 'YELLOW',
    reversible: true,
    group: 'transfer',
  },
  {
    name: 'split_request',
    label: '发起 AA 收款',
    description: '按人数拆分账单并向联系人发起收款',
    baseRisk: 'YELLOW',
    reversible: true,
    group: 'transfer',
  },
  {
    name: 'fetch_transactions',
    label: '读取流水',
    description: '按周期读取账户交易流水',
    baseRisk: 'GREEN',
    reversible: false,
    group: 'bills',
  },
  {
    name: 'aggregate_bills',
    label: '分类聚合',
    description: '按消费分类聚合并与上期对比',
    baseRisk: 'GREEN',
    reversible: false,
    group: 'bills',
  },
  {
    name: 'detect_anomalies',
    label: '异常检测',
    description: '识别凌晨大额、重复扣费、异常地点等可疑交易',
    baseRisk: 'GREEN',
    reversible: false,
    group: 'bills',
  },
  {
    name: 'sandbox_analyze',
    label: '沙箱分析',
    description: '在受限沙箱内运行统计脚本，输出消费洞察',
    baseRisk: 'GREEN',
    reversible: false,
    group: 'bills',
  },
  {
    name: 'assess_risk',
    label: '风险测评读取',
    description: '读取用户风险承受能力评估',
    baseRisk: 'GREEN',
    reversible: false,
    group: 'wealth',
  },
  {
    name: 'list_products',
    label: '产品列表',
    description: '读取在售理财产品',
    baseRisk: 'GREEN',
    reversible: false,
    group: 'wealth',
  },
  {
    name: 'match_products',
    label: '产品匹配',
    description: '按风险偏好、金额和期限匹配产品',
    baseRisk: 'GREEN',
    reversible: false,
    group: 'wealth',
  },
  {
    name: 'purchase_wealth',
    label: '理财申购',
    description: '申购理财产品，扣减账户资金',
    baseRisk: 'RED',
    reversible: false,
    group: 'wealth',
  },
  {
    name: 'redeem_wealth',
    label: '理财赎回',
    description: '赎回理财持仓，资金回到账户',
    baseRisk: 'RED',
    reversible: false,
    group: 'wealth',
  },
  {
    name: 'list_cards',
    label: '卡片列表',
    description: '读取卡片、额度与状态',
    baseRisk: 'GREEN',
    reversible: false,
    group: 'card',
  },
  {
    name: 'apply_virtual_card',
    label: '申请虚拟卡',
    description: '申请一张可控额度的虚拟卡',
    baseRisk: 'YELLOW',
    reversible: true,
    group: 'card',
    compensator: 'cancel_virtual_card',
  },
  {
    name: 'adjust_card_limit',
    label: '调整额度',
    description: '调整卡片交易额度',
    baseRisk: 'YELLOW',
    reversible: true,
    group: 'card',
    compensator: 'restore_card_limit',
  },
  {
    name: 'freeze_card',
    label: '临时冻结',
    description: '临时冻结卡片交易',
    baseRisk: 'YELLOW',
    reversible: true,
    group: 'card',
    compensator: 'restore_card_status',
  },
  {
    name: 'unfreeze_card',
    label: '解除冻结',
    description: '解除卡片冻结状态',
    baseRisk: 'RED',
    reversible: true,
    group: 'card',
    compensator: 'restore_card_status',
  },
  {
    name: 'report_loss',
    label: '卡片挂失',
    description: '挂失卡片并停止全部交易',
    baseRisk: 'RED',
    reversible: false,
    group: 'card',
  },
  {
    name: 'scan_subscriptions',
    label: '扫描订阅',
    description: '识别自动续费、重复扣费与下次扣款日',
    baseRisk: 'GREEN',
    reversible: false,
    group: 'subscription',
  },
  {
    name: 'detect_price_changes',
    label: '识别涨价',
    description: '识别订阅价格变化',
    baseRisk: 'GREEN',
    reversible: false,
    group: 'subscription',
  },
  {
    name: 'cancel_subscription',
    label: '取消订阅',
    description: '取消自动续费代扣',
    baseRisk: 'YELLOW',
    reversible: true,
    group: 'subscription',
    compensator: 'restore_subscription',
  },
  {
    name: 'resolve_birthday',
    label: '解析生日',
    description: '计算家人生日与 T-2 / T-1 日期',
    baseRisk: 'GREEN',
    reversible: false,
    group: 'crossscene',
  },
  {
    name: 'lock_funds',
    label: '锁定活期预算',
    description: '锁定活期资金，避免提前花掉',
    baseRisk: 'YELLOW',
    reversible: true,
    group: 'crossscene',
    compensator: 'unlock_funds',
  },
  {
    name: 'order_gift',
    label: '预约礼物',
    description: '预约鲜花 / 蛋糕配送',
    baseRisk: 'YELLOW',
    reversible: true,
    group: 'crossscene',
    compensator: 'cancel_gift',
  },
  {
    name: 'create_note',
    label: '写入日程',
    description: '写入生日提醒日程',
    baseRisk: 'GREEN',
    reversible: true,
    group: 'crossscene',
  },
  {
    name: 'get_balance',
    label: '查询余额',
    description: '读取账户余额与可用资金',
    baseRisk: 'GREEN',
    reversible: false,
    group: 'account',
  },
  {
    name: 'list_transactions',
    label: '查询流水',
    description: '按周期和分类查询交易流水',
    baseRisk: 'GREEN',
    reversible: false,
    group: 'account',
  },
];

const HANDLERS: Partial<Record<ToolName, import('./types').ToolHandler>> = {
  resolve_contact: resolveContactTool,
  check_limit: checkLimitTool,
  transfer: transferTool,
  schedule_transfer: scheduleTransferTool,
  split_request: splitRequestTool,
  fetch_transactions: fetchTransactionsTool,
  aggregate_bills: aggregateBillsTool,
  detect_anomalies: detectAnomaliesTool,
  sandbox_analyze: sandboxAnalyzeTool,
  assess_risk: assessRiskTool,
  list_products: listProductsTool,
  match_products: matchProductsTool,
  purchase_wealth: purchaseWealthTool,
  redeem_wealth: redeemWealthTool,
  list_cards: listCardsTool,
  apply_virtual_card: applyVirtualCardTool,
  adjust_card_limit: adjustCardLimitTool,
  freeze_card: freezeCardTool,
  unfreeze_card: unfreezeCardTool,
  report_loss: reportLossTool,
  scan_subscriptions: scanSubscriptionsTool,
  detect_price_changes: detectPriceChangesTool,
  cancel_subscription: cancelSubscriptionTool,
  resolve_birthday: resolveBirthdayTool,
  lock_funds: lockFundsTool,
  order_gift: orderGiftTool,
  create_note: createNoteTool,
  get_balance: getBalanceTool,
  list_transactions: listTransactionsTool,
};

export const TOOL_META = new Map<ToolName, ToolMeta>(META.map((m) => [m.name, m]));

/** 这些工具只读写本地身份/日程，不依赖银行核心，断网也可用。 */
const LOCAL_ONLY_TOOLS = new Set<ToolName>([
  'resolve_contact',
  'check_limit',
  'resolve_birthday',
  'create_note',
]);

export function usesBankData(name: ToolName): boolean {
  return !LOCAL_ONLY_TOOLS.has(name);
}

export function toolMeta(name: ToolName): ToolMeta {
  const meta = TOOL_META.get(name);
  if (!meta) throw new Error(`Unknown tool meta: ${name}`);
  return meta;
}

export function toolHandler(name: ToolName) {
  const handler = HANDLERS[name];
  if (!handler) throw new Error(`No handler for tool ${name}`);
  return handler;
}

export function plannerToolCatalog(): Array<{ name: ToolName; label: string; risk: string; description: string }> {
  return META.filter((m) => !m.internal).map((m) => ({
    name: m.name,
    label: m.label,
    risk: m.baseRisk,
    description: m.description,
  }));
}
