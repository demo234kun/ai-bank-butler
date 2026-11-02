import type { DagNode } from '@bank/shared';
import { newId } from '../core/ledger';
import { getState, persist } from '../core/store';
import { banking } from '../integration/banking';
import { audit } from '../security/auditChain';
import type { EmitFn } from './events';
import type { SessionInternal } from './session';

export interface CompensationReport {
  compensated: Array<{ nodeId: string; label: string; detail: string }>;
  manual: Array<{ nodeId: string; label: string; reason: string }>;
  failed: Array<{ nodeId: string; label: string; error: string }>;
}

const IRREVERSIBLE_MUTATIONS = new Set(['purchase_wealth', 'redeem_wealth', 'report_loss']);

async function compensateNode(
  session: SessionInternal,
  node: DagNode,
  runId: string,
): Promise<string | null> {
  const state = getState(session.userId);
  const data = node.result?.data ?? {};
  const key = `comp:${session.id}:${runId}:${node.id}`;
  const userId = session.userId;

  switch (node.tool) {
    case 'transfer': {
      const ids: string[] = (data.txns ?? []).map((t: any) => t.id);
      const result = await banking.reverseTransfer(userId, ids, key);
      for (const reservation of state.limits) {
        if (reservation.nodeId === node.id && reservation.state === 'COMMITTED') {
          reservation.state = 'RELEASED';
        }
      }
      persist();
      return `已冲正 ${ids.length} 笔转账，退回 ${(result.creditCents / 100).toFixed(2)} 元，并恢复当日额度`;
    }
    case 'schedule_transfer': {
      const id = data.schedule?.id;
      if (id) await banking.cancelSchedule(userId, id, key);
      return '已取消定时转账计划';
    }
    case 'cancel_subscription': {
      const id = data.subscription?.id;
      if (id) {
        await banking.restoreSubscription(
          userId,
          id,
          data.previousStatus ?? 'active',
          key,
        );
      }
      return '已恢复自动续费';
    }
    case 'apply_virtual_card': {
      const id = data.card?.id;
      if (id) await banking.cancelVirtualCard(userId, id, key);
      return '已注销虚拟卡';
    }
    case 'adjust_card_limit': {
      const id = data.card?.id;
      if (id) {
        await banking.adjustCardLimit(
          userId,
          { cardId: id, limitCents: data.previousLimitCents ?? 0 },
          key,
        );
      }
      return '已恢复原额度';
    }
    case 'freeze_card':
    case 'unfreeze_card': {
      const id = data.card?.id;
      if (id) {
        await banking.setCardStatus(
          userId,
          { cardId: id, status: data.previousStatus ?? 'active' },
          key,
        );
      }
      return '已恢复卡片原状态';
    }
    case 'order_gift': {
      const id = data.order?.id;
      if (id) await banking.cancelGift(userId, id, key);
      return '已取消预约并退款';
    }
    case 'lock_funds': {
      const id = data.lock?.id;
      if (id) await banking.unlockFunds(userId, id, key);
      return '已释放锁定资金';
    }
    case 'split_request': {
      const id = data.requestId;
      if (id) await banking.cancelSplitRequest(userId, id, key);
      return '已撤销 AA 收款请求';
    }
    case 'create_note': {
      const id = data.item?.id;
      const note = state.schedules.find((s) => s.id === id);
      if (note) note.status = 'cancelled';
      persist();
      return '已移除生日日程';
    }
    default:
      return null;
  }
}

export async function compensateRun(
  session: SessionInternal,
  emit: EmitFn,
  runId: string,
): Promise<CompensationReport> {
  const report: CompensationReport = { compensated: [], manual: [], failed: [] };
  const dag = session.dag;
  if (!dag) return report;
  const candidates = [...dag.nodes].reverse();
  for (const node of candidates) {
    if (node.status === 'SUCCESS' && IRREVERSIBLE_MUTATIONS.has(node.tool)) {
      report.manual.push({
        nodeId: node.id,
        label: node.label,
        reason: '已提交且不可逆，已生成人工处理工单',
      });
      continue;
    }
    if (node.status !== 'SUCCESS' || !node.reversible) continue;
    try {
      const detail = await compensateNode(session, node, runId);
      if (!detail) continue;
      node.status = 'COMPENSATED';
      report.compensated.push({ nodeId: node.id, label: node.label, detail });
      emit(
        'node.state',
        {
          nodeId: node.id,
          status: 'COMPENSATED',
          tool: node.tool,
          label: node.label,
          risk: node.risk,
          resultSummary: detail,
        },
        runId,
      );
      audit.append('COMPENSATION', `${node.label}：${detail}`, { nodeId: node.id, tool: node.tool }, {
        sessionId: session.id,
        runId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      node.status = 'MANUAL';
      report.failed.push({ nodeId: node.id, label: node.label, error: message });
      emit(
        'node.state',
        { nodeId: node.id, status: 'MANUAL', tool: node.tool, label: node.label, risk: node.risk, error: message },
        runId,
      );
      audit.append('COMPENSATION_FAILED', `${node.label}：${message}`, { nodeId: node.id }, {
        sessionId: session.id,
        runId,
      });
    }
  }
  if (report.manual.length) {
    audit.append(
      'MANUAL_TICKET',
      `生成 ${report.manual.length} 张人工工单`,
      { items: report.manual },
      { sessionId: session.id, runId },
    );
  }
  session.state = 'PARTIAL';
  session.pending = null;
  session.abortRequested = false;
  persist();
  return report;
}

export function createManualTicketNote(label: string): string {
  return `工单 ${newId('ticket')}：${label}`;
}
