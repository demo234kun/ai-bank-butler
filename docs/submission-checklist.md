# 提交清单（对标赛题「五、作品资料」）

> 目标：把赛题要求的每一项落到具体文件与状态。✅ 已具备 · ⚠ 需补动作 · ⏸ 由你决定何时做
> 打包脚本：`node scripts/build-submission.mjs --target=G:\\AI银行管家-提交材料`

## 1. 作品简介（报名系统填写，≤200 字，含创作理念与所用 AI 技术）

| 项 | 状态 | 位置 / 待办 |
| --- | --- | --- |
| 简介正文 197 字 | ✅ | [submission-intro.md](submission-intro.md)，含创作理念与所用 AI 技术（大模型意图解析、Agent DAG 规划、策略引擎、数字守卫、哈希链审计、受限沙箱、WebAuthn、语音识别） |
| 作品名称 | ✅ | 定稿 **AI 银行管家**（拉丁字标 AI BANK BUTLER），`packages/shared/src/brand.ts` 一处生效，界面、manifest、WebAuthn 显示名、文档与 PPT 已同步 |

## 2. 技术文档（系统架构图 + 核心算法说明 + 安全设计文档）

| 要求 | 状态 | 位置 / 待办 |
| --- | --- | --- |
| 系统架构图 | ✅ | [architecture.md](architecture.md) §2 分层图（客户端 / API / Agent 运行时 / 安全内核 / 工具 / 接入层）+ 导出 PNG；§3 对话时序（含 T2 复述与 T4 审核）+ 导出 PNG |
| 架构图导出图片 | ✅ | `docs/assets/architecture.png`、`docs/assets/sequence.png`，已在 architecture.md 内嵌；重新生成：`node tools/render-diagrams.mjs` |
| 核心算法说明 | ✅ | architecture.md §4 NLU（模型必调 + 规则合并）、§5 业务模板库（18 个）、§6 DAG 规划与执行、§7 核心算法（五档融合、14 信号风控评分、摘要授权、复述、额度、数字守卫、注入、审计链） |
| 安全设计文档 | ✅ | [security-self-assessment.md](security-self-assessment.md)、[feature-description.md](feature-description.md) 第二、三节 |
| 接口与数据契约 | ✅ | [api.md](api.md)、[openapi-banking.yaml](openapi-banking.yaml)、[banking-integration.md](banking-integration.md) |
| 功能与设计说明 | ✅ | [feature-description.md](feature-description.md)（按赛题任务与核心技术要求逐条写） |

## 3. 答辩材料（PPT ≤10 分钟 + 演示视频 ≤5 分钟）

| 要求 | 状态 | 位置 / 待办 |
| --- | --- | --- |
| 答辩 PPT 大纲 | ✅ | [ppt-outline.md](ppt-outline.md)：10 页逐页主张、画面、口播与计时，按赛题三项核心技术要求分章对应 |
| 答辩 PPT 成片 | ✅ | `docs/ppt/AI银行管家-答辩.pptx`（16:9 · 10 页 · 每页含演讲者备注）+ 同名 PDF；重新生成：`python scripts/build-ppt.py`，导出预览：`cp` 成 ASCII 名后跑 `tools/export-ppt.ps1`（逐页 PNG）与 `tools/export-ppt-pdf.ps1`（PDF） |
| 打包位置 | ✅ | 随包进入 `06-演示材料/`（pptx + pdf + 大纲 + 演示脚本），`docs/ppt/` 不再重复进源代码 |
| 演示视频 ≤5 分钟 | ⚠ | 分镜与台词已就绪：[demo-script.md](demo-script.md)（0:00–5:00 逐段画面 + 关键话术）；**尚未录制** |
| 演示环境 | ⚠ | 当前公网链接是临时 Cloudflare 隧道，进程结束即失效；录制前建议换成固定域名托管，或本地起服务录屏 |
| 界面截图 | ✅ | `docs/assets/`（产品端、控制台、真实浏览器回归截图） |

## 4. 作品信息（源代码 + README + GitHub 仓库地址 + 部署说明 + 测试用例）

| 要求 | 状态 | 位置 / 待办 |
| --- | --- | --- |
| 源代码 | ✅ | 整个仓库（monorepo：`apps/server`、`apps/web`、`packages/shared`、`scripts`、`tools`）；打包时排除 `node_modules`、构建产物、运行数据与隧道二进制 |
| README | ✅ | `README.md`（简介、产品形态、场景、安全设计、快速开始、脚本、架构、已知边界、目录） |
| GitHub 仓库地址 | ✅ | https://github.com/demo234kun/ai-bank-butler （public，240 个文件；已排除 `node_modules`、`dist`、`data/` 运行数据、`.env`、隧道 exe） |
| 部署说明 | ✅ | [deploy.md](deploy.md)（本地、Docker、公网 HTTPS、环境变量表、两种前端构建、验收清单） |
| 测试用例 | ✅ | `apps/server/test/`（策略、NLU、规划、审计、账本、集成、风险测评、争议）+ `scripts/smoke.ts`、`scripts/smoke` 全量模式 + `tools/qa-product.mjs` 浏览器回归 |
| 依赖与开源许可 | ✅ | [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md)，离线枚举 291 个第三方包及许可（MIT/ISC/Apache/BSD 等），自研 `@bank/*` 不计入；`node scripts/list-licenses.mjs` 可重新生成 |
| 密钥与隐私 | ✅ | `.env` 不入库，模型 Key 仅存服务端；`.gitignore` 已排除 `data/`、`.env`、`tools/*.exe` |

## 5. 安全自评报告（权限分级实现说明 + 已知风险清单）

| 要求 | 状态 | 位置 |
| --- | --- | --- |
| 权限分级实现说明 | ✅ | security-self-assessment.md 分级章节 + feature-description.md 第二节（含与赛题表格的逐条对应与差异说明） |
| 已知风险清单 | ✅ | security-self-assessment.md「已知风险清单（P0/P1/P2）」19 条 + feature-description.md 第七节边界 |
| 自评口径 | ✅ | 报告开头声明为开发期自查，不构成合规或审计结论 |

## 6. 项目规范自查

| 要求 | 状态 | 说明 |
| --- | --- | --- |
| 独立完成 | ✅ | 代码自研；第三方仅为开源框架与公开模型 API，需在许可清单中列明 |
| 无作弊、欺诈 | ✅ | 所有演示数据与通道性质在带标注版界面与文档中如实说明；纯产品版只是去掉措辞，不改变行为与数据来源 |
| 知识产权 | ✅ | 作品名 **AI 银行管家**；界面、文档与合成数据未使用真实银行商标、标识或受版权素材（银行名均为虚构：云杉 / 青禾 / 北岭 / 长川）；商户与支付渠道名称仅作场景说明；图标为自绘 SVG |
| 主办方宣传授权 | ⚠ | 报名前确认作品名与截图是否可公开 |

## 7. 打包时排除的内容

`node_modules/`、`apps/web/dist/`、`data/`（含账号与审计运行数据）、`tools/cloudflared.exe`、`.qoder/`、本地 `.env`。

## 8. 提交前最后检查

1. 作品名与品牌是否定稿，`brand.ts` 是否替换并重新构建。
2. git 仓库是否已初始化并推送到可访问的 GitHub 地址。
3. 演示视频是否录制完成且 ≤5 分钟，链接是否可访问。
4. 安全自评与依赖许可清单是否随包提交。
5. 公网演示链接在提交时刻是否仍然有效（临时隧道会失效）。
