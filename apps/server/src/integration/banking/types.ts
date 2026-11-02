import type {
  Account,
  AppNotification,
  BankCard,
  Dispute,
  ScheduledTransferPayload,
  DisputeReason,
  FundLock,
  GiftOrder,
  Holding,
  ScheduleItem,
  Subscription,
  Txn,
  WealthProduct,
} from '@bank/shared';

export type BankMode = 'simulated' | 'http';

export interface BankSyncInfo {
  mode: BankMode;
  provider: string;
  healthy: boolean;
  syncedAt: string | null;
  error?: string;
}

export interface BankSnapshot {
  accounts?: Account[];
  cards?: BankCard[];
  transactions?: Txn[];
  subscriptions?: Subscription[];
  products?: WealthProduct[];
  holdings?: Holding[];
  fundLocks?: FundLock[];
  giftOrders?: GiftOrder[];
  schedules?: ScheduleItem[];
  disputes?: Dispute[];
  notifications?: AppNotification[];
}

export interface TransferRecipient {
  name: string;
  amountCents: number;
  contactId?: string;
  bank?: string;
  last4?: string;
}

export interface TransferOutcome {
  txns: Txn[];
  totalCents: number;
  account: Account;
  recipients: TransferRecipient[];
}

export interface ReverseTransferOutcome {
  creditCents: number;
  reversal: Txn;
  originals: Txn[];
}

export interface WealthPurchaseOutcome {
  holding: Holding;
  txn: Txn;
  account: Account;
}

export interface WealthRedeemOutcome {
  amountCents: number;
  txn: Txn;
  account: Account;
  holding: Holding;
}

export interface FundLockOutcome {
  lock: FundLock;
  account: Account;
}

export interface GiftOrderOutcome {
  order: GiftOrder;
  account: Account;
  txn: Txn;
}

export interface CardLimitOutcome {
  card: BankCard;
  previousLimitCents: number;
}

export interface CardStatusOutcome {
  card: BankCard;
  previousStatus: BankCard['status'];
}

export interface SubscriptionCancelOutcome {
  subscription: Subscription;
  previousStatus: Subscription['status'];
}

export interface SplitRequestOutcome {
  requestId: string;
  totalCents: number;
  myShareCents: number;
  shares: Array<{ name: string; amountCents: number; status: string }>;
  createdAt: string;
  note?: string;
}

export interface TransferInput {
  fromAccountId?: string;
  recipients: TransferRecipient[];
  note?: string;
}

export interface WealthPurchaseInput {
  product: WealthProduct;
  amountCents: number;
  fromAccountId?: string;
}

export interface WealthRedeemInput {
  holding: Holding;
  product: WealthProduct;
  amountCents: number;
  toAccountId?: string;
}

export interface LockFundsInput {
  accountId?: string;
  amountCents: number;
  reason: string;
  releaseAt: string;
}

export interface GiftOrderInput {
  type: 'flower' | 'cake';
  merchant: string;
  amountCents: number;
  deliveryAt: string;
  note: string;
  fromAccountId?: string;
}

export interface VirtualCardInput {
  limitCents: number;
  network?: '银联' | 'Visa';
}

export interface ScheduleInput {
  kind: ScheduleItem['kind'];
  title: string;
  amountCents?: number;
  executeAt: string;
  detail?: string;
  /** 定时转账的执行载荷；银行核心需原样回传，调度器才会到点执行 */
  payload?: ScheduledTransferPayload;
}

export interface SplitRequestInput {
  totalCents: number;
  names: string[];
  note?: string;
}

export interface DisputeInput {
  txn: Txn;
  reason: DisputeReason;
  note?: string;
  channel: Dispute['channel'];
}

/**
 * 银行核心网关。simulated 仅用于本地演示；
 * http 模式下所有读写都走签约上游，错误直接上抛，不做静默仿真回退。
 */
export interface BankingGateway {
  readonly mode: BankMode;
  readonly provider: string;
  status(userId: string): BankSyncInfo;
  sync(userId: string, options?: { force?: boolean; tolerant?: boolean }): Promise<BankSyncInfo>;

  transfer(userId: string, input: TransferInput, idempotencyKey: string): Promise<TransferOutcome>;
  reverseTransfer(
    userId: string,
    txnIds: string[],
    idempotencyKey: string,
  ): Promise<ReverseTransferOutcome>;

  purchaseWealth(
    userId: string,
    input: WealthPurchaseInput,
    idempotencyKey: string,
  ): Promise<WealthPurchaseOutcome>;
  redeemWealth(
    userId: string,
    input: WealthRedeemInput,
    idempotencyKey: string,
  ): Promise<WealthRedeemOutcome>;

  applyVirtualCard(
    userId: string,
    input: VirtualCardInput,
    idempotencyKey: string,
  ): Promise<BankCard>;
  cancelVirtualCard(userId: string, cardId: string, idempotencyKey: string): Promise<BankCard>;
  adjustCardLimit(
    userId: string,
    input: { cardId: string; limitCents: number },
    idempotencyKey: string,
  ): Promise<CardLimitOutcome>;
  setCardStatus(
    userId: string,
    input: { cardId: string; status: BankCard['status'] },
    idempotencyKey: string,
  ): Promise<CardStatusOutcome>;

  cancelSubscription(
    userId: string,
    subscriptionId: string,
    idempotencyKey: string,
  ): Promise<SubscriptionCancelOutcome>;
  restoreSubscription(
    userId: string,
    subscriptionId: string,
    previousStatus: Subscription['status'],
    idempotencyKey: string,
  ): Promise<Subscription>;

  createSchedule(
    userId: string,
    input: ScheduleInput,
    idempotencyKey: string,
  ): Promise<ScheduleItem>;
  cancelSchedule(
    userId: string,
    scheduleId: string,
    idempotencyKey: string,
  ): Promise<ScheduleItem>;

  lockFunds(
    userId: string,
    input: LockFundsInput,
    idempotencyKey: string,
  ): Promise<FundLockOutcome>;
  unlockFunds(userId: string, lockId: string, idempotencyKey: string): Promise<FundLockOutcome>;

  orderGift(
    userId: string,
    input: GiftOrderInput,
    idempotencyKey: string,
  ): Promise<GiftOrderOutcome>;
  cancelGift(userId: string, orderId: string, idempotencyKey: string): Promise<GiftOrderOutcome>;

  createSplitRequest(
    userId: string,
    input: SplitRequestInput,
    idempotencyKey: string,
  ): Promise<SplitRequestOutcome>;
  cancelSplitRequest(userId: string, requestId: string, idempotencyKey: string): Promise<void>;

  /** 交易争议受理：只提交申诉，账务结论由银行核心给出 */
  openDispute(userId: string, input: DisputeInput, idempotencyKey: string): Promise<Dispute>;
  /** 拉取上游最新工单状态；simulated 直接返回本地工单 */
  refreshDisputes(userId: string): Promise<Dispute[]>;
}
