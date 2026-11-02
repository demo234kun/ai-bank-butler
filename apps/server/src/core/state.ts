import type {
  Account,
  AppNotification,
  BankCard,
  Dispute,
  FundLock,
  GiftOrder,
  Holding,
  ScheduleItem,
  Subscription,
  Txn,
  UserProfile,
  WealthProduct,
} from '@bank/shared';

export interface Reservation {
  id: string;
  userId: string;
  nodeId: string;
  amountCents: number;
  dayKey: string;
  state: 'HELD' | 'COMMITTED' | 'RELEASED';
  createdAt: string;
  expiresAt: string;
  committedAt?: string;
}

export interface SecurityState {
  failures: number;
  injectionHits: number;
  lockedUntil: string | null;
  lastReason: string | null;
}

export interface IdempotencyRecord {
  key: string;
  result: unknown;
  at: string;
}

export interface BankState {
  seedVersion: number;
  seededAt: string;
  demoNow: string;
  user: UserProfile;
  accounts: Account[];
  cards: BankCard[];
  transactions: Txn[];
  subscriptions: Subscription[];
  products: WealthProduct[];
  holdings: Holding[];
  fundLocks: FundLock[];
  giftOrders: GiftOrder[];
  schedules: ScheduleItem[];
  disputes: Dispute[];
  notifications: AppNotification[];
  limits: Reservation[];
  security: SecurityState;
  idempotency: Record<string, IdempotencyRecord>;
}

export function findAccount(state: BankState, idOrLast4?: string): Account | undefined {
  if (!idOrLast4) return state.accounts.find((a) => a.primary);
  return (
    state.accounts.find((a) => a.id === idOrLast4) ??
    state.accounts.find((a) => a.last4 === idOrLast4) ??
    state.accounts.find((a) => a.primary)
  );
}

export function availableCents(account: Account): number {
  return Math.max(0, account.balanceCents - account.lockedCents);
}

/** 名下非信用卡账户的可用资金合计（分）。 */
export function totalAvailableCents(state: BankState): number {
  return state.accounts
    .filter((a) => a.type !== 'credit')
    .reduce((sum, a) => sum + availableCents(a), 0);
}

export function primaryAccount(state: BankState): Account {
  return state.accounts.find((a) => a.primary) ?? state.accounts[0]!;
}
