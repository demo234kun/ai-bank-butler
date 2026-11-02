/**
 * 业务模板库：语义理解只负责"识别意图 + 抽槽位"，执行路径由这里的预置模板决定。
 * 每个模板声明：需要的槽位、节点步骤与依赖顺序。规划器按意图与槽位选择模板，
 * 补齐参数后交给 DAG 执行器；模型不生成调用链。
 */
import type { Intent, NluSlots } from './types';

export type BusinessTemplateId =
  | 'transfer.instant'
  | 'transfer.scheduled'
  | 'transfer.split'
  | 'bills.report'
  | 'wealth.advice'
  | 'wealth.purchase'
  | 'wealth.redeem'
  | 'card.list'
  | 'card.apply_virtual'
  | 'card.adjust_limit'
  | 'card.freeze'
  | 'card.unfreeze'
  | 'card.report_loss'
  | 'subscription.scan'
  | 'subscription.cancel'
  | 'crossscene.birthday'
  | 'account.balance'
  | 'account.transactions';

export interface BusinessTemplate {
  id: BusinessTemplateId;
  label: string;
  intent: Intent;
  /** 缺一不可的参数；缺失时先澄清，不执行 */
  requiredSlots: Array<keyof NluSlots>;
  /** 可选参数，缺省时由模板给默认值 */
  optionalSlots?: Array<keyof NluSlots>;
  /** 节点步骤（展示用；实际参数由规划器按模板填充） */
  steps: string[];
  /** 失败处理策略：重试次数与是否可转人工 */
  onFailure: { retries: number; manualTakeover: boolean };
}

export const BUSINESS_TEMPLATES: Record<BusinessTemplateId, BusinessTemplate> = {
  'transfer.instant': {
    id: 'transfer.instant',
    label: '即时转账',
    intent: 'transfer',
    requiredSlots: ['payee', 'amount'],
    optionalSlots: ['note', 'phone'],
    steps: ['解析收款人', '校验限额与风控', '转账提交', '生成回执'],
    onFailure: { retries: 2, manualTakeover: true },
  },
  'transfer.scheduled': {
    id: 'transfer.scheduled',
    label: '定时转账',
    intent: 'transfer',
    requiredSlots: ['payee', 'amount', 'scheduleDate'],
    steps: ['解析收款人', '校验限额与风控', '创建定时计划'],
    onFailure: { retries: 1, manualTakeover: true },
  },
  'transfer.split': {
    id: 'transfer.split',
    label: '拆分 AA 收款',
    intent: 'transfer',
    requiredSlots: ['splitNames', 'splitTotal'],
    steps: ['解析参与人', '校验金额与限额', '发起 AA 收款'],
    onFailure: { retries: 1, manualTakeover: true },
  },
  'bills.report': {
    id: 'bills.report',
    label: '账单分析',
    intent: 'bills',
    requiredSlots: [],
    optionalSlots: ['period', 'category'],
    steps: ['读取流水', '分类汇总', '异常识别', '沙箱洞察'],
    onFailure: { retries: 1, manualTakeover: false },
  },
  'wealth.advice': {
    id: 'wealth.advice',
    label: '理财推荐',
    intent: 'wealth',
    requiredSlots: [],
    optionalSlots: ['amount', 'riskLevel', 'productName'],
    steps: ['读取风险测评', '读取在售产品', '匹配产品'],
    onFailure: { retries: 1, manualTakeover: false },
  },
  'wealth.purchase': {
    id: 'wealth.purchase',
    label: '理财申购',
    intent: 'wealth',
    requiredSlots: ['amount'],
    optionalSlots: ['productName', 'riskLevel'],
    steps: ['读取风险测评', '读取在售产品', '匹配产品', '申购确认与执行'],
    onFailure: { retries: 0, manualTakeover: true },
  },
  'wealth.redeem': {
    id: 'wealth.redeem',
    label: '理财赎回',
    intent: 'wealth',
    requiredSlots: [],
    optionalSlots: ['productName', 'amount'],
    steps: ['读取持仓', '赎回确认与执行'],
    onFailure: { retries: 0, manualTakeover: true },
  },
  'card.list': {
    id: 'card.list',
    label: '卡片总览',
    intent: 'card',
    requiredSlots: [],
    steps: ['读取卡片与额度'],
    onFailure: { retries: 1, manualTakeover: false },
  },
  'card.apply_virtual': {
    id: 'card.apply_virtual',
    label: '申请虚拟卡',
    intent: 'card',
    requiredSlots: [],
    optionalSlots: ['limitAmount'],
    steps: ['读取现有卡片', '申请虚拟卡'],
    onFailure: { retries: 0, manualTakeover: true },
  },
  'card.adjust_limit': {
    id: 'card.adjust_limit',
    label: '调整卡片额度',
    intent: 'card',
    requiredSlots: ['limitAmount'],
    optionalSlots: ['cardLast4'],
    steps: ['读取卡片', '调整额度'],
    onFailure: { retries: 0, manualTakeover: true },
  },
  'card.freeze': {
    id: 'card.freeze',
    label: '临时冻结卡片',
    intent: 'card',
    requiredSlots: ['cardLast4'],
    steps: ['读取卡片', '冻结'],
    onFailure: { retries: 0, manualTakeover: true },
  },
  'card.unfreeze': {
    id: 'card.unfreeze',
    label: '解除冻结',
    intent: 'card',
    requiredSlots: ['cardLast4'],
    steps: ['读取卡片', '解冻'],
    onFailure: { retries: 0, manualTakeover: true },
  },
  'card.report_loss': {
    id: 'card.report_loss',
    label: '挂失卡片',
    intent: 'card',
    requiredSlots: ['cardLast4'],
    steps: ['读取卡片', '挂失'],
    onFailure: { retries: 0, manualTakeover: true },
  },
  'subscription.scan': {
    id: 'subscription.scan',
    label: '订阅扫描',
    intent: 'subscription',
    requiredSlots: [],
    steps: ['扫描订阅', '识别涨价'],
    onFailure: { retries: 1, manualTakeover: false },
  },
  'subscription.cancel': {
    id: 'subscription.cancel',
    label: '取消订阅',
    intent: 'subscription',
    requiredSlots: [],
    optionalSlots: ['subscriptionName'],
    steps: ['匹配订阅', '取消自动续费'],
    onFailure: { retries: 1, manualTakeover: true },
  },
  'crossscene.birthday': {
    id: 'crossscene.birthday',
    label: '生日联动规划',
    intent: 'crossscene',
    requiredSlots: ['birthdayDate'],
    optionalSlots: ['budget'],
    steps: ['解析日期', '锁定预算', '订购鲜花', '订购蛋糕', '写入日程'],
    onFailure: { retries: 1, manualTakeover: true },
  },
  'account.balance': {
    id: 'account.balance',
    label: '账户余额',
    intent: 'account',
    requiredSlots: [],
    steps: ['读取账户余额'],
    onFailure: { retries: 1, manualTakeover: false },
  },
  'account.transactions': {
    id: 'account.transactions',
    label: '交易流水',
    intent: 'account',
    requiredSlots: [],
    optionalSlots: ['period', 'category'],
    steps: ['查询交易流水'],
    onFailure: { retries: 1, manualTakeover: false },
  },
};

/** 意图 + 槽位 → 模板。纯函数，便于单测与回放。 */
export function selectTemplate(intent: Intent, slots: NluSlots, text = ''): BusinessTemplateId {
  switch (intent) {
    case 'transfer':
      if (slots.splitNames?.length) return 'transfer.split';
      if (slots.isScheduled || /定时|预约|每月|明天|后天|下周/.test(text)) return 'transfer.scheduled';
      return 'transfer.instant';
    case 'bills':
      return 'bills.report';
    case 'wealth':
      if (slots.wealthAction === 'purchase') return 'wealth.purchase';
      if (slots.wealthAction === 'redeem') return 'wealth.redeem';
      return 'wealth.advice';
    case 'card': {
      const action = slots.cardAction ?? 'list';
      if (action === 'apply_virtual') return 'card.apply_virtual';
      if (action === 'adjust_limit') return 'card.adjust_limit';
      if (action === 'freeze') return 'card.freeze';
      if (action === 'unfreeze') return 'card.unfreeze';
      if (action === 'report_loss') return 'card.report_loss';
      return 'card.list';
    }
    case 'subscription':
      return /取消|关掉|停掉|退订/.test(text) || slots.subscriptionName ? 'subscription.cancel' : 'subscription.scan';
    case 'crossscene':
      return 'crossscene.birthday';
    case 'account':
      return slots.query === 'transactions' ? 'account.transactions' : 'account.balance';
    default:
      return 'account.balance';
  }
}
