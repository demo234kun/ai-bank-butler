/**
 * 纯产品版检查：确认页面上不再出现"演示 / 合成 / 模拟"这类标注。
 * 用法：先 VITE_DEMO_LABELS=0 npm run build，再 node tools/qa-pure-product.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = Number(process.env.QA_PORT ?? 8797);
const CDP_PORT = Number(process.env.QA_CDP_PORT ?? 9338);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.QA_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.join(ROOT, 'docs/assets/product-review');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bank-pure-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FORBIDDEN = ['演示', '合成', '模拟', '评委模式', 'DEMO 数据'];

let nextId = 1;
const pending = new Map();

function send(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(ws, expression) {
  const r = await send(ws, 'Runtime.evaluate', {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

async function main() {
  const server = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: path.join(TMP, 'data'),
      LLM_OFFLINE: '1',
      LOG_LEVEL: 'silent',
      DEMO_NODE_DELAY_MS: '0',
    },
    stdio: 'ignore',
  });
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${path.join(TMP, 'chrome')}`,
    '--no-first-run',
    '--window-size=390,844',
    'about:blank',
  ]);
  let failures = 0;
  try {
    for (let i = 0; i < 80; i++) {
      try {
        if ((await fetch(`${BASE}/api/health`)).ok) break;
      } catch {}
      await sleep(400);
    }
    let list;
    for (let i = 0; i < 40; i++) {
      try {
        list = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json());
        if (list.some((t) => t.type === 'page')) break;
      } catch {}
      await sleep(300);
    }
    const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = rej;
    });
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    });
    await send(ws, 'Page.enable');
    await send(ws, 'Runtime.enable');
    await send(ws, 'Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });

    const visit = async (name, url, opts = {}) => {
      await send(ws, 'Page.navigate', { url });
      await sleep(opts.wait ?? 1800);
      if (opts.script) await evaluate(ws, opts.script);
      const text = await evaluate(ws, `return document.body.innerText;`);
      const hits = FORBIDDEN.filter((word) => text.includes(word));
      const ok = hits.length === 0;
      if (!ok) failures += 1;
      console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — 命中 ${hits.join('、')}`}`);
      if (opts.shot) {
        const { data } = await send(ws, 'Page.captureScreenshot', { format: 'png' });
        fs.mkdirSync(OUT, { recursive: true });
        fs.writeFileSync(path.join(OUT, `${opts.shot}.png`), Buffer.from(data, 'base64'));
      }
    };

    await visit('登录页', `${BASE}/login`, { shot: 'pure-login' });
    await visit('注册页', `${BASE}/register`, { shot: 'pure-register' });
    await visit('找回密码', `${BASE}/forgot-password`);
    await evaluate(
      ws,
      `await fetch('/api/auth/guest',{method:'POST'}); return 'ok';`,
    );
    await visit('首页', `${BASE}/app`, { shot: 'pure-home' });
    await visit('账单', `${BASE}/app/activity`, { shot: 'pure-activity' });
    await visit('卡片', `${BASE}/app/cards`, { shot: 'pure-cards' });
    await visit('我的', `${BASE}/app/profile`, { shot: 'pure-profile' });
    await visit(
      '聊天',
      `${BASE}/app/chat`,
      {
        wait: 2200,
        script: `
          const input=document.querySelector('input:not([type=hidden])');
          const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
          setter.call(input,'我还有多少钱');
          input.dispatchEvent(new Event('input',{bubbles:true}));
          input.closest('div').parentElement.querySelector('button[title="发送"]').click();
          return 'sent';`,
      },
    );
    await sleep(3200);
    const chatText = await evaluate(ws, `return document.body.innerText;`);
    const chatHits = FORBIDDEN.filter((word) => chatText.includes(word));
    if (chatHits.length) {
      failures += 1;
      console.log(`✗ 聊天回执卡片 — 命中 ${chatHits.join('、')}`);
    } else {
      console.log('✓ 聊天回执卡片');
    }
    const { data } = await send(ws, 'Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, 'pure-chat.png'), Buffer.from(data, 'base64'));
  } finally {
    chrome.kill();
    server.kill();
    await sleep(400);
    fs.rmSync(TMP, { recursive: true, force: true });
    console.log(failures === 0 ? '\nPURE PRODUCT PASS' : `\nPURE PRODUCT FAIL · ${failures} 处残留`);
    process.exitCode = failures === 0 ? 0 : 1;
  }
}

void main();
