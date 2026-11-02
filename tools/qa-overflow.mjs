/** 定位控制台在窄屏下的横向溢出元素。node tools/qa-overflow.mjs */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.QA_PORT ?? 8795);
const CDP_PORT = Number(process.env.QA_CDP_PORT ?? 9336);
const BASE = `http://localhost:${PORT}`;
const CHROME = process.env.QA_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bank-qa-overflow-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
    env: { ...process.env, PORT: String(PORT), DATA_DIR: path.join(TMP, 'data'), LLM_OFFLINE: '1', LOG_LEVEL: 'silent' },
    stdio: 'ignore',
  });
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${path.join(TMP, 'chrome')}`,
    '--no-first-run',
    '--window-size=375,800',
    'about:blank',
  ]);
  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`${BASE}/api/health`)).ok) break;
      } catch {}
      await sleep(300);
    }
    let list;
    for (let i = 0; i < 40; i++) {
      try {
        list = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json());
        if (list.find((t) => t.type === 'page')) break;
      } catch {}
      await sleep(300);
    }
    const page = list.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
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
    await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 375, height: 800, deviceScaleFactor: 2, mobile: true });
    await send(ws, 'Page.navigate', { url: `${BASE}/login` });
    await sleep(2000);
    await evaluate(ws, `await fetch('/api/auth/guest',{method:'POST'}); return 'ok';`);
    for (const [label, url] of [['console', `${BASE}/console`], ['app', `${BASE}/app`]]) {
      await send(ws, 'Page.navigate', { url });
      await sleep(2500);
      const info = await evaluate(
        ws,
        `const vw = document.documentElement.clientWidth;
         const out = [];
         document.querySelectorAll('*').forEach((el) => {
           const r = el.getBoundingClientRect();
           if (r.right > vw + 1 || r.width > vw + 1) {
             out.push({
               tag: el.tagName.toLowerCase(),
               cls: String(el.className).slice(0, 90),
               left: Math.round(r.left),
               right: Math.round(r.right),
               width: Math.round(r.width),
               text: (el.textContent || '').trim().slice(0, 28),
             });
           }
         });
         return { vw, scrollWidth: document.documentElement.scrollWidth, count: out.length, sample: out.slice(0, 12) };`,
      );
      console.log(`\n### ${label}: viewport=${info.vw} scrollWidth=${info.scrollWidth} offenders=${info.count}`);
      for (const item of info.sample) console.log(JSON.stringify(item));
    }
  } finally {
    chrome.kill();
    server.kill();
    await sleep(300);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
}

void main();
