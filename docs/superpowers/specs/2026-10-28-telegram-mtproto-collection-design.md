# TG 采集链（MTProto 协议源 · 期一：契约层 + 离线联调）

日期：2026-10-28
阶段：新模块。README 现状：「未交付：Telegram 采集/发送链（卡在无机号）」
前置：B27 WA 协议号入站腿（`src/shared/protocol/` 网关契约 + `ProtocolSyncManager` + mock 网关）

---

## 0. 目标与约束

把 **TG 协议源**做成与 **WA 协议号**并列的一种外部协议源，**复用 B27 已有的网关契约**，使 TG 不依赖 Telegram Web 页面、不需要 `WebContentsView` 就能进采集链。

### 0.1 为什么不是"移植对标项目的 TG 注入层"

对标项目的 TG 取数依赖 Telegram Web **页面自己挂的内部接口**：`window.getData` / `window.getMessage` / `window.sendMessage` / `getGlobal()` 状态树 / `window.apiUpdate` 自定义事件。这些在 Telegram 官方文档里一个字都没有，是它与**某个特定版本** Telegram Web 之间的隐式契约（其 `src/inject/platforms/telegram/` 有 5.3 万行，其中 `tabState.d.ts` 一个类型文件 1108 行）。

照抄的后果：把一个无法验证、随时会被上游一次发布打断的契约搬进本仓，且**现在手上没有账号能验证它是否还成立**。

**决定：走 MTProto 直连，不依赖页面。**

### 0.2 期一 / 期二的切分（这是本 spec 的核心）

MTProto 登录必须走手机号收验证码，构造客户端还需要 `api_id` / `api_hash`（my.telegram.org 申请）。**当前两者都没有**，因此：

| | 内容 | 能否验证 |
|---|---|---|
| **期一（本 spec）** | 契约层、协议源抽象、状态机、重连、归一化、mock 网关联调 | ✅ 全离线可测，要求单测 + harness 全绿 |
| **期二（不在本 spec）** | 真实 MTProto 客户端、登录流程、session 持久化、2FA / `FLOOD_WAIT`、真机验收 | ❌ 需 api_id + 账号 |

期一交付后，**拿到 api_id 与账号时只需替换网关实现，客户端一侧不动**。

### 0.3 硬约束

- **GramJS / MTProto 客户端不进 Electron 主进程**，跑外部独立服务。native 依赖、内存占用与崩溃风险都隔离在外；与 WA 协议号同架构。
- **期一不引入任何 MTProto / GramJS 依赖**（连 devDependency 都不加）。
- **契约复用优先于契约优化**：`src/shared/protocol/` 现有的 `ProtocolWsEnvelope` / `ProtocolInboundMessage` / 关闭码语义一律不改。
- **未真机验证的代码路径必须有显式标记**：文件头注释 + README 记一笔。不允许写出"看起来能跑"但没有证据的东西。

### 0.4 核心语义规则

| # | 规则 |
|---|---|
| R1 | TG 走**协议源**，与 B27 协议号同口径：不经网页登录、不建 `WebContentsView`、不注册进 `msgBridge` 的 `COLLECT` 表 |
| R2 | **契约一个字都不改**：WS 信封 `{event, data}`、PING/PONG 裸文本、关闭码 4001（鉴权失败→刷新重试）/ 4005（硬停→不重连），全部沿用 |
| R3 | **TG 的 `chat_key` 形态**：群为 `-100` 前缀的负整数串、单聊为正整数串。`isGroupChatKey` 已支持 `-100`，`peerPhoneOfChatKey` 对 TG 一律返回 `null`——**这两处都不用改**，但 `ChatKeys.java` 必须复查一遍确认同形 |
| R4 | **期一零 MTProto 代码**。任何 `import` 里出现 `gramjs` / `telegram` / `mtproto` 即违反 |
| R5 | 归一化输出 `NormalizedMessage`，与 WA 支**完全同形**，主进程侧零分支——`CollectorHub` 不知道数据来自哪个源 |
| R6 | **采集投递仍走 `CollectorHub`**，不新造缓冲、不新造重试 |
| R7 | **每条未经真机验证的契约字段都要在类型上标 `?` 并在注释里写明"形态待实测"**，不假装已经知道形状（沿用 `bridge/types.ts` 里对群变动字段的既有做法） |
| R8 | 契约层字段**沿用现有 `wp` 前缀命名**（`wpMsgId` / `peerJid` / `waTimestamp`）。改名会动到 B27 已验证的代码，收益不抵风险；TG 语义由 §2.2 的形态映射承担，不靠改字段名 |
| R9 | 期一的测试**只能用 mock 网关**，禁止任何外网连接 |

---

## 1. 范围

### 1.1 做（期一）

| # | 内容 |
|---|---|
| 1 | `src/shared/protocol/types.ts`：新增 `ProtocolSource` 联合（`'wa-protocol' \| 'telegram'`）与 TG 侧**待实测**字段的类型占位（R7） |
| 2 | `src/shared/protocol/normalize.ts`：`normalizeInbound` 扩展出 TG 分支（msgType 与时间字段的 TG 形态） |
| 3 | `src/shared/protocol/map.ts`：TG 会话标识 → `chat_key` 的映射（§2.2） |
| 4 | `src/renderer/src/services/protocol/manager.ts`：`ProtocolSyncManager` 支持多源并列，配置里带 `source` |
| 5 | `test/telegram-protocol/mock-tg-gateway.mjs`：零依赖 mock TG 网关（沿用 `mock-protocol-gateway.mjs` 的写法，`node:http` + `node:crypto`） |
| 6 | `test/telegram-protocol/run.mjs`：离线联调 harness，≥6 个用例（对标 `test:b27`） |
| 7 | README「未交付」清单更新：TG 从"卡在无机号"改为"契约层已交付（未真机验证），真链接入待 api_id" |

### 1.2 不做（期二 / 明确推迟）

- 真实 MTProto 客户端与登录流程（需 api_id + 账号）
- `api_id` / `api_hash` 的配置与存储
- session 持久化与失效重登
- 2FA、`FLOOD_WAIT`、风控退避
- TG 群成员采集与导出（B6 那一套目前只接了 WA）
- **TG 的发送 / 撤回**：期一只做入站腿，与 B27 同口径
- 现有 TG 注入翻译层（`src/inject/platforms/telegram/`）——**保留不动**，那是"页面内"的另一条链，与本源无关

### 1.3 验收

| 层 | 条件 |
|---|---|
| 单测 | `pnpm test:unit` 全绿；新增覆盖：TG 归一化、形态映射、多源分派、退避与关闭码 |
| 类型 | `pnpm typecheck` 四路全绿 |
| 离线联调 | `pnpm test:tg` 全绿，≥6 个用例（建连/心跳/鉴权失败重连/硬停不重连/入站消息归一/状态推进） |
| 依赖闸 | `pnpm -r list` 里不出现任何 MTProto 相关包（R4 的可验证形式） |
| **明确标注** | 所有新增文件头写明「期一：契约层，未经真机验证」；README 同步 |

---

## 2. 关键设计

### 2.1 协议源并列

```
外部协议服务（独立进程，期二才有真实实现；期一由 mock 顶替）
   │  REST: POST /messages/send
   │  WS:   { event, data } 信封 + 裸文本 PING/PONG
   ▼
ProtocolSyncManager（渲染层，多源：wa-protocol | telegram）
   │  归一化 → NormalizedMessage
   ▼
CollectorHub → POST /api/messages/batch
```

与 WA 协议号**共用同一条路**，差别只在 `source` 与归一化分支。

### 2.2 TG 会话标识 → `chat_key`（R3 / R8）

| TG 概念 | 原生形态 | 落 `chat_key` | 备注 |
|---|---|---|---|
| 单聊 / 用户 | 正整数 id | `"123456789"` | `peerPhoneOfChatKey` 返回 `null`（无手机号语义） |
| 超级群 / 群组 | `-100` 前缀 | `"-1001234567890"` | `isGroupChatKey` 已认 |
| 话题（thread） | 群 id + thread id | `-100...`（v1 不展开话题维度） | 期二再定 |

**不做的事**：不把 TG 数字 id 编造形如 `xxx@c.us` 的伪 JID 去套 WA 那套。同类项目踩过"拿 WA 词汇装 TG 数据"的坑——`chat_key` 只要内部一致即可，不需要长得像另一个平台。

### 2.3 待实测字段清单（R7）

以下内容期一**只留类型占位与注释**，不写死逻辑；拿到账号后逐条实测回填：

- `msgType` 的 TG 取值域（对照 WA 的 `wpMsgTypeToMediaType`）
- 时间戳字段：TG 给的是否为 epoch 秒，落在 `createdAt` 还是 `waTimestamp`
- 发送人：TG 的 `senderJid` 是否带 `user#id` 形态
- 状态推进：TG 的已读回执是否有等价事件

---

## 3. 风险

| # | 风险 | 处置 |
|---|---|---|
| 1 | **期一交付物无法证明"能采到真数据"** | 这是已知且被接受的。靠 §1.3 的"明确标注"与 README 记账来管，不靠含糊表述掩盖 |
| 2 | **期二实测发现契约装不下 TG**（字段形状与预期不符） | R7 已把待实测字段隔离在类型占位层；真出偏差只改 `normalize.ts` 与 `map.ts`，不动 `dispatch.ts` / `manager.ts` |
| 3 | **`wp` 前缀命名造成长期语义污染** | 记录在 R8 的取舍里。若期二证明摩擦过大，再单独起一次改名（届时 B27 与 TG 一起改，有测试兜底） |
| 4 | **外部网关进程的管理**（期二才出现） | 期一定死接口边界；期二的进程托管方案另起 spec |

---

## 4. 未决问题

| # | 问题 | 当前处置 |
|---|---|---|
| Q1 | 期二时外部网关怎么分发与更新？（随客户端打包 / 独立安装 / 自托管） | 期一不决。接口边界定死后，这题可以独立回答 |
| Q2 | TG 账号的 `platform_account` 记录怎么建？现有建号流程隐含"要建视图" | 期一不决。期二需要一条"无视图账号"的建号路径，与协议号共用 |
| Q3 | 现有 TG 注入翻译层与本源长期并存是否会分裂？ | 暂定并存：注入层服务"用户在页面里手动聊"，协议源服务"后台采集"。若期二证明重复，再考虑收敛 |
