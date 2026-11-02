import { createHash } from 'node:crypto';

/**
 * 本地用户与银行客户之间的稳定去标识映射。
 * 银行侧在开户/绑卡时建立 bref -> custId 映射；请求中不传本地 userId 或手机号。
 */
export function externalRefFor(userId: string): string {
  return `bref_${createHash('sha256').update(`banking:${userId}`).digest('hex').slice(0, 24)}`;
}
