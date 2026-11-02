/**
 * 产品端 UI 回归：用真实浏览器验证注册 / 风险测评 / 交易详情 / 争议工单 / 控制台响应式。
 *
 * 启动：node --experimental-vm-modules tools/qa-product.mjs（需先 npm run build）
 * 依赖：本机 Chrome，无需额外 npm 包（Node 24 自带 WebSocket，直连 CDP）。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.QA_PORT ?? 8795);
const CDP_PORT = Number(process.env.QA_CDP_PORT ?? 9335);
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve('docs/assets/product-review');
const CHROME =
  process.env.QA_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bank-qa-'));
const profileDir = path.join(TMP, 'chrome');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
let failures = 0;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitHealth(timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {}
    await sleep(300);
  }
  throw new Error('后端未启动');
}

async function connectCdp() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const list = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json());
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          ws.onopen = resolve;
          ws.onerror = reject;
        });
        return ws;
      }
    } catch {}
    await sleep(300);
  }
  throw new Error('无法连接 Chrome DevTools');
}

let nextId = 1;
const pending = new Map();

function send(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function attach(ws) {
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message}`));
      else resolve(msg.result);
    }
  });
}

async function evaluate(ws, expression) {
  const result = await send(ws, 'Runtime.evaluate', {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate 失败');
  }
  return result.result.value;
}

async function goto(ws, url) {
  await send(ws, 'Page.navigate', { url });
  await sleep(1600);
}

async function waitSelector(ws, selector, timeoutMs = 9000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = await evaluate(ws, `return Boolean(document.querySelector(${JSON.stringify(selector)}));`);
    if (found) return true;
    await sleep(250);
  }
  return false;
}

const typeJs = `
const set = (selector, value) => {
  const el = document.querySelector(selector);
  if (!el) return 'missing:' + selector;
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
};
`;

async function fill(ws, selector, value) {
  return evaluate(ws, `${typeJs} return set(${JSON.stringify(selector)}, ${JSON.stringify(value)});`);
}

async function clickText(ws, selectorPart, text) {
  return evaluate(
    ws,
    `const nodes = [...document.querySelectorAll(${JSON.stringify(selectorPart)})];
     const hit = nodes.find((n) => (n.textContent || '').trim().includes(${JSON.stringify(text)}));
     if (!hit) return 'not-found:' + ${JSON.stringify(text)};
     hit.click();
     return 'ok';`,
  );
}

async function waitText(ws, text, timeoutMs = 9000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = await evaluate(
      ws,
      `return document.body.innerText.includes(${JSON.stringify(text)});`,
    );
    if (found) return true;
    await sleep(250);
  }
  return false;
}

async function shot(ws, name, clip) {
  const { data } = await send(ws, 'Page.captureScreenshot', { format: 'png', ...(clip ? { clip, captureBeyondViewport: true } : {}) });
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  return file;
}

async function setViewport(ws, width, height) {
  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: width < 700,
  });
  await sleep(600);
}

async function main() {
  const server = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: path.join(TMP, 'data'),
      LLM_OFFLINE: '1',
      LOG_LEVEL: 'silent',
      DEMO_NODE_DELAY_MS: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += String(d)));
  server.stderr.on('data', (d) => (serverLog += String(d)));

  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=390,844',
    'about:blank',
  ]);
  let chromeLog = '';
  chrome.stderr.on('data', (d) => (chromeLog += String(d)));

  let ws;
  try {
    await waitHealth();
    ws = await connectCdp();
    attach(ws);
    await send(ws, 'Page.enable');
    await send(ws, 'Runtime.enable');
    await setViewport(ws, 390, 844);

    // ---- 注册：短信验证码，且不再手填风险等级 ----
    await goto(ws, `${BASE}/register`);
    check('注册页可访问', await waitSelector(ws, 'input[placeholder="怎么称呼你"]'));
    const hasRiskPicker = await evaluate(
      ws,
      `return [...document.querySelectorAll('button')].some((b) => (b.textContent||'').trim() === '保守');`,
    );
    check('注册页移除风险等级手选项', !hasRiskPicker);
    const phone = `138${String(Date.now()).slice(-8)}`;
    await fill(ws, 'input[placeholder="怎么称呼你"]', '测评用户');
    await fill(ws, 'input[inputmode="numeric"]', phone);
    const passwords = await evaluate(
      ws,
      `return [...document.querySelectorAll('input[type="password"]')].length;`,
    );
    check('注册页含密码与确认密码', passwords >= 2, `password inputs=${passwords}`);
    const passwordFields = await evaluate(
      ws,
      `const nodes=[...document.querySelectorAll('input[type="password"]')];
       const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
       nodes.forEach((el)=>{ setter.call(el,'secret123'); el.dispatchEvent(new Event('input',{bubbles:true})); });
       return nodes.length;`,
    );
    await clickText(ws, 'button', '获取验证码');
    await sleep(1200);
    const otpValue = await evaluate(
      ws,
      `const numeric=[...document.querySelectorAll('input[inputmode="numeric"]')];
       const field=numeric[numeric.length-1];
       return field && /^[0-9]{6}$/.test(field.value) ? field.value : null;`,
    );
    check('演示通道下发一次性随机码并自动填入', Boolean(otpValue), `code=${otpValue}`);
    await shot(ws, 'qa-register');
    await clickText(ws, 'button[type="submit"]', '创建并进入');
    await sleep(2200);
    const afterRegister = await evaluate(ws, `return location.pathname;`);
    check('注册成功后进入 App', afterRegister.startsWith('/app'), `path=${afterRegister}`);

    // ---- 新用户：未测评状态 ----
    await goto(ws, `${BASE}/app/profile`);
    check('我的页可访问', await waitText(ws, '登录与安全'));
    const profileRiskRow = await evaluate(
      ws,
      `const rows=[...document.querySelectorAll('button')];
       const row=rows.find((b)=>(b.textContent||'').includes('风险测评'));
       return row ? row.textContent : null;`,
    );
    check(
      '我的页显示未测评提示',
      Boolean(profileRiskRow && profileRiskRow.includes('已过期')),
      profileRiskRow ?? '',
    );

    // ---- 风险测评流程 ----
    await clickText(ws, 'button', '风险测评');
    check('风险测评弹层打开', await waitText(ws, '风险承受能力测评'));
    const sheetTitle = await evaluate(
      ws,
      `return [...document.querySelectorAll('div')].some((d)=>(d.textContent||'').trim()==='风险承受能力测评');`,
    );
    check('测评标题存在', sheetTitle);
    await shot(ws, 'qa-risk-step1');
    for (let step = 0; step < 5; step += 1) {
      const picked = await evaluate(
        ws,
        `const options=[...document.querySelectorAll('button[aria-pressed]')];
         if(!options.length) return 'no-options';
         options[Math.min(${step}, options.length - 1) === options.length - 1 ? options.length - 1 : 0].click();
         return 'ok';`,
      );
      if (picked !== 'ok') break;
      const advanced = await clickText(ws, 'button', step === 4 ? '提交测评' : '下一题');
      await sleep(900);
      if (step === 2) await shot(ws, 'qa-risk-question');
      if (advanced.startsWith('not-found')) break;
    }
    const assessmentResult = await evaluate(
      ws,
      `return document.body.innerText.includes('测评结果') ? document.body.innerText.match(/测评结果[\\s\\S]{0,80}/)?.[0] : null;`,
    );
    check('测评结果页展示等级与分数', Boolean(assessmentResult), String(assessmentResult ?? '').replace(/\n/g, ' | '));
    await shot(ws, 'qa-risk-result');
    await clickText(ws, 'button', '完成');
    await sleep(1000);
    const rowAfter = await evaluate(
      ws,
      `const rows=[...document.querySelectorAll('button')];
       const row=rows.find((b)=>(b.textContent||'').includes('风险测评'));
       return row ? row.textContent : null;`,
    );
    check('我的页回显新测评结果', Boolean(rowAfter && !rowAfter.includes('已过期')), rowAfter ?? '');

    await shot(ws, 'qa-profile-risk');

    // ---- 编辑资料不应再改风险等级 ----
    await clickText(ws, 'button', '编辑');
    await sleep(500);
    const editModalText = await evaluate(ws, `return document.body.innerText.includes('编辑资料');`);
    const editHasRisk = await evaluate(
      ws,
      `return [...document.querySelectorAll('span')].some((s)=>(s.textContent||'').trim()==='风险偏好');`,
    );
    check('编辑资料保留且无风险等级选项', editModalText && !editHasRisk);
    await shot(ws, 'qa-profile-edit');
    await clickText(ws, 'button', '取消');

    // ---- 交易详情 + 争议工单 ----
    await goto(ws, `${BASE}/app/activity`);
    check('账单页可访问', await waitText(ws, '交易明细'));
    const rowOpened = await evaluate(
      ws,
      `const rows=[...document.querySelectorAll('button')].filter((b)=>(b.textContent||'').includes('¥')||(b.textContent||'').includes('-'));
       const target=rows.find((b)=>b.querySelector('svg'));
       if(!target) return 'no-row';
       target.click(); return 'ok';`,
    );
    check('交易行可点击', rowOpened === 'ok', rowOpened);
    check('交易详情弹层打开', await waitText(ws, '交易详情'));
    const detailText = await evaluate(ws, `return document.body.innerText.includes('交易详情');`);
    check('详情显示交易明细字段', detailText);
    const detailAmount = await evaluate(
      ws,
      `const big=[...document.querySelectorAll('div')].filter((d)=>/^[+-][¥]?[\\d,]+\\.\\d{2}$/.test((d.textContent||'').trim()));
       return big.length ? big[0].textContent.trim() : null;`,
    );
    check('详情显示金额', Boolean(detailAmount), detailAmount ?? '');
    await shot(ws, 'qa-txn-detail');
    const submitResult = await clickText(ws, 'button', '提交争议申诉');
    check('争议提交按钮存在', submitResult === 'ok', submitResult);
    await sleep(1600);
    const ticketText = await evaluate(
      ws,
      `const m=document.body.innerText.match(/争议工单\\s*\\S+/); return m?m[0]:null;`,
    );
    check('工单号回显', Boolean(ticketText), ticketText ?? '');
    await shot(ws, 'qa-dispute-ticket');
    await evaluate(ws, `const btn=[...document.querySelectorAll('button[aria-label="关闭交易详情"]')]; btn.forEach(b=>b.click()); return 'ok';`);
    await sleep(800);
    const ticketSection = await evaluate(
      ws,
      `return document.body.innerText.includes('申诉工单');`,
    );
    check('账单页展示申诉工单区块', ticketSection);
    await shot(ws, 'qa-activity-dispute');

    // ---- 语音输入：真实通道，不再是随机样例 ----
    await goto(ws, `${BASE}/app/chat`);
    const micLabel = await evaluate(
      ws,
      `const btn=document.querySelector('button[aria-label*="语音"], button[aria-label*="指纹"], button[aria-label*="通行密钥"]');
       return btn ? btn.getAttribute('aria-label') : null;`,
    );
    check('麦克风按钮标注真实识别通道', Boolean(micLabel) && !String(micLabel).includes('演示模拟'), String(micLabel));
    const fakeTextGone = await evaluate(
      ws,
      `return !document.body.innerText.includes('演示模拟');`,
    );
    check('页面无“演示模拟”假聆听文案', fakeTextGone);
    await evaluate(ws, `document.querySelector('button[aria-label*="语音"]')?.click(); return 'ok';`);
    await sleep(2000);
    const afterMic = await evaluate(
      ws,
      `const t=document.body.innerText;
       const keys=['麦克风权限','语音识别','正在聆听','录音中','浏览器不支持','等待系统生物识别'];
       const hit=keys.find((k)=>t.includes(k));
       return hit ? hit + ' · ' + t.slice(t.indexOf(hit), t.indexOf(hit) + 48).replace(/\s+/g,' ') : null;`,
    );
    check('点击语音后给出真实状态或错误', Boolean(afterMic), String(afterMic ?? ''));
    await shot(ws, 'qa-voice-input');

    // ---- 提醒中心与计划 ----
    await goto(ws, `${BASE}/app`);
    const bell = await evaluate(
      ws,
      `const b=document.querySelector('button[aria-label*="计划与提醒"]'); return b?b.getAttribute('aria-label'):null;`,
    );
    check('首页有提醒入口', Boolean(bell), String(bell ?? ''));
    await evaluate(ws, `document.querySelector('button[aria-label*="计划与提醒"]')?.click(); return 'ok';`);
    await sleep(1400);
    check('提醒中心展示待执行计划', await waitText(ws, '待执行计划'));
    await shot(ws, 'qa-notifications');
    await evaluate(ws, `document.querySelector('button[aria-label="关闭提醒中心"]')?.click(); return 'ok';`);

    // ---- 生物识别录入入口 ----
    await goto(ws, `${BASE}/app/profile`);
    const bioRow = await evaluate(
      ws,
      `const rows=[...document.querySelectorAll('button')];
       const row=rows.find((b)=>(b.textContent||'').includes('本机生物识别'));
       return row?row.textContent:null;`,
    );
    check('我的页提供生物识别录入', Boolean(bioRow), String(bioRow ?? '').slice(0, 64));

    // ---- 控制台调度面板 ----
    await setViewport(ws, 1440, 900);
    await goto(ws, `${BASE}/console`);
    await clickText(ws, 'button', '运行指标');
    await sleep(1500);
    check('控制台展示计划任务与调度面板', await waitText(ws, '计划任务与调度'));
    await shot(ws, 'qa-console-scheduler');
    await setViewport(ws, 390, 844);

    // ---- 登录页找回密码入口 ----
    await goto(ws, `${BASE}/forgot-password`);
    const forgotVisible = await evaluate(ws, `return document.body.innerText.includes('找回密码');`);
    check('找回密码页可访问', forgotVisible);
    await shot(ws, 'qa-forgot-password');

    // ---- 控制台响应式 ----
    await setViewport(ws, 1440, 900);
    await goto(ws, `${BASE}/console`);
    const guestBtn = await clickText(ws, 'button', '评委演示入口');
    if (guestBtn === 'ok') {
      await sleep(2500);
    }
    const consolePath = await evaluate(ws, `return location.pathname;`);
    check('控制台可进入', consolePath.startsWith('/console'), `path=${consolePath}`);
    await shot(ws, 'qa-console-1440');
    await setViewport(ws, 1024, 768);
    await sleep(700);
    await shot(ws, 'qa-console-1024');
    const overflow = await evaluate(
      ws,
      `return document.documentElement.scrollWidth - document.documentElement.clientWidth;`,
    );
    check('控制台 1024 无横向溢出', Number(overflow) <= 1, `overflow=${overflow}px`);
    await setViewport(ws, 375, 780);
    await sleep(700);
    await shot(ws, 'qa-console-375');
    const mobileOverflow = await evaluate(
      ws,
      `return document.documentElement.scrollWidth - document.documentElement.clientWidth;`,
    );
    check('控制台 375 无横向溢出', Number(mobileOverflow) <= 1, `overflow=${mobileOverflow}px`);

    // ---- 产品端首页在窄屏的排版 ----
    await setViewport(ws, 375, 812);
    await goto(ws, `${BASE}/app`);
    await sleep(1200);
    await shot(ws, 'qa-home-375');
    const homeOverflow = await evaluate(
      ws,
      `return document.documentElement.scrollWidth - document.documentElement.clientWidth;`,
    );
    check('首页 375 无横向溢出', Number(homeOverflow) <= 1, `overflow=${homeOverflow}px`);
    const tiny = await evaluate(
      ws,
      `const sizes=new Set();
       document.querySelectorAll('div,span,button,p').forEach((el)=>{
         const own=[...el.childNodes].some((n)=>n.nodeType===3 && n.textContent.trim());
         if(!own) return;
         sizes.add(Number(getComputedStyle(el).fontSize.replace('px','')));
       });
       return [...sizes].sort((a,b)=>a-b).slice(0,3);`,
    );
    check('最小字号已抬到 8.5px 以上', Array.isArray(tiny) && tiny[0] >= 8.5, `smallest=${(tiny ?? []).join('/')}`);
  } catch (error) {
    failures += 1;
    console.error('QA 运行出错：', error);
    console.error(serverLog.slice(-2000));
    console.error(chromeLog.slice(-1500));
  } finally {
    const summary = {
      at: new Date().toISOString(),
      port: PORT,
      checks: results.length,
      failures,
      results,
    };
    fs.writeFileSync(path.join(OUT, 'qa-product.json'), JSON.stringify(summary, null, 2), 'utf8');
    chrome.kill();
    server.kill();
    await sleep(400);
    fs.rmSync(TMP, { recursive: true, force: true });
    console.log(`\n${failures === 0 ? 'QA PASS' : 'QA FAIL'} · ${results.length} 项检查，失败 ${failures} 项`);
    console.log(`截图目录：${OUT}`);
    process.exitCode = failures === 0 ? 0 : 1;
  }
}

void main();
