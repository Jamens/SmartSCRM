# P7 / B7 批量群发实施计划（batch-send）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让运营在应用内建一个「多账号 × 多会话 × 多文本」的群发任务，由主进程逐条骑在现有发送链上跑完，进度与结果落库，可随时暂停/继续/取消，并能对已发成功的条目做「对所有人撤回」。

**Architecture:** 三层各司其职，且每层只有一个出口。
1. **Java 后端**是唯一数据层，也是所有状态迁移的唯一裁决者（创建即展开、计数、状态机、撤回资格、陈旧心跳 reconcile 全在这里）。
2. **主进程** `services/batchSend/` 是唯一的执行器：它不裁决任何状态，只按后端给的待跑清单逐条投料；它对后端的每一跳都走注入的 `fetcher`（真身 `authedFetch`），对页面的唯一出口是 `msgBridge.sendText` / `msgBridge.recallText`。
3. **渲染层**只读 REST、只经 `window.scrm.batch.*` 变更；它永远说不出「我属于哪个账号的哪个会话」，这条盖章口径不因群发而削弱。

**Tech Stack:** Java 17 + Spring Boot 3.5 + MyBatis-Plus（注解 SQL）+ 本地 MySQL `smartscrm_react`；Electron 35 + React 19 + TypeScript，测试用 JUnit 5（纯单测，不起 Spring）与 `node --test`；渲染层验证走 CDP。

**Spec:** `docs/superpowers/specs/2026-09-28-batch-send-design.md`（本计划逐条实现它；冲突以 spec 为准，spec 未覆盖处见「决策记录」）

## Global Constraints

- **库**：本地 MySQL `smartscrm_react`（root / `1234560`），数据库名固定。**绝不碰 42 张表的 `smartscrm` 老库**。没有 mysql CLI、没有 Docker —— 所有数据库断言都通过 `:8180` 的 HTTP API 做。
- **迁移**：只新增 `V11__batch_send.sql`，不改已发布迁移（V1–V10）。迁移文件带 `-- 回滚` 注释段。
- **后端命令**：在 `apps/server` 下 `export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18"`，用 `./mvnw`（**禁 npm/npx 之外也禁 mvn**，只用 wrapper）；需要看 surefire 输出时**不要加 `-q`**；`package` 之前必须先杀掉 `:8180` 上的进程。所有 shell 里 `set -o pipefail`。
- **前端命令**：只用 `pnpm`（`pnpm run test:unit` / `pnpm run typecheck` / `pnpm exec eslint`）。
- **lint 口径**：全仓 lint 不是绿的（格式化器自身崩 + src 既有 error），只按**改动文件**跑 `pnpm exec eslint --quiet <files>` 判定。
- **typecheck 四路**：`pnpm run typecheck` 必须 node / web / inject / unit 四路全过。
- **`tsconfig.unit.json` 的 `include` 是半枚举**：`src/shared/**` 与 `src/bridge/**` 已经是整目录通配（读码：`include` 头两条），落在这两个目录里的纯模块**不需要**再加 `include`，逐条枚举它们只是空转；`src/main/services/**` 与 `src/renderer/src/lib/**` 才是逐文件枚举，新的**纯**主进程/渲染模块要显式加进去。任何 `import 'electron'` 的文件**绝不能**加进去（unit 程序不含 electron 依赖）。
- **`erasableSyntaxOnly: true`**：禁用参数属性（TS1294）、禁用 `enum`。字段 + 构造赋值，或用 `as const` 联合类型。
- **`node --test` 不解析 `@shared/*` 别名**：进入 unit 程序的模块一律用相对路径 + `.ts` 后缀导入。
- **提交**：一个功能一次提交，前缀 `feat:` / `fix:` / `refa:` / `update:`，主题行后空一行再写正文。**助手不得 push、不得 amend、不得跳 hook**。一个任务一个提交，由验证它的坐席提。
- **`tmp/` 已被 gitignore**：驱动脚本与日志永不进提交。`docs/notes/2026-09-22-legacy-feature-gap.md` **永不提交**。`apps/desktop/tsconfig.node.tsbuildinfo` 永不提交。禁止 `git clean -fdx`。
- **CDP 验证（C9）**：渲染层/页内验证只走 CDP。任何点击之前先跑 `powershell -NoProfile -ExecutionPolicy Bypass -File tmp/p5c-top.ps1` 并断言 `document.visibilityState === 'visible'`；驱动脚本收尾固定 `process.exitCode = N; await sleep(1500); process.exit(N)`。窗口隐藏 ≠ 点不动，判据是「点完读得到」。
- **真发与真撤回是不可回收动作**：**任何任务都不得按下 WhatsApp 页面的发送/回车**，不得对真实会话执行撤回。真发 1 条、真撤回 1 次只在用户在场并明确放行时做（Task 16 的两格）。所有自动化腿只跑 `dryRun=1`。
- **证据词只有四个**：实测 / 读码 / 推断 / 待验证。没跑完那一档就不写「已验证」。断言要能区分「生效了」与「什么都没做」。等待用条件轮询不用固定 sleep。清理状态覆盖**每一条退出路径**与**每一个档位**。
- **本项目文档只写本项目的规则**，不与任何其他实现比较。`D:\electron-client` 只读（Read/Grep/Glob），Bash 进去是禁的。
- **Electron 主进程重启是用户的手**；Spring 后端重启是坐席的活。

## 决策记录（spec 未定或两处矛盾之处，本计划在此一次性裁定）

| # | 裁定 | 理由 | 错了会付什么 |
|---|---|---|---|
| R1 | 错误码新增段位：`40011` 账号不可用、`40012` 收件人全部不可寻址、`40013` 群发规则不过、`40014` 展开总数自检失败、`40902` 状态迁移非法/并发抢搬、`40903` 撤回目标不合法。 | 现有 `GlobalExceptionHandler` 用 `BizException(code,msg,status)`，`40000/40404/40901/50000` 已被占；群发要「点名拒绝哪一条」，必须与通用 400 分开，前端才能只判一个码。 | 与既有码撞号会让前端把「正文超长」当成「未登录」一类处理；代价是回来重编一次码表。 |
| R2 | `unknown` **不计入** `fail_count`，只留在 `openCount` 之外由人工裁决；`skipped` 既不计 sent 也不计 fail。 | spec §2 明写 `unknown` 不发也不撤，把它算成失败会诱导用户 retry-failed 重发可能已到达的消息。 | 计错数会让进度条永远不满，或让「已失败」被复位重发。 |
| R3 | `retry-failed` 只复位 `send_status='failed'`，`WHERE` 里**不含** `unknown`/`skipped`。 | spec §4 原话。 | 复位 `unknown` = 把「不知道发没发出去」变成「再发一遍」，是不可回收事故。 |
| R4 | 心跳与 reconcile 都在后端一个事务里做**两拍**：先把陈旧的 `sending` 明细判 `unknown`，再把陈旧任务判 `paused`。顺序不可换。 | 先转 paused 再查 sending 时，那一行仍挂 `sending`，重入时会把它当活跃执行项再发一次。 | 换序 = 重复发送，最贵的错。 |
| R5 | 定时器（15 s 心跳）住在 `host.ts`，引擎 `engine.ts` 里没有 `setInterval`。 | engine 必须能在 `tsconfig.unit.json` 里被 `node --test` 用假 clock 跑完；一旦引 electron 或真 timer，unit 程序就编不过。 | 若挪进 engine，engine 就得从 unit include 里剔除，队列/熔断/间隔三档断言退化为「读码」。 |
| R6 | `engine.ts` / `batchApi.ts` 的每个外部依赖都从构造函数注入（`fetcher`、`send`、`recall`、`sleep`、`rand`、`now`、`log`）。 | 同上；同时让「连续 3 条熔断只停一个账号」「per-view 锁不交错」这些断言可以在毫秒级假 clock 下成立。 | 漏一个注入点，对应那条断言就要么写不出来要么假绿。 |
| R7 | 撤回**不新增 IPC 白名单**：`recall` 命令骑现有的 `view:host:msg-cmd` 通道下行，`recall_result` 骑现有的 `msg-report` 上行。 | 该通道是整条 `BridgeCommand` 联合类型的通道，扩成员不改白名单（读码：`webContentsView/ipc.ts` 只放行通道名，不看 `kind`）。spec §6 那句「白名单同步放开」按此实现即成立。 | 若真去加通道名，preload/main/页内三处要同时改，凭空多两个失配点。 |
| R8 | 收件人中**部分**不可寻址时：创建**成功**，返回 `rejected[]` 逐个点名（spec §3 第 2 条的「逐个点名」优先于第 3 段那句「第一条不满足即整单拒绝」）；**全部**不可寻址才整单拒绝（`40012`）。 | spec §3 两处互相矛盾。选「部分接受」因为：1000 人规模下会话表滞后于页面是常态，整单拒绝会让用户改一次试一次。 | 若用户其实要整单拒绝，代价是创建返回的 `rejected` 数组变成一次异常抛出，Task 4 与驱动各改一处。 |
| R9 | 无客户归属的会话：`{客户名}` 回落到「会话标题 → 否则 `chat_key` 本地段（`@` 之前）」，`{号码}` 回落 `''`；两者都不再回落成 `open_id` 尾 4 位（无客户就没有 `open_id` 列可取）。 | spec §3 第 6 条的兜底写的是 `customer.nickname`/`open_id`，但 `chat_conversation` 在无客户时没有 open_id 列，只有 `title`。 | 若强行回落，`{客户名}` 在陌生会话上会渲染成空串——正文里出现「亲爱的 ，」这种骗人的称呼。 |
| R10 | 创建入参只认 `conversations: [{accountId, chatKey}]`；`audienceId` / `customerIds` **不进取件器**，人群包/客户/标签的收窄在渲染层的会话选择器里用现有 API 完成后仍交 `conversations`。 | spec §3 那句「或 audienceId / customerIds 由后端解析」需要新的「按客户反查会话」读端点（现 `/api/conversations` 无 `customerId` 过滤，读码：`ConversationController.java:30-36`），那是另一条腿；B7 的主干是执行环，不该被它拖住。 | 若产品后面要求「一键把整个包发一遍」，需要补一条 `customerId → conversations` 反查（含一个账号多会话的扇出规则），Task 4 的取件器加一个分支。 |
| R11 | 重发按**明细行粒度**做，并且**允许 `done`/`error` 回到 `paused`**（`cancelled` 不许）：`retry-failed` 的入参加可选 `detailIds[]`（不传＝整批，传＝只复位这几条），服务层在同一跳里先复位、`reset > 0` 且当前态是 `done`/`error` 时才搬 `→ paused`，然后由用户显式点「继续」投泵。 | spec 自己两处打架：§2 写「`done/error/cancelled` 不可再 `start`」，§7 又要求详情面有「单条重发入口」。那条禁令挡的是「整个任务从头再发一遍」（会把已成功的几百条再发一次），重发失败行不在此列——`WHERE send_status='failed'` 保证已成功的行永不入泵。若不搬状态，复位出来的 `pending` 行没有泵会捡它们：`host.ts` 的 `runTask` 要求 `task.status === 'running'` 才投料（Task 12），按钮点下去只是把三列清成 NULL，什么都不会发生。 | 终态任务可以被复活（只能回到 `paused`，且只能由 `failed` 行驱动）。若产品后面说"跑完的任务是档案，不许动"，退路是把两个重发入口降级为「复制成新任务」，代价是 Task 3/5/6/15 各回一处、状态机少两条边。 |
| R12 | `CHAT_NOT_FOUND` **不需要新代码**：它是现有 `SendError` 联合里已有的一支（`src/shared/chatTypes.ts:100`），页内分类器已经在产出它（`src/bridge/whatsapp/send.ts:19`，认 `Unable to find chat` 一类文案），引擎 `item.errorCode = outcome.error ?? 'SEND_FAILED'` 原样带过去。渲染列复用 `renderer/src/lib/sendError.ts` 的 `sendErrorText()` 把码翻成人话。 | spec §8 那一行读起来像要新增一种分类，实际是既有分类在新链路上的复用；自审时先在仓库里 grep 过这个码，确认它不是待建项。 | 如果页内那条正则对群发场景失效（比如群发切会话时抛的是另一句话），这一行会退化成 `SEND_FAILED`——细则由 Task 16 的验收文档在真发那一格回读，不改分类器结构。 |

---

## 文件结构

### 后端新增

| 文件 | 职责 |
|---|---|
| `apps/server/src/main/resources/db/migration/V11__batch_send.sql` | 两张表 + `-- 回滚` 段 |
| `entity/BatchSendTask.java`、`entity/BatchSendDetail.java` | MyBatis-Plus 实体，列 ↔ 驼峰 |
| `mapper/BatchSendTaskMapper.java`、`mapper/BatchSendDetailMapper.java` | 全部状态迁移原语（注解 SQL） |
| `service/batch/BatchRender.java` | 两个变量的渲染 + 未识别花括号原样 |
| `service/batch/BatchExpansion.java` | 收件人主序展开 + `seq`/`content_index` |
| `service/batch/BatchRules.java` | 上限/间隔/正文规则，返回**全部**违规 |
| `service/batch/BatchStatus.java` | 任务与明细状态机的合法边、撤回资格 |
| `service/batch/BatchJson.java` | `account_ids`/`contents` 两列的手写 JSON 编解码 |
| `service/BatchSendService.java` | 创建 / 预览 / 读 / 运行面十个动作（Task 5 Step 4 那张端点表一一对应） |
| `web/BatchSendController.java` | `/api/batch-send` 全部端点 |
| `web/dto/BatchTaskCreateDTO.java`、`BatchRecipientDTO.java`、`BatchPreviewDTO.java`、`BatchReportsDTO.java`、`BatchReportItemDTO.java`、`BatchRecallRequestDTO.java`、`BatchRecallReportItemDTO.java`、`BatchRecallReportsDTO.java`、`BatchRetryDTO.java` | 入参，Bean Validation（`BatchRetryDTO.detailIds` 是唯一**可以空**的一个：空＝整批复位，R11） |
| `web/vo/BatchTaskVO.java`、`BatchDetailVO.java`、`BatchRejectedVO.java`、`BatchCreateVO.java`、`BatchPreviewVO.java`、`BatchReportsResultVO.java`、`BatchRecallVO.java` | 出参 |
| `src/test/.../service/batch/BatchRenderTest.java`、`BatchExpansionTest.java`、`BatchRulesTest.java`、`BatchStatusTest.java`、`BatchJsonTest.java` | 纯单测 |

### 桌面端新增

| 文件 | 职责 |
|---|---|
| `apps/desktop/src/shared/batchSend.ts` | 纯模型：状态词、建队列、随机间隔取样、回执→状态映射、熔断阈值、上报积压环 |
| `apps/desktop/src/shared/batchSend.test.ts` | 上述全部断言 |
| `apps/desktop/src/main/services/batchSend/batchApi.ts` | 主进程 → 后端的群发十二跳（十跳运行面 + `task`/`details` 两跳只读；注入 `fetcher`，信封→null） |
| `apps/desktop/src/main/services/batchSend/batchApi.test.ts` | 信封/失败/无凭据形状 |
| `apps/desktop/src/main/services/batchSend/engine.ts` | 每账号串行泵 + 撤回第二职 + 关闭结算 |
| `apps/desktop/src/main/services/batchSend/engine.test.ts` | 队列/节律/熔断/锁不交错/积压重报 |
| `apps/desktop/src/main/services/batchSend/host.ts` | 真身装配：`authedFetch`、`sendText`、15 s 心跳、启动 reconcile、`batch:*` IPC、`batch:state` 广播 |
| `apps/desktop/src/main/services/msgBridge/sendLock.ts` | per-view 串行闸门 |
| `apps/desktop/src/main/services/msgBridge/sendLock.test.ts` | 不交错 / 失败不断链 |
| `apps/desktop/src/bridge/whatsapp/recall.ts` | 页内撤回：`WPP.chat.deleteMessage` + `isRevoked` 判定 |
| `apps/desktop/src/bridge/whatsapp/recall.test.ts` | 假 chat 对象的四种返回形状 |
| `apps/desktop/src/renderer/src/api/batchSend.ts` | REST hooks + `window.scrm.batch` 包装 |
| `apps/desktop/src/renderer/src/pages/BroadcastPage.tsx` | 列表 + 向导 + 详情 |

### 修改

| 文件 | 改动 |
|---|---|
| `apps/desktop/src/shared/chatTypes.ts` | `BridgeCommand` 加 `recall`；`BridgeReport` 加 `recall_result`；新增 `RecallRequest` / `RecallReceipt`（**`SendReceipt` 不加 `isRevoked`**，R31：撤回的结论另有自己的类型，发送回执里塞一个永远 undefined 的字段只会多一个分支） |
| `apps/desktop/src/bridge/types.ts` | `WppChatApi` 加 `deleteMessage` |
| `apps/desktop/src/bridge/index.ts` | 命令 switch 加 `case 'recall'` |
| `apps/desktop/src/main/services/msgBridge/index.ts` | `sendText`/`recallText` 走锁；`send_result`/`recall_result` 结清；掉线与销毁两条出口 |
| `apps/desktop/src/main/services/msgBridge/sendRegistry.ts` | 新增 `RecallRegistry`（同文件的第二个类；`SendRegistry` 与 `SendReceipt` 一字不动） |
| `apps/desktop/src/main/ipc.ts` | **不动它**：`batch:*` 七条 handle 全在 `services/batchSend/host.ts` 的 `registerBatchIpc()` 里（Task 12 Step 2 说清为什么不能在这里再注册一遍） |
| `apps/desktop/src/main/index.ts` | 启动 `startBatchHost()`、退出 `stopBatchHost()` |
| `apps/desktop/src/preload/index.ts` | `scrm.batch` 面 |
| `apps/desktop/src/renderer/src/lib/nav.ts` | 人群包后加 `/broadcast`「批量群发」 |
| `apps/desktop/src/renderer/src/App.tsx` | 一条 `<Route>` |
| `apps/desktop/package.json` | `test:unit` glob 加 `src/main/services/batchSend/**/*.test.ts` |
| `apps/desktop/tsconfig.unit.json` | `include` 加新的纯模块与其测试 |
| `docs/superpowers/specs/2026-09-28-batch-send-design.md` | R1/R4/R8/R9/R10 回填到 §3/§4；R11 那两条边补进 §2；§10 补 unknown 裁决入口缺口；§11 四条给状态（Task 16 Step 6） |

---

## Task 1: V11 迁移 + 两实体 + 两 Mapper 原语

**Files:**
- Create: `apps/server/src/main/resources/db/migration/V11__batch_send.sql`
- Create: `apps/server/src/main/java/com/smartscrm/server/entity/BatchSendTask.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/entity/BatchSendDetail.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/mapper/BatchSendTaskMapper.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/mapper/BatchSendDetailMapper.java`
- Create: `tmp/p7b-kill8180.ps1`（gitignored 工具）

**Interfaces:**
- Consumes: 无（本任务是最底层）。
- Produces:
  - `int BatchSendTaskMapper.heartbeat(long tenantId, long id)`
  - `int BatchSendTaskMapper.moveTo(long tenantId, long id, String fromStatus, String toStatus)`
  - `Map<String,Object> BatchSendTaskMapper.recount(long tenantId, long id)`（键 `sentCount` / `failCount`）
  - `int BatchSendTaskMapper.openCount(long tenantId, long id)`
  - `int BatchSendTaskMapper.markStaleSendingUnknown(long tenantId, LocalDateTime staleBefore)`
  - `int BatchSendTaskMapper.pauseStaleTasks(long tenantId, LocalDateTime staleBefore)`
  - `int BatchSendDetailMapper.insertBatch(List<BatchSendDetail> rows)`
  - `int BatchSendDetailMapper.applyReport(...9 args...)`、`skipAllPending`、`retryFailed(tenantId, taskId, List<Long> ids)`（`ids` 传 `null`＝整批）、`markRecalling(List<Long> ids)`、`applyRecallReport`、`List<Map<String,Object>> countByTask`
  - 实体字段名（后续任务的 SQL 与 Java 都按这些名字写）：任务 `id,tenantId,name,platform,dryRun,status,accountIds,contents,msgIntervalMin,msgIntervalMax,chatIntervalMin,chatIntervalMax,totalCount,sentCount,failCount,heartbeatAt,createdAt,updatedAt`；明细 `id,tenantId,taskId,seq,accountId,chatKey,customerId,contentIndex,body,localId,sendStatus,errorCode,errorDetail,msgKey,recallStatus,recallDetail,sentAt,createdAt,updatedAt`。

- [ ] **Step 1：先记基线。** 在 `apps/server` 下执行（`tmp/p7b-kill8180.ps1` 先建好，见 Step 5）：

```bash
cd /d/SmartSCRM/apps/server && export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18" && set -o pipefail && ./mvnw test 2>&1 | tail -20
```

把 `Tests run: N` 的 N 抄进本任务最后的提交正文（当前仓库里共有 82 个 `@Test` 注解，surefire 的确切数以这次实跑为准）。期望：`BUILD SUCCESS`，0 failures。

- [ ] **Step 2：写迁移。** `V11__batch_send.sql` 内容 = spec §2 的两个 `CREATE TABLE` **逐字照抄**（列名、类型、注释、索引名都不改），文件头加设计注释、文件尾加回滚段：

```sql
-- V11__batch_send.sql
-- P7/B7 批量群发：任务头 + 明细。展开（seq/content_index/body）在创建事务里一次做完，
-- 引擎之后只读明细、只写回状态，所以 uk_bsd_seq 是「同一任务不会跑出两条同序」的最后一道闸。
-- dry_run 在任务头而不在明细：演练是整个任务的属性，不允许一半一半。
CREATE TABLE `batch_send_task` ( ... 照 spec §2 ... );
CREATE TABLE `batch_send_detail` ( ... 照 spec §2 ... );

-- 回滚：
--   DROP TABLE IF EXISTS `batch_send_detail`;
--   DROP TABLE IF EXISTS `batch_send_task`;
```

- [ ] **Step 3：写两个实体。** 形制照 `entity/ChatMessage.java`（读码：`@TableName` + `@TableId(type = IdType.AUTO)` + 时间字段用 `LocalDateTime`，`dryRun` 用 `Boolean`）。要点：

```java
@Data
@TableName("batch_send_task")
public class BatchSendTask {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private String name;
    private String platform;
    private Boolean dryRun;
    private String status;
    private String accountIds;   // JSON 数组字符串，由 BatchJson 读写
    private String contents;     // JSON 数组字符串
    private Integer msgIntervalMin;
    private Integer msgIntervalMax;
    private Integer chatIntervalMin;
    private Integer chatIntervalMax;
    private Integer totalCount;
    private Integer sentCount;
    private Integer failCount;
    private LocalDateTime heartbeatAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
```

`BatchSendDetail` 同形制，`@TableName("batch_send_detail")`，字段按 Interfaces 列出的那份（`customerId`/`localId`/`errorCode`/`errorDetail`/`msgKey`/`recallDetail`/`sentAt` 可空，其余 `NOT NULL` 列用包装类型但不给默认值——默认值由 SQL 与创建路径负责）。

- [ ] **Step 4：写两个 Mapper。** 全部注解 SQL，形制照 `mapper/ChatMessageMapper.java`（`@Mapper` + `extends BaseMapper<T>`）。`BatchSendDetailMapper.insertBatch` 用 `<script>` + `<foreach>`：

```java
@Insert({
    "<script>",
    "INSERT INTO batch_send_detail (tenant_id, task_id, seq, account_id, chat_key, customer_id,",
    " content_index, body, send_status, recall_status) VALUES",
    "<foreach collection='rows' item='r' separator=','>",
    "(#{r.tenantId}, #{r.taskId}, #{r.seq}, #{r.accountId}, #{r.chatKey}, #{r.customerId},",
    " #{r.contentIndex}, #{r.body}, 'pending', 'none')",
    "</foreach>",
    "</script>"
})
int insertBatch(@Param("rows") List<BatchSendDetail> rows);
```

`BatchSendTaskMapper` 六条：

```java
/** 只给在跑的任务续心跳：paused/cancelled 之后心跳必须停止，否则 reconcile 永远判它「活着」。 */
@Update("UPDATE batch_send_task SET heartbeat_at = NOW(3) "
        + "WHERE tenant_id = #{tenantId} AND id = #{id} AND status = 'running'")
int heartbeat(@Param("tenantId") long tenantId, @Param("id") long id);

/** CAS 式迁移：返回 0 就是「当前态不是 fromStatus」，调用方据此出 40902 并点名现状。 */
@Update("UPDATE batch_send_task SET status = #{toStatus} "
        + "WHERE tenant_id = #{tenantId} AND id = #{id} AND status = #{fromStatus}")
int moveTo(@Param("tenantId") long tenantId, @Param("id") long id,
           @Param("fromStatus") String fromStatus, @Param("toStatus") String toStatus);

/** fail 只算 'failed'：unknown 不发不撤（R2），skipped 是没跑（R2）。 */
@Select("SELECT SUM(send_status = 'success') AS sentCount, SUM(send_status = 'failed') AS failCount "
        + "FROM batch_send_detail WHERE tenant_id = #{tenantId} AND task_id = #{id}")
Map<String, Object> recount(@Param("tenantId") long tenantId, @Param("id") long id);

/** 「还没结论」= pending + sending。全部账号熔断的判定与 done 的判定都读它。 */
@Select("SELECT COUNT(1) FROM batch_send_detail WHERE tenant_id = #{tenantId} AND task_id = #{id} "
        + "AND send_status IN ('pending','sending')")
int openCount(@Param("tenantId") long tenantId, @Param("id") long id);

/** R4 第一拍：先判 unknown，顺序不可与 pauseStaleTasks 互换。 */
@Update("UPDATE batch_send_detail d JOIN batch_send_task t ON t.id = d.task_id "
        + "SET d.send_status = 'unknown', d.error_code = 'ENGINE_LOST', "
        + "    d.error_detail = 'engine heartbeat stale at shutdown' "
        + "WHERE d.tenant_id = #{tenantId} AND t.tenant_id = #{tenantId} AND t.status = 'running' "
        + "AND (t.heartbeat_at IS NULL OR t.heartbeat_at < #{staleBefore}) AND d.send_status = 'sending'")
int markStaleSendingUnknown(@Param("tenantId") long tenantId, @Param("staleBefore") LocalDateTime staleBefore);

/** R4 第二拍。 */
@Update("UPDATE batch_send_task SET status = 'paused' "
        + "WHERE tenant_id = #{tenantId} AND status = 'running' "
        + "AND (heartbeat_at IS NULL OR heartbeat_at < #{staleBefore})")
int pauseStaleTasks(@Param("tenantId") long tenantId, @Param("staleBefore") LocalDateTime staleBefore);
```

`BatchSendDetailMapper` 其余六条（除 `insertBatch` 外）：

```java
/** localId/msgKey/sentAt 用 COALESCE 保留旧值（同一行可能被重报），错误列无条件覆盖。 */
@Update("UPDATE batch_send_detail SET send_status = #{sendStatus}, "
        + " local_id = COALESCE(#{localId}, local_id), error_code = #{errorCode}, "
        + " error_detail = #{errorDetail}, msg_key = COALESCE(#{msgKey}, msg_key), "
        + " sent_at = COALESCE(#{sentAt}, sent_at) "
        + "WHERE tenant_id = #{tenantId} AND task_id = #{taskId} AND id = #{detailId}")
int applyReport(@Param("tenantId") long tenantId, @Param("taskId") long taskId,
                @Param("detailId") long detailId, @Param("sendStatus") String sendStatus,
                @Param("localId") String localId, @Param("errorCode") String errorCode,
                @Param("errorDetail") String errorDetail, @Param("msgKey") String msgKey,
                @Param("sentAt") LocalDateTime sentAt);

@Update("UPDATE batch_send_detail SET send_status = 'skipped', error_code = 'TASK_HALT' "
        + "WHERE tenant_id = #{tenantId} AND task_id = #{taskId} AND send_status = 'pending'")
int skipAllPending(@Param("tenantId") long tenantId, @Param("taskId") long taskId);

/**
 * R3：WHERE 里只有 'failed'，绝不含 unknown / skipped。
 * `ids == null` 或空 = 整批复位（spec §5 的 `retry-failed` 原语义）；带 ids = 只复位勾选的那几条
 * （spec §7 的单条重发）。两条语义共用一条原语，是因为 SET 子句一个字都不能差：少清一列
 * `local_id`，重跑那一行就会拿旧 localId 去认领新回执（`sendRegistry` 的 FIFO 会认错）。
 */
@Update("<script>UPDATE batch_send_detail SET send_status = 'pending', error_code = NULL, "
        + " error_detail = NULL, local_id = NULL "
        + " WHERE tenant_id = #{tenantId} AND task_id = #{taskId} AND send_status = 'failed' "
        + " <if test='ids != null and ids.size() > 0'> AND id IN "
        + "   <foreach collection='ids' item='d' open='(' separator=',' close=')'>#{d}</foreach>"
        + " </if>"
        + "</script>")
int retryFailed(@Param("tenantId") long tenantId, @Param("taskId") long taskId, @Param("ids") List<Long> ids);

@Update({
    "<script>",
    "UPDATE batch_send_detail SET recall_status = 'recalling', recall_detail = NULL "
        + "WHERE tenant_id = #{tenantId} AND task_id = #{taskId} AND recall_status = 'none' "
        + "AND id IN",
    "<foreach collection='ids' item='i' open='(' separator=',' close=')'>#{i}</foreach>",
    "</script>"
})
int markRecalling(@Param("tenantId") long tenantId, @Param("taskId") long taskId,
                  @Param("ids") List<Long> ids);

/** 只结 recalling 的行：迟到的撤回回执不得改写已经判过 recall_failed 的结论。 */
@Update("UPDATE batch_send_detail SET recall_status = #{recallStatus}, recall_detail = #{detail} "
        + "WHERE tenant_id = #{tenantId} AND task_id = #{taskId} AND id = #{detailId} "
        + "AND recall_status = 'recalling'")
int applyRecallReport(@Param("tenantId") long tenantId, @Param("taskId") long taskId,
                      @Param("detailId") long detailId, @Param("recallStatus") String recallStatus,
                      @Param("detail") String detail);

/** 每状态一行，供 Task 5 的 reports 结算与 Task 4 的自检。 */
@Select("SELECT send_status AS sendStatus, COUNT(1) AS c FROM batch_send_detail "
        + "WHERE tenant_id = #{tenantId} AND task_id = #{taskId} GROUP BY send_status")
List<Map<String, Object>> countByTask(@Param("tenantId") long tenantId, @Param("taskId") long taskId);
```

- [ ] **Step 5：建 kill-8180 工具（用 Write 工具建文件，别用 Bash heredoc——Bash 会吃掉 `$_`）。** `tmp/p7b-kill8180.ps1`：

```powershell
$procs = Get-CimInstance Win32_Process -Filter "Name = 'java.exe'" |
  Where-Object { $_.CommandLine -like '*smartscrm*' }
foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force }
Write-Output ("killed=" + $procs.Count)
```

按 CommandLine 里的 `*smartscrm*` 杀，**不要按端口或按进程名**：本机另有别的项目的 java/node 进程。

- [ ] **Step 6：编译并让 Flyway 跑迁移。** 先杀旧进程，再打包，再后台起服务，日志落 `tmp/p7b-server.log`：

```bash
cd /d/SmartSCRM && powershell -NoProfile -ExecutionPolicy Bypass -File tmp/p7b-kill8180.ps1
cd /d/SmartSCRM/apps/server && export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18" && set -o pipefail \
  && ./mvnw -DskipTests package > /d/SmartSCRM/tmp/p7b-build.log 2>&1 && tail -5 /d/SmartSCRM/tmp/p7b-build.log
cd /d/SmartSCRM/apps/server && nohup ./mvnw spring-boot:run > /d/SmartSCRM/tmp/p7b-server.log 2>&1 &
```

然后用条件轮询等启动完成（不许拍脑袋 sleep 10 秒）：

```bash
cd /d/SmartSCRM && node -e "const fs=require('fs');const f='tmp/p7b-server.log';for(let i=0;i<120;i++){const s=fs.existsSync(f)?fs.readFileSync(f,'utf8'):'';if(/Started ScrmServerApplication|APPLICATION FAILED/.test(s)){console.log(/Started/.test(s)?'started':'FAILED');process.exit(/Started/.test(s)?0:1)};require('child_process').execSync('sleep 1')}"
```

再 grep 迁移见证行：

```bash
grep -n 'version "11 - batch send"' /d/SmartSCRM/tmp/p7b-server.log 2>/dev/null || grep -n 'version "11 - batch send"' tmp/p7b-server.log
```

期望：命中 `Migrating schema \`smartscrm_react\` to version "11 - batch send"`。**这一行没出现就是迁移没跑**，不许改写成「表应该建好了」这种推断词。

- [ ] **Step 7：全量单测复跑**（同 Step 1 的命令），期望 `Tests run: <基线> , Failures: 0, Errors: 0`（本任务没加 Java 测试，所以数字不变）。

- [ ] **Step 8：提交。**

```bash
cd /d/SmartSCRM && git add apps/server/src/main/resources/db/migration/V11__batch_send.sql \
  apps/server/src/main/java/com/smartscrm/server/entity/BatchSendTask.java \
  apps/server/src/main/java/com/smartscrm/server/entity/BatchSendDetail.java \
  apps/server/src/main/java/com/smartscrm/server/mapper/BatchSendTaskMapper.java \
  apps/server/src/main/java/com/smartscrm/server/mapper/BatchSendDetailMapper.java
git commit -m "feat(P7/群发): V11 两张表 + 实体与 Mapper 状态迁移原语

心跳只给 running 续、CAS 式 moveTo、unknown 先于 pause 两拍。"
```

## Task 2: 展开与渲染（TDD，6 + 4 条 Java 单测）

**Files:**
- Create: `apps/server/src/main/java/com/smartscrm/server/service/batch/BatchRender.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/service/batch/BatchExpansion.java`
- Test: `apps/server/src/test/java/com/smartscrm/server/service/batch/BatchRenderTest.java`
- Test: `apps/server/src/test/java/com/smartscrm/server/service/batch/BatchExpansionTest.java`

**Interfaces:**
- Consumes: 无。
- Produces:
  - `BatchRender.CUSTOMER_TOKEN = "{客户名}"`、`BatchRender.PHONE_TOKEN = "{号码}"`
  - `record BatchRender.Fields(String nickname, String openId, String phone)`
  - `BatchRender.EMPTY_FIELDS = new Fields(null, null, null)`（Task 4 的 `getOrDefault` 用它兜底）
  - `static String BatchRender.render(String template, Fields fields)`
  - `record BatchExpansion.Recipient(long accountId, String chatKey, Long customerId)`
  - `record BatchExpansion.ExpandedRow(int seq, long accountId, String chatKey, Long customerId, int contentIndex, String body)`
  - `interface BatchExpansion.FieldSource { BatchRender.Fields fields(BatchExpansion.Recipient r); }` + `BatchExpansion.NO_FIELDS`
  - `static List<ExpandedRow> BatchExpansion.expand(List<Recipient> recipients, List<String> contents, FieldSource src)`

- [ ] **Step 1：先写失败的测试。** `BatchRenderTest.java`：

```java
package com.smartscrm.server.service.batch;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class BatchRenderTest {

    @Test
    void replacesBothKnownTokens() {
        String out = BatchRender.render("你好 {客户名}，你的号码是 {号码}",
                new BatchRender.Fields("Ada", "15000000000@c.us", "15000000000"));
        assertEquals("你好 Ada，你的号码是 15000000000", out);
    }

    @Test
    void missingNicknameFallsBackToOpenIdTailFour() {
        String out = BatchRender.render("{客户名} 您好",
                new BatchRender.Fields(null, "1500009999@c.us", null));
        assertEquals("9999 您好", out);
    }

    @Test
    void openIdShorterThanFourKeepsWholeTail() {
        String out = BatchRender.render("{客户名}",
                new BatchRender.Fields("  ", "77@c.us", null));
        assertEquals("77", out);
    }

    @Test
    void missingPhoneRendersEmptyAndMissingEverythingIsSafe() {
        assertEquals("[]", BatchRender.render("[{号码}]", new BatchRender.Fields(null, null, null)));
        assertEquals("[]", BatchRender.render("[{客户名}]", new BatchRender.Fields(null, "", null)));
    }

    @Test
    void keepsUnknownBracesVerbatim() {
        BatchRender.Fields f = new BatchRender.Fields("Ada", "12345@c.us", "7");
        // 未识别的花括号一个都不吞（{a{b}、{}、未闭合的 {客户名 都原样活下来）。
        assertEquals("{订单号} Ada {a{b} {} 7 {客户名",
                BatchRender.render("{订单号} {客户名} {a{b} {} {号码} {客户名", f));
    }

    @Test
    void rendersWithoutTokensAndWithoutTemplate() {
        assertEquals("纯文本", BatchRender.render("纯文本", BatchRender.EMPTY_FIELDS));
        assertEquals("", BatchRender.render(null, BatchRender.EMPTY_FIELDS));
    }
}
```

- [ ] **Step 2：跑，确认失败。**

```bash
cd /d/SmartSCRM/apps/server && export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18" && set -o pipefail && ./mvnw test -Dtest=BatchRenderTest 2>&1 | tail -20
```

期望：编译失败 `cannot find symbol: class BatchRender`（这就是「还没实现」的证据，不许跳过这步直接写实现）。

- [ ] **Step 3：写 `BatchRender.java`。**

```java
package com.smartscrm.server.service.batch;

/**
 * 群发正文的两个变量。只认这两个 token，其余花括号一律原样保留：
 * 正文里的合法花括号（占位说明、JSON 片段）被吞掉的代价比多一个字符大得多。
 * <p>
 * 兜底链只有一层，值由调用方备好：无客户会话的 nickname 交给会话标题、openId 交给
 * chat_key 的本地段（计划 R9），这里不再区分"有没有客户"，只看"这一格有没有值"。
 */
public final class BatchRender {

    public static final String CUSTOMER_TOKEN = "{客户名}";
    public static final String PHONE_TOKEN = "{号码}";

    public static final Fields EMPTY_FIELDS = new Fields(null, null, null);

    private BatchRender() {
    }

    /** nickname 缺失时用来兜底的串（客户 open_id，或会话键的本地段）。 */
    public record Fields(String nickname, String openId, String phone) {
    }

    public static String render(String template, Fields fields) {
        if (template == null) {
            return "";
        }
        Fields f = fields == null ? EMPTY_FIELDS : fields;
        return template
                .replace(CUSTOMER_TOKEN, customerName(f))
                .replace(PHONE_TOKEN, f.phone() == null ? "" : f.phone());
    }

    private static String customerName(Fields f) {
        String nickname = blankToNull(f.nickname());
        if (nickname != null) {
            return nickname;
        }
        return openIdTail(blankToNull(f.openId()));
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s;
    }

    /**
     * 先剥掉 `@` 之后的平台段再取尾 4 位：客户 open_id 与 chat_key 同形（`8613800001001@c.us`），
     * 不剥就会给每个无昵称的客户渲染出同一个 "c.us"。不足 4 位用整串——尾 4 位是为"认个人"，
     * 不是为"凑长度"。
     */
    private static String openIdTail(String openId) {
        if (openId == null) {
            return "";
        }
        int at = openId.indexOf('@');
        String local = at < 0 ? openId : openId.substring(0, at);
        return local.length() <= 4 ? local : local.substring(local.length() - 4);
    }
}
```

> 为什么用两次 `replace` 而不是扫字符找花括号：未识别的 `{...}` 要**原样保留**，那么"什么情况下不动它"就是"它不等于两个已知 token 之一"——按字面替换天然成立，`{a{b}`、未闭合 `{`、`{}` 全部原样活下来，无需第二套解析规则。

- [ ] **Step 4：跑 BatchRenderTest，6 条全绿。** 命令同 Step 2。

- [ ] **Step 5：写展开的失败测试。** `BatchExpansionTest.java`：

```java
package com.smartscrm.server.service.batch;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import org.junit.jupiter.api.Test;

class BatchExpansionTest {

    private static final List<String> TWO = List.of("第一条 {客户名}", "第二条 {号码}");

    private static final BatchExpansion.Recipient C1 = new BatchExpansion.Recipient(7L, "c1@c.us", 11L);
    private static final BatchExpansion.Recipient C2 = new BatchExpansion.Recipient(7L, "c2@c.us", null);

    private static final BatchExpansion.FieldSource NAMED = r ->
            new BatchRender.Fields("Nick-" + r.chatKey(), r.chatKey(), "13800000000");

    @Test
    void seqIsRecipientMajorAndContentsStayAdjacent() {
        List<BatchExpansion.ExpandedRow> rows =
                BatchExpansion.expand(List.of(C1, C2), TWO, NAMED);
        assertEquals(List.of(1, 2, 3, 4), rows.stream().map(BatchExpansion.ExpandedRow::seq).toList());
        assertEquals(List.of("c1@c.us", "c1@c.us", "c2@c.us", "c2@c.us"),
                rows.stream().map(BatchExpansion.ExpandedRow::chatKey).toList());
        assertEquals(List.of(0, 1, 0, 1),
                rows.stream().map(BatchExpansion.ExpandedRow::contentIndex).toList());
    }

    @Test
    void totalIsRecipientsTimesContents() {
        assertEquals(2 * TWO.size(), BatchExpansion.expand(List.of(C1, C2), TWO, NAMED).size());
        assertEquals(0, BatchExpansion.expand(List.of(), TWO, NAMED).size());
        assertEquals(0, BatchExpansion.expand(List.of(C1), List.of(), NAMED).size());
    }

    @Test
    void bodiesComeFromTheSameRendererForBothRecipients() {
        List<BatchExpansion.ExpandedRow> rows = BatchExpansion.expand(List.of(C1, C2), TWO, NAMED);
        assertEquals("第一条 Nick-c1@c.us", rows.get(0).body());
        assertEquals("第二条 13800000000", rows.get(1).body());
        assertEquals("第一条 Nick-c2@c.us", rows.get(2).body());
    }

    @Test
    void accountChatKeyAndCustomerIdAreCarriedThrough() {
        List<BatchExpansion.ExpandedRow> rows = BatchExpansion.expand(List.of(C1), TWO, BatchExpansion.NO_FIELDS);
        assertEquals(7L, rows.get(0).accountId());
        assertEquals(11L, rows.get(0).customerId().longValue());
        // NO_FIELDS 之下两个变量都走"什么都没有"的兜底：昵称空 + openId 空 → 空串。
        assertEquals("第一条 ", rows.get(0).body());
        assertEquals("第二条 ", rows.get(1).body());
    }
}
```

- [ ] **Step 6：跑，确认编译失败。**

- [ ] **Step 7：写 `BatchExpansion.java`。**

```java
package com.smartscrm.server.service.batch;

import java.util.ArrayList;
import java.util.List;

/**
 * 收件人主序展开：同一收件人的多条内容连续排完再换人。
 * 这样 msg_interval 只管"同人相邻两条"、chat_interval 只管"换人那一跳"，两个间隔各管一段，
 * 不需要在执行环里再判一次"上一条是不是同一个人"。
 */
public final class BatchExpansion {

    private BatchExpansion() {
    }

    public record Recipient(long accountId, String chatKey, Long customerId) {
    }

    public record ExpandedRow(int seq, long accountId, String chatKey, Long customerId,
                              int contentIndex, String body) {
    }

    @FunctionalInterface
    public interface FieldSource {
        BatchRender.Fields fields(Recipient recipient);
    }

    /** 预览与单测用的空字段源：变量一律走兜底。 */
    public static final FieldSource NO_FIELDS = r -> BatchRender.EMPTY_FIELDS;

    public static List<ExpandedRow> expand(List<Recipient> recipients, List<String> contents,
                                           FieldSource source) {
        List<ExpandedRow> rows = new ArrayList<>();
        if (recipients == null || contents == null) {
            return rows;
        }
        FieldSource src = source == null ? NO_FIELDS : source;
        int seq = 1;
        for (Recipient r : recipients) {
            BatchRender.Fields fields = src.fields(r);
            for (int ci = 0; ci < contents.size(); ci++) {
                rows.add(new ExpandedRow(seq++, r.accountId(), r.chatKey(), r.customerId(),
                        ci, BatchRender.render(contents.get(ci), fields)));
            }
        }
        return rows;
    }
}
```

- [ ] **Step 8：跑两条测试类，全绿。** `./mvnw test -Dtest='Batch*Test'`。

- [ ] **Step 9：全量单测**（`./mvnw test`），期望总数 = Task 1 基线 + 10。

- [ ] **Step 10：提交。**

```bash
cd /d/SmartSCRM && git add apps/server/src/main/java/com/smartscrm/server/service/batch \
  apps/server/src/test/java/com/smartscrm/server/service/batch
git commit -m "feat(P7/群发): 两个变量的渲染与收件人主序展开

未识别花括号原样保留；缺昵称落到 openId 尾 4 位，不足 4 位用整串。"
```

---

## Task 3: 规则、状态机与 JSON 列（TDD，+ 12 条 → 基线 + 22）

**Files:**
- Create: `apps/server/src/main/java/com/smartscrm/server/service/batch/BatchRules.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/service/batch/BatchStatus.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/service/batch/BatchJson.java`
- Test: `.../service/batch/BatchRulesTest.java`、`BatchStatusTest.java`、`BatchJsonTest.java`

**Interfaces:**
- Consumes: 无。
- Produces:
  - `BatchRules.MAX_RECIPIENTS=1000` / `MAX_CONTENTS=20` / `MAX_BODY=5000` / `MAX_DETAILS=20000` / `MAX_INTERVAL=3600` / `REAL_MIN_MSG_INTERVAL=3` / `REAL_MIN_CHAT_INTERVAL=5`
  - `static List<String> BatchRules.violations(String platform, int recipientCount, List<String> contents, int expandedTotal)`
  - `static List<String> BatchRules.intervalViolations(int msgMin, int msgMax, int chatMin, int chatMax, boolean dryRun)`
  - `static boolean BatchStatus.canMove(String from, String to)` / `recallBlocker(Boolean dryRun, String sendStatus, String msgKey)`（`null` = 有资格）
  - `static String BatchJson.encodeLongs(List<Long>)` / `encodeStrings(List<String>)` / `static List<Long> readLongs(String)` / `static List<String> readStrings(String)`

- [ ] **Step 1：写 `BatchRulesTest`（5 条）。**

```java
class BatchRulesTest {

    @Test
    void platformWhatsappOnly() {
        List<String> v = BatchRules.violations("telegram", 1, List.of("正文"), 1);
        assertTrue(v.contains("第一版只放开 whatsapp 平台"), "实际: " + v);
    }

    @Test
    void capsAreReportedTogetherNotFirstOnly() {
        List<String> contents = new ArrayList<>();
        for (int i = 0; i < 21; i++) {
            contents.add("正文" + i);
        }
        List<String> v = BatchRules.violations("whatsapp", 1001, contents, 20001);
        assertEquals(3, v.size(), "三条上限要一起回，实际: " + v);
        assertTrue(v.get(0).contains("1000"));
        assertTrue(v.get(1).contains("20"));
        assertTrue(v.get(2).contains("20000"));
    }

    @Test
    void blankAndOversizedBodiesAreNamedByIndex() {
        List<String> v = BatchRules.violations("whatsapp", 2, List.of("  ", "a".repeat(5001), "正常"), 6);
        assertEquals(2, v.size(), "实际: " + v);
        assertTrue(v.get(0).contains("第 1 条"), v.get(0));
        assertTrue(v.get(1).contains("第 2 条"), v.get(1));
    }

    @Test
    void realSendFloorsBiteButDryRunZeroPasses() {
        assertEquals(List.of(), BatchRules.intervalViolations(0, 0, 0, 0, true));
        List<String> v = BatchRules.intervalViolations(0, 8, 5, 15, false);
        assertEquals(1, v.size(), "实际: " + v);
        assertTrue(v.get(0).contains("3"), v.get(0));
    }

    @Test
    void intervalOrderAndCeiling() {
        List<String> v = BatchRules.intervalViolations(10, 8, 20, 4000, false);
        assertTrue(v.stream().anyMatch(s -> s.contains("min 不能大于 max")), "实际: " + v);
        assertTrue(v.stream().anyMatch(s -> s.contains("3600")), "实际: " + v);
    }
}
```

- [ ] **Step 2：跑 → 编译失败。Step 3：写 `BatchRules.java`：**

```java
package com.smartscrm.server.service.batch;

import java.util.ArrayList;
import java.util.List;

/**
 * 群发的入参规则。返回**全部**违规而不是第一条：1000 人 20 条内容的向导里，
 * 一次只回一条会让人改一条试一次，成本全在用户身上。
 * <p>
 * 正文上限 5000 与 trim 后非空这条口径与 desktop 的 isSendable 是同一条规则的两处写法（spec §3.3），
 * 改数必须同时改 `apps/desktop/src/main/services/msgBridge/msgApi.ts:114`。
 */
public final class BatchRules {

    public static final int MAX_RECIPIENTS = 1000;
    public static final int MAX_CONTENTS = 20;
    public static final int MAX_BODY = 5000;
    public static final int MAX_DETAILS = 20000;
    public static final int MAX_INTERVAL = 3600;
    public static final int REAL_MIN_MSG_INTERVAL = 3;
    public static final int REAL_MIN_CHAT_INTERVAL = 5;

    private static final String PLATFORM = "whatsapp";

    private BatchRules() {
    }

    public static List<String> violations(String platform, int recipientCount,
                                         List<String> contents, int expandedTotal) {
        List<String> out = new ArrayList<>();
        if (!PLATFORM.equals(platform)) {
            out.add("第一版只放开 whatsapp 平台");
        }
        if (recipientCount < 1) {
            out.add("收件人不能为空");
        } else if (recipientCount > MAX_RECIPIENTS) {
            out.add("收件人超过上限 " + MAX_RECIPIENTS + " 人");
        }
        int size = contents == null ? 0 : contents.size();
        if (size < 1) {
            out.add("内容不能为空");
        } else if (size > MAX_CONTENTS) {
            out.add("内容条数超过上限 " + MAX_CONTENTS + " 条");
        }
        if (expandedTotal > MAX_DETAILS) {
            out.add("展开后的明细总数超过上限 " + MAX_DETAILS + " 条");
        }
        if (contents != null) {
            for (int i = 0; i < contents.size(); i++) {
                String c = contents.get(i);
                if (c == null || c.isBlank()) {
                    out.add("第 " + (i + 1) + " 条正文是空的");
                } else if (c.length() > MAX_BODY) {
                    out.add("第 " + (i + 1) + " 条正文超过 " + MAX_BODY + " 字");
                }
            }
        }
        return out;
    }

    public static List<String> intervalViolations(int msgMin, int msgMax, int chatMin, int chatMax,
                                                 boolean dryRun) {
        List<String> out = new ArrayList<>();
        checkOne(out, "同人间隔", msgMin, msgMax, dryRun ? 0 : REAL_MIN_MSG_INTERVAL);
        checkOne(out, "换人间隔", chatMin, chatMax, dryRun ? 0 : REAL_MIN_CHAT_INTERVAL);
        return out;
    }

    private static void checkOne(List<String> out, String label, int min, int max, int realFloor) {
        if (min < 0) {
            out.add(label + " min 不能为负");
        }
        if (min > max) {
            out.add(label + " min 不能大于 max");
        }
        if (max > MAX_INTERVAL) {
            out.add(label + " max 不能超过 " + MAX_INTERVAL + " 秒");
        }
        if (min < realFloor) {
            out.add(label + " min 真发不能低于 " + realFloor + " 秒");
        }
    }
}
```

> `checkOne` 在 `dryRun` 时 `realFloor=0`，所以「演练 0 通过」与「真发 0 被拒」两条断言走的是同一条分支——这正是 spec §3.4 要的：下限只约束真发。

- [ ] **Step 4：写 `BatchStatusTest`（4 条）→ 跑 → 写 `BatchStatus.java`。**

```java
class BatchStatusTest {

    @Test
    void taskEdgesAreTheSpecifiedOnes() {
        assertTrue(BatchStatus.canMove("pending", "running"));
        assertTrue(BatchStatus.canMove("pending", "cancelled"));
        assertTrue(BatchStatus.canMove("running", "paused"));
        assertTrue(BatchStatus.canMove("running", "done"));
        assertTrue(BatchStatus.canMove("running", "error"));
        assertTrue(BatchStatus.canMove("running", "cancelled"));
        assertTrue(BatchStatus.canMove("paused", "running"));
        assertTrue(BatchStatus.canMove("paused", "cancelled"));
        // R11：重发是唯一能把终态唤醒的动作，而且只唤醒到 paused（要再跑必须由人点「继续」）。
        assertTrue(BatchStatus.canMove("done", "paused"));
        assertTrue(BatchStatus.canMove("error", "paused"));
    }

    @Test
    void terminalStatesCannotRestart() {
        assertFalse(BatchStatus.canMove("done", "running"));
        assertFalse(BatchStatus.canMove("error", "running"));
        assertFalse(BatchStatus.canMove("cancelled", "running"));
        assertFalse(BatchStatus.canMove("cancelled", "paused"), "取消是人明确按下的停，重发不唤醒它");
        assertFalse(BatchStatus.canMove("done", "cancelled"), "已经跑完的任务没有可取消的东西");
        assertFalse(BatchStatus.canMove("done", "error"), "终态之间不互搬");
        assertFalse(BatchStatus.canMove("pending", "paused"), "没跑过没有什么可暂停");
        assertFalse(BatchStatus.canMove(null, "running"));
    }

    @Test
    void dryRunIsTheFirstRecallBlocker() {
        assertEquals("演练任务没有真发过，无物可撤",
                BatchStatus.recallBlocker(true, "success", "true_x@c.us_Y_out"));
    }

    @Test
    void sendStateThenMsgKeyDecideTheRest() {
        assertEquals("这一条不是成功状态（send_status=unknown），撤回无从谈起",
                BatchStatus.recallBlocker(false, "unknown", "true_x@c.us_Y_out"));
        assertEquals("这一条没有 msg_key，无法定位要撤哪条消息",
                BatchStatus.recallBlocker(false, "success", null));
        assertNull(BatchStatus.recallBlocker(false, "success", "true_x@c.us_Y_out"));
    }
}
```

```java
package com.smartscrm.server.service.batch;

import java.util.Map;
import java.util.Set;

/**
 * 任务状态机的合法边 + 撤回资格。裁决只在这一处：控制器、服务、执行环都来这里问，
 * 于是"pending 能不能暂停"在系统里只有一个答案。
 */
public final class BatchStatus {

    private static final Map<String, Set<String>> TASK_EDGES = Map.of(
            "pending", Set.of("running", "cancelled"),
            "running", Set.of("paused", "done", "error", "cancelled"),
            "paused", Set.of("running", "cancelled"),
            // R11：这两条只服务重发（done/error → paused），由 Task 5 的 retryFailed 独占；
            // 「暂停」动作的来源态表在 BatchSendService.SOURCES_OF 里仍然只有 running，
            // 所以没有人能从一个跑完的任务点出「暂停」。
            "done", Set.of("paused"),
            "error", Set.of("paused")
    );

    private BatchStatus() {
    }

    public static boolean canMove(String from, String to) {
        if (from == null || to == null) {
            return false;
        }
        return TASK_EDGES.getOrDefault(from, Set.of()).contains(to);
    }

    /** @return null 表示这三条都过了；否则是人能看懂的一句话（spec §2 的三条判据，按顺序判；第四条「recall_status 不是 none」在 Task 5 的服务层判）。 */
    public static String recallBlocker(Boolean dryRun, String sendStatus, String msgKey) {
        if (Boolean.TRUE.equals(dryRun)) {
            return "演练任务没有真发过，无物可撤";
        }
        if (!"success".equals(sendStatus)) {
            return "这一条不是成功状态（send_status=" + sendStatus + "），撤回无从谈起";
        }
        if (msgKey == null || msgKey.isBlank()) {
            return "这一条没有 msg_key，无法定位要撤哪条消息";
        }
        return null;
    }
}
```

- [ ] **Step 5：写 `BatchJsonTest`（3 条）→ 跑 → 写 `BatchJson.java`。**

```java
class BatchJsonTest {

    @Test
    void stringsSurviveQuotesBackslashAndNewline() {
        List<String> in = List.of("他说\"你好\"", "C:\\路径", "两\n行");
        String json = BatchJson.encodeStrings(in);
        assertEquals(in, BatchJson.readStrings(json));
    }

    @Test
    void longsRoundTripAndEmptyListIsTwoBrackets() {
        assertEquals("[7,8,9]", BatchJson.encodeLongs(List.of(7L, 8L, 9L)));
        assertEquals("[]", BatchJson.encodeStrings(List.of()));
        assertEquals(List.of(), BatchJson.readLongs("[]"));
        assertEquals(List.of(), BatchJson.readLongs(null));
    }

    @Test
    void malformedOrWrongShapeIsAnErrorNotEmptyList() {
        assertThrows(IllegalStateException.class, () -> BatchJson.readLongs("not json"));
        assertThrows(IllegalStateException.class, () -> BatchJson.readStrings("{}"));
        assertThrows(IllegalStateException.class, () -> BatchJson.readLongs("[\"x\"]"));
    }
}
```

```java
package com.smartscrm.server.service.batch;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;

/**
 * `batch_send_task` 那两个 TEXT 列（account_ids / contents）的编解码。
 * 用 ObjectMapper 而不是拼字符串：contents 是用户写的正文，里面什么字符都可能有的
 * （引号、反斜杠、换行），转义规则不是本项目该重新发明一遍的东西。
 * `new ObjectMapper()` 这份形制与 service/provider 下的两处一致，不注册 Spring 的 mapper bean。
 * <p>
 * 读侧出错一律抛 IllegalStateException 而不是回空表：这两列是任务定义本身，
 * 解不出来就是数据坏了，静默回空表会让引擎"跑一个没有内容的任务"。
 */
public final class BatchJson {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private BatchJson() {
    }

    public static String encodeLongs(List<Long> values) {
        try {
            return MAPPER.writeValueAsString(values == null ? List.of() : values);
        } catch (Exception e) {
            throw new IllegalStateException("account_ids 编码失败", e);
        }
    }

    public static String encodeStrings(List<String> values) {
        try {
            return MAPPER.writeValueAsString(values == null ? List.of() : values);
        } catch (Exception e) {
            throw new IllegalStateException("contents 编码失败", e);
        }
    }

    public static List<Long> readLongs(String json) {
        return read(json, new TypeReference<List<Long>>() { });
    }

    public static List<String> readStrings(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        return read(json, new TypeReference<List<String>>() { });
    }

    private static <T> T read(String json, TypeReference<T> type) {
        if (json == null || json.isBlank()) {
            try {
                return MAPPER.readValue("[]", type);
            } catch (Exception e) {
                throw new IllegalStateException("JSON 列空白成形失败", e);
            }
        }
        try {
            return MAPPER.readValue(json, type);
        } catch (Exception e) {
            throw new IllegalStateException("JSON 列解不出来: " + json, e);
        }
    }
}
```

- [ ] **Step 6：全量单测** `./mvnw test`，期望总数 = Task 1 基线 + 22，0 failures。（整枝修复轮之后这一列的真实分母是 **115** = 81 + 22 + 12，见 Task 16 Step 1。）
- [ ] **Step 7：提交。** `git commit -m "feat(P7/群发): 上限/间隔规则、任务状态机与两个 JSON 列编解码"`（正文写一句：违规一次全回、下限只咬真发、unknown 无撤回资格）。

---

## Task 4: 创建即展开 + 预览 + 五个读端点

**Files:**
- Create: `web/dto/BatchRecipientDTO.java`、`BatchTaskCreateDTO.java`、`BatchPreviewDTO.java`
- Create: `web/vo/BatchTaskVO.java`、`BatchDetailVO.java`、`BatchRejectedVO.java`、`BatchCreateVO.java`、`BatchPreviewVO.java`
- Create: `service/BatchSendService.java`
- Create: `web/BatchSendController.java`
- Modify: `docs/superpowers/specs/2026-09-28-batch-send-design.md`（§3 回填 R1/R8/R9/R10）

**Interfaces:**
- Consumes: Task 1 的两个 Mapper 与实体；Task 2 的 `BatchExpansion`/`BatchRender`；Task 3 的 `BatchRules`/`BatchJson`；现有 `entity/PlatformAccount.java`（`id,tenantId,viewId,name,status,platformType`）、`entity/ChatConversation.java`（`id,tenantId,platform,accountId,chatKey,title,customerId,...`）、`entity/Customer.java`（`id,nickname,openId,phone`）。
- Produces（Task 5、6、12 都靠这些名字）:
  - `BatchCreateVO create(long tenantId, BatchTaskCreateDTO dto)` → `{ taskId, rejected[], totalCount }`
  - `BatchPreviewVO preview(BatchPreviewDTO dto)` → `{ rows[], truncated }`
  - `PageResult<BatchTaskVO> pageTasks(long tenantId, String status, int page, int size)`
  - `BatchTaskVO task(long tenantId, long id)`
  - `PageResult<BatchDetailVO> pageDetails(long tenantId, long taskId, String sendStatus, String recallStatus, int page, int size)`
  - `BatchSendService.requireOwned(long tenantId, long taskId)` → `BatchSendTask`（Task 5 复用）

- [ ] **Step 1：DTO。** `BatchRecipientDTO`：

```java
public class BatchRecipientDTO {
    @NotNull
    private Long accountId;
    @NotBlank
    @Size(max = 128)
    private String chatKey;
    // getter/setter（本项目 DTO 用显式 getter/setter，不用 Lombok @Data —— 见 web/dto/AudienceRequest.java）
}
```

`BatchTaskCreateDTO`（**四个间隔用包装类型 `Integer` 且 `@NotNull`**：基本类型 `int` 会让"前端少传一个字段"静默变成 0，而 0 在演练档是合法值，这条链上就再也看不出是漏传还是故意）：

```java
public class BatchTaskCreateDTO {
    @NotBlank @Size(max = 64) private String name;
    @NotBlank @Size(max = 16) private String platform;
    @NotNull private Boolean dryRun;
    @NotNull private List<Long> accountIds;
    @Valid @NotNull private List<BatchRecipientDTO> conversations;
    @Valid @NotNull private List<String> contents;
    @NotNull private Integer msgIntervalMin;
    @NotNull private Integer msgIntervalMax;
    @NotNull private Integer chatIntervalMin;
    @NotNull private Integer chatIntervalMax;
}
```

`BatchPreviewDTO`：`@Valid @NotNull List<BatchRecipientDTO> conversations` + `@NotNull List<String> contents`（预览不需要任务名与间隔）。

- [ ] **Step 2：VO。** `BatchTaskVO` 带 `id,name,platform,dryRun,status,accountIds(List<Long>),contents(List<String>),msgIntervalMin/Max,chatIntervalMin/Max,totalCount,sentCount,failCount,heartbeatAt,createdAt`。`BatchDetailVO` 带 `id,taskId,seq,accountId,chatKey,customerId,contentIndex,body,localId,sendStatus,errorCode,errorDetail,msgKey,recallStatus,recallDetail,sentAt`。`BatchRejectedVO(String chatKey, Long accountId, String reason)`。`BatchCreateVO(long taskId, List<BatchRejectedVO> rejected, int totalCount)`。`BatchPreviewVO(List<Sample> rows, boolean truncated)` —— `record Sample(String chatKey, int contentIndex, String body)`，定义在 `BatchPreviewVO` 内部。

**两个时间字段（`heartbeatAt`、`sentAt`）用 `LocalDateTime`，不换算 epoch 秒**（读码：出参一律给 `LocalDateTime`——`web/vo/ConversationVO.java:8` 的 `lastMsgTime`、`web/vo/MessageVO.java:10` 的 `msgTime`、`web/vo/CustomerVO.java:20` 的 `lastContactAt`；仓库里没有任何 ObjectMapper 定制，Boot 默认把 `LocalDateTime` 序列化成不带偏移的墙钟串）。 epoch 秒只活在**入参**方向：`web/dto/MessageItemDTO.java:18` 的 `msgTimeEpochSec` 进库前由 `MsgTimes.toDbTime` 换算（Task 5 的 `BatchReportItemDTO.sentAtEpochSec` 与它同形）。两套口径各管一边，混用就会在渲染层出现"同一个字段一会儿是数一会儿是串"。Task 7 的 shared 模型、Task 8 的 `ReportItem`、Task 15 的显示都按这份口径写。

- [ ] **Step 3：服务里的创建。** `BatchSendService`（构造注入 `BatchSendTaskMapper`、`BatchSendDetailMapper`、`PlatformAccountMapper`、`ChatConversationMapper`、`CustomerMapper`）：

```java
@Service
public class BatchSendService {

    /** 预览只渲染前 5 个收件人：向导里要看的是"变量填得对不对"，不是"能不能刷屏"。 */
    private static final int PREVIEW_MAX_RECIPIENTS = 5;
    private static final int INSERT_CHUNK = 500;

    @Transactional
    public BatchCreateVO create(long tenantId, BatchTaskCreateDTO dto) {
        List<BatchRecipientDTO> recipients = dedupe(dto.getConversations());
        int expandedTotal = recipients.size() * dto.getContents().size();
        List<String> v = new ArrayList<>(BatchRules.violations(dto.getPlatform(), recipients.size(),
                dto.getContents(), expandedTotal));
        v.addAll(BatchRules.intervalViolations(dto.getMsgIntervalMin(), dto.getMsgIntervalMax(),
                dto.getChatIntervalMin(), dto.getChatIntervalMax(), Boolean.TRUE.equals(dto.getDryRun())));
        if (dto.getAccountIds() == null || dto.getAccountIds().isEmpty()) {
            // spec §3.2 的第一句「accountIds 非空」归任务头，不进 BatchRules（它的签名只管任务体）。
            // 必须打在 requireAccountsBound 之前：空表会让那条 IN 塌成 `IN ()`，回 500 而不是 40013。
            v.add("账号不能为空");
        }
        if (!v.isEmpty()) {
            throw new BizException(40013, String.join("；", v));
        }
        requireAccountsBound(tenantId, dto.getAccountIds());

        Map<String, ChatConversation> convIndex = loadConversations(tenantId, recipients);
        Set<Long> chosen = new HashSet<>(dto.getAccountIds());
        List<BatchExpansion.Recipient> ok = new ArrayList<>();
        List<BatchRejectedVO> rejected = new ArrayList<>();
        for (BatchRecipientDTO r : recipients) {
            ChatConversation c = convIndex.get(convKey(r.getAccountId(), r.getChatKey()));
            if (!chosen.contains(r.getAccountId())) {
                // spec §3.2 的后半句「account_id ∈ accountIds」。不拦在这里的代价是静默半跑：
                // Task 11 的 buildQueues 按 accountIds 分组，不属于任何一组的明细行永远留在 pending，
                // openCount 也就永远不归零、任务永远到不了 done。
                rejected.add(new BatchRejectedVO(r.getChatKey(), r.getAccountId(), "这条会话所属的账号不在本次勾选的账号里"));
            } else if (c == null) {
                rejected.add(new BatchRejectedVO(r.getChatKey(), r.getAccountId(), "当前账号下没有这条会话的采集记录"));
            } else {
                ok.add(new BatchExpansion.Recipient(r.getAccountId(), r.getChatKey(), c.getCustomerId()));
            }
        }
        if (ok.isEmpty()) {
            throw new BizException(40012, "所有收件人都不可寻址");
        }
        Map<String, BatchRender.Fields> fieldsByKey = resolveFields(tenantId, convIndex, ok);
        List<BatchExpansion.ExpandedRow> rows = BatchExpansion.expand(ok, dto.getContents(),
                r -> fieldsByKey.getOrDefault(convKey(r.accountId(), r.chatKey()), BatchRender.EMPTY_FIELDS));

        // 先落任务头拿自增 id，再分块落明细，最后用 countByTask 自检（spec §3.5）。
        BatchSendTask task = newTask(tenantId, dto, rows.size());
        taskMapper.insert(task);
        List<BatchSendDetail> details = toDetails(tenantId, task.getId(), rows);
        for (int i = 0; i < details.size(); i += INSERT_CHUNK) {
            detailMapper.insertBatch(details.subList(i, Math.min(i + INSERT_CHUNK, details.size())));
        }
        long counted = detailMapper.countByTask(tenantId, task.getId()).stream()
                .mapToLong(m -> ((Number) m.get("c")).longValue()).sum();
        if (counted != rows.size()) {
            // @Transactional 会回滚，所以这条抛出去就是"一行都不留"，不是"留一半"。
            throw new BizException(40014, "展开自检失败：期望 " + rows.size() + " 行，实落 " + counted + " 行");
        }
        return new BatchCreateVO(task.getId(), rejected, rows.size());
    }

    /** 保序去重：同一条会话在选人面板里可能被勾两次。key = accountId + ":" + chatKey。 */
    private List<BatchRecipientDTO> dedupe(List<BatchRecipientDTO> in) {
        Map<String, BatchRecipientDTO> m = new LinkedHashMap<>();
        for (BatchRecipientDTO r : in) {
            m.putIfAbsent(convKey(r.getAccountId(), r.getChatKey()), r);
        }
        return new ArrayList<>(m.values());
    }

    private String convKey(Long accountId, String chatKey) {
        return accountId + ":" + chatKey;
    }

    /** 缺任何一个 id、或它的 viewId 是空，都算账号不可用 —— 点名是哪几个。 */
    private void requireAccountsBound(long tenantId, List<Long> accountIds) {
        List<PlatformAccount> found = accountMapper.selectList(new LambdaQueryWrapper<PlatformAccount>()
                .eq(PlatformAccount::getTenantId, tenantId)
                .in(PlatformAccount::getId, accountIds));
        Map<Long, PlatformAccount> byId = new HashMap<>();
        found.forEach(a -> byId.put(a.getId(), a));
        List<String> bad = new ArrayList<>();
        for (Long id : accountIds) {
            PlatformAccount a = byId.get(id);
            if (a == null || a.getViewId() == null || a.getViewId().isBlank()) {
                bad.add(String.valueOf(id));
            }
        }
        if (!bad.isEmpty()) {
            throw new BizException(40011, "账号不可用: " + String.join(",", bad));
        }
    }

    /** 一次性把这些账号涉及会话捞进内存表，避免 N 个收件人打 N 次库。 */
    private Map<String, ChatConversation> loadConversations(long tenantId, List<BatchRecipientDTO> recipients) {
        Set<Long> accounts = new HashSet<>();
        Set<String> keys = new HashSet<>();
        recipients.forEach(r -> {
            accounts.add(r.getAccountId());
            keys.add(r.getChatKey());
        });
        List<ChatConversation> found = conversationMapper.selectList(new LambdaQueryWrapper<ChatConversation>()
                .eq(ChatConversation::getTenantId, tenantId)
                .in(ChatConversation::getAccountId, accounts)
                .in(ChatConversation::getChatKey, keys));
        Map<String, ChatConversation> index = new HashMap<>();
        found.forEach(c -> index.put(convKey(c.getAccountId(), c.getChatKey()), c));
        return index;
    }

    /**
     * 两个变量的取值来源（R9）：有客户用客户档案；没客户落到会话标题与 chat_key 本地段。
     * 一次性批量查客户，绝不在循环里 selectById —— 1000 个收件人会打出 1000 条 SQL。
     * 这批 id 来自会话行，带 `tenant_id` 闸是照仓库既有形制（读码：每一条 by-id 的客户读都先 eq 租户
     * ——`MessageQueryService.java:376` 的 selectCount、`TranslationService.java:153` 的 selectOne）：
     * 错链的那一行会把别人的昵称/号码渲染进 `body`，而 `body` 是要发出去的。
     */
    private Map<String, BatchRender.Fields> resolveFields(long tenantId,
                                                          Map<String, ChatConversation> convIndex,
                                                          List<BatchExpansion.Recipient> ok) {
        Set<Long> customerIds = new HashSet<>();
        ok.forEach(r -> {
            if (r.customerId() != null) {
                customerIds.add(r.customerId());
            }
        });
        Map<Long, Customer> customers = new HashMap<>();
        if (!customerIds.isEmpty()) {
            customerMapper.selectList(new LambdaQueryWrapper<Customer>()
                            .eq(Customer::getTenantId, tenantId)
                            .in(Customer::getId, customerIds))
                    .forEach(c -> customers.put(c.getId(), c));
        }
        Map<String, BatchRender.Fields> out = new HashMap<>();
        for (BatchExpansion.Recipient r : ok) {
            ChatConversation c = convIndex.get(convKey(r.accountId(), r.chatKey()));
            Customer cu = r.customerId() == null ? null : customers.get(r.customerId());
            String nickname = cu != null && cu.getNickname() != null ? cu.getNickname() : (c == null ? null : c.getTitle());
            String openId = cu != null && cu.getOpenId() != null ? cu.getOpenId() : localPart(r.chatKey());
            out.put(convKey(r.accountId(), r.chatKey()),
                    new BatchRender.Fields(nickname, openId, cu == null ? null : cu.getPhone()));
        }
        return out;
    }

    /** `8613800000000@c.us` → `8613800000000`；群聊键 `1234-5678@c.us` 保持整串本地段。 */
    private String localPart(String chatKey) {
        int at = chatKey.indexOf('@');
        return at < 0 ? chatKey : chatKey.substring(0, at);
    }

    private BatchSendTask newTask(long tenantId, BatchTaskCreateDTO dto, int totalCount) {
        BatchSendTask t = new BatchSendTask();
        t.setTenantId(tenantId);
        t.setName(dto.getName().trim());
        t.setPlatform(dto.getPlatform());
        t.setDryRun(dto.getDryRun());
        t.setStatus("pending");
        t.setAccountIds(BatchJson.encodeLongs(dto.getAccountIds()));
        t.setContents(BatchJson.encodeStrings(dto.getContents()));
        t.setMsgIntervalMin(dto.getMsgIntervalMin());
        t.setMsgIntervalMax(dto.getMsgIntervalMax());
        t.setChatIntervalMin(dto.getChatIntervalMin());
        t.setChatIntervalMax(dto.getChatIntervalMax());
        t.setTotalCount(totalCount);
        t.setSentCount(0);
        t.setFailCount(0);
        return t;
    }

    private List<BatchSendDetail> toDetails(long tenantId, long taskId, List<BatchExpansion.ExpandedRow> rows) {
        List<BatchSendDetail> out = new ArrayList<>(rows.size());
        for (BatchExpansion.ExpandedRow r : rows) {
            BatchSendDetail d = new BatchSendDetail();
            d.setTenantId(tenantId);
            d.setTaskId(taskId);
            d.setSeq(r.seq());
            d.setAccountId(r.accountId());
            d.setChatKey(r.chatKey());
            d.setCustomerId(r.customerId());
            d.setContentIndex(r.contentIndex());
            d.setBody(r.body());
            d.setSendStatus("pending");
            d.setRecallStatus("none");
            out.add(d);
        }
        return out;
    }
}
```

要点（上面这份代码已经把它们写进语句里了，列在这里是复核清单）：

1. 上限/间隔规则不过 → `40013`，`message` 是所有违规用「；」拼起来（Task 3 的 `violations` 一次给全）。
2. 收件人解析走 `loadConversations` 一次查、`resolveFields` 一次查客户，**循环里没有 SQL**。
3. 部分不可寻址照常创建并逐个点名（R8）——两种原因分开点名：账号不在本次勾选清单里 / 该账号下没有这条会话的采集记录；全员不可寻址 → `40012`。
4. 总数自检不等 → `40014` 抛出，`@Transactional` 回滚，库里不留半成品。
5. `preview` 与明细正文走的是同一个 `BatchRender`（spec §4 明写"渲染规则只有后端一份"）。

- [ ] **Step 4：预览与读端点。** `preview` 复用 `BatchRender`（同一份规则只有一个实现，spec §4 明写）：取 `conversations` 前 `PREVIEW_MAX_RECIPIENTS` 条，逐条逐内容生成 `{chatKey, contentIndex, body}`，`truncated = conversations.size() > 5`。**预览不查库、不校验会话存在性**——它是渲染器预览，不是收件人校验；这一步查库会让人在向导里边打字边等一次 join。

`pageTasks` / `task` / `pageDetails`：`LambdaQueryWrapper` 加 `eq(tenantId)` + 可选 `eq(status)` / `eq(sendStatus)` / `eq(recallStatus)`，`orderByAsc(BatchSendDetail::getSeq)`（明细）/ `orderByDesc(BatchSendTask::getId)`（任务列表），分页用现有 `PageResult.of(records, total, page, pageSize)`。`requireOwned` 用 `LambdaQueryWrapper` 按 `tenantId + id` 取，取不到 → `BizException(40404, "任务不存在")`。

**每页条数：入参叫 `size`，出参叫 `pageSize`，两个方向两套名。** 入参的名以 spec §4 的端点表为准（`?page=&size=`）。仓库里"每页条数"这个入参本来就有两派写法：`ConversationController.java:36`、`MessageController.java:54`、`CustomerController.java:65` 收 `size`（那三处是游标 + `size`，没有 `page`），`AudienceController.java:47` 与 `CustomerController.java:45`（列表分页那一跳）收 `pageSize`。群发这一片统一用 `size`，跟的是 §4 那张表，不是跟某一处旧代码；出参照 `common/PageResult.java` 的 record 组件名 `pageSize`，那是响应体字段、不是查询参数。Task 6 的契约腿、Task 8 的 query 串、Task 13 的两个 hook 一律拼 `size=`。拼成 `pageSize=` 不会报错——Spring 只是不绑定，然后静默回到默认页大小，断言看起来"过了"其实测的是默认值（实测：`tasks?page=1&size=1` 回显 `pageSize:1`，`tasks?page=1&pageSize=1` 回显 `pageSize:20`）。

实体 → VO 只有这一份映射，Task 5 的 `resultOf` 与三个读端点都调它（JSON 列在这里拆，别的地方拿到的一直是 `List`）：

```java
    /** 两个 JSON 列 + 心跳：实体存串，VO 给结构。时间原样透传 LocalDateTime（Task 4 Step 2 的口径）。 */
    private BatchTaskVO toVO(BatchSendTask t) {
        return new BatchTaskVO(t.getId(), t.getName(), t.getPlatform(), Boolean.TRUE.equals(t.getDryRun()),
                t.getStatus(), BatchJson.readLongs(t.getAccountIds()), BatchJson.readStrings(t.getContents()),
                t.getMsgIntervalMin(), t.getMsgIntervalMax(), t.getChatIntervalMin(), t.getChatIntervalMax(),
                t.getTotalCount(), t.getSentCount(), t.getFailCount(), t.getHeartbeatAt(), t.getCreatedAt());
    }

    private BatchDetailVO toVO(BatchSendDetail d) {
        return new BatchDetailVO(d.getId(), d.getTaskId(), d.getSeq(), d.getAccountId(), d.getChatKey(),
                d.getCustomerId(), d.getContentIndex(), d.getBody(), d.getLocalId(), d.getSendStatus(),
                d.getErrorCode(), d.getErrorDetail(), d.getMsgKey(), d.getRecallStatus(), d.getRecallDetail(),
                d.getSentAt());
    }
```

`BatchTaskVO` / `BatchDetailVO` 都是 `record`（形制照 `web/vo/ConversationVO.java`），组件顺序与上面构造调用的实参顺序逐个一致——`BatchDetailVO` 的那 16 个字段就是 Interfaces 里列出的那份。

- [ ] **Step 5：控制器。**

```java
@RestController
@RequestMapping("/api/batch-send")
public class BatchSendController {

    private final BatchSendService service;

    public BatchSendController(BatchSendService service) {
        this.service = service;
    }

    @PostMapping("/tasks")
    public ApiResponse<BatchCreateVO> create(@AuthenticationPrincipal AuthPrincipal principal,
                                             @Valid @RequestBody BatchTaskCreateDTO dto) {
        return ApiResponse.ok(service.create(principal.tenantId(), dto));
    }

    @GetMapping("/tasks")
    public ApiResponse<PageResult<BatchTaskVO>> list(@AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam(required = false) String status,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ApiResponse.ok(service.pageTasks(principal.tenantId(), status, page, size));
    }

    @GetMapping("/tasks/{id}")
    public ApiResponse<BatchTaskVO> one(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable long id) {
        return ApiResponse.ok(service.task(principal.tenantId(), id));
    }

    @GetMapping("/tasks/{id}/details")
    public ApiResponse<PageResult<BatchDetailVO>> details(@AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable long id,
            @RequestParam(required = false) String sendStatus,
            @RequestParam(required = false) String recallStatus,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "50") int size) {
        return ApiResponse.ok(service.pageDetails(principal.tenantId(), id, sendStatus, recallStatus, page, size));
    }

    @PostMapping("/preview")
    public ApiResponse<BatchPreviewVO> preview(@AuthenticationPrincipal AuthPrincipal principal,
                                               @Valid @RequestBody BatchPreviewDTO dto) {
        return ApiResponse.ok(service.preview(dto));
    }
}
```

- [ ] **Step 6：跑 `./mvnw test`** —— 本任务不加 Java 测试（规则与展开已在 Task 2/3 覆盖，这里是装配；它的腿是 Task 6 的 HTTP 契约驱动）。期望基线 + 22 仍全绿。
- [ ] **Step 7：`pnpm`? 不。** 起后端并手工确认迁移与建表在跑（`tmp/p7b-server.log` 里那行 `"11 - batch send"` 已出现），带 token `POST /api/batch-send/preview` 手打一次两变量的正文，确认返回体里的 body 已渲染 —— 这一条只是冒烟，正式断言在 Task 6。
- [ ] **Step 8：spec 回填。** 在 `docs/superpowers/specs/2026-09-28-batch-send-design.md` §3 末尾加一小段「落地裁定」，写入 R1（码表）、R8（部分拒绝成功、全部拒绝才整单拒）、R9（无客户会话的 `{客户名}` 兜底链）、R10（收件人只认 `conversations`）四条，只写规则本身，不写实现过程。
- [ ] **Step 9：提交。**

```bash
git add apps/server/src/main/java docs/superpowers/specs/2026-09-28-batch-send-design.md
git commit -m "feat(P7/群发): 创建即展开与预览复用同一个渲染器

部分不可寻址点名返回、总数自检不等即整单回滚；spec §3 补四条落地裁定。"
```

---

## Task 5: 运行面十个端点（start/pause/resume/cancel/heartbeat/reports/retry-failed/recall/recall-reports/reconcile）

**Files:**
- Create: `web/dto/BatchReportItemDTO.java`、`BatchReportsDTO.java`、`BatchRecallRequestDTO.java`、`BatchRecallReportItemDTO.java`、`BatchRecallReportsDTO.java`、`BatchRetryDTO.java`
- Create: `web/vo/BatchReportsResultVO.java`、`BatchRecallVO.java`
- Modify: `service/BatchSendService.java`、`web/BatchSendController.java`
- Modify: `docs/superpowers/specs/2026-09-28-batch-send-design.md`（§4/§5 回填 R4 两拍与 `POST /reconcile`）

**Interfaces:**
- Consumes: Task 1 全部 mapper 原语；Task 3 `BatchStatus`；Task 4 `requireOwned`。
- Produces（Task 8 的 `batchApi.ts` 按这些形状一一对齐）:
  - `BatchReportsResultVO transition(long tenantId, long taskId, String action)`
  - `int BatchSendService.heartbeat(long tenantId, long taskId)`
  - `BatchReportsResultVO reports(long tenantId, long taskId, BatchReportsDTO dto)`
  - `Map<String,Object> retryFailed(long tenantId, long taskId, List<Long> detailIds)` → `{reset, status}`（`detailIds` 空＝整批；`status` 是复位后任务态，可能是被唤醒的 `paused`，R11）
  - `BatchRecallVO recall(long tenantId, long taskId, List<Long> detailIds)`
  - `int recallReports(long tenantId, long taskId, BatchRecallReportsDTO dto)`（先 `requireOwned`，任务不存在回 `40404`；返回结掉的行数：只有 `recalling` 的行结得掉，差值就是"迟到的那一报"）
  - `Map<String,Object> reconcile(long tenantId)` → `{pausedTasks, markedUnknown}`
  - DTO/VO 字段：`BatchReportItemDTO{ @NotNull Long detailId, @Size(max=64) String localId, @NotBlank String sendStatus, @Size(max=32) String errorCode, @Size(max=255) String errorDetail, @Size(max=160) String msgKey, Long sentAtEpochSec }`；`BatchReportsDTO{ @Valid List<BatchReportItemDTO> items, boolean allHalted }`（**items 不加 `@NotEmpty`**：收尾那一跳只带结论不带条目）；`BatchRecallRequestDTO{ @NotEmpty List<Long> detailIds }`；`BatchRecallReportsDTO{ @Valid @NotNull List<BatchRecallReportItemDTO> items }`、`BatchRecallReportItemDTO{ @NotNull Long detailId, @NotNull Boolean recalled, @Size(max=255) String detail }`（这三个字段名就是 Task 8 线上拼的 `{detailId, recalled, detail}`，一个都不能改叫别的：叫 `ok` 的话每一条报都读成 `recalled=undefined → false`，撤**成功**的行会被记成 `recall_failed`，而这是写进库的结论）；`BatchRecallVO{ List<Target> eligible, List<Blocked> rejected }`，`Target(long detailId, long accountId, String chatKey, String msgKey)`、`Blocked(long detailId, String reason)`；`BatchReportsResultVO(int sentCount, int failCount, int totalCount, String status)`。

- [ ] **Step 1：状态迁移一个口。**

```java
    /** action → 目标态；action → 允许的来源态集合。两张表就是 spec §2 状态机全部代码化。 */
    private static final Map<String, String> TARGET_OF = Map.of(
            "start", "running", "pause", "paused", "resume", "running", "cancel", "cancelled");
    private static final Map<String, List<String>> SOURCES_OF = Map.of(
            "start", List.of("pending", "paused"),
            "pause", List.of("running"),
            "resume", List.of("paused"),
            "cancel", List.of("pending", "running", "paused"));

    @Transactional
    public BatchReportsResultVO transition(long tenantId, long taskId, String action) {
        BatchSendTask task = requireOwned(tenantId, taskId);
        String to = TARGET_OF.get(action);
        List<String> sources = SOURCES_OF.getOrDefault(action, List.of());
        if (to == null || !sources.contains(task.getStatus()) || !BatchStatus.canMove(task.getStatus(), to)) {
            throw new BizException(40902,
                    "当前状态 " + task.getStatus() + " 不能 " + action, HttpStatus.CONFLICT);
        }
        // 0 行 = 有人先我一步搬走了它（两个窗口同时点「继续」）。
        if (taskMapper.moveTo(tenantId, taskId, task.getStatus(), to) == 0) {
            throw new BizException(40902, "任务状态已被并发改变，请刷新后重试", HttpStatus.CONFLICT);
        }
        if ("cancel".equals(action)) {
            detailMapper.skipAllPending(tenantId, taskId);
        }
        return resultOf(tenantId, taskId);
    }
```

> `SOURCES_OF.get("cancel")` 里没有终态：终态不可再 `cancel`（spec §2「done/error/cancelled 不可再 start」，取消同理），且 `BatchStatus.canMove` 会再挡一次。两张表都判，是因为两张表管的是不同的事——「这个动作允许从哪来」与「这条边在状态机上合不合法」。

> `BizException` 的第三个参数是 `org.springframework.http.HttpStatus` 枚举，不是 int（读码：`common/BizException.java:14`；`GlobalExceptionHandler.java:12-14` 把它同时摊成 HTTP 状态与信封里的业务码）。写 `409` 编译不过，要 `HttpStatus.CONFLICT` 并加 import。既有 `40901` 那类走的是两参构造（默认 400），群发的迁移冲突单独特意给 409：渲染层的按钮态与后端裁决要能对上。

- [ ] **Step 2：心跳与上报。**

```java
    public int heartbeat(long tenantId, long taskId) {
        return taskMapper.heartbeat(tenantId, taskId);
    }

    @Transactional
    public BatchReportsResultVO reports(long tenantId, long taskId, BatchReportsDTO dto) {
        requireOwned(tenantId, taskId);
        if (dto.getItems() != null) {
            LocalDateTime now = LocalDateTime.now(MsgTimes.CHAT_ZONE);
            for (BatchReportItemDTO item : dto.getItems()) {
                // 引擎是唯一写入者（单实例锁），所以这里不做状态守卫，只结这一行。
                detailMapper.applyReport(tenantId, taskId, item.getDetailId(), item.getSendStatus(),
                        item.getLocalId(), item.getErrorCode(), item.getErrorDetail(),
                        item.getMsgKey(), item.getSentAtEpochSec() == null
                                ? ("success".equals(item.getSendStatus()) ? now : null)
                                : MsgTimes.toDbTime(item.getSentAtEpochSec(), now));
            }
        }
        Map<String, Object> counts = taskMapper.recount(tenantId, taskId);
        writeCounts(tenantId, taskId, intOf(counts, "sentCount"), intOf(counts, "failCount"));
        BatchSendTask task = requireOwned(tenantId, taskId);
        if ("running".equals(task.getStatus())) {
            int open = taskMapper.openCount(tenantId, taskId);
            if (dto.isAllHalted() && open > 0) {
                taskMapper.moveTo(tenantId, taskId, "running", "error");
            } else if (open == 0) {
                taskMapper.moveTo(tenantId, taskId, "running", "done");
            }
        }
        return resultOf(tenantId, taskId);
    }
```

`recount` 回来的是 `SUM(...)`，MySQL 在无行时给 `null`，所以 `intOf(map,key)` 必须 `Object → Number → intValue`，`null → 0`。收尾那一跳（`items` 为空、只带 `allHalted`）也走同一个方法，所以 `resultOf` 与 `intOf` 都定义在这里。计数写回单独一个 `writeCounts`（`reports` 与 `retryFailed` 两处都要它——复位之后 `fail_count` 必须跟着掉，否则任务列表挂着「3 条失败」而明细里一条 failed 都没有）：

```java
    /** 只碰这两列：updateById 会拿整个实体覆盖行，而这里手上的实体是旧的。 */
    private void writeCounts(long tenantId, long taskId, int sent, int fail) {
        taskMapper.update(null, new LambdaUpdateWrapper<BatchSendTask>()
                .eq(BatchSendTask::getTenantId, tenantId)
                .eq(BatchSendTask::getId, taskId)
                .set(BatchSendTask::getSentCount, sent)
                .set(BatchSendTask::getFailCount, fail));
    }

    /** 状态搬完之后的权威读数：Task 12 的 host 拿它广播，渲染层只认这一份。 */
    private BatchReportsResultVO resultOf(long tenantId, long taskId) {
        BatchSendTask t = requireOwned(tenantId, taskId);
        return new BatchReportsResultVO(nz(t.getSentCount()), nz(t.getFailCount()), nz(t.getTotalCount()),
                t.getStatus());
    }

    private static int nz(Integer v) {
        return v == null ? 0 : v;
    }

    /** SUM(...) 无行时是 null；JDBC 也可能给 Long / BigDecimal，所以只认 Number。 */
    private static int intOf(Map<String, Object> row, String key) {
        Object v = row == null ? null : row.get(key);
        return v instanceof Number n ? n.intValue() : 0;
    }
```


- [ ] **Step 3：复位、撤回、reconcile。**

```java
    /**
     * R3 + R11。三跳一个事务：复位 → 刷计数 → 必要时唤醒。
     * `detailIds` 为空＝整批复位（spec §5 的 retry-failed 原语义），非空＝只复位勾选的那几条（spec §7 的单条重发）；
     * 两种都受 `WHERE send_status='failed'` 约束，所以 unknown 永远复位不掉。
     * 唤醒只在 done/error 上做：running 本来就有泵在捡 pending 行，把它打成 paused 是重发的副作用而不是用户意图；
     * cancelled 不唤醒（那是人明确按下的停）。revive 与 reset 都判：一条都没复位就把终态搬走，
     * 页面上会出现"暂停中但无事可跑"的任务。
     */
    @Transactional
    public Map<String, Object> retryFailed(long tenantId, long taskId, List<Long> detailIds) {
        BatchSendTask task = requireOwned(tenantId, taskId);
        List<Long> ids = (detailIds == null || detailIds.isEmpty())
                ? null
                : List.copyOf(new LinkedHashSet<>(detailIds));
        int reset = detailMapper.retryFailed(tenantId, taskId, ids);
        if (reset > 0) {
            Map<String, Object> counts = taskMapper.recount(tenantId, taskId);
            writeCounts(tenantId, taskId, intOf(counts, "sentCount"), intOf(counts, "failCount"));
        }
        String from = task.getStatus();
        String to = from;
        // 唤醒三步各判一次，写成 if 而不是布尔表达式：moveTo 是带副作用的，藏在 && 链里读起来像纯判定。
        if (reset > 0 && ("done".equals(from) || "error".equals(from)) && BatchStatus.canMove(from, "paused")) {
            if (taskMapper.moveTo(tenantId, taskId, from, "paused") > 0) {
                to = "paused";
            }
        }
        return Map.of("reset", reset, "status", to);
    }

    @Transactional
    public BatchRecallVO recall(long tenantId, long taskId, List<Long> detailIds) {
        BatchSendTask task = requireOwned(tenantId, taskId);
        Set<Long> wanted = new LinkedHashSet<>(detailIds);
        List<BatchSendDetail> found = detailMapper.selectList(new LambdaQueryWrapper<BatchSendDetail>()
                .eq(BatchSendDetail::getTenantId, tenantId)
                .eq(BatchSendDetail::getTaskId, taskId)
                .in(BatchSendDetail::getId, wanted)
                .orderByAsc(BatchSendDetail::getSeq));
        Set<Long> seen = new HashSet<>();
        List<BatchRecallVO.Target> eligible = new ArrayList<>();
        List<BatchRecallVO.Blocked> blocked = new ArrayList<>();
        // 读一遍再分区：每一条被挡都要说得出为什么（spec §4 的 recall 那行）。
        for (BatchSendDetail d : found) {
            seen.add(d.getId());
            String reason = BatchStatus.recallBlocker(task.getDryRun(), d.getSendStatus(), d.getMsgKey());
            if (reason != null) {
                blocked.add(new BatchRecallVO.Blocked(d.getId(), reason));
            } else if (!"none".equals(d.getRecallStatus())) {
                blocked.add(new BatchRecallVO.Blocked(d.getId(),
                        "已经撤过或正在撤（recall_status=" + d.getRecallStatus() + "）"));
            } else {
                eligible.add(new BatchRecallVO.Target(d.getId(), d.getAccountId(), d.getChatKey(), d.getMsgKey()));
            }
        }
        // 库里没有的 id 也要点名：只按 id 传而不核对，打错消息的人是无辜的收件人。
        for (Long id : wanted) {
            if (!seen.contains(id)) {
                blocked.add(new BatchRecallVO.Blocked(id, "这一条不属于本任务或不存在"));
            }
        }
        if (!eligible.isEmpty()) {
            detailMapper.markRecalling(tenantId, taskId,
                    eligible.stream().map(BatchRecallVO.Target::detailId).toList());
        }
        return new BatchRecallVO(eligible, blocked);
    }

    /** R4 两拍：先 unknown 后 paused，顺序换了就是重复发送事故。 */
    @Transactional
    public Map<String, Object> reconcile(long tenantId) {
        LocalDateTime staleBefore = LocalDateTime.now(MsgTimes.CHAT_ZONE).minusSeconds(STALE_SECONDS);
        int unknown = taskMapper.markStaleSendingUnknown(tenantId, staleBefore);
        int paused = taskMapper.pauseStaleTasks(tenantId, staleBefore);
        return Map.of("pausedTasks", paused, "markedUnknown", unknown);
    }
```

`STALE_SECONDS = 60`（spec §5，定义在后端——就是服务类里一行 `private static final int STALE_SECONDS = 60;`，和 `INSERT_CHUNK` 同一处；引擎只负责在 `POST /tasks/{id}/reconcile` 上什么都不传）。`recall` 里那一趟 `selectList` + `seen` 差集就是「每一条都被交代」的实现：库里没有的 id 进 `blocked`，而不是静默少一条。

`reconcile` 的两跳都打在 `taskMapper` 上——读码：`BatchSendTaskMapper.java:42` 的 `markStaleSendingUnknown` 与 `:48` 的 `pauseStaleTasks`（Task 1 就把这两条放在任务 mapper）。第一跳写的虽是明细行（`UPDATE batch_send_detail d JOIN batch_send_task t ...`），但它的成立条件是「这一行属于一个 running 且心跳陈旧的任务」，谓词横跨两表；`BatchSendDetailMapper` 里没有 `markStaleSendingUnknown`，照字面写 `detailMapper.` 编译不过。

`recallReports`：先 `requireOwned(tenantId, taskId)`（与其余九跳同一张嘴：任务不存在就回 `40404`，而不是回一个看不出所以然的 `settled:0`——错的 taskId 与「每一条报都迟到了」在响应体上本来会一模一样，而后者正是 R4 的 reconcile 要处理的状态）。然后逐条 `applyRecallReport(tenantId, taskId, item.getDetailId(), Boolean.TRUE.equals(item.getRecalled()) ? "recalled" : "recall_failed", item.getDetail())`，把受影响行数累加成返回值（额外守卫在 SQL 里：不是 `recalling` 的行结不掉）。`getRecalled()` 是包装 `Boolean`，必须走 `Boolean.TRUE.equals(...)` 而不是直接进条件——缺字段的那一条报会 NPE，而 NPE 出的是 50000，引擎那边只会看到"这一跳挂了"，看不到是体形状不对。

`BatchRetryDTO` 与 `BatchRecallRequestDTO` 只差一个校验注解，形状照现有 DTO 的形制（`@Data` + 一个字段），**这里不加 `@NotEmpty`**：整批重发的语义就是"什么都不传"，加上它 spec §5 那条 `retry-failed` 原语义（无 body）会被 400 挡掉，而 `recall` 那一条必须有目标、`@NotEmpty` 保留：

```java
@Data
public class BatchRetryDTO {
    /** null / 空 = 整批复位；非空 = 只复位这些 detailId（R11）。 */
    private List<Long> detailIds;
}
```

- [ ] **Step 4：控制器加十条。** 全部沿用 Task 4 Step 5 那一形制（`@AuthenticationPrincipal AuthPrincipal principal` 取租户，`ApiResponse.ok(...)` 出参）：

```java
    @PostMapping("/tasks/{id}/start")
    public ApiResponse<BatchReportsResultVO> start(@AuthenticationPrincipal AuthPrincipal principal,
                                                   @PathVariable long id) {
        return ApiResponse.ok(service.transition(principal.tenantId(), id, "start"));
    }

    @PostMapping("/tasks/{id}/pause")
    public ApiResponse<BatchReportsResultVO> pause(@AuthenticationPrincipal AuthPrincipal principal,
                                                   @PathVariable long id) {
        return ApiResponse.ok(service.transition(principal.tenantId(), id, "pause"));
    }

    @PostMapping("/tasks/{id}/resume")
    public ApiResponse<BatchReportsResultVO> resume(@AuthenticationPrincipal AuthPrincipal principal,
                                                    @PathVariable long id) {
        return ApiResponse.ok(service.transition(principal.tenantId(), id, "resume"));
    }

    @PostMapping("/tasks/{id}/cancel")
    public ApiResponse<BatchReportsResultVO> cancel(@AuthenticationPrincipal AuthPrincipal principal,
                                                    @PathVariable long id) {
        return ApiResponse.ok(service.transition(principal.tenantId(), id, "cancel"));
    }

    /** 只回"有没有跳上"，不回新时刻：引擎自己知道墙上时间，心跳的权威读数在 GET /tasks/{id}。 */
    @PostMapping("/tasks/{id}/heartbeat")
    public ApiResponse<Map<String, Object>> heartbeat(@AuthenticationPrincipal AuthPrincipal principal,
                                                      @PathVariable long id) {
        return ApiResponse.ok(Map.of("updated", service.heartbeat(principal.tenantId(), id)));
    }

    @PostMapping("/tasks/{id}/reports")
    public ApiResponse<BatchReportsResultVO> reports(@AuthenticationPrincipal AuthPrincipal principal,
                                                     @PathVariable long id,
                                                     @Valid @RequestBody BatchReportsDTO dto) {
        return ApiResponse.ok(service.reports(principal.tenantId(), id, dto));
    }

    /**
     * 一条端点两种粒度（R11）：不带 body（或 detailIds 为空）＝整批复位＝spec §5 的 retry-failed 原语义；
     * 带 detailIds＝只复位勾选的那几条＝spec §7 的单条重发。
     */
    @PostMapping("/tasks/{id}/retry-failed")
    public ApiResponse<Map<String, Object>> retryFailed(@AuthenticationPrincipal AuthPrincipal principal,
                                                        @PathVariable long id,
                                                        @RequestBody(required = false) BatchRetryDTO dto) {
        return ApiResponse.ok(service.retryFailed(principal.tenantId(), id,
                dto == null ? null : dto.getDetailIds()));
    }

    @PostMapping("/tasks/{id}/recall")
    public ApiResponse<BatchRecallVO> recall(@AuthenticationPrincipal AuthPrincipal principal,
                                             @PathVariable long id,
                                             @Valid @RequestBody BatchRecallRequestDTO dto) {
        return ApiResponse.ok(service.recall(principal.tenantId(), id, dto.getDetailIds()));
    }

    @PostMapping("/tasks/{id}/recall-reports")
    public ApiResponse<Map<String, Object>> recallReports(@AuthenticationPrincipal AuthPrincipal principal,
                                                          @PathVariable long id,
                                                          @Valid @RequestBody BatchRecallReportsDTO dto) {
        return ApiResponse.ok(Map.of("settled", service.recallReports(principal.tenantId(), id, dto)));
    }

    /** 启动时一次，什么都不传；租户从 token 来，所以驱动换号就能验到隔离。 */
    @PostMapping("/reconcile")
    public ApiResponse<Map<String, Object>> reconcile(@AuthenticationPrincipal AuthPrincipal principal) {
        return ApiResponse.ok(service.reconcile(principal.tenantId()));
    }
```

`recallReports` 的返回是行数（`int`），所以 `service.recallReports(...)` 的签名按 Step 3 那句说明写成 `int recallReports(long tenantId, long taskId, BatchRecallReportsDTO dto)` —— Interfaces 里那行 `void` 以这里为准，改成 `int`。

- [ ] **Step 5：`./mvnw test`** 全绿（基线 + 22）。
- [ ] **Step 6：spec 回填 + 提交。** §4 表里补 `POST /reconcile` 一行与「60 s 阈值由后端定义」；§5 心跳那条后面补 R4 两拍的先后依据。

```bash
git commit -m "feat(P7/群发): 运行面端点齐了，状态迁移只有一个口

cancel 顺带 skipAllPending；reconcile 先判 unknown 再转 paused；allHalted 把 running 打成 error。"
```

## Task 6: 后端契约驱动 `tmp/p7b-batch-contract.mjs`（29 个编号 / 33 条断言，全程 dryRun）

**Files:**
- Create: `tmp/p7b-batch-contract.mjs`（gitignored，永不进提交）
- Create: `tmp/p7b-server.log`（后端日志，供 Flyway witness 行 grep）

**Interfaces:**
- Consumes: Task 4/5 的全部端点与错误码。
- Produces: 一份可重复运行的台账：**29 个编号、一次运行 33 条 `check`、33 个调用点**（`#24` 三条、`#26` 两条 `#26a`/`#26b`、`#29` 两条 `#29a`/`#29b`；`#5` 以前是 if/else 取其一、每次有一条 `check(..., true, ...)` 的恒真行占着 pass，现在收件人夹具实测可选，写成一调一断）。终端表格按 `rows.length` 打印 + 退出码。

- [ ] **Step 1：写驱动骨架。** 形制照 `tmp/p6b-scope-contract.mjs`（读码：同一个 `check/req/get/post`、同一种退出码约定）。整文件开头：

```js
// tmp/p7b-batch-contract.mjs — P7/B7 群发后端契约（全程 dryRun=1，不碰页面）
// 用法：node tmp/p7b-batch-contract.mjs   （后端需已在 :8180 上跑本计划的构建）
// 退出码：0=33 条 check 全过（29 个编号 / 33 个调用点：#24 三条、#26 两条、#29 两条，其余一编号一条）；1=有断言失败；2=前置条件不满足（没有可用账号/会话/客户夹具，不算产品失败）
// 用时：#29b 要等心跳阈值（后端定义的 60 s）真的过去，所以整跑比上一版多花 60~70 s；那一腿是轮询到判出来为止，不是固定 sleep。
// 收尾：#26b 需要一条 dryRun:false 的任务才有撤回资格，所以本脚本确实会建非演练单——但从不 start 它
//       （#18~#24 的 start/pause/resume/cancel 链全部打在 dryRun:true 的 T/T2/T3 上）。创建的每个 taskId 进
//       createdTasks，结尾逐个 POST /cancel（取消会把 pending 置 skipped），并打印取消结果。
//       整个腿段落包在 try/finally 里：抛错也照样逐个 cancel，退出路径不留活任务。
const BASE = 'http://127.0.0.1:8180';
const rows = [];
const responses = {};
let failures = 0;
let tok = null;
const createdTasks = [];

function check(name, pass, expected, actual) {
  rows.push({ name, pass, expected, actual });
  if (!pass) failures++;
}
async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return await res.json();
}
const get = (p) => req('GET', p);
const post = (p, body) => req('POST', p, body);

const login = await post('/api/auth/login', {
  inviteCode: 'DEMO0001', username: 'admin', password: 'admin123', deviceId: 'p7t6-batch',
});
tok = login?.data?.accessToken;
responses.login = login.code;
if (!tok) { console.log('login failed: ' + JSON.stringify(login)); process.exit(1); }

// —— 前置：一个已绑定视图的账号 + 该账号下至少两条已采会话 ——
const accts = (await get('/api/platform-accounts')).data ?? [];
const bound = accts.filter((a) => a.viewId && a.status === 1);
let acct = null, keys = [], convs = [];
for (const a of bound) {
  const cs = (await get(`/api/conversations?accountId=${a.id}&size=50`)).data?.records ?? [];
  // keys：无客户且标题为空的会话。#6 要比的是「两条兜底链在同一格重合」，挂了客户或带标题的会话
  // 会让创建侧走昵称/标题那一支，与 preview 的样例链必然不等（读码 BatchSendService#preview）。
  const plain = [...new Set(cs
    .filter((c) => !c.customerId && (c.title == null || c.title === ''))
    .map((c) => c.chatKey))].filter(Boolean);
  if (plain.length >= 2) { acct = a; keys = plain; convs = cs; break; }
}
if (!acct) { console.log('前置失败：没有 status=1/viewId 非空、且有 ≥2 条无客户空标题会话的账号'); process.exit(2); }

// chat_key 本地段尾 4：与 BatchRender#openIdTail 同口径（先剥 @ 之后，再取尾 4，不足 4 位用整串）
const tail4 = (chatKey) => { const l = chatKey.split('@')[0]; return l.length <= 4 ? l : l.slice(-4); };

// liveCust：同一账号下「挂着存活客户」的会话，三条门槛都过——昵称非空、手机号非空、
// 昵称≠会话标题、昵称≠chat_key 本地段尾 4。为什么门槛要这么多（读码 BatchSendService#resolveFields
// 的兜底链：客户昵称 → 会话标题 → chat_key 本地段尾 4）：昵称撞上标题或尾 4 时，
// 「创建侧根本没查客户档」这一支错也能写出同一个 body，断言就废了。
// 实测本地库账号 7 有 9 条这种会话（探针 tmp/p7b-fixture-probe.mjs，只读、退出码 0=有夹具）。
const custRows = (await get('/api/customers?pageSize=200')).data?.records ?? [];
const custById = new Map(custRows.map((c) => [c.id, c]));
const liveCust = convs
  .map((c) => ({ chatKey: c.chatKey, title: c.title ?? '', cu: custById.get(c.customerId) }))
  .find((x) => x.cu && (x.cu.nickname ?? '') !== '' && (x.cu.phone ?? '') !== ''
    && x.cu.nickname !== x.title && x.cu.nickname !== tail4(x.chatKey));
if (!liveCust) { console.log('前置失败：账号下没有「挂存活客户且昵称≠标题≠尾 4」的会话'); process.exit(2); }

// —— 任务工厂：默认 2 收件人 × 2 内容、零间隔、演练 ——
const base = (over = {}) => ({
  name: 'p7t6 契约任务', platform: 'whatsapp', dryRun: true,
  accountIds: [acct.id],
  conversations: [{ accountId: acct.id, chatKey: keys[0] }, { accountId: acct.id, chatKey: keys[1] }],
  contents: ['第一条 {客户名} {号码} {订单号}', '第二条'],
  msgIntervalMin: 0, msgIntervalMax: 0, chatIntervalMin: 0, chatIntervalMax: 0,
  ...over,
});
async function makeTask(over) {
  const r = await post('/api/batch-send/tasks', base(over));
  if (r.code === 0 && r.data?.taskId) createdTasks.push(r.data.taskId);
  return r;
}
```

- [ ] **Step 2：创建与读面（#1–#8）。** 逐条写死期望值：

```js
// #1 创建返回 totalCount = 2 收件人 × 2 内容，rejected 为空数组
const c1 = await makeTask();
responses.c1 = c1;
check('#1 创建 → taskId + rejected:[] + totalCount:4',
  c1.code === 0 && Array.isArray(c1.data?.rejected) && c1.data.rejected.length === 0
    && c1.data?.totalCount === 4 && typeof c1.data?.taskId === 'number',
  'code=0,totalCount=4,rejected=[]', JSON.stringify(c1.data));
const T = c1.data.taskId;

// #2 GET /tasks/{id}：pending / 三计数 0 / dryRun 原样回读
const t2 = await get(`/api/batch-send/tasks/${T}`);
check('#2 读任务 → status:pending, sent/fail/total=0/0/4, dryRun:true',
  t2.code === 0 && t2.data?.status === 'pending' && t2.data?.sentCount === 0
    && t2.data?.failCount === 0 && t2.data?.totalCount === 4 && t2.data?.dryRun === true,
  'pending,0,0,4,dryRun=true', JSON.stringify(t2.data));

// #3 明细 seq 收件人主序，同会话相邻。两页各 2 条：`size=` 与 `page=` 都要"看得出生效了"——
// 只拉一次默认大小的话，参数名拼错（`pageSize=`）返回体一模一样，这条腿就只是在读默认值。
const d3a = await get(`/api/batch-send/tasks/${T}/details?page=1&size=2`);
const d3b = await get(`/api/batch-send/tasks/${T}/details?page=2&size=2`);
const recs = (d3a.data?.records ?? []).concat(d3b.data?.records ?? []);
check('#3 明细分页 → size=2 每页两条、page=2 接上后两行，seq=[1,2,3,4] 同人两条相邻',
  (d3a.data?.records ?? []).length === 2 && (d3b.data?.records ?? []).length === 2
    && d3a.data?.pageSize === 2 && d3a.data?.page === 1 && d3b.data?.page === 2
    && recs.length === 4 && JSON.stringify(recs.map((r) => r.seq)) === '[1,2,3,4]'
    && recs[0].chatKey === recs[1].chatKey && recs[2].chatKey === recs[3].chatKey
    && recs[0].chatKey !== recs[2].chatKey
    && JSON.stringify(recs.map((r) => r.contentIndex)) === '[0,1,0,1]',
  'seq=1,2,3,4 / ci=0,1,0,1', JSON.stringify(recs.map((r) => [r.seq, r.chatKey, r.contentIndex])));

// #4 body 是渲染后的快照：未识别花括号原样、两个已知变量已被替换
const outs = recs.filter((r) => r.contentIndex === 0).map((r) => r.body);
check('#4 body 含 {订单号}，两个已知 token 已被替换',
  outs.length === 2 && outs.every((b) => b.includes('{订单号}')
    && !b.includes('{客户名}') && !b.includes('{号码}')),
  '含 {订单号}，不含两个 token', JSON.stringify(outs));

// #5 创建侧真的查了客户档（R9 的 nickname/phone 接线，spec §3 第 6 条）。
//    这一腿**自己建一个 dryRun 任务**，收件人是 liveCust 那条挂了存活客户的会话——它和 #6 的收件人
//    不能是同一条：#6 要的是「无客户 + 空标题」那一格两条链重合，#5 要证的是「有客户时真去读了客户档」。
//    {号码} 没有兜底链（客户缺 phone 就是空串），所以它出现在 body 里本身就证明那一格来自客户档。
const c5 = await makeTask({
  conversations: [{ accountId: acct.id, chatKey: liveCust.chatKey }],
  contents: ['{客户名}|{号码}'],
});
const d5 = c5.code === 0
  ? (await get(`/api/batch-send/tasks/${c5.data.taskId}/details?page=1&size=5`)).data?.records ?? [] : [];
check('#5 收件人挂存活客户 → body 逐字 = 客户昵称|客户手机号',
  c5.code === 0 && d5.length === 1 && d5[0].body === liveCust.cu.nickname + '|' + liveCust.cu.phone,
  liveCust.cu.nickname + '|' + liveCust.cu.phone, JSON.stringify(d5.map((r) => r.body)));

// #6 契约是「预览复用同一个渲染函数」（spec §4「渲染规则只有后端一份」），不是「同一份字段值」。
//    preview 手上没有客户档，喂的是样例兜底链：nickname=null、openId=chat_key 本地段、phone=null
//    （读码 BatchSendService#preview → BatchRender.Fields(null, localPart, null)）。
//    本腿收件人无客户且标题为空，两条链在 {客户名} 那一格重合，于是 body 逐字相等；
//    再把期望值写成手拼的整串，把样例链本身钉住（{号码} 落空、未识别 token 原样）——
//    Task 14 的向导要靠这条口径把预览标成「示例」，不能当成真实正文。
const p6 = await post('/api/batch-send/preview', {
  conversations: [{ accountId: acct.id, chatKey: keys[0] }],
  contents: ['第一条 {客户名} {号码} {订单号}', '第二条'],
});
const p6b = p6.data?.rows?.[0]?.body ?? '';
const expect6 = '第一条 ' + tail4(keys[0]) + '  {订单号}';
check('#6 preview 与 detail 同一个渲染函数，且 preview 走样例链（{客户名}=本地段尾 4、{号码}=空）',
  p6.code === 0 && p6b === recs[0]?.body && p6b === expect6,
  '逐字相等 + ' + expect6,
  JSON.stringify({ same: p6b === recs[0]?.body, expect: expect6, actual: p6b }));

// #7 预览只渲染前 5 个收件人并给出 truncated 标记
const many = Array.from({ length: 7 }, (_, i) => ({ accountId: acct.id, chatKey: keys[0] + i }));
const p7 = await post('/api/batch-send/preview', { conversations: many, contents: ['x {客户名}'] });
check('#7 preview 收件人截到 5 且 truncated:true',
  p7.code === 0 && p7.data?.rows?.length === 5 && p7.data?.truncated === true,
  '5 行 + truncated', JSON.stringify({ n: p7.data?.rows?.length, t: p7.data?.truncated }));

// #8 平台不是 whatsapp → 40013 且整单不落一行
const c8 = await post('/api/batch-send/tasks', base({ platform: 'telegram' }));
check('#8 platform:telegram → code 40013',
  c8.code === 40013 && c8.data == null, '40013', JSON.stringify(c8));
```

- [ ] **Step 3：规则腿（#9–#15）。**

```js
// #9 空正文点名到第几条
const c9 = await post('/api/batch-send/tasks', base({ contents: ['  ', '正常'] }));
check('#9 空正文 → 40013 且文案点名"第 1 条"',
  c9.code === 40013 && /第 1 条/.test(c9.message ?? ''), '40013 + 第 1 条', c9.message);

// #10 超长正文点名 + 上限就是 5000
const c10 = await post('/api/batch-send/tasks', base({ contents: ['a'.repeat(5001)] }));
check('#10 5001 字 → 40013 且含"第 1 条"与"5000"',
  c10.code === 40013 && /第 1 条/.test(c10.message ?? '') && /5000/.test(c10.message ?? ''),
  '40013', c10.message);

// #11 内容条数上限 20
const c11 = await post('/api/batch-send/tasks', base({ contents: Array.from({ length: 21 }, (_, i) => 'x' + i) }));
check('#11 21 条内容 → 40013 且含 20', c11.code === 40013 && /20/.test(c11.message ?? ''), '40013', c11.message);

// #12 真发下限咬人：dryRun=false 时 msg_interval_min=0 被拒
const c12 = await post('/api/batch-send/tasks', base({ dryRun: false, msgIntervalMin: 0 }));
check('#12 dryRun:false + msgMin:0 → 40013 且含 3',
  c12.code === 40013 && /3/.test(c12.message ?? ''), '40013', c12.message);
// （这一条只创建、不 start，所以"被拒"完全不需要真发。）

// #13 演练不受下限约束：0/0 通过（#1 就是它的正面证据，这里做反向确认）
check('#13 dryRun 的零间隔任务已创建成功（同 #1 的 taskId 存在）',
  typeof T === 'number' && c12.code === 40013, 'dryRun 0 通过 / 真发 0 拒', `T=${T},c12=${c12.code}`);

// #14 min > max → 40013
const c14 = await post('/api/batch-send/tasks', base({ msgIntervalMin: 10, msgIntervalMax: 8 }));
check('#14 min>max → 40013 且含"min 不能大于 max"',
  c14.code === 40013 && /min 不能大于 max/.test(c14.message ?? ''), '40013', c14.message);

// #15 两种不可寻址各点名一条：账号不在本次清单里（999999 不在 accountIds，先撞这一支）、该账号下没有这条会话
const c15 = await post('/api/batch-send/tasks', base({
  conversations: [
    { accountId: acct.id, chatKey: keys[0] },
    { accountId: acct.id, chatKey: 'nope-9999@c.us' },
    { accountId: 999999, chatKey: keys[0] },
  ],
}));
const d15 = c15.code === 0 ? await get(`/api/batch-send/tasks/${c15.data.taskId}/details?size=10`) : null;
check('#15 两条不可寻址分别点名、其余照常展开，totalCount=2（1 人 × 2 内容）',
  c15.code === 0 && c15.data?.rejected?.length === 2
    && c15.data.rejected.some(r => r.chatKey === 'nope-9999@c.us' && /采集记录/.test(r.reason ?? ''))
    && c15.data.rejected.some(r => r.accountId === 999999 && /不在本次勾选的账号里/.test(r.reason ?? ''))
    && c15.data?.totalCount === 2
    && d15?.data?.records?.length === 2,
  'rejected=[nope-9999(无会话), 999999(账号不在清单)] total=2', JSON.stringify({ code: c15.code, d: c15.data }));
```

- [ ] **Step 4：状态机与上报腿（#16–#26）。**

```js
// #16 全部收件人不可寻址 → 40012 整单拒
const c16 = await post('/api/batch-send/tasks', base({
  conversations: [{ accountId: acct.id, chatKey: 'ghost-1@c.us' }],
}));
check('#16 全员不可寻址 → 40012', c16.code === 40012 && c16.data == null, '40012', JSON.stringify(c16));

// #17 账号不在本租户 / 没绑视图 → 40011 并点名 id
const c17 = await post('/api/batch-send/tasks', base({ accountIds: [999999] }));
check('#17 账号不可用 → 40011 且 message 里有那个 id',
  c17.code === 40011 && /999999/.test(c17.message ?? ''), '40011', c17.message);

// #18 pending 直接 pause → 40902 且点名当前态
const r18 = await post(`/api/batch-send/tasks/${T}/pause`);
check('#18 pending→pause = 40902 且含"pending"',
  r18.code === 40902 && /pending/.test(r18.message ?? ''), '40902', JSON.stringify(r18));

// #19 start → running；pause → paused；resume → running；cancel → cancelled
const s19a = await post(`/api/batch-send/tasks/${T}/start`);
const s19b = await post(`/api/batch-send/tasks/${T}/pause`);
const s19c = await post(`/api/batch-send/tasks/${T}/resume`);
const s19d = await post(`/api/batch-send/tasks/${T}/cancel`);
check('#19 start/pause/resume/cancel 链每一跳都返回目标态',
  s19a.data?.status === 'running' && s19b.data?.status === 'paused'
    && s19c.data?.status === 'running' && s19d.data?.status === 'cancelled',
  'running→paused→running→cancelled',
  JSON.stringify([s19a.data?.status, s19b.data?.status, s19c.data?.status, s19d.data?.status]));

// #20 cancelled 之后 start → 40902
const r20 = await post(`/api/batch-send/tasks/${T}/start`);
check('#20 终态再 start = 40902', r20.code === 40902, '40902', JSON.stringify(r20));

// #21 心跳：running 时 1 行，paused/cancelled 时 0 行（heartbeat_at 只给在跑的任务续）
const T2 = (await makeTask()).data.taskId;
const h21a = (await post(`/api/batch-send/tasks/${T2}/heartbeat`)).data?.updated;
await post(`/api/batch-send/tasks/${T2}/start`);
const h21b = (await post(`/api/batch-send/tasks/${T2}/heartbeat`)).data?.updated;
await post(`/api/batch-send/tasks/${T2}/pause`);
const h21c = (await post(`/api/batch-send/tasks/${T2}/heartbeat`)).data?.updated;
check('#21 heartbeat 只在 running 时命中一行',
  h21a === 0 && h21b === 1 && h21c === 0, '0,1,0', JSON.stringify([h21a, h21b, h21c]));

// 明细 id 一律现取，不硬编码：任务是自己创建的，行 id 由自增决定，写死 1/2/3/4 必然对不上。
const detailsOf = async (taskId) =>
  (await get(`/api/batch-send/tasks/${taskId}/details?size=50`)).data?.records ?? [];

// #22 reports 刷三计数：2 success + 1 failed + 1 unknown
const dT2 = await detailsOf(T2);
const ids = dT2.map((d) => d.id);
const nowSec = Math.floor(Date.now() / 1000);
const rep = await post(`/api/batch-send/tasks/${T2}/reports`, {
  allHalted: false,
  items: [
    { detailId: ids[0], sendStatus: 'success', msgKey: 'true_a@c.us_1_out', localId: 'L1', sentAtEpochSec: nowSec },
    { detailId: ids[1], sendStatus: 'success', msgKey: 'true_b@c.us_2_out', localId: 'L2', sentAtEpochSec: nowSec },
    { detailId: ids[2], sendStatus: 'failed', errorCode: 'SEND_FAILED', errorDetail: '页内异常' },
    { detailId: ids[3], sendStatus: 'unknown', errorCode: 'TIMEOUT', errorDetail: '>20000ms' },
  ],
});

const t22 = (await get(`/api/batch-send/tasks/${T2}`)).data;
check('#22 reports 后 sent=2 / fail=1（unknown 不计 fail，R2）',
  rep.code === 0 && t22?.sentCount === 2 && t22?.failCount === 1 && t22?.status === 'running',
  'sent2/fail1/running', JSON.stringify({ sent: t22?.sentCount, fail: t22?.failCount, st: t22?.status }));

// #23 msg_key 原样入库，_out 尾没被剥
check('#23 detail 的 msgKey 逐字带 _out', (await detailsOf(T2))[0]?.msgKey === 'true_a@c.us_1_out',
  'true_a@c.us_1_out', (await detailsOf(T2))[0]?.msgKey);

// #24 allHalted 收尾：剩余 pending 不清零但任务转 error（本例已无 pending，所以先看 done 那一支）
const t24 = (await get(`/api/batch-send/tasks/${T2}`)).data;
const allDone = await post(`/api/batch-send/tasks/${T2}/reports`, { allHalted: false, items: [] });
check('#24 无 open 行时再报一次 → 任务 done（收尾那一跳只带结论）',
  allDone.data?.status === 'done' && t24?.status === 'running', 'done', allDone.data?.status);

// #24b R11 的终态唤醒 + 单条粒度：T2 此时是 done 且挂着 1 条 failed，只点名复位那一条。
//      三件事一起判，缺一条都可能让"重发"变成一个静默无效的动作：
//      reset 只对那一行、任务被唤醒回 paused、fail_count 跟着掉下来（不跟就会挂着"1 条失败"而明细里没有）。
const rt24b = await post(`/api/batch-send/tasks/${T2}/retry-failed`, { detailIds: [ids[2]] });
const t24b = (await get(`/api/batch-send/tasks/${T2}`)).data;
const after24b = await detailsOf(T2);
check('#24b detailIds 只复位那一条：reset=1 / status=paused / failCount=0 / 其余三行原样',
  rt24b.data?.reset === 1 && rt24b.data?.status === 'paused'
    && t24b?.failCount === 0 && t24b?.sentCount === 2
    && after24b[0]?.sendStatus === 'success' && after24b[1]?.sendStatus === 'success'
    && after24b[2]?.sendStatus === 'pending' && after24b[3]?.sendStatus === 'unknown',
  'reset=1,paused,[success,success,pending,unknown]',
  JSON.stringify({ d: rt24b.data, s: after24b.map((x) => x.sendStatus), fail: t24b?.failCount }));

// #24c cancelled 不唤醒（R11 的另一半）：那个任务的行是 skipped，一条都复位不掉，状态纹丝不动。
//      "cancelled → paused 这条边不存在"由 Task 3 的 BatchStatusTest 判，这里只判"复位 0 条就不搬"。
const rt24c = await post(`/api/batch-send/tasks/${T}/retry-failed`);
check('#24c cancelled 任务 retry → reset=0 且 status 仍是 cancelled',
  rt24c.data?.reset === 0 && rt24c.data?.status === 'cancelled', 'reset=0/cancelled',
  JSON.stringify(rt24c.data));

// #25 retry-failed 不带 detailIds = 整批复位：unknown 那行纹丝不动（R3）
const T3 = (await makeTask()).data.taskId;   // 又一个 4 行任务
const dT3 = await detailsOf(T3);
await post(`/api/batch-send/tasks/${T3}/start`);
await post(`/api/batch-send/tasks/${T3}/reports`, { allHalted: false, items: [
  { detailId: dT3[0].id, sendStatus: 'failed', errorCode: 'SEND_FAILED', errorDetail: 'x' },
  { detailId: dT3[1].id, sendStatus: 'unknown', errorCode: 'TIMEOUT', errorDetail: 'y' },
] });
const rt = await post(`/api/batch-send/tasks/${T3}/retry-failed`);
const after = await detailsOf(T3);
check('#25 retry-failed reset=1 且 unknown 仍是 unknown',
  rt.data?.reset === 1 && after[0]?.sendStatus === 'pending' && after[1]?.sendStatus === 'unknown'
    && after[2]?.sendStatus === 'pending' && after[3]?.sendStatus === 'pending',
  'reset=1 / [pending,unknown,pending,pending]', JSON.stringify(after.map((x) => x.sendStatus)));

// #26a 撤回资格：演练任务全部被挡，理由点名"演练"
const rc = await post(`/api/batch-send/tasks/${T3}/recall`, { detailIds: dT3.map((d) => d.id) });
check('#26a dryRun 任务 recall → eligible:[] 且四条理由都是演练',
  rc.code === 0 && rc.data?.eligible?.length === 0 && rc.data?.rejected?.length === 4
    && rc.data.rejected.every((x) => /演练/.test(x.reason)),
  'eligible=0 / rejected=4 全含"演练"', JSON.stringify(rc.data));

// #26b 撤回资格的另一支：非演练 + success 的那一条有资格，且这一跳把 recall_status 推到 recalling。
//      这里只"要清单"，不执行撤回 —— 真撤回在 Task 16 由用户在场放行。
const T4 = (await makeTask({ dryRun: false, msgIntervalMin: 3, msgIntervalMax: 8, chatIntervalMin: 5, chatIntervalMax: 15 })).data.taskId;
const dT4 = await detailsOf(T4);
await post(`/api/batch-send/tasks/${T4}/reports`, { allHalted: false, items: [
  { detailId: dT4[0].id, sendStatus: 'success', msgKey: 'true_c@c.us_9_out', localId: 'L9' },
] });
const rc2 = await post(`/api/batch-send/tasks/${T4}/recall`, { detailIds: dT4.map((d) => d.id) });
const dT4b = await detailsOf(T4);
check('#26b 非演练 + success → eligible 1 条带 msgKey、recall_status 变 recalling，其余 3 条点名原因',
  rc2.data?.eligible?.length === 1 && rc2.data.eligible[0].msgKey === 'true_c@c.us_9_out'
    && rc2.data?.rejected?.length === 3 && dT4b[0]?.recallStatus === 'recalling'
    && dT4b[1]?.recallStatus === 'none',
  'eligible=1/recalling=1', JSON.stringify({ e: rc2.data?.eligible, r: dT4b.map((x) => x.recallStatus) }));

// #27 运行端点对不存在的任务：八跳同一张嘴（业务码 40404），心跳是有意的那一支例外。
//     recall-reports 是这一条的意义所在——少了 requireOwned 那一闸，它只靠 SQL 里的租户守卫，
//     错误的 taskId 会回 settled:0，与「每一条报都迟到了」（reconcile 要处理的状态）在响应体上不可区分。
//     heartbeat 反过来不闸：它的 `updated` 本来就是停泵信号（spec §5），「这一行没在 running」与
//     「这一行不存在」对引擎是同一个决定，把它改成 40404 只是给每 15 s 一跳加一次读。
const GHOST = 9000001;
const ghostCalls = [
  ['start', {}],
  ['pause', {}],
  ['resume', {}],
  ['cancel', {}],
  ['reports', { items: [], allHalted: false }],
  ['retry-failed', {}],
  ['recall', { detailIds: [1] }],
  ['recall-reports', { items: [{ detailId: 1, recalled: true }] }],
];
const ghostCodes = [];
for (const [seg, body] of ghostCalls) {
  const r = await post(`/api/batch-send/tasks/${GHOST}/${seg}`, body);
  ghostCodes.push(`${seg}=${r.code}`);
}
const rGhostHb = await post(`/api/batch-send/tasks/${GHOST}/heartbeat`);
check('#27 八跳对不存在的任务都回 40404，心跳回 code=0/updated=0',
  ghostCodes.length === 8 && ghostCodes.every((x) => x.endsWith('=40404'))
    && rGhostHb.code === 0 && rGhostHb.data?.updated === 0,
  '8 段全 =40404 + heartbeat updated=0', `${ghostCodes.join(' ')} heartbeat=${rGhostHb.code}/${rGhostHb.data?.updated}`);

// #28 第二个租户（QA0002/qa）打租户 1 的真 taskId：八跳 + 两个 GET 全部 40404。
//     R40 之前 /details 那一格回的是「空的一页」，与「这一档筛选下确实没有行」在响应体上分不出来；
//     这里用真 id（不是 9000001 那种不存在的 id），为的是让 SQL 里的租户守卫也当一次证人。
const ownRead = (await get(`/api/batch-send/tasks/${T}`)).code; // 先确认这个 id 在本租户手上读得到
const tokA = tok;
const loginB = await post('/api/auth/login', {
  inviteCode: 'QA0002', username: 'qa', password: 'qa12345', deviceId: 'p7t6-batch-b',
});
tok = loginB?.data?.accessToken;
const foreignCodes = [];
if (tok) {
  for (const [seg, body] of ghostCalls) {
    foreignCodes.push(`${seg}=${(await post(`/api/batch-send/tasks/${T}/${seg}`, body)).code}`);
  }
  foreignCodes.push(`GET_task=${(await get(`/api/batch-send/tasks/${T}`)).code}`);
  foreignCodes.push(`GET_details=${(await get(`/api/batch-send/tasks/${T}/details?size=2`)).code}`);
}
tok = tokA;
check('#28 换号后八跳 + 两个 GET 打别人的真任务全是 40404（本租户读得到同一个 id）',
  ownRead === 0 && loginB?.data?.accessToken != null
    && foreignCodes.length === 10 && foreignCodes.every((x) => x.endsWith('=40404')),
  '本租户 code=0 + 换号 10 段全 =40404', `${ownRead} ${foreignCodes.join(' ')}`);

// #29 R4 的两拍打在真库上（T5 是 dryRun，全程没有引擎、没有按下过任何页面）：
//     #29a 刚点下「开始」的任务不该被 reconcile 判成陈旧（R39 的证人：搬进 running 那一跳就续了心跳。
//          少了那一拍，heartbeat_at 一直是空，而 reconcile 的判据是「为空或早于 60 s」——当场就把它打死）；
//     #29b 心跳停过阈值之后，一次 reconcile 要同时留下两个结论：那条 sending 变 unknown、任务变 paused。
//          两拍顺序换了就只剩第二个结论——markStaleSendingUnknown 的守卫是「所属任务仍是 running」。
//     先把 T3 打成 paused：它手上没有引擎，干等着只会一起变陈旧，那会让 #29b 的计数读不出是几行。
await post(`/api/batch-send/tasks/${T3}/pause`);
await post('/api/batch-send/reconcile'); // 先把上一次运行遗留的陈旧 running 行扫掉，再读基线
const T5 = (await makeTask()).data.taskId;
const ids5 = (await detailsOf(T5)).map((d) => d.id);
await post(`/api/batch-send/tasks/${T5}/start`);
await post(`/api/batch-send/tasks/${T5}/reports`, {
  allHalted: false,
  items: [{ detailId: ids5[0], sendStatus: 'sending', localId: 'L5' }],
});
const recEarly = (await post('/api/batch-send/reconcile')).data;
check('#29a 刚 start（心跳已续上）时 reconcile 两拍都不动这一行与这一任务',
  recEarly?.markedUnknown === 0 && recEarly?.pausedTasks === 0,
  'markedUnknown=0 pausedTasks=0', JSON.stringify(recEarly));

// 阈值定义在后端（STALE_SECONDS=60），引擎侧什么都不传，所以这里只能等它真的过去：
// 轮询到 reconcile 判出来为止，上限 90 s；到点还没判出来就把当时的读数当失败打出来（不是「跳过」）。
const staleDeadline = Date.now() + 90000;
let recLate = recEarly;
while (Date.now() < staleDeadline) {
  recLate = (await post('/api/batch-send/reconcile')).data ?? recLate;
  if ((recLate?.markedUnknown ?? 0) >= 1) break;
  await new Promise((r) => setTimeout(r, 3000));
}
const d5b = await detailsOf(T5);
const t5b = (await get(`/api/batch-send/tasks/${T5}`)).data;
check('#29b 心跳停过阈值后：那一行 sending→unknown(ENGINE_LOST)、任务 running→paused',
  recLate?.markedUnknown === 1 && recLate?.pausedTasks === 1
    && d5b[0]?.sendStatus === 'unknown' && d5b[0]?.errorCode === 'ENGINE_LOST'
    && d5b[1]?.sendStatus === 'pending' && t5b?.status === 'paused',
  'markedUnknown=1/pausedTasks=1/[unknown,pending,…]/paused',
  JSON.stringify({ r: recLate, s: d5b.map((x) => [x.sendStatus, x.errorCode]), st: t5b?.status }));
```

> 编号到 `#29`，其中 `#24` 有三条 `check`（收尾跳 / 单条重发唤醒 / cancelled 不唤醒）、`#26` 有两条（`#26a`/`#26b`）、`#29` 有两条（`#29a`/`#29b`）：台账是 **29 个编号、一次运行 33 条 `check`、33 个调用点**，收尾表格按 `rows.length` 打印。`#5` 曾经写成 if/else 两个调用点、无客户那一支是 `check(..., true, ...)`——它占着一个 pass 却永远为真，等于台账虚报一格；现在收件人夹具（挂存活客户的那条会话）实测可选，就写成一调一断，一条都不许恒真。
>
> `#28`（第二租户扫真 id）与 `#29a`/`#29b`（reconcile 两拍与 `start` 那一拍心跳）是整枝终审补进来的三格：R38 要在自动化里留下「最贵的两个错」的证人——跨租户读到别人的任务、以及两拍顺序颠倒导致的重复发送。`#29a` 与 `#29b` 是一正一反的一对：只有前者通过，才说明后者的 0/0 不是「reconcile 什么都没做」。

- [ ] **Step 5：收尾与打印（每条退出路径都还原）。**

```js
// 收尾：所有创建的任务逐个 cancel（幂等，已是终态的返回 40902 也无害），只打印返回码。
// 这里刻意不 assert「cancel 后没有行留在 sending」——本驱动从未报过 sending 行，那条断言恒真；
// sending 行的结清由 Task 11 的引擎单测来证：每一行投料后必跟一跳终态（`TIMEOUT 落 unknown`
// 那一格证的正是这个——非 success 的投递不能把行留在 sending 上等天收）。
const cancelResults = [];
for (const id of createdTasks) {
  cancelResults.push([id, (await post(`/api/batch-send/tasks/${id}/cancel`)).code]);
}
responses.cancel = cancelResults;

for (const [i, r] of rows.entries()) {
  console.log(`${r.pass ? 'ok  ' : 'FAIL'} #${i + 1} ${r.name}  expect=${r.expected}  actual=${r.actual}`);
}
console.log(`\n${rows.length - failures}/${rows.length} passed`);
if (failures) { console.log('failures=' + failures); }
process.exitCode = failures ? 1 : 0;
await new Promise((res) => setTimeout(res, 1500));
process.exit(failures ? 1 : 0);
```

- [ ] **Step 6：跑。** 先确保 Task 5 构建的后端在 `:8180` 上（必要时 `powershell -NoProfile -ExecutionPolicy Bypass -File tmp/p7b-kill8180.ps1` 再重启）：

```bash
cd /d/SmartSCRM && node tmp/p7b-batch-contract.mjs
```

期望：末行 `30/30 passed`，退出码 0。若前置不足退出码 2 —— 两条候选都是环境而不是产品，回来写「待验证」而不是改断言：账号下无客户空标题会话 < 2 条（#6/#1~#4 的收件人），或账号下找不到「挂存活客户且昵称≠标题≠尾 4」的会话（#5 的 `liveCust`）。

- [ ] **Step 7：不提交驱动。** `tmp/` 已 gitignore；本任务没有需要提交的源码改动，验证结果写进 Task 16 的验收文档草稿（`docs/notes/` 下一份 P7 群发验证文档，**只在本计划最后一个任务提交它**）。

---

## Task 7: `src/shared/batchSend.ts` 纯模型 + unit 闸门接线

**Files:**
- Create: `apps/desktop/src/shared/batchSend.ts`
- Create: `apps/desktop/src/shared/batchSend.test.ts`
（**不改** `apps/desktop/package.json`：`test:unit` 已有 `"src/shared/**/*.test.ts"`，Task 7 的两支天然覆盖。`batchSend` 目录那条 glob 由 **Task 8** 加——它是该目录第一个测试文件；原先写"Task 9 加"，与 Task 11 的 Files 段互相矛盾，两处都已改口）
- （不改）`apps/desktop/tsconfig.unit.json`：`include` 第一条就是 `src/shared/**/*.ts`（读码），
  这两支已被覆盖；再逐条枚举一遍是空转。Task 8/9/10/11 才需要动这个文件（`src/main/services/**` 是逐文件枚举）。

**Interfaces:**
- Consumes: `NormalizedMessage`/`SendReceipt` 之外的东西一律不 import（本文件零依赖，才进得去 unit 程序）。
- Produces（Task 8/9/10/13 都按这些名字用）:
  - `type BatchTaskStatus = 'pending'|'running'|'paused'|'done'|'error'|'cancelled'`
  - `type BatchDetailStatus = 'pending'|'sending'|'success'|'failed'|'unknown'|'skipped'`
  - `type RecallStatus = 'none'|'recalling'|'recalled'|'recall_failed'`
  - `interface BatchTask` / `interface BatchDetail` / `interface BatchStateEvent`
    两个 VO 接口逐列对齐后端出参（读码 `BatchTaskVO.java:10-16`、`BatchDetailVO.java:6-12`）：
    `BatchDetail.recallDetail`（页内撤回的逐条结论，Task 10/15 要展示）、`BatchTask.createdAt`
    （列表排序与展示，Task 14 要用）都是 `string | null` 的墙钟串，与 `sentAt`/`heartbeatAt` 同一口径。
  - `buildQueues(details: BatchDetail[], accountIds: number[]): BatchDetail[][]`：
    **只捡 `pending` 行**。进 `sending` 的唯一 arrow 是 `pending → sending`（spec:96），`failed` 要回队
    必须由人走 `retry-failed`（spec:136）——这条判据和下面那份 `SETTLED_DETAIL_STATUS` 是**两个问题**，
    各答各的，共用一份就会把「重发这一条」变成「重发这一批」。
  - `gapKindFor(prev: BatchDetail | null, cur: BatchDetail): IntervalKind` + `pickIntervalSec(kind, t, rand): number`
  - `outcomeStatus(receipt: { ok: boolean; error?: string }): BatchDetailStatus`
  - `FAIL_STREAK_LIMIT = 3`、`REPORT_BACKLOG_CAP = 500`
  - `class ReportBacklog`（`push/drain/size/dropped`）
  - `interface IntervalConfig` / `type IntervalKind = 'msg'|'chat'`（`pickIntervalSec` 与 Task 11 的节律共用）
  - `interface BatchProgress`：四个运行端点与 reports 的出参 = 后端 `BatchReportsResultVO` 的四列
    （`sentCount/failCount/totalCount/status`），**不是**整张任务——整张任务只有 `GET /tasks/{id}` 一条路。
    preload 与渲染层都要认它，而 preload 不许 import `main/services/**`，所以它住在 shared。
  - `SETTLED_DETAIL_STATUS: readonly BatchDetailStatus[]`（`success`/`unknown`/`skipped`）：
    它答的是「人还能不能处置这一行」——Task 13/15 的状态徽标与「重发这一条」按钮读它。
    **它不决定泵该发谁**（那一条只有 `pending` 算数，见上面的 `buildQueues`）：
    `failed` 在这里必须算「没收口」，否则重试按钮点不动；它对泵又必须是「别再发一遍」。

- [ ] **Step 1：写失败的测试** `apps/desktop/src/shared/batchSend.test.ts`：

```ts
// src/shared/batchSend.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  FAIL_STREAK_LIMIT, REPORT_BACKLOG_CAP, ReportBacklog, SETTLED_DETAIL_STATUS, buildQueues,
  gapKindFor, outcomeStatus, pickIntervalSec
} from './batchSend.ts'
import type { BatchDetail, IntervalConfig } from './batchSend.ts'

const t: IntervalConfig = { msgMin: 3, msgMax: 8, chatMin: 5, chatMax: 15 }
const d = (id: number, seq: number, accountId: number, chatKey: string): BatchDetail => ({
  id, taskId: 1, seq, accountId, chatKey, contentIndex: 0, body: 'x',
  sendStatus: 'pending', recallStatus: 'none'
})

test('buildQueues: 每个账号一条队列，队列内按 seq 升序', () => {
  const rows = [d(5, 5, 2, 'b'), d(1, 1, 1, 'a'), d(3, 3, 1, 'a'), d(2, 2, 2, 'b')]
  const q = buildQueues(rows, [1, 2])
  assert.deepEqual(q.map((x) => x.map((r) => r.id)), [[1, 3], [2, 5]])
})

test('buildQueues: 没在 accountIds 里的行不进队列（账号被剔出任务不该照跑）', () => {
  // 实现保证「每个账号一条队列」（长度 = accountIds.length），账号下没有可发行时
  // 拿到的是 [[]] 而不是 []。Task 11 靠这条形状给每个账号挂一条泵，空队列也要占位。
  assert.deepEqual(buildQueues([d(1, 1, 9, 'a')], [1]).flat(), [])
  assert.equal(buildQueues([d(1, 1, 9, 'a')], [1, 2]).length, 2)
})

test('buildQueues: 终态行不进队列（重跑一个已 done 的任务不该重发成功条目）', () => {
  const done = { ...d(1, 1, 1, 'a'), sendStatus: 'success' as const }
  assert.deepEqual(buildQueues([done], [1]).flat(), [])
})

// 这里有两个不同的问题，之前被一份判据一起答了，所以答错了一个：
// SETTLED_DETAIL_STATUS 答的是「人还能不能处置这一行」——'failed' 必须**不在**里面，单条重发靠它，
// 漏了 Task 15 的重试按钮就点不动；'unknown' 必须在里面，它是 R2 的落点（超时可能已送达）。
// buildQueues 答的是「泵该不该再发这一行」——只有 pending 算数。
test('SETTLED 管"人可处置"、buildQueues 管"泵可发"：泵只捡 pending', () => {
  assert.deepEqual([...SETTLED_DETAIL_STATUS].sort(), ['skipped', 'success', 'unknown'])
  for (const s of ['success', 'unknown', 'skipped', 'failed', 'sending'] as const) {
    assert.deepEqual(buildQueues([{ ...d(1, 1, 1, 'a'), sendStatus: s }], [1]).flat(), [], s + ' 不该进队列')
  }
  assert.equal(buildQueues([d(1, 1, 1, 'a')], [1]).flat().length, 1, 'pending 要进队列')
})

test('pickIntervalSec: 落在 [min,max] 且取整，边界两种随机数都夹得住', () => {
  assert.equal(pickIntervalSec('msg', t, () => 0), 3)
  assert.equal(pickIntervalSec('msg', t, () => 0.999999), 8)
  // rand() 交出区间外的数（桩函数给 1、负数）时，钳制必须把它夹回区间内，
  // 否则 max+1 秒会直接进 Task 11 的等待时长里。
  assert.equal(pickIntervalSec('msg', t, () => 1), 8)
  assert.equal(pickIntervalSec('msg', t, () => -0.5), 3)
  // 非有限值走区间下界：NaN 穿到 setTimeout 就是"立刻触发"，节律等于没设；
  // Infinity 也按同一张嘴处理，不然两条分支要各记一条规则。
  assert.equal(pickIntervalSec('msg', t, () => Number.NaN), 3)
  assert.equal(pickIntervalSec('msg', t, () => Number.POSITIVE_INFINITY), 3)
  assert.equal(pickIntervalSec('msg', t, () => Number.NEGATIVE_INFINITY), 3)
  assert.equal(pickIntervalSec('chat', t, () => 0.5), 10)
  for (let i = 0; i < 200; i++) {
    const v = pickIntervalSec('msg', t, Math.random)
    assert.ok(v >= 3 && v <= 8 && Number.isInteger(v), `越界读数 ${v}`)
  }
})

test('pickIntervalSec: min===max 时不抖动', () =>
  assert.equal(pickIntervalSec('msg', { msgMin: 7, msgMax: 7, chatMin: 0, chatMax: 0 }, () => 0.3), 7))

test('outcomeStatus: TIMEOUT 是 unknown 而不是 failed', () => {
  assert.equal(outcomeStatus({ ok: true }), 'success')
  assert.equal(outcomeStatus({ ok: false, error: 'TIMEOUT' }), 'unknown')
  assert.equal(outcomeStatus({ ok: false, error: 'SEND_FAILED' }), 'failed')
  assert.equal(outcomeStatus({ ok: false }), 'failed')
})

test('ReportBacklog: 溢出丢最旧并计数，drain 保序且清空', () => {
  const b = new ReportBacklog<number>()
  for (let i = 0; i < REPORT_BACKLOG_CAP + 3; i++) b.push(i)
  assert.equal(b.size, REPORT_BACKLOG_CAP)
  assert.equal(b.dropped, 3)
  const out = b.drain()
  assert.equal(out.length, REPORT_BACKLOG_CAP)
  assert.equal(out[0], 3)
  assert.equal(b.size, 0)
  assert.deepEqual(b.drain(), [])
})

test('gapKindFor: 同人接续算 msg，换人算 chat；跨账号同 chatKey 必须算换人', () => {
  const first = d(1, 1, 1, '8613800001001@c.us')
  assert.equal(gapKindFor(null, first), 'chat')
  assert.equal(gapKindFor(first, d(2, 2, 1, '8613800001001@c.us')), 'msg')
  assert.equal(gapKindFor(first, d(3, 3, 2, '8613800001001@c.us')), 'chat')
})

test('FAIL_STREAK_LIMIT 就是 3（spec §5 的熔断阈值只有一个出处）', () =>
  assert.equal(FAIL_STREAK_LIMIT, 3))
```

- [ ] **Step 2：跑，确认失败。**

```bash
cd /d/SmartSCRM/apps/desktop && pnpm run test:unit 2>&1 | tail -20
```

期望：`Cannot find module ... batchSend.ts`（不是 212 绿 —— 失败必须是"找不到实现"这个形状）。

- [ ] **Step 3：写 `batchSend.ts`。** 关键实现（全部纯函数，零 import）：

```ts
// src/shared/batchSend.ts
export type BatchTaskStatus = 'pending' | 'running' | 'paused' | 'done' | 'error' | 'cancelled'
export type BatchDetailStatus = 'pending' | 'sending' | 'success' | 'failed' | 'unknown' | 'skipped'
export type RecallStatus = 'none' | 'recalling' | 'recalled' | 'recall_failed'

/**
 * 「人还能不能处置这一行」= 已经收口。Task 13/15 的徽标与「重发这一条」按钮读它。
 * 这条判据**不**用来决定泵该发谁（那一条只有 `pending` 算数，见 `buildQueues`）：
 * `failed` 在这里必须算"没收口"，否则重试按钮点不动；它对泵又必须是"别再发一遍"。
 */
export const SETTLED_DETAIL_STATUS: readonly BatchDetailStatus[] = ['success', 'unknown', 'skipped']

export interface BatchDetail {
  id: number
  taskId: number
  seq: number
  accountId: number
  chatKey: string
  customerId?: number | null
  contentIndex: number
  body: string
  localId?: string | null
  sendStatus: BatchDetailStatus
  errorCode?: string | null
  errorDetail?: string | null
  msgKey?: string | null
  recallStatus: RecallStatus
  /** 页内撤回四态的逐条结论文案（后端 `recall_detail`）；没撤过就为空。 */
  recallDetail?: string | null
  /** 后端 VO 的墙钟串（不带偏移），显示走 `chatMs` + `chatClock`；引擎只写不回读，所以可选。 */
  sentAt?: string | null
}

export interface BatchTask {
  id: number
  name: string
  platform: string
  dryRun: boolean
  status: BatchTaskStatus
  accountIds: number[]
  contents: string[]
  msgIntervalMin: number
  msgIntervalMax: number
  chatIntervalMin: number
  chatIntervalMax: number
  totalCount: number
  sentCount: number
  failCount: number
  /**
   * 后端 `LocalDateTime` 出来的墙钟串（`'2026-09-28T13:04:05'`，不带偏移），与
   * `api/messages.ts` 的 `lastMsgTime: string | null` 同一口径；解析只准用 `chatMs`（补 `+08:00`），
   * 直接 `dayjs(串)` 会在非东八区机器上按浏览器时区偏一次。
   */
  heartbeatAt?: string | null
  /** 与 `heartbeatAt` 同一口径的墙钟串（后端 `created_at` 原样透传）；列表按它排序展示，解析同样只准走 `chatMs`。 */
  createdAt?: string | null
}

export interface IntervalConfig { msgMin: number; msgMax: number; chatMin: number; chatMax: number }
export type IntervalKind = 'msg' | 'chat'

/**
 * `batch:state` 的载荷。它只是"进度变了"的通知：数字仍然以 GET 回来的那一份为准，
 * 渲染层不拿它当状态源（Task 13 的 useBatchLive 收到就 refetch）。
 */
export interface BatchStateEvent {
  taskId: number
  status: BatchTaskStatus
  totalCount: number
  sentCount: number
  failCount: number
}

/**
 * 运行面四个迁移（start/pause/resume/cancel）与 reports 的出参 = 后端 `BatchReportsResultVO` 的四列，
 * 不是整张任务：它没有 name/contents/间隔。放在 shared 是因为 preload 与渲染层都要认它，
 * 而 preload 不许 import `main/services/**`（两个 tsconfig 范围）。
 * 整张任务只有 `GET /tasks/{id}` 一条路（`BatchTask`）。
 */
export interface BatchProgress {
  sentCount: number
  failCount: number
  totalCount: number
  status: BatchTaskStatus
}

/**
 * 账号之间并行、账号内串行，所以队列形状 = 按 accountIds 顺序分组、组内 seq 升序。
 * 泵只捡 `pending` 行：进 `sending` 的唯一 arrow 是 `pending → sending`（spec:96），
 * `failed` 要回队必须由人走 `retry-failed`（spec:136）——别把这里改成读 `SETTLED_DETAIL_STATUS`，
 * 那一份判据答的是「人还能不能处置这一行」，拿它决定投料会把单条重发变成全部重发。
 */
export function buildQueues(details: BatchDetail[], accountIds: number[]): BatchDetail[][] {
  return accountIds
    .map((a) => details
      .filter((d) => d.accountId === a && d.sendStatus === 'pending')
      .sort((x, y) => x.seq - y.seq))
}

export function gapKindFor(prev: BatchDetail | null, cur: BatchDetail): IntervalKind {
  return prev && prev.chatKey === cur.chatKey && prev.accountId === cur.accountId ? 'msg' : 'chat'
}

export function pickIntervalSec(kind: IntervalKind, t: IntervalConfig, rand: () => number): number {
  const min = kind === 'msg' ? t.msgMin : t.chatMin
  const max = kind === 'msg' ? t.msgMax : t.chatMax
  if (max <= min) return min
  // 非有限值（NaN / ±Infinity）一律走区间下界：NaN 会一路穿到 Task 11 的 setTimeout，
  // 而 `setTimeout(fn, NaN)` 等于立刻触发——节律保护正是它该护住账号的那一格就这样没了。
  const raw = rand()
  const r = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 0.999999) : 0
  return Math.floor(min + r * (max - min + 1))
}

/** TIMEOUT → unknown：可能已经发出去了，把它算成失败会诱导出"再发一遍"。 */
export function outcomeStatus(receipt: { ok: boolean; error?: string }): BatchDetailStatus {
  if (receipt.ok) return 'success'
  return receipt.error === 'TIMEOUT' ? 'unknown' : 'failed'
}

export const FAIL_STREAK_LIMIT = 3
export const REPORT_BACKLOG_CAP = 500

/** 后端不可达时的内存积压：溢出丢最旧并计数，恢复后按序重报。 */
export class ReportBacklog<T> {
  private readonly items: T[] = []
  dropped = 0

  push(item: T): void {
    this.items.push(item)
    if (this.items.length > REPORT_BACKLOG_CAP) {
      this.items.shift()
      this.dropped += 1
    }
  }

  drain(): T[] {
    return this.items.splice(0, this.items.length)
  }

  get size(): number {
    return this.items.length
  }
}
```

- [ ] **Step 4：确认 `tsconfig.unit.json` 已覆盖这两支，不要改它。** 读码：`include[0] === "src/shared/**/*.ts"`，`src/shared/batchSend.ts` 与 `batchSend.test.ts` 天然在内。改这个文件是空转，而空转会在后续任务的 diff 里被当成「Task 7 动过 tsconfig」误读。
- [ ] **Step 5：跑 unit + typecheck。**

```bash
cd /d/SmartSCRM/apps/desktop && pnpm run test:unit 2>&1 | tail -8 && pnpm run typecheck 2>&1 | tail -8
```

期望：`pass 212+10`（10 条 = buildQueues 3 + 「SETTLED 管人可处置 / buildQueues 管泵可发」1 + pickIntervalSec 2 + outcomeStatus 1 + ReportBacklog 1 + gapKindFor 1 + FAIL_STREAK_LIMIT 1）、`fail 0`；typecheck 四路 0 error。

- [ ] **Step 6：提交。** `feat(P7/群发): shared 群发纯模型（队列/节律/熔断阈值/上报积压）`

---

## Task 8: `batchApi.ts`——主进程到后端的群发十二跳

**Files:**
- Create: `apps/desktop/src/main/services/batchSend/batchApi.ts`
- Create: `apps/desktop/src/main/services/batchSend/batchApi.test.ts`
- Modify: `apps/desktop/package.json:15`（`test:unit` 追加 `"src/main/services/batchSend/**/*.test.ts"`——**本任务就是这个目录第一个测试文件**，glob 不在这里加，后面 Task 9/10 每次报的"unit 全绿"都不含刚写的那几条，而漏掉的窗口正好横跨三个任务）
- Modify: `apps/desktop/tsconfig.unit.json`（include 加这两支：`src/main/services/batchSend/batchApi.ts`、`src/main/services/batchSend/batchApi.test.ts`。**只加这两支**——`src/main/services/**` 是逐文件枚举，而 Task 7 那两支不用再加，`include[0]` 的 `src/shared/**/*.ts` 已经覆盖）

**Interfaces:**
- Consumes: Task 7 的 `BatchTask`/`BatchDetail`/`BatchProgress`；后端 Task 4/5 端点与响应形状。
- Produces（Task 11/12 按这些名字用；本任务自带 **9 条** `node --test` 用例）:
  - `type Fetcher = (path: string, init: RequestInit) => Promise<Response>`（真身是 Task 12 传进来的 `authedFetch`）
  - `interface ReportItem { detailId: number; localId?: string; sendStatus: string; errorCode?: string; errorDetail?: string; msgKey?: string; sentAtEpochSec?: number }`
  - `RecallTarget { detailId: number; accountId: number; chatKey: string; msgKey: string }`、`RecallBlocked { detailId: number; reason: string }`、`RecallPlan { eligible: RecallTarget[]; rejected: RecallBlocked[] }`、`RecallReportItem { detailId: number; recalled: boolean; detail?: string }`、`Page<T> { records: T[]; total: number; page: number; pageSize: number }`
  - `createBatchApi(opts: BatchApiOptions)` → `BatchApi = ReturnType<typeof createBatchApi>`，十二个方法就是 Step 3 实现里那十二个（十跳运行面 + `task`/`details` 两跳只读）：`start/pause/resume/cancel(taskId) → Promise<BatchProgress | null>`、`reports(taskId, items, allHalted) → Promise<BatchProgress | null>`、`task(id) → Promise<BatchTask | null>`、`details(taskId, page, size) → Promise<Page<BatchDetail> | null>`（URL 里拼 `size=`，见 Task 4 Step 4 的「入参 size / 出参 pageSize」）、`heartbeat(taskId) → Promise<number>`、`retryFailed(taskId, detailIds?) → Promise<number>`（省略＝整批，带＝只复位那几条，R11）、`recall(taskId, detailIds) → Promise<RecallPlan | null>`、`recallReports(taskId, items) → Promise<number>`、`reconcile() → Promise<{ pausedTasks: number; markedUnknown: number } | null>`
  - `BatchApiOptions { fetcher: Fetcher; onError?: (where: string, e: unknown) => void }`（两个参数：host 要知道是哪一跳挂了，只给 error 就得上 log 里猜）

- [ ] **Step 1：写失败的测试**（`node --test`，`tsconfig.unit.json` 内，相对导入）：

```ts
// src/main/services/batchSend/batchApi.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBatchApi } from './batchApi.ts'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

test('reports：信封 code=0 才认，返回 data', async () => {
  const calls: { path: string; body: string }[] = []
  const api = createBatchApi({
    fetcher: async (path, init) => {
      calls.push({ path, body: String(init.body) })
      return json({ code: 0, message: 'ok', data: { sentCount: 2, failCount: 1, totalCount: 4, status: 'running' } })
    }
  })
  const out = await api.reports(9, [{ detailId: 1, sendStatus: 'success' }], false)
  assert.equal(out?.status, 'running')
  assert.equal(calls[0].path, '/api/batch-send/tasks/9/reports')
  assert.ok(calls[0].body.includes('"allHalted":false'), calls[0].body)
})

test('任何非 0 信封 / 非 2xx / 抛错都塌成 null 或 0，不抛出到调用方', async () => {
  const boom = createBatchApi({ fetcher: async () => { throw new Error('ECONNREFUSED') } })
  assert.equal(await boom.heartbeat(1), 0)
  assert.equal(await boom.retryFailed(1), 0)
  assert.equal(await boom.recall(1, [1]), null)
  const bad = createBatchApi({ fetcher: async () => json({ code: 40902, message: '状态非法' }, 409) })
  assert.equal(await bad.start(1), null)
  assert.equal(await bad.heartbeat(1), 0)
})

test('401 无 data 字段这条既有口径不在这里兜：只信 code===0 && data!==undefined', async () => {
  const api = createBatchApi({ fetcher: async () => json({ code: 401, message: 'unauthorized' }, 401) })
  assert.equal(await api.task(1), null)
})

test('recall 出参保留 eligible 与 rejected 两侧', async () => {
  const api = createBatchApi({
    fetcher: async () => json({ code: 0, data: {
      eligible: [{ detailId: 3, accountId: 7, chatKey: 'a@c.us', msgKey: 'true_a@c.us_3_out' }],
      rejected: [{ detailId: 4, reason: '这一条不是成功状态（send_status=failed），撤回无从谈起' }]
    } })
  })
  const plan = await api.recall(1, [3, 4])
  assert.equal(plan?.eligible.length, 1)
  assert.match(plan?.rejected[0].reason ?? '', /不是成功状态/)
})

// R11：同一条端点两种粒度。省略或空数组 = 整批复位（不发 body），带 detailIds = 只复位勾选的那几条。
// 这一支是全文件最容易静默坏掉的地方：把空数组拼成 body 发出去，后端按整批复位还是按零条复位，
// 调用方在渲染层看不出来——单条重发按钮会「成功」但复位了整批。
test('retryFailed：省略/空数组都不带 body，非空数组只带那几条', async () => {
  const seen: { path: string; body?: string }[] = []
  const api = createBatchApi({
    fetcher: async (path, init) => {
      seen.push({ path, body: init.body === undefined ? undefined : String(init.body) })
      return json({ code: 0, data: { reset: 1, status: 'paused' } })
    }
  })
  assert.equal(await api.retryFailed(1), 1)
  assert.equal(await api.retryFailed(1, []), 1)
  assert.equal(seen[0].body, undefined)
  assert.equal(seen[1].body, undefined)
  await api.retryFailed(1, [7, 8])
  assert.equal(seen[2].body, JSON.stringify({ detailIds: [7, 8] }))
})

// 两个「只回一个数」的跳：抽取的键名各有其主（heartbeat=updated / recallReports=settled），
// 写错键名的症状是永远回 0，而 0 在这里是合法值——泵会据此停摆，看起来像后端坏了。
test('heartbeat 取 updated、recallReports 取 settled，缺字段塌成 0', async () => {
  const api = createBatchApi({
    fetcher: async (path) =>
      json({ code: 0, data: path.includes('heartbeat') ? { updated: 1 } : { settled: 2 } })
  })
  assert.equal(await api.heartbeat(1), 1)
  assert.equal(await api.recallReports(1, [{ detailId: 1, recalled: true }]), 2)
  const empty = createBatchApi({ fetcher: async () => json({ code: 0, data: {} }) })
  assert.equal(await empty.heartbeat(1), 0)
  assert.equal(await empty.recallReports(1, []), 0)
})

test('details 分页参数进 query 串，页码从 1 起', async () => {
  let seenPath = ''
  const api = createBatchApi({ fetcher: async (p) => { seenPath = p; return json({ code: 0, data: { records: [], total: 0, page: 2, pageSize: 50 } }) } })
  await api.details(1, 2, 50)
  assert.equal(seenPath, '/api/batch-send/tasks/1/details?page=2&size=50')
})

// 塌成 null 的三种形状必须各自落到 onError(where, e)，且 where = 那一跳的 path：
// 调用方拿到的返回值全是 null/0，唯一的区别就在这一路回调里。少报任何一种，
// Task 11 的心跳泵就无法把「后端拒了这个迁移」和「后端没起来」分开处理。
test('三种塌法都报到 onError，where 就是那一跳的 path', async () => {
  const seen: { where: string; msg: string }[] = []
  const mk = (fetcher: (p: string) => Promise<Response>): ReturnType<typeof createBatchApi> =>
    createBatchApi({ fetcher, onError: (where, e) => seen.push({ where, msg: String(e) }) })

  await mk(async () => { throw new Error('ECONNREFUSED') }).start(1)
  await mk(async () => json({ code: 40902, message: '状态非法' }, 409)).pause(2)
  await mk(async () => json({ code: 50000, message: 'boom' }, 200)).resume(3)
  await mk(async () => json({ code: 0, message: 'ok' }, 200)).cancel(4)

  assert.deepEqual(seen.map((s) => s.where), [
    '/api/batch-send/tasks/1/start',
    '/api/batch-send/tasks/2/pause',
    '/api/batch-send/tasks/3/resume',
    '/api/batch-send/tasks/4/cancel'
  ])
  assert.match(seen[0].msg, /ECONNREFUSED/)
  assert.match(seen[1].msg, /HTTP 409/, '非 2xx 要把状态码带出来，否则日志里只有 null')
  assert.match(seen[2].msg, /code=50000/, '200 + 非 0 信封要把信封码带出来')
  assert.match(seen[3].msg, /data 缺失/, 'code=0 但没 data 是后端形状变了，不能报成"非 0"')
})

// 宿主的 onError 挂了也不能把"这一跳没成"升级成抛到采集/发送链上——那是全文件的返回值契约。
// 少了 note 里那层 try，这一条会直接 reject 而不是拿到 null/0。
test('onError 自己抛，调用方仍然只拿到 null/0', async () => {
  const api = createBatchApi({
    fetcher: async () => json({ code: 40902, message: '状态非法' }, 409),
    onError: () => { throw new Error('宿主的日志实现挂了') }
  })
  assert.equal(await api.start(1), null)
  assert.equal(await api.heartbeat(1), 0)
})
```

- [ ] **Step 2：跑 → 找不到模块。**
- [ ] **Step 3：写 `batchApi.ts`。** 形制照 `msgBridge/msgApi.ts`（信封→null，全部返回"成功与否"而不抛），但 `fetcher` 注入而不是自己拼 base：

```ts
// src/main/services/batchSend/batchApi.ts
import type { BatchDetail, BatchProgress, BatchTask } from '../../../shared/batchSend.ts'

export type Fetcher = (path: string, init: RequestInit) => Promise<Response>

interface Envelope<T> { code: number; message?: string; data?: T }

export interface ReportItem {
  detailId: number
  localId?: string
  sendStatus: string
  errorCode?: string
  errorDetail?: string
  msgKey?: string
  sentAtEpochSec?: number
}

export interface RecallTarget { detailId: number; accountId: number; chatKey: string; msgKey: string }
export interface RecallBlocked { detailId: number; reason: string }
export interface RecallPlan { eligible: RecallTarget[]; rejected: RecallBlocked[] }
export interface RecallReportItem { detailId: number; recalled: boolean; detail?: string }
export interface Page<T> { records: T[]; total: number; page: number; pageSize: number }

export interface BatchApiOptions { fetcher: Fetcher; onError?: (where: string, e: unknown) => void }

// 返回类型不写在这里：`BatchApi = ReturnType<typeof createBatchApi>` 是 Task 11/12 的口径，
// 而 `: BatchApi` 会自引用循环。同形的 `createMsgApi` 挂着同一条既有 error，这里用仓库惯例的
// 行级豁免补齐 `--quiet` 闸门，不改 brief 的任何行为。
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function createBatchApi(opts: BatchApiOptions) {
  // 诊断通道自己不能把这一跳弄挂：宿主传进来的 `onError` 一旦抛，本来只是"这一跳没成"的调用
  // 会变成抛到采集/发送链上，而全文件"返回成功与否、不抛"的那条口径就是靠这里兜住。
  const note = (where: string, e: unknown): void => {
    try {
      opts.onError?.(where, e)
    } catch {
      /* 宿主的日志实现挂了：吞掉，让这一跳照常塌成 null/0 */
    }
  }

  /**
   * 三种「这一跳没成」的形状都要落到 `onError`，因为塌成 null 之后调用方只剩一个值可读：
   * - 非 2xx（409 状态迁移非法 / 40404 任务不属本租户 / 网关 5xx）
   * - 200 但信封 `code !== 0` 或缺 `data`
   * - `fetcher` 直接抛（后端没起 / 断网）
   * 少报任何一种，Task 11 的心跳泵就只能把"后端拒了"和"后端根本没起来"当成同一件事处理——
   * 而它对该不该停泵的判断正好取决于这两者的区别。
   */
  async function call<T>(path: string, init: RequestInit): Promise<T | null> {
    try {
      const res = await opts.fetcher(path, init)
      if (!res.ok) {
        note(path, new Error(`HTTP ${res.status}`))
        return null
      }
      const env = (await res.json()) as Envelope<T>
      if (env.code !== 0 || env.data === undefined) {
        // 两种塌法分开点名：`code=0 但缺 data` 说的是后端形状变了，和"业务拒了"是两回事。
        note(path, new Error(env.code !== 0 ? `信封 code=${env.code}` : '信封 code=0 但 data 缺失'))
        return null
      }
      return env.data
    } catch (e) {
      note(path, e)
      return null
    }
  }

  // 运行面四跳与 reports 的出参就是 `BatchProgress` 那四列，所以直接 call<BatchProgress> 带上类型，
  // 而不是先取 unknown 再 cast：会被 cast 掉的恰好是这几跳——后端在这里回 40902/40404 时，
  // `call` 塌成 null 是有语义的（状态机拒了 / 任务不属于本租户），糊成 unknown 就没人知道 null 从哪来。
  const postProgress = (path: string, body?: unknown): Promise<BatchProgress | null> =>
    call<BatchProgress>(path, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) })

  return {
    start: (taskId: number) => postProgress(`/api/batch-send/tasks/${taskId}/start`),
    pause: (taskId: number) => postProgress(`/api/batch-send/tasks/${taskId}/pause`),
    resume: (taskId: number) => postProgress(`/api/batch-send/tasks/${taskId}/resume`),
    cancel: (taskId: number) => postProgress(`/api/batch-send/tasks/${taskId}/cancel`),
    task: (taskId: number) => call<BatchTask>(`/api/batch-send/tasks/${taskId}`, { method: 'GET' }),
    details: (taskId: number, page: number, size: number) =>
      call<Page<BatchDetail>>(`/api/batch-send/tasks/${taskId}/details?page=${page}&size=${size}`,
        { method: 'GET' }),
    /** 心跳只关心"命中没有"：0 = 任务已不在 running，调用方据此停泵。 */
    async heartbeat(taskId: number): Promise<number> {
      const data = await call<{ updated?: number }>(`/api/batch-send/tasks/${taskId}/heartbeat`,
        { method: 'POST' })
      return data?.updated ?? 0
    },
    reports: (taskId: number, items: ReportItem[], allHalted: boolean) =>
      postProgress(`/api/batch-send/tasks/${taskId}/reports`, { items, allHalted }),
    /**
     * 只回复位条数：R11 那次「done/error → paused」的唤醒结果由渲染层随后 GET 任务拿到，
     * 这里不把 status 穿两层 IPC 再穿一次——同一条链上出现两个"任务现在是什么状态"的读数来源，
     * 而其中一个可能是上一跳的旧值。
     * detailIds 省略或空数组 = 整批复位；带 = 只复位勾选的那几条（spec §7 的单条重发）。
     */
    async retryFailed(taskId: number, detailIds?: number[]): Promise<number> {
      const data = await call<{ reset?: number }>(`/api/batch-send/tasks/${taskId}/retry-failed`,
        detailIds?.length
          ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ detailIds }) }
          : { method: 'POST' })
      return data?.reset ?? 0
    },
    recall: (taskId: number, detailIds: number[]) =>
      call<RecallPlan>(`/api/batch-send/tasks/${taskId}/recall`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ detailIds }) }),
    async recallReports(taskId: number, items: RecallReportItem[]): Promise<number> {
      const data = await call<{ settled?: number }>(`/api/batch-send/tasks/${taskId}/recall-reports`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items }) })
      return data?.settled ?? 0
    },
    reconcile: () => call<{ pausedTasks: number; markedUnknown: number }>('/api/batch-send/reconcile',
      { method: 'POST' })
  }
}

export type BatchApi = ReturnType<typeof createBatchApi>
```

- [ ] **Step 4：`tsconfig.unit.json` 的 `include` 追加那两支**（`src/main/services/batchSend/batchApi.ts`、`.../batchApi.test.ts`；`host.ts` 这类 import electron 的绝不能加）。`package.json:15` 的 `test:unit` 追加 `"src/main/services/batchSend/**/*.test.ts"`。跑 unit + typecheck 全绿：期望 `pass` 从 **222 → 231**（212 基线 + Task 7 的 10 + 本任务 9），`fail 0`。
- [ ] **Step 5：提交。** `feat(P7/群发): 主进程群发十二跳，注入 fetcher 且全部塌成 null`

## Task 9: per-view 发送锁 + `sendText` / `recallText` 挂锁

**Files:**
- Create: `apps/desktop/src/main/services/msgBridge/sendLock.ts`
- Create: `apps/desktop/src/main/services/msgBridge/sendLock.test.ts`
- Modify: `apps/desktop/src/main/services/msgBridge/sendRegistry.ts`（同文件加第二个类 `RecallRegistry`）
- Modify: `apps/desktop/src/main/services/msgBridge/sendRegistry.test.ts`（`RecallRegistry` 两条）
- Modify: `apps/desktop/src/main/services/msgBridge/index.ts`（`sendText` 包锁；新增 `recallText`；`recall_result` 结清；掉线与销毁两条出口）
- Modify: `apps/desktop/tsconfig.unit.json`（只追加一行 `src/main/services/msgBridge/sendLock.ts`。`sendLock.test.ts` 已被现有的 `src/main/services/msgBridge/*.test.ts` 那一行收进，**不要再登记一次**；`index.ts` 与 `bridgeMount.ts` import electron，永远不进这份 include）

**本任务自带 8 条测试**（sendLock 6 + RecallRegistry 2），unit 期望 `pass` 从 **231 → 239**。

**Interfaces:**
- Consumes: 无（纯 promise 链工具）。`sendLock.ts` 与 `RecallRegistry` 都不许 import electron——它们进 `tsconfig.unit.json`，那里跑的是 `node --test`。
- Produces:
  - `class SendLock { run<T>(viewId: string, job: () => Promise<T>): Promise<T>; pending(viewId?): number; dropView(viewId): void }`
  - `class RecallRegistry { get size: number; add(localId: string, viewId: string): Promise<RecallReceipt>; settle(receipt: RecallReceipt): boolean; failView(viewId: string, detail?: string): number; dispose(): void }`（`sendRegistry.ts`，默认超时 20 s 与 `SendRegistry` 同形）
  - `msgBridge.recallText(req: RecallRequest): Promise<RecallReceipt>`（新增导出）
  - `RecallRequest = { accountId: number; chatKey: string; msgKey: string; localId: string }`、`RecallReceipt = { localId: string; ok: boolean; isRevoked?: boolean; detail?: string }`（`shared/chatTypes.ts`）

- [ ] **Step 1：失败的测试**（`sendLock.ts` 在 `tsconfig.unit.json` 的 include 里，所以它不能 import electron）：

```ts
// src/main/services/msgBridge/sendLock.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SendLock } from './sendLock.ts'

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

test('同一 viewId 的 job 严格串行，不交错', async () => {
  const lock = new SendLock()
  const log: string[] = []
  const job = (tag: string) => lock.run('v1', async () => {
    log.push(`in:${tag}`)
    await tick()
    log.push(`out:${tag}`)
    return tag
  })
  const all = await Promise.all([job('a'), job('b'), job('c')])
  assert.deepEqual(log, ['in:a', 'out:a', 'in:b', 'out:b', 'in:c', 'out:c'])
  assert.deepEqual(all, ['a', 'b', 'c'])
})

test('不同 viewId 并发：一条账号上的队列不该挡住另一条', async () => {
  const lock = new SendLock()
  const log: string[] = []
  await Promise.all([
    lock.run('v1', async () => { log.push('v1a'); await tick(); log.push('v1b') }),
    lock.run('v2', async () => { log.push('v2a'); await tick(); log.push('v2b') })
  ])
  assert.deepEqual(log.slice(0, 2).sort(), ['v1a', 'v2a'], '两条链应同时起步')
})

test('前一条抛错不会让后面的排队者拿到一个死锁：锁自己吞掉失败', async () => {
  const lock = new SendLock()
  await assert.rejects(() => lock.run('v1', async () => { throw new Error('页内炸了') }), /页内炸了/)
  assert.equal(await lock.run('v1', async () => 'ok'), 'ok')
  assert.equal(lock.pending('v1'), 0)
})

test('pending 计数含在途那条，dropView 之后新 job 仍能排队', async () => {
  const lock = new SendLock()
  let release = (): void => {}
  const held = lock.run('v1', () => new Promise<string>((r) => { release = () => r('done') }))
  assert.equal(lock.pending('v1'), 1)
  const queued = lock.run('v1', async () => 'second')
  assert.equal(lock.pending('v1'), 2)
  release()
  assert.deepEqual(await Promise.all([held, queued]), ['done', 'second'])
  lock.dropView('v1')
  assert.equal(await lock.run('v1', async () => 'third'), 'third')
})

test('作业同步就抛：这一环照样释放，后来的不被一条死尾链卡住', async () => {
  const lock = new SendLock()
  // 非 async 的闭包：抛出发生在 await 之前。起飞那一行若排在 try 之外，finally 就不跑，
  // done 永远没人 resolve——下一条会排在一个死 promise 上，而日志里什么都没有。
  await assert.rejects(() => lock.run('v1', () => { throw new Error('起飞前就炸') }), /起飞前就炸/)
  assert.equal(lock.pending('v1'), 0, '抛错那一环的计数要归还')
  assert.equal(await lock.run('v1', async () => 'ok'), 'ok')
})

test('排队中被 dropView：两条陆续收尾也不把 pending 减成负数', async () => {
  const lock = new SendLock()
  let release = (): void => {}
  const held = lock.run('v1', () => new Promise<string>((r) => { release = () => r('done') }))
  const queued = lock.run('v1', async () => 'second')
  assert.equal(lock.pending('v1'), 2)
  lock.dropView('v1') // 视图销毁：队列还在飞，两条的 finally 之后才各自收尾
  release()
  await Promise.all([held, queued])
  assert.equal(lock.pending('v1'), 0, '摘掉的 view 不许留下负计数')
  assert.equal(lock.pending(), 0, '全局求和也不许被负数拖下去')
})
```

- [ ] **Step 2：跑 → 找不到模块。**
- [ ] **Step 3：写 `sendLock.ts`。**

```ts
// src/main/services/msgBridge/sendLock.ts
/**
 * per-view 串行闸门：同一个视图同一时刻只允许一条 send/recall 在页内飞。
 * 群发与回复框共用它（spec §5）——归属认领的判据是"同视图+同会话+同文本 FIFO"，
 * 让两条并发就是把认错的口子摊开；代价是手动回复最坏多等一条间隔。
 * <p>
 * 实现是"每个 view 一条尾链"：链上任何一环失败都必须被吞掉再往下走，
 * 否则一次页内异常会留下一个 rejected tail，之后每一条都排队去撞同一个死 promise。
 */
export class SendLock {
  // erasableSyntaxOnly 下不许写参数属性，两个 map 都在类顶部声明。
  private readonly tails = new Map<string, Promise<unknown>>()
  private readonly count = new Map<string, number>()

  pending(viewId?: string): number {
    if (viewId !== undefined) return this.count.get(viewId) ?? 0
    return [...this.count.values()].reduce((a, b) => a + b, 0)
  }

  async run<T>(viewId: string, job: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(viewId)
    // 计数在第一个 await 之前加：测试要在调用后同步读到 pending。
    this.count.set(viewId, (this.count.get(viewId) ?? 0) + 1)
    // done 只给队尾当"这一环结束了"的信号（成功失败都一样）；调用方拿的是 job 自己的结果。
    let release!: () => void
    const done = new Promise<void>((r) => { release = r })
    this.tails.set(viewId, done)
    // 队首（prev 为 undefined）直接同步启动 job，保证外部在同一个同步段就能拿到 promise resolve；
    // 排队时等 prev 兑现再启动——这才是串行的真正来源。
    // 起飞那一行必须留在 try 里：一个同步就抛的作业（非 async 的闭包）要是逃在 try 之外，
    // finally 就不会跑，这一环的 done 永远没人 resolve，该 view 之后每一条都排在一个死 promise 上。
    try {
      const result = prev ? prev.catch(() => undefined).then(job) : job()
      return await result
    } finally {
      // 归零就删键，不写 0：dropView 已经把这个 view 摘掉时，`?? 1` 那一格会把计数写回表里，
      // 后面排队的那一环再减一次就成了负数，而 pending() 是全局求和的。
      const next = (this.count.get(viewId) ?? 1) - 1
      if (next > 0) this.count.set(viewId, next)
      else this.count.delete(viewId)
      release()
      if (this.tails.get(viewId) === done) this.tails.delete(viewId)
    }
  }

  /** 视图销毁：把这座岛摘掉，别让旧 viewId 的尾链挂进新会话。 */
  dropView(viewId: string): void {
    this.tails.delete(viewId)
    this.count.delete(viewId)
  }
}
```

- [ ] **Step 4：跑 `sendLock.test.ts` 六条全绿**（`sendRegistry.test.ts` 的那两条要到 Step 5b 才写，这一步先不碰），`pnpm run typecheck` 四路干净。

> **队首那一条必须同步起飞**（R45，实施后回写到这里）：`job()` 不能排在 `await` 之后。第四条用例的 `release` 是作业体自己被调用时才捕获到的那个 resolve——先 `await` 就等于让作业晚一个微任务起步，同一个同步段里拿到的还是初始那个空函数，`release()` 按下去谁也不醒，那条用例直接死等。串行性只由 `prev` 那一支负责，排队者照样等在前一环的 `done` 上，第一条用例的 `in:a / out:a / in:b / out:b` 就是它的证人。
- [ ] **Step 5：`shared/chatTypes.ts` 扩三种形状。**

```ts
export interface RecallRequest {
  accountId: number
  chatKey: string
  msgKey: string
  localId: string
}

export interface RecallReceipt {
  localId: string
  ok: boolean
  /** 只有页内返回体 isRevoked===true 才是 true（spec §6 的判定）。 */
  isRevoked?: boolean
  detail?: string
}
```

`BridgeCommand` 加一支、`BridgeReport` 加一支（同一文件）：

```ts
  | { kind: 'recall'; localId: string; chatKey: string; msgKey: string }
  | { kind: 'recall_result'; localId: string; ok: boolean; isRevoked?: boolean; detail?: string }
```

`SendReceipt` 之后另加 `RecallReceipt` 即可，**不改 `SendReceipt` 本身**（撤回结论与发送结论是两件事，混在一个类型里会让 `send_result` 的处理分支多一个永远为 undefined 的字段）。

- [ ] **Step 5b：`RecallRegistry` 先红**（`sendRegistry.test.ts` 末尾追加两条；这一步之后类还不存在，跑该文件应报 `does not provide an export named 'RecallRegistry'`）：

```ts
// 追加在 src/main/services/msgBridge/sendRegistry.test.ts 末尾，import 那行加上 RecallRegistry：
// import { RecallRegistry, SendAttribution, SendRegistry } from './sendRegistry.ts'
test('RecallRegistry：超时与重复登记都会结掉 invoke，迟到的 ok 不再改口', async () => {
  const reg = new RecallRegistry(5)
  const p = reg.add('R1', 'acc-x')
  assert.deepEqual(await p, { localId: 'R1', ok: false, detail: '>5ms' })
  assert.equal(reg.settle({ localId: 'R1', ok: true, isRevoked: true }), false)
  const first = reg.add('R2', 'acc-x')
  const second = reg.add('R2', 'acc-x')
  assert.deepEqual(await first, { localId: 'R2', ok: false, detail: 'duplicated localId' })
  reg.settle({ localId: 'R2', ok: true, isRevoked: true })
  assert.deepEqual(await second, { localId: 'R2', ok: true, isRevoked: true })
})

test('RecallRegistry：failView 只结该视图并带 detail，dispose 清空表与定时器', async () => {
  const reg = new RecallRegistry(1_000)
  const a = reg.add('R1', 'acc-x')
  const b = reg.add('R2', 'acc-y')
  assert.equal(reg.failView('acc-x', '视图已销毁'), 1)
  assert.deepEqual(await a, { localId: 'R1', ok: false, detail: '视图已销毁' })
  reg.settle({ localId: 'R2', ok: false, isRevoked: false, detail: 'isRevoked=false' })
  assert.equal((await b).isRevoked, false)
  const reg2 = new RecallRegistry(1_000)
  reg2.add('R3', 'acc-z')
  reg2.dispose()
  assert.equal(reg2.size, 0)
})
```

- [ ] **Step 6：`msgBridge/index.ts` 挂锁并加 `recallText`。** 在模块里建 `const sendLock = new SendLock()` 与 `const recallRegistry = new RecallRegistry()`，`sendText` 包进锁，`recallText` 同锁同 view：

```ts
export async function sendText(req: SendRequest): Promise<SendReceipt> {
  const localId = req.localId
  // 正文判定留在最前，那是既有 `sendText` 的报错次序：挪到 viewId 之后会让
  // 「账号没绑视图 + 正文又不合格」这一格从 SEND_FAILED 翻成 BRIDGE_OFFLINE，白改一次语义。
  if (!isSendable(req)) return { localId, ok: false, error: 'SEND_FAILED', detail: '正文为空或超长' }
  const entry = accountOfId(req.accountId)
  const viewId = entry?.viewId
  // 锁挂在 viewId 上：没有 viewId 就没有"哪条链"，直接按离线返回，不进锁也不排队。
  if (!viewId) return { localId, ok: false, error: 'BRIDGE_OFFLINE', detail: '账号没有绑定视图' }
  return sendLock.run(viewId, () => sendTextUnlocked(req, viewId))
}

async function sendTextUnlocked(req: SendRequest, viewId: string): Promise<SendReceipt> {
  const localId = req.localId
  const mount = bridgeOf(viewId)
  if (!mount || !mount.ready) return { localId, ok: false, error: 'BRIDGE_OFFLINE', detail: '会话未在线' }
  const wait = registry.add(localId, viewId)
  attribution.claim(viewId, localId, req.chatKey, req.text)
  mount.push({ kind: 'send', localId, chatKey: req.chatKey, text: req.text })
  return wait.then((receipt) => {
    if (!receipt.ok) attribution.abandon(localId)
    return receipt
  })
}

/** 撤回：localId 由引擎生成，回执走 `recallRegistry` 那张同形但另立的 Promise 表。 */
export async function recallText(req: RecallRequest): Promise<RecallReceipt> {
  const entry = accountOfId(req.accountId)
  const viewId = entry?.viewId
  if (!viewId) return { localId: req.localId, ok: false, detail: '账号没有绑定视图' }
  return sendLock.run(viewId, async () => {
    const mount = bridgeOf(viewId)
    if (!mount || !mount.ready) return { localId: req.localId, ok: false, detail: '会话未在线' }
    const wait = recallRegistry.add(req.localId, viewId)
    mount.push({ kind: 'recall', localId: req.localId, chatKey: req.chatKey, msgKey: req.msgKey })
    return wait
  })
}
```

`recallRegistry` **不复用 `SendRegistry` 的实例，而是在 `sendRegistry.ts` 里另起一个 `RecallRegistry` 类**（类放在那个文件而不是 `index.ts`：`index.ts` import electron、进不了 `tsconfig.unit.json`，写在它里面的表就永远没有单测）。裁定理由：`SendRegistry` 的超时分支要自己造一条失败回执（`{ localId, ok: false, error: 'TIMEOUT', detail }`），把它泛型化就得允许 `T` 携带 `error: SendError`——那等于把 `SendReceipt` 的类型面放宽给一个永远用不到它的调用方，还会牵动 `sendRegistry.test.ts` 现有 6 条。两个 registry 是为了不动 `SendReceipt`；这两份表形状相近是有意的，别去抽第三个基类。

`sendRegistry.ts` 里紧接 `SendRegistry` 之后加（`RecallReceipt` 由文件顶部的 `chatTypes.ts` import 带进来）：

```ts
interface PendingRecall {
  viewId: string
  resolve: (receipt: RecallReceipt) => void
  timer: NodeJS.Timeout
}

/**
 * localId → 未决撤回。与 `SendRegistry` 分开写的唯一理由是回执类型：`RecallReceipt` 没有
 * `error: SendError` 那一格（撤回的结论是 `isRevoked`，失败原因只进 `detail`）。
 * 超时这一支照抄发送侧：页内不回话时 invoke 不能永远挂着。
 */
export class RecallRegistry {
  private readonly table = new Map<string, PendingRecall>()
  // 同 SendRegistry：`erasableSyntaxOnly` 不许参数属性，写成字段 + 赋值。
  private readonly timeoutMs: number

  constructor(timeoutMs = 20_000) {
    this.timeoutMs = timeoutMs
  }

  get size(): number {
    return this.table.size
  }

  add(localId: string, viewId: string): Promise<RecallReceipt> {
    this.settle({ localId, ok: false, detail: 'duplicated localId' })
    return new Promise<RecallReceipt>((resolve) => {
      const timer = setTimeout(() => {
        this.settle({ localId, ok: false, detail: `>${this.timeoutMs}ms` })
      }, this.timeoutMs)
      this.table.set(localId, { viewId, resolve, timer })
    })
  }

  /** @returns 命中未决表才 true；迟到或不属于本表的回执由调用方自己处置。 */
  settle(receipt: RecallReceipt): boolean {
    const entry = this.table.get(receipt.localId)
    if (!entry) return false
    this.table.delete(receipt.localId)
    clearTimeout(entry.timer)
    entry.resolve(receipt)
    return true
  }

  /** 桥掉线 / 视图销毁：只结这个视图的未决撤回。 */
  failView(viewId: string, detail?: string): number {
    const ids = [...this.table.entries()].filter(([, p]) => p.viewId === viewId).map(([id]) => id)
    for (const id of ids) this.settle({ localId: id, ok: false, detail })
    return ids.length
  }

  dispose(): void {
    for (const entry of this.table.values()) clearTimeout(entry.timer)
    this.table.clear()
  }
}
```

三条出口都要接上，位置各不同（`registry.failView` / `attribution.dropView` 那段既有代码在 `broadcastState()` 的 `retry|offline|destroyed` 分支里，不在 `unmountView` 里——`unmountView` 是先 `mount.dispose()`、由它翻到 `destroyed` 再经 `broadcastState` 结清的）：

```ts
// ① broadcastState 的那条掉线分支，紧跟在 attribution.dropView(s.viewId) 之后：
      // 撤回与发送共用这一条掉线出口：桥没了，在途那条 invoke 必须当场拿到 ok:false，
      // 不能干等自己的 20s 超时（这里的 detail 会原样进后端的 recall_failed）。
      const m = recallRegistry.failView(s.viewId, s.detail ?? '桥未在线')
      // 页内那条 deleteMessage 可能其实成功了，只是回执赶不上这张表——这条日志是唯一能看到那一格的痕迹。
      if (m > 0) console.log(`[msgBridge] 结清未决撤回 ${m} 条 view=${s.viewId}`)

// ② unmountView 里，放在 activeChat.delete(viewId) 之后、`if (!mount) return` 之前：
  // 锁只在真销毁时摘，且不放进 ① 的那条分支——retry/offline 是掉线不是销毁：排队中的 job
  // 已经抓住了自己的 gate，摘掉 tails 会让下一条与它并发上飞，把归属认领的"同视图同会话同文本
  // FIFO"判据摊开。放在早退之前：一条从没挂上桥的 viewId 也不该留下尾链。
  sendLock.dropView(viewId)

// ③ stopMsgBridge 里，紧跟 registry.dispose() 之后：
  // 撤回表的超时定时器同样没 unref：不 dispose 就是退出路上最多 20s 的挂起。
  recallRegistry.dispose()
```

- [ ] **Step 7：`handleBridgeReport` 接 `recall_result`。** 在 `send_result` 那一段之后加：

```ts
  if (report.kind === 'recall_result') {
    // 这一帧的字段与 RecallReceipt 逐字一致（Step 5 就是这么定义的），不需要转手。
    // false 意味着表里已经没有这一格：要么 20s 超时先判了，要么掉线那一刻被 failView 结掉了。
    // 撤回这一侧没有 attribution 那样的第二证人，"答晚了"与"没答"只差这一行日志，不能不放。
    if (!recallRegistry.settle(report)) {
      console.log(`[msgBridge] 撤回回执无人认领（迟到或已结）localId=${report.localId}`)
    }
    return
  }
```

- [ ] **Step 8：跑 unit + typecheck + lint，并用读码复核一次单发链路。** unit 期望 `pass` **239**（231 + 本任务 8）、`fail 0`；`pnpm run typecheck` 四路 0 error；`pnpm exec eslint <改动文件> --quiet` 0 error。**这一步不许真发、也不许真撤回**：`sendText`/`recallText` 一旦通过 CDP 或回复框敲下去就是一条不可回收的外部动作（全站口径，Task 16 才有用户在场放行那一格）。这里的判据改成读码三条，逐条写进报告：① `sendText` 的返回值形状与错误次序未变（`SEND_FAILED` 仍在 `BRIDGE_OFFLINE` 之前）；② 同一 viewId 的两条 job 在锁上严格串行（Step 1 的第一条测试就是它的证人）；③ `recall_result` 只结 `recallRegistry`、`send_result` 只结 `registry`，两张表互不串门。真发那一格在验收文档里标 **待验证**，交给 Task 16。
- [ ] **Step 9：提交。** `feat(P7/群发): per-view 发送锁挂进 sendText，撤回走同一把锁`

---

## Task 10: 页内撤回命令链（`bridge/whatsapp/recall.ts`）

**Files:**
- Create: `apps/desktop/src/bridge/whatsapp/recall.ts`
- Create: `apps/desktop/src/bridge/whatsapp/recall.test.ts`
- Modify: `apps/desktop/src/bridge/types.ts`（`WppChatApi` 加 `deleteMessage`，并在**这一处唯一声明**返回类型 `WaDeleteResult`）
- Modify: `apps/desktop/src/bridge/index.ts`（switch 加 `case 'recall'`）
- Modify: `apps/desktop/src/bridge/index.test.ts`（加 1 条 recall 派发证人，见 Step 5b）

**Interfaces:**
- Consumes: Task 9 的 `BridgeCommand.recall` / `BridgeReport.recall_result`（两个形状都在 `shared/chatTypes.ts`，本任务**不再改**那个文件）。
- Produces:
  - `interface RecallChat { deleteMessage(chatId: string, ids: string, deleteMediaInDevice?: boolean, revoke?: boolean): Promise<DeleteResult> }`
  - `recallViaWa(cmd: RecallCmd, chat: RecallChat | undefined): Promise<RecallReceipt>`
  - `type DeleteResult = WaDeleteResult`（**本任务自带 5 条** `node --test` 用例：`recall.test.ts` 4 条 + `index.test.ts` 1 条；unit 期望 `pass` 从 **239 → 244**）

- [ ] **Step 1：失败的测试**（`src/bridge/**` 已在 unit glob 与 include 里）：

```ts
// src/bridge/whatsapp/recall.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { recallViaWa } from './recall.ts'
import type { RecallCmd } from './recall.ts'

const cmd: RecallCmd = { kind: 'recall', localId: 'R1', chatKey: '8613800000000@c.us', msgKey: 'true_8613800000000@c.us_ABC_out' }

test('第四位必须是 revoke=true，且入参剥掉 _out 尾', async () => {
  const seen: unknown[][] = []
  const r = await recallViaWa(cmd, {
    deleteMessage: async (...args: unknown[]) => { seen.push(args); return { isRevoked: true } }
  })
  assert.deepEqual(seen[0], ['8613800000000@c.us', 'true_8613800000000@c.us_ABC', false, true])
  assert.deepEqual(r, { localId: 'R1', ok: true, isRevoked: true })
})

test('isRevoked 不为 true 就是失败：删除自己这边不算"对所有人撤回"', async () => {
  const r = await recallViaWa(cmd, { deleteMessage: async () => ({ isDeleted: true }) })
  assert.equal(r.ok, false)
  assert.equal(r.isRevoked, false)
  assert.match(r.detail ?? '', /isRevoked/)
})

test('没有 chat 对象 → BRIDGE_OFFLINE 形状（detail 说明是哪个能力不在）', async () => {
  const r = await recallViaWa(cmd, undefined)
  assert.equal(r.ok, false)
  assert.match(r.detail ?? '', /deleteMessage/)
})

test('页内抛错折成 detail 原文，不抛出到主进程', async () => {
  const r = await recallViaWa(cmd, {
    deleteMessage: async () => { throw new Error('message no longer than 21915 seconds') }
  })
  assert.equal(r.ok, false)
  assert.match(r.detail ?? '', /21915/)
})
```

- [ ] **Step 2：跑 → 失败。Step 3：写 `recall.ts`：**

```ts
// src/bridge/whatsapp/recall.ts
import type { BridgeCommand, RecallReceipt } from '../../shared/chatTypes.ts'
import type { WaDeleteResult } from '../types.ts'

export type RecallCmd = Extract<BridgeCommand, { kind: 'recall' }>

/** 返回类型只在 `bridge/types.ts` 声明一次（R32）；这里换个名字给本文件用，不再抄一遍字段。 */
export type DeleteResult = WaDeleteResult

export interface RecallChat {
  deleteMessage(chatId: string, ids: string, deleteMediaInDevice?: boolean, revoke?: boolean): Promise<DeleteResult>
}

/**
 * 剥 `_out` 只发生在**入参**这一步：`msgKey` 列存的仍是回执原样（与 whatsapp/send.ts 的
 * "key 原样用"配套——原样那串要和事件流那条逐字相等，而去尾这串才是 deleteMessage 认的）。
 * 同一个尾在 `shared/msgIds.ts` 里也有一份常量，但那边的操作是"取末段裸 id"，与这里的
 * "整串去尾"不是同一件事，所以不复用那个函数（R33）。
 */
export const bareMsgKey = (msgKey: string): string => msgKey.replace(/_out$/, '')

export async function recallViaWa(cmd: RecallCmd, chat: RecallChat | undefined): Promise<RecallReceipt> {
  if (!chat) return { localId: cmd.localId, ok: false, detail: 'WPP.chat.deleteMessage 不可用' }
  try {
    const result = await chat.deleteMessage(cmd.chatKey, bareMsgKey(cmd.msgKey), false, true)
    // 只有 isRevoked 才是"对所有人撤回"成功；isDeleted 只说明本机那条没了。
    if (result?.isRevoked !== true) {
      return {
        localId: cmd.localId,
        ok: false,
        isRevoked: false,
        detail: `isRevoked=${String(result?.isRevoked)} isDeleted=${String(result?.isDeleted)}`
      }
    }
    return { localId: cmd.localId, ok: true, isRevoked: true }
  } catch (e) {
    return { localId: cmd.localId, ok: false, isRevoked: false, detail: e instanceof Error ? e.message : String(e) }
  }
}
```

- [ ] **Step 4：`bridge/types.ts` 的 `WppChatApi` 加一行，并把返回类型声明在**这个文件**（`ids` 按 wa-js 文档收 string 或 string[]，这里只传一条裸 key）：

```ts
export interface WaDeleteResult {
  id?: string
  sendMsgResult?: unknown
  isRevoked?: boolean
  isDeleted?: boolean
  isSentByMe?: boolean
}

  deleteMessage(chatId: string, ids: string, deleteMediaInDevice?: boolean, revoke?: boolean): Promise<WaDeleteResult>
```

（依赖方向照 `whatsapp/send.ts` 走：叶子模块从 `../types.ts` 取共享形状，`types.ts` 不 import 实现目录。所以 `WaDeleteResult` 只在这里声明一次，`recall.ts` 用 `export type DeleteResult = WaDeleteResult` 起别名——两个名字一套字段，`wppChat()` 的返回值可直接喂进 `RecallChat`。若在 `recall.ts` 里另抄一份同形接口，评审会按重复代码记账，R32。）

- [ ] **Step 5：`bridge/index.ts` 的 switch 加一支**：

```ts
      case 'recall':
        // 与 send 同样不 await：命令回路是同步的。
        void recallViaWa(cmd, wppChat()).then((receipt) => {
          push({ kind: 'recall_result', ...receipt })
        })
        return
```

并在文件顶部 `import { recallViaWa } from './whatsapp/recall.ts'`。`wppChat()` 返回的是 `WppChatApi`，`deleteMessage` 已在 Step 4 进接口，所以类型直接对得上。

- [ ] **Step 5b：`bridge/index.test.ts` 加一条派发证人**（R34：Step 5 那一支如果不接住命令，`recall.test.ts` 四条全绿也照样发现不了——撤回会永远走 default 之外的"没人管"，主进程那 20 s 超时是它唯一的响）。照 `gatedSend()`/那条 send 证人的形状加，放在 send 证人之后：

```ts
/** 带 `deleteMessage` 的假 WPP，回执卡在 await 里：证明 recall 支与 send 支同样不排命令回路。 */
function gatedRecall(): { wpp: unknown; calls: unknown[][]; release: () => void } {
  let release: () => void = () => undefined
  const gate = new Promise<void>((r) => {
    release = r
  })
  const calls: unknown[][] = []
  return {
    release,
    calls,
    wpp: {
      chat: {
        list: async () => [],
        getMessages: async () => [],
        getActiveChat: () => null,
        deleteMessage: async (...args: unknown[]) => {
          calls.push(args)
          await gate
          return { isRevoked: true }
        }
      },
      on: () => ({ off: () => undefined })
    }
  }
}

test('recall 命令交给 recallViaWa：回执异步单独一帧，命令回路不被它排住', async (t) => {
  const { wpp, calls, release } = gatedRecall()
  const host = fakeHost(wpp)
  t.after(() => {
    destroy()
    delete (globalThis as unknown as { window?: unknown }).window
  })
  install(CONFIG)
  host.out.length = 0 // 只留命令阶段的帧
  host.deliver({ kind: 'recall', localId: 'R1', chatKey: '861380001001@c.us', msgKey: 'true_861380001001@c.us_K-1_out' })
  host.deliver({ kind: 'ping' })
  // 区分性证据：case 'recall' 若漏加，下面两条一条也过不了（ping 会是唯一一帧，calls 为空）；
  // 若改成 await 再 return，pong 就排不到 recall_result 前面。
  assert.equal(host.out[0]?.kind, 'pong')
  assert.equal(host.out.some((f) => f.kind === 'recall_result'), false)
  release()
  await idle(0)
  assert.deepEqual(calls[0], ['861380001001@c.us', 'true_861380001001@c.us_K-1', false, true])
  assert.deepEqual(host.out.find((f) => f.kind === 'recall_result'), {
    kind: 'recall_result',
    localId: 'R1',
    ok: true,
    isRevoked: true
  })
})
```

`fakeHost` / `idle` / `CONFIG` / `destroy` 都是该文件已有的助手，不新加工具函数。

- [ ] **Step 6：跑 `pnpm run test:unit` + `pnpm run typecheck`，并重建 bridge bundle**：`pnpm run build:bridge`（若该脚本名不同，读 `package.json` 的 `build:bridge`），确认编译过、产物里含 `deleteMessage` 调用。unit 期望 `pass` **244**、`fail 0`。
- [ ] **Step 7：提交。** `feat(P7/群发): 页内撤回命令——revoke=true 与入参剥尾`

---

## Task 11: `engine.ts`——每账号一条串行泵

**Files:**
- Create: `apps/desktop/src/main/services/batchSend/engine.ts`
- Create: `apps/desktop/src/main/services/batchSend/engine.test.ts`
- Modify: `apps/desktop/package.json:15`（**不改**：那条 `src/main/services/batchSend/**/*.test.ts` glob 已由 Task 8 加过，这里确认在位即可）
- Modify: `apps/desktop/tsconfig.unit.json`（**只追加这两行**：`src/main/services/batchSend/engine.ts`、`src/main/services/batchSend/engine.test.ts`。`batchApi.ts` 与 `batchApi.test.ts` 已由 Task 8 登记在该文件 line 11–12，重复登记是空转；`host.ts` 因为 import electron 永远不进这份 include）

**Interfaces:**
- Consumes: Task 7 全部纯函数；Task 8 的 `BatchApi`/`ReportItem`/`RecallTarget` 形状。Task 9 的 `sendText` 只以注入的 `Dispatch` 出现，引擎不 import 它。
- Produces（Task 12 按这些名字用）:
  - `interface SendOutcome { ok: boolean; msgKey?: string; error?: string; detail?: string }`
  - `type Dispatch = (d: BatchDetail, viewId: string, localId: string) => Promise<SendOutcome>`
  - `type RecallDispatch = (t: RecallTarget) => Promise<{ ok: boolean; isRevoked?: boolean; detail?: string }>`（声明在此，**编排在 Task 12 的 host**——撤回是一次性短扇出，没有队列/节律/熔断。没有 `viewId` 参数：`recallText` 与 `sendText` 同用 `accountOfId` 那一本目录，账号 → 视图的解析只有一份）
  - `interface EngineDeps { api: BatchApi; dispatch: Dispatch; viewIdOf(accountId: number): string | null; sleep(ms: number): Promise<void>; rand(): number; now(): number; log(where: string, e: unknown): void }`
  - `class BatchEngine`：`constructor(deps: EngineDeps)`、`start(task: BatchTask, details: BatchDetail[]): Promise<void>`、`flushBacklog(): Promise<void>`、`stop(): void`

- [ ] **Step 1：失败的测试**（假 clock + 假随机源，全程不碰页面）：

```ts
// src/main/services/batchSend/engine.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BatchEngine } from './engine.ts'
import type { BatchApi, ReportItem } from './batchApi.ts'
import type { BatchDetail, BatchTask } from '../../../shared/batchSend.ts'
import type { EngineDeps, SendOutcome } from './engine.ts'

const task = (over: Partial<BatchTask> = {}): BatchTask => ({
  id: 1, name: 't', platform: 'whatsapp', dryRun: true, status: 'running',
  accountIds: [1, 2], contents: ['a', 'b'],
  msgIntervalMin: 0, msgIntervalMax: 0, chatIntervalMin: 0, chatIntervalMax: 0,
  totalCount: 0, sentCount: 0, failCount: 0, ...over
})
const row = (id: number, seq: number, accountId: number, chatKey: string, contentIndex = 0): BatchDetail => ({
  id, taskId: 1, seq, accountId, chatKey, contentIndex, body: 'x', sendStatus: 'pending', recallStatus: 'none'
})

/**
 * 记账用的假 api：记录每一跳上报。`reports` **必须回一份非空 `BatchProgress`**——
 * 引擎那一侧的判据是 `send()` 里的 `(await api.reports(...)) !== null`，`null` 在它眼里就是
 * "后端没收下，整批进积压"。回 `null` 的用例照样能看 `calls` 变长，于是"报出去了"这件事
 * 一次都没发生过而没人报警（本计划第一版草稿就写成 `return null`，三处已改）。
 */
// 返回类型不写在这里：`api` 只以 `as unknown as BatchApi` 进 EngineDeps，显式标一遍会把
// 12 跳的桩形状钉死、用例里 `api.reports = ...` 那处覆盖反而套不进去。与本目录 batchApi.ts
// 同一规则（@typescript-eslint/explicit-function-return-type）的仓库惯例处理。
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function fakeApi() {
  const calls: { items: ReportItem[]; allHalted: boolean }[] = []
  const api = {
    start: async () => null,
    pause: async () => null,
    resume: async () => null,
    cancel: async () => null,
    task: async () => null,
    details: async () => null,
    heartbeat: async () => 1,
    retryFailed: async () => 0,
    recall: async () => ({ eligible: [], rejected: [] }),
    recallReports: async () => 0,
    reconcile: async () => null,
    reports: async (_taskId: number, items: ReportItem[], allHalted: boolean) => {
      calls.push({ items, allHalted })
      // 非空 = 这一跳被后端收下了：积压只在收不下时才涨（见上面那段注释）。
      return { sentCount: items.length, failCount: 0, totalCount: 20, status: 'running' }
    }
  }
  return { calls, api }
}

/** 睡一步就计数，不真等：断言"跑了几条"与"取了几个间隔"。 */
function fakeDeps(api: ReturnType<typeof fakeApi>['api'], over: Partial<EngineDeps> = {}): EngineDeps {
  return {
    api: api as unknown as BatchApi,
    dispatch: async (): Promise<SendOutcome> => ({ ok: true, msgKey: `k${Math.random()}` }),
    viewIdOf: (accountId) => `view-${accountId}`,
    sleep: async () => {},
    rand: () => 0.5,
    // 固定时钟：success 那一跳的 sentAtEpochSec = 1_700_000_000（测试不靠墙上时间）。
    now: () => 1_700_000_000_000,
    log: () => {},
    ...over
  }
}
```

测试主体（8 条）：

```ts
test('账号并行、账号内串行：每条明细都被投料一次', async () => {
  const { calls, api } = fakeApi()
  const seen: number[] = []
  const engine = new BatchEngine(fakeDeps(api, {
    dispatch: async (d) => { seen.push(d.id); return { ok: true, msgKey: `k${d.id}` } }
  }))
  await engine.start(task({ accountIds: [1, 2] }), [row(1, 1, 1, 'a'), row(2, 2, 1, 'a'), row(3, 1, 2, 'b')])
  assert.deepEqual(seen.slice().sort((x, y) => x - y), [1, 2, 3])
  const items = calls.flatMap((c) => c.items)
  assert.equal(items.length, 6, '每条先 sending 后终态，两跳')
  assert.ok(items.every((i) => typeof i.detailId === 'number'))
  // 上面那三句只看 `calls` 变没变长，而 `calls` 在 `reports` 返回什么之前就先 push 了。
  // 少了下面这两句，把 `fakeApi` 的 `reports` 改回 `return null` 时八条用例照样全绿——
  // 引擎会以为"后端没收下"，把每一跳都塞进积压，于是"报出去了"这个事实一次都没被证过。
  // 判据落在积压侧：正常路径一条都不该积压，所以 flushBacklog 之后重报数必须是 0。
  const replayed: ReportItem[] = []
  api.reports = async (_t: number, batch: ReportItem[]) => {
    replayed.push(...batch)
    return { sentCount: batch.length, failCount: 0, totalCount: 20, status: 'running' }
  }
  await engine.flushBacklog()
  assert.equal(replayed.length, 0, '正常路径不该有任何上报落到积压里等重报')
})

test('同账号串行：一条在飞时不会有第二条从同一账号出去', async () => {
  const { api } = fakeApi()
  let inFlight = 0
  let maxInFlight = 0
  const engine = new BatchEngine(fakeDeps(api, {
    dispatch: async (d) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 0))
      inFlight -= 1
      return { ok: true, msgKey: `k${d.id}` }
    },
    viewIdOf: (a) => `view-${a}`
  }))
  await engine.start(task({ accountIds: [1] }), [row(1, 1, 1, 'a'), row(2, 2, 1, 'a', 1)])
  assert.equal(maxInFlight, 1, '同账号并发 = 撞锁')
})

test('间隔取的是随机值且落在区间内：同人相邻两条走 msg，换人走 chat', async () => {
  const { api } = fakeApi()
  const gaps: number[] = []
  const engine = new BatchEngine(fakeDeps(api, {
    sleep: async (ms) => { gaps.push(ms) },
    rand: () => 0
  }))
  await engine.start(task({ accountIds: [1], msgIntervalMin: 3, msgIntervalMax: 8, chatIntervalMin: 5, chatIntervalMax: 15 }),
    [row(1, 1, 1, 'a'), row(2, 2, 1, 'a', 1), row(3, 3, 1, 'b')])
  // 三条明细之间有 2 个 gap：a→a 是 msg(3s)，a→b 是 chat(5s)；最后一条之后不再等。
  assert.deepEqual(gaps, [3000, 5000])
})

test('连续 3 条失败熔断该账号：只停它，别的账号继续跑完', async () => {
  const { calls, api } = fakeApi()
  const hit: number[] = []
  const engine = new BatchEngine(fakeDeps(api, {
    dispatch: async (d) => {
      hit.push(d.id)
      // 账号 1 的前三条全失败（熔断线 = 3，所以第三条投完料才判熔断），第四条起被跳过；账号 2 成功。
      return d.accountId === 1 ? { ok: false, error: 'SEND_FAILED', detail: 'x' } : { ok: true, msgKey: 'k' }
    }
  }))
  await engine.start(task({ accountIds: [1, 2] }), [
    row(1, 1, 1, 'a'), row(2, 2, 1, 'a', 1), row(3, 3, 1, 'b'), row(5, 4, 1, 'a'), row(4, 1, 2, 'c')
  ])
  const last = calls.at(-1)
  assert.ok(!hit.includes(5), '账号 1 熔断后剩余条目不该再投料')
  // 两条泵并发，跨账号的先后不确定，所以只断言"投过哪四条"这个集合。
  assert.deepEqual(hit.slice().sort((x, y) => x - y), [1, 2, 3, 4], '熔断线之前的三条 + 另一账号一条')
  const skipped = calls.flatMap((c) => c.items).filter((i) => i.sendStatus === 'skipped')
  assert.deepEqual(skipped.map((i) => i.detailId), [5])
  assert.equal(skipped[0].errorCode, 'ACCOUNT_HALT')
  // success 那一跳来自账号 2 的泵；`calls.at(-1)` 是 settle 那批——它按设计 items 恒为 []
  // （见 engine.ts 里"收尾那一跳只带结论"那条注释），所以"报没报成 success"只能在全部 items 里找，
  // 而 allHalted 只在 settle 那一批才有真值，两句各看各的，不能都挂在 last 上。
  assert.ok(calls.flatMap((c) => c.items).some((i) => i.detailId === 4 && i.sendStatus === 'success'),
    '账号 2 那一条要带着 success 报出去')
  assert.ok(last?.allHalted === false, '还有一个账号跑完了，不是全停')
})

test('全部账号熔断 → 收尾那一跳 allHalted=true（后端据此把 running 打成 error）', async () => {
  const { calls, api } = fakeApi()
  const engine = new BatchEngine(fakeDeps(api, { dispatch: async () => ({ ok: false, error: 'BRIDGE_OFFLINE' }) }))
  // 三条都失败才够熔断线：单条失败只算一次失败，不该判成全停。
  await engine.start(task({ accountIds: [1] }), [row(1, 1, 1, 'a'), row(2, 2, 1, 'a', 1), row(3, 3, 1, 'b')])
  assert.equal(calls.at(-1)?.allHalted, true)
  // 熔断正好落在最后一行，剩余条目是零：那一跳不该发。空 items 是 `settle` 的专用形状
  // （只带结论、不带明细），多一条就让人分不清"这是收尾结论"还是"给零条报 skipped"。
  assert.equal(calls.filter((c) => c.items.length === 0).length, 1, '空 items 的跳只允许收尾那一条')
})

test('TIMEOUT 落 unknown 而不是 failed（重发不可回收，这一行只能人判）', async () => {
  const { calls, api } = fakeApi()
  const engine = new BatchEngine(fakeDeps(api, { dispatch: async () => ({ ok: false, error: 'TIMEOUT' }) }))
  await engine.start(task({ accountIds: [1] }), [row(1, 1, 1, 'a')])
  const finals = calls.flatMap((c) => c.items).filter((i) => i.sendStatus !== 'sending')
  assert.deepEqual(finals.map((i) => i.sendStatus), ['unknown'])
})

test('后端不可达时进积压，恢复后按序重报，不丢结论也不重复投料', async () => {
  const sent: ReportItem[] = []
  let down = true
  const { api } = fakeApi()
  api.reports = async (_t: number, items: ReportItem[]) => {
    if (down) throw new Error('ECONNREFUSED')
    sent.push(...items)
    // 这里也必须回非空：`flushBacklog()` 是按 `send()` 的返回值决定"倒得动倒不动"的，
    // 回 null 的话它倒完第一条就把整段原序塞回去，下面那句 `sent.length >= 2` 永远不成立。
    return { sentCount: items.length, failCount: 0, totalCount: 20, status: 'running' }
  }
  const engine = new BatchEngine(fakeDeps(api))
  await engine.start(task({ accountIds: [1] }), [row(1, 1, 1, 'a')])
  assert.equal(sent.length, 0, '后端在地下没有任何一跳成功')
  down = false
  await engine.flushBacklog()
  assert.ok(sent.length >= 2, '积压的 sending + 终态两跳都被重报')
})

test('stop() 之后队列不再投料，剩余 pending 一条都不发', async () => {
  const { calls, api } = fakeApi()
  let n = 0
  const engine = new BatchEngine(fakeDeps(api, {
    dispatch: async () => { n += 1; await new Promise((r) => setTimeout(r, 5)); return { ok: true, msgKey: 'k' } }
  }))
  const running = engine.start(task({ accountIds: [1] }), [row(1, 1, 1, 'a'), row(2, 2, 1, 'a', 1)])
  await new Promise((r) => setTimeout(r, 1))
  engine.stop()
  await running
  assert.ok(n <= 1, `stop 之后还在投料：n=${n}`)
  // 标题里"一条都不发"靠这句才成立：引擎不许替没跑的条目写 skipped。
  // 这不是抠字眼——`skipped` 是没有回程的终态（retryFailed 只复位 failed、buildQueues 不再捡它），
  // 暂停要是把剩余条目报成 skipped，resume 就只剩空队列，任务会被判成"发完了"。
  const skipped = calls.flatMap((c) => c.items).filter((i) => i.sendStatus === 'skipped')
  assert.deepEqual(skipped.map((i) => i.detailId), [], '暂停要留 pending 给 resume')
})
```

- [ ] **Step 2：跑 → `Cannot find module ./engine.ts`。**
- [ ] **Step 3：写 `engine.ts`。** 整份照抄（注释里的"为什么不裁决状态"要保留）：

```ts
// src/main/services/batchSend/engine.ts
import {
  FAIL_STREAK_LIMIT, ReportBacklog, buildQueues, gapKindFor, outcomeStatus, pickIntervalSec
} from '../../../shared/batchSend.ts'
import type { BatchApi, RecallTarget, ReportItem } from './batchApi.ts'
import type { BatchDetail, BatchTask, IntervalConfig } from '../../../shared/batchSend.ts'

/** 出料口的结果形状：真发是页内回执，演练是 host 造的假回执（两条都要给 msgKey）。 */
export interface SendOutcome {
  ok: boolean
  msgKey?: string
  error?: string
  detail?: string
}

/** localId 由引擎生成、随两跳上报一起走：页内回执要靠它与这一行对齐（Task 9 的归属登记）。 */
export type Dispatch = (d: BatchDetail, viewId: string, localId: string) => Promise<SendOutcome>

/**
 * 撤回出料口的形状声明在这里（与 Dispatch 同处，方便对照），但**编排在 host**（Task 12 Step 4）：
 * 撤回是一次性的短扇出，没有队列、没有节律、没有熔断，塞进引擎只会多一格没人用的依赖。
 */
export type RecallDispatch = (t: RecallTarget) =>
  Promise<{ ok: boolean; isRevoked?: boolean; detail?: string }>

export interface EngineDeps {
  api: BatchApi
  dispatch: Dispatch
  viewIdOf(accountId: number): string | null
  sleep(ms: number): Promise<void>
  rand(): number
  /** 注入时钟：测试给固定值，host 给 () => Date.now()。 */
  now(): number
  log(where: string, e: unknown): void
}

/** 积压单元：一整批上报 + 它当时的结论，重报时两样都不能改。 */
interface BacklogEntry {
  taskId: number
  items: ReportItem[]
  allHalted: boolean
}

/**
 * 执行环：只做三件事——排队、投料、如实上报。任何"能不能从 X 到 Y"的判断都在后端（BatchStatus），
 * 这里不裁决状态，所以引擎崩了也不会写出一个后端不认的状态。
 */
export class BatchEngine {
  // erasableSyntaxOnly 下不许写参数属性：deps 显式声明字段，构造器里赋值。
  private readonly deps: EngineDeps
  private stopped = false
  private seq = 0
  /** 熔断的是账号，不是任务：halted 记 accountId，收尾据此判"是不是全部账号都停了"。 */
  private readonly halted = new Set<number>()
  private readonly backlog = new ReportBacklog<BacklogEntry>()

  constructor(deps: EngineDeps) {
    this.deps = deps
  }

  async start(task: BatchTask, details: BatchDetail[]): Promise<void> {
    this.stopped = false
    const queues = buildQueues(details, task.accountIds)
    await Promise.all(queues.map((q) => this.pump(task, q)))
    await this.settle(task, queues)
  }

  /** host.ts 在下一次心跳前调用：把后端不可达期间攒下的上报按序倒出去。 */
  async flushBacklog(): Promise<void> {
    const pending = this.backlog.drain()
    for (let i = 0; i < pending.length; i++) {
      if (!(await this.send(pending[i].taskId, pending[i].items, pending[i].allHalted))) {
        // 倒不动就整段按原序塞回去：后端还没起来，继续试只会把新条目挤成"丢最旧"。
        for (const entry of pending.slice(i)) this.backlog.push(entry)
        return
      }
    }
  }

  /** 只停投料：剩余条目由下一轮的 host/后端决定去处，引擎不在这里替它们写结论。 */
  stop(): void {
    this.stopped = true
  }

  /** 一个账号一条串行泵：投料前后各上报一跳，连续 FAIL_STREAK_LIMIT 条失败就熔断这一个账号。 */
  private async pump(task: BatchTask, queue: BatchDetail[]): Promise<void> {
    if (!queue.length) return
    const accountId = queue[0].accountId
    const viewId = this.deps.viewIdOf(accountId)
    if (!viewId) {
      await this.report(task, queue.map((d) => ({
        detailId: d.id, sendStatus: 'skipped', errorCode: 'BRIDGE_OFFLINE', errorDetail: '账号没有绑定视图'
      })), false)
      this.halted.add(accountId)
      return
    }
    const cfg: IntervalConfig = {
      msgMin: task.msgIntervalMin, msgMax: task.msgIntervalMax,
      chatMin: task.chatIntervalMin, chatMax: task.chatIntervalMax
    }
    let prev: BatchDetail | null = null
    let streak = 0
    for (let i = 0; i < queue.length; i++) {
      const d = queue[i]
      if (this.stopped) {
        // 只退出投料，不替没跑的那些写结论。暂停走的就是这一格：剩余条目必须还是 `pending`，
        // resume 才拾得起来——`skipped` 是没有回程的终态（`retryFailed` 只复位 `failed`，
        // `buildQueues` 也不再捡它）。取消那一侧的 skipped 由后端 `skipAllPending` 一条 SQL 落，
        // 写的同样是 `TASK_HALT`，所以"谁停的"这条事实不会因为这里不报而丢掉。
        break
      }
      const localId = `b${task.id}-${d.id}-${(this.seq += 1)}`
      await this.report(task, [{ detailId: d.id, sendStatus: 'sending', localId }], false)
      // catch 的返回值要显式标成 SendOutcome：只写 `satisfies` 的话 TS 留的是那个窄字面量类型
      // （没有 msgKey 那一格），下面 `outcome.msgKey` 就在 union 上取不到属性、typecheck 直接红。
      const outcome = await this.deps.dispatch(d, viewId, localId).catch((e: unknown): SendOutcome => {
        this.deps.log('dispatch', e)
        return { ok: false, error: 'SEND_FAILED', detail: e instanceof Error ? e.message : String(e) }
      })
      const sendStatus = outcomeStatus(outcome)
      const item: ReportItem = { detailId: d.id, sendStatus, localId }
      if (sendStatus === 'success') {
        // 演练的 msgKey（dryrun:<detailId>）由出料口给（Task 12），引擎不造它：
        // 真发回执缺 msgKey 就如实留空——撤回那侧会点名"这一条没有 msg_key"，比编一个假键好查。
        if (outcome.msgKey) item.msgKey = outcome.msgKey
        item.sentAtEpochSec = Math.floor(this.deps.now() / 1000)
      } else {
        item.errorCode = outcome.error ?? 'SEND_FAILED'
        item.errorDetail = outcome.detail
      }
      await this.report(task, [item], false)
      streak = sendStatus === 'failed' ? streak + 1 : 0
      prev = d
      if (streak >= FAIL_STREAK_LIMIT) {
        const rest = queue.slice(i + 1)
        // 熔断正好落在最后一行时 rest 是空的：空 items 那一跳是 `settle` 的专用形状（只带结论），
        // 在这里也发一条会让人分不清"这是收尾结论"还是"给零条明细报 skipped"。
        if (rest.length) {
          await this.report(task, rest.map((r) => ({
            detailId: r.id, sendStatus: 'skipped', errorCode: 'ACCOUNT_HALT'
          })), false)
        }
        this.halted.add(accountId)
        return
      }
      const next = queue[i + 1]
      if (next) {
        await this.deps.sleep(pickIntervalSec(gapKindFor(prev, next), cfg, this.deps.rand) * 1000)
      }
    }
  }

  private async settle(task: BatchTask, queues: BatchDetail[][]): Promise<void> {
    const active = queues.filter((q) => q.length).length
    const allHalted = active > 0 && this.halted.size >= active
    // 收尾那一跳只带结论：items=[] 合法（BatchReportsDTO 的 items 不加 @NotEmpty），
    // 后端拿 allHalted 与 openCount 判 running→error / running→done（Task 5 Step 2）。
    await this.report(task, [], allHalted)
  }

  private async report(task: BatchTask, items: ReportItem[], allHalted: boolean): Promise<void> {
    if (!(await this.send(task.id, items, allHalted))) {
      this.backlog.push({ taskId: task.id, items, allHalted })
    }
  }

  /** 一跳上报的成与不成：batchApi 把"后端不可达"折成 null（Task 8），所以 null 就是没落地。 */
  private async send(taskId: number, items: ReportItem[], allHalted: boolean): Promise<boolean> {
    try {
      return (await this.deps.api.reports(taskId, items, allHalted)) !== null
    } catch (e) {
      this.deps.log('reports', e)
      return false
    }
  }
}
```

> 三处刻意的选择，实现时不要"顺手改回去"：
> ① **引擎只在"自己判出来的停"那一格报 `skipped`**——熔断报 `ACCOUNT_HALT`、桥离线（`pump` 里 `viewIdOf` 取不到 viewId）整队报 `BRIDGE_OFFLINE`，两条都是逐条 `sendStatus:'skipped'` + `errorCode`，谁停的、停了几条留在明细行上。**暂停不报**：`stop()` 只退出投料，剩余条目必须是 `pending`，`resume` 才拾得起来（`skipped` 是没有回程的终态——`retryFailed` 只复位 `failed`，`buildQueues` 也不再捡它）。**取消也不由引擎报**：那一份 `skipped` 是后端 `skipAllPending` 一条 SQL 落的（Task 5 Step 2，只在 `action=cancel` 分支里跑，写的同样是 `TASK_HALT`），本任务不碰。三个去处各有各自的作者，Task 16 的验收文档要按这个分工写。
> ② **`report` 失败进积压的是整批**（含 `allHalted`），不是逐条：拆开重报会把"这一批的结论"丢掉。
> ③ **`allHalted` 那一批天然是最后进积压的**（`settle` 在所有泵之后才跑），所以 `flushBacklog` 不需要为它单独排序。

- [ ] **Step 4：跑 8 条全绿。** `pnpm run test:unit 2>&1 | tail -8`。
- [ ] **Step 5：`package.json` 的 `test:unit` 里那条 `"src/main/services/batchSend/**/*.test.ts"` 由 Task 8 加过，这里只确认在位**；`tsconfig.unit.json` 的 `include` **只追加这两行**：`src/main/services/batchSend/engine.ts` 与 `src/main/services/batchSend/engine.test.ts`（`batchApi.ts` / `batchApi.test.ts` 是 Task 8 登记的，line 11–12 已在，别再列一次；`host.ts` 因为 import electron 永不加）。
- [ ] **Step 6：`pnpm run typecheck` 四路干净。**
- [ ] **Step 7：提交。** `feat(P7/群发): 执行环——账号并行、同人串行、3 连失败只熔断一个账号`

---

## Task 12: `host.ts` 装配 + `batch:*` IPC + `batch:state` 广播

**Files:**
- Create: `apps/desktop/src/main/services/batchSend/host.ts`
- Modify: `apps/desktop/src/main/index.ts`、`apps/desktop/src/preload/index.ts`（`main/ipc.ts` 一行都不改，理由见 Step 2）

**Interfaces:**
- Consumes: Task 8 的 `createBatchApi`；Task 11 的 `BatchEngine`；Task 9 的 `sendText`/`recallText`/`SendLock`；现有 `authedFetch`、`getSession`、`getMainWindow`。
- Produces:
  - `startBatchHost(): void` / `stopBatchHost(): Promise<void>` / `registerBatchIpc(): void`
  - IPC 通道：`batch:start`、`batch:pause`、`batch:resume`、`batch:cancel`、`batch:retry-failed`、`batch:recall`、`batch:run`（把待跑明细交给引擎）、`batch:state`（下行广播）
  - preload `scrm.batch`：七个 invoke（`start`/`pause`/`resume`/`cancel`/`run`/`retryFailed`/`recall`）+ `onState(cb)`

- [ ] **Step 1：`host.ts`——真身依赖都在这里，engine 里一格没有。**

```ts
// src/main/services/batchSend/host.ts
import { ipcMain } from 'electron'
import { getMainWindow } from '../../window/mainWindow'
import { authedFetch } from '../authedFetch'
import { accountOfId } from '../msgBridge/accountDirectory'
import { recallText, sendText } from '../msgBridge'
import { BatchEngine } from './engine'
import { createBatchApi } from './batchApi'
import type { RecallTarget } from './batchApi'
import type { Dispatch, RecallDispatch, SendOutcome } from './engine'
import type { BatchDetail, BatchStateEvent, BatchTask } from '../../../shared/batchSend'

/** 心跳周期：15 s（spec §5）。四拍打空才停泵，那条线就是下面 `HEARTBEAT_MISS_LIMIT` 的注释。 */
const HEARTBEAT_MS = 15_000
/**
 * 连着四拍（= 60 s）打不到后端才停泵。这个数就是后端自己的 `STALE_SECONDS`
 * （`BatchSendService.java:58`）——它认定这条泵已经死了的那一刻，泵才自己收。
 * 单拍为 0 就停是不行的：`heartbeat` 把「后端明确说这一行不在 running」和「这一跳根本没打到
 * 后端」（`batchApi` 折成同一个 0，spec:141 有意如此）混在一起，一次 15 s 的网络抖动就会
 * 把泵连同它的上报积压一起扔掉，而积压正是为后端不可达准备的。
 * 界面点暂停/取消那一侧不受这条影响：`batch:pause`/`batch:cancel` 的处理器直接 `stopEngine`。
 */
const HEARTBEAT_MISS_LIMIT = 4
/** 演练出料口的模拟耗时（spec §11.4：先取 200 ms，只影响观感）。 */
const DRY_RUN_MS = 200

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const api = createBatchApi({
  fetcher: (path, init) => authedFetch(path, init),
  onError: (where, e) => console.warn(`[batch] ${where}`, e)
})

/**
 * 一张「taskId → 泵」的表。`engine`/`timer` 可以为 null：那是 `runTask` 在开场之前先占下的格子
 * （见那里的注释），占位格没有任何在飞的东西，只回答"这个 taskId 已经有人在起了"。
 */
interface Pump {
  engine: BatchEngine | null
  timer: NodeJS.Timeout | null
  misses: number
  /** 上一拍心跳还在飞（见 `tick` 开头那句跳过）。 */
  beating: boolean
}
const running = new Map<number, Pump>()
```

`viewIdOf` 的落点已定：账号→视图的映射只有 `msgBridge/accountDirectory.ts` 一份（`accountOfId(accountId)?.viewId`，读码确认它在 `:60` 就是 `export`，`index.ts:350` 同源取用），**host 里不建第二份 map**：

```ts
/** 账号→视图的映射只有 accountDirectory 那一份，host 不建第二张表。 */
const viewIdOf = (accountId: number): string | null => accountOfId(accountId)?.viewId ?? null
```

出料口两套（演练那套完全不碰页面）：

```ts
/** 演练：不碰 `msgBridge`、不碰页面，只按时耗产一条 `dryrun:` 回执（spec §8）。 */
const dryDispatch: Dispatch = async (d: BatchDetail): Promise<SendOutcome> => {
  await sleep(DRY_RUN_MS)
  return { ok: true, msgKey: `dryrun:${d.id}` }
}

/** 真发：localId 用引擎给的那一个——回执要靠它与明细行对齐（Task 9 的归属登记）。 */
const realDispatch: Dispatch = async (d: BatchDetail, _viewId: string, localId: string): Promise<SendOutcome> => {
  const receipt = await sendText({ accountId: d.accountId, chatKey: d.chatKey, text: d.body, localId })
  return { ok: receipt.ok, msgKey: receipt.msgKey, error: receipt.error, detail: receipt.detail }
}

const recallDispatch: RecallDispatch = async (t: RecallTarget): Promise<{ ok: boolean; isRevoked?: boolean; detail?: string }> => {
  const r = await recallText({ accountId: t.accountId, chatKey: t.chatKey, msgKey: t.msgKey, localId: `r${t.detailId}` })
  return { ok: r.ok, isRevoked: r.isRevoked, detail: r.detail }
}
```

（`dispatchFor(task)` 不需要单独一个函数：`new BatchEngine({ ..., dispatch: task.dryRun ? dryDispatch : realDispatch })` 一处选完。）

跑一个任务（`batch:run` 的处理器，也是演练腿唯一要跑的东西）——逐字实现这份：

```ts
async function runTask(taskId: number): Promise<{ started: boolean }> {
  // 占位要在第一个 await 之前同步落表：`running.has` 与真正建泵之间隔着 `api.task` 和整段翻页
  // 拉取（20 000 条明细 = 100 跳 HTTP），那个窗口里第二次 runTask 会读到"没人在飞"，
  // 于是同一个 detailId 有两个投料者——群发最贵的一种事故就是同一条消息发出去两遍。
  // 占位格还有个附带用处：开场期间来的 pause/cancel 能在表里找到它并摘掉，下面两处复查据此止步。
  if (running.has(taskId)) return { started: true }
  running.set(taskId, { engine: null, timer: null, misses: 0, beating: false })
  const task = await api.task(taskId)
  // 引擎不裁决、也不发起迁移：谁把任务变成 running 是渲染层点「开始」那一次 batch:start 的事。
  if (!task || task.status !== 'running') {
    running.delete(taskId)
    return { started: false }
  }
  const details: BatchDetail[] = []
  for (let page = 1; ; page++) {
    const res = await api.details(taskId, page, 200)
    if (!res) break
    details.push(...res.records)
    if (details.length >= res.total || res.records.length === 0) break
  }
  if (!running.has(taskId)) return { started: false }
  const engine = new BatchEngine({
    api, dispatch: task.dryRun ? dryDispatch : realDispatch, viewIdOf,
    sleep, rand: Math.random, now: () => Date.now(),
    log: (where, e) => console.warn(`[batch] task=${taskId} ${where}`, e)
  })
  const timer = setInterval(() => void tick(taskId), HEARTBEAT_MS)
  timer.unref()
  // 从上面那句复查到这里落表是同一个同步段：中间不许插 await，否则"被 pause 摘掉的格子
  // 又被这里复活"就成了第三条能起两条泵的路；timer 也在这段里建，止步就不必撤它。
  running.set(taskId, { engine, timer, misses: 0, beating: false })
  void engine.start(task, details).then(() => finish(taskId), (e: unknown) => {
    console.error(`[batch] task=${taskId} 泵逃出来的异常`, e)
    finish(taskId)
  })
  return { started: true }
}

/** 心跳 + 顺带广播：15 s 一跳，比每跳都发一次吵得要轻，也比"只在收尾发"有用得多。 */
async function tick(taskId: number): Promise<void> {
  const entry = running.get(taskId)
  if (!entry?.engine) return
  // 一拍是可以跑过 15 s 的：flushBacklog 是逐条一跳，每跳的上限是 authedFetch 的 5 s 超时，
  // 积压几十条就足够让 setInterval 把第二条 tick 排进来。两条并发倒同一份积压会把同一批上报
  // 报两遍，倒不动的那段还各塞回一次——同一条结论在积压里就存了两份。上一拍没完就跳过这一拍：
  // 心跳少打一拍不会停泵（要看的是 MISS_LIMIT 那个连续数），也不会让积压变多。
  if (entry.beating) return
  entry.beating = true
  try {
    await entry.engine.flushBacklog()
    const updated = await api.heartbeat(taskId)
    if (updated === 0) {
      // 这一拍没打到/没命中：先记一笔，到 HEARTBEAT_MISS_LIMIT 才认死（两种 0 的分别见那条注释）。
      entry.misses += 1
      if (entry.misses >= HEARTBEAT_MISS_LIMIT) stopEngine(taskId)
      return
    }
    entry.misses = 0
    const task = await api.task(taskId)
    if (task) broadcastTask(task)
  } finally {
    entry.beating = false
  }
}

async function finish(taskId: number): Promise<void> {
  stopEngine(taskId)
  const task = await api.task(taskId)
  if (task) broadcastTask(task)
}

/** 进度只有这一处构造：`tick` 与 `finish` 两个发点读同一份 GET 回来的任务，不各拼一份字面量。 */
function broadcastTask(task: BatchTask): void {
  broadcastState({
    taskId: task.id, status: task.status,
    totalCount: task.totalCount, sentCount: task.sentCount, failCount: task.failCount
  })
}

function stopEngine(taskId: number): void {
  const entry = running.get(taskId)
  if (!entry) return
  // 顺序不能反：先撤 timer 再 stop 再从 map 摘，反了会有一个在途心跳在摘掉之后重新排一个 timer。
  // 两个 null 是给占位格留的：那一段泵还没起步，没什么可停，摘掉就是"这一趟开场作废"。
  if (entry.timer) clearInterval(entry.timer)
  entry.engine?.stop()
  running.delete(taskId)
}
```

> **不加 `deps.onProgress`。** 进度广播只有上面两处发点（`tick` 每 15 s、`finish` 收尾），渲染层在 running 期间另有 GET 轮询（Task 13 的 `useBatchTask`）。理由：引擎是纯执行环，给它一条 UI 广播依赖会让 Task 11 的八条单测都要多假装一个回调，而它不参与任何裁决——这条在 R6 的"依赖一律注入"里没有位置，因为它不是引擎干活要用的东西。

启动 reconcile 与退出：

```ts
export function startBatchHost(): void {
  // 应用一起来就先把上一次崩掉的现场结清：先 unknown 后 paused 的顺序在后端（R4）。
  void api.reconcile().then((r) => {
    if (r && (r.pausedTasks || r.markedUnknown)) console.log(`[batch] reconcile paused=${r.pausedTasks} unknown=${r.markedUnknown}`)
  })
  registerBatchIpc()
}

export async function stopBatchHost(): Promise<void> {
  for (const taskId of [...running.keys()]) stopEngine(taskId)
}
```

`batch:state` 广播（**这里必须有 `isDestroyed()` 守卫**，`ebab8e5` 那颗雷就是这么埋的）：

```ts
function broadcastState(payload: BatchStateEvent): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) win.webContents.send('batch:state', payload)
}
```

- [ ] **Step 1b：`batch:*` 的七条 handle（都在 host.ts 的 `registerBatchIpc()` 里，一处注册）。**

```ts
export function registerBatchIpc(): void {
  // start 之后顺手 run：渲染层一次 IPC 就能"开始跑"，不需要自己记得再调 run。
  ipcMain.handle('batch:start', async (_e, taskId: number) => {
    const task = await api.start(taskId)
    if (task?.status === 'running') await runTask(taskId)
    return task
  })
  ipcMain.handle('batch:pause', async (_e, taskId: number) => {
    const task = await api.pause(taskId)
    stopEngine(taskId)
    return task
  })
  ipcMain.handle('batch:resume', async (_e, taskId: number) => {
    const task = await api.resume(taskId)
    if (task?.status === 'running') await runTask(taskId)
    return task
  })
  ipcMain.handle('batch:cancel', async (_e, taskId: number) => {
    // 先停泵再打后端：反过来会让泵在 cancel 落地前多投几条。
    stopEngine(taskId)
    return api.cancel(taskId)
  })
  ipcMain.handle('batch:run', (_e, taskId: number) => runTask(taskId))
  // 重发：detailIds 省略＝整批，带＝单条（R11）。同一跳端点，两种粒度只差 body 里那个数组有没有。
  ipcMain.handle('batch:retry-failed', (_e, taskId: number, detailIds?: number[]) =>
    api.retryFailed(taskId, detailIds))
  // 撤回：清单在后端判（Task 5），这里只把 eligible 逐条交给页内出料口，结清走 recallReports。
  ipcMain.handle('batch:recall', async (_e, taskId: number, detailIds: number[]) => {
    const plan = await api.recall(taskId, detailIds)
    if (!plan) return { eligible: 0, blocked: 0 }
    for (const t of plan.eligible) {
      // 账号没有可用视图（掉线 / 未挂桥）也要结清：后端已经把这条推成 recalling，
      // 静默 continue 会让它永远卡在 recalling，界面上看不出"为什么没撤"。
      if (!viewIdOf(t.accountId)) {
        await api.recallReports(taskId, [{ detailId: t.detailId, recalled: false, detail: '账号当前没有可用视图' }])
        continue
      }
      // 一条一结清：撤回的成败只由 isRevoked 判（Task 10），后端据此把 recall_status 落成 recalled 或 recall_failed。
      const r = await recallDispatch(t)
      await api.recallReports(taskId, [{ detailId: t.detailId, recalled: r.ok && r.isRevoked === true, detail: r.detail }])
    }
    return { eligible: plan.eligible.length, blocked: plan.rejected.length }
  })
}
```

- [ ] **Step 2：`main/ipc.ts` 不碰 batch。** 七条 handle 已经在 Step 1b 的 `registerBatchIpc()` 里（由 `startBatchHost()` 调用）——**不要在 `ipc.ts` 再注册一遍**：`ipcMain.handle` 第二次同名会抛 `Attempted to register a second handler`，而那是在应用启动路径上抛的，表现为整个应用起不来。
- [ ] **Step 3：`main/index.ts` 接线。** `startBatchHost()` 放在 `startMsgBridge()` 之后（`:35` 那一行下面）；`stopBatchHost()` 放进 `before-quit` 那段清理链，写法与 `stopMsgBridge()` 一致用 `void`，**不要 `await`**：

```ts
  app.on('before-quit', () => {
    setQuitting(true)
    void stopMsgBridge()
    void stopBatchHost()   // 这里不 await：before-quit 不等监听器的返回值，而 stopBatchHost 体内没有异步等待点
    viewManager.destroyAll()
  })
```

  理由写下来免得下次又被"顺手改成 async"：`before-quit` 的回调返回的 Promise Electron 不会等，把监听器改成 `async` 再 `await` 只会让应用先退出、清理后落地，比 `void` 更差；而 `stopBatchHost()` 的函数体本来就是同步的（遍历 `running` 调 `stopEngine`，`stopEngine` 三段全同步：`clearInterval` → `engine.stop()` → `running.delete`），`Promise<void>` 只是给调用方的签名，不是"里面有东西要等"。**`stopEngine` 的 `clearInterval` 因此就是那条泵的终结**——退出时不需要等在途的 `send`，那一条的明细留在 `sending`，由后端 reconcile 判成 `unknown`（spec §5）。
- [ ] **Step 4：`preload/index.ts` 加 `scrm.batch`。** 形制照现有 `msg: {}` 那一块；shared 类型走 `@shared/*` 别名（读码：`preload/index.ts:11` 的 `import type { ... } from '@shared/badge'` 就是同一别名，renderer 与 preload 两条 tsconfig 都配了 paths，而 unit 那条没有——所以只有 `main/services/**` 的测试要用相对路径）。这里加 `import type { BatchProgress, BatchStateEvent } from '@shared/batchSend'`。`preload/index.d.ts` 不用改：它写的是 `scrm?: ScrmApi`，而 `ScrmApi = typeof scrm`，加进去的 `batch` 自己就流到 `window.scrm.batch` 的类型上。

```ts
  batch: {
    start: (taskId: number): Promise<BatchProgress | null> => ipcRenderer.invoke('batch:start', taskId),
    pause: (taskId: number): Promise<BatchProgress | null> => ipcRenderer.invoke('batch:pause', taskId),
    resume: (taskId: number): Promise<BatchProgress | null> => ipcRenderer.invoke('batch:resume', taskId),
    cancel: (taskId: number): Promise<BatchProgress | null> => ipcRenderer.invoke('batch:cancel', taskId),
    run: (taskId: number): Promise<{ started: boolean }> => ipcRenderer.invoke('batch:run', taskId),
    retryFailed: (taskId: number, detailIds?: number[]): Promise<number> =>
      ipcRenderer.invoke('batch:retry-failed', taskId, detailIds),
    recall: (taskId: number, detailIds: number[]): Promise<{ eligible: number; blocked: number }> =>
      ipcRenderer.invoke('batch:recall', taskId, detailIds),
    onState: (cb: (e: BatchStateEvent) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, e: BatchStateEvent): void => cb(e)
      ipcRenderer.on('batch:state', listener)
      return () => ipcRenderer.removeListener('batch:state', listener)
    }
  },
```

（七条的语义都在 Step 1b 那一段里：`start`/`resume` 迁移成功后顺手 `run`，`pause`/`cancel` 一定 `stopEngine`，`recall` 只把后端判过的 eligible 交页内。**渲染层不许自己拼"先 start 再 run"两次调用**。）

- [ ] **Step 5：跑 `pnpm run typecheck` 四路 + unit（`host.ts` 不在 unit include，typecheck 的 node 路覆盖它）。**
- [ ] **Step 6：提交。** `feat(P7/群发): 装配真身——心跳定时器、启动 reconcile、batch:state 带销毁守卫`

## Task 13: 渲染层数据层 + 导航一行 + 一条路由

**Files:**
- Create: `apps/desktop/src/renderer/src/api/batchSend.ts`
- Modify: `apps/desktop/src/renderer/src/lib/nav.ts`
- Modify: `apps/desktop/src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `http`（`lib/http.ts` 的 `http.get/post`）、`window.scrm.batch`（Task 12）、后端 VO 形状。
- Produces（Task 14/15 按这些名字用）:
  - `interface BatchTaskVO` / `interface BatchDetailVO` / `interface BatchCreateInput`（`PageResult<T>` 复用 `api/customers.ts` 里已有的那份，不另造）
  - `useBatchTasks(status?: string, page?: number, size?: number)`
  - `useBatchTask(id: number | null)`
  - `useBatchDetails(id, sendStatus?, recallStatus?, page?, size?)`
  - `useCreateBatchTask()` / `useBatchPreview()`
  - `useBatchAction(action: 'start'|'pause'|'resume'|'cancel')` / `useBatchRetry()` / `useBatchRecall()`
  - `useBatchLive()`

- [ ] **Step 1：写 `api/batchSend.ts`。** 形制照 `api/audiences.ts`（读码：`useQuery` + `queryKey` 常量 + `useMutation` + `onSuccess: invalidate`）。

```ts
import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/lib/http'
import type { PageResult } from './customers'
import type { BatchDetail, BatchTask } from '@shared/batchSend'   // 渲染层已有的 `@shared/*` 别名（读码：api/messages.ts:15-18 同形）

const BATCH_KEY = ['batch'] as const

export type BatchTaskVO = BatchTask
export type BatchDetailVO = BatchDetail

export interface BatchCreateInput {
  name: string
  platform: 'whatsapp'
  dryRun: boolean
  accountIds: number[]
  conversations: { accountId: number; chatKey: string }[]
  contents: string[]
  msgIntervalMin: number
  msgIntervalMax: number
  chatIntervalMin: number
  chatIntervalMax: number
}

export interface BatchCreateVO {
  taskId: number
  rejected: { chatKey: string; accountId: number; reason: string }[]
  totalCount: number
}

export function useBatchTasks(status?: string, page = 1, size = 20) {
  return useQuery({
    queryKey: [...BATCH_KEY, 'list', status ?? '', page, size],
    queryFn: () =>
      http.get<PageResult<BatchTaskVO>>(
        `/api/batch-send/tasks?page=${page}&size=${size}${status ? `&status=${status}` : ''}`
      )
  })
}

export function useBatchTask(taskId: number | null) {
  return useQuery({
    queryKey: [...BATCH_KEY, 'task', taskId],
    queryFn: () => http.get<BatchTaskVO>(`/api/batch-send/tasks/${taskId}`),
    enabled: taskId != null
  })
}

/** 明细的 seq 升序由后端保证（Task 4），这里不再排第二遍。 */
export function useBatchDetails(
  taskId: number | null, sendStatus?: string, recallStatus?: string, page = 1, size = 50
) {
  return useQuery({
    queryKey: [...BATCH_KEY, 'details', taskId, sendStatus ?? '', recallStatus ?? '', page, size],
    queryFn: () =>
      http.get<PageResult<BatchDetailVO>>(
        `/api/batch-send/tasks/${taskId}/details?page=${page}&size=${size}` +
          `${sendStatus ? `&sendStatus=${sendStatus}` : ''}${recallStatus ? `&recallStatus=${recallStatus}` : ''}`
      ),
    enabled: taskId != null
  })
}

export function useCreateBatchTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: BatchCreateInput) => http.post<BatchCreateVO>('/api/batch-send/tasks', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [...BATCH_KEY, 'list'] })
  })
}

export function useBatchPreview() {
  return useMutation({
    mutationFn: (input: { conversations: { accountId: number; chatKey: string }[]; contents: string[] }) =>
      http.post<{ rows: { chatKey: string; contentIndex: number; body: string }[]; truncated: boolean }>(
        '/api/batch-send/preview',
        input
      )
  })
}

/**
 * 状态迁移不直连 REST：群发的"开始"必须由主进程起泵，所以这一跳走 window.scrm.batch。
 * 四个动作返回同一种 BatchTaskVO，因此一个 hook 够用；retry-failed 返回的是 { reset }，
 * 形状不同，另立一个 useBatchRetry —— 一个 hook 两种返回会让调用方无从判定拿到的是哪个。
 */
export function useBatchAction(action: 'start' | 'pause' | 'resume' | 'cancel') {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (taskId: number) => window.scrm.batch[action](taskId),
    onSuccess: (_out, taskId) => void qc.invalidateQueries({ queryKey: [...BATCH_KEY, 'task', taskId] })
  })
}

/** 重发：detailIds 省略＝整批（表头那颗），带＝只这一行（行末那颗）。返回复位条数，新状态靠下面的 invalidate 重新 GET。 */
export function useBatchRetry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, detailIds }: { taskId: number; detailIds?: number[] }) =>
      window.scrm.batch.retryFailed(taskId, detailIds),
    onSuccess: (reset, { taskId }) => {
      void qc.invalidateQueries({ queryKey: [...BATCH_KEY, 'task', taskId] })
      void qc.invalidateQueries({ queryKey: [...BATCH_KEY, 'details', taskId] })
    }
  })
}

export function useBatchRecall() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, detailIds }: { taskId: number; detailIds: number[] }) =>
      window.scrm.batch.recall(taskId, detailIds),
    onSuccess: (_out, v) => void qc.invalidateQueries({ queryKey: [...BATCH_KEY, 'details', v.taskId] })
  })
}

/** 事件只是加速器：进页面一律 GET 兜底（spec §7），所以这里只顺手并一帧进缓存，不建第二个真值。 */
export function useBatchLive() {
  const qc = useQueryClient()
  useEffect(() => {
    return window.scrm.batch.onState((e) => {
      qc.setQueryData<BatchTaskVO>([...BATCH_KEY, 'task', e.taskId], (prev) =>
        prev ? { ...prev, status: e.status, sentCount: e.sentCount, failCount: e.failCount, totalCount: e.totalCount } : prev
      )
      void qc.invalidateQueries({ queryKey: [...BATCH_KEY, 'list'] })
    })
  }, [qc])
}
```

- [ ] **Step 2：`nav.ts` 加一行**（`/audiences` 那条之后、`/quick-replies` 之前；图标 `Megaphone` 加进顶部 import）：

```ts
  // 群发消费人群包选出的收件人，所以紧跟在人群包之后。
  { path: '/broadcast', label: '批量群发', icon: Megaphone },
```

- [ ] **Step 3：`App.tsx` 加路由**（`/audiences` 那条之后）：

```tsx
          <Route path="/broadcast" element={<BroadcastPage />} />
```

同时建占位 `pages/BroadcastPage.tsx`（`export function BroadcastPage(): JSX.Element { return <div>批量群发</div> }`），Task 14/15 再填 —— 没有它 `App.tsx` 编不过，而 typecheck 是本任务的判据。
- [ ] **Step 4：`pnpm run typecheck` 四路 0 error** + `pnpm exec eslint --quiet src/renderer/src/api/batchSend.ts src/renderer/src/lib/nav.ts src/renderer/src/App.tsx src/renderer/src/pages/BroadcastPage.tsx`。
- [ ] **Step 5：提交。** `feat(P7/群发): 渲染层数据层与 /broadcast 入口`

---

## Task 14: `BroadcastPage`——任务列表 + 创建向导

**Files:**
- Modify: `apps/desktop/src/renderer/src/pages/BroadcastPage.tsx`
- Create: `apps/desktop/src/renderer/src/components/broadcast/BatchTaskList.tsx`
- Create: `apps/desktop/src/renderer/src/components/broadcast/BatchWizard.tsx`

**Interfaces:**
- Consumes: Task 13 的全部 hooks；`stores/accounts.ts` 的账号列表；`/api/conversations?accountId=&size=`；`api/audiences.ts` 的 `useAudiences`/`useAudienceCustomers`。
- Produces: `<BroadcastPage />`（默认 = 列表 + 「新建任务」）；导出 `ACTIONS`（Task 15 复用）。

- [ ] **Step 1：`ACTIONS` 表（列表与详情共用一份）。**

```ts
export const ACTIONS: Record<BatchTaskStatus, ('start' | 'pause' | 'resume' | 'cancel')[]> = {
  pending: ['start', 'cancel'],
  running: ['pause', 'cancel'],
  paused: ['resume', 'cancel'],
  done: [],
  error: [],
  cancelled: []
}
```

> 注释里写清：这张表只决定**按钮出不出现**，合法性仍由后端 40902 裁决；它与后端 `SOURCES_OF` 是同一规则的两处写法，改一边要看另一边。

- [ ] **Step 2：列表。** `BatchTaskList.tsx`：
  - 列：`name` / `status`（Badge）/ 演练徽标 / `sentCount`–`totalCount` 进度条 / `failCount`（0 也写「0」，不许留空）/ `createdAt` / 操作。
  - **演练徽标常驻**：`dryRun ? <Badge>演练</Badge> : <Badge variant="outline">真发</Badge>`，两种状态都有字，跑完的演练任务不许看起来像真发过（spec §7）。
  - 状态筛选 Select：`全部 | pending | running | paused | done | error | cancelled`。
  - 行点击 → `onOpen(taskId)` 交回 `BroadcastPage` 切详情视图。
- [ ] **Step 3：向导五步。** `BatchWizard.tsx`（Dialog + step 状态机 `accounts → recipients → contents → pacing → confirm`）：
  - `accounts`：多选在线账号；一个未选时「下一步」disabled。
  - `recipients`：按已选账号拉会话（`size=200`），勾选进 `conversations`；顶部 `q` 输入框做标题/键过滤，另有一个「按人群包」Select —— 选中后用 `useAudienceCustomers` 拿 `customerId` 集合，在**已拉到的会话列表里**按 `customerId` 命中勾选（纯前端过滤，R10）。实时显示 `已选 N 人 × M 条内容 = K 条`，`K > 20000` 时 disabled 并显示「超过 20000 条上限」。
  - `contents`：`Textarea` 数组，增删至多 20 条；每条实时判 `trim()` 空 → 「第 N 条为空」、`length > 5000` → 「第 N 条超过 5000 字」。**两个数从这里到后端是同一份规则（`BatchRules.MAX_BODY=5000` / `isSendable`），文案不许自造第三个数。** 底部「预览渲染结果」→ `useBatchPreview`（前 5 个收件人），显示渲染后正文，未识别花括号原样、两个变量已填。
  - `pacing`：四个 number + 演练 Switch（**默认开**）。关掉演练时 `msgMin<3` / `chatMin<5` 就地标红，文案「真发不能低于 3 秒」/「真发不能低于 5 秒」。
  - `confirm`：任务名 + 账号数 + 收件人数 + 内容条数 + 总条数 + 两个区间 + 演练与否。提交 `useCreateBatchTask`；成功后 `rejected.length>0` 时先弹「这 N 个收件人被跳过」并逐条 `chatKey — reason`（R8 的部分接受必须看得见，不许静默丢），然后 `onOpen(taskId)`。
- [ ] **Step 4：`BroadcastPage.tsx` 组装**：`useBatchLive()` + 列表 / 详情切换 + 向导 Dialog。
- [ ] **Step 5：typecheck + eslint --quiet（四个文件）。**
- [ ] **Step 6：手工看一眼**：`/broadcast` 能出列表、向导能走完五步并创建出一个 `pending` 任务；**这一步不点「开始」**（起泵的腿在 Task 16 有专门驱动）。
- [ ] **Step 7：提交。** `feat(P7/群发): 任务列表与创建向导（演练徽标常驻，预览复用后端渲染器）`

---

## Task 15: `BroadcastPage`——任务详情（明细翻页 + 失败复位 + 撤回勾选）

**Files:**
- Create: `apps/desktop/src/renderer/src/components/broadcast/BatchTaskDetail.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/BroadcastPage.tsx`

**Interfaces:**
- Consumes: `useBatchTask` / `useBatchDetails` / `useBatchAction` / `useBatchRetry` / `useBatchRecall` / Task 14 的 `ACTIONS`。
- Produces: `<BatchTaskDetail taskId={number} />`；`recallEligible(task, row): boolean`。

- [ ] **Step 1：头部卡。** 三计数 + 进度条 + 状态 Badge + 演练徽标 + `heartbeatAt` + 按 `ACTIONS` 出的按钮组。
  - `heartbeatAt` 是墙钟串（Task 7 的 `string | null`），解析与格式化都走既有那一条链，**不要 dayjs 直接吃 VO 串**：`const ms = chatMs(task.heartbeatAt)`（`api/messages.ts:393`，内部补 `@shared/chatTime` 的 `CHAT_ZONE_OFFSET_TAG`），显示 `chatClock(ms)`（`@shared/chatTime:43`，东八区 `HH:mm`）+ 一句「距今 N 秒」（`Math.max(0, Math.round((Date.now() - ms) / 1000))`）。绝对时刻只到分，是因为 `chatClock` 的口径就是"日分组已经交代了哪天，这里只到分"；15 秒一跳的心跳在分钟刻度上看不出前进，**「距今 N 秒」才是"引擎还在跑"的那张证人**，所以两个都显示。
  - `null` 显示「还没跑过」而不是空白。页面每收到一次 `batch:state` 就 refetch（Task 13 的 `useBatchLive`），距今那个数会跟着跳；**不自设 `setInterval` 重算**，那会在没人看的时候也常驻一个定时器。
- [ ] **Step 2：明细表。** 列 `seq / accountId / chatKey / contentIndex / body（截断 60 字 + title 全文）/ sendStatus / errorCode+errorDetail / msgKey / recallStatus / sentAt`（`sentAt` 与 `heartbeatAt` 同一口径：`row.sentAt ? chatClock(chatMs(row.sentAt)) : '—'`）；筛选两个 Select（`sendStatus`、`recallStatus`）；翻页用 `useBatchDetails` 的 `page`。
  - **`unknown` 行**只显示不动作：文案「结果未知（可能已发出），不自动重发」。V1 **不给**它任何复位/裁决入口（R3；`retryFailed` 的 WHERE 不含它），并把这个缺口记进 Task 16 的验收文档为「V1 缺 unknown 的人工裁决入口」。
  - **`failed` 行**：行末一个「重发这一条」→ `useBatchRetry({ taskId, detailIds: [row.id] })`；表头另有一颗「重发失败条目」→ `useBatchRetry({ taskId })`（不带 detailIds＝整批）。两颗粒都走同一跳端点，只是 body 有无 `detailIds`（R11）。成功 toast 用返回的 `reset` 说"复位 N 条"（N 不许写死），**N=0 时要点一句「这几条不是失败状态，没有可重发的」**——否则用户会以为已经重发过了。复位把终态唤醒成 `paused` 时，任务卡上要出现「继续」并配一句「已复位 N 条，点继续重跑」：复位本身不投泵，泵只在 `running` 时捡 `pending` 行（Task 12 的 `runTask`），少了这一句用户会以为点完就在跑。
- [ ] **Step 3：撤回。**

```ts
/** 后端四条判据的镜像：`BatchStatus.recallBlocker` 那三条（非演练 / send_status=success / 有 msg_key）+ 服务层那条「recall_status 不是 none = 已经撤过或正在撤」。只用来禁用 checkbox；筛与点名仍在后端 POST /recall。 */
export function recallEligible(task: BatchTask, row: BatchDetailVO): boolean {
  return !task.dryRun && row.sendStatus === 'success' && !!row.msgKey && row.recallStatus === 'none'
}
```

勾选只在 `recallEligible` 的行上可用；「撤回已发」→ `useBatchRecall({taskId, detailIds})`，返回 `{eligible, blocked}` 后 toast「待撤 N 条，M 条不能撤」并把 `blocked` 的 `reason` 逐条列在一个折叠区里。`dryRun` 任务的整排 checkbox 禁用 + 表头一句「演练任务没有真发过」。
- [ ] **Step 4：typecheck + eslint --quiet + 手工看一眼**（打开一个已跑完的演练任务，确认演练任务的撤回 checkbox 全是禁用且有那句说明）。
- [ ] **Step 5：提交。** `feat(P7/群发): 任务详情——明细翻页、失败复位与撤回勾选`

---

## Task 16: 全量回归 + CDP 演练腿 + 验收文档 + spec 回填

**Files:**
- Create: `tmp/p7b-dry-run.mjs`（CDP 驱动，gitignored）
- Create: `docs/notes/2026-09-28-b7-batch-send-verification.md`
- Modify: `docs/superpowers/specs/2026-09-28-batch-send-design.md`（§11 四条待验证逐条给状态，§10 补 unknown 缺口）
- Modify: `docs/feature-checklist.md`（B7 行状态）

**Interfaces:**
- Consumes: 前 15 个任务的全部产物。
- Produces: 一份只用 实测 / 读码 / 推断 / 待验证 四个词的验收文档。

- [ ] **Step 1：机械回归，五个数逐个抄。**

```bash
cd /d/SmartSCRM/apps/desktop && pnpm run test:unit 2>&1 | tail -8
cd /d/SmartSCRM/apps/desktop && pnpm run typecheck 2>&1 | tail -8
cd /d/SmartSCRM/apps/desktop && pnpm exec eslint --quiet <本次全部改动文件> 2>&1 | tail -20
cd /d/SmartSCRM/apps/server && export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18" && set -o pipefail && ./mvnw test 2>&1 | tail -20
cd /d/SmartSCRM && node tmp/p7b-batch-contract.mjs
```

期望：unit `pass` = 212 + 10(Task 7) + 9(Task 8) + 8(Task 9) + 5(Task 10) + 8(Task 11) = **252**，`fail 0`；typecheck 四路 0 error；`eslint --quiet` 对改动文件 0 error；Java `Tests run` = **115**（实测 = Task 1 基线 81 + 群发纯函数 22 + 整枝修复轮的 12 条证人，其中 `BatchSendServiceTest` 8 条）、0 failures；契约驱动 `33/33 passed`（29 个编号）且退出码 0。**（212 与基线数以本次实跑为准，跑出来的真实数字写进文档，不许抄本文档的算术。）**

- [ ] **Step 2：CDP 演练腿（全程 dryRun，不碰页面）。** 前提：主进程改过，dev 必须已被用户重启过一次（dev watcher 不重载 `src/main`）。先 `powershell -NoProfile -ExecutionPolicy Bypass -File tmp/p5c-top.ps1` 断言 `visibilityState==='visible'`，然后跑 `tmp/p7b-dry-run.mjs`，八条：

```js
// #1 建 20 条演练任务（10 收件人 × 2 内容，dryRun=true，四个间隔都 0）
// #2 window.scrm.batch.start(taskId) → GET 回来 status==='running'
// #3 条件轮询 GET /tasks/{id} 直到 status 变 done（300ms 一轮，30s 上限；不许固定 sleep 判完）
// #4 sentCount===20 且 failCount===0
// #5 每条 detail 的 msgKey 都以 'dryrun:' 开头
// #6 明细里没有行留在 sending 或 pending
// #7 另建一个 20 条任务：start → 1s 内 pause → 连续两次读 sentCount 相同（暂停真的止住了）
//      → resume → sentCount 重新增长 → cancel → 剩余 pending 全部 skipped
// #8 全程内嵌视图的 location.href 与"当前会话"标记一次都没变（演练出料口不碰页面）
//      证法：跑前跑后各读一次并逐字比对，两次相等才算数
```

每条进 `check(name, pass, expected, actual)`，末行打印 `n/8 passed` 并按 Step 1 的收尾约定 `process.exitCode = N; await sleep(1500); process.exit(N)`。

- [ ] **Step 3：渲染层那一屏（CDP）**：`/broadcast` 出列表、演练徽标在、进度条 100%、详情页 20 行 seq=1..20、演练任务的撤回 checkbox 全禁用且有「演练任务没有真发过」。截图 `tmp/p7b-shot-list.png` / `tmp/p7b-shot-detail.png`，文档里按文件名引用。
  - **重发那一格（R11 的 UI 腿，只有这里能证）**：另建一份 2 收件人 × 1 内容的 dryRun 任务，用 HTTP 把其中一行报成 `failed`（另一行 `success`）让任务自然 `done`；然后**只用页面**：点那一行的「重发」→ 该行回 `pending`、任务徽标从 `done` 变 `paused`、表头「继续」亮起来 → 点「继续」→ 这一行重跑成 `success`、`failCount` 掉回 0。判据逐条读回来，不许用"点了没报错"当通过。
- [ ] **Step 4：用户在场那两格（各一次，明确放行才做）。**
  1. **真发 1 条**：`dryRun=false`、1 收件人 × 1 内容、`msgMin=3/msgMax=3/chatMin=5/chatMax=5`，收件人**必须是用户当场给出的那一个会话**（不许自己挑），用户点头后点「开始」；跑完读 `msgKey`（不带 `dryrun:` 前缀）与 `sentAt`。
  2. **真撤回 1 次**：对刚那条勾「撤回已发」并提交，读 `recall_status` 与 `recall_detail`；顺手把超出时间窗那一格的失败原文抄回来（spec §11.2 就等这个串）。
  3. 这两格之外**不许真发**：群发的形状决定了"多发一条"不可回收。
- [ ] **Step 5：验收文档**，四张表：机械验证（Step 1 五个数）、后端契约（30 行逐条 `ok/FAIL` + 期望/实际）、CDP 演练腿（Step 2 八行 + Step 3 那一格重发腿 + 截图名）、真实档（Step 4 两格 + 失败形状原文）。用户那两格没跑就写「待验证（需用户在场）」，**不写"已验证"**。
- [ ] **Step 6：spec 回填。** §11 四条逐条给状态（1 是否真走到对所有人 / 2 抄回的失败形状 / 3 回复框最坏等待 = 读码结论「一条 chat_interval + 在途回执耗时」加实测状态 / 4 演练 200 ms 是否够慢）；§10 补一条「unknown 的人工裁决入口 V1 缺，只有显示」；**§2 状态机补 R11 那两条边**（`done/error → paused` 只由重发走，`cancelled` 没有出边）。
- [ ] **Step 7：只提交文档三件。**

```bash
cd /d/SmartSCRM && git add docs/notes/2026-09-28-b7-batch-send-verification.md \
  docs/superpowers/specs/2026-09-28-batch-send-design.md docs/feature-checklist.md
git commit -m "update(P7/群发): B7 演练腿与真实档状态落档

20 条演练跑完、msgKey 全带 dryrun: 前缀、暂停那一秒计数不再增长；真发与真撤回按在场情况如实标注。"
```

**绝不 push** —— 推送是用户的手。

---

## 端到端顺序与依赖

```
Task 1 (V11+实体+Mapper)
  ├─ Task 2 (渲染/展开 TDD) ─┐
  ├─ Task 3 (规则/状态/JSON) ─┴─ Task 4 (创建+预览+读端点) ─ Task 5 (运行面) ─ Task 6 (契约驱动)
Task 7 (shared 纯模型) ─┬─ Task 8 (batchApi) ─┐
                        └─ Task 9 (sendLock+recallText) ─ Task 10 (页内撤回) ─┴─ Task 11 (engine) ─ Task 12 (host+IPC+preload)
Task 13 (渲染层数据层) ─ Task 14 (列表+向导) ─ Task 15 (详情) ─ Task 16 (回归+CDP 演练腿+文档)
```

后端线（1–6）与桌面线（7–12）互不阻塞，可并行推进；Task 11 需要 Task 8 的 `BatchApi` 类型与 Task 9 的注入形状都齐了才开工；Task 13 之后必须等 Task 12（`window.scrm.batch` 得先存在）。

