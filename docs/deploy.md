# 部署与公网访问

## 1. 本地开发

```bash
npm install
cp .env.example .env   # 可选：填 LLM_API_KEY
npm run dev
```

- 产品端：http://localhost:5173
- API：http://localhost:8787
- 评委控制台：登录后 /console

默认 `BANKING_MODE=simulated`、`SMS_MODE=demo`、`FACE_MODE=demo`，无需外部依赖。

### 切到真实接入层

```bash
BANKING_MODE=http \
BANKING_BASE_URL=https://bank-gateway.example.com \
BANKING_APP_ID=... BANKING_APP_SECRET=... \
SMS_MODE=http SMS_BASE_URL=https://verify.example.com SMS_APP_ID=... SMS_APP_SECRET=... \
FACE_MODE=http FACE_BASE_URL=https://verify.example.com FACE_APP_ID=... FACE_APP_SECRET=... \
npm run dev
```

配置缺项会直接启动失败；运行中银行不可用会返回 503 / 当前节点失败，不会回退合成数据。详见 [银行核心接入说明](banking-integration.md)。

本地联调与回归：

```bash
npm run bank:stub        # 契约桩，8791
npm run smoke:bank       # 六场景经 HTTP 银行核心适配层
npm run smoke:full       # 银行 + 短信 + 人脸全部 HTTP
```

本地 HTTP 不需要 `COOKIE_SECURE`；生产 HTTPS 必须设置为 `1`。

## 2. 生产构建 + 本机 HTTPS 隧道

```bash
npm run build
DATA_DIR="$PWD/data-public" PORT=8788 COOKIE_SECURE=1 npm start
```

Cloudflare Quick Tunnel（免费、无需 Cloudflare 账号）：

```bash
# Windows（本仓库演示使用）
tools/cloudflared.exe tunnel --url http://127.0.0.1:8788 --protocol http2 --no-autoupdate

# macOS
brew install cloudflared
cloudflared tunnel --url http://127.0.0.1:8788 --protocol http2

# Linux：下载 cloudflared 后
cloudflared tunnel --url http://127.0.0.1:8788 --protocol http2
```

终端会给出 `https://xxxx.trycloudflare.com`。这是 HTTPS，手机浏览器可直接打开并“添加到主屏幕”，Service Worker 与安装提示均可用。

注意：

- Quick Tunnel 的域名是临时的，进程/隧道重启会变化；仅适合答辩与短期分享。
- 机器休眠、断网或关闭服务，链接就不可用。
- 公网必须 `COOKIE_SECURE=1`；否则登录 Cookie 不具备 Secure 属性，不应对外暴露。
- 建议使用独立的 `DATA_DIR`（例如 `data-public`），避免公开演示数据与本地开发数据混在一起。
- 不要提交 `data*/`、`tools/`、`.env`。

## 3. 稳定托管（Docker）

仓库包含 [Dockerfile](../Dockerfile) 与 [.dockerignore](../.dockerignore)。单实例部署即可（会话在内存中，状态在 `/data`）：

```bash
docker build -t ai-bank-agent .
docker run -d --name ai-bank-agent \
  -p 8080:8080 \
  -v ai-bank-data:/data \
  -e LLM_BASE_URL=https://api.deepseek.com \
  -e LLM_MODEL=deepseek-chat \
  -e LLM_API_KEY=sk-... \
  -e AUTH_SECRET="$(openssl rand -hex 32)" \
  -e COOKIE_SECURE=1 \
  ai-bank-agent
```

- 平台需要支持持久卷（Fly.io、Render、Railway、自建 VPS 均可）；把卷挂到 `/data`。
- `AUTH_SECRET` 一旦更换，所有登录 Cookie 失效；请固定保存。不设置时使用 `/data/runtime/auth-secret`，需要持久卷。
- 端口使用 8080；平台自动提供 HTTPS。不要暴露到明文 HTTP。
- **只运行一个实例**：当前额度台账、会话、账号 store 使用单进程内存 + JSON 文件；多实例会破坏隔离与额度一致性。生产多实例请替换为 Postgres + Redis。
- 首次启动自动创建演示账号与访客数据；无需手工 seed。

### 两种前端构建

| 命令 | 产物 | 用途 |
| --- | --- | --- |
| `npm run build`（等价 `build:product`） | 纯产品版：不出现"演示 / 合成数据 / 模拟核心"等标注 | 对外体验与答辩演示主入口 |
| `npm run build:demo` | 带标注版：如实说明合成数据与演示通道 | 内部自查、合规审阅、给非专业观众解释环境 |

开关是构建期常量 `VITE_DEMO_LABELS`（`0` = 纯产品版），只影响措辞：数据源、核验通道、验证码与适当性策略仍由服务端配置决定，关闭标注不会让仿真数据变成真实数据，也不会放宽任何安全校验。评委控制台 `/console` 的技术说明在两种构建里都完整保留。校验命令：`npm run qa:pure`。

### 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `PORT` | 否 | 默认 8787；Docker 用 8080 |
| `COOKIE_SECURE` | 公网必填 | `1` |
| `AUTH_SECRET` | 建议 | ≥32 字节；固定，不要提交 |
| `AUTH_REQUIRE_PHONE_VERIFY` | 否 | 默认 `1`：注册必须先通过短信验证码；仅本地演示可设 `0` |
| `LOGIN_MFA` | 否 | 默认 `0`；设 `1` 后密码登录仍需一次短信二次验证才签发会话 |
| `DATA_DIR` | 建议 | 持久卷路径，如 `/data` |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | 是（在线模式） | OpenAI 兼容 |
| `LLM_OFFLINE` | 否 | `1` 强制规则引擎（无 Key / 断网演示） |
| `LLM_DAILY_LIMIT` | 否 | 全局 LLM 日调用上限，默认 500 |
| `DEMO_NOW` | 否 | 演示时钟默认 2026-10-30 10:00 +08:00 |
| `BUSINESS_CLOCK` | 否 | `demo` / `real`；默认 simulated→demo，http→real |
| `BANKING_MODE` | 否 | `simulated` 默认 / `http` 真实核心网关 |
| `BANKING_BASE_URL` / `BANKING_APP_ID` / `BANKING_APP_SECRET` | http 必填 | 银行核心网关地址与 HMAC 凭据 |
| `BANKING_PROVIDER` | 否 | 前端展示的数据源名称 |
| `BANKING_TIMEOUT_MS` / `BANKING_RETRIES` | 否 | 超时与重试，默认 8000ms / 1 |
| `BANKING_SYNC_TTL_MS` / `BANKING_TXN_LIMIT` | 否 | 快照缓存 TTL / 流水条数 |
| `SMS_MODE` / `SMS_BASE_URL` / `SMS_APP_ID` / `SMS_APP_SECRET` | http 时必填 | 短信核验 Provider |
| `SMS_RESEND_COOLDOWN_MS` | 否 | 验证码重发冷却，默认 60000 |
| `FACE_MODE` / `FACE_BASE_URL` / `FACE_APP_ID` / `FACE_APP_SECRET` | http 时必填 | 人脸 / 活体核验 Provider |
| `WEBAUTHN_STEPUP` | 否 | 默认 `1`：允许用本机生物识别（Windows Hello / Touch ID / Face ID）满足红色强验证的人脸因子；需 HTTPS 或 localhost |
| `ASR_MODE` | 否 | `off`（默认，仅用浏览器原生语音识别）/ `http`（录音交给签约转写服务） |
| `ASR_BASE_URL` / `ASR_API_KEY` / `ASR_MODEL` | http 时必填 | OpenAI 兼容 `/v1/audio/transcriptions` 网关 |
| `ASR_LANGUAGE` / `ASR_TIMEOUT_MS` / `ASR_MAX_BYTES` | 否 | 默认 zh / 15000ms / 2MB |
| `SCHEDULER_TICK_MS` | 否 | 计划任务扫描间隔，默认 10000；设 `0` 关闭（定时转账将不会执行） |
| `SCHEDULER_MAX_ATTEMPTS` | 否 | 单个计划最多重试次数，默认 5，超过即终止并提醒 |

## 4. PWA

- `manifest.webmanifest`、`sw.js`、192/512/maskable 图标位于 `apps/web/public`。
- Service Worker 只在生产构建注册；开发模式不缓存，避免 HMR 干扰。
- 更新前端资源后，若需要强制刷新安装包缓存，提升 `apps/web/public/sw.js` 的 `CACHE` 版本号并重新构建。
- 安装条件：HTTPS（或 localhost）、manifest、Service Worker、图标满足浏览器要求。公网隧道已验证 manifest 0 errors、SW 注册成功。

## 5. 公网验收清单

1. `GET /api/health` 返回 200。
2. 首页 `/` 返回产品页面；`/manifest.webmanifest` 与 `/sw.js` 可访问。
3. 访客登录：`POST /api/auth/guest` 返回 200 且 Set-Cookie 带 `Secure`。
4. 首页 `/api/overview` 带 Cookie 返回数据；不带 Cookie 返回 401。
5. 登录后在 `/app` 发送「我还有多少钱」，SSE 能返回账单/余额卡片。
6. 打开 `/console`，能看到实时链路、审计链完整；运行安全自检全部拦截。
7. 用第二台设备注册账户，确认看不到另一个账号的会话/审计/数据。
8. PWA：浏览器显示“安装 / 添加到主屏幕”，安装后以 standalone 打开。

## 6. 已知限制

- 默认仍是合成数据与 demo 核验；真实接入需配置 http 模式并完成行方准入、客户绑定、mTLS、对账与模板报备。
- 单机 JSON store + 内存运行态，不支持水平扩容；重启丢失进行中的对话会话（账号、银行数据与登录会话记录均持久化）。
- 账号认证已具备注册短信验证、找回密码、可开关的登录 MFA、服务端会话与设备撤销；仍缺 KYC/证件核验、设备指纹、账号注销与安全通知，且 `SMS_MODE=demo` 时验证码由服务端回传，只可用于演示。
- 公网访客会消耗 LLM 配额；演示前请关注 API 用量，必要时切「离线兜底」或设置网关限流。
- `/console` 对任何已登录用户开放（隐藏入口），便于评委查看当前账号的技术链路；不暴露其他用户数据。若需更严格，请加评委访问码或角色权限。
- 临时的 trycloudflare / SSH 隧道不适合作为长期赛事链接；正式提交请使用 Docker + 持久托管。
- Docker 镜像默认模拟模式；接真实核心时把上述 `*_MODE` 与凭据通过密钥管理注入，不要写进镜像。
