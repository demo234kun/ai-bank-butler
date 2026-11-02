/**
 * 生成第三方依赖与许可清单（离线，直接读 node_modules 元数据）。
 *   node scripts/list-licenses.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'THIRD-PARTY-LICENSES.md');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function licenseOf(pkg) {
  const raw = pkg.license ?? pkg.licenses;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw.map((item) => (typeof item === 'string' ? item : item.type)).join(' OR ');
  if (raw && typeof raw === 'object') return raw.type ?? 'UNKNOWN';
  return 'UNKNOWN';
}

function collect(dirs) {
  const found = new Map();
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('@')) {
        const scopeDir = path.join(dir, entry.name);
        for (const scoped of fs.readdirSync(scopeDir)) {
          add(path.join(scopeDir, scoped), `${entry.name}/${scoped}`);
        }
        continue;
      }
      add(path.join(dir, entry.name), entry.name);
    }
    if (found.size) continue;
  }

  function add(pkgDir, fallbackName) {
    const pkg = readJson(path.join(pkgDir, 'package.json'));
    if (!pkg || !pkg.name) return;
    const key = `${pkg.name}@${pkg.version ?? ''}`;
    if (found.has(key)) return;
    found.set(key, {
      name: pkg.name ?? fallbackName,
      version: pkg.version ?? '',
      license: licenseOf(pkg),
      description: (pkg.description ?? '').slice(0, 90),
      repo: typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url ?? '',
    });
  }

  return [...found.values()];
}

const workspaceDirs = [
  path.join(ROOT, 'node_modules'),
  path.join(ROOT, 'apps', 'server', 'node_modules'),
  path.join(ROOT, 'apps', 'web', 'node_modules'),
  path.join(ROOT, 'packages', 'shared', 'node_modules'),
];

const declared = {
  root: readJson(path.join(ROOT, 'package.json')) ?? {},
  server: readJson(path.join(ROOT, 'apps', 'server', 'package.json')) ?? {},
  web: readJson(path.join(ROOT, 'apps', 'web', 'package.json')) ?? {},
  shared: readJson(path.join(ROOT, 'packages', 'shared', 'package.json')) ?? {},
};

const direct = new Set();
for (const pkg of Object.values(declared)) {
  for (const name of Object.keys(pkg.dependencies ?? {})) direct.add(name);
  for (const name of Object.keys(pkg.devDependencies ?? {})) direct.add(name);
}

const external = collect(workspaceDirs).filter((item) => !item.name.startsWith('@bank/'));
const all = external.sort((a, b) => a.name.localeCompare(b.name));
const byLicense = new Map();
for (const item of all) byLicense.set(item.license, (byLicense.get(item.license) ?? 0) + 1);

const lines = [
  '# 第三方依赖与许可清单',
  '',
  `生成时间：${new Date().toISOString()}`,
  '',
  '本清单离线读取 `node_modules` 元数据生成，用于赛题「无侵犯他人知识产权」自查。',
  '运行时不包含任何真实银行商标、标识、字体或受版权保护的素材；界面图标为自绘 SVG。',
  '',
  '## 许可分布',
  '',
  '| 许可 | 包数量 |',
  '| --- | --- |',
  ...[...byLicense.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`),
  '',
  '## 直接依赖',
  '',
  '| 包 | 版本 | 许可 | 用途 |',
  '| --- | --- | --- | --- |',
  ...all
    .filter((item) => direct.has(item.name))
    .map((item) => `| ${item.name} | ${item.version} | ${item.license} | ${item.description} |`),
  '',
  '## 全部依赖（含间接）',
  '',
  '| 包 | 版本 | 许可 |',
  '| --- | --- | --- |',
  ...all.map((item) => `| ${item.name} | ${item.version} | ${item.license} |`),
  '',
  '## 模型与外部服务',
  '',
  '- 意图解析调用 DeepSeek 兼容的公开模型 API，密钥仅存服务端环境变量，不随源码提交。',
  '- 银行核心、短信、人脸、语音转写均为可配置接入通道，默认使用本地仿真实现，不包含任何供应商 SDK 二进制。',
  '- 公网演示使用 Cloudflare 快速隧道（独立可执行文件，已在打包排除列表中）。',
  '',
];

fs.writeFileSync(OUT, lines.join('\n').replace('`node scripts/list-licensed.mjs`.replace 生成为', '由 `node scripts/list-licenses.mjs` 生成，'), 'utf8');
console.log(`已生成 ${path.relative(ROOT, OUT)}：${all.length} 个第三方包，其中直接依赖 ${all.filter((i) => direct.has(i.name)).length} 个`);
