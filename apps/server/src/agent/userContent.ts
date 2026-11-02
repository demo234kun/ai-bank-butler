import type { BankState } from '../core/state';
import type { Intent } from '@bank/shared';

export function buildQuickPrompts(bank: BankState): string[] {
  const spouse = bank.user.spouse;
  const transferTarget = spouse.name?.trim() || bank.user.contacts[0]?.name || '联系人';
  const birthday = spouse.name && spouse.birthday
    ? `${spouse.name}下周生日，帮我提前安排`
    : '帮我提前规划一场生日惊喜';
  const activeSub = bank.subscriptions.find((sub) => sub.status === 'active');
  return [
    `给${transferTarget}转 520 元，备注爱你`,
    '这个月花了多少？有异常消费吗',
    '推荐一款稳健理财，我想放一万',
    activeSub ? `查一下自动续费，把${activeSub.merchant}取消` : '查一下自动续费并帮我取消不需要的',
    '申请一张虚拟卡，额度 3000',
    birthday,
    '我还有多少钱',
  ];
}

export function buildCapabilities(bank: BankState): Array<{ intent: Intent; label: string; example: string }> {
  const prompts = buildQuickPrompts(bank);
  return [
    { intent: 'transfer', label: '智能转账', example: prompts[0]! },
    { intent: 'bills', label: '账单分析', example: prompts[1]! },
    { intent: 'wealth', label: '理财操作', example: prompts[2]! },
    { intent: 'card', label: '卡片管理', example: prompts[4]! },
    { intent: 'subscription', label: '订阅代扣', example: prompts[3]! },
    { intent: 'crossscene', label: '跨场景联动', example: prompts[5]! },
    { intent: 'account', label: '账户查询', example: prompts[6]! },
  ];
}
