# P7 / B7 批量群发设计（batch-send）

**日期** 2026-09-28 · **清单** B7（`docs/feature-checklist.md:33`，标「P7」）
**目标**：让运营在应用内建一个"多个账号 × 多个会话 × 多条文本"的群发任务，由主进程逐条骑在现有发送链上跑完，进度与结果落库、可随时暂停/继续/取消，并且能对已发成功的条目做"对所有人撤回"。
**范围**：只做 B7，且第一版只做 WhatsApp。素材归属分层（B17）、Telegram 群发、媒体与按钮消息、陌生号直发各有去处，见 §10。

## 0. 约束与红线

- 本地 MySQL（`smartscrm_react`）+ Java 后端是唯一数据层；迁移只新增（`V11`），不改已发布迁移。
- 发送能力只在主进程（桥挂在那儿）。渲染层与页内脚本永远说不出"我属于哪个账号的哪个会话"，本设计不削弱这条盖章口径。
- 所有业务行按 `tenant_id` 隔离；平台 id 列（`chat_key` / `msg_key`）沿用 V8 的二进制排序。
- **真发与真删是不可回收动作**：执行环必须能在完全不碰页面的前提下被验证到底（§5 的演练出料口），真发/真撤回各只跑一次且由用户在场放行。
- 验证分档：后端 HTTP 契约 / `node:test` 纯函数 / 渲染层 CDP / 真实登录档。后一档没跑完就不写"已验证"。
- 本文只描述本项目的规则，不与其他实现比较。

## 1. 现在有什么（设计前提，读码所得）

| 事实 | 位置 |
|---|---|
| 单条发送的唯一入口：校验 → 绑视图 → `registry.add(localId)` 拿回执 Promise → 归属登记 → 下推 `send` 命令 | `src/main/services/msgBridge/index.ts:329-346` |
| 页内发送走 wa-js：`chat.sendTextMessage(chatKey, text, { createChat: true, waitForAck: false })`，**不需要在页面里切会话或敲输入框** | `src/bridge/whatsapp/send.ts:47-55` |
| 回执必须带 `msgKey`，且与事件流那条 `MsgModel.id._serialized` 逐字相等（后端 `uk_msg` 靠它认行）；`deleteMessage` 的入参才需要剥 `_out` 尾 | `src/bridge/whatsapp/send.ts:23-41` |
| 发送前的一行校验：非空且 ≤ 5000 字 | `src/main/services/msgBridge/msgApi.ts:114-116` |
| 归属认领刻意保守：同视图 + 同会话 + 同文本才在无 msgKey 时按 FIFO 认领 | `src/main/services/msgBridge/sendRegistry.ts:99-123` |
| 主进程调本地后端有唯一一跳：带 access token、401 自动刷新重试一次 | `src/main/services/authedFetch.ts:80-93` |
| 会话头表已带可寻址的收件人身份：`chat_conversation(tenant_id, platform, account_id, chat_key, customer_id)`，`uk_conv` 保证一个账号内会话键唯一 | `V8__chat_history.sql:15-28` |
| `wa-js.bundle.js` 暴露 `chat.deleteMessage=async function(e,t,r=!1,l=!1)`（4 位，后两位默认 false） | `resources/wa-js.bundle.js`（搜 `deleteMessage=async function`） |
| `WPP.chat.deleteMessage(chatId, ids, deleteMediaInDevice?, revoke?)` → `{id, sendMsgResult, isRevoked, isDeleted, isSentByMe}`，第四位 `revoke` 才是"对所有侧" | wa-js 官方 `_autodocs/api-reference/chat.md` |
| 导航是 9 项硬编码表，新增模块 = 加一行 | `src/renderer/src/lib/nav.ts:21-33` |
| 单实例锁使本机不可能同时跑第二个应用实例 | `src/main/index.ts:9` |

## 2. 数据模型（V11）

`V11__batch_send.sql`，两张表，均 `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`，迁移带回滚段。

```sql
CREATE TABLE `batch_send_task` (
    `id`                BIGINT       NOT NULL AUTO_INCREMENT,
    `tenant_id`         BIGINT       NOT NULL,
    `name`              VARCHAR(64)  NOT NULL,
    `platform`          VARCHAR(16)  NOT NULL DEFAULT 'whatsapp' COMMENT 'whatsapp | telegram(留位，第一版不放开)',
    `dry_run`           TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1=演练：出料口只记账，不碰页面',
    `status`            VARCHAR(16)  NOT NULL DEFAULT 'pending' COMMENT 'pending|running|paused|done|error|cancelled',
    `account_ids`       TEXT         NOT NULL COMMENT 'JSON 数组：参与账号（platform_account.id）',
    `contents`          TEXT         NOT NULL COMMENT 'JSON 数组：文本模板，顺序即 content_index',
    `msg_interval_min`  INT          NOT NULL DEFAULT 3 COMMENT '同一收件人两条内容之间，秒',
    `msg_interval_max`  INT          NOT NULL DEFAULT 8,
    `chat_interval_min` INT          NOT NULL DEFAULT 5 COMMENT '换一个收件人之间，秒',
    `chat_interval_max` INT          NOT NULL DEFAULT 15,
    `total_count`       INT          NOT NULL DEFAULT 0,
    `sent_count`        INT          NOT NULL DEFAULT 0,
    `fail_count`        INT          NOT NULL DEFAULT 0,
    `heartbeat_at`      DATETIME(3)  NULL COMMENT '引擎心跳；reconcile 的唯一依据',
    `created_at`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    KEY `idx_bst_tenant_status` (`tenant_id`, `status`, `id`),
    CONSTRAINT `fk_bst_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='batch send tasks';

CREATE TABLE `batch_send_detail` (
    `id`            BIGINT        NOT NULL AUTO_INCREMENT,
    `tenant_id`     BIGINT        NOT NULL,
    `task_id`       BIGINT        NOT NULL,
    `seq`           INT           NOT NULL COMMENT '执行序：收件人为主，同人内容连续',
    `account_id`    BIGINT        NOT NULL,
    `chat_key`      VARCHAR(128)  COLLATE utf8mb4_bin NOT NULL,
    `customer_id`   BIGINT        NULL,
    `content_index` INT           NOT NULL,
    `body`          TEXT          NOT NULL COMMENT '渲染后的最终文本快照：事后能看到究竟发出去什么',
    `local_id`      VARCHAR(64)   NULL COMMENT '引擎为这条生成的 id，回执靠它对上',
    `send_status`   VARCHAR(16)   NOT NULL DEFAULT 'pending' COMMENT 'pending|sending|success|failed|unknown|skipped',
    `error_code`    VARCHAR(32)   NULL,
    `error_detail`  VARCHAR(255)  NULL,
    `msg_key`       VARCHAR(160)  COLLATE utf8mb4_bin NULL COMMENT '回执原样存，撤回时才剥 _out 尾',
    `recall_status` VARCHAR(16)   NOT NULL DEFAULT 'none' COMMENT 'none|recalling|recalled|recall_failed',
    `recall_detail` VARCHAR(255)  NULL,
    `sent_at`       DATETIME(3)   NULL,
    `created_at`    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_bsd_seq` (`tenant_id`, `task_id`, `seq`),
    KEY `idx_bsd_run` (`task_id`, `send_status`, `seq`),
    KEY `idx_bsd_recall` (`task_id`, `recall_status`),
    CONSTRAINT `fk_bsd_task` FOREIGN KEY (`task_id`) REFERENCES `batch_send_task` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='batch send details';
```

两张表的键列（`chat_key` / `msg_key`）显式写 `COLLATE utf8mb4_bin`，其余列跟表默认，与 V8 已立的口径一致；迁移文件带 `-- 回滚` 注释段（`DROP TABLE batch_send_detail; DROP TABLE batch_send_task;`）。

**状态机**

- 任务：`pending → running → done`；`running ⇄ paused`；`running → error`（参与账号全部熔断或人工放弃）；任一非终态 `→ cancelled`。`done/error/cancelled` 不可再 `start`。
- 明细：`pending → sending → success | failed | unknown`；`pending → skipped`（任务被取消或账号熔断时的未跑条目）。`unknown` 只能由人工裁决改写为 `success`（补 `msg_key` 无从谈起，因此不给它撤回资格）或 `failed`。
- 撤回：`none → recalling → recalled | recall_failed`，只有 `send_status='success' AND msg_key IS NOT NULL AND dry_run=0` 的条目有撤回资格。

## 3. 创建：展开与校验（全在后端事务内）

入参：`name`、`platform`、`dryRun`、`accountIds[]`、收件人选择（`conversations: [{accountId, chatKey}]`，或 `audienceId` / `customerIds` 由后端解析成会话集）、`contents[]`、四个间隔值。

规则，按顺序判，第一条不满足即整单拒绝（不留半成品）：

1. `platform` 必须是 `whatsapp`（第一版唯一放开的一档）。
2. `accountIds` 非空、全部属于本租户且已绑定视图；`conversations` 每一项都能在 `chat_conversation` 按 `(tenant_id, account_id, chat_key)` 查到，且 `account_id ∈ accountIds`。查不到的条目**逐个点名**回给前端，不静默丢。
3. 上限：收件人 ≤ **1000**、内容条数 ≤ **20**、单条正文 trim 后非空且 ≤ **5000** 字（与 `isSendable` 同一条口径，不另造第二个数；空正文永远不该出主进程）、展开后的明细总数 ≤ **20000**。
4. 间隔：`0 ≤ min ≤ max ≤ 3600`；`dryRun=0` 时 `msg_interval_min ≥ 3` 且 `chat_interval_min ≥ 5`（真发的风控下限，演练不受限）。
5. 展开：`seq` 以**收件人为主序**——同一收件人的多条内容连续排完，再换下一个收件人（这样 `chat_interval` 与 `msg_interval` 各管各的那一段）。`total_count = 收件人数 × 内容条数`，插入完成后与实数比对，不等则回滚。
6. 渲染（插值）只认两个变量，缺值走各自的兜底而不是留空串骗人：`{客户名}` → `customer.nickname`，缺失则 `open_id` 尾 4 位；`{号码}` → `customer.phone`，缺失则 `''`。未识别的 `{...}` **原样保留**（正文里的合法花括号不该被吞）。渲染结果写进 `body`，模板本身只留在 `task.contents`。
7. `created_at` 起任务可查但引擎不碰：`start` 是另一条显式动作。

**落地裁定**

- R1（错误码表）：群发新增码段 `40011` 账号不可用、`40012` 收件人全部不可寻址、`40013` 群发规则不过（`message` 为全部违规以「；」拼接）、`40014` 展开总数自检失败、`40902` 状态迁移非法、`40903` 撤回目标不合法；"目标行不存在"仍用既有 `40404`。
- R8（部分拒绝）：仅**部分**收件人不可寻址时创建照常成功，被拒者在返回的 `rejected[]` 中逐个点名（`chatKey` + `accountId` + 原因）；**全部**不可寻址才整单拒绝，报 `40012`。
- R9（`{客户名}` 兜底链）：无客户归属的会话，`{客户名}` 回落「会话标题 → 否则 `chat_key` 本地段（`@` 之前）的尾 4 位」，`{号码}` 回落 `''`——无客户时不存在 `open_id` 列，`open_id` 尾 4 位一档只在有客户且昵称缺失时生效。
- R10（收件人寻址）：创建入参只接受 `conversations: [{accountId, chatKey}]` 一种收件人表达；上文"或 `audienceId` / `customerIds` 由后端解析成会话集"不进第一版取件面，人群包/客户/标签的收窄在选会话之前于前端完成，最终仍交回 `conversations`。

## 4. 后端 API 面（前缀 `/api/batch-send`，沿用现有 REST 约定）

| 方法与路径 | 用途 |
|---|---|
| `POST /tasks` | 创建并展开（§3）：成功返回 `taskId` 与被拒收件人清单（全通过时是空数组）；任一条规则不过则整单不落一行 |
| `GET /tasks?status=&page=&size=` | 任务列表（含 `dry_run` 与三计数） |
| `GET /tasks/{id}` | 单任务 |
| `GET /tasks/{id}/details?sendStatus=&recallStatus=&page=&size=` | 明细翻页 |
| `POST /preview` | 向导里的样例渲染（渲染规则只有后端一份，预览必须复用同一个函数） |
| `POST /tasks/{id}/start` \| `pause` \| `resume` \| `cancel` | 状态迁移，非法迁移返回 4090x 并点名当前态 |
| `POST /tasks/{id}/heartbeat` | 引擎心跳（幂等，只写 `heartbeat_at`） |
| `POST /tasks/{id}/reports` | 引擎批量回报明细结果：`[{detailId, localId, sendStatus, errorCode, errorDetail, msgKey, sentAt}]`；服务端按 `detailId` 定位行（多账号并行上报，同批内**不要求** `seq` 有序），并在同一事务里刷三计数 |
| `POST /tasks/{id}/retry-failed` | 把 `failed` 复位为 `pending`（`unknown` 不复位），返回复位条数 |
| `POST /tasks/{id}/recall` | 入参 `detailIds[]`，服务端筛出有撤回资格的条目并置 `recalling`，回给引擎待撤清单；无资格者逐个点名原因 |
| `POST /tasks/{id}/recall-reports` | 撤回结果回报：`[{detailId, recalled, detail}]` |

租户闸、参数校验、错误码风格全部沿用既有控制器；越权与跨租户读一律走现有那条 401/403 出口（`401` 无 data 字段这条已知口径不变）。

## 5. 执行环：主进程 `services/batchSend/engine.ts`

**唯一的出料口**（这是演练模式的全部实现成本）：

```ts
type Dispatch = (d: DetailRow, viewId: string) => Promise<SendOutcome>
// 真发: d => sendText({ localId: d.localId, accountId, chatKey, text: d.body })
// 演练: async d => { await sleep(模拟耗时); return { ok: true, msgKey: `dryrun:${d.id}` } }
```

队列与节律：

- 每个参与账号一条队列，**队列内串行**、账号之间并行；同一队列内按 `seq` 升序取待跑明细。
- 每条跑完按规则取随机间隔：同人还有下一条内容 → `msg_interval`，换人 → `chat_interval`；`[min,max]` 均匀随机，随机源可注入（测试用假 clock + 假随机源断言区间与次数）。
- 明细生命周期：先 `POST reports` 标 `sending` → 调出料口 → 按结果标 `success(+msg_key)` / `failed(+error_code)` / 超时 `unknown`。
- 每账号**连续 3 条失败即熔断该账号**：剩余条目置 `skipped`，队列停，其他账号继续；全部账号停时任务转 `error`。桥掉线（`BRIDGE_OFFLINE`）等同一次失败计数，不做无限重试。
- 撤回是同一条队列的第二种活：走同一把锁、同一档 `chat_interval`，逐条 `recall` 命令。

共用锁：**在 `sendText` 内部**加一把 per-view 串行闸门（同一 `viewId` 同时只允许一条 send 在飞），回复框与群发共用。理由与代价写清楚：归属认领是"同视图+同会话+同文本 FIFO"（`sendRegistry.ts:99-102`），让它并发只会制造认错机会；代价是手动回复最坏多等一条间隔。

心跳与续跑：

- 引擎每 **15 s** 刷一次 `heartbeat_at`（与进度推进无关，定时器驱动），因此陈旧判定不受间隔上限（3600 s）影响。
- 应用启动时 reconcile：`status='running'` 且 `heartbeat_at` 为空或早于 **60 s** 前 → 任务转 `paused`；其 `sending` 残留明细 → `unknown`（发没发出去真的不知道，**不自动重发**，只给人工裁决）。
- 后端不可达：`reports` 落内存积压队列（上限 **500** 条，溢出丢最旧并计数），恢复后按序重报；任务不因上报失败而失败，积压计数一并写进日志。
- 单实例锁（`src/main/index.ts:9`）保证本机只有一个引擎，所以不引入认领表与认领锁。

## 6. 桥与注入层：新增 `recall` 命令

- `BridgeCommand` 加 `{ kind: 'recall'; localId; chatKey; msgKey }`，回执 `{ kind: 'recall_result'; localId; ok; isRevoked?; detail? }`；`ipc.ts` 的白名单与 preload 通道同步放开（沿用"页内说不出账号会话、主进程盖章"的既有形制）。
- 页内实现：`WPP.chat.deleteMessage(chatId, msgKey.replace(/_out$/, ''), false, true)`——剥 `_out` 尾只发生在**入参**这一步，`msg_key` 列存的仍是回执原样（§2 与 `send.ts:23-27` 一致）。
- 判定：只有返回体 `isRevoked === true` 才写 `recalled`；其余一律 `recall_failed + detail`。超时窗内失败的形状（文案/异常）在第一版验收里由用户那一格实测回来补正则——与 `send.ts:13-15` 的分类策略同一套办法。

## 7. 渲染层：入口与三块面

- `nav.ts` 加一行 `/broadcast`「批量群发」，排在「人群包」之后（它消费人群包选出的收件人）。
- `BroadcastPage`：任务列表（状态、`sent/fail/total` 进度、**演练徽标常驻**——跑完的演练任务不许看起来像真发过）、创建向导（选账号 → 选会话，可按客户/标签/人群包收窄 → N 条内容 + `{客户名}`/`{号码}` 预览 → 间隔与演练开关 → 上限就地拦）、任务详情（明细翻页 + 单条重发入口 + 勾选「撤回已发」）。
- 主进程 → 渲染层新开一条 `batch:state` 通道（载荷 = `taskId` + `status` + 三计数），**不**挂进 `msg:state`：那条是桥的"最后已知值"，任务生命周期与它不是同一个东西。页面重进一律走 GET 兜底，事件只是加速器。

## 8. 错误码与状态语义

| 出现处 | 语义 |
|---|---|
| `BRIDGE_OFFLINE` | 桥不在（账号未在线 / mount 未 ready）：计一次失败，账号熔断优先于重试 |
| `CHAT_NOT_FOUND` | 会话不可寻址：明细 `failed`，同收件人其余内容照常跑（不牵连） |
| `SEND_FAILED` | 页内发送异常：明细 `failed + error_detail` |
| `TIMEOUT` | 回执超时：明细 `unknown`（**不是** failed，因为可能已发出去） |
| `dryrun:<detailId>` | 演练产物的 `msg_key` 前缀，一眼可辨；撤回资格判据天然把它挡在外面（`dry_run=0` 那一项） |

## 9. 验收腿分工（写在这里，避免事后追认）

- **我侧（无需用户在场）**：Java 单测（展开与 `total_count` 自检、上限逐条、两个变量的兜底、未识别花括号原样、状态迁移合法性、租户闸）；`:8180` 契约驱动（创建/列表/明细分页/start-pause-resume-cancel/reports 刷计数/retry-failed 不误复位 `unknown`/recall 筛资格/陈旧心跳 reconcile）；主进程 JS 单测（队列串行与账号并行、假 clock 下间隔落区间、连续 3 条熔断只停一个账号、per-view 锁不交错、演练出料口不改状态机形状、积压重报与溢出计数）；CDP 演练腿（真建一个 20 条演练任务跑完，读进度/暂停/继续/取消）；`pnpm run typecheck`（node / web / inject / unit 四路）+ 改动文件 `pnpm exec eslint --quiet`。
- **用户在场（各一次）**：放行 **1 条真发**到指定会话；放行 **1 次真撤回**（撤掉刚发那条）；顺带看撤回超窗那一格的失败形状。
- 后一档没跑完，验收文档里真发与真撤回两格只写"待实测"，不写"已验证"。

## 10. 第一版不做

- Telegram 群发（TG 发送链尚未交付；`platform` 列留位，创建时只认 `whatsapp`）。
- 媒体、按钮消息、任何非纯文本内容。
- 陌生号直发（`createChat: true` 使其技术上可达，但发错人不可回收；收件人锁死在已采会话）。
- 定时/周期发送（何时开始只有"人工点 start"一种）。
- 跨设备任务续跑（引擎与账号视图同宿主，本机跑）。

## 11. 待验证（动手后回来补，不许提前定论）

1. `deleteMessage` 第四位在真机上是否真的走到"对所有人撤回"（docs 说 `revoke`，实测只信一次）。
2. 撤回超出 WhatsApp 时间窗时的失败形状（用于补分类正则）。
3. `sendText` 加 per-view 锁后，回复框在高密度群发下的最坏等待是否可接受（不可接受就改成"群发期间回复框提示等待"，而不是拆锁）。
4. 演练任务的耗时形状（`模拟耗时` 取多少才不让人误以为真发完了）——只影响观感，先取 200 ms。
