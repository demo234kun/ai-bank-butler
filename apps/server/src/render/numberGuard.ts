const AMOUNT_RE = /¥\s?(-?[\d,]+(?:\.\d{1,2})?)/g;
const PERCENT_RE = /(-?\d+(?:\.\d+)?)\s*%/g;

function collectNumeric(value: unknown, out: number[], depth = 0): void {
  if (depth > 8 || value === null || value === undefined) return;
  if (typeof value === 'number' && Number.isFinite(value)) {
    out.push(value, value / 100, Math.abs(value), Math.abs(value) / 100);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectNumeric(item, out, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) collectNumeric(item, out, depth + 1);
  }
}

export interface NumberGuardResult {
  ok: boolean;
  checked: number;
  blocked: Array<{ token: string; reason: string }>;
}

/**
 * 幻觉兜底：回复中出现的金额与百分比必须能在工具结果 / 卡片数据中找到，
 * 金额按元与分两种尺度比对，防止模板或措辞环节凭空生成数字。
 */
export function guardNumbers(text: string, evidence: unknown): NumberGuardResult {
  const allowed: number[] = [0];
  collectNumeric(evidence, allowed);
  const allowedSet = allowed.map((n) => Math.round(n * 100) / 100);
  const blocked: NumberGuardResult['blocked'] = [];
  let checked = 0;

  const check = (raw: string, token: string) => {
    checked += 1;
    const value = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(value)) {
      blocked.push({ token, reason: '无法解析的数字' });
      return;
    }
    const ok = allowedSet.some((candidate) => Math.abs(candidate - value) <= 0.011);
    if (!ok) blocked.push({ token, reason: '数字不在工具结果证据集合内' });
  };

  for (const match of text.matchAll(AMOUNT_RE)) {
    check(match[1]!, match[0]);
  }
  for (const match of text.matchAll(PERCENT_RE)) {
    check(match[1]!, match[0]);
  }

  return { ok: blocked.length === 0, checked, blocked };
}
