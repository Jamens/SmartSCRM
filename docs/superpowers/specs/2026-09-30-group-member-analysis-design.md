# P8 / B6 群成员分析设计（group-member-analysis）

**日期** 2026-09-30 · **清单** B6（`docs/feature-checklist.md:34`，标「P8」）
**目标**：把"账号在哪些群里 / 每个群里有哪些人 / 谁在什么时候被谁加进来或踢出去"变成库里的持久事实，提供群名单、成员名单、进退流水三块可读面与一份 14 列 XLSX 导出，并把成员状态表定成后续群运营阶段可直接依赖的契约。
**范围**：采集与建档第一版只做 WhatsApp；Telegram 的表结构、接口分派与页面空态现在就含，采集实现排到 Telegram 采集链之后（§14）。客户域的"批量建客户/打标"不在本期（§14）。

## 0. 约束与红线

- 本地 MySQL（`smartscrm_react`）+ Java 后端是唯一数据层；迁移只新增（`V12`），不改已发布迁移。
- 所有业务行按 `tenant_id` 隔离；平台 id 列（`chat_key` / `member_key` / `dedup_key`）沿用 V8 的 `utf8mb4_bin` 二进制排序，显示文本列留人类排序。
- 页内能力只在桥那一侧，桥只说得出"我看见了什么"，说不出"我属于哪个账号"；账号归属由主进程盖章（沿用既有口径，不削弱）。
- **群成员采集是只读动作**：不发消息、不改页面状态、不点任何会话。它需要的用户动作只有"账号视图已挂载且已登录"。
- 状态判定不许用本地猜测补实：`latest_leave_at` 在没有事件证据时保持 NULL，`first_seen_at` 永远不等于进群时间（§3）。
- 验证分档：后端 HTTP 契约 / `node:test` 纯函数 / 渲染层 CDP / 真实登录档。后一档没跑完就不写"已验证"。
- 本文只描述本项目的规则，不与其他实现比较。

## 1. 现在有什么（设计前提，读码所得）

| 事实 | 位置 |
|---|---|
| 群的两个既有痕迹：会话头 `is_group`、消息行 `sender_key` / `sender_name`（群里"谁说的"） | `apps/server/.../db/migration/V8__chat_history.sql:19,44`；`apps/desktop/src/bridge/whatsapp/normalize.ts:104` |
| 群的判定只看键形态（`@g.us` / `-100` / `@group`），不猜标题 | `apps/desktop/src/shared/chatKeys.ts:9-11` |
| 群系统消息今天就入库，但 `gp2` 不在媒体映射表里，落 `media_type='unknown'`，**没有任何结构化识别** | `normalize.ts:15-31` |
| 桥的命令与帧都是带 `kind` 的可辨识联合，命令下行 / 帧上行各一条面 | `apps/desktop/src/shared/chatTypes.ts:127-148` |
| 采集上行汇聚点、页内命令注册、桥挂载生命周期三件已就位 | `apps/desktop/src/main/services/msgBridge/{collectorHub,bridgeMount,index}.ts` |
| 每账号一条串行泵的形状（依赖注入 `api/dispatch/viewIdOf/sleep/now/log`，可跑假时钟单测） | `apps/desktop/src/main/services/batchSend/engine.ts:26-48` |
| 按号码认领客户的唯一现成规则：`ChatKeys.peerPhoneOf` + `normalizePhone` 后等值匹配 | `apps/server/.../service/MessageService.java:231-247`；`service/msg/ChatKeys.java:59,67,76` |
| 客户抽屉是单栏滚动表单 + 底部时间线，`components/ui` 里**没有** Tabs 原子件 | `apps/desktop/src/renderer/src/components/customers/CustomerDrawer.tsx:226` |
| wa-js 4.6.0 在册群能力：`getAllGroups` / `getParticipants` / `getPastParticipants` | `apps/desktop/node_modules/@wppconnect/wa-js/dist/group/functions/{getAllGroups,getParticipants,getPastParticipants}.d.ts` |
| `'group.participant_changed'` 事件载荷：`author / authorPushName / groupId / action(add\|remove\|demote\|promote\|leaver\|join) / operation / participants[]` | 同上 `dist/group/events/eventTypes.d.ts:16-60` |
| 该事件由 `wrapModuleFunction(updateDBForGroupAction)` 在 `onFullReady` 时包出来：`remove` 且 actor 在 participants 里 → `leave`；`add` 且 `isInvite \|\| reason==='invite'` → `join` | 读码 `dist/wppconnect-wa.js`（同包内单处出现，无第二发射点） |
| **`ParticipantModel` 只有 `id / isAdmin / isSuperAdmin`**（+ session 位 `stale/contact/hasSenderKey`），快照里没有任何进群时间 | `dist/whatsapp/models/ParticipantModel.d.ts:17-27` |

推论两条：① 进群时间的唯一来源是事件，快照给不出；② 在线事件只覆盖"页面在线并处理到那条 action"的时段，离线时段的变更永久缺失，必须靠快照 diff 兜。两条决定了本设计的核心形状：**快照定"谁在群里"，事件定"什么时候、被谁"**。

## 2. 范围裁定（八项，含代价）

| # | 裁定 | 代价 |
|---|---|---|
| 1 | `group_member_state` 是后续群运营阶段的**目标池契约**，不只是展示用 | 契约文字要写在文档里并被引用（§11）；P8 期间契约改动等于动别人地基 |
| 2 | 采集形态 = 账号上线全量建档 + 事件增量 + 进入群详情时补拉 | 多一条主进程泵与批次状态，比"纯手动"贵 2–3 个任务 |
| 3 | 判退口径 = **覆盖率闸 `0.6`**，且被推定退群的行 `latest_leave_at` 留 NULL | 连续两次截断的快照会一致地错，且界面看不出它错了（§6 陷阱 ②） |
| 4 | 事件两个来源都收：群系统消息解析 + `participant_changed` 在线事件 | 分类器两条腿、两套测试夹具 |
| 5 | 导出 **14 列 XLSX**，不含"地区" | 新增一个主进程依赖（§10）；没有地区数据来源，硬填只会造出一列空值 |
| 6 | 表结构、API 分派、页面空态现在就含 Telegram | Telegram 采集实现排在 Telegram 采集链之后（§14） |
| 7 | 宿主 = 客户详情抽屉里的「所在群」一节 + 群成员弹层 | 客户对不上的群在界面上不可浏览、不可手动建档（§9 后果） |
| 8 | 群本体新建 `chat_group` 表，不复用 `chat_conversation WHERE is_group=1` | 多一张表；换来"从没发过消息的群也在册"（§3） |

## 3. 数据模型（V12，三张表）

迁移文件 `apps/server/src/main/resources/db/migration/V12__group_member_analysis.sql`，末尾必须写回滚段。

**`chat_group` —— 群登记册**

```
id, tenant_id, account_id, platform VARCHAR(16) 'whatsapp|telegram',
chat_key VARCHAR(128) COLLATE utf8mb4_bin,
title VARCHAR(256) NULL,
participant_count INT NOT NULL DEFAULT 0   COMMENT '只被成功快照覆盖；覆盖率闸的分母',
last_snapshot_at DATETIME(3) NULL,
snapshot_count INT NOT NULL DEFAULT 0,
is_final TINYINT(1) NOT NULL DEFAULT 0     COMMENT '群已解散/账号已退出',
created_at, updated_at
UNIQUE uk_group (tenant_id, platform, account_id, chat_key)
KEY idx_group_list (tenant_id, account_id, last_snapshot_at)
FK → tenant, platform_account（与 V8 会话头同款 ON DELETE CASCADE）
```
为什么不复用会话头投影：`chat_conversation` 只被消息驱动，`getAllGroups` 能列出从没发过消息的群。少了这张表，群名单与它的下游目标池都会少一批人。

**`group_member_state` —— 状态快照（§11 契约的本体）**

```
id, tenant_id, account_id, platform, chat_key VARCHAR(128) utf8mb4_bin,
member_key VARCHAR(160) utf8mb4_bin       COMMENT 'WA: 8613...@c.us',
phone VARCHAR(32) NULL, display_name VARCHAR(128) NULL,
role_type VARCHAR(16) NOT NULL DEFAULT 'member' COMMENT 'member|admin|super',
is_in_group TINYINT(1) NOT NULL DEFAULT 1,
join_count INT NOT NULL DEFAULT 0,
latest_join_at DATETIME(3) NULL, latest_leave_at DATETIME(3) NULL,
exit_method VARCHAR(24) NULL COMMENT 'left|removed|snapshot_absent',
last_event_at DATETIME(3) NULL,
first_seen_at DATETIME(3) NOT NULL COMMENT '本应用第一次看见他，不是进群时间',
snapshot_seen_count INT NOT NULL DEFAULT 0 COMMENT '第几次成功快照里还看见他',
customer_id BIGINT NULL,
created_at, updated_at
UNIQUE uk_member (tenant_id, platform, account_id, chat_key, member_key)
KEY idx_member_group (tenant_id, account_id, chat_key, is_in_group)
KEY idx_member_phone (tenant_id, phone)
```
`latest_join_at` 与 `first_seen_at` 分列是硬要求：快照建档的人没有进群时间证据，把建档时刻写进 `latest_join_at` 就是造一条查不出来的假记录。`customer_id` 由 `phone` 走 §1 那条现成规则回填，读侧允许为空。

**`group_member_event` —— 进退流水**

```
id, tenant_id, account_id, platform, chat_key VARCHAR(128) utf8mb4_bin,
group_title VARCHAR(256) NULL,
member_key VARCHAR(160) utf8mb4_bin        COMMENT '目标人',
actor_key VARCHAR(160) utf8mb4_bin NULL, actor_name VARCHAR(128) NULL,
event_type VARCHAR(16) NOT NULL COMMENT 'added|joined|left|removed|promoted|demoted',
occurred_at DATETIME(3) NOT NULL,
source VARCHAR(16) NOT NULL COMMENT 'system_message|live_event',
dedup_key VARCHAR(160) utf8mb4_bin NOT NULL COMMENT '系统消息取 msgKey；在线事件取 actor|epochSec|action 合成',
raw_type VARCHAR(32) NULL, raw_subtype VARCHAR(48) NULL,
body_snapshot VARCHAR(512) NULL,
created_at
UNIQUE uk_event (tenant_id, platform, account_id, chat_key, dedup_key, event_type, member_key)
KEY idx_event_group (tenant_id, account_id, chat_key, occurred_at)
```
不设外键到 `chat_message`：事件行比消息行长寿，清理聊天记录不该删掉进退史。

## 4. 采集：桥的命令与帧

`BridgeCommand` 增两条（`chatTypes.ts:144-148` 那一支）：

```
| { kind: 'group_list'; reqId: string }
| { kind: 'group_snapshot'; reqId: string; chatKey: string }
```

`BridgeReport` 增两种帧（`:127-139` 那一支）：

```
| { kind: 'group_list_result'; reqId: string; ok: boolean;
    groups?: { chatKey: string; title: string | null }[]; error?: string }
| { kind: 'group_snapshot_result'; reqId: string; chatKey: string; ok: boolean;
    participants?: GroupParticipantWire[]; participantCount?: number;
    truncated?: boolean; error?: string }
| { kind: 'group_event'; events: GroupEventWire[] }
```
`GroupParticipantWire = { memberKey, phone, displayName, roleType }`；`GroupEventWire = { chatKey, memberKey, actorKey?, actorName?, eventType, occurredAtEpochSec, dedupKey, source, rawType?, rawSubtype?, bodySnapshot? }`。字段命名与序列化只在 `shared/` 定一处，两侧都从它取型（沿用 P6/P7 的 shared 纯模型口径）。

**快照的页内取值**：`WPP.group.getParticipants(chatKey)` 为主，`WPP.chat.get(chatKey).groupMetadata.participants` 为副，两者按 `memberKey` 取并集；两方都空则 `ok:false`，**绝不回一份空名单当作成功快照**（空名单会把整群人在闸前送进 `is_in_group=0`）。电话与显示名从 `WPP.contact` 侧补，取不到就留 NULL，不猜。

**在线事件订阅**：桥 `ready` 后挂 `WPP.on('group.participant_changed', …)`，`off()` 随卸载走（沿用既有"每一步都要容错，wa-js 的 off() 在热更新后可能抛"的处理，`bridge/index.ts:97`）。`action → event_type` 映射：`add→added`、`join→joined`、`remove→removed`、`leave→left`、`demote→demoted`、`promote→promoted`；`leaver` 按 `left` 收。

**系统消息解析**：`normalize` 旁路（不新增 `chat_message` 列，也不 ALTER V8）。命中群变动的系统消息时，除了原有的消息行，额外产一条 `group_event`。判定与目标取值要读 `raw.type / raw.subtype / raw.participantIds / raw.recipients`（后两者形态待实测，§15），只有命中"加人/减人"两族才产事件，群设置类变更（改名、描述、头像、消息模式）不进流水。
已知代价写清：桥早期版本没取 `subtype`，已经落库的历史消息行补不回事件；只有重跑补底才能把那批人的进退史填进来，重跑不重复消息行（`uk_msg` 幂等）。

## 5. 建档泵（主进程 `services/groupCollect/engine.ts`）

形状照抄 `batchSend/engine.ts` 的 `EngineDeps`：`api / dispatch / viewIdOf / sleep / now / log` 全注入，假时钟可测。

```
runBuildForAccount(accountId):
  list = await dispatch group_list                     // 失败则整轮放弃，记一条日志
  queue = list.groups 按 last_snapshot_at 升序（从没建过档的优先）
  截断到 MAX_GROUPS_PER_BUILD
  for chatKey of queue:                                // 每账号串行，不并发
     snapshot = await dispatch group_snapshot(chatKey) // SNAPSHOT_TIMEOUT_MS 超时
     ok  → POST /api/group-members/batch（一请求带 groups + snapshot）
     fail→ 重试 1 次，退避 RETRY_BACKOFF_MS；仍失败记 backfill_gap 同形的缺口帧，继续下一群
     await sleep(GROUP_GAP_MS)
```
常量（写进 shared，测试引用同一份）：`GROUP_GAP_MS = 600`、`SNAPSHOT_TIMEOUT_MS = 15_000`、`RETRY_BACKOFF_MS = 2_000`、`MAX_GROUPS_PER_BUILD = 200`。一轮跑不完剩下的留给下一轮（下次上线或手动点「刷新成员」），不做到点定时器。
三个触发点：桥 `ready` 后一轮建档；进入某群成员面时对该群一次；弹层「刷新成员」。事件帧不等泵，`collectorHub` 收到即批量 POST。
泵与发送链互斥不变：泵只做只读命令，永不进 `sendLock`（`msgBridge/sendLock.ts` 那条锁是发送用的，采集不冒充发送方）。

## 6. 后端 ingest 与 reconcile（`GroupMemberService`，同事务）

`POST /api/group-members/batch` 一次收 `groups[] + snapshot + events[]`，三步：

1. **群登记**：按 `uk_group` upsert `chat_group`（`title` 来就更新，`created_at` 不动）。
2. **事件先行**：逐条按 `uk_event` 插入并**同时**投影到状态：
   `added|joined` → `is_in_group=1`、`join_count+1`、`latest_join_at=occurred_at`；
   `left|removed` → `is_in_group=0`、`latest_leave_at=occurred_at`、`exit_method='left'|'removed'`；
   `promoted|demoted` 只动 `role_type`。
   命中 `uk_event` 冲突即整条跳过（不改 `join_count`）——重报不双计，这条要有单测。
3. **快照收口**：
```
prev = chat_group.participant_count
cur  = snapshot.participants.size
firstBuild = (prev == null || prev == 0)
coverage = firstBuild ? null : cur / prev
reconcileAllowed = firstBuild || coverage >= COVERAGE_MIN(0.6)
upsert 每个到场成员：命中 → is_in_group=1、role/name/phone 刷新、snapshot_seen_count+1
                     未命中 → 仅当 reconcileAllowed 才置 is_in_group=0、
                              exit_method='snapshot_absent'、latest_leave_at 保持 NULL
成功快照才写 participant_count = cur 与 last_snapshot_at；失败拉取永不覆盖分母
响应：{ reconciled, coverage, reason }，reason ∈ 'ok|first_build|coverage_too_low'
```
两个陷阱写进代码注释与 §13 的契约用例：① 分母只被成功快照覆盖；② 覆盖率闸只防单次截断误伤，连续两次都截断的快照会一致地错，本期不解决，只保证响应里 `coverage` 与 `reason` 可见（界面按 §9 把它标出来）。

## 7. 后端 API 面（前缀 `/api/group-members`，沿用现有 REST 约定）

| 端点 | 用途 |
|---|---|
| `POST /batch` | 采集入库（§6，主进程专用，带 `X-Device`/JWT 同现有消息面） |
| `GET /groups?accountId&page&size` | 群列表：`chat_group` + 在群人数 + 最近变动时间 |
| `GET /group/members?chatKey&isInGroup&role&q&page&size` | 成员名单（带 `coverage/reason` 快照新鲜度字段） |
| `GET /group/events?chatKey&eventType&page&size` | 进退流水 |
| `GET /customer/{customerId}/groups` | 按客户手机号反查其所在群（§9 的数据源） |
| `GET /group/members/export-rows?chatKeys` | 导出取数：14 列的行，顺序规则见 §10 |

`GET /groups` 与 `export-rows` 的"最近聊天时间 / 当日发言数 / 发言数"从 `chat_message` 聚合：按 `(chat_key, sender_key)` 取 `MAX(msg_time)`、`COUNT(*)`，以及 `MAX(msg_time)` **所在那一天**的当日条数（"当日"锚定该成员最近发言日，不是导出执行日——这条歧义在这里钉死）。租户闸与分页参数沿用现有查询面。

## 8. 错误与状态语义

| 处 | 值 | 界面口径 |
|---|---|---|
| 快照失败 | `ok:false, error` | 群行不显示"已建档"，弹层顶栏给"成员快照失败：<原因>" |
| `reason='coverage_too_low'` | `reconciled:false` | 成员表右上角标"本次快照人数较上次少 x%，未做退群判定" |
| `reason='first_build'` | `reconciled:true` | 正常显示，`first_seen_at` 列文案是"首次见到"，不是"进群时间" |
| `exit_method='snapshot_absent'` 且 `latest_leave_at IS NULL` | — | 退群时间列给"—"，退出方式给"快照中已不在" |
| `is_final=1` 的群 | — | 群行标"已解散/已退出"，泵跳过建档，流水仍读得到 |
| 非 WhatsApp 的群行，或 `snapshot_count=0` | — | 成员区给"该平台的成员采集尚未开通"，不显示空名单冒充结果 |

## 9. 渲染层：客户抽屉「所在群」+ 群成员弹层

- `components/ui` 补一个 `tabs.tsx` 原子件（现在 12 件里没有），或弹层用两个可切换的按钮组——取前者，因为后续报表阶段同样要 tab。
- `CustomerDrawer` 在 `CustomerTimeline` 之后新增一节「所在群」：`GET /customer/{id}/groups`，行给群名 / 在群人数 / 最近快照时间，行尾「查看群成员」。
- `GroupMembersDialog`：顶栏（刷新成员、导出所选、导出本群）+ 两个 tab（成员名单 / 进退流水）+ 筛选（在群、角色、关键词）。名单列：名称、手机号、角色、是否在群、进群时间、进群数、退群时间、退出方式、最近发言、发言数。流水列：时间、事件、目标人、操作人、来源。
- 数据层沿用现有 hooks 形状（`renderer/src/api/*` 一份、VO + 分页 hook 一份），群与成员的实时尾巴走既有广播面：`group_event` 入库后主进程广播一条 `group:state`，成员面开着就刷，没开着不刷。
- **本选择的直接后果**：客户匹配不上的群（陌生号群、从没消息的群）在界面上既不可浏览也不能手动建档，只能等账号上线的自动建档。群运营阶段需要选群面时自己开。

## 10. 导出（主进程，14 列 XLSX）

`group:export` IPC（渲染 → 主进程，参数只给 `chatKeys` 与租户已由 JWT 定死）→ 主进程拉 `export-rows` → 生成 XLSX → `dialog.showSaveDialog` → 落盘。渲染包不带编码库，大群不占渲染内存。
列序固定：`序号 / 群组名称 / 群Id / 手机号 / 名称 / 角色 / 是否在群 / 进群时间 / 进群数 / 退群时间 / 退出方式 / 最近聊天时间 / 当日发言数 / 发言数`。无"地区"列（没有数据来源，§2#5）。
**行序也钉死**：群按 `chatKeys` 传入顺序，群内按 `latest_join_at` 升序、`latest_join_at IS NULL` 的排到该群末尾并按 `first_seen_at` 升序；`序号` 是整份文件内的连续序号（跨群不重置）。一次导出不超过 50 个群（`chatKeys` 超出即 400，界面按所选数量提前拦住）。
新增依赖：`apps/desktop` 主进程侧 XLSX 编码库，选定 `exceljs`（MIT，纯 JS，无原生模块）。**待验证**：它必须只出现在主进程产物里，不得进渲染包（§15#4）。

## 11. 给后续群运营阶段的契约面

`group_member_state` + `chat_group` 是那份契约，本期内不提供任何"选群去操作"的界面（§2#7）。

**可依赖**：`uk_member` 唯一性；`is_in_group`；`role_type`；`latest_join_at`；`join_count`；`phone`；`customer_id`（可空）；`chat_group.participant_count` 与 `last_snapshot_at`；§7 的四个读端点契约。

**明确不许依赖**：
1. `latest_leave_at` —— 被快照推定退群的人恒为 NULL，非空只意味着"有事件证据"。
2. `first_seen_at` —— 它不是进群时间，任何"进群时间"的读法只能取 `latest_join_at` 并容忍为空。
3. **把 `state` 当"此刻真相"的任何读法**。快照只在拉取那一刻为真；要真相只能发起一次 `group_snapshot`，读 `state` 前必须先判 `last_snapshot_at` 的新鲜度。
4. `role_type` 的历史 —— 它是投影后的当前值，晋升/降级史只在 `group_member_event` 里。

契约改动（列改名、语义变化、判退口径调整）在本期交付后属破坏性改动，要连同本节一起改。

## 12. 文件面（新增为主）

| 侧 | 新增 / 修改 |
|---|---|
| DB | `V12__group_member_analysis.sql`（含回滚段） |
| Java | `entity/ChatGroup`、`GroupMemberState`、`GroupMemberEvent` + 三个 Mapper；`service/GroupMemberService`（ingest+reconcile）；`service/GroupMemberQueryService`；`web/GroupMemberController` |
| shared | `apps/desktop/src/shared/groupMembers.ts`（wire 类型、映射表、常量、纯函数：action→event_type、系统消息分类、coverage 计算） |
| 桥 | `bridge/whatsapp/groups.ts`（快照与事件订阅）；`bridge/index.ts` + `shared/chatTypes.ts`（命令与帧）；`normalize.ts` 旁路挂系统消息分类 |
| 主进程 | `services/groupCollect/{engine,collector,api}.ts`；`services/msgBridge/bridgeMount.ts` 挂建档触发点；`ipc` 注册 `group:export` 与 `group:state` 广播（与既有 `msg:state` 同一条扇出面）；`package.json` 加 `exceljs` |
| 渲染层 | `api/groupMembers.ts`、`components/ui/tabs.tsx`、`components/customers/CustomerGroupsSection.tsx`、`components/customers/GroupMembersDialog.tsx`、`CustomerDrawer.tsx` 挂节 |

## 13. 验收腿分工（写在这里，避免事后追认）

| 档 | 内容 | 判据 |
|---|---|---|
| Java 单测 | 覆盖率闸三档（首次/达标/不达标）、事件投影与重报不双计、`snapshot_absent` 不写退群时间、系统消息分类只认加减人、导出"当日"锚定最近发言日 | `./mvnw test` 全过（`apps/server`，JAVA_HOME=jdk-17） |
| JS 单测 | `action→event_type` 全映射、快照并集去重、两方皆空判失败、假时钟泵的截断与退避、coverage 计算 | `node --test`（不解析 `@shared/*`，用相对路径） |
| HTTP 契约 | 建档→判退→截断快照被闸拦住→事件重报→`/customer/{id}/groups`→`export-rows` 列序与值；每步走 `:8180`，**不用 mysql CLI** | 驱动脚本 exit 0；退出路径清干净 |
| CDP 腿 | 客户抽屉那一节渲染、弹层两个 tab、筛选、`coverage_too_low` 标注出现（用契约脚本造一次低覆盖） | 先 `tmp/p5c-top.ps1` 断言 `visibilityState==='visible'` |
| 真实登录档 | 一次真实建档跑通全链、一次真实进退群出事件行、一次真实导出落盘 | **用户在场放行**，不计入自动化腿 |

自动化腿一律不碰页面发送链，也不对真实群做任何写操作。

## 14. 本期不做

- Telegram 成员采集（结构与页面已含，实现排在 Telegram 采集链之后）。
- 陌生成员批量建客户 / 打标签 / 加人群包（客户域写入动作）。
- 群消息模式、群公告、邀请链接等群设置面（只收加减人）。
- 媒体与缩略图、成员头像。
- 到点自动重拉的定时器。
- 群运营阶段的选群界面（§11 只给表与读端点）。

## 15. 待验证（动手后回来补，不许提前定论）

1. `gp2` 系统消息的 `subtype` 真实取值名与目标人字段形态（`participantIds` / `recipients` / `participantIdObj`），要真机一条真实加减人行本。当前分类器实现按读码所得写，实测后如不符回来改 §4 与单测夹具。
2. `WPP.group.getAllGroups()` 的返回是否包含已退出群、归档群、社群（community）下的子群；决定 `is_final` 要不要在建档时就打标。
3. `getParticipants()` 对超大群（>1024 人）是否分页截断。**这条最危险**：截断 + 覆盖率闸会一致地误判退群（§6 陷阱 ②）。若确认会截断，泵必须对超大群放弃判退（`reconciled:false`），届时这是改口径，不是调参数。
4. `exceljs` 只进主进程产物、不进渲染包（构建产物实测）。
5. 事件时间戳的形态：`participant_changed` 不带时间，`occurred_at` 取到达时刻——离线重放或多台设备下可能与真实时间偏差，需实测偏差量级后决定是否在界面标注"时间为观测时刻"。
