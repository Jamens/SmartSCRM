# P8 / B6 群成员分析 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「账号在哪些群里 / 每个群里有哪些人 / 谁在什么时候被谁加进来或踢出去」变成库里的事实，提供群名单、成员名单、进退流水三块读面与一份 14 列 XLSX 导出。

**Architecture:** 三段式。**页内**（桥）只回答「我看见了什么」：两条新命令 `group_list` / `group_snapshot`、三种新帧 `group_list_result` / `group_snapshot_result` / `group_event`。**主进程**盖章账号归属并做只读建档泵（上线全量、进群详情补拉、弹层手动刷新，无定时器），事件帧即时批量入库。**Java** 持全部状态判定：群登记 → 事件先行投影 → 快照收口 + 覆盖率闸，读面与导出取数都在后端。渲染层只有客户抽屉「所在群」一节与群成员弹层两处宿主。

**Tech Stack:** MySQL 8（本地 `smartscrm_react`）+ Flyway `V12`；Spring Boot 3 / Java 17 / MyBatis-Plus 注解 SQL；Electron 39 主进程 + preload IPC；wa-js 4.6.0 注入桥（esbuild bundle）；React 19 + @tanstack/react-query 5 + Tailwind 4 + radix-ui；exceljs（仅主进程）；`node --test`、JUnit 5 + Mockito。

**Spec:** `docs/superpowers/specs/2026-09-30-group-member-analysis-design.md`（本计划相对它的每一处偏离都记在下面的决策表里；冲突时以 spec 为准，spec 未覆盖处按下表裁定）

## §A as-built 校准（执行前先读这一节）

B6 的实现分成了两段交付：**Java 数据层**（`3771927`）与**桥侧采集 + shared 纯模型**（`2b2df31` + `ade904e`）已经进了 `main`，而本计划的 Task 1–8 正文写的是设计时的契约形状。两者不一致。用户裁定（2026-10-01）：**形状跟代码，语义跟 spec**——命名与线形以已提交代码为权威（下面的 §A.2 / §A.3 / §A.4），已提交代码与 spec 冲突的语义**改代码**（Task 8b），Task 9 之后的任务一律按本节读写。

### §A.1 交付状态（读码取证）

| 提交 | 内容 | 对应本计划 | 状态 |
|---|---|---|---|
| `2b2df31` | V12 三表迁移 + `shared/groupMembers.ts` 纯模型与 JS 单测 | Task 1（迁移部分）、Task 2 | 已交付 |
| `3771927` | 三实体 + 三 Mapper + `GroupMemberService` / `GroupMemberQueryService` + `GroupMemberController` | Task 1、5、6、7、8 | 已交付，**无 JUnit 覆盖**（`apps/server/src/test` 下没有 `GroupMember*Test.java`，实测：该目录只有 batch/msg/provider/translation 几类）——补测就是 Task 8b 的载体 |
| `ade904e` | 桥侧群名单/快照/在线事件 + 系统消息旁路（`bridge/whatsapp/groups.ts` +311 行、`chatTypes.ts` 三帧两命令、299 行单测） | Task 3、4 | 已交付 |
| `fad3fda`（+ 8b 修正轮一次提交） | Task 8b 的八条语义校准：V13 两列 + `MemberPageVO` + `markSnapshotSuccess`/`markGate` 分工 + 行序/转义/账号收窄/导出码数/事件投影/入参长度闸；附 17 条校准单测（读侧 10 / 写侧 7）与 2 条「缺必填查询参数 = 400」的形状单测 | Task 8b | 已交付（`apps/server` 全量 `./mvnw test` 绿；V13 两列由 `tmp/P8Tables.java` 探针实测已进库） |
| `954eb58` `4852494` | 计划与本 spec 的文档同步 | — | 已交付 |

**未开工**：Task 9、10、12、13、14、15、16、17。

**Task 11 是例外，且这一条例外要写成现场判定而不是结论**（实测 2026-10-01）：`git status --porcelain -- apps/desktop/src/main/services/groupCollect/` 返回 `?? apps/desktop/src/main/services/groupCollect/`，`git log --oneline -- …groupCollect/` 无输出，Glob 可见 `engine.ts`（导出 `GroupListReply`/`GroupSnapshotReply`/`GroupCommand`/`GroupDispatch`/`IngestPayload`/`GroupCollectApi`/`GroupCollectDeps`/`BuildResult`/`class GroupCollectEngine`，方法 `get busy()` 与 `runBuildForAccount(accountId: number, chatKeys?: string[]): Promise<BuildResult>`，唯一 import 是 `../../../shared/groupMembers.ts`）与 `engine.test.ts`（10 条 `test(...)`）。**读码**：这两支文件不在 `apps/desktop/tsconfig.unit.json` 的 `include` 里（该表的 groupCollect 条目由 Task 9 补，见其 Files），也不在另外三路 typecheck 覆盖面内——所以这台泵**从未被编译过、从未被 `node --test` 跑过**，它的"存在"目前只是磁盘事实，不是验收事实。

**它因此不享有 R30 的"形状跟代码"**：R30 认的是**已提交且已验收**的代码（§A.1 那张表里的四个提交），而一支没进任何闸门、也没进版本库的文件只是编辑区里的一个候选形状。Task 11 的 Interfaces 段（`GroupEngine` / `GroupEngineDeps{api,pull,viewIdOf,sleep,now,log}` / `runForAccount(accountId, chatKey?)` / `GroupBuildOutcome`）才是 Task 12/15/16 已经按它写就的契约；那台树里的泵与之有五处实差（读码，逐条都要在 Step 0 报告里判掉）：

| # | 树里那份 | 计划契约 | 影响 |
|---|---|---|---|
| 1 | `GroupCollectEngine` / `runBuildForAccount` | `GroupEngine` / `runForAccount` | 名字；Task 12 的 host 按后者 import |
| 2 | `chatKeys?: string[]`（复数） | `chatKey?: string`（单数） | IPC 与 preload 的入参形状；见 R49 |
| 3 | `deps.dispatch(cmd, timeoutMs)`（泵不知视图） | `deps.pull(viewId, cmd)` + `viewIdOf(accountId)` | 视图归属由谁解析；Task 10 的 registry 与 Task 12 的路由按后者接线 |
| 4 | `deps.snapshotAtOf(chatKey)` 本地排序，且 `GroupCollectApi` 只有 `ingest` | 读 `GET /groups?sort=stale`（R28/R41，Task 9 的 `groups()` 那一跳） | 树里那份压根没接后端排序，`sort=stale` 这条已交付能力没人用 |
| 5 | `BuildResult{built,failed,abandoned?,deferred}` | `GroupBuildOutcome{skipped,list,registered,attempted,snapshotted,postedFailed,failed,skippedFinal,truncated,aborted,accountId}` | `group:state` 广播与 §8 的「未建档/已定档/截断」三格全靠 outcome 的字段；`skippedFinal` 那一格在树里那份没有对应实现（R21 的 `is_final` 跳过没做） |

Step 0 的量法与判读（Task 11 执行席第一件事，先量后写）：

```bash
cd apps/desktop
git status --porcelain -- src/main/services/groupCollect/    # ?? = 仍未纳管；无输出 = 已被前席提交，按下面 ③ 判
pnpm run typecheck:unit                                       # 期望：Task 9 接完 include 后这两支才进编译，否则本命令对它们零覆盖
pnpm run test:unit 2>&1 | tail -15                            # 期望：泵那 10 条进总数
```

① 编译与 10 条断言全绿，且逐条对上 Interfaces 段 → 本任务的实现步降级为"复核 + 补 `is_final` 与 `sort=stale` 两处缺的语义 + 改名对齐 + 提交"；② 有红或对不上契约 → 按正文实现覆盖那两支文件（实现是本计划写的，覆盖它不算重写别人的成果）；③ 若届时 `git log` 显示它已被提交进主干且与正文不符 → 那才轮到 R30，停手按代码对齐 Task 12/15/16 的引用名，并在决策表补一行。**推断**（不进判据）：`??` 更可能是前一段会话留下的半成品，理由是同目录里没有 Task 9/10 的 `api.ts`/`registry.ts`/`collector.ts`，而单独一份泵无法装配。

### §A.2 权威线形——后端六跳（`/api/group-members`，已提交）

信封、`PageResult` 的 JSON 键（`records/total/page/pageSize`）、401 无 `data` 等横切形状与 P6/P7 相同，这里只列本节特有的部分。字段名逐字抄自 `GroupMemberController.java` / `GroupMemberService.java` / `GroupMemberBatchDTO.java` / `web/vo/Group*.java`。

**① `POST /batch`** — 入参 `GroupMemberBatchDTO`（可变类，校验**只有** `accountId` 一处 `@NotNull`）：

```
{ accountId, groups?:[{chatKey,title}], snapshot?:{chatKey,participants:[{memberKey,phone,displayName,roleType}]},
  events?:[{chatKey,memberKey,actorKey,actorName,eventType,occurredAtEpochSec,dedupKey,source,rawType,rawSubtype,bodySnapshot}] }
```

出参 `IngestResult(groupsUpserted:int, eventsInserted:int, reconciled:boolean, coverage:Double|null, reason:String)`：

- `groupsUpserted` / `eventsInserted` 是**两个计数**，计划正文里的 `eventsAccepted / eventsDuplicated / membersUpserted` 三计数与 `reasons[]` 逐条拒收文案**都不存在**。
- `reason` **四值**：`ok | first_build | coverage_too_low | no_snapshot`。第四种的含义是「这一批根本没带可用快照」（缺 `snapshot`、`chatKey` 非群键、去重后名单为空都算），此时 `reconciled=false`、`coverage=null`、HTTP 200。
- **空名单不是 40000**：正文 Task 5 里「空名单整批拒收」那一格没实现，实现走的是 §A.5 的 `no_snapshot`（语义与 spec §4「空名单不当成功快照」一致，只是不拒收）。闸放行时才 `markSnapshotSuccess`；被闸拦下时**分母、`last_snapshot_at`、`snapshot_count` 三列都不动**（R20 已落实，读码确认）。
- 非法 `roleType` 归 `member`；非法 `eventType` / `source` 静默丢弃；`bodySnapshot` 与展示文本 clip 512。

**② `GET /groups?accountId&page&size&sort`** → `PageResult<GroupVO>`，`GroupVO(chatKey,title,platform,participantCount,snapshotCount,inGroupCount,lastSnapshotAt,lastEventAt,isFinal,lastCoverage,lastReconcileReason)`（后两键是 8b ③ 补的，追加在末尾）。`isFinal` 是 Java `boolean` → JSON `true|false`，**不是 0/1**。`platform` 由账号反查，客户端说了不算。`sort` 可选（8b ⑥）：`sort=stale` 给建档泵那一支，`ORDER BY ISNULL(last_snapshot_at), last_snapshot_at, id`（从没成功快照的最前，其余按上次成功快照从旧到新）；缺省或不认识的值 = 今天那份顺序（`last_snapshot_at DESC, id DESC`，新的在前）。泵读返回的**位置**当 rank，不解析日期串（R28 / R41）。

**③ `GET /group/members?accountId&chatKey&isInGroup&role&q&page&size`** → 一个三键对象 `{members, coverage, reason}`：`members` 是 `PageResult<GroupMemberVO>`；`coverage` 在**线路上是 `number | null`**（已修，8b ③：容器是 record `MemberPageVO(members, coverage, reason)`，`null` 原样是 `null`，不折成空串）；`reason` 是上面那四值之一。这两个读数**读的是 `chat_group` 落库的那两列**（`last_coverage` / `last_reconcile_reason`，见本节末 V12/V13 那一行），不在翻页时现场算——现场算用的是当前这一页的在群人数，翻页会给出不同的 coverage（`GroupMemberVO` 的 `isInGroup` 是 `boolean`）。

**④ `GET /group/events?accountId&chatKey&eventType&page&size`** → `PageResult<GroupEventVO(id,chatKey,groupTitle,memberKey,actorKey,actorName,eventType,occurredAt,source,rawType,rawSubtype,bodySnapshot)>`。`groupTitle` 列存在但**写入侧恒为 NULL**（Task 8b 不修它，界面按「可能为空」渲染）。

**⑤ `GET /customer/{customerId}/groups?accountId`** → `List<GroupVO>`。`accountId` 是**必填**参数（已修，8b ④）：这一跳按 `(platform, account_id)` 收窄，两个账号下的同名群不会混成一份名单（R16 / spec §9）。缺这一个参数得到 **HTTP 400**（`GlobalExceptionHandler` 对「缺必填查询参数」有自己那一支，返回 `code=40000`、`message` 点出缺的是哪个字段），不是 500。

**⑥ `GET /group/members/export-rows?accountId&chatKeys`**（`chatKeys` 是逗号分隔的 `List<String>`）→ `List<GroupExportRowVO>`：

```
{seq, groupName, groupId, phone, name, role, inGroup, joinAt, joinCount, leaveAt, exitMethod, lastMsgAt, dayMsgCount, msgCount}
```

四处与正文不同，Task 13 的 exporter 逐字按这里写：群键列叫 **`groupId`** 不叫 `chatKey`；**没有 `memberKey`、没有 `firstSeenAt`**（14 列本来就不含它们）；`inGroup` 已经是中文串 **`'是'|'否'`**（后端 `GroupExportRowVO` 里格式化过，主进程**不许再映射一次**）；`role` 仍是原始码 `member|admin|super`（要过 `groupRoleLabel`）。三个消息列叫 `lastMsgAt / dayMsgCount / msgCount`，不叫 `lastChatAt / dayCount / totalCount`。

**`chat_group` 的列宽与闸读数**：`chat_key` 128、`title` 256。闸的两个**读数**落在 `chat_group` 自己的两列上（已修，8b ③ 的 `V13__group_gate_reading.sql`）：`last_coverage DOUBLE NULL`（`NULL` = 没做过可判定的快照）、`last_reconcile_reason VARCHAR(24) NULL`（`ok | first_build | coverage_too_low | no_snapshot`），位置在 `snapshot_count` 之后；`markSnapshotSuccess` 与 `markGate` 是它们的唯一写者，读侧（② 的两个新键、③ 的 `coverage`/`reason`）只读不写。V12 那三张表的列宽（写夹具用）：`chat_key` 128、`member_key` 160、`phone` 32、`display_name` 128、`role_type` 16、`exit_method` 24、`group_title` 256、`body_snapshot` 512、`dedup_key` 160——入参长度闸（8b ⑧）用的就是这几个数。

### §A.3 权威线形——已交付的 JS 侧实名

`shared/groupMembers.ts`（`2b2df31`，`ade904e` 续）：`GroupMemberRole`、`GroupEventType`、`GroupEventSource`、`GroupParticipantWire{memberKey,phone,displayName,roleType}`、`GroupEventWire`、`GROUP_GAP_MS=600`、`SNAPSHOT_TIMEOUT_MS=15_000`、`RETRY_BACKOFF_MS=2_000`、`MAX_GROUPS_PER_BUILD=200`、`COVERAGE_MIN=0.6`、`MAX_EXPORT_GROUPS=50`、`EXPORT_COLUMNS`（14 项，`as const`）、`eventTypeFromAction`、`liveEventDedupKey`、`GroupSystemRaw`、`GroupSystemClassification`、`classifyGroupSystemMessage`、`mergeParticipants`、`snapshotIsUsable`、`CoverageReason`（四值）、`CoverageVerdict`、`snapshotCoverage`。

命令与帧（`shared/chatTypes.ts`）：下行 `{kind:'group_list', reqId}`、`{kind:'group_snapshot', reqId, chatKey}`；上行 `group_list_result{reqId,ok,groups?:[{chatKey,title}],error?}`、`group_snapshot_result{reqId,ok,chatKey,participants?,participantCount?,truncated?,error?}`、`group_event{events:GroupEventWire[]}`。

**`participantCount` / `truncated` 只存在于页内那一帧**（桥 → 主进程，读码 `chatTypes.ts:157-166`），`GroupMemberBatchDTO.SnapshotItem` 里没有这两个字段。所以主进程**发不出去**它们：泵把它们用作本地排序与日志依据（Task 11 的技术要点相应改写），不进 POST 体。

### §A.4 计划正文名 → as-built 名

| 正文里的名字 | as-built | 说明 |
|---|---|---|
| `GroupBatchDTO` | `GroupMemberBatchDTO` | 嵌套类 `GroupItem / SnapshotItem / ParticipantItem / EventItem` |
| `GroupBatchVO` / `GroupBatchResult` | `IngestResult` / `GroupIngestResult` | 两计数，无 `reasons[]` |
| `eventsAccepted` `eventsDuplicated` `membersUpserted` | `eventsInserted` `groupsUpserted` | 拒收不落库，所以没有「重复」计数 |
| `GroupReconcileReason`（三值） | `CoverageReason`（四值） | 已在 shared 交付，Task 9 **不许重复声明** |
| `MemberPageVO` | `{members, coverage, reason}` | 读侧容器；Task 8b ③ 后换成 record `MemberPageVO` 且 `coverage` 可为 null |
| `GroupRowVO` / `GroupMemberRowVO` / `GroupEventRowVO` / `CustomerGroupVO` | `GroupVO` / `GroupMemberVO` / `GroupEventVO` / 复用 `GroupVO` | **全是 record**：它们是服务层组装的出参，不是 MyBatis 行载体，所以 R24 那条「行载体必须可变 POJO」的顾虑在这里不适用（R31） |
| `GROUP_EXPORT_COLUMNS` / `EXPORT_GROUP_MAX` | `EXPORT_COLUMNS` / `MAX_EXPORT_GROUPS` | |
| `GroupExportRowWire` | 同名单但字段换成 §A.2 ⑥ 那 14 个键 | 无 `chatKey/memberKey/displayName/firstSeenAt/isInGroup` |
| `groupEventTypeOfAction` / `phoneOfMemberKey` | `eventTypeFromAction` / 无（号码在桥侧 `groups.ts` 内取） | |
| `tmp/P8Cleanup.java` | `tmp/P8Purge.java` | 定义在 Task 14 |
| `tmp/p8a-group-contract.mjs` | `tmp/p8-group-members-contract.mjs` | 已有草稿，Task 14 校正它 |

### §A.5 语义偏差 → 全部归 Task 8b

形状可以各叫各的，语义不行。已提交代码与 spec 冲突的地方逐条列在 **Task 8b**（①–⑧），每条先写红的 Java 单测再改代码。**Task 14 的契约腿按 §A.2 的"修完之后"那一列断言**，红格一律回 Task 8b 修，不许放宽判据凑绿。

### §A.6 本节怎么对下游任务生效

SDD 的执行单元是**单任务节选**（brief 只切一个 Task），所以 §A 不能作为唯一出处——每个受影响的任务节里都有一份「as-built 修正」块，修正写进了正文的代码与 Interfaces 里。Task 1–8 的正文**不改写**：它们是已交付那两段的过程记录，与 §A 冲突处以 §A 为准；谁要动那一层的语义，走 Task 8b。

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
- `tmp/` 与 `.superpowers/` 已 gitignore：驱动脚本**永不进提交**、`apps/desktop/tsconfig.node.tsbuildinfo` 永不暂存、禁 `git clean -fdx`。
- 外部参考资料只读（Read/Grep，不用 Bash 进入）；写进 `docs/` 的文档只陈述本项目规则，**不与其他实现比较**。
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
| R19 | 契约驱动的清理用 `tmp/P8Purge.java`（JDBC DELETE），**只删驱动自己那一轮造出来的键**（把 `GROUP_KEY` 与 `mk(n)` 系列作为参数传进去，按精确键删，不按前缀删） | 群面本期不提供 DELETE 端点（§14 没写，§7 也没有）；断言仍全部走 :8180，只有清理这一跳例外。改成精确键清单是因为驱动用的是 `12036<运行号>@g.us`，前缀删法会连着删掉别人上一轮留下的数据，而那份数据正是另一条腿的判据 | 有一条读码之外的写库通道，必须把它锁死在「参数来自本进程」这一条上并在探针输出每张表删了几行（**删不动 = 断言失败**，不是 = 无事发生） |
| R20 | `participant_count`（分母）只由**成功**快照覆盖；失败拉取永不写它，也不写 `last_snapshot_at` | spec §6 陷阱 ① 的直接落实；一旦失败拉取能写分母，一次网络抖动就会把整群人在闸前推定成退群 | 「成功」的定义必须包含「两方皆空 ⇒ 不算成功」（Task 3 的页内判定 + Task 6 的入库判定两头都挡） |
| R21 | `is_final=1` 的群泵跳过、读面仍返回 | spec §8 那格的直译 | 泵的单测要专门有一例断言它「没拉」，而不是断言返回里没有它 |
| R22 | 导出取数走 `GET /group/members/export-rows?accountId&chatKeys`，**行序在后端**排；exceljs 只负责写字面量 | §10 的行序规则（群序 + 群内 `latest_join_at` 升序、NULL 沉底按 `first_seen_at` + 跨群连续序号）一旦在渲染层或主进程各排一遍就分叉；后端一份 `Comparator` 是唯一出处 | 主进程只做编码与落盘，测试面变小 |
| R23 | exceljs 进 `dependencies`（不是 devDependencies） | electron-vite 只把 `dependencies` 里的包当外部留在 `node_modules`；进 dev 就会被打进主进程 bundle，`out/` 里出现两份，§15#4 那条构建产物实测也就失去意义 | 打包体积（Task 12 要量一次实际大小并记档） |
| R24 | `@Select` 的返回类型（`GroupRowVO` / `GroupMemberRowVO` / `GroupEventRowVO` / `CustomerGroupVO` / Task 8 的 `GroupExportRowVO`）是 Lombok `@Data` 可变 POJO；只有服务层自己组装的出参（`MemberPageVO`、Task 5 的 `GroupBatchVO`）才是 record | MyBatis 对没有默认构造器的目标走**构造器自动映射、按列序不按列名**（仓库只开了 `map-underscore-to-camel-case`，`application.yml:19-21`，没开 `arg-name-based-constructor-auto-mapping`）。record 当行载体时，SELECT 清单一改顺序就按位置错填且全静默 | 读面少一点「record 更纯」的审美；这四个类的类注释要写明为什么可变，否则下一个端点会把 record 抄进来。**本行的形状部分已被 R31 与已提交代码取代**：`3771927` 里那四个读侧 VO、`GroupExportRowVO` 与 `MemberPageVO` 全是 record（读码 `web/vo/GroupExportRowVO.java:11`），因为交付形态是服务层组装（`GroupMemberQueryService.java:120,136` 用 `selectList` 取实体再在 Java 里映射），**没有任何 VO 当过 `@Select` 的行载体**。R24 那条规则本身仍然有效，只是触发条件换成「以后若把某个 VO 直接当 `@Select` 的返回类型」——Task 7/8 正文里「`@Data` 可变 POJO」那几段是当时的预测，按各节「本节正文不改写」的约定留着不改，以本行与 R31 为准 |
| R25 | 「一轮建档」是一个有界批次：上限 `MAX_GROUPS_PER_BUILD = 200`，跑不完的留给下一轮；三条触发点（上线全量 / 进群详情补拉 / 弹层手动刷新）合成 `group:build` 两支——`chatKey` 省略 = 整账号一轮，带上 = 只补这一群。**不做定时器** | 定时的重扫会长期在页面上打 `getParticipants`，而本期没有任何读数依赖"定时"；上限给一轮一个终点，跑不完就留到下一次触发 | 一个从没被再触发的群可能长期不建档——`GET /groups?sort=stale`（R28 / Task 8b ⑥）与 §8 的「未建档」标注就是这一格的可见面 |
| R26 | 主进程只挂三跳（`postBatch` / `groups` / `exportRows`）；成员名单、进退流水、客户反查三支走渲染层自己的 `lib/http.ts` | 那三支的唯一读者是界面，做成 IPC 转发只会得到三份没人调用的代码 + 两条白名单，而界面读它们时用的是渲染层那一份 | 同一批 VO 类型要放 `shared/` 给两侧共用（R27） |
| R27 | 读侧 wire 类型放 `shared/groupMembers.ts`，不放 `api.ts` | 渲染层不 import `main/**`；「字段命名与序列化只在 shared 定一处，两侧都从它取型」（spec §4 末行）在跨进程边界上同样成立 | shared 里多出几个纯类型 |
| R28 | 泵按 `GET /groups?sort=stale` 返回的**位置**当建档优先级（第 i 行 rank=i，册子上查不到的键 rank=-1 排最前），**不解析** `lastSnapshotAt` 字符串 | `LocalDateTime` 的 Jackson 形状不是本项目定的；拿一个没实测过的外部格式做字典序比较就是把猜测当依据。位置是后端 SQL 承诺的 | 后端没起时 rank 表为空，整轮退化为页内本地顺序（不漏群，只不精确，有日志）。这一支依赖 Task 8b ⑥ |
| R29 | 一轮先一跳登记**全部**可见群，再逐群一跳补快照 | spec §5 的伪码把 `groups + snapshot` 写在同一跳，那样快照失败的群永远进不了登记册；而「账号在哪些群里」这份名册要的恰恰是"群行存在但 `last_snapshot_at IS NULL`"这一格（与"压根没这个群"是两种可见状态） | 每群那一跳多带一条只含它自己的 `groups`，upsert 幂等，无副作用 |
| R30 | **混合裁定（用户，2026-10-01）**：命名与线形认已提交代码（`3771927` / `ade904e`，逐字见 §A.2 / §A.3），已提交代码与 spec 冲突的语义改代码（Task 8b）。Task 1–8 正文**不改写**，与 §A 冲突处以 §A 为准 | 推翻已交付且带 299 行单测的桥侧形状去迁就设计稿，代价是把验证过的东西重新变成没验证过的；反过来全认代码会把 spec §7/§8 的三条硬口径（闸读数、账号维度、搜索转义）丢掉 | 一份 §A + 一个 Task 8b；下游每个受影响的任务节里都要有一份就地修正（brief 是按任务切的，§A 不会跟着走） |
| R31 | §A.2 那四个读侧 VO 与 `GroupExportRowVO` **保持 record**，不改可变 POJO | R24 管的是 MyBatis 的**行载体**；这四个是服务层组装的出参，字段来自 Java 代码而不是列序，构造器自动映射那条风险不适用 | 以后若把某个 VO 直接当 `@Select` 的返回类型，就必须按 R24 改回可变 POJO——这一条写在类注释里 |
| R32 | `IngestResult(groupsUpserted, eventsInserted, reconciled, coverage, reason)` 定稿：两计数，**没有** `eventsDuplicated` 与 `reasons[]` | 「重复」在这一层的定义是"没落库"，它不进计数器就不会有任何读数依赖它；逐条拒收文案要的是"哪一条被丢"，而丢的只有非法值（`roleType` 归 `member`、非法 `eventType/source` 静默丢弃），本期没有界面读它 | 界面说不出"这批里有 3 条被丢了"；要补就先补契约，别先补字段 |
| R33 | `reason` 四值定稿（`ok / first_build / coverage_too_low / no_snapshot`），`no_snapshot` = 本批没有可用快照；空名单**不返 40000**，返 HTTP 200 + `reconciled=false` | 页内「空名单不当成功快照」与后端「空名单不进判退」两条闸都在（R20 落实），拒收只是把同一件事换成错误码；而泵的一跳里 `groups` 与 `events` 常常合法地没有快照，用 400 表达"没做判退"会让泵对一批已经写进去的数据重试 | Task 5 正文里「空名单 40000」那一格作废（见 §A.5） |
| R34 | 快照的 `participantCount` / `truncated` **止于页内那一帧**，不进 POST 体；分母的唯一来源是后端去重后的名单长度 | `GroupMemberBatchDTO.SnapshotItem` 没有这两个字段，写进去就是一行没人读的 JSON；而"页内给的群 metadata 人数"与"实际收到的名单长度"是两个数，让后端信前者就等于把 §6 陷阱 ① 的分母交给一个量过的截断值 | 泵把它们降级为本地日志与排序依据（Task 11 相应改写）；§15#3 的超大群截断实测仍靠那行日志取数 |
| R35 | 闸读数落库走**新增 V13 迁移**（`chat_group` 补 `last_coverage DECIMAL(5,4) NULL`、`last_reconcile_reason VARCHAR(24) NULL`），**不改 V12** | V12 已经在本地库跑过，改它的文件会撞 Flyway 校验和；Flyway 校验和报错的现场是"后端起不来"，那是最贵的一种冲突 | 多一个迁移文件；回滚段写在 V13 里（`ALTER TABLE … DROP COLUMN`） |
| R36 | 名单页的 `latest_join_at IS NULL` 沉底，与导出同序（`ORDER BY ISNULL(latest_join_at), latest_join_at, first_seen_at`） | MySQL 的 `ASC` 把 NULL 排最前，于是界面第一屏全是"没有进群时间的人"，而 §7 承诺的排序口径与 R22 的导出行序是同一件事——两份顺序就是两个答案 | 读侧那条 wrapper 要写函数排序键，不是纯列名（判退腿 14.8 断言这一格） |
| R37 | `/group/members` 的返回容器换成允许 `coverage=null` 的 record（`MemberPageVO(members, coverage, reason)`——三键就是 §A 名表里那份已提交线形的三键，`members` 是 `PageResult<GroupMemberVO>`），撤销 `Map.of` 把 null 压成空串 `""` | `""` 是"不知道"与"0.0"挤进同一个 JSON 值：界面判 `coverage === ''` 才能拿到"没分母"，而 `0` 是合法读数（覆盖率 0 会被压成 `0`，两者在 `== ` 下还会相等）。这是拿容器限制冒充语义 | 换容器只换 Java 侧的装法，**线形三键不变**（Task 15 的 `MemberPageVO` TS 类型已按这三键写，`coverage: number | null`）；R24 说的那条"服务层组装的出参可以是 record"在这里同样成立 |
| R38 | 成员的 `phone` **入库即归一**（`ChatKeys.normalizePhone`，取不到给 NULL），且**超长给 NULL 不截断** | 现在写库的是原样字符串（带 `+` / 空格都进库），而按号码反查客户与 §9 的匹配走的是归一值——两路都存在但只在"页内恰好给了裸号"时才命中，这种"有时匹配得上"比从不匹配更难查。截断一个超长号会得到一个**看起来像号码的假号码**，那是 §2#3 明令不许的 | 存量行的 `phone` 形状在新写入后是归一的；本期不回填历史行（没有读侧依赖它，且回填是一次不可回的写库动作） |
| R39 | 事件投影只在**真的新行**上做：以 `INSERT … ON DUPLICATE KEY UPDATE` 的 affected rows 判"这条是不是新"，`1` 才投影 | 现在的去重是"查已落库的键 + 批内集合"，两条都在写之前，所以并发两批同键会都判定为新鲜、都投影——`join_count` 双计且永远回不去。uk 挡住的是行，挡不住计数器 | MyBatis 的 affected rows 语义（1=插入、2=更新）要在单测里实测坐实，不能推断（先例：Task 91 那条 `insertIgnoreBatch` 实测） |
| R40 | `/customer/{id}/groups` 补 `accountId`（必填），`export-rows` 的超限与空名单错误码统一用 **40016**、且在计数**之前**按群键去重 | R16 的同一句话在两支读端点上没落实：`uk_group` 含 `account_id`，跨账号读会把两个同名群混成一份名单。去重早于计数是因为"51 个键里有 3 个重复"该报的和"51 个不同键"不一样，前者其实在限制内 | 渲染层与导出腿都要带 `accountId`；已提交代码的 40000 改成 40016 属响应码变化，Task 14 的契约腿有专门一格断言它 |
| R41 | `GET /groups?sort=stale`：`ORDER BY (last_snapshot_at IS NULL) DESC, last_snapshot_at ASC, id ASC`，参数缺省=今天那份顺序 | R28 的 rank 要有来源，而"从没成功快照的群排最前"正是 §5 建档队列的语义；把它做成后端的一个排序参数，比在 JS 里比日期串少一处外部格式依赖 | `sort` 是新参数，Task 9 的 `groups()` 签名多一个可选形参（泵传 `'stale'`，界面不传） |
| R42 | 入参按列宽处理：`chatKey`/`memberKey`/`dedupKey` 超长 → 整批 **40000** 拒收；展示文本（`title` / `displayName` / `actorName` / `bodySnapshot`）超长 → clip 到列宽 | 超长键进了 `uk` 会得到一个**被数据库截断后才会撞上的键**（MySQL 非严格模式下的静默截断 + 唯一键 = 两个不同的人合成一行成员状态）；展示文本截断丢的是可读性，不是身份 | 键超长时整批失败会让同批合法数据一起等下一轮——泵的重试语义（Task 11）本来就是"这一跳没成"，不新增死路 |
| R43 | 「所在群」那一节的账号上下文：优先 `useSelectionStore().selectedId`，为 null 时回落到 `useAccounts()` 里第一个 `platformType===1 && status===1 && viewId` 非空的账号；节头标出账号名，多于一档时给一个下拉切换 | Task 8b ④ 把 `accountId` 变成必填（R40），而 `CustomerDrawer` 挂在 `CustomersPage`，那一页没有 `AccountSidebar`（读码：`HomePage.tsx:12` 是唯一挂侧栏的页面），`selectedId` 完全可能是 null。另一种做法是"叫用户先去工作台选账号"——那等于把客户管理页的一节功能绑在另一个页面的操作上 | 客户可能同时在两个账号下进群，界面一次只读一个账号（与 R16/R40 一致：本就不许混读）；回落选中的账号是"第一个在线的"，不是"客户最常聊的那个" |
| R44 | 契约腿的收尾清理走 `tmp/P8Purge.java` 的 JDBC `DELETE`，范围钉死 `account_id = ? AND chat_key IN (本轮两个键)`，并在 `finally` 里跑、跑完复查三表 0 行 | Global Constraints 只把**表形状**列为 JDBC 例外，但成员域没有任何删除端点（本期不做删，§11 的契约面也不含写侧清理），HTTP 腿清不掉自己留下的行。留着这些行的代价不是磁盘：下一轮 `RUN` 换了群键就读不到上一轮，而**同键复跑**会因 `participant_count` 已有值而把"首次建档"那条断言变成 `ok`——验证数据会伪装成产品行为（与 memory 里那条"客户档残留会伪装成产品故障"同源） | 多一个不进 git 的探针；`DELETE` 是写动作，靠 `chat_key` 的本轮随机命名空间 + `account_id` 双条件把误删面收到"只能删我自己造的群" |
| R45 | 成员名单与流水用**普通分页**（`page`/`size`，读 `PageResult` 的四键），不套 `useInfiniteQuery` 的游标形状 | 后端这两支给的是 `PageResult`（`records/total/page/pageSize`，§A.2），不是消息面那套 `nextCursor/hasMore`。为了复用 `useMessages` 的形状去改后端分页契约，是拿已交付的读端点迁就一个前端 hook 的写法 | 名单翻页要自己写「上一页/下一页 + 总数」，不能靠 `fetchNextPage`；`total` 的口径由后端 `COUNT(*)` 给 |
| R46 | **时刻文本与"退群方式"的中文词各只有一份作者，都在 `shared/groupMembers.ts`**：`formatExportTime`（Task 13 迁入 shared）与 `exitMethodLabel`；Task 15 的 `groupDisplay.ts` 用**相对路径 + `.ts` 后缀**引它们，自己不再写 `TIME` / `EXIT_METHOD` 两张本地表 | 导出文件（主进程）与弹层名单（渲染层）是同一份读数的两个出口，两处各写一遍就会出现"文件里到秒、界面里到毫秒"「表格里叫『被移出』、界面上叫『被移出群』」这种只有把两个出口并排看才发现的错；而渲染层要进 `node --test` 闸门，别名 `@shared/*` 在那一侧解析不了，只有相对路径能两边都走得通（先例 `lib/chatDays.ts:4`） | `shared` 因此多两个导出；`groupDisplay` 依赖 shared 的形状，改 shared 会同时红两边（这正是想要的耦合） |
| R47 | 渲染层**不导出 `useGroups`**（`GET /groups` 这一支本期没有界面读者） | 选群面在 §14 的"本期不做"里，客户抽屉只读 ⑤ `/customer/{id}/groups`；泵与 Task 14 的契约腿各有自己的读法（`api.ts` / HTTP）。留一个没人调的 hook 就是留一份永不失效也没有消费者的缓存键，评审只会问"谁在用" | 群运营阶段（B9/B10）要做选群面时得新写这一支——那时它有真实调用方，`groupKeys.groups` 一并补 |
| R48 | 「导出所选」放在抽屉的**「所在群」那一节**顶栏（导的是勾选的那几个群），弹层顶栏只留「刷新成员 / 导出本群」；spec §9 那句把两处按钮写在同一行的措辞随本任务改口 | `group:export` 的入参是 `chatKeys: string[]`（群键数组，Task 13），契约里**不存在**"勾选若干成员"这件事；而弹层一次只开一个群，"所选"在弹层里无所指。spec §9 的原文是"顶栏（刷新成员、导出所选、导出本群）"，读起来像三个按钮都在弹层里——那是把两处面写进了一行 | 用户要导多个群得先回抽屉勾选，不能在被打开的弹层里跨群选；代价是一句改口，换来的是界面按钮与 IPC 入参一一对应 |
| R49 | `group:build` / `window.scrm.group.build` / `GroupEngine.runForAccount` 三处的入参形状统一为**单数** `{ accountId: number; chatKey?: string }`（省略 = 整账号一轮，给一个 = 只补那一群）。工作区里那支未纳管的 `groupCollect/engine.ts` 签名是复数 `chatKeys?: string[]`，**本计划不采它**（判据见 §A.1 的 Task 11 例外段与五处实差表） | R30 的"形状跟代码"认的是**已提交且已过闸门的代码**（那节列的 `3771927` / `ade904e` 两个提交），而 `git status` 给 `??`、`git log` 给空、`tsconfig.unit.json` 又不含它的一支文件，只是编辑区里的一个候选形状——它没被编译过，也就没被验证过。真正的判据是需求面：本期只有两种触发（整账号一轮、弹层「刷新成员」补一群），没有任何界面要"只建这 N 个群"；复数是给一个不存在的调用方留的门（YAGNI），而它已经在计划里造出两处互相矛盾的写法。导出的 `chatKeys: string[]` 保持复数——那边"勾选若干群"是真的 | 泵内部要处理"单键 → 一群队列"这一层转换，多一行代码；代价的反面是：若将来真出现批量补建，那是新增一层（`chatKeys?: string[]` 与单数共存），不是把三处 IPC 契约再改一遍。Step 0 若判读成 ③（那时它已进主干且不符），按 §A.1 那一条回到本裁定重新裁定 |
| R50 | spec §8 第一行那句"未建档的群要写明 `<原因>`"**本期给不出逐群原因**：`GroupBuildOutcome` 只有账号级的 `list: 'ok' \| 'error' \| 'silent'` 与 `skipped: 'busy' \| 'no_view' \| null`，没有 per-chatKey 的错误位；改法是把 spec 的措辞收成"未建档 + 账号级结论"，而不是扩展 IPC 契约 | 逐群原因的真实产地是主进程日志（泵按群键逐条 dispatch，失败的 `error` 字符串只进 `log`），要把它送到界面得让 registry 的结清值带上 error 文本、`GroupBuildOutcome` 长出 `Map<chatKey, string>`、IPC 与 preload 类型跟着变——为一句界面文案开一条新的跨进程数据通道，代价和收益不成比 | 用户在弹层里看到的是"这个群还没建过档——名单为空不等于群里没人"，不是"因为页内超时没建上"。真要逐群原因，留到群运营阶段与选群面（R47）一起做 |
| R51 | 事件类型与来源的中文表放 `lib/groupDisplay.ts`（`EVENT_TYPE_LABEL` / `EVENT_SOURCE_LABEL`），**不放 shared**；但用三条 unit 断言把它们与 shared 的 `exitMethodLabel('left'/'removed'/'added')` 钉在一起 | 导出（主进程）读的是 `exitMethod` 那一列，`groupDisplay` 里的 `eventTypeCopy`/`sourceCopy` 只有渲染层读者，塞进 shared 就是让主进程背一张永不查的表——与 R46"两处都有读者才上移"的判据相反。跨语言共享不了（Java 的 `event_type` 字面量在 `GroupRules.java`），能共享的只有 JS 侧，那就用断言把三组词对齐，改一处会同时红 | 词表有两份 JS 拷贝 + 一份 Java 字面量，靠断言而不是 import 约束；新增一种 `event_type` 时若忘了补 `EVENT_TYPE_LABEL`，`eventTypeCopy` 回显原始码，日志与界面能对上，评审也不会把它读成"没有类型" |

---

## 文件结构

| 侧 | 文件 | 职责 | 任务 |
|---|---|---|---|
| DB | `apps/server/src/main/resources/db/migration/V12__group_member_analysis.sql` | 三张表 + 回滚段 | 1 |
| Java | `entity/ChatGroup.java` `entity/GroupMemberState.java` `entity/GroupMemberEvent.java` | 三行形状 | 1 |
| Java | `mapper/ChatGroupMapper.java` `mapper/GroupMemberStateMapper.java` `mapper/GroupMemberEventMapper.java` | upsert / INSERT IGNORE / NOT IN 收口 / 聚合 | 1 |
| Java | `service/GroupMemberService.java` + `service/msg/GroupRules.java` | ingest 三步 + 覆盖率闸 | 5（已交付）, 6（已交付）, **8b** |
| Java | `service/GroupMemberQueryService.java` | 四个读端点 + export-rows 取数与行序 | 7（已交付）, 8（已交付）, **8b** |
| Java | `web/GroupMemberController.java` `web/dto/*` `web/vo/*` | `/api/group-members` 六跳 | 5, 7, 8（均已交付）；**8b** 改容器与参数 |
| Java | `src/test/java/.../service/GroupMember*Test.java` + `db/migration/V13__group_gate_reading.sql` | 校准项 ①–⑧ 的红→绿单测 + 闸读数落库 | **8b** |
| 探针 | `tmp/P8Tables.java` `tmp/P8Purge.java` | 表形状实测 / 退出路径清理（不进 git） | 1, 14 |
| shared | `apps/desktop/src/shared/groupMembers.ts` | wire 类型、action 映射、快照并集、系统消息分类、泵常量、导出列序 | 2（已交付）, 3（已交付）, 4（已交付）, 9, 13 |
| shared | `apps/desktop/src/shared/chatTypes.ts` | `BridgeCommand` +2 kind、`BridgeReport` +3 kind | 3（已交付） |
| 桥 | `apps/desktop/src/bridge/types.ts` `bridge/whatsapp/groups.ts` `bridge/whatsapp/normalize.ts` `bridge/index.ts` | 群能力声明、快照/列表/事件订阅、命令分派 | 3, 4（均已交付） |
| 主进程 | `services/groupCollect/{api,registry,collector,engine,host,exporter}.ts` | 三跳 HTTP、reqId 表、事件攒批、建档泵、装配 + `group:*` IPC、XLSX | 9–12 |
| 主进程 | `services/msgBridge/index.ts`（改） | 三种新帧路由 + `setBridgeReadyHook` | 10, 12 |
| 主进程 | `preload/index.ts`（改） | `window.scrm.group.{build,export,onState}` | 12, 13 |
| 渲染层 | `renderer/src/api/groupMembers.ts` `renderer/src/components/ui/tabs.tsx` `renderer/src/components/customers/{CustomerGroupsSection,GroupMembersDialog}.tsx` `CustomerDrawer.tsx`（改） | hooks、Tabs 原子件、两节界面 | 15, 16 |
| 驱动 | `tmp/p8-group-members-contract.mjs`（已有草稿，Task 14 校正）`tmp/p8c-ui.mjs` | HTTP 契约腿 / CDP 腿（不进 git） | 14, 17 |

---

## Task 1: V12 迁移 + 三实体 + 三 Mapper 原语

> **已交付**（`2b2df31` 迁移、`3771927` 实体与 Mapper）。V12 里**没有** R1 要的 `last_coverage` / `last_reconcile_reason` 两列，它们走 V13 增量迁移（R35 / Task 8b ③）。本节正文是实现过程记录，不改写。

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

> **已交付**（`2b2df31`，`ade904e` 续）。实名清单见 §A.3——常量与函数名以仓库为权威（`MAX_EXPORT_GROUPS` / `EXPORT_COLUMNS` / `CoverageReason` 四值 / `eventTypeFromAction`），本节正文不改写。

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

> **已交付**（`ade904e`）。两命令三帧的字段名与 §A.3 一致；`participantCount` / `truncated` 止于页内那一帧，不进 POST（R34）。本节正文不改写。

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

> **已交付**（`ade904e`，分类器 `classifyGroupSystemMessage` 在 shared、事件成形 `systemEventsFromRaw` 在桥侧 `groups.ts`）。本节正文不改写。

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

> **已交付**（`3771927`：`GroupMemberService` + `GroupMemberBatchDTO` + `GroupMemberController`）。线形以 §A.2 ① 为准（两计数、四值 reason、空名单不返 40000）；这一层的语义与补测由 Task 8b 收口（`fad3fda` + 修正轮 `33c8785`：写侧 7 条 + 读侧 10 条 mock-mapper 单测 + 异常映射 2 条，模块 `./mvnw test` 141 绿）。本节正文不改写。

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

> **已交付**（`3771927`）。闸放行才记账那一条读码确认落实（R20：`markSnapshotSuccess` 只在 `allowed` 分支调用）；闸读数已由 Task 8b ③ 落库（V13 的 `last_coverage` / `last_reconcile_reason` 两列已在本地库生效，`tmp/p8-tables.log` 实测）。本节正文不改写。

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

> **已交付**（`3771927`：`GroupMemberQueryService` + `GroupVO` / `GroupMemberVO` / `GroupEventVO`，全是 record，见 R31）。四处语义偏差由 Task 8b 收口（① 搜索转义、② 名单行序、③ 闸读数与 `coverage` 容器、⑥ `sort=stale`）；`sort=stale` 已在后端实现，但**主进程建档泵没有读者**（泵只有 `ingest`，接线会重做已交付的 Task 11），这笔账留在 P8 之外。本节正文不改写。

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
  - `GET /api/group-members/group/members?accountId&chatKey&isInGroup&role&q&page&size` → 三键容器 `{members: PageResult<GroupMemberVO>, coverage, reason}`（§A 名表第 103 行的 as-built 形状；`coverage` 今天由 `Map.of` 在 null 时压成 `""`，Task 8b ③ 换成 record 后回真 `null`。本任务草稿里写过的 `records/total/page/size` 平铺七键**不是**落地形状，下游一律按这三键读）
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
- **`MemberPageVO` 为什么不用 `PageResult`**：§8 要界面上把 `coverage_too_low` 标出来，那份新鲜度读数属于「这一页的来源」而不是「这一页的记录」。多包一层是有意的：`reason` 这一键在 Java 侧的出处是 `chat_group.last_reconcile_reason`（R1 的同源命名在列上，不在 JSON 键上——线形键名 `members/coverage/reason` 三个是已提交代码给渲染层的契约，Task 15/16/17 都按它读），所以弹层单独打开时也有出处。
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

> **已交付**（`3771927`：`GroupExportRowVO`，14 个键逐字见 §A.2 ⑥——群键叫 `groupId`，`inGroup` 已是 `'是'|'否'`，三个消息列叫 `lastMsgAt / dayMsgCount / msgCount`）。超限错误码已由 Task 8b ⑤ 改成 40016、先去重再计数、并用 `ChatKeys.isGroup` 校验群键形态。这里的口径是一条裁定，不是 brief 字面：**被拒形态是单聊键（`@c.us`）**，`ChatKeys.isGroup` 还收 `-100…` 与 `@group`，因为导出按账号收窄，非 WhatsApp 账号的群键不该被静默丢掉；Task 14 的契约腿必须按这个口径断言，不能写成"任何不以 `@g.us` 结尾的串"。本节正文不改写。

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

## Task 8b: 后端校准——把已提交代码的八条语义改回 spec（Java 单测先红）

> R30「混合裁定」的另一半：**形状认代码，语义认 spec**。Task 1–8 的正文不再改，本任务是那一层唯一被允许动 Java 语义的入口。
> `3771927` 那一层**没有任何 JUnit 覆盖**（§A.1），所以本任务同时是它的补测：八条每条先落一条会红的测试，再改代码。
>
> **本任务的判档**：Java 单测 = 实测（`./mvnw test`）；V13 两列真进库 = `tmp/P8Tables.java` 探针实测。
> 本任务**不**声称证明了「行序在真 MySQL 上的 NULL 语义」「覆盖率端到端读数」——那两条是 Task 14 契约腿的活（§13 的 HTTP 那一档）。

**校准清单**（后面每一步用编号点名）：

| # | 现状（读码） | 改成 | 依据 |
|---|---|---|---|
| ① | `GroupMemberQueryService:109-114` 自己拼 `"%" + q + "%"` 再交给 MP 的 `like()`，`like()` 外面又包一层 `%`；`%`/`_` 不转义 | 走 `SearchPattern.like(q)` + `apply("col LIKE {0}", like)`；`q` 只含 `%`/`_` 时按「不搜」处理，返回空名单 | spec §7 搜索口径；与 `MessageQueryService:75-90` 同形 |
| ② | `:116` `orderByAsc(latestJoinAt)`——MySQL ASC 把 NULL 排**最前**，没进群时间的人占据了名单第一页 | 名单与导出同一份行序：`ISNULL(latest_join_at)` 先、再 `latest_join_at`、再 `first_seen_at`、最后 `id` 定全序 | R36 / spec §10 行序 |
| ③ | `:122-133` 现场拿**当前这一页**的 `inGroup` 数除以分母算 coverage（翻页就变数）；`Controller:70` 用 `Map.of` 装容器，`coverage==null` 被压成空串 `""` | 闸读数改从 `chat_group` 的两列读（V13），算的一侧只写不读；容器换成 record `MemberPageVO`，`null` 就是 `null` | R1 / R33 / R37 |
| ④ | `customerGroups(tenantId, customerId)` 不带账号，同一客户在两个账号下的群混在一起回 | 加必填 `accountId`，两路查询都按 `(platform, account_id)` 收窄 | R16 / spec §9 |
| ⑤ | `exportRows:255-260` 不去重、超限给 40000、不校验群键形态 | 先去重再计数再查；超限给 **40016**；剔掉非 `@g.us` 的键，剔空了给 40000 | R40 / spec §10 |
| ⑥ | `pageGroups` 只按 `last_snapshot_at DESC` 排，泵读不到「谁最该补档」 | 加 `sort=stale`：`ISNULL(last_snapshot_at), last_snapshot_at, id`（未建档最前，最旧的其次） | R28 / R41 |
| ⑦ | `GroupMemberService:197-200` 批量 `insertIgnoreBatch` 后**无条件**逐条 `projectEvent`——并发重报时 `join_count` 双计且回不去 | 改单条 `insertIgnore`，只有 affected rows = 1 才投影 | R39 / spec §6 |
| ⑧ | 入参长度无闸：`member_key`/`dedup_key` 超列宽会让整条 SQL 抛 500；`phone` 入库写原样（`+8613800000000`）而匹配用归一值，按号码那一路永远命中不上 | 长度超限整批 40000；`phone` 入库前过 `ChatKeys.normalizePhone`；`display_name` clip 到 128 | R42 / R38 |

**Files:**
- Create: `apps/server/src/main/resources/db/migration/V13__group_gate_reading.sql`
- Create: `apps/server/src/main/java/com/smartscrm/server/web/vo/MemberPageVO.java`
- Modify: `entity/ChatGroup.java`（+2 字段）、`mapper/ChatGroupMapper.java`（③）、`mapper/GroupMemberEventMapper.java`（⑦）、`service/GroupMemberService.java`（③⑦⑧）、`service/GroupMemberQueryService.java`（①②③④⑤⑥）、`web/GroupMemberController.java`（③④⑥）、`web/vo/GroupVO.java`（③）
- Test: `src/test/java/com/smartscrm/server/service/GroupMemberWriteCalibrationTest.java`（③⑦⑧）、`src/test/java/com/smartscrm/server/service/GroupMemberReadCalibrationTest.java`（①②④⑤⑥）

**Interfaces:**
- Consumes：已交付的 `GroupMemberService` / `GroupMemberQueryService` / `GroupMemberController` / 三 Mapper（`3771927`），`SearchPattern.like`（`service/msg/SearchPattern.java`，返回**已带 `%` 的模式**，SQL 侧不得再包一层）、`ChatKeys.normalizePhone` / `ChatKeys.isGroup`、`BizException(code, msg)`。
- Produces（Task 9 的 `api.ts` 与 Task 14 的契约腿按这一份读）：
  - `V13`：`chat_group.last_coverage DOUBLE NULL`、`chat_group.last_reconcile_reason VARCHAR(24) NULL`
  - `ChatGroup`：`Double lastCoverage`、`String lastReconcileReason`
  - `ChatGroupMapper.markSnapshotSuccess(Long id, int count, Double coverage, String reason, LocalDateTime now)`（**签名变了**，多两个参数）
  - `ChatGroupMapper.markGate(Long id, Double coverage, String reason, LocalDateTime at)`
  - `GroupMemberEventMapper.insertIgnore(GroupMemberEvent e)`；`insertIgnoreBatch` **删除**
  - `GroupVO(..., boolean isFinal, Double lastCoverage, String lastReconcileReason)`（两键追加在末尾）
  - `MemberPageVO(PageResult<GroupMemberVO> members, Double coverage, String reason)`
  - `GroupMemberQueryService.pageGroups(Long, Long, String, int, int, String sort)`、`customerGroups(Long tenantId, Long accountId, String platform, Long customerId)`
  - `GET /groups` 多一个可选参数 `sort`；`GET /customer/{id}/groups` 多一个**必填** `accountId`；`GET /group/members` 的 `data.coverage` 现在是 `number | null`

**技术要点**

- **两条写闸读口的分工**（③）：放行时 `markSnapshotSuccess` 一次写五列（分母 + 时间戳 + 次数 + 两列读数），被拦时 `markGate` 只写那两列读数。R20 那条「三列一起挡」不许松动——被截断的名单一旦参与记账，分母就被污染，而那种污染在界面上永远看不出来。**没带快照的那一批两种都不写**：一次纯事件上报不该把上一轮的读数抹成 `no_snapshot`，那样 §8 的「本次未做退群判定」会变成「上一轮的好结果被抹掉」。
- **覆盖率用 `DOUBLE` 不用 `DECIMAL`**：它是比值不是金额，`DECIMAL(6,4)` 的精度收益在这一列上没有读者，而实体侧要因此多一次 `BigDecimal → double` 换算。代价：读数会带浮点尾巴（0.9333333333333333），由渲染层格式化到 1 位小数（Task 16）。
- **②⑥ 的 ORDER BY 只能这么测**：把 wrapper 从 `LambdaQueryWrapper` 换成 `QueryWrapper<GroupMemberState>`（字符串列名），排序写成 `orderByAsc("ISNULL(latest_join_at)", "latest_join_at", "first_seen_at", "id")`。测试用 `ArgumentCaptor` 抓 wrapper，断言 `getSqlSegment()` 里 `latest_join_at` **第一次出现的位置紧跟在 `ISNULL(` 之后**——只比「谁在前」，不比整串（MP 小版本会在列名后追加 `ASC`，把整串写进断言等于把一个版本相关的字面量当契约）。这一条只证明了「Java 这边把 ISNULL 放在了裸列前面」，MySQL 真按这个序输出行是 Task 14 契约腿第 7 组那两格的活。失去 lambda 类型安全的补偿：那条测试同时断言 WHERE 段里出现的列名逐个是 snake_case（`tenant_id`/`account_id`/`platform`/`chat_key`），列名拼错会在那里响。
- **① 的 `apply("col LIKE {0}", like)` 是既有形状**（`MessageQueryService:85`），不是新发明：`like()` 会把参数再包一层 `%`，与 `SearchPattern` 已经包过的那一层叠成 `%%…%%`，于是搜 `%` 变成搜全表。绑定值断言 `%a\\%b%`（反斜杠先自转义、`%` 再转义后的产物原样进参数）。
- **④ 的 `accountId` 设成必填**：客户抽屉本来就在某个账号的上下文里，跨账号合并是 §9 没有要求的行为。代价：老脚本手搓不带 `accountId` 的 URL 会得到 400（Spring 缺参），这正是要它响。
- **⑦ 从批量退回单条**是**量级判断**：事件攒批每批 ≤100 条、每 2s 一趟，一百次本地 INSERT 往返在这个量级上不构成瓶颈；换来的是「投影只对真新行跑」这条能被单测证明的性质。批量与单条的差别在 `insertIgnoreBatch` 的注释里已经写明它说不出「哪几行是新的」——那正是缺陷的来源，所以把它删掉而不是留着等下一个人误用。
- **⑧ 整批拒收，不静默跳过**：混进一个超长键就把 100 条事件全丢是贵得多的错吗？不是——**客户端已经有一道同名同值的闸**（Task 10 的 `fits()`），超长键能走到 Java 只可能是手搓请求或桥侧漏了一处过滤。那种情况下 400 加一句「member_key 超过 160 字符」是把问题指出来，静默跳过是把一个契约违约藏进 200。
- **不动的两处**：`GroupEventVO.groupTitle` 仍恒 NULL（写侧没有可信的「发生时的群名」，Task 9 的帧类型注释同口径）；`applyRole` 0 行受影响仍保持沉默（升降级说明不了在不在群里）。这两条读码确认过是**有意的**，不是漏的。

- [ ] **Step 1: V13 迁移**

```sql
-- V13__group_gate_reading.sql
-- 覆盖率闸的读数落库（R1 / R35）。V12 没建这两列，§8 的「本次快照人数较上次少 x%」与
-- 泵的位置优先（R28）都读不到东西。
ALTER TABLE chat_group
    ADD COLUMN last_coverage DOUBLE NULL COMMENT '最近一次快照判定的覆盖率；NULL = 没做过可判定的快照' AFTER snapshot_count,
    ADD COLUMN last_reconcile_reason VARCHAR(24) NULL COMMENT 'ok | first_build | coverage_too_low | no_snapshot' AFTER last_coverage;

-- 回滚段（与 V9 / V12 同形，人工执行）：
-- ALTER TABLE chat_group DROP COLUMN last_reconcile_reason, DROP COLUMN last_coverage;
```

`entity/ChatGroup.java` 在 `snapshotCount` 之后补两字段，注释各写一句「谁写这一列」：

```java
    /** 最近一次快照判定的覆盖率。只有 {@link com.smartscrm.server.mapper.ChatGroupMapper} 的 `markSnapshotSuccess` / `markGate` 写它。 */
    private Double lastCoverage;
    /** 最近一次判定结论：`ok | first_build | coverage_too_low | no_snapshot`。 */
    private String lastReconcileReason;
```

- [ ] **Step 2: 两个测试文件的骨架**

两份都用 mock 掉的 mapper（不碰库、不碰页面），形状照 `BatchSendServiceTest:65-86`。`@BeforeAll` 那段手工装载 TableInfo 是**必需**的——`QueryWrapper` 的字符串列不进缓存也要解析，但 `customerMapper.selectList` 那一路的 lambda 会当场解析列名：

```java
// GroupMemberWriteCalibrationTest / GroupMemberReadCalibrationTest 各自的一份
@BeforeAll
static void installLambdaColumnCache() {
    MapperBuilderAssistant assistant = new MapperBuilderAssistant(new MybatisConfiguration(), "");
    TableInfoHelper.initTableInfo(assistant, ChatGroup.class);
    TableInfoHelper.initTableInfo(assistant, GroupMemberState.class);
    TableInfoHelper.initTableInfo(assistant, GroupMemberEvent.class);
    TableInfoHelper.initTableInfo(assistant, PlatformAccount.class);
    TableInfoHelper.initTableInfo(assistant, Customer.class);
}
```

写侧那份的固定件：

```java
    private static final long TENANT = 1L;
    private static final long ACCOUNT = 9L;
    private static final String GROUP = "120363111@g.us";
    private static final String MEMBER = "8613800000000@c.us";

    private final ChatGroupMapper groupMapper = mock(ChatGroupMapper.class);
    private final GroupMemberStateMapper stateMapper = mock(GroupMemberStateMapper.class);
    private final GroupMemberEventMapper eventMapper = mock(GroupMemberEventMapper.class);
    private final PlatformAccountMapper accountMapper = mock(PlatformAccountMapper.class);
    private final CustomerMapper customerMapper = mock(CustomerMapper.class);
    private final GroupMemberService service = new GroupMemberService(
        groupMapper, stateMapper, eventMapper, accountMapper, customerMapper);

    /** 账号必须解析得动，否则每条测试都先死在 resolveAccount 上。 */
    @BeforeEach
    void accountResolves() {
        PlatformAccount a = new PlatformAccount();
        a.setId(ACCOUNT);
        a.setTenantId(TENANT);
        a.setPlatformType(1);              // WhatsApp：与 ChatKeys.platformOfAccountType 的映射一致
        when(accountMapper.selectById(ACCOUNT)).thenReturn(a);
    }
```

读侧那份同样五个 mock，构造 `new GroupMemberQueryService(groupMapper, stateMapper, eventMapper, messageMapper, customerMapper)`（五个参数的顺序照构造器，`messageMapper` 也在其中）。**mock 的形参一律以文件里的实际签名为准**，别照本节手敲——签名对不上是编译错，不是测试判据。

- [ ] **Step 3: 八条红测试全部写下**

判别力规则：每条测试都要能指出「改坏哪一行它会红」。下面八条里没有一条是 `assertNotNull` 式的存在性断言。

```java
// —— GroupMemberWriteCalibrationTest ——

/** ③：闸放行 → 五列一起写，读数就是这一跳的 0.4 之上那个值。 */
@Test
void allowedSnapshotRecordsDenominatorAndGateReadingTogether() {
    ChatGroup g = new ChatGroup();
    g.setId(3L);
    g.setParticipantCount(10);
    when(groupMapper.selectByKey(TENANT, "whatsapp", ACCOUNT, GROUP)).thenReturn(g);
    when(stateMapper.selectByGroup(TENANT, "whatsapp", ACCOUNT, GROUP)).thenReturn(List.of());

    GroupMemberBatchDTO dto = batchWithSnapshot(10);       // 夹具见下
    GroupMemberService.IngestResult r = service.ingest(TENANT, dto);

    assertEquals("ok", r.reason());
    verify(groupMapper).markSnapshotSuccess(eq(3L), eq(10), eq(1.0), eq("ok"), any());
    verify(groupMapper, never()).markGate(anyLong(), any(), any(), any());
}

/** ③：闸拦下 → 只写读数那两列。这条是 R20 的守门人：一旦有人把 markGate 换成 markSnapshotSuccess，分母就被 4 人污染。 */
@Test
void blockedSnapshotWritesGateReadingOnly() {
    ChatGroup g = new ChatGroup();
    g.setId(3L);
    g.setParticipantCount(10);
    when(groupMapper.selectByKey(TENANT, "whatsapp", ACCOUNT, GROUP)).thenReturn(g);
    when(stateMapper.selectByGroup(TENANT, "whatsapp", ACCOUNT, GROUP)).thenReturn(List.of());

    GroupMemberService.IngestResult r = service.ingest(TENANT, batchWithSnapshot(4));

    assertEquals("coverage_too_low", r.reason());
    assertFalse(r.reconciled());
    assertEquals(0.4, r.coverage(), 1e-9);
    verify(groupMapper, never()).markSnapshotSuccess(anyLong(), anyInt(), any(), any(), any());
    verify(groupMapper).markGate(eq(3L), eq(0.4), eq("coverage_too_low"), any());
}

/** ③：只报事件、没带快照 → 两种都不写。上一轮的好读数不能被抹成 no_snapshot。 */
@Test
void eventOnlyBatchWritesNeitherGatePath() {
    GroupMemberBatchDTO dto = new GroupMemberBatchDTO();
    dto.setAccountId(ACCOUNT);
    dto.setEvents(List.of(event("added", "dedup-1")));
    when(eventMapper.insertIgnore(any())).thenReturn(1);

    GroupMemberService.IngestResult r = service.ingest(TENANT, dto);

    assertEquals("no_snapshot", r.reason());
    assertFalse(r.reconciled());
    verify(groupMapper, never()).markSnapshotSuccess(anyLong(), anyInt(), any(), any(), any());
    verify(groupMapper, never()).markGate(anyLong(), any(), any(), any());
}

/** ⑦：批量 IGNORE 里被去重掉的那条不许再投影一次——join_count 双计永远回不去。 */
@Test
void onlyActuallyInsertedEventsProject() {
    GroupMemberBatchDTO dto = new GroupMemberBatchDTO();
    dto.setAccountId(ACCOUNT);
    dto.setEvents(List.of(event("added", "d-1"), event("added", "d-2"), event("added", "d-3")));
    when(groupMapper.selectByKey(TENANT, "whatsapp", ACCOUNT, GROUP)).thenReturn(null);
    // 第 2 条撞 uk_event：affected rows = 0。旧实现批量插入 + 无条件投影，这里会投三条。
    when(eventMapper.insertIgnore(any())).thenReturn(1, 0, 1);

    GroupMemberService.IngestResult r = service.ingest(TENANT, dto);

    assertEquals(2, r.eventsInserted());
    verify(stateMapper, times(2)).applyJoin(eq(TENANT), eq(ACCOUNT), eq("whatsapp"), eq(GROUP),
        eq(MEMBER), any(), any(), any());
}

/** ⑧：超长键整批拒收，且响在投影之前——不许留下"事件没进但状态改了"的半套。 */
@Test
void oversizedKeyRejectsWholeBatchBeforeAnyProjection() {
    GroupMemberBatchDTO dto = new GroupMemberBatchDTO();
    dto.setAccountId(ACCOUNT);
    GroupMemberBatchDTO.EventItem e = event("added", "d-1");
    e.setMemberKey("x".repeat(161));
    dto.setEvents(List.of(e));

    BizException bx = assertThrows(BizException.class, () -> service.ingest(TENANT, dto));
    assertEquals(40000, bx.getCode());
    verify(eventMapper, never()).insertIgnore(any());
    verify(stateMapper, never()).applyJoin(anyLong(), anyLong(), anyString(), anyString(), anyString(),
        any(), any(), any());
}

/** ⑧ / R38：phone 入库前归一，界面上才只有一个号码形状，且按号码匹配客户那条路真能命中。 */
@Test
void snapshotPhoneIsNormalisedOnWrite() {
    ChatGroup g = new ChatGroup();
    g.setId(3L);
    g.setParticipantCount(1);
    when(groupMapper.selectByKey(TENANT, "whatsapp", ACCOUNT, GROUP)).thenReturn(g);
    when(stateMapper.selectByGroup(TENANT, "whatsapp", ACCOUNT, GROUP)).thenReturn(List.of());
    ArgumentCaptor<GroupMemberState> cap = ArgumentCaptor.forClass(GroupMemberState.class);

    service.ingest(TENANT, batchWithSnapshot(1, "+86 138-0000-0000"));

    verify(stateMapper).upsertFromSnapshot(cap.capture(), any());
    assertEquals("8613800000000", cap.getValue().getPhone());
}
```

```java
// —— GroupMemberReadCalibrationTest ——

/** ① / ②：搜索词交给 SearchPattern，绑定值里必须已经带好反斜杠转义；名单排序必须 ISNULL 打头。 */
@Test
void memberSearchUsesEscapedPatternAndNullSinkingOrder() {
    when(groupMapper.selectByKey(TENANT, "whatsapp", ACCOUNT, GROUP)).thenReturn(null);
    when(messageMapper.statsBySenders(any(), any(), any())).thenReturn(List.of());
    ArgumentCaptor<QueryWrapper<GroupMemberState>> cap = ArgumentCaptor.forClass(QueryWrapper.class);
    when(stateMapper.selectPage(any(), cap.capture())).thenAnswer(inv -> inv.getArgument(0));

    query.pageMembers(TENANT, ACCOUNT, "whatsapp", GROUP, null, null, "a%b", 1, 50);

    String seg = cap.getValue().getSqlSegment();
    assertTrue(seg.contains("display_name LIKE"), seg);
    assertTrue(cap.getValue().getParamNameValuePairs().containsValue("%a\\%b%"),
        String.valueOf(cap.getValue().getParamNameValuePairs()));
    int first = seg.indexOf("latest_join_at");
    assertTrue(first > 0 && seg.startsWith("ISNULL(", first - 7, first),
        "ORDER BY 里裸列排在 ISNULL 之前，NULL 会占满第一页: " + seg);
    assertTrue(seg.indexOf("latest_join_at", first + 1) > first, "裸列没出现: " + seg);
    for (String col : List.of("tenant_id", "account_id", "platform", "chat_key")) {
        assertTrue(seg.contains(col), "WHERE 段缺列 " + col + ": " + seg);
    }
}

/** ①：只由通配符组成的词按「不搜」处理，而且**不发查询**——当成"没有过滤条件"就是一次全表扫。 */
@Test
void wildcardOnlyQuerySearchesNothingAndDoesNotHitDb() {
    query.pageMembers(TENANT, ACCOUNT, "whatsapp", GROUP, null, null, "%%", 1, 50);
    verify(stateMapper, never()).selectPage(any(), any());
}

/** ④：另一个账号下的成员行不能混进这个客户的所在群。 */
@Test
void customerGroupsAreScopedToTheAccount() {
    Customer c = new Customer();
    c.setId(1L);
    c.setTenantId(TENANT);
    c.setPhone("8613800000000");
    when(customerMapper.selectById(1L)).thenReturn(c);
    ArgumentCaptor<LambdaQueryWrapper<GroupMemberState>> cap = ArgumentCaptor.forClass(LambdaQueryWrapper.class);
    when(stateMapper.selectList(cap.capture())).thenReturn(List.of());

    query.customerGroups(TENANT, ACCOUNT, "whatsapp", 1L);

    for (LambdaQueryWrapper<GroupMemberState> w : cap.getAllValues()) {
        assertTrue(w.getSqlSegment().contains("account_id"), w.getSqlSegment());
        assertTrue(w.getSqlSegment().contains("platform"), w.getSqlSegment());
    }
}

/** ⑤：同一群勾两遍不许出一遍成员，也不许绕过 50 群上限（拦的是工作量）。 */
@Test
void exportDeduplicatesKeysBeforeCounting() {
    List<String> keys = new ArrayList<>();
    for (int i = 0; i < 51; i++) keys.add("12036311" + i + "@g.us");
    keys.add(keys.get(0));                       // 重复一次 → 去重后正好 50：必须放行
    when(groupMapper.selectByKey(any(), any(), any(), any())).thenReturn(null);
    when(stateMapper.selectByGroup(any(), any(), any(), any())).thenReturn(List.of());
    when(messageMapper.statsBySenders(any(), any(), any())).thenReturn(List.of());

    assertDoesNotThrow(() -> query.exportRows(TENANT, ACCOUNT, "whatsapp", keys));

    // 51 个**互不相同**的键才该被 40016 拦下
    keys.add("120363999@g.us");
    BizException bx = assertThrows(BizException.class,
        () -> query.exportRows(TENANT, ACCOUNT, "whatsapp", keys));
    assertEquals(40016, bx.getCode());           // 不是 40000：界面要能分清"选太多"和"参数不对"
}

/** ⑤：非群键（有人拿单聊键来导）不进 IN，剔空了要响。 */
@Test
void exportRejectsNonGroupKeys() {
    BizException bx = assertThrows(BizException.class, () -> query.exportRows(
        TENANT, ACCOUNT, "whatsapp", List.of("8613800000000@c.us")));
    assertEquals(40000, bx.getCode());
    verify(stateMapper, never()).selectByGroup(any(), any(), any(), any());
}

/** ⑥：sort=stale 那一路未建档（last_snapshot_at IS NULL）排最前；默认那一路仍是新的在前。 */
@Test
void staleSortPutsNeverSnapshottedGroupsFirst() {
    ArgumentCaptor<QueryWrapper<ChatGroup>> cap = ArgumentCaptor.forClass(QueryWrapper.class);
    when(groupMapper.selectPage(any(), cap.capture())).thenAnswer(inv -> inv.getArgument(0));

    query.pageGroups(TENANT, ACCOUNT, "whatsapp", 1, 200, "stale");

    String seg = cap.getValue().getSqlSegment();
    int first = seg.indexOf("last_snapshot_at");
    assertTrue(first > 0 && seg.startsWith("ISNULL(", first - 7, first),
        "未建档的群没排在最前: " + seg);

    query.pageGroups(TENANT, ACCOUNT, "whatsapp", 1, 200, null);
    assertFalse(cap.getAllValues().get(1).getSqlSegment().contains("ISNULL("), "默认顺序被顺手改成了旧→新");
}
```

夹具（写侧那份的私有方法，别写成 `public`）：

```java
    private static GroupMemberBatchDTO.EventItem event(String type, String dedup) {
        GroupMemberBatchDTO.EventItem e = new GroupMemberBatchDTO.EventItem();
        e.setChatKey(GROUP);
        e.setMemberKey(MEMBER);
        e.setEventType(type);
        e.setOccurredAtEpochSec(1_700_000_000L);
        e.setDedupKey(dedup);
        e.setSource("live_event");
        return e;
    }

    private static GroupMemberBatchDTO batchWithSnapshot(int n) {
        return batchWithSnapshot(n, "+8613800000000");
    }

    private static GroupMemberBatchDTO batchWithSnapshot(int n, String phone) {
        List<GroupMemberBatchDTO.ParticipantItem> parts = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            GroupMemberBatchDTO.ParticipantItem p = new GroupMemberBatchDTO.ParticipantItem();
            p.setMemberKey(i == 0 ? MEMBER : "861380000000" + i + "@c.us");
            p.setPhone(phone);
            p.setDisplayName("成员" + i);
            p.setRoleType("member");
            parts.add(p);
        }
        GroupMemberBatchDTO.SnapshotItem snap = new GroupMemberBatchDTO.SnapshotItem();
        snap.setChatKey(GROUP);
        snap.setParticipants(parts);
        GroupMemberBatchDTO dto = new GroupMemberBatchDTO();
        dto.setAccountId(ACCOUNT);
        dto.setSnapshot(snap);
        return dto;
    }
```

- [ ] **Step 4: 跑到红**

```bash
export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18"
set -o pipefail
cd /d/SmartSCRM/apps/server
powershell -NoProfile -ExecutionPolicy Bypass -File tmp/p7b-kill8180.ps1
./mvnw -Dtest='GroupMember*CalibrationTest' test 2>&1 | tee /d/SmartSCRM/tmp/p8b-red.log | tail -40
```
期望：编译期就红（`markGate` / `insertIgnore` / `MemberPageVO` / 新签名不存在）。**先把编译门槛清掉再谈测试红**：Step 5 先补方法签名与空实现，Step 6 起逐条改到红变绿。把「几条红、红在哪」记进提交正文。

- [ ] **Step 5: 补齐新签名，让编译过**

`ChatGroupMapper` 的两条（③）、`GroupMemberEventMapper.insertIgnore`、`MemberPageVO`、`GroupVO` 的两个新键、`pageGroups`/`customerGroups` 的新参数。此步**只加不改**：新方法先 `throw new UnsupportedOperationException()`，服务层调用点先接上；跑一次 `./mvnw -Dtest='GroupMember*CalibrationTest' test`，期望换成「`UnsupportedOperationException`」与断言失败两种红。

- [ ] **Step 6: ③ 覆盖率闸读数**

`markSnapshotSuccess` 实现成五列一起写、`markGate` 只写两列（SQL 见上），`reconcileSnapshot` 末尾：

```java
        if (allowed) {
            ChatGroup after = groupMapper.selectByKey(tenantId, acc.platform(), acc.accountId(), chatKey);
            if (after != null) {
                groupMapper.markSnapshotSuccess(after.getId(), cur, coverage, reason, now);
            }
        } else if (group != null) {
            groupMapper.markGate(group.getId(), coverage, reason, now);
        }
```

读侧 `pageMembers` 尾巴换成「只读列、不现场算」，并把 `MemberPage` 内部 record 删掉、改回 `MemberPageVO`：

```java
        ChatGroup g = groupMapper.selectByKey(tenantId, platform, accountId, chatKey);
        // 新鲜度读闸落下来的那两列，不在这里现场算：现场算用的是**当前这一页**的在群数，
        // 翻页会给出不同的 coverage，而 §8 那句"本次未做退群判定"必须只有一个答案。
        Double coverage = g == null ? null : g.getLastCoverage();
        String reason = (g == null || g.getLastReconcileReason() == null)
            ? "no_snapshot" : g.getLastReconcileReason();
        return new MemberPageVO(PageResult.of(vos, p.getTotal(), p.getCurrent(), p.getSize()), coverage, reason);
```

`GroupMemberController.members` 的返回从 `Map.of(...)` 换成 `ApiResponse<MemberPageVO>`（`Map.of` 不许 null，那正是 `coverage` 今天被压成 `""` 的原因）。Controller 里那段「名单与新鲜度同一份响应」的注释搬过来别丢。

`GroupVO` 两处构造点补上 `g.getLastCoverage(), g.getLastReconcileReason()`。

- [ ] **Step 7: ①②⑥ 读侧的 wrapper 换成 QueryWrapper**

```java
    // 成员名单（①②）。用 QueryWrapper 的字符串列名，为的是那一条 ORDER BY：
    // MP 的 lambda 排序给不出 ISNULL(...) 这种表达式，而 MySQL 的 ASC 会把 NULL 排在最前，
    // 于是"没有进群时间的人"占满第一页——那正是 R36 要消掉的形状。
    QueryWrapper<GroupMemberState> w = new QueryWrapper<GroupMemberState>()
        .eq("tenant_id", tenantId).eq("account_id", accountId)
        .eq("platform", platform).eq("chat_key", chatKey);
    if (isInGroup != null) w.eq("is_in_group", isInGroup ? 1 : 0);
    if (role != null && !role.isBlank()) w.eq("role_type", role);
    String like = SearchPattern.like(q);
    if (like == null) {
        // null 的契约是"不该发起搜索"（SearchPattern:10-13）。词只由 %/_ 组成时给空名单，
        // 给全表就是拿一次误输入换一遍群扫描。
        return new MemberPageVO(PageResult.of(List.<GroupMemberVO>of(), 0L, Math.max(1, page),
            Math.min(Math.max(1, size), 200)), null, "no_snapshot");
    }
    w.and(x -> x.apply("display_name LIKE {0}", like)
        .or().apply("phone LIKE {0}", like)
        .or().apply("member_key LIKE {0}", like));
    w.orderByAsc("ISNULL(latest_join_at)", "latest_join_at", "first_seen_at", "id");
```

**这一段的两个坑**：① `q == null`（没在搜）时 `SearchPattern.like` 同样返回 `null`，所以「不搜」与「搜了个只含通配符的词」在这条分支上撞车——必须**先分**：`q` 本身为空就跳过整个搜索块（正常查全量），`q` 非空而 `like == null` 才返回空名单。写成上面那样会让不带 `q` 的名单永远空，而测试里那格 `wildcardOnlyQuery...` 恰好看不出这个错（它传的 `q` 非空）。补一条测试：`pageMembers(..., q = null, ...)` 必须 `verify(stateMapper).selectPage(any(), any())`。② `apply` 的 `{0}` 是 MP 的占位而不是 `?`，写成 `{0}` 之外任何形式都会在真库上以参数数量不匹配收场。

`pageGroups`（⑥）：

```java
    public PageResult<GroupVO> pageGroups(Long tenantId, Long accountId, String platform,
                                          int page, int size, String sort) {
        Page<ChatGroup> p = new Page<>(Math.max(1, page), Math.min(Math.max(1, size), 200));
        QueryWrapper<ChatGroup> w = new QueryWrapper<ChatGroup>()
            .eq("tenant_id", tenantId).eq("account_id", accountId).eq("platform", platform);
        if ("stale".equals(sort)) {
            // 建档泵那一支（R28 / R41）：没成功快照的最前，其余按上次成功快照从旧到新。
            w.orderByAsc("ISNULL(last_snapshot_at)", "last_snapshot_at", "id");
        } else {
            w.orderByDesc("last_snapshot_at").orderByDesc("id");
        }
        ...
```

`Controller.groups` 加 `@RequestParam(required = false) String sort` 并透传。**后端不认识 `sort` 之前它也不报错**（Spring 忽略未声明的请求参数），所以 Task 9 可以先接线、本任务再补读数——但两者都进 `main` 之后，`sort=stale` 才有真顺序。

- [ ] **Step 8: ④ 客户反查按账号收窄**

```java
    public List<GroupVO> customerGroups(Long tenantId, Long accountId, String platform, Long customerId) {
        ...
        List<GroupMemberState> byCustomer = stateMapper.selectList(new LambdaQueryWrapper<GroupMemberState>()
            .eq(GroupMemberState::getTenantId, tenantId)
            .eq(GroupMemberState::getAccountId, accountId)
            .eq(GroupMemberState::getPlatform, platform)
            .eq(GroupMemberState::getCustomerId, customerId));
        ...   // 按号码那一路同样加这两个条件
```

`Controller.customerGroups` 加 `@RequestParam Long accountId`（**必填**），先 `service.resolveAccount(...)` 拿 platform 再传下去——与另外四支读端点同一条租户/账号闸。

- [ ] **Step 9: ⑤ 导出去重、错误码与群键形态**

```java
        List<String> keys = new ArrayList<>(new LinkedHashSet<>(chatKeys));   // 先去重（R40）
        keys.removeIf(k -> k == null || k.isBlank() || !ChatKeys.isGroup(k));
        if (keys.isEmpty()) {
            throw new BizException(40000, "chatKeys 里没有一个是群键");
        }
        if (keys.size() > MAX_EXPORT_GROUPS) {
            // 40016 而不是 40000：界面要能把"选太多"与"参数不对"分成两句文案说，
            // 前者的下一步是少勾两个群，后者的下一步是看请求怎么拼的。
            throw new BizException(40016, "一次最多导出 " + MAX_EXPORT_GROUPS + " 个群，当前 " + keys.size());
        }
        for (String chatKey : keys) {   // 行序：入参顺序 = 去重后保留的首次出现顺序
```

`seq` 仍只由这一段写（R22）。**两句 40016 的话不完全一样，别当成回填漏了**：Task 8 正文（`EXPORT_GROUP_MAX`、「当前 N 个」）是当时的预测，已提交代码（读码 `GroupMemberQueryService.java:39,259`）用的是 `MAX_EXPORT_GROUPS`、「当前 N」不带尾「个」，本节按已提交的那句改常量名与码数、只把 `40000` 换成 `40016`。这句话不进界面（Task 16 技术要点 8），Task 14 的 12.1 只断 `code`，所以两种写法都不会被腿读到——但下游要照**已提交**那句，别照正文。

- [ ] **Step 10: ⑦⑧ 写侧**

`GroupMemberEventMapper`：加 `insertIgnore(GroupMemberEvent e)`（单条 `INSERT IGNORE`，列清单照 `insertIgnoreBatch` 那份逐字抄，别漏 `group_title`），**删掉 `insertIgnoreBatch`**。注释里保留那句「返回值 = 真正插入的行数」，并补一句它为什么单条：批量只给得出总数，给不出「哪几行是新的」，而投影必须按行决定。

`GroupMemberService.ingest` 开头加长度闸（⑧），常量照 §A.2 的 V12 列宽：

```java
        requireFits("chatKey", dto.getSnapshot() == null ? null : dto.getSnapshot().getChatKey(), CHAT_KEY_MAX);
        if (dto.getGroups() != null) {
            for (GroupItem g : dto.getGroups()) {
                if (g != null) requireFits("chatKey", g.getChatKey(), CHAT_KEY_MAX);
            }
        }
        if (dto.getSnapshot() != null && dto.getSnapshot().getParticipants() != null) {
            for (ParticipantItem p : dto.getSnapshot().getParticipants()) {
                if (p != null) requireFits("memberKey", p.getMemberKey(), MEMBER_KEY_MAX);
            }
        }
        if (dto.getEvents() != null) {
            for (EventItem e : dto.getEvents()) {
                if (e != null) {
                    requireFits("chatKey", e.getChatKey(), CHAT_KEY_MAX);
                    requireFits("memberKey", e.getMemberKey(), MEMBER_KEY_MAX);
                    requireFits("dedupKey", e.getDedupKey(), DEDUP_KEY_MAX);
                }
            }
        }
```

`resolveAccount` 之后、任何 upsert 之前跑这一段——**闸在任何写动作之前**，否则一条超长键会留下"前面的都写了、这条抛 500"的半套事务（同一 `@Transactional` 会回滚，但 `upsertGroup` 那些 `ON DUPLICATE KEY` 的副作用在回滚前会占着行锁，别去试那个形状）。

`upsertFromSnapshot` 那一处（⑧ / R38）：

```java
            String normalized = ChatKeys.normalizePhone(p.getPhone());
            e.setPhone(normalized == null || normalized.length() > PHONE_MAX ? null : normalized);
            e.setDisplayName(clip(trimToNull(p.getDisplayName()), DISPLAY_NAME_MAX));
```

- [ ] **Step 11: 全量 Java 绿**

```bash
export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18"
set -o pipefail
cd /d/SmartSCRM/apps/server
./mvnw test 2>&1 | tee /d/SmartSCRM/tmp/p8b-test.log | tail -30
```
期望：`BUILD SUCCESS`，测试总数 = 接线前 + 12（写侧 6 + 读侧 6，逐格点名）。日志落在 `tmp/p8b-test.log`（gitignored），条数记进提交正文。**这一档不许用「之前有几条红的」放宽**：P7 之前 `./mvnw test` 是绿的，红了就是本任务弄的。

- [ ] **Step 12: 起服让 V13 生效 + 表形状探针实测**

```bash
export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18"
set -o pipefail
cd /d/SmartSCRM/apps/server
powershell -NoProfile -ExecutionPolicy Bypass -File tmp/p7b-kill8180.ps1
./mvnw -q -DskipTests package
java -jar target/*.jar 2>&1 | tee /d/SmartSCRM/tmp/p8b-server.log &
# 等 :8180 起来（条件轮询，不 sleep）
for i in $(seq 1 60); do curl -sf http://localhost:8180/api/health >/dev/null && break; sleep 1; done
javac -cp "$(cat /d/SmartSCRM/tmp/mvn-cp.txt)" -d /d/SmartSCRM/tmp/p8bcls /d/SmartSCRM/tmp/P8Tables.java 2>/dev/null || true
node /d/SmartSCRM/tmp/p8b-tables.mjs   # 见下：JDBC 走 java，或直接用现成的 P6Tables 形状
```

**Flyway 只在启动时跑**，所以 V13 必须靠这一次重启才进库。表形状的实测按老规矩走 `tmp/*.java` 的 JDBC 探针（`tmp/P6Tables.java` 是形状先例）：读 `information_schema.COLUMNS`，断言 `chat_group` 有 `last_coverage`（`double`、`IS_NULLABLE=YES`）与 `last_reconcile_reason`（`varchar(24)`）两列，缺任何一列 exit 1。**探针脚本不落 git，但日志要 tee 进 `tmp/`**，否则这一格停在「推断」。

- [ ] **Step 13: 文档同步 + 提交**

- 本计划：§A.1 交付状态表加一行（8b 已交付 + commit 号）；§A.2 里那三处「当前实现是缺陷」的括注改成「已修（8b）」；Task 9 的 `lastCoverage` 可选注释与 `sort` 参数注释各加一句「8b 之后后端给这两个键」。
- `docs/superpowers/specs/2026-09-30-group-member-analysis-design.md`：§7 的 `GET /groups` 补 `sort` 参数、`GET /customer/{id}/groups` 补 `accountId`、导出超限那句把「400」改成 40016 的口径；§3 的 `chat_group` 列清单补两列。**spec 只写规则。**

```bash
cd /d/SmartSCRM
git add apps/server/src/main/java apps/server/src/main/resources/db/migration/V13__group_gate_reading.sql \
        apps/server/src/test/java/com/smartscrm/server/service apps/desktop/src/shared/groupMembers.ts \
        docs/superpowers/specs/2026-09-30-group-member-analysis-design.md \
        docs/superpowers/plans/2026-09-30-group-member-analysis.md
git commit -m "$(cat <<'EOF'
fix(P8/B6): 后端校准八条——闸读数落库、搜索转义、行序、账号收窄、导出与事件投影

已交付的 Java 层形状是权威（R30），但八处语义与 spec 冲突，逐条改回：
闸读数落 V13 两列并换 record 容器（Map.of 把 null 压成空串）；名单排序 ISNULL 沉底；
搜索走 SearchPattern 不再二次包 %；客户反查按账号收窄；导出去重早于计数并给 40016；
事件投影按 affected rows（批量 INSERT IGNORE 说不出哪几行是新的）；入参长度整批拒收、phone 入库即归一。

同时补上 3771927 那一层缺的 JUnit：12 条，先红后绿。
EOF
)"
```

**提交前自查**：`git status --short` 里不许出现 `tmp/` 下任何东西、不许出现 `apps/desktop/tsconfig.node.tsbuildinfo`、差距表 `docs/notes/2026-09-22-legacy-feature-gap.md` 永不进暂存。

---

## Task 9: 主进程 `groupCollect/api.ts`（泵用的三跳）+ unit 闸门接线

**Files:**
- Modify: `apps/desktop/src/shared/groupMembers.ts`（追加 POST 出入参与读侧行 wire 类型；Task 2 建的那一份的续篇）
- Create: `apps/desktop/src/main/services/groupCollect/api.ts`
- Create: `apps/desktop/src/main/services/groupCollect/api.test.ts`
- Modify: `apps/desktop/tsconfig.unit.json`（include 补 `src/main/services/groupCollect/**`）
- Modify: `apps/desktop/package.json`（`test:unit` 的 glob 列表补一条）

**Interfaces:**
- Consumes：Task 5 的 `GroupMemberBatchDTO` / `IngestResult`、Task 7 的 `PageResult<GroupVO>`、Task 8 的 `List<GroupExportRowVO>`——**字段名逐字取自 §A.2**（那三节的正文是设计过程记录，与 §A.2 冲突处以 §A.2 为准）。
- Produces（Task 10 的攒批器、Task 11 的泵、Task 13 的导出全从这里取型）：
  - shared（追加，不动已交付的那 327 行）：`GroupListWire` `GroupSnapshotPayload` `GroupBatchPayload` `GroupIngestResult` `PageWire<T>` `GroupRowWire` `GroupExportRowWire`；**外加 §A.3 缺的那七个常量** `CHAT_KEY_MAX=128` `MEMBER_KEY_MAX=160` `DEDUP_KEY_MAX=160` `GROUP_BODY_MAX=512` `EVENT_BATCH_SIZE=100` `EVENT_BATCH_INTERVAL_MS=2_000` `EVENT_QUEUE_MAX=5_000`（Task 2 正文写了、实现没落；下游按它们判长度与攒批）。**`CoverageReason` 已在 shared 交付，本任务不重复声明、不改它的四值**（R33）；`GroupIngestResult.reason` 就是它。`GroupListWire` 是新声明：已交付的 `chatTypes.ts:148` 把同一个形状内联写在 `group_list_result` 帧里，本任务把它提到 shared 给 POST 体与渲染层共用，**不动 `chatTypes.ts`**（两处形状由 Step 1 末尾那条形状锁住，判据是 `typecheck:unit`）。
  - api：`type Fetcher`、`interface GroupApiOptions { fetcher: Fetcher; onError?: (where: string, e: unknown) => void }`、`createGroupApi(opts): GroupApi`、`type GroupApi = ReturnType<typeof createGroupApi>`
    - `postBatch(payload: GroupBatchPayload): Promise<GroupIngestResult | null>`
    - `groups(accountId: number, page: number, size: number, sort?: 'stale'): Promise<PageWire<GroupRowWire> | null>`（`sort` 是 Task 8b ⑥ / R41 那一支；泵传 `'stale'`）
    - `exportRows(accountId: number, chatKeys: string[]): Promise<GroupExportRowWire[] | null>`

**技术要点**

- **工厂形状取 `batchApi.ts` 那一份，不取 `msgApi.ts` 那一份**：`msgApi` 是 `{ token, apiBase, fetchImpl }` 的老形状，每次调用现取一次令牌，**没有 401→刷新→重试**；`batchApi` 走 `authedFetch`（`main/services/authedFetch.ts`：401 时共用一条 in-flight 的 `refreshAccessToken`，只重放一次）。泵的 `POST /batch` 一旦赶上令牌到期，老形状会把整批事件变成 401 丢弃，而新形状只是慢一跳。**这条判据写给下一个采集面用**：主进程新开的 HTTP 面默认接 `authedFetch`，除非它比消息量小三个数量级。
- **只有三跳，不是六跳**：`/group/members`、`/group/events`、`/customer/{id}/groups` 三支不进主进程——渲染层有自己的 `renderer/src/lib/http.ts`（自带 token 对、401 刷新链、`code!==0 ⇒ throw ApiError`），P6/P7 的读面全走它。主进程只留「泵要写的」（`postBatch`）、「泵要读的」（`groups`）、「导出要落盘的」（`exportRows`）。**少写的三跳不是偷懒**：把它们做成 IPC 转发会得到三份没人调用的代码 + 两条 IPC 白名单，而界面将来读它们时用的是渲染层那一份。记 R26。
- **`null` 只有一种含义：这一跳没成**（非 2xx / `code!==0` / `code=0` 但缺 `data` / `fetcher` 抛，四类都落到 `onError` 再塌 `null`）。Task 11 的泵靠它区分「重试一次」与「放弃这一轮」；`GroupIngestResult` 里 `eventsInserted=0` 是**成了但一条没收**（多半是重复上报），两者混成一件事就会让泵对着一个已经写坏的后端一直重试。这与 `batchApi.retryFailed` 当年把「没成」与「没有 failed 行」分开是同一格教训。
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
import type { BridgeReport } from '../../../shared/chatTypes.ts'
import type { GroupBatchPayload, GroupListWire } from '../../../shared/groupMembers.ts'

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
          groupsUpserted: 0, eventsInserted: 1,
          reconciled: false, coverage: null, reason: 'no_snapshot'
        }
      })
    }
  })
  const out = await api.postBatch(payload)
  assert.equal(out?.reason, 'no_snapshot')
  assert.equal(out?.eventsInserted, 1)
  // 判别力：把「这一跳没成」与「成了但没做判退」混成一件事的实现，这里会塌成 null 或给出 reconciled=true。
  assert.equal(out?.reconciled, false)
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
          chatKey: '120363111@g.us', title: 'G', platform: 'whatsapp',
          participantCount: 30, inGroupCount: 28,
          lastSnapshotAt: '2026-09-30T10:00:00', snapshotCount: 2, isFinal: false,
          // 这两格要等 Task 8b ③（V13 + 落库）才有读数；那之前后端不给这两个键。
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
  // `isFinal` 是 JSON 布尔（§A.2 ②：Java `boolean` → `true|false`），不是 0/1。
  // 判据写成 `=== false`：用 `!r.isFinal` 的话，`0`、`undefined`、`null` 都能冒充"没解散"。
  assert.equal(out?.records[0].isFinal, false)
  await api.groups(7, 1, 200, 'stale')   // 泵那一支（R28 / R41，Task 8b ⑥ 交付这一参数）
  assert.equal(seen[1], '/api/group-members/groups?accountId=7&page=1&size=200&sort=stale')
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

/**
 * 形状锁（Step 3 那条「不动 `chatTypes.ts`」的兑现处）。
 *
 * `GroupListWire` 与 `group_list_result` 帧里的内联 `{chatKey, title}` 是同构的两份声明，光看代码
 * 谁也不会发现它们错开——直到渲染层拿到一个 `title: undefined` 的空列。这里让同一份对象**两个方向**
 * 各赋一次：帧改成 `{chatKey, name}` 或 shared 多出必填键，`typecheck:unit` 就编译不过（运行期这两个
 * 断言只是普通赋值，`node --test` 不会因它们变化，所以**判据是四路 typecheck，不是这条测试红**）。
 */
type FrameGroupItem = Extract<BridgeReport, { kind: 'group_list_result' }> extends {
  groups?: infer G
}
  ? NonNullable<G>[number]
  : never

test('shared 的 GroupListWire 与桥帧里的群项同形（双向赋值，错开则 typecheck 红）', () => {
  const wire: GroupListWire = { chatKey: '120363111@g.us', title: null }
  const fromFrame: FrameGroupItem = wire
  const backToWire: GroupListWire = fromFrame
  void fromFrame
  assert.equal(backToWire.chatKey, '120363111@g.us')
  assert.equal(backToWire.title, null)
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
 * Task 9：主进程 ↔ 后端的线形。读端点里只有 `groups` 与 `export-rows` 进主进程——
 * 成员名单 / 流水 / 客户反查由渲染层自己的 `lib/http.ts` 读（它自带 token 对与 401 刷新链），
 * 所以这些类型同样放这里给两侧共用（R26、R27）。
 *
 * 键名一律照 §A.2 的已提交后端，不照 Task 5/7/8 正文里那些设计名——那两个计数、
 * `reasons[]`、三值 reason 都不存在，抄过来会得到一份"看着有类型、读出来全是 undefined"的契约。
 *
 * **Task 2 正文里那九个常量只落了五个**（§A.3）：长度闸与攒批常量在已交付的 shared 里**不存在**，
 * 而 Task 10/11/13 要消费它们。本任务补齐，数字一律照 §A.2 的 V12 列宽——列宽才是会让 INSERT
 * 报错的那道闸，不是设计稿里的数。
 */
export const CHAT_KEY_MAX = 128
export const MEMBER_KEY_MAX = 160
/** `dedup_key` 与 `member_key` 今天同为 160，但分开命名：它俩约束的是不同的列。 */
export const DEDUP_KEY_MAX = 160
export const GROUP_BODY_MAX = 512

export const EVENT_BATCH_SIZE = 100
export const EVENT_BATCH_INTERVAL_MS = 2_000
/** 事件不像消息行可以「同步历史」补底：越界即永久缺口，所以这一格必须带 dropped 计数（Task 10/12）。 */
export const EVENT_QUEUE_MAX = 5_000

/** 群名单的一行。已交付的 `chatTypes.ts:148` 把同一形状内联在 `group_list_result` 帧里，这里提到 shared 给 POST 体用；**不改 `chatTypes.ts`**，两者结构相同即可，Step 1 末尾那条形状锁住它。 */
export interface GroupListWire {
  chatKey: string
  title: string | null
}

/**
 * 快照那一跳的体。刻意**只有** `chatKey` + `participants`：`GroupMemberBatchDTO.SnapshotItem`
 * 就这两个字段（R34），页内帧上的 `participantCount` / `truncated` 到主进程为止，发不出去也不该发。
 */
export interface GroupSnapshotPayload {
  chatKey: string
  participants: GroupParticipantWire[]
}

/** `GroupMemberBatchDTO`：一次 POST 可以只带 events（攒批）、只带 groups（建档首轮）、或 groups + snapshot（每群一跳）。 */
export interface GroupBatchPayload {
  accountId: number
  groups?: GroupListWire[]
  snapshot?: GroupSnapshotPayload
  events?: GroupEventWire[]
}

/**
 * `IngestResult`（§A.2 ①）：两个计数 + 判退结论。
 * `coverage=null` 有两种——首次建档（没有分母可除）与这一批没做快照，靠 `reason` 分：`first_build` vs `no_snapshot`。
 * 后端**不给** `reasons[]`（逐条拒收文案这一层不存在，R32），别在这里声明一个永远 undefined 的字段。
 */
export interface GroupIngestResult {
  groupsUpserted: number
  eventsInserted: number
  reconciled: boolean
  coverage: number | null
  reason: CoverageReason
}

/** `PageResult<T>` 的线上形状：注意字段是 `pageSize`，不是 `size`。 */
export interface PageWire<T> {
  records: T[]
  total: number
  page: number
  pageSize: number
}

/**
 * `GroupVO`（§A.2 ②）的线上形状。两个口径别混：`lastEventAt` 来自流水表，「最近聊天时间」是成员/导出那一层从 `chat_message` 聚合的（Task 8）。
 * 日期一律当不透明字符串：泵只按后端给的位置排建档优先级（R28），不做时区运算（后端 `MsgTimes.CHAT_ZONE` 是唯一折算处）。
 */
export interface GroupRowWire {
  chatKey: string
  title: string | null
  /** 由账号反查得出（`platform_account.platform_type`），客户端说了不算。 */
  platform: string
  participantCount: number | null
  inGroupCount: number | null
  snapshotCount: number
  lastSnapshotAt: string | null
  /**
   * Java `boolean` → JSON `true | false`，**不是 0/1**（§A.2 ②）。
   * 判 `=== true` / `=== false`，不判真值：`undefined`（后端没给这一键）在真值判法下会冒充"没解散"。
   */
  isFinal: boolean
  /** 闸读数（R1 / R35）：Task 8b ③ 之前后端**不给这两个键**，所以类型上是可选。**8b 之后后端给这两个键**（`GroupVO` 末尾那两键，值可为 `null`），可选声明留着不动是为了不回头改已交付的引用。 */
  lastCoverage?: number | null
  lastReconcileReason?: CoverageReason | null
  lastEventAt: string | null
}

/**
 * `GroupExportRowVO`（§A.2 ⑥）：14 列的取数结果，列序由 `EXPORT_COLUMNS` 定，行序由后端定（R22）。
 *
 * 三处与"成员行"不同，抄错就会得到一列 `undefined`：群键这一列叫 **`groupId`** 不叫 `chatKey`；
 * **没有** `memberKey` / `displayName` / `firstSeenAt`（14 列本来不含它们，人名列叫 `name`、角色列叫 `role`）；
 * `inGroup` 已经是**中文串** `'是' | '否'`（后端格式化过），主进程再映射一次就是把同一个事实写两个词。
 * `role` 与 `exitMethod` 仍是原始码，进表格时才过 `groupRoleLabel` / `exitMethodLabel`（Task 13）。
 */
export interface GroupExportRowWire {
  seq: number | null
  groupName: string | null
  groupId: string
  phone: string | null
  name: string | null
  role: string | null
  inGroup: string | null
  joinAt: string | null
  joinCount: number | null
  leaveAt: string | null
  exitMethod: string | null
  lastMsgAt: string | null
  dayMsgCount: number | null
  msgCount: number | null
}
```

- [ ] **Step 4: 实现 api**

```ts
// src/main/services/groupCollect/api.ts
import type {
  GroupBatchPayload,
  GroupIngestResult,
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
      call<GroupIngestResult>('/api/group-members/batch', jsonInit(payload)),

    /** `sort` 只有泵用（R28 / R41）；不传就是后端的默认顺序。这一参数要等 Task 8b ⑥ 落地才有读数，传了也不报错（Spring 忽略未声明的请求参数）。**8b 之后这一参数有读数**：`sort=stale` = 从没成功快照的群排最前，其余按 `last_snapshot_at` 从旧到新，`id` 定全序；缺省 = 新的在前。 */
    groups: (accountId: number, page: number, size: number, sort?: 'stale') =>
      call<PageWire<GroupRowWire>>(
        `/api/group-members/groups?accountId=${accountId}&page=${page}&size=${size}` +
          (sort === undefined ? '' : `&sort=${sort}`),
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
- Consumes：`BridgeReport`（Task 3 加过三种 `kind` 的那一份联合）、`GroupEventWire` / `EVENT_BATCH_SIZE` / `EVENT_BATCH_INTERVAL_MS` / `EVENT_QUEUE_MAX` / `CHAT_KEY_MAX` / `MEMBER_KEY_MAX` / `DEDUP_KEY_MAX` / `GROUP_BODY_MAX` / `SNAPSHOT_TIMEOUT_MS`（`shared/groupMembers.ts`——**前四个攒批常量与三个长度常量不在已交付的那 327 行里**，由 Task 9 Step 3 补齐，见 §A.3）、`GroupApi`（Task 9）
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
  DEDUP_KEY_MAX,
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
  if (!fits(raw.chatKey, CHAT_KEY_MAX) || !fits(raw.memberKey, MEMBER_KEY_MAX) || !fits(raw.dedupKey, DEDUP_KEY_MAX)) {
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
  const h = harness({ groups: [{ chatKey: 'a@g.us', title: null }] })
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => { release = r })
  const kinds: string[] = []
  // 列表那一跳立刻答，快照那一跳卡在 gate 上——这就是「泵正在跑」的现场。
  const engine = new GroupEngine({
    ...h.deps,
    pull: async (_viewId, cmd) => {
      kinds.push(cmd.kind)
      if (cmd.kind === 'group_list') {
        return { kind: 'group_list_result', reqId: cmd.reqId, ok: true, groups: [{ chatKey: 'a@g.us', title: null }] }
      }
      await gate
      return {
        kind: 'group_snapshot_result', reqId: cmd.reqId, chatKey: cmd.chatKey, ok: true,
        participants: [member('8613800000001')], participantCount: 9
      }
    }
  })
  const first = engine.runForAccount(7)
  // 有界自旋而不是无限等：等不到「在跑」就是 gate 没生效，直接失败而不是挂死测试。
  for (let i = 0; i < 1_000 && !engine.running(7); i++) await new Promise((r) => setTimeout(r, 0))
  assert.equal(engine.running(7), true, '快照那一跳确实还挂在 gate 上')
  const second = await engine.runForAccount(7)
  assert.equal(second.skipped, 'busy')
  assert.equal(kinds.filter((k) => k === 'group_list').length, 1, '第二次连列表都不该发')
  release()
  assert.equal((await first).skipped, null)
})

test('账号没绑视图：skipped=no_view，一条命令都不发', async () => {
  const h = harness({ groups: [{ chatKey: 'a@g.us', title: null }] })
  const out = await new GroupEngine({ ...h.deps, viewIdOf: () => null }).runForAccount(7)
  assert.equal(out.skipped, 'no_view')
  assert.equal(out.attempted, 0)
  // 判别力：只看 skipped 的值拦不住「先发了命令再补一句没绑视图」；这一跳必须压根没发生。
  assert.equal(h.pulls.length, 0)
  assert.equal(h.posts.length, 0)
})
```

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

## Task 12: 装配——`groupCollect/host.ts` + 桥三帧路由 + preload + 启停

**Files:**
- Create: `apps/desktop/src/main/services/groupCollect/host.ts`
- Modify: `apps/desktop/src/shared/groupMembers.ts`（`GroupBuildOutcome` 迁入 + `GroupStateEvent` + `oneLine()`）
- Modify: `apps/desktop/src/main/services/groupCollect/engine.ts:1-40`（本地 `GroupBuildOutcome` / 私有 `line()` 换成 shared 那两份）
- Modify: `apps/desktop/src/main/services/msgBridge/index.ts`（`GroupBridgeHooks` 一处注入点 + 三帧路由 + ready/掉线接线）
- Modify: `apps/desktop/src/preload/index.ts`（`group` 命名空间）
- Modify: `apps/desktop/src/main/index.ts:36-50`（`startGroupHost()` / `stopGroupHost()`）

**Interfaces:**
- Consumes：`GroupRegistry` / `EventCollectorHub` / `EventBatchPayload`（Task 10）、`createGroupApi` / `GroupApi`（Task 9）、`GroupEngine` / `GroupEngineDeps` / `GroupBuildOutcome`（Task 11）、`pushToBridge` / `accountOfId` / `accountOfView`（既有 msgBridge）、`authedFetch`（既有）、`BridgeReport` 的三种群 `kind`（Task 3）
- Produces（Task 15 的渲染层与 Task 16 的界面只认这些名字）：
  - `shared/groupMembers.ts`：`interface GroupBuildOutcome { accountId: number; skipped: 'busy' | 'no_view' | null; list: 'ok' | 'error' | 'silent'; registered: number; attempted: number; snapshotted: number; postedFailed: number; failed: number; skippedFinal: number; truncated: boolean; aborted: boolean }`
  - `shared/groupMembers.ts`：`interface GroupStateEvent { accountId: number; phase: 'running' | 'settled'; outcome: GroupBuildOutcome | null }`
  - `shared/groupMembers.ts`：`function oneLine(text: string | undefined, max?: number): string`
  - msgBridge：`interface GroupBridgeHooks { onFrame(viewId: string, accountId: number, report: GroupFrameReport): void; onReady(accountId: number, viewId: string): void; onViewDown(viewId: string): void }`、`type GroupFrameReport = Extract<BridgeReport, { kind: 'group_list_result' } | { kind: 'group_snapshot_result' } | { kind: 'group_event' }>`、`function setGroupHooks(hooks: GroupBridgeHooks | null): void`
  - host：`function startGroupHost(): void`、`function stopGroupHost(): Promise<void>`
  - IPC：`invoke('group:build', { accountId: number; chatKey?: string }) → Promise<GroupBuildOutcome | null>`（**单数**，R49：`chatKey` 省略 = 整账号一轮，给一个 = 只补那一群，弹层「刷新成员」用后者）、`on('group:state', GroupStateEvent)`
  - preload：`window.scrm.group.build(req)`、`window.scrm.group.onState(cb)`

**技术要点**

- **依赖方向只有一条边：`groupCollect/host.ts` → `msgBridge/index.ts`**。反过来 import（msgBridge 直接拿 host 里的 `GroupRegistry` 实例）会做成 `index ↔ host` 的运行时循环——esbuild 打包下表现为 `host.ts` 顶层的 `new GroupRegistry()` 在 `msgBridge/index.ts` 求值时还没初始化，`handleBridgeReport` 一读就是 TDZ。所以 msgBridge 只认识一个可注入的 `GroupBridgeHooks`（类型来自 `shared/chatTypes` 的 `BridgeReport`，不 import 任何 groupCollect 的东西），host 在 `startGroupHost()` 里把自己装上去。这也保住了 P6 已验收那块地基的单方面可读性：想知道群帧去哪了，只看一次 `setGroupHooks` 的调用点。
- **三种群帧不进 `mount.handle`**（`bridgeMount.ts:114-130` 的 `default: return false` 是它唯一的处理法）：那条支路对未知 `kind` 只是返回 false，落到底等于**静默丢弃**。更关键的是 `group_event` 根本没有 `reqId`，它不属于任何未决表；而两支 `*_result` 的结清对象是 groupCollect 那张 15s 表，不是 mount 的生命周期状态机。所以路由必须插在 `handleBridgeReport` 的分支链里（`active_chat` 那支之后、`mount?.handle(report)` 之前），三条都带 `return`。
- **`pull` 里先登记再下命令**（与 `sendTextUnlocked` 同一次序，`msgBridge/index.ts` 的 `registry.add` 在 `mount.push` 之前）：页内可能在我们登记之前就把帧送上来了，反过来会把那一帧变成「无人认领」，而泵只能干等 15s 超时——把一次成功读成一次超时是这条链上最贵的判读错误。
- **`pushToBridge` 返回 false 时当场结 `null`**：桥没 ready 就意味着这条命令永远不会有答案。不结的话表里留一条幽灵气泡，泵按「页内没答」处理但要多等 15s，一次建档 200 群就是 200 次白等。用 `failView(viewId)` 结是安全的：同一视图同一时刻至多一条在飞群命令（泵 per-account 一条，视图与账号 1:1），所以它只会结掉刚登记的那一条。
- **账号归属由主进程盖，页内帧不带 `accountId`**（R13）：`handleBridgeReport` 已经在最前面用 `accountOfView(viewId)` 做过一次归属判定（`if (!entry) return`），群帧复用同一个 `entry.accountId`。页内不知道自己对应哪个平台账号 id，让它带就是给伪造留门。
- **掉线结清挂在既有的那处分支上**，不新开监听：`broadcastState()` 里 `phase === 'retry' | 'offline' | 'destroyed'` 那一段已经在结 `registry`（发送）与 `recallRegistry`（撤回），`groupHooks?.onViewDown(s.viewId)` 加在同一段里，三个结清出口就只有一条"什么时候算掉线"的判据。host 那一侧的实现就是 `groupRegistry.failView(viewId)`，结出来一律 `null`（Task 10 第 2 条）。
- **自动建档每个账号只跑一次**（`autoBuilt: Set<number>`）：`onReady` 在每次 `mount()` 成功时都发（含心跳掉线后的重挂），照字面接会让一次网络抖动换一轮 200 群的采集。代价：运行中真的换过一次登录（同视图退出再登录）时，第二次 ready 不自动补档——**手动按钮能补**，界面文案说清这一点。为什么不用时间窗（"距上次自动建档 >N 分钟就再跑"）：spec 没有"N 分钟算过期"的依据，编一个数字就是把它当事实用。
- **`group:state` 只报"这一轮在跑 / 结了"，不报进度**：进度的真值在后端（`snapshot_count`、`last_snapshot_at`），渲染层要进度就 GET 群列表（Task 15），广播再带一份计数就会造出"两个真值"那条老问题（对照 `msgBridge` 里 `active_chat` 不另开通道、统一走 `msg:state` 的理由，`index.ts:323-331`）。`phase:'running'` 那一格的意义是让按钮当场变灰——引擎的 `skipped:'busy'` 只有配合它才有可见反馈。
- **`startGroupHost()` 排在 `startMsgBridge()` 之前**：`startMsgBridge()` 的 `refreshAccounts → mountOne → mount().then(ok)` 全在微任务里跑，同一次 `whenReady` 里如果先启桥，第一条 `onReady` 有实现在 hook 装上之前落地的可能，症状正是"账号上线那一格静默不采"。顺序写死比"应该来不及"可靠。
- **`stopGroupHost()` 的三件套**：`setGroupHooks(null)`（不再有新帧进来挂表）→ `engine.stop()`（这一轮跑完就止步，不打断在途那一跳）→ `groupRegistry.dispose()`（超时定时器没 `unref`，不 dispose 就是退出路上最多 15s 的挂起，Task 10 第 4 条）→ `await eventHub.flush()` 再打 `dropped` 那行 → `eventHub.dispose()`。`main/index.ts` 的 `before-quit` 用 `void` 调它，与既有的 `void stopMsgBridge()` / `void stopBatchHost()` 同一档事实：**能不能冲完取决于进程还活多久**，冲不掉的缺口由下次启动的快照收口补（spec §9），这里不假称"退出前必达"。
- **`runBuild` 的 catch 是给实现缺陷准备的，不是给业务失败准备的**：泵把所有可预期失败都结成了 `GroupBuildOutcome` 的字段（Task 11），逃到这里的只剩"页内帧形状变了导致 `settle` 之外抛"这一类。它仍必须广播一条 `settled`——否则界面永远等在 `running` 那一格。合成那一条 `outcome`（`list:'error'`、计数全 0）并在日志里点名是 catch 段，界面文案不许把这一格说成"没有群"。
- **`accountId` 入参校验落在 host**：`ipcMain.handle` 收到的是渲染层给的任意值，`Number.isInteger(accountId) && accountId > 0` 不合格直接返回 `null`（不抛），日志写"入参不合格"。为什么不等 `accountOfId` 去过：那一只按 id 查表，查不到返回 undefined，与"传进来的是字符串 `"7"`/负数/NaN"是两种诊断，界面拿到的都是 null 但日志能分开。
- **本任务没有 unit 腿**（诚实的验证档次）：`host.ts` import 了 `electron` 的 `ipcMain` 与主窗口，`node --test` 那条闸门进不去——与 `batchSend/host.ts`（P7 Task 12）同一处境，那一任务的装配也是靠四路 typecheck + 构建 + 后面的实机腿结的。所以这里的判据分两档：**可自动化**= 四路 typecheck + `test:unit` 总数不变（Task 10/11 的表与泵仍绿）+ `pnpm run build`；**待实机**= Task 17 的 CDP 腿按两行主进程日志取证（`[group] 建档结清 …`、`[group] 事件剔除 …`）。不许在本任务写"已验证装配可用"。
- **`oneLine` 上移到 shared 而不是第三份拷贝**：Task 11 的 engine 里已经写了一份私有 `line()`，host 还要用第二次（`reqId` 进日志前收一行）。msgBridge 那份保持不动（改它要动 P6 已验收文件，不值），但 groupCollect 内部不留两份。
- **`GroupBuildOutcome` 从 engine.ts 迁到 shared 的唯一理由是 preload**：preload 不许 import `main/services/**`（两个 tsconfig 的边界，`batchSend.ts:76-78` 同一条注释），而 `window.scrm.group.build` 的返回类型必须是它。engine.ts 改成 `import type` + `export type { GroupBuildOutcome }`，Task 11 已写好的测试与类型引用一行都不用动。

- [ ] **Step 1: shared 补两份类型与一行文本收口**

`apps/desktop/src/shared/groupMembers.ts` 末尾追加：

```ts
/**
 * 一轮建档的结论。放在 shared 而不是 `engine.ts`：`window.scrm.group.build` 的返回类型
 * 要经 preload，而 preload 不许 import `main/services/**`（与 `batchSend.ts` 的
 * `BatchProgress` 同一条边界理由）。
 * `skipped` 与 `list` 是两种「什么都没做」：前者这一账号不该做（在跑 / 没绑视图），
 * 后者做了但页内没给答案。渲染层的文案必须分开，混成一句就看不出该重试还是该等。
 */
export interface GroupBuildOutcome {
  accountId: number
  skipped: 'busy' | 'no_view' | null
  list: 'ok' | 'error' | 'silent'
  registered: number
  attempted: number
  snapshotted: number
  postedFailed: number
  failed: number
  skippedFinal: number
  truncated: boolean
  aborted: boolean
}

/** `group:state` 的唯一载荷：只说"这一轮在跑 / 结了"，进度另有真值（见 Task 12 技术要点）。 */
export interface GroupStateEvent {
  accountId: number
  phase: 'running' | 'settled'
  outcome: GroupBuildOutcome | null
}

/**
 * 页内来的文本进主进程日志前收成一行：留着换行等于允许伪造日志行，长度也不该无界。
 * 与 `msgBridge/index.ts:163-167` 同口径的第三份实现，唯一区别是它在这里是共享的：
 * groupCollect 的 engine 与 host 都要用，两处各写一份就是两份要各自改的规矩。
 */
export function oneLine(text: string | undefined, max = 200): string {
  // \v \f 之类也算换行（Chrome 的 console 会把它们断行），所以按 C0 控制字符整体收。
  // eslint-disable-next-line no-control-regex
  return (text ?? '').replace(/[\x00-\x1f]+/g, ' ').slice(0, max)
}
```

`engine.ts` 里删掉本地那段 `export interface GroupBuildOutcome { … }` 与私有的 `function line(…)`，改成：

```ts
import { GROUP_GAP_MS, MAX_GROUPS_PER_BUILD, RETRY_BACKOFF_MS, oneLine, type GroupBuildOutcome } from '../../../shared/groupMembers.ts'
export type { GroupBuildOutcome }
```
调用点里 `line(x)` 换成 `oneLine(x)`（同签名，机械替换）。

- [ ] **Step 2: msgBridge 加一处注入点与三条路由**

`msgBridge/index.ts` 顶部（`import` 之后、`HISTORY_LIMIT_DEFAULT` 之前）加：

```ts
/**
 * 群能力帧的出口。msgBridge 只认识这一个注入点，不认识 groupCollect：
 * 反向 import 会把 `index ↔ host` 做成运行时循环（Task 12 技术要点第 1 条），
 * 而这里想要的只是"这三种 kind 有别人在处理"，用不着知道那是谁。
 */
export interface GroupBridgeHooks {
  onFrame(viewId: string, accountId: number, report: GroupFrameReport): void
  /** 桥 ready（首次挂上，或掉线后重挂成功）：spec §5 的"账号上线"那一格。 */
  onReady(accountId: number, viewId: string): void
  /** 视图进入 retry / offline / destroyed：在飞的群命令不会再有答案。 */
  onViewDown(viewId: string): void
}

/** 三种群帧的合集；两支 `*_result` 带 reqId，`group_event` 不带（它不属于任何未决表）。 */
export type GroupFrameReport = Extract<
  BridgeReport,
  { kind: 'group_list_result' } | { kind: 'group_snapshot_result' } | { kind: 'group_event' }
>

let groupHooks: GroupBridgeHooks | null = null

export function setGroupHooks(hooks: GroupBridgeHooks | null): void {
  groupHooks = hooks
}
```

`broadcastState()` 里那段 `if (s.phase === 'retry' || …)` 内，紧接 `recallRegistry.failView(...)` 之后加：

```ts
      // 群命令共用这一条掉线出口：未决的快照结 null，泵据此中止整轮而不是对死页连发 200 跳。
      groupHooks?.onViewDown(s.viewId)
```

`handleBridgeReport` 里，`active_chat` 那一支的 `return` 之后、`mount?.handle(report)` 之前插入：

```ts
  // 三种群帧直接交给 groupCollect。不走 `mount?.handle`：那一只对未知 kind 只返回 false，
  // 落到底等于静默丢弃，而 `group_event` 连 reqId 都没有，挂到任何未决表上都是错的。
  if (report.kind === 'group_list_result' || report.kind === 'group_snapshot_result' || report.kind === 'group_event') {
    if (!groupHooks) {
      // host 没装 hook（只在启动的极短窗口与测试现场可能命中）：留一行痕迹，静默丢弃查不到。
      console.log(`[msgBridge] 群帧无人接 view=${viewId} kind=${report.kind}`)
      return
    }
    groupHooks.onFrame(viewId, entry.accountId, report)
    return
  }
```

`mountOne()` 里那句 `void mount.mount().then((ok) => { … })` 改成：

```ts
  void mount.mount().then((ok) => {
    // 握手成功才补底：没 ready 就发 backfill 命令，桥还没挂上钩子，等于白发。
    if (!ok) return
    mount.push({ kind: 'backfill', limit: HISTORY_LIMIT_DEFAULT })
    // 同一次 ready 的两个消费者：补底是消息链，建档是群链，两条都由"钩子真的在页里了"触发。
    groupHooks?.onReady(entry.accountId, viewId)
  })
```

- [ ] **Step 3: 写 `groupCollect/host.ts`**

```ts
// src/main/services/groupCollect/host.ts
import { ipcMain } from 'electron'
import { getMainWindow } from '../../window/mainWindow'
import { authedFetch } from '../authedFetch'
import { accountOfId } from '../msgBridge/accountDirectory'
import { pushToBridge, setGroupHooks, type GroupBridgeHooks } from '../msgBridge'
import { createGroupApi } from './api'
import { EventCollectorHub } from './collector'
import { GroupEngine } from './engine'
import { GroupRegistry } from './registry'
import { oneLine, type GroupBuildOutcome, type GroupStateEvent } from '../../../shared/groupMembers'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const api = createGroupApi({
  fetcher: (path, init) => authedFetch(path, init),
  onError: (where, e) => console.warn(`[group] ${where}`, e)
})

const groupRegistry = new GroupRegistry()

const eventHub = new EventCollectorHub({
  flush: async (payload) => {
    const result = await api.postBatch(payload)
    // Task 10 的契约：投不出去必须 reject（`drain()` 的退回重试只认这一种失败信号）。
    // `null` 在这里不返回假值而是抛，与 `msgBridge` 那条采集链同一处理（`index.ts:44-50`）。
    if (!result) throw new Error('group batch rejected')
  }
})

const engine = new GroupEngine({
  api,
  // 先登记再下命令：反过来会把已经在路上的帧读成一次超时。
  pull: async (viewId, cmd) => {
    const wait = groupRegistry.add(cmd.reqId, viewId)
    if (!pushToBridge(viewId, cmd)) {
      // 桥不在线 = 这条命令永远没人答。当场结 null：留着就是泵多等 15s，而 200 个群是 200 次白等。
      // `failView` 在这里只会结掉刚登记的那一条（同视图同一时刻至多一条在飞群命令）。
      groupRegistry.failView(viewId)
      return null
    }
    return wait
  },
  viewIdOf: (accountId) => accountOfId(accountId)?.viewId ?? null,
  sleep,
  now: () => Date.now(),
  log: (where, e) => console.warn(`[group] ${where}`, e)
})

/** 自动建档每账号一次：重连不再换一轮 200 群（代价与文案见计划技术要点）。 */
const autoBuilt = new Set<number>()

const hooks: GroupBridgeHooks = {
  onFrame(viewId, accountId, report) {
    if (report.kind === 'group_event') {
      const incoming = Array.isArray(report.events) ? report.events.length : 0
      const kept = eventHub.push(accountId, report.events)
      // 返回值是「收下几条」：差值就是被剔掉的非法条目。少了这一行，"页内报了一堆、库里 0 行"
      // 与"页内压根没报"在日志里长得一模一样。
      if (kept !== incoming) console.log(`[group] 事件剔除 view=${viewId} 收=${kept} 来=${incoming}`)
      return
    }
    // false = 表里已经没有这一格（超时先结了 / 视图销毁先结了）。迟到帧不重试也不补：
    // 泵那边已经按「页内没答」处理过，这一行只是把"页内其实答了"这件事留下来。
    if (!groupRegistry.settle(report)) {
      console.log(`[group] 群帧无人认领（迟到或已结）view=${viewId} reqId=${oneLine(report.reqId)}`)
    }
  },
  onReady(accountId) {
    if (autoBuilt.has(accountId)) return
    autoBuilt.add(accountId)
    void runBuild(accountId)
  },
  onViewDown(viewId) {
    const n = groupRegistry.failView(viewId)
    if (n > 0) console.log(`[group] 结清未决群命令 ${n} 条 view=${viewId}`)
  }
}

function broadcast(event: GroupStateEvent): void {
  // 与 `broadcastState`/`broadcastTheme` 同一条口径：`getMainWindow()` 可能给回一枚已销毁的窗口。
  const win = getMainWindow()
  if (win && !win.isDestroyed()) win.webContents.send('group:state', event)
}

/** 泵抛出来时的合成结论：界面必须拿到一个 settled，不能让按钮永远灰在 running。 */
function crashOutcome(accountId: number): GroupBuildOutcome {
  return {
    accountId, skipped: null, list: 'error', registered: 0, attempted: 0, snapshotted: 0,
    postedFailed: 0, failed: 0, skippedFinal: 0, truncated: false, aborted: false
  }
}

async function runBuild(accountId: number, chatKey?: string): Promise<GroupBuildOutcome | null> {
  if (!Number.isInteger(accountId) || accountId <= 0) {
    console.log(`[group] 建档入参不合格 account=${oneLine(String(accountId))}`)
    return null
  }
  broadcast({ accountId, phase: 'running', outcome: null })
  let outcome: GroupBuildOutcome
  try {
    outcome = await engine.runForAccount(accountId, chatKey)
  } catch (e) {
    // 泵把可预期失败都结进了 outcome，逃到这里的只剩实现缺陷（帧形状变了 / 空引用）。
    // 日志点名是 catch 段，界面那句「这一轮没跑成」不许写成「这个账号没有群」。
    console.warn(`[group] 建档抛出（非业务失败）account=${accountId}`, e)
    outcome = crashOutcome(accountId)
  }
  broadcast({ accountId, phase: 'settled', outcome })
  console.log(
    `[group] 建档结清 account=${accountId} list=${outcome.list} 登记=${outcome.registered}` +
    ` 尝试=${outcome.attempted} 成=${outcome.snapshotted} 投败=${outcome.postedFailed}` +
    ` 拉败=${outcome.failed} 终态跳=${outcome.skippedFinal} 截断=${outcome.truncated}` +
    ` 中止=${outcome.aborted} 跳过=${outcome.skipped ?? '-'}`
  )
  return outcome
}

export function startGroupHost(): void {
  // 先装 hook 再启桥：`startMsgBridge()` 的 refresh → mount → ready 全在微任务里跑，
  // 顺序反了第一条 onReady 有落在 hook 装上之前的可能，症状正是"账号上线那一格静默不采"。
  setGroupHooks(hooks)
  // `chatKey` 省略 = 整账号一轮；带上 = 只补这一群（spec §5 的 ②③ 两条触发点合成这一支，R25）。
  ipcMain.handle('group:build', (_e, req: { accountId: number; chatKey?: string }) =>
    runBuild(Number(req?.accountId), req?.chatKey))
}

export async function stopGroupHost(): Promise<void> {
  setGroupHooks(null)
  // 只停"下一群"：在途那一跳仍然答它自己的，硬掐会让一条快照结果无主。
  engine.stop()
  // 这张表的超时定时器没有 unref：不 dispose 就是退出路上最多 15s 的挂起（Task 10 第 4 条）。
  groupRegistry.dispose()
  // 退出前把队列里剩下的事件冲一次。冲不掉也不追：下一次启动由快照收口补（spec §9 同一口径）。
  await eventHub.flush().catch(() => undefined)
  // 事件不像消息行可以"同步历史"补底，页内不重发历史 → 队列越界丢的是永久缺口，必须留一行。
  if (eventHub.dropped > 0) console.log(`[group] 本次运行丢弃群事件 ${eventHub.dropped} 条（队列越界丢最旧）`)
  eventHub.dispose()
}
```

- [ ] **Step 4: preload 与主进程启停**

`preload/index.ts` 顶部 type import 补一行：

```ts
import type { GroupBuildOutcome, GroupStateEvent } from '@shared/groupMembers'
```

在 `batch: { … }` 之后加一个 `group` 命名空间（同层、同形状）：

```ts
  /**
   * 群成员（P8/B6）：一条 invoke + 一条推送。
   * 五个读端点不在这里——渲染层 `lib/http.ts` 自己带 token 对与 401 刷新链，做成 IPC 转发
   * 只会多出三份 dead code 与两条白名单（R26）。留着这一条的理由是它必须经主进程：
   * 命令要下给内嵌页，页里才有 wa-js。
   */
  group: {
    build: (req: { accountId: number; chatKey?: string }): Promise<GroupBuildOutcome | null> =>
      ipcRenderer.invoke('group:build', req),
    onState: (cb: (e: GroupStateEvent) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, e: GroupStateEvent): void => cb(e)
      ipcRenderer.on('group:state', listener)
      return () => ipcRenderer.removeListener('group:state', listener)
    }
  }
```

`main/index.ts`：import 补 `import { startGroupHost, stopGroupHost } from './services/groupCollect/host'`；`registerIpcHandlers()` 之后、`startMsgBridge()` **之前**插 `startGroupHost()`；`before-quit` 里 `void stopBatchHost()` 之后补 `void stopGroupHost()`。

```ts
    registerIpcHandlers()
    // 顺序有含义：群采集要先装好 hook，再让桥开始挂载并上报 ready（Task 12 技术要点第 8 条）。
    startGroupHost()
    startMsgBridge()
    startBatchHost()
```

- [ ] **Step 5: 机械校验**

```bash
cd /d/SmartSCRM/apps/desktop
pnpm run typecheck:node && pnpm run typecheck:web && pnpm run typecheck:inject && pnpm run typecheck:unit
pnpm run test:unit 2>&1 | tail -15
pnpm exec eslint src/main/services/groupCollect/host.ts src/main/services/msgBridge/index.ts src/preload/index.ts src/main/index.ts src/shared/groupMembers.ts src/main/services/groupCollect/engine.ts --quiet
pnpm run build 2>&1 | tail -20
```
期望：四路 typecheck 全过；`test:unit` 总数与 Task 11 收尾时**相同**（本任务不加 unit 腿，见技术要点最后一条）；`--quiet` 零输出；`build` 打出 `msg-bridge.bundle.js` 与主进程产物。

- [ ] **Step 6: 实机两行日志（等用户重启，不进本任务的通过判据）**

主进程重启是用户的手。请用户在 dev 实例里让某个 WhatsApp 账号进 ready，然后到 dev 终端取两行：

```bash
# dev 终端的输出落在会话里；没有落盘就先按下面这条 grep（会话里没有就 exit 非 0，不要改写判据）
grep -nE '\[group\] (建档结清|事件剔除|群帧无人)' tmp/p8d-main.log || echo '没有落盘副本：这一格记为待实机，Task 17 用 CDP 腿补'
```
判据：`[group] 建档结清 account=… list=ok …` 至少一行，且 `尝试>0`。只有 `[msgBridge] 群帧无人接` 说明 hook 没装上（Step 4 的启动顺序没落地）；`list=silent` 说明页内没答，回到 Task 3 的 `group_list` 那一支查。

- [ ] **Step 7: 提交**

```bash
git add apps/desktop/src/main/services/groupCollect/host.ts apps/desktop/src/main/services/groupCollect/engine.ts apps/desktop/src/shared/groupMembers.ts apps/desktop/src/main/services/msgBridge/index.ts apps/desktop/src/preload/index.ts apps/desktop/src/main/index.ts
git commit -m "$(cat <<'EOF'
feat(P8/群成员): 装配——群帧路由、group:build 一条 IPC 与退出结清

依赖方向只做一条边：groupCollect 认识 msgBridge，反向靠一处可注入 hook，
否则 index 与 host 会做成运行时循环。

未决群命令与发送、撤回共用同一条掉线出口；桥不在线时下命令当场结 null，
不让泵对着一页死代码等 15s。

Co-Authored-By: Qoder <noreply@qoder.com>
EOF
)"
```

---

## Task 13: 导出——`exporter.ts`（纯工作簿）+ `group:export`（落盘）

**Files:**
- Create: `apps/desktop/src/main/services/groupCollect/exporter.ts`
- Create: `apps/desktop/src/main/services/groupCollect/exporter.test.ts`
- Modify: `apps/desktop/src/shared/groupMembers.ts`（`GroupExportResult` + 两张中文标签表 + 标签函数 + `formatExportTime`）
- Modify: `apps/desktop/src/main/services/groupCollect/host.ts`（`group:export` 那一支 IPC）
- Modify: `apps/desktop/src/preload/index.ts`（`group.export`）
- Modify: `apps/desktop/tsconfig.unit.json`（`include` 补 `src/main/services/groupCollect/exporter.ts`；`exceljs` 的类型走 node_modules，不用另配 `types`）
- Modify: `apps/desktop/package.json` + `pnpm-lock.yaml`（`exceljs`，安装动作属用户的手）

**Interfaces:**
- Consumes：`GroupExportRowWire`（Task 9）、`EXPORT_COLUMNS` / `MAX_EXPORT_GROUPS`（Task 2）、`api.exportRows`（Task 9）、`GroupApi`（Task 9）
- Produces（Task 16 的界面与 Task 14 的契约腿只认这些名字）：
  - `shared/groupMembers.ts`：`type GroupExportReason = 'cancel' | 'empty_keys' | 'too_many' | 'no_rows' | 'failed' | 'saved'`
  - `shared/groupMembers.ts`：`interface GroupExportResult { reason: GroupExportReason; path: string | null; rows: number; bytes: number }`
  - `shared/groupMembers.ts`：`GROUP_ROLE_LABEL` / `EXIT_METHOD_LABEL`（`Partial<Record<…,string>>`）、`groupRoleLabel(role: string | null): string`、`exitMethodLabel(method: string | null): string`、`formatExportTime(value: string | null): string`（时间文本的唯一作者，Task 15 的 `groupDisplay.ts` 也引它）
  - `exporter.ts`：`function buildWorkbook(rows: GroupExportRowWire[]): ExcelJS.Workbook`
  - IPC：`invoke('group:export', { accountId: number; chatKeys: string[] }) → Promise<GroupExportResult | null>`
  - preload：`window.scrm.group.export(req)`

**技术要点**

- **纯工作簿与落盘分成两个文件，是为了这一节能有自己的 unit 腿**：`exporter.ts` 只 import `exceljs` 与 shared，不碰 `electron`，所以 `node --test` 进得去；`dialog` / `fs` / IPC 那一段留在 `host.ts`，与 Task 12 的装配同一处境（只有 typecheck + 构建 + 实机腿）。装配任务最容易出的事故是"整节都无法自动验证"，这一刀把它切成两半。
- **单元格一律写文本，日期不写成 Excel 日期类型**：后端给的是 Jackson 序列化的 `LocalDateTime` 字符串，`new Date(s)` 会按本地时区重读它（无 `Z` 的串在 JS 里是本地时间），于是同一份数据在两个时区的机器上打开会差几小时。写文本 `2026-09-30 12:00:00` 的代价是那一列不能直接参与 Excel 的日期筛选与排序——**取舍理由**：这份文件是给人核对名单用的，读数错一小时比不能排序更坏，而排序的缺省形状本来就是"群内按进群时间升序"（R22 已在后端排好）。
- **`formatExportTime` 只做「`T` 换成空格、截到秒」，不解析、不换算**：`null` / 空串给空串（不给 `null`、不给 `-`），因为空单元格在表格里读作"没有这个时间"，而 `-` 在 §8 的口径里专指"有事件缺时间证据"（`exit_method='snapshot_absent'` 且 `latest_leave_at IS NULL` 那一格才是 `—`）。
- **`序号` 取后端的 `seq`，前端一律不许重算**（R22）：行序与跨群连续序号的唯一出处是后端那条 SQL，主进程重排一次就会造出"文件里的顺序与界面看到的不一样"。**判别力**：测试要喂一段 `seq` 不连续、顺序已定的行（`[5,6,1,2]`），断言第 1 列逐字是 `5,6,1,2`——重算实现的输出是 `1,2,3,4`，一眼分得开。
- **`0 行不落盘`**：`exportRows` 给回空数组意味着这些群一行成员都没有——最常见的原因是"从没建过档"，而不是"群里没人"。写一份只有表头的文件会让人读成后者（§8 明令"不显示空名单冒充结果"，导出面同一条口径要成立），所以 `reason:'no_rows'` 直接返回，界面提示先建档。代价：真要一份空表头的模板时导不出来，本期没有这个需求（§14）。
- **`null` 与 `[]` 必须分开**（Task 9 第 3 条的下游）：`exportRows` 返回 `null` 有两种——空名单（我们自己在 `exportPath` 挡的）与这一跳没成。界面拿到 `failed` 该说"取数没成，重试或看后端"，拿到 `no_rows` 该说"还没建档"。**归因**：`empty_keys` 那一格在 host 里先判（不让 `null` 的两个来源混进同一句文案）。
- **`MAX_EXPORT_GROUPS` 主进程再判一次**：界面按所选数量提前拦（spec §10），后端 `export-rows` 也 40016。三处判的不是同一件事——界面省一次 IPC、后端守租户配额、主进程挡住"拿 51 个群键去换一次 400 再报'取数没成'"这种把用户误导到重试死路上的诊断。主进程这一判的写法是 `chatKeys.length > MAX_EXPORT_GROUPS` → `too_many`，**不发请求**。
- **`chatKeys` 入参先剔非法再交给 api**：页内/渲染层来的数组是半可信的，`exportRows` 内部按裸逗号拼 query，一个含逗号的键会把一个键拆成两个（与 Task 9 的编码口径同源）。剔掉 `typeof !== 'string'`、空串、`> CHAT_KEY_MAX`、不含 `@` 的四类，并留一行日志说剔了几条。
- **中文标签表放 shared，不放 exporter**：`GroupMembersDialog` 的角色列与退出方式列要读同一份，两处各写一份就会出现"表格里叫『群主』、界面上叫『超管』"这种同一事实两个词的结果。未知取值回落成原词（`super` 之外的平台新值不许显示空白），`null` 给 `—`。
- **体积只量一次、不优化**（R23）：写完打一行 `bytes=`，Task 17 的验收文档记一个真实数字。本期不做列宽自适应、不做样式、不做多 sheet——每一项都是"没有需求支撑的实现面"（§14 的同一把尺）。
- **`exceljs` 必须只进主进程产物**（§15#4，本任务给出实测方法）：`electron-vite` 把 `dependencies` 里的包在主进程侧外部化，渲染层是 vite 打包，只要渲染层不 `import` 它就不会进包。取证用两条 grep（见 Step 6），**跑出来是"渲染产物里出现 exceljs"就是改口径的事**，要回来把这条改成"自己写最小 XLSX"或把导出挪到后端出文件，不许悄悄把 grep 删掉当通过。
- **安装 `exceljs` 属用户的手**（出网），且要 `pnpm`：`pnpm --filter @smartscrm/desktop add exceljs`。装完由本任务在 Step 5 里验证 `node --test` 能在纯 Node 下 import 它（CJS 包的默认导出互操作在这一档是唯一没量过的外部事实，跑不通就在测试里改 `import * as ExcelJS`，属实现细节不属口径变更）。

- [ ] **Step 1: 装依赖（用户的手）**

```bash
cd /d/SmartSCRM && pnpm --filter @smartscrm/desktop add exceljs
```
期望：`apps/desktop/package.json` 的 `dependencies` 多出 `exceljs`。这一步要出网，由用户执行；没装好之前 Step 3 之后的一切跑不动，也不许用「先写个假 exceljs」绕过——本任务的全部价值之一就是量到真实库的行为。

- [ ] **Step 2: shared 补标签与结果类型**

```ts
/** 导出结论六选一，界面按它给文案。`saved` 之外 `path` 一定是 null。 */
export type GroupExportReason = 'cancel' | 'empty_keys' | 'too_many' | 'no_rows' | 'failed' | 'saved'

export interface GroupExportResult {
  reason: GroupExportReason
  path: string | null
  rows: number
  bytes: number
}

/**
 * 角色与退出方式的中文词只在这里有一份：表格里叫「群主」而界面上叫「超管」
 * 是同一事实写了两个词的结果。未知取值回落原词（平台以后加新角色时导出不许留空白）。
 */
const GROUP_ROLE_LABEL: Record<string, string> = { member: '成员', admin: '管理员', super: '群主' }
const EXIT_METHOD_LABEL: Record<string, string> = {
  removed: '被移出',
  left: '自行退群',
  invited_join: '受邀加入',
  added: '被加入',
  join: '主动加入',
  snapshot_absent: '快照中已不在'
}

export function groupRoleLabel(role: string | null): string {
  if (role === null) return '—'
  return GROUP_ROLE_LABEL[role] ?? role
}

export function exitMethodLabel(method: string | null): string {
  if (method === null) return '—'
  return EXIT_METHOD_LABEL[method] ?? method
}

/**
 * 群成员这一路的所有时刻都是后端 `LocalDateTime` 序列化出来的墙钟串（不带 `Z`）。
 * 「`T` 换空格、截到秒」这一手**只有这一处作者**：导出表格（`exporter.ts`）与渲染层名单
 * （`renderer/src/lib/groupDisplay.ts`）都 import 它。两处各写一遍，就会出现"文件里到秒、
 * 界面里到毫秒"这种同一个读数两个样子的错——而它只会在这两个界面并排看时被发现的。
 * 不用 `new Date(s)`：JS 会把不带偏移的串按本地时区读，于是同一行在两台机器上显示两个时刻。
 */
export function formatExportTime(value: string | null): string {
  if (!value) return ''
  const iso = value.replace('T', ' ')
  // `2026-09-30 12:00:03.417` → 秒；长度不足（后端以后只给到分）就原样给回，不补零。
  return iso.length > 19 ? iso.slice(0, 19) : iso
}
```

（`formatExportTime` 放 shared 而不是 exporter，是因为渲染层也要用它：`exporter.ts` 在主进程侧、
`groupDisplay.ts` 在渲染层侧，两边都不许 import 对方，唯一能共处的地方就是 `shared/`。
渲染层引它走**相对路径 + `.ts` 后缀**（`../../../shared/groupMembers.ts`），理由见 Task 15 技术要点 10。）

- [ ] **Step 3: 先写失败的 exporter 单测**

```ts
// src/main/services/groupCollect/exporter.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Worksheet } from 'exceljs'
import {
  EXPORT_COLUMNS,
  formatExportTime,
  type GroupExportRowWire
} from '../../../shared/groupMembers.ts'
import { buildWorkbook } from './exporter.ts'

/**
 * 夹具的字段名逐字取 §A.2 ⑥（后端 `GroupExportRowVO` 的 14 个键）。
 * 这里**没有** `chatKey / memberKey / displayName / firstSeenAt / isInGroup`：群键叫 `groupId`，
 * 名称叫 `name`，角色叫 `role`，在群叫 `inGroup` 且**已经是后端格式化过的中文 `'是'|'否'`**。
 * 用旧名写夹具 = 测试跟着实现一起对不上后端（§A 那条"形状跟代码"的裁定在这里的落点）。
 */
const row = (over: Partial<GroupExportRowWire> = {}): GroupExportRowWire => ({
  seq: 1, groupName: '测试群', groupId: '12036@g.us', phone: '86138', name: null,
  role: 'member', inGroup: '是', joinAt: '2026-09-30T12:00:00', joinCount: 2,
  leaveAt: null, exitMethod: null, lastMsgAt: null, dayMsgCount: 0, msgCount: 0, ...over
})

/**
 * 读回第 n 行的值并收成字符串：断言走「这一格人看得见的是什么」，不走 workbook 的内部结构。
 * `String(v)` 这一手有判读力：日期被写成 Date 对象、缺值被写成 `undefined` 时，
 * 这里分别会在第三条与第六条用例上露出来。
 */
const cells = (ws: Worksheet, n: number): string[] =>
  ws.getRow(n).values.slice(1).map((v: unknown) => (v === undefined || v === null ? '' : String(v)))

/**
 * 本期只有一张 sheet，取 `worksheets[0]` 而不是按名查：`getWorksheet` 的返回带 `undefined`，
 * 每一处都要多一次判空，而"有没有第二张 sheet"这件事就由本文件写死。
 */
const sheet = (rows: GroupExportRowWire[]): Worksheet => buildWorkbook(rows).worksheets[0]

test('表头逐字等于 EXPORT_COLUMNS，顺序也没动', () => {
  assert.deepEqual(cells(sheet([row()]), 1), [...EXPORT_COLUMNS])
  assert.equal(EXPORT_COLUMNS.length, 14)
})

test('日期写成文本：T 换空格、截到秒，null 给空串而不是 null / —', () => {
  assert.equal(formatExportTime('2026-09-30T12:00:03.417'), '2026-09-30 12:00:03')
  assert.equal(formatExportTime('2026-09-30T12:00:00'), '2026-09-30 12:00:00')
  assert.equal(formatExportTime(null), '')
  assert.equal(formatExportTime(''), '')
  // 判别力：`new Date(s)` 那一派会把它变成时区相关的 Date 对象；这里必须还是文本。
  assert.equal(typeof formatExportTime('2026-09-30T12:00:00'), 'string')
})

test('角色取中文词、在群列逐字用后端给的字、快照推定那一格退群时间给 —', () => {
  const ws = sheet([
    row({ seq: 1, role: 'super' }),
    row({ seq: 2, role: 'member', inGroup: '否', exitMethod: 'snapshot_absent' }),
    row({ seq: 3, role: 'member', inGroup: '否', exitMethod: 'left', leaveAt: '2026-09-20T01:02:03' })
  ])
  assert.equal(cells(ws, 2)[5], '群主')
  // 「在群」这一列不许主进程再映射一次：后端 `GroupExportRowVO` 已经把 0/1 写成 `'是'/'否'`，
  // 这里再判断一回就是第二个作者——以后后端改成「在/不在」，文件会一列对不上。
  assert.equal(cells(ws, 2)[6], '是')
  assert.equal(cells(ws, 3)[6], '否')
  // §8 那一格的逐字形状：snapshot_absent 且 leaveAt 为空 ⇒ 时间 —、方式「快照中已不在」
  assert.equal(cells(ws, 3)[9], '—')
  assert.equal(cells(ws, 3)[10], '快照中已不在')
  assert.equal(cells(ws, 4)[9], '2026-09-20 01:02:03')
  assert.equal(cells(ws, 4)[10], '自行退群')
})

test('序号原样透传：后端给 5,6,1,2 就写 5,6,1,2（重算会写成 1,2,3,4）', () => {
  const ws = sheet([row({ seq: 5 }), row({ seq: 6 }), row({ seq: 1 }), row({ seq: 2 })])
  assert.deepEqual([2, 3, 4, 5].map((n) => cells(ws, n)[0]), ['5', '6', '1', '2'])
})

test('缺值不许写成 undefined / null 字样；群组名称与手机号给空串', () => {
  const c = cells(sheet([row({ name: null, phone: null, groupName: null })]), 2)
  assert.equal(c[1], '')
  assert.equal(c[3], '')
  assert.equal(c[4], '')
  assert.ok(!c.some((v) => v === 'undefined' || v === 'null'), `缺值被写成了字面量：${c.join('|')}`)
})

test('只有表头的那一份也能构造出来（host 的空判据不靠它落盘）', () => {
  assert.equal(sheet([]).rowCount, 1)
})
```

```bash
cd /d/SmartSCRM/apps/desktop && node --test src/main/services/groupCollect/exporter.test.ts
```
期望：FAIL（模块不存在）。

- [ ] **Step 4: 实现 exporter**

```ts
// src/main/services/groupCollect/exporter.ts
import ExcelJS from 'exceljs'
import {
  EXPORT_COLUMNS,
  exitMethodLabel,
  formatExportTime,
  groupRoleLabel,
  type GroupExportRowWire
} from '../../../shared/groupMembers'

/** 单元格取值：缺值一律空串，`序号` 与四个计数用数字。键名逐字取 §A.2 ⑥。 */
function cellOf(row: GroupExportRowWire, index: number): string | number {
  switch (index) {
    case 0: return row.seq ?? ''
    case 1: return row.groupName ?? ''
    case 2: return row.groupId
    case 3: return row.phone ?? ''
    case 4: return row.name ?? ''
    case 5: return groupRoleLabel(row.role)
    // 后端已经把 0/1 写成 `'是'|'否'`（§A.2 ⑥）。主进程再判断一次 = 同一个事实两个作者，
    // 以后后端换词，这一列会和界面各说一半。
    case 6: return row.inGroup ?? ''
    case 7: return formatExportTime(row.joinAt)
    case 8: return row.joinCount ?? 0
    // §8 那一格：`snapshot_absent` 的退群时间没有事件证据，留 `—` 而不是空白——
    // 空白在表格里读作"不知道"，而这里的事实是"有证据说人没了、没有证据说时间"。
    case 9: return row.leaveAt ? formatExportTime(row.leaveAt) : row.inGroup === '否' ? '—' : ''
    case 10: return row.inGroup === '否' ? exitMethodLabel(row.exitMethod) : ''
    case 11: return formatExportTime(row.lastMsgAt)
    case 12: return row.dayMsgCount ?? 0
    default: return row.msgCount ?? 0
  }
}

/**
 * 一份 sheet、14 列、纯文本 + 计数。列序取 `EXPORT_COLUMNS` 的字面顺序，
 * 这里不 `.sort()` 也不另列名——那份常量就是列序的唯一出处。
 */
export function buildWorkbook(rows: GroupExportRowWire[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('群成员')
  ws.addRow([...EXPORT_COLUMNS])
  for (const r of rows) ws.addRow(EXPORT_COLUMNS.map((_c, i) => cellOf(r, i)))
  ws.getRow(1).font = { bold: true }
  // 固定列宽：自适应要遍历全部单元格，而 50 群 × 几百人那一档的量正是我们不想付的。
  const widths = [6, 24, 26, 15, 20, 10, 8, 20, 8, 20, 14, 20, 12, 10]
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w
  })
  return wb
}
```

- [ ] **Step 5: host 的 `group:export` 那一支**

`host.ts` 顶部补 import：

```ts
import { dialog } from 'electron'
import { promises as fs } from 'node:fs'
import { CHAT_KEY_MAX, MAX_EXPORT_GROUPS, type GroupExportResult } from '../../../shared/groupMembers'
import { buildWorkbook } from './exporter'
```
（`fs` 走 `node:fs` 的 promise API：`electron` 导出的那个 `fs` 是 40 才有的，本项目锁在 `electron ^39`，
照记忆写会直接过不了 `typecheck:node`。）

`startGroupHost()` 里 `group:build` 之后加：

```ts
  ipcMain.handle('group:export', (_e, req: { accountId: number; chatKeys: string[] }) =>
    exportGroups(Number(req?.accountId), Array.isArray(req?.chatKeys) ? req.chatKeys : []))
```

模块作用域加：

```ts
/**
 * 半可信入参的四道剔非法：非字符串、空串、超长、形状不对。
 * `!k.includes(',')` 单列一条是必须的：`exportRows` 用裸逗号拼 query（Task 9），
 * 一个含逗号的键会被后端拆成两个键，静默导出两份不相干的数据。
 */
function sanitizeChatKeys(keys: string[]): { kept: string[]; dropped: number } {
  const kept = keys.filter(
    (k) => typeof k === 'string' && k.length > 0 && k.length <= CHAT_KEY_MAX && k.includes('@') && !k.includes(',')
  )
  return { kept, dropped: keys.length - kept.length }
}

async function exportGroups(accountId: number, rawKeys: string[]): Promise<GroupExportResult> {
  const none = (reason: GroupExportResult['reason']): GroupExportResult => ({ reason, path: null, rows: 0, bytes: 0 })
  if (!Number.isInteger(accountId) || accountId <= 0) {
    console.log(`[group] 导出入参不合格 account=${oneLine(String(accountId))}`)
    return none('failed')
  }
  const { kept, dropped } = sanitizeChatKeys(rawKeys)
  if (dropped > 0) console.log(`[group] 导出剔除非法群键 ${dropped} 条，留 ${kept.length} 条`)
  if (kept.length === 0) return none('empty_keys')
  // 主进程这一判不是为了省一跳，是为了不把"选了 51 个群"报成"取数没成"（三处判的分工见技术要点）。
  if (kept.length > MAX_EXPORT_GROUPS) return none('too_many')
  const rows = await api.exportRows(accountId, kept)
  // `null` = 这一跳没成（后端拒了 / 没起来），与"成了但 0 行"是两件事：文案与下一步动作都不同。
  if (!rows) return none('failed')
  if (rows.length === 0) return none('no_rows')
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return none('failed')
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
  const picked = await dialog.showSaveDialog(win, {
    title: '导出群成员',
    defaultPath: `群成员-${stamp}.xlsx`,
    filters: [{ name: 'Excel', extensions: ['xlsx'] }]
  })
  if (picked.canceled || !picked.filePath) return none('cancel')
  try {
    const buffer = await buildWorkbook(rows).xlsx.writeBuffer()
    await fs.writeFile(picked.filePath, Buffer.from(buffer))
    // 体积量一次（R23）：这一行是 §15#4 之外唯一能拿到"50 群 × 几百人有多大"的地方。
    console.log(`[group] 导出落盘 rows=${rows.length} bytes=${buffer.byteLength} path=${oneLine(picked.filePath, 260)}`)
    return { reason: 'saved', path: picked.filePath, rows: rows.length, bytes: buffer.byteLength }
  } catch (e) {
    // 写盘失败（目标被占用 / 只读目录 / 权限）：日志留原文，界面上只说"没写成"。
    console.warn('[group] 导出写盘失败', e)
    return none('failed')
  }
}
```

preload 的 `group` 命名空间里加一行，`shared` 的类型 import 补 `GroupExportResult`：

```ts
    export: (req: { accountId: number; chatKeys: string[] }): Promise<GroupExportResult | null> =>
      ipcRenderer.invoke('group:export', req),
```

- [ ] **Step 6: 跑绿 + 产物归属取证**

```bash
cd /d/SmartSCRM/apps/desktop
node --test src/main/services/groupCollect/exporter.test.ts 2>&1 | tail -20
pnpm run test:unit 2>&1 | tail -15
pnpm run typecheck:node && pnpm run typecheck:web && pnpm run typecheck:inject && pnpm run typecheck:unit
pnpm exec eslint src/main/services/groupCollect/exporter.ts src/main/services/groupCollect/exporter.test.ts src/main/services/groupCollect/host.ts src/preload/index.ts src/shared/groupMembers.ts --quiet
pnpm run build 2>&1 | tail -20
# §15#4 的取证：主进程产物里有（外部化的 require），渲染产物里没有（谁都没 import 它）
grep -l 'exceljs' out/main/*.js 2>/dev/null || echo 'MISS:main'
grep -l 'exceljs' out/renderer/assets/*.js 2>/dev/null && echo 'FAIL:渲染包出现了 exceljs' || echo 'OK:渲染包干净'
```
期望：exporter 6 条全过、`test:unit` 比 Task 11 收尾时多 6；四路 typecheck 过；`--quiet` 零输出；两条 grep 一条命中 `out/main/index.js`、另一条给 `OK:渲染包干净`。**第二条给 `FAIL` 时不许改 grep 的写法**——那是 §15#4 那条待验证项的答案，出现了就是要改口径（导出挪后端或自写最小 XLSX），按 R24 的方式回来裁定。

- [ ] **Step 7: 提交**

```bash
git add apps/desktop/src/main/services/groupCollect/exporter.ts apps/desktop/src/main/services/groupCollect/exporter.test.ts apps/desktop/src/main/services/groupCollect/host.ts apps/desktop/src/preload/index.ts apps/desktop/src/shared/groupMembers.ts apps/desktop/tsconfig.unit.json apps/desktop/package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(P8/群成员): 14 列 XLSX 导出——纯工作簿与落盘分两半

日期写成文本：不带时区标记的 LocalDateTime 交给 new Date 会按本地时区重读，
代价是那一列不参与 Excel 日期筛选，比读数差一小时轻。

序号原样透传后端的值、0 行不落盘、51 群在主进程就挡下：
三处都在防同一件事——把"还没建档 / 选太多"报成"取数没成"。

Co-Authored-By: Qoder <noreply@qoder.com>
EOF
)"
```

---

## Task 14: 契约腿校正与补漏——`tmp/p8-group-members-contract.mjs` + `tmp/P8Purge.java`

> **判档**：这一节是 §13 五档里的「HTTP 契约」档，跑出来的读数才算**实测**。它同时是 Task 8b 那八条在**真 MySQL** 上的证人——8b 的 Java 单测只证到 mock 的调用形状（`verify(...)` 收到了什么参数），而 `ISNULL(...)` 的 NULL 沉底、`LIKE` 的反斜杠转义、`DOUBLE` 列的读数、`INSERT IGNORE` 的 affected rows 这四件事，只有真库给答案。**8b 的注释里不许写"已验证行序"，本任务的日志才是它的下游证据。**
>
> **顺序硬约束**：本任务必须排在 **Task 8b 之后**跑。今天（8b 之前）跑草稿会得到两条红：`2.4 coverage===null`（现在是 `""`）与 `9.1 /customer/{id}/groups`（④ 之后 `accountId` 必填，现在不带也能过）。这两条**不许放宽**去迁就现状——§A.5 定的口径是"红格回 8b 修"。
>
> **本任务不碰页面、不发消息**：全程只打 `:8180` 的读写端点，数据全落在本轮自己造的群键上。真实登录档（§13 最后一档）不在这里。

**Files:**
- Modify: `tmp/p8-group-members-contract.mjs`（现有 267 行草稿；`tmp/` 已 gitignore，**永不进提交**）
- Create: `tmp/P8Purge.java`（清理探针，同样不进提交；形制照 `tmp/P6Tables.java` / `tmp/PurgeCredentials.java`）
- Modify: 本计划 §A.1（加一行契约腿读数）；spec §15 的 ②③ 若被本任务的读数部分回答，只记读数、不改口径（那两条要真机页内数据才能收口）

**Interfaces:**
- Consumes：§A.2 六跳的已提交形状 + Task 8b Produces 的四处变化——`data.coverage` 是 `number | null`、`GET /customer/{id}/groups` 的 `accountId` **必填**、`GET /groups` 的可选 `sort=stale`、导出超限 **40016** 且 `chatKeys` **去重早于计数**。以及 `PageResult` 的四键（`records/total/page/pageSize`）、`/api/auth/login`（`inviteCode/username/password/deviceId`，本地种子账号见 `DataSeeder.java:29`）、`GET /api/customers?platformType=1&page&pageSize` 的 `records[].{id,phone,platformType}`。
- Produces：没有源码接口（tmp 不进 git）。产出两份可引用的读数文件：`tmp/p8-contract.log`（逐条 check 名 + 期望/实际 + 末尾退出码）与 `tmp/p8-purge.log`（三表清理前后的行数 + affected rows）。Task 17 的验收文档直接抄这两份，**不接受"跑过了"这种无文件口的说法**。

**校正清单**（草稿那一格 → 改成；逐条有名，Step 里给代码）：

| # | 草稿现状（读码 `tmp/p8-group-members-contract.mjs`） | 改成 | 为什么这格必须动 |
|---|---|---|---|
| N1 | `0.1 服务活着` / `0.2 登录成功` 走 `ok()`，失败只 `fail++`，最后 `exit 1` | 前置档独立：health 拿不到 `code===0`、登录没过、`:8180` 拒绝连接 → `die(2, 原因)`；只有**断言**红才 `exit 1` | 「后端根本没起」与「产品行为坏了」是两个完全不同的结论。草稿会把环境问题报成 12 条产品失败，而 memory 里那条纪律就是为这个付过费的：断言必须区分「生效了」与「什么都没做」 |
| N2 | 注释承认「每跑一轮在库里留一批验证数据」 | 清理腿：`tmp/P8Purge.java` 按 `(account_id, chat_key IN 本轮两键)` 删三表，包在 `finally` 里，跑完复查 0 行（R44） | 残留不只占磁盘。同键复跑时 `participant_count` 已有值 → "首次建档"那条断言读到 `ok` 而不是 `first_build`，**验证数据会伪装成产品行为**。换 `RUN` 键只是把问题推迟，不是解决 |
| N3 | 只有一个群键 `GROUP_KEY` | 再加 `GROUP_KEY2`（只登记不快照），专门喂 `sort=stale` 那一腿 | ⑥ 的判据是「`last_snapshot_at IS NULL` 的排最前」，需要一个真未建档的群。用本轮已有的群做会与本任务的其它断言互相污染 |
| N4 | 2.4 `coverage === null` | 保留，并补 **2.4b `'coverage' in data`** | `undefined`（容器压根没这个键）与 `null`（有键、值就是空）在 `=== null` 上都为假，但含义完全不同：前者是容器换了形状，后者才是"没有分母" |
| N5 | 夹具 `phone: '+86138000...'`，落库形状无断言 | 补 **2.9**：`rows[0].phone === '861380000001'`（无 `+`），且夹具里放一个 `'+86 138 0000 0002'`（带空格）证明归一吃掉了空白 | ⑧ 归一这一半今天在库里是看不出来的：写原样、匹配用归一值，按号码那一路永远命中不上——只有把落库值钉成断言，改回来的那一拍才有证人 |
| N6 | 段 3 只断 `reconciled===false` 与「人没被误判退群」 | 补 **3.6** 闸读数入库（`lastCoverage≈0.4`、`lastReconcileReason==='coverage_too_low'`）、**3.7** `lastSnapshotAt` 与 `snapshotCount` 没被坏快照推进 | ③ 的两列是 §8 界面标注唯一的数据来源；R20 那三列（分母 / 时间戳 / 次数）不动是这条闸最贵的性质，而 8b 的 `markGate(...,at)` 带了一个 `at` 形参——一旦实现顺手把它写进 `last_snapshot_at`，只有真库读数能抓到 |
| N7 | 段 7 只断 `seq` 连续与 `groupId` 值 | 补 **7.5** 键集逐字等于那 14 个键名、**7.6** `inGroup ∈ {'是','否'}` 且本轮真退群的那人是 `'否'` | §A.2 ⑥ 那四处"与正文不同"里没有一条有证人。列名与"后端已格式化过中文"这两件事都是 Task 13 的 exporter 逐字依赖的，改了后端不改 exporter 就出现两份列名 |
| N8 | 段 9 的 `/customer/1/groups` 不带 `accountId`，且只断「不报错」 | 改成带 `accountId`，并新增段 11 造一次**真匹配**（客户号 → 成员 → 反查得到本轮群） | ④ 收窄之后"不报错"这条断言永远为真（400 也是响应）。要证明的是"收窄了仍然读得到该读的"与"跨账号的那一份读不到了" |
| N9 | 无搜索腿 | 新增段 10：**10.1** `q='%'` ⇒ 空名单、**10.2** `q='a%b'` ⇒ 只命中 displayName 里真含 `a%b` 的那一行、**10.3** `q` 只有全角空格 ⇒ 空名单 | ① 的整个效果（`SearchPattern` 的 `null` 契约 + 反斜杠转义）在 mock 单测里只能断"绑定值长这样"。真库里 `%%…%%` 会变成搜全表——那恰好是这条腿要抓的错法，而它只有 HTTP 档看得见 |
| N10 | 无行序腿 | **10.4**：名单第一页里，`latestJoinAt` 非空的行必须整体排在为空的行之前（真 MySQL 的 `ASC` 默认 NULL **最前**，② 改的就是这个默认） | ② 是本计划里唯一一条"数据库默认与产品口径相反"的修法，Mockito 证不了 `ORDER BY ISNULL(...)`；这一格不跑就等于没改 |
| N11 | 无导出上限/去重腿 | 新增段 12：**12.1** 51 个唯一键 ⇒ 40016、**12.2** `[G1,G1,G2]` ⇒ `code===0` 且行数 = 两群人数之和、**12.3** 只给一个 `@c.us` 键 ⇒ 40000 | ⑤ 三半各一条。特别是 12.2：不去重的实现会返回翻倍行数、`seq` 跟着双计，而"同一群勾两遍绕过 50 群上限"是 spec §10 明令拦住的那件事 |
| N12 | 无 `sort` 腿 | 新增段 13：**13.1** `sort=stale` 的第一行是 `GROUP_KEY2`（未建档），默认顺序的第一行是 `GROUP_KEY` | ⑥ 是 R28 那条"泵读位置不读日期串"的唯一来源；这一格红 = 泵的建档优先级会一直按页内顺序跑，看不出后端根本没排 |

**技术要点**

1. **前置探测当版本闸，但它在**本轮第一发首建之后**（Step 2 那段代码）**：判 `'lastCoverage' in (records[0] ?? {})`，拿不到就 `die(2, '后端不含 Task 8b 的 V13 读数')`。为什么不放在骨架里：这条读数是**按账号取一页群**，账号名下没有行时 `records[0]` 是 `undefined`，判据塌成 false——而清理腿（N2）每轮末尾就把本轮两键删干净了，于是"旧 jar"与"库还空着"会共用同一个 `die(2)`，那种红归不了因。为什么不先跑断言再看红：`LocalDateTime`/新列没进库时，症状是"一片红"，而真相是"你连的那个 jar 不是本构建"——这正是上一期踩过并记进 memory 的那类归因错（文件 mtime ≠ 库里的形状；Flyway 只在启动时跑）。**这一条把环境问题从产品失败里摘出来，比任何断言都值钱。** Task 17 的技术要点 13 ① 是同一条纪律的第二处应用。
2. **本轮的写动作只在两个群键上**。`chat_group` / `group_member_state` / `group_member_event` 三张表里，本任务只允许碰 `chat_key IN (GROUP_KEY, GROUP_KEY2)` 这两块地盘；`P8Purge` 的 `DELETE` 因此必须带 `account_id` 双条件，并在打印里给出三个 affected rows——**affected rows 为 0 也是失败**（说明本轮数据压根没进去，清理没跑成 ≠ 清理干净，两件事不许混报）。
3. **`RUN` 键的形态要像真群键**。`12036` + 9 位 + `@g.us` 是 `ChatKeys.isGroup` 认的形状；草稿这一格是对的，保留（`resolveAccount` 与 `isGroupKey` 都会拒非 `@g.us`，夹具一旦不像真键，段 2 就变成在测参数校验）。代价：真实 WhatsApp 群键是 18 位，我们的 14 位不会与真数据撞车——这是**故意的**，撞上了清理腿就会删掉不该删的行。
4. **断言一律读"实际落库的那一列"，不读响应的回声**。最典型的是覆盖率：POST 响应里的 `coverage` 是当场算的，`/groups` 里的 `lastCoverage` 才是写进去的——只断前者会漏掉"`markGate` 没被调用 / 调用时 SQL 没写列"这一整类失败（3.6 因此必须存在，且它读的是 ⑥ 那一份而不是 ① 那一份）。
5. **`DOUBLE` 的比较用差值不用等值**：`Math.abs(x - 0.4) < 1e-9`。8b 的技术要点里已经写明这一列会有浮点尾巴；用 `=== 0.4` 的断言一旦在某个 Java/MySQL 版本组合上红，会把一条口径改动误报成产品缺陷。
6. **"当日发言数"这一格本任务不测**。它锚定的是"该成员最近发言的那一天"，而自动化腿不许碰页面发送链（Global Constraints），库里造不出真消息。做法是**在日志里显式打印 `dayMsgCount` 与 `msgCount` 的实际值并注明"待真实登录档核对"**，把这一格留在"待验证"而不是用假数据冒充通过（§13 最后一档）。这一句要抄进 Task 17 的验收文档。
7. **退出码是判据的一部分**：`0` 全绿、`1` 断言红（产品）、`2` 前置不满足（环境/版本/凭据/账号平台不支持）。草稿只有 1/2 且用反了（凭据缺失是 2、登录失败是 1）。跑法与 P7 那两个驱动一致：`node tmp/p8-group-members-contract.mjs; echo "exit=$?"`，日志 `tee` 进 `tmp/`（后台任务的输出文件在 AppData 下我读不到，仓库内 `tmp/` 是唯一能引用的位置）。
8. **红格不许在本任务里修后端**。发现红就三选一：记进 §A.1（"8b 的第 N 条在真库里没生效"）→ 回 8b 修 → 重跑本任务；或者确认是**契约腿自己写错**（夹具、期望值），改这里要在提交正文里写明"改了判据的哪一半、判别力为什么还在"；第三种是这条断言本来就不该由 HTTP 档证（如 N6 的浮点尾巴），那把它降级成日志读数，不许静默删掉。

- [ ] **Step 1: 骨架改造（N1 + N3；版本闸的位置见 Step 2）**

文件头把退出码约定写进注释，并换成 `die()` / `check()` 两件套：

```js
// 退出码：0=全绿；1=断言红（产品）；2=前置不满足（服务没起 / 登录没过 / 后端 jar 不含 8b
//          / 本租户没有平台支持的账号 / 没有 platformType=1 且带 phone 的客户档）。
// 用法：SCRM_USER=admin SCRM_PASS=admin123 node tmp/p8-group-members-contract.mjs 2>&1 | tee tmp/p8-contract.log
//       （本地种子口令读码自 DataSeeder.java:29，不在脚本里新增秘密）
const die = (code, why) => { console.error(`前置不满足：${why}`); process.exit(code) }

function check(name, pass, expected, actual) {
  if (pass) { pass_++; console.log(`  PASS  ${name}`) }
  else { fail_++; failures.push(name); console.log(`  FAIL  ${name}  expect=${expected}  actual=${JSON.stringify(actual)?.slice(0, 220)}`) }
  return pass
}
```

`req()` 里把 `fetch` 的 reject 塌成 `{ code: -1 }`（照 `tmp/p7b-detail-ui.mjs:M1` 那条：后端不可达时裸 reject 会崩栈按 1 收，把环境问题的退出码判反）。**前置版本闸不在这一步**——它要读一行已存在的群，位置在 Step 2，理由见那里的注释与技术要点 1。

两个群键：

```js
const RUN = String(Date.now()).slice(-9)
const GROUP_KEY = `12036${RUN}@g.us`        // 本轮主战场：建档 + 闸 + 事件
const GROUP_KEY2 = `12036${RUN}9@g.us`      // 只登记不快照，专门给 sort=stale（N3）
const KEYS = [GROUP_KEY, GROUP_KEY2]
```

- [ ] **Step 2: 段 2 补断言（N4 + N5）+ 前置版本闸**

先在 `2.1` 那条之后（也就是**本轮第一发首建落库之后**）装版本闸，再往下写断言：

```js
// 前置版本闸（技术要点 1）。为什么不在骨架里：`GET /groups` 的 `accountId` 是必填参数
//（读码 `GroupMemberController.java:48-54`），而判 `GroupVO` 有没有 8b 那两列又必须**有一行群**
// 才读得出键名。清理腿（N2）每轮末尾会把本轮两键删干净，所以下一轮刚进来时那个账号名下很可能
// 一行都没有：`records[0]` 是 `undefined`，判据塌成 false，于是"旧 jar"和"还没写库"混成同一个
// `die(2)`——那种红归因不了，只能整跑重来。放在 2.1 之后，读的才是 jar 的形状而不是库的空。
const gateRow = (await call('GET', `/api/group-members/groups?accountId=${accountId}&page=1&size=1`, { token })).json?.data?.records?.[0]
if (!gateRow) die(2, '版本闸读不到任何群行：2.1 那一发首建没落库，先修写入再谈版本')
if (!('lastCoverage' in gateRow)) die(2, '后端不含 Task 8b 的 V13 读数（jar 是旧构建？）')
```

`2.4` 保留原判据，紧随其后补两格，并把 `first` 那一批的夹具改成"带 `+` 与带空格各一半"：

```js
check('2.4b coverage 键存在（区分 null 与"容器没这个键"）', 'coverage' in (first.json?.data ?? {}), '有键', Object.keys(first.json?.data ?? {}))
// N5：⑧ 的 phone 归一——写进去的必须是纯数字
const phoneRows = rows1.map((r) => r.phone)
check('2.9 phone 落库无 + 无空白（⑧ 归一生效）',
  phoneRows.every((p) => /^\d+$/.test(p ?? '')) && phoneRows[0] === '861380000001', '/^\\d+$/', phoneRows.slice(0, 3))
```

```js
// 夹具：1 号带 +，2 号带空格与连字符，两者都必须归一成同一形状
const participants = (from, count) =>
  Array.from({ length: count }, (_, i) => {
    const n = from + i
    const raw = n === 1 ? '+8613800000001' : n === 2 ? '+86 138-0000-0002' : `+86138000${String(n).padStart(4, '0')}`
    return { memberKey: mk(n), phone: raw, displayName: n === 3 ? '搜a%b的人' : `成员${n}`, roleType: n === 1 ? 'admin' : 'member' }
  })
```

（3 号那一行同时是 N9 的搜索夹具——`displayName` 里真含 `a%b`。）

- [ ] **Step 3: 段 3 补断言（N6，③ + R20 的真库读数）**

```js
const gs = await call('GET', `/api/group-members/groups?accountId=${accountId}&page=1&size=50`, { token })
const g1 = (gs.json?.data?.records ?? []).find((x) => x.chatKey === GROUP_KEY)
check('3.6 闸读数入库（V13 两列，界面唯一来源）',
  Math.abs((g1?.lastCoverage ?? -1) - 0.4) < 1e-9 && g1?.lastReconcileReason === 'coverage_too_low',
  '0.4 / coverage_too_low', { lastCoverage: g1?.lastCoverage, reason: g1?.lastReconcileReason })
check('3.7 坏快照没推进时间戳与次数（R20 三列一起挡）',
  g1?.lastSnapshotAt === beforeGateSnapshotAt && g1?.snapshotCount === beforeGateCount,
  { at: beforeGateSnapshotAt, count: beforeGateCount }, { at: g1?.lastSnapshotAt, count: g1?.snapshotCount })
```

`beforeGateSnapshotAt` / `beforeGateCount` 在段 2 结束、段 3 开始之前读一次（同一次 `/groups` 里就有），不许拿 POST 响应里的字段当"库里的值"——那是回声，不是落库。**这一格就是 `markGate(...,at)` 那个多余形参的守门人**：实现若把它写进 `last_snapshot_at`，3.7 必红，红格回 8b 删参数或删赋值。

- [ ] **Step 4: 段 10 —— 搜索与行序（N9 + N10，①② 的真库效果）**

```js
// 10.1 SearchPattern 的 null 契约：只含通配符的词按"不搜"处理，返回空名单而不是全表
const wild = await call('GET', memberUrl({ q: '%' }), { token })
check('10.1 q="%" 不搜全表（① 的 null 契约）', (wild.json?.data?.members?.records ?? []).length === 0,
  '0 行', `${(wild.json?.data?.members?.records ?? []).length} 行 / total=${wild.json?.data?.members?.total}`)

// 10.2 字面量 % 要搜得到：转义没生效时这里会命中全表（10 人）而不是 1 人
const lit = await call('GET', memberUrl({ q: 'a%b' }), { token })
const litRows = lit.json?.data?.members?.records ?? []
check('10.2 q="a%b" 只命中真含 a%b 的那一行（反斜杠转义生效）',
  litRows.length === 1 && litRows[0].displayName === '搜a%b的人', 1, litRows.map((r) => r.displayName))

// 10.3 全角空格：strip() 用错成 trim() 时这里会命中全表
const full = await call('GET', memberUrl({ q: '\u3000' }), { token })
check('10.3 全角空格按空白处理（strip 而非 trim）', (full.json?.data?.members?.records ?? []).length === 0,
  '0 行', `${(full.json?.data?.members?.records ?? []).length} 行`)

// 10.4 NULL 沉底：② 改的就是 MySQL ASC 的默认（NULL 最前）
const page = await call('GET', memberUrl({ page: 1, size: 50 }), { token })
const ordered = page.json?.data?.members?.records ?? []
const lastNonNull = ordered.reduce((acc, r, i) => (r.latestJoinAt != null ? i : acc), -1)
const firstNull = ordered.findIndex((r) => r.latestJoinAt == null)
check('10.4 名单里 latestJoinAt 为 NULL 的整体沉到非空之后（② 真库生效）',
  firstNull === -1 || lastNonNull === -1 || firstNull > lastNonNull,
  'NULL 行索引 > 非空行索引', { firstNull, lastNonNull, n: ordered.length })
```

`memberUrl(extra)` 是本任务新加的小函数，把重复的六次 `?accountId=&chatKey=&page=&size=` 拼法收成一处（`encodeURIComponent` 一个都不许漏——`chatKey` 里的 `@` 与 `q` 里的 `%` 都是要编的）：

```js
const memberUrl = (extra = {}) => {
  const p = new URLSearchParams({ accountId: String(accountId), chatKey: GROUP_KEY, page: '1', size: '50' })
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  return `/api/group-members/group/members?${p}`
}
```

- [ ] **Step 5: 段 11 —— 账号收窄与客户匹配（N8，④ + ⑧ 的另一半）**

先用 HTTP 找一个**本租户内**可当夹具的客户（`platformType===1` 且 `phone` digits ≥ 7）：

```js
const custs = await call('GET', '/api/customers?platformType=1&page=1&pageSize=50', { token })
const cust = (custs.json?.data?.records ?? [])
  .find((c) => /^\d{7,}$/.test(String(c.phone ?? '').replace(/\D/g, '')))
if (!cust) die(2, '本租户没有 platformType=1 且带 phone 的客户档——④ 与 ⑧ 的匹配腿做不了')
const custDigits = String(cust.phone).replace(/\D/g, '')
```

再报一批带这个号码的快照，然后用**带 `accountId`** 的反查读回来：

```js
await call('POST', '/api/group-members/batch', {
  token,
  body: { accountId, snapshot: { chatKey: GROUP_KEY,
    participants: [{ memberKey: `${custDigits}@c.us`, phone: `+${custDigits}`, displayName: '客户夹具', roleType: 'member' }] } }
})
const withAcct = await call('GET', `/api/group-members/customer/${cust.id}/groups?accountId=${accountId}`, { token })
check('11.1 反查带 accountId 读得到本轮群（④ 收窄后仍可用）',
  (withAcct.json?.data ?? []).some((g) => g.chatKey === GROUP_KEY), '含本轮 GROUP_KEY', (withAcct.json?.data ?? []).map((g) => g.chatKey))
const row = (await call('GET', memberUrl({ q: '客户夹具' }), { token })).json?.data?.members?.records?.[0]
check('11.2 成员行按号码挂上客户（⑧ 的归一在这里闭环）', row?.customerId === cust.id, cust.id, row?.customerId)
const badAcct = await call('GET', `/api/group-members/customer/${cust.id}/groups`, { token })
check('11.3 不带 accountId 的反查被拒（④ 的必填是真必填）', badAcct.status === 400 || badAcct.json?.code !== 0,
  '400 或非 0 code', { status: badAcct.status, code: badAcct.json?.code })
```

**11.2 是这条链上唯一能把 ⑧ 的两半接起来的断言**：入库不归一 → 按号码匹配不上（NULL）；匹配用原样比 → 带 `+` 的入参与不带 `+` 的客户档永远不等。两种失败都表现为 `customerId` 为空，而 11.1/11.3 都还是绿的——所以这一格不许省。

- [ ] **Step 6: 段 12 —— 导出键面与上限（N7 + N11，⑤ 的三半）**

```js
const EXPORT_KEYS = ['seq','groupName','groupId','phone','name','role','inGroup','joinAt',
  'joinCount','leaveAt','exitMethod','lastMsgAt','dayMsgCount','msgCount']   // §A.2 ⑥ 逐字

// 7.5 / 7.6 打在已有的那次 export 上
check('7.5 导出键集逐字等于那 14 个键（§A.2 ⑥）',
  expRows.length > 0 && JSON.stringify(Object.keys(expRows[0]).sort()) === JSON.stringify([...EXPORT_KEYS].sort()),
  EXPORT_KEYS.length, expRows[0] ? Object.keys(expRows[0]).length : '无行')
check('7.6 inGroup 已是中文且退群那个人是「否」（后端格式化过，主进程不许再映射）',
  expRows.every((r) => r.inGroup === '是' || r.inGroup === '否') &&
  expRows.filter((r) => r.name === '客户夹具').every((r) => r.inGroup === '是'),
  "'是'|'否'", [...new Set(expRows.map((r) => r.inGroup))])

// 12.1 51 个唯一键 → 40016
const fiftyOne = Array.from({ length: 51 }, (_, i) => `12036000000000${String(i).padStart(2, '0')}@g.us`)
const over = await call('GET', `/api/group-members/group/members/export-rows?accountId=${accountId}&chatKeys=${encodeURIComponent(fiftyOne.join(','))}`, { token })
check('12.1 去重后仍 51 群 → 40016（不是 40000）', over.json?.code === 40016, 40016, over.json?.code)

// 12.2 同一群写两遍：不翻倍
const dup = await call('GET', `/api/group-members/group/members/export-rows?accountId=${accountId}&chatKeys=${encodeURIComponent([GROUP_KEY, GROUP_KEY, GROUP_KEY2].join(','))}`, { token })
const single = await call('GET', `/api/group-members/group/members/export-rows?accountId=${accountId}&chatKeys=${encodeURIComponent(GROUP_KEY)}`, { token })
check('12.2 群键重复不翻倍行数，且 50 上限按去重后算',
  dup.json?.code === 0 && (dup.json?.data ?? []).length === (single.json?.data ?? []).length,
  (single.json?.data ?? []).length, (dup.json?.data ?? []).length)

// 12.3 非群键被剔干净 → 40000
const notGroup = await call('GET', `/api/group-members/group/members/export-rows?accountId=${accountId}&chatKeys=${encodeURIComponent(`${custDigits}@c.us`)}`, { token })
check('12.3 只给单聊键 → 剔完为空 → 40000（不是 0 行成功）', notGroup.json?.code === 40000, 40000, notGroup.json?.code)
```

- [ ] **Step 7: 段 13 —— `sort=stale`（N12，⑥）**

```js
// GROUP_KEY2 只登记、从没成功快照 → stale 那一路必须排最前
await call('POST', '/api/group-members/batch', { token, body: { accountId, groups: [{ chatKey: GROUP_KEY2, title: '契约验证群B' }] } })
const stale = await call('GET', `/api/group-members/groups?accountId=${accountId}&page=1&size=50&sort=stale`, { token })
const staleRows = (stale.json?.data?.records ?? []).filter((g) => KEYS.includes(g.chatKey))
const plain = await call('GET', `/api/group-members/groups?accountId=${accountId}&page=1&size=50`, { token })
const plainRows = (plain.json?.data?.records ?? []).filter((g) => KEYS.includes(g.chatKey))
check('13.1 sort=stale 把未建档的排在本轮两键之前，默认顺序仍是它之后（⑥）',
  staleRows[0]?.chatKey === GROUP_KEY2 && plainRows[0]?.chatKey === GROUP_KEY,
  { stale: GROUP_KEY2, plain: GROUP_KEY }, { stale: staleRows.map((g) => g.chatKey), plain: plainRows.map((g) => g.chatKey) })
```

**两条顺序反了就是红**：后端 SQL 里 `ISNULL(last_snapshot_at)` 与 `DESC` 配错、或者 `sort` 参数压根没接（Spring 忽略未声明参数 ⇒ 两趟返回同一份顺序），这份断言都抓得到——后者尤其：不比较两趟的差异而只断 `staleRows[0]`，参数没接上时可能碰巧通过。

- [ ] **Step 8: 段 8 补一格（空快照不许抹掉上一轮读数）**

```js
check('8.2 纯空快照这一批既不写分母也不写读数（③ 的"没带可用快照两种都不写"）',
  emptySnap.json?.data?.coverage === null && gAfterEmpty?.lastReconcileReason === 'coverage_too_low',
  { coverage: null, reason: 'coverage_too_low（上一轮的）' },
  { coverage: emptySnap.json?.data?.coverage, reason: gAfterEmpty?.lastReconcileReason })
```

`gAfterEmpty` 在 8.1 之后重新读一次 `/groups`。这一格守的是 8b 技术要点里那句"一次纯事件上报不该把上一轮的好结果抹成 `no_snapshot`"——症状是界面上"本次未做退群判定"的标注突然消失，而实际上什么也没重算。

- [ ] **Step 9: 清理腿（N2，R44）——`tmp/P8Purge.java`**

```java
// tmp/P8Purge.java —— 契约腿的收尾清理。只删本轮自己造的两个群键（account_id 双条件），
// affected rows 为 0 视为失败：那说明数据根本没进去，"清理没跑成"不能报成"清理干净"。
import java.sql.*;

public class P8Purge {
    public static void main(String[] a) throws Exception {
        long accountId = Long.parseLong(a[0]);
        String url = "jdbc:mysql://localhost:3306/smartscrm_react?useSSL=false&allowPublicKeyRetrieval=true";
        try (Connection c = DriverManager.getConnection(url, "root", "1234560")) {
            for (String sql : new String[] {
                "DELETE FROM group_member_event  WHERE account_id = ? AND chat_key IN (?, ?)",
                "DELETE FROM group_member_state  WHERE account_id = ? AND chat_key IN (?, ?)",
                "DELETE FROM chat_group          WHERE account_id = ? AND chat_key IN (?, ?)" }) {
                try (PreparedStatement ps = c.prepareStatement(sql)) {
                    ps.setLong(1, accountId); ps.setString(2, a[1]); ps.setString(3, a[2]);
                    int n = ps.executeUpdate();
                    System.out.println(sql.split(" ")[2] + " deleted=" + n);
                    if (n == 0) { System.out.println("WARN 这一张表本轮没有行（数据没写进去？清理没跑成 ≠ 清理干净）"); }
                }
            }
            // 复查：区分"删了"与"什么都没做"
            try (Statement s = c.createStatement(); ResultSet r = s.executeQuery(
                "SELECT COUNT(*) FROM chat_group WHERE account_id = " + accountId + " AND chat_key IN ('" + a[1] + "','" + a[2] + "')")) {
                r.next();
                System.out.println("residual chat_group=" + r.getInt(1));
                if (r.getInt(1) != 0) System.exit(1);
            }
        }
    }
}
```

```bash
export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18"
set -o pipefail
cd /d/SmartSCRM
java -cp "$HOME/.m2/repository/com/mysql/mysql-connector-j/9.1.0/mysql-connector-j-9.1.0.jar" \
  tmp/P8Purge.java "$ACCOUNT_ID" "$GROUP_KEY" "$GROUP_KEY2" 2>&1 | tee tmp/p8-purge.log
```

jar 版本号以 `~/.m2/repository/com/mysql/mysql-connector-j/` 下实际目录为准（`tmp/P6Tables.java` 那一格早就这么写的）。驱动里把这条挂在 `finally`：`ACCOUNT_ID` 与两个群键在段 1/段 2 就已知，**任何退出路径**（断言红、`die(2)`、`main()` 抛错）都要先冲一遍清理再退出；清理失败只打日志不改主退出码（否则产品失败会被清理噪声盖掉），但 `tmp/p8-purge.log` 里的 `deleted=0` 必须在验收文档里点名。

- [ ] **Step 10: 跑一遍并留日志**

```bash
cd /d/SmartSCRM
powershell -NoProfile -ExecutionPolicy Bypass -File tmp/p7b-kill8180.ps1
cd apps/server && ./mvnw -DskipTests package 2>&1 | tail -5
cd /d/SmartSCRM && (java -jar apps/server/target/*.jar > tmp/p8-server.log 2>&1 &)
for i in $(seq 1 60); do curl -sf http://localhost:8180/api/health >/dev/null && break; sleep 1; done
cd /d/SmartSCRM
SCRM_USER=admin SCRM_PASS=admin123 node tmp/p8-group-members-contract.mjs 2>&1 | tee tmp/p8-contract.log
echo "exit=$?"
```

期望：`exit=0`，日志末尾「通过 N / 失败 0」，**N 必须等于脚本里 `check(` 的调用条数**（跑之前 `grep -c "^check(\|  check(" tmp/p8-group-members-contract.mjs` 数一遍，把那个数抄进验收文档当分母）。按本任务的清单推：磁盘上那份草稿有 **34** 条编号断言（`0.1` 到 `9.1`，实测 `grep -oE "ok\('[0-9]"` 得 34），N1 把其中四条改判成前置（`0.1 服务活着`、`0.2 登录成功`、`0.3 拿到 access token`、`1.2 找到可用于群成员采集的账号`——`die(2)` 的口径，不再记账；`1.1 拿到账号列表` 留着，它证的是端点本身可读），Step 2–7 新增 **18** 条（`2.4b 2.9 3.6 3.7 7.5 7.6 8.2 10.1 10.2 10.3 10.4 11.1 11.2 11.3 12.1 12.2 12.3 13.1`）⇒ **34 − 4 + 18 = 48**。分母对不上就是有一条腿没被记账（写漏了或中途抛错），这条纪律与 Task 17 的 `x+y=20` 同源；跑出来的实际数与 48 不符时，以脚本里的 `check(` 数为准并在提交正文里写明差在哪几条。**先记退出码再读日志**：`tee` 之后的 `echo $?` 拿的是 `tee` 的码，这一格要判红必须让脚本自己 `process.exit`，或改用 `node ... 2>&1 | tee tmp/p8-contract.log; exit ${PIPESTATUS[0]}`（`set -o pipefail` 已在 shell 里开着，两种写法任选其一，但**必须**有一种——否则"驱动红了但流水线绿了"这条最像成功的失败会被读成通过）。

- [ ] **Step 11: 红格归因，然后才谈修**

每条红按三选一走（技术要点 8）：回 8b 改代码 → 改判据（写明判别力为什么还在）→ 降级成日志。任何"改判据"都要在本节末尾追加一行记录，不许只留在会话里。

- [ ] **Step 12: 文档同步 + 提交**

- 本计划 §A.1：契约腿那一行从"未跑"改成"实测：`tmp/p8-contract.log` 全绿（尾行分母 = 脚本里的 `check(` 数，推定 48）/ 退出码 0 / 清理后 `residual chat_group=0`"。
- spec §15：②③ 那两格各追加一句本次读数（**只记读数，不改口径**——这两条要真机 `getAllGroups()` / `getParticipants()` 的数据才能收口，本地 HTTP 夹具证明不了它们）。
- 提交只含 `docs/`：`tmp/` 下的驱动与日志永不进 git（Global Constraints）。

```bash
cd /d/SmartSCRM && git status --short
git add docs/superpowers/plans/2026-09-30-group-member-analysis.md docs/superpowers/specs/2026-09-30-group-member-analysis-design.md
git commit -m "$(cat <<'EOF'
update(P8/B6): 契约腿按 as-built 校正并补八条语义的真库证腿

12 条校正（N1-N12）：退出码档、版本闸、清理腿；coverage 落库、phone 归一、
NULL 沉底、LIKE 转义、40016 与去重、sort=stale 各一条真 MySQL 断言。
EOF
)"
```

提交前确认 `git status --short` 里没有 `tmp/`、没有 `apps/desktop/tsconfig.node.tsbuildinfo`、没有 `docs/notes/2026-09-22-legacy-feature-gap.md`。

---

---

## Task 15: 渲染层数据层 `api/groupMembers.ts` + `components/ui/tabs.tsx` + §8 文案纯函数

> **判档**：`pnpm run typecheck`（四路）+ `test:unit`（本任务给 `groupDisplay` 补 7 条 test / 21 个断言）+ `pnpm run build`。**本任务不声称界面可用**——hooks 与真后端对不上、tab 切换不渲染，都是 Task 16 装配完 + Task 17 的 CDP 腿才结的事。
>
> 本任务不碰页、不碰主进程，只动渲染层与一个 `ui` 原子件。

**Files:**
- Create: `apps/desktop/src/renderer/src/api/groupMembers.ts`
- Create: `apps/desktop/src/renderer/src/components/ui/tabs.tsx`
- Create: `apps/desktop/src/renderer/src/lib/groupDisplay.ts`
- Create: `apps/desktop/src/renderer/src/lib/groupDisplay.test.ts`
- Modify: `apps/desktop/src/renderer/src/api/messages.ts:149`（`const qs` → `export const qs`，只加一个词）
- Modify: `apps/desktop/tsconfig.unit.json`（`include` 补 `groupDisplay.ts` / `groupDisplay.test.ts` 两行）
- Modify: `docs/superpowers/specs/2026-09-30-group-member-analysis-design.md` §9 的 `group:state` 那一句（改口，见技术要点 7）

**Interfaces:**
- Consumes：`http`（`lib/http.ts`：`code !== 0 ⇒ ApiError`，401 自动刷一次）、`PageResult` 的四键（`records/total/page/pageSize`）、§A.2 六跳的线形 + Task 8b Produces 的四处变化（`coverage: number | null`、`customerGroups` 必填 `accountId`、`GroupVO` 末尾两键、`sort` 界面**不传**）、shared 的 `CoverageReason` / `GroupMemberRole` / `GroupEventType` / `GroupEventSource` / `GroupBuildOutcome` / `GroupStateEvent` / `GroupExportResult` / `groupRoleLabel` / `exitMethodLabel` / `MAX_EXPORT_GROUPS`（全部 `import type` 或值导入皆来自 `@shared/groupMembers`，Task 2/9/12/13 已交付）、`window.scrm?.group.{build,onState,export}`（Task 12/13 的 preload 面）、`useAccounts()` / `useSelectionStore()`（`stores/accounts.ts`）。
- Produces（Task 16 的两个组件只认这一份名字表）：

```ts
// api/groupMembers.ts
export interface GroupRowVO {
  chatKey: string; title: string | null; platform: string
  participantCount: number; snapshotCount: number; inGroupCount: number
  lastSnapshotAt: string | null; lastEventAt: string | null; isFinal: boolean
  lastCoverage: number | null; lastReconcileReason: string | null
}
export interface GroupMemberRowVO {
  chatKey: string; memberKey: string; phone: string | null; displayName: string | null
  roleType: GroupMemberRole; isInGroup: boolean; joinCount: number
  latestJoinAt: string | null; latestLeaveAt: string | null; exitMethod: string | null
  firstSeenAt: string | null; lastEventAt: string | null; snapshotSeenCount: number
  customerId: number | null; lastMsgAt: string | null; dayMsgCount: number | null; msgCount: number | null
}
export interface GroupEventRowVO {
  id: number; chatKey: string; groupTitle: string | null; memberKey: string | null
  actorKey: string | null; actorName: string | null; eventType: GroupEventType
  occurredAt: string; source: GroupEventSource; rawType: string | null
  rawSubtype: string | null; bodySnapshot: string | null
}
export interface MemberPageVO { members: PageResult<GroupMemberRowVO>; coverage: number | null; reason: CoverageReason }
export interface MemberFilters { isInGroup?: boolean; role?: GroupMemberRole | ''; q?: string; page?: number }
export const GROUP_MEMBER_PAGE_SIZE = 50
export const GROUP_EVENT_PAGE_SIZE = 30
export const groupKeys = {
  root: ['group'] as const,
  members: (accountId: number | null, chatKey: string, f: MemberFilters) => ['group', 'members', accountId, chatKey, f] as const,
  events: (accountId: number | null, chatKey: string, eventType: string | '', page: number) => ['group', 'events', accountId, chatKey, eventType, page] as const,
  customerGroups: (accountId: number | null, customerId: number | null) => ['group', 'customer-groups', accountId, customerId] as const
}
export function useGroupMembers(accountId: number | null, chatKey: string, filters: MemberFilters)
export function useGroupEvents(accountId: number | null, chatKey: string, eventType: string | '', page = 1)
export function useCustomerGroups(accountId: number | null, customerId: number | null)
export function useGroupBuild(): { build: (req: { accountId: number; chatKey?: string }) => void; pending: boolean; outcome: GroupBuildOutcome | null }
export function useGroupExport(): { exportRows: (req: { accountId: number; chatKeys: string[] }) => void; pending: boolean; result: GroupExportResult | null }
export function useGroupStateInvalidation(): void   // 挂在 AppLayout：settled ⇒ invalidate(['group'])
// lib/groupDisplay.ts
export function shortfallPercent(coverage: number): number
export function gateNote(reason: string | null, coverage: number | null): string | null
export function memberAreaState(row: { platform: string; snapshotCount: number }): 'unavailable' | 'never_built' | 'built'
export function joinTimeCopy(row: { latestJoinAt: string | null }): string
export function exitCell(row: { isInGroup: boolean; exitMethod: string | null; latestLeaveAt: string | null }): { time: string; method: string }
export function firstSeenCopy(firstSeenAt: string | null): string
// components/ui/tabs.tsx
export { Tabs, TabsList, TabsTrigger, TabsContent, TabsIndicator }
```

> **`GET /groups` 这一支在本期不导出 hook**：它的读者是建档泵（Task 9 的 `api.ts`）与 Task 14 的契约腿，
> 渲染层没有"选群去操作"的面（spec §14 明列「群运营阶段的选群界面」不做），所以数据层里不放一个
> 没有消费者的 `useGroups`。将来 B9/B10 要选群面时再补，那时候它会有真实的调用方。

- `api/groupMembers.ts` 之外**不许有第二个取数出口**：Task 16 的两个组件只调上面这些 hook，不许在组件里裸 `http.get('/api/group-members/…')`。理由与消息面同一条：查询键散到组件里，就会出现"两处形状不同 → 两份永不刷新的缓存"（`messages.ts:159-175` 那段注释买来的教训）。

**技术要点**

1. **`qs` 从 `messages.ts` 导出，不在本节再写一份**：这是"逐字复制一个逻辑块"那一类缺陷，评审会点。改动只有 `export` 一个词，无行为变化，提交正文里点名它动了 P6 已交付文件。
2. **`isInGroup=false` 必须留在查询串里**（读码 `messages.ts:151-153`：`qs` 丢的是 `undefined`/`null`/`''`，`false` 留下）。所以"只看已退群的人"传 `isInGroup: false` 是对的；**"全部"档必须传 `undefined`，不许传 `''`**——`''` 会被丢掉（看起来一样），但 `false` 与 `''` 在类型上是两件事，混用会让人以为空串是"全部"的编码。`MemberFilters.isInGroup` 的类型就是 `boolean | undefined`，没有第三种。
3. **查询键把 `size` 算进去**：本层的 `size` 不从 `filters` 里取，而是钉成常量（`GROUP_MEMBER_PAGE_SIZE = 50`）并作为 `groupKeys.members` 的隐含维度（`f` 里带 `page`，`size` 由 hook 自己拼 URL）。为什么钉死：`messages.ts:159-163` 那条注释写得很清楚——两处数字一旦不同，订阅的就是另一份永不刷新的缓存，而表现是一行报错都没有。弹层只有一个调用方，钉死比开放更便宜。
4. **`coverage` 在本层只透传 `number | null`，格式化归 `groupDisplay`**：`Double` 列会带浮点尾巴（0.9333333333333333，Task 8b 技术要点里已经写明），把 `.toFixed(1)` 写在 hook 里就等于"读数被取数层改过"，下游再格式化一次就成了二次近似。文案计算是纯函数，所以它进 `lib/`，所以它能进 unit 闸门——这是本节唯一可自动验证的显示面。
5. **不发明"新鲜度阈值"**：spec §11 第 3 条要求读 `state` 前先判 `last_snapshot_at` 的新鲜度，但没有任何一份文档给过"N 小时算旧"。所以 `memberAreaState` 只分三档（非 WhatsApp / `snapshotCount===0` / 其余），弹层顶部**显示时间戳本身**而不是"过期/未过期"的判断词，§14 又明令不做定时重拉——重拉的入口只有顶栏那颗「刷新成员」。代价：用户要自己看时间判断新旧；换来的是界面上没有一个我编的数字。
6. **`useGroupBuild` 的 `pending` 来自本地 mutation，不来自广播**：`window.scrm.group.build()` 的 promise 在整轮跑完才回（Task 12 的 `invoke`），而广播 `running`/`settled` 是扇出的第二个信号。两个都用会导致"按钮点了没反应"与"按钮一直灰"两种相反的错法。**这里选 mutation 作按钮态**（它是这一次点击的回执，归因清楚），广播只用作**缓存失效**与"别的入口也在跑"的灰态提示（`phase==='running'` 那一格，Task 12 技术要点里就是为它准备的）。
7. **`group:state` 不携带"某个群来了新事件"这一层信息**，所以 spec §9 那句「`group_event` 入库后主进程广播一条 `group:state`，成员面开着就刷」在本期**做不到**：Task 12 的 `GroupStateEvent` 是**每轮建档**的 `running`/`settled`（`shared/groupMembers.ts`，已定形状），攒批器每 2s 冲一趟（Task 10 的 `EVENT_BATCH_INTERVAL_MS`），把每一次冲趟都广播一遍会变成"每 2 秒全片失效一次"的轮询风暴。**改口径而不是改代码**：本任务把 spec §9 那一句改成「建档结清时广播 `group:state`，成员面据此失效缓存；实时事件只落库，界面靠顶栏「刷新成员」按需重读」，并记进 §13 的验收档。**这是本任务里唯一一处改 spec，动的是数据到达时的可见性承诺，必须在提交正文里写清。**
8. **`tabs.tsx` 用 Radix 而不是两个按钮**：spec §9 已经取了前者（后续报表阶段同样要 tab）。形制照 `dialog.tsx`：`import { Tabs as TabsPrimitive } from "radix-ui"`（聚合包，成员是 `.Root/.List/.Trigger/.Content/.Indicator`，读码 `dialog.tsx:4,11-18`）、每个件带 `data-slot`、props 类型用 `React.ComponentProps<typeof TabsPrimitive.X>`。**没有 `tabs.tsx` 的现在**是实测的（`components/ui/` 下 12 个文件里没有它）。
9. **`DialogContent` 已经把浮层计数挂好了**（读码 `dialog.tsx:49-70` 的 `beginOverlay/endOverlay`）：Task 16 的弹层**不许**再调 `beginOverlay`，否则内嵌平台视图会让位两次、归位时留下一个永不移除的 `pointer-events:none`——那是 CDP 腿里 exit 4 那一档污染的来源。
10. **`groupDisplay.ts` 里凡是运行时要用（不是只用类型）的 shared 值，一律走相对路径 + `.ts` 后缀**：`import { exitMethodLabel, formatExportTime } from '../../../shared/groupMembers.ts'`。原因是这个文件同时活在两个世界——`pnpm run typecheck` 认 `@shared/*` 别名，`node --test`（本任务的 7 条单测靠它）**不认**别名。现成的先例是 `lib/chatDays.ts:4`（`from '../../../shared/chatTime.ts'`），`tsconfig.web.json:15` 与 `tsconfig.unit.json` 都开了 `allowImportingTsExtensions`，所以这一条路径两边都走得通。**只用类型的** import 可以留别名（编译后被擦除，运行时不需要解析）。
11. **中文词与时间文本各只有一处作者（R46）**：退群方式「快照中已不在 / 自行退群 / 被移出」由 shared 的 `exitMethodLabel` 给（Task 13 交付），`'T'` 换空格截到秒由 shared 的 `formatExportTime` 给（Task 13 交付，Task 15 引它）。`groupDisplay.ts` 只做"这一格该不该出话、出的是时间还是 `—`"，**不许**再写第二张 `EXIT_METHOD` 表、也不许自己 `.replace('T',' ')`。理由：导出文件与弹层是同一份读数的两个出口，两处各写一遍就会在"文件到秒、界面到毫秒"这种 nobody-looks-here 的缝里错开（Task 13 技术要点第 9 条同一条顾虑的下游）。

- [ ] **Step 1: 导出 `qs`**

`apps/desktop/src/renderer/src/api/messages.ts:149`：

```ts
/** 查询串组装。渲染层只有一份：`groupMembers.ts` 也用它（键的形状要与这里一致，两份各写就会各漏一个空值判断）。 */
export const qs = (input: Record<string, unknown>): string => {
```

- [ ] **Step 2: `tabs.tsx`**

```tsx
import * as React from "react"
import { cn } from "cn"
import { Tabs as TabsPrimitive } from "radix-ui"

// 形状与 dialog.tsx 同一家族：data-slot 给样式与 CDP 腿当锚点，props 类型从 primitive 反推，不自己写一遍。
// 群成员弹层的两个 tab（名单 / 流水）用它；报表阶段（B8）同样要 tab，所以这是第一个 ui 原子件而不是内联按钮组。
function Tabs({ ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" {...props} />
}
function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn("inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground", className)}
      {...props}
    />
  )
}
function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow",
        className
      )}
      {...props}
    />
  )
}
function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn("outline-none", className)} {...props} />
}
function TabsIndicator({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Indicator>) {
  return <TabsPrimitive.Indicator data-slot="tabs-indicator" className={cn(className)} {...props} />
}
export { Tabs, TabsList, TabsTrigger, TabsContent, TabsIndicator }
```

- [ ] **Step 3: 先写 `groupDisplay` 的失败单测（TDD）**

`apps/desktop/src/renderer/src/lib/groupDisplay.test.ts`（`node --test` 不解析 `@shared/*`，用相对路径 + `.ts` 后缀；`erasableSyntaxOnly` 下禁 `enum`/参数属性）：

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  shortfallPercent, gateNote, memberAreaState, joinTimeCopy, exitCell, firstSeenCopy
} from './groupDisplay.ts'

test('shortfallPercent：覆盖率换成「少 x%」，一位小数', () => {
  assert.equal(shortfallPercent(0.4), 60)
  assert.equal(shortfallPercent(0.9333), 6.7)   // 四舍五入到一位，浮点尾巴不外泄
  assert.equal(shortfallPercent(1), 0)
})

test('gateNote 只在 coverage_too_low 出文案', () => {
  assert.equal(gateNote('coverage_too_low', 0.4), '本次快照人数较上次少 60%，未做退群判定')
  assert.equal(gateNote('ok', 1), null)
  assert.equal(gateNote('first_build', null), null)      // §8：首次建档正常显示
  assert.equal(gateNote('no_snapshot', null), null)      // 这一格是"没带快照"，不是"少人了"
  assert.equal(gateNote(null, null), null)
})

test('gateNote：coverage 缺失时不许编一个百分比出来', () => {
  // 判据：reason 说低覆盖但读数没落库（列可空）——宁可不显示标注，也不显示"少 NaN%"
  assert.equal(gateNote('coverage_too_low', null), '本次快照人数低于上次，未做退群判定')
})

test('memberAreaState：非 WhatsApp 与从没快照过的群分开', () => {
  assert.equal(memberAreaState({ platform: 'telegram', snapshotCount: 5 }), 'unavailable')
  assert.equal(memberAreaState({ platform: 'whatsapp', snapshotCount: 0 }), 'never_built')
  assert.equal(memberAreaState({ platform: 'whatsapp', snapshotCount: 3 }), 'built')
})

test('joinTimeCopy：进群时间只取 latestJoinAt，空就空（§11 第 2 条）', () => {
  assert.equal(joinTimeCopy({ latestJoinAt: '2026-09-30T12:00:00' }), '2026-09-30 12:00:00')
  assert.equal(joinTimeCopy({ latestJoinAt: null }), '—')
})

test('exitCell：推定退群没有时间，退出方式给"快照中已不在"（§8 第四行）', () => {
  // 中文词从 shared 的 `exitMethodLabel` 来（R46：那一份表在 Task 13 的 shared 里，
  // 这里断言的是"接线接对了"，不是"这里再写一遍词"）。
  assert.deepEqual(exitCell({ isInGroup: false, exitMethod: 'snapshot_absent', latestLeaveAt: null }),
    { time: '—', method: '快照中已不在' })
  assert.deepEqual(exitCell({ isInGroup: false, exitMethod: 'left', latestLeaveAt: '2026-09-30T12:00:00' }),
    { time: '2026-09-30 12:00:00', method: '自行退群' })
  assert.deepEqual(exitCell({ isInGroup: false, exitMethod: 'removed', latestLeaveAt: null }),
    { time: '—', method: '被移出' })   // 事件证据在，时间戳缺——仍是"—"，不许拿 first_seen 补
  // 判别力：exitMethod 为 null 时**不许**把 `exitMethodLabel(null)` 的 '—' 当成"有退出方式"显示出来，
  // 否则每一行在群成员都会多出一格"—"，读起来像"退群方式未知"。
  assert.deepEqual(exitCell({ isInGroup: false, exitMethod: null, latestLeaveAt: null }), { time: '', method: '' })
  // 在群的人这两格一律空着：`exit_method` 是历史值（上次退群留下的），不能显示成"现在退群了"。
  assert.deepEqual(exitCell({ isInGroup: true, exitMethod: 'left', latestLeaveAt: '2026-09-30T12:00:00' }),
    { time: '', method: '' })
})

test('firstSeenCopy 的措辞是"首次见到"，不是"进群时间"', () => {
  assert.equal(firstSeenCopy('2026-09-30T12:00:00'), '2026-09-30 12:00:00')
  assert.equal(firstSeenCopy(null), '—')
})
```

Run:

```bash
cd /d/SmartSCRM/apps/desktop && set -o pipefail
pnpm run test:unit 2>&1 | tee /d/SmartSCRM/tmp/p8e-unit-red.log | tail -20
```

期望：`Cannot find module './groupDisplay.ts'` 一类的红（模块不存在）。**这一步的意义是"测试先于实现"**，红的内容不重要，重要的是它红了。

- [ ] **Step 4: 实现 `groupDisplay.ts`**

```ts
// 运行时值走相对路径 + `.ts`（技术要点 10：`node --test` 不解析 `@shared/*`）。
import { exitMethodLabel, formatExportTime } from '../../../shared/groupMembers.ts'
import type { CoverageReason } from '@shared/groupMembers'

/**
 * 覆盖率 → 「少 x%」。一位小数：`DOUBLE` 列会带浮点尾巴（Task 8b 技术要点），原样上界面就是 60.000000000000006%。
 */
export function shortfallPercent(coverage: number): number {
  return Math.round((1 - coverage) * 1000) / 10
}

/**
 * 弹层右上角那一行（spec §8 第三行）。只有 `coverage_too_low` 出文案；
 * `first_build` 是正常显示，`ok` 什么都没发生，`no_snapshot` 说的是"这批没带快照"，
 * 拿它当"少人了"会给用户一个凭空出现的百分比。
 */
export function gateNote(reason: string | null, coverage: number | null): string | null {
  if (reason !== 'coverage_too_low') return null
  if (coverage === null) return '本次快照人数低于上次，未做退群判定'
  return `本次快照人数较上次少 ${shortfallPercent(coverage)}%，未做退群判定`
}

/** 成员区的三档（spec §8 第六行）。`unavailable` 与 `never_built` 是两句话，不许合成"暂无数据"。 */
export function memberAreaState(row: { platform: string; snapshotCount: number }): 'unavailable' | 'never_built' | 'built' {
  if (row.platform !== 'whatsapp') return 'unavailable'
  return row.snapshotCount === 0 ? 'never_built' : 'built'
}

/** 进群时间**只**取 `latestJoinAt`（§11 第 2 条：`first_seen_at` 不是进群时间，空就是"我们没看见他进来"）。 */
export function joinTimeCopy(row: { latestJoinAt: string | null }): string {
  return row.latestJoinAt ? formatExportTime(row.latestJoinAt) : '—'
}

/**
 * 退群时间列与退出方式列一起算（§8 第四行）。三件事在这一格里分得开：
 * 在群的人两格空着；有 `exitMethod` 没 `latestLeaveAt` 是"有证据说人没了、没证据说时间"，给 `—`；
 * `exitMethod` 本身为空就一字不出——`exitMethodLabel(null)` 给的是 `—`，
 * 直接拿它当"退出方式"显示会让每个在群的人都被读成"退群方式未知"。
 */
export function exitCell(row: {
  isInGroup: boolean
  exitMethod: string | null
  latestLeaveAt: string | null
}): { time: string; method: string } {
  if (row.isInGroup) return { time: '', method: '' }
  if (!row.exitMethod) return { time: '', method: '' }
  return {
    time: row.latestLeaveAt ? formatExportTime(row.latestLeaveAt) : '—',
    method: exitMethodLabel(row.exitMethod)
  }
}

export function firstSeenCopy(firstSeenAt: string | null): string {
  return firstSeenAt ? formatExportTime(firstSeenAt) : '—'
}

export type { CoverageReason }
```

（时刻文本的口径在 shared 的 `formatExportTime` 里：只做「`T` 换空格、截到秒」，**不解析、不换算时区**。`LocalDateTime` 没有 `Z`，`new Date()` 会按本地时区重读它，于是同一行在两台机器上显示两个时刻。渲染层与导出文件读的是同一个函数，所以两边不会长得不一样。）

Run: `pnpm run test:unit` → 期望 7 条 test 全绿（21 个断言）、总数比上一档多 7。

- [ ] **Step 5: `api/groupMembers.ts` 的取数层**

```ts
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/lib/http'
import { qs } from '@/api/messages'
import type { PageResult } from '@/api/customers'
import type { CoverageReason, GroupBuildOutcome, GroupEventSource, GroupEventType,
  GroupExportResult, GroupMemberRole, GroupStateEvent } from '@shared/groupMembers'

export const GROUP_MEMBER_PAGE_SIZE = 50
export const GROUP_EVENT_PAGE_SIZE = 30
const BASE = '/api/group-members'

// 类型逐字抄 §A.2 + Task 8b Produces；`isFinal`/`isInGroup` 是 boolean（不是 0/1），
// `lastCoverage`/`coverage` 是 number | null（8b 之后才不是空串）。
// …（GroupRowVO / GroupMemberRowVO / GroupEventRowVO / MemberPageVO 照 Interfaces 那一段落进来）

export const groupKeys = {
  root: ['group'] as const,
  members: (accountId: number | null, chatKey: string, f: MemberFilters) =>
    ['group', 'members', accountId, chatKey, f] as const,
  events: (accountId: number | null, chatKey: string, eventType: string | '', page: number) =>
    ['group', 'events', accountId, chatKey, eventType, page] as const,
  customerGroups: (accountId: number | null, customerId: number | null) =>
    ['group', 'customer-groups', accountId, customerId] as const
}

export function useGroupMembers(accountId: number | null, chatKey: string, filters: MemberFilters) {
  const page = filters.page ?? 1
  return useQuery({
    queryKey: groupKeys.members(accountId, chatKey, { ...filters, page }),
    // 「全部」档传 undefined 而不是空串：`qs` 两种都会丢掉，但那只是巧合（技术要点 2）。
    queryFn: () => http.get<MemberPageVO>(
      `${BASE}/group/members${qs({
        accountId, chatKey, isInGroup: filters.isInGroup, role: filters.role || undefined,
        q: filters.q, page, size: GROUP_MEMBER_PAGE_SIZE
      })}`
    ),
    enabled: accountId != null && chatKey !== ''
  })
}

export function useGroupEvents(accountId: number | null, chatKey: string, eventType: string | '', page = 1) {
  return useQuery({
    queryKey: groupKeys.events(accountId, chatKey, eventType, page),
    queryFn: () => http.get<PageResult<GroupEventRowVO>>(
      `${BASE}/group/events${qs({ accountId, chatKey, eventType: eventType || undefined, page, size: GROUP_EVENT_PAGE_SIZE })}`
    ),
    enabled: accountId != null && chatKey !== ''
  })
}

export function useCustomerGroups(accountId: number | null, customerId: number | null) {
  return useQuery({
    queryKey: groupKeys.customerGroups(accountId, customerId),
    // 8b ④：accountId 必填。少一个都不查——宁可不显示，也不跨账号混读（R16/R40）。
    queryFn: () => http.get<GroupRowVO[]>(`${BASE}/customer/${customerId}/groups${qs({ accountId })}`),
    enabled: accountId != null && customerId != null
  })
}
```

（`PageResult<T>` 从 `api/customers.ts:41` 取，不另写一份：它的四键形状与后端 `PageResult` 逐字对应，
消息面另写的那份是游标形状（`nextCursor/hasMore`），两者不是一件事——R45。）

- [ ] **Step 6: 宿主那三跳 + 广播失效**

```ts
export function useGroupBuild() {
  const [outcome, setOutcome] = useState<GroupBuildOutcome | null>(null)
  // 单数键（R49）：`group:build` 的契约是 `{ accountId, chatKey? }`，"只补这一群"就传一个键。
  // IPC 是 JSON，多余或拼错的键会被静默忽略——渲染层与主进程两处各一种拼法不会编译报错，
  // 症状是"刷新成员"按下去没有任何反应。所以这一形状在三处（Task 11/12/15）必须逐字一致。
  const m = useMutation({
    mutationFn: (req: { accountId: number; chatKey?: string }) => window.scrm?.group.build(req),
    onSuccess: (r) => setOutcome(r ?? null)
  })
  return { build: (req: { accountId: number; chatKey?: string }) => void m.mutate(req), pending: m.isPending, outcome }
}

export function useGroupExport() {
  const [result, setResult] = useState<GroupExportResult | null>(null)
  const m = useMutation({
    mutationFn: (req: { accountId: number; chatKeys: string[] }) => window.scrm?.group.export(req),
    onSuccess: (r) => setResult(r ?? null)
  })
  // null = 宿主没给答案（preload 没挂上 / IPC 那侧 catch 了）。它和 result.reason==='failed' 是两种失败，
  // 前者要说"这个构建里宿主没接上"，后者才说"取数/写文件没成"（Task 13 技术要点第 6 条同一口径）。
  return { exportRows: (req: { accountId: number; chatKeys: string[] }) => void m.mutate(req), pending: m.isPending, result }
}

export function useGroupStateInvalidation(): void {
  const qc = useQueryClient()
  useEffect(() => {
    return window.scrm?.group.onState((e: GroupStateEvent) => {
      if (e.phase === 'settled') void qc.invalidateQueries({ queryKey: groupKeys.root })
    })
  }, [qc])
}
```

- [ ] **Step 7: 四路 typecheck + unit + lint + 构建**

```bash
cd /d/SmartSCRM/apps/desktop && set -o pipefail
pnpm run typecheck 2>&1 | tee /d/SmartSCRM/tmp/p8e-typecheck.log | tail -20
pnpm run test:unit 2>&1 | tee -a /d/SmartSCRM/tmp/p8e-unit.log | tail -10
pnpm exec eslint src/renderer/src/api/groupMembers.ts src/renderer/src/components/ui/tabs.tsx \
  src/renderer/src/lib/groupDisplay.ts src/renderer/src/lib/groupDisplay.test.ts \
  src/renderer/src/api/messages.ts --quiet 2>&1 | tail -20
pnpm run build 2>&1 | tee /d/SmartSCRM/tmp/p8e-build.log | tail -20
```

期望：四路 `tsc` 全 0；`test:unit` 通过数 = 上一档 + 7；`eslint --quiet` 对这五个文件 0 error（**全仓 lint 不是绿门**，只看改动文件）；`build` 成功。`typecheck:web` 会替本任务证住一件不容易注意到的事：`MemberPageVO.coverage` 若被写成 `number`，Task 16 里任何 `coverage === null` 的分支都会被 TS 判成死代码——`number | null` 是 8b ③ 的下游锁。

- [ ] **Step 8: spec §9 那句改口 + 提交**

把 `docs/superpowers/specs/2026-09-30-group-member-analysis-design.md` §9 的「群与成员的实时尾巴走既有广播面：`group_event` 入库后主进程广播一条 `group:state`，成员面开着就刷，没开着不刷」改成：「`group:state` 报的是**一轮建档**的在跑 / 结了，渲染层据此失效群与成员的缓存；实时事件只落库，名单要新读数就点顶栏「刷新成员」（本期不做定时重拉，§14）。」其余行不动。

```bash
cd /d/SmartSCRM && git status --short
git add apps/desktop/src/renderer/src/api/groupMembers.ts apps/desktop/src/renderer/src/api/messages.ts \
  apps/desktop/src/renderer/src/components/ui/tabs.tsx apps/desktop/src/renderer/src/lib/groupDisplay.ts \
  apps/desktop/src/renderer/src/lib/groupDisplay.test.ts apps/desktop/tsconfig.unit.json \
  docs/superpowers/specs/2026-09-30-group-member-analysis-design.md \
  docs/superpowers/plans/2026-09-30-group-member-analysis.md
git commit -m "$(cat <<'EOF'
feat(P8/B6): 渲染层群成员数据层与 tabs 原子件

六跳的 VO + hooks 一份、§8 文案收成纯函数（7 条 test / 21 个断言）、components/ui 补 tabs。
spec §9 的 group:state 那句改口：它报的是每轮建档的在跑/结了，不是每批事件——
按事件广播会把缓存失效变成 2 秒一次的轮询风暴。
EOF
)"
```

---

## Task 16: 界面装配——抽屉「所在群」+ 群成员弹层（两个 tab、三档筛选、两处导出入口）

> **判档**：`pnpm run typecheck`（四路）+ `test:unit`（本任务给 `groupDisplay` 补 11 条 test / 49 个断言）+ `pnpm exec eslint <改动文件> --quiet` + `pnpm run build`。
> **本任务不声称界面可用。** 两个组件都是"装配 + 接线"：`host.ts` / `preload` / 泵 没跑通时，这里渲染得出来但读不到数；弹层点开看到真名单是 **Task 17 的 CDP 腿**（§13 的界面那一档）。
> 本任务唯一可自动验证的显示面是 `lib/groupDisplay.ts` 那 11 条纯函数——**这也是把全部文案判断挪进 lib 的理由**：组件里剩下的只有 JSX。

**Files:**
- Modify: `apps/desktop/src/renderer/src/lib/groupDisplay.ts`（补 8 件纯函数：`timeCopy` / `memberAreaCopy` / `memberAreaShort` / `eventTypeCopy` / `sourceCopy` / `inGroupCopy` / `actorCopy` / `firstSeenNote` / `exportOutcomeCopy` / `tooManyCopy` / `buildFailureNotes` + `LIVE_EVENT_TIME_NOTE`；把 `joinTimeCopy` / `firstSeenCopy` 改成走 `timeCopy`）
- Modify: `apps/desktop/src/renderer/src/lib/groupDisplay.test.ts`（补 11 条 test）
- Create: `apps/desktop/src/renderer/src/components/customers/CustomerGroupsSection.tsx`
- Create: `apps/desktop/src/renderer/src/components/customers/GroupMembersDialog.tsx`
- Modify: `apps/desktop/src/renderer/src/components/customers/CustomerDrawer.tsx:227`（`最近消息` 那一节之后挂 `<CustomerGroupsSection customerId={customer.id} />`）
- Modify: `apps/desktop/src/renderer/src/layouts/AppLayout.tsx`（挂 `useGroupStateInvalidation()`）
- Modify: `docs/superpowers/specs/2026-09-30-group-member-analysis-design.md` §9（R48 改口）+ §8 第一行（R50 改口）

**Interfaces:**
- Consumes（全部来自 Task 15 的 Produces 名表，逐字）：`useCustomerGroups` / `useGroupMembers` / `useGroupEvents` / `useGroupBuild` / `useGroupExport` / `MemberFilters` / `MemberPageVO` / `GroupRowVO` / `GroupMemberRowVO` / `GroupEventRowVO` / `GROUP_MEMBER_PAGE_SIZE` / `GROUP_EVENT_PAGE_SIZE`；`lib/groupDisplay` 的 `gateNote` / `memberAreaState` / `joinTimeCopy` / `exitCell` / `firstSeenCopy`（Task 15）+ 本任务新补的那几件；`components/ui/{tabs,dialog,select,input,button,badge,separator}`；`stores/accounts` 的 `useAccounts` / `useSelectionStore`（读码 `accounts.ts:32,69`）、`lib/platform` 的 `PlatformType`（`platform.ts:13-20`，`WhatsApp = 1`）；shared 的 `MAX_EXPORT_GROUPS` / `MAX_GROUPS_PER_BUILD` / `groupRoleLabel` / 类型 `GroupMemberRole` / `GroupBuildOutcome` / `GroupExportResult` / `GroupEventType` / `GroupEventSource`。
- Produces：**没有源码接口**（渲染层到此为止），只产出 **Task 17 的 CDP 腿按这张表点**——锚点全集：

| 锚点 | 在哪 | 读什么 |
|---|---|---|
| `[data-p8g-section]` | 抽屉那一节根 | 节存在（不在线时也在，内容是那句说明） |
| `[data-p8g-no-account]` | 节的说明行 | `accountId===null` 那一档，且**没有**发出 `/customer/*/groups` 请求 |
| `[data-p8g-empty]` `[data-p8g-error]` | 节的空态行 / 错误行 | Task 16 那段 `CustomerGroupsSection` 里的两行 `<p data-p8g-error>`（「读不到所在群：确认后端已启动。」）与 `<p data-p8g-empty>`（Task 17 的 L18 要分辨这两档，故补进本表；行号随文档编辑会漂，认文案不认行号）|
| `[data-p8g-account]` | 节头下拉（≥2 档在线账号才有） | 当前账号 id；切档后勾选清空 |
| `[data-p8g-group-row="<chatKey>"]` | 每一群行 | 群名 / 两个数 / 快照时间 |
| `[data-p8g-final]` `[data-p8g-area="<state>"]` | 群行徽标 | `is_final` 与三档短标签 |
| `[data-p8g-check="<chatKey>"]` | 群行复选框 | 勾选集合 |
| `[data-p8g-export-selected]` | 节顶栏按钮 | 文案带勾选数；`picked.size===0` 时 disabled |
| `[data-p8g-open="<chatKey>"]` | 「查看群成员」 | 打开弹层 |
| `[data-p8g-dialog]` / `[data-p8g-close]` | 弹层根 / 关闭 | 弹层在不在 |
| `[data-p8g-refresh]` `[data-p8g-export-one]` | 弹层顶栏两颗 | 各自的 disabled 条件 |
| `[data-p8g-area="<state>"]` | 弹层成员区横幅 | §8 第六行那句 |
| `[data-p8g-build-msg]` `[data-p8g-build-pending]` | 弹层提示行 | `buildFailureNotes` 的每一行 / 「建档中…」 |
| `[data-p8g-export-msg]` | 弹层与抽屉各一条 | `exportOutcomeCopy` 的文案 |
| `[data-p8g-blocked]` | 抽屉「前拦」那一行 | 超过 `MAX_EXPORT_GROUPS` 时不发 IPC |
| `[data-p8g-tab-members]` `[data-p8g-tab-events]` | 两个 tab 触发器 | 切换 |
| `[data-p8g-f-in-group]` `[data-p8g-f-role]` `[data-p8g-f-q]` `[data-p8g-f-event]` | 四个筛选件 | 值 |
| `[data-p8g-member-row="<memberKey>"]` `[data-p8g-event-row="<id>"]` | 两张表的行 | 十列 / 五列的格子文本 |
| `[data-p8g-coverage-note]` | 名单右上角 | `gateNote` 的文案（`coverage_too_low` 才有） |
| `[data-p8g-member-page]` `[data-p8g-event-page]` | 两个页脚 | 「第 x / y 页 · 共 n」 |

有三类锚点**故意**不被界面腿点/读，评审时不要当成漏项：`[data-p8g-refresh]` 与 `[data-p8g-export-one]` 属 Task 17「技术要点」第 4 条那三条安全线（点了会打到真实 WhatsApp 页面或真落盘），界面腿只在 L11 读它们的 `disabled`，绝不点击；`[data-p8g-build-msg]` `[data-p8g-build-pending]` 要等一发真建档才有现场，本期归真实登录档；`[data-p8g-event-page]` 在本轮夹具里恒是「第 1 / 1 页」——流水的表头、行值与筛选由 L13/L15 用 `[data-p8g-event-row]` 读，事件翻页要证就得先批量造事件，而事件行的真实性归 §13 的契约腿与真实登录档管，界面腿不替它编现场。

**技术要点**

1. **账号上下文按 R43，优先级是 `节内下拉 > 工作台 selectedId > candidates[0]`**：`candidates = accounts.filter(a => a.platformType === PlatformType.WhatsApp && a.status === 1 && a.viewId !== '')`（读码先例 `BatchWizard.tsx:105` 同一条过滤，只是它没有 `viewId` 那一半）。下拉排在最前是对 R43 的一处补：那一行写的是"优先 selectedId"，而**节内下拉是用户刚刚在这节里点的那一下**，比工作台上一次选择更近；不这么排的话，用户在这个窄抽屉里换了账号，读数却还是工作台那一份，看上去像下拉坏了。代价：与工作台不同步，节头必须把当前账号名显出来（已显）。
2. **`accountId === null` 时必须早于 `isPending` 判**：react-query v5 里 `enabled: false` 的查询**永远停在 `status:'pending'`**（读码 `api/groupMembers.ts` 的 `useGroupMembers/useCustomerGroups` 都带 `enabled`）。所以"没有在线账号"那一档如果放在 loading 之后判，界面会永远显示"读取中…"——那是"什么都没做"被显示成"正在做"，是 memory 里那条判据的界面版。
3. **只认 `PlatformType.WhatsApp`（1），不认 `WhatsAppProtocol`（7）**：`ChatKeys.platformOfAccountType` 只给 1→`whatsapp` / 4→`telegram`，其余给 `null`，而 `GroupMemberService.java:103-107` 在 `platform == null` 时直接拒收（读码）。所以协议号账号点「刷新成员」只会得到一条"没建成"，不如一开始就不进候选。同理 **Telegram（4）不进候选**：§14 明文本期不做 TG 成员采集，但 `memberAreaState` 仍要判 `platform !== 'whatsapp'`——那是给"库里已经有 TG 群行"这种以后的情况留的读侧口径，不是现在的入口。
4. **未激活的 tab 不取数**：Radix `Tabs.Content` 默认在 value 不匹配时**卸载**，所以 `useGroupMembers` / `useGroupEvents` 必须各自待在 `MemberTable` / `EventTable` 组件里，不许提到 Dialog 顶层。判别：提到顶层 = 打开弹层就打两次 GET，而第二个 tab 还没被人看过；这一格 Task 17 的 CDP 腿用网络计数读，不靠读码。
5. **`filters` 每次 render 新建对象是安全的**：`groupKeys.members(accountId, chatKey, f)` 把整个 `f` 塞进查询键，react-query v5 按键**结构化哈希**比较，不按引用。反过来说，正因为键是按值的，`page` 与三个筛选条件才必须全部进 `f`——漏掉 `page` 的那一份缓存会永远停在第 1 页的数据上（`messages.ts:159-163` 那条注释讲的同一个坑的另一个方向）。
6. **筛选变化就 `setPage(1)` 并清勾选**：沿用 `BatchTaskDetail.tsx:357-362` 那两行的理由——换筛选后当前页的行全变了，看不见的勾选会继续被算进导出集合。抽屉那一份勾选按 `chatKey` 存，切账号也一起清（技术要点 7）。
7. **一次只读一个账号，切账号即作废全部现场**：`useEffect(() => { setPicked(new Set()); setDialogRow(null); setBlocked('') }, [accountId])`。R16/R40 说 `chat_key` 在两个账号下是两行，所以"A 账号勾的键在 B 账号下导出"不是不方便，是**错的**；`export-rows` 带 `accountId`，后端只会返回另一个账号那份名单（或者空），而 `seq` 与"导出所选（n）"的数字会双双对不上。
8. **导出上限提前拦，但拦下时不许发 IPC，也不许另写一句话**：`picked.size > MAX_EXPORT_GROUPS` → `setBlocked(tooManyCopy(picked.size))` 并 return。界面前拦（省一次 IPC + 一次落盘）、主进程再判（Task 13）、后端 40016（8b ⑤）三处判的不是同一件事；**渲染层能看见的那两句**（前拦带计数、宿主回 `too_many` 不带）只有 `tooManyCopy` 一个作者。后端那句在 Java 侧另写，跨语言共不了作者，也不需要共：它永远进不了界面（前拦与主进程都在它前面），Task 14 的 12.1 因此只断 `code === 40016`，不断那句文案。
9. **「导出所选」在抽屉、「导出本群」在弹层（R48）**：`group:export` 的入参是群键数组，契约里没有"勾选若干成员"，所以弹层里那个"所选"无所指。spec §9 那句随本任务改口。
10. **`buildRequested` 那一位是给"点了没反应"准备的**：`useGroupBuild().outcome` 在**没点过**与**点了但宿主返回 `undefined`**（preload 没挂上 / IPC 那侧 catch）两种情况下都是 `null`。少了这个本地位，第二种情况会被渲染成"什么都没发生"——而那恰好是本期唯一能看见"宿主没接上"的现场（`window.scrm?.group` 是可选面，读码 `preload/index.d.ts:7`）。
11. **§8 第一行的 `<原因>` 本期给不出（R50）**：`GroupBuildOutcome` 里没有逐群 error 字段，快照失败的原因只在主进程日志（`oneLine()` 收过一行，C3）。所以弹层那一格是"这一轮没建成（详情看主进程日志）"，spec §8 的措辞随本任务改口。**不许**为了填这一格去扩展 IPC 载荷——那是改契约，属 Task 11/12 那一层。
12. **两个数分开写，不合并（§A.2 的 `GroupVO` 类注释）**：`在群 {inGroupCount} · 上次快照 {participantCount}`。两者不等恰恰是"这次快照被闸拦下、没记账"的读数（R20 的可见面），写成"人数"一个词就把信号抹掉了。计数列全部是 `NOT NULL DEFAULT 0`（读码 `V12__group_member_analysis.sql:20,22,44,45,53`），所以只有 `lastMsgAt/dayMsgCount/msgCount` 三格要判空——它们是聚合出来的（Task 8b 的 VO 类型已如此）。
13. **时刻文本与中文词只有一个作者（R46/R51）**：组件里不许出现 `.replace('T',' ')`、`.slice(0,19)`、也不许就地写"自行退群/被移出"。角色列直接调 shared 的 `groupRoleLabel`（它就是那张表的作者）；「是/否」那一格走 `inGroupCopy`——Java 侧 `GroupExportRowVO` 已经把同一对词格式化过了（§A.2 ⑥），跨语言没法共一份，所以这里用一条 unit 断言把两侧钉住（R51 的锁）。
14. **不再调 `beginOverlay`**（Task 15 技术要点 9）：`DialogContent` 内部已经挂好计数，重复调会让内嵌视图归位时留下 `pointer-events:none`，症状是 CDP 腿之后整个窗口点不动（exit 4 那一档）。
15. **`Th`/`Td` 在新文件里写一份、两个表共用**，不去 import `CustomersPage.tsx:265-271` 那两个私有件（它们没导出），也不抽进 `components/ui/table.tsx`——抽出来要同时改 `CustomersPage` 与 `BatchTaskDetail` 两个已验收文件，那是另一期的一步，本期记为已知重复（第 2 份 → 第 3 份，不再增长）。
16. **本期不做的界面**（§14，逐条落地）：没有选群面（只有客户反查到的群）、没有到点重拉（只有手动「刷新成员」）、没有陌生成员建客户/打标（名单里那格 `customerId` 只用于"这个人已经是客户"的暗示，本期连暗示都不给——列里没有它）、没有虚拟列表（一页 50，超大群靠翻页）、没有成员头像。
17. **`buildFailureNotes` 是本任务唯一可能随 Task 11 现场取证（§A.1 的 Step 0）改动的代码**：它读的是 Task 12 定稿的那份 `GroupBuildOutcome`（十格）。若取证判读成 ③ 并认工作区那台泵的 `BuildResult{built,failed,deferred,abandoned?}` 为契约，那就连 shared 的类型定义一起换，本函数改成判 `abandoned` / `failed>0` / `deferred>0` 三格，**其余 JSX 一行不动**（这就是把易变点收进纯函数的理由）。同一次取证若换成 `BuildResult`，`group:build` 的返回类型与 §8 那三格文案的口径都要跟着改，改的范围仍以这一支函数 + shared 类型两处为限。

- [ ] **Step 1: 先写失败文案单测**

`apps/desktop/src/renderer/src/lib/groupDisplay.test.ts` 末尾追加（import 补上本任务新加的那几件，类型仍走别名）：

```ts
// 下面三段是**并入文件既有 import 区**的新行（Task 15 已写好 `import test from 'node:test'` 与
// `import assert`，本任务不许重复声明，否则 typecheck:unit 报 Duplicate identifier）。
// shared 的运行时值走相对路径 + `.ts`（R46 / Task 15 技术要点 10，同一文件里两种写法混用会一边编译过、一边跑不动）；
// 只用类型的走 @shared 别名。
import type { GroupBuildOutcome, GroupExportResult } from '@shared/groupMembers'
import { MAX_GROUPS_PER_BUILD, exitMethodLabel } from '../../../shared/groupMembers.ts'
import {
  actorCopy, buildFailureNotes, exportOutcomeCopy, firstSeenNote, inGroupCopy, memberAreaCopy,
  memberAreaShort, sourceCopy, timeCopy, tooManyCopy, eventTypeCopy
} from './groupDisplay.ts'

test('timeCopy：空给 —，有值只换形不换算', () => {
  assert.equal(timeCopy(null), '—')
  assert.equal(timeCopy(''), '—')
  assert.equal(timeCopy('2026-09-30T12:00:00.123'), '2026-09-30 12:00:00')
})

test('memberAreaCopy 与 memberAreaShort：同一档两句长短，built 一字不出', () => {
  assert.equal(memberAreaCopy('unavailable'), '该平台的成员采集尚未开通')
  assert.equal(memberAreaCopy('never_built'), '这个群还没建过档——名单为空不等于群里没人')
  assert.equal(memberAreaCopy('built'), '')
  assert.equal(memberAreaShort('unavailable'), '未开通')
  assert.equal(memberAreaShort('never_built'), '未建档')
  assert.equal(memberAreaShort('built'), '')
})

test('eventTypeCopy：六个码全有词，未知值回落原词', () => {
  assert.equal(eventTypeCopy('added'), '被加入')
  assert.equal(eventTypeCopy('joined'), '主动加入')
  assert.equal(eventTypeCopy('left'), '自行退群')
  assert.equal(eventTypeCopy('removed'), '被移出')
  assert.equal(eventTypeCopy('promoted'), '升为管理员')
  assert.equal(eventTypeCopy('demoted'), '降为成员')
  assert.equal(eventTypeCopy('invited_join'), 'invited_join')  // 平台以后给新值时不许显示空白
})

test('eventTypeCopy 与 shared 的退出方式词不许分家（R51 的锁）', () => {
  // 同一个人"被移出"，流水里叫一个词、名单里叫另一个词，是同一事实两个作者的结果。
  // 这两行断言就是那条漂移的守门人：改任一侧都会红。
  assert.equal(eventTypeCopy('left'), exitMethodLabel('left'))
  assert.equal(eventTypeCopy('removed'), exitMethodLabel('removed'))
  assert.equal(eventTypeCopy('added'), exitMethodLabel('added'))
})

test('sourceCopy：两种来源 + 未知回落', () => {
  assert.equal(sourceCopy('system_message'), '系统消息')
  assert.equal(sourceCopy('live_event'), '实时事件')
  assert.equal(sourceCopy('whatever'), 'whatever')
})

test('inGroupCopy：钉的是 Java 导出侧已经用过的那一对（R46 的跨语言版）', () => {
  assert.equal(inGroupCopy(true), '是')
  assert.equal(inGroupCopy(false), '否')
})

test('actorCopy：名字优先，其次键，两个都没有才给 —', () => {
  assert.equal(actorCopy({ actorName: '张三', actorKey: '86138@c.us' }), '张三')
  assert.equal(actorCopy({ actorName: null, actorKey: '86138@c.us' }), '86138@c.us')
  assert.equal(actorCopy({ actorName: null, actorKey: null }), '—')
})

test('firstSeenNote：只在"没有进群时间、但有首次见到"时出话（§8 第三行、§11 第 2 条）', () => {
  assert.equal(firstSeenNote({ latestJoinAt: null, firstSeenAt: '2026-09-30T12:00:00' }), '首次见到 2026-09-30 12:00:00')
  assert.equal(firstSeenNote({ latestJoinAt: '2026-09-01T00:00:00', firstSeenAt: '2026-09-30T12:00:00' }), '')
  assert.equal(firstSeenNote({ latestJoinAt: null, firstSeenAt: null }), '')
})

test('exportOutcomeCopy：六种结论 + 宿主没答，七种来路七句话', () => {
  const r = (over: Partial<GroupExportResult>): GroupExportResult =>
    ({ reason: 'saved', path: 'D:/x.xlsx', rows: 12, bytes: 3456, ...over })
  assert.match(exportOutcomeCopy(r({})), /^已导出 12 行/)
  assert.equal(exportOutcomeCopy(r({ reason: 'cancel', path: null, rows: 0 })), '已取消保存，什么都没写')
  assert.equal(exportOutcomeCopy(r({ reason: 'empty_keys', path: null, rows: 0 })), '没有可导出的群：先勾选至少一个')
  assert.equal(exportOutcomeCopy(r({ reason: 'too_many', path: null, rows: 0 })), tooManyCopy())
  assert.equal(exportOutcomeCopy(r({ reason: 'no_rows', path: null, rows: 0 })), '这些群还没有成员名单，先建一次档再导')
  assert.match(exportOutcomeCopy(r({ reason: 'failed', path: null, rows: 0 })), /导出没成/)
  // 判别力：宿主没答与后端报失败是两句话。塌成一句就会把"这个构建没接 IPC"读成"重试一下就好"。
  assert.notEqual(exportOutcomeCopy(null), exportOutcomeCopy(r({ reason: 'failed', path: null, rows: 0 })))
  assert.match(exportOutcomeCopy(null), /宿主/)
})

test('tooManyCopy：不传 count 时只有干句（宿主那一路），传了才带「当前勾了 n 个」（前拦那一路）', () => {
  assert.match(tooManyCopy(), /一次最多导出 50 个群/)
  assert.equal(tooManyCopy(53), `一次最多导出 50 个群，当前勾了 53 个`)
})

const outcome = (over: Partial<GroupBuildOutcome> = {}): GroupBuildOutcome => ({
  accountId: 1, skipped: null, list: 'ok', registered: 3, attempted: 3, snapshotted: 3,
  postedFailed: 0, failed: 0, skippedFinal: 0, truncated: false, aborted: false, ...over
})

test('buildFailureNotes：skipped 只出一句；计数各占一行；成功出空数组', () => {
  // 早退那一格是判据：不早退的实现会对"上一轮还在跑"同时吐出 skipped + list:'silent' 两行，
  // 而那一轮根本没去读群名单，"页内没答"是假话。
  assert.deepEqual(buildFailureNotes(outcome({ skipped: 'busy', list: 'silent', registered: 0, attempted: 0, snapshotted: 0 })),
    ['这个账号已有一轮建档在跑，这一轮没开'])
  assert.deepEqual(buildFailureNotes(outcome({ skipped: 'no_view', list: 'silent', registered: 0, attempted: 0, snapshotted: 0 })),
    ['这个账号的窗口没挂着，采集下不去'])
  assert.deepEqual(buildFailureNotes(outcome({ list: 'silent' })), ['页内没回答群名单（桥没就绪或 wa-js 没答），这一轮没建档'])
  assert.deepEqual(buildFailureNotes(outcome({ list: 'error' })), ['群名单没读到（页内报错了）'])
  assert.deepEqual(buildFailureNotes(outcome({ aborted: true, failed: 2, postedFailed: 1, truncated: true })), [
    '这一轮被中止（账号掉线或退出），已经入库的那部分仍算数',
    `这一轮只跑了 ${MAX_GROUPS_PER_BUILD} 个群，剩下的等下一次触发`,
    '2 个群的快照没成',
    '1 个群入库没成（后端没答或报错）'
  ])
  assert.deepEqual(buildFailureNotes(outcome()), [])
  assert.deepEqual(buildFailureNotes(outcome({ skippedFinal: 2 })), [])   // 泵跳过已解散群不是失败
  assert.equal(buildFailureNotes(null).length, 1)
  assert.match(buildFailureNotes(null)[0] ?? '', /宿主/)
})
```

Run:

```bash
cd /d/SmartSCRM/apps/desktop && set -o pipefail
pnpm run test:unit 2>&1 | tee /d/SmartSCRM/tmp/p8f-unit-red.log | tail -30
```

期望：新增的 11 条全红（`timeCopy is not a function` 一类的引用错），Task 15 那 7 条仍绿。**红必须是新函数缺实现，不许是 import 路径写错**——后者会让整文件连旧用例一起红，掩盖真实判据。

- [ ] **Step 2: `groupDisplay.ts` 补实现**

在文件末尾追加（`joinTimeCopy` / `firstSeenCopy` 改成走 `timeCopy`，签名与既有 7 条测试都不变）。**import 区不新开**：Task 15 那一份已经有 `import { exitMethodLabel, formatExportTime } from '../../../shared/groupMembers.ts'` 与 `import type { CoverageReason } from '@shared/groupMembers'` 两行，本任务只往这两行里**加名字**（`MAX_EXPORT_GROUPS`、`MAX_GROUPS_PER_BUILD` 进前者；`GroupBuildOutcome`、`GroupEventSource`、`GroupEventType`、`GroupExportResult` 进后者的 type import）。重复声明一份 import 会让 `typecheck:unit` 报 Duplicate identifier，而报错位置在文件头，看不出是本任务加的：

```ts
// ↓ 这两行是「改既有 import」的成品形状，不是新增行
// import { MAX_EXPORT_GROUPS, MAX_GROUPS_PER_BUILD, exitMethodLabel, formatExportTime } from '../../../shared/groupMembers.ts'
// import type { CoverageReason, GroupBuildOutcome, GroupEventSource, GroupEventType, GroupExportResult } from '@shared/groupMembers'

/** 空给 `—`，有值只换形不换算。§8 那几格里"没有这个时刻"永远是 `—`，不是空格、不是 0。 */
export function timeCopy(value: string | null | undefined): string {
  return value ? formatExportTime(value) : '—'
}

/** 成员区三档的两句长短：横幅用长的，徽标用短的。`built` 那一档没有话要说。 */
export function memberAreaCopy(state: 'unavailable' | 'never_built' | 'built'): string {
  if (state === 'unavailable') return '该平台的成员采集尚未开通'
  if (state === 'never_built') return '这个群还没建过档——名单为空不等于群里没人'
  return ''
}
export function memberAreaShort(state: 'unavailable' | 'never_built' | 'built'): string {
  if (state === 'unavailable') return '未开通'
  if (state === 'never_built') return '未建档'
  return ''
}

/**
 * 事件类型与来源的中文词（R51）：只有界面读它们，所以作者在这里而不是 shared。
 * 形状照 shared 那两张表（`Partial<Record<…>>` + 未知回落原词），未知值留空白是最坏的回落。
 */
const EVENT_TYPE_LABEL: Partial<Record<GroupEventType, string>> = {
  added: '被加入', joined: '主动加入', left: '自行退群',
  removed: '被移出', promoted: '升为管理员', demoted: '降为成员'
}
const EVENT_SOURCE_LABEL: Partial<Record<GroupEventSource, string>> = {
  system_message: '系统消息', live_event: '实时事件'
}
export function eventTypeCopy(eventType: string): string {
  return EVENT_TYPE_LABEL[eventType as GroupEventType] ?? eventType
}
export function sourceCopy(source: string): string {
  return EVENT_SOURCE_LABEL[source as GroupEventSource] ?? source
}

/**
 * 「是 / 否」这一对在 Java 侧已经格式化过一次（§A.2 ⑥ 的 `inGroup`）。跨语言共不了同一份表，
 * 所以这里用 `groupDisplay.test.ts` 那条断言把两侧钉住：改成"在群/已退群"会红，改 Java 也会红。
 */
export function inGroupCopy(isInGroup: boolean): string {
  return isInGroup ? '是' : '否'
}

/** 操作人：有名字用名字，没名字用键，两个都没有才是 `—`（系统消息那一路常常没有 actorName）。 */
export function actorCopy(row: { actorName: string | null; actorKey: string | null }): string {
  if (row.actorName) return row.actorName
  if (row.actorKey) return row.actorKey
  return '—'
}

/** 「首次见到」只在"没有进群时间"时补一句——两行并排会把人引向"到底哪个是进群时间"。 */
export function firstSeenNote(row: { latestJoinAt: string | null; firstSeenAt: string | null }): string {
  if (row.latestJoinAt || !row.firstSeenAt) return ''
  return `首次见到 ${firstSeenCopy(row.firstSeenAt)}`
}

/** 导出上限那一句话在**渲染层**的唯一作者：界面前拦带 `count`（「当前勾了 51 个」），主进程回 `too_many` 时不带（「一次最多导出 50 个群」）。后端 40016 那句在 Java 侧另写（Task 8b ⑤：`"一次最多导出 " + MAX_EXPORT_GROUPS + " 个群，当前 " + keys.size()`，没有"勾了"），跨语言不可能共用一个作者——它也不进界面：前拦与主进程都在它前面，Task 14 的 12.1 只断 `code === 40016` 而**不断那句文案**。 */
export function tooManyCopy(count?: number): string {
  return `一次最多导出 ${MAX_EXPORT_GROUPS} 个群${count == null ? '' : `，当前勾了 ${count} 个`}`
}

/**
 * 导出结论 → 界面文案（spec §10 的六格 + preload 没接上那一格）。
 * `null` 与 `failed` 必须分开：前者是"这个构建里宿主没接上"，后者是"接上了但取数/写文件没成"，
 * 塌成一句会让人去重试一个根本不存在的通道（Task 13 技术要点第 6 条同一口径的另一侧）。
 */
export function exportOutcomeCopy(result: GroupExportResult | null): string {
  if (!result) return '宿主没有给出导出结果（这个构建里 `group:export` 没接上）'
  switch (result.reason) {
    case 'saved': return `已导出 ${result.rows} 行：${result.path ?? ''}`
    case 'cancel': return '已取消保存，什么都没写'
    case 'empty_keys': return '没有可导出的群：先勾选至少一个'
    case 'too_many': return tooManyCopy()
    case 'no_rows': return '这些群还没有成员名单，先建一次档再导'
    case 'failed': return '导出没成：后端取数或本地写文件失败，详情看主进程日志'
    default: return `导出结果：${result.reason}`   // 以后加新 reason 时至少能看见码，不给空白
  }
}

/**
 * 一轮建档的结论 → 若干行提示（§8 第一行的本期形状，R50：逐群原因不在 IPC 载荷里）。
 * 返回数组是因为一轮里"截断 + 两群快照没成"可以同时成立，合成一行就会只剩第一个；
 * 但 `skipped` 那一档要早退——那意味着这一轮**根本没去读**，此时再报"页内没答"是假话。
 */
export function buildFailureNotes(outcome: GroupBuildOutcome | null): string[] {
  if (!outcome) return ['宿主没有给出建档结果（这个构建里 `group:build` 没接上）']
  if (outcome.skipped === 'busy') return ['这个账号已有一轮建档在跑，这一轮没开']
  if (outcome.skipped === 'no_view') return ['这个账号的窗口没挂着，采集下不去']
  const notes: string[] = []
  if (outcome.list === 'silent') notes.push('页内没回答群名单（桥没就绪或 wa-js 没答），这一轮没建档')
  if (outcome.list === 'error') notes.push('群名单没读到（页内报错了）')
  if (outcome.aborted) notes.push('这一轮被中止（账号掉线或退出），已经入库的那部分仍算数')
  if (outcome.truncated) notes.push(`这一轮只跑了 ${MAX_GROUPS_PER_BUILD} 个群，剩下的等下一次触发`)
  if (outcome.failed > 0) notes.push(`${outcome.failed} 个群的快照没成`)
  if (outcome.postedFailed > 0) notes.push(`${outcome.postedFailed} 个群入库没成（后端没答或报错）`)
  return notes
}

/** 流水页脚那句（§15#5）：说的是这一列的读数含义，不预报偏差量级——那条还没实测。 */
export const LIVE_EVENT_TIME_NOTE = '来源为「实时事件」的行，时间是主进程收到它的时刻；平台本身没给出发生时刻。'
```

（`joinTimeCopy` / `firstSeenCopy` 内部改成 `return timeCopy(row.latestJoinAt)` / `return timeCopy(firstSeenAt)`：「空 → `—`」这条规则从此只有一处。既有那 7 条测试一个字都不用改。）

Run: `pnpm run test:unit` → 期望 18 条 test 全绿（本任务 +11 条 / +49 个断言，总数比 Task 15 收尾时多 11）。

- [ ] **Step 3: `CustomerGroupsSection.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react'
import { Download, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PlatformType } from '@/lib/platform'
import { useAccounts, useSelectionStore } from '@/stores/accounts'
import { useCustomerGroups, useGroupExport, type GroupRowVO } from '@/api/groupMembers'
import { exportOutcomeCopy, memberAreaShort, memberAreaState, timeCopy, tooManyCopy } from '@/lib/groupDisplay'
import GroupMembersDialog from '@/components/customers/GroupMembersDialog'
// 运行时值走相对路径 + `.ts`（Task 15 技术要点 10）。只用类型时留 `@shared/*` 别名（编译后被擦除）。
import { MAX_EXPORT_GROUPS } from '../../../shared/groupMembers.ts'

interface Props {
  customerId: number
}

/**
 * 抽屉里的「所在群」（spec §9）。这一节同时是**导出所选**的家（R48）：
 * `group:export` 收的是群键数组，能"选出若干群"的地方只有这份列表，不是单个群的弹层。
 */
export default function CustomerGroupsSection({ customerId }: Props): React.JSX.Element {
  const { data: accounts = [] } = useAccounts()
  const selectedId = useSelectionStore((s) => s.selectedId)
  // 只认「在线的 WhatsApp 且视图挂着」那一档（技术要点 1/3）：`status===1` 是在线，`viewId` 空 = 没有可下命令的视图。
  const candidates = useMemo(
    () => accounts.filter((a) => a.platformType === PlatformType.WhatsApp && a.status === 1 && a.viewId !== ''),
    [accounts]
  )
  const [manualId, setManualId] = useState<number | null>(null)
  const accountId = useMemo<number | null>(() => {
    const hit = (id: number | null): number | null =>
      id != null && candidates.some((a) => a.id === id) ? id : null
    return hit(manualId) ?? hit(selectedId) ?? candidates[0]?.id ?? null
  }, [manualId, selectedId, candidates])

  const { data: rows = [], isPending, isError } = useCustomerGroups(accountId, customerId)
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [dialog, setDialog] = useState<{ accountId: number; row: GroupRowVO } | null>(null)
  const [blocked, setBlocked] = useState('')
  const groupExport = useGroupExport()

  // 切账号作废全部现场：勾的群键属于上一个账号（技术要点 7），弹层与提示词一起收。
  useEffect(() => {
    setPicked(new Set())
    setDialog(null)
    setBlocked('')
  }, [accountId])

  const toggle = (chatKey: string): void => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(chatKey)) next.delete(chatKey)
      else next.add(chatKey)
      return next
    })
  }

  const exportPicked = (): void => {
    if (accountId === null || picked.size === 0) return
    if (picked.size > MAX_EXPORT_GROUPS) {
      setBlocked(tooManyCopy(picked.size))   // 前拦：一次 IPC 都不发（技术要点 8）
      return
    }
    setBlocked('')
    groupExport.exportRows({ accountId, chatKeys: [...picked] })
  }

  // 弹层那一行的读数要跟着失效后的列表走：「刷新成员」建完档，顶栏那个时间戳必须变，
  // 否则"生效了"与"什么都没做"在界面上长得一样。找不到（列表被换账号重读空了）就退回手里那份。
  const liveRow = dialog ? rows.find((r) => r.chatKey === dialog.row.chatKey) ?? dialog.row : null
  const accountName = candidates.find((a) => a.id === accountId)?.name ?? ''
  const exportMsg = blocked || (groupExport.result ? exportOutcomeCopy(groupExport.result) : '')

  return (
    <section data-p8g-section="">
      <Separator className="my-5" />
      <div className="mb-2 flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
          所在群{accountName && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{accountName}</span>}
        </h3>
        {candidates.length > 1 && (
          <Select value={String(accountId ?? '')} onValueChange={(v) => setManualId(Number(v))}>
            <SelectTrigger size="sm" className="w-32" data-p8g-account="">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button
          size="sm"
          variant="secondary"
          data-p8g-export-selected=""
          disabled={accountId === null || picked.size === 0 || groupExport.pending}
          onClick={exportPicked}
        >
          <Download className="size-3.5" />
          {groupExport.pending ? '导出中…' : `导出所选（${picked.size}）`}
        </Button>
      </div>

      {/* 顺序即判据：`enabled:false` 的查询在 v5 里永远停在 pending，所以"没有在线账号"必须排在 loading 前（技术要点 2）。 */}
      {accountId === null ? (
        <p className="text-xs text-muted-foreground" data-p8g-no-account="">
          没有在线的 WhatsApp 账号。群成员只在账号上线时采集，连上之后这里会自动出内容。
        </p>
      ) : isPending ? (
        <p className="text-xs text-muted-foreground">读取中…</p>
      ) : isError ? (
        <p className="text-xs text-destructive" data-p8g-error="">读不到所在群：确认后端已启动。</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground" data-p8g-empty="">
          这位客户还没有匹配到的群成员行。匹配是按手机号做的，所以没存进通讯录的陌生号群不会出现在这里。
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row) => {
            const area = memberAreaState(row)
            return (
              <li
                key={row.chatKey}
                data-p8g-group-row={row.chatKey}
                className="flex items-center gap-2 rounded-lg border border-border/50 px-2.5 py-2"
              >
                <input
                  type="checkbox"
                  data-p8g-check={row.chatKey}
                  checked={picked.has(row.chatKey)}
                  onChange={() => toggle(row.chatKey)}
                  aria-label={`选择 ${row.title ?? row.chatKey}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <Users className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{row.title ?? row.chatKey}</span>
                    {row.isFinal && <Badge variant="outline" data-p8g-final="">已解散/已退出</Badge>}
                    {area !== 'built' && (
                      <Badge variant="outline" data-p8g-area={area}>{memberAreaShort(area)}</Badge>
                    )}
                  </p>
                  {/* 两个数分开写：不等 = 这一轮的快照被覆盖率闸拦下、没记账（GroupVO 的类注释、R20）。 */}
                  <p className="truncate text-[11px] text-muted-foreground">
                    在群 {row.inGroupCount} · 上次快照 {row.participantCount} · 快照于 {timeCopy(row.lastSnapshotAt)}
                  </p>
                </div>
                <Button size="sm" variant="ghost" data-p8g-open={row.chatKey} onClick={() => setDialog({ accountId, row })}>
                  查看群成员
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      {exportMsg && (
        <p
          className="mt-2 text-xs text-muted-foreground"
          data-p8g-export-msg=""
          data-p8g-blocked={blocked ? '1' : undefined}
        >
          {exportMsg}
        </p>
      )}

      {dialog && liveRow && (
        <GroupMembersDialog accountId={dialog.accountId} row={liveRow} onClose={() => setDialog(null)} />
      )}
    </section>
  )
}
```

（`data-p8g-blocked` 与 `data-p8g-export-msg` 挂在**同一个可见节点**上：前拦那句本来就是给用户看的，再补一枚 `hidden` 锚会让"界面上有没有这句话"与"驱动读不读得到"分家，也会让 CDP 腿读到一个看不见的内容。判据是 `getAttribute('data-p8g-blocked') === '1'`——前拦与"真导过一次"共用一条文案位置，不分开的腿就没法区分「IPC 没发」与「IPC 发了但失败」，那是 memory 里「断言必须区分生效了与什么都没做」的界面版。）

- [ ] **Step 4: `GroupMembersDialog.tsx`（顶栏 + 两个 tab）**

```tsx
import { useState } from 'react'
import { Download, RefreshCw, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { cn } from '@/lib/utils'
import {
  GROUP_EVENT_PAGE_SIZE, GROUP_MEMBER_PAGE_SIZE, useGroupBuild, useGroupEvents, useGroupExport,
  useGroupMembers, type GroupRowVO, type MemberFilters
} from '@/api/groupMembers'
import {
  actorCopy, buildFailureNotes, exportOutcomeCopy, exitCell, firstSeenNote, gateNote, inGroupCopy,
  joinTimeCopy, LIVE_EVENT_TIME_NOTE, memberAreaCopy, memberAreaState, sourceCopy, timeCopy
} from '@/lib/groupDisplay'
import type { GroupMemberRole } from '@shared/groupMembers'
// 运行时值走相对路径（Task 15 技术要点 10）：角色列的中文词只有 shared 那一份作者（R46）。
import { groupRoleLabel } from '../../../shared/groupMembers.ts'

const ALL = 'all'
const ROLES: GroupMemberRole[] = ['member', 'admin', 'super']
const EVENT_TYPES = ['added', 'joined', 'left', 'removed', 'promoted', 'demoted']

interface Props {
  accountId: number
  row: GroupRowVO
  onClose: () => void
}

export default function GroupMembersDialog({ accountId, row, onClose }: Props): React.JSX.Element {
  const [tab, setTab] = useState('members')
  const build = useGroupBuild()
  const groupExport = useGroupExport()
  // 「点了没反应」与「还没点」的唯一分界（技术要点 10）：`outcome===null` 两种来路都成立。
  const [buildRequested, setBuildRequested] = useState(false)

  const area = memberAreaState(row)
  const areaNote = memberAreaCopy(area)
  const notes = buildRequested ? buildFailureNotes(build.outcome) : []
  const exportMsg = groupExport.result ? exportOutcomeCopy(groupExport.result) : ''

  const refresh = (): void => {
    setBuildRequested(true)
    build.build({ accountId, chatKey: row.chatKey })   // 单数键（R49）：三处契约逐字一致
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      {/* 不再调 beginOverlay：DialogContent 内部已挂浮层计数（Task 15 技术要点 9）。 */}
      <DialogContent className="max-w-5xl" data-p8g-dialog="">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="truncate">{row.title ?? row.chatKey}</span>
            {row.isFinal && <Badge variant="outline">已解散/已退出</Badge>}
          </DialogTitle>
          <DialogDescription>
            在群 {row.inGroupCount} 人 · 上次快照 {row.participantCount} 人 · 快照于 {timeCopy(row.lastSnapshotAt)} ·
            已成功快照 {row.snapshotCount} 次。名单是**建档那一刻**为真，要新读数就点「刷新成员」。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm" variant="outline" data-p8g-refresh=""
            disabled={build.pending || row.isFinal}
            title={row.isFinal ? '泵会跳过已解散/已退出的群（spec §8）' : '只给这个群重新拉一次成员快照'}
            onClick={refresh}
          >
            <RefreshCw className={cn('size-3.5', build.pending && 'animate-spin')} />
            {build.pending ? '建档中…' : '刷新成员'}
          </Button>
          <Button
            size="sm" variant="outline" data-p8g-export-one=""
            disabled={groupExport.pending || row.snapshotCount === 0}
            title={row.snapshotCount === 0 ? '还没建过档，导出会得到一份空文件（spec §10 的 no_rows）' : undefined}
            onClick={() => groupExport.exportRows({ accountId, chatKeys: [row.chatKey] })}
          >
            <Download className="size-3.5" />
            {groupExport.pending ? '导出中…' : '导出本群'}
          </Button>
          <Button size="sm" variant="ghost" data-p8g-close="" className="ml-auto" onClick={onClose}>
            <X className="size-4" />
            关闭
          </Button>
        </div>

        {build.pending && <p className="text-xs text-muted-foreground" data-p8g-build-pending="">建档中：这一轮跑完会自动刷新这里的读数。</p>}
        {areaNote && <p className="rounded-md border border-border/60 px-3 py-2 text-xs text-muted-foreground" data-p8g-area={area}>{areaNote}</p>}
        {notes.map((line) => (
          <p key={line} className="text-xs text-destructive" data-p8g-build-msg="">{line}</p>
        ))}
        {exportMsg && <p className="text-xs text-muted-foreground" data-p8g-export-msg="">{exportMsg}</p>}

        {/* 非 WhatsApp 与从没快照过的群不显示空名单冒充结果（spec §8 第六行）：两句话各自出，tab 都不给。 */}
        {area === 'built' ? (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="members" data-p8g-tab-members="">成员名单</TabsTrigger>
              <TabsTrigger value="events" data-p8g-tab-events="">进退流水</TabsTrigger>
            </TabsList>
            <TabsContent value="members"><MemberTable accountId={accountId} chatKey={row.chatKey} /></TabsContent>
            <TabsContent value="events"><EventTable accountId={accountId} chatKey={row.chatKey} /></TabsContent>
          </Tabs>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

/** 名单与流水各一张表。两个 hook 都待在组件内部：未激活的 tab 被 Radix 卸载，才不会一开弹层就打两次 GET（技术要点 4）。 */
function MemberTable({ accountId, chatKey }: { accountId: number; chatKey: string }): React.JSX.Element {
  const [inGroup, setInGroup] = useState(ALL)
  const [role, setRole] = useState(ALL)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const debouncedQ = useDebouncedValue(q, 300)

  const filters: MemberFilters = {
    // 「全部」传 undefined，"只看已退群"传 false（Task 15 技术要点 2：`qs` 丢 undefined 但保留 false）。
    isInGroup: inGroup === 'in' ? true : inGroup === 'out' ? false : undefined,
    role: role === ALL ? '' : (role as GroupMemberRole),
    q: debouncedQ.trim(),
    page
  }
  const { data, isPending, isError } = useGroupMembers(accountId, chatKey, filters)
  const records = data?.members.records ?? []
  const total = data?.members.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / GROUP_MEMBER_PAGE_SIZE))
  const gate = gateNote(data?.reason ?? null, data?.coverage ?? null)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={inGroup} onValueChange={(v) => { setInGroup(v); setPage(1) }}>
          <SelectTrigger size="sm" className="w-28" data-p8g-f-in-group=""><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>全部成员</SelectItem>
            <SelectItem value="in">在群</SelectItem>
            <SelectItem value="out">已退群</SelectItem>
          </SelectContent>
        </Select>
        <Select value={role} onValueChange={(v) => { setRole(v); setPage(1) }}>
          <SelectTrigger size="sm" className="w-28" data-p8g-f-role=""><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>全部角色</SelectItem>
            {ROLES.map((r) => <SelectItem key={r} value={r}>{groupRoleLabel(r)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input
          className="w-44" data-p8g-f-q="" placeholder="名称或手机号"
          value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }}
        />
        {gate && <span className="ml-auto text-xs text-amber-600" data-p8g-coverage-note="">{gate}</span>}
      </div>

      {isPending ? <p className="py-8 text-center text-xs text-muted-foreground">读取中…</p>
        : isError ? <p className="py-8 text-center text-xs text-destructive">读不到成员名单。</p>
        : records.length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">这个筛选条件下没有人。</p>
        : (
          <div className="max-h-[52vh] overflow-auto rounded-lg border border-border/50">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-muted/70 text-left text-[11px] text-muted-foreground backdrop-blur">
                <tr>
                  {['名称', '手机号', '角色', '是否在群', '进群时间', '进群数', '退群时间', '退出方式', '最近发言', '发言数']
                    .map((h) => <Th key={h}>{h}</Th>)}
                </tr>
              </thead>
              <tbody>
                {records.map((m) => {
                  const exit = exitCell(m)
                  const seen = firstSeenNote(m)
                  return (
                    <tr key={m.memberKey} data-p8g-member-row={m.memberKey} className="border-b border-border/40">
                      <Td><span className="block max-w-[12rem] truncate">{m.displayName ?? '—'}</span></Td>
                      <Td>{m.phone ?? '—'}</Td>
                      <Td>{groupRoleLabel(m.roleType)}</Td>
                      <Td>{inGroupCopy(m.isInGroup)}</Td>
                      <Td>
                        {joinTimeCopy(m)}
                        {/* §8 第三行 + §11 第 2 条：没有进群证据时补一句"首次见到"，且绝不叫进群时间。 */}
                        {seen && <span className="block text-[11px] text-muted-foreground">{seen}</span>}
                      </Td>
                      <Td>{m.joinCount}</Td>
                      <Td>{exit.time}</Td>
                      <Td>{exit.method}</Td>
                      <Td>{timeCopy(m.lastMsgAt)}</Td>
                      {/* 聚合列可空：null 是"没查过"，0 是"查了、那天没说话"。把 null 印成 0 就是替后端编一个读数。 */}
                      <Td>{m.msgCount == null ? '—' : m.msgCount}{m.dayMsgCount == null ? '' : ` / ${m.dayMsgCount}`}</Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

      <Pager anchor="member" page={page} pageCount={pageCount} total={total} unit="人" onPage={setPage} />
    </div>
  )
}

function EventTable({ accountId, chatKey }: { accountId: number; chatKey: string }): React.JSX.Element {
  const [eventType, setEventType] = useState(ALL)
  const [page, setPage] = useState(1)
  const { data, isPending, isError } = useGroupEvents(accountId, chatKey, eventType === ALL ? '' : eventType, page)
  const records = data?.records ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / GROUP_EVENT_PAGE_SIZE))

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={eventType} onValueChange={(v) => { setEventType(v); setPage(1) }}>
          <SelectTrigger size="sm" className="w-32" data-p8g-f-event=""><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>全部事件</SelectItem>
            {EVENT_TYPES.map((t) => <SelectItem key={t} value={t}>{eventTypeText(t)}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-[11px] text-muted-foreground">{LIVE_EVENT_TIME_NOTE}</span>
      </div>

      {isPending ? <p className="py-8 text-center text-xs text-muted-foreground">读取中…</p>
        : isError ? <p className="py-8 text-center text-xs text-destructive">读不到进退流水。</p>
        : records.length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">还没有加减人的流水。事件只在账号上线且桥就绪时采集。</p>
        : (
          <div className="max-h-[52vh] overflow-auto rounded-lg border border-border/50">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-muted/70 text-left text-[11px] text-muted-foreground backdrop-blur">
                <tr>{['时间', '事件', '目标人', '操作人', '来源'].map((h) => <Th key={h}>{h}</Th>)}</tr>
              </thead>
              <tbody>
                {records.map((e) => (
                  <tr key={e.id} data-p8g-event-row={e.id} className="border-b border-border/40">
                    <Td>{timeCopy(e.occurredAt)}</Td>
                    <Td>{eventTypeText(e.eventType)}</Td>
                    {/* 本期流水只有键没有名（§A.2 ④ 的 `GroupEventVO` 不含 displayName），目标人那一格给键。 */}
                    <Td><span className="block max-w-[14rem] truncate font-mono text-[11px]" title={e.memberKey ?? ''}>{e.memberKey ?? '—'}</span></Td>
                    <Td><span className="block max-w-[10rem] truncate" title={actorCopy(e)}>{actorCopy(e)}</span></Td>
                    <Td>{sourceCopy(e.source)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      <Pager anchor="event" page={page} pageCount={pageCount} total={total} unit="条" onPage={setPage} />
    </div>
  )
}

/** 事件类型的中文词走 `groupDisplay` 那一份（R51）；单独一个薄函数只为让两个调用点读起来同形。 */
function eventTypeText(t: string): string {
  return eventTypeCopy(t)
}

function Th({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <th className="px-3 py-2 font-medium">{children}</th>
}

function Td({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <td className="px-3 py-2 align-middle">{children}</td>
}

function Pager({ anchor, page, pageCount, total, unit, onPage }: {
  anchor: 'member' | 'event'
  page: number
  pageCount: number
  total: number
  unit: string
  onPage: (next: number) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between text-xs text-muted-foreground">
      <span data-p8g-event-page={anchor === 'event' ? '' : undefined} data-p8g-member-page={anchor === 'member' ? '' : undefined}>
        第 {page} / {pageCount} 页 · 共 {total} {unit}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>上一页</Button>
        <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>下一页</Button>
      </div>
    </div>
  )
}
```

（**两处要在跑 typecheck 时回头改**：① `useGroupEvents` 的回参是 `PageResult<GroupEventRowVO>`，Task 15 的 hook 直接返回它，所以这里读 `data?.records`——若 Task 15 落地时包了一层 `{events}`，以那份 Produces 为准改这里，不改 hook。② 名单表就是 spec §9 的那十列（`最近发言` 与 `发言数` 各一列，没有合并），但第十列的单元格里写成 `msgCount / dayMsgCount` 两数并列（`dayMsgCount` 为 null 时只出 `msgCount`，不出 `NaN`、不出 `undefined`）——**「当日发言数」在界面上占的是这一格的后半，不是第十一列**。为什么不单列：§9 数到十，多一列就是把表撑出弹层宽度，而这两数天然属于同一件事（这个人说了多少 / 那天说了多少）。判别：这一格的斜杠是**读数并列**，不是"发言数的两种口径"——`dayMsgCount` 的口径由后端 `GroupMemberQueryService` 的聚合 SQL 定，界面不参与换算；这一格在真实登录档之前必然是空读数（Task 14 技术要点第 6 条：自动化腿造不出真消息），所以 §15 与本任务的提交正文都要写明它停在待验证。）

- [ ] **Step 5: 抽屉挂节 + 布局层挂失效**

`CustomerDrawer.tsx`：`import CustomerGroupsSection from '@/components/customers/CustomerGroupsSection'`，并在 `最近消息` 那一节的 `</div>` 之后（`:227`）加一行：

```tsx
          <CustomerGroupsSection customerId={customer.id} />
```

`AppLayout.tsx`：`import { useGroupStateInvalidation } from '@/api/groupMembers'`，与 `useUnreadBadge()` 同段调用：

```tsx
  // 群与成员的缓存失效也挂布局层：`group:state` 是广播，切走客户页时那一轮建档照样会结。
  // 挂在这里还有一层意义——没登录时不跑，`window.scrm.group.onState` 不需要 token，但读数要。
  useGroupStateInvalidation()
```

- [ ] **Step 6: spec 两句改口**

- §9 第三条的顶栏那句改成：「`GroupMembersDialog`：顶栏（刷新成员、导出本群）+ 两个 tab（成员名单 / 进退流水）+ 筛选（在群、角色、关键词）。**导出所选在客户抽屉「所在群」那一节的顶栏**，导的是勾选的若干群（`group:export` 的入参就是群键数组，本期没有"勾选若干成员"这回事）。」
- §8 第一行的界面口径改成：「群行不显示"已建档"，弹层顶栏给"这一轮没建成"；**逐群失败的原因本期不进 IPC**，只在主进程日志里一行（R50）。」
- 两处都只改句子，不删表行（口径来自本项目）。

- [ ] **Step 7: 四路 typecheck + unit + lint + 构建**

```bash
cd /d/SmartSCRM/apps/desktop && set -o pipefail
pnpm run typecheck 2>&1 | tee /d/SmartSCRM/tmp/p8f-typecheck.log | tail -30
pnpm run test:unit 2>&1 | tee /d/SmartSCRM/tmp/p8f-unit.log | tail -10
pnpm exec eslint src/renderer/src/lib/groupDisplay.ts src/renderer/src/lib/groupDisplay.test.ts \
  src/renderer/src/components/customers/CustomerGroupsSection.tsx \
  src/renderer/src/components/customers/GroupMembersDialog.tsx \
  src/renderer/src/components/customers/CustomerDrawer.tsx src/renderer/src/layouts/AppLayout.tsx \
  --quiet 2>&1 | tail -30
pnpm run build 2>&1 | tee /d/SmartSCRM/tmp/p8f-build.log | tail -20
```

期望：四路 `tsc` 全 0；`test:unit` = 上一档 + 11；这六个文件 `eslint --quiet` 0 error（**全仓 lint 不是绿门**）；`build` 成功。`typecheck:web` 在本任务额外证住两件事：`enabled:false` 的查询返回类型仍是 `UseQueryResult`（早退顺序写错不会编译失败，所以那条只能靠技术要点 2 的判读与 Task 17 的 CDP 读数）；`GroupEventRowVO.id` 是 `number`，`key={e.id}` 才成立——若后端把它给成字符串，`React.Key` 那里不会红，但 `dedup` 行为会变，所以流水行的 `data-p8g-event-row` 读数是 CDP 腿的一格判据。

- [ ] **Step 8: 提交**

```bash
cd /d/SmartSCRM && git status --short
git add apps/desktop/src/renderer/src/lib/groupDisplay.ts apps/desktop/src/renderer/src/lib/groupDisplay.test.ts \
  apps/desktop/src/renderer/src/components/customers/CustomerGroupsSection.tsx \
  apps/desktop/src/renderer/src/components/customers/GroupMembersDialog.tsx \
  apps/desktop/src/renderer/src/components/customers/CustomerDrawer.tsx \
  apps/desktop/src/renderer/src/layouts/AppLayout.tsx \
  docs/superpowers/specs/2026-09-30-group-member-analysis-design.md \
  docs/superpowers/plans/2026-09-30-group-member-analysis.md
git commit -m "$(cat <<'EOF'
feat(P8/B6): 客户抽屉「所在群」+ 群成员弹层

两个组件 + §8 全部口径收成纯函数（+11 条 test / 49 个断言）。导出所选按 R48
落在抽屉那一节，弹层只留刷新成员 / 导出本群；spec §9 与 §8 第一行随之改口
（逐群失败原因本期不进 IPC，见 R50）。

界面尚未声称可用：本任务的判档只到四路 typecheck + unit + build。
EOF
)"
```

---

<!-- APPEND-SENTINEL: Task 18 起接在这里（Task 17 已落档于本行上方） -->

---

## Task 17: CDP 界面腿 20 条 + 验收文档（B6 的交付闸）

> **判档**：`node tmp/p8c-ui.mjs 2>&1 | tee tmp/p8c-ui.log` 的日志**最后一行必须是「通过 20 / 失败 0」且进程以 0 退出**；同一轮里 Task 14 的 HTTP 契约腿（全绿，分母 = 脚本里的 `check(` 数，推定 48）、Java 单测、四路 typecheck、`test:unit`、`pnpm run build` 要同时是绿的。四条退出码各有归属：`0` 全绿 / `1` 断言红（产品）/ `2` 后端与布景前置（服务没起、登录没过、jar 不含 8b、布景写库失败）/ `4` 窗口与渲染层前置（CDP 连不上、窗口不可见、`window.scrm.group` 没挂上、锚点结构对不上）。
> **这是 B6 第一次声称"界面可用"。** Task 16 的判档明写着它只到编译；§13 那五档里，只有本任务这一档能证明渲染层真读到了后端、真画出了那十列、真把被闸拦下的那一批显示成"没做退群判定"。
> **本任务不改产品代码。** 任何一条红的去向写死在下面那张判据表的最后一列：回 8b / 回 11–13 / 回 15 / 回 16，不在这里就地改判据。唯一允许在本任务里改的是**驱动自己的锚点**，改了要在提交正文写明"判别力为什么还在"。

**Files:**
- Create: `tmp/p8c-ui.mjs`（CDP 驱动，20 条；文件名由 §0 文件地图第 219 行定死，不许另起一名）
- Create: `docs/notes/2026-10-01-group-members-verification.md`（§13 五档台账 + 不可自动化档 + 前置三行读数；**这份要提交**，与差距表那条"永不提交"不同）
- Modify: `tmp/P8Purge.java`（加 `--prefix` 模式：本轮 54 个群键删不完两键版本；Task 14 Step 9 的位置参数用法一字不动）
- Modify: `docs/superpowers/plans/2026-09-30-group-member-analysis.md`（§A.1 的「未开工」一行 + 交付状态表补一行 + 本任务的三行前置读数）
- Modify: `docs/superpowers/specs/2026-09-30-group-member-analysis-design.md` §13（五档各自的实测状态）、§15（证不掉的三格逐条写明由谁续证）

（`tmp/` 在 `.gitignore` 里（Global Constraints）：**驱动、日志、截图都不进提交**，本任务的提交只含 `docs/` 那三支。这不削弱判档——判的是"这一跑有没有绿"，而 `tmp/p8c-ui.log` 与 `tmp/p8c-drawer.png` / `tmp/p8c-dialog.png` 留在仓库工作区里可读、可引用。）

**Interfaces:**
- Consumes（全部是已交付的实名，逐字照抄，不在本任务里新造）：
  - Task 16 Produces 那张**锚点全集表**（本计划 6452–6472 行）：所有选择器只从那张表里取，表里没有的一律先用 `Grep` 回源码确认再写。
  - Task 15 的六跳 URL 形状：`/api/group-members/customer/{id}/groups?accountId=`、`/group/members?accountId&chatKey&isInGroup&role&q&page&size`、`/group/events?accountId&chatKey&eventType&page&size`（网络腿按 **URL 去重计数**，见技术要点 4）。
  - Task 12/13 的 preload 面：`window.scrm.group.build` / `window.scrm.group.export`（L11 只读类型，**不调用**）。
  - §A.2 的 ①（布景写入）③④⑤（读数），加上客户域与账号域的 `POST/DELETE /api/customers(/{id})`、`POST /api/platform-accounts`、`PATCH /api/platform-accounts/{id}/status`、`DELETE /api/platform-accounts/{id}`（读码 `CustomerController.java:55-87`、`PlatformAccountController.java:63-75`、`stores/accounts.ts:32-67`）——布景全靠这几跳，**不碰 mysql CLI**（表内容走 HTTP 是 Global Constraints）。
  - `tmp/cdp.mjs`：`openPage(9223, 'localhost:5173') → { url, ev, send, close }`。
- Produces：`docs/notes/2026-10-01-group-members-verification.md`；spec §13/§15 的实测回填；§A.1 的状态行更新。**没有源码接口**（本任务不动 `apps/`）。

### §17.1 布景数据表（全部由驱动经 `:8180` 造，跑完自己收走）

| 夹具 | 形状 | 为谁而造 |
|---|---|---|
| 测试账号 `ACCT_NAME = P8C界面腿${RUN}` | `platformType:1`、`viewId:'p8c-'+RUN`、建完 `PATCH status:1` | 让 `candidates` 里**必定**有一个在线 WhatsApp（渲染层那三条件读码 `CustomerGroupsSection.tsx` 的 filter）。本轮所有数据只挂在这个账号上，收尾整条删掉，不碰用户真实账号行。**但候选不止一个是常态**：用户真机那条 WhatsApp 只要在线，`candidates` 就有两档，抽屉那节会挂出账号下拉，默认落在哪一档不由布景决定（读码 Task 16 技术要点 1 的三级优先）。所以 `openDrawer` 先读触发器当前那一档：已经是 `ACCT_NAME` 就不动，否则切过去并等"本轮账号多出一枪 + 那一节两拍定稳"再继续——不处理的话 L1 数到空集，那条红看着像 8b ④ 的跨账号混读，其实是驱动没对齐上下文（技术要点 13 ④） |
| 客户 A `openId=mk(101)`、**无 phone** | 靠 `member_key` 那一路命中 | L1–L16（抽屉三行、名单表、流水、闸标注） |
| 客户 B `openId=mk(500)` | 命中 51 个单人群 | L19（勾满 51 → 前拦） |
| 客户 C `openId='p8cuiC'+RUN+'@c.us'`、`phone:'861380000907'` | **必须晚于 K2 的快照建档** | L17（手机号那一路） |
| 客户 D `openId='p8cuiD'+RUN+'@c.us'`、无 phone | 谁都命中不上 | L18（空态那句） |
| `K1 = ${PREFIX}1001@g.us` | 51 人快照 `mk(101..151)`，其中 `mk(105)=super`、`mk(106)=admin` | L6 L7 L8 L9 L10 L11 L12 |
| `K2 = ${PREFIX}1002@g.us` | 快照 10 人 = `mk(101)`、`mk(907)`、`mk(203)`、`mk(204)`、`mk(210..215)`；**第二批**再报两条事件：`left`（`mk(203)`，source `system_message`）+ `promoted`（`mk(204)`，source `live_event`，带 `actorName`） | L13 L14 L15 + L2 的两个数 + L17 |
| `KG = ${PREFIX}1003@g.us` | 先 10 人快照（`mk(101)`、`mk(302..310)`），再来一发 4 人快照（`mk(101)`、`mk(302..304)`）⇒ 4/10=0.4 ⇒ `coverage_too_low` | L16 + L2 的 GATE 那半 |
| `B_i = ${PREFIX}20${pad2(i)}@g.us`（i=1..51；代码里那颗叫 `BK(i)`，见 Step 3 的常量块） | 每群一发快照，名单只有 `mk(500)` | L19 |

`RUN = String(Date.now()).slice(-9)`、`PREFIX = '12036' + RUN`、`gk(tag) = PREFIX + tag + '@g.us'`、`mk(n) = '86138000' + String(n).padStart(4, '0') + '@c.us'`。形状解释：`ChatKeys.isGroup` 只认 `@g.us` 后缀（读码 `msg/ChatKeys.java:59-64`），所以纯数字尾标既像真群键又不会撞真数据；`chat_key` 列宽 128，本轮最长 23 字（§A.2 V12 那行）。

**三处顺序是设计，写反了腿就没证人**：
① **客户 A/B/D 早于批次**——`matchCustomer` 只在写侧那一刻匹配（读码 `GroupMemberService.java:352-374`），晚了 `customer_id` 就是 NULL，抽屉一行都出不来。
② **客户 C 晚于 K2 的快照**——C 的 openId 不等于任何 memberKey，若建在快照之前，写侧的手机号那一路会提前把 `customer_id` 填上，L17 就变成"今天也过"的假绿。把 C 放在 K2 之后，`customer_id=NULL`、openId 不命中，抽屉里那唯一一行只能来自**读侧**的手机号那一路（8b ⑧）。
③ **K2 的事件单独一批**——一个批里顺序是「群登记 → 事件投影 → 快照收口」（读码 `GroupMemberService.java:84-86` 与类注释），快照最后跑会把同一批里 `left` 投影掉的在场性**盖回 1**。分两批：第一批纯快照，第二批纯事件。

### §17.2 二十条判据

| # | 在哪读 | 判据（逐字） | 红的时候归谁 |
|---|---|---|---|
| L1 | A 抽屉的 `[data-p8g-group-row]` | 键集**逐字等于** `{K1,K2,KG}`（不多不少、不重） | 16（键集/渲染）或 8b ④（跨账号混读） |
| L2 | 同一份 `innerText` | K2 行含 `在群 9 · 上次快照 10 · 快照于 <日期时间>`；KG 行含 `在群 10 · 上次快照 10` | 16 技术要点 12（两个数不许合并）／8b ③（R20 三列被坏快照推进） |
| L3 | `[data-p8g-check]` ×2 + `[data-p8g-export-selected]` | 勾 K1、KG ⇒ 文案 `导出所选（2）`；再点同两颗取消 ⇒ `导出所选（0）` 且 `disabled===true` | 16（勾选集合与 disabled 条件） |
| L4 | 页内 fetch 探针（`resetSpy` 之后到 L4 为止这一窗） | **本轮 `accountId` 的去重 URL 数 === 1**，且那条 URL 里含 `accountId=${accountId}`；**其他账号**的去重 URL ≤ 1（切下拉那一枪，见 §17.1 的账号对齐） | 16（同一入参重复取数）；URL 缺 accountId 才归 15 |
| L5 | 三行各自的徽标 | `data-p8g-final` 计数 0 **且** `data-p8g-area` 计数 0 **且** group-row 计数 3（三件同时成立才算过） | 16（凭空出徽标）；单看"没有徽标"会被"三行根本没画"顶替，所以并读 |
| L6 | K2/K1 弹层 `[data-p8g-member-row]` 所在表 | 表头文本数组**逐字**等于 `['名称','手机号','角色','是否在群','进群时间','进群数','退群时间','退出方式','最近发言','发言数']`；第一行 `data-p8g-member-row` ∈ 本轮夹具键集 | 16（列序/列名） |
| L7 | fetch 探针（开弹层后立刻读） | `/group/members` 去重 URL 数 === 1；`/group/events` **原始次数 === 0** | 16 技术要点 4（hook 被提到 Dialog 顶层） |
| L8 | `[data-p8g-f-role]` **按选项文本**选「群主」（`pickOrStop`，见技术要点 10） | 恰好 1 行，且键 === `mk(105)` | 选不到「群主」⇒ `pickOrStop` 按前置 4 收手（清单少一档）；选到了却 ≠1 行或键不对 ⇒ 15（role 参数没传）／16（键集） |
| L9 | `[data-p8g-f-q]` 真键盘打 `861380000107` | 1 行且键 === `mk(107)`；接着再补打 `99` ⇒ 空态文案 `这个筛选条件下没有人。` | 8b ①（`q` 转义/`SearchPattern`）／16（`qs` 丢值） |
| L10 | 下一页前后各读一次键集 | 第 1 页 50 键、第 2 页 1 键、**两页不相交**、并集 === 51；页脚文案 `第 2 / 2 页 · 共 51 人` | 15（分页参数）；**不比行序**（后端按 `latest_join_at ASC, first_seen_at ASC`，51 人同一次快照 ⇒ 行序由 MySQL 定，不可赌） |
| L11 | 弹层顶栏 + `window.scrm` | `typeof window.scrm?.group?.build === 'function'` 且 `.export === 'function'`；`[data-p8g-refresh]` 的 `disabled === false`（**读了就走，绝不点**） | `undefined` ⇒ 本任务自己 `blocked(4)`（宿主没接上不算产品缺陷）；`disabled` 真 ⇒ 16（`build.pending`/`isFinal` 判反） |
| L12 | `[data-p8g-close]` 点完 | `[data-p8g-dialog]` 不在 DOM，**且** `getComputedStyle(document.body).pointerEvents !== 'none'` | 16 技术要点 14（浮层计数漏还，症状是整窗点不动） |
| L13 | K2 弹层·流水 tab | 表头逐字 `['时间','事件','目标人','操作人','来源']`；两行事件分别是 `自行退群`/`mk(203)`/`系统消息` 与 `升为管理员`/`mk(204)`/`实时事件`；`LIVE_EVENT_TIME_NOTE` 那句在筛选行里 | 16 技术要点 13（中文词作者）／15（`eventType` 传值） |
| L14 | K2 弹层·名单 + `[data-p8g-f-in-group]` 选 `已退群` | 恰好 1 行且键 === `mk(203)`；退群时间格不是 `—`；退出方式格逐字 `自行退群` | 8b（快照收口误判退群）／16（`exitCell`） |
| L15 | K2 弹层·流水 + `[data-p8g-f-event]` 选两次 | 选 `自行退群` ⇒ 1 行且目标人 `mk(203)`；选 `降为成员` ⇒ 空态 `还没有加减人的流水。事件只在账号上线且桥就绪时采集。` | 15／16 |
| L16 | KG 弹层 `[data-p8g-coverage-note]` | 文案**逐字** `本次快照人数较上次少 60%，未做退群判定`；名单 10 行、`是否在群` 列 10 个 `是` | **8b ③ 的界面证人**（V13 两列没落地 / `Map.of` 把 null 压成 `""` / 读侧仍当场重算 ⇒ 这条必然红）——红就在这里点名，**不许放宽判据** |
| L17 | C 抽屉 | 恰好 1 行且键 === `K2` | **8b ⑧ 的界面证人**：C 建在 K2 快照**之后**（约束②），`customer_id` 必为 NULL、openId 又不等于任何 memberKey，所以这一行只可能来自**读侧**手机号那一路。两种坏法分开归因：0 行 ⇒ 那一路比不中——写侧若仍存原样 `'+86 138-0000-0907'`（8b ⑧ 的 `normalizePhone` 没落地）就必然红，否则查 `customerGroups` 的 phone 分支；≥2 行或键集里冒出 K1 ⇒ 写侧提前把 `customer_id` 回填了，约束② 被破坏，这一格的证人身份当场失效。**不许放宽** |
| L18 | D 抽屉 | `[data-p8g-empty]` 在，文案含「还没有匹配到的群成员行」；且 `[data-p8g-error]` 不在 | 16（空与错两档混掉） |
| L19 | B 抽屉 `[data-p8g-check]` ×51 | 全勾完文案 `导出所选（51）`；点 `[data-p8g-export-selected]` ⇒ `data-p8g-blocked === '1'` 且文案 `一次最多导出 50 个群，当前勾了 51 个` 且按钮**没**出现过 `导出中…` | 16 技术要点 8（前拦没生效） |
| L20 | 收摊之后，四个读数取自**不同时刻**：`residual` 由 P8Purge 自己复查、`groupsLeftAfterPurge` 在 `runPurge()` 之后**且删账号之前**读 `/groups`、`40404×4` 与账号消失在那之后读 | 三表 `residual=0`、`/groups` 里没有 `PREFIX` 开头的键、四位客户全 `40404`、测试账号已从 `/api/platform-accounts` 消失 | 驱动自己的清理（R44）；残留要写进验收文档 §4 点名。顺序写反（先删账号再读 `/groups`）这一格会**假绿**，见技术要点 13 ② |

**这张表与代码的分歧以代码为准**——Step 4–8 每落一条腿都要回来对齐本表的措辞，两处不一致就是自审的活（见 Step 10）。

### §17.3 界面证不了的那些（逐条写明由谁续证，不许混进 20 条）

| 项 | 为什么这一档证不了 | 由谁证 |
|---|---|---|
| `never_built` / `unavailable` 两枚徽标 | **本期入口不可达**（读码四条：① 抽屉里的一行必然来自一条 `group_member_state` 行；② 事件投影建的行 `phone/customer_id` 均为 NULL（`applyJoin/applyLeave/applyRole` 的列清单里根本没有 `customer_id`），反查不到客户；③ 只登记不快照的群没有任何 state 行；④ 能给 state 行填上客户的只有快照那一路，而快照被闸放行过 ⇒ `snapshotCount ≥ 1`、`platform==='whatsapp'`，`memberAreaState` 只剩 `built`） | Task 16 的 `groupDisplay.test.ts` 那两条 unit 断言（**文案与档位判定已由 unit 证过**）；真入口要等 B27 的选群面 |
| `is_final` 徽标（L5 只断"没有"） | 本期没有写入点：V12 有 `is_final` 列，但 §A.2 六跳没有任何一跳会写它 | spec §15 第 2 条，等解散/退出事件那期 |
| 账号下拉与切账号作废现场 | 要**两个**同时满足 `platformType===1 && status===1 && viewId!==''` 的账号；布景只造一个，第二个是用户真登的那条，不在自动化腿里 | 真实登录档（用户在场的两棒） |
| `[data-p8g-no-account]` 那一档 | 要把在线账号全部下线才能造现场，而"下线"是用户的手 | 同上；文案与判档顺序由 Task 16 的 unit + 读码钉住 |
| `dayMsgCount` / `msgCount` 的真读数 | 自动化腿不许碰页面发送链（Global Constraints），库里造不出真消息 | **抄 Task 14 技术要点 6 那句**：日志里显式打印两列实际值并标注"待真实登录档核对"，停在待验证，不用假数据冒充通过 |
| 真发 1 条 / 真撤回 1 次 / 真实进退群 / 真实导出落盘 | 用户在场并明确放行才做，不进自动化腿 | 真实登录档 |
| 超大群 `getParticipants` 截断 | 需要真实大群现场（P8 记的那颗雷） | 真实登录档；页内那一腿由 Task 4 的单测证 |

### 技术要点

1. **两条腿是 8b 的下游界面证人，红就回 8b，不在这里放宽**（L16 的 `data-p8g-coverage-note`、L17 的手机号那一路）。判别办法写死：L16 今天必然红——`GroupMemberQueryService.pageMembers` 是在**读的时候重算**覆盖率（10/10=1.0 ⇒ `ok` ⇒ 一句标注都不出），要它变绿只有 8b ③ 那两列进库、读侧改取存储值这一条路。这条判据**不许**改成"读到标注就算过"或"读到空也算过"。
2. **`never_built` 不许伪造**：为了"把四档都跑一遍"而发一发 `groups:[K2]` 且不带快照的批次是**徒劳**的——那样只会多一条没有 `customer_id`、`phone` 为 NULL 的 state 行，反查仍回不到客户（上表④）。想证这一档得先有选群面，本期没有，就记在 §17.3，不硬造。
3. **状态位可以布景，但只能挂在自己的账号上**：`PATCH status:1` 改的是库里一个整数；主进程不知道（它从注入页学在线，不从 DB 学），所以这一发**不会**唤起泵，也就不会去碰真页面。安全线（下面第 4 条）与这一条是同一件事的两面。
4. **安全线：三条不许碰**。**「刷新成员」**（一发 `group_snapshot` 会打到真实 WhatsApp 页面上）、「**导出本群**」、**≤50 群的「导出所选」**（三者都会走到 `dialog.showSaveDialog` + 真落盘）。L19 唯一允许点导出那颗，前提是勾选 51 个——**残余风险**：如果 16 的前拦与 Task 13 主进程那道 50 群上限**同时**坏掉，屏幕中央会弹出一个原生保存框，需要人在场按 Esc。红的时候先按下述顺序归因：`data-p8g-blocked` 缺 → 前拦坏；出现 `导出中…` 但无保存框 → IPC 发了、主进程或后端拦下（`tooManyCopy()` 无计数那半句会露出来）；有保存框 → 两道都坏，属最贵的一种，立刻写进验收文档 §5。
5. **取数判据一律用去重 URL，不用次数**：`main.tsx` 的 QueryClient 只关了 `refetchOnWindowFocus`、`retry:1`，`staleTime` 留默认 0，且 StrictMode 开着（dev 双挂载）。所以"tab 切回不重取"在这一档根本不可证，而原始次数天然是 2——写死成 `=== 1` 会红得不明不白。L4/L7 的写法：`去重 URL 数 === 1` 是判据，原始次数进日志当读数。L7 的 `/group/events` 用**原始次数 === 0**（零不受精确缓存影响）。
6. **探针为什么必须装在页内**：`lib/http.ts:60` 是在调用时才取全局 `fetch`，而 `Runtime.evaluate` 跑在主 world ⇒ 页面包一层就能看见渲染层全部请求；`tmp/cdp.mjs` 没订 CDP 事件，网络域拿不到。**顺序硬约束**：探针要装在 `location.reload()` **之后**（reload 会连它一起冲掉），且早于第一次点导航。
7. **点击一律走真实鼠标事件**：`Input.dispatchMouseEvent` 的 moved/press(`buttons:1`)/release(`buttons:0`)，定位先 `scrollIntoView({block:'center'})` 再 `elementFromPoint` 认定中心点落在目标身上。**读不到点**（gone / 零尺寸 / `elementFromPoint` 返回 null）按前置 `blocked(4)` 收——分不清"被吃掉"还是"根本没进视口"时报缺陷就是替应用撒谎；**读到了却被别的节点接走**按断言红收（应用侧命中测试缺陷）。抽屉体是 `overflow-y-auto`（读码 `CustomerDrawer.tsx` 恢复文件），所以那一节每次点之前都要滚。
8. **下拉照抄 `tmp/p7a-d12probe.mjs:215-300` 那一段**，三条不许改的纪律都来自实测：① 只认 `[data-state="open"]` 的 content（radix 的 `animate-out` 期间旧节点仍挂 DOM 且仍吃命中）；② 要连续两拍停在同一坐标才点（radix 挂载后会自己再对齐一次，实测挪走 24px）；③ **绝不用 Escape 收尾**——`Input.dispatchKeyEvent` 的 Escape 关不掉 radix 的 Select，却会关掉外面那颗 Dialog（P6 实测过两次，一次连锁红三条）。本任务把它从"按第 idx 颗"改成"按 trigger 的选择器"，因为 Task 16 给四颗下拉都挂了 `data-p8g-f-*` 锚点。
9. **输入框用真键盘，不给 `value` 赋值**：ASCII 逐字符 `keyDown(带 text)+keyUp`（`tmp/p16-page.mjs:175-188` 的 `typeAscii`），清空走"全选 + 退格"（同文件 `clearFocused`）。直接改 `input.value` 会绕过 React 的 onChange，症状是"筛选没生效"被误报成后端坏了。L9 打完要等 debounce 300ms + 一次网络往返，判据用条件轮询而不是固定 sleep。
10. **行序与坐标都不可赌**：L10 用键集代数（两页不相交、并集 51）而不是"第 51 个人在第二页第一行"；L8 的下拉**按选项文本**选「群主」而不是"第 idx 颗"（`pickIn` 本来就是按 `textContent` 找项，`tmp/p7a-d12probe.mjs` 那一段的实测形状），清单顺序变了它照样选到对的档，而 `ROLES` 少了一档会由 `pickOrStop` 的 `notfound` 按前置 4 报出来——两种坏法分开归因，比"按最后一颗"更准。任何按 nth 定位的读表式都带 `[data-p8g-*]` 前缀选择器，不带 nth-child。
11. **退出码分档，且清理挂在每一条退出路径上**（R44 / Task 14 技术要点 7、8 的界面版）：`blocked(2)`=后端/布景，`blocked(4)`=窗口/渲染层，断言红=1，驱动自己抛错=1。`cleanup()` 幂等（`cleanedUp` 位），五件事按固定顺序做完：`P8Purge --prefix` → **读一次 `/groups` 存进 `groupsLeftAfterPurge`** → 删四位客户 → 删测试账号 → `page.close()`（`Promise.resolve` 包一层，见技术要点 13）。清理失败**不改主退出码**，只在日志里点名——产品失败不能被清理噪声盖掉。
12. **跑之前先断可见性**：`document.visibilityState === 'visible'`，不是就 `blocked(4, '先跑 tmp/p6f-raise.ps1')`（C9）。hidden 不等于点不动，真正的判据永远是"点完读得到"；但看不见时连"读得到"都归不了因，所以还是先抬起窗口。
13. **四处"读数的时刻"是设计，写反了会拿到必然的假绿/假红**：
    ① **版本闸排在 K1 落库之后**（Step 4 的 4.4）。`GET /groups` 的 `accountId` 是必填参数（读码 `GroupMemberController.java:48-54`），而判 `GroupVO` 有没有 8b 那两列又必须有**一行群**才读得出键名。刚建好的测试账号名下是空的：`records[0]` 为 `undefined`，判据塌成 false，于是"旧 jar"和"还没写库"会混成同一个红——那种红归因不了，只能整跑重来。K1 落库之后再判，读的才是 jar 的形状。
    ② **L20 的 `/groups` 残读排在删账号之前**（就在 `runPurge()` 后面，Step 9）。账号一删，`accountId` 在 `resolveAccount` 那一关就解析不出来，接口回的是错误码而不是空名单，`rec()` 塌成 `[]` ⇒ `groupsLeft === 0` **永远成立**。那是 L20 里唯一一条会假绿的格子，所以它只能在账号还活着的时候读，读完把数存下来。
    ③ **`page.close()` 要包一层**。`tmp/cdp.mjs` 的 `close` 是 `() => ws.close()`，返回 `undefined`；`await page.close().catch(...)` 会在 `.catch` 上抛 TypeError，把一次正常收摊变成"驱动自身抛错（按 1 收）"。写成 `await Promise.resolve(page.close()).catch(() => {})`。
    ④ **账号下拉只在候选 ≥2 时才挂**（读码锚点表 `[data-p8g-account]` 那行），而候选里有没有第二档取决于用户真机那条 WhatsApp 在不在线——这是**现场**，不是布景能控制的。所以 `openDrawer` 先读触发器当前那一档（`<SelectValue/>` 渲染的就是选中的 `a.name`，在 Task 16 那段 `candidates.length > 1 && (<Select …><SelectTrigger data-p8g-account>` 里）：不是本轮账号就切过去，并等"本轮账号多出一枪 + 那一节两拍定稳"；本来就停在本轮账号就不动（切档那一枪算进 L4 的 `others ≤ 1`，不切就没这一枪）。"多出一枪"是**切档作废现场重取**的客观证人，比 `countSel(...) >= 0` 那种恒真条件强：后者什么都不等，会把"正在换数据"读成"数据就这样"。不处理下拉的话 L1 会数到空集，那条红看着像 8b ④ 的跨账号混读，其实是驱动没对齐账号上下文。顺带一条同源的读码事实：布景造的那条账号行**开不出内嵌视图**（`viewId` 只是库里的字符串，创建视图是渲染层经 `preload/index.ts:97` 调 `wcv-create` 的产物，读码 `main/webContentsView/ipc.ts:54`），所以泵不会因此碰到真页面——技术要点 3 的安全线在这一条上同样成立。

- [ ] **Step 1: 全量回归先行（把 8b 之后的一切钉成绿的）**

```bash
cd /d/SmartSCRM/apps/desktop
pnpm run test:unit 2>&1 | tail -6
pnpm run typecheck:node && pnpm run typecheck:web && pnpm run typecheck:inject && pnpm run typecheck:unit
pnpm run build 2>&1 | tail -4
cd /d/SmartSCRM
powershell -NoProfile -ExecutionPolicy Bypass -File tmp/p7b-kill8180.ps1
cd apps/server && export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18"
set -o pipefail
./mvnw -Dtest='GroupMember*Test' test 2>&1 | tail -12
./mvnw -DskipTests package 2>&1 | tail -5
cd /d/SmartSCRM && (java -jar apps/server/target/*.jar > tmp/p8-server.log 2>&1 &)
for i in $(seq 1 60); do curl -sf http://localhost:8180/api/health >/dev/null && break; sleep 1; done
SCRM_USER=admin SCRM_PASS=admin123 node tmp/p8-group-members-contract.mjs 2>&1 | tee tmp/p8-contract.log
```

期望：`test:unit` 尾部 `pass` 数不小于 Task 16 落地时的那一份且 `fail 0`；四路 typecheck 无输出即过；`build` 出 `dist`；`mvnw test` 是 `BUILD SUCCESS` 且 `Tests run:` 行里 `Failures: 0, Errors: 0`；契约腿日志尾行 `失败 0`、`echo "exit=$?"` 打 0。**这一步任何一格红都不要往下走**：CDP 腿是在"编译 + 契约都绿"的前提上再证一层，前提坏了它只会给一堆同源的红。

后端起来是助手的活，Electron 主进程重启是用户的手——本任务要的 dev 应用（`:9223` 可连、窗口可见、渲染层在 `localhost:5173`）由用户起，Step 3 的前置自检负责判新旧（看 `:9223` 那个进程的实际启动时刻，不看文件 mtime）。

- [ ] **Step 2: 驱动骨架（退出码、`check()`、`blocked()`、探针、点击、打字、下拉）**

`tmp/p8c-ui.mjs` 第一块。**每条腿都以 `await check(...)` 记账**：跑完整一轮时「通过 x / 失败 y」的 `x+y` 必须等于 20，少一条就是有一条腿没被记账（要么写漏了，要么中途抛错）。唯一允许的例外是**前置收手**——那种情况下尾行之前一定有一行「前置不满足（exit 2/4）」，读日志时先看那一行再看 `x+y`，**不许**把"只跑到第 6 条"读成"另外 14 条没问题"。

```js
// tmp/p8c-ui.mjs —— P8/B6 群成员分析：CDP 界面腿 20 条（spec §13 的第四档）
// 退出码：0=通过 20 / 失败 0；1=断言红（产品）；2=后端与布景前置；4=窗口与渲染层前置。
// 用法：SCRM_USER=admin SCRM_PASS=admin123 node tmp/p8c-ui.mjs 2>&1 | tee tmp/p8c-ui.log
//       （要在仓库根跑：P8Purge 与截图路径都按 cwd 相对；dev 应用已由用户起好、窗口可见）
// 全程不改产品代码；三条安全线见上面「技术要点」第 4 条：不点刷新成员、不点导出本群、导出所选只在勾满 51 时点。
import { openPage } from './cdp.mjs'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const BASE = 'http://127.0.0.1:8180'
const PORT = 9223
const USER = process.env.SCRM_USER ?? 'admin'
const PASS = process.env.SCRM_PASS ?? 'admin123'   // 本地种子口令，读码 DataSeeder.java:29；不落新秘密

const RUN = String(Date.now()).slice(-9)
const PREFIX = `12036${RUN}`
const gk = (tag) => `${PREFIX}${tag}@g.us`
const K1 = gk('1001')
const K2 = gk('1002')
const KG = gk('1003')
const BK = (i) => gk(`20${String(i).padStart(2, '0')}`)
const mk = (n) => `86138000${String(n).padStart(4, '0')}@c.us`
const ACCT_NAME = `P8C界面腿${RUN}`
const NICK = (tag) => `P8C${tag}${RUN}`                       // 唯一昵称：客户表按 updated_at 排，靠它认行
const SUPER_KEY = mk(105)
const ADMIN_KEY = mk(106)
const PHONE_MEMBER = mk(907)
const PHONE_RAW = '+86 138-0000-0907'                          // 带 + 与分隔符：归一没生效就命中不上
const PHONE_FLAT = '861380000907'
const LEAVER = mk(203)
const PROMOTED = mk(204)
const Q_KEY = mk(107)
const nowSec = Math.floor(Date.now() / 1000)

let token = null
let accountId = null
let page = null
let cleanedUp = false
let purgeResidual = null
let groupsLeftAfterPurge = null   // 由 cleanup 在 purge 之后、删账号之前填（L20 用，理由见技术要点 13）
const custIds = { A: 0, B: 0, C: 0, D: 0 }

let passN = 0
const failN = () => failures.length
const failures = []
/** 断言：只有 PASS/FAIL 两种，全部记账。expected/actual 只为红的时候好归因。 */
async function check(name, pass, expected, actual) {
  const okv = !!pass
  if (okv) { passN++; console.log(`  PASS  ${name}`) }
  else { failures.push(name); console.log(`  FAIL  ${name}  expect=${expected}  actual=${JSON.stringify(actual)?.slice(0, 260)}`) }
  return okv
}
/** 前置：抛出去由顶层按退出码收，绝不当成断言红。 */
function blocked(code, why) { const e = new Error(why); e.__exit = code; throw e }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function req(method, path, { body } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  try {
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    return await res.json()
  } catch (e) {
    return { code: -1, message: String(e).slice(0, 140) }   // 后端不可达塌成 -1：裸 reject 会把环境问题按 1 收
  }
}
const dataOf = (env) => env?.data ?? null
const rec = (env) => env?.data?.records ?? []

// ---------- 页面原读：只返回文本/属性/坐标，判据一律写在 JS 侧 ----------
const ev = (expr) => page.ev(expr)
const pOf = (sel, nth = 0) =>
  ev(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${nth}]
       ?? document.querySelector(${JSON.stringify(sel)}); return e ? { p: e.innerText ?? '' } : { gone: true } })()`)
const atOf = (sel, attr, nth = 0) =>
  ev(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${nth}]
       ?? document.querySelector(${JSON.stringify(sel)}); return e ? { a: e.getAttribute(${JSON.stringify(attr)}) } : { gone: true } })()`)
const txt = async (sel, nth = 0) => { const r = await pOf(sel, nth); return r.gone ? null : oneLine(r.p) }
/** 弹层整段的可见文本。为什么单开一件：K1/K2/KG 三只弹层共用同一个根锚点，行数列数都可能相同
 *  （K2 与 KG 的名单都是 10 行），只有群名不会撞。开下一只之前"上一只离开了没有"也用它判。
 *  上限给到 4000，且**判据一律在整段里 `includes`，日志只抄要的那一段**：空态与「实时事件时刻」那句都在
 *  筛选行之后，K1 那一档 50 行的正文就有约 3000 字——用"从头切 N 字"当判据会把句子切没，症状是永远红。 */
const dlgText = async () => oneLine(await ev(`document.querySelector('[data-p8g-dialog]')?.innerText ?? ''`).catch(() => ''), 4000)
const boolOf = (sel, name, nth = 0) =>
  ev(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${nth}]; return e ? { v: !!e[name] } : { gone: true } })()`)
const oneLine = (s, n = 200) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
/** 挂键值的锚点（`[data-p8g-group-row="k"]` 这一类）统一这样读：属性名单独传，别从选择器里切——
 *  切法既读不出 `[data-p8g-member-row]` 这种不带 `=` 的写法，也会把 `"` 的位置写死在驱动里。 */
async function attrList(attr) {
  const r = await ev(`(() => ({ a: [...document.querySelectorAll('[${attr}]')].map(x => x.getAttribute(${JSON.stringify(attr)})) }))()`)
  return r.a ?? []
}
```

点击与打字（真实输入）：

```js
/** 中心点能不能真点到：读得到且是自己 → 坐标；够不着 → {bad}；被别的节点接走 → {cov}。三种分开返回。 */
async function spot(sel, nth = 0) {
  return await ev(`(() => {
    const all = [...document.querySelectorAll(${JSON.stringify(sel)})]
    const el = all[${nth}]
    if (!el) return { why: 'gone' }
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return { why: 'zero' }
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2)
    const h = document.elementFromPoint(x, y)
    if (h && (h === el || el.contains(h))) return { x, y }
    if (!h) return { why: 'unhit' }
    return { cov: h.tagName + '|' + (h.getAttribute('data-slot') || h.getAttribute('title') || '') }
  })()`)
}
/** 点一下：轮询到"点得到"为止。gone/unhit/zero 是布景与现场（4），被接走是缺陷（断言红）。 */
async function click(sel, label, { nth = 0, ms = 12000 } = {}) {
  const until = Date.now() + ms
  for (;;) {
    const s = await spot(sel, nth)
    if (s.x) {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: s.x, y: s.y })
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: s.x, y: s.y, button: 'left', clickCount: 1, buttons: 1 })
      await sleep(40)
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: s.x, y: s.y, button: 'left', clickCount: 1, buttons: 0 })
      return
    }
    if (s.cov) { await check(`${label}：中心点被别的东西接走`, false, '中心点落在目标自己身上', s.cov); return }
    if (Date.now() > until) blocked(4, `点不到「${label}」：轮询 ${ms}ms 仍是 ${s.why}；此刻 hash=${await ev('location.hash')}，正文开头=${JSON.stringify(oneLine(await ev('document.body.innerText'), 160))}`)
    await sleep(150)
  }
}
/** 按**可见文本**找可点元素并真实点击：给没有 `data-p8g-*` 锚点的那几颗用——侧栏「客户」（Step 5）、
 *  客户表那一行（Step 5/8）、分页的「下一页 / 上一页」（Step 6）。形状照 `tmp/p18-timeline.mjs:153-167`
 *  那条实测过的腿：候选里取**嵌套最深**的那一个（外层容器的 innerText 也含同样的字，点它会点到整页），
 *  其余分档同 `click`：gone/zero/unhit 是布景（4），被接走是缺陷（记红）。
 *  `tag` 允许逗号列表（先例用 `'a,button'`）。不能直接拼成 `body a,button`——querySelectorAll 会把它
 *  读成「body 里的 a」+「页面上任意 button」两组，于是导航之外的一颗按钮会被选中；列表里每个 tag
 *  各自带 scope，再按节点去重。 */
async function clickText(text, { scope = 'body', tag = 'button', label, ms = 12000 } = {}) {
  const sels = tag.split(',').map((t) => `${scope} ${t.trim()}`)
  const until = Date.now() + ms
  for (;;) {
    const s = await ev(`(() => {
      const flat = ${JSON.stringify(sels)}.flatMap((x) => [...document.querySelectorAll(x)])
      const cands = flat.filter((x, i) => flat.indexOf(x) === i)
        .filter((x) => (x.innerText || '').trim().includes(${JSON.stringify(text)}))
      const el = cands.length ? cands.reduce((a, b) => (a.contains(b) ? b : a)) : null
      if (!el) return { why: 'gone', n: cands.length }
      el.scrollIntoView({ block: 'center' })
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return { why: 'zero' }
      const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2)
      const h = document.elementFromPoint(x, y)
      if (h && (h === el || el.contains(h))) return { x, y, n: cands.length }
      if (!h) return { why: 'unhit' }
      return { cov: h.tagName + '|' + (h.getAttribute('data-slot') || '') } })()`)
    if (s.x) {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: s.x, y: s.y })
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: s.x, y: s.y, button: 'left', clickCount: 1, buttons: 1 })
      await sleep(40)
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: s.x, y: s.y, button: 'left', clickCount: 1, buttons: 0 })
      if (s.n > 1) console.log(`  [点击候选] 「${label ?? text}」有 ${s.n} 个文本候选，取最深的那一个`)
      return
    }
    if (s.cov) { await check(`${label ?? text}：中心点被别的东西接走`, false, '点在自己身上', s.cov); return }
    if (Date.now() > until) blocked(4, `找不到「${label ?? text}」那一颗（${s.why}，文本候选 ${s.n ?? 0} 个）`)
    await sleep(150)
  }
}
const keyEvents = async (key, code, vk, modifiers = 0, text) => {  const p = { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers }
  if (text) Object.assign(p, { text, unmodifiedText: text })
  await page.send('Input.dispatchKeyEvent', p)
  await sleep(45)
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers })
}
const typeAscii = async (s) => {
  for (const ch of s) {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch })
    await sleep(20)
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
    await sleep(20)
  }
}
const clearFocused = async () => {
  for (let i = 0; i < 6; i++) {
    if ((await ev(`(document.activeElement && document.activeElement.value) || ''`)) === '') return
    await keyEvents('a', 'KeyA', 65, 2)
    await sleep(60)
    await keyEvents('Backspace', 'Backspace', 8)
    await sleep(140)
  }
}
/** 条件轮询。**到点返回 `null` 并打一行 `[等待超时]`，不抛错**：抛出会让后面所有腿都没机会记账，
 *  日志尾行的 x+y 就不再是 20（Step 2 开头那条记账纪律）。真的前置（路由、那一节在不在）由调用处
 *  自己 `if (!v) blocked(...)`，读数为空的现场交给那一条腿的 `check` 去记红。 */
const poll = async (ms, fn, label) => {
  const until = Date.now() + ms
  for (;;) {
    const v = await Promise.resolve(fn()).catch(() => null)
    if (v) return v
    if (Date.now() > until) { console.log(`  [等待超时] ${label}`); return null }
    await sleep(200)
  }
}
```

页内 fetch 探针（技术要点 6）：

```js
async function installSpy() {
  await ev(`(() => {
    if (window.__P8C?.hooked) return
    window.__P8C = { hooked: true, reqs: [] }
    const orig = window.fetch
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input?.url ?? ''
      const method = (init?.method ?? (typeof input === 'object' ? input?.method : undefined) ?? 'GET').toUpperCase()
      if (url.includes('/api/')) window.__P8C.reqs.push({ method, url, t: Date.now() })
      return orig(input, init)
    }
  })()`)
}
const spyReqs = async () => (await ev('window.__P8C?.reqs ?? []')) ?? []
/** 每次"只打一枪"的判据之前清空计数：探针是全程累积的，不清就没法把这一腿的请求和上一腿的分开。 */
const resetSpy = async () => { await ev('if (window.__P8C) window.__P8C.reqs = []') }
const countUrl = async (needle) => (await spyReqs()).filter((r) => String(r.url).includes(needle)).length
const distinctUrl = async (needle) => [...new Set((await spyReqs()).filter((r) => String(r.url).includes(needle)).map((r) => String(r.url)))].length
```

radix 下拉（照 `tmp/p7a-d12probe.mjs:215-300`，按 trigger 选择器寻址，`scope` 固定 `[data-p8g-dialog]`）：

```js
const CONTENT = '[data-slot="select-content"]'
async function countSel(sel) { return await ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`) }
async function pickIn(triggerSel, want, scope = '[data-p8g-dialog]') {
  const base = await countSel(CONTENT)
  const trig = `${scope} ${triggerSel}`
  const s = await spot(trig)
  if (!s.x) return s.cov ? { code: 'covered', why: s.cov } : { code: s.why === 'gone' ? 'notrig' : 'unhit' }
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: s.x, y: s.y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: s.x, y: s.y, button: 'left', clickCount: 1, buttons: 1 })
  await sleep(40)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: s.x, y: s.y, button: 'left', clickCount: 1, buttons: 0 })
  const ITEM = `${CONTENT}[data-state="open"] [data-slot="select-item"]`
  const read = () => ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(ITEM)})]
      .find(x => (x.textContent || '').includes(${JSON.stringify(want)}))
    if (!el) return { gone: true }
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2)
    const h = document.elementFromPoint(x, y)
    if (h && (h === el || el.contains(h))) return { x, y }
    if (!h) return { none: true }
    return { cov: h.tagName + '|' + (h.getAttribute('data-slot') || '') } })()`)
  let prev = null
  const got = await poll(4000, async () => {
    const cur = await read()
    const settled = !!(cur.x && prev && cur.x === prev.x && cur.y === prev.y)
    prev = cur
    return settled ? cur : null
  }, `下拉「${want}」定稳`).catch(() => null)
  if (!got) return prev?.gone ? { code: 'notfound' } : prev?.none ? { code: 'unhit' }
    : prev?.cov ? { code: 'covered', why: prev.cov } : { code: 'stuck', why: '四秒内没有连续两拍同位置' }
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: got.x, y: got.y, button: 'left', clickCount: 1, buttons: 1 })
  await sleep(40)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: got.x, y: got.y, button: 'left', clickCount: 1, buttons: 0 })
  const back = await poll(4000, async () => ((await countSel(CONTENT)) <= base ? 1 : null), '浮层退场').catch(() => null)
  return back ? { code: 'ok' } : { code: 'stuck', why: `选完「${want}」后浮层没退场：基线 ${base}，现在 ${await countSel(CONTENT)}` }
}
/** 三种"够不着"→ 前置 4（结构/清单与锚点表不符，驱动走不下去）；两种"点了没生效"→ 断言红。
 *  `scope` 默认是弹层；抽屉里那颗账号下拉（`[data-p8g-account]`）要传 `[data-p8g-section]`。 */
async function pickOrStop(triggerSel, want, label, scope = '[data-p8g-dialog]') {
  const r = await pickIn(triggerSel, want, scope)
  if (r.code === 'ok') return
  if (r.code === 'notrig') blocked(4, `${label}：那颗下拉不存在（渲染层结构与 Task 16 锚点表不符）`)
  if (r.code === 'notfound') blocked(4, `${label}：清单里没有「${want}」这一项（下拉内容与 Task 16 不符）`)
  if (r.code === 'unhit') blocked(4, `${label}：那一项在 DOM 里但取不到中心点（窗口尺寸/可见性布景不行，空样本不算缺陷）`)
  await check(`${label}`, false, '选中并退场', `${r.code}：${r.why ?? ''}`)
}
```

截图留证：

```js
async function screenshot(file) {
  const r = await page.send('Page.captureScreenshot', { format: 'png' })
  if (r?.data) { writeFileSync(file, Buffer.from(r.data, 'base64')); console.log(`  [截图] ${file}`) }
}
```

- [ ] **Step 3: 前置自检（CDP + 可见性 + 宿主面；版本闸不在这里，见技术要点 13 ①）**

```js
// ① 后端活着 + 登录（→ die 2）
const health = await req('GET', '/api/health')
if (health.code !== 0) blocked(2, `后端不可达（/api/health 回 ${JSON.stringify(health).slice(0, 120)}）：先跑 Step 1 那段起 jar`)
const login = await req('POST', '/api/auth/login', {
  body: { inviteCode: 'DEMO0001', username: USER, password: PASS, deviceId: `p8c-ui-${RUN}` }
})
token = login?.data?.accessToken
if (!token) blocked(2, `登录没过：${JSON.stringify(login).slice(0, 180)}`)

// ② 版本闸挪到 Step 4 的 4.4（技术要点 13）：`GET /groups` 的 `accountId` 是必填参数
//    （读码 `GroupMemberController.java:48-54`），而且它要**库里已经有一行群**才读得出 GroupVO 的键——
//    刚建出来的测试账号名下是空的，`records[0]` 为 undefined，那一格会把"旧 jar"和"还没写库"混成同一个红。
//    所以这里只做窗口/宿主面，jar 的形状等 K1 落库之后再判。

// ③ CDP + 可见性 + 宿主面（→ die 4）
page = await openPage(PORT, 'localhost:5173')
if ((await ev('document.visibilityState')) !== 'visible') blocked(4, '开发窗口不可见，点击不会被受理：先跑 tmp/p6f-raise.ps1')
await page.send('Emulation.setFocusEmulationEnabled', { enabled: true })
const faces = await ev(`(() => ({ b: typeof window.scrm?.group?.build, e: typeof window.scrm?.group?.export,
  s: typeof window.scrm?.group?.onState }))()`)
console.log(`[前置读数 1] window.scrm.group = build:${faces.b} export:${faces.e} onState:${faces.s}`)
if (faces.b !== 'function' || faces.e !== 'function') blocked(4, 'preload 的 group 面没挂上（主进程是旧的：看 :9223 那个进程的实际启动时刻，不是文件 mtime）')
console.log(`[前置读数 2] 渲染层地址 = ${await ev('location.href')}，hash = ${await ev('location.hash')}`)
```

那三行 `[前置读数 N]`（1 宿主面、2 渲染层地址、3 jar 是否含 V13 读数）是验收文档 §1 的来源，也是"红格归谁"的裁判依据——把它们抄进文档，别只写"跑过了"。

- [ ] **Step 4: 布景（只走 HTTP，顺序按 §17.1 的三条硬约束）**

```js
// 4.1 测试账号：只在自己的行上把状态位置成在线（技术要点 3）
const acct = await req('POST', '/api/platform-accounts', {
  body: { platformType: 1, name: ACCT_NAME, viewId: `p8c-${RUN}`, remark: 'P8C 界面腿临时账号（跑完自删）' }
})
accountId = dataOf(acct)?.id
if (!accountId) blocked(2, `建测试账号失败：${JSON.stringify(acct).slice(0, 180)}`)
const st = await req('PATCH', `/api/platform-accounts/${accountId}/status`, { body: { status: 1 } })
if (st.code !== 0) blocked(2, `把测试账号置为在线失败：${JSON.stringify(st).slice(0, 160)}`)

// 4.2 客户 A/B/D 早于批次（约束①）
async function newCustomer(tag, body) {
  const r = await req('POST', '/api/customers', { body: { platformType: 1, nickname: NICK(tag), ...body } })
  const id = dataOf(r)?.id
  if (!id) blocked(2, `建客户 ${tag} 失败：${JSON.stringify(r).slice(0, 180)}`)
  return id
}
custIds.A = await newCustomer('甲', { openId: mk(101) })                      // 只靠 member_key 命中
custIds.B = await newCustomer('乙', { openId: mk(500) })
custIds.D = await newCustomer('丁', { openId: `p8cuiD${RUN}@c.us` })          // 谁都命中不上

// 4.3 批次写入
async function batch(body) {
  const r = await req('POST', '/api/group-members/batch', { body: { accountId, ...body } })
  if (r.code !== 0) blocked(2, `布景写库没成（${JSON.stringify(r).slice(0, 200)}）`)
  return r.data
}
const part = (n, over = {}) => ({
  memberKey: mk(n), phone: `+86138000${String(n).padStart(4, '0')}`, displayName: `成员${n}`, roleType: 'member', ...over
})
const A1 = Array.from({ length: 51 }, (_, i) => 101 + i)                       // 101..151
await batch({
  groups: [{ chatKey: K1, title: 'P8C甲群' }],
  snapshot: { chatKey: K1, participants: A1.map((n) => part(n, n === 105 ? { roleType: 'super' } : n === 106 ? { roleType: 'admin' } : {})) }
})

// 4.4 版本闸（Task 14 技术要点 1 同一条纪律）：没有 8b 的 V13 那两列就先修构建，别在界面腿里数红格。
//     它必须排在 K1 那一发**之后**：`accountId` 是必填参数，且 `records[0]` 要有行才读得出 GroupVO 的键。
//     K1 已经落库，所以这里判的是"jar 的形状"，不是"库有没有数据"；下面的 K2/KG/BK 与 C 都还没写，
//     闸门坏了要靠 cleanup 的 `--prefix` 把 K1 那 51 行收走（R44），不留残。
const probe = await req('GET', `/api/group-members/groups?accountId=${accountId}&page=1&size=1`)
const anyGroup = rec(probe)[0]
const hasV13 = !!anyGroup && 'lastCoverage' in anyGroup && 'lastReconcileReason' in anyGroup
console.log(`[前置读数 3] jar 含 8b 的 V13 读数 = ${hasV13}（GroupVO 键：${anyGroup ? Object.keys(anyGroup).join(',') : `库里没有群：${JSON.stringify(probe).slice(0, 120)}`}）`)
if (!hasV13) blocked(2, '后端不含 Task 8b 的 V13 读数：jar 是旧构建？先 ./mvnw -DskipTests package 再重启（Flyway 只在启动时跑）')

// 4.5 K2 / KG / BK：K2 的快照与事件**分两批**（约束③），KG 两发把闸踩下去
const A2 = [101, 907, 203, 204, 210, 211, 212, 213, 214, 215]                  // 10 人（§17.1）
await batch({
  groups: [{ chatKey: K2, title: 'P8C乙群（K2）' }],
  snapshot: { chatKey: K2, participants: A2.map((n) => part(n, n === 907 ? { phone: PHONE_RAW } : {})) }
})
// 约束③：事件单独一批。同批里快照最后跑，会把 left 投影掉的在场性盖回 1。
await batch({
  groups: [{ chatKey: K2, title: 'P8C乙群（K2）' }],
  events: [
    { chatKey: K2, memberKey: LEAVER, actorKey: null, actorName: null, eventType: 'left',
      occurredAtEpochSec: nowSec - 120, dedupKey: `p8c${RUN}l203`, source: 'system_message',
      rawType: 'system', rawSubtype: 'revoke', bodySnapshot: '这个号码退出了群组' },
    { chatKey: K2, memberKey: PROMOTED, actorKey: mk(101), actorName: '群主甲', eventType: 'promoted',
      occurredAtEpochSec: nowSec - 60, dedupKey: `p8c${RUN}p204`, source: 'live_event',
      rawType: null, rawSubtype: null, bodySnapshot: null }
  ]
})
await batch({ groups: [{ chatKey: KG, title: 'P8C闸下群' }],
  snapshot: { chatKey: KG, participants: [101, 302, 303, 304, 305, 306, 307, 308, 309, 310].map(part) } })
const gate = await batch({ groups: [{ chatKey: KG, title: 'P8C闸下群' }],
  snapshot: { chatKey: KG, participants: [101, 302, 303, 304].map(part) } })
console.log(`[布景] KG 第二发：coverage=${gate.coverage} reason=${gate.reason} reconciled=${gate.reconciled}`)
if (gate.reason !== 'coverage_too_low') blocked(2, `覆盖率闸没按预期拦下（期望 coverage_too_low，实得 ${gate.reason}）：8b 的闸先坏了，界面腿判不出什么`)
for (let i = 1; i <= 51; i++) {
  await batch({ groups: [{ chatKey: BK(i), title: `P8C乙群${i}` }], snapshot: { chatKey: BK(i), participants: [part(500)] } })
}

// 4.6 客户 C 晚于 K2 的快照（约束②：它是 L17 的假绿开关）
custIds.C = await newCustomer('丙', { openId: `p8cuiC${RUN}@c.us`, phone: PHONE_FLAT })
```

`gate.reason` 那一格是**前置**不是断言：闸本身归 Task 8b/14，界面腿只负责"闸拦下之后界面上那句话有没有出来"。闸没拦就继续跑，只会得到一排同源的假红——所以在这里按 2 收手。

- [ ] **Step 5: 抽屉五腿（L1–L5）**

```js
// reload 之后装探针（技术要点 6：顺序反了探针会被自己冲掉）。
// 这一跳故意"发出去就不管"：`location.reload()` 会把当前 execution context 拆掉，
// 所以等待写在**调用侧**、并且每次读数都 `.catch` —— reload 期间 `ev()` 抛的是
// "Execution context was destroyed"，那不是产品缺陷也不是布景坏，是刷新本身的过程（R44 之外的第三种来路）。
await ev(`setTimeout(() => { location.hash = '#/customers'; location.reload() }, 0)`).catch(() => {})
const reloaded = await poll(30000, async () => {
  const n = await ev(`document.querySelectorAll('a[href]').length`).catch(() => 0)
  return n > 3 ? n : null
}, 'reload 之后渲染层回来')
if (!reloaded) {
  const head = await ev(`document.body ? document.body.innerText : ''`).catch(() => '(上下文还没回来)')
  blocked(4, `reload 后 30 秒没回到应用：正文开头=${JSON.stringify(oneLine(head, 160))}——若是登录页，说明 dev 应用要重新登录（用户的手），界面腿不代登`)
}
await installSpy()
await resetSpy()   // 探针是全程累积的：从这一刻起只计 A 抽屉这一次开窗，L4 才有"一次"可判

// 「客户所在群」那一族的取数事实：openDrawer 的切档定稳判据和 L4 用的是同一个口径，
// 所以这两个谓词必须在 openDrawer 之前定义（函数体在 `await openDrawer('甲')` 那一线就被执行，
// 把 `const` 留在后面会撞上 TDZ ReferenceError）。
const custReqs = async () => (await spyReqs()).filter((r) => String(r.url).includes('/api/group-members/customer/'))
const mineUrl = (r) => String(r.url).includes(`accountId=${accountId}`)

/** 打开某位客户的抽屉。两句都不猜地址：先按可见文本点「客户」、等 hash 到位，再按唯一昵称点那一行、
 *  等「所在群」那一节挂上。形状照 `tmp/p18-timeline.mjs:217-219` 那条实测过的腿——
 *  `scope:'body'` 是必须的：客户行与那一节都在弹层之外，默认作用域 `[data-p8g-dialog]` 一条也找不到。
 *  （客户表没有 data-* 锚点，读码 `CustomersPage.tsx` 未挂，所以按昵称文本认行；四位客户都按
 *  `updated_at DESC` 排在第 1 页，`PAGE_SIZE=10`，读码 `CustomerService.java:51-52`。） */
async function openDrawer(tag) {
  await clickText('客户', { scope: 'body', tag: 'a,button', label: '侧栏「客户」' })
  if (!(await poll(10000, async () => ((await ev('location.hash')).includes('/customers') ? 1 : null), '路由到客户页'))) {
    blocked(4, `点了「客户」没到 /customers：此刻 hash=${await ev('location.hash').catch(() => '?')}`)
  }
  await clickText(NICK(tag), { scope: 'body', tag: 'tr', label: `客户行「${NICK(tag)}」` })
  if (!(await poll(12000, async () => ((await countSel('[data-p8g-section]')) > 0 ? 1 : null), `${NICK(tag)} 的「所在群」那一节`))) {
    blocked(4, `抽屉里没有「所在群」那一节（${NICK(tag)}）：Task 16 的挂载或锚点坏了，20 条腿没有一条能在这里往下走`)
  }
  // 账号对齐：候选 ≥2 时那一节才挂下拉（读码锚点表 `[data-p8g-account]` 那行），而默认落在哪一档由
  // `节内下拉 > selectedId > candidates[0]` 决定（Task 16 技术要点 1）——用户真机那条 WhatsApp 只要在线，
  // 它就可能排在前面，于是 L1 数到空集。那是**假红**，不是缺陷，所以这里不判红也不跳过，只做一件事：
  // 把下拉切到本轮的测试账号，并把"切过"这件事写进日志（技术要点 13）。选项文本是 `a.name`
  //（Task 16 那段 `candidates.map((a) => <SelectItem …>{a.name}</SelectItem>)`），
  // 触发器里的 `<SelectValue/>` 渲染的是同一个值（同一块 `candidates.length > 1 && <Select>` 里），所以"现在停在哪一档"是能读的。
  if ((await countSel('[data-p8g-account]')) > 0) {
    const shown = await txt('[data-p8g-account]')
    if (shown && shown.includes(ACCT_NAME)) {
      console.log(`  [布景读数] 下拉本来就停在「${ACCT_NAME}」：不切档，也就不该多出一枪`)
    } else {
      const mineBefore = (await custReqs()).filter(mineUrl).length
      await pickOrStop('[data-p8g-account]', ACCT_NAME, '切到本轮测试账号', '[data-p8g-section]')
      console.log(`  [布景读数] 账号下拉从「${shown ?? '(读不到)'}」切到「${ACCT_NAME}」：本轮数据只挂在这一档上`)
      // 切档会让那一节作废现场重取（读码 Task 16 技术要点 7 的那个 `useEffect`），于是"画稳"有客观证人：
      // 本轮账号的取数必然多出一枪。原来的 `countSel(...) >= 0` 是恒真条件，它什么都不等。
      // 12 秒多不出枪不在这里按 4 收手——那是 16 的缺陷（切档没作废现场），交给 L1 去红并归因，
      // 界面腿不替产品判定"切档不用重取"。
      const refetched = await poll(12000, async () =>
        ((await custReqs()).filter(mineUrl).length > mineBefore ? 1 : null), '切档 ⇒ 本轮账号重新取数')
      if (!refetched) {
        console.log(`  [布景读数] 切档后 12 秒没有为「${ACCT_NAME}」重新取数：L1 若数到旧账号那三行，归因 16 的切档作废没生效`)
      }
    }
    // 定稳判据：取数枪数与行数列在 450ms 里两拍都不变。只读一次会把"正在换数据"读成"数据就这样"。
    const settled = await poll(12000, async () => {
      const q1 = (await custReqs()).length
      const n1 = await countSel('[data-p8g-group-row]')
      await sleep(450)
      return q1 === (await custReqs()).length && n1 === (await countSel('[data-p8g-group-row]'))
        ? `${n1} 行 / ${q1} 枪` : null
    }, '「所在群」那一节两拍定稳')
    if (!settled) blocked(4, `「所在群」那一节 12 秒定不下来（行数列或取数枪数两拍都对不上）：界面腿没有稳定现场可读`)
  }
}
await openDrawer('甲')
const A_KEYS = (await attrList('data-p8g-group-row')).filter((k) => k && k.startsWith(PREFIX))
await check('L1 A 的所在群键集 = {K1,K2,KG}',
  A_KEYS.length === 3 && [K1, K2, KG].every((k) => A_KEYS.includes(k)),
  [K1, K2, KG].join(','), A_KEYS.join(','))

const copyOf = async (key) => { const r = await pOf(`[data-p8g-group-row="${key}"]`); return oneLine(r.gone ? '' : r.p, 600) }
const c2 = await copyOf(K2)
const cg = await copyOf(KG)
await check('L2 两个数分开写：K2 在群 9 / 快照 10，KG 在群 10 / 快照 10',
  c2.includes('在群 9 · 上次快照 10 · 快照于') && /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(c2)
  && cg.includes('在群 10 · 上次快照 10'),
  'K2「在群 9 · 上次快照 10 · 快照于 <日期时间>」+ KG「在群 10 · 上次快照 10」', { K2: c2, KG: cg })

await click(`[data-p8g-check="${K1}"]`, '勾选 K1')
await click(`[data-p8g-check="${KG}"]`, '勾选 KG')
const btnTxt2 = await poll(6000, async () => {
  const t = await txt('[data-p8g-export-selected]')
  return t?.includes('导出所选（2）') ? t : null
}, '按钮文案跟进到（2）').catch(() => null)
await click(`[data-p8g-check="${K1}"]`, '取消勾选 K1')
await click(`[data-p8g-check="${KG}"]`, '取消勾选 KG')
const back = await poll(6000, async () => {
  const t = await txt('[data-p8g-export-selected]')
  const d = await boolOf('[data-p8g-export-selected]', 'disabled')
  return t?.includes('导出所选（0）') && d.v === true ? 1 : null
}, '清空后回到（0）且 disabled').catch(() => null)
await check('L3 勾选数进文案、清空后按钮 disabled',
  !!btnTxt2 && !!back, '「导出所选（2）」→「导出所选（0）」且 disabled', { btnTxt2, back, disabled: await boolOf('[data-p8g-export-selected]', 'disabled') })

// L4 的窗口 = 上面那次 `resetSpy()` 到此刻。判据分两半，因为这一窗里可能有**两档账号**各打一枪：
// openDrawer 里若切过下拉，切档会作废现场并重取（读码 Task 16 技术要点 7 那个 `useEffect`），
// 那一枪挂的是另一个 accountId，不是本轮这一档的重复取数。
// 原始次数只打印不判：它随 StrictMode 的挂载次数浮动（技术要点 4），去重 URL 才是稳定的那一级。
const custUrls = await custReqs()
const mine = [...new Set(custUrls.filter(mineUrl).map((r) => String(r.url)))]
const others = [...new Set(custUrls.filter((r) => !mineUrl(r)).map((r) => String(r.url)))]
await check('L4 本轮账号只读一次且 URL 带 accountId（切档那一枪算别人家的）',
  mine.length === 1 && others.length <= 1,
  '本轮 accountId 去重 URL = 1 且含 accountId；其他账号 ≤ 1',
  { mine: mine.map((u) => oneLine(u, 120)), others: others.map((u) => oneLine(u, 120)), raw: custUrls.length })

const finals = await countSel('[data-p8g-section] [data-p8g-final]')
const areas = await countSel('[data-p8g-section] [data-p8g-area]')
await check('L5 界面上不出「已解散/已退出」，也不出三档短徽标（三行都在才算读到）',
  finals === 0 && areas === 0 && A_KEYS.length === 3, '0 / 0 / 3 行', { finals, areas, rows: A_KEYS.length })
```

L5 的"三件同时成立"是有意的：只看 `finals === 0` 会被"三行根本没画出来"顶替成绿——那条纪律就是 memory 里"生效了 vs 什么都没做"的界面版。

- [ ] **Step 6: K1 弹层七腿（L6–L12）**

```js
await resetSpy()   // L7 的窗口 = 开这一只弹层到读数为止。探针是全程累积的，不清就成了整场的累计（技术要点 6）
await click(`[data-p8g-open="${K1}"]`, 'K1「查看群成员」')
if (!(await poll(12000, async () => ((await dlgText()).includes('P8C甲群') ? 1 : null), 'K1 弹层挂上且标题是「P8C甲群」'))) {
  blocked(4, `点了「查看群成员」12 秒，弹层里没有「P8C甲群」：Task 16 的 Dialog 没开起来（或开成了上一只），L6–L12 没有一条可判。此刻弹层文本开头=${JSON.stringify((await dlgText()).slice(0, 120))}，抽屉里仍可读 ${await countSel('[data-p8g-group-row]')} 行`)
}
await poll(15000, async () => ((await countSel('[data-p8g-member-row]')) > 0 ? 1 : null), '成员名单画出来了')

const heads = await ev(`(() => ({ a: [...document.querySelectorAll('[data-p8g-dialog] thead th')].map(x => x.innerText.trim()) }))()`)
const firstKey = (await attrList('data-p8g-member-row'))[0]
await check('L6 名单十列逐字 + 首行键属于本轮夹具',
  heads.a.join('|') === ['名称', '手机号', '角色', '是否在群', '进群时间', '进群数', '退群时间', '退出方式', '最近发言', '发言数'].join('|')
  && String(firstKey).endsWith('@c.us') && firstKey.startsWith('86138000'),
  '十列表头一字不差 + 首行是本轮成员键', { heads: heads.a, firstKey })

await check('L7 未激活的流水 tab 不取数，名单只打一枪',
  (await distinctUrl('/group/members')) === 1 && (await countUrl('/group/events')) === 0,
  'members 去重 URL = 1 且 events 次数 = 0',
  { members: await distinctUrl('/group/members'), events: await countUrl('/group/events'), raw: await countUrl('/group/members') })

await pickOrStop('[data-p8g-f-role]', '群主', 'L8 角色筛到群主')
await poll(8000, async () => ((await countSel('[data-p8g-member-row]')) === 1 ? 1 : null), '角色筛选出结果').catch(() => null)
const roleKeys = await attrList('data-p8g-member-row')
await check('L8 角色=群主 ⇒ 恰一行且是 SUPER_KEY',
  roleKeys.length === 1 && roleKeys[0] === SUPER_KEY, SUPER_KEY, roleKeys)
await pickOrStop('[data-p8g-f-role]', '全部角色', 'L8b 角色放回全部')
await poll(8000, async () => ((await countSel('[data-p8g-member-row]')) === 50 ? 1 : null), '放回全部后回到第一页 50 行').catch(() => null)

await click('[data-p8g-f-q]', '搜索框')
await clearFocused()
await typeAscii('861380000107')
await poll(9000, async () => {
  const k = await attrList('data-p8g-member-row')
  return k.length === 1 && k[0] === Q_KEY ? 1 : null
}, `搜「861380000107」出一行 ${Q_KEY}`).catch(() => null)
const hit = await attrList('data-p8g-member-row')
await typeAscii('99')
await poll(9000, async () => ((await countSel('[data-p8g-member-row]')) === 0 ? 1 : null), '追加 99 之后空态').catch(() => null)
const emptyDlg = await dlgText()
await check('L9 搜索命中一行；再补两位数字出空态',
  hit.length === 1 && hit[0] === Q_KEY && emptyDlg.includes('这个筛选条件下没有人。'),
  `1 行 ${Q_KEY} ⇒ 空态文案`, { hit, tail: oneLine(emptyDlg.slice(-160)) })
await clearFocused()

const p1 = await poll(9000, async () => { const k = await attrList('data-p8g-member-row'); return k.length === 50 ? k : null }, '第 1 页 50 行').catch(() => [])
const foot1 = await txt('[data-p8g-member-page]')
```

「下一页 / 上一页」没有 `data-p8g-*` 锚点（Task 16 的 `Pager` 只在挂着 `data-p8g-member-page` / `data-p8g-event-page` 的那个页脚 `<span>` 上打了锚，按钮本身没有），所以走 Step 2 里那件 `clickText`——它同时服务 Step 5 的侧栏「客户」与昵称行，**这就是为什么它定义在 Step 2 而不是这里**。

L10 的键集代数与其余三腿：

```js
await clickText('下一页', { label: '下一页' })
const p2 = await poll(9000, async () => { const k = await attrList('data-p8g-member-row'); return k.length >= 1 ? k : null }, '第 2 页出行了').catch(() => [])
const foot2 = await txt('[data-p8g-member-page]')
const inter = p2.filter((k) => p1.includes(k))
const union = new Set([...p1, ...p2])
await check('L10 51 人分两页：两页不相交、并集 51、页脚文案跟进',
  p1.length === 50 && p2.length === 1 && inter.length === 0 && union.size === 51 && foot2 === '第 2 / 2 页 · 共 51 人',
  '50 + 1，交集空，并集 51，「第 2 / 2 页 · 共 51 人」', { p1: p1.length, p2: p2.length, inter, foot1, foot2 })
await clickText('上一页', { label: '上一页' })
await poll(8000, async () => ((await txt('[data-p8g-member-page]'))?.startsWith('第 1 / 2 页') ? 1 : null), '回到第 1 页').catch(() => null)

const refreshDisabled = await boolOf('[data-p8g-refresh]', 'disabled')
const faces2 = await ev(`(() => ({ b: typeof window.scrm?.group?.build, e: typeof window.scrm?.group?.export }))()`)
await check('L11 宿主面是函数、「刷新成员」没被禁用（只读不点：技术要点 4）',
  faces2.b === 'function' && faces2.e === 'function' && refreshDisabled.v === false,
  'build/export 均为 function 且 refresh.disabled=false', { faces2, refreshDisabled })
await screenshot('tmp/p8c-dialog.png')

await click('[data-p8g-close]', '弹层「关闭」')
await poll(8000, async () => ((await countSel('[data-p8g-dialog]')) === 0 ? 1 : null), '弹层节点离开 DOM').catch(() => null)
const pe = await ev(`getComputedStyle(document.body).pointerEvents`)
const gone = await countSel('[data-p8g-dialog]')
await check('L12 关掉之后节点不残留、body 的 pointer-events 也还回来',
  gone === 0 && pe !== 'none', 'dialog 不在 + pointerEvents≠none', { gone, pe })
```

- [ ] **Step 7: K2 / KG 弹层四腿（L13–L16）**

```js
await click(`[data-p8g-open="${K2}"]`, 'K2「查看群成员」')
if (!(await poll(12000, async () => ((await dlgText()).includes('P8C乙群（K2）') ? 1 : null), 'K2 弹层挂上且标题对得上'))) {
  blocked(4, `K2 的弹层没开成，或开着的还是上一只没关掉的：弹层文本开头=${JSON.stringify((await dlgText()).slice(0, 120))}（L13–L15 无从判）`)
}
await click('[data-p8g-tab-events]', 'tab「进退流水」')
await poll(12000, async () => ((await countSel('[data-p8g-event-row]')) >= 2 ? 1 : null), '流水出两行').catch(() => null)

const eHeads = await ev(`(() => ({ a: [...document.querySelectorAll('[data-p8g-dialog] thead th')].map(x => x.innerText.trim()) }))()`)
const eRows = await ev(`(() => ({ a: [...document.querySelectorAll('[data-p8g-event-row]')].map(tr =>
  [...tr.querySelectorAll('td')].map(td => (td.innerText || '').trim())) }))()`)
const oneLineNote = await dlgText()
const leftRow = eRows.a.find((r) => r.includes(LEAVER))
const promoRow = eRows.a.find((r) => r.includes(PROMOTED))
await check('L13 流水五列 + 两条事件词 + 来源两词 + 那句时刻说明',
  eHeads.a.join('|') === ['时间', '事件', '目标人', '操作人', '来源'].join('|')
  && leftRow?.[1] === '自行退群' && leftRow?.[4] === '系统消息'
  && promoRow?.[1] === '升为管理员' && promoRow?.[3] === '群主甲' && promoRow?.[4] === '实时事件'
  && oneLineNote.includes('来源为「实时事件」的行，时间是主进程收到它的时刻'),
  '五列表头 + left/promoted 两行 + LIVE_EVENT_TIME_NOTE',
  { heads: eHeads.a, leftRow, promoRow, noteHit: oneLineNote.includes('来源为「实时事件」的行，时间是主进程收到它的时刻') })

await click('[data-p8g-tab-members]', 'tab「成员名单」')
await poll(12000, async () => ((await countSel('[data-p8g-member-row]')) > 0 ? 1 : null), '名单回来了').catch(() => null)
await pickOrStop('[data-p8g-f-in-group]', '已退群', 'L14 只看已退群')
await poll(9000, async () => ((await attrList('data-p8g-member-row')).length === 1 ? 1 : null), '已退群只剩一行').catch(() => null)
const outKeys = await attrList('data-p8g-member-row')
const outCells = await ev(`(() => { const tr = document.querySelector('[data-p8g-member-row]')
  return { a: tr ? [...tr.querySelectorAll('td')].map(td => (td.innerText || '').trim()) : null } })()`)
await check('L14 已退群档：恰一行且是 mk(203)，退群时间非 —，退出方式「自行退群」',
  outKeys.length === 1 && outKeys[0] === LEAVER && outCells.a?.[6] && outCells.a[6] !== '—' && outCells.a[7] === '自行退群',
  `1 行 ${LEAVER} + 退群时间有值 + 自行退群`, { outKeys, cells: outCells.a })
// 事件那一腿（L15）在名单档之后回到流水：筛两次，一半有一半无
await click('[data-p8g-tab-events]', 'tab「进退流水」（第二次）')
await pickOrStop('[data-p8g-f-event]', '自行退群', 'L15a 事件筛 left')
await poll(9000, async () => ((await countSel('[data-p8g-event-row]')) === 1 ? 1 : null), '事件筛选出一行').catch(() => null)
const eOne = await ev(`(() => { const tr = document.querySelector('[data-p8g-event-row]')
  return { k: tr?.querySelectorAll('td')?.[2]?.innerText?.trim() ?? null, n: document.querySelectorAll('[data-p8g-event-row]').length } })()`)
await pickOrStop('[data-p8g-f-event]', '降为成员', 'L15b 事件筛 demoted（本轮没有）')
await poll(9000, async () => ((await countSel('[data-p8g-event-row]')) === 0 ? 1 : null), '事件空态').catch(() => null)
const eEmpty = await dlgText()
await check('L15 事件筛选两半：left 一行且目标人是 mk(203)，demoted 出空态文案',
  eOne.n === 1 && eOne.k === LEAVER && eEmpty.includes('还没有加减人的流水。事件只在账号上线且桥就绪时采集。'),
  `left⇒1 行 ${LEAVER}；demoted⇒空态`, { eOne, tail: oneLine(eEmpty.slice(-160)) })
await click('[data-p8g-close]', '弹层「关闭」（K2）')
if (!(await poll(8000, async () => ((await countSel('[data-p8g-dialog]')) === 0 ? 1 : null), 'K2 弹层离开 DOM'))) {
  blocked(4, '关掉 K2 的弹层 8 秒后根节点还在：Radix 的卸载坏了，且这时候再点 KG 会点在浮层上，L16 无法归因')
}

// L16：8b ③ 的界面证人。红就点名 8b，不许把判据放宽。
await click(`[data-p8g-open="${KG}"]`, 'KG「查看群成员」')
if (!(await poll(12000, async () => ((await dlgText()).includes('P8C闸下群') ? 1 : null), 'KG 弹层挂上且标题对得上'))) {
  blocked(4, `KG 的弹层没开成：弹层文本开头=${JSON.stringify((await dlgText()).slice(0, 120))}（L16 是 8b ③ 的界面证人，没有替补判据）`)
}
await poll(15000, async () => ((await countSel('[data-p8g-member-row]')) === 10 ? 1 : null), 'KG 名单 10 行').catch(() => null)
const note = await txt('[data-p8g-coverage-note]')
const inCol = await ev(`(() => ({ a: [...document.querySelectorAll('[data-p8g-member-row]')]
  .map(tr => tr.querySelectorAll('td')[3]?.innerText.trim()) }))()`)
await check('L16 KG 出覆盖率标注且十人全「是」〔8b ③ 界面证人：红就回 8b，不许放宽〕',
  note === '本次快照人数较上次少 60%，未做退群判定' && inCol.a.length === 10 && inCol.a.every((x) => x === '是'),
  '「本次快照人数较上次少 60%，未做退群判定」+ 10 个「是」', { note, inCol: inCol.a })
await screenshot('tmp/p8c-drawer.png')
await click('[data-p8g-close]', '弹层「关闭」（KG）')
await poll(8000, async () => ((await countSel('[data-p8g-dialog]')) === 0 ? 1 : null), 'KG 弹层关了').catch(() => null)
```

（`tmp/p8c-drawer.png` 是**在 KG 弹层开着的时候**截的——那张图要给验收文档当证人，看的就是那句标注，收摊之后再截等于一张空抽屉。Step 9 的读数表里要写明两张截图各自的现场。）

- [ ] **Step 8: 另三位客户的抽屉三腿（L17–L19）**

```js
// L17：C 只可能靠读侧的手机号那一路读到 K2 —— 8b ⑧ 的界面证人
await click('[title="关闭"]', '抽屉的关闭')
await poll(8000, async () => ((await countSel('[data-p8g-section]')) === 0 ? 1 : null), 'A 的抽屉收掉').catch(() => null)
await openDrawer('丙')
const cKeys = await attrList('data-p8g-group-row')
await check('L17 客户 C 能看到 K2〔8b ⑧ 界面证人：红就回 8b，不许放宽〕',
  cKeys.length === 1 && cKeys[0] === K2, `1 行且 = ${K2}`, cKeys)
await click('[title="关闭"]', '抽屉的关闭（C）')

// L18：D 命中不上 —— 空态那句，且不能和"读不到"混成一档
await openDrawer('丁')
const emptyHit = await atOf('[data-p8g-empty]', 'data-p8g-empty')
const errHit = await countSel('[data-p8g-error]')
const emptyTxt = oneLine(await txt('[data-p8g-empty]'), 200)
await check('L18 没有匹配行的客户走空态那句，而不是报错那一档',
  !emptyHit.gone && errHit === 0 && emptyTxt.includes('还没有匹配到的群成员行'),
  'data-p8g-empty 在 + data-p8g-error 不在 + 文案含「还没有匹配到的群成员行」', { emptyHit, errHit, emptyTxt })
await click('[title="关闭"]', '抽屉的关闭（D）')

// L19：勾满 51 → 前拦不发 IPC（技术要点 4 里唯一允许点导出的一格）
await openDrawer('乙')
const bKeys = await attrList('data-p8g-group-row')
for (let i = 0; i < bKeys.length; i++) await click('[data-p8g-check]', `勾选第 ${i + 1} 个群`, { nth: i, ms: 6000 })
const btnB = await poll(9000, async () => {
  const t = await txt('[data-p8g-export-selected]')
  return t?.includes('导出所选（51）') ? t : null
}, '按钮跟进到（51）').catch(() => null)
const halfDone = await check('L19a 51 行都画出来且勾满 ⇒「导出所选（51）」',
  bKeys.length === 51 && !!btnB, '51 行 + 「导出所选（51）」', { rows: bKeys.length, btnB })
if (halfDone) {
  await click('[data-p8g-export-selected]', '「导出所选」（勾了 51 个）')
  const blockedHit = await poll(9000, async () => {
    const v = await atOf('[data-p8g-export-msg]', 'data-p8g-blocked')
    return !v.gone && v.a === '1' ? 1 : null
  }, '前拦标注挂上 data-p8g-blocked="1"').catch(() => null)
  const msg = oneLine(await txt('[data-p8g-export-msg]'), 200)
  const busy = await txt('[data-p8g-export-selected]')
  await check('L19b 前拦生效：data-p8g-blocked=1 + 那句上限文案 + 没进「导出中…」',
    !!blockedHit && msg === '一次最多导出 50 个群，当前勾了 51 个' && !String(busy).includes('导出中'),
    'blocked=1 +「一次最多导出 50 个群，当前勾了 51 个」+ 不进导出中', { blockedHit, msg, busy })
}
await click('[title="关闭"]', '抽屉的关闭（B）')
```

L19 的 `msg` 与 `data-p8g-blocked` 合起来才能区分"IPC 没发"与"IPC 发了但失败"（Task 16 在 6916 行那条括号里写的就是这件事）：走通了 IPC 的那一路拿不到 `data-p8g-blocked` 属性，因为 `blocked` 那个 state 只在**前拦**时被赋值。

- [ ] **Step 9: 收摊 + L20（清理挂在每一条退出路径上）**

先把 `tmp/P8Purge.java` 换成"位置参数 + `--prefix`"两用的形状（Task 14 Step 9 那份**用法不变**，只是把删两键那一段抽成条件）：

```java
// tmp/P8Purge.java —— B6 三条腿的收尾清理：删本账号名下指定群键 / 指定前缀的三表行。
// 用法一（Task 14）：java -cp <mysql-connector-j.jar> tmp/P8Purge.java <accountId> <chatKey1> <chatKey2>
// 用法二（Task 17）：java -cp <mysql-connector-j.jar> tmp/P8Purge.java <accountId> --prefix <12036 开头的数字前缀>
// affected rows 为 0 视为异常（本轮数据没进去 ⇒ 清理没跑成，不许报成"清理干净"）；复查非 0 直接 exit 1。
import java.sql.*;
import java.util.ArrayList;
import java.util.List;

public class P8Purge {
    public static void main(String[] a) throws Exception {
        if (a.length < 1) { fail("缺 accountId"); return; }
        long accountId;
        try {
            accountId = Long.parseLong(a[0]);
        } catch (NumberFormatException e) {
            fail("accountId 不是数字: " + a[0]); return;
        }
        boolean prefixMode = a.length >= 3 && "--prefix".equals(a[1]);
        List<String> keys = new ArrayList<>();
        String prefix = null;
        if (prefixMode) {
            prefix = a[2];
            // 前缀必须是 6 位以上纯数字：防止一个空串或 "1" 把整张表端了。
            if (!prefix.matches("\\d{6,}")) { fail("--prefix 至少要 6 位纯数字，收到: " + prefix); return; }
        } else {
            for (int i = 1; i < a.length; i++) keys.add(a[i]);
            if (keys.isEmpty()) { fail("既没给群键也没给 --prefix"); return; }
        }

        String url = "jdbc:mysql://localhost:3306/smartscrm_react?useSSL=false&allowPublicKeyRetrieval=true";
        String[] tables = { "group_member_event", "group_member_state", "chat_group" };
        long totalResidual = 0;
        try (Connection c = DriverManager.getConnection(url, "root", "1234560")) {
            for (String t : tables) {
                String sql = prefixMode
                    ? "DELETE FROM " + t + " WHERE account_id = ? AND chat_key LIKE ?"
                    : "DELETE FROM " + t + " WHERE account_id = ? AND chat_key IN (" + placeholders(keys.size()) + ")";
                try (PreparedStatement ps = c.prepareStatement(sql)) {
                    ps.setLong(1, accountId);
                    int p = 2;
                    if (prefixMode) ps.setString(p, prefix + "%");
                    else for (String k : keys) ps.setString(p++, k);
                    int n = ps.executeUpdate();
                    System.out.println(t + " deleted=" + n);
                    if (n == 0) System.out.println("WARN " + t + " 本轮没有行（数据没写进去？清理没跑成 ≠ 清理干净）");
                }
                String q = prefixMode
                    ? "SELECT COUNT(*) FROM " + t + " WHERE account_id = " + accountId + " AND chat_key LIKE '" + prefix + "%'"
                    : "SELECT COUNT(*) FROM " + t + " WHERE account_id = " + accountId
                        + " AND chat_key IN (" + keys.stream().map(k -> "'" + k + "'").reduce((x, y) -> x + "," + y).orElse("''") + ")";
                try (Statement s = c.createStatement(); ResultSet r = s.executeQuery(q)) {
                    r.next();
                    int left = r.getInt(1);
                    totalResidual += left;
                    System.out.println("residual " + t + "=" + left);
                }
            }
        }
        System.out.println("residual=" + totalResidual);
        if (totalResidual != 0) System.exit(1);
    }

    private static String placeholders(int n) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) sb.append(i == 0 ? "?" : ",?");
        return sb.toString();
    }

    private static void fail(String why) {
        System.out.println("REFUSED " + why);
        System.exit(2);
    }
}
```

驱动侧的 `cleanup()` 与 L20：

```js
function runPurge() {
  if (!accountId) return { skipped: '没建成测试账号，本轮没东西可删' }
  const javaBin = process.env.JAVA_HOME ? `${process.env.JAVA_HOME.replace(/\\/g, '/')}/bin/java` : 'java'
  const jar = process.env.P8_JDBC_JAR
    ?? `${(process.env.USERPROFILE ?? process.env.HOME ?? '').replace(/\\/g, '/')}/.m2/repository/com/mysql/mysql-connector-j/9.1.0/mysql-connector-j-9.1.0.jar`
  const r = spawnSync(javaBin, ['-cp', jar, 'tmp/P8Purge.java', String(accountId), '--prefix', PREFIX], { encoding: 'utf8' })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const m = out.match(/residual=(-?\d+)/)
  purgeResidual = m ? Number(m[1]) : null
  console.log(`[清理] purge status=${r.status ?? 'spawn失败'}\n${oneLine(out, 600)}`)
  if (r.status === null) console.log('[清理] java 起不来：手工跑一遍（日志要留在验收文档 §4）\n  java -cp <mysql-connector-j.jar> tmp/P8Purge.java <accountId> --prefix ' + PREFIX)
  return r
}
async function cleanup() {
  if (cleanedUp) return
  cleanedUp = true
  try { runPurge() } catch (e) { console.warn('[清理] purge 抛错（不改主退出码）：', String(e).slice(0, 160)) }
  // purge 之后、删账号**之前**读 `/groups`：账号一删，`accountId` 在 resolveAccount 那一关就解析不出来，
  // 接口给的是错误码而不是空名单，`rec()` 塌成 `[]`，那一格就成了"什么都没读到也算 0"的假绿（技术要点 13）。
  if (accountId) {
    const g = await req('GET', `/api/group-members/groups?accountId=${accountId}&page=1&size=50`)
    groupsLeftAfterPurge = (rec(g) ?? []).filter((x) => String(x.chatKey).startsWith(PREFIX)).length
    console.log(`[清理] purge 之后 /groups 仍挂着本轮键 ${groupsLeftAfterPurge} 个（接口回码 ${g?.code}）`)
  }
  for (const [tag, id] of Object.entries(custIds)) {
    if (!id) continue
    const r = await req('DELETE', `/api/customers/${id}`)
    if (r.code !== 0) console.warn(`[清理] 客户 ${tag}(${id}) 没删掉：${JSON.stringify(r).slice(0, 120)}`)
  }
  if (accountId) {
    const r = await req('DELETE', `/api/platform-accounts/${accountId}`)
    if (r.code !== 0) console.warn(`[清理] 测试账号 ${accountId} 没删掉：${JSON.stringify(r).slice(0, 120)}`)
  }
  // `close()` 在 `tmp/cdp.mjs` 里是 `() => ws.close()`，返回 undefined——`.catch` 挂在 undefined 上会抛
  // TypeError，把一次正常收摊变成"驱动自身抛错"。Promise.resolve 包一层才是真的"关了就行，失败别吵"。
  if (page) await Promise.resolve(page.close()).catch(() => {})
}

// L20：先收摊，再复查收干净了（清理没跑成 ≠ 清理干净，两件事分开报）。
// 四个读数各自来自不同的时刻：residual 来自 JDBC 自己复查、groupsLeftAfterPurge 来自 cleanup 里
// purge 之后那一跳、custCodes 与 acctLeft 来自删完之后的 HTTP 读。缺一格就少一个证人。
await cleanup()
const custCodes = {}
for (const [tag, id] of Object.entries(custIds)) custCodes[tag] = (await req('GET', `/api/customers/${id}`))?.code
const acctLeft = ((await req('GET', '/api/platform-accounts'))?.data ?? []).some((x) => x.id === accountId)
await check('L20 三表无本轮残留 + 四位客户 40404 + 测试账号已删 + /groups 无本轮键',
  purgeResidual === 0 && Object.values(custCodes).every((c) => c === 40404) && !acctLeft && groupsLeftAfterPurge === 0,
  'residual=0 / 40404×4 / 账号没了 / purge 后 /groups 本轮键 = 0',
  { purgeResidual, custCodes, acctLeft, groupsLeftAfterPurge })

console.log(`\n通过 ${passN} / 失败 ${failN()}`)
if (failN() > 0) console.log('失败清单：' + failures.join('、'))
process.exit(failN() === 0 ? 0 : 1)
```

顶层的 catch 负责把 `blocked()` 与意外抛错分流，并且**再兜一次清理**：

```js
// main() 之外包一层：任何 blocked(2|4) 与意外抛错都要先冲一遍清理再退出（R44）
// 上面的 20 条腿写在同一个 async 函数体里；这里给最外层形状。
try {
  // …Step 3–Step 9 的全部代码…
} catch (e) {
  if (e?.__exit) console.error(`\n前置不满足（exit ${e.__exit}）：${e.message}`)
  else { console.error('驱动自身抛错（按 1 收）：', String(e?.stack ?? e).slice(0, 400)) }
  await cleanup().catch(() => {})
  console.log(`\n通过 ${passN} / 失败 ${failN()}`)
  process.exit(e?.__exit ?? 1)
}
```

- [ ] **Step 10: 跑一遍，留日志与两张截图；把日志尾行的三件事抄进台账**

```bash
cd /d/SmartSCRM
SCRM_USER=admin SCRM_PASS=admin123 node tmp/p8c-ui.mjs 2>&1 | tee tmp/p8c-ui.log
echo "exit=$?"
ls -l tmp/p8c-ui.log tmp/p8c-drawer.png tmp/p8c-dialog.png tmp/p8-purge.log
```

期望的**尾行**是 `通过 20 / 失败 0`、`exit=0`。`tmp/p8c-ui.log` 里要能数到这些行：

- 三行 `[前置读数 N]`（jar 含 V13 / `window.scrm.group` 三面 / 渲染层地址）；
- `[布景] KG 第二发：coverage=0.4 reason=coverage_too_low reconciled=false`；
- 每次开窗最多一行 `[布景读数] 账号下拉从「…」切到「P8C界面腿…」` 或 `[布景读数] 下拉本来就停在「…」`（只有那一节挂了 `[data-p8g-account]` 才会打；用户真机不在线时整场一条都没有，属正常）；
- `[清理] purge status=0`、同一行块里的 `residual=0`，以及 `[清理] purge 之后 /groups 仍挂着本轮键 0 个（接口回码 0）`（L20 的读数，必须在删账号**之前**打出来，见技术要点 13 ②）；
- `  [点击候选] …` 允许出现（按文本认行/认按钮时的多候选提示，不是缺陷）。

`  [等待超时] …` 这两条只可能出现在**只打印不判**的两个 poll 上：`切档 ⇒ 本轮账号重新取数`（紧接着会有一行 `[布景读数] 切档后 12 秒没有为…` 归因给 16）和 L19 的按钮文案跟进；出现在别处等于有一条腿的记账被跳过，按本步下面的「跑红了怎么办」②处理。

关于 `x+y`：**只有一整跑跑到底时**「通过 x / 失败 y」的 `x+y` 才必须等于 20；中途前置收手时尾行之前一定有一行 `前置不满足（exit 2/4）`，读日志先看那一行再看 `x+y`，**不许**把"只记到第 6 条"读成"另外 14 条没问题"。

**跑红了怎么办**（Task 14 技术要点 8 的界面版，三选一，写进验收文档 §5）：
① 判据表里点名的 owning task（8b / 11–13 / 15 / 16）→ 记下来回那一格修，然后**整跑重跑**（不要只重跑那一条腿，抽屉与弹层的现场是按顺序推进的）；
② 确认是驱动自己写错（锚点、期望文案、坐标）→ 改驱动，并在提交正文里写明"改了判据的哪一半、判别力为什么还在"；
③ 这一格本来就不该由界面档证（例：要真实消息、要第二个在线账号）→ 降级成日志读数，**移到 §17.3**，不许静默删掉。

L16 / L17 两条红**只能走 ①**：它们就是 8b ③/⑧ 的界面证人，放宽等于替应用撒谎。L19 若弹出原生保存框，说明前拦与主进程两道都坏了——立刻在文档 §5 记一条"最贵的一种"，并要求人在场按 Esc 收掉那个框。

- [ ] **Step 11: 验收文档 + §A.1/spec 回填 + 只提交 `docs/`**

`docs/notes/2026-10-01-group-members-verification.md` 的结构（六段，内容全部来自这一跑的日志与 `tmp/` 产物，只陈述本项目规则）：

```markdown
# P8 / B6 群成员分析 · 验收台账（2026-10-01）

## 1. 前置三行读数
（抄 tmp/p8c-ui.log 的三行 [前置读数 N]：jar 含 V13 / window.scrm.group 三面 / 渲染层地址）

## 2. §13 五档状态
| 档 | 载体 | 状态 | 证据 |
|---|---|---|---|
| Java 单测 | ./mvnw -Dtest='GroupMember*Test' test | 实测 Tests run=N, Failures=0 | tmp/p8-server.log 或 surefire 摘要 |
| JS 单测 | pnpm run test:unit | 实测 pass=… fail=0 | 日志尾行 |
| HTTP 契约 | tmp/p8-group-members-contract.mjs | 实测全绿（尾行「通过 N / 失败 0」，N = 脚本里 `check(` 的条数，推定 48） | tmp/p8-contract.log |
| CDP 界面腿 | tmp/p8c-ui.mjs | 实测 通过 20 / 失败 0 | tmp/p8c-ui.log + 两张 png |
| 真实登录档 | 用户在场的两棒 | 待验证 | 见 §4 |

## 3. 界面腿 20 条逐条读数
（每条腿一行：PASS/FAIL + actual 里那两个数。不许只写"全绿"）

## 4. 不可自动化档（照 §17.3 那张表逐条落，含 dayMsgCount/msgCount 的实际值）
（这一节要含 Task 14 技术要点 6 那句：这一格停在待验证，不用假数据冒充通过。）

## 5. 本轮发现与残留
（红格归因、清理日志里的 deleted/residual、需要人在场按掉的东西）

## 6. 证据词
（实测 / 读码 / 推断 / 待验证 四类，逐条给出处；没有出处的判断只能写"推断"）
```

§A.1 的更新（同一支文件里改两处）：第 26 行那句「**未开工**：Task 8b、9、10、12、13、14、15、16、17。」在这一跑绿之后改成——

```markdown
**未开工**：无（Task 1–17 全部落档并验收；8b 的八条逐条状态、CDP 界面腿 20 条读数与"界面证不了的那几档"记在 `docs/notes/2026-10-01-group-members-verification.md`）。
```

交付状态表补一行：

```markdown
| 本任务的提交号 | CDP 界面腿 20 条 + 验收台账 + `P8Purge --prefix` | Task 17 | 已交付（驱动与日志在 `tmp/`，不进提交） |
```

spec 的两处回填只写规则与状态，不写实现过程：§13 那张五行表的「CDP」行改成"已证（20 条，读数见台账 §3）"，"真实登录档"行保持"待用户在场"；§15 的五条里 #2（`is_final`）与 #4（exceljs 产物归属）与 #5（事件时刻形态）各补一句"本期入口不可达 / 由哪一档续证"，并新记一条：**「`never_built` 与 `unavailable` 两档在本期唯一入口（客户抽屉）不可达」**，把 §17.3 那四行理由抄过去（这一条是读码结论，词用"读码"，不是"实测"）。

```bash
cd /d/SmartSCRM && git status --short
git add docs/notes/2026-10-01-group-members-verification.md \
  docs/superpowers/specs/2026-09-30-group-member-analysis-design.md \
  docs/superpowers/plans/2026-09-30-group-member-analysis.md
git commit -m "$(cat <<'EOF'
docs(P8/B6): 群成员分析 CDP 界面腿 20 条 + 验收台账

界面腿的二十条判据、三条布景顺序硬约束（客户早于批次 / C 晚于 K2 快照 /
K2 的事件单独一批）、以及"界面证不了的四档由谁续证"全部落档。L16 与 L17 是
Task 8b ③⑧ 的界面证人，判据写死、红就回 8b；dayMsgCount 那格照 Task 14 的
口径停在待验证，不用假数据冒充通过。

tmp/ 里的驱动、日志与两张截图按仓库规则不进提交，判档以 tmp/p8c-ui.log 的
「通过 20 / 失败 0」与退出码为准。
EOF
)"
```

（提交正文里那句"二十条判据"要对着日志尾行的实际条数写；若这一跑是 19 绿 1 红，正文就写那条红的归因和 owning task，**不要**把标题改成"19 条"来掩盖——台账 §5 是红的唯一登记处。）

---

## 计划自审（writing-plans 那三段，2026-10-01 收尾时逐条跑过）

这不是"看起来没问题"的记录，每一段都写了**怎么查的**，下一席可以按同样方法复查。

**1. spec 覆盖。** 逐节对照 `docs/superpowers/specs/2026-09-30-group-member-analysis-design.md`：§3/§4/§6 的写侧与闸 → Task 5/6 与 Task 8b ①②③⑦⑧；§5 的事件两源 → Task 3/4；§7 六跳 → Task 7/8 加上 8b ④⑥，取数层在 Task 9（主进程三跳）与 Task 15（渲染层三支）；§8 的两处界面 → Task 16；§9 的宿主面 → Task 10/11/12/13；§10 的导出 → Task 8/13；§13 五档验收腿 → Java 单测（Task 5/6/8 各自的 Step 1，加 Task 8b 的八条红测试）、JS 单测（Task 2/3/4/9/10/11/13/15/16）、HTTP 契约（Task 14）、CDP 界面腿（Task 17 §17.2 的 L1–L20）、真实登录档（Task 17 Step 11 的台账 §4）。§14「本期不做」的六条在本计划里**没有**任何一节的 Files 段越界（TG 采集、批量建客户、群设置面、媒体与头像、定时器、选群界面）。§15 五条待验证各有一处"只记读数、不改口径"的落点：#1 在 Task 4（三字段各占一格测试），#2/#3 在 Task 3 的取证行与 Task 11 的 `snapshot chatKey=… count=…` 日志（#3 的另一半在 Task 8 的 `matched={}/{}` 日志），#4 在 Task 13 Step 6 那两条 grep，#5 在 Task 16 的 `LIVE_EVENT_TIME_NOTE`（由 Task 17 的 L13 读到界面上）。

**2. 占位符扫描。** `grep -n "TBD|TODO|待补|fill in|同上|类似 Task|自行实现|酌情"` 全文命中两处 `同上`，逐条判过：Task 3 Interfaces 段那一个指向前一行已写全的签名形状（不是要求实施者自己补），§17.3 表格里那一个指向同一行左侧已写全的理由。另有三处 Java 里的裸 `...`（Task 8b Step 7 的 `pageGroups`、Step 8 的 `customerGroups` 两处 + 注释那一处）——它们是**修改已提交方法**的步骤，省略号代表"这一段既有代码不动"，而改动行（新的 `order by` 块、新加的 `accountId`/`platform` 两个条件）在同一个代码块里逐字给出，Step 8 那句「按号码那一路同样加这两个条件」点名的就是那两行已给出的谓词。Task 14–17 四个未开工任务**没有一处**代码步是省略式写法。

**3. 类型与文案一致性。** 三样东西按"名字—形状—字符串"对过一遍：

- **线形名**：`/group/members` 的容器在 §A.4 名表（103 行）、R37、Task 8b Produces（`MemberPageVO(members, coverage, reason)`）三处已统一成**已提交的三键**；Task 7 正文那段七参构造留在「正文不改写」里，并由 Task 8b ③ 就地替换。Task 15 的 `MemberPageVO` TS 类型（`coverage: number | null`）与 Java 侧 `Double coverage` 同键同名。
- **中文文案**：`本次快照人数较上次少 x%，未做退群判定`、`一次最多导出 50 个群（，当前勾了 n 个）`、`还没有加减人的流水。事件只在账号上线且桥就绪时采集。`、`导出所选（n）`、`第 x / y 页 · 共 n` 五句，Task 16 的作者（`groupDisplay.ts` / 组件 JSX）与 Task 17 的判据（L2/L10/L15/L16/L19 + 代码里的 `check` 实参）逐字对过，无第二作者。
- **跨节引用**：`§17.4` 这类不存在的锚点已清除；三处"读码 6823 / 6853 / 7201"这种**按本文档行号**的引用改成按文案与选择器定位（行号随编辑漂移，本次就漂了两次）。
- **本轮顺手修掉的四处**：① Task 17 Step 5 的 `custReqs`/`mineUrl` 提到 `openDrawer` 之前（原顺序是 TDZ：函数体在声明之前执行），并删掉 L4 里重复的 `const mineUrl`（重复声明是 SyntaxError）；② `openDrawer` 的账号对齐从恒真等待（`countSel(...) >= 0`）换成"本轮账号多出一枪 + 那一节两拍定稳"；③ §17.2 L8 与技术要点 10 的"按选项文本选「群主」"对齐（原来还写着按 nth 选）；④ Task 14 的**前置版本闸从骨架挪到 2.1 之后**——清理腿每轮删键，账号名下无行时 `records[0]` 为 `undefined`，"旧 jar"与"库还空着"会共用同一个 `die(2)`；Task 17 的技术要点 13 ① 是同一条纪律的界面版。另外 `tooManyCopy` 的"三处同一句话"改成"渲染层两句一个作者、后端那句在 Java 侧另写且不进界面"（Task 14 的 12.1 只断 `code`），R24 那行补了"形状部分已被 R31 与已提交代码取代"的指针。

**已知不自洽但故意留着**：Task 1–8 各节正文是设计当时的形状（七参容器、`@Data` 可变 VO、`EXPORT_GROUP_MAX`、"空名单 40000"），与 §A/Task 8b 冲突。这是 R30 的裁定（「本节正文不改写」），冲突处以 §A 为准，且每节开头那一行「已交付」都点名了偏差别去哪节找。

