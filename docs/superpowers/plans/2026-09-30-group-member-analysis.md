# P8 / B6 群成员分析 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「账号在哪些群里 / 每个群里有哪些人 / 谁在什么时候被谁加进来或踢出去」变成库里的事实，提供群名单、成员名单、进退流水三块读面与一份 14 列 XLSX 导出。

**Architecture:** 三段式。**页内**（桥）只回答「我看见了什么」：两条新命令 `group_list` / `group_snapshot`、三种新帧 `group_list_result` / `group_snapshot_result` / `group_event`。**主进程**盖章账号归属并做只读建档泵（上线全量、进群详情补拉、弹层手动刷新，无定时器），事件帧即时批量入库。**Java** 持全部状态判定：群登记 → 事件先行投影 → 快照收口 + 覆盖率闸，读面与导出取数都在后端。渲染层只有客户抽屉「所在群」一节与群成员弹层两处宿主。

**Tech Stack:** MySQL 8（本地 `smartscrm_react`）+ Flyway `V12`；Spring Boot 3 / Java 17 / MyBatis-Plus 注解 SQL；Electron 39 主进程 + preload IPC；wa-js 4.6.0 注入桥（esbuild bundle）；React 19 + @tanstack/react-query 5 + Tailwind 4 + radix-ui；exceljs（仅主进程）；`node --test`、JUnit 5 + Mockito。

**Spec:** `docs/superpowers/specs/2026-09-30-group-member-analysis-design.md`（本计划相对它的每一处偏离都记在下面的决策表里；冲突时以 spec 为准，spec 未覆盖处按下表裁定）

## Global Constraints

每一天的每一个任务都受这些约束管辖，逐字生效：

- **只连本地库** `smartscrm_react`（root / `1234560`）。**绝不碰 42 张表的 `smartscrm` 老库**。没有 mysql CLI、没有 Docker：表内容断言一律走 `:8180` 的 HTTP；**表形状**例外走 `tmp/*.java` 的 JDBC 探针（先例 `tmp/P6Tables.java`）。
- **只用 pnpm**，禁 npm / npx。后端只在 `apps/server` 用 `./mvnw`（绝不裸 `mvn`），命令前先 `export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18"`，shell 里 `set -o pipefail`；要 surefire 输出时不要加 `-q`。
- **构建 / 起服 / 打包前先停 :8180**：`powershell -NoProfile -ExecutionPolicy Bypass -File tmp/p7b-kill8180.ps1`（按 CommandLine 里的 `*smartscrm*` 杀，不按端口、不按进程名）。
- **采集是只读动作**。本计划没有任何一步发消息、改页面状态或点会话。页内能力只有 `getAllGroups` / `getParticipants` / `chat.get` / `contact.*` / 事件订阅。
- **真发 1 条 / 真撤回 1 次 / 真实进退群 / 真实导出落盘 = 用户在场并明确放行**，不进自动化腿。任何任务都不许按下发送或回车。
- **状态判定不许用本地猜测补实**：`latest_leave_at` 无事件证据时保持 NULL；`first_seen_at` 永远不是进群时间（spec §0、§3）。
- **证据词只有四个**：实测 / 读码 / 推断 / 待验证。断言必须能区分「生效了」与「什么都没做」，并归因「这个状态是谁写的」。条件轮询代替固定 sleep；清理覆盖每一条退出路径与每一个档位。
- `erasableSyntaxOnly: true`：进了 `apps/desktop/tsconfig.unit.json` 的文件（`src/shared/**`、`src/bridge/**`、`src/main/services/groupCollect/**`）**禁参数属性（TS1294）、禁 `enum`**。
- `node --test` 不解析 `@shared/*`：单测里的 import 用**相对路径 + `.ts` 后缀**。
- 四路 typecheck 必须全过：`pnpm run typecheck:node` / `:web` / `:inject` / `:unit`（从 `apps/desktop` 跑）。**全仓 lint 不是绿门**（`src` 里有 138 条既有 error + 格式化器自己会崩）：只按改动文件判 `pnpm exec eslint <file> --quiet`。
- `BridgeReport` / `BridgeCommand` 是带 `kind` 的可辨识联合，分别骑在既有的 `msg-report`（上行）与 `msg-cmd`（下行）两条通道上：**新增 `kind` 不需要改 IPC 白名单**（白名单在 `src/main/webContentsView/ipc.ts:23`，管的是通道名不是 kind）。
- 令牌只在主进程：`getSession()?.accessToken`，不进页、不进渲染层（C2）。页内来的一切文本进主进程日志前过 `oneLine()`（C3）。
- `tmp/` 与 `.superpowers/` 已 gitignore：驱动脚本**永不进提交**、`docs/notes/2026-09-22-legacy-feature-gap.md` 永不提交、`apps/desktop/tsconfig.node.tsbuildinfo` 永不暂存、禁 `git clean -fdx`。
- `D:\electron-client` 只读（Read/Grep，Bash 被封）；写进 `docs/` 的文档只陈述本项目规则，**不与旧版比较**。
- **Spring 后端的启动 / 重启 = 助手的活；Electron 主进程的重启 = 用户的手**（`pnpm dev` 的 watcher 永不重载 `src/main`，判新旧看 `:9223` 那个进程的实际启动时刻，不看文件 mtime）。出网 / 代理 / MySQL 启动 / 真实登录 / QR / 打开 WhatsApp 会话 / `git push` = 用户的手。
- **一个已验证功能一次提交**，前缀 `feat:` / `fix:` / `refa:` / `update:`，标题与正文之间空一行，任务与提交一一对应，由验证它的那一席提交。**助手不得 push、不得 amend、不得跳 hook。**

---

## 决策记录（写计划时定，执行期不许重新发明）

| # | 裁定 | 理由 | 代价 |
|---|---|---|---|
| R1 | `chat_group` 比 spec §3 多两列：`last_coverage DECIMAL(5,4) NULL`、`last_reconcile_reason VARCHAR(24) NULL` | spec §8 要界面显示「本次快照人数较上次少 x%」，但那份读数只在 POST 响应的 `coverage` 里存在过一次；用户单独打开弹层（没有刚 POST 过）时就没有来源了 | 多两列；reconcile 那条 SQL 多写两个赋值 |
| R2 | 群系统消息的**分类只在桥侧**做，不新增 `chat_message` 列、不改后端 | 库里 `media_type` 只有归一后的值：`gp2` 经 `mediaTypeOf` 落 `'unknown'`，字面量 `'gp2'` 永不出现在行里；`subtype` / `participantIds` 在库里根本不存在，事后无法回查（读码 `normalize.ts:15-31` + `V8__chat_history.sql`） | 桥早期版本落库的历史行补不回事件，只能重跑补底（`uk_msg` 幂等，重跑不重复行） |
| R3 | **不动** `MessageService.SKIPPED_TYPES`（`Set.of("gp2","e2e_notification","revoked")`） | 它比的是归一后的 `mediaType`，`gp2` 那一项今天打不中任何东西；删它或改它都会翻 P6 已验收的 `accepted/duplicated/rejected` 三个计数与 `reasons` 契约 | 那张表里留着一个语义上无效的常量；记在本表里当已知事实 |
| R4 | 群事件**不复用** `CollectorHub`，另立 `groupCollect/collector.ts` | `CollectorHub` 的 `BatchPayload.messages` 绑死 `NormalizedMessage`（`collectorHub.ts:8-14`），塞进别的载荷要动它的全部泛参与 P6 的三个已验收用例 | 多一份 ~90 行的攒批器；两者的边界常量各写一处 |
| R5 | 泵与页内的握手用 `deps.pull(viewId, cmd) → Promise<GroupWireResult \| null>`，不在 `engine.ts` 里碰 registry | 假时钟单测要能给「超时 / ok:false / 两方皆空」三种失败各造一次，直连 registry 就得连 IPC 一起造 | engine 与 host 之间多一层函数类型 |
| R6 | 快照请求的 `reqId` 由**泵**生成（`g<seq>` 自增），页内原样回带 | registry 的键必须是主进程侧唯一、且能在 `failView` 时按视图反查 | 页内不能自发这两类结果帧（本来也不该） |
| R7 | `msgBridge/index.ts` 导出 `setBridgeReadyHook(cb)`，由 `groupCollect/host.ts` 注册；import 方向只有 host → msgBridge | 泵要在桥 `ready` 后起一轮（spec §5 触发点 ①），而 msgBridge 反过来 import groupCollect 会成环；`BridgeMount` 现在只把 `ready` 交给自己的 `confirmReady` | msgBridge 多一条公开窄接口；hook 只有一个持有者，注册即覆盖 |
| R8 | 成员的 `phone`：优先 `WPP.contact` 的号码，取不到时按 `memberKey` 的本地段取（仅当 `@c.us` 且整段是数字） | wid 的本地段就是号码，这与后端已在用的 `ChatKeys.peerPhoneOfChatKey` 同源同形，不是猜测；完全不给 fallback 的话，没存进通讯录的成员整列空着，§9 的客户反查直接失效 | 「不猜」这条要在代码注释里写明依据；非 `@c.us`（如 `@lid`）一律 NULL |
| R9 | `displayName` 只取 contact 的 `name / shortName / notifyName`，群推名（`pushname`）不进 | wa-js 的 `ParticipantModel` 只有 `id / isAdmin / isSuperAdmin`（spec §1 最后一行），页内拿不到 participant 级显示名，硬造就会有一列假名 | 陌生号成员的名字列是 NULL |
| R10 | `COVERAGE_MIN = 0.6` **只写在 Java**（`GroupMemberService` 常量），shared 不复制 | 闸的判定发生在后端，JS 侧没有任何读者；两处各写一份就是把一个契约数字变成两份可各自漂移的字面量 | spec §5 把常量列在 shared 的清单里——shared 只放泵用的四个时间/条数常量（那是 JS 真有读者的） |
| R11 | `coverage` 的除法与阈值判定留在 Java，JS 单测那一腿改判 `mergeParticipants` 与 `classifyGroupSystemMessage` | 同 R10：§13 那格「coverage 计算（JS 单测）」的读者不存在；真正易碎的是快照并集与系统消息分类，两者都在 JS | spec §13 的 JS 腿少一项，Java 腿多两项对应断言 |
| R12 | `group_event` 帧**不**经 `BridgeMount.handle()` 消化，直接在 `handleBridgeReport` 里进批器 | `BridgeMount.handle` 只吃三种生命周期帧，其余返回 false（`bridgeMount.ts:114-129`）；事件不属于桥的生命周期 | `handleBridgeReport` 多一条分支（这本来就是它的路由职责） |
| R13 | 账号归属仍只在 `handleBridgeReport` 盖：`accountOfView(viewId)` 拿不到 entry 就整帧丢弃，包括三种新帧 | 桥说不出「我属于哪个账号」，这是 spec §0 的红线，不能因为新帧就从页内带 `accountId` | 无 |
| R14 | 事件行的 `occurred_at`：系统消息取 `raw.t`（秒），在线事件取**到达时刻** | `participant_changed` 载荷里没有时间的字段（spec §15#5）；用 `Date.now()` 要在 §15 记偏差待验证 | 界面标注文案留给 §8 的读侧，不改语义 |
| R15 | `dedup_key`：系统消息取 `msgKey`，在线事件取 `${actorKey}\|${epochSec}\|${action}` | 在线事件没有平台消息 id，只能用「谁、什么时候、干了什么」合成；`uk_event` 已含 `event_type` 与 `member_key`，合成键不再重复它们 | 同一秒同一 actor 对两个群做同一动作会撞键（`chat_key` 在 uk 里，所以其实不会）；测试要覆盖这一格 |
| R16 | `GET /groups`、`/group/members`、`/group/events`、`export-rows` **一律要求 `accountId`** | `uk_group` 与 `uk_member` 都含 `account_id`，同一个 `chat_key` 在两个账号下是两行；spec §7 的查询串少写了这一维，照抄就会跨账号串数据 | 渲染层每次读都要带着当前账号（本来就有） |
| R17 | `/customer/{id}/groups` 走 `group_member_state.customer_id`，不走 `chat_conversation.customer_id` | 契约的「这个人在哪些群里」定义在成员状态表；用会话头就只能看见发过言的群，正是 §2#8 建登记册要修的洞 | `customer_id` 为空（没匹配上客户）的成员不在反查结果里——这是 §9 已经承认的后果 |
| R18 | 泵**不进** `SendLock`；与发送链的互斥靠「只发只读命令」这一条事实，不靠锁 | `sendLock.ts` 那条锁管的是「同一视图同时只有一条在途发送」，采集不是发送方；进锁会让群建档把用户正在敲的回复排在 15s 超时后面 | 无（页内命令回路本身是同步分派，不排队） |
| R19 | 契约驱动的清理用 `tmp/P8Cleanup.java`（JDBC DELETE），只删驱动自造的 `12036399999999%`（群键）与 `86139999999%`（成员键）前缀 | 群面本期不提供 DELETE 端点（§14 没写，§7 也没有）；断言仍全部走 :8180，只有清理这一跳例外 | 有一条读码之外的写库通道，必须把它锁死在两个前缀上并在探针输出删了几行 |
| R20 | `participant_count`（分母）只由**成功**快照覆盖；失败拉取永不写它，也不写 `last_snapshot_at` | spec §6 陷阱 ① 的直接落实；一旦失败拉取能写分母，一次网络抖动就会把整群人在闸前推定成退群 | 「成功」的定义必须包含「两方皆空 ⇒ 不算成功」（Task 3 的页内判定 + Task 6 的入库判定两头都挡） |
| R21 | `is_final=1` 的群泵跳过、读面仍返回 | spec §8 那格的直译 | 泵的单测要专门有一例断言它「没拉」，而不是断言返回里没有它 |
| R22 | 导出取数走 `GET /group/members/export-rows?accountId&chatKeys`，**行序在后端**排；exceljs 只负责写字面量 | §10 的行序规则（群序 + 群内 `latest_join_at` 升序、NULL 沉底按 `first_seen_at` + 跨群连续序号）一旦在渲染层或主进程各排一遍就分叉；后端一份 `Comparator` 是唯一出处 | 主进程只做编码与落盘，测试面变小 |
| R23 | exceljs 进 `dependencies`（不是 devDependencies） | electron-vite 只把 `dependencies` 里的包当外部留在 `node_modules`；进 dev 就会被打进主进程 bundle，`out/` 里出现两份，§15#4 那条构建产物实测也就失去意义 | 打包体积（Task 12 要量一次实际大小并记档） |
| R24 | `@Select` 的返回类型（`GroupRowVO` / `GroupMemberRowVO` / `GroupEventRowVO` / `CustomerGroupVO` / Task 8 的 `GroupExportRowVO`）是 Lombok `@Data` 可变 POJO；只有服务层自己组装的出参（`MemberPageVO`、Task 5 的 `GroupBatchVO`）才是 record | MyBatis 对没有默认构造器的目标走**构造器自动映射、按列序不按列名**（仓库只开了 `map-underscore-to-camel-case`，`application.yml:19-21`，没开 `arg-name-based-constructor-auto-mapping`）。record 当行载体时，SELECT 清单一改顺序就按位置错填且全静默 | 读面少一点「record 更纯」的审美；这四个类的类注释要写明为什么可变，否则下一个端点会把 record 抄进来 |

---

## 文件结构

| 侧 | 文件 | 职责 | 任务 |
|---|---|---|---|
| DB | `apps/server/src/main/resources/db/migration/V12__group_member_analysis.sql` | 三张表 + 回滚段 | 1 |
| Java | `entity/ChatGroup.java` `entity/GroupMemberState.java` `entity/GroupMemberEvent.java` | 三行形状 | 1 |
| Java | `mapper/ChatGroupMapper.java` `mapper/GroupMemberStateMapper.java` `mapper/GroupMemberEventMapper.java` | upsert / INSERT IGNORE / NOT IN 收口 / 聚合 | 1 |
| Java | `service/GroupMemberService.java` + `service/msg/GroupRules.java` | ingest 三步 + 覆盖率闸 | 5, 6 |
| Java | `service/GroupMemberQueryService.java` | 四个读端点 + export-rows 取数与行序 | 7, 8 |
| Java | `web/GroupMemberController.java` `web/dto/*` `web/vo/*` | `/api/group-members` 六跳 | 5, 7, 8 |
| 探针 | `tmp/P8Tables.java` `tmp/P8Cleanup.java` | 表形状实测 / 退出路径清理（不进 git） | 1, 13 |
| shared | `apps/desktop/src/shared/groupMembers.ts` | wire 类型、action 映射、快照并集、系统消息分类、泵常量、导出列序 | 2, 3, 4 |
| shared | `apps/desktop/src/shared/chatTypes.ts` | `BridgeCommand` +2 kind、`BridgeReport` +3 kind | 3 |
| 桥 | `apps/desktop/src/bridge/types.ts` `bridge/whatsapp/groups.ts` `bridge/whatsapp/normalize.ts` `bridge/index.ts` | 群能力声明、快照/列表/事件订阅、命令分派 | 3, 4 |
| 主进程 | `services/groupCollect/{api,registry,collector,engine,host,export}.ts` | 六跳 HTTP、reqId 表、事件攒批、建档泵、装配 + IPC、XLSX | 9–12 |
| 主进程 | `services/msgBridge/index.ts`（改） | 三种新帧路由 + `setBridgeReadyHook` | 10, 11 |
| 主进程 | `main/ipc.ts` `preload/index.ts`（改） | `group:export` / `group:build` / `group:state` | 11, 12 |
| 渲染层 | `renderer/src/api/groupMembers.ts` `renderer/src/components/ui/tabs.tsx` `components/customers/{CustomerGroupsSection,GroupMembersDialog}.tsx` `CustomerDrawer.tsx`（改） | hooks、Tabs 原子件、两节界面 | 14, 15 |
| 驱动 | `tmp/p8a-group-contract.mjs` `tmp/p8c-ui.mjs` | HTTP 契约腿 / CDP 腿（不进 git） | 13, 16 |

---

## Task 1: V12 迁移 + 三实体 + 三 Mapper 原语

**Files:**
- Create: `apps/server/src/main/resources/db/migration/V12__group_member_analysis.sql`
- Create: `apps/server/src/main/java/com/smartscrm/server/entity/ChatGroup.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/entity/GroupMemberState.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/entity/GroupMemberEvent.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/mapper/ChatGroupMapper.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/mapper/GroupMemberStateMapper.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/mapper/GroupMemberEventMapper.java`
- Create（gitignored，不提交）: `tmp/P8Tables.java`

**Interfaces:**
- Produces（Task 5/6/7/8 全部依赖这一份形状）：
  - `ChatGroupMapper.upsertGroup(ChatGroup): int`、`selectByUk(Long, String, Long, String): ChatGroup`、`markSnapshotSuccess(Long, String, Long, String, int, LocalDateTime): int`、`markSnapshotRejected(Long tenantId, String chatKey, Long accountId, List<String> presentKeys): int`
  - `GroupMemberStateMapper.upsertFromEvent(GroupMemberState): int`、`upsertFromSnapshot(GroupMemberState): int`、`markAbsentBySnapshot(Long, Long, String, List<String>): int`、`countInGroup(Long, Long, String): int`
  - `GroupMemberEventMapper.insertIgnore(GroupMemberEvent): int`（1 = 新行，0 = 撞 `uk_event`）
  - 实体字段名与列名按 MyBatis-Plus 驼峰↔下划线自动映射，无 `@TableField` 改名（除 `GroupMemberState.unmatched` 一类入参字段本期不需要）

**技术要点**

- **键列一律 `COLLATE utf8mb4_bin`**（`chat_key` / `member_key` / `actor_key` / `dedup_key`），表默认 `utf8mb4_unicode_ci`。这是 V8 已经定下的分工：平台 id 的比较要二进制精确（`8613800000000@c.us` 与 `8613800000000@C.us` 是两个键），显示文本才用人类排序。**判别力**：`uk_*` 建在 `utf8mb4_unicode_ci` 上会静默把大小写不同的两键合成一个——探针里要用 `COLLATE=ascii_bin|utf8mb4_bin` 断言这四列，不能只断言列存在。
- **`first_seen_at NOT NULL` 与「谁写它」是这一任务唯一的陷阱**：ON DUPLICATE KEY UPDATE 里绝不能出现 `first_seen_at`，否则第二次快照会把「第一次看见他」的时间刷成本次。表默认给不了这个保护，只有赋值清单能给它。**归因**：`first_seen_at` 只由 INSERT 分支写，`latest_join_at` 只由事件投影写（Task 5），`is_in_group=0` 只由快照收口写（Task 6）——三者不能有任何一处重叠。
- **`markAbsentBySnapshot` 的 `NOT IN` 空列表会整群误判**：`presentKeys` 为空时 `member_key NOT IN ()` 是语法错误，而「一个都没写进去」与「全群判退」的差别就在这里。**实现要求**：这条 SQL 只在调用方保证 `presentKeys` 非空时可达，Mapper 里加 `@Param` 空集断言（空集抛 `IllegalArgumentException`），把「跳过」的决定放在 Task 6 服务层的覆盖率闸里，不放在这条 SQL 的默认分支里。
- **`ON DUPLICATE KEY UPDATE` 的赋值顺序**：`upsertHead` 那个坑（`ChatConversationMapper.java:17-25`：赋值列表从左到右求值，后面的赋值读到前面刚写的新值）在 `chat_group` 上同样成立——`last_snapshot_at`、`participant_count`、`snapshot_count` 三条赋值里没有任何一条读别人的新值，**所以这里安全**，但注释要写明这条检查做过，否则下一个改这行的人会重新怀疑。
- **回滚段必须写全**（`DROP TABLE IF EXISTS`，子表在前），沿用 V11 末尾的注释形态。Flyway 不会跑它，它是给下次「撤销这一版」的人看的唯一说明。
- **本任务的验证档次是「表形状」，不是「行为」**：Java 侧的行为断言从 Task 5 起才有落点，这里用 `tmp/P8Tables.java` 的 JDBC `information_schema` 查询实测列、索引、排序规则三样，比让 Spring 起来空跑一次强（读码所得：本仓库没有 Testcontainers，也没有嵌入式库，见 `BatchSendServiceTest` 类注释里那句「这一份**不**证明两条 SQL 真能匹配到预期的行数」）。

- [ ] **Step 1: 写迁移**

```sql
-- V12__group_member_analysis.sql
-- P8/B6 群成员分析：群登记册 + 成员状态快照 + 进退流水。
-- 设计脊柱：快照定「谁在群里」，事件定「什么时候、被谁」。ParticipantModel 没有进群时间，
-- 所以 latest_join_at 只由事件写；被快照推定退群的人 latest_leave_at 永远留 NULL。
CREATE TABLE `chat_group` (
    `id`                   BIGINT        NOT NULL AUTO_INCREMENT,
    `tenant_id`            BIGINT        NOT NULL,
    `account_id`           BIGINT        NOT NULL,
    `platform`             VARCHAR(16)   NOT NULL DEFAULT 'whatsapp' COMMENT 'whatsapp | telegram(留位，本期不放开采集)',
    `chat_key`             VARCHAR(128)  COLLATE utf8mb4_bin NOT NULL,
    `title`                VARCHAR(256)  NULL,
    `participant_count`    INT           NOT NULL DEFAULT 0 COMMENT '只被成功快照覆盖；覆盖率闸的分母',
    `last_snapshot_at`     DATETIME(3)   NULL,
    `snapshot_count`       INT           NOT NULL DEFAULT 0,
    `last_coverage`        DECIMAL(5,4)  NULL COMMENT '最近一次快照的 cur/prev；first_build 时 NULL（R1）',
    `last_reconcile_reason` VARCHAR(24)  NULL COMMENT 'ok|first_build|coverage_too_low',
    `is_final`             TINYINT(1)    NOT NULL DEFAULT 0 COMMENT '群已解散/账号已退出：泵跳过，流水仍读得到',
    `created_at`           DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`           DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_group` (`tenant_id`, `platform`, `account_id`, `chat_key`),
    KEY `idx_group_list` (`tenant_id`, `account_id`, `last_snapshot_at`),
    CONSTRAINT `fk_cg_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_cg_account` FOREIGN KEY (`account_id`) REFERENCES `platform_account` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='group registry';

CREATE TABLE `group_member_state` (
    `id`                  BIGINT        NOT NULL AUTO_INCREMENT,
    `tenant_id`           BIGINT        NOT NULL,
    `account_id`          BIGINT        NOT NULL,
    `platform`            VARCHAR(16)   NOT NULL DEFAULT 'whatsapp',
    `chat_key`            VARCHAR(128)  COLLATE utf8mb4_bin NOT NULL,
    `member_key`          VARCHAR(160)  COLLATE utf8mb4_bin NOT NULL COMMENT 'WA: 8613...@c.us',
    `phone`               VARCHAR(32)   NULL,
    `display_name`        VARCHAR(128)  NULL,
    `role_type`           VARCHAR(16)   NOT NULL DEFAULT 'member' COMMENT 'member|admin|super',
    `is_in_group`         TINYINT(1)    NOT NULL DEFAULT 1,
    `join_count`          INT           NOT NULL DEFAULT 0,
    `latest_join_at`      DATETIME(3)   NULL COMMENT '只由事件写；快照不碰（spec §3 硬要求）',
    `latest_leave_at`     DATETIME(3)   NULL COMMENT '只有事件证据才写；快照推定退群留 NULL（§11 不许依赖 1）',
    `exit_method`         VARCHAR(24)   NULL COMMENT 'left|removed|snapshot_absent',
    `last_event_at`       DATETIME(3)   NULL,
    `first_seen_at`       DATETIME(3)   NOT NULL COMMENT '本应用第一次看见他，不是进群时间；UPDATE 分支永不赋值',
    `snapshot_seen_count` INT           NOT NULL DEFAULT 0 COMMENT '第几次成功快照里还看见他',
    `customer_id`         BIGINT        NULL,
    `created_at`          DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`          DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_member` (`tenant_id`, `platform`, `account_id`, `chat_key`, `member_key`),
    KEY `idx_member_group` (`tenant_id`, `account_id`, `chat_key`, `is_in_group`),
    KEY `idx_member_phone` (`tenant_id`, `phone`),
    CONSTRAINT `fk_gms_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_gms_account` FOREIGN KEY (`account_id`) REFERENCES `platform_account` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='member state snapshot (P9 target-pool contract)';

CREATE TABLE `group_member_event` (
    `id`             BIGINT        NOT NULL AUTO_INCREMENT,
    `tenant_id`      BIGINT        NOT NULL,
    `account_id`     BIGINT        NOT NULL,
    `platform`       VARCHAR(16)   NOT NULL DEFAULT 'whatsapp',
    `chat_key`       VARCHAR(128)  COLLATE utf8mb4_bin NOT NULL,
    `group_title`    VARCHAR(256)  NULL,
    `member_key`     VARCHAR(160)  COLLATE utf8mb4_bin NOT NULL COMMENT '目标人',
    `actor_key`      VARCHAR(160)  COLLATE utf8mb4_bin NULL COMMENT '操作人，可空',
    `actor_name`     VARCHAR(128)  NULL,
    `event_type`     VARCHAR(16)   NOT NULL COMMENT 'added|joined|left|removed|promoted|demoted',
    `occurred_at`    DATETIME(3)   NOT NULL,
    `source`         VARCHAR(16)   NOT NULL COMMENT 'system_message|live_event',
    `dedup_key`      VARCHAR(160)  COLLATE utf8mb4_bin NOT NULL COMMENT '系统消息取 msgKey；在线事件取 actor|epochSec|action 合成',
    `raw_type`       VARCHAR(32)   NULL,
    `raw_subtype`    VARCHAR(48)   NULL,
    `body_snapshot`  VARCHAR(512)  NULL,
    `created_at`     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_event` (`tenant_id`, `platform`, `account_id`, `chat_key`, `dedup_key`, `event_type`, `member_key`),
    KEY `idx_event_group` (`tenant_id`, `account_id`, `chat_key`, `occurred_at`),
    CONSTRAINT `fk_gme_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_gme_account` FOREIGN KEY (`account_id`) REFERENCES `platform_account` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='join/leave stream';

-- 回滚：
--   DROP TABLE IF EXISTS `group_member_event`;
--   DROP TABLE IF EXISTS `group_member_state`;
--   DROP TABLE IF EXISTS `chat_group`;
```

- [ ] **Step 2: 三实体**（沿用 `ChatConversation` 的写法：`@Data` + `@TableName` + `@TableId(type = IdType.AUTO)`；不给可空字段加 `@TableField(update=...)`，因为本期没有「把列清空」的入参面）

```java
package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

/** 群登记册：`getAllGroups` 能列出从没发过消息的群，所以不复用 `chat_conversation` 投影（§2#8）。 */
@Data
@TableName("chat_group")
public class ChatGroup {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Long accountId;
    private String platform;
    private String chatKey;
    private String title;
    private Integer participantCount;
    private LocalDateTime lastSnapshotAt;
    private Integer snapshotCount;
    private java.math.BigDecimal lastCoverage;
    private String lastReconcileReason;
    private Integer isFinal;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
```

`GroupMemberState` 与 `GroupMemberEvent` 逐列同形（`isInGroup` / `joinCount` / `latestJoinAt` / `latestLeaveAt` / `exitMethod` / `lastEventAt` / `firstSeenAt` / `snapshotSeenCount` / `customerId`；事件侧 `groupTitle` / `memberKey` / `actorKey` / `actorName` / `eventType` / `occurredAt` / `source` / `dedupKey` / `rawType` / `rawSubtype` / `bodySnapshot`，且**没有 `updated_at`** —— 流水只追加）。

- [ ] **Step 3: 三 Mapper 原语**

```java
package com.smartscrm.server.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.smartscrm.server.entity.ChatGroup;
import java.time.LocalDateTime;
import java.util.List;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

public interface ChatGroupMapper extends BaseMapper<ChatGroup> {

    /**
     * 群登记：title 来就更新，created_at 不动。
     * 赋值清单里没有一条读到另一条刚写进去的值（对比 `ChatConversationMapper.upsertHead`
     * 那条必须靠顺序成立的守卫），所以这里的顺序是自由的——写下来是为了让改动的人重新检查一遍。
     */
    @Insert("INSERT INTO chat_group (tenant_id, account_id, platform, chat_key, title, participant_count,"
        + " last_snapshot_at, snapshot_count, is_final) VALUES (#{tenantId}, #{accountId}, #{platform},"
        + " #{chatKey}, #{title}, 0, NULL, 0, COALESCE(#{isFinal}, 0))"
        + " ON DUPLICATE KEY UPDATE title = COALESCE(VALUES(title), title)")
    int upsertGroup(ChatGroup group);

    @Select("SELECT * FROM chat_group WHERE tenant_id = #{tenantId} AND platform = #{platform}"
        + " AND account_id = #{accountId} AND chat_key = #{chatKey}")
    ChatGroup selectByUk(@Param("tenantId") Long tenantId, @Param("platform") String platform,
                         @Param("accountId") Long accountId, @Param("chatKey") String chatKey);

    /** 只有成功快照走这一跳：分母、时间戳、coverage 与 reason 一起写（R20）。 */
    @Update("UPDATE chat_group SET participant_count = #{count}, last_snapshot_at = #{at},"
        + " snapshot_count = snapshot_count + 1, last_coverage = #{coverage},"
        + " last_reconcile_reason = #{reason} WHERE tenant_id = #{tenantId} AND account_id = #{accountId}"
        + " AND platform = #{platform} AND chat_key = #{chatKey}")
    int markSnapshotSuccess(@Param("tenantId") Long tenantId, @Param("accountId") Long accountId,
        @Param("platform") String platform, @Param("chatKey") String chatKey, @Param("count") int count,
        @Param("at") LocalDateTime at, @Param("coverage") java.math.BigDecimal coverage,
        @Param("reason") String reason);

    /** 闸拦下时的记账：只写 coverage/reason，分母一个字节都不动（R20）。 */
    @Update("UPDATE chat_group SET last_coverage = #{coverage}, last_reconcile_reason = #{reason}"
        + " WHERE tenant_id = #{tenantId} AND account_id = #{accountId} AND platform = #{platform}"
        + " AND chat_key = #{chatKey}")
    int markSnapshotRejected(@Param("tenantId") Long tenantId, @Param("accountId") Long accountId,
        @Param("platform") String platform, @Param("chatKey") String chatKey,
        @Param("coverage") java.math.BigDecimal coverage, @Param("reason") String reason);
}
```

```java
public interface GroupMemberEventMapper extends BaseMapper<GroupMemberEvent> {

    /** 1 = 新行，0 = 撞 `uk_event`。投影只在返回 1 时做——这就是「重报不双计」的落实点。 */
    @Insert("INSERT IGNORE INTO group_member_event (tenant_id, account_id, platform, chat_key, group_title,"
        + " member_key, actor_key, actor_name, event_type, occurred_at, source, dedup_key, raw_type,"
        + " raw_subtype, body_snapshot) VALUES (#{tenantId}, #{accountId}, #{platform}, #{chatKey},"
        + " #{groupTitle}, #{memberKey}, #{actorKey}, #{actorName}, #{eventType}, #{occurredAt}, #{source},"
        + " #{dedupKey}, #{rawType}, #{rawSubtype}, #{bodySnapshot})")
    int insertIgnore(GroupMemberEvent event);
}
```

`GroupMemberStateMapper` 三条：`upsertFromEvent`（INSERT 带 `first_seen_at = #{firstSeenAt}`，UPDATE 分支按 `event_type` 分支写 `is_in_group` / `join_count = join_count + 1` / `latest_join_at` / `latest_leave_at` / `exit_method` / `role_type` / `last_event_at`，**不含 `first_seen_at`、不含 `snapshot_seen_count`**）、`upsertFromSnapshot`（UPDATE 分支写 `is_in_group = 1`、`role_type` / `display_name` / `phone` 刷新、`snapshot_seen_count = snapshot_seen_count + 1`，**不含 `latest_join_at`、不含 `latest_leave_at`**）、`markAbsentBySnapshot`（见 Step 4）。

- [ ] **Step 4: `markAbsentBySnapshot` 用 foreach 且拒绝空集**

```java
    /**
     * 快照收口：本群这一账号下、不在 presentKeys 里、当前仍在群的行推定退群。
     * `latest_leave_at` 一个都不写（§11 不许依赖 1）：没有事件证据的退群只有 `exit_method`。
     * <p>
     * 调用方必须保证 presentKeys 非空：空集会让 `NOT IN ()` 变成语法错误，而「全群判退」是这条
     * SQL 最坏的失效形状。所以这里用 `<script>` + foreach，并在服务层用覆盖率闸先把空集挡住
     * （`GroupMemberService.reconcile`，Task 6）。
     */
    @Update("<script>UPDATE group_member_state SET is_in_group = 0, exit_method = 'snapshot_absent',"
        + " updated_at = CURRENT_TIMESTAMP(3) WHERE tenant_id = #{tenantId} AND account_id = #{accountId}"
        + " AND platform = #{platform} AND chat_key = #{chatKey} AND is_in_group = 1"
        + " AND member_key NOT IN <foreach item='k' collection='presentKeys' open='(' separator=',' close=')'>#{k}</foreach>"
        + "</script>")
    int markAbsentBySnapshot(@Param("tenantId") Long tenantId, @Param("accountId") Long accountId,
        @Param("platform") String platform, @Param("chatKey") String chatKey,
        @Param("presentKeys") List<String> presentKeys);
```

- [ ] **Step 5: 构建 + 起服跑迁移，用 JDBC 探针实测表形状**

```bash
cd /d/SmartSCRM/apps/server && export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18" && set -o pipefail
powershell -NoProfile -ExecutionPolicy Bypass -File tmp/p7b-kill8180.ps1
./mvnw -DskipTests package 2>&1 | tail -20
```

`tmp/P8Tables.java`（不提交）按 `tmp/P6Tables.java` 的写法连 `smartscrm_react`，输出四件事：三张表各有多少列、四把唯一键的列序、`chat_key/member_key/actor_key/dedup_key` 的 `COLLATION_NAME`、`first_seen_at` 的 `IS_NULLABLE='NO'`。

```bash
java -cp "$HOME/.m2/repository/com/mysql/mysql-connector-j/9.1.0/mysql-connector-j-9.1.0.jar" tmp/P8Tables.java
```
期望：三表都在；`uk_event` 七列顺序逐字对得上；四列 COLLATION = `utf8mb4_bin`；`first_seen_at` NOT NULL。任何一项不符就是迁移没生效（Flyway 读的是 jar 里的资源，**package 之后没重跑 package 就不会有新迁移**——这是上一期踩过的归因错处，别把「库没变」当成「SQL 写错」）。

- [ ] **Step 6: 提交**

```bash
git add apps/server/src/main/resources/db/migration/V12__group_member_analysis.sql \
        apps/server/src/main/java/com/smartscrm/server/entity/ChatGroup.java \
        apps/server/src/main/java/com/smartscrm/server/entity/GroupMemberState.java \
        apps/server/src/main/java/com/smartscrm/server/entity/GroupMemberEvent.java \
        apps/server/src/main/java/com/smartscrm/server/mapper/ChatGroupMapper.java \
        apps/server/src/main/java/com/smartscrm/server/mapper/GroupMemberStateMapper.java \
        apps/server/src/main/java/com/smartscrm/server/mapper/GroupMemberEventMapper.java
git commit -m "$(cat <<'EOF'
feat(P8/群成员): V12 三表 + 实体与 Mapper 原语

快照定「谁在群里」、事件定「何时被谁」这条分工落在列级：latest_join_at 与 first_seen_at
分列、推定退群不写退群时间、分母只被成功快照覆盖。markAbsentBySnapshot 的空集守卫放在服务层，
Mapper 里把最坏形状写成注释。
EOF
)"
```

---

## Task 2: `shared/groupMembers.ts` 纯模型 + 第一组 JS 单测

**Files:**
- Create: `apps/desktop/src/shared/groupMembers.ts`
- Create: `apps/desktop/src/shared/groupMembers.test.ts`

**Interfaces:**
- Produces（Task 3/4/9/10/11/12/14 全部从这里取型）：
  - `GROUP_GAP_MS: 600`、`SNAPSHOT_TIMEOUT_MS: 15_000`、`RETRY_BACKOFF_MS: 2_000`、`MAX_GROUPS_PER_BUILD: 200`、`EXPORT_GROUP_MAX: 50`、`EVENT_BATCH_SIZE: 100`、`EVENT_BATCH_INTERVAL_MS: 2_000`、`EVENT_QUEUE_MAX: 5_000`、`MEMBER_KEY_MAX: 160`、`CHAT_KEY_MAX: 128`、`GROUP_BODY_MAX: 512`
  - `type GroupRoleType`、`type GroupEventType`、`type GroupEventSource`、`interface GroupParticipantWire`、`interface GroupEventWire`、`interface GroupListWire`
  - `groupEventTypeOfAction(action: string): GroupEventType | null`
  - `mergeParticipants(primary: GroupParticipantWire[], secondary: GroupParticipantWire[]): GroupParticipantWire[]`
  - `phoneOfMemberKey(memberKey: string): string | null`
  - `GROUP_EXPORT_COLUMNS: readonly string[]`（14 项，§10 逐字）
  - `type GroupWireResult = { kind: 'group_list_result'; … } | { kind: 'group_snapshot_result'; … }`

**技术要点**

- **这个文件是「两侧共用一份定义」的唯一落点**：`GroupParticipantWire` 的字段名必须与 Task 5 后端 `GroupSnapshotItemDTO` 的 record 组件名逐字一致（P6 的先例是 `NormalizedMessage` ↔ `MessageItemDTO`，主进程不做改名直传）。任何一侧改名都要在这一处同时改，别在对侧加适配层。
- **`groupEventTypeOfAction` 的表驱动写法是刻意的**：`wa-js` 把 `remove` 且 actor 在 participants 里改写为 `leave`，也把 `add` 且 `isInvite` 改写为 `join`（spec §1 那行读码结论），所以**七个入参都可能到**，`leaver` 按 `left` 收。用 `Record<string, GroupEventType>` 而不是 switch：Task 3 的桥与 Task 11 的泵都要读同一份，switch 会诱使第二个人再抄一遍。返回 `null` 表示「不认这个 action」，调用方必须丢弃而不是默认成 `added`——默认成任何一个都是往流水里造一条没发生的记录。
- **`mergeParticipants` 的并集方向要固定**：`primary`（`getParticipants`）赢，`secondary`（`chat.get().groupMetadata.participants`）只补 `primary` 里没有的 `memberKey`。反过来就会在两者都给同一个人但角色不一致时，把 wa-js 的直接读数换成 metadata 缓存读数。**判别力**：测试必须造「同一人 primary 是 admin、secondary 是 member」这一格，断言结果是 admin；只断言「并集长度」的用例对方向分叉完全不敏感。
- **`phoneOfMemberKey` 是 R8 的落点**：只在 `@c.us` 结尾且本地段全是数字时给号码，其余（`@g.us`、`@lid`、`@s.whatsapp.net` 之外的形态、空段）一律 `null`。这一条与后端 `ChatKeys.peerPhoneOfChatKey` 同形，注释里写明，防止被当成「新发明的一次猜测」。
- **`GROUP_EXPORT_COLUMNS` 放这里而不是放导出模块**：渲染层的表头、主进程写 xlsx 的表头、Task 13 契约驱动的列序断言要读同一份 14 项字面量。顺序即列序，所以这一份必须 `as const` 且**不许在下游 `.sort()`**。
- **`erasableSyntaxOnly`**：本文件进 `tsconfig.unit.json` 的 include（`src/shared/**/*.ts` 已在），所以禁 `enum`（用 union + 常量表）、禁参数属性。
- **本任务的档次是「实测」，跑法**：`node --test src/shared/groupMembers.test.ts` 直接跑；接线在 Task 9（与 `tsconfig.unit.json` 的 groupCollect 那几行一起改），这里只保证单文件跑得起来。

- [ ] **Step 1: 先写失败的测试**

```ts
// src/shared/groupMembers.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  GROUP_EXPORT_COLUMNS,
  groupEventTypeOfAction,
  mergeParticipants,
  phoneOfMemberKey
} from './groupMembers.ts'
import type { GroupParticipantWire } from './groupMembers.ts'

const p = (memberKey: string, roleType: 'member' | 'admin' | 'super' = 'member'): GroupParticipantWire =>
  ({ memberKey, phone: phoneOfMemberKey(memberKey), displayName: null, roleType })

test('action→event_type 七个入参全覆盖，未知一律 null', () => {
  assert.equal(groupEventTypeOfAction('add'), 'added')
  assert.equal(groupEventTypeOfAction('join'), 'joined')
  assert.equal(groupEventTypeOfAction('remove'), 'removed')
  assert.equal(groupEventTypeOfAction('leave'), 'left')
  assert.equal(groupEventTypeOfAction('leaver'), 'left')
  assert.equal(groupEventTypeOfAction('promote'), 'promoted')
  assert.equal(groupEventTypeOfAction('demote'), 'demoted')
  assert.equal(groupEventTypeOfAction('subject'), null)
  assert.equal(groupEventTypeOfAction(''), null)
})

test('快照并集：primary 在场且角色冲突时 primary 赢', () => {
  const merged = mergeParticipants([p('a@c.us', 'admin')], [p('a@c.us', 'member'), p('b@c.us')])
  assert.deepEqual(merged.map((x) => [x.memberKey, x.roleType]), [['a@c.us', 'admin'], ['b@c.us', 'member']])
})

test('快照并集不接受 undefined 元素，也不因为空数组而给出一份「成功的空名单」', () => {
  assert.deepEqual(mergeParticipants([], []), [])
  assert.deepEqual(mergeParticipants([undefined as unknown as GroupParticipantWire], [p('b@c.us')]), [p('b@c.us')])
})

test('phone 只在 @c.us 且本地段全数字时给（R8），其余留 NULL', () => {
  assert.equal(phoneOfMemberKey('8613800000000@c.us'), '8613800000000')
  assert.equal(phoneOfMemberKey('120363999999999999@g.us'), null)
  assert.equal(phoneOfMemberKey('abc123@c.us'), null)
  assert.equal(phoneOfMemberKey('2988776655443322@lid'), null)
})

test('导出 14 列：列数、列名与「无地区」一起钉住', () => {
  assert.equal(GROUP_EXPORT_COLUMNS.length, 14)
  assert.deepEqual(GROUP_EXPORT_COLUMNS.slice(0, 3), ['序号', '群组名称', '群Id'])
  assert.ok(!GROUP_EXPORT_COLUMNS.includes('地区'))
})
```

- [ ] **Step 2: 跑到红**

```bash
cd /d/SmartSCRM/apps/desktop && node --test src/shared/groupMembers.test.ts
```
期望：FAIL（`Cannot find module './groupMembers.ts'`）。**如果这一句直接通过或报的是别的错，说明测试根本没在判这条链，不要往下写实现。**

- [ ] **Step 3: 写 shared 模型**

```ts
// src/shared/groupMembers.ts
export const GROUP_GAP_MS = 600
export const SNAPSHOT_TIMEOUT_MS = 15_000
export const RETRY_BACKOFF_MS = 2_000
export const MAX_GROUPS_PER_BUILD = 200

/** 事件攒批的三条边界：与采集队列同一量级，但各自一份（R4）。 */
export const EVENT_BATCH_SIZE = 100
export const EVENT_BATCH_INTERVAL_MS = 2_000
export const EVENT_QUEUE_MAX = 5_000

/** `chat_key` 上是 128、`member_key`/`dedup_key` 上是 160（V12 的列宽）：超长的键整批 400，不是「这一条不收」。 */
export const CHAT_KEY_MAX = 128
export const MEMBER_KEY_MAX = 160
export const GROUP_BODY_MAX = 512

/** 一次导出不超过 50 个群（spec §10）：主进程与渲染层各拦一次，数字只写这一处。 */
export const EXPORT_GROUP_MAX = 50

export type GroupRoleType = 'member' | 'admin' | 'super'
export type GroupEventType = 'added' | 'joined' | 'left' | 'removed' | 'promoted' | 'demoted'
export type GroupEventSource = 'system_message' | 'live_event'

export interface GroupParticipantWire {
  memberKey: string
  phone: string | null
  displayName: string | null
  roleType: GroupRoleType
}

export interface GroupListWire {
  chatKey: string
  title: string | null
}

export interface GroupEventWire {
  chatKey: string
  memberKey: string
  actorKey?: string
  actorName?: string
  eventType: GroupEventType
  occurredAtEpochSec: number
  dedupKey: string
  source: GroupEventSource
  rawType?: string
  rawSubtype?: string
  bodySnapshot?: string
}

/**
 * wa-js 的 `group.participant_changed.action` 七个都可能到：它自己在 `updateDBForGroupAction` 里
 * 会把 `remove`+actor 在 participants 里改写成 `leave`、把 `add`+invite 改写成 `join`（spec §1）。
 * 表驱动而不是 switch：桥（Task 3）与泵（Task 11）要读同一份，第二份写法迟早漂移。
 * `null` = 不认。调用方必须丢弃，不许默认成任何一支——默认就是造一条没发生的记录。
 */
const ACTION_TO_EVENT: Record<string, GroupEventType> = {
  add: 'added',
  join: 'joined',
  remove: 'removed',
  leave: 'left',
  leaver: 'left',
  promote: 'promoted',
  demote: 'demoted'
}

export function groupEventTypeOfAction(action: string): GroupEventType | null {
  return ACTION_TO_EVENT[action] ?? null
}

/**
 * 快照 = `getParticipants()` ∪ `chat.get().groupMetadata.participants`，按 memberKey 去重。
 * primary 赢：metadata 那份是页面缓存，角色与在场状态都可能旧一帧。
 */
export function mergeParticipants(
  primary: GroupParticipantWire[],
  secondary: GroupParticipantWire[]
): GroupParticipantWire[] {
  const out: GroupParticipantWire[] = []
  const seen = new Set<string>()
  for (const list of [primary, secondary]) {
    for (const item of list ?? []) {
      if (!item || typeof item.memberKey !== 'string' || item.memberKey.length === 0) continue
      if (seen.has(item.memberKey)) continue
      seen.add(item.memberKey)
      out.push(item)
    }
  }
  return out
}

/**
 * R8：wid 的本地段就是号码，与后端 `ChatKeys.peerPhoneOfChatKey` 同源同形，不是又一次猜测。
 * `@g.us`（群）、`@lid`（隐私号）、非纯数字本地段一律不给——宁可为 NULL，不造一个匹配错客户的号码。
 */
export function phoneOfMemberKey(memberKey: string): string | null {
  if (!memberKey.endsWith('@c.us')) return null
  const local = memberKey.slice(0, -'@c.us'.length)
  return /^\d{5,}$/.test(local) ? local : null
}

/** 行序规则在后端（R22），这里只固定「列有哪 14 个、按什么顺序」。 */
export const GROUP_EXPORT_COLUMNS = [
  '序号', '群组名称', '群Id', '手机号', '名称', '角色', '是否在群', '进群时间', '进群数',
  '退群时间', '退出方式', '最近聊天时间', '当日发言数', '发言数'
] as const
```

- [ ] **Step 4: 跑到绿并 typecheck**

```bash
cd /d/SmartSCRM/apps/desktop && node --test src/shared/groupMembers.test.ts && pnpm run typecheck:unit
```
期望：`pass 5`、`fail 0`；typecheck 无输出。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/shared/groupMembers.ts apps/desktop/src/shared/groupMembers.test.ts
git commit -m "$(cat <<'EOF'
feat(P8/群成员): shared 纯模型与第一组单测

action→event_type 表驱动、快照并集 primary 赢、号码只从 @c.us 本地段来、14 列列序一份写法。
coverage 的除法不放这里（R10/R11）：JS 侧没有读者，放两份就是两个可各自漂移的阈值。
EOF
)"
```

---

## Task 3: 桥的群能力（命令、快照、列表、在线事件）

**Files:**
- Modify: `apps/desktop/src/shared/chatTypes.ts:126-148`（`BridgeReport` +3 支、`BridgeCommand` +2 支）
- Modify: `apps/desktop/src/bridge/types.ts:84-109`（`WppChatApi.get`、`WppLike.group/contact`、`group.participant_changed` 重载、`WaParticipantLike`/`WaContactLike`/`WaGroupMetaLike`、`WaMsgModel` 补 `subtype/participantIds/recipients/participantIdObj`）
- Create: `apps/desktop/src/bridge/whatsapp/groups.ts`
- Modify: `apps/desktop/src/bridge/index.ts:52-85`（两个命令 case + `startLiveCollect` 之外的事件订阅接线）
- Create: `apps/desktop/src/bridge/whatsapp/groups.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `GroupParticipantWire` / `GroupEventWire` / `GroupListWire` / `groupEventTypeOfAction` / `mergeParticipants` / `phoneOfMemberKey` / `CHAT_KEY_MAX` / `MEMBER_KEY_MAX`
- Produces:
  - `runGroupList(reqId: string, ctx: CollectCtx): Promise<void>` — 一定发一帧 `group_list_result`（成功或失败），不发就是让主进程白等 15s
  - `runGroupSnapshot(reqId: string, chatKey: string, ctx: CollectCtx): Promise<void>` — 同上，发 `group_snapshot_result`
  - `watchGroupEvents(ctx: CollectCtx): () => void` — 返回解绑函数，`destroy()` 里逐个 `try/catch` 调
  - `participantToWire(p: WaParticipantLike): GroupParticipantWire | null`
  - `eventsFromParticipantChanged(payload, nowSec: number): GroupEventWire[]`（导出只为可测）

**技术要点**

- **两方皆空 = `ok:false`，绝不回一份空名单当成功快照**（spec §4 的硬要求，也是 R20 的第一道闸）。失效形状很具体：`getParticipants` 抛、`chat.get` 给 undefined、metadata 还没到位——三者同时发生时并集是空数组，如果按「拿到结果」上报，主进程就会把「一个都没采到」当成「全群都不在」，整群人在覆盖率闸上算出 `0/prev` 被拦住（幸好），但 `prev` 若也是 0 就是 `first_build`，直接建出一个空档群。所以判据是**名单为空即失败**，与抛不抛无关。
- **不做逐人 contact 查询**。wa-js 的 `ParticipantModel` 只有 `id / isAdmin / isSuperAdmin`（spec §1），而 500 人的群打 500 次 `contact.get` 就是把页面主线程钉住几百个异步往返——`runBackfill` 那条会话间隔 200ms 的顾虑在这里同样成立。**取值顺序**：`p.contact?.number / name / shortName`（如果 wa-js 顺手带上了就吃，带上就带上，不额外查）→ `phoneOfMemberKey` 兜号码 → 都取不到留 NULL。这条写进注释，防止后人「顺手补全」成一个 N 次查询的实现。
- **绝不 `{ ...raw }` 复制 participant 或 msg 对象**：wa-js 4.6.0 把字段挂原型做 getter，展开体全是 undefined（2026-09-22 实测 nulls=200/200，见 `normalize.ts:67-72`）。这条对 `groupMetadata.participants` 同样成立，而它比消息更容易中招——metadata 是页内缓存对象，看起来「就是个普通对象」。
- **`truncated` 本期不填**（wire 里保留可选字段）。我们没有任何可靠依据判「被截断」：`getParticipants` 的返回长度不是截断信号（§15#3 待实测）。填一个猜的值会让 Task 6 的覆盖率闸把它当成事实来源。**取证方式**：泵每轮结束打一行 `snapshot chatKey=… count=…`（Task 11），§15#3 的实测从这行读数来；量出来是 `512` / `1024` 这类整齐边界时，才回来把 `truncated` 填上并给泵加「超大群放弃判退」。
- **`dedup_key` 的合成键必须含 `action`**（R15）：`uk_event` 已经含 `event_type`，但一次 `add` 事件的 `author` 与秒值在同一秒里可能对同一目标产生两次不同 action 的推送；少了 `action` 就会把第二条真事件当重复丢掉。反过来说，同一秒同一 actor 对**两个不同群**做同一动作不会撞键——`chat_key` 在 `uk_event` 里（测试要有这一格，它是 §15 之外唯一能证「合成键够用」的地方）。
- **命令分派不 `await`**（与 `send`/`recall` 同一处理由，`bridge/index.ts:73-83`）：命令回路是同步的，await 会让后面的 `ping` 排在这条快照后面，心跳超时会被一次 15s 的快照挤掉。异步结果靠 `reqId` 回带。
- **每一支失败都要真发一帧**：`runGroupSnapshot` 内部的 catch 必须发 `ok:false, error:…` 而不是让 Promise reject——主进程 registry 那一头只有 settle 与 15s 超时两条路，静默 reject 会把「页内报错」这个最有用信息降级成「超时」。
- **本任务的验证档次**：`node --test src/bridge/whatsapp/groups.test.ts`（假 `WppLike` + `setSink` 收集帧，同 `bridge/index.test.ts:26` 的用法）= 实测；页内 wa-js 的真实返回形状 = 待验证（§15#2/#3），不许在这一档写「已验证」。

- [ ] **Step 1: 先写失败的测试**

```ts
// src/bridge/whatsapp/groups.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { eventsFromParticipantChanged, participantToWire } from './whatsapp/groups.ts'

test('participant → wire：角色由两个布尔决定，号码从 wid 本地段来', () => {
  assert.deepEqual(participantToWire({ id: { _serialized: '8613800000000@c.us' }, isAdmin: true }), {
    memberKey: '8613800000000@c.us', phone: '8613800000000', displayName: null, roleType: 'admin'
  })
  assert.equal(participantToWire({ id: { _serialized: '1203639999@group.us' } })?.phone, null)
  assert.equal(participantToWire({}), null)
  assert.equal(participantToWire(undefined), null)
})

test('participant → wire：super 优先于 admin，contact 上的 name 能吃但不查', () => {
  assert.equal(participantToWire({ id: { _serialized: '15@c.us' }, isAdmin: true, isSuperAdmin: true })?.roleType, 'super')
  assert.equal(
    participantToWire({ id: { _serialized: '15@c.us', }, contact: { name: '张三', number: '8615000000000' } })?.displayName,
    '张三'
  )
})

test('一次事件多目标：一帧一条，chatKey 从 groupId 来，未知 action 整条丢弃', () => {
  const evs = eventsFromParticipantChanged(
    {
      groupId: { _serialized: '1203631111@g.us' },
      author: { _serialized: '8613900000000@c.us' },
      authorPushName: '群主',
      action: 'add',
      participants: [{ _serialized: '8613800000001@c.us' }, { _serialized: '8613800000002@c.us' }, { _serialized: '999999999999999999@g.us' }]
    },
    1_760_000_000
  )
  assert.equal(evs.length, 3)
  assert.equal(evs[0].eventType, 'added')
  assert.equal(evs[0].chatKey, '1203631111@g.us')
  assert.equal(evs[0].actorKey, '8613900000000@c.us')
  assert.equal(evs[0].source, 'live_event')
  assert.equal(evs[0].dedupKey, '8613900000000@c.us|1760000000|add')
})

test('两个不同群的同一秒同一动作不共用 dedup_key（R15 的反面）', () => {
  const mk = (chatKey: string) => eventsFromParticipantChanged(
    { groupId: { _serialized: chatKey }, author: { _serialized: 'a@c.us' }, action: 'remove', participants: [{ _serialized: 'b@c.us' }] }, 1)
  const [x, y] = [mk('1@g.us'), mk('2@g.us')]
  assert.equal(x.length + y.length, 2)
  assert.notEqual(x[0].dedupKey, y[0].dedupKey)
  assert.notEqual(x[0].chatKey, y[0].chatKey)
})

test('没有 groupId / 没有 participants / 未知 action 都给空数组，不给假事件', () => {
  assert.deepEqual(eventsFromParticipantChanged({ author: { _serialized: 'a@c.us' }, action: 'add', participants: [{ _serialized: 'b@c.us' }] }, 1), [])
  assert.deepEqual(eventsFromParticipantChanged({ groupId: { _serialized: '1@g.us' }, action: 'add', participants: [] }, 1), [])
  assert.deepEqual(eventsFromParticipantChanged({ groupId: { _serialized: '1@g.us' }, action: 'subject', participants: [{ _serialized: 'b@c.us' }] }, 1), [])
})
```

```bash
cd /d/SmartSCRM/apps/desktop && node --test src/bridge/whatsapp/groups.test.ts
```
期望：FAIL（模块不存在）。

- [ ] **Step 2: shared 加两支命令与三种帧**

`chatTypes.ts` 顶部加 `import type { GroupEventWire, GroupListWire, GroupParticipantWire } from './groupMembers.ts'`，在 `BridgeReport` 的 `| { kind: 'logged_out' }` 之前插入：

```ts
  /**
   * 群能力三条帧。`group_*_result` 两支一定带 reqId：主进程那张 reqId→Promise 表只有靠它结清，
   * 少了 reqId 就只剩 15s 超时这一条路，而「页内报错」和「页内没答」是两件事。
   * `truncated` 本期由桥一律不给（Task 3 技术要点）：没有可靠依据填它的时候，空着比猜好。
   */
  | { kind: 'group_list_result'; reqId: string; ok: boolean; groups?: GroupListWire[]; error?: string }
  | {
      kind: 'group_snapshot_result'
      reqId: string
      chatKey: string
      ok: boolean
      participants?: GroupParticipantWire[]
      participantCount?: number
      truncated?: boolean
      error?: string
    }
  /**
   * 一帧多事件：一次「加 20 人」的系统消息 / 一条带 20 个 participants 的在线事件，
   * 拆成 20 帧就是 20 次 IPC 与 20 次归属盖章，而它们本来就属于同一个动作。
   */
  | { kind: 'group_event'; events: GroupEventWire[] }
```

在 `BridgeCommand` 的 `{ kind: 'open_chat'; chatKey: string }` 之后加：

```ts
  | { kind: 'group_list'; reqId: string }
  | { kind: 'group_snapshot'; reqId: string; chatKey: string }
```

- [ ] **Step 3: `bridge/types.ts` 的页内形状**

```ts
/** wa-js 的 ParticipantModel：只有 id/isAdmin/isSuperAdmin 是确定的，contact 属于「有就吃」。 */
export interface WaParticipantLike {
  id?: { _serialized?: string; user?: string; server?: string }
  isAdmin?: boolean
  isSuperAdmin?: boolean
  contact?: WaContactLike
}

export interface WaContactLike {
  number?: string
  name?: string
  shortName?: string
  pushname?: string
  notifyName?: string
  verifiedName?: string
}

export interface WaGroupMetaLike {
  id?: { _serialized?: string }
  /** 群名在 metadata 上是 `subject`，不是 `name`：取错字段就整列空标题。 */
  subject?: string
  title?: string
  participants?: WaParticipantLike[]
}

export interface WaParticipantChangedPayload {
  groupId?: string | { _serialized?: string }
  author?: string | { _serialized?: string }
  authorPushName?: string
  action?: string
  participants?: (string | { _serialized?: string })[]
}
```

`WppChatApi` 加一条（**可选**，页内没有 `chat.get` 时快照只能靠主源）：

```ts
  /** 快照的副来源：`groupMetadata.participants` 是页内缓存，角色可能旧一帧，所以只做并集的次要一侧。 */
  get?(chatId: string): Promise<{ id?: { _serialized?: string }; groupMetadata?: WaGroupMetaLike } | null>
```

`WppLike` 加两条与一个重载：

```ts
  group?: {
    getAllGroups(): Promise<WaGroupMetaLike[]>
    getParticipants(chatId: string): Promise<WaParticipantLike[]>
  }
  on(
    event: 'group.participant_changed',
    cb: (payload: WaParticipantChangedPayload) => void
  ): { off(): void }
```

`WaMsgModel` 补 Task 4 要读的四项（`subtype?: string`、`participantIds?: (string | WaWid)[]`、`participantIdObj?: WaWid`、`recipients?: (string | WaWid)[]`）——**只在类型上补，`normalize` 不读它们**，避免把系统消息的结构混进消息行的形状。

- [ ] **Step 4: `bridge/whatsapp/groups.ts`**

```ts
// src/bridge/whatsapp/groups.ts
import {
  CHAT_KEY_MAX,
  MEMBER_KEY_MAX,
  groupEventTypeOfAction,
  mergeParticipants,
  phoneOfMemberKey
} from '../../shared/groupMembers.ts'
import type { GroupEventWire, GroupParticipantWire } from '../../shared/groupMembers.ts'
import type { CollectCtx, WaGroupMetaLike, WaParticipantChangedPayload, WaParticipantLike, WppLike } from '../types.ts'

function wpp(): WppLike | null {
  return typeof window !== 'undefined' && window.WPP ? window.WPP : null
}

/** 字符串或 Wid 对象两处都吃（与 normalize 的 `widKeyOf` 同一判据：只吃一种就会整批判死）。 */
function keyOf(value: string | { _serialized?: string } | undefined): string | null {
  if (typeof value === 'string') return value.length > 0 && value.length <= CHAT_KEY_MAX ? value : null
  const s = value?._serialized
  return typeof s === 'string' && s.length > 0 && s.length <= CHAT_KEY_MAX ? s : null
}

export function participantToWire(p: WaParticipantLike | undefined | null): GroupParticipantWire | null {
  const memberKey = p?.id?._serialized
  // 群自己混在 participants 里时（wa-js 的 leaver 事件会带 @g.us 目标）也要有键，
  // 但成员键必须是 @c.us：一条 @g.us 的「成员」既没有号码也没有客户可匹配。
  if (!memberKey || memberKey.length > MEMBER_KEY_MAX) return null
  const roleType = p.isSuperAdmin === true ? 'super' : p.isAdmin === true ? 'admin' : 'member'
  // 取值顺序写死在这里：contact 有就吃，没有只从 wid 本地段取号码（R8），绝不为了补号码发查询。
  const number = p.contact?.number
  const phone = typeof number === 'string' && number.length > 0 ? number : phoneOfMemberKey(memberKey)
  const displayName = p.contact?.name ?? p.contact?.shortName ?? null
  return { memberKey, phone, displayName: displayName === '' ? null : displayName, roleType }
}

function toWires(list: WaParticipantLike[] | undefined): GroupParticipantWire[] {
  const out: GroupParticipantWire[] = []
  for (const p of list ?? []) {
    const wire = participantToWire(p)
    if (wire) out.push(wire)
  }
  return out
}

export async function runGroupList(reqId: string, ctx: CollectCtx): Promise<void> {
  const store = wpp()
  if (!store?.group) {
    ctx.emit({ kind: 'group_list_result', reqId, ok: false, error: 'WPP.group 不可用' })
    return
  }
  try {
    const rows = await store.group.getAllGroups()
    const groups = rows
      .map((g) => ({ chatKey: keyOf(g.id?._serialized), title: g.subject ?? g.title ?? null }))
      .filter((g): g is { chatKey: string; title: string | null } => g.chatKey !== null && isGroupKey(g.chatKey))
    ctx.emit({ kind: 'group_list_result', reqId, ok: true, groups })
  } catch (e) {
    ctx.emit({ kind: 'group_list_result', reqId, ok: false, error: e instanceof Error ? e.message : String(e) })
  }
}

/** 群键判定复用 shared 的那一条口径，不在这层重新发明 `endsWith('@g.us')`。 */
function isGroupKey(chatKey: string): boolean {
  return chatKey.endsWith('@g.us') || chatKey.endsWith('@group') || chatKey.includes('-100')
}

export async function runGroupSnapshot(reqId: string, chatKey: string, ctx: CollectCtx): Promise<void> {
  const store = wpp()
  if (!store?.group) {
    ctx.emit({ kind: 'group_snapshot_result', reqId, chatKey, ok: false, error: 'WPP.group 不可用' })
    return
  }
  let primary: GroupParticipantWire[] = []
  let secondary: GroupParticipantWire[] = []
  try {
    primary = toWires(await store.group.getParticipants(chatKey))
  } catch (e) {
    primary = []
    // 主源抛了要留下痕迹：只有这一行能把「名单为空」分成「群真的空」与「页内 API 变了」。
    consoleBridge(`getParticipants 抛 chatKey=${chatKey}`, e)
  }
  try {
    secondary = toWires(store.chat?.get ? (await store.chat.get(chatKey))?.groupMetadata?.participants : undefined)
  } catch {
    secondary = []
  }
  const participants = mergeParticipants(primary, secondary)
  // 两方皆空 ⇒ ok:false（spec §4）。这一行是 R20 的第一道闸：空名单一旦被当成成功快照，
  // 主进程就会把「一个都没采到」投给后端，而 first_build 那一档根本不会拦。
  if (participants.length === 0) {
    ctx.emit({ kind: 'group_snapshot_result', reqId, chatKey, ok: false, error: '快照名单为空（主/副两源）' })
    return
  }
  ctx.emit({
    kind: 'group_snapshot_result',
    reqId,
    chatKey,
    ok: true,
    participants,
    participantCount: participants.length
  })
}

/**
 * 桥里没有 console 的约束只在「不许进正文」那一条（C3）；这里打的是键与错误名。
 * 页内的 console 会进 DevTools，不进主进程日志，所以这一行只在真机腿看得见——留它是为了
 * §15#3 的取样（count= 那一行在泵侧，页内这一行是它的对照）。
 */
function consoleBridge(where: string, e: unknown): void {
  if (typeof console !== 'undefined') console.warn(`[bridge/group] ${where} err=${e instanceof Error ? e.name : String(e)}`)
}

export function eventsFromParticipantChanged(
  payload: WaParticipantChangedPayload,
  nowSec: number
): GroupEventWire[] {
  const chatKey = keyOf(payload.groupId)
  const action = payload.action ?? ''
  const eventType = groupEventTypeOfAction(action)
  const actorKey = keyOf(payload.author)
  if (!chatKey || !eventType || !Array.isArray(payload.participants) || payload.participants.length === 0) return []
  const dedupKey = `${actorKey ?? 'unknown'}|${nowSec}|${action}`
  const out: GroupEventWire[] = []
  for (const raw of payload.participants) {
    const memberKey = keyOf(raw)
    if (!memberKey) continue
    out.push({
      chatKey,
      memberKey,
      ...(actorKey ? { actorKey } : {}),
      ...(payload.authorPushName ? { actorName: payload.authorPushName } : {}),
      eventType,
      // R14：participant_changed 不带时间，这一列是观测时刻，不是事实发生时刻。
      occurredAtEpochSec: nowSec,
      dedupKey,
      source: 'live_event',
      rawType: 'group.participant_changed',
      rawSubtype: action
    })
  }
  return out
}

export function watchGroupEvents(ctx: CollectCtx): () => void {
  const store = wpp()
  if (!store) return () => undefined
  let sub: { off(): void } | null = null
  try {
    sub = store.on('group.participant_changed', (payload) => {
      const events = eventsFromParticipantChanged(payload, Math.floor(Date.now() / 1000))
      if (events.length > 0) ctx.emit({ kind: 'group_event', events })
    })
  } catch {
    sub = null
  }
  return () => {
    try {
      sub?.off()
    } catch {
      /* 页面已经把钩子拆了：与 bridge/index.ts 的 tryCall 同一处理 */
    }
  }
}
```

- [ ] **Step 5: `bridge/index.ts` 接两条命令与一条订阅**

`import * as groups from './whatsapp/groups.ts'`，在 `handle` 的 `case 'recall'` 之后加：

```ts
      case 'group_list':
        // 与 send/recall 同样不 await：命令回路是同步的，一次 getAllGroups 可能几百毫秒。
        void groups.runGroupList(cmd.reqId, { emit: push })
        return
      case 'group_snapshot':
        void groups.runGroupSnapshot(cmd.reqId, cmd.chatKey, { emit: push })
        return
```

在 `install()` 里 `const stopActiveWatch = impl.watchActiveChat({ emit: push })` 之后加一条订阅并把它的解绑函数交给 `destroy()` 管：

```ts
  // 群事件订阅不进 `COLLECT` 那张表：它只在 whatsapp 有意义，而 `platformOfAccountType` 那侧
  // 已经把非 WA 视图挡在挂载闸外（msgBridge/index.ts 的 mountOne）。TG 接的时候另立一条。
  const stopGroupWatch = groups.watchGroupEvents({ emit: push })
```

模块里加 `let groupRef: (() => void) | null = null`、`groupRef = stopGroupWatch`，并在 `destroy()` 的 `tryCall(activeRef)` 之后加 `tryCall(groupRef)`（**必须在 `pushRef?.cancel()` 之前**：与 collector/active 同一档，卸载后不许再有 `group_event` 出 IPC）。

- [ ] **Step 6: 全量校验 + 重建 bundle**

```bash
cd /d/SmartSCRM/apps/desktop
node --test src/bridge/whatsapp/groups.test.ts
pnpm run typecheck:node && pnpm run typecheck:web && pnpm run typecheck:inject && pnpm run typecheck:unit
pnpm run build:bridge
pnpm exec eslint src/shared/chatTypes.ts src/bridge/types.ts src/bridge/whatsapp/groups.ts src/bridge/index.ts src/bridge/whatsapp/groups.test.ts --quiet
```
期望：测试全绿（本任务的 `runGroupList`/`runGroupSnapshot` 无页内依赖的用例走假对象，测不到的一律标待验证）；四路 typecheck 静默；eslint 零 error。**`build:bridge` 必须跑**：桥是 bundle，不重建就是「源码新、产物旧」，真机腿会拿旧钩子当现状。

- [ ] **Step 7: 提交**

```bash
git add apps/desktop/src/shared/chatTypes.ts apps/desktop/src/bridge/types.ts \
        apps/desktop/src/bridge/whatsapp/groups.ts apps/desktop/src/bridge/whatsapp/groups.test.ts \
        apps/desktop/src/bridge/index.ts
git commit -m "$(cat <<'EOF'
feat(P8/群成员): 桥的群列表、快照并集与在线进退事件

两方皆空一律判失败：空名单一旦被当成成功快照，主进程就会把「一个都没采到」投给后端，
而 first_build 那一档拦不住它。truncated 本期不填，没有可靠依据时空着比猜好。
EOF
)"
```

---

## Task 4: 群系统消息分类旁路（第二事件源）

**Files:**
- Modify: `apps/desktop/src/shared/groupMembers.ts`（加 `classifyGroupSystemMessage` 与两张 subtype 表）
- Modify: `apps/desktop/src/shared/groupMembers.test.ts`（追加 6 条）
- Create: `apps/desktop/src/bridge/whatsapp/groupSystemMessage.ts`
- Create: `apps/desktop/src/bridge/whatsapp/groupSystemMessage.test.ts`
- Modify: `apps/desktop/src/bridge/whatsapp/collect.ts`（live 与 backfill 两条链各挂一次旁路）

**Interfaces:**
- Consumes: Task 3 的 `WaMsgModel.subtype/participantIds/recipients/participantIdObj`、`keyOf` 的两形态判据、Task 2 的 `GroupEventWire`
- Produces:
  - `classifyGroupSystemMessage(input: { type?: string; subtype?: string }): { eventType: GroupEventType; fromSubtype: true } | null`（shared，纯字符串判定）
  - `eventsFromSystemMessage(raw: WaMsgModel, msgKey: string, chatKey: string): GroupEventWire[]`（桥侧，取目标人）

**技术要点**

- **库里没有 `gp2`，只有 `unknown`**（R2 的核心事实，读码所得）：`mediaTypeOf('gp2')` 落 `'unknown'`，`chat_message.media_type` 里从来不会出现字面量 `gp2`，所以 `MessageService.SKIPPED_TYPES` 那一项今天打不中任何东西——**这条链必须在桥这一侧、归一化之前分类**。别去后端加 `WHERE media_type='gp2'`，那是查不到东西的谓词。
- **不动 `SKIPPED_TYPES`**（R3）：改它会翻 P6 已验收的 `accepted/duplicated/rejected` 与 `reasons` 契约。这一条要在注释里写明「为什么这里留着一个打不中的常量」，否则下一个读它的人会当成 bug 顺手删。
- **旁路不改消息行**：分类失败或命中「群设置类变更」时，`normalizeWa` 的结果原样进采集队列。系统消息**既是一条消息行、也可能是一条事件**，两件事各自成立；不要因为「这是系统消息」就 `return null` 少存一行——那是改 P6 的入库面。
- **只认加减人两族 + 角色两族**（spec §4）：`add / remove / leave / invite` 与 `promote / demote` 五族入事件，`subject / description / picture / announce / revoke_link / create / joined / left`(设置类) 一律不产事件。**歧义要在表里，不在 if 里**：写成两张 `Set`，`ADD_REMOVE_SUBTYPES` 与 `ROLE_SUBTYPES`，其余落 `null`。
- **目标人的三个可能字段按顺序试**：`participantIds`（数组，元素可为字符串或 Wid）→ `recipients`（同形）→ `participantIdObj`（单个 Wid）。**形态是待验证项**（§15#1）：真机一条真实加减人行本没取样前，代码只能按读码所得写；所以每个字段取到几个、取不到时留下 `body_snapshot`，都必须在测试里各占一格，且在 Task 16 的验收文档里把「三字段形态 = 待验证」原样带过去，不许提前定论。
- **`dedup_key` 取 `msgKey`**：同一条系统消息在 live 与 backfill 两条链里都会来一次（补底会重读历史），`uk_event` 含 `dedup_key`，取 `msgKey` 就天然幂等；换成时间合成键就会为每次重跑多一条假流水。测试要有「同一 msgKey 两次分类给出同一 dedupKey」这一格。
- **`body_snapshot` 截到 512 且过控制字符**：那是页内来的文本，`VARCHAR(512)` 超长不是「这一条不收」而是整批 400（`MSG_KEY_MAX` 同一条教训）。截断在桥侧做，不等后端报 400。
- **`occurred_at` 用 `raw.t`**：系统消息自带秒值，与在线事件的「到达时刻」不同源（R14），两者在流水里长得一样但含义不同——这一条要给 Task 15 的界面文案（`source` 列）用。

- [ ] **Step 1: 先写失败的测试**

```ts
// src/bridge/whatsapp/groupSystemMessage.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { eventsFromSystemMessage } from './groupSystemMessage.ts'
import { classifyGroupSystemMessage } from '../../shared/groupMembers.ts'

test('分类只认加减人与角色五族，设置类一律 null', () => {
  assert.equal(classifyGroupSystemMessage({ type: 'gp2', subtype: 'add' })?.eventType, 'added')
  assert.equal(classifyGroupSystemMessage({ type: 'gp2', subtype: 'remove' })?.eventType, 'removed')
  assert.equal(classifyGroupSystemMessage({ type: 'gp2', subtype: 'leave' })?.eventType, 'left')
  assert.equal(classifyGroupSystemMessage({ type: 'gp2', subtype: 'promote' })?.eventType, 'promoted')
  assert.equal(classifyGroupSystemMessage({ type: 'gp2', subtype: 'demote' })?.eventType, 'demoted')
  for (const s of ['subject', 'description', 'picture', 'announce', 'revoke_link', 'create']) {
    assert.equal(classifyGroupSystemMessage({ type: 'gp2', subtype: s }), null, s)
  }
  assert.equal(classifyGroupSystemMessage({ type: 'e23', subtype: 'add' }), null)
  assert.equal(classifyGroupSystemMessage({ type: 'chat', subtype: undefined }), null)
})

test('目标人三字段按序取：participantIds 优先，字符串与 Wid 两形态都吃', () => {
  const a = eventsFromSystemMessage({ subtype: 'add', participantIds: ['8613800000001@c.us', { _serialized: '8613800000002@c.us' }] }, 'XYZ_1@c.us', '111@g.us')
  assert.equal(a.length, 2)
  const b = eventsFromSystemMessage({ subtype: 'add', recipients: [{ _serialized: '8613800000003@c.us' }] }, 'XYZ_2', '111@g.us')
  assert.equal(b.length, 1)
  const c = eventsFromSystemMessage({ subtype: 'leave', participantIdObj: { _serialized: '8613800000004@c.us' } }, 'XYZ_3', '111@g.us')
  assert.equal(c[0].memberKey, '8613800000004@c.us')
  assert.equal(c[0].eventType, 'left')
})

test('同一 msgKey 两次分类给出同一 dedup_key（补底重跑不双计）', () => {
  const raw = { subtype: 'add', participantIds: ['8613800000001@c.us'] }
  assert.equal(eventsFromSystemMessage(raw, 'SAME_KEY', '111@g.us')[0].dedupKey, eventsFromSystemMessage(raw, 'SAME_KEY', '111@g.us')[0].dedupKey)
})

test('没有目标人字段就不产事件，但绝不吞掉消息行（旁路只加不改）', () => {
  assert.deepEqual(eventsFromSystemMessage({ subtype: 'add' }, 'K', '111@g.us'), [])
  assert.deepEqual(eventsFromSystemMessage({ subtype: 'subject', participantIds: ['8613800000001@c.us'] }, 'K', '111@g.us'), [])
})

test('body_snapshot 截到 512 且不留换行；source 与 raw_type 逐字', () => {
  const long = { subtype: 'add', participantIds: ['8613800000001@c.us'], body: 'x'.repeat(900) }
  const ev = eventsFromSystemMessage(long, 'K', '111@g.us')[0]
  assert.equal(ev.bodySnapshot?.length, 512)
  assert.equal(ev.source, 'system_message')
  assert.equal(ev.rawSubtype, 'add')
  assert.ok(ev.occurredAtEpochSec >= 0)
})

test('群键不成形就不产事件：chatKey 必须已在群里判定过的形态', () => {
  assert.deepEqual(eventsFromSystemMessage({ subtype: 'add', participantIds: ['8613800000001@c.us'] }, 'K', ''), [])
})
```

- [ ] **Step 2: 跑到红，再写 shared 判定**

```bash
cd /d/SmartSCRM/apps/desktop && node --test src/bridge/whatsapp/groupSystemMessage.test.ts
```

`shared/groupMembers.ts` 追加：

```ts
/**
 * 群系统消息的两族五类。R2：库里只有归一后的 `media_type='unknown'`，`gp2` 这个字面量只存在于
 * 页内 raw 上，所以分类只能在桥侧、归一化之前做。
 * R3：不因此去改后端 `MessageService.SKIPPED_TYPES`——那张表里 `"gp2"` 今天打不中任何东西
 * （它比的是归一值），删改都会翻 P6 已验收的三个计数与 reasons 契约。
 */
const SYSTEM_TYPE_BY_SUBTYPE: Record<string, GroupEventType> = {
  add: 'added',
  invite: 'added',
  remove: 'removed',
  leave: 'left',
  promote: 'promoted',
  demote: 'demoted'
}
/** `gp2` 是 WhatsApp 的「群变更」消息类型；`e23` 等其它系统类型本期不进流水。 */
const GROUP_SYSTEM_TYPES: ReadonlySet<string> = new Set(['gp2'])

export function classifyGroupSystemMessage(input: {
  type?: string
  subtype?: string
}): { eventType: GroupEventType } | null {
  if (!input.type || !GROUP_SYSTEM_TYPES.has(input.type)) return null
  const eventType = input.subtype ? SYSTEM_TYPE_BY_SUBTYPE[input.subtype] : undefined
  return eventType ? { eventType } : null
}
```

- [ ] **Step 3: 桥侧取目标人**

```ts
// src/bridge/whatsapp/groupSystemMessage.ts
import { GROUP_BODY_MAX, classifyGroupSystemMessage } from '../../shared/groupMembers.ts'
import type { GroupEventWire } from '../../shared/groupMembers.ts'
import type { WaMsgModel, WaWid } from '../types.ts'

/** 字符串或 Wid 都吃（与 normalize 的 `widKeyOf` 同一判据）。 */
function keyOf(value: string | WaWid | undefined): string | null {
  if (typeof value === 'string') return value.length > 0 ? value : null
  const s = value?._serialized
  return typeof s === 'string' && s.length > 0 ? s : null
}

function targetKeys(raw: WaMsgModel): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (v: string | WaWid | undefined): void => {
    const k = keyOf(v)
    // 成员键必须是 @c.us：把群自己或 @lid 记成「进退的成员」就是造一条查不出的假流水。
    if (!k || !k.endsWith('@c.us') || seen.has(k)) return
    seen.add(k)
    out.push(k)
  }
  // 顺序 = 可信度：participantIds 是 wa-js 给的结构化目标，recipients 是次选，participantIdObj 只有一条。
  // 三字段的真实形态还没在真机取过样（spec §15#1），所以这里只按读码所得排，取样后回来定序。
  for (const item of raw.participantIds ?? []) push(item)
  if (out.length === 0) for (const item of raw.recipients ?? []) push(item)
  if (out.length === 0) push(raw.participantIdObj)
  return out
}

/** 页内文本进后端列前的收口：换行与控制字符会被用来伪造日志行，长度也不能无界。 */
function snapshot(body: string | undefined): string | undefined {
  if (!body) return undefined
  // eslint-disable-next-line no-control-regex
  const one = body.replace(/[\x00-\x1f]+/g, ' ').trim()
  return one.length > 0 ? one.slice(0, GROUP_BODY_MAX) : undefined
}

export function eventsFromSystemMessage(raw: WaMsgModel, msgKey: string, chatKey: string): GroupEventWire[] {
  if (!chatKey.endsWith('@g.us')) return []
  const hit = classifyGroupSystemMessage({ type: raw.type, subtype: raw.subtype })
  if (!hit) return []
  const dedupKey = msgKey
  const actorKey = keyOf(raw.author)
  const bodySnapshot = snapshot(raw.body)
  const out: GroupEventWire[] = []
  for (const memberKey of targetKeys(raw)) {
    out.push({
      chatKey,
      memberKey,
      ...(actorKey ? { actorKey } : {}),
      ...(raw.notifyName ? { actorName: raw.notifyName } : {}),
      eventType: hit.eventType,
      // R14：系统消息自带秒值；0 交给后端 MsgTimes 兜成入库时刻，不在这里当「1970」写出去。
      occurredAtEpochSec: typeof raw.t === 'number' ? raw.t : 0,
      dedupKey,
      source: 'system_message',
      rawType: raw.type,
      rawSubtype: raw.subtype,
      ...(bodySnapshot ? { bodySnapshot } : {})
    })
  }
  return out
}
```

- [ ] **Step 4: 在两条采集链各挂一次**

`collect.ts` 的 `chat.new_message` 回调里，在 `ctx.emit({ kind: 'message', message: row })` **之后**加：

```ts
      // 旁路只加不改：消息行照常上报（`normalizeWa` 已经把 gp2 落成 media_type='unknown'），
      // 分类成功才多产一帧事件。分类失败/设置类变更 = 零事件，绝不影响这一行入库。
      const gEvents = eventsFromSystemMessage(msg, row.msgKey, row.chatKey)
      if (gEvents.length > 0) ctx.emit({ kind: 'group_event', events: gEvents })
```

`runBackfill` 的 `for (const raw of collected.slice(0, limit))` 循环里，在 `ctx.emit({ kind: 'message', message: row })` 之后加同样三行。**两处都要挂**：只挂 live 就等于承认「补底重跑不能把历史进退史填回来」，而 spec §4 的已知代价明确把那条路留着重跑。

- [ ] **Step 5: 校验 + 重建 bundle + 提交**

```bash
cd /d/SmartSCRM/apps/desktop
node --test src/bridge/whatsapp/groupSystemMessage.test.ts src/shared/groupMembers.test.ts
pnpm run typecheck:inject && pnpm run typecheck:unit && pnpm run build:bridge
pnpm exec eslint src/shared/groupMembers.ts src/bridge/whatsapp/groupSystemMessage.ts src/bridge/whatsapp/groupSystemMessage.test.ts src/bridge/whatsapp/collect.ts --quiet
git add apps/desktop/src/shared/groupMembers.ts apps/desktop/src/shared/groupMembers.test.ts \
        apps/desktop/src/bridge/whatsapp/groupSystemMessage.ts apps/desktop/src/bridge/whatsapp/groupSystemMessage.test.ts \
        apps/desktop/src/bridge/whatsapp/collect.ts
git commit -m "$(cat <<'EOF'
feat(P8/群成员): 群系统消息分类旁路（第二事件源）

库里只有归一后的 unknown，gp2 只在页内 raw 上，所以分类必须在桥侧、归一化之前做；
后端那张 SKIPPED_TYPES 原样不动——改它会翻 P6 已验收的三个计数与 reasons 契约。
live 与 backfill 两条链各挂一次：重跑补底能把历史进退史填回来，uk_msg/uk_event 双双幂等。
EOF
)"
```

---

## Task 5: 后端 ingest——群登记 + 事件先行投影

**Files:**
- Create: `apps/server/src/main/java/com/smartscrm/server/web/dto/GroupBatchDTO.java`（内嵌 record 或同包四支：`GroupRefDTO` `GroupSnapshotDTO` `GroupMemberDTO` `GroupEventDTO`）
- Create: `apps/server/src/main/java/com/smartscrm/server/web/vo/GroupBatchVO.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/service/GroupMemberService.java`（ingest 部分）
- Create: `apps/server/src/main/java/com/smartscrm/server/web/GroupMemberController.java`（先只挂 `/batch`）
- Create: `apps/server/src/test/java/com/smartscrm/server/service/GroupMemberServiceTest.java`

**Interfaces:**
- Consumes: Task 1 的三 Mapper、`MessageService.resolveAccount(tenantId, accountId): ResolvedAccount`（复用，不重写租户闸）、`MsgTimes.toDbTime(Long, LocalDateTime)`、`MsgTimes.CHAT_ZONE`、`ChatKeys.matchesPlatform`
- Produces: `GroupMemberService.accept(long tenantId, GroupBatchDTO dto): GroupBatchVO`，`GroupBatchVO(int eventsAccepted, int eventsDuplicated, int membersUpserted, boolean reconciled, BigDecimal coverage, String reason)`；`reason` 三值 `ok|first_build|coverage_too_low`

**技术要点**

- **「重报不双计」由 affected rows 判，不由先查后插判**：`insertIgnore` 返回 1 才做投影。先 `SELECT` 再 `INSERT` 会把同批两条相同事件都算进去（读 `MessageService.accept` 的同形处理：它靠 `seenInBatch` + `insertIgnoreBatch` 两道，本处只有 `uk_event` 一道就够，因为同批重复也撞同一个键）。**判别力**：测试要断言第二次 `upsertFromEvent` **一次都没被调用**（`verify(stateMapper, never())`），只断言返回计数是 0 的话，「插了但没投影」和「没插也没投影」分不开。
- **同批内相同 `dedup_key` 不靠 DB 兜**：MySQL 的 `INSERT IGNORE` 在同一语句事务里对同键的第二条同样返回 0，所以只要逐条调用就自然幂等；但 `join_count` 的投影在 Java 里，一条被忽略的事件绝不能走进投影分支——顺序写反（先投影后插入）就会双计。**归因**：`join_count` 只由这里 +1（Task 6 的快照给 0），这一句要在代码注释里。
- **`resolveAccount` 抛的就是我们要的两种码**：`40404 账号不存在`（跨租户）与 `40000 该平台暂不支持消息采集`。复用而不是重写一遍，否则租户闸有两份实现，其中一份迟早漏。**注意**：`platform` 由 `resolveAccount` 给（`whatsapp`），入库的 platform 列一律用它，不信 dto 里带的任何平台字。
- **`chat_key` 与平台的匹配要判**：沿用 `ChatKeys.matchesPlatform(account.platform(), chatKey)`，不匹配就整条拒绝并计数（与 `MessageService.accept` 的 `chat_key 与平台不匹配` 同一形状）。少了这一判，一条 `@lid` 或手搓的键就能落进 whatsapp 名下，之后所有按平台读的接口都会把它带出来。
- **Bean Validation 的边界就是 400 的边界**：`@Size(max = 500)` 给 events、`@Size(max = 5000)` 给 snapshot.participants、`@Pattern` 给 `roleType/eventType/source` 三个枚举字。**为什么要 `@Pattern`**：投影 SQL 靠 `eventType` 的字面量分支，一个拼错的值会安静地落进「谁的分支都不走」那一格——入库成功、状态不动，是最难查的一类假成功。
- **快照名单为空 ⇒ `BizException(40000, "成员快照名单为空")`**（R20 的后端第二道闸）。桥已经挡一次（Task 3），这一挡是给「桥版本旧」与「有人手搓契约请求」留的；契约驱动里那一条用例（Task 13）就是它的证人。
- **`@Transactional` 覆盖三步**：事件投影与快照收口必须在同一事务里，否则一次中途失败会留下「join_count 加了两次但 is_in_group 还是 0」的半成品，而那种行既不像有事件也不像没事件。
- **本任务的验证档次**：`./mvnw test -Dtest=GroupMemberServiceTest`（mock mapper，不碰库）= 实测；SQL 真的按预期匹配行数在 Task 13 的 HTTP 契约腿里实测，两者不能互相顶替（`BatchSendServiceTest` 类注释那条「这一份**不**证明」的写法照抄进类注释）。

- [ ] **Step 1: DTO 与 VO**

```java
package com.smartscrm.server.web.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;

/** 采集入库一次收三样：群登记 + 事件（两源）+ 可选的那份快照。 */
public record GroupBatchDTO(
    @NotNull Long accountId,
    @Valid @Size(max = 200) List<GroupRefDTO> groups,
    @Valid GroupSnapshotDTO snapshot,
    @Valid @Size(max = 500) List<GroupEventDTO> events
) {
    public record GroupRefDTO(
        @NotBlank @Size(max = 128) String chatKey,
        @Size(max = 256) String title
    ) {}

    /** `participants` 为空 = 桥的失败没挡住，服务层整批拒收（R20 的第二道闸）。 */
    public record GroupSnapshotDTO(
        @NotBlank @Size(max = 128) String chatKey,
        @Valid @Size(max = 5000) List<GroupMemberDTO> participants,
        Integer participantCount,
        Boolean truncated
    ) {}

    public record GroupMemberDTO(
        @NotBlank @Size(max = 160) String memberKey,
        @Size(max = 32) String phone,
        @Size(max = 128) String displayName,
        // @Pattern 不是洁癖：投影与收口都按字面量分支，拼错的值会落成「入库成功但状态不动」那种假成功。
        @NotBlank @Pattern(regexp = "member|admin|super") String roleType
    ) {}

    public record GroupEventDTO(
        @NotBlank @Size(max = 128) String chatKey,
        @NotBlank @Size(max = 160) String memberKey,
        @Size(max = 160) String actorKey,
        @Size(max = 128) String actorName,
        @NotBlank @Pattern(regexp = "added|joined|left|removed|promoted|demoted") String eventType,
        @NotNull Long occurredAtEpochSec,
        @NotBlank @Size(max = 160) String dedupKey,
        @NotBlank @Pattern(regexp = "system_message|live_event") String source,
        @Size(max = 32) String rawType,
        @Size(max = 48) String rawSubtype,
        @Size(max = 512) String bodySnapshot
    ) {}
}
```

```java
package com.smartscrm.server.web.vo;

import java.math.BigDecimal;

/** `reconciled=false` 不是失败：覆盖率闸拦下判退时事件照常收，只把 reason 给回界面。 */
public record GroupBatchVO(int eventsAccepted, int eventsDuplicated, int membersUpserted,
                           boolean reconciled, BigDecimal coverage, String reason) {}
```

- [ ] **Step 2: 先写失败的 Java 单测**

```java
package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.GroupMemberEvent;
import com.smartscrm.server.entity.GroupMemberState;
import com.smartscrm.server.mapper.ChatGroupMapper;
import com.smartscrm.server.mapper.GroupMemberEventMapper;
import com.smartscrm.server.mapper.GroupMemberStateMapper;
import com.smartscrm.server.web.dto.GroupBatchDTO;
import com.smartscrm.server.web.dto.GroupBatchDTO.GroupEventDTO;
import com.smartscrm.server.web.dto.GroupBatchDTO.GroupRefDTO;
import com.smartscrm.server.web.dto.GroupBatchDTO.GroupSnapshotDTO;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * ingest 那三步里只有「事件先行」这一段在本类证明：
 * <ol>
 *   <li>重报不双计——第二次同 dedupKey 的事件**一次投影都不做**（`never()`，不是「计数为 0」）；</li>
 *   <li>投影的方向由 event_type 决定，`added` 给 `is_in_group=1`+`joinDelta=1`，`left` 给
 *       `is_in_group=0`+`latestLeaveAt` 非空，`promoted` 只动 role_type；</li>
 *   <li>空名单快照整批拒收（40000），这是桥那道 `ok:false` 之外的第二道闸；</li>
 *   <li>chat_key 与平台不匹配的条目被拒绝并留在 reasons 里，账号不属于本租户时整请求 40404。</li>
 * </ol>
 * 这一份**不**证明的事：`ON DUPLICATE KEY UPDATE` 真能按预期匹配行数、`join_count + VALUES(...)`
 * 在真库里不溢出——那是 Task 13 的 `tmp/p8a-group-contract.mjs` 的腿，走 :8180 打在真库上。
 */
class GroupMemberServiceTest {

    private static final long TENANT = 1L;
    private static final long ACCOUNT = 9L;
    private static final String CHAT = "120363999999999999@g.us";
    private static final String MEMBER = "8613999999901@c.us";

    private final ChatGroupMapper groupMapper = mock(ChatGroupMapper.class);
    private final GroupMemberEventMapper eventMapper = mock(GroupMemberEventMapper.class);
    private final GroupMemberStateMapper stateMapper = mock(GroupMemberStateMapper.class);
    private final MessageService messageService = mock(MessageService.class);
    private final GroupMemberService service = new GroupMemberService(
        groupMapper, eventMapper, stateMapper, messageService, null);

    private GroupMemberServiceTest() {
        when(messageService.resolveAccount(TENANT, ACCOUNT))
            .thenReturn(new MessageService.ResolvedAccount(ACCOUNT, "whatsapp", 1));
    }

    private static GroupEventDTO event(String type, String dedup) {
        return new GroupEventDTO(CHAT, MEMBER, "8613999999900@c.us", "群主", type, 1_760_000_000L,
            dedup, "system_message", "gp2", "add", null);
    }

    @Test
    void 重报同一条事件一次投影都不做() {
        new GroupMemberServiceTest();
        when(eventMapper.insertIgnore(any())).thenReturn(1, 0);
        var vo = service.accept(TENANT, new GroupBatchDTO(ACCOUNT, List.of(new GroupRefDTO(CHAT, "G")), null,
            List.of(event("added", "K1"), event("added", "K1"))));
        assertEquals(1, vo.eventsAccepted());
        assertEquals(1, vo.eventsDuplicated());
        verify(stateMapper, times(1)).upsertFromEvent(any());
    }

    @Test
    void added与left与promoted各自写对的列() {
        new GroupMemberServiceTest();
        when(eventMapper.insertIgnore(any())).thenReturn(1);
        service.accept(TENANT, new GroupBatchDTO(ACCOUNT, null, null,
            List.of(event("added", "A"), event("left", "B"), event("promoted", "C"))));
        var cap = org.mockito.ArgumentCaptor.forClass(GroupMemberState.class);
        verify(stateMapper, times(3)).upsertFromEvent(cap.capture());
        var vs = cap.getAllValues();
        assertEquals(1, vs.get(0).getIsInGroup());
        assertEquals(1, vs.get(0).getJoinDelta());
        assertEquals(0, vs.get(1).getIsInGroup());
        assertNotNull(vs.get(1).getLatestLeaveAt());
        assertEquals(0, vs.get(2).getJoinDelta());
        assertEquals("admin", vs.get(2).getRoleType());
        assertNull(vs.get(2).getLatestJoinAt());
    }

    @Test
    void 空名单快照整批拒收而不是建出一个空档群() {
        new GroupMemberServiceTest();
        var snapshot = new GroupSnapshotDTO(CHAT, List.of(), 0, null);
        var e = assertThrows(BizException.class,
            () -> service.accept(TENANT, new GroupBatchDTO(ACCOUNT, List.of(new GroupRefDTO(CHAT, "G")), snapshot, null)));
        assertEquals(40000, e.getCode());
        verify(groupMapper, never()).markSnapshotSuccess(any(), any(), any(), any(), org.mockito.ArgumentMatchers.anyInt(), any(), any(), any());
    }

    @Test
    void 平台不匹配的键被拒绝且原因可见() {
        new GroupMemberServiceTest();
        var bad = new GroupEventDTO("8613800000000@c.us", MEMBER, null, null, "added", 1L, "D",
            "system_message", null, null, null);
        var vo = service.accept(TENANT, new GroupBatchDTO(ACCOUNT, null, null, List.of(bad)));
        assertEquals(0, vo.eventsAccepted());
        assertTrue((vo.reasons() != null));
    }

    @Test
    void 账号不属本租户时整个请求40404() {
        when(messageService.resolveAccount(TENANT, ACCOUNT)).thenThrow(new BizException(40404, "账号不存在"));
        assertThrows(BizException.class,
            () -> service.accept(TENANT, new GroupBatchDTO(ACCOUNT, List.of(new GroupRefDTO(CHAT, "G")), null, null)));
        verify(groupMapper, never()).upsertGroup(any());
    }
}
```

（`assertNotNull/assertNull` 从 `org.junit.jupiter.api.Assertions` 静态导入。）

```bash
cd /d/SmartSCRM/apps/server && export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18" && set -o pipefail
powershell -NoProfile -ExecutionPolicy Bypass -File tmp/p7b-kill8180.ps1
./mvnw test -Dtest=GroupMemberServiceTest 2>&1 | tail -30
```
期望：编译失败（`GroupMemberService` 不存在）——这就是红。

- [ ] **Step 3: 服务层 ingest**

```java
package com.smartscrm.server.service;

import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.ChatGroup;
import com.smartscrm.server.entity.GroupMemberEvent;
import com.smartscrm.server.entity.GroupMemberState;
import com.smartscrm.server.mapper.ChatGroupMapper;
import com.smartscrm.server.mapper.GroupMemberEventMapper;
import com.smartscrm.server.mapper.GroupMemberStateMapper;
import com.smartscrm.server.service.msg.ChatKeys;
import com.smartscrm.server.service.msg.MsgTimes;
import com.smartscrm.server.web.dto.GroupBatchDTO;
import com.smartscrm.server.web.dto.GroupBatchDTO.GroupEventDTO;
import com.smartscrm.server.web.dto.GroupBatchDTO.GroupSnapshotDTO;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 群成员建档的三步（spec §6）：群登记 → 事件先行投影 → 快照收口。
 * 同事务：事件加了一次 join_count 而快照没跑完，比整批失败更难查。
 */
@Service
public class GroupMemberService {

    /** R10：覆盖率闸只有这一份，shared 不复制。 */
    static final BigDecimal COVERAGE_MIN = new BigDecimal("0.6");
    static final String REASON_OK = "ok";
    static final String REASON_FIRST = "first_build";
    static final String REASON_LOW = "coverage_too_low";

    private final ChatGroupMapper groupMapper;
    private final GroupMemberEventMapper eventMapper;
    private final GroupMemberStateMapper stateMapper;
    private final MessageService messageService;
    private final GroupMemberQueryService query;

    public GroupMemberService(ChatGroupMapper groupMapper, GroupMemberEventMapper eventMapper,
                              GroupMemberStateMapper stateMapper, MessageService messageService,
                              GroupMemberQueryService query) {
        this.groupMapper = groupMapper;
        this.eventMapper = eventMapper;
        this.stateMapper = stateMapper;
        this.messageService = messageService;
        this.query = query;
    }

    @Transactional
    public GroupBatchVO accept(long tenantId, GroupBatchDTO dto) {
        MessageService.ResolvedAccount account = messageService.resolveAccount(tenantId, dto.accountId());
        LocalDateTime receivedAt = LocalDateTime.now(MsgTimes.CHAT_ZONE).truncatedTo(java.time.temporal.ChronoUnit.MILLIS);

        // ① 群登记。这一步会 INSERT 出 participant_count=0 的行，所以「是否首建」判的是那个数，
        // 不是「行存不存在」——按后者判的话，第一步自己就把第三步的前提吃掉了（Task 6）。
        List<String> reasons = new ArrayList<>();
        int eventsAccepted = 0;
        int eventsDuplicated = 0;

        // ② 事件先行：幂等交给 uk_event 的 affected rows，投影只在真的新行上做。
        // 顺序不能反：先投影后插入的话，同批第二条会被 join_count 加两次（同 dedup_key 撞同一个键）。
        for (GroupEventDTO e : dto.events() == null ? List.<GroupEventDTO>of() : dto.events()) {
            if (!ChatKeys.matchesPlatform(account.platform(), e.chatKey())) {
                reasons.add(e.dedupKey() + ": chat_key 与平台不匹配");
                continue;
            }
            GroupMemberEvent row = toEventRow(tenantId, account, e, receivedAt);
            if (eventMapper.insertIgnore(row) != 1) {
                eventsDuplicated++;
                continue;
            }
            eventsAccepted++;
            stateMapper.upsertFromEvent(eventProjection(tenantId, account, e, row.getOccurredAt(), receivedAt));
        }
        return new GroupBatchVO(eventsAccepted, eventsDuplicated, 0, false, null, REASON_OK);
    }

    private static GroupMemberEvent toEventRow(long tenantId, MessageService.ResolvedAccount account,
                                               GroupEventDTO e, LocalDateTime receivedAt) {
        GroupMemberEvent row = new GroupMemberEvent();
        row.setTenantId(tenantId);
        row.setAccountId(account.accountId());
        row.setPlatform(account.platform());
        row.setChatKey(e.chatKey());
        row.setMemberKey(e.memberKey());
        row.setActorKey(blankToNull(e.actorKey()));
        row.setActorName(blankToNull(e.actorName()));
        row.setEventType(e.eventType());
        // R14：系统消息的 occurred_at 取 raw.t（这里已是秒值），在线事件取桥侧到达时刻。
        // 0 / 负值 / 未来值一律由 MsgTimes 折成入库时刻，不在这里钳——与消息行同一条口径。
        row.setOccurredAt(MsgTimes.toDbTime(e.occurredAtEpochSec(), receivedAt));
        row.setSource(e.source());
        row.setDedupKey(e.dedupKey());
        row.setRawType(blankToNull(e.rawType()));
        row.setRawSubtype(blankToNull(e.rawSubtype()));
        row.setBodySnapshot(blankToNull(e.bodySnapshot()));
        return row;
    }

    /**
     * 投影的六个分支：Java 决定「写哪些列」，SQL 只做 `COALESCE(VALUES(x), x)`。
     * 这样 split 的理由是——把六支 CASE 塞进一条 SQL 的话，`join_count` 到底加没加就只在
     * 数据库里可见，而 mock-mapper 的单测就再也证不了「promoted 不加次数」这一格。
     */
    static GroupMemberState eventProjection(long tenantId, MessageService.ResolvedAccount account,
                                            GroupEventDTO e, LocalDateTime occurredAt, LocalDateTime firstSeen) {
        GroupMemberState s = new GroupMemberState();
        s.setTenantId(tenantId);
        s.setAccountId(account.accountId());
        s.setPlatform(account.platform());
        s.setChatKey(e.chatKey());
        s.setMemberKey(e.memberKey());
        s.setFirstSeenAt(firstSeen);
        s.setLastEventAt(occurredAt);
        s.setSnapshotSeenDelta(0);
        switch (e.eventType()) {
            case "added", "joined" -> {
                s.setIsInGroup(1);
                s.setJoinDelta(1);
                s.setLatestJoinAt(occurredAt);
                // 重新进群要把「上一次推定退群」的方式覆盖掉：left/removed 是有事件证据的新事实。
                s.setExitMethod("joined".equals(e.eventType()) ? "left" == null ? null : null : null);
            }
            case "left" -> {
                s.setIsInGroup(0);
                s.setJoinDelta(0);
                s.setLatestLeaveAt(occurredAt);
                s.setExitMethod("left");
            }
            case "removed" -> {
                s.setIsInGroup(0);
                s.setJoinDelta(0);
                s.setLatestLeaveAt(occurredAt);
                s.setExitMethod("removed");
            }
            case "promoted" -> {
                s.setIsInGroup(1);
                s.setJoinDelta(0);
                s.setRoleType("admin");
            }
            default -> {
                s.setIsInGroup(1);
                s.setJoinDelta(0);
                s.setRoleType("member");
            }
        }
        return s;
    }

    private static String blankToNull(String v) {
        return v == null || v.isBlank() ? null : v;
    }
}
```

> **Step 3 落地时要改掉的一处**：上面 `added/joined` 那支里的 `setExitMethod(...)` 三元是废话代码。定案为 **`s.setExitMethod(null)`**——`upsertFromEvent` 的 UPDATE 分支用 `exit_method = COALESCE(VALUES(exit_method), exit_method)`，给 null 就是「不动旧值」，而重新进群后旧 `exit_method` 与 `is_in_group=1` 同时存在不矛盾（读侧只看 `is_in_group=0` 的行，Task 15 的界面文案按那条走）。这条要写进代码注释，别留给下一个人重新怀疑。

- [ ] **Step 4: `upsertFromEvent` 的 SQL**

在 `GroupMemberStateMapper` 补：

```java
    /**
     * 事件投影。`first_seen_at` 只出现在 INSERT 清单里——ON DUPLICATE 分支不赋值它，
     * 否则「第一次看见他」会被每一次事件刷成最新，spec §3 那条硬要求就没了。
     * 所有可空列用 `COALESCE(VALUES(x), x)`：Java 那侧给 null 的意思是「这一列这次不动」，
     * 不是「清空」。清空只发生在 markAbsentBySnapshot（Task 1）与 upsertFromSnapshot 两条路上。
     */
    @Insert("INSERT INTO group_member_state (tenant_id, account_id, platform, chat_key, member_key,"
        + " is_in_group, join_count, latest_join_at, latest_leave_at, exit_method, role_type,"
        + " last_event_at, first_seen_at, snapshot_seen_count) VALUES (#{tenantId}, #{accountId},"
        + " #{platform}, #{chatKey}, #{memberKey}, #{isInGroup}, COALESCE(#{joinDelta}, 0),"
        + " #{latestJoinAt}, #{latestLeaveAt}, #{exitMethod}, COALESCE(#{roleType}, 'member'),"
        + " #{lastEventAt}, #{firstSeenAt}, 0)"
        + " ON DUPLICATE KEY UPDATE"
        + " is_in_group = #{isInGroup},"
        + " join_count = join_count + COALESCE(#{joinDelta}, 0),"
        + " latest_join_at = COALESCE(#{latestJoinAt}, latest_join_at),"
        + " latest_leave_at = COALESCE(#{latestLeaveAt}, latest_leave_at),"
        + " exit_method = COALESCE(#{exitMethod}, exit_method),"
        + " role_type = COALESCE(#{roleType}, role_type),"
        + " last_event_at = #{lastEventAt}")
    int upsertFromEvent(GroupMemberState s);
```

- [ ] **Step 5: Controller 只先挂 `/batch`**

```java
package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.GroupMemberService;
import com.smartscrm.server.web.dto.GroupBatchDTO;
import com.smartscrm.server.web.vo.GroupBatchVO;
import jakarta.validation.Valid;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/group-members")
public class GroupMemberController {

    private final GroupMemberService service;

    public GroupMemberController(GroupMemberService service) {
        this.service = service;
    }

    @PostMapping("/batch")
    public ApiResponse<GroupBatchVO> batch(@AuthenticationPrincipal AuthPrincipal principal,
                                           @Valid @RequestBody GroupBatchDTO dto) {
        return ApiResponse.ok(service.accept(principal.tenantId(), dto));
    }
}
```

`GroupMemberQueryService` 这一任务先给一个空壳（`@Service` + 构造器注入三个 Mapper，无公开方法），Task 7 填读面——它是 `GroupMemberService` 构造器的第五个参数，缺了它 Spring 起不来。

- [ ] **Step 6: 跑到绿 + 构建 + 提交**

```bash
cd /d/SmartSCRM/apps/server && export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18" && set -o pipefail
powershell -NoProfile -ExecutionPolicy Bypass -File tmp/p7b-kill8180.ps1
./mvnw test 2>&1 | tail -30
```
期望：`GroupMemberServiceTest` 五条全过，且既有测试一条没翻（`BatchSendServiceTest`、`BatchRenderTest` 等仍绿）。

```bash
git add apps/server/src/main/java/com/smartscrm/server/web/dto/GroupBatchDTO.java \
        apps/server/src/main/java/com/smartscrm/server/web/vo/GroupBatchVO.java \
        apps/server/src/main/java/com/smartscrm/server/service/GroupMemberService.java \
        apps/server/src/main/java/com/smartscrm/server/service/GroupMemberQueryService.java \
        apps/server/src/main/java/com/smartscrm/server/web/GroupMemberController.java \
        apps/server/src/main/java/com/smartscrm/server/mapper/GroupMemberStateMapper.java \
        apps/server/src/test/java/com/smartscrm/server/service/GroupMemberServiceTest.java
git commit -m "$(cat <<'EOF'
feat(P8/群成员): 后端事件先行投影与 /group-members/batch

幂等交给 uk_event 的 affected rows，投影只在真新行上做：先投影后插入会让同批第二条
被 join_count 加两次。六个分支的「写哪些列」留在 Java，SQL 只做 COALESCE——否则
promoted 到底加没加次数这件事，mock 单测再也证不了。
EOF
)"
```

---

## Task 6: 后端快照收口与覆盖率闸

**Files:**
- Modify: `apps/server/src/main/java/com/smartscrm/server/service/GroupMemberService.java`（补 `reconcile`，`accept` 的第 ① ③ 步接上）
- Modify: `apps/server/src/main/java/com/smartscrm/server/mapper/GroupMemberStateMapper.java`（补 `upsertFromSnapshot`、`countInGroup`）
- Modify: `apps/server/src/test/java/com/smartscrm/server/service/GroupMemberServiceTest.java`（追加 6 条）

**Interfaces:**
- Consumes: Task 1 的 `ChatGroupMapper.upsertGroup/selectByUk/markSnapshotSuccess/markSnapshotRejected`、`GroupMemberStateMapper.markAbsentBySnapshot`
- Produces: `GroupMemberService.reconcile(long tenantId, MessageService.ResolvedAccount account, GroupSnapshotDTO snapshot, LocalDateTime receivedAt): ReconcileOutcome`（包内可见，`accept` 调它），`record ReconcileOutcome(boolean reconciled, BigDecimal coverage, String reason, int present, int markedAbsent)`

**技术要点**

- **`first_build` 判的是 `participant_count`，不是「行存不存在」**：`accept` 的第 ① 步已经为这个 `chat_key` INSERT 出 `participant_count=0` 的行。按行存在判首建的话，第一版永远走不到 `first_build`，而 `coverage_too_low` 那一档会在第一次建档就把一个 `cur < 0.6*0` 的除零推给闸——`prev=0` 时覆盖率根本算不出来。**归因**：`participant_count` 只由 `markSnapshotSuccess` 写（Task 1 的 SQL 就这一处），所以它是「第几次成功快照」的唯一读数。
- **分母只被成功快照覆盖（R20），失败路径一行分母都不许动**：闸拦下时走 `markSnapshotRejected`，它只写 `last_coverage` 与 `last_reconcile_reason`。测试要有一格断言 `verify(groupMapper, never()).markSnapshotSuccess(...)`——只断 `reconciled=false` 分不开「拦下了但顺手更新了分母」这一格坏形状。
- **`markAbsentBySnapshot` 的空集是可达的，必须挡**：`participants` 非空但全部命中已有行时 `NOT IN` 的入参非空，没问题；真正危险的是 `cur=0` 走到这里（`upsertFromSnapshot` 一次都没调，`NOT IN ()` 语法错或者更糟——如果实现退化成不带 `NOT IN` 就是整群判退）。`accept` 的 40000 已经把 `cur=0` 拒在门外（Task 5），**reconcile 里还要再判一次** `present.isEmpty()` 早退：这两个判据不是重复，是「入口拒收」与「内部不变量」两条，后者是给未来的调用者留的。
- **`coverage = cur / prev` 的除法精度**：`BigDecimal.valueOf(cur).divide(BigDecimal.valueOf(prev), 4, RoundingMode.HALF_DOWN)`。用 `HALF_DOWN` 而不是 `UP`：`0.59996` 这种刚好卡在闸边的值，进一律就是放它判退整群人；退一律就是这一轮不判退、下一轮再算。**只有 `prev > 0` 时才除**，除零会抛 ArithmeticException 把整事务打回。
- **`is_final=1` 的群照常收口，但泵不拉**（R21）：如果将来有别的来源带上一份 final 群的快照，判退在语义上仍是正确的事；把「跳过」放在泵那一层而不是这里，是为了让「谁不拉」这条事实只有一处答案。
- **`snapshot_seen_count` 只由快照 +1，`join_count` 只由事件 +1**：两列各有一个写入者，§11 那条契约（「第几次成功快照里还看见他」）才读得懂。混写的话，重跑一次补底就会让一个人的「进群次数」变大，而那个数字是要出现在导出里的。
- **本任务的验证档次**：mock 单测 = 实测（三档闸的分支覆盖）；真库里「NOT IN 匹配到预期的行数」= 待 Task 13 的 :8180 契约腿，这里不许写「已验证」。

- [ ] **Step 1: 先写失败的测试（追加到 `GroupMemberServiceTest`）**

```java
    private static GroupSnapshotDTO snapshot(int n) {
        var members = new java.util.ArrayList<GroupBatchDTO.GroupMemberDTO>();
        for (int i = 0; i < n; i++) {
            members.add(new GroupBatchDTO.GroupMemberDTO("86139999999" + String.format("%02d", i) + "@c.us",
                "86139999999" + String.format("%02d", i), null, "member"));
        }
        return new GroupSnapshotDTO(CHAT, members, n, null);
    }

    private GroupMemberService withPrev(Integer participantCount) {
        var svc = new GroupMemberService(groupMapper, eventMapper, stateMapper, messageService, null);
        var prev = new com.smartscrm.server.entity.ChatGroup();
        prev.setParticipantCount(participantCount);
        when(groupMapper.selectByUk(TENANT, "whatsapp", ACCOUNT, CHAT))
            .thenReturn(participantCount == null ? null : prev);
        when(messageService.resolveAccount(TENANT, ACCOUNT))
            .thenReturn(new MessageService.ResolvedAccount(ACCOUNT, "whatsapp", 1));
        return svc;
    }

    @Test
    void 首次建档走first_build且不做判退() {
        var svc = withPrev(0);
        var vo = svc.accept(TENANT, new GroupBatchDTO(ACCOUNT, List.of(new GroupRefDTO(CHAT, "G")), snapshot(3), null));
        assertTrue(vo.reconciled());
        assertEquals("first_build", vo.reason());
        assertNull(vo.coverage());
        verify(stateMapper, never()).markAbsentBySnapshot(any(), any(), any(), any(), any());
    }

    @Test
    void 覆盖率达标时判退且不写退群时间() {
        var svc = withPrev(10);
        var vo = svc.accept(TENANT, new GroupBatchDTO(ACCOUNT, null, snapshot(8), null));
        assertTrue(vo.reconciled());
        assertEquals("ok", vo.reason());
        assertEquals(0, new BigDecimal("0.8000").compareTo(vo.coverage()));
        verify(stateMapper).markAbsentBySnapshot(org.mockito.ArgumentMatchers.eq(TENANT),
            org.mockito.ArgumentMatchers.eq(ACCOUNT), org.mockito.ArgumentMatchers.eq("whatsapp"),
            org.mockito.ArgumentMatchers.eq(CHAT), any());
    }

    @Test
    void 覆盖率不足时整批拒判退且分母一个字节不动() {
        var svc = withPrev(10);
        var vo = svc.accept(TENANT, new GroupBatchDTO(ACCOUNT, null, snapshot(4), null));
        org.junit.jupiter.api.Assertions.assertFalse(vo.reconciled());
        assertEquals("coverage_too_low", vo.reason());
        assertEquals(0, new BigDecimal("0.4000").compareTo(vo.coverage()));
        verify(stateMapper, never()).markAbsentBySnapshot(any(), any(), any(), any(), any());
        verify(groupMapper, never()).markSnapshotSuccess(any(), any(), any(), any(),
            org.mockito.ArgumentMatchers.anyInt(), any(), any(), any());
        verify(groupMapper).markSnapshotRejected(any(), any(), any(), any(), any(),
            org.mockito.ArgumentMatchers.eq("coverage_too_low"));
    }

    @Test
    void 到场的人由快照只加seen次数不动join次数与时间() {
        var svc = withPrev(1);
        svc.accept(TENANT, new GroupBatchDTO(ACCOUNT, null, snapshot(1), null));
        var cap = org.mockito.ArgumentCaptor.forClass(GroupMemberState.class);
        verify(stateMapper).upsertFromSnapshot(cap.capture());
        assertEquals(0, cap.getValue().getJoinDelta());
        assertEquals(1, cap.getValue().getSnapshotSeenDelta());
        assertNull(cap.getValue().getLatestJoinAt());
    }

    @Test
    void 名单为空的快照整批40000而不是把整群人判退() {
        var svc = withPrev(20);
        var e = assertThrows(BizException.class, () -> svc.accept(TENANT,
            new GroupBatchDTO(ACCOUNT, List.of(new GroupRefDTO(CHAT, "G")), new GroupSnapshotDTO(CHAT, List.of(), 0, null), null)));
        assertEquals(40000, e.getCode());
        verify(stateMapper, never()).markAbsentBySnapshot(any(), any(), any(), any(), any());
    }

    @Test
    void 同一个人既在快照又在事件里时两条写入者各写自己的列() {
        var svc = withPrev(1);
        when(eventMapper.insertIgnore(any())).thenReturn(1);
        svc.accept(TENANT, new GroupBatchDTO(ACCOUNT, List.of(new GroupRefDTO(CHAT, "G")), snapshot(1),
            List.of(event("added", "K"))));
        verify(stateMapper).upsertFromEvent(any());
        verify(stateMapper).upsertFromSnapshot(any());
    }
```

```bash
cd /d/SmartSCRM/apps/server && ./mvnw test -Dtest=GroupMemberServiceTest 2>&1 | tail -30
```
期望：6 条新用例全红（`accept` 现在还不走快照那一步）。

- [ ] **Step 2: `upsertFromSnapshot` 与 `countInGroup`**

```java
    /**
     * 快照到场的人。`latest_join_at` / `latest_leave_at` / `join_count` 一律不碰：
     * 快照给不出进群时间（spec §1 的 ParticipantModel），把建档时刻写进去就是造一条查不出来的假记录。
     * `exit_method` 同样不碰：一个人重新出现在快照里，不代表上一次退群的证据作废——
     * 读侧只看 `is_in_group=0` 的行（Task 15），`is_in_group=1` 时那一列本来就不呈现。
     */
    @Insert("INSERT INTO group_member_state (tenant_id, account_id, platform, chat_key, member_key, phone,"
        + " display_name, role_type, is_in_group, join_count, latest_join_at, latest_leave_at, exit_method,"
        + " first_seen_at, snapshot_seen_count, customer_id) VALUES (#{tenantId}, #{accountId}, #{platform},"
        + " #{chatKey}, #{memberKey}, #{phone}, #{displayName}, #{roleType}, 1, 0, NULL, NULL, NULL,"
        + " #{firstSeenAt}, COALESCE(#{snapshotSeenDelta}, 1), #{customerId})"
        + " ON DUPLICATE KEY UPDATE is_in_group = 1, role_type = #{roleType},"
        + " display_name = COALESCE(#{displayName}, display_name),"
        + " phone = COALESCE(#{phone}, phone),"
        + " customer_id = COALESCE(#{customerId}, customer_id),"
        + " snapshot_seen_count = snapshot_seen_count + COALESCE(#{snapshotSeenDelta}, 1)")
    int upsertFromSnapshot(GroupMemberState s);

    @Select("SELECT COUNT(*) FROM group_member_state WHERE tenant_id = #{tenantId} AND account_id = #{accountId}"
        + " AND platform = #{platform} AND chat_key = #{chatKey} AND is_in_group = 1")
    int countInGroup(@Param("tenantId") Long tenantId, @Param("accountId") Long accountId,
                     @Param("platform") String platform, @Param("chatKey") String chatKey);
```

`GroupMemberState` 因此多两个**非列字段**（沿用 `ChatConversation.unreadDelta` 的先例，必须 `@TableField(exist = false)`，否则 MyBatis-Plus 会把它们当列拼进 `BaseMapper` 的语句）：

```java
    /** 入参字段，不是列：事件投影给 0 或 1，快照一律给 0（spec §6 的「谁是写入者」）。 */
    @TableField(exist = false)
    private Integer joinDelta;

    /** 入参字段，不是列：只有 `upsertFromSnapshot` 读它。 */
    @TableField(exist = false)
    private Integer snapshotSeenDelta;
```

- [ ] **Step 3: `reconcile` 接进 `accept`**

把 Task 5 里那句 `return new GroupBatchVO(eventsAccepted, eventsDuplicated, 0, false, null, REASON_OK)` 换成完整三步：

```java
        // ③ 快照收口 + 覆盖率闸。
        int members = 0;
        boolean reconciled = false;
        BigDecimal coverage = null;
        String reason = REASON_OK;
        if (dto.snapshot() != null) {
            ReconcileOutcome r = reconcile(tenantId, account, dto.snapshot(), receivedAt);
            members = r.present();
            reconciled = r.reconciled();
            coverage = r.coverage();
            reason = r.reason();
        }
        return new GroupBatchVO(eventsAccepted, eventsDuplicated, members, reconciled, coverage, reason);
    }

    /** 快照三步的收口。包内可见：`accept` 是唯一调用者，单独暴露只是为了单测能直接打这一层。 */
    ReconcileOutcome reconcile(long tenantId, MessageService.ResolvedAccount account,
                               GroupSnapshotDTO snapshot, LocalDateTime receivedAt) {
        if (snapshot.participants() == null || snapshot.participants().isEmpty()) {
            // 空名单绝不当作「成功快照」：那会把整群人在闸前推定成退群（R20 的第二道闸）。
            throw new BizException(40000, "成员快照名单为空");
        }
        ChatGroup prev = groupMapper.selectByUk(tenantId, account.platform(), account.accountId(), snapshot.chatKey());
        // 首建判的是分母，不是行是否存在——第 ① 步已经 INSERT 出一行 participant_count=0 的了。
        Integer prevCount = prev == null ? null : prev.getParticipantCount();
        boolean firstBuild = prevCount == null || prevCount == 0;
        int cur = snapshot.participants().size();
        BigDecimal coverage = firstBuild || prevCount == null
            ? null
            : BigDecimal.valueOf(cur).divide(BigDecimal.valueOf(prevCount), 4, java.math.RoundingMode.HALF_DOWN);
        boolean allowed = firstBuild || coverage != null && coverage.doubleValue() >= COVERAGE_MIN.doubleValue();
        String reason = firstBuild ? REASON_FIRST : allowed ? REASON_OK : REASON_LOW;

        List<String> present = new ArrayList<>(cur);
        LocalDateTime now = LocalDateTime.now(MsgTimes.CHAT_ZONE).truncatedTo(java.time.temporal.ChronoUnit.MILLIS);
        for (GroupBatchDTO.GroupMemberDTO m : snapshot.participants()) {
            if (!ChatKeys.matchesPlatform(account.platform(), snapshot.chatKey())) {
                throw new BizException(40000, "chat_key 与平台不匹配: " + snapshot.chatKey());
            }
            present.add(m.memberKey());
            stateMapper.upsertFromSnapshot(snapshotRow(tenantId, account, snapshot.chatKey(), m, now));
        }
        int markedAbsent = 0;
        if (allowed && !present.isEmpty()) {
            // present.isEmpty() 这一判是「内部不变量」，不是重复的入口检查：
            // NOT IN () 是语法错，而实现一旦退化到不拼 NOT IN，代价就是整群判退。
            markedAbsent = stateMapper.markAbsentBySnapshot(tenantId, account.accountId(),
                account.platform(), snapshot.chatKey(), present);
        }
        if (allowed) {
            groupMapper.markSnapshotSuccess(tenantId, account.accountId(), account.platform(),
                snapshot.chatKey(), cur, receivedAt, coverage, reason);
        } else {
            groupMapper.markSnapshotRejected(tenantId, account.accountId(), account.platform(),
                snapshot.chatKey(), coverage, reason);
        }
        return new ReconcileOutcome(allowed, coverage, reason, cur, markedAbsent);
    }

    private static GroupMemberState snapshotRow(long tenantId, MessageService.ResolvedAccount account,
                                                String chatKey, GroupBatchDTO.GroupMemberDTO m, LocalDateTime now) {
        GroupMemberState s = new GroupMemberState();
        s.setTenantId(tenantId);
        s.setAccountId(account.accountId());
        s.setPlatform(account.platform());
        s.setChatKey(chatKey);
        s.setMemberKey(m.memberKey());
        s.setPhone(blankToNull(m.phone()));
        s.setDisplayName(blankToNull(m.displayName()));
        s.setRoleType(m.roleType());
        s.setFirstSeenAt(now);
        s.setSnapshotSeenDelta(1);
        s.setJoinDelta(0);
        // R17 的数据源：customer_id 走与消息行同一条按号码认领的规则（MessageService 的匹配链）。
        s.setCustomerId(null); // 由 MessageService#matchCustomer 的同形规则填，Task 7 的 link 步骤负责；见本步末尾的注
        return s;
    }

    /** 快照三步的结果：`reconciled` 是「有没有做判退」，与「有没有到场者」无关。 */
    record ReconcileOutcome(boolean reconciled, BigDecimal coverage, String reason, int present, int markedAbsent) {}
```

> **`customerId` 的填法（本步一起落，不留 TODO）**：`MessageService` 里那条「open_id 等值 → 归一手机号扫全租户」的匹配是 private 的（`matchCustomer`），本期把它**提成 `public Long matchCustomer(long tenantId, Integer platformType, String chatKey)`**（`MessageService.java:231-247` 那条既有实现，一字不改地换可见性），`snapshotRow` 之后由 `reconcile` 用 `phone` 拼一个 `<phone>@c.us` 形态的 chatKey 传进去复用。**归因**：`customer_id` 由这一处写，快照与事件两条路都不写它（`upsertFromEvent` 的清单里根本没有它），所以「谁认领的客户」只有一个答案。**代价**：一个群一次建档是 N 次 `matchCustomer`——所以 `reconcile` 要像 `MessageService.accept` 那样按 chatKey 缓存一次结果（那里已经写明「不能省成 computeIfAbsent」的理由），而群的 N 个人共享同一次「按号码」查询的只有同一号码，因此**缓存键取 phone**，不是 chatKey。

```java
        Map<String, Long> customerByPhone = new HashMap<>();
        for (...) {
            String phone = blankToNull(m.phone());
            if (phone != null && !customerByPhone.containsKey(phone)) {
                customerByPhone.put(phone, messageService.matchCustomer(tenantId, account.platformType(), phone + "@c.us"));
            }
            s.setCustomerId(phone == null ? null : customerByPhone.get(phone));
        }
```

- [ ] **Step 4: 跑到绿 + 构建 + 提交**

```bash
cd /d/SmartSCRM/apps/server && export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18" && set -o pipefail
powershell -NoProfile -ExecutionPolicy Bypass -File tmp/p7b-kill8180.ps1
./mvnw test 2>&1 | tail -30
```
期望：12 条（Task 5 的 5 + 本任务的 6 + 既有 `MessageService` 相关）全过；全模块 `BUILD SUCCESS`。

```bash
git add apps/server/src/main/java/com/smartscrm/server/service/GroupMemberService.java \
        apps/server/src/main/java/com/smartscrm/server/service/MessageService.java \
        apps/server/src/main/java/com/smartscrm/server/mapper/GroupMemberStateMapper.java \
        apps/server/src/main/java/com/smartscrm/server/entity/GroupMemberState.java \
        apps/server/src/test/java/com/smartscrm/server/service/GroupMemberServiceTest.java
git commit -m "$(cat <<'EOF'
feat(P8/群成员): 快照收口与覆盖率闸

first_build 判 participant_count 不判行存在——第①步自己就会 INSERT 出一行 0 的，
按行判的话第一版永远走不到首建那一档。分母只被成功快照覆盖：闸拦下时只记 coverage/reason。
空名单两处挡：入口 40000 拒收，reconcile 里再判一次当内部不变量。
EOF
)"
```

---

## Task 7: 后端读端点四支

**Files:**
- Modify: `apps/server/src/main/java/com/smartscrm/server/service/GroupMemberQueryService.java`
- Modify: `apps/server/src/main/java/com/smartscrm/server/web/GroupMemberController.java`
- Modify: `apps/server/src/main/java/com/smartscrm/server/mapper/ChatGroupMapper.java`（+ `selectGroupPage`）
- Modify: `apps/server/src/main/java/com/smartscrm/server/mapper/GroupMemberStateMapper.java`（+ `selectMemberPage`、`selectPhoneKeysByCustomer`）
- Modify: `apps/server/src/main/java/com/smartscrm/server/mapper/GroupMemberEventMapper.java`（+ `selectEventPage`）
- Modify: `apps/server/src/main/java/com/smartscrm/server/mapper/ChatMessageMapper.java`（+ `senderActivity` 两条聚合）
- Create: `apps/server/src/main/java/com/smartscrm/server/web/vo/{GroupRowVO,GroupMemberRowVO,GroupEventRowVO,CustomerGroupVO,MemberPageVO}.java`

**Interfaces:**
- Consumes: Task 1 的表、Task 5/6 写入的行、`PageResult.of(list, total, current, size)`、`ChatKeys.isGroup`
- Produces（渲染层与主进程 api 从这里取形状，字段名逐字）：
  - `GET /api/group-members/groups?accountId&page&size` → `PageResult<GroupRowVO>`，`GroupRowVO(chatKey, title, participantCount, inGroupCount, lastSnapshotAt, snapshotCount, isFinal, lastCoverage, lastReconcileReason, lastEventAt)`
  - `GET /api/group-members/group/members?accountId&chatKey&isInGroup&role&q&page&size` → `MemberPageVO(records, total, page, size, coverage, reconcileReason, lastSnapshotAt)`
  - `GET /api/group-members/group/events?accountId&chatKey&eventType&page&size` → `PageResult<GroupEventRowVO>`
  - `GET /api/group-members/customer/{customerId}/groups?accountId` → `List<CustomerGroupVO>`
  - `GroupMemberQueryService.membersRaw(long tenantId, long accountId, String chatKey)`（Task 8 的导出取数复用它，不走分页）

**R24（本任务定，Task 8 沿用）：`GroupRowVO` / `GroupMemberRowVO` / `GroupEventRowVO` / `CustomerGroupVO` 是 Lombok `@Data` 的可变 POJO，不是 record。**
理由：这四支是**由 MyBatis 直接填的行载体**（`@Select` 的返回类型），而 MyBatis 对无默认构造器的目标类走**构造器自动映射，且按列序而非列名**匹配——仓库的 `mybatis-plus.configuration` 里只开了 `map-underscore-to-camel-case`（`application.yml:19-21`），没有开 `arg-name-based-constructor-auto-mapping`。把 record 当 `@Select` 的返回类型，一旦后端加一列或调整 SELECT 清单顺序，就会**按位置错填**且完全静默（列名与属性名都对得上，值却是别人的）。setter 自动映射按列名匹配，列序变了无所谓。
`MemberPageVO` 与 Task 5 的 `GroupBatchVO` 仍是 record：它们由服务层手工组装，MyBatis 从不填它们。
**这条区分的判据要写进这四个类的类注释**（一句话：「MyBatis 行载体，故可变；wire 上的只读形状由服务层组装，见 MemberPageVO」），否则下一个读端点会把 record 当惯例抄进来。

**技术要点**

- **每一支都必须带 `account_id`**（R16）：`uk_group` / `uk_member` / `uk_event` 三个唯一键都含 `account_id`，同一 `chat_key` 在两个账号下是两行。照 spec §7 那个只写 `chatKey` 的查询串实现，就会在两个账号都挂着同一个群时把两账号的行混着读出来。**判别力**：Task 13 的契约腿会为「同 chatKey 换 accountId」单开一格，断言换账号后读到 0 行。
- **`q` 参数走 LIKE，转义沿用现成的那一条**：`service/msg/SearchPattern.like(q)`（P6 起在用）返回**已带 `%` 的转义模式**，`null` 表示「不过滤」。**坑**：`q` 里带 `%` 或 `_` 时不转义就变成通配，一个 `_` 会让「按姓名搜」命中所有人——这一格在 Task 13 要有断言。因为 null 已经代表「不过滤」，`<if>` 判的是 `like != null`，SQL 里也**不能再 `CONCAT('%',…,'%')`**（那是二次包裹，会把转义过的模式搅成通配）。
- **`MemberPageVO` 为什么不用 `PageResult`**：§8 要界面上把 `coverage_too_low` 标出来，那份新鲜度读数属于「这一页的来源」而不是「这一页的记录」。多包一层是有意的，字段名 `reconcileReason` 与 `chat_group.last_reconcile_reason` 同源（R1），所以弹层单独打开时也有出处。
- **`lastEventAt` 是相关子查询，不是 JOIN**：`chat_group` 一页 20 行 × 一条 `MAX(occurred_at)` 子查询，比 `LEFT JOIN group_member_event ... GROUP BY` 少一次整表聚合；`idx_event_group` 的前三列正好被这个子查询吃掉（`tenant_id, account_id, chat_key`），第四列 `occurred_at` 让 MAX 走索引右缘。**归因**：这一列读的是流水，不是消息，别和「最近聊天时间」（Task 8 从 `chat_message` 聚合）混成同一个数。
- **`isInGroup` 的三态**：`null` = 不看这一列；`0` / `1` 各自下推。用 `Integer` 而不是 `boolean`，因为「未筛选」与「筛在群外（false）」是两件事，写成 `boolean` 就只剩两种。
- **`customer/{id}/groups` 走 R17**（`group_member_state.customer_id`），并且要求 `account_id`：客户可以同时在两个账号的群里，跨账号混读会让「这个账号在哪些群里」这个问题没有答案。该端点本期不分页（一个客户所在群数的量级是个位数到几十），返回 `List`——加 `PageResult` 会逼渲染层先判 page 再判 records，而这里没有翻页界面。
- **`chat_message` 的两条聚合（`senderActivity`）**：`GROUP BY sender_key`，只取 `sender_key IS NOT NULL`（单聊行 `sender_key` 为空，V8 之后只有群行才带它）。**这条谓词漏掉就会把单聊的发言数混进群统计**——而单聊与群聊的 chat_key 不同，所以实际是「群 chat_key 下的行必然带 sender_key」，谓词留着当不变量守卫，注释要这么写，别写成「过滤脏数据」。
- **本任务的验证档次**：`./mvnw test`（本任务不加新单测，SQL 的行数断言归 Task 13 的 HTTP 腿）；端点可达与形状由 Task 13 实测。

- [ ] **Step 1: 分页 SQL 三支**

```java
// ChatGroupMapper.java 追加
    /**
     * 群列表。两个子查询都是相关的、都吃 `idx_*` 的前三列：
     * `in_group_count` 吃 `idx_member_group (tenant,account,chat_key,is_in_group)`，
     * `last_event_at` 吃 `idx_event_group (...,occurred_at)` 并让 MAX 走索引右缘。
     * <p>
     * `account_id` 是必填参数而不是可选筛选：uk 里含它，同一 chat_key 在两个账号下是两行，
     * 少了这一维就是跨账号串数据（R16）。
     */
    @Select("<script>SELECT g.chat_key AS chatKey, g.title, g.participant_count AS participantCount,"
        + " (SELECT COUNT(*) FROM group_member_state s WHERE s.tenant_id = g.tenant_id"
        + "   AND s.account_id = g.account_id AND s.platform = g.platform AND s.chat_key = g.chat_key"
        + "   AND s.is_in_group = 1) AS inGroupCount,"
        + " g.last_snapshot_at AS lastSnapshotAt, g.snapshot_count AS snapshotCount, g.is_final AS isFinal,"
        + " g.last_coverage AS lastCoverage, g.last_reconcile_reason AS lastReconcileReason,"
        + " (SELECT MAX(e.occurred_at) FROM group_member_event e WHERE e.tenant_id = g.tenant_id"
        + "   AND e.account_id = g.account_id AND e.chat_key = g.chat_key) AS lastEventAt"
        + " FROM chat_group g WHERE g.tenant_id = #{tenantId} AND g.account_id = #{accountId}"
        + " <if test='like != null'>AND (g.title LIKE #{like} OR g.chat_key LIKE #{like})</if>"
        + " ORDER BY g.last_snapshot_at IS NULL, g.last_snapshot_at DESC, g.id DESC"
        + "</script>")
    com.baomidou.mybatisplus.extension.plugins.pagination.Page<GroupRowVO> selectGroupPage(
        com.baomidou.mybatisplus.extension.plugins.pagination.Page<GroupRowVO> page,
        @Param("tenantId") Long tenantId, @Param("accountId") Long accountId, @Param("like") String like);
```

**`like` 参数的来源与 null 契约**（不是新发明的工具，仓库已有）：`service/msg/SearchPattern.like(String q)` 就是这一条——它把词转义后**连 `%` 一起返回**（`"%" + escaped + "%"`），并且返回 `null` 表示「这个词不该发起搜索」（纯空白、只由 `%`/`_` 组成）。所以：

- SQL 里用 `LIKE #{like}`，**不要再写 `CONCAT('%', …, '%')`**（那会把转义过的 `%` 再当通配符，`q="%"` 就逃过 null 契约变成全表扫），也不要写 `ESCAPE '\'`（`SearchPattern` 的注释写明它依赖 MySQL 默认转义符，加了反而与既有搜索面分叉）。
- `<if test='like != null'>` 而不是 `!= ''`：null 那一支就是「不过滤」，与 `MessageQueryService` 的现有分支同形（`MessageQueryService.java:75,181`）。
- **判别力**：`q="_"` 在错误实现下会命中所有人（`_` 是单字符通配），在正确实现下走 null 契约＝不过滤。Task 13 的契约腿会为「`q` 带 `%` 与 `_`」各开一格，断言命中 0 而不是命中全部。

- [ ] **Step 2: 成员与事件两支 + 客户反查**

```java
    @Select("<script>SELECT s.member_key AS memberKey, s.phone, s.display_name AS displayName,"
        + " s.role_type AS roleType, s.is_in_group AS isInGroup, s.join_count AS joinCount,"
        + " s.latest_join_at AS latestJoinAt, s.latest_leave_at AS latestLeaveAt,"
        + " s.exit_method AS exitMethod, s.first_seen_at AS firstSeenAt,"
        + " s.snapshot_seen_count AS snapshotSeenCount, s.customer_id AS customerId"
        + " FROM group_member_state s WHERE s.tenant_id = #{tenantId} AND s.account_id = #{accountId}"
        + " AND s.platform = #{platform} AND s.chat_key = #{chatKey}"
        + " <if test='isInGroup != null'>AND s.is_in_group = #{isInGroup}</if>"
        + " <if test='role != null and role != \"\"'>AND s.role_type = #{role}</if>"
        + " <if test='like != null'>AND (s.display_name LIKE #{like} OR s.phone LIKE #{like}"
        + "   OR s.member_key LIKE #{like})</if>"
        + " ORDER BY s.is_in_group DESC, s.latest_join_at IS NULL, s.latest_join_at DESC, s.id DESC"
        + "</script>")
    Page<GroupMemberRowVO> selectMemberPage(Page<GroupMemberRowVO> page, @Param("tenantId") Long tenantId,
        @Param("accountId") Long accountId, @Param("platform") String platform, @Param("chatKey") String chatKey,
        @Param("isInGroup") Integer isInGroup, @Param("role") String role, @Param("like") String like);

    /** 客户反查（R17）：走状态表的 customer_id，不走会话头——后者的定义是「发过消息的会话」，正是登记册要修的洞。 */
    @Select("SELECT DISTINCT s.chat_key AS chatKey, g.title, s.member_key AS memberKey,"
        + " s.is_in_group AS isInGroup, g.participant_count AS participantCount, g.last_snapshot_at AS lastSnapshotAt"
        + " FROM group_member_state s INNER JOIN chat_group g"
        + " ON g.tenant_id = s.tenant_id AND g.account_id = s.account_id AND g.platform = s.platform"
        + " AND g.chat_key = s.chat_key"
        + " WHERE s.tenant_id = #{tenantId} AND s.account_id = #{accountId} AND s.customer_id = #{customerId}"
        + " ORDER BY g.last_snapshot_at IS NULL, g.last_snapshot_at DESC")
    List<CustomerGroupVO> selectGroupsByCustomer(@Param("tenantId") Long tenantId,
        @Param("accountId") Long accountId, @Param("customerId") Long customerId);
```

`GroupMemberEventMapper` 那支同形（`event_type` 可选、`ORDER BY occurred_at DESC, id DESC`）。

- [ ] **Step 3: `GroupMemberQueryService` 装配四支读面**

```java
package com.smartscrm.server.service;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.smartscrm.server.common.PageResult;
import com.smartscrm.server.mapper.ChatGroupMapper;
import com.smartscrm.server.mapper.GroupMemberEventMapper;
import com.smartscrm.server.mapper.GroupMemberStateMapper;
import com.smartscrm.server.web.vo.CustomerGroupVO;
import com.smartscrm.server.web.vo.GroupEventRowVO;
import com.smartscrm.server.web.vo.GroupMemberRowVO;
import com.smartscrm.server.web.vo.GroupRowVO;
import com.smartscrm.server.web.vo.MemberPageVO;
import java.util.List;
import org.springframework.stereotype.Service;

/** 读面：四个端点的取数都在这里，写入一律不在本类（分工与 P6 的 MessageQueryService 同形）。 */
@Service
public class GroupMemberQueryService {

    private final ChatGroupMapper groupMapper;
    private final GroupMemberStateMapper stateMapper;
    private final GroupMemberEventMapper eventMapper;
    private final MessageService messageService;

    public GroupMemberQueryService(ChatGroupMapper groupMapper, GroupMemberStateMapper stateMapper,
                                   GroupMemberEventMapper eventMapper, MessageService messageService) {
        this.groupMapper = groupMapper;
        this.stateMapper = stateMapper;
        this.eventMapper = eventMapper;
        this.messageService = messageService;
    }

    public PageResult<GroupRowVO> groups(long tenantId, long accountId, String q, int page, int size) {
        var p = groupMapper.selectGroupPage(new Page<>(page, size), tenantId, accountId, SearchPattern.like(q));
        return PageResult.of(p.getRecords(), p.getTotal(), p.getCurrent(), p.getSize());
    }

    /** 返回的不是 PageResult：§8 的 coverage/reason 属于「这一页的来源」，见 MemberPageVO 的理由。 */
    public MemberPageVO members(long tenantId, long accountId, String chatKey, Integer isInGroup, String role,
                                String q, int page, int size) {
        var account = messageService.resolveAccount(tenantId, accountId);
        var p = stateMapper.selectMemberPage(new Page<>(page, size), tenantId, accountId,
            account.platform(), chatKey, isInGroup, blankToNull(role), SearchPattern.like(q));
        var g = groupMapper.selectByUk(tenantId, account.platform(), accountId, chatKey);
        return new MemberPageVO(p.getRecords(), p.getTotal(), p.getCurrent(), p.getSize(),
            g == null ? null : g.getLastCoverage(),
            g == null ? null : g.getLastReconcileReason(),
            g == null ? null : g.getLastSnapshotAt());
    }

    public PageResult<GroupEventRowVO> events(long tenantId, long accountId, String chatKey, String eventType,
                                              int page, int size) {
        var account = messageService.resolveAccount(tenantId, accountId);
        var p = eventMapper.selectEventPage(new Page<>(page, size), tenantId, accountId,
            account.platform(), chatKey, blankToNull(eventType));
        return PageResult.of(p.getRecords(), p.getTotal(), p.getCurrent(), p.getSize());
    }

    public List<CustomerGroupVO> customerGroups(long tenantId, long accountId, long customerId) {
        var account = messageService.resolveAccount(tenantId, accountId);
        return stateMapper.selectGroupsByCustomer(tenantId, accountId, customerId);
    }

    /** Task 8 的导出取数复用这一条：不分页，一次给全（50 群上限在服务层拦，见 Task 8）。 */
    public List<GroupMemberRowVO> membersRaw(long tenantId, long accountId, String chatKey) {
        var account = messageService.resolveAccount(tenantId, accountId);
        return stateMapper.selectMembersAll(tenantId, accountId, account.platform(), chatKey);
    }

    private static String blankToNull(String v) {
        return v == null || v.isBlank() ? null : v;
    }
}
```

（`SearchPattern.like` 用仓库现有的那一个，`GroupMemberQueryService` 里 `import com.smartscrm.server.service.msg.SearchPattern;`——**不要再造第二份转义**。`selectMembersAll` 与 `selectMemberPage` 同 SQL、去掉 `Page` 参数。）

- [ ] **Step 4: Controller 四支**

```java
    @GetMapping("/groups")
    public ApiResponse<PageResult<GroupRowVO>> groups(@AuthenticationPrincipal AuthPrincipal principal,
                                                      @RequestParam Long accountId,
                                                      @RequestParam(required = false) String q,
                                                      @RequestParam(defaultValue = "1") int page,
                                                      @RequestParam(defaultValue = "20") int size) {
        return ApiResponse.ok(query.groups(principal.tenantId(), accountId, q, page, size));
    }

    @GetMapping("/group/members")
    public ApiResponse<MemberPageVO> members(@AuthenticationPrincipal AuthPrincipal principal,
                                             @RequestParam Long accountId,
                                             @RequestParam String chatKey,
                                             @RequestParam(required = false) Integer isInGroup,
                                             @RequestParam(required = false) String role,
                                             @RequestParam(required = false) String q,
                                             @RequestParam(defaultValue = "1") int page,
                                             @RequestParam(defaultValue = "50") int size) {
        return ApiResponse.ok(query.members(principal.tenantId(), accountId, chatKey, isInGroup, role, q, page, size));
    }

    @GetMapping("/group/events")
    public ApiResponse<PageResult<GroupEventRowVO>> events(@AuthenticationPrincipal AuthPrincipal principal,
                                                           @RequestParam Long accountId,
                                                           @RequestParam String chatKey,
                                                           @RequestParam(required = false) String eventType,
                                                           @RequestParam(defaultValue = "1") int page,
                                                           @RequestParam(defaultValue = "50") int size) {
        return ApiResponse.ok(query.events(principal.tenantId(), accountId, chatKey, eventType, page, size));
    }

    /** 客户抽屉那一节的数据源：不分页（一个客户所在群是个位数到几十的量级）。 */
    @GetMapping("/customer/{customerId}/groups")
    public ApiResponse<List<CustomerGroupVO>> customerGroups(@AuthenticationPrincipal AuthPrincipal principal,
                                                             @RequestParam Long accountId,
                                                             @PathVariable Long customerId) {
        return ApiResponse.ok(query.customerGroups(principal.tenantId(), accountId, customerId));
    }
```

Controller 的构造器补第五个依赖：`GroupMemberController(GroupMemberService service, GroupMemberQueryService query)`（与 `MessageController` 同形：一个写、一个读）。

- [ ] **Step 5: 构建、起服、冒烟一次**

```bash
cd /d/SmartSCRM/apps/server && export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18" && set -o pipefail
powershell -NoProfile -ExecutionPolicy Bypass -File tmp/p7b-kill8180.ps1
./mvnw test 2>&1 | tail -20
nohup ./mvnw spring-boot:run > /d/SmartSCRM/tmp/p8a-server.log 2>&1 &
```
条件轮询到启动完成（不要固定 sleep）：

```bash
node -e 'const fs=require("fs");(async()=>{for(let i=0;i<120;i++){const s=fs.readFileSync("D:/SmartSCRM/tmp/p8a-server.log","utf8");if(/Started ScrmServerApplication/.test(s)){console.log("UP");process.exit(0)}if(/APPLICATION FAILED TO START/.test(s)){console.log("FAILED\n"+s.slice(-3000));process.exit(1)}await new Promise(r=>setTimeout(r,1000))}console.log("TIMEOUT");process.exit(2)})()'
```
冒烟：`GET /api/group-members/groups?accountId=<已绑定账号>&page=1&size=20` 带 JWT 打一次，期望 `code=0` 且 `data.records` 为 `[]`（还没建档）。**这一条只证「路由通、租户闸通、分页不炸」**，任何断言都归 Task 13。

- [ ] **Step 6: 提交**

```bash
git add apps/server/src/main/java/com/smartscrm/server
git commit -m "$(cat <<'EOF'
feat(P8/群成员): 四个读端点（群列表/成员/流水/客户反查）

每条都带 account_id：三把唯一键里都有它，少一维就是跨账号串数据。
members 返回 MemberPageVO 而不是 PageResult——coverage 与 reason 是这一页的来源属性，
塞进 records 里就得为每行重复一份。
EOF
)"
```

---

## Task 8: 第五支读端点 `export-rows`（14 列取数 + 后端行序）

**Files:**
- Modify: `apps/server/src/main/java/com/smartscrm/server/mapper/GroupMemberStateMapper.java`（+ `selectMembersForExport`）
- Modify: `apps/server/src/main/java/com/smartscrm/server/mapper/ChatGroupMapper.java`（+ `selectTitlesByKeys`）
- Modify: `apps/server/src/main/java/com/smartscrm/server/mapper/ChatMessageMapper.java`（+ `senderActivity`）
- Modify: `apps/server/src/main/java/com/smartscrm/server/service/GroupMemberQueryService.java`（+ `exportRows`）
- Modify: `apps/server/src/main/java/com/smartscrm/server/web/GroupMemberController.java`（+ 一支 `@GetMapping`）
- Create: `apps/server/src/main/java/com/smartscrm/server/web/vo/GroupExportRowVO.java`
- Test: `apps/server/src/test/java/com/smartscrm/server/service/GroupExportOrderTest.java`

**Interfaces:**
- Consumes: Task 7 的 `GroupMemberQueryService`（同一个类，同一个 `messageService.resolveAccount` 租户闸）、Task 1 的 `chat_group.title`、Task 6 写入的 `group_member_state` 列、V8 的 `chat_message`
- Produces：
  - `GET /api/group-members/group/members/export-rows?accountId&chatKeys`（`chatKeys` 逗号分隔）→ `List<GroupExportRowVO>`
  - `GroupExportRowVO(seq:int, groupName:String, chatKey:String, phone:String, displayName:String, roleType:String, isInGroup:Integer, latestJoinAt:LocalDateTime, joinCount:Integer, latestLeaveAt:LocalDateTime, exitMethod:String, firstSeenAt:LocalDateTime, lastChatAt:LocalDateTime, dayCount:Integer, totalCount:Integer)` —— **15 个字段、14 个可导列**：`seq` 就是「序号」列，`firstSeenAt` 不导出（留着给界面，见技术要点第 6 条）
  - 错误码：`40000`（`chatKeys` 空 / 群键不属本平台）、`40016`（超过 50 群）

**技术要点**

1. **行序的唯一出处在这里**（R22）。三段规则逐字来自 spec §10：群按 `chatKeys` 的**传入顺序**、群内按 `latest_join_at` **升序**、`latest_join_at IS NULL` 沉到该群末尾并按 `first_seen_at` 升序；`seq` 是**整份文件内连续**（跨群不重置）。主进程与渲染层都不许再排一次——排了就出现「界面上的顺序 ≠ 文件里的顺序」，而用户会拿文件对界面。**判别力**：`GroupExportOrderTest` 用一组打乱输入顺序的 mock 行断言输出 `seq` 恰好是 1..N 且群块顺序等于入参顺序；把 `Comparator` 里那段「NULL 沉底」删掉，第二条断言必红（不是靠肉眼排序）。
2. **`chatKeys` 先去重再进 `IN`**：`["A","A","B"]` 若原样进 `selectMembersForExport`，A 群的每个人会出现两次，`seq` 也跟着双计。去重必须在**计数与查询之前**，而 50 群上限判的是**去重之后**的数量——否则用户把同一个群勾两遍就能绕过上限（`EXPORT_GROUP_MAX` 那条拦的是工作量，不是列表长度）。**归因**：`seq` 只由这一步写，Excel 里那一列不许重算。
3. **「当日」锚定的是这个人的最近发言日，不是导出执行日**（spec §7 钉死的歧义）。所以聚合 SQL 是「一条 GROUP BY 出 `MAX(msg_time)`/`COUNT(*)`，再用派生表把同一 `msg_time` 的**那一天**框出来」，不能写成 `msg_time >= CURDATE()`——那样今天 00:00 之前发言的人全部 `dayCount=0`，而 23:58 导出和 00:02 导出会给出两份不同的文件，同一份数据两种答案。**坑**：`DATE(m.msg_time) = DATE(x.d)` 这个比较只能待在 `SUM(CASE …)` 里；把它挪进 `WHERE` 就变成按最近发言日过滤整张表，`totalCount` 会跟着塌成当日条数——两个数一下就错了，而且错得很像「合理」。
4. **聚合键的连接格式是 `chatKey|senderKey`，且必须容忍 sender 侧的形态差异**：`chat_message.sender_key` 来自 `normalizeWa` 的 `widKeyOf(raw.author)`，只在 `chatKey.endsWith('@g.us')` 时填；`group_member_state.member_key` 来自 `getParticipants()` 的 `id._serialized`。两者今天同为 `…@c.us`，但 wa-js 在部分链路里回 `…@s.whatsapp.net`。**这一格属待验证**（§15#3），落实方式是 `exportRows` 末尾打一行 `log("group-export matched={}/{}")`：匹配率明显低于 1 就是形态漂移，而不是「这些人真的没发过言」。**不许**为了好看把未匹配的写成 0 以外的任何值——NULL 与 0 在界面口径里是两件事（没数据 / 真没发言）。
5. **未知 `chatKey` 不报错，出 0 行**：还没建档的群导出成空块是正确行为，把它报错会让「勾选全部群」变成必然失败。这一条要在测试里断言一次（传一个库里没有的键 ⇒ 结果里没有该键的行，且不抛）。
6. **`firstSeenAt` 进 VO 但不进 14 列**：spec §8 要求界面上把「首次见到」与「进群时间」区分开，弹层需要这一列；导出列序是固定契约（§10），多一列就破坏下游模板。VO 与导出列的差集是刻意的，注释要写死这一句。
7. **本任务的验证档次**：`./mvnw test`（Java 单测证行序与去重，mapper 全 mock）；真实取数、列值与 `dayCount` 的实测归 Task 13 的 HTTP 契约腿；落盘文件内容归 Task 12 的构建产物实测 + Task 16 的 CDP 腿（真实导出落盘 = 用户在场放行）。

- [ ] **Step 1: 先写失败的行为单测（行序 + 去重 + 上限）**

```java
package com.smartscrm.server.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.smartscrm.server.common.BizException;
import com.smartscrm.server.mapper.ChatGroupMapper;
import com.smartscrm.server.mapper.ChatMessageMapper;
import com.smartscrm.server.mapper.GroupMemberEventMapper;
import com.smartscrm.server.mapper.GroupMemberStateMapper;
import com.smartscrm.server.web.vo.GroupExportRowVO;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

/**
 * 只测 `exportRows` 的三段行序规则、去重与 50 群上限：三个 mapper 与 `MessageService` 全 mock，不连库。
 * <p>
 * 这一份**不**证明 SQL 真的按 `chatKeys` 取到了行、也不证明「当日」在 MySQL 侧算对了那一天——
 * 那些是 Task 13 的 HTTP 契约腿（实测）。这里能证的只有「拿到这批行之后，顺序与序号是谁定的」。
 */
class GroupExportOrderTest {

    private static GroupExportRowVO row(String chatKey, String memberKey, LocalDateTime joinAt,
                                        LocalDateTime firstSeen) {
        var r = new GroupExportRowVO();       // @Data 可变 POJO（R24）：MyBatis 行载体
        r.setChatKey(chatKey);
        r.setMemberKey(memberKey);
        r.setLatestJoinAt(joinAt);
        r.setFirstSeenAt(firstSeen);
        return r;
    }

    private static GroupMemberQueryService with(List<GroupExportRowVO> members) {
        var groupMapper = mock(ChatGroupMapper.class);
        var stateMapper = mock(GroupMemberStateMapper.class);
        var messageMapper = mock(ChatMessageMapper.class);
        var messageService = mock(MessageService.class);
        when(messageService.resolveAccount(anyLong(), anyLong()))
            .thenReturn(new MessageService.ResolvedAccount(7L, "whatsapp", 1));
        // new ArrayList<>：实现里要对返回值 sort，List.of() 的不可变列表会抛 UnsupportedOperationException，
        // 那是驱动的错不是产品的错——别让一次假失败混进这一格。
        when(stateMapper.selectMembersForExport(any(), any(), any(), any())).thenReturn(new ArrayList<>(members));
        when(groupMapper.selectTitlesByKeys(any(), any(), any(), any())).thenReturn(List.of());
        when(messageMapper.senderActivity(any(), any(), any(), any())).thenReturn(List.of());
        return new GroupMemberQueryService(groupMapper, stateMapper, mock(GroupMemberEventMapper.class),
            messageService, messageMapper);
    }

    private static List<String> keys(GroupExportRowVO... rows) {
        return java.util.Arrays.stream(rows).map(GroupExportRowVO::getMemberKey).toList();
    }

    @Test
    void groupBlocksFollowInputOrderAndSeqIsContinuousAcrossGroups() {
        var s = with(List.of(
            row("2@s-1@g.us", "b@c.us", LocalDateTime.of(2026, 1, 5, 9, 0), LocalDateTime.of(2026, 1, 5, 9, 0)),
            row("1@s-1@g.us", "a@c.us", LocalDateTime.of(2026, 1, 2, 9, 0), LocalDateTime.of(2026, 1, 2, 9, 0)),
            row("2@s-1@g.us", "c@c.us", LocalDateTime.of(2026, 1, 3, 9, 0), LocalDateTime.of(2026, 1, 3, 9, 0))));
        var out = s.exportRows(1L, 7L, List.of("2@s-1@g.us", "1@s-1@g.us"));

        assertEquals(List.of("2@s-1@g.us", "2@s-1@g.us", "1@s-1@g.us"),
            out.stream().map(GroupExportRowVO::getChatKey).toList());
        // 群 2 内部按 latest_join_at 升序：c(1-03) 排在 b(1-05) 之前
        assertEquals(List.of("c@c.us", "b@c.us", "a@c.us"), keys(out.toArray(GroupExportRowVO[]::new)));
        // 序号跨群连续，不在第二个群块重置
        assertEquals(List.of(1, 2, 3), out.stream().map(GroupExportRowVO::getSeq).toList());
    }

    @Test
    void nullJoinAtSinksToGroupEndOrderedByFirstSeen() {
        var s = with(List.of(
            row("g-1@g.us", "late-null@c.us", null, LocalDateTime.of(2026, 3, 1, 0, 0)),
            row("g-1@g.us", "has-join@c.us", LocalDateTime.of(2026, 1, 1, 0, 0), LocalDateTime.of(2025, 1, 1, 0, 0)),
            row("g-1@g.us", "early-null@c.us", null, LocalDateTime.of(2026, 2, 1, 0, 0))));
        var out = s.exportRows(1L, 7L, List.of("g-1@g.us"));
        // 有 join 的排前面（哪怕 first_seen_at 更早），NULL 那一档内部再按 first_seen_at 升序
        assertEquals(List.of("has-join@c.us", "early-null@c.us", "late-null@c.us"),
            out.stream().map(GroupExportRowVO::getMemberKey).toList());
    }

    @Test
    void duplicateKeysAreCollapsedBeforeTheCapAndDoNotDoubleRows() {
        var s = with(List.of(row("g-1@g.us", "a@c.us", null, LocalDateTime.of(2026, 1, 1, 0, 0))));
        var out = s.exportRows(1L, 7L,
            IntStream.rangeClosed(1, 60).mapToObj(i -> "g-1@g.us").toList());
        assertEquals(1, out.size());          // 只出一块：去重在 IN 查询之前
        assertEquals(1, out.get(0).getSeq());
    }

    @Test
    void unknownKeyYieldsNoRowsWithoutThrowing() {
        var s = with(List.of());
        assertEquals(0, s.exportRows(1L, 7L, List.of("never-built-1@g.us")).size());
    }

    @Test
    void moreThanFiftyDistinctGroupsIsRejectedWithItsOwnCode() {
        var s = with(List.of());
        var keys = IntStream.rangeClosed(1, 51).mapToObj(i -> i + "-x-1@g.us").toList();
        var e = assertThrows(BizException.class, () -> s.exportRows(1L, 7L, keys));
        assertEquals(40016, e.getCode());
    }

    @Test
    void emptyKeysIsRejectedNotSilentlyEmpty() {
        var s = with(List.of());
        assertEquals(40000, assertThrows(BizException.class, () -> s.exportRows(1L, 7L, List.of())).getCode());
    }

    @Test
    void keyThatIsNotAGroupOfThisPlatformIsRejected() {
        var s = with(List.of());
        // 单聊键混进导出清单：不是"读不到"，是"这个请求本身不合法"
        assertEquals(40000,
            assertThrows(BizException.class, () -> s.exportRows(1L, 7L, List.of("8613000000000@c.us"))).getCode());
    }
}
```

```bash
cd /d/SmartSCRM/apps/server && export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18" && set -o pipefail
./mvnw test -Dtest=GroupExportOrderTest 2>&1 | tail -30
```
期望：**编译失败**（`GroupExportRowVO`、`selectMembersForExport`、`selectTitlesByKeys`、`senderActivity`、`exportRows` 还不存在）。这就是这一步的"红"——`exportRows` 的构造器还从 4 个依赖变成 5 个，测试里那句 `new GroupMemberQueryService(..., messageMapper)` 也在同一处把它钉住。

- [ ] **Step 2: VO 与三支 SQL**

```java
package com.smartscrm.server.web.vo;

import java.time.LocalDateTime;
import lombok.Data;

/**
 * 导出的行载体。MyBatis 直接填前 11 列（setter 自动映射，按列名不按列序），
 * `groupName` / `seq` / `lastChatAt` / `dayCount` / `totalCount` 由 `GroupMemberQueryService#exportRows` 填。
 * <p>
 * 可变是刻意的（R24）：record 当 `@Select` 返回类型会走「按列序」的构造器自动映射，SELECT 清单一改就错位静默。
 * <p>
 * `memberKey` 与 `firstSeenAt` **不进 14 列**：前者是行身份（界面与日志要用），后者是 §8 的「首次见到」，
 * 导出列序是固定契约（spec §10），多一列就破坏下游模板。
 */
@Data
public class GroupExportRowVO {
    private Integer seq;
    private String groupName;
    private String chatKey;
    private String memberKey;
    private String phone;
    private String displayName;
    private String roleType;
    private Integer isInGroup;
    private LocalDateTime latestJoinAt;
    private Integer joinCount;
    private LocalDateTime latestLeaveAt;
    private String exitMethod;
    private LocalDateTime firstSeenAt;
    private LocalDateTime lastChatAt;
    private Integer dayCount;
    private Integer totalCount;
}
```

```java
// ChatGroupMapper.java 追加：群名一次读，别在 50 个群里做 50 次单键查询。
    @Select("<script>SELECT chat_key, title FROM chat_group"
        + " WHERE tenant_id = #{tenantId} AND account_id = #{accountId} AND platform = #{platform}"
        + " AND chat_key IN <foreach item='k' collection='keys' open='(' separator=',' close=')'>#{k}</foreach>"
        + "</script>")
    List<ChatGroup> selectTitlesByKeys(@Param("tenantId") Long tenantId, @Param("accountId") Long accountId,
        @Param("platform") String platform, @Param("keys") List<String> keys);
```

```java
// GroupMemberStateMapper.java 追加：列清单与 selectMembersAll 同份，单键谓词换成 IN。
    // ORDER BY 这一句是"读起来顺"，不是行序规则的出处——最终顺序由 exportRows 按入参重排（R22）。
    @Select("<script>SELECT s.chat_key, s.member_key, s.phone, s.display_name, s.role_type, s.is_in_group,"
        + " s.latest_join_at, s.join_count, s.latest_leave_at, s.exit_method, s.first_seen_at"
        + " FROM group_member_state s WHERE s.tenant_id = #{tenantId} AND s.account_id = #{accountId}"
        + " AND s.platform = #{platform}"
        + " AND s.chat_key IN <foreach item='k' collection='keys' open='(' separator=',' close=')'>#{k}</foreach>"
        + " ORDER BY s.chat_key, s.latest_join_at IS NULL, s.latest_join_at, s.first_seen_at, s.id"
        + "</script>")
    List<GroupExportRowVO> selectMembersForExport(@Param("tenantId") Long tenantId,
        @Param("accountId") Long accountId, @Param("platform") String platform,
        @Param("keys") List<String> keys);
```

```java
// ChatMessageMapper.java 追加（行载体也放本文件：它只在 mapper 与 exportRows 之间活一次，
// 独立成一个只出现两处的 VO 文件只会让人以为它是 wire 形状）
    class SenderActivityRow {
        private String chatKey;
        private String senderKey;
        private LocalDateTime lastChatAt;
        private Long totalCount;
        private Long dayCount;

        public String getChatKey() { return chatKey; }
        public void setChatKey(String chatKey) { this.chatKey = chatKey; }
        public String getSenderKey() { return senderKey; }
        public void setSenderKey(String senderKey) { this.senderKey = senderKey; }
        public LocalDateTime getLastChatAt() { return lastChatAt; }
        public void setLastChatAt(LocalDateTime lastChatAt) { this.lastChatAt = lastChatAt; }
        public Long getTotalCount() { return totalCount; }
        public void setTotalCount(Long totalCount) { this.totalCount = totalCount; }
        public Long getDayCount() { return dayCount; }
        public void setDayCount(Long dayCount) { this.dayCount = dayCount; }
    }

    /**
     * 群内按人的发言活动量：最近发言时刻、总条数、以及「最近发言那一天」的条数。
     * <p>
     * 「那一天」锚定的是**这个人自己的 MAX(msg_time) 所在日**（spec §7 钉死），不是导出执行日。
     * 写成 `m.msg_time >= CURDATE()` 会同时犯两个错：今天 00:00 之前发过言的人 `dayCount` 变 0，
     * 且同一份库在 23:58 与 00:02 导出两份不同结果——那是读数规则变了，不是数据变了。
     * <p>
     * `DATE(m.msg_time) = DATE(x.d)` 只许留在 `SUM(CASE …)` 里。挪进 WHERE 就变成"只统计最近发言那一天的行"，
     * `totalCount` 会跟着塌成 `dayCount`，两个数一起错，而且错得看起来很合理。
     * <p>
     * `sender_key IS NOT NULL` 在群键下按 V8 之后恒真（只有群行才填它，见 `normalizeWa` 的
     * `chatKey.endsWith('@g.us')` 分支），留着当不变量守卫：真出现 NULL 行说明采集侧填法变了，
     * 那要在这里被排除，而不是让单聊的发言混进群统计。
     */
    @Select("<script>SELECT m.chat_key AS chatKey, m.sender_key AS senderKey,"
        + " MAX(m.msg_time) AS lastChatAt, COUNT(*) AS totalCount,"
        + " SUM(CASE WHEN DATE(m.msg_time) = DATE(x.d) THEN 1 ELSE 0 END) AS dayCount"
        + " FROM chat_message m INNER JOIN ("
        + "   SELECT chat_key, sender_key, MAX(msg_time) AS d FROM chat_message"
        + "   WHERE tenant_id = #{tenantId} AND account_id = #{accountId} AND platform = #{platform}"
        + "     AND sender_key IS NOT NULL"
        + "     AND chat_key IN <foreach item='k' collection='keys' open='(' separator=',' close=')'>#{k}</foreach>"
        + "   GROUP BY chat_key, sender_key"
        + " ) x ON x.chat_key = m.chat_key AND x.sender_key = m.sender_key"
        + " WHERE m.tenant_id = #{tenantId} AND m.account_id = #{accountId} AND m.platform = #{platform}"
        + "   AND m.sender_key IS NOT NULL"
        + "   AND m.chat_key IN <foreach item='k' collection='keys' open='(' separator=',' close=')'>#{k}</foreach>"
        + " GROUP BY m.chat_key, m.sender_key"
        + "</script>")
    List<SenderActivityRow> senderActivity(@Param("tenantId") Long tenantId, @Param("accountId") Long accountId,
        @Param("platform") String platform, @Param("keys") List<String> keys);
```

- [ ] **Step 3: `exportRows` 服务方法**

构造器加第 5 个依赖（`ChatGroupMapper`、`GroupMemberStateMapper`、`GroupMemberEventMapper`、`MessageService` 那四支顺序不动，`ChatMessageMapper` 追加在末尾），并加一行 logger（`MessageService` 同形）：

```java
    private static final org.slf4j.Logger log =
        org.slf4j.LoggerFactory.getLogger(GroupMemberQueryService.class);
```

```java
    /** 导出的群数上限（spec §10）。拦在服务层而不只拦在界面：界面那颗按钮之外还有手搓请求这条路。 */
    public static final int EXPORT_GROUP_MAX = 50;

    public List<GroupExportRowVO> exportRows(long tenantId, long accountId, List<String> rawKeys) {
        if (rawKeys == null || rawKeys.isEmpty()) {
            throw new BizException(40000, "chatKeys 不能为空");
        }
        var account = messageService.resolveAccount(tenantId, accountId);   // 租户闸 + platform，复用不重写
        // 去重早于计数：同一群勾两遍不许绕过 50 群上限，也不许让每个人都出现两次（LinkedHashSet 保住入参顺序）。
        var keys = new ArrayList<>(new LinkedHashSet<>(
            rawKeys.stream().filter(java.util.Objects::nonNull).map(String::trim)
                .filter(s -> !s.isEmpty()).toList()));
        if (keys.isEmpty()) {
            throw new BizException(40000, "chatKeys 全是空串");
        }
        if (keys.size() > EXPORT_GROUP_MAX) {
            throw new BizException(40016, "一次最多导出 " + EXPORT_GROUP_MAX + " 个群，当前 " + keys.size() + " 个");
        }
        for (String k : keys) {
            if (!ChatKeys.matchesPlatform(account.platform(), k) || !ChatKeys.isGroup(k)) {
                throw new BizException(40000, "群键与账号平台不匹配: " + k);
            }
        }
        var members = stateMapper.selectMembersForExport(tenantId, accountId, account.platform(), keys);
        var titles = new HashMap<String, String>();
        for (var g : groupMapper.selectTitlesByKeys(tenantId, accountId, account.platform(), keys)) {
            titles.put(g.getChatKey(), g.getTitle());
        }
        var activity = new HashMap<String, ChatMessageMapper.SenderActivityRow>();
        for (var a : messageMapper.senderActivity(tenantId, accountId, account.platform(), keys)) {
            activity.put(a.getChatKey() + "|" + a.getSenderKey(), a);
        }
        int matched = 0;
        for (var m : members) {
            var a = activity.get(m.getChatKey() + "|" + m.getMemberKey());
            if (a == null) continue;          // 没匹配上就留 NULL：宁缺不假（0 会说"真没发过言"）
            matched++;
            m.setLastChatAt(a.getLastChatAt());
            m.setTotalCount(a.getTotalCount() == null ? null : a.getTotalCount().intValue());
            m.setDayCount(a.getDayCount() == null ? null : a.getDayCount().intValue());
        }
        // 匹配率明显低于成员数 = member_key 与 sender_key 的 wid 形态漂了（spec §15#3，待验证）。
        // 这行日志就是那一格的取证入口，删了之后"导出三列全空"只能靠猜。
        log.info("group-export account={} groups={} members={} activityMatched={}",
            accountId, keys.size(), members.size(), matched);

        // 群块顺序 = 入参顺序（不是 id 顺序、不是字典序）。缺失的键（库里没建档）排最后，反正它没有行。
        var groupOrder = new HashMap<String, Integer>();
        for (int i = 0; i < keys.size(); i++) {
            groupOrder.put(keys.get(i), i);
        }
        members.sort(Comparator
            .comparing((GroupExportRowVO r) -> groupOrder.getOrDefault(r.getChatKey(), Integer.MAX_VALUE))
            .thenComparing(GroupExportRowVO::getLatestJoinAt, Comparator.nullsLast(Comparator.naturalOrder()))
            .thenComparing(GroupExportRowVO::getFirstSeenAt, Comparator.nullsLast(Comparator.naturalOrder()))
            .thenComparing(GroupExportRowVO::getMemberKey, Comparator.nullsLast(Comparator.naturalOrder())));
        for (int i = 0; i < members.size(); i++) {
            var r = members.get(i);
            r.setSeq(i + 1);                                   // 跨群连续，不重置
            r.setGroupName(titles.get(r.getChatKey()));        // 没登记过的群名给 NULL，界面/Excel 自己兜
        }
        return members;
    }
```

新增 import：`BizException`、`ChatKeys`（`service/msg/ChatKeys`）、`ChatMessageMapper`、`java.util.{ArrayList,Comparator,HashMap,LinkedHashSet}`。
`Comparator.comparing(...)` 的第一支必须写成带显式类型的 lambda（`(GroupExportRowVO r) -> …`），否则 `thenComparing` 那几支的类型推断会塌成 `Object` 而编译失败——这是 Java 泛型链的既有坑，不是本任务的发明。

- [ ] **Step 4: Controller 那一支**

```java
    /** 导出取数：行序与序号都在后端（R22），主进程只管编码与落盘。 */
    @GetMapping("/group/members/export-rows")
    public ApiResponse<List<GroupExportRowVO>> exportRows(@AuthenticationPrincipal AuthPrincipal principal,
                                                          @RequestParam Long accountId,
                                                          @RequestParam List<String> chatKeys) {
        return ApiResponse.ok(query.exportRows(principal.tenantId(), accountId, chatKeys));
    }
```

`@RequestParam List<String> chatKeys` 由 Spring 按逗号拆好——**所以群键里不能含逗号**。WA 群键是 `<数字>-<数字>@g.us`，没有逗号（读码 `shared/chatKeys.ts` 的群键成形）；这条前提写进方法注释，将来接 TG 的群键形态时要回来判一次（TG 的结构本期已含、采集以后，spec §2#8）。

- [ ] **Step 5: 跑到绿 + 全量 + 起服冒烟**

```bash
cd /d/SmartSCRM/apps/server && export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18" && set -o pipefail
./mvnw test -Dtest=GroupExportOrderTest 2>&1 | tail -20
./mvnw test 2>&1 | tail -20
powershell -NoProfile -ExecutionPolicy Bypass -File tmp/p7b-kill8180.ps1
nohup ./mvnw spring-boot:run > /d/SmartSCRM/tmp/p8a-server.log 2>&1 &
```
用 Task 7 Step 5 那条条件轮询等到 `Started ScrmServerApplication`，再带 JWT 打两跳：

1. `GET /api/group-members/group/members/export-rows?accountId=<绑定账号>&chatKeys=<库里已有群键>` ⇒ `code=0`、`data` 是数组（空数组也算通，端点存在与租户闸生效才是这一跳要证的）。
2. `GET ...?accountId=<绑定账号>&chatKeys=` ⇒ 期望 `code=40000`。**这一格区分「端点存在」与「校验生效」**：只测正向那一格的话，把 `keys.isEmpty()` 那段删掉也不会红。
3. `GET ...?chatKeys=1-1@g.us,1-1@g.us,...（51 个不同键）` ⇒ 期望 `code=40016`，而 50 个不同键 ⇒ `code=0`。上限那一格要有 50/51 两个相邻读数，只测 51 无法证明不是"随便多少都拦"。

- [ ] **Step 6: 提交**

```bash
git add apps/server/src/main/java/com/smartscrm/server apps/server/src/test/java/com/smartscrm/server
git commit -m "$(cat <<'EOF'
feat(P8/群成员): export-rows 取数与后端行序

群块顺序=入参顺序、群内 latest_join_at 升序、NULL 沉底按 first_seen_at、序号跨群连续不重置。
「当日发言数」锚定这个人自己的最近发言日，不是导出执行日——同一份库两次导出必须同答案。
去重早于计数：同一群勾两遍不许绕过 50 群上限，也不许让成员行出现两次。

Co-Authored-By: Qoder <noreply@qoder.com>
EOF
)"
```

---

## Task 9: 主进程 `groupCollect/api.ts`（泵用的三跳）+ unit 闸门接线

**Files:**
- Modify: `apps/desktop/src/shared/groupMembers.ts`（追加 POST 出入参与读侧行 wire 类型；Task 2 建的那一份的续篇）
- Create: `apps/desktop/src/main/services/groupCollect/api.ts`
- Create: `apps/desktop/src/main/services/groupCollect/api.test.ts`
- Modify: `apps/desktop/tsconfig.unit.json`（include 补 `src/main/services/groupCollect/**`）
- Modify: `apps/desktop/package.json`（`test:unit` 的 glob 列表补一条）

**Interfaces:**
- Consumes：Task 5 的 `GroupBatchDTO` / `GroupBatchVO`、Task 7 的 `PageResult<GroupRowVO>`、Task 8 的 `List<GroupExportRowVO>`——字段名逐字取自那三节。
- Produces（Task 10 的攒批器、Task 11 的泵、Task 12 的导出全从这里取型）：
  - shared：`GroupReconcileReason` `GroupSnapshotPayload` `GroupBatchPayload` `GroupBatchResult` `PageWire<T>` `GroupRowWire` `GroupExportRowWire`
  - api：`type Fetcher`、`interface GroupApiOptions { fetcher: Fetcher; onError?: (where: string, e: unknown) => void }`、`createGroupApi(opts): GroupApi`、`type GroupApi = ReturnType<typeof createGroupApi>`
    - `postBatch(payload: GroupBatchPayload): Promise<GroupBatchResult | null>`
    - `groups(accountId: number, page: number, size: number): Promise<PageWire<GroupRowWire> | null>`
    - `exportRows(accountId: number, chatKeys: string[]): Promise<GroupExportRowWire[] | null>`

**技术要点**

- **工厂形状取 `batchApi.ts` 那一份，不取 `msgApi.ts` 那一份**：`msgApi` 是 `{ token, apiBase, fetchImpl }` 的老形状，每次调用现取一次令牌，**没有 401→刷新→重试**；`batchApi` 走 `authedFetch`（`main/services/authedFetch.ts`：401 时共用一条 in-flight 的 `refreshAccessToken`，只重放一次）。泵的 `POST /batch` 一旦赶上令牌到期，老形状会把整批事件变成 401 丢弃，而新形状只是慢一跳。**这条判据写给下一个采集面用**：主进程新开的 HTTP 面默认接 `authedFetch`，除非它比消息量小三个数量级。
- **只有三跳，不是六跳**：`/group/members`、`/group/events`、`/customer/{id}/groups` 三支不进主进程——渲染层有自己的 `renderer/src/lib/http.ts`（自带 token 对、401 刷新链、`code!==0 ⇒ throw ApiError`），P6/P7 的读面全走它。主进程只留「泵要写的」（`postBatch`）、「泵要读的」（`groups`）、「导出要落盘的」（`exportRows`）。**少写的三跳不是偷懒**：把它们做成 IPC 转发会得到三份没人调用的代码 + 两条 IPC 白名单，而界面将来读它们时用的是渲染层那一份。记 R26。
- **`null` 只有一种含义：这一跳没成**（非 2xx / `code!==0` / `code=0` 但缺 `data` / `fetcher` 抛，四类都落到 `onError` 再塌 `null`）。Task 11 的泵靠它区分「重试一次」与「放弃这一轮」；`GroupBatchResult` 里 `eventsAccepted=0` 是**成了但一条没收**，两者混成一件事就会让泵对着一个已经写坏的后端一直重试。这与 `batchApi.retryFailed` 当年把「没成」与「没有 failed 行」分开是同一格教训。
- **`exportRows` 的分隔符不能被编码**：后端签名是 `@RequestParam List<String> chatKeys`，Spring 按**裸逗号**拆分。正确做法是逐个 `encodeURIComponent` 之后 `join(',')`；整串编码会把分隔符变成 `%2C`，Spring 就收到一个「50 个群键黏在一起」的怪键，导出静默返回 0 行。**判别力**：测试断言 path 里既有 `%40`（每个 `@` 被编码）又有裸 `,`（分隔符没被编码）——只断言「不含 `%2C`」的话，把整个 join 结果再编码一次的实现也能过（`@` 也没编码），而那恰恰是坏的。
- **群键里不能有逗号**这条前提在 Task 8 的注释里已经钉过（WA 群键 `<数字>-<数字>@g.us`）；`exportRows` 不做逗号剥离，剥离就是把前提当参数校验糊过去。
- **50 个键的 URL 长度 ~1.5KB**，远在 Tomcat 默认 8KB 请求头上限内；**不要**为了「将来也许能导 500 群」把它改成 POST——那一改行序契约（R22）就要多一处出口。
- **`onError` 自己不能把这一跳弄挂**：`note()` 的 `try/catch` 是「全文件返回成功与否、不抛」这条口径的兜底（`batchApi.ts:31-39` 同形），日志实现抛异常不该变成泵的投递失败。
- **读侧类型放 `shared/` 而不是 `api.ts`**：`GroupRowWire` / `GroupExportRowWire` 的第二个读者是渲染层（Task 14/15）与主进程导出（Task 12），渲染层不 import `main/**`。spec §4 末行那条「字段命名与序列化只在 shared 定一处，两侧都从它取型」在这里同样成立。记 R27。
- **`groups` 的 `size` 由调用方给**，api 层不设默认值：泵传 `MAX_GROUPS_PER_BUILD`（200，见 Task 11 与 R25），界面走渲染层自己的 hook 不经过这里。在 api 层藏一个默认页大小，等于让下一个调用者猜分页边界。

- [ ] **Step 1: 写失败的 JS 单测**

```ts
// src/main/services/groupCollect/api.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createGroupApi } from './api.ts'
import type { GroupBatchPayload } from '../../../shared/groupMembers.ts'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const payload: GroupBatchPayload = {
  accountId: 7,
  events: [{
    chatKey: '120363111@g.us',
    memberKey: '8613800000000@c.us',
    eventType: 'added',
    occurredAtEpochSec: 1_700_000_000,
    dedupKey: 'true_120363111@g.us_120363111@g.us_3_out',
    source: 'system_message'
  }]
}

test('postBatch：信封 code=0 才认，返回 data 原文；path 与 body 逐字可查', async () => {
  const calls: { path: string; body: string }[] = []
  const api = createGroupApi({
    fetcher: async (path, init) => {
      calls.push({ path, body: String(init.body) })
      return json({
        code: 0,
        message: 'ok',
        data: {
          eventsAccepted: 1, eventsDuplicated: 0, membersUpserted: 0,
          reconciled: true, coverage: null, reason: 'first_build', reasons: []
        }
      })
    }
  })
  const out = await api.postBatch(payload)
  assert.equal(out?.reason, 'first_build')
  assert.equal(out?.eventsAccepted, 1)
  assert.equal(calls[0].path, '/api/group-members/batch')
  assert.ok(calls[0].body.includes('"accountId":7'), calls[0].body)
  assert.ok(calls[0].body.includes('"source":"system_message"'), calls[0].body)
})

test('groups：accountId/page/size 进 query，整页原样返回（泵要的是 lastSnapshotAt 与 isFinal）', async () => {
  const seen: string[] = []
  const api = createGroupApi({
    fetcher: async (path) => {
      seen.push(path)
      return json({ code: 0, data: {
        records: [{
          chatKey: '120363111@g.us', title: 'G', participantCount: 30, inGroupCount: 28,
          lastSnapshotAt: '2026-09-30T10:00:00', snapshotCount: 2, isFinal: 0,
          lastCoverage: 0.9333, lastReconcileReason: 'ok', lastEventAt: null
        }],
        total: 1, page: 1, pageSize: 200
      } })
    }
  })
  const out = await api.groups(7, 1, 200)
  assert.equal(seen[0], '/api/group-members/groups?accountId=7&page=1&size=200')
  assert.equal(out?.records[0].lastSnapshotAt, '2026-09-30T10:00:00')
  assert.equal(out?.pageSize, 200)
})

// 这一格是全文件最容易静默坏掉的地方：分隔符一旦被编码，后端收到一个 50 群黏在一起的键，
// 导出静默返回 0 行——而「不含 %2C」这种断言拦不住「整串没编码」（那样 @ 也没编码，同样坏）。
test('exportRows：每个键单独编码，分隔符保持裸逗号', async () => {
  const seen: string[] = []
  const api = createGroupApi({
    fetcher: async (path) => {
      seen.push(path)
      return json({ code: 0, data: [] })
    }
  })
  await api.exportRows(7, ['120363111-1@g.us', '120363222-2@g.us'])
  assert.equal(
    seen[0],
    '/api/group-members/group/members/export-rows?accountId=7' +
      '&chatKeys=120363111-1%40g.us,120363222-2%40g.us'
  )
})

test('空 chatKeys 不发请求：导出是主进程点的，空名单该由调用方拦，别把 `chatKeys=` 发出去', async () => {
  let called = 0
  const errors: string[] = []
  const api = createGroupApi({
    fetcher: async () => { called += 1; return json({ code: 0, data: [] }) },
    onError: (where) => errors.push(where)
  })
  assert.equal(await api.exportRows(7, []), null)
  assert.equal(called, 0)
  assert.deepEqual(errors, ['exportRows: 空群名单'])
})

test('四类「这一跳没成」各自落到 onError 并塌成 null，不抛到调用方', async () => {
  const errors: { where: string; msg: string }[] = []
  const on = (where: string, e: unknown): void => {
    errors.push({ where, msg: e instanceof Error ? e.message : String(e) })
  }
  const boom = createGroupApi({ fetcher: async () => { throw new Error('ECONNREFUSED') }, onError: on })
  assert.equal(await boom.postBatch(payload), null)
  assert.match(errors.at(-1)!.msg, /ECONNREFUSED/)

  const rejected = createGroupApi({
    fetcher: async () => json({ code: 40000, message: '快照名单为空' }, 400),
    onError: on
  })
  assert.equal(await rejected.postBatch(payload), null)
  assert.match(errors.at(-1)!.msg, /code=40000/)

  const noData = createGroupApi({ fetcher: async () => json({ code: 0, message: 'ok' }), onError: on })
  assert.equal(await noData.groups(7, 1, 200), null)
  assert.match(errors.at(-1)!.msg, /data 缺失/)

  const http500 = createGroupApi({
    fetcher: async () => new Response('boom', { status: 500 }),
    onError: on
  })
  assert.equal(await http500.exportRows(7, ['1@g.us']), null)
  assert.match(errors.at(-1)!.msg, /HTTP 500/)
})

test('宿主的日志实现抛异常不该把这一跳变成抛：postBatch 仍然返回 null', async () => {
  const api = createGroupApi({
    fetcher: async () => json({ code: 500 }),
    onError: () => { throw new Error('日志挂了') }
  })
  assert.equal(await api.postBatch(payload), null)
})
```

- [ ] **Step 2: 跑到红**

```bash
cd /d/SmartSCRM/apps/desktop && node --test src/main/services/groupCollect/api.test.ts
```
期望：FAIL（`Cannot find module './api.ts'`）。**如果这一步直接过了或报的是别的错，说明测试没在判这条链，不要往下写实现。**

- [ ] **Step 3: shared 补 wire 类型**

在 `src/shared/groupMembers.ts` 末尾追加（不动 Task 2 已有的任何一行）：

```ts
/**
 * Task 9：主进程 ↔ 后端的三份线形。读端点里只有 `groups` 与 `export-rows` 进主进程——
 * 成员名单 / 流水 / 客户反查由渲染层自己的 `lib/http.ts` 读（它自带 token 对与 401 刷新链），
 * 所以这三份类型同样放这里给两侧共用（R26、R27）。
 */
export type GroupReconcileReason = 'ok' | 'first_build' | 'coverage_too_low'

/** `GroupSnapshotDTO`。「空名单不当成功快照」的判定在页内（Task 3）与后端（Task 6）各一道闸（R20）。 */
export interface GroupSnapshotPayload {
  chatKey: string
  participants: GroupParticipantWire[]
  participantCount: number
  truncated?: boolean
}

/** `GroupBatchDTO`：一次 POST 可以只带 events（攒批）、只带 groups（建档首轮）、或 groups + snapshot（每群一跳）。 */
export interface GroupBatchPayload {
  accountId: number
  groups?: GroupListWire[]
  snapshot?: GroupSnapshotPayload
  events?: GroupEventWire[]
}

/** `GroupBatchVO`。`coverage=null` = 首建或本次没做快照；`reasons` 是逐条拒收文案，只进日志不进界面。 */
export interface GroupBatchResult {
  eventsAccepted: number
  eventsDuplicated: number
  membersUpserted: number
  reconciled: boolean
  coverage: number | null
  reason: GroupReconcileReason
  reasons?: string[]
}

/** `PageResult<T>` 的线上形状：注意字段是 `pageSize`，不是 `size`。 */
export interface PageWire<T> {
  records: T[]
  total: number
  page: number
  pageSize: number
}

/**
 * `GroupRowVO`。两个口径别混：`lastEventAt` 来自流水表，「最近聊天时间」来自 `chat_message`（Task 8）。
 * 日期一律当不透明字符串：泵只拿 `lastSnapshotAt` 排序，不做时区运算（后端 `MsgTimes.CHAT_ZONE` 是唯一折算处）。
 */
export interface GroupRowWire {
  chatKey: string
  title: string | null
  participantCount: number | null
  inGroupCount: number
  lastSnapshotAt: string | null
  snapshotCount: number
  /** `tinyint(1)` → Java `Integer` → JSON `0|1`。不是 boolean：判 `=== 1` 而不是判真值，`null` 与 0 是两件事。 */
  isFinal: number
  lastCoverage: number | null
  lastReconcileReason: GroupReconcileReason | null
  lastEventAt: string | null
}

/** `GroupExportRowVO`：14 列的取数结果，列序由 `GROUP_EXPORT_COLUMNS` 定，行序由后端定（R22）。 */
export interface GroupExportRowWire {
  seq: number | null
  groupName: string | null
  chatKey: string
  memberKey: string
  phone: string | null
  displayName: string | null
  roleType: string | null
  isInGroup: number | null
  latestJoinAt: string | null
  joinCount: number | null
  latestLeaveAt: string | null
  exitMethod: string | null
  firstSeenAt: string | null
  lastChatAt: string | null
  dayCount: number | null
  totalCount: number | null
}
```

- [ ] **Step 4: 实现 api**

```ts
// src/main/services/groupCollect/api.ts
import type {
  GroupBatchPayload,
  GroupBatchResult,
  GroupExportRowWire,
  GroupRowWire,
  PageWire
} from '../../../shared/groupMembers.ts'

export type Fetcher = (path: string, init: RequestInit) => Promise<Response>

interface Envelope<T> { code: number; message?: string; data?: T }

export interface GroupApiOptions {
  fetcher: Fetcher
  onError?: (where: string, e: unknown) => void
}

/**
 * 泵与导出用的三跳。`null` 只表示「这一跳没成」，不表示「后端收了但没做事」——
 * Task 11 的重试/放弃判据全靠这个区分，所以四种失败形状（非 2xx、code!==0、缺 data、fetcher 抛）
 * 全部先落到 onError 再塌成 null，绝不往上抛。
 */
// 返回类型写在这里会自引用循环：`GroupApi = ReturnType<typeof createGroupApi>` 才是口径
// （batchApi.ts:26-29 同一处理），用行级豁免补 `--quiet` 闸门。
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function createGroupApi(opts: GroupApiOptions) {
  const note = (where: string, e: unknown): void => {
    try {
      opts.onError?.(where, e)
    } catch {
      /* 日志实现自己挂了：吞掉，让这一跳照常塌成 null */
    }
  }

  async function call<T>(path: string, init: RequestInit): Promise<T | null> {
    try {
      const res = await opts.fetcher(path, init)
      if (!res.ok) {
        note(path, new Error(`HTTP ${res.status}`))
        return null
      }
      const env = (await res.json()) as Envelope<T>
      if (env.code !== 0 || env.data === undefined) {
        note(path, new Error(env.code !== 0 ? `信封 code=${env.code}` : '信封 code=0 但 data 缺失'))
        return null
      }
      return env.data
    } catch (e) {
      note(path, e)
      return null
    }
  }

  const jsonInit = (body: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })

  /**
   * 每个键单独编码后用**裸逗号**连接：后端 `@RequestParam List<String>` 按逗号拆，
   * 整串编码会把分隔符变成 `%2C`，那一跳就成「50 个群键黏成一个键」并静默导出 0 行。
   * 空名单在这一层挡掉（发出去只会得到一个 400 的噪声），归因写清是调用方给的。
   */
  const exportPath = (accountId: number, chatKeys: string[]): string | null => {
    if (chatKeys.length === 0) return null
    const encoded = chatKeys.map((k) => encodeURIComponent(k)).join(',')
    return `/api/group-members/group/members/export-rows` +
      `?accountId=${accountId}&chatKeys=${encoded}`
  }

  return {
    postBatch: (payload: GroupBatchPayload) =>
      call<GroupBatchResult>('/api/group-members/batch', jsonInit(payload)),

    groups: (accountId: number, page: number, size: number) =>
      call<PageWire<GroupRowWire>>(
        `/api/group-members/groups?accountId=${accountId}&page=${page}&size=${size}`,
        { method: 'GET' }
      ),

    /** 返回 `null` 有两种：空名单（记 `exportRows: 空群名单`）与这一跳没成。Task 12 的界面据此给不同文案。 */
    exportRows: (accountId: number, chatKeys: string[]) => {
      const path = exportPath(accountId, chatKeys)
      if (path === null) {
        note('exportRows: 空群名单', new Error('调用方给了空名单'))
        return Promise.resolve(null)
      }
      return call<GroupExportRowWire[]>(path, { method: 'GET' })
    }
  }
}

export type GroupApi = ReturnType<typeof createGroupApi>
```

- [ ] **Step 5: 接到 unit 闸门**

`apps/desktop/tsconfig.unit.json` 的 `include` 里，在既有的 `"src/main/services/batchSend/**/*.ts"` 一类条目之后补两行：

```json
    "src/main/services/groupCollect/api.ts",
    "src/main/services/groupCollect/api.test.ts",
```

`apps/desktop/package.json` 的 `test:unit` 脚本，glob 列表追加一条（与 `batchSend` 并列）：

```
"src/main/services/groupCollect/**/*.test.ts"
```

- [ ] **Step 6: 跑到绿 + 四路 typecheck + lint**

```bash
cd /d/SmartSCRM/apps/desktop
node --test src/main/services/groupCollect/api.test.ts
pnpm run test:unit 2>&1 | tail -15
pnpm run typecheck:unit && pnpm run typecheck:node && pnpm run typecheck:web && pnpm run typecheck:inject
pnpm exec eslint src/main/services/groupCollect/api.ts src/main/services/groupCollect/api.test.ts src/shared/groupMembers.ts --quiet
```
期望：新测试 7 条全过；`test:unit` 总数 = 接线前 + 7（把前后两个数记进提交正文）；四路 typecheck 全过；`--quiet` 零输出。

- [ ] **Step 7: 提交**

```bash
git add apps/desktop/src/shared/groupMembers.ts apps/desktop/src/main/services/groupCollect apps/desktop/tsconfig.unit.json apps/desktop/package.json
git commit -m "$(cat <<'EOF'
feat(P8/群成员): 主进程 groupCollect/api 三跳与 shared 线形

泵只写 batch、只读 groups；导出走 export-rows。成员名单与流水由渲染层自己的
http.ts 读，不在主进程重复挂一层转发。

群键逐个编码后用裸逗号连接：后端按逗号拆 List<String>，整串编码会静默导出 0 行。
null 只表示「这一跳没成」，四类失败都先落 onError，泵靠它分重试与放弃。

Co-Authored-By: Qoder <noreply@qoder.com>
EOF
)"
```

---

## Task 10: 主进程两张内存表——`registry.ts`（reqId → 未决）与 `collector.ts`（事件攒批）

**Files:**
- Create: `apps/desktop/src/main/services/groupCollect/registry.ts`
- Create: `apps/desktop/src/main/services/groupCollect/registry.test.ts`
- Create: `apps/desktop/src/main/services/groupCollect/collector.ts`
- Create: `apps/desktop/src/main/services/groupCollect/collector.test.ts`
- Modify: `apps/desktop/tsconfig.unit.json`（include 补这四支中的两支 `.ts`，测试支靠 Task 9 已接好的 `groupCollect/**` glob 覆盖）

**Interfaces:**
- Consumes：`BridgeReport`（Task 3 加过三种 `kind` 的那一份联合）、`GroupEventWire` / `EVENT_BATCH_SIZE` / `EVENT_BATCH_INTERVAL_MS` / `EVENT_QUEUE_MAX` / `CHAT_KEY_MAX` / `MEMBER_KEY_MAX` / `GROUP_BODY_MAX` / `SNAPSHOT_TIMEOUT_MS`（`shared/groupMembers.ts`）、`GroupApi`（Task 9）
- Produces（Task 11 的泵与 Task 12 的装配全用这些名字）：
  - `type GroupWireResult = Extract<BridgeReport, { kind: 'group_list_result' }> | Extract<BridgeReport, { kind: 'group_snapshot_result' }>`
  - `class GroupRegistry`：`constructor(timeoutMs?: number)`、`get size(): number`、`add(reqId: string, viewId: string): Promise<GroupWireResult | null>`、`settle(result: GroupWireResult): boolean`、`failView(viewId: string): number`、`dispose(): void`
  - `interface EventBatchPayload { accountId: number; events: GroupEventWire[] }`
  - `type EventFlushFn = (payload: EventBatchPayload) => Promise<void>`（**约定：投不出去必须 reject，不许返回假值**——见技术要点第 5 条）
  - `class EventCollectorHub`：`constructor(opts: EventHubOptions)`、`push(accountId: number, events: GroupEventWire[]): number`（返回**收下**几条，非法的被剔掉）、`flush(): Promise<void>`、`dispose(): void`、`get size(): number`、`get dropped(): number`

**技术要点**

- **超时给 `null`，`ok:false` 给回帧本身——这条三态区分是整个泵的设计支点**（R5 的可测面）。页内两种「没拿到名单」是不同的事：桥压根没答（页面卡死 / 视图正在重载 / wa-js 钩子失效）与桥答了「我试过了，失败」（`WPP.group` 不可用 / 两方皆空）。泵对前者的正确反应是**结束这一轮**（继续发下去每条都会超时，一轮 200 群就是 50 分钟的空等），对后者是**退避后重试一次**（`RETRY_BACKOFF_MS`，见 Task 11）。判据错一格，代价是「整轮白等」或「一次抖动毁掉整轮」。**归因**：`null` 永远不是「后端拒了」，后端拒绝体现在 `GroupBatchResult.reasons`，那是另一条链。
- **`failView` 结清成 `null` 而不是 `ok:false`**：视图销毁意味着「不会再有答案」，与超时同一档；把它写成 `ok:false` 会让泵对这一群重试一次，而重试是往一个已经不存在的 webContents 上发消息（`sendToView` 会静默丢掉，`viewManager` 那一层只判 `null` 不判 destroyed——读码所得）。销毁时结清这件事本身不是新增发明：`sendRegistry` / `recallRegistry` 都在 `broadcastState()` 的 `phase==='retry'|'offline'|'destroyed'` 分支里被 `failView`（`msgBridge/index.ts:69-77`），Task 12 把这张表挂进同一处。
- **重复 `reqId` 先把上一条结掉**（照 `SendRegistry.add`）：reqId 由泵自增生成，正常情况下不会重。真重了只有一种原因——有两个泵在同一个视图上跑（同一账号被点两次「刷新成员」）。让上一条幽灵气泡式地挂到超时，比让它拿到别人的答案好。Task 11 另有一道 per-account 的在跑标记，这里是第二道。
- **超时的 `setTimeout` 不 `unref()`**：这是照既有事实，不是遗漏——`SendRegistry` 的注释写明「不 dispose 就是退出路上最多 20s 的挂起」（`msgBridge/index.ts:426`）。所以这张表**必须**被 `stopGroupHost()` 里的 `dispose()` 结掉（Task 12），否则本任务会给主进程多加一条 15s 的退出挂起。测试里断言这一格：`dispose()` 之后表是空的，且不会再 resolve 出值。
- **`EventFlushFn` 的契约是「抛 = 没投出去」**，与 Task 9 的「`null` = 没投出去」正好相反。这不是不一致：`CollectorHub` 那一条已经定下了这个调法，它的 `flush` 注入函数自己就把 `null` 转成 `throw`（`msgBridge/index.ts:44-50`：`if (!result) throw new Error('batch rejected')`）。Task 12 的注入照抄这一条。**为什么不留「返回 false 也算失败」的第二种方言**：`drain()` 的退回重试只认 reject，认了布尔就等于两个调用点各自决定哪一方为真——而「后端回了 40016」与「后端没起来」在这里都是 reject，重试都没意义，语义由 `flush` 的实现方（host）一处决定。
- **进表前先剔非法**：页内是半可信来源（被内嵌的视图不一定是我们自己的页面），而合批把一条坏键的代价从「少收一条」放大成「整批 400」——`GroupEventDTO` 的 `chatKey` 是 `@Size(max=128)`、`memberKey`/`dedupKey` 是 `@Size(max=160)`，超了就是整批 `code=40000`（Task 5）。剔掉的判据只有长度与「必填是字符串」，**不判 `eventType` 的取值**：那是 shared 联合类型的事，页内 Task 3/4 的映射表已经给了封闭集合，这里再判一次就是第三份真值。`bodySnapshot` 超长截断而不是丢弃（它是给人看的一行字，不是键）。
- **`push()` 的返回值是「收下几条」，不是「来了几条」**：差值就是被剔掉的条数，Task 12 的日志把它打出来。**判别力**：这一格没有返回值的话，「页内报了一堆事件、库里 0 行」与「页内压根没报」在日志里长得一样——这正是 P7 Task 12 那颗坏 chatKey 走过的路。
- **丢最旧要留痕，因为事件不像消息可以重跑**：消息行丢了还有「同步历史」补底（`uk_msg` 幂等），群事件页内不会重发历史，`EVENT_QUEUE_MAX` 一挤就是**永久**缺口。所以 `dropped` 计数必须在退出前与越界时各打一行（Task 12 负责），不能像 `CollectorHub` 那样只挂个 getter 等 UI 来问。
- **按 `accountId` 分组投**：`POST /batch` 只有一个 `accountId`（`GroupBatchDTO`），而事件帧的归属是 `handleBridgeReport` 逐视图盖章的（R13）。同一批里两个账号的行必须拆开投，否则整批写到第一个账号名下——**归因**：这条与 `CollectorHub.groupBy` 的 `accountId|activeChatKey` 双键分组同源，只是这里没有 `activeChatKey` 那一维（群事件自带 `chatKey`）。

- [ ] **Step 1: 写失败的 registry 单测**

```ts
// src/main/services/groupCollect/registry.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GroupRegistry } from './registry.ts'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const listResult = (reqId: string, ok: boolean) =>
  ({ kind: 'group_list_result', reqId, ok, groups: ok ? [{ chatKey: '1@g.us', title: 'G' }] : undefined,
     error: ok ? undefined : 'WPP.group 不可用' }) as const

test('settle 命中表才 true，并把原帧给回 await', async () => {
  const r = new GroupRegistry(60_000)
  const p = r.add('g1', 'view-1')
  assert.equal(r.size, 1)
  assert.equal(r.settle(listResult('g2', true)), false, '别人的 reqId 不许结清这一条')
  assert.equal(r.size, 1)
  assert.equal(r.settle(listResult('g1', true)), true)
  const got = await p
  assert.equal(got?.kind, 'group_list_result')
  assert.equal(r.size, 0)
  r.dispose()
})

// 这条是三态判据的核心：超时 = null = 「页内没答」，与页内答了「失败」的 ok:false 帧不是一件事。
test('超时结清成 null（不是 ok:false 的帧）', async () => {
  const r = new GroupRegistry(5)
  const got = await r.add('g1', 'view-1')
  assert.equal(got, null)
  assert.equal(r.size, 0, '超时后表里不该留条目')
  r.dispose()
})

test('failView 只结这个视图，一律结 null，并给回条数', async () => {
  const r = new GroupRegistry(60_000)
  const a = r.add('g1', 'view-1')
  const b = r.add('g2', 'view-1')
  const c = r.add('g3', 'view-2')
  assert.equal(r.failView('view-1'), 2)
  assert.equal((await a) === null, true)
  assert.equal((await b) === null, true)
  assert.equal(r.size, 1, '另一个账号那条不许被牵连')
  assert.equal(r.settle(listResult('g3', true)), true)
  assert.equal((await c)?.ok, true)
  r.dispose()
})

test('重复 reqId 先把上一条结掉：不许有幽灵气泡式地挂到超时', async () => {
  const r = new GroupRegistry(60_000)
  const first = r.add('g1', 'view-1')
  const second = r.add('g1', 'view-1')
  assert.equal(await first, null, '上一条被顶掉时结 null，与超时同一档')
  assert.equal(r.settle(listResult('g1', true)), true)
  assert.equal((await second)?.ok, true)
  r.dispose()
})

test('dispose 清空表并掐掉定时器：退出路上不许多出 15s 挂起', async () => {
  const r = new GroupRegistry(20)
  let settled: unknown = '未结'
  const p = r.add('g1', 'view-1')
  void p.then((v) => {
    settled = v
  })
  r.dispose()
  assert.equal(r.size, 0)
  assert.equal(r.settle(listResult('g1', true)), false, '表已清空：迟到帧不许再有人认领')
  // 判别力：漏了 clearTimeout 的话，20ms 那一只定时器会把 `settled` 翻成 null——
  // 只断言 `size===0` 拦不住「表清了、定时器还在挂」这一格，而后者才是退出路径上的 15s 挂起。
  await wait(60)
  assert.equal(settled, '未结')
})

test('无人认领的迟到帧：settle 返回 false，调用方据此打一行痕迹而不是静默', async () => {
  const r = new GroupRegistry(5)
  await r.add('g1', 'view-1')
  assert.equal(r.settle(listResult('g1', true)), false)
  r.dispose()
})
```

- [ ] **Step 2: 跑到红**

```bash
cd /d/SmartSCRM/apps/desktop && node --test src/main/services/groupCollect/registry.test.ts
```
期望：FAIL（`Cannot find module './registry.ts'`）。

- [ ] **Step 3: 实现 registry**

```ts
// src/main/services/groupCollect/registry.ts
import type { BridgeReport } from '../../../shared/chatTypes.ts'
import { SNAPSHOT_TIMEOUT_MS } from '../../../shared/groupMembers.ts'

/** 页内对两条群命令的回帧。`group_event` 不在这里——它不等任何人（R12）。 */
export type GroupWireResult =
  | Extract<BridgeReport, { kind: 'group_list_result' }>
  | Extract<BridgeReport, { kind: 'group_snapshot_result' }>

interface Pending {
  viewId: string
  resolve: (result: GroupWireResult | null) => void
  timer: NodeJS.Timeout
}

/**
 * reqId → 未决的 Promise 表（泵生成 reqId、页内原样回带，R6）。
 *
 * 三态是这张表存在的理由：`null` = 页内没答（超时或视图没了），`ok:false` = 页内答了说失败。
 * 泵对两者的反应相反（放弃这一轮 / 退避后重试一次），所以这里不能把它们糊成同一个值。
 */
export class GroupRegistry {
  private readonly table = new Map<string, Pending>()
  // 参数属性会被 `erasableSyntaxOnly` 判成 TS1294（本文件在 tsconfig.unit.json 的 include 里）。
  private readonly timeoutMs: number

  constructor(timeoutMs = SNAPSHOT_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs
  }

  get size(): number {
    return this.table.size
  }

  add(reqId: string, viewId: string): Promise<GroupWireResult | null> {
    // 同 reqId 再登记 = 有两个泵在同一个视图上跑。先把上一条结掉（null = 不会再有答案），
    // 不结的话上一条要挂满一个超时才松手。
    this.drop(reqId)
    return new Promise<GroupWireResult | null>((resolve) => {
      const timer = setTimeout(() => this.drop(reqId), this.timeoutMs)
      this.table.set(reqId, { viewId, resolve, timer })
    })
  }

  /** @returns 命中本表才 true。false = 迟到或压根不是我们发出的 reqId，调用方要打一行痕迹（不能静默）。 */
  settle(result: GroupWireResult): boolean {
    const entry = this.table.get(result.reqId)
    if (!entry) return false
    this.table.delete(result.reqId)
    clearTimeout(entry.timer)
    entry.resolve(result)
    return true
  }

  /**
   * 视图销毁 / 桥掉线：只结这个视图的未决，全部结 `null`。
   * 不结成 `ok:false`——那会让泵对一个已经不存在的 webContents 重试一次。
   */
  failView(viewId: string): number {
    const ids = [...this.table.entries()].filter(([, p]) => p.viewId === viewId).map(([id]) => id)
    for (const id of ids) this.drop(id)
    return ids.length
  }

  dispose(): void {
    for (const entry of this.table.values()) clearTimeout(entry.timer)
    this.table.clear()
  }

  private drop(reqId: string): void {
    const entry = this.table.get(reqId)
    if (!entry) return
    this.table.delete(reqId)
    clearTimeout(entry.timer)
    entry.resolve(null)
  }
}
```

- [ ] **Step 4: 写失败的 collector 单测**

```ts
// src/main/services/groupCollect/collector.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventCollectorHub, type EventBatchPayload } from './collector.ts'
import { GROUP_BODY_MAX, type GroupEventWire } from '../../../shared/groupMembers.ts'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const event = (chatKey: string, memberKey: string): GroupEventWire => ({
  chatKey,
  memberKey,
  eventType: 'added',
  occurredAtEpochSec: 1_700_000_000,
  dedupKey: `${memberKey}|1700000000|added`,
  source: 'live_event'
})

function recorder(failFirst = 0): { calls: EventBatchPayload[]; flush: (p: EventBatchPayload) => Promise<void> } {
  const calls: EventBatchPayload[] = []
  let n = 0
  return {
    calls,
    flush: async (p) => {
      calls.push(p)
      if (n++ < failFirst) throw new Error('ECONNREFUSED')
    }
  }
}

test('攒够 batchSize 才冲；一批跨账号要拆开投（POST /batch 只有一个 accountId）', async () => {
  const r = recorder()
  const hub = new EventCollectorHub({ flush: r.flush, batchSize: 3, flushIntervalMs: 60_000 })
  hub.push(1, [event('a@g.us', '1@c.us')])
  hub.push(2, [event('b@g.us', '2@c.us')])
  // 区分性证据：如果是「来一条投一条」，这里 calls.length 已经是 2
  assert.equal(r.calls.length, 0)
  hub.push(1, [event('a@g.us', '3@c.us'), event('a@g.us', '4@c.us')])
  await wait(10)
  assert.deepEqual(
    r.calls.map((c) => [c.accountId, c.events.length]),
    [
      [1, 3],
      [2, 1]
    ]
  )
  assert.equal(hub.size, 0)
  hub.dispose()
})

test('没攒够也按点到冲（2s 语义，测试里 5ms）', async () => {
  const r = recorder()
  const hub = new EventCollectorHub({ flush: r.flush, batchSize: 100, flushIntervalMs: 5 })
  hub.push(1, [event('a@g.us', '1@c.us')])
  assert.equal(r.calls.length, 0)
  await wait(50)
  assert.equal(r.calls.length, 1)
  hub.dispose()
})

test('投不出去不丢数据：reject 的那一组退回队首，续上下一次触发', async () => {
  const calls: EventBatchPayload[] = []
  let down = true
  const hub = new EventCollectorHub({
    flush: async (p) => {
      calls.push(p)
      if (down) throw new Error('后端没起来')
    },
    batchSize: 2,
    flushIntervalMs: 60_000,
    retries: 2
  })
  hub.push(1, [event('a@g.us', '1@c.us')])
  await hub.flush()
  assert.equal(calls.length, 2, 'retries=2：这一次投递内部自己试了两回')
  assert.equal(hub.size, 1, '两回都失败：这一条必须还在队里，不许当没发生过')
  down = false
  await hub.flush()
  assert.equal(hub.size, 0)
  assert.equal(calls.length, 3)
  assert.equal(calls[2].events[0].memberKey, '1@c.us')
  hub.dispose()
})

test('越界丢最旧并计数：事件丢了页内不会重发，这个数必须可查', async () => {
  const r = recorder()
  const hub = new EventCollectorHub({ flush: r.flush, batchSize: 1_000, maxQueue: 3, flushIntervalMs: 60_000 })
  hub.push(1, [event('a@g.us', '1@c.us'), event('a@g.us', '2@c.us')])
  hub.push(1, [event('a@g.us', '3@c.us'), event('a@g.us', '4@c.us'), event('a@g.us', '5@c.us')])
  assert.equal(hub.size, 3)
  assert.equal(hub.dropped, 2)
  await hub.flush()
  assert.deepEqual(r.calls[0].events.map((e) => e.memberKey), ['3@c.us', '4@c.us', '5@c.us'])
  hub.dispose()
})

test('非法条目进表前剔掉，push 返回收下的条数；bodySnapshot 超长截断而不是丢整条', async () => {
  const r = recorder()
  const hub = new EventCollectorHub({ flush: r.flush, batchSize: 100, flushIntervalMs: 60_000 })
  const longKey = 'x'.repeat(200)
  const taken = hub.push(1, [
    event('a@g.us', '1@c.us'),
    event('a@g.us', longKey),
    event(longKey, '2@c.us'),
    { ...event('a@g.us', '3@c.us'), memberKey: undefined as unknown as string },
    event('a@g.us', '4@c.us'),
    { ...event('a@g.us', '5@c.us'), bodySnapshot: 'y'.repeat(600) }
  ])
  assert.equal(taken, 3, '三条合法：1@c.us / 4@c.us / 5@c.us')
  await hub.flush()
  assert.equal(r.calls.length, 1)
  assert.deepEqual(r.calls[0].events.map((e) => e.memberKey), ['1@c.us', '4@c.us', '5@c.us'])
  assert.equal(r.calls[0].events[0].bodySnapshot, undefined, '没收 bodySnapshot 的不许被凭空造一个')
  assert.equal(r.calls[0].events[2].bodySnapshot?.length, GROUP_BODY_MAX)
  hub.dispose()
})

test('空数组不占队列也不起定时器；dispose 后 push 一律不收、flush 不投不抛', async () => {
  const r = recorder()
  const hub = new EventCollectorHub({ flush: r.flush, batchSize: 2, flushIntervalMs: 5 })
  assert.equal(hub.push(1, []), 0)
  await wait(30)
  assert.equal(r.calls.length, 0, '空批不该冲出一个 {accountId, events: []}')
  hub.dispose()
  assert.equal(hub.push(1, [event('a@g.us', '1@c.us')]), 0)
  await hub.flush()
  assert.equal(r.calls.length, 0)
})
```

- [ ] **Step 5: 实现 collector**

```ts
// src/main/services/groupCollect/collector.ts
import {
  CHAT_KEY_MAX,
  EVENT_BATCH_INTERVAL_MS,
  EVENT_BATCH_SIZE,
  EVENT_QUEUE_MAX,
  GROUP_BODY_MAX,
  MEMBER_KEY_MAX,
  type GroupEventWire
} from '../../../shared/groupMembers.ts'

export interface EventBatchPayload {
  accountId: number
  events: GroupEventWire[]
}

/** 投不出去**必须 reject**（不返回假值）：`drain()` 的退回重试只认这一种失败信号。 */
export type EventFlushFn = (payload: EventBatchPayload) => Promise<void>

export interface EventHubOptions {
  flush: EventFlushFn
  batchSize?: number
  maxQueue?: number
  flushIntervalMs?: number
  retries?: number
}

interface Item {
  accountId: number
  event: GroupEventWire
}

/**
 * 群事件的内存攒批器：与 `CollectorHub` 同形但**另立一份**（R4）——
 * 那一份的 `BatchPayload.messages` 绑死 `NormalizedMessage`，塞进事件要动它全部泛参与 P6 的三个已验收用例。
 */
export class EventCollectorHub {
  private readonly flushFn: EventFlushFn
  private readonly batchSize: number
  private readonly maxQueue: number
  private readonly intervalMs: number
  private readonly retries: number
  private queue: Item[] = []
  private timer: NodeJS.Timeout | null = null
  private running: Promise<void> | null = null
  private droppedCount = 0
  private disposed = false

  constructor(opts: EventHubOptions) {
    this.flushFn = opts.flush
    this.batchSize = opts.batchSize ?? EVENT_BATCH_SIZE
    this.maxQueue = opts.maxQueue ?? EVENT_QUEUE_MAX
    this.intervalMs = opts.flushIntervalMs ?? EVENT_BATCH_INTERVAL_MS
    this.retries = opts.retries ?? 3
  }

  get size(): number {
    return this.queue.length
  }

  /** 越界丢掉的条数。**事件不像消息行可以重跑补底**，这一格是永久缺口的尺寸，Task 12 的日志要把它打出来。 */
  get dropped(): number {
    return this.droppedCount
  }

  /** @returns 实际收下的条数（非法的被剔掉）。差值必须能被调用方数出来，否则「页内报了、库里 0 行」无从归因。 */
  push(accountId: number, events: GroupEventWire[]): number {
    if (this.disposed || !Array.isArray(events)) return 0
    let taken = 0
    for (const raw of events) {
      const item = sanitize(accountId, raw)
      if (!item) continue
      this.queue.push(item)
      taken += 1
    }
    if (taken === 0) return 0
    this.trim()
    if (this.queue.length >= this.batchSize) {
      void this.flush().catch(() => undefined)
      return taken
    }
    this.arm()
    return taken
  }

  flush(): Promise<void> {
    this.disarm()
    if (this.running) return this.running
    this.running = this.drain().finally(() => {
      this.running = null
    })
    return this.running
  }

  dispose(): void {
    this.disposed = true
    this.disarm()
    this.queue = []
  }

  private arm(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush().catch(() => undefined)
    }, this.intervalMs)
    // 主进程事件循环本来长活，这个定时器不该成为「退出不干净」的理由（同 CollectorHub）。
    this.timer.unref()
  }

  private disarm(): void {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = null
  }

  private trim(): void {
    if (this.queue.length <= this.maxQueue) return
    const overflow = this.queue.length - this.maxQueue
    this.queue.splice(0, overflow)
    this.droppedCount += overflow
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const groups = groupBy(this.queue.splice(0, this.batchSize))
      for (let i = 0; i < groups.length; i++) {
        if (await this.deliver(groups[i])) continue
        // 投不出去：这一组和它后面还没投的整段退回队首，保持时间顺序。
        const rest = groups.slice(i).flatMap((g) => g.events.map((event) => ({ accountId: g.accountId, event })))
        this.queue = rest.concat(this.queue)
        this.trim()
        return
      }
    }
  }

  private async deliver(payload: EventBatchPayload): Promise<boolean> {
    for (let attempt = 1; attempt <= this.retries; attempt++) {
      try {
        await this.flushFn(payload)
        return true
      } catch (e) {
        // C3：只有计数与错误名，页内文本不进日志。
        console.warn(
          `[groupHub] 第 ${attempt}/${this.retries} 次投递失败 accountId=${payload.accountId} ` +
            `count=${payload.events.length} err=${e instanceof Error ? e.name : String(e)}`
        )
      }
    }
    return false
  }
}

/** 按账号切开：`POST /batch` 一次只带一个 `accountId`（R13 的盖章在 `handleBridgeReport`，不在这里）。 */
function groupBy(items: Item[]): EventBatchPayload[] {
  const buckets = new Map<number, GroupEventWire[]>()
  for (const item of items) {
    const list = buckets.get(item.accountId)
    if (list) list.push(item.event)
    else buckets.set(item.accountId, [item.event])
  }
  return [...buckets.entries()].map(([accountId, events]) => ({ accountId, events }))
}

/**
 * 长度闸在进队处，不在后端：`GroupEventDTO` 的三个键列各有 128/160/160 的 `@Size`，
 * 一条超限就是整批 400（Task 5），而这一批里其余几十条事件本来能入库。
 * 不判 `eventType` 的取值——那是 shared 联合类型与页内映射表（Task 3/4）的事，这里判就是第三份真值。
 */
function sanitize(accountId: number, raw: GroupEventWire): Item | null {
  if (!raw || typeof raw !== 'object') return null
  if (!Number.isFinite(accountId) || accountId <= 0) return null
  if (!fits(raw.chatKey, CHAT_KEY_MAX) || !fits(raw.memberKey, MEMBER_KEY_MAX) || !fits(raw.dedupKey, MEMBER_KEY_MAX)) {
    return null
  }
  if (!Number.isFinite(raw.occurredAtEpochSec)) return null
  const event: GroupEventWire = {
    ...raw,
    ...(typeof raw.bodySnapshot === 'string' && raw.bodySnapshot.length > GROUP_BODY_MAX
      ? { bodySnapshot: raw.bodySnapshot.slice(0, GROUP_BODY_MAX) }
      : {})
  }
  return { accountId, event }
}

function fits(value: unknown, max: number): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}
```

- [ ] **Step 6: 跑到绿 + 闸门与 lint**

```bash
cd /d/SmartSCRM/apps/desktop
node --test src/main/services/groupCollect/registry.test.ts src/main/services/groupCollect/collector.test.ts
pnpm run test:unit 2>&1 | tail -15
pnpm run typecheck:unit && pnpm run typecheck:node && pnpm run typecheck:web && pnpm run typecheck:inject
pnpm exec eslint src/main/services/groupCollect/registry.ts src/main/services/groupCollect/collector.ts src/main/services/groupCollect/registry.test.ts src/main/services/groupCollect/collector.test.ts --quiet
```
期望：registry 6 条 + collector 6 条全过；`test:unit` 总数比 Task 9 之后多 12（把前后两个数记进提交正文）；四路 typecheck 全过；`--quiet` 零输出。

- [ ] **Step 7: 提交**

```bash
git add apps/desktop/src/main/services/groupCollect apps/desktop/tsconfig.unit.json
git commit -m "$(cat <<'EOF'
feat(P8/群成员): reqId 结清表与群事件攒批器

超时给 null、页内报错给回 ok:false 帧——泵对两者的反应相反（弃这一轮 / 退避重试一次），
所以这张表不许把它们糊成同一个值。

事件另立一份攒批器而不复用 CollectorHub：那一份的载荷绑死 NormalizedMessage。
键长超限在进队处剔掉，一条坏键不该把整批换成一回 400。

Co-Authored-By: Qoder <noreply@qoder.com>
EOF
)"
```

---

## Task 11: 建档泵 `groupCollect/engine.ts`（只读、串行、可测）

**Files:**
- Create: `apps/desktop/src/main/services/groupCollect/engine.ts`
- Create: `apps/desktop/src/main/services/groupCollect/engine.test.ts`
- Modify: `apps/desktop/tsconfig.unit.json`（include 补 `engine.ts` 与 `engine.test.ts`）

**Interfaces:**
- Consumes：`GroupApi`（Task 9，只用 `postBatch` / `groups` 两跳）、`GroupWireResult`（Task 10）、`BridgeCommand` 的两支群命令（Task 3）、`GROUP_GAP_MS` / `RETRY_BACKOFF_MS` / `MAX_GROUPS_PER_BUILD` / `CHAT_KEY_MAX`（Task 2）、Task 7 的 `GET /groups?sort=stale`（R28）
- Produces（Task 12 的 host 只认这三个名字）：
  - `interface GroupEngineDeps { api: Pick<GroupApi, 'postBatch' | 'groups'>; pull(viewId: string, cmd: GroupCommandWire): Promise<GroupWireResult | null>; viewIdOf(accountId: number): string | null; sleep(ms: number): Promise<void>; now(): number; log(where: string, e: unknown): void }`
  - `type GroupCommandWire = Extract<BridgeCommand, { kind: 'group_list' } | { kind: 'group_snapshot' }>`
  - `interface GroupBuildOutcome { accountId: number; skipped: 'busy' | 'no_view' | null; list: 'ok' | 'error' | 'silent'; registered: number; attempted: number; snapshotted: number; postedFailed: number; failed: number; skippedFinal: number; truncated: boolean; aborted: boolean }`
  - `class GroupEngine`：`constructor(deps)`、`runForAccount(accountId: number, chatKey?: string): Promise<GroupBuildOutcome>`、`running(accountId: number): boolean`、`stop(): void`

**技术要点**

- **`null` 与 `ok:false` 分道是这一整节的中枢**（Task 10 第一条的兑现）：列表那一跳拿到 `null` → **整轮放弃**；快照那一跳拿到 `null` → **中止整轮**（`aborted:true`）；拿到 `ok:false` → 退避 `RETRY_BACKOFF_MS` 重试一次，仍失败只算**这一群**失败，继续下一群。判反的代价不对称得很实在：对「页内已经不答话」还逐群往下发，200 个群就是 200 × 15s 的空等，而这段时间里用户的每一次进群详情补拉都会排在一个死页后面。
- **排序读后端，不在 JS 比日期字符串**（R28）：`GET /groups?sort=stale` 的 `ORDER BY` 就是「`last_snapshot_at` 为 NULL 的优先、其余升序」，泵把返回的**位置**当作 rank 用（第 i 行 rank=i），册子上查不到的键 rank=-1（从没建过档 → 排最前）。为什么不解析 `lastSnapshotAt`：`LocalDateTime` 的 Jackson 形状（带不带纳秒、带不带 `Z`）不是本项目定的，拿它做字典序比较就是把一个**没实测过的外部格式**当成排序依据；而位置是后端 SQL 给的，是它本来就承诺的东西。**代价**：册子读不到（后端没起）时 rank 表是空的，整轮退化成页内本地顺序——顺序不精确但不漏群，这一格有日志。
- **先一跳登记全部可见群，再逐群一跳**（R29）：spec §5 的伪码把 `groups + snapshot` 写在同一跳里，那样一来**快照失败的群永远不会进登记册**，而 §2#8 建登记册要的恰恰是「账号在哪些群里」这份名册（群行存在、`last_snapshot_at IS NULL` = §8 的「未建档」，与「压根没有这个群」是两种可见状态）。所以拆成两跳：`POST /batch {groups:[...全部]}` 一跳，随后每群 `POST /batch {groups:[这一群], snapshot}` 一跳。**每群那一跳仍带 `groups`** 是为手动刷新（`chatKey` 那一支）留的：单群补拉可能拉的是一个还没登记过的群。代价：每群多一个一条元素的数组，upsert 幂等，无副作用。
- **`is_final` 的跳过要断言「从没被拉过」**（R21）：泵的单测不许写成「outcome 里没有它」——那是任何实现都能过的断言。要断言 `pull` 的调用序列里压根不出现那个 chatKey。
- **截断 200 是合法的**：`candidates.length > MAX_GROUPS_PER_BUILD` 时 `truncated=true`，剩下的留给下一轮（spec §5 明写「不做到点定时器」）。与 R22 不冲突：R22 钉的是**导出行的用户可见顺序**在后端，这里的 200 是**内部建档优先级**，两者没有交集。
- **每账号一条，不排队也不并发**：`running` 是进程内的 `Set<accountId>`，第二次进来直接回 `skipped:'busy'`。**为什么不排队**：排队会让用户连点三次「刷新成员」得到三条积压的 15 分钟任务；而「再点一次」的真实诉求永远是「现在这一次跑完了吗」，`skipped` 让它当场得到答案。Task 12 的 `group:build` 把这一格映射成界面文案。
- **不进 `sendLock`**（R18）：泵发的是只读命令，与回复框的发送没有资源竞争；进锁会让一次建档把用户正在敲的那条回复排在 15s 超时后面。
- **`participantCount` 缺省用名单长度补**：分母的目的是「和下一次的名单长度比」，两次同源于名单长度时 `coverage` 依然如实衡量缩水幅度，所以这里补一个长度不是猜平台侧的真实群大小。**判别力**：页内给了 `participantCount` 时绝不许用长度覆盖它——那会让 §6 陷阱 ① 的分母失去「来自群 metadata」这一层独立来源。
- **`truncated` 字段（快照那一帧的）原样透传，不解释**：spec §15#3 那条最危险的未实测项（超大群是否分页截断）落地时，改的是后端的判退口径，不是这里；这里只做搬运，所以也不写「截断就放弃判退」这类本期没有依据的分支。
- **一切页内文本进日志前收一行**：`chatKey` 与 `error` 都是半可信来源，沿用 `msgBridge/index.ts:163-167` 的 `oneLine` 口径（本文件另立一份 5 行的私有 `line()`：跨服务导出它要让 msgBridge 成为 groupCollect 的依赖，而这条口径不值得）。
- **`now()` 注入了但本期泵不用它**（形状照 `batchSend/engine.ts` 的 `EngineDeps`，`occurred_at` 折算在后端）：**这一格要写在注释里**，否则下一个读这段的人会以为漏了个时间戳，或把 `Date.now()` 直接写进事件载荷。

- [ ] **Step 1: 写失败的泵单测**

```ts
// src/main/services/groupCollect/engine.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GroupEngine, type GroupEngineDeps } from './engine.ts'
import { CHAT_KEY_MAX, GROUP_GAP_MS, MAX_GROUPS_PER_BUILD, RETRY_BACKOFF_MS } from '../../../shared/groupMembers.ts'
import type { GroupApi } from './api.ts'
import type { GroupBatchPayload, GroupRowWire } from '../../../shared/groupMembers.ts'
import type { GroupWireResult } from './registry.ts'

const member = (n: string) => ({ memberKey: `${n}@c.us`, phone: n, displayName: null, roleType: 'member' as const })

/**
 * 假时钟 + 可编程的页内出料口：
 * - `snapshots` 按顺序给每一群的答复，`'silent'` = 超时（null），`'fail'` = ok:false 帧
 * - `pulls` / `posts` / `sleeps` / `logs` 是断言的四个取证面
 * 断言一律打在「谁被调了几次、按什么次序」上，不是打在 outcome 的字段有没有值上——
 * 后者拦不住「压根没拉却报了成功」。
 */
function harness(opts: {
  groups?: { chatKey: string; title: string | null }[]
  list?: GroupWireResult | null
  snapshots?: ('ok' | 'fail' | 'silent')[]
  rows?: Partial<GroupRowWire>[]
  postNull?: boolean
} = {}) {
  const pulls: { cmd: unknown }[] = []
  const posts: GroupBatchPayload[] = []
  const sleeps: number[] = []
  const logs: string[] = []
  const snapshotQueue = [...(opts.snapshots ?? ['ok'])]
  const rows = (opts.rows ?? []).map((r, i) => ({
    chatKey: '', title: null, participantCount: null, inGroupCount: 0, lastSnapshotAt: null,
    snapshotCount: 0, isFinal: 0, lastCoverage: null, lastReconcileReason: null, lastEventAt: null,
    ...r,
    // 位置就是 rank（R28）：harness 里给 rows 的顺序 = 后端 `sort=stale` 返回的顺序。
    chatKey: r.chatKey || `12036${i}@g.us`
  })) as GroupRowWire[]

  const api = {
    postBatch: async (payload: GroupBatchPayload) => {
      posts.push(payload)
      if (opts.postNull) return null
      return { eventsAccepted: 0, eventsDuplicated: 0, membersUpserted: 1, reconciled: true, coverage: null, reason: 'ok' as const }
    },
    groups: async () => ({ records: rows, total: rows.length, page: 1, pageSize: MAX_GROUPS_PER_BUILD })
  } as unknown as Pick<GroupApi, 'postBatch' | 'groups'>

  const deps: GroupEngineDeps = {
    api,
    pull: async (viewId, cmd) => {
      pulls.push({ cmd })
      if (cmd.kind === 'group_list') {
        return opts.list === undefined
          ? { kind: 'group_list_result', reqId: cmd.reqId, ok: true, groups: opts.groups ?? [] }
          : opts.list
      }
      const mode = snapshotQueue.shift() ?? 'ok'
      if (mode === 'silent') return null
      if (mode === 'fail') return { kind: 'group_snapshot_result', reqId: cmd.reqId, chatKey: cmd.chatKey, ok: false, error: 'WPP.group 不可用' }
      return {
        kind: 'group_snapshot_result', reqId: cmd.reqId, chatKey: cmd.chatKey, ok: true,
        participants: [member('8613800000001')], participantCount: 9
      }
    },
    viewIdOf: () => 'view-1',
    sleep: async (ms) => { sleeps.push(ms) },
    now: () => 1_700_000_000_000,
    log: (where) => { logs.push(where) }
  }
  return { deps, engine: new GroupEngine(deps), pulls, posts, sleeps, logs }
}

const chatKeysPulled = (pulls: { cmd: unknown }[]): string[] =>
  pulls.map((p) => (p.cmd as { chatKey?: string }).chatKey).filter((k): k is string => typeof k === 'string')

test('happy path：先一跳登记全部可见群，再逐群一跳只带这一群的快照', async () => {
  const h = harness({ groups: [{ chatKey: 'a@g.us', title: 'A' }, { chatKey: 'b@g.us', title: 'B' }] })
  const out = await h.engine.runForAccount(7)
  assert.equal(out.list, 'ok')
  assert.equal(out.registered, 2)
  assert.equal(out.attempted, 2)
  assert.equal(out.snapshotted, 2)
  assert.deepEqual(
    h.posts.map((p) => [p.groups?.length ?? 0, p.snapshot?.chatKey ?? null]),
    [[2, null], [1, 'a@g.us'], [1, 'b@g.us']]
  )
  assert.equal(h.posts[1].snapshot?.participantCount, 9, '页内给了分母就不许用名单长度覆盖它')
})

test('每群之间必 sleep(GROUP_GAP_MS)；退避那一跳单独记 RETRY_BACKOFF_MS', async () => {
  const h = harness({ groups: [{ chatKey: 'a@g.us', title: null }], snapshots: ['fail', 'ok'] })
  await h.engine.runForAccount(7)
  assert.deepEqual(h.sleeps, [RETRY_BACKOFF_MS, GROUP_GAP_MS])
})

test('快照失败重试一次仍失败：只算这一群失败，后面的群照常拉', async () => {
  const h = harness({
    groups: [{ chatKey: 'a@g.us', title: null }, { chatKey: 'b@g.us', title: null }],
    snapshots: ['fail', 'fail']
  })
  const out = await h.engine.runForAccount(7)
  assert.equal(out.failed, 1)
  assert.equal(out.snapshotted, 1)
  assert.deepEqual(chatKeysPulled(h.pulls), ['a@g.us', 'a@g.us', 'b@g.us'], '同一群重试一次，然后前进')
  assert.match(h.logs.join('|'), /快照失败/)
})

test('列表那一跳超时 ⇒ 整轮放弃，一条快照都不发', async () => {
  const h = harness({ list: null })
  const out = await h.engine.runForAccount(7)
  assert.equal(out.list, 'silent')
  assert.equal(h.pulls.length, 1, '区分性证据：发了一条快照这里就是 2')
  assert.equal(h.posts.length, 0)
})

test('快照中途页内不再答话 ⇒ 中止整轮（aborted），剩余群不陪等超时', async () => {
  const h = harness({
    groups: [{ chatKey: 'a@g.us', title: null }, { chatKey: 'b@g.us', title: null }, { chatKey: 'c@g.us', title: null }],
    snapshots: ['ok', 'silent']
  })
  const out = await h.engine.runForAccount(7)
  assert.equal(out.aborted, true)
  assert.equal(out.attempted, 2)
  assert.deepEqual(chatKeysPulled(h.pulls), ['a@g.us', 'b@g.us'])
})

test('is_final=1 的群从没被拉过（不是"返回里没有它"那种弱断言）', async () => {
  const h = harness({
    groups: [{ chatKey: 'a@g.us', title: null }, { chatKey: 'gone@g.us', title: null }],
    rows: [{ chatKey: 'gone@g.us', isFinal: 1 }]
  })
  const out = await h.engine.runForAccount(7)
  assert.equal(out.skippedFinal, 1)
  assert.ok(!chatKeysPulled(h.pulls).includes('gone@g.us'))
})

test('册上的按后端位置排、册上没有的排最前（从没建过档的优先）', async () => {
  const h = harness({
    groups: [
      { chatKey: 'built-old@g.us', title: null },
      { chatKey: 'fresh@g.us', title: null },
      { chatKey: 'never-built@g.us', title: null }
    ],
    rows: [{ chatKey: 'fresh@g.us' }, { chatKey: 'built-old@g.us' }]
  })
  await h.engine.runForAccount(7)
  assert.deepEqual(chatKeysPulled(h.pulls), ['never-built@g.us', 'built-old@g.us', 'fresh@g.us'])
})

test('超过 MAX_GROUPS_PER_BUILD 截断，剩下的留给下一轮', async () => {
  const many = Array.from({ length: MAX_GROUPS_PER_BUILD + 50 }, (_, i) => ({ chatKey: `12036${i}@g.us`, title: null }))
  const h = harness({ groups: many, snapshots: many.map(() => 'ok') })
  const out = await h.engine.runForAccount(7)
  assert.equal(out.truncated, true)
  assert.equal(out.attempted, MAX_GROUPS_PER_BUILD)
  assert.equal(h.pulls.length, MAX_GROUPS_PER_BUILD + 1, '+1 是列表那一跳')
})

test('非法 chatKey 进不了任何一跳：列表里混一条超长键就剔掉并留日志', async () => {
  const h = harness({
    groups: [{ chatKey: 'x'.repeat(CHAT_KEY_MAX + 10), title: null }, { chatKey: 'a@g.us', title: null }]
  })
  const out = await h.engine.runForAccount(7)
  assert.equal(out.registered, 1, '整批 400 的代价由剔掉来挡，不靠后端报错')
  assert.deepEqual(chatKeysPulled(h.pulls), ['a@g.us'])
  assert.match(h.logs.join('|'), /剔除非法群键/)
})

test('postBatch 返回 null：这一群记 postedFailed，整轮继续，不抛', async () => {
  const h = harness({ groups: [{ chatKey: 'a@g.us', title: null }, { chatKey: 'b@g.us', title: null }], postNull: true })
  const out = await h.engine.runForAccount(7)
  assert.equal(out.snapshotted, 0)
  assert.equal(out.postedFailed, 2)
  assert.equal(out.aborted, false)
})

test('同账号第二次调用直接 skipped=busy：不排队也不并发', async () => {
  const pulls: number[] = []
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => { release = r })
  const deps = harness({ groups: [{ chatKey: 'a@g.us', title: null }] })
  const slow: GroupEngineDeps = {
    ...deps.engine ? ({} as GroupEngineDeps) : ({} as GroupEngineDeps),
  }
  void slow
  void pulls
  // 直接用一条会被 gate 住的 pull 造"还在跑"的现场，再断言第二次调用没发出任何新命令。
  const h = harness()
  const busy = new GroupEngine({
    ...(() => {
      const base = harness({ groups: [{ chatKey: 'a@g.us', title: null }], snapshots: ['ok'] })
      return {
        api: base.posts.length >= 0 ? (undefined as unknown as GroupEngineDeps['api']) : (undefined as unknown as GroupEngineDeps['api']),
        pull: () => { throw new Error('不该走到这里') },
        viewIdOf: () => 'view-1',
        sleep: async () => {},
        now: () => 0,
        log: () => {}
      }
    })()
  })
  void busy
  void gate
  void release
  assert.ok(true)
})
```

**上面最后一条是占位级的坏测试，不许照抄**——它断言不了任何东西。写这一节时按下面这条实现它，跑绿再提交：

```ts
test('同账号第二次调用直接 skipped=busy：不排队也不并发', async () => {
  let releaseFirst: () => void = () => {}
  const gate = new Promise<void>((r) => { releaseFirst = r })
  const pulls: string[] = []
  const deps: GroupEngineDeps = {
    api: {
      postBatch: async () => ({ eventsAccepted: 0, eventsDuplicated: 0, membersUpserted: 0, reconciled: true, coverage: null, reason: 'ok' }),
      groups: async () => ({ records: [], total: 0, page: 1, pageSize: 200 })
    } as unknown as GroupEngineDeps['api'],
    // 列表那一跳立刻答，快照那一跳卡在 gate 上：这就是"泵正在跑"的现场。
    pull: async (_viewId, cmd) => {
      pulls.push(cmd.kind)
      if (cmd.kind === 'group_list') {
        return { kind: 'group_list_result', reqId: cmd.reqId, ok: true, groups: [{ chatKey: 'a@g.us', title: null }] }
      }
      await gate
      return { kind: 'group_snapshot_result', reqId: cmd.reqId, chatKey: cmd.chatKey, ok: true, participants: [], participantCount: 0 }
    },
    viewIdOf: () => 'view-1',
    sleep: async () => {},
    now: () => 0,
    log: () => {}
  }
  const engine = new GroupEngine(deps)
  const first = engine.runForAccount(7)
  while (engine.running(7) === false) await new Promise((r) => setTimeout(r, 0))
  const second = await engine.runForAccount(7)
  assert.equal(second.skipped, 'busy')
  assert.equal(pulls.filter((k) => k === 'group_list').length, 1, '第二次连列表都不该发')
  releaseFirst()
  const done = await first
  assert.equal(done.skipped, null)
})

test('账号没绑视图：skipped=no_view，一条命令都不发', async () => {
  const deps = { ...harnessDeps(), viewIdOf: () => null }
  const out = await new GroupEngine(deps).runForAccount(7)
  assert.equal(out.skipped, 'no_view')
  assert.equal(out.attempted, 0)
})
```

（`harnessDeps()` 就是上面那个 `harness()` 的 deps 部分；最后两条测试落地时把 `harness()` 重构成返回 `deps` 可覆盖的形式，别复制第二份 harness。）

- [ ] **Step 2: 跑到红**

```bash
cd /d/SmartSCRM/apps/desktop && node --test src/main/services/groupCollect/engine.test.ts
```
期望：FAIL（`Cannot find module './engine.ts'`）。

- [ ] **Step 3: 实现泵**

```ts
// src/main/services/groupCollect/engine.ts
import type { BridgeCommand } from '../../../shared/chatTypes.ts'
import {
  CHAT_KEY_MAX,
  GROUP_GAP_MS,
  MAX_GROUPS_PER_BUILD,
  RETRY_BACKOFF_MS,
  type GroupBatchPayload,
  type GroupListWire,
  type GroupSnapshotPayload
} from '../../../shared/groupMembers.ts'
import type { GroupApi } from './api.ts'
import type { GroupWireResult } from './registry.ts'

export type GroupCommandWire = Extract<BridgeCommand, { kind: 'group_list' } | { kind: 'group_snapshot' }>

export interface GroupEngineDeps {
  api: Pick<GroupApi, 'postBatch' | 'groups'>
  /** R5：泵不碰 registry、不碰 IPC，只经这一条出料口。`null` = 页内没答（超时或视图没了）。 */
  pull(viewId: string, cmd: GroupCommandWire): Promise<GroupWireResult | null>
  viewIdOf(accountId: number): string | null
  sleep(ms: number): Promise<void>
  /** 注入时钟：形状照 `batchSend/engine.ts` 的 `EngineDeps`。本期泵不读时间（`occurred_at` 的折算在后端）。 */
  now(): number
  log(where: string, e: unknown): void
}

export interface GroupBuildOutcome {
  accountId: number
  /** `'busy'` = 这个账号已经有一条在跑；`'no_view'` = 账号没绑视图。这两格既不算失败也不算跑过。 */
  skipped: 'busy' | 'no_view' | null
  list: 'ok' | 'error' | 'silent'
  registered: number
  attempted: number
  snapshotted: number
  /** 名单拿到了但 `POST /batch` 没成：与快照失败分开记，两者的去处不同（重试页内 / 等后端）。 */
  postedFailed: number
  failed: number
  skippedFinal: number
  truncated: boolean
  /** 页内中途不再答话，剩余群没陪它等超时（spec §5 的「一轮跑不完留给下一轮」）。 */
  aborted: boolean
}

/** 页内文本进日志前收成一行（`msgBridge/index.ts:163-167` 同口径，跨服务不导出它）。 */
function line(value: unknown, max = 120): string {
  // eslint-disable-next-line no-control-regex
  return String(value ?? '').replace(/[\x00-\x1f]+/g, ' ').slice(0, max)
}

/**
 * 建档泵：一条只读的命令回路，从页内拿群列表与每群名单，交给后端判状态。
 * 这里不裁决「谁在群里」——那是 `GroupMemberService` 的覆盖率闸（Task 6），
 * 所以泵崩了、中止了、截断了，都不会写出一条后端不认的状态。
 */
export class GroupEngine {
  private readonly deps: GroupEngineDeps
  private seq = 0
  private stopped = false
  private readonly runningSet = new Set<number>()

  constructor(deps: GroupEngineDeps) {
    this.deps = deps
  }

  running(accountId: number): boolean {
    return this.runningSet.has(accountId)
  }

  /** 只停「下一群」这一步：已经在途的那一跳由它自己的超时结清，这里不假装能撤回发出去的消息。 */
  stop(): void {
    this.stopped = true
  }

  async runForAccount(accountId: number, chatKey?: string): Promise<GroupBuildOutcome> {
    const out: GroupBuildOutcome = {
      accountId, skipped: null, list: 'ok', registered: 0, attempted: 0, snapshotted: 0,
      postedFailed: 0, failed: 0, skippedFinal: 0, truncated: false, aborted: false
    }
    if (this.runningSet.has(accountId)) {
      out.skipped = 'busy'
      return out
    }
    const viewId = this.deps.viewIdOf(accountId)
    if (!viewId) {
      out.skipped = 'no_view'
      return out
    }
    this.runningSet.add(accountId)
    try {
      await this.build(viewId, accountId, chatKey, out)
    } finally {
      this.runningSet.delete(accountId)
    }
    return out
  }

  private async build(viewId: string, accountId: number, only: string | undefined, out: GroupBuildOutcome): Promise<void> {
    // ① 页内群列表。`null`（没答）与 `ok:false`（答了失败）都放弃整轮：同一页面上连发必然同失败。
    const listRes = await this.deps.pull(viewId, { kind: 'group_list', reqId: this.req() })
    if (!listRes) {
      out.list = 'silent'
      this.deps.log(`列表超时 account=${accountId}`, new Error('页内没答 group_list'))
      return
    }
    if (listRes.kind !== 'group_list_result') {
      out.list = 'silent'
      this.deps.log(`列表帧型不符 account=${accountId}`, new Error(String(listRes.kind)))
      return
    }
    if (!listRes.ok) {
      out.list = 'error'
      this.deps.log(`列表失败 account=${accountId}`, new Error(line(listRes.error)))
      return
    }
    // ② 剔非法：`GroupBatchDTO.groups` 里一条超 `@Size` 就是整批 400，其余本来能登记的群会被它拖死。
    const all = (listRes.groups ?? []).filter((g): g is GroupListWire => typeof g?.chatKey === 'string' &&
      g.chatKey.length > 0 && g.chatKey.length <= CHAT_KEY_MAX)
    if (all.length !== (listRes.groups?.length ?? 0)) {
      this.deps.log(`剔除非法群键 account=${accountId} 丢弃=${(listRes.groups?.length ?? 0) - all.length}`,
        new Error('chatKey 缺失或超长'))
    }
    out.registered = all.length

    // ③ 一跳登记全部可见群（R29）：登记册要完整，快照失败不该让一个群从册子上消失。
    const batched = all.slice(0, MAX_GROUPS_PER_BUILD)
    if (batched.length > 0) {
      const posted = await this.deps.api.postBatch({ accountId, groups: batched })
      if (!posted) this.deps.log(`群册登记失败 account=${accountId}`, new Error('postBatch 返回 null'))
    }

    // ④ 建档顺序读后端的 `sort=stale`（R28）：位置即 rank，册上没有 = 从没建过档 = 最前。
    const page = await this.deps.api.groups(accountId, 1, MAX_GROUPS_PER_BUILD)
    if (!page) this.deps.log(`读建档顺序失败 account=${accountId}`, new Error('groups 返回 null：按本地顺序建'))
    const rank = new Map<string, number>()
    const finalKeys = new Set<string>()
    for (const [i, row] of (page?.records ?? []).entries()) {
      rank.set(row.chatKey, i)
      if (row.isFinal === 1) finalKeys.add(row.chatKey)
    }

    const candidates: GroupListWire[] = only
      ? // 单群补拉（spec §5 触发点 ②③）：不在列表里也照拉，登记靠那一跳的 `groups:[这一群]`。
        [{ chatKey: only, title: all.find((g) => g.chatKey === only)?.title ?? null }]
      : all.filter((g) => {
          if (!finalKeys.has(g.chatKey)) return true
          out.skippedFinal += 1
          return false
        })
    if (!only) {
      // 稳定排序：册上没有的都给 -1，它们之间保持页内原序（V8 的 Array#sort 稳定）。
      candidates.sort((a, b) => (rank.has(a.chatKey) ? rank.get(a.chatKey)! : -1) -
        (rank.has(b.chatKey) ? rank.get(b.chatKey)! : -1))
    }
    if (candidates.length > MAX_GROUPS_PER_BUILD) out.truncated = true

    for (const group of candidates.slice(0, MAX_GROUPS_PER_BUILD)) {
      if (this.stopped) {
        out.aborted = true
        break
      }
      out.attempted += 1
      const snap = await this.snapshot(viewId, group.chatKey)
      if (snap === 'silent') {
        // 页内已经不答话了：继续发下去每一群都要等一个 15s 超时，剩下的留给下一轮。
        out.aborted = true
        break
      }
      if (snap === 'fail') {
        out.failed += 1
        await this.deps.sleep(GROUP_GAP_MS)
        continue
      }
      const posted = await this.deps.api.postBatch({ accountId, groups: [group], snapshot: snap })
      if (posted) out.snapshotted += 1
      else {
        out.postedFailed += 1
        this.deps.log(`快照入库失败 account=${accountId} chat=${line(group.chatKey)}`, new Error('postBatch 返回 null'))
      }
      await this.deps.sleep(GROUP_GAP_MS)
    }
  }

  /**
   * 三态出口（Task 10 第一条的兑现）：
   * `null` → `'silent'`（中止整轮）；`ok:false` → 退避后重试一次，仍失败才 `'fail'`（只算这一群）；否则名单。
   */
  private async snapshot(viewId: string, chatKey: string): Promise<GroupSnapshotPayload | 'silent' | 'fail'> {
    const first = await this.pullSnapshot(viewId, chatKey)
    if (first === 'silent') return 'silent'
    if (first !== 'fail') return first
    this.deps.log(`快照失败，退避重试 chat=${line(chatKey)}`, new Error('准备重试一次'))
    await this.deps.sleep(RETRY_BACKOFF_MS)
    const second = await this.pullSnapshot(viewId, chatKey)
    if (second === 'silent') return 'silent'
    if (second === 'fail') {
      this.deps.log(`快照失败 chat=${line(chatKey)}`, new Error('重试后仍失败'))
      return 'fail'
    }
    return second
  }

  private async pullSnapshot(viewId: string, chatKey: string): Promise<GroupSnapshotPayload | 'silent' | 'fail'> {
    const res = await this.deps.pull(viewId, { kind: 'group_snapshot', reqId: this.req(), chatKey })
    if (res === null) return 'silent'
    if (res.kind !== 'group_snapshot_result') return 'silent'
    if (!res.ok) {
      this.deps.log(`页内报快照失败 chat=${line(chatKey)}`, new Error(line(res.error)))
      return 'fail'
    }
    const participants = res.participants ?? []
    return {
      chatKey: res.chatKey,
      participants,
      // 页内没给分母才用名单长度补（两次同源于名单长度时 coverage 依然如实衡量缩水）；给了就不许覆盖。
      participantCount: res.participantCount ?? participants.length,
      ...(res.truncated === undefined ? {} : { truncated: res.truncated })
    }
  }

  /** R6：reqId 由泵生成、页内原样回带。`g<seq>` 在同一进程内唯一。 */
  private req(): string {
    return `g${(this.seq += 1)}`
  }
}
```

- [ ] **Step 4: 跑到绿**

```bash
cd /d/SmartSCRM/apps/desktop && node --test src/main/services/groupCollect/engine.test.ts 2>&1 | tail -25
```
期望：12 条全过（happy path、节律、重试一次、列表超时、中途静默、`is_final`、排序、截断、非法群键、POST 失败、busy、no_view）。

- [ ] **Step 5: 全量 unit + 四路 typecheck + lint**

```bash
cd /d/SmartSCRM/apps/desktop
pnpm run test:unit 2>&1 | tail -15
pnpm run typecheck:unit && pnpm run typecheck:node && pnpm run typecheck:web && pnpm run typecheck:inject
pnpm exec eslint src/main/services/groupCollect/engine.ts src/main/services/groupCollect/engine.test.ts --quiet
```
期望：`test:unit` 总数比 Task 10 后多 12；四路全过；`--quiet` 零输出。

- [ ] **Step 6: 提交**

```bash
git add apps/desktop/src/main/services/groupCollect/engine.ts apps/desktop/src/main/services/groupCollect/engine.test.ts apps/desktop/tsconfig.unit.json
git commit -m "$(cat <<'EOF'
feat(P8/群成员): 只读建档泵——串行、stale 优先、页内失声即止

列表超时与快照超时是两件事：前者整轮放弃，后者只中止这一轮，而 ok:false 只让这一群重试一次。
建档顺序读后端 sort=stale 的位置，不在 JS 比 Jackson 的日期字符串。

群册先一跳登记全部可见群，再逐群一跳：快照失败不该让一个群从登记册上消失。

Co-Authored-By: Qoder <noreply@qoder.com>
EOF
)"
```

---

<!-- APPEND-SENTINEL: Task 12 起接在这里 -->

