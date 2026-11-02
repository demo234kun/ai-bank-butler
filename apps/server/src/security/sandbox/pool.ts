import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const WORKER_PATH = fileURLToPath(new URL('./worker.cjs', import.meta.url));
const HARD_TIMEOUT_MS = 2200;

export interface SandboxResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  durationMs: number;
  engine: string;
}

/**
 * 受限逻辑沙箱：独立 worker + node:vm，无 require/fs/net，
 * vm 内 800ms 软超时，worker 2.2s 硬终止；返回值大小受限。
 */
export function runInSandbox(code: string, data: unknown): Promise<SandboxResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    const worker = new Worker(WORKER_PATH, {
      workerData: { code, data },
      resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 },
    });
    const finish = (result: Omit<SandboxResult, 'durationMs' | 'engine'>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate().catch(() => undefined);
      resolve({
        ...result,
        durationMs: Date.now() - started,
        engine: 'worker_threads + node:vm · 无 IO 白名单',
      });
    };
    const timer = setTimeout(() => {
      finish({ ok: false, error: `沙箱执行超过 ${HARD_TIMEOUT_MS}ms，已被硬终止` });
    }, HARD_TIMEOUT_MS);
    worker.once('message', (message: { ok: boolean; result?: unknown; error?: string }) => {
      finish({ ok: message.ok, result: message.result, error: message.error });
    });
    worker.once('error', (error) => {
      finish({ ok: false, error: error.message });
    });
    worker.once('exit', (code) => {
      if (!settled && code !== 0) finish({ ok: false, error: `worker 异常退出（code ${code}）` });
    });
  });
}

export function buildCategoryInsightCode(category: string): string {
  const safeCategory = JSON.stringify(category);
  return `
const target = ${safeCategory};
const rows = data.txns.filter((t) => t.category === target);
const totalCents = rows.reduce((sum, t) => sum + Math.abs(t.amountCents), 0);
const byMerchant = {};
for (const row of rows) {
  byMerchant[row.merchant] = (byMerchant[row.merchant] || 0) + Math.abs(row.amountCents);
}
const top = Object.entries(byMerchant).sort((a, b) => b[1] - a[1]).slice(0, 3);
__out = {
  category: target,
  count: rows.length,
  totalCents,
  avgCents: rows.length ? Math.round(totalCents / rows.length) : 0,
  topMerchants: top.map(([merchant, cents]) => ({ merchant, cents })),
  weeklyAvgCents: rows.length ? Math.round(totalCents / 26) : 0
};
`;
}

export const SANDBOX_SAMPLE_CODE = `// 在受限沙箱中运行：只有 data（已脱敏账单切片），无 require / fs / net
const rows = data.txns.filter((t) => t.category === '咖啡茶饮');
const totalCents = rows.reduce((sum, t) => sum + Math.abs(t.amountCents), 0);
const yearlyIfWeekly2Less = Math.round((totalCents / 26) * 52 - 2 * 35 * 52);
__out = {
  coffeeCount: rows.length,
  coffeeTotalCents: totalCents,
  saveIfTwoCupsLessPerWeek: yearlyIfLess(yearlyIfWeekly2Less)
};

function yearlyIfLess(value) {
  return Math.max(0, value);
}`;
