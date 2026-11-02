// ---------------------------------------------------------------------------
// 基础枚举与 Agent 协议类型（前后端共享）
// ---------------------------------------------------------------------------

import type { Dispute } from './dispute';
import type { RiskTier, RiskVerdict, SecurityControl } from './riskTiers';

export type Risk = 'GREEN' | 'YELLOW' | 'RED';

export type Intent =
  | 'transfer'
  | 'bills'
  | 'wealth'
  | 'card'
  | 'subscription'
  | 'crossscene'
  | 'account'
  | 'chitchat'
  | 'unknown';

export const INTENT_LABELS: Record<Intent, string> = {
  transfer: '智能转账',
  bills: '账单分析',
  wealth: '理财操作',
  card: '卡片管理',
  subscription: '订阅代扣',
  crossscene: '跨场景联动',
  account: '账户查询',
  chitchat: '闲聊',
  unknown: '未识别',
};

export type FlowState =
  | 'IDLE'
  | 'PARSING'
  | 'PLANNING'
  | 'AWAIT_CONFIRM'
  | 'AWAIT_STEPUP'
  | 'EXECUTING'
  | 'DONE'
  | 'PARTIAL'
  | 'CANCELLED'
  | 'FAILED'
  | 'LOCKED'
  | 'HUMAN_TAKEOVER';

export type NodeStatus =
  | 'PENDING'
  | 'READY'
  | 'RUNNING'
  | 'AWAIT_CONFIRM'
  | 'AWAIT_STEPUP'
  | 'SUCCESS'
  | 'FAILED'
  | 'SKIPPED'
  | 'COMPENSATED'
  | 'MANUAL';

export type ToolName =
  | 'resolve_contact'
  | 'check_limit'
  | 'transfer'
  | 'schedule_transfer'
  | 'split_request'
  | 'fetch_transactions'
  | 'aggregate_bills'
  | 'detect_anomalies'
  | 'sandbox_analyze'
  | 'assess_risk'
  | 'list_products'
  | 'match_products'
  | 'purchase_wealth'
  | 'redeem_wealth'
  | 'list_cards'
  | 'apply_virtual_card'
  | 'adjust_card_limit'
  | 'freeze_card'
  | 'unfreeze_card'
  | 'report_loss'
  | 'scan_subscriptions'
  | 'detect_price_changes'
  | 'cancel_subscription'
  | 'resolve_birthday'
  | 'lock_funds'
  | 'order_gift'
  | 'create_note'
  | 'get_balance'
  | 'list_transactions'
  | 'list_holdings'
  | 'get_txn_detail'
  | 'open_dispute'
  | 'list_schedules'
  | 'cancel_schedule'
  // 内部补偿工具（不进入规划器可选工具集）
  | 'reverse_transfer'
  | 'restore_subscription'
  | 'cancel_gift'
  | 'unlock_funds'
  | 'cancel_virtual_card'
  | 'restore_card_limit'
  | 'restore_card_status';

export type NluSource = 'llm' | 'cache' | 'rules' | 'offline';

export type LlmMode = 'llm' | 'offline';

export interface NluSlots {
  amount?: number | null;
  payee?: string | null;
  phone?: string | null;
  note?: string | null;
  period?: 'currentMonth' | 'lastMonth' | 'year' | null;
  category?: string | null;
  productName?: string | null;
  riskLevel?: 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | null;
  cardAction?: 'list' | 'apply_virtual' | 'adjust_limit' | 'report_loss' | 'freeze' | 'unfreeze' | null;
  cardLast4?: string | null;
  limitAmount?: number | null;
  subscriptionName?: string | null;
  birthdayDate?: string | null;
  budget?: number | null;
  query?: 'balance' | 'transactions' | 'schedules' | 'cancel_schedule' | null;
  /** 账单侧动作：查看单笔详情 / 提交争议申诉 */
  txnAction?: 'detail' | 'dispute' | null;
  /** 定位单笔交易的线索：商户名或金额 */
  txnHint?: string | null;
  disputeReason?: 'duplicate' | 'unauthorized' | 'not_received' | 'amount_wrong' | 'other' | null;
  /** 定位计划任务的线索：标题或时间关键字 */
  scheduleHint?: string | null;
  isScheduled?: boolean | null;
  scheduleDate?: string | null;
  splitNames?: string[] | null;
  splitTotal?: number | null;
  wealthAction?: 'query' | 'purchase' | 'redeem' | 'holdings' | null;
  contactId?: string | null;
  subscriptionId?: string | null;
  cardId?: string | null;
}

export interface ClarifyOption {
  label: string;
  value: string;
  hint?: string;
}

export interface Ambiguity {
  slot: string;
  prompt: string;
  options: ClarifyOption[];
}

export interface NluResult {
  intent: Intent;
  confidence: number;
  slots: NluSlots;
  /** 原始用户语句，供规划器做确定性关键词判断（不用于渲染事实） */
  utterance?: string;
  ambiguity?: Ambiguity | null;
  needsClarification?: boolean;
  clarification?: string | null;
  injectionSuspicion: number;
  references: string[];
  rationale?: string;
  source: NluSource;
  latencyMs?: number;
}

// ---------------------------------------------------------------------------
// 银行仿真领域模型
// ---------------------------------------------------------------------------

export interface Contact {
  id: string;
  name: string;
  bank: string;
  last4: string;
  phoneMasked: string;
  relation: string;
  color: string;
}

export interface UserProfile {
  id: string;
  name: string;
  tier: string;
  phoneMasked: string;
  spouse: { name: string; birthday: string };
  contacts: Contact[];
  riskProfile: {
    level: '保守型' | '稳健型' | '平衡型' | '成长型' | '进取型';
    score: number;
    assessedAt: string;
  };
  preferences: {
    defaultAccountId: string;
    coffeeWeekly: number;
    addressMasked: string;
  };
}

export interface Account {
  id: string;
  name: string;
  bank: string;
  type: 'savings' | 'current' | 'credit';
  last4: string;
  balanceCents: number;
  lockedCents: number;
  availableCents?: number;
  primary: boolean;
  color: string;
}

export interface BankCard {
  id: string;
  accountId?: string;
  type: 'debit' | 'credit' | 'virtual';
  network: '银联' | 'Visa';
  last4: string;
  status: 'active' | 'frozen' | 'lost' | 'cancelled';
  limitCents?: number;
  usedCents?: number;
  expiry: string;
  color: string;
  virtual: boolean;
}

export interface Txn {
  id: string;
  accountId: string;
  ts: string;
  amountCents: number;
  merchant: string;
  category: string;
  channel: string;
  note?: string;
  status: 'posted' | 'reversed';
  anomaly?: boolean;
  anomalyReason?: string;
  location?: string;
}

export interface Subscription {
  id: string;
  merchant: string;
  amountCents: number;
  previousAmountCents?: number;
  cycle: 'monthly' | 'yearly';
  nextChargeAt: string;
  lastChargedAt: string;
  status: 'active' | 'paused' | 'cancelled';
  category: string;
  color: string;
}

export interface WealthProduct {
  id: string;
  name: string;
  issuer: string;
  type: string;
  riskLevel: 'R1' | 'R2' | 'R3' | 'R4' | 'R5';
  yieldPct: number;
  minAmountCents: number;
  termDays: number;
  liquidity: string;
  tags: string[];
  description: string;
  color: string;
}

export interface Holding {
  id: string;
  productId: string;
  amountCents: number;
  purchasedAt: string;
  yieldPct: number;
  floatingPct: number;
  status: 'holding' | 'redeemed';
}

export interface FundLock {
  id: string;
  accountId: string;
  amountCents: number;
  reason: string;
  createdAt: string;
  releaseAt: string;
  status: 'locked' | 'released';
}

export interface GiftOrder {
  id: string;
  type: 'flower' | 'cake';
  merchant: string;
  amountCents: number;
  deliveryAt: string;
  status: 'scheduled' | 'delivered' | 'cancelled';
  note: string;
}

/**
 * 定时转账的可执行载荷。用户在确认单上授权后 authorized=true，
 * 调度器到点才会真正扣款；缺授权的计划只提醒、不动钱。
 */
export interface ScheduledTransferPayload {
  recipients: Array<{
    name: string;
    amountCents: number;
    contactId?: string;
    bank?: string;
    last4?: string;
  }>;
  fromAccountId?: string;
  note?: string;
  authorized: boolean;
  /** 授权来源（runId / 节点），便于审计回溯 */
  authorizationRef?: string;
}

export interface ScheduleItem {
  id: string;
  kind: 'transfer' | 'gift' | 'note' | 'review';
  title: string;
  amountCents?: number;
  executeAt: string;
  status: 'scheduled' | 'done' | 'cancelled' | 'failed';
  detail?: string;
  payload?: ScheduledTransferPayload;
  attempts?: number;
  lastError?: string;
}

/** 应用内提醒：由调度器、风控、工单等真实事件产生 */
export interface AppNotification {
  id: string;
  ts: string;
  kind: 'schedule' | 'budget' | 'gift' | 'note' | 'risk' | 'dispute' | 'review' | 'system';
  title: string;
  body: string;
  read: boolean;
  refId?: string;
  amountCents?: number;
}

// ---------------------------------------------------------------------------
// DAG / 策略 / 会话
// ---------------------------------------------------------------------------

export interface ToolResult {
  ok: boolean;
  data?: any;
  error?: { code: string; message: string };
  evidence?: string[];
  summary?: string;
}

export interface DagNode {
  id: string;
  tool: ToolName;
  label: string;
  args: Record<string, unknown>;
  deps: string[];
  risk: Risk;
  reversible: boolean;
  status: NodeStatus;
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  result?: ToolResult;
  policy?: PolicyDecision;
  riskReasons?: string[];
  compensator?: ToolName;
}

export interface Dag {
  runId: string;
  intent: Intent;
  title: string;
  summary: string;
  nodes: DagNode[];
  createdAt: string;
  /** 命中的业务模板：模型只识别意图与槽位，执行路径由模板决定 */
  template?: { id: string; label: string; steps: string[] };
}

export interface PolicyReason {
  code: string;
  label: string;
  detail?: string;
}

export interface LimitSummary {
  dayKey: string;
  dailyLimitCents: number;
  usedCents: number;
  heldCents: number;
  remainingCents: number;
  reservations: Array<{
    id: string;
    amountCents: number;
    state: 'HELD' | 'COMMITTED' | 'RELEASED';
    expiresAt: string;
    nodeId: string;
  }>;
}

export interface PolicyDecision {
  nodeId: string;
  tool: ToolName;
  baseRisk: Risk;
  effectiveRisk: Risk;
  reasons: PolicyReason[];
  amountCents?: number;
  limit: LimitSummary;
  explanation: string;
  decision: 'ALLOW' | 'CONFIRM' | 'STEPUP' | 'DENY' | 'REVIEW';
  /** 五档安全级别：静态档由金额与操作类型决定，动态档由风控智能体评分决定，取较高档 */
  tier?: RiskTier;
  /** 静态档与动态档的来源，便于控制台解释"为什么升到这一档" */
  tierSource?: { amount: RiskTier; agent: RiskTier; final: RiskTier };
  controls?: SecurityControl[];
  risk?: RiskVerdict;
}

export interface OperationSummary {
  title: string;
  subtitle?: string;
  amountCents?: number;
  payee?: string;
  from?: string;
  rows: Array<{ label: string; value: string; emphasis?: boolean; tone?: 'normal' | 'risk' }>;
  warnings?: string[];
}

export interface DataSourceInfo {
  mode: 'simulated' | 'http';
  provider: string;
  healthy: boolean;
  syncedAt: string | null;
}

export interface StepUpChallenge {
  id: string;
  nodeId: string;
  digest: string;
  methods: Array<'FACE' | 'SMS'>;
  expiresAt: string;
  attemptsLeft: number;
  /** demo：页面内演示；provider：跳转签约的活体核验服务 */
  faceMode?: 'demo' | 'http';
  smsMode?: 'demo' | 'http';
  smsSent?: boolean;
  faceSessionId?: string;
  faceVerifyUrl?: string;
  /** 本机生物识别（WebAuthn）：可用 / 已通过 */
  bioAvailable?: boolean;
  bioVerified?: boolean;
  /** T2 起要求手输收款人姓名；echo 校验通过后才允许进入多因子 */
  payeeEchoRequired?: boolean;
  /** 需要复述的收款人（脱敏展示，如"王*"） */
  payeeMasked?: string;
  payeeEchoVerified?: boolean;
}

export interface PendingAction {
  nodeId: string;
  kind: 'CONFIRM' | 'STEPUP';
  digest: string;
  expiresAt: string;
  policy: PolicyDecision;
  summary: OperationSummary;
  challenge?: StepUpChallenge;
  /** 黄色批量确认：同一计划内一起展示、一起授权的节点 */
  batchNodeIds?: string[];
  /** T2 起要求手输收款人姓名；服务端只下发脱敏值，比对在服务端完成 */
  payeeEcho?: { required: boolean; masked?: string };
}

export interface ContextStack {
  lastIntent?: Intent;
  lastPayee?: string;
  lastPayeeBank?: string;
  lastAmountCents?: number;
  lastTxnIds?: string[];
  lastProduct?: string;
  lastPeriod?: string;
  spouseName: string;
  spouseBirthday: string;
  references: Array<{ at: string; utterance: string; resolved: Record<string, string> }>;
}

export interface RunSummary {
  runId: string;
  intent: Intent;
  title: string;
  status: FlowState;
  startedAt: string;
  finishedAt?: string;
  nodeCount: number;
  riskCounts: Record<Risk, number>;
  reversible: boolean;
  auditStartSeq?: number;
}

export interface Card {
  type: string;
  [key: string]: any;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text?: string;
  card?: Card;
  ts: string;
  evidence?: string[];
  meta?: {
    intent?: Intent;
    risk?: Risk;
    blocked?: boolean;
    source?: NluSource;
    runId?: string;
    tone?: 'normal' | 'warning' | 'success' | 'danger';
  };
}

export interface SessionPublic {
  id: string;
  state: FlowState;
  messages: ChatMessage[];
  dag: Dag | null;
  pending: PendingAction | null;
  context: ContextStack;
  runs: RunSummary[];
  llmMode: LlmMode;
  takeover: boolean;
  updatedAt: string;
  pendingRemainingMs?: number;
}

// ---------------------------------------------------------------------------
// 指标 / 审计
// ---------------------------------------------------------------------------

export interface LlmStats {
  enabled: boolean;
  mode: LlmMode;
  model: string;
  calls: number;
  failures: number;
  cacheHits: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  avgLatencyMs: number;
  lastLatencyMs: number;
  lastSource: NluSource | null;
  estimatedCostCents: number;
}

export interface GuardStats {
  rendered: number;
  numbersChecked: number;
  numbersBlocked: number;
  injectionBlocked: number;
  lastGuardAt: string | null;
}

export interface BreakerState {
  failures: number;
  injectionHits: number;
  lockedUntil: string | null;
}

export interface AuthUserPublic {
  id: string;
  name: string;
  phoneMasked: string;
  spouseName: string;
  spouseBirthday: string;
  riskLevel: UserProfile['riskProfile']['level'];
  tier: string;
  isGuest: boolean;
  createdAt: string;
}

export interface AuditEntry {
  seq: number;
  ts: string;
  type: string;
  summary: string;
  hash: string;
  prevHash: string;
  sessionId?: string;
  runId?: string;
  userId?: string;
  payload?: any;
}

export interface AuditVerification {
  ok: boolean;
  count: number;
  head: string;
  checkpointCount: number;
  errors: string[];
  verifiedAt: string;
}

export interface StatsPayload {
  llm: LlmStats;
  guard: GuardStats;
  breaker: BreakerState;
  sessions: number;
  audit: { count: number; head: string; checkpointCount: number; verification: AuditVerification };
  demoNow: string;
}

export interface UserPublic {
  name: string;
  tier: string;
  phoneMasked: string;
  spouseName: string;
  spouseBirthday: string;
  riskProfile: UserProfile['riskProfile'];
}

export interface AccountPublic {
  id: string;
  name: string;
  bank: string;
  type: Account['type'];
  last4: string;
  balanceCents: number;
  lockedCents: number;
  availableCents?: number;
  primary: boolean;
  color: string;
}

export interface SnapshotPayload {
  session: SessionPublic;
  user: UserPublic;
  accounts: AccountPublic[];
  cards: BankCard[];
  limits: LimitSummary;
  stats: StatsPayload;
  demoNow: string;
  dailyLimitCents: number;
  dataSource?: DataSourceInfo;
}

export interface OverviewTxn {
  id: string;
  ts: string;
  amountCents: number;
  merchant: string;
  category: string;
  channel: string;
  accountId: string;
  anomaly?: boolean;
}

export interface OverviewPayload {
  user: UserPublic & { authUserId: string; isGuest: boolean };
  accounts: AccountPublic[];
  cards: BankCard[];
  recentTransactions: OverviewTxn[];
  month: {
    label: string;
    expenseCents: number;
    incomeCents: number;
    anomalyCount: number;
    transactionCount: number;
    categories: Array<{ name: string; amountCents: number; ratio: number }>;
  };
  subscriptions: { activeCount: number; monthlyCents: number; nextChargeAt: string | null };
  holdings: { count: number; valueCents: number; productNames: string[] };
  limits: LimitSummary;
  risk?: {
    profile: UserProfile['riskProfile'];
    maxProductRisk: 'R1' | 'R2' | 'R3' | 'R4' | 'R5';
    expired: boolean;
  };
  notifications?: { unreadCount: number; latest: AppNotification[] };
  plans?: { scheduled: ScheduleItem[]; lockedCents: number };
  audit: { count: number; verified: boolean; head: string };
  demoNow: string;
  todayLabel?: string;
  sessionCount?: number;
  quickPrompts: string[];
  capabilities: Array<{ intent: Intent; label: string; example: string }>;
  dataSource?: DataSourceInfo;
}

export interface TransactionListPayload {
  periodLabel: string;
  period: 'currentMonth' | 'lastMonth' | 'year';
  items: OverviewTxn[];
  total: number;
  expenseCents: number;
  incomeCents: number;
}

export interface TxnDetailPayload {
  txn: Txn;
  account: { id: string; name: string; bank: string; type: string; last4: string } | null;
  subscription: Pick<Subscription, 'id' | 'merchant' | 'cycle' | 'amountCents' | 'nextChargeAt' | 'status'> | null;
  product: { id: string; name: string; type: string; riskLevel: string } | null;
  /** 同日同商户同金额的疑似重复扣费 */
  similar: Array<{ id: string; ts: string; amountCents: number; merchant: string }>;
  dispute: Dispute | null;
  disputeEligible: { ok: boolean; code?: string; message?: string };
  dataSource?: DataSourceInfo;
}

export interface DisputeListPayload {
  items: Dispute[];
  openCount: number;
}

export interface BootstrapPayload extends SnapshotPayload {
  quickPrompts: string[];
  capabilities: Array<{ intent: Intent; label: string; example: string }>;
  brand: { name: string; nameEn: string; product: string; slogan: string; monogram: string };
}

// ---------------------------------------------------------------------------
// SSE 事件
// ---------------------------------------------------------------------------

export type StreamEventType =
  | 'run.start'
  | 'nlu.result'
  | 'injection.flag'
  | 'plan.ready'
  | 'node.state'
  | 'policy.decision'
  | 'run.paused'
  | 'stepup.challenge'
  | 'stepup.result'
  | 'render.card'
  | 'message.final'
  | 'breaker.tripped'
  | 'takeover.required'
  | 'audit.appended'
  | 'run.end';

export interface StreamEvent<T = any> {
  seq: number;
  ts: string;
  type: StreamEventType;
  sessionId: string;
  runId?: string;
  data: T;
}

export interface ApiError {
  ok: false;
  code: string;
  message: string;
}
