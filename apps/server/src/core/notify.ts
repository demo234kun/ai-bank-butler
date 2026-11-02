import type { AppNotification } from '@bank/shared';
import { clock } from './clock';
import { newId } from './ledger';
import type { BankState } from './state';

const MAX_KEEP = 60;

export type NotificationInput = Pick<AppNotification, 'kind' | 'title' | 'body'> &
  Partial<Pick<AppNotification, 'refId' | 'amountCents'>>;

/** 提醒由真实事件（调度器、风控、工单）产生，只保留最近 60 条。 */
export function pushNotification(state: BankState, input: NotificationInput): AppNotification {
  const item: AppNotification = {
    id: newId('ntf'),
    ts: clock.nowIso(),
    read: false,
    ...input,
  };
  state.notifications.unshift(item);
  if (state.notifications.length > MAX_KEEP) state.notifications.length = MAX_KEEP;
  return item;
}

export function markNotificationsRead(state: BankState, ids?: string[]): number {
  let changed = 0;
  for (const item of state.notifications) {
    if (item.read) continue;
    if (!ids || ids.length === 0 || ids.includes(item.id)) {
      item.read = true;
      changed += 1;
    }
  }
  return changed;
}

export function unreadCount(state: BankState): number {
  return state.notifications.filter((item) => !item.read).length;
}
