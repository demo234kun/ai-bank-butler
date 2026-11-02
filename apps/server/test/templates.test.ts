import { describe, expect, it } from 'vitest';
import { BUSINESS_TEMPLATES, selectTemplate, type Intent, type NluResult, type NluSlots } from '@bank/shared';
import { createSeededState } from '../src/core/seed';
import { emptySlots } from '../src/nlu/schema';
import { buildPlan } from '../src/agent/planner';

function slots(patch: Partial<NluSlots> = {}): NluSlots {
  return { ...emptySlots(), ...patch };
}

function nlu(intent: Intent, patch: Partial<NluSlots> = {}, utterance = ''): NluResult {
  return {
    intent,
    confidence: 0.9,
    slots: slots(patch),
    needsClarification: false,
    ambiguity: null,
    injectionSuspicion: 0,
    references: [],
    source: 'rules',
    rationale: 'test',
    utterance,
  } as NluResult;
}

describe('业务模板库', () => {
  it('每个模板都有必需的步骤与失败策略', () => {
    for (const template of Object.values(BUSINESS_TEMPLATES)) {
      expect(template.steps.length).toBeGreaterThan(0);
      expect(template.label.length).toBeGreaterThan(0);
      expect(template.onFailure.retries).toBeGreaterThanOrEqual(0);
    }
  });

  it('按意图与槽位选择模板', () => {
    expect(selectTemplate('transfer', slots({ payee: '林晚', amount: 520 }))).toBe('transfer.instant');
    expect(selectTemplate('transfer', slots({ payee: '林晚', amount: 520, isScheduled: true }))).toBe(
      'transfer.scheduled',
    );
    expect(selectTemplate('transfer', slots({ splitNames: ['王磊'], splitTotal: 600 }))).toBe('transfer.split');
    expect(selectTemplate('wealth', slots({ wealthAction: 'purchase' }))).toBe('wealth.purchase');
    expect(selectTemplate('wealth', slots({ wealthAction: 'redeem' }))).toBe('wealth.redeem');
    expect(selectTemplate('wealth', slots({ wealthAction: 'query' }))).toBe('wealth.advice');
    expect(selectTemplate('card', slots({ cardAction: 'report_loss' }))).toBe('card.report_loss');
    expect(selectTemplate('card', slots({ cardAction: 'freeze' }))).toBe('card.freeze');
    expect(selectTemplate('card', slots({ cardAction: 'list' }))).toBe('card.list');
    expect(selectTemplate('subscription', slots(), '把健身会员取消')).toBe('subscription.cancel');
    expect(selectTemplate('subscription', slots())).toBe('subscription.scan');
    expect(selectTemplate('account', slots({ query: 'transactions' }))).toBe('account.transactions');
    expect(selectTemplate('account', slots({ query: 'balance' }))).toBe('account.balance');
    expect(selectTemplate('crossscene', slots())).toBe('crossscene.birthday');
    expect(selectTemplate('bills', slots())).toBe('bills.report');
  });

  it('规划结果带上模板标记，执行链路由模板决定', () => {
    const state = createSeededState();
    const plan = buildPlan(
      state,
      nlu('transfer', { payee: '林晚', amount: 520 }, '给林晚转 520'),
      { lastIntent: 'transfer' } as any,
      'run_test',
    );
    expect(plan.kind).toBe('plan');
    if (plan.kind !== 'plan') return;
    expect(plan.dag.template?.id).toBe('transfer.instant');
    expect(plan.dag.template?.steps.length).toBeGreaterThan(2);
    expect(plan.dag.nodes.map((n) => n.tool)).toContain('transfer');
  });

  it('卡片挂失命中危险模板并保留节点顺序', () => {
    const state = createSeededState();
    const plan = buildPlan(
      state,
      nlu('card', { cardAction: 'report_loss', cardLast4: '5521' }, '挂失尾号5521'),
      {} as any,
      'run_card',
    );
    expect(plan.kind).toBe('plan');
    if (plan.kind !== 'plan') return;
    expect(plan.dag.template?.id).toBe('card.report_loss');
    const tools = plan.dag.nodes.map((n) => n.tool);
    expect(tools[0]).toBe('list_cards');
    expect(tools[tools.length - 1]).toBe('report_loss');
  });
});
