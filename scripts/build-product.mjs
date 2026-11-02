/** 纯产品版构建：跨平台设置 VITE_DEMO_LABELS=0 后调用 vite build。 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'], {
  cwd: path.join(root, 'apps/web'),
  env: { ...process.env, VITE_DEMO_LABELS: '0' },
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
