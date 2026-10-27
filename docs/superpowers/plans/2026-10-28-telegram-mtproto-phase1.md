# TG 采集链 · 期一（契约层 + 离线联调）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 **TG 协议源**做成与 **WA 协议号**并列的一种外部协议源，复用 B27 已有网关契约，使 Telegram 不依赖 Telegram Web 页面、不需要 `WebContentsView` 就能进采集链。期一只交付**契约层 + 离线联调**，真实 MTProto 客户端留给期二。

**Architecture:** 与 B27 完全同构，差别只有两处——`source` 标识与归一化分支。外部协议服务（期二才有真实实现，期一由 mock 顶替）通过 REST + WS 与渲染层通信；`ProtocolSyncManager` 多源并列，按 `source` 选网关地址与归一化分支；归一化输出 `NormalizedMessage` 与 WA 支**完全同形**，主进程侧的 `CollectorHub` 不知道数据来自哪个源。

**Tech Stack:** TypeScript strict（`@shared/protocol/` 纯函数层）；React 19 + @tanstack/react-query 5；`node --test`；离线 harness 用 esbuild + `node:http` + `node:crypto`（零新增依赖）；JUnit 5（仅 `ChatKeys` 形态哨兵）。

**Spec:** `docs/superpowers/specs/2026-10-28-telegram-mtproto-collection-design.md`（冲突时以 spec 为准；spec 未覆盖处按下面 §0 决策表裁定）

**工作区：** `.worktrees/tg-mtproto`（分支 `feat/telegram-mtproto-phase1`）。**所有改动只发生在该工作区内。**

---

## §0 相对 spec 的决策（执行前先读）

| # | spec 原文 | 本计划裁定 | 理由 |
|---|---|---|---|
| D1 | R2「契约一个字都不改」 | **既有条目一个字不改**（信封、PING/PONG、关闭码语义）；`PROTOCOL_WS_TYPES` 里**新增** `TG_*` 三个事件名常量 | R2 的意图是"不重写已验证的契约"，不是"禁止扩展"。TG 帧若复用 `WA_MSG_IN_PUSH` 这个事件名，网关侧与排障日志都会长期混淆来源 |
| D2 | §1.1-4「manager 支持多源并列」 | `start()` 签名从 `number[]` 改成 `ProtocolSourceEntry[]`；**不留** `start(accountIds)` 旧签名 | 两个入口做同一件事是典型的双写隐患（加第三个源时一定漏一处）。调用点只有两处：`useProtocolSync.ts` 与 B27 harness 的 5 行，改得起 |
| D3 | 未涉及网关地址 | `ProtocolSyncDeps` 加 `tgBaseUrl` / `tgWsUrl` 两个可选字段，缺省 `''` | 与 `config.ts` 的既定口径一致（未配置 = 静默，绝不外连）。不塞进必填位置，避免动到 B27 已验证的构造 |
| D4 | §4-Q2「TG 账号的 platform_account 怎么建」 | 期一只加**类型常量** `TELEGRAM_PROTOCOL_ACCOUNT_TYPE = 8`（与 4 = TG 网页版区分），**不做建号 UI** | 没有类型常量，`source` 就无从映射，多源支持等于空中楼阁。但建号流程本身（Q2 的真正内容）期二再做——现在没有账号可建 |
| D5 | §1.1-7「README 更新」 | 更新为「契约层已交付（未真机验证），真链接入待 api_id」 | 不写"支持 Telegram"这种会被误读的措辞 |
| D6 | §0.3「未真机验证的代码路径必须有显式标记」 | 每个新增文件头写三行：期一 / 未经真机验证 / 期二待办点 | 可 grep 验证：`grep -rl "未经真机验证" apps/desktop/src` 应命中全部新增文件 |

### §0.1 期一红线（违反即返工）

- **零 MTProto 代码**：任何 `import` 里出现 `gramjs` / `telegram` / `mtproto` 即违反（R4）。连 devDependency 都不加。
- **零外网连接**：期一所有测试只能用 mock 网关（R9）。
- **不改现有契约**：`ProtocolWsEnvelope` / `ProtocolInboundMessage` / 关闭码 / `wp` 前缀字段名，一个字都不动（R2、R8）。

---

## §1 shared：类型与归一化

### 任务 1：协议源类型常量

- 文件路径：`apps/desktop/src/shared/chatPlatform.ts`
- 要做的：加
  ```ts
  // TG 协议源（MTProto）：与 4 = Telegram 网页版区分——4 走 WebContentsView + 注入翻译层，
  // 8 走外部协议网关，不建视图。期一只有常量与映射，无账号创建流程（spec Q2）。
  export const TELEGRAM_PROTOCOL_ACCOUNT_TYPE = 8
  ```
  `BY_CODE` 加 `[TELEGRAM_PROTOCOL_ACCOUNT_TYPE, 'telegram']`。`accountTypeOfPlatform` 不改（它只用于"平台 → 默认账号类型"的反查，协议源不该被它选中）。
- 验证：`pnpm typecheck:node` 通过

### 任务 2：`ProtocolSource` 与 TG 待实测字段（R7）

- 文件路径：`apps/desktop/src/shared/protocol/types.ts`
- 要做的：
  ```ts
  /** 外部协议源。'wa-protocol' = B27 WA 协议号；'telegram' = 本 spec 的 TG 协议源。 */
  export type ProtocolSource = 'wa-protocol' | 'telegram'
  export const DEFAULT_PROTOCOL_SOURCE: ProtocolSource = 'wa-protocol'

  export interface ProtocolSourceEntry {
    accountId: number
    source: ProtocolSource
  }
  ```
  在 `ProtocolInboundMessage` 的注释区（**不改字段**）补一段注释，列出四个「形态待实测」的 TG 字段（R7）：`msgType` 取值域、时间戳落在 `waTimestamp` 还是 `createdAt`、`senderJid` 是否带 `user#id`、已读回执的等价事件。**只写注释，不加字段。**
- 验证：`pnpm typecheck:node` 通过

### 任务 3：`normalize.ts` 的 TG 分支

- 文件路径：`apps/desktop/src/shared/protocol/normalize.ts`
- 要做的：
  1. 新增 `tgMsgTypeToMediaType(msgType?: number | string): MediaType` —— TG 名称域与 WA 不同（`photo`/`voice`/`animation`/`video_note`），WA 的 map 认不出会一律回落 `text`，所以 TG 必须走自己的一张表。未知值回落 `'text'`，并在函数注释里写明「取值域待实测」
  2. `normalizeInbound(msg, source, protocolSource = DEFAULT_PROTOCOL_SOURCE)` —— 只在 `protocolSource === 'telegram'` 时用 `tgMsgTypeToMediaType` 取代 `wpMsgTypeToMediaType`。**其余字段一个不动**（R5：输出与 WA 完全同形）
  3. 函数头注释写明：TG 的 `from` 语义（0 收 / 1 发）由**网关侧**把 MTProto 的 `out` 布尔转换而来，客户端不做二次解释（R8：不动契约）
- 验证：见任务 5

### 任务 4：`map.ts` 的 TG chat_key 映射

- 文件路径：`apps/desktop/src/shared/protocol/map.ts`
- 要做的：
  ```ts
  /**
   * TG 会话标识 -> chat_key：正整数串（单聊）/ -100 前缀负整数串（超级群）。
   * **不**把 TG 数字 id 编造成 xxx@c.us 的伪 JID——chat_key 只要内部一致即可。
   * 非整数形态一律返回 null（静默丢弃，不入站）。
   */
  export function tgChatKeyOf(peer: number | string | null | undefined): string | null
  ```
  判定：`/^-?\d+$/` 且去掉前导零后长度在 4–20（`ChatKeys.TG_CHAT` 的同形约束，与 Java 侧对齐）。
  `inboundMessageToBatch(accountId, msg, protocolSource = DEFAULT_PROTOCOL_SOURCE)` 加第三个参数透传给 `normalizeInbound`。
- 验证：见任务 5

### 任务 5：归一化与映射单测

- 文件路径：`apps/desktop/src/shared/protocol/tgNormalize.test.ts`（新建）
- 要做的：至少 9 条：
  1. TG `photo` → `image`；WA `2` → `image`（两条并存，证明分支生效而非改写）
  2. TG `voice` → `audio`；TG `animation` → `video`
  3. TG 未知 `msgType`（如 `'poll'`）→ 回落 `'text'`
  4. `protocolSource` 缺省时按 WA 域解析（`'photo'` → `text`，证明 WA 支未被污染）
  5. `tgChatKeyOf(-1001234567890)` → `'-1001234567890'`
  6. `tgChatKeyOf('123456789')` → `'123456789'`
  7. `tgChatKeyOf('123@c.us')` → `null`（**不**接受 WA 形态）
  8. `tgChatKeyOf('abc')` / `null` / `''` → `null`
  9. TG 入站经 `inboundMessageToBatch` 产出的 `IngestMessage` 与同形 WA 入站**逐字段一致**（除 `mediaType`），证明 R5 成立
- 验证：`node --test src/shared/protocol/tgNormalize.test.ts` 全绿

### 任务 6：`dispatch.ts` 支持 TG 事件名

- 文件路径：`apps/desktop/src/shared/protocol/dispatch.ts`、`apps/desktop/src/shared/protocol/tgDispatch.test.ts`（新建）
- 要做的：`PROTOCOL_WS_TYPES` **追加**三个常量（D1，既有条目不动）：
  ```ts
  TG_MSG_IN: 'TG_MSG_IN_PUSH',
  TG_MSG_STATUS: 'TG_MSG_STATUS_PUSH',
  TG_ACCOUNT_STATUS: 'TG_ACCOUNT_STATUS_PUSH'
  ```
  `dispatchWsFrame` 的 `switch` 里给三个新 case 各加一行，路由到**同一批** handler（`onMessage` / `onStatus` / `onAccountStatus`）。测试 3 条：TG 三个事件各触发对应 handler；TG 事件不触发 WA 专属路径；未知事件仍走 `onUnknown`
- 验证：`node --test src/shared/protocol/tgDispatch.test.ts` 全绿

---

## §2 manager：多源并列

### 任务 7：`manager.ts` 多源改造

- 文件路径：`apps/desktop/src/renderer/src/services/protocol/manager.ts`
- 要做的：
  1. `ProtocolSyncDeps` 加 `tgBaseUrl?: string` 与 `tgWsUrl?: string`（D3）
  2. `start(entries: ProtocolSourceEntry[])`（D2）：内部按 `accountId` 去重与校准，逻辑与原来按 `number[]` 的版本一致
  3. `attach(entry: ProtocolSourceEntry)` 取代 `attach(accountId: number)`：`makeClient(entry)` 按 `entry.source` 选 `{ baseUrl, wsUrl }`（TG 取 `tgBaseUrl` / `tgWsUrl`），handler 闭包捕获 `entry.source` 并透传给 `handleInbound` / `handleStatus`
  4. `handleInbound(accountId, data, protocolSource)` 把 `protocolSource` 透传给 `inboundMessageToBatch`
  5. `clientFor(accountId)` 改为按账号查已注册的 `source`（从一张 `sourceByAccount: Map<number, ProtocolSource>` 取），取不到退回 `'wa-protocol'`
- 验证：`pnpm typecheck:web` 通过

### 任务 8：同步更新 B27 harness 的 `start` 调用

- 文件路径：`apps/desktop/test/protocol-integration/b27-offline-integration.mjs`
- 要做的：5 处 `mgr.start([N])` 改成 `mgr.start([{ accountId: N, source: 'wa-protocol' }])`（行 86 / 124 / 151 / 174 / 196 / 216，其中 196 是账号 8、216 是账号 9）
- 验证：`pnpm run test:b27` 仍 **6 passed / 0 failed**（这是本次改造的回归底线）

### 任务 9：`config.ts` 与 `useProtocolSync.ts` 接线

- 文件路径：
  - `apps/desktop/src/renderer/src/services/protocol/config.ts`
  - `apps/desktop/src/renderer/src/hooks/useProtocolSync.ts`
- 要做的：
  - config 加 `TG_PROTOCOL_URL` / `TG_PROTOCOL_WS_URL`，读 `VITE_TG_PROTOCOL_URL` / `VITE_TG_PROTOCOL_WS_URL`，缺省 `''`（未配置则静默，不外连——与既有两条同口径）
  - `protocolAccountIds` 改名 `protocolEntries`，返回 `ProtocolSourceEntry[]`：`platformType === 7 → 'wa-protocol'`，`platformType === 8 → 'telegram'`，其余过滤掉
  - manager 构造处补 `tgBaseUrl: TG_PROTOCOL_URL, tgWsUrl: TG_PROTOCOL_WS_URL`
  - 文件头补注释：TG 源在当前版本下无账号会命中（无 type-8 记录），多源通路**只由离线 harness 覆盖**，符合期一定位
- 验证：`pnpm typecheck:web` 通过

---

## §3 离线联调 harness

### 任务 10：mock TG 网关

- 文件路径：`apps/desktop/test/telegram-protocol/mock-tg-gateway.mjs`（新建）
- 要做的：照抄 `test/protocol-integration/mock-protocol-gateway.mjs` 的骨架（`node:http` + `node:crypto` 手写 WS 握手与帧编解码，**零依赖**），只换三处：
  1. 事件名用 `TG_MSG_IN_PUSH` / `TG_MSG_STATUS_PUSH` / `TG_ACCOUNT_STATUS_PUSH`
  2. `peerJid` 用 TG 数字形态（单聊 `'1234567890'`、群 `'-1001234567890'`）
  3. `msgType` 用 TG 名称域（`'text'` / `'photo'` / `'voice'`）
  保留 B27 mock 的全部行为：PING 裸文本 → 期望 PONG；`/messages/send` REST；按测试指令以指定关闭码断连（4001 鉴权失败 / 4005 硬停）
- 验证：单独 `node -e "import('./mock-tg-gateway.mjs')"` 能起服务不报错

### 任务 11：离线联调 runner（≥6 用例）

- 文件路径：`apps/desktop/test/telegram-protocol/tg-offline-integration.mjs`、`apps/desktop/test/telegram-protocol/run.mjs`（新建）
- 要做的：`run.mjs` 照抄 `test/protocol-integration/run.mjs`（esbuild 把真实的 `manager.ts` 打成 `_tg_manager.bundle.mjs`，`alias: { '@shared': ... }`）。`tg-offline-integration.mjs` 导出 `runTG()`，至少 7 条：
  1. **T1 建连**：`start([{accountId, source:'telegram'}])` 后网关收到带 token 的 WS 握手
  2. **T2 心跳**：网关发裸文本 `PING`，client 回 `PONG`
  3. **T3 鉴权失败 4001** → 调 `onAuthFailure` 刷新 token → 重连成功
  4. **T4 硬停 4005** → 不重连，连接保持断开
  5. **T5 入站归一**：`TG_MSG_IN_PUSH`（群 `-1001234567890`，`msgType: 'photo'`）→ `/api/messages/batch` 收到 `chatKey === '-1001234567890'` 且 `mediaType === 'image'`
  6. **T6 状态推进**：`TG_MSG_STATUS_PUSH` 只带 `conversationId + messageId` → 反查 chatKey 后写 status
  7. **T7 多源并存**：同时 `start()` 一个 `wa-protocol` 与一个 `telegram` 账号，各自推帧 → 落库形状各自正确、**互不串台**（这条是 D2 改造的核心证人）
  输出格式照抄 B27：`PASS/FAIL` 逐行 + 末尾 `TG 期一离线联调结果：N passed, M failed`
- 验证：`node test/telegram-protocol/run.mjs` → **7 passed, 0 failed**

### 任务 12：`test:tg` 脚本

- 文件路径：`apps/desktop/package.json`
- 要做的：`scripts` 加 `"test:tg": "node test/telegram-protocol/run.mjs"`（紧挨 `test:b27`）
- 验证：`pnpm run test:tg` 7/7

---

## §4 后端复查与文档

### 任务 13：`ChatKeys.java` 形态复查 + Java 哨兵

- 文件路径：`apps/server/src/test/java/com/smartscrm/server/service/msg/ChatKeysTgShapeTest.java`（新建；**`ChatKeys.java` 本身预期不改**）
- 要做的：spec R3 要求复查 `ChatKeys.java` 确认 TG 形态与前端同形。读码确认后（预期结论：`TG_CHAT = ^-?\d{4,20}$` 已覆盖 `-1001234567890` 与正整数，无需改动），用 4 条断言把它钉住：
  1. `matchesPlatform("telegram", "-1001234567890")` → true（超级群）
  2. `matchesPlatform("telegram", "1234567890")` → true（单聊）
  3. `matchesPlatform("telegram", "123@c.us")` → false（**不接受 WA 形态**）
  4. `matchesPlatform("telegram", "abc")` → false
  若读码发现形态不一致，**回来改 `ChatKeys.java` 并在此计划里记一笔**——不要静默绕过
- 验证：`./mvnw -pl apps/server test -Dtest=ChatKeysTgShapeTest` 全绿

### 任务 14：README 与期一标记

- 文件路径：`README.md`、全部新增文件头
- 要做的：
  1. README「未交付」清单里 Telegram 一条从「卡在无机号」改为「契约层已交付（**未经真机验证**）；真实 MTProto 接入待 api_id / api_hash 与账号」
  2. README §7 补一段期一/期二切分说明：期一含什么、期二含什么、为什么现在做不了
  3. 每个新增文件头三行注释（D6）：`期一：契约层，未经真机验证` / `期二待办：<具体点>` / `契约见 docs/superpowers/specs/2026-10-28-telegram-mtproto-collection-design.md`
- 验证：`grep -rl "未经真机验证" apps/desktop/src apps/desktop/test/telegram-protocol` 应命中全部新增文件；README 人读一遍无矛盾表述

---

## §5 收尾

- [ ] `pnpm run test:unit` 全绿（基线 496 → 新增 ≥ 12 条后 ≥ 508）
- [ ] `pnpm run typecheck` 四路全绿
- [ ] `pnpm run test:b27` 仍 **6/6**（D2 改造的回归底线，必须保持）
- [ ] `pnpm run test:tg` **7/7**
- [ ] **依赖闸**：`pnpm -r list` 输出里不出现任何 `gramjs` / `telegram` / `mtproto` 相关包（R4 的可验证形式）
- [ ] `./mvnw -pl apps/server test` 全绿
- [ ] `pnpm lint` 无新增告警
