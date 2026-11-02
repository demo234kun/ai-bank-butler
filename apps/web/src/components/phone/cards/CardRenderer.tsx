import type { Card, Dag, DataSourceInfo } from '@bank/shared';
import {
  BalanceCard,
  BlockedCard,
  CapabilitiesCard,
  ClarifyCard,
  CompensationCard,
  ErrorCard,
  GenericCard,
  LockedCard,
  PendingCard,
  TransactionsCard,
} from './CommonCards';
import { BillReportCard } from './BillCard';
import { BirthdayPlanCard } from './BirthdayCard';
import { CardReceipt, CardsCard } from './CardManageCards';
import { SubscriptionReceipt, SubscriptionsCard } from './SubscriptionCard';
import { ScheduleReceipt, SplitShareCard, TransferReceipt } from './TransferCards';
import { WealthCard, WealthReceipt } from './WealthCards';

export function CardRenderer({
  card,
  dag,
  capabilities,
  onSend,
  onRollback,
  onOpenPending,
  dataSource,
}: {
  card: Card;
  dag: Dag | null;
  capabilities?: Array<{ intent: string; label: string; example: string }>;
  onSend: (text: string) => void;
  onRollback: () => void;
  onOpenPending: () => void;
  dataSource?: DataSourceInfo;
}) {
  switch (card.type) {
    case 'capabilities':
      return (
        <CapabilitiesCard
          data={card}
          capabilities={capabilities}
          onSend={onSend}
          dataSource={dataSource}
        />
      );
    case 'clarify':
      return <ClarifyCard data={card} onSend={onSend} />;
    case 'balance':
      return <BalanceCard data={card} dataSource={dataSource} />;
    case 'transactions':
      return <TransactionsCard data={card} />;
    case 'billReport':
      return <BillReportCard data={card} />;
    case 'wealth':
      return <WealthCard data={card} onSend={onSend} />;
    case 'wealthReceipt':
      return <WealthReceipt data={card} />;
    case 'cards':
      return <CardsCard data={card} />;
    case 'cardReceipt':
      return <CardReceipt data={card} />;
    case 'subscriptions':
      return <SubscriptionsCard data={card} onSend={onSend} />;
    case 'subscriptionReceipt':
      return <SubscriptionReceipt data={card} />;
    case 'birthdayPlan':
      return <BirthdayPlanCard data={card} />;
    case 'transferReceipt': {
      const canUndo =
        Boolean(card.undoable) &&
        Boolean(dag?.nodes.some((node) => node.tool === 'transfer' && node.status === 'SUCCESS'));
      return <TransferReceipt data={card} canUndo={canUndo} onRollback={onRollback} />;
    }
    case 'scheduleReceipt':
      return <ScheduleReceipt data={card} />;
    case 'splitShare':
      return <SplitShareCard data={card} />;
    case 'blocked':
      return <BlockedCard data={card} />;
    case 'locked':
      return <LockedCard data={card} />;
    case 'pending':
      return <PendingCard data={card} onOpenPending={onOpenPending} />;
    case 'compensation':
      return <CompensationCard data={card} />;
    case 'error':
      return <ErrorCard data={card} />;
    default:
      return <GenericCard data={card} />;
  }
}
