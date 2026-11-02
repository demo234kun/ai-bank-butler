import {
  BRAND,
  DAILY_TRANSFER_LIMIT_CENTS,
  type BootstrapPayload,
  type SnapshotPayload,
} from '@bank/shared';
import { clock } from '../core/clock';
import { getState } from '../core/store';
import type { SessionInternal } from '../agent/session';
import { listSessions, listSessionsForUser, toPublic } from '../agent/session';
import { metrics } from '../metrics';
import { getLimitSummary } from '../policy/limits';
import { buildCapabilities, buildQuickPrompts } from '../agent/userContent';
import { banking } from '../integration/banking';

export function buildSnapshot(session: SessionInternal): SnapshotPayload {
  const bank = getState(session.userId);
  const limit = getLimitSummary(bank);
  return {
    session: toPublic(session),
    user: {
      name: bank.user.name,
      tier: bank.user.tier,
      phoneMasked: bank.user.phoneMasked,
      spouseName: bank.user.spouse.name,
      spouseBirthday: bank.user.spouse.birthday,
      riskProfile: bank.user.riskProfile,
    },
    accounts: bank.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      bank: a.bank,
      type: a.type,
      last4: a.last4,
      balanceCents: a.balanceCents,
      lockedCents: a.lockedCents,
      primary: a.primary,
      color: a.color,
    })),
    cards: bank.cards.map((c) => ({ ...c })),
    limits: limit,
    stats: metrics.stats(bank, listSessionsForUser(session.userId).length),
    demoNow: clock.nowIso(),
    dailyLimitCents: DAILY_TRANSFER_LIMIT_CENTS,
    dataSource: banking.status(session.userId),
  };
}

export function buildBootstrap(session: SessionInternal): BootstrapPayload {
  return {
    ...buildSnapshot(session),
    quickPrompts: buildQuickPrompts(getState(session.userId)),
    capabilities: buildCapabilities(getState(session.userId)),
    brand: {
      name: BRAND.name,
      nameEn: BRAND.nameEn,
      product: BRAND.product,
      slogan: BRAND.slogan,
      monogram: BRAND.monogram,
    },
  };
}
