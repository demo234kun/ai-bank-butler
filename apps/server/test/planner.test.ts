import { describe, expect, it } from 'vitest';
import type { ContextStack, NluResult } from '@bank/shared';
import { createSeededState } from '../src/core/seed';
import { parseWithRules } from '../src/nlu/fallbackRules';
import { buildPlan } from '../src/agent/planner';

const state = createSeededState();
const context: ContextStack = {
  spouseName: state.user.spouse.name,
  spouseBirthday: state.user.spouse.birthday,
  lastPayee: '林晚',
  lastPayeeBank: '云杉银行',
  lastAmountCents: 52000,
  references: [],
};

function nlu(text: string): NluResult {
  return parseWithRules(text, { context, user: state.user, state, source: 'rules' });
}

function plan(text: string) {
  return buildPlan(state, nlu(text), context, 'run_test');
}

describe('DAG 规划器', () => {
  it('转账拆成解析联系人 → 限额校验 → 转账提交', () => {
    const result = plan('给林晚转 520 元，备注爱你');
    expect(result.kind).toBe('plan');
    if (result.kind !== 'plan') return;
    expect(result.dag.nodes).toHaveLength(3);
    expect(result.dag.nodes.map((n) => n.tool)).toEqual([
      'resolve_contact',
      'check_limit',
      'transfer',
    ]);
    const transfer = result.dag.nodes[2]!;
    expect(transfer.deps).toEqual(['n1', 'n2']);
    expect(transfer.args.totalCents).toBe(52000);
    expect(transfer.risk).toBe('YELLOW');
  });

  it('同名联系人触发澄清', () => {
    const result = plan('给王磊转 500 元');
    expect(result.kind).toBe('clarify');
    if (result.kind !== 'clarify') return;
    expect(result.slot).toBe('contactId');
    expect(result.options).toHaveLength(2);
  });

  it('缺少金额时澄清，不执行资金操作', () => {
    const result = plan('给林晚转');
    expect(result.kind).toBe('clarify');
    if (result.kind !== 'clarify') return;
    expect(result.slot).toBe('amount');
    expect(result.options?.length).toBeGreaterThan(0);
  });

  it('账单分析含沙箱节点', () => {
    const result = plan('这个月花了多少？有异常消费吗');
    expect(result.kind).toBe('plan');
    if (result.kind !== 'plan') return;
    expect(result.dag.nodes.map((n) => n.tool)).toEqual([
      'fetch_transactions',
      'aggregate_bills',
      'detect_anomalies',
      'sandbox_analyze',
    ]);
    expect(result.dag.nodes.every((n) => n.risk === 'GREEN')).toBe(true);
  });

  it('理财推荐不直接申购，申购才加入红色节点', () => {
    const recommend = plan('推荐一款稳健理财，我想放一万');
    expect(recommend.kind).toBe('plan');
    if (recommend.kind === 'plan') {
      expect(recommend.dag.nodes.map((n) => n.tool)).toEqual([
        'assess_risk',
        'list_products',
        'match_products',
      ]);
    }
    const purchase = plan('申购招银稳健180天 5000 元');
    expect(purchase.kind).toBe('plan');
    if (purchase.kind === 'plan') {
      expect(purchase.dag.nodes.at(-1)?.tool).toBe('purchase_wealth');
      expect(purchase.dag.nodes.at(-1)?.risk).toBe('RED');
    }
  });

  it('虚拟卡申请为黄色，额度写入参数', () => {
    const result = plan('申请一张虚拟卡，额度 3000');
    expect(result.kind).toBe('plan');
    if (result.kind !== 'plan') return;
    const node = result.dag.nodes.find((n) => n.tool === 'apply_virtual_card');
    expect(node?.args.limitCents).toBe(300000);
    expect(node?.risk).toBe('YELLOW');
  });

  it('挂失升级红色并依赖卡片列表', () => {
    const result = plan('把尾号1234的卡挂失');
    expect(result.kind).toBe('plan');
    if (result.kind !== 'plan') return;
    const node = result.dag.nodes.find((n) => n.tool === 'report_loss');
    expect(node?.risk).toBe('RED');
    expect(node?.deps).toEqual(['n1']);
  });

  it('取消订阅加入黄色取消节点', () => {
    const result = plan('查一下自动续费，把健身会员取消');
    expect(result.kind).toBe('plan');
    if (result.kind !== 'plan') return;
    const node = result.dag.nodes.find((n) => n.tool === 'cancel_subscription');
    expect(node?.risk).toBe('YELLOW');
    expect(node?.args.subscriptionId).toBe('sub_fitness');
  });

  it('生日联动生成 5 个节点与 T-2 / T-1 排期', () => {
    const result = plan('我爱人下周生日，帮我提前安排');
    expect(result.kind).toBe('plan');
    if (result.kind !== 'plan') return;
    expect(result.dag.nodes).toHaveLength(5);
    const lock = result.dag.nodes.find((n) => n.tool === 'lock_funds');
    expect(lock?.args.amountCents).toBe(100000);
    const gifts = result.dag.nodes.filter((n) => n.tool === 'order_gift');
    expect(gifts).toHaveLength(2);
    expect(String(gifts[0]?.args.deliveryAt)).toContain('2026-10-31');
    expect(String(gifts[1]?.args.deliveryAt)).toContain('2026-11-01');
    expect(result.dag.nodes.filter((n) => n.risk === 'YELLOW')).toHaveLength(3);
  });

  it('账户查询走单节点绿色 DAG', () => {
    const result = plan('我还有多少钱');
    expect(result.kind).toBe('plan');
    if (result.kind !== 'plan') return;
    expect(result.dag.nodes).toHaveLength(1);
    expect(result.dag.nodes[0]?.tool).toBe('get_balance');
  });

  it('闲聊不生成 DAG', () => {
    const result = plan('你好');
    expect(result.kind).toBe('reply');
  });
});
