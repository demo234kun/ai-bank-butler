import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE ?? 'http://localhost:8787';

try {
  const res = await fetch(`${BASE}/api/demo/reset`, { method: 'POST' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as any;
  console.log(`已通过接口重置演示数据，会话 ${data.session.id}`);
} catch {
  for (const file of [
    path.join(ROOT, 'data/runtime/state.json'),
    path.join(ROOT, 'data/audit/audit.jsonl'),
    path.join(ROOT, 'data/audit/checkpoint.json'),
    path.join(ROOT, 'data/audit/audit.tampered.jsonl'),
  ]) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      // ignore
    }
  }
  console.log('后端未运行，已删除本地运行时数据与审计文件；下次启动会重新生成种子数据。');
}
