/**
 * 交易争议（拒付/差错）工单：产品侧只负责受理与状态展示，
 * 账务结论始终由银行核心返回，AI 不在本地改账。
 */
export type DisputeReason =
  | 'duplicate'
  | 'unauthorized'
  | 'not_received'
  | 'amount_wrong'
  | 'other';

export type DisputeStatus = 'submitted' | 'reviewing' | 'resolved_credit' | 'rejected';

export interface Dispute {
  id: string;
  reference: string;
  txnId: string;
  accountId: string;
  merchant: string;
  amountCents: number;
  currency: 'CNY';
  reason: DisputeReason;
  status: DisputeStatus;
  note?: string;
  createdAt: string;
  updatedAt: string;
  /** 银行核心承诺的核查完成时点，超出则提示用户联系人工 */
  expectedFinishAt: string;
  channel: 'agent' | 'app';
  resolution?: string;
}

export const DISPUTE_REASON_TEXT: Record<DisputeReason, string> = {
  duplicate: '重复扣费',
  unauthorized: '非本人授权',
  not_received: '未收到商品/服务',
  amount_wrong: '金额与约定不符',
  other: '其他疑问',
};

export const DISPUTE_STATUS_TEXT: Record<DisputeStatus, string> = {
  submitted: '已受理',
  reviewing: '银行核查中',
  resolved_credit: '已退回入账',
  rejected: '核查不成立',
};

/** 争议可提交的时限：卡组织与行内规则一般以 180 天为上限 */
export const DISPUTE_WINDOW_DAYS = 180;

export function disputeStageIndex(status: DisputeStatus): number {
  if (status === 'submitted') return 0;
  if (status === 'reviewing') return 1;
  return 2;
}

export function canDispute(
  txn: { ts: string; amountCents: number; status: string },
  nowIso: string,
): { ok: boolean; code?: string; message?: string } {
  if (txn.status !== 'posted') {
    return { ok: false, code: 'TXN_NOT_DISPUTABLE', message: '该笔交易已冲正，无需重复申诉' };
  }
  const ageDays =
    (new Date(nowIso).getTime() - new Date(txn.ts).getTime()) / 86_400_000;
  if (!Number.isFinite(ageDays)) {
    return { ok: false, code: 'TXN_NOT_DISPUTABLE', message: '交易时间无法识别，请重新同步账单' };
  }
  if (ageDays > DISPUTE_WINDOW_DAYS) {
    return {
      ok: false,
      code: 'DISPUTE_WINDOW_CLOSED',
      message: `交易已超过 ${DISPUTE_WINDOW_DAYS} 天申诉期，请联系人工客服`,
    };
  }
  if (ageDays < 0) {
    return { ok: false, code: 'TXN_NOT_POSTED_YET', message: '该笔交易尚未入账，暂不能申诉' };
  }
  return { ok: true };
}
