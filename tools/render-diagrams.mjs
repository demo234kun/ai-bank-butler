/**
 * 把 docs/architecture.md 里的 Mermaid 图渲染成 PNG，供评审直接查看。
 *   node tools/render-diagrams.mjs
 * 需要本机 Chrome；渲染时从 jsDelivr 拉取 mermaid。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'docs', 'architecture.md');
const OUT_DIR = path.join(ROOT, 'docs', 'assets');
const CHROME =
  process.env.QA_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const NAMES = ['architecture', 'sequence'];

function blocks(markdown) {
  const out = [];
  const re = /```mermaid\r?\n([\s\S]*?)```/g;
  let match;
  while ((match = re.exec(markdown))) out.push(match[1].trim());
  return out;
}

function html(source, index) {
  const title = index === 0 ? 'AI 银行管家 · 系统架构' : 'AI 银行管家 · 一次对话时序';
  // 定义文本用 JSON 注入，避免 <br/> 被 HTML 解析掉
  const payload = JSON.stringify(source).replace(/<\//g, '<\/');
  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  html,body{margin:0;background:#ffffff;font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif}
  #wrap{display:inline-block;padding:26px 30px}
  h2{font-size:17px;color:#0f3d33;margin:0 0 14px}
  #diagram svg{max-width:none!important}
  #error{color:#b3392e;font:12px/1.6 Consolas,monospace;white-space:pre-wrap;max-width:1200px}
  #content-size{position:fixed;left:-10000px;top:0}
</style></head>
<body><div id="wrap">
<h2>${title}</h2>
<div id="diagram"></div>
<pre id="error"></pre>
</div>
<script type="module">
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
mermaid.initialize({
  startOnLoad: false,
  theme: 'base',
  securityLevel: 'loose',
  flowchart: { htmlLabels: true, curve: 'basis' },
  themeVariables: {
    primaryColor: '#f2efe7', primaryBorderColor: '#0f3d33', primaryTextColor: '#14251f',
    lineColor: '#8c6c2f', fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif', fontSize: '15px',
  },
});
const src = ${payload};
const box = document.getElementById('diagram');
box.textContent = src;
try {
  await mermaid.run({ nodes: [box] });
  const svg = box.querySelector('svg');
  if (svg) {
    const vb = svg.viewBox && svg.viewBox.baseVal;
    svg.removeAttribute('style');
    if (vb && vb.width) {
      svg.setAttribute('width', String(Math.ceil(vb.width)));
      svg.setAttribute('height', String(Math.ceil(vb.height)));
      svg.style.width = Math.ceil(vb.width) + 'px';
      svg.style.height = Math.ceil(vb.height) + 'px';
    }
  }
} catch (err) {
  document.getElementById('error').textContent = String(err && err.message ? err.message : err);
}
const rect = document.getElementById('wrap').getBoundingClientRect();
const marker = document.createElement('div');
marker.id = 'content-size';
marker.textContent = Math.ceil(rect.width) + 'x' + Math.ceil(rect.height);
document.body.appendChild(marker);
<\/script></body></html>`;
}

function main() {
  if (!fs.existsSync(CHROME)) {
    console.error(`找不到 Chrome：${CHROME}（可用 QA_CHROME 环境变量指定）`);
    process.exitCode = 1;
    return;
  }
  const sources = blocks(fs.readFileSync(SRC, 'utf8'));
  if (!sources.length) {
    console.error('未在 architecture.md 中找到 mermaid 代码块');
    process.exitCode = 1;
    return;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bank-diagram-'));

  sources.slice(0, NAMES.length).forEach((source, index) => {
    const page = path.join(tmp, `${NAMES[index]}.html`);
    fs.writeFileSync(page, html(source, index), 'utf8');
    const out = path.join(OUT_DIR, `${NAMES[index]}.png`);
    const url = `file:///${page.replace(/\\/g, '/')}`;
    const baseArgs = [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      `--user-data-dir=${path.join(tmp, `c${index}`)}`,
      '--virtual-time-budget=20000',
    ];
    try {
      // 第一遍：量出内容实际尺寸，避免截图留下大片空白
      const dom = execFileSync(CHROME, [...baseArgs, '--window-size=3800,2500', '--dump-dom', url], {
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 64 * 1024 * 1024,
      }).toString();
      const size = /id="content-size"[^>]*>(\d+)x(\d+)</.exec(dom);
      const width = size ? Math.min(4200, Number(size[1]) + 20) : 1600;
      const height = size ? Math.min(3000, Number(size[2]) + 20) : 1200;
      execFileSync(CHROME, [
        ...baseArgs,
        `--window-size=${width},${height}`,
        '--force-device-scale-factor=1.6',
        `--screenshot=${out}`,
        url,
      ], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
    } catch (error) {
      console.error(`渲染失败 ${NAMES[index]}：${error?.stderr?.toString().slice(0, 200) ?? error}`);
      return;
    }
    const size = fs.existsSync(out) ? fs.statSync(out).size : 0;
    console.log(`${size > 0 ? '✓' : '✗'} ${path.relative(ROOT, out)} (${(size / 1024).toFixed(0)} KB)`);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
}

main();
