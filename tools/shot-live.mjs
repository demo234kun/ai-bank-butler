/** 打开公网页面截图：node tools/shot-live.mjs <path> <outName> [width] */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import os from 'node:os';

const target = process.argv[2] ?? '/login';
const name = process.argv[3] ?? 'live';
const width = Number(process.argv[4] ?? 390);
const BASE = process.env.QA_BASE ?? 'https://cooperation-spelling-indices-arrangements.trycloudflare.com';
const CDP = Number(process.env.QA_CDP_PORT ?? 9341);
const CHROME = process.env.QA_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bank-shot-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let id = 1;
const pending = new Map();

function send(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const n = id++;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
}

async function main() {
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${CDP}`,
    `--user-data-dir=${path.join(TMP, 'c')}`,
    '--no-first-run',
    '--ignore-certificate-errors',
    `--window-size=${width},860`,
    'about:blank',
  ]);
  try {
    let list;
    for (let i = 0; i < 40; i++) {
      try {
        list = await fetch(`http://127.0.0.1:${CDP}/json/list`).then((r) => r.json());
        if (list.some((t) => t.type === 'page')) break;
      } catch {}
      await sleep(300);
    }
    const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = rej;
    });
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    });
    await send(ws, 'Page.enable');
    await send(ws, 'Runtime.enable');
    await send(ws, 'Emulation.setDeviceMetricsOverride', { width, height: 860, deviceScaleFactor: 2, mobile: width < 700 });
    console.log("NAV:", JSON.stringify(BASE + target));
    await send(ws, "Page.navigate", { url: BASE + target });
    await sleep(6000);
    const info = await send(ws, 'Runtime.evaluate', {
      expression: `JSON.stringify({title:document.title, chars:document.body.innerText.length, text:document.body.innerText.slice(0,220)})`,
      returnByValue: true,
    });
    console.log(info.result.value);
    const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
    const out = path.join('docs/assets/product-review', `${name}.png`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log('saved', out);
  } finally {
    chrome.kill();
    await sleep(300);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
}

void main();
