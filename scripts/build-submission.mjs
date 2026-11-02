/**
 * 生成提交材料包（不含 PPT）。
 *
 *   node scripts/build-submission.mjs
 *   node scripts/build-submission.mjs --target="G:\\AI银行管家-提交材料"
 *   node scripts/build-submission.mjs --dry-run
 *
 * 目录结构：
 *   00-提交清单.md / 00-文件清单.md
 *   01-作品简介/      02-技术文档/      03-安全自评报告/
 *   04-源代码/        05-界面截图/      06-演示材料/
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((item) => item.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

const TARGET = path.resolve(arg('target', 'G:\\AI银行管家-提交材料'));
const DRY = process.argv.includes('--dry-run');
const DRIVE = path.parse(TARGET).root;

const DOCS = path.join(ROOT, 'docs');

const DOC_FILES = {
  '02-技术文档': [
    'architecture.md',
    'feature-description.md',
    'api.md',
    'openapi-banking.yaml',
    'banking-integration.md',
    'feature-audit.md',
    'product-review.md',
    'deploy.md',
    'THIRD-PARTY-LICENSES.md',
  ],
  '03-安全自评报告': ['security-self-assessment.md'],
  '06-演示材料': ['demo-script.md', 'submission-checklist.md', 'ppt-outline.md'],
};

const PPT_DIR = path.join(DOCS, 'ppt');
const PPT_FILES = ['AI银行管家-答辩.pptx', 'AI银行管家-答辩.pdf'];

const SOURCE_EXCLUDE_DIRS = new Set(['node_modules', 'dist', 'data', 'data-public', '.git', '.qoder', '.vscode', 'runtime']);
const SOURCE_EXCLUDE_EXT = new Set(['.exe', '.log', '.map']);

function walk(dir, filterFn, collected = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // 目录一律尝试下钻，是否收录由 filterFn 决定（源码用名称排除，截图用后缀）
      if (!SOURCE_EXCLUDE_DIRS.has(entry.name) && !entry.name.startsWith('.')) walk(full, filterFn, collected);
      continue;
    }
    if (filterFn(full, entry.name)) collected.push(full);
  }
  return collected;
}

function sourceAllowed(full, name) {
  const rel = path.relative(ROOT, full).split(path.sep).join('/');
  if (rel.startsWith('docs/assets')) return false; // 截图单独归档
  if (rel.startsWith('docs/ppt')) return false; // 答辩 PPT 单独归档到 06-演示材料
  if (rel.startsWith('data')) return false; // 运行数据（账号 / 审计）不随包提交
  if (SOURCE_EXCLUDE_DIRS.has(name)) return false;
  if (SOURCE_EXCLUDE_EXT.has(path.extname(name))) return false;
  if (name === '.env' || name === '.DS_Store') return false;
  return true;
}

function copyFile(from, to) {
  if (!fs.existsSync(from)) throw new Error(`缺少文件：${from}`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return { from: path.relative(ROOT, from).split(path.sep).join('/'), to, size: fs.statSync(to).size };
}

function copyTree(fromDir, toDir, allowed) {
  const files = walk(fromDir, allowed);
  if (!files.length) console.warn(`  警告：${path.relative(ROOT, fromDir)} 没有匹配到文件`);
  for (const file of files) {
    const rel = path.relative(fromDir, file);
    fs.mkdirSync(path.dirname(path.join(toDir, rel)), { recursive: true });
    fs.copyFileSync(file, path.join(toDir, rel));
  }
  return files.length;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);
}

function human(size) {
  if (size > 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size > 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}

function main() {
  if (!DRY && !fs.existsSync(DRIVE)) {
    console.error(`目标盘 ${DRIVE} 不存在，请先插入 U 盘/移动硬盘，或用 --target 指定其他位置。`);
    process.exitCode = 1;
    return;
  }

  console.log(`目标：${TARGET}${DRY ? '（dry-run，仅列出计划）' : ''}`);

  const plan = [];
  plan.push(['00-提交清单.md', path.join(DOCS, 'submission-checklist.md')]);
  plan.push(['01-作品简介/作品简介.md', path.join(DOCS, 'submission-intro.md')]);
  plan.push(['01-作品简介/README-报名提示.md', path.join(ROOT, 'README.md')]);
  for (const [folder, files] of Object.entries(DOC_FILES)) {
    for (const file of files) plan.push([`${folder}/${file}`, path.join(DOCS, file)]);
  }
  for (const file of PPT_FILES) {
    const from = path.join(PPT_DIR, file);
    if (fs.existsSync(from)) plan.push([`06-演示材料/${file}`, from]);
    else console.warn(`  警告：缺少 ${path.relative(ROOT, from)}（先跑 python scripts/build-ppt.py 与 tools/export-ppt-pdf.ps1）`);
  }

  if (DRY) {
    for (const [to, from] of plan) console.log(`  ${to}  ←  ${path.relative(ROOT, from)}`);
    console.log(`  04-源代码/  ←  整个仓库（排除 node_modules、dist、data、exe、docs/ppt）`);
    console.log(`  05-界面截图/  ←  docs/assets`);
    return;
  }

  fs.rmSync(TARGET, { recursive: true, force: true });
  fs.mkdirSync(TARGET, { recursive: true });

  const copied = [];
  for (const [to, from] of plan) copied.push(copyFile(from, path.join(TARGET, to)));

  const srcCount = copyTree(ROOT, path.join(TARGET, '04-源代码'), sourceAllowed);
  const shotCount = copyTree(
    path.join(DOCS, 'assets'),
    path.join(TARGET, '05-界面截图'),
    (full, name) => !fs.statSync(full).isDirectory() && /\.(png|jpg|jpeg|svg|webp|json|ico)$/i.test(name),
  );

  const intro = path.join(TARGET, '01-作品简介', '作品简介.txt');
  const introText = fs.readFileSync(path.join(DOCS, 'submission-intro.md'), 'utf8');
  // 只取简介正文那一段，标题、备选短句与品牌说明不进报名用 txt
  const body =
    introText
      .split(/\r?\n[ \t]*\r?\n/)
      .map((block) => block.trim())
      .find((block) => block && !block.startsWith('#') && !block.startsWith('>') && !block.startsWith('-')) ?? '';
  fs.writeFileSync(intro, `作品名称：AI 银行管家\n\n${body}\n`, 'utf8');

  const all = walk(TARGET, () => true);
  const totalBytes = all.reduce((sum, file) => sum + fs.statSync(file).size, 0);
  const manifest = [
    '# 提交材料文件清单',
    '',
    `- 生成时间：${new Date().toISOString()}`,
    `- 文件数：${all.length}`,
    `- 总大小：${human(totalBytes)}`,
    `- 源代码文件：${srcCount}　截图：${shotCount}`,
    '',
    '| 文件 | 大小 | SHA-256(前16) |',
    '| --- | --- | --- |',
    ...all
      .sort((a, b) => path.relative(TARGET, a).localeCompare(path.relative(TARGET, b)))
      .map((file) => {
        const size = fs.statSync(file).size;
        return `| ${path.relative(TARGET, file).split(path.sep).join('/')} | ${human(size)} | \`${sha256(file)}\` |`;
      }),
    '',
    '> 待补：演示视频录制。仓库地址 https://github.com/demo234kun/ai-bank-butler',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(TARGET, '00-文件清单.md'), manifest, 'utf8');

  console.log(`\n已生成：${TARGET}`);
  console.log(`文件 ${all.length + 1} 个，总计 ${human(totalBytes)}`);
  console.log('待补：演示视频录制。仓库地址 https://github.com/demo234kun/ai-bank-butler');
}

main();
