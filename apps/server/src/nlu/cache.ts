import type { NluResult } from '@bank/shared';

const MAX = 120;
const cache = new Map<string, NluResult>();

export function normalizeUtterance(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, '')
    .replace(/[，。！？,.!?；;：:]/g, '')
    .toLowerCase();
}

export function cacheKey(text: string, context: { lastPayee?: string; lastAmountCents?: number }): string {
  return [normalizeUtterance(text), context.lastPayee ?? '', context.lastAmountCents ?? ''].join('|');
}

export function cacheGet(key: string): NluResult | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  cache.delete(key);
  cache.set(key, hit);
  return { ...hit, source: 'cache' };
}

export function cacheSet(key: string, value: NluResult): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, { ...value, source: 'llm' });
  while (cache.size > MAX) {
    const first = cache.keys().next().value;
    if (first === undefined) break;
    cache.delete(first);
  }
}

export function cacheClear(): void {
  cache.clear();
}

export function cacheSize(): number {
  return cache.size;
}
