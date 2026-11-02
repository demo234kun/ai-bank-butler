import type { BankCard, Dispute, ScheduleItem, Subscription } from '@bank/shared';
import { clock } from '../../core/clock';
import {
  LedgerError,
  adjustCardLimit,
  applyVirtualCard,
  cancelGift,
  cancelSubscription,
  cancelVirtualCard,
  createSchedule,
  lockFunds,
  newId,
  orderGift,
  purchaseWealth,
  redeemWealth,
  restoreSubscription,
  reverseTransfer,
  setCardStatus,
  transfer,
  unlockFunds,
} from '../../core/ledger';
import { getState, persist } from '../../core/store';
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

function nowIso(): string {
  return clock.wallNowIso();
}

/** 本地仿真核心：保留无外部依赖的比赛演示，同时复用与真实接入完全相同的工具路径。 */
export class SimulatedBankingGateway implements BankingGateway {
  readonly mode = 'simulated' as const;
  readonly provider = '本地仿真核心';

  status(_userId: string): BankSyncInfo {
    return {
      mode: this.mode,
      provider: this.provider,
      healthy: true,
      syncedAt: null,
    };
  }

  async sync(_userId: string): Promise<BankSyncInfo> {
    return this.status(_userId);
  }

  async transfer(_userId: string, input: TransferInput): Promise<TransferOutcome> {
    const result = transfer(getState(_userId), input);
    persist();
    return result;
  }

  async reverseTransfer(_userId: string, txnIds: string[]): Promise<ReverseTransferOutcome> {
    const result = reverseTransfer(getState(_userId), txnIds);
    persist();
    return result;
  }

  async purchaseWealth(_userId: string, input: WealthPurchaseInput): Promise<WealthPurchaseOutcome> {
    const result = purchaseWealth(getState(_userId), input);
    persist();
    return result;
  }

  async redeemWealth(_userId: string, input: WealthRedeemInput): Promise<WealthRedeemOutcome> {
    const result = redeemWealth(getState(_userId), input);
    persist();
    return result;
  }

  async applyVirtualCard(_userId: string, input: VirtualCardInput): Promise<BankCard> {
    const result = applyVirtualCard(getState(_userId), input);
    persist();
    return result.card;
  }

  async cancelVirtualCard(_userId: string, cardId: string): Promise<BankCard> {
    const result = cancelVirtualCard(getState(_userId), cardId);
    persist();
    return result.card;
  }

  async adjustCardLimit(
    _userId: string,
    input: { cardId: string; limitCents: number },
  ): Promise<CardLimitOutcome> {
    const result = adjustCardLimit(getState(_userId), input);
    persist();
    return result;
  }

  async setCardStatus(
    _userId: string,
    input: { cardId: string; status: BankCard['status'] },
  ): Promise<CardStatusOutcome> {
    const result = setCardStatus(getState(_userId), input);
    persist();
    return result;
  }

  async cancelSubscription(
    _userId: string,
    subscriptionId: string,
  ): Promise<SubscriptionCancelOutcome> {
    const result = cancelSubscription(getState(_userId), subscriptionId);
    persist();
    return result;
  }

  async restoreSubscription(
    _userId: string,
    subscriptionId: string,
    previousStatus: Subscription['status'],
  ): Promise<Subscription> {
    const subscription = restoreSubscription(getState(_userId), subscriptionId, previousStatus);
    persist();
    return subscription;
  }

  async createSchedule(_userId: string, input: ScheduleInput): Promise<ScheduleItem> {
    const item = createSchedule(getState(_userId), input);
    persist();
    return item;
  }

  async cancelSchedule(_userId: string, scheduleId: string): Promise<ScheduleItem> {
    const state = getState(_userId);
    const item = state.schedules.find((schedule) => schedule.id === scheduleId);
    if (!item) throw new LedgerError('SCHEDULE_NOT_FOUND', '未找到定时计划');
    item.status = 'cancelled';
    persist();
    return item;
  }

  async lockFunds(_userId: string, input: LockFundsInput): Promise<FundLockOutcome> {
    const result = lockFunds(getState(_userId), input);
    persist();
    return result;
  }

  async unlockFunds(_userId: string, lockId: string): Promise<FundLockOutcome> {
    const result = unlockFunds(getState(_userId), lockId);
    persist();
    return result;
  }

  async orderGift(_userId: string, input: GiftOrderInput): Promise<GiftOrderOutcome> {
    const result = orderGift(getState(_userId), input);
    persist();
    return result;
  }

  async cancelGift(_userId: string, orderId: string): Promise<GiftOrderOutcome> {
    const result = cancelGift(getState(_userId), orderId);
    persist();
    return result;
  }

  async createSplitRequest(
    _userId: string,
    input: SplitRequestInput,
  ): Promise<SplitRequestOutcome> {
    const base = Math.floor(input.totalCents / (input.names.length + 1));
    const remainder = input.totalCents - base * (input.names.length + 1);
    return {
      requestId: newId('aa'),
      totalCents: input.totalCents,
      myShareCents: base,
      shares: input.names.map((name, index) => ({
        name,
        amountCents: base + (index === 0 ? remainder : 0),
        status: 'pending',
      })),
      createdAt: nowIso(),
      note: input.note,
    };
  }

  async cancelSplitRequest(): Promise<void> {
    // 本地 AA 请求不落资金，无需冲正；真实接入时由银行撤销收款请求。
  }

  /**
   * 仿真核心的争议受理：建单并进入「银行核查中」，不动账务、不承诺退款。
   * 生产接入时同一入口改由银行核心返回受理结果与工单号。
   */
  async openDispute(userId: string, input: DisputeInput): Promise<Dispute> {
    const state = getState(userId);
    const existing = state.disputes.find(
      (item) => item.txnId === input.txn.id && item.status !== 'rejected',
    );
    if (existing) return existing;
    const submittedAt = clock.nowIso();
    const dispute: Dispute = {
      id: newId('dsp'),
      reference: `DR${submittedAt.slice(0, 10).replace(/-/g, '')}${String(
        Math.floor(Math.random() * 9000) + 1000,
      )}`,
      txnId: input.txn.id,
      accountId: input.txn.accountId,
      merchant: input.txn.merchant,
      amountCents: input.txn.amountCents,
      currency: 'CNY',
      reason: input.reason,
      status: 'reviewing',
      note: input.note?.slice(0, 300),
      createdAt: submittedAt,
      updatedAt: submittedAt,
      expectedFinishAt: new Date(clock.now().getTime() + 5 * 86_400_000).toISOString(),
      channel: input.channel,
      resolution: '仿真核心已受理，等待核查结论（演示环境不会自动退款）',
    };
    state.disputes.unshift(dispute);
    persist();
    return dispute;
  }

  async refreshDisputes(userId: string): Promise<Dispute[]> {
    return getState(userId).disputes;
  }
}
