import type { Account, BankCard, Dispute, Holding, ScheduleItem, Subscription, Txn, WealthProduct } from '@bank/shared';
import { clock } from '../../core/clock';
import { getState, persist } from '../../core/store';
import { externalRefFor } from '../ids';
import { IntegrationError, SignedHttpClient } from '../httpClient';
import { applyBankSnapshot, parseBankSnapshot } from './snapshot';
import type {
  BankSyncInfo,
  BankingGateway,
  CardLimitOutcome,
  CardStatusOutcome,
  DisputeInput,
  FundLockOutcome,
  GiftOrderInput,
  GiftOrderOutcome,
  LockFundsInput,
  ReverseTransferOutcome,
  ScheduleInput,
  SplitRequestInput,
  SplitRequestOutcome,
  SubscriptionCancelOutcome,
  TransferInput,
  TransferOutcome,
  VirtualCardInput,
  WealthPurchaseInput,
  WealthPurchaseOutcome,
  WealthRedeemInput,
  WealthRedeemOutcome,
} from './types';

export interface HttpBankingOptions {
  baseUrl: string;
  appId: string;
  appSecret: string;
  provider?: string;
  timeoutMs?: number;
  retries?: number;
  syncTtlMs?: number;
  txnLimit?: number;
  circuitFailures?: number;
  circuitCooldownMs?: number;
  client?: SignedHttpClient;
}

function asRecord(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new IntegrationError('BANK_BAD_RESPONSE', `银行核心返回的 ${label} 格式不正确`);
  }
  return value as Record<string, any>;
}

function readIds(data: Record<string, any>, key: string): string[] {
  const value = data[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * 通过签约银行核心网关读写真实账户。
 *
 * 上游契约见 docs/banking-integration.md 与 docs/openapi-banking.yaml。
 * 任何网络/协议/业务错误都会显式上抛，不会回退成本地合成数据。
 */
export class HttpBankingGateway implements BankingGateway {
  readonly mode = 'http' as const;
  readonly provider: string;
  private readonly client: SignedHttpClient;
  private readonly syncTtlMs: number;
  private readonly txnLimit: number;
  private readonly statusByUser = new Map<string, BankSyncInfo>();
  private readonly inFlight = new Map<string, Promise<BankSyncInfo>>();
  private readonly hydrated = new Set<string>();

  constructor(options: HttpBankingOptions) {
    this.provider = options.provider ?? '合作银行核心';
    this.syncTtlMs = options.syncTtlMs ?? 2500;
    this.txnLimit = options.txnLimit ?? 600;
    this.client =
      options.client ??
      new SignedHttpClient({
        baseUrl: options.baseUrl,
        appId: options.appId,
        appSecret: options.appSecret,
        timeoutMs: options.timeoutMs,
        retries: options.retries,
        circuitFailures: options.circuitFailures,
        circuitCooldownMs: options.circuitCooldownMs,
      });
  }

  status(userId: string): BankSyncInfo {
    return (
      this.statusByUser.get(userId) ?? {
        mode: this.mode,
        provider: this.provider,
        healthy: false,
        syncedAt: null,
      }
    );
  }

  private markSynced(userId: string): BankSyncInfo {
    const info: BankSyncInfo = {
      mode: this.mode,
      provider: this.provider,
      healthy: true,
      syncedAt: clock.wallNowIso(),
    };
    this.statusByUser.set(userId, info);
    return info;
  }

  private markFailed(userId: string, error: unknown): BankSyncInfo {
    const message = error instanceof Error ? error.message : String(error);
    const previous = this.statusByUser.get(userId);
    const info: BankSyncInfo = {
      mode: this.mode,
      provider: this.provider,
      healthy: false,
      syncedAt: previous?.syncedAt ?? null,
      error: message,
    };
    this.statusByUser.set(userId, info);
    return info;
  }

  private applySnapshot(userId: string, raw: unknown): void {
    const snapshot = parseBankSnapshot(raw);
    const state = getState(userId);
    if (!this.hydrated.has(userId)) {
      // 首次接入真实核心时清空本地种子数据，避免上游未返回的字段继续展示合成账户。
      state.accounts = [];
      state.cards = [];
      state.transactions = [];
      state.subscriptions = [];
      state.products = [];
      state.holdings = [];
      state.fundLocks = [];
      state.giftOrders = [];
      state.schedules = [];
      state.disputes = [];
      this.hydrated.add(userId);
    }
    applyBankSnapshot(state, snapshot, { txnLimit: this.txnLimit });
    persist();
    this.markSynced(userId);
  }

  async sync(
    userId: string,
    options: { force?: boolean; tolerant?: boolean } = {},
  ): Promise<BankSyncInfo> {
    const current = this.statusByUser.get(userId);
    if (
      !options.force &&
      current?.healthy &&
      current.syncedAt &&
      Date.now() - new Date(current.syncedAt).getTime() < this.syncTtlMs
    ) {
      return current;
    }
    const running = this.inFlight.get(userId);
    if (running) return running;

    const task = (async () => {
      try {
        const data = await this.client.request<unknown>('GET', '/v1/snapshot', {
          query: { externalRef: externalRefFor(userId), txnLimit: this.txnLimit },
        });
        this.applySnapshot(userId, data);
        return this.status(userId);
      } catch (error) {
        const info = this.markFailed(userId, error);
        if (options.tolerant) return info;
        throw error;
      } finally {
        this.inFlight.delete(userId);
      }
    })();
    this.inFlight.set(userId, task);
    return task;
  }

  private async callOp<T = Record<string, any>>(
    userId: string,
    op: string,
    payload: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<T> {
    const data = await this.client.request<unknown>('POST', '/v1/ops', {
      body: {
        externalRef: externalRefFor(userId),
        op,
        payload,
      },
      idempotencyKey,
    });
    const record = asRecord(data, '操作结果');
    if (record.snapshot) {
      this.applySnapshot(userId, record.snapshot);
    } else {
      await this.sync(userId, { force: true });
    }
    return record as T;
  }

  private account(userId: string, accountId?: string): Account {
    const state = getState(userId);
    const account =
      (accountId ? state.accounts.find((item) => item.id === accountId) : undefined) ??
      state.accounts.find((item) => item.primary) ??
      state.accounts[0];
    if (!account) throw new IntegrationError('BANK_BAD_RESPONSE', '银行核心未返回可用账户');
    return account;
  }

  private txn(userId: string, txnId: string): Txn {
    const txn = getState(userId).transactions.find((item) => item.id === txnId);
    if (!txn) throw new IntegrationError('BANK_BAD_RESPONSE', `银行核心未返回交易 ${txnId}`);
    return txn;
  }

  private card(userId: string, cardId?: string, last4?: string): BankCard {
    const cards = getState(userId).cards;
    const card =
      (cardId ? cards.find((item) => item.id === cardId) : undefined) ??
      (last4 ? cards.find((item) => item.last4 === last4) : undefined);
    if (!card) throw new IntegrationError('BANK_BAD_RESPONSE', '银行核心未返回目标卡片');
    return card;
  }

  private subscription(userId: string, subscriptionId: string): Subscription {
    const subscription = getState(userId).subscriptions.find((item) => item.id === subscriptionId);
    if (!subscription) throw new IntegrationError('BANK_BAD_RESPONSE', '银行核心未返回目标订阅');
    return subscription;
  }

  private schedule(userId: string, scheduleId: string): ScheduleItem {
    const schedule = getState(userId).schedules.find((item) => item.id === scheduleId);
    if (!schedule) throw new IntegrationError('BANK_BAD_RESPONSE', '银行核心未返回目标计划');
    return schedule;
  }

  private lock(userId: string, lockId: string) {
    const lock = getState(userId).fundLocks.find((item) => item.id === lockId);
    if (!lock) throw new IntegrationError('BANK_BAD_RESPONSE', '银行核心未返回资金锁定记录');
    return lock;
  }

  private holding(userId: string, holdingId: string): Holding {
    const holding = getState(userId).holdings.find((item) => item.id === holdingId);
    if (!holding) throw new IntegrationError('BANK_BAD_RESPONSE', '银行核心未返回目标持仓');
    return holding;
  }

  private product(userId: string, productId: string): WealthProduct {
    const product = getState(userId).products.find((item) => item.id === productId);
    if (!product) throw new IntegrationError('BANK_BAD_RESPONSE', '银行核心未返回目标理财产品');
    return product;
  }

  async transfer(
    userId: string,
    input: TransferInput,
    idempotencyKey: string,
  ): Promise<TransferOutcome> {
    const data = await this.callOp(userId, 'transfer', input as unknown as Record<string, unknown>, idempotencyKey);
    const txns = readIds(data, 'txnIds').map((txnId) => this.txn(userId, txnId));
    if (!txns.length) {
      throw new IntegrationError('BANK_BAD_RESPONSE', '银行核心未返回转账流水号');
    }
    const account = this.account(userId, data.accountId ?? txns[0]?.accountId);
    const totalCents =
      Number.isFinite(data.totalCents) && Number(data.totalCents) > 0
        ? Number(data.totalCents)
        : txns.reduce((sum, txn) => sum + Math.abs(txn.amountCents), 0);
    return { txns, totalCents, account, recipients: input.recipients };
  }

  async reverseTransfer(
    userId: string,
    txnIds: string[],
    idempotencyKey: string,
  ): Promise<ReverseTransferOutcome> {
    const data = await this.callOp(userId, 'reverse_transfer', { txnIds }, idempotencyKey);
    const originals = (readIds(data, 'originalTxnIds').length ? readIds(data, 'originalTxnIds') : txnIds)
      .map((txnId) => this.txn(userId, txnId));
    const reversal = this.txn(userId, String(data.reversalTxnId ?? ''));
    const creditCents =
      Number.isFinite(data.creditCents) && Number(data.creditCents) > 0
        ? Number(data.creditCents)
        : originals.reduce((sum, txn) => sum + Math.abs(txn.amountCents), 0);
    return { creditCents, reversal, originals };
  }

  async purchaseWealth(
    userId: string,
    input: WealthPurchaseInput,
    idempotencyKey: string,
  ): Promise<WealthPurchaseOutcome> {
    const data = await this.callOp(
      userId,
      'purchase_wealth',
      {
        productId: input.product.id,
        amountCents: input.amountCents,
        fromAccountId: input.fromAccountId,
      },
      idempotencyKey,
    );
    const holding = this.holding(userId, String(data.holdingId ?? ''));
    const txn = this.txn(userId, String(data.txnId ?? ''));
    const account = this.account(userId, txn.accountId);
    return { holding, txn, account };
  }

  async redeemWealth(
    userId: string,
    input: WealthRedeemInput,
    idempotencyKey: string,
  ): Promise<WealthRedeemOutcome> {
    const data = await this.callOp(
      userId,
      'redeem_wealth',
      {
        holdingId: input.holding.id,
        amountCents: input.amountCents,
        toAccountId: input.toAccountId,
      },
      idempotencyKey,
    );
    const holding = this.holding(userId, String(data.holdingId ?? input.holding.id));
    const txn = this.txn(userId, String(data.txnId ?? ''));
    const account = this.account(userId, txn.accountId);
    const amountCents =
      Number.isFinite(data.amountCents) && Number(data.amountCents) > 0
        ? Number(data.amountCents)
        : input.amountCents;
    return { amountCents, txn, account, holding };
  }

  async applyVirtualCard(
    userId: string,
    input: VirtualCardInput,
    idempotencyKey: string,
  ): Promise<BankCard> {
    const data = await this.callOp(userId, 'apply_virtual_card', input as unknown as Record<string, unknown>, idempotencyKey);
    return this.card(userId, String(data.cardId ?? ''), data.last4 ? String(data.last4) : undefined);
  }

  async cancelVirtualCard(
    userId: string,
    cardId: string,
    idempotencyKey: string,
  ): Promise<BankCard> {
    const data = await this.callOp(userId, 'cancel_virtual_card', { cardId }, idempotencyKey);
    return this.card(userId, String(data.cardId ?? cardId));
  }

  async adjustCardLimit(
    userId: string,
    input: { cardId: string; limitCents: number },
    idempotencyKey: string,
  ): Promise<CardLimitOutcome> {
    const data = await this.callOp(userId, 'adjust_card_limit', input, idempotencyKey);
    const card = this.card(userId, String(data.cardId ?? input.cardId));
    return {
      card,
      previousLimitCents:
        Number.isFinite(data.previousLimitCents) && Number(data.previousLimitCents) >= 0
          ? Number(data.previousLimitCents)
          : 0,
    };
  }

  async setCardStatus(
    userId: string,
    input: { cardId: string; status: BankCard['status'] },
    idempotencyKey: string,
  ): Promise<CardStatusOutcome> {
    const data = await this.callOp(userId, 'set_card_status', input, idempotencyKey);
    const card = this.card(userId, String(data.cardId ?? input.cardId));
    return {
      card,
      previousStatus: (data.previousStatus as BankCard['status']) ?? 'active',
    };
  }

  async cancelSubscription(
    userId: string,
    subscriptionId: string,
    idempotencyKey: string,
  ): Promise<SubscriptionCancelOutcome> {
    const data = await this.callOp(userId, 'cancel_subscription', { subscriptionId }, idempotencyKey);
    const subscription = this.subscription(userId, subscriptionId);
    return {
      subscription,
      previousStatus: (data.previousStatus as Subscription['status']) ?? 'active',
    };
  }

  async restoreSubscription(
    userId: string,
    subscriptionId: string,
    previousStatus: Subscription['status'],
    idempotencyKey: string,
  ): Promise<Subscription> {
    await this.callOp(
      userId,
      'restore_subscription',
      { subscriptionId, status: previousStatus },
      idempotencyKey,
    );
    return this.subscription(userId, subscriptionId);
  }

  async createSchedule(
    userId: string,
    input: ScheduleInput,
    idempotencyKey: string,
  ): Promise<ScheduleItem> {
    const data = await this.callOp(userId, 'create_schedule', input as unknown as Record<string, unknown>, idempotencyKey);
    return this.schedule(userId, String(data.scheduleId ?? ''));
  }

  async cancelSchedule(
    userId: string,
    scheduleId: string,
    idempotencyKey: string,
  ): Promise<ScheduleItem> {
    const data = await this.callOp(userId, 'cancel_schedule', { scheduleId }, idempotencyKey);
    return this.schedule(userId, String(data.scheduleId ?? scheduleId));
  }

  async lockFunds(
    userId: string,
    input: LockFundsInput,
    idempotencyKey: string,
  ): Promise<FundLockOutcome> {
    const data = await this.callOp(userId, 'lock_funds', input as unknown as Record<string, unknown>, idempotencyKey);
    const lock = this.lock(userId, String(data.lockId ?? ''));
    const account = this.account(userId, lock.accountId);
    return { lock, account };
  }

  async unlockFunds(
    userId: string,
    lockId: string,
    idempotencyKey: string,
  ): Promise<FundLockOutcome> {
    const data = await this.callOp(userId, 'unlock_funds', { lockId }, idempotencyKey);
    const lock = this.lock(userId, String(data.lockId ?? lockId));
    const account = this.account(userId, lock.accountId);
    return { lock, account };
  }

  async orderGift(
    userId: string,
    input: GiftOrderInput,
    idempotencyKey: string,
  ): Promise<GiftOrderOutcome> {
    const data = await this.callOp(userId, 'order_gift', input as unknown as Record<string, unknown>, idempotencyKey);
    const state = getState(userId);
    const order = state.giftOrders.find((item) => item.id === String(data.orderId ?? ''));
    if (!order) throw new IntegrationError('BANK_BAD_RESPONSE', '银行核心未返回礼品订单');
    const txn = this.txn(userId, String(data.txnId ?? ''));
    return { order, account: this.account(userId, txn.accountId), txn };
  }

  async cancelGift(
    userId: string,
    orderId: string,
    idempotencyKey: string,
  ): Promise<GiftOrderOutcome> {
    const data = await this.callOp(userId, 'cancel_gift', { orderId }, idempotencyKey);
    const state = getState(userId);
    const order = state.giftOrders.find((item) => item.id === String(data.orderId ?? orderId));
    if (!order) throw new IntegrationError('BANK_BAD_RESPONSE', '银行核心未返回已取消订单');
    const txn = this.txn(userId, String(data.txnId ?? ''));
    return { order, account: this.account(userId, txn.accountId), txn };
  }

  async createSplitRequest(
    userId: string,
    input: SplitRequestInput,
    idempotencyKey: string,
  ): Promise<SplitRequestOutcome> {
    const data = await this.callOp(userId, 'create_split', input as unknown as Record<string, unknown>, idempotencyKey);
    const shares = Array.isArray(data.shares)
      ? data.shares
          .filter((item: any) => item && typeof item.name === 'string')
          .map((item: any) => ({
            name: String(item.name),
            amountCents: Number(item.amountCents) || 0,
            status: String(item.status ?? 'pending'),
          }))
      : [];
    return {
      requestId: String(data.requestId ?? ''),
      totalCents: Number(data.totalCents) || input.totalCents,
      myShareCents: Number(data.myShareCents) || 0,
      shares,
      createdAt: String(data.createdAt ?? clock.nowIso()),
      note: typeof data.note === 'string' ? data.note : input.note,
    };
  }

  async cancelSplitRequest(
    userId: string,
    requestId: string,
    idempotencyKey: string,
  ): Promise<void> {
    await this.callOp(userId, 'cancel_split', { requestId }, idempotencyKey);
  }

  /**
   * 争议受理走上游：本地只缓存银行返回的工单，绝不自行判定退款。
   * 银行未返回工单视为失败（fail-closed），由调用方提示稍后重试。
   */
  async openDispute(userId: string, input: DisputeInput, idempotencyKey: string): Promise<Dispute> {
    const data = await this.callOp(
      userId,
      'open_dispute',
      {
        txnId: input.txn.id,
        reason: input.reason,
        note: input.note,
        channel: input.channel,
      },
      idempotencyKey,
    );
    const disputeId = String(data.disputeId ?? '');
    const dispute = getState(userId).disputes.find(
      (item) => item.id === disputeId || item.txnId === input.txn.id,
    );
    if (!dispute) {
      throw new IntegrationError('BANK_BAD_RESPONSE', '银行核心未返回争议工单，请稍后重试');
    }
    return dispute;
  }

  async refreshDisputes(userId: string): Promise<Dispute[]> {
    await this.sync(userId, { force: true });
    return getState(userId).disputes;
  }
}
