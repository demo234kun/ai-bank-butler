import { MANUAL_REVIEW_WINDOW_MS, type DagNode, type PolicyDecision } from '@bank/shared';
import { clock } from '../core/clock';
import { getState, persist } from '../core/store';
import { banking } from '../integration/banking';
import { pushNotification } from '../core/notify';
import { audit } from '../security/auditChain';
import type { ScheduledTransferPayload, ScheduleItem } from '@bank/shared';

/** 从节点参数里取收款人姓名，用于复述校验与风控特征。 */
export function nodePayee(node: DagNode): string | undefined {
  const args = node.args as Record<string, any>;
  const recipients = Array.isArray(args.recipients) ? args.recipients : [];
  return (
    (recipients[0]?.name as string | undefined) ??
    (typeof args.payeeName === 'string' ? args.payeeName : undefined) ??
    (typeof args.payee === 'string' ? args.payee : undefined)
  );
}

/** 复述比对前的规范化：去空白、全角转半角、忽略大小写与中间点差异。 */
export function normalizeName(value: string): string {
  return value
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[\s·•・]/g, '')
    .toLowerCase()
    .trim();
}

/** 展示用脱敏：保留姓氏，其余以 * 代替。 */
export function maskName(name: string): string {
  const chars = [...name.trim()];
  if (chars.length <= 1) return `${chars[0] ?? ''}*`;
  return `${chars[0]}${'*'.repeat(Math.max(1, chars.length - 1))}`;
}

export interface PayeeEchoRequirement {
  required: boolean;
  masked?: string;
}

/** 档位含 PAYEE_ECHO 且能确定收款人时，要求用户手输收款人姓名。 */
export function payeeEchoFor(node: DagNode, policy: PolicyDecision): PayeeEchoRequirement {
  const controls = policy.controls ?? [];
  const payee = nodePayee(node);
  if (!controls.includes('PAYEE_ECHO') || !payee) return { required: false };
  return { required: true, masked: maskName(payee) };
}

export function verifyPayeeEcho(node: DagNode, input: string | undefined): boolean {
  const payee = nodePayee(node);
  if (!payee) return true;
  if (!input) return false;
  return normalizeName(input) === normalizeName(payee);
}

/**
 * T4 交易不直接执行，也不直接拒绝：写入人工审核队列并延迟到账。
 * 审核期内用户可撤销；人工批准后立即执行；超时未审核自动退回。
 */
export async function deferToManualReview(input: {
  userId: string;
  node: DagNode;
  policy: PolicyDecision;
  runId: string;
}): Promise<ScheduleItem> {
  const { userId, node, policy, runId } = input;
  const args = node.args as Record<string, any>;
  const recipients: ScheduledTransferPayload['recipients'] = Array.isArray(args.recipients)
    ? args.recipients
    : [{ name: nodePayee(node) ?? '收款人', amountCents: policy.amountCents ?? 0 }];
  const payload: ScheduledTransferPayload = {
    recipients,
    fromAccountId: args.fromAccountId,
    note: typeof args.note === 'string' ? args.note : undefined,
    authorized: false,
    authorizationRef: `review:${runId}:${node.id}`,
  };
  const executeAt = new Date(clock.wallNow().getTime() + MANUAL_REVIEW_WINDOW_MS).toISOString();
  const item = await banking.createSchedule(
    userId,
    {
      kind: 'review',
      title: `人工审核 · ${node.label}`,
      amountCents: policy.amountCents,
      executeAt,
      detail: policy.explanation,
      payload,
    },
    `review:create:${runId}:${node.id}`,
  );
  const state = getState(userId);
  pushNotification(state, {
    kind: 'review',
    title: '交易已进入人工审核',
    body: `${node.label} 需人工审核，${Math.round(MANUAL_REVIEW_WINDOW_MS / 60_000)} 分钟内可撤销；审核通过后自动执行。`,
    refId: item.id,
    amountCents: policy.amountCents,
  });
  persist();
  audit.append(
    'MANUAL_REVIEW_QUEUED',
    `${node.label} 转入人工审核队列（风控评分 ${policy.risk?.score ?? '—'}）`,
    {
      reviewId: item.id,
      tier: policy.tier,
      riskScore: policy.risk?.score,
      signals: (policy.risk?.signals ?? []).map((s) => s.code),
      dueAt: executeAt,
    },
    { sessionId: state.user.id, runId },
  );
  return item;
}

export interface ReviewDecisionResult {
  ok: boolean;
  code?: string;
  message: string;
  item?: ScheduleItem;
}

/** 人工审核通过：立即执行原交易，幂等键固定为 review:<id>，重复批准不会二次扣款。 */
export async function approveManualReview(userId: string, reviewId: string): Promise<ReviewDecisionResult> {
  const state = getState(userId);
  const item = state.schedules.find((s) => s.id === reviewId && s.kind === 'review');
  if (!item) return { ok: false, code: 'REVIEW_NOT_FOUND', message: '未找到该审核单' };
  if (item.status !== 'scheduled') return { ok: false, code: 'REVIEW_CLOSED', message: `审核单已处于${item.status === 'done' ? '已完成' : item.status === 'cancelled' ? '已撤销' : '已关闭'}状态` };
  const payload = item.payload;
  if (!payload?.recipients?.length) return { ok: false, code: 'REVIEW_PAYLOAD', message: '审核单缺少交易参数' };

  payload.authorized = true;
  payload.authorizationRef = `review-approved:${reviewId}`;
  try {
    await banking.transfer(userId, payload, `review:${reviewId}`);
  } catch (error) {
    payload.authorized = false;
    item.lastError = error instanceof Error ? error.message : '执行失败';
    persist();
    return { ok: false, code: 'REVIEW_EXECUTE_FAILED', message: item.lastError };
  }
  item.status = 'done';
  item.detail = `${item.detail ?? ''}\n人工审核通过，已执行`.trim();
  pushNotification(state, {
    kind: 'review',
    title: '人工审核已通过',
    body: `${item.title} 已执行完成。`,
    refId: item.id,
  });
  persist();
  audit.append(
    'MANUAL_REVIEW_APPROVED',
    `人工审核通过并执行：${item.title}`,
    { reviewId, amountCents: item.amountCents },
    { sessionId: userId },
  );
  return { ok: true, message: '审核通过，交易已执行', item };
}

/** 人工驳回或用户撤销：取消审核单，不发生资金变动。 */
export async function rejectManualReview(
  userId: string,
  reviewId: string,
  reason: string,
  by: 'user' | 'bank',
): Promise<ReviewDecisionResult> {
  const state = getState(userId);
  const item = state.schedules.find((s) => s.id === reviewId && s.kind === 'review');
  if (!item) return { ok: false, code: 'REVIEW_NOT_FOUND', message: '未找到该审核单' };
  if (item.status !== 'scheduled') return { ok: false, code: 'REVIEW_CLOSED', message: '审核单已关闭' };
  await banking.cancelSchedule(userId, reviewId, `review:cancel:${reviewId}`);
  pushNotification(state, {
    kind: 'review',
    title: by === 'user' ? '你已撤销该交易' : '人工审核未通过',
    body: `${item.title}：${reason}，未发生资金变动。`,
    refId: reviewId,
  });
  persist();
  audit.append(
    by === 'user' ? 'MANUAL_REVIEW_WITHDRAWN' : 'MANUAL_REVIEW_REJECTED',
    `${by === 'user' ? '用户撤销' : '人工驳回'}：${item.title}`,
    { reviewId, reason },
    { sessionId: userId },
  );
  return { ok: true, message: by === 'user' ? '已撤销，未发生资金变动' : '已驳回，未发生资金变动', item };
}
