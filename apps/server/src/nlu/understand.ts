import type { ChatMessage, ContextStack, NluResult, UserProfile } from '@bank/shared';
import { config } from '../config';
import type { BankState } from '../core/state';
import { metrics } from '../metrics';
import { cacheGet, cacheKey, cacheSet } from './cache';
import { consumeLlmBudget } from './usage';
import { parseWithRules } from './fallbackRules';
import { callChatCompletion, LlmError } from './llmClient';
import { buildNluPrompt } from './prompt';
import { NluParseError, parseNluContent } from './schema';

export interface UnderstandInput {
  text: string;
  context: ContextStack;
  user: UserProfile;
  state: BankState;
  history: ChatMessage[];
}

function hasNumericSignal(text: string): boolean {
  return /[0-9零一二两三四五六七八九十百千万]/.test(text);
}

function mergeWithRules(parsed: NluResult, rule: NluResult): NluResult {
  const slots = { ...parsed.slots };
  if (slots.amount === null && rule.slots.amount !== null) slots.amount = rule.slots.amount;
  if (rule.slots.amount !== null) slots.amount = rule.slots.amount; // 金额以原文抽取为准
  if (slots.amount !== null && !hasNumericSignal(parsed.utterance ?? '')) slots.amount = null;
  if (slots.payee === null && rule.slots.payee) slots.payee = rule.slots.payee;
  if (slots.payee) {
    const known =
      slots.payee === rule.slots.payee ||
      /爱人|老婆|太太|配偶/.test(parsed.utterance ?? '') ||
      (parsed.utterance ?? '').includes(slots.payee);
    if (!known) slots.payee = rule.slots.payee ?? null;
  }
  const fill = <K extends keyof NluResult['slots']>(key: K) => {
    if (slots[key] === null || slots[key] === undefined) {
      const candidate = rule.slots[key];
      if (candidate !== null && candidate !== undefined) slots[key] = candidate as any;
    }
  };
  (['phone', 'note', 'period', 'category', 'productName', 'riskLevel', 'cardAction', 'cardLast4', 'subscriptionName', 'birthdayDate', 'query', 'isScheduled', 'scheduleDate', 'splitNames', 'splitTotal', 'wealthAction'] as const).forEach(fill);
  // 提示词内对手机号做了脱敏，原文抽取到的 11 位号码优先用于联系人匹配
  if (rule.slots.phone && (slots.phone ?? '').replace(/D/g, '').length < 11) {
    slots.phone = rule.slots.phone;
  }
  if (slots.limitAmount === null && rule.slots.limitAmount !== null) slots.limitAmount = rule.slots.limitAmount;
  if (slots.budget === null && rule.slots.budget !== null) slots.budget = rule.slots.budget;

  let intent = parsed.intent;
  if (intent === 'unknown' && rule.intent !== 'unknown') intent = rule.intent;
  const references = [...new Set([...(parsed.references ?? []), ...(rule.references ?? [])])];
  return {
    ...parsed,
    intent,
    slots,
    references,
    confidence: intent === parsed.intent ? parsed.confidence : Math.max(parsed.confidence, 0.7),
  };
}

export async function understand(input: UnderstandInput): Promise<NluResult> {
  const rule = parseWithRules(input.text, {
    context: input.context,
    user: input.user,
    state: input.state,
    source: config.llm.offline ? 'offline' : 'rules',
  });

  if (!metrics.llmEnabled()) {
    return rule;
  }

  const key = cacheKey(input.text, {
    lastPayee: input.context.lastPayee,
    lastAmountCents: input.context.lastAmountCents,
  });
  // 每条消息都必须调用模型做语义理解；缓存只在模型失败时兜底
  const cached = cacheGet(key);

  if (!consumeLlmBudget()) {
    return { ...rule, source: 'rules', rationale: '今日 LLM 演示配额已用完，规则引擎接管' };
  }

  const messages = buildNluPrompt({
    text: input.text,
    context: input.context,
    user: input.user,
    history: input.history,
  });

  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await callChatCompletion(messages, {
        retryHint: attempt > 0 ? lastError.slice(0, 200) : undefined,
      });
      const parsed = parseNluContent(response.content, { text: input.text, source: 'llm' });
      metrics.recordLlm({
        ok: true,
        source: 'llm',
        latencyMs: response.latencyMs,
        promptTokens: response.promptTokens,
        completionTokens: response.completionTokens,
        model: response.model,
      });
      const merged = mergeWithRules(parsed, rule);
      cacheSet(key, merged);
      return merged;
    } catch (error) {
      lastError =
        error instanceof NluParseError
          ? `JSON 结构不合法：${error.message}`
          : error instanceof LlmError
            ? `${error.code}: ${error.message}`
            : error instanceof Error
              ? error.message
              : String(error);
      if (attempt === 0) continue;
      metrics.recordLlm({ ok: false, source: 'llm', latencyMs: 0 });
    }
  }

  if (cached) {
    metrics.recordCacheHit();
    return { ...mergeWithRules(cached, rule), rationale: `${cached.rationale ?? ''}（模型暂时不可用，使用缓存解析）`.trim() };
  }
  return { ...rule, source: config.llm.offline ? 'offline' : 'rules' };
}
