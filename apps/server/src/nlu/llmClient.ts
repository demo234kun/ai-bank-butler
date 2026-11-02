import { config } from '../config';

export interface LlmCallResult {
  content: string;
  model: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
}

export class LlmError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export async function callChatCompletion(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options: { temperature?: number; maxTokens?: number; retryHint?: string } = {},
): Promise<LlmCallResult> {
  if (!config.llm.apiKey || !config.llm.baseUrl) {
    throw new LlmError('LLM_NOT_CONFIGURED', '未配置 LLM_BASE_URL / LLM_API_KEY');
  }
  const started = Date.now();
  const payloadMessages = [...messages];
  if (options.retryHint) {
    payloadMessages.push({
      role: 'user',
      content: `上一次输出无法解析：${options.retryHint}。请只输出严格合法的 JSON 对象，不要 Markdown。`,
    });
  }
  let response: Response;
  try {
    response = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.llm.apiKey}`,
      },
      body: JSON.stringify({
        model: config.llm.model,
        messages: payloadMessages,
        temperature: options.temperature ?? 0,
        max_tokens: options.maxTokens ?? config.llm.maxTokens,
        response_format: { type: 'json_object' },
        stream: false,
      }),
      signal: AbortSignal.timeout(config.llm.timeoutMs),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new LlmError('LLM_NETWORK_ERROR', message);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new LlmError(`LLM_HTTP_${response.status}`, text.slice(0, 300));
  }
  const json = (await response.json()) as any;
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new LlmError('LLM_EMPTY', '模型返回内容为空');
  }
  return {
    content,
    model: json?.model ?? config.llm.model,
    latencyMs: Date.now() - started,
    promptTokens: Number(json?.usage?.prompt_tokens ?? 0),
    completionTokens: Number(json?.usage?.completion_tokens ?? 0),
  };
}
