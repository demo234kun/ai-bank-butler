# 银行核心与核验通道接入说明

这份文档说明：当前原型里哪些部分是真实能力，哪些默认仍是比赛演示数据，以及如何把账户、资金操作、短信验证码和人脸核验切到签约的银行 / 核验服务。

> 结论先行：代码已经具备可执行的接入层，`BANKING_MODE=http` / `SMS_MODE=http` / `FACE_MODE=http` 后会走签名 HTTP 通道，失败显式报错，**不会静默回退成本地仿真**。但仓库不包含任何真实银行的地址、密钥或客户绑定关系，正式上线仍需行方联调、准入和证书配置。

## 1. 当前边界

| 能力 | 默认 `simulated/demo` | 配成 `http` 后 |
| --- | --- | --- |
| 账户、卡片、流水、订阅、持仓 | `createSeededState()` 生成的合成数据 | `GET /v1/snapshot` 拉取并覆盖本地工作副本 |
| 转账、冲正、理财申赎、卡片、订阅、定时、资金锁定、礼物、AA | 本地 Ledger | `POST /v1/ops` 签名调用银行核心网关 |
| 数据读取 | 直接读本地状态 | 每次进入银行数据节点前同步快照；首屏/账单页也同步 |
| 短信验证码 | 服务端下发一次性随机码（5 分钟、用后即废），仅演示时回传页面自动填入 | 调用签约短信 / 核验服务；服务端不保存固定码，也不回传验证码 |
| 人脸核验 | 页面内动画演示，客户端标记 | 创建核验会话，跳转合作方页面，服务端轮询通过结果 |
| 失败处理 | 本地账本错误 | 网络 / 协议 / 业务错误上抛；不会偷偷使用合成数据 |
| 客户身份 | 本地用户 ID | 只传 `bref_...` 去标识引用，不传 userId / 手机号给银行核心（短信通道除外，手机号是短信业务必需） |

LLM 解析、Agent DAG、五档权限与风控智能体、一次性授权、审计链、沙箱、熔断、回滚、人工接管本身是真实运行代码，不依赖银行接入模式。

## 2. 拓扑与代码位置

```text
浏览器 / PWA
   │  HttpOnly Cookie + SSE
   ▼
Fastify 产品 API ── Agent 执行器 ── 工具
   │                                  │
   │                                  ├─ 本地仿真适配器 (SimulatedBankingGateway)
   │                                  │     └─ 本地 Ledger / 种子数据
   │                                  └─ HTTP 适配器 (HttpBankingGateway)
   │                                        ├─ HMAC 签名 + 幂等键 + 超时 + 重试 + 熔断
   │                                        ├─ GET /v1/snapshot
   │                                        └─ POST /v1/ops
   ▼
银行核心 / 开放平台网关（行方实现或行方中间件）

核验通道：OtpProvider / FaceProvider
   ├─ demo：本地固定码 / 页面动画
   └─ http：HMAC 签名调用短信 / 活体服务
```

关键文件：

- `apps/server/src/integration/banking/types.ts`：统一网关契约
- `apps/server/src/integration/banking/simulated.ts`：本地仿真实现
- `apps/server/src/integration/banking/http.ts`：真实 HTTP 实现
- `apps/server/src/integration/banking/snapshot.ts`：上游快照校验与落盘
- `apps/server/src/integration/httpClient.ts`：签名、重试、熔断
- `apps/server/src/integration/verification.ts`：短信 / 人脸 Provider
- `apps/server/src/policy/stepup.ts`：强验证挑战与两种 Provider 编排
- `scripts/bank-core-stub.ts`：契约联调桩（仅测试）
- `docs/openapi-banking.yaml`：机器可读契约

## 3. 配置

```bash
BANKING_MODE=http
BANKING_BASE_URL=https://bank-core-gateway.example.com
BANKING_APP_ID=your-app-id
BANKING_APP_SECRET=your-app-secret
BANKING_PROVIDER=某银行核心
BANKING_TIMEOUT_MS=8000
BANKING_RETRIES=1
BANKING_SYNC_TTL_MS=2500
BANKING_TXN_LIMIT=600
BANKING_CIRCUIT_FAILURES=5
BANKING_CIRCUIT_COOLDOWN_MS=30000

# 真实接入建议使用真实业务时间；不设置时 http 模式默认 real
BUSINESS_CLOCK=real
```

```bash
SMS_MODE=http
SMS_BASE_URL=https://verification-gateway.example.com
SMS_APP_ID=...
SMS_APP_SECRET=...
SMS_RESEND_COOLDOWN_MS=60000

FACE_MODE=http
FACE_BASE_URL=https://verification-gateway.example.com
FACE_APP_ID=...
FACE_APP_SECRET=...
```

启动时会检查 `http` 模式的 URL / appId / secret；缺项直接启动失败，避免“配置写了 http、实际还在仿真”。密钥只存在于服务端进程环境或 `.env`，不会进入前端 bundle、API 响应或审计日志。

## 4. 请求签名

所有 `/v1/*`（`/v1/health` 除外）请求都携带：

```http
X-App-Id: your-app-id
X-Timestamp: 1761799200000
X-Nonce: 32-hex-random
X-Signature: hex(HMAC-SHA256(appSecret, canonical))
Idempotency-Key: <uuid-or-stable-sha256>   # 写请求必需
Content-Type: application/json
```

`canonical` 为五行，用 `\n` 连接：

```text
METHOD
/path?query            # 原始请求路径，含 query，不做重排
timestamp
nonce
sha256(rawBody)        # GET 为空字符串的 sha256
```

要求：

- 允许时间偏移 5 分钟；nonce 在窗口内不可复用。
- 写操作必须带 `Idempotency-Key`，网络重试复用同一个 key；服务端必须缓存首次成功结果。
- 建议网关侧强制 mTLS / IP 白名单；本原型客户端只实现了应用级 HMAC，mTLS 由部署层承担。
- 响应统一为 `{ "ok": true, "data": ... }` 或 `{ "ok": false, "error": { "code": "...", "message": "..." } }`。

## 5. 快照：`GET /v1/snapshot`

Query：

| 参数 | 说明 |
| --- | --- |
| `externalRef` | `bref_` + 24 位十六进制，本地用户与银行客户的去标识映射 |
| `txnLimit` | 最近流水条数上限，默认 600 |

`data` 字段（均可选，但完整实现应全量返回）：

```json
{
  "accounts": [Account],
  "cards": [BankCard],
  "transactions": [Txn],
  "subscriptions": [Subscription],
  "products": [WealthProduct],
  "holdings": [Holding],
  "fundLocks": [FundLock],
  "giftOrders": [GiftOrder],
  "schedules": [ScheduleItem],
  "disputes": [Dispute]
}
```

字段定义与 `packages/shared/src/types.ts` 保持一致；运行时由 Zod 校验，非法字段、错误金额类型、非 4 位卡号等会以 `BANK_BAD_SNAPSHOT` 拒绝，不会污染本地状态。

落盘规则：

- 账户、卡、订阅、产品、持仓、锁定、礼物、日程、流水、争议工单以银行快照为准覆盖本地工作副本。
- 用户姓名、爱人资料、联系人、风险测评结果仍由本地身份域维护，不被核心覆盖；测评是行内适当性流程，不写入银行账务。
- 流水按时间倒序保留 `BANKING_TXN_LIMIT` 条；账单页的“今年”范围若需要更长历史，应扩展为分页查询接口。

## 6. 操作：`POST /v1/ops`

请求：

```json
{
  "externalRef": "bref_...",
  "op": "transfer",
  "payload": { "...": "..." }
}
```

响应：

```json
{
  "ok": true,
  "data": {
    "txnIds": ["...", "..."],
    "totalCents": 600000,
    "accountId": "acc_001",
    "snapshot": { "...": "更新后的完整快照，建议返回" }
  },
  "requestId": "..."
}
```

`data.snapshot` 可选；若返回，适配器直接应用；若缺失，适配器会再调用一次 `/v1/snapshot`。写操作建议始终返回 `snapshot`，避免“核心成功、客户端读不到结果”的窗口。

### 6.1 操作清单

| op | payload | data 必填字段 |
| --- | --- | --- |
| `transfer` | `fromAccountId?`, `recipients[{name, amountCents, bank?, last4?, contactId?}]`, `note?` | `txnIds[]`, `totalCents`, `accountId` |
| `reverse_transfer` | `txnIds[]` | `creditCents`, `reversalTxnId`, `originalTxnIds[]` |
| `purchase_wealth` | `productId`, `amountCents`, `fromAccountId?` | `holdingId`, `txnId`, `amountCents` |
| `redeem_wealth` | `holdingId`, `amountCents`, `toAccountId?` | `holdingId`, `txnId`, `amountCents` |
| `apply_virtual_card` | `limitCents`, `network?` | `cardId`, `last4?` |
| `cancel_virtual_card` | `cardId` | `cardId` |
| `adjust_card_limit` | `cardId`, `limitCents` | `cardId`, `previousLimitCents` |
| `set_card_status` | `cardId`, `status` (`active/frozen/lost/cancelled`) | `cardId`, `previousStatus` |
| `cancel_subscription` | `subscriptionId` | `subscriptionId`, `previousStatus` |
| `restore_subscription` | `subscriptionId`, `status` | `subscriptionId` |
| `create_schedule` | `kind`, `title`, `amountCents?`, `executeAt`, `detail?` | `scheduleId` |
| `cancel_schedule` | `scheduleId` | `scheduleId` |
| `lock_funds` | `accountId?`, `amountCents`, `reason`, `releaseAt` | `lockId` |
| `unlock_funds` | `lockId` | `lockId` |
| `order_gift` | `type`, `merchant`, `amountCents`, `deliveryAt`, `note`, `fromAccountId?` | `orderId`, `txnId` |
| `cancel_gift` | `orderId` | `orderId`, `txnId` |
| `create_split` | `totalCents`, `names[]`, `note?` | `requestId`, `totalCents`, `myShareCents`, `shares[]`, `createdAt` |
| `cancel_split` | `requestId` | `requestId` |
| `open_dispute` | `txnId`, `reason` (`duplicate/unauthorized/not_received/amount_wrong/other`), `note?`, `channel` (`agent/app`) | `disputeId`, `reference` |

`open_dispute` 只受理申诉，不改账：银行核心须返回工单号 `reference` 与初始状态，工单本体在后续 `GET /v1/snapshot` 的 `disputes[]` 中回传，字段为

```json
{
  "id": "dsp_x", "reference": "DR202611010421", "txnId": "txn_x", "accountId": "acc_x",
  "merchant": "地铁乘车码", "amountCents": -600, "currency": "CNY",
  "reason": "duplicate", "status": "reviewing",
  "createdAt": "...", "updatedAt": "...", "expectedFinishAt": "...",
  "channel": "app", "resolution": "差错核查中"
}
```

`status` 取 `submitted / reviewing / resolved_credit / rejected`；退款与否由行方决定，本服务只展示状态，绝不本地生成 `resolved_credit`。

### 6.2 错误码约定

业务失败应返回 HTTP 4xx + `ok:false`，例如：

```json
{
  "ok": false,
  "error": { "code": "INSUFFICIENT_BALANCE", "message": "账户可用余额不足" }
}
```

客户端不会对 4xx 重试，也不会回退仿真；错误码会直接出现在 Agent 工具结果中。5xx / 429 / 网络超时会按配置重试，最终仍失败则当前节点失败，并记录 `BANK_UNAVAILABLE` 审计。

推荐沿用本地账本已有的错误码：`ACCOUNT_NOT_FOUND`、`INSUFFICIENT_BALANCE`、`INVALID_AMOUNT`、`CARD_NOT_FOUND`、`CARD_STATUS_FAILED`、`SUBSCRIPTION_NOT_FOUND`、`PRODUCT_NOT_FOUND`、`HOLDING_NOT_FOUND`、`SCHEDULE_NOT_FOUND`、`LOCK_NOT_FOUND`、`ORDER_NOT_FOUND`。

## 7. 短信核验 Provider

### `POST /v1/otp/send`

```json
{
  "externalRef": "bref_...",
  "phone": "13800006677",
  "scene": "stepup",
  "reference": "chal_...",
  "expiresInSec": 300
}
```

返回 `{ "requestId": "..." }`。手机号是短信服务必需字段，请只在受控 HTTPS 通道传输，不写入日志。

### `POST /v1/otp/verify`

```json
{ "requestId": "...", "reference": "chal_...", "code": "123456" }
```

返回 `{ "ok": true }` 或 `{ "ok": false, "attemptsLeft": 2, "reason": "OTP_INVALID" }`。适配器不会把验证码写入审计或幂等键（只使用验证码哈希的短摘要）。

## 8. 人脸 Provider

### `POST /v1/face/sessions`

```json
{ "externalRef": "bref_...", "reference": "chal_...", "returnUrl": "..." }
```

返回：

```json
{
  "sessionId": "face_...",
  "verifyUrl": "https://verify.example.com/session/...",
  "expiresAt": "2026-10-30T10:05:00+08:00"
}
```

### `GET /v1/face/sessions/{id}`

返回 `{ "status": "pending" | "passed" | "failed" | "expired", "score": 0.99 }`。

前端不把“点击了人脸按钮”当成通过：`FACE_MODE=http` 时，服务端必须拿到 Provider 的 `passed` 才会签发授权。演示模式才会接受页面内动画完成标记。

## 9. 本地联调

仓库自带一个**契约联调桩**，用于验证适配层而不是冒充真实银行：

```bash
# 终端 1：银行核心 + 短信/人脸 Provider 桩
BANKING_APP_ID=stub-app BANKING_APP_SECRET=stub-secret npm run bank:stub
# 默认监听 8791
```

```bash
# 终端 2：启动服务端，指向桩
BANKING_MODE=http \
BANKING_BASE_URL=http://127.0.0.1:8791 \
BANKING_APP_ID=stub-app \
BANKING_APP_SECRET=stub-secret \
SMS_MODE=http \
SMS_BASE_URL=http://127.0.0.1:8791 \
SMS_APP_ID=stub-app \
SMS_APP_SECRET=stub-secret \
FACE_MODE=http \
FACE_BASE_URL=http://127.0.0.1:8791 \
FACE_APP_ID=stub-app \
FACE_APP_SECRET=stub-secret \
npm run dev
```

一条命令跑完整回归（六场景、强验证、回退、审计，全部经 HTTP 适配层与 Provider）：

```bash
npm run smoke:full
```

## 10. 上线对接清单

1. **客户绑定**：在开户 / 授权环节建立 `bref -> bankCustId` 映射；未绑定用户调用快照应返回 `CUSTOMER_NOT_BOUND`，不要自动建户。
2. **协议与准入**：确认行方开放平台接口、报文映射、限额、幂等窗口、对账日切；本适配层只定义了网关契约，行方中间件负责映射到具体核心接口。
3. **证书与网络**：在网关层启用 mTLS、IP 白名单、WAF、请求体大小限制；不要把 appSecret 下发给客户端。
4. **数据映射**：将核心账户、卡、流水、理财、订阅映射到 `packages/shared/src/types.ts`；金额统一为分（整数）。
5. **对账与补偿**：建立日终对账、冲正、人工工单；当前“已提交且不可逆”的申购 / 赎回 / 挂失转人工，不做自动回退。
6. **审计外送**：把哈希链 checkpoint / 关键事件同步到 WORM 或集中日志平台；本地文件只用于原型。
7. **真实核验**：短信模板报备、验证码有效期 / 重发策略、人脸活体等级、失败重试与人工复核流程。
8. **上线前回归**：`npm test`、`npm run smoke`、`npm run smoke:full`，再在行方测试环境执行相同用例。

## 11. 已知未完成项

- 没有实现 OAuth / 客户授权同意管理，只有应用级 HMAC；客户绑定需行方侧完成。
- HTTP 客户端未内置 mTLS 证书加载，建议由反向代理 / 服务网格终止。
- 没有 webhook / 异步对账回调；流水依赖快照轮询。
- 快照覆盖最近流水窗口，超长历史账单需分页接口。
- “核心成功但返回快照失败”这一极端窗口建议通过幂等查询 / 对账接口补齐；当前桩总是返回快照。
- 默认仍为 `simulated/demo`，比赛演示公网实例若未配置上述变量，页面会明确标注“演示环境 / 合成数据”。
