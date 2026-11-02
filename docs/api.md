# API 与 SSE 契约

Base URL：`http://localhost:8787`（生产由同源页面调用）

- 除 `/api/health`、`/api/auth/*` 和登录页展示用的 `/api/public/config` 外，所有 API 都需要登录 Cookie。
- 登录态：`bank_auth`，HMAC 签名，HttpOnly，SameSite=Lax，7 天；生产 HTTPS 下带 Secure。
- 所有会话、DAG、确认、审计均绑定当前登录用户；访问其他用户的 session / run 返回 404。
- 错误响应：

```json
{ "ok": false, "code": "AUTH_REQUIRED", "message": "登录已失效，请重新登录" }
```

## 1. 账号

### `POST /api/auth/guest`

浏览器发送 `{}`（JSON），创建独立访客账号并返回 Cookie：

```json
{
  "ok": true,
  "user": {
    "id": "u_guest_xxx",
    "name": "陈屿",
    "phoneMasked": "139****0068",
    "spouseName": "林晚",
    "spouseBirthday": "1992-11-02",
    "riskLevel": "稳健型",
    "tier": "私人银行 · 金桂级",
    "isGuest": true,
    "createdAt": "..."
  }
}
```

### `POST /api/auth/register`

```json
{
  "name": "陈屿",
  "phone": "13800006677",
  "password": "至少6位",
  "otpCode": "246810",
  "spouseName": "林晚",
  "spouseBirthday": "1992-11-02"
}
```

创建账号与独立银行数据，并自动登录。`spouse*` 可选；不填使用演示默认。

- `AUTH_REQUIRE_PHONE_VERIFY=1`（默认）时必须先调用 `POST /api/auth/otp/send` 取得验证码，缺失返回 `400 OTP_REQUIRED`，错误返回 `400 OTP_INVALID`，3 次错误后 `OTP_ATTEMPTS_EXHAUSTED`。
- 注册接口不接受 `riskLevel`：新账号一律记为「未测评」（`assessedAt` 为空），理财适当性上限按最低 R1，完成风险测评后才放开。

### `POST /api/auth/otp/send`

```json
{ "phone": "13800006677", "scene": "register | reset" }
```

返回 `{ ok, sent, cooldownSec, demoCode? }`。`SMS_MODE=demo` 时服务端为每次请求生成**一次性随机 6 位码**（5 分钟有效、校验成功即作废）并回传用于演示自动填入；`SMS_MODE=http` 时验证码由签约通道送达，接口不再回传任何验证码。固定万能码 `246810` 已移除：未先调用本接口时，任何验证码都会返回 `SMS_NOT_SENT`。手机号未注册（register）或不存在（reset）时同样返回 `sent: true`，不泄露账号是否存在。

### `POST /api/auth/login`

```json
{ "phone": "13800006677", "password": "demo1234" }
```

演示预置账号：手机号 `13800006677`，密码 `demo1234`。登录连续失败按 IP + 手机号限流。

`LOGIN_MFA=1` 时密码校验通过后不直接发 Cookie，而是返回二次验证挑战：

```json
{ "ok": false, "mfaRequired": true, "challengeId": "otp_xxx", "demoCode": "246810", "cooldownSec": 60 }
```

### `POST /api/auth/login/mfa`

```json
{ "phone": "13800006677", "code": "246810", "challengeId": "otp_xxx" }
```

校验通过后签发会话 Cookie。密码正确但没有通过这一步，任何业务接口都不会放行。

### `POST /api/auth/password/reset/request` → `/verify` → `/confirm`

```json
{ "phone": "13800006677" }
{ "phone": "13800006677", "code": "246810" }        // 返回一次性 resetToken（5 分钟有效）
{ "resetToken": "rst_xxx", "password": "新密码" }    // 重置成功并直接登录
```

重置成功会撤销该用户全部其他会话；`resetToken` 用过即失效，二次使用返回 `RESET_INVALID`。

### `POST /api/auth/password/change`

```json
{ "oldPassword": "demo1234", "newPassword": "新密码" }
```

返回 `{ ok, revokedSessions }`；当前设备保持登录，其他设备全部失效。

### `GET /api/auth/sessions`

返回当前账号的有效登录设备：

```json
{
  "ok": true,
  "sessions": [
    { "id": "ses_x", "current": true, "device": "iPhone · Safari", "ip": "10.1.2.3", "createdAt": "...", "lastSeenAt": "...", "expiresAt": "..." }
  ]
}
```

会话保存在服务端并与登录 Cookie 里的 `sid` 绑定，撤销后旧 Cookie 立即 401。

### `POST /api/auth/sessions/revoke` / `POST /api/auth/sessions/revoke-others`

```json
{ "sessionId": "ses_x" }   // 撤销指定设备；撤销自己时同时清除 Cookie，返回 signedOut: true
{}                          // 退出其他所有设备
```

### `POST /api/auth/logout`

清除 Cookie 并撤销当前服务端会话；写入 `AUTH_LOGOUT` 审计。

### `GET /api/auth/me`

返回当前用户；未登录 401。

## 2. 会话与快照

### `GET /api/bootstrap?sessionId=<可选>`

返回首屏完整数据：`SnapshotPayload` + 动态 `quickPrompts` + `capabilities` + `brand`。会话 ID 属于当前用户时才复用，否则新建。

```json
{
  "session": { "id": "sess_xxx", "state": "IDLE", "messages": [], "dag": null, "pending": null, "context": {}, "runs": [], "llmMode": "llm", "takeover": false, "updatedAt": "..." },
  "user": { "name": "陈屿", "tier": "私人银行", "spouseName": "林晚", "spouseBirthday": "1992-11-02", "riskProfile": {} },
  "accounts": [], "cards": [], "limits": {},
  "stats": { "llm": {}, "guard": {}, "breaker": {}, "audit": {} },
  "demoNow": "2026-10-30T02:00:00.000Z",
  "dailyLimitCents": 100000,
  "dataSource": { "mode": "simulated", "provider": "本地仿真核心", "healthy": true, "syncedAt": null },
  "quickPrompts": [], "capabilities": [], "brand": {}
}
```

### `GET /api/session/:id`

同一结构（不含 quickPrompts/capabilities/brand）。用于刷新页面、确认后、接管后同步现场。

## 3. 产品 API

### `GET /api/overview`

首页需要的账户、卡片、最近交易、本月支出/收入、分类、异常数量、订阅、持仓、额度、审计状态、动态快捷指令。金额单位均为分（cents）。

`dataSource` 表示当前数据源：`simulated`（本地仿真）或 `http`（签约银行核心），并带 `provider / healthy / syncedAt`。`BANKING_MODE=http` 且首次同步失败时返回 `503 BANK_UNAVAILABLE`，不会返回合成数据顶替。

### `GET /api/transactions?period=currentMonth|lastMonth|year&category=&limit=160`

返回：

```json
{
  "period": "currentMonth",
  "periodLabel": "2026 年 10 月（截至 30 日）",
  "items": [{ "id": "txn_x", "ts": "...", "amountCents": -2900, "merchant": "Manner 咖啡", "category": "咖啡茶饮", "channel": "微信支付", "anomaly": false }],
  "total": 63,
  "expenseCents": 1421800,
  "incomeCents": 3200000
}
```

### `POST /api/profile`

```json
{ "name": "陈屿", "spouseName": "林晚", "spouseBirthday": "1992-11-02" }
```

更新资料并刷新当前会话上下文；写入 `PROFILE_UPDATED` 审计。请求体带 `riskLevel` 会被拒绝（`400 RISK_ASSESSMENT_REQUIRED`），风险等级只能通过下面的测评接口产生。

## 3.1 风险测评与适当性

### `GET /api/risk/assessment`

```json
{
  "questions": [{ "id": "age", "label": "你的年龄段", "options": [{ "label": "18–25 岁", "score": 20 }] }],
  "profile": { "level": "稳健型", "score": 62, "assessedAt": "2026-06-18T10:30:00+08:00" },
  "maxProductRisk": "R2",
  "expired": false,
  "validDays": 365,
  "businessNow": "2026-10-30T10:00:00+08:00"
}
```

### `POST /api/risk/assessment`

```json
{ "answers": { "age": 0, "experience": 2, "income": 1, "tolerance": 3, "horizon": 2 } }
```

`answers` 是题目 id → 选项下标。缺答或越界返回 `400 RISK_ANSWER_INVALID`，不做默认推断。成功后返回：

```json
{ "ok": true, "profile": { "level": "平衡型", "score": 71, "assessedAt": "..." }, "maxProductRisk": "R3", "levelChanged": true, "user": {} }
```

分数→等级：≤39 保守型、≤54 稳健型、≤69 平衡型、≤84 成长型、其余进取型；等级→可购产品上限 R1…R5。写入 `RISK_ASSESSED` 审计（含每题选项与前后等级）。

### `GET /api/risk/suitability/:riskLevel`

对某个产品风险等级做适当性预检，返回 `{ suitable, expired, profile, maxProductRisk }`。

理财工具的同一套规则：`match_products` 只推荐适当性范围内的产品并在 `excludedBySuitability` 里说明被排除的款数；`purchase_wealth` 遇到超等级或测评过期直接失败，错误码 `RISK_SUITABILITY_REQUIRED` / `RISK_ASSESSMENT_EXPIRED`，不会进入确认与扣款环节。

## 3.2 交易详情与争议工单

### `GET /api/transactions/:id`

返回单笔交易全字段 + 关联信息：

```json
{
  "ok": true,
  "txn": { "id": "txn_x", "ts": "...", "amountCents": -600, "merchant": "地铁乘车码", "category": "交通出行", "channel": "银联云闪付", "status": "posted", "anomaly": false },
  "account": { "id": "acc_ys", "name": "云杉储蓄账户", "bank": "云杉银行", "type": "savings", "last4": "1234" },
  "subscription": null,
  "product": null,
  "similar": [{ "id": "txn_y", "ts": "...", "amountCents": -600, "merchant": "地铁乘车码" }],
  "dispute": null,
  "disputeEligible": { "ok": true },
  "dataSource": { "mode": "http", "provider": "合作银行核心", "healthy": true, "syncedAt": "..." }
}
```

`similar` 是「同日同商户同金额」的疑似重复扣费；`disputeEligible` 说明能否申诉（已冲正、未入账、超过 180 天都会给出对应 `code` 与文案）。

### `POST /api/transactions/:id/dispute`

```json
{ "reason": "duplicate | unauthorized | not_received | amount_wrong | other", "note": "选填，最多 300 字" }
```

通过银行核心网关受理工单，返回 `{ ok, dispute }`；同一笔交易已有在处理的工单时返回 `409 DISPUTE_EXISTS`。每用户每小时最多 5 次提交。写入 `TXN_DISPUTE_OPENED` 审计。

AI 只负责受理与状态展示，退款结论由银行核心给出：仿真核心返回 `reviewing`（演示环境不会自动退款），HTTP 模式由上游返回工单号与状态，未返回工单即视为失败。

### `GET /api/disputes`

返回 `{ ok, items, openCount }`，并顺带向上游刷新工单状态（`refreshDisputes`）。

## 4. 对话流（SSE）

### `POST /api/chat`

```json
{ "sessionId": "sess_xxx", "message": "给林晚转 520 元，备注爱你", "after": 12 }
```

- 返回 `text/event-stream`；每帧：

```
data: {"seq":13,"ts":"...","type":"nlu.result","sessionId":"sess_xxx","runId":"run_xxx","data":{...}}\n\n
```

- 到 `run.paused`（待确认 / 强验证）或 `run.end` 后关闭流，不挂起等待用户。
- `after` 用于续传：只接收 `seq > after`。
- 每会话事件缓冲 320 条；`GET /api/session/:id` 提供完整快照。
- 若 `sessionId` 属于其他用户或不存在，服务端新建当前用户的会话。

### SSE 事件

| type | data 关键字段 | 说明 |
| --- | --- | --- |
| `run.start` | `utterance, llmMode, resumed?` | 新一轮开始 |
| `nlu.result` | `intent, confidence, slots, source, latencyMs, references, utterance` | 意图解析（`source: llm/cache/rules/offline`） |
| `injection.flag` | `score, patterns, categories, action, locked` | 注入拦截 |
| `plan.ready` | `dag, title, summary, nodeCount, riskCounts` | DAG 规划完成 |
| `node.state` | `nodeId, status, tool, label, risk, durationMs, resultSummary, error?` | 节点状态 |
| `policy.decision` | `nodeId, baseRisk, effectiveRisk, decision, reasons, limit, explanation` | 权限判定 |
| `run.paused` | `pending` | 待确认/强验证；流随后关闭 |
| `stepup.challenge` | `challenge` | 强验证挑战（预留事件） |
| `render.card` | `messageId, card, ts` | 富卡片 |
| `message.final` | `messageId, text, evidence, meta` | 最终文字 + 证据 |
| `breaker.tripped` | `reason, failures, injectionHits, lockedUntil` | 熔断 |
| `takeover.required` | `message` | 人工接管 |
| `audit.appended` | `entry` | 审计链新增（含 hash/prevHash） |
| `run.end` | `status, runId, intent, title, counts, canRollback` | 结束；`DONE/PARTIAL/FAILED/CANCELLED/LOCKED/HUMAN_TAKEOVER` |

`pending`：

```json
{
  "nodeId": "n3",
  "kind": "CONFIRM | STEPUP",
  "digest": "sha256...",
  "expiresAt": "2026-10-30T02:01:30.000Z",
  "policy": { "effectiveRisk": "YELLOW", "reasons": [], "limit": {} },
  "summary": {
    "title": "转账确认",
    "amountCents": 52000,
    "rows": [{ "label": "收款人", "value": "林晚 · 云杉银行 尾号 6222" }],
    "warnings": []
  },
  "challenge": { "id": "chal_xxx", "methods": ["FACE", "SMS"], "attemptsLeft": 3 },
  "batchNodeIds": ["n3"]
}
```

## 5. 确认、强验证与续传

### `POST /api/confirm`

```json
{ "sessionId": "sess_xxx", "nodeId": "n3", "digest": "sha256...", "approve": true }
```

- 校验 digest、节点、TTL（真实墙钟 90 秒）后签发一次性 grant。
- 黄色：`{ ok: true, resume: true }`。
- 红色：`{ ok: true, needStepUp: true, challenge }`。
- 取消：`approve=false` → `{ ok:true, canceled:true }`，无资金变动。
- 摘要不匹配 `DIGEST_MISMATCH`；超时 `EXPIRED`。

### `POST /api/stepup`

```json
{ "sessionId": "sess_xxx", "challengeId": "chal_xxx", "faceDone": true, "smsCode": "246810" }
```

- 两种模式都必须先 `/api/stepup/send` 再由服务端校验：`demo` 下发一次性随机码，`http` 由签约短信服务送达；未发送时返回 `SMS_NOT_SENT`，过期返回 `SMS_EXPIRED`。
- 已录入通行密钥时可用 `BIO` 因子替代人脸，见 §5.1。
- `FACE_MODE=demo`：页面动画完成后传 `faceDone=true`；`FACE_MODE=http`：服务端只认 Provider 返回的 `passed`，客户端布尔值无效。
- 连续 3 次短信错误触发熔断；挑战与操作摘要绑定，90 秒过期。

### `POST /api/stepup/send`

```json
{ "sessionId": "sess_xxx", "challengeId": "chal_xxx" }
```

发送短信验证码；有 60 秒重发冷却。`SMS_MODE=demo` 时响应带 `demoCode`，HTTP 模式不带。

### `POST /api/stepup/face/start`

```json
{ "sessionId": "sess_xxx", "challengeId": "chal_xxx" }
```

`demo` 返回 `{ mode: "demo" }`；`http` 返回合作方 `verifyUrl` / `sessionId` / `expiresAt`，前端跳转核验页。

### `POST /api/stepup/face/status`

查询合作方核验状态，返回 `{ ok, status: "pending" | "passed" | "failed" | "expired" }`；只有 `passed` 才允许继续签发 grant。

### `POST /api/resume`

```json
{ "sessionId": "sess_xxx", "after": 21 }
```

新开 SSE 继续执行 DAG；若仍有 pending 返回 409。

### `POST /api/cancel`

待确认操作的快捷取消，等价于 `confirm approve=false`。

## 5.1 本机生物识别（WebAuthn）

| 接口 | 说明 |
| --- | --- |
| `GET /api/passkey` | 返回 `{ enabled, credentials }`，credential 含标签、录入时间、aaguid 尾号与传输方式 |
| `POST /api/passkey/register/start` | 返回 `generateRegistrationOptions` 的 `options`（platform + userVerification=required） |
| `POST /api/passkey/register/finish` | `{ response, challenge, label }`，服务端校验 origin / rpId / 用户验证后落库，最多保留 5 个 |
| `POST /api/passkey/revoke` | `{ id }` 删除单个通行密钥 |
| `POST /api/stepup/bio/start` | `{ sessionId, challengeId }` → 返回 `allowCredentials` 限定的登录选项 |
| `POST /api/stepup/bio/finish` | `{ sessionId, challengeId, response }` → 校验签名与签名计数器后把该挑战的人脸因子标记为已通过 |

挑战只在服务端内存保存 5 分钟且一次性；签名计数器会随校验成功更新，重放旧的断言会被拒绝。写入 `PASSKEY_REGISTERED` / `PASSKEY_REVOKED` / `STEPUP_BIO_PASSED` / `STEPUP_BIO_FAILED` 审计。

## 5.2 语音输入

| 接口 | 说明 |
| --- | --- |
| `GET /api/speech/status` | 返回服务端是否启用 ASR、音频上限与语言 |
| `POST /api/speech/transcribe` | 请求体为原始音频字节（`audio/webm` 等），返回 `{ text, durationSec }` |

浏览器支持时前端直接使用 Web Speech API（边说边上屏，不经过服务端）；不支持时（如 iOS Safari）录音后调用本接口。`ASR_MODE=off` 时返回 `503 ASR_DISABLED`，绝不返回假转写结果。音频只在内存中转发给上游，不落盘、不进审计，审计只记录字节数、时长与耗时。

## 5.3 计划任务与提醒

| 接口 | 说明 |
| --- | --- |
| `GET /api/notifications` | 提醒列表 + 未读数 + 待执行计划 + 锁定中的预算 + 礼品订单 + 当前业务时钟 |
| `POST /api/notifications/read` | `{ ids? }` 标记已读，不传即全部 |
| `POST /api/demo/advance-clock` | `{ days: 0-60 }` 仅演示时钟可用：前进业务时间并立即扫描一轮到点任务；真实时钟返回 `CLOCK_IS_REAL` |

调度器每 `SCHEDULER_TICK_MS`（默认 10 秒）扫描一次：定时转账真实扣款、预算锁定真实释放、礼品订单流转到已送达、日程生成提醒。执行前重新校验硬限额与可用余额，缺授权或多次失败会终止并提醒；幂等键绑定计划 id，重启不会重复扣款。写入 `SCHEDULE_EXECUTED` / `SCHEDULE_BLOCKED` / `SCHEDULE_ABANDONED` / `FUNDS_RELEASED_BY_SCHEDULE` / `GIFT_ORDER_DELIVERED` / `DEMO_CLOCK_ADVANCED` 审计。

## 6. 中断、回退与接管

### `POST /api/interrupt`

```json
{ "sessionId": "sess_xxx", "mode": "abort | rollback" }
```

- `abort`：执行中在节点边界停止；待确认时立即取消。
- `rollback`：中断并逆序补偿。

### `POST /api/rollback`

对已完成任务做逆序补偿；不可逆操作返回人工工单信息。

### `POST /api/takeover`

```json
{ "sessionId": "sess_xxx", "action": "take | release | abort | unlock" }
```

- `take`：暂停调度；`release`：恢复；`abort`：终止；`unlock`：人工复核解除熔断。

## 7. 审计

### `GET /api/audit?limit=80&runId=<可选>`

只返回**当前用户**的条目，并从最近一次 `DEMO_RESET` 开始展示；`verification` 是全局链校验结果，`count` 是当前用户条目数。

### `GET /api/audit/verify`

全局链校验；额外返回 `userCount`。

### `GET /api/audit/replay/:runId`

仅允许查看当前用户的 run；按序返回该 run 的审计条目。

### `POST /api/demo/tamper`

在审计**副本**上修改一条摘要并重新校验，返回检测错误；主链不受影响。

## 8. 演示、安全与指标

| 接口 | 说明 |
| --- | --- |
| `POST /api/demo/reset` | 重置当前用户本地数据、额度、会话、授权和挑战；`BANKING_MODE=http` 时随后从银行核心重新同步，不改行方账务；追加 `DEMO_RESET`，不擦除全局审计 |
| `GET /api/llm/status` | 模型、调用数、token、缓存命中、延迟、估算成本、模式 |
| `POST /api/llm/mode` | `{ "mode": "llm" \| "offline" }`；演示全局开关 |
| `GET /api/stats` | LLM / 守卫 / 当前用户熔断 / 审计 / 当前用户会话数 |
| `GET /api/health` | 公开健康检查；`banking.mode / provider` 显示当前数据源 |
| `POST /api/security/attack` | 当前用户的安全自检：注入、摘要篡改、令牌重放、策略独立性 |
| `POST /api/sandbox/run` | 在 worker + vm 中运行纯计算脚本；数据来自当前用户 |
| `GET /api/compliance/summary` | 当前用户的安全自评 Markdown |

### 接入状态

| 接口 | 说明 |
| --- | --- |
| `GET /api/public/config` | 公开；返回银行模式、Provider 名称、短信 / 人脸模式，不含密钥 |
| `GET /api/integration/status` | 登录后；返回当前用户的同步状态、Provider 模式与去标识 `customerRef` |
| `POST /api/integration/refresh` | 强制从银行核心拉取最新快照；失败返回 5xx，不回退仿真 |

## 9. 错误码

| code | 场景 |
| --- | --- |
| `AUTH_REQUIRED` | 未登录或 Cookie 失效 |
| `INVALID_CREDENTIALS` | 手机号或密码错误 |
| `PHONE_EXISTS` | 注册手机号已存在 |
| `RATE_LIMITED` | 认证尝试过于频繁 |
| `SESSION_NOT_FOUND` | 会话不存在或不属于当前用户 |
| `EMPTY_MESSAGE` | 空消息 |
| `NO_PENDING` / `PENDING_CONFIRMATION` | 无待确认 / 请先确认 |
| `DIGEST_MISMATCH` | 确认摘要被改 |
| `EXPIRED` | 确认或强验证超时 |
| `CHALLENGE_MISMATCH` | 验证挑战不匹配 |
| `SMS_INVALID` / `SMS_ATTEMPTS_EXHAUSTED` | 验证码错误 / 次数耗尽 |
| `SMS_NOT_SENT` / `SMS_SEND_FAILED` / `SMS_COOLDOWN` / `SMS_EXPIRED` | 短信未发送 / 发送失败 / 重发冷却 / 验证码过期 |
| `ASR_DISABLED` / `ASR_UPSTREAM_ERROR` / `ASR_UNAUTHORIZED` / `ASR_TIMEOUT` / `ASR_EMPTY` / `EMPTY_AUDIO` / `AUDIO_TOO_LARGE` | 语音转写通道状态 |
| `WEBAUTHN_NOT_REGISTERED` / `WEBAUTHN_CHALLENGE_EXPIRED` / `WEBAUTHN_CREDENTIAL_UNKNOWN` / `WEBAUTHN_ASSERTION_FAILED` / `WEBAUTHN_DISABLED` | 生物识别未录入 / 挑战过期 / 密钥不属于本账号 / 签名校验失败 / 服务端未开启 |
| `CLOCK_IS_REAL` | 真实业务时钟下拒绝伪造时间 |
| `FACE_REQUIRED` / `FACE_FAILED` / `FACE_COOLDOWN` | 人脸未完成 / 未通过 / 创建会话过于频繁 |
| `FACE_START_FAILED` / `FACE_STATUS_FAILED` | 人脸 Provider 不可用 / 结果查询失败 |
| `BANK_UNAVAILABLE` | 银行核心首次同步失败或运行中不可达；不会回退仿真数据 |
| `UPSTREAM_CIRCUIT_OPEN` / `UPSTREAM_UNAVAILABLE` | 银行网关连续失败熔断 / 网络不可达 |
| `BANK_BAD_SNAPSHOT` / `BANK_BAD_RESPONSE` | 上游快照或操作结果格式不合法 |
| `GRANT_ALREADY_USED` / `GRANT_EXPIRED` / `RISK_ESCALATED` | 授权重放 / 过期 / 风险升级 |
| `POLICY_DENIED` | 策略拒绝（硬限额、熔断等） |
| `OTP_REQUIRED` / `OTP_INVALID` / `OTP_EXPIRED` / `OTP_NOT_SENT` / `OTP_ATTEMPTS_EXHAUSTED` / `OTP_COOLDOWN` / `OTP_SEND_FAILED` | 注册、找回密码、登录二次验证的短信状态 |
| `RESET_INVALID` | 重置令牌无效、已过期或已被使用 |
| `SESSION_NOT_FOUND`（撤销接口） | 目标登录设备不属于当前用户 |
| `RISK_ASSESSMENT_REQUIRED` | 试图直接改 `riskLevel`，需先完成测评 |
| `RISK_ANSWER_INVALID` | 测评缺答或选项越界 |
| `RISK_SUITABILITY_REQUIRED` / `RISK_ASSESSMENT_EXPIRED` / `NO_SUITABLE_PRODUCT` | 产品超出适当性上限 / 测评过期 / 范围内无可选产品 |
| `TXN_NOT_FOUND` / `TXN_NOT_DISPUTABLE` / `TXN_NOT_POSTED_YET` | 交易不存在 / 已冲正不可申诉 / 尚未入账 |
| `DISPUTE_EXISTS` / `DISPUTE_WINDOW_CLOSED` / `DISPUTE_FAILED` | 已有在处理工单 / 超过 180 天申诉期 / 上游受理失败 |
| `SANDBOX_*` | 沙箱静态检查 / 执行失败 |

## 10. 最小客户端示例

```ts
// 浏览器默认同源携带 Cookie；SSE 用 fetch 读取，after 续传
let seq = 0;
async function chat(sessionId: string, message: string) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, message, after: seq }),
  });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const event = JSON.parse(line.slice(6));
      seq = event.seq;
      if (event.type === 'run.paused') {
        // 展示确认单；确认后 POST /api/confirm / stepup / resume
      }
    }
  }
}
```

> IM 接入时把同样的 SSE 事件映射为卡片消息即可；认证与业务 API 不变。
