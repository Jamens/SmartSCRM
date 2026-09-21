# P6 聊天记录实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 WhatsApp 内嵌页面里的真实会话落成可查、可搜、可统计的本地聊天记录；Telegram 走 spec §11 的**官方 K 版 DOM 契约**（Task 12a 探针 → 12b 译文注入 → 12c 采集 → 12d 发送），验证基线是由真机快照裁出来的本地 fixture 页，真实站点那一档以"用户扫码登录 `/k/`"为前置（未扫码就是未验证，不预先假设已验证）

**Architecture:** Java 后端是唯一数据层：Flyway V8 建 `chat_conversation` / `chat_message` 两张表，批量入库靠 `uk_msg` 幂等，会话头是消息流的投影。桌面端在"页面侧"再挂一条与翻译注入包互相独立的消息桥：`@wppconnect/wa-js` 注入用户正在看的 WhatsApp 视图，与原生页共用同一个 Store，页内脚本零凭据、只经 `window.ele` 与主进程通信；主进程 `services/msgBridge/` 负责挂载、心跳重挂、批量攒写（CollectorHub）、发送登记（SendRegistry），并持 JWT 与 Java 通信。渲染层 `#/messages` 双源取数：历史读库，当前会话的尾巴吃主进程广播的 live 帧，按 `msg_key` 去重。

**Tech Stack:** Java 17 · Spring Boot 3.5.16 · MyBatis-Plus 3.5.17 · Flyway · MySQL 8（`smartscrm_react`）· JUnit 5 · Electron 39 + React 19 + TS(strict) + Tailwind v4 + radix-ui + TanStack Query v5 + Zustand · esbuild（注入 bundle / 消息桥 bundle）· `@wppconnect/wa-js` 4.6.0（`self.WPP`，零运行时依赖）· Node 24 原生 `node --test` + TS 类型剥离（本项目第一个 JS 侧单测闸门）

**Spec:** `docs/superpowers/specs/2026-09-20-chat-history-design.md`（表结构、链路、契约、验收矩阵以该文件为准；本计划只对其中 13 处做落地收敛，见下一节）

## Global Constraints

逐条抄自 spec §0 与本机既定事实，每个任务的隐含前提：

- **C1 本地闭环**：除 P5 已获批的翻译出口（`/api/translation/*` 打到厂商）外不新增任何外呼。`@wppconnect/wa-js` 只在构建期从 npm 取，运行时不请求厂商服务器；桥脚本内不得 `fetch` 任何第三方地址。
- **C2 桥脚本零凭据**：跑在 WhatsApp / Telegram 页里的一切代码不得持有 JWT / API key，不得直连 `:8180`；只走 `window.ele`（`sendToHost` / `send` / `invoke` / `on`）与主进程通信，凭据只在主进程。
- **C3 明文入库**：消息正文按既定隐私模型明文存本地库；不额外写缓存、不写 console、日志只记 id 与计数。
- **C4 测试痕迹清零**：向 WhatsApp 自聊发出的测试消息测后删除；DEMO 种子保持原样（customer 5 / label group 2 / audience 2 / material group 3 / material 4 / qr group 3 / reply 3）。`chat_*` 两表是本阶段新增的运行时表，验证行可以留，但**每轮验证前打印行数、验证后报告增量**，不静默膨胀。
- **C5 工具链**：前端一律 `pnpm`（禁 npm / npx）；后端 `./mvnw`（PATH 上的 JDK 已是 17.x，若不是先 `export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18"`，管道前 `set -o pipefail`）。提交前缀 `feat:` / `fix:` / `refa:` / `update:`；**每片测试通过即 commit，push 由用户手动执行，助手不得 push**。
- **C6 文档口径**：注释与文档只描述本项目的方案，不写与其它实现的对比、不引用外部仓库路径。
- **C7 后端验证只走 `http://localhost:8180`**：本机没有 mysql CLI、Docker 守护进程未运行。中文 payload 必须先用 Write 工具落成 UTF-8 文件再 `curl --data-binary @file`；Git Bash 内联中文会变成服务端 `50000`。多断言契约用 `tmp/*.mjs` 驱动，一次跑完打印 PASS/FAIL 表。
- **C8 重启口径**：新 Controller 404 且报 "No static resource" = 8180 上跑的是旧进程。`netstat -ano | grep ':8180'` → `taskkill //PID <pid> //F` → `./mvnw -q -DskipTests package` → `java -jar apps/server/target/scrm-server-0.1.0.jar`（后台），下一次命令前轮询 `/api/health`。
- **C9 渲染层验证只走 CDP**：`pnpm --dir apps/desktop exec electron-vite dev --remoteDebuggingPort 9223` + `tmp/cdp.mjs`（`openPage(9223)` / `openViewByUrl('web.whatsapp.com')` / `ev()` / `send()`），跑前先 `tmp/p5c-top.ps1` 抬起窗口并断言 `document.visibilityState === 'visible'`，否则 Radix 的出场动画不结束、`pointer-events` 永久卡在 `<body>` 上，所有点击静默失效。脚本结尾必须 `process.exit()`。
- **C10 输入路径口径（P5e 教训）**：凡涉及页内交互的断言一律用 CDP `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` / `Input.insertText`。合成 `element.click()` 不经过 `mousedown` 的默认焦点行为，会把焦点与选区竞态全部掩盖成"通过"。
- **C11 不得越权声称验证**：没有真实登录态就跑不了的项目（补底、发送、Telegram 真实站点的收发）要么标 blocked 要么如实报告"未验证"，不接受用桩数据冒充端到端。TG 的本地 fixture 页（`apps/desktop/test/tg-fixture.html`，spec §12）只证明"我们这侧的 DOM 读取照清单接得上"，**不**等于"TG 真实站点验证过"——两档结论在报告里永远分开写。TG 真机那一档的前置是**用户在 `/k/` 扫一次码**（K 与 A 不共用会话登录态），没扫就是没跑。
- **C12 业务错误码沿用既有词表**：`40000` 参数/取值非法、`40100` 未鉴权、`40404` 目标行不存在、`40901` 冲突、`50000` 未预期异常（`apps/server` 现有 service 就是这套，如 `PlatformAccountService:69` 的"账号不存在"用 `40404`）。本计划所有"找不到这一行"的断言一律写 `40404`，不新造 `40400` —— 两个近邻数字并存，前后端与契约表都会抄错。
- **C13 主进程发往后端的请求一律走 `apps/desktop/src/main/services/authedFetch.ts`**：不要在调用点手写 `getSession()?.accessToken` + `fetch`。内嵌页的生命周期远长于 access token 的 7200 秒，无刷新的请求会在两小时后整齐地变成 401，而页内只会看到"结果忽然没了"。`authedFetch` 的口径是：附带会话令牌 → 遇 401 刷新一次（并发共享同一次刷新）→ 把新令牌写回 session 文件 → 重放一次 → 仍失败才把响应原样交回调用方。Task 9 的 `createMsgApi`、Task 10 的 `accountDirectory` 与 Task 12 的发送链都按这条接。
- **本项目桌面端从本计划起有 JS 单测闸门**：`pnpm --dir apps/desktop test:unit`（Node 24 原生跑 `.test.ts`）。约束：被测模块必须只用**可擦除 TS 语法**（无 `enum` / `namespace` / 参数属性），import 必须带 `.ts` 后缀；由 `tsconfig.unit.json` 的 `erasableSyntaxOnly` 把这条钉死。DOM 与 IPC 行为仍靠 CDP 脚本，`node --test` 不碰。
- **C14 单测计数以实测基线为准**：本计划正文里写死的 `# pass N` 是**写作时**的推演值，评审修复轮一旦新增用例就会整体后移（Task 11 两轮之后实测基线是 48，正文那一条链仍写着 34）。执行每个任务时先跑一次拿到真实基线，期望值 = 真实基线 + 本任务新增用例数；**"数字对不上就把期望调大"不接受**，必须是本任务确实新写了那么多条。终态交付时把这条链按实测重算一遍写进报告。

## 对 spec 的十三处收敛

计划执行时按下述口径落地。这些是 spec 文字落到本仓库代码时必须做的决定（含两处 spec 与现实不符的更正），先在此声明，避免实现阶段各自发挥：

1. **更正：客户创建 API 目前不存在。** 现状只有 `GET/PUT/DELETE /api/customers/{id}` 与 `PUT /{id}/labels`，没有 `POST /api/customers`。spec §6 说的"既有客户创建 API"按**新增**处理（Task 5）。
2. **更正：`GET /customers/{id}/timeline` 目前不存在**（客户抽屉只有资料 + 标签）。spec §7 那行"扩展既有契约"改为**新建端点**，形状由本计划定义（Task 5）。
3. **状态推进不单开批量入口。** 采集侧一律 `INSERT IGNORE`（新行自带当时的 ack 状态）；只有发送链的 ack 变化走 `POST /api/messages/status`（单调阶梯守卫，量小）。这样 `accepted / duplicated` 的计数口径保持 spec §3 的简洁语义。
4. **客户匹配以 `customer.open_id` 为主键。** 种子里 WhatsApp 客户的 `open_id` 就是 `8613800001001@c.us`，与桥上报的 `chat_key` 同形，且落在既有唯一索引 `uk_customer_tenant_platform_openid` 上；手机号只做兜底，且两侧都要归一（种子 `phone` 带 `+`，chat_key 前缀不带）。
5. **页面 ↔ 主进程不新增 preload 表面。** 复用既有 `window.ele` 与 `webContentsView/ipc.ts` 的白名单路由：`msg-*` 前缀的页内上报在 `routePageMessage` 里改道给 `msgBridge`，不再转发给渲染层（渲染层从主进程的 `msg:live` 吃尾巴）。主进程 → 页内只有一条 `msg-cmd` 推送通道。**新增的渲染层表面只有 `scrm.msg`：`send` / `syncHistory` / `bridges` 三个 invoke + `onLive` / `onState` 两个订阅**（spec §10 的"固定几个 channel"落地成这五个）。
6. **账号归属不依赖渲染层存活。** 主进程 `msgBridge/accountDirectory.ts` 自带 viewId → `{accountId, platformType, name}` 目录：用主进程持有的 JWT 拉一次 `GET /api/platform-accounts`，挂载时与每 5 分钟刷新。理由：视图可以后台存活，切走路由会让渲染层的账号查询处于任何状态，采集不能因此断档。
7. **wa-js 独立于注入 bundle。** `pnpm --dir apps/desktop add -D @wppconnect/wa-js@4.6.0`，构建期把它的 `dist/wppconnect-wa.js`（IIFE，末尾 `self.WPP = exports`，零运行时依赖）复制成 `resources/wa-js.bundle.js`，由主进程**单独一次** `executeJavaScript` 注入，早于桥脚本。不 `bundle` 进 `msg-bridge.bundle.js`：体积（约 1 MB）与升级节奏都不同。
8. **`platform` 列的取值是 `'whatsapp' | 'telegram'`**（小写字面量），与 `platform_type`（1 / 4）的映射只在两处出现：`ChatKeys.platformOfAccountType()`（Java）与 `@shared/chatPlatform.ts`（TS）。
9. **时间口径**：页内 `t` 是 unix 秒；主进程不做换算，直接把 `msgTimeEpochSec` 上送后端；Java 用 `ZoneId.of("Asia/Shanghai")` 转成 `LocalDateTime(3)` 存库——该常量与 JDBC URL 上的 `serverTimezone=Asia/Shanghai` 是一对，注释里互相指认。API 返回的仍是 Jackson 序列化的本地墙钟串（与 P3/P5 既有 VO 一致），渲染层用 dayjs 解析。`t` 为 0 或未来值时钳制为接收时刻（spec §9）。
10. **JS 侧单测落点**：新建 `apps/desktop/src/shared/`（可擦除 TS 的纯模型与纯函数：桥、主进程、渲染层三处共用）与 `apps/desktop/src/bridge/`（页内桥），配 `tsconfig.unit.json`（`allowImportingTsExtensions` + `erasableSyntaxOnly` + `types:["node"]`，均已在本机 tsc 5.9.3 验证可用）与脚本 `test:unit: node --test "src/shared/**/*.test.ts" "src/bridge/**/*.test.ts"`（Node 24 的多 glob 实测可展开；若某条 glob 匹配不到文件，Node 24 会打印 `Could not find` 并以非 0 退出——`src/bridge/` 在 Task 8 才有第一个测试，Task 7 先只写 `src/shared` 那条，Task 8 补齐）。`@shared` 别名要同时加进 `electron.vite.config.ts` 的 `main` / `renderer` 与 `tsconfig.web.json` / `tsconfig.node.json` 的 `paths`。
11. **未读数是尽力值**：live 收到 `in` 消息且该视图的 `activeChat != chat_key` 时 +1；记录页打开会话即调 `POST /api/conversations/{id}/read` 清零。不追求与 WhatsApp 侧栏一致。
12. **搜索用 `LIKE`，不建 FTS**（spec §1 非目标）；`q` 里的 `%` `_` `\` 必须转义，空串与纯通配符返回空结果而不是全表。
13. **spec §8 的「按客户语向」两处生效面都落在 P6：① 记录页回复框由 Task 6 兑现，② 内嵌页气泡由 Task 17b 兑现。** ② 需要的三段东西在计划里都各有承接点，不另起一期：主进程那份「视图 → 账号 / 会话」的目录在 Task 10 的 `accountOfView` 与 Task 11 的 `activeChatOf` 里已经有了（采集链本来就靠它给批次盖章），后端按 `(tenantId, accountId, chatKey)` 查 `chat_conversation.customer_id` 是一行投影查询（17b Step 1），页内的翻译请求只需要把会话并进 inflight 去重键（17b Step 3）。落地后的边界：**页面说不出账号与会话**——上报到 `view:invoke` 的字段仍只有 `text/type/input/noCache`，`accountId` 与 `chatKey` 由主进程按 `viewId` 重新盖。记录页回复框（①）继续显式带 `customerId`，且它压过 ② 的会话投影。

## 验收口径速览（对应 spec §12）

| 层 | 谁来做 | 通过标准 |
|---|---|---|
| Java 纯函数 | scoped：`./mvnw test -Dtest='ChatKeysTest,MsgTimesTest,StatusLadderTest,SearchPatternTest'`（Task 2）、`-Dtest='CursorsTest'`（Task 4）、`-Dtest='ScopeSettingsTest'`（Task 6）；全量：`./mvnw test`（Task 19） | 三处 scoped 分别 `Tests run: 15 / 3 / 4`（Task 2 的 15 = ChatKeys 6 + MsgTimes 5 + StatusLadder 2 + SearchPattern 2，2026-09-20 实跑）；P6 六个测试类共 22 条，全量跑 `Failures: 0, Errors: 0` |
| 后端契约 | `tmp/p6b-query.mjs` / `tmp/p6b-customer.mjs` / `tmp/p6b-scope-contract.mjs` / `tmp/p6c-chatkey-direction.mjs`（Node，打 8180）+ Task 3 Step 4/5 的 curl 探针 | 四份脚本分别 `ALL PASS (17/17)`、`(9/9)`、`(10/10)`、`(8/8)`，覆盖幂等、游标与锚点窗口、搜索转义与过滤、统计口径、link-customer 回填、客户级语向、按会话投影取语向与缓存分键 |
| TS 纯函数 | `pnpm --dir apps/desktop test:unit` | normalize / ackRank / CollectorHub / SendRegistry / liveTail merge / 日分组 / chatKeys / 搜索与统计 / 建客户预填与语向草稿 / 时间线分组 / 翻译请求去重键 / TG DOM 读取与归一化与发送结清 全绿，计数按 12 → 16 → 28 → 34 → 39 → 43 → 48 → 56 → 68 → 76 → 79 → 83 → 85 → 99 → 105 单调递增（TG 四档里 12a +2 条清单校验、12c +14、12d +6；12b 不加用例，`src/inject/**` 不在闸门白名单里），终态 `# pass 105` / `# fail 0`（C14：这些是评审前推演值，真实基线以闸门输出为准） |
| 桥与真实会话 | CDP + 已登录 WhatsApp 视图；TG 由 Task 12a 的探针产清单，A 档走真机快照裁出的 fixture 页（B 档需用户扫码，见 C11） | 补底 N=5 行数与 `msg_key` 集合前后差、自聊发送→状态推进→删除、原生页手发一条也入库、断线重挂不重不漏、**内嵌页气泡跟随客户语向**（Task 17b Step 6，含"陌生会话仍走全局"的并存对照）；TG：`tmp/p6-tg-fixture.mjs` 第 0～9 行（补底/会话头/open_id 挂客户/live 幂等/无服务端 id 挡门外）+ 12d 第 10～14 行（`out` 行认领、app_send、同文本连发、认领不上按 TIMEOUT） |
| 渲染层 | CDP 真实鼠标/键盘（C10） | 列表 / 翻页 / live 去重 / 回复（先译再发开关两态）/ 语向弹层 / 陌生建客户闭环 / 搜索跳转 / 统计卡数字等于库内 COUNT |

## 与后续阶段的三条硬缝（spec §13）

本计划不实现 P7/P8/P13，但今天定下的形状会长期约束它们。这三条是"做对了以后不用回头改"的关口，验收时各有一条可查断言：

1. **发送契约必须无会话内状态**（P7 群发要复用）。`scrm:msg:send` 的入参是 `{accountId, chatKey, text, localId}`，`localId` 由渲染层生成，主进程 `SendRegistry` 只按 `localId` 登记回执（Task 9 的 `add(localId, viewId)` / `settle(receipt)`），**不读也不写"当前会话""上一条消息"这类会话级变量**。节流与看门狗留在渲染层排队（Task 15）与主进程超时（Task 12），不在契约里塞批次语义。可查断言：Task 19 Step 3 第 6 行——同一 `chatKey` 连发两条不同 `localId`，两条各自拿到独立回执、状态互不覆盖。
2. **`chat_message` 就是事实源，P6 不预建任何聚合表**（P8 群统计 / P13 报表要读它）。会话头 `chat_conversation` 只是投影，且只承担列表页展示；跨会话/跨时间段的统计一律走 `GET /api/messages/stats` 的实时聚合（Task 4）。V8 迁移里出现第三张表即为违约。可查断言：Task 19 Step 6 的 `grep -c 'CREATE TABLE' ... V8__chat_history.sql` 必须是 `2`；两表行数与 `stats` 的对照口径在 Step 1 第 3 条（分母）与 Step 2（增量）里。
3. **客户级语向的数据形状在 Task 6/17 就落到位**，生效面 ② 由 Task 17b 接上，不改这张表、不加列、不改写入方。Task 6 与 Task 17 写入的就是后端既有语义的 `scope='customer'` / `scope_key=<customerId>` 覆盖行；17b 补的是"读取侧的第二条入口"——主进程盖 `accountId`+`chatKey`、后端按 `chat_conversation` 投影出 `customer_id`（见收敛第 13 条）。可查断言：Task 17 Step 7 的 CDP 第 7、8 行（成对读）确认覆盖行可写可读、第 11 行确认可清；17b Step 2 的契约表确认「② 按会话投影取语向」与「① 显式 customerId 压过 ②」两条同时成立；Step 6 的真实页面确认语种只能由主进程那条盖章链得出。

---

## 文件结构

```
apps/server/src/main/resources/db/migration/
  V8__chat_history.sql                                                  [新增]
apps/server/src/main/java/com/smartscrm/server/
  entity/      ChatConversation.java · ChatMessage.java                 [新增]
  mapper/      ChatConversationMapper.java · ChatMessageMapper.java     [新增]（@Insert INSERT IGNORE / 守卫 UPDATE / 统计 @Select）
  service/msg/ ChatKeys.java          平台码 / chat_key 归一 / 手机号归一 [新增]
  service/msg/ MsgTimes.java          epoch 秒 → LocalDateTime + 钳制    [新增]
  service/msg/ StatusLadder.java      状态阶梯词表（顺序只在 SQL）        [新增]
  service/msg/ SearchPattern.java     LIKE 转义与通配判定                 [新增]
  service/msg/ Cursors.java           游标编解码 "<epochMillis>:<id>"     [新增]
  service/msg/ ScopeSettings.java     customer → global 语向解析          [新增]
  service/     MessageService.java    批量入库 + 会话头投影 + 客户匹配     [新增]
  service/     MessageQueryService.java 游标 / 分页 / 搜索 / 统计 / 清未读 [新增]
  service/     CustomerService.java   +create()                           [改]
  service/     TranslationService.java +按 scope/customerId 解析语向       [改]
  web/         MessageController.java                                     [新增]
  web/         ConversationController.java                                [新增]
  web/         CustomerController.java   +POST /api/customers +timeline    [改]
  web/         TranslationController.java +DELETE /settings/customer/{id}  [改]
  web/dto/     MessageBatchDTO · MessageItemDTO · MessageStatusDTO ·
               ConversationLinkCustomerDTO · CustomerCreateRequest ·
               TranslateDTO(+customerId) · TranslationSettingInput(+scope/scopeKey) [新增/改]
  web/vo/      MessageVO · ConversationVO · ConversationPageVO · MessagePageVO ·
               MessageSearchVO · SearchHitVO · MessageStatsVO · DayCountVO ·
               CustomerTimelineVO                                        [新增]
apps/server/src/test/java/com/smartscrm/server/service/msg/
  ChatKeysTest.java · MsgTimesTest.java · StatusLadderTest.java · SearchPatternTest.java
  · CursorsTest.java · ScopeSettingsTest.java                            [新增]

apps/desktop/
  package.json            + wa-js devDep、+ build:bridge / watch:bridge / test:unit、typecheck 追加 [改]
  electron.vite.config.ts main / renderer 各加 @shared 别名                                        [改]
  tsconfig.unit.json      桥与 shared 的严格可擦除 TS 闸门                                          [新增]
  scripts/build-bridge.mjs  esbuild 产 resources/msg-bridge.bundle.js + 复制 wa-js bundle          [新增]
  src/shared/
    chatPlatform.ts       'whatsapp' | 'telegram' 与 platform_type 的双向映射                       [新增]
    chatTypes.ts          NormalizedMessage · LiveFrame · BridgeState · SendReceipt 形状            [新增]
    chatStatus.ts         页内 ack → 状态词 + 阶梯秩与可否推进                                      [新增]
    chatKeys.ts           chat_key 形态解释：群判定与对端裸号码（Java `ChatKeys` 的 TS 镜像）        [新增]
    translateKey.ts       翻译请求的 inflight 去重键：语种之外还要分会话提示（Task 17b）                  [新增]
    liveTail.ts           live 帧并入已取列表的纯函数（去重 / 尾部补 / 乐观气泡销账）              [新增]
    tgDomContract.ts      §11.1 那份清单 + assertTgContract：TG 三条链唯一的类名来源，值由探针写回  [新增 · Task 12a]
    *.test.ts             上述纯函数的 node:test 用例                                               [新增]
  src/bridge/
    index.ts              window.__SCRM_BRIDGE__ 入口：握手、心跳应答、模式分派、__SCRM_BRIDGE_DESTROY__ [新增]
    host.ts               window.ele 封装（sendToHost / on / 节流）                                  [新增]
    types.ts              WppLike 等最小环境声明（不 import wa-js 类型）                             [新增]
    whatsapp/normalize.ts RawMessage / MsgModel → NormalizedMessage（纯函数）                        [新增]
    whatsapp/collect.ts   on 事件 + 补底批量拉取（限速）                                              [新增]
    whatsapp/send.ts      sendTextMessage + ack 变化上报                                             [新增]
    telegram/tgParse.ts   hash→chatKey / 合成 msgKey / 时间与未读解析（纯函数，进单测闸门）        [新增 · Task 12c]
    telegram/tgDom.ts     清单 → 节点读取（会话行 / 消息行 / 滚动到顶），TG 侧唯一碰 document 处    [新增 · Task 12c]
    telegram/normalize.ts 行快照 → NormalizedMessage（纯函数，spec §11.2 映射）                  [新增 · Task 12c]
    telegram/collect.ts   MutationObserver 实时 + 滚动补底（滚到顶或到 N 条）                    [新增 · Task 12c]
    telegram/claim.ts     "这条 out 是哪次发送"的认领纯函数（FIFO + 已认领集合）                  [新增 · Task 12d]
    telegram/send.ts      切会话 → 写 composer → 真实点发送 → 认领 out 行上桥（共用 SendRegistry） [新增 · Task 12d]
    *.test.ts             normalize / 平台映射的 node:test 用例                                        [新增]
  test/
    tg-probe/             Task 12a 产物：探针输出的 manifest.json + 打码后的 snapshots.md          [新增 · Task 12a]
    tg-fixture.html       由上面那份快照裁出来的假 Telegram Web：同一批类名与嵌套，脚本化抛变更      [新增 · Task 12c]
  src/main/services/msgBridge/
    index.ts              挂载总入口 + 登录观察接线 + 页内消息路由 + 渲染层广播                       [新增]
    bridgeMount.ts        两段 executeJavaScript、ready 握手、心跳与指数退避重挂                      [新增]
    collectorHub.ts       批量攒写队列（500/2s、上限 10k 丢最旧、重试 3 次）；无 Electron 依赖，进单测闸门 [新增]
    sendRegistry.ts       localId → pending 回执登记 + 超时清理；同上                                  [新增]
    msgApi.ts             批量入库 / 状态推进 / 账号列表的 HTTP hop（token 与 fetch 都注入）；同上      [新增]
    accountDirectory.ts   viewId ⇄ accountId 目录（5min TTL）                                          [新增]
  src/main/services/translationBridge.ts  requestTranslation 多一个 TranslateContext 形参（Task 17b）  [改]
  src/inject/core/translation/ · core/PlatformAdapter.ts · platforms/whatsapp/index.ts
                          页内请求带上会话提示（只进去重键，不进请求体；Task 17b）                        [改]
  src/main/webContentsView/ipc.ts    routePageMessage 改道 msg-*；view:invoke 按 viewId 盖会话（17b）  [改]
  src/main/ipc.ts                    注册 msg:send / msg:sync-history / msg:bridges                    [改]
  src/preload/index.ts               scrm.msg 五个成员                                                  [改]
  src/renderer/src/
    services/msgService.ts    window.scrm.msg 的浏览器 fallback                                        [新增]
    api/messages.ts           VO 类型 + Query/Mutation hooks                                            [新增]
    api/customers.ts          +useCreateCustomer（创建端点是 Task 5 新开的）                              [改]
    api/translation.ts        客户级语向：settings(customerId?) · settingsInputOf · reset mutation        [改]
    lib/liveTailSync.ts       订阅 msg:live / msg:state 并入 Query 缓存                                 [新增]
    lib/chatDays.ts           日分组区间 + 时间戳 → 日头文案（进单测闸门）                                [新增]
    lib/chatDisplay.ts        会话标题与消息时间展示                                                    [新增]
    lib/chatSearch.ts         一条搜索结果 → 跳到哪个会话的哪条 + 命中锚点文案（进闸门）                   [新增]
    lib/chatStats.ts          按日计数 → 柱条几何：补零、归一、收发比（进闸门）                            [新增]
    lib/sendDraft.ts          回复框的决策表：空 / 超长 / 中文拦截 / 先译再发（进闸门）                    [新增]
    lib/createCustomerPrefill.ts  会话 → 建客户表单预填（进闸门）                                       [新增]
    lib/directionDraft.ts     语向弹层的表单初值、改动计数与摘要（进闸门）                                 [新增]
    lib/chatTimeline.ts       时间线按会话分组：卡片顺序与卡内顺序（进闸门）                                [新增]
    stores/chatJump.ts        客户时间线 → 记录页的跨页待选会话                                           [新增]
    pages/MessagesPage.tsx    记录页（列表 / 流 / 回复 / 搜索 / 统计 / 会话头动作）                        [新增]
    components/messages/*.tsx 会话列表 · 消息流 · 气泡 · 回复框 · 搜索面板 · 统计卡 · 会话头动作            [新增]
    components/translation/LangSelect.tsx  从翻译中心提取，语向弹层共用                                   [新增]
    components/customers/CustomerTimeline.tsx 客户抽屉时间线（复用气泡）                                  [新增]
    components/customers/CustomerDrawer.tsx  +最近消息段                                                 [改]
    lib/nav.ts + App.tsx      /messages 路由与导航                                                       [改]
    layouts/AppLayout.tsx     挂 useLiveTailSync()                                                       [改]
```

---

## P6-0 前置定档（TG 实现深度，spec §11 的门）

### Task 0: Telegram 实现深度的定档（spec §11 的门）—— **已定档为"官方 K 版 DOM 契约"，本任务无步骤要跑**

> **裁定史（三次，按时间读）**：2026-09-21 一次裁定"本期不做 TG"，把 TG 采集/发送整体移出 P6；同日二次裁定推翻它，但把读取面定成"页内 store 契约"——要求承载页自己在 `window` 上挂出状态与动作 API；2026-09-22 三次裁定**再推翻二次**：那次的前提是"内嵌自建 Telegram Web"，而本期用的是官方站点，实测 `https://web.telegram.org/k/` 上 `"getGlobal" in window === false`、`apiManagerProxy` 上没有 `invokeApi`（完整观察见 spec §11.0）——读取面在要用的站点上根本不存在。三次裁定后的口径：**内嵌官方 K 版、路径钉死 `/k/`、采集与发送都读 DOM、类名集中在一份由真机探针产出的清单里**（spec §11.1）。
>
> **定档结果**：DOM 契约档（与 WhatsApp 不同构：WA 有 store 可钩，TG 只有渲染结果）。落地的任务：**Task 12a**（真登录态探针 → `tgSelectors.ts` 清单 + `test/tg-probe/` 快照，这一步之前不写 TG 代码）、**Task 12b**（注入层 TG 适配器换成清单真值，译文与 WA 同形）、**Task 12c**（DOM 读取 + 归一化 + 实时/补底入库 + 由快照裁出的 fixture 页 + TG 客户 `open_id` 形态收敛）、**Task 12d**（TG 发送链，与 Task 12 共用 `SendRegistry` 与状态阶梯）、**Task 10**（桥挂载闸门从 WhatsApp-only 放开为 WhatsApp + Telegram）。
>
> **B 档不再是"永久未验证"**，但前置条件写在 C11 里：**TG 视图指到 `/k/` 后要重新扫一次码**（不钉路径会落到 `/a/`，两条路径不共用会话）。没扫码那一档就是没跑，报告里如实标未验证，不计绿也不计红。
>
> **执行者注意**：不要因为任务表里挂着 Task 0 去找步骤跑。Task 12a 之前任何人不得在 `bridge/telegram/` 或 `inject/platforms/telegram/` 里新增类名字符串——清单没落地之前，猜出来的类名与真值在测试里长得一模一样，只有真机能区分。

---


## P6a — 后端（V8 + 采集入库 + 查询面 + 客户 / 语向）

### Task 1: V8 迁移、两张表、两个实体与 Mapper

**Files:**
- Create: `apps/server/src/main/resources/db/migration/V8__chat_history.sql`
- Create: `apps/server/src/main/java/com/smartscrm/server/entity/ChatConversation.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/entity/ChatMessage.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/mapper/ChatConversationMapper.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/mapper/ChatMessageMapper.java`

**Interfaces:**
- Consumes: 既有 `tenant` / `platform_account` / `customer` 表；V5–V7 迁移的书写风格（反引号列名、`DATETIME(3)` 默认值、`ENGINE = InnoDB` + `utf8mb4_unicode_ci`、注释说明"为什么这么设计"）。
- Produces: 表 `chat_conversation` / `chat_message`；实体 `ChatConversation`（Lombok `@Data` 生成 `getTenantId()` / `getAccountId()` / `getPlatform()` / `getChatKey()` / `getTitle()` / `getIsGroup()` / `getCustomerId()` / `getLastMsgTime()` / `getLastMsgBody()` / `getUnreadCount()` / `getCreatedAt()` / `getUpdatedAt()`）、`ChatMessage`（另有 `getMsgKey()` / `getDirection()` / `getSenderId()`… 见 DDL 列名驼峰）；`ChatConversationMapper`（`upsertHead` / `clearUnread` / `replayHead`）、`ChatMessageMapper`（`insertIgnoreBatch` / `advanceStatus` / `statsTotals` / `statsPerDay`）。Task 3 的 `MessageService` 只经这三个入口写库。

- [ ] **Step 1: 写 `V8__chat_history.sql`**

全文（DDL 逐字来自 spec §3，外键与索引按本仓库既有风格补齐）：

```sql
-- P6: chat history (checklist B5) — the message log and its conversation projection.
-- Content is stored in plaintext inside the local database on purpose (privacy model
-- shared with the customer domain). Nothing here is seeded: both tables only ever
-- contain rows that a real embedded session produced.

CREATE TABLE `chat_conversation`
(
    `id`            BIGINT       NOT NULL AUTO_INCREMENT,
    `tenant_id`     BIGINT       NOT NULL,
    `account_id`    BIGINT       NOT NULL COMMENT 'platform_account.id',
    `platform`      VARCHAR(16)  NOT NULL COMMENT 'whatsapp | telegram',
    `chat_key`      VARCHAR(128) NOT NULL COMMENT 'WA: 8613...@c.us / 1234-5678@g.us; TG: numeric chat id',
    `title`         VARCHAR(256) NULL COMMENT 'peer name snapshot at ingest time',
    `is_group`      TINYINT(1)   NOT NULL DEFAULT 0,
    `customer_id`   BIGINT       NULL COMMENT 'filled when the chat matches a customer (Task 3 matching rules)',
    `last_msg_time` DATETIME(3)  NULL,
    `last_msg_body` VARCHAR(512) NULL COMMENT 'body, or the media summary for non-text messages',
    `unread_count`  INT          NOT NULL DEFAULT 0 COMMENT 'best effort: only live inbound frames move it (spec 收敛 11)',
    `created_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_conv` (`tenant_id`, `platform`, `account_id`, `chat_key`),
    KEY `idx_conv_list` (`tenant_id`, `account_id`, `last_msg_time`),
    CONSTRAINT `fk_conv_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_conv_account` FOREIGN KEY (`account_id`) REFERENCES `platform_account` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='conversation headers, projected from chat_message';

CREATE TABLE `chat_message`
(
    `id`            BIGINT       NOT NULL AUTO_INCREMENT,
    `tenant_id`     BIGINT       NOT NULL,
    `account_id`    BIGINT       NOT NULL,
    `platform`      VARCHAR(16)  NOT NULL COMMENT 'whatsapp | telegram',
    `chat_key`      VARCHAR(128) NOT NULL,
    `msg_key`       VARCHAR(128) NOT NULL COMMENT 'WA: message.id._serialized; TG: platform message id',
    `direction`     VARCHAR(8)   NOT NULL COMMENT 'in | out',
    `customer_id`   BIGINT       NULL,
    `sender_key`    VARCHAR(128) NULL COMMENT 'group sender id; NULL for 1:1 chats',
    `sender_name`   VARCHAR(128) NULL,
    `body`          TEXT         NULL COMMENT 'text body; NULL for media-only messages',
    `media_type`    VARCHAR(16)  NOT NULL DEFAULT 'text' COMMENT 'text|image|audio|video|document|sticker|contact|location|unknown',
    `media_summary` VARCHAR(256) NULL COMMENT 'the "[图片]" style placeholder shown in the stream',
    `msg_time`      DATETIME(3)  NOT NULL COMMENT 'platform timestamp; clamped to ingest time when implausible',
    `status`        VARCHAR(16)  NOT NULL DEFAULT 'received' COMMENT 'in: received; out: pending|sent|delivered|read|failed',
    `source`        VARCHAR(16)  NOT NULL COMMENT 'live | backfill | app_send | native_send',
    `send_local_id` VARCHAR(64)  NULL COMMENT 'SendRegistry correlation id for rows this app sent',
    `created_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_msg` (`tenant_id`, `platform`, `account_id`, `chat_key`, `msg_key`),
    KEY `idx_msg_conv` (`tenant_id`, `account_id`, `chat_key`, `msg_time`),
    KEY `idx_msg_customer` (`tenant_id`, `customer_id`, `msg_time`),
    CONSTRAINT `fk_msg_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_msg_account` FOREIGN KEY (`account_id`) REFERENCES `platform_account` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT ='the message log; uk_msg is the idempotency contract';
```

- [ ] **Step 2: 两个实体**

`ChatMessage.java`：

```java
package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("chat_message")
public class ChatMessage {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Long accountId;
    private String platform;
    private String chatKey;
    private String msgKey;
    private String direction;
    private Long customerId;
    private String senderKey;
    private String senderName;
    private String body;
    private String mediaType;
    private String mediaSummary;
    private LocalDateTime msgTime;
    private String status;
    private String source;
    private String sendLocalId;
    private LocalDateTime createdAt;
}
```

`ChatConversation.java`（字段与 DDL 一一对应；`is_group` 声明成 `Integer`，因为 Task 3 按 `? 1 : 0` 赋值；`unreadDelta` 是给 `upsertHead` 传参用的非表字段）：

```java
package com.smartscrm.server.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("chat_conversation")
public class ChatConversation {

    @TableId(type = IdType.AUTO)
    private Long id;
    private Long tenantId;
    private Long accountId;
    private String platform;
    private String chatKey;
    private String title;
    private Integer isGroup;
    private Long customerId;
    private LocalDateTime lastMsgTime;
    private String lastMsgBody;
    private Integer unreadCount;
    private LocalDateTime createdAt;
    @TableField(update = "CURRENT_TIMESTAMP(3)")
    private LocalDateTime updatedAt;

    /** upsertHead 的入参：本次要加的未读数（0 或 1），不落库。 */
    @TableField(exist = false)
    private Integer unreadDelta;
}
```

- [ ] **Step 3: 两个 Mapper（幂等 SQL 是本任务的全部 cleverness）**

`ChatMessageMapper.java`：

```java
package com.smartscrm.server.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.smartscrm.server.entity.ChatMessage;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

public interface ChatMessageMapper extends BaseMapper<ChatMessage> {

    /**
     * 采集链的唯一写入口。uk_msg 命中即忽略：重复事件、补底与实时交叠、重挂后的
     * 尾巴重放，全都靠这一条消解，所以调用方不需要先查后插。
     * 返回值 = 真正插入的行数；duplicated = 提交条数 - 返回值。
     */
    @Insert({"<script>",
        "INSERT IGNORE INTO chat_message",
        "(tenant_id, account_id, platform, chat_key, msg_key, direction, customer_id, sender_key, sender_name,",
        " body, media_type, media_summary, msg_time, status, source, send_local_id) VALUES",
        "<foreach collection='list' item='m' separator=','>",
        "(#{m.tenantId}, #{m.accountId}, #{m.platform}, #{m.chatKey}, #{m.msgKey}, #{m.direction},",
        " #{m.customerId}, #{m.senderKey}, #{m.senderName}, #{m.body}, #{m.mediaType}, #{m.mediaSummary},",
        " #{m.msgTime}, #{m.status}, #{m.source}, #{m.sendLocalId})",
        "</foreach>",
        "</script>"})
    int insertIgnoreBatch(@Param("list") List<ChatMessage> list);

    /**
     * 发送状态的单调推进，一条 SQL 自己把关（不做"先查后改"，省一次往返也避免竞态）：
     * 出站行只能沿 pending→sent→delivered→read 往上走；failed 只能从 pending/sent 落定，
     * 落定即终态 —— 迟到的 ack 不能把一条已经失败的消息翻回成功，页面上它已经带重试按钮了。
     * 第一条分支显式要求 status 也在阶梯上：FIELD() 对清单外的值返回 0，
     * 只比大小会把 'failed'/'received'/脏值当成最低的一阶，让 0 < FIELD('sent') 成立而把它们顶上去。
     * 与页内 chatStatus.ts 的 canAdvance 同形（Task 7），两边必须一致。
     */
    @Update("UPDATE chat_message SET status = #{toStatus} WHERE tenant_id = #{tenantId} AND platform = #{platform}"
        + " AND account_id = #{accountId} AND chat_key = #{chatKey} AND msg_key = #{msgKey} AND direction = 'out'"
        + " AND ((#{toStatus} IN ('sent', 'delivered', 'read')"
        + "       AND status IN ('pending', 'sent', 'delivered', 'read')"
        + "       AND FIELD(status, 'pending', 'sent', 'delivered', 'read')"
        + "           < FIELD(#{toStatus}, 'pending', 'sent', 'delivered', 'read'))"
        + "      OR (#{toStatus} = 'failed' AND status IN ('pending', 'sent')))")
    int advanceStatus(@Param("tenantId") Long tenantId, @Param("platform") String platform,
                      @Param("accountId") Long accountId, @Param("chatKey") String chatKey,
                      @Param("msgKey") String msgKey, @Param("toStatus") String toStatus);

    @Select("SELECT COUNT(*) total, COALESCE(SUM(direction = 'in'), 0) inCount,"
        + " COALESCE(SUM(direction = 'out'), 0) outCount,"
        + " COUNT(DISTINCT chat_key) activeConversations"
        + " FROM chat_message WHERE tenant_id = #{tenantId} AND account_id = #{accountId}"
        + " AND msg_time >= #{from}")
    Map<String, Object> statsTotals(@Param("tenantId") Long tenantId, @Param("accountId") Long accountId,
                                    @Param("from") LocalDateTime from);

    /**
     * 按日计数。DATE_FORMAT 直接给字符串，省掉 java.sql.Date 的时区二义；
     * 没有消息的日子由服务层补零（统计卡的柱条数必须等于 days）。
     */
    @Select("SELECT DATE_FORMAT(msg_time, '%Y-%m-%d') day, COALESCE(SUM(direction = 'in'), 0) inCount,"
        + " COALESCE(SUM(direction = 'out'), 0) outCount"
        + " FROM chat_message WHERE tenant_id = #{tenantId} AND account_id = #{accountId}"
        + " AND msg_time >= #{from} GROUP BY day ORDER BY day")
    List<Map<String, Object>> statsPerDay(@Param("tenantId") Long tenantId,
                                          @Param("accountId") Long accountId,
                                          @Param("from") LocalDateTime from);
}
```

`ChatConversationMapper.java`：

```java
package com.smartscrm.server.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.smartscrm.server.entity.ChatConversation;
import java.time.LocalDateTime;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

public interface ChatConversationMapper extends BaseMapper<ChatConversation> {

    /**
     * 会话头是投影：随消息写入，且只在时间更新时改写摘要，乱序到达的旧消息不会
     * 把会话顶到列表前面。unread 增量由调用方算好（0 或 1），这里不判定活跃会话。
     */
    @Insert("INSERT INTO chat_conversation (tenant_id, account_id, platform, chat_key, title, is_group,"
        + " customer_id, last_msg_time, last_msg_body, unread_count) VALUES (#{tenantId}, #{accountId},"
        + " #{platform}, #{chatKey}, #{title}, #{isGroup}, #{customerId}, #{lastMsgTime}, #{lastMsgBody},"
        + " #{unreadDelta}) ON DUPLICATE KEY UPDATE"
        + " title = IF(VALUES(title) IS NULL, title, VALUES(title)),"
        + " customer_id = COALESCE(customer_id, VALUES(customer_id)),"
        + " last_msg_time = IF(VALUES(last_msg_time) > COALESCE(last_msg_time, '1970-01-01'),"
        + "     VALUES(last_msg_time), last_msg_time),"
        + " last_msg_body = IF(VALUES(last_msg_time) > COALESCE(last_msg_time, '1970-01-01'),"
        + "     VALUES(last_msg_body), last_msg_body),"
        + " unread_count = unread_count + #{unreadDelta}")
    int upsertHead(ChatConversation head);

    @Update("UPDATE chat_conversation SET unread_count = 0 WHERE id = #{id} AND tenant_id = #{tenantId}")
    int clearUnread(@Param("tenantId") Long tenantId, @Param("id") Long id);

    /** 运维兜底：会话头按消息重算（spec §3「错乱可由重算接口修复」）。 */
    @Update("UPDATE chat_conversation c SET last_msg_time ="
        + " (SELECT MAX(m.msg_time) FROM chat_message m WHERE m.tenant_id = c.tenant_id"
        + "   AND m.account_id = c.account_id AND m.chat_key = c.chat_key),"
        + " last_msg_body = (SELECT COALESCE(m.body, m.media_summary) FROM chat_message m"
        + "   WHERE m.tenant_id = c.tenant_id AND m.account_id = c.account_id AND m.chat_key = c.chat_key"
        + "   ORDER BY m.msg_time DESC, m.id DESC LIMIT 1)"
        + " WHERE c.id = #{id} AND c.tenant_id = #{tenantId}")
    int replayHead(@Param("tenantId") Long tenantId, @Param("id") Long id);
}
```

`upsertHead` 的入参是"临时组装的 head 行 + `unreadDelta`"，所以 Step 2 的实体上带了那个 `@TableField(exist = false)` 字段：Lombok 生成 getter，Mapper 只读它，MyBatis-Plus 的通用 CRUD 不会把它当列。

- [ ] **Step 4: 起服务让 Flyway 落地**

```bash
cd apps/server && set -o pipefail && ./mvnw -q -DskipTests package
java -jar target/scrm-server-0.1.0.jar > ../tmp/p6-server.log 2>&1 &
until curl -sf http://127.0.0.1:8180/api/health > /dev/null; do sleep 1; done
grep -a "Migrating schema\|Successfully applied" ../tmp/p6-server.log | tail -5
```

预期：日志出现 `Migrating schema ... to version "8 - chat history"` 与 `Successfully applied 1 migration`，且 `/api/health` 返回 `code:0`。若日志出现 Flyway 校验失败，说明 DDL 语法在本机 MySQL 8.0.45 上不成立——按报错改 SQL，**不要**手改 `flyway_schema_history`。

- [ ] **Step 5: 用 JDBC 单文件探针确认两张表可读且为空**

本机没有 mysql CLI，用 memory 里已验证过的 source-file 模式：

```java
// tmp/P6Tables.java
import java.sql.*;

public class P6Tables {
    public static void main(String[] a) throws Exception {
        String url = "jdbc:mysql://localhost:3306/smartscrm_react?useSSL=false&allowPublicKeyRetrieval=true";
        try (Connection c = DriverManager.getConnection(url, "root", "1234560");
             Statement s = c.createStatement()) {
            for (String t : new String[]{"chat_conversation", "chat_message"}) {
                try (ResultSet r = s.executeQuery("SELECT COUNT(*) FROM " + t)) {
                    r.next();
                    System.out.println(t + " rows=" + r.getInt(1));
                }
            }
            try (ResultSet r = s.executeQuery(
                "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='smartscrm_react'"
                    + " AND table_name='chat_message' AND column_name IN ('msg_key','uk_msg','send_local_id','status','source')")) {
                r.next();
                System.out.println("columns=" + r.getInt(1));
            }
        }
    }
}
```

Run: `java -cp "$HOME/.m2/repository/com/mysql/mysql-connector-j/9.1.0/mysql-connector-j-9.1.0.jar" tmp/P6Tables.java`（jar 版本号以 `ls ~/.m2/repository/com/mysql/mysql-connector-j/` 实际目录为准）

预期：`chat_conversation rows=0` / `chat_message rows=0` / `columns=4`（`uk_msg` 不是列，所以是 4；若打印 5 说明列名与计划不符，检查拼写）。这一步区分的是"表建出来了"与"表建错了列名"，不能只靠启动成功。

- [ ] **Step 6: 提交**

```bash
git add apps/server/src/main/resources/db/migration/V8__chat_history.sql \
        apps/server/src/main/java/com/smartscrm/server/entity \
        apps/server/src/main/java/com/smartscrm/server/mapper
git commit -m "feat(P6): V8 聊天记录两张表 + 幂等入库与会话头投影 SQL"
```

---

### Task 2: chat_key / 时间 / 状态阶梯的纯函数（JUnit TDD）

**Files:**
- Create: `apps/server/src/main/java/com/smartscrm/server/service/msg/ChatKeys.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/service/msg/MsgTimes.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/service/msg/StatusLadder.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/service/msg/SearchPattern.java`
- Create: `apps/server/src/test/java/com/smartscrm/server/service/msg/ChatKeysTest.java`
- Create: `apps/server/src/test/java/com/smartscrm/server/service/msg/MsgTimesTest.java`
- Create: `apps/server/src/test/java/com/smartscrm/server/service/msg/StatusLadderTest.java`
- Create: `apps/server/src/test/java/com/smartscrm/server/service/msg/SearchPatternTest.java`

**Interfaces:**
- Consumes: 无（纯函数，不依赖 Spring / MyBatis）。
- Produces:
  - `ChatKeys.platformOfAccountType(Integer) -> String`（1→`whatsapp`，4→`telegram`，其它→`null`）
  - `ChatKeys.matchesPlatform(String platform, String chatKey) -> boolean`（chat_key 形态归属校验）
  - `ChatKeys.isGroup(String chatKey) -> boolean`（`@g.us` 结尾，或 TG 的 `-100…` / `…@group` 形态）
  - `ChatKeys.peerPhoneOf(String chatKey) -> String|null`（`8613800001001@c.us` → `8613800001001`；群与非数字为 null）
  - `ChatKeys.normalizePhone(String raw) -> String|null`（丢弃 `+`、空格、`-`、括号，只留数字，空为 null）
  - `MsgTimes.toDbTime(Long epochSec, LocalDateTime receivedAt) -> LocalDateTime`
  - `StatusLadder.isLadder(String) -> boolean`（`pending|sent|delivered|read`）、`StatusLadder.isAllowedTarget(String) -> boolean`（阶梯 + `failed`）
  - `SearchPattern.like(String q) -> String|null`（非法查询返回 null）
  Task 3 的客户匹配、Task 4 的搜索都调它们。

  **`fromAck` 不在 Java 侧**：ack 数字只在 WhatsApp 页里出现，归一化发生在桥（`src/shared/chatStatus.ts`，Task 7），Java 只收到已经翻译好的状态字符串。Java 这边因此不需要重复实现阶梯比较，只需要判定"这个状态字符串能不能被写入"——真正的单调性由 `advanceStatus` 的 SQL 守卫把关（Task 3 Step 5 用一次逆序更新来验证它）。

- [ ] **Step 1: 先写四个失败的测试**

`ChatKeysTest.java`：

```java
package com.smartscrm.server.service.msg;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class ChatKeysTest {

    @Test
    void mapsPlatformTypes() {
        assertEquals("whatsapp", ChatKeys.platformOfAccountType(1));
        assertEquals("telegram", ChatKeys.platformOfAccountType(4));
        assertNull(ChatKeys.platformOfAccountType(7));
        assertNull(ChatKeys.platformOfAccountType(null));
    }

    @Test
    void extractsPeerPhoneFromWhatsappChatKey() {
        assertEquals("8613800001001", ChatKeys.peerPhoneOf("8613800001001@c.us"));
        assertEquals("15533445566778899", ChatKeys.peerPhoneOf("15533445566778899@lid"));
        assertNull(ChatKeys.peerPhoneOf("12036325554444@g.us"), "群聊没有对端号码");
        assertNull(ChatKeys.peerPhoneOf("tg_10002003"), "TG 的 open id 不是手机号");
        assertNull(ChatKeys.peerPhoneOf(null));
    }

    @Test
    void detectsGroups() {
        assertTrue(ChatKeys.isGroup("12036325554444@g.us"));
        assertTrue(ChatKeys.isGroup("-1001234567890"));
        assertFalse(ChatKeys.isGroup("8613800001001@c.us"));
        assertFalse(ChatKeys.isGroup(null));
    }

    @Test
    void normalizesPhoneForFallbackMatch() {
        assertEquals("8613800001001", ChatKeys.normalizePhone("+86 138-0000-1001"));
        assertEquals("8613800001001", ChatKeys.normalizePhone("8613800001001"));
        assertNull(ChatKeys.normalizePhone("   "));
        assertNull(ChatKeys.normalizePhone(null));
    }

    @Test
    void chatKeyShapeMustMatchTheAccountPlatform() {
        assertTrue(ChatKeys.matchesPlatform("whatsapp", "8613800001001@c.us"));
        assertTrue(ChatKeys.matchesPlatform("whatsapp", "12036325554444@g.us"));
        assertTrue(ChatKeys.matchesPlatform("whatsapp", "15533445566778899@lid"));
        assertFalse(ChatKeys.matchesPlatform("whatsapp", "-1001234567890"));
        assertFalse(ChatKeys.matchesPlatform("whatsapp", "8613800001001"));
        assertTrue(ChatKeys.matchesPlatform("telegram", "-1001234567890"));
        assertTrue(ChatKeys.matchesPlatform("telegram", "123456789"));
        assertFalse(ChatKeys.matchesPlatform("telegram", "8613800001001@c.us"));
        assertFalse(ChatKeys.matchesPlatform("whatsapp", null));
        assertFalse(ChatKeys.matchesPlatform(null, "8613800001001@c.us"));
    }
}
```

`MsgTimesTest.java`：

```java
package com.smartscrm.server.service.msg;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

import java.time.LocalDateTime;
import org.junit.jupiter.api.Test;

class MsgTimesTest {

    private static final LocalDateTime RECEIVED = LocalDateTime.of(2026, 9, 20, 12, 0, 0);

    @Test
    void convertsEpochSecondsInAsiaShanghaiBecauseThatIsTheJdbcSessionZone() {
        // 1_700_000_000 = 2023-11-14 22:13:20 UTC = 2023-11-15 06:13:20 Asia/Shanghai
        assertEquals(LocalDateTime.of(2023, 11, 15, 6, 13, 20),
            MsgTimes.toDbTime(1_700_000_000L, RECEIVED));
    }

    @Test
    void clampsZeroAndFutureAndNegativeToReceiveTime() {
        assertEquals(RECEIVED, MsgTimes.toDbTime(0L, RECEIVED));
        assertEquals(RECEIVED, MsgTimes.toDbTime(-5L, RECEIVED));
        assertEquals(RECEIVED, MsgTimes.toDbTime(null, RECEIVED));
        assertEquals(RECEIVED, MsgTimes.toDbTime(9_999_999_999L, RECEIVED), "未来时间戳不可信");
    }

    @Test
    void pastTimestampsAreKeptAsIs() {
        LocalDateTime past = MsgTimes.toDbTime(1_000_000_000L, RECEIVED);
        assertNotEquals(RECEIVED, past);
        assertEquals(2001, past.getYear());
    }
}
```

> **`pastTimestampsAreKeptAsIs` 只断年份，`convertsEpochSeconds…` 断到秒 —— 但开发机系统时区就是 +8，实现里误用 `ZoneId.systemDefault()` 两条都照样绿。**要把 Asia/Shanghai 真钉住，得让默认时区不等于它：在换区断言里临时 `TimeZone.setDefault(TimeZone.getTimeZone("UTC"))`、`@AfterEach` 还原，再断同一个 `06:13:20`。没有这条，"用了哪个时区"在本机是不可证的。

`StatusLadderTest.java`：

```java
package com.smartscrm.server.service.msg;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class StatusLadderTest {

    @Test
    void ladderHoldsTheOutboundStatesAndOnlyThose() {
        assertTrue(StatusLadder.isLadder("pending"));
        assertTrue(StatusLadder.isLadder("sent"));
        assertTrue(StatusLadder.isLadder("delivered"));
        assertTrue(StatusLadder.isLadder("read"));
        assertFalse(StatusLadder.isLadder("received"), "收到的行不在发出阶梯上");
        assertFalse(StatusLadder.isLadder("failed"), "failed 是终态，不参与只能往上走的比较");
        assertFalse(StatusLadder.isLadder(null));
    }

    @Test
    void writeTargetsAreTheLadderPlusFailed() {
        assertTrue(StatusLadder.isAllowedTarget("sent"));
        assertTrue(StatusLadder.isAllowedTarget("failed"));
        assertFalse(StatusLadder.isAllowedTarget("received"));
        assertFalse(StatusLadder.isAllowedTarget(""));
        assertFalse(StatusLadder.isAllowedTarget(null));
    }
}
```

> 阶梯的**顺序**只在两处落地：`ChatMessageMapper.advanceStatus` 里的 `FIELD(status,'pending','sent','delivered','read')`，以及 Task 7 的 `chatStatus.ts`（页内 ack → 状态）。本类只回答"这个词是不是发出状态"，所以它不需要重复审一遍比较。


`SearchPatternTest.java`：

```java
package com.smartscrm.server.service.msg;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import org.junit.jupiter.api.Test;

class SearchPatternTest {

    @Test
    void wrapsAndEscapesWildcards() {
        assertEquals("%100\\%\\_off%", SearchPattern.like("100%_off"));
        assertEquals("%\\\\backslash%", SearchPattern.like("\\backslash"));
    }

    @Test
    void rejectsBlankAndPureWildcardQueries() {
        assertNull(SearchPattern.like(null));
        assertNull(SearchPattern.like("   "));
        assertNull(SearchPattern.like("%"));
        assertNull(SearchPattern.like("_"));
        assertNull(SearchPattern.like("%_%"));
    }
}
```

- [ ] **Step 2: 跑测试，确认失败**

```bash
cd apps/server && set -o pipefail && ./mvnw -q test -Dtest='ChatKeysTest,MsgTimesTest,StatusLadderTest,SearchPatternTest' 2>&1 | tail -20
```

预期：编译失败，`找不到符号 ChatKeys` 之类。这一步必须真的红，才算断言写在了代码之前。

- [ ] **Step 3: 写实现**

```java
// ChatKeys.java
package com.smartscrm.server.service.msg;

import java.util.regex.Pattern;

/** chat_key 语义的唯一解释处：WhatsApp 的 <digits>@c.us / <digits>@g.us 与 Telegram 的数字 / tg_ 形态。 */
public final class ChatKeys {

    private static final Pattern WA_PEER = Pattern.compile("^(\\d{5,20})@(c\\.us|lid|s\\.wallet)$");
    private static final Pattern WA_GROUP = Pattern.compile("^[\\d-]{5,25}(-\\d+)?@g\\.us$");
    private static final Pattern TG_CHAT = Pattern.compile("^-?\\d{4,20}$");
    private static final Pattern DIGITS = Pattern.compile("\\d");

    private ChatKeys() {
    }

    /** platform_type → 库里的 platform 列值；未支持的平台返回 null，调用方据此拒绝入库。 */
    public static String platformOfAccountType(Integer platformType) {
        if (platformType == null) {
            return null;
        }
        return switch (platformType) {
            case 1 -> "whatsapp";
            case 4 -> "telegram";
            default -> null;
        };
    }

    /**
     * chat_key 的形态必须属于账号所在平台。错了不拦的话，一个 viewId→accountId 的错映射
     * 会把 WhatsApp 会话写进 Telegram 账号名下，而 uk_msg 视其为不同行——脏数据无法自愈。
     */
    public static boolean matchesPlatform(String platform, String chatKey) {
        if (platform == null || chatKey == null || chatKey.isBlank()) {
            return false;
        }
        return switch (platform) {
            case "whatsapp" -> WA_PEER.matcher(chatKey).matches() || WA_GROUP.matcher(chatKey).matches();
            case "telegram" -> TG_CHAT.matcher(chatKey).matches();
            default -> false;
        };
    }

    /** 群判定只看形态：WA 用 @g.us 后缀，TG 用负号前缀（-100… 是超级群的既定前缀）。 */
    public static boolean isGroup(String chatKey) {
        if (chatKey == null || chatKey.isBlank()) {
            return false;
        }
        return chatKey.endsWith("@g.us") || chatKey.startsWith("-100") || chatKey.endsWith("@group");
    }

    /** 单聊对端的裸号码；非 WhatsApp 单聊与群聊都是 null。 */
    public static String peerPhoneOf(String chatKey) {
        if (chatKey == null) {
            return null;
        }
        var m = WA_PEER.matcher(chatKey);
        return m.matches() ? m.group(1) : null;
    }

    /** 两侧都归一到纯数字再比，因为种子里 phone 带 '+'、chat_key 前缀不带。 */
    public static String normalizePhone(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        StringBuilder sb = new StringBuilder(raw.length());
        for (int i = 0; i < raw.length(); i++) {
            char ch = raw.charAt(i);
            if (DIGITS.matcher(String.valueOf(ch)).matches()) {
                sb.append(ch);
            }
        }
        return sb.isEmpty() ? null : sb.toString();
    }
}
```

```java
// MsgTimes.java
package com.smartscrm.server.service.msg;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;

/**
 * 页内上报的是 unix 秒。库里的 DATETIME(3) 与 JDBC 会话时区成对，
 * 所以这里固定的 Asia/Shanghai 必须与 application.yml 里 jdbc url 的 serverTimezone 一致。
 */
public final class MsgTimes {

    public static final ZoneId CHAT_ZONE = ZoneId.of("Asia/Shanghai");
    /** 允许的最大未来偏移：手机与电脑时钟总有偏差，超过这个就当不可信。 */
    private static final long FUTURE_SLACK_SEC = 300;

    private MsgTimes() {
    }

    public static LocalDateTime toDbTime(Long epochSec, LocalDateTime receivedAt) {
        if (epochSec == null || epochSec <= 0) {
            return receivedAt;
        }
        long nowSec = receivedAt.atZone(CHAT_ZONE).toEpochSecond();
        if (epochSec > nowSec + FUTURE_SLACK_SEC) {
            return receivedAt;
        }
        return LocalDateTime.ofInstant(Instant.ofEpochSecond(epochSec), CHAT_ZONE);
    }
}
```

```java
// StatusLadder.java
package com.smartscrm.server.service.msg;

import java.util.Set;

/**
 * 发出消息的状态词表。顺序比较不在这里做——写库的单调性由
 * ChatMessageMapper.advanceStatus 的 FIELD() 守卫负责，页内 ack 的翻译由
 * desktop 的 src/shared/chatStatus.ts 负责，这里只回答"这个词是不是发出状态"。
 */
public final class StatusLadder {

    private static final Set<String> LADDER = Set.of("pending", "sent", "delivered", "read");

    private StatusLadder() {
    }

    public static boolean isLadder(String status) {
        return status != null && LADDER.contains(status);
    }

    /** 允许被写入的状态：阶梯上的四个 + 终态 failed。 */
    public static boolean isAllowedTarget(String status) {
        return isLadder(status) || "failed".equals(status);
    }
}
```

```java
// SearchPattern.java
package com.smartscrm.server.service.msg;

/** 搜索词 → LIKE 模式。全表 LIKE 是本阶段刻意选择的简单方案（本地量级够用）。 */
public final class SearchPattern {

    private SearchPattern() {
    }

    public static String like(String q) {
        if (q == null) {
            return null;
        }
        String trimmed = q.trim();
        if (trimmed.isEmpty() || trimmed.replace("%", "").replace("_", "").isEmpty()) {
            return null;
        }
        String escaped = trimmed.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
        return "%" + escaped + "%";
    }
}
```

- [ ] **Step 4: 跑测试，确认全绿**

```bash
cd apps/server && set -o pipefail && ./mvnw -q test -Dtest='ChatKeysTest,MsgTimesTest,StatusLadderTest,SearchPatternTest' 2>&1 | tail -20
```

预期：`Tests run: 12, Failures: 0, Errors: 0`（ChatKeys 5 + MsgTimes 3 + StatusLadder 2 + SearchPattern 2）。

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/main/java/com/smartscrm/server/service/msg apps/server/src/test/java/com/smartscrm/server/service/msg
git commit -m "feat(P6): chat_key 归一、消息时间钳制、状态阶梯与搜索转义的纯函数"
```

---

### Task 3: 批量入库 + 会话头投影 + 客户匹配（`POST /api/messages/batch`、`POST /api/messages/status`）

**Files:**
- Create: `apps/server/src/main/java/com/smartscrm/server/service/MessageService.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/web/MessageController.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/web/dto/MessageBatchDTO.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/web/dto/MessageItemDTO.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/web/dto/MessageStatusDTO.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/web/dto/StatusUpdateDTO.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/web/vo/BatchAcceptVO.java`
- Modify: `apps/server/src/main/java/com/smartscrm/server/service/msg/ChatKeys.java`（如需补 helper）

**Interfaces:**
- Consumes: Task 1 的两个 Mapper 与实体；Task 2 的 `ChatKeys` / `MsgTimes` / `StatusLadder`；既有 `PlatformAccountMapper`（校验账号属于本租户）、`CustomerMapper`（匹配）、`ApiResponse` / `BizException` / `AuthPrincipal`。
- Produces:
  - `MessageService.accept(Long tenantId, MessageBatchDTO dto) -> BatchAcceptVO`
  - `MessageService.applyStatus(Long tenantId, MessageStatusDTO dto) -> int`（返回真正推进的行数）
  - `MessageService.resolveAccount(Long tenantId, Long accountId) -> ResolvedAccount(accountId, platform, platformType)`：账号必须属于本租户且平台在 P6 支持面内，否则抛 `BizException`。Task 4 的查询面与 Task 3 的写入口共用它。
  - HTTP：`POST /api/messages/batch` → `{accepted,duplicated,rejected,reasons}`；`POST /api/messages/status` → `{updated}`。Task 9 的 CollectorHub 只认这两个形状。
  - `MessageItemDTO` 字段（Task 7 的 `NormalizedMessage` 必须与之逐字对齐）：`chatKey, msgKey, direction, senderKey, senderName, body, mediaType, mediaSummary, msgTimeEpochSec, status, source, sendLocalId, chatTitle`；`MessageBatchDTO`：`accountId, activeChatKey, messages[]`。

  为避免"客户端声明什么就算什么"，`platform` 与 `chatKey` 的合法性一律由后端按 `accountId` 对应的 `platform_type` 复核（不信任请求里的 platform）。

- [ ] **Step 1: DTO**

```java
// MessageItemDTO.java
package com.smartscrm.server.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** 一条归一化消息。字段名与桌面端 src/shared/chatTypes.ts 的 NormalizedMessage 一一对应。 */
public record MessageItemDTO(
    @NotBlank @Size(max = 128) String chatKey,
    @NotBlank @Size(max = 128) String msgKey,
    @NotBlank String direction,
    @Size(max = 128) String senderKey,
    @Size(max = 128) String senderName,
    String body,
    String mediaType,
    @Size(max = 256) String mediaSummary,
    @NotNull Long msgTimeEpochSec,
    String status,
    @NotBlank String source,
    @Size(max = 64) String sendLocalId,
    @Size(max = 256) String chatTitle
) {
}
```

```java
// MessageBatchDTO.java
package com.smartscrm.server.web.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

public record MessageBatchDTO(
    @NotNull Long accountId,
    /** 当前视图里正打开的会话：不属于它的 in 消息才计未读。 */
    String activeChatKey,
    @NotEmpty @Size(max = 500) List<@Valid MessageItemDTO> messages
) {
}
```

`MessageStatusDTO`（`accountId` + `chatKey` + `updates[]`）与 `StatusUpdateDTO`（`msgKey` + `status`）同风格：

```java
public record MessageStatusDTO(@NotNull Long accountId, @NotBlank @Size(max = 128) String chatKey,
                               @NotEmpty @Size(max = 200) List<@Valid StatusUpdateDTO> updates) {}

public record StatusUpdateDTO(@NotBlank @Size(max = 128) String msgKey, @NotBlank String status) {}
```

```java
// BatchAcceptVO.java
package com.smartscrm.server.web.vo;

import java.util.List;

public record BatchAcceptVO(int accepted, int duplicated, int rejected, List<String> reasons) {
}
```

- [ ] **Step 2: `MessageService`**

```java
package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.ChatConversation;
import com.smartscrm.server.entity.ChatMessage;
import com.smartscrm.server.entity.Customer;
import com.smartscrm.server.entity.PlatformAccount;
import com.smartscrm.server.mapper.ChatConversationMapper;
import com.smartscrm.server.mapper.ChatMessageMapper;
import com.smartscrm.server.mapper.CustomerMapper;
import com.smartscrm.server.mapper.PlatformAccountMapper;
import com.smartscrm.server.service.msg.ChatKeys;
import com.smartscrm.server.service.msg.MsgTimes;
import com.smartscrm.server.service.msg.StatusLadder;
import com.smartscrm.server.web.dto.MessageBatchDTO;
import com.smartscrm.server.web.dto.MessageItemDTO;
import com.smartscrm.server.web.dto.MessageStatusDTO;
import com.smartscrm.server.web.dto.StatusUpdateDTO;
import com.smartscrm.server.web.vo.BatchAcceptVO;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MessageService {

    private static final Set<String> DIRECTIONS = Set.of("in", "out");
    private static final Set<String> SOURCES =
        Set.of("live", "backfill", "app_send", "native_send");
    /** 通知类系统行不进聊天记录，它们既不可回复也没有正文。 */
    private static final Set<String> SKIPPED_TYPES = Set.of("gp2", "e2e_notification", "revoked");
    /** media_type 是 VARCHAR(16)，取值就是列注释那九个；清单外的一律降级，不让原样字符串碰 SQL。 */
    private static final Set<String> MEDIA_TYPES = Set.of(
        "text", "image", "audio", "video", "document", "sticker", "contact", "location", "unknown");

    private final ChatMessageMapper messageMapper;
    private final ChatConversationMapper conversationMapper;
    private final CustomerMapper customerMapper;
    private final PlatformAccountMapper accountMapper;

    public MessageService(ChatMessageMapper messageMapper, ChatConversationMapper conversationMapper,
                          CustomerMapper customerMapper, PlatformAccountMapper accountMapper) {
        this.messageMapper = messageMapper;
        this.conversationMapper = conversationMapper;
        this.customerMapper = customerMapper;
        this.accountMapper = accountMapper;
    }

    public record ResolvedAccount(Long accountId, String platform, Integer platformType) {}

    /** 账号必须属于本租户，且平台在 P6 支持面内；否则整批拒绝。 */
    public ResolvedAccount resolveAccount(Long tenantId, Long accountId) {
        PlatformAccount account = accountMapper.selectById(accountId);
        if (account == null || !tenantId.equals(account.getTenantId())) {
            throw new BizException(40404, "账号不存在: " + accountId);
        }
        String platform = ChatKeys.platformOfAccountType(account.getPlatformType());
        if (platform == null) {
            throw new BizException(40000, "该平台暂不支持消息采集: " + account.getPlatformType());
        }
        return new ResolvedAccount(accountId, platform, account.getPlatformType());
    }

    @Transactional
    public BatchAcceptVO accept(Long tenantId, MessageBatchDTO dto) {
        ResolvedAccount account = resolveAccount(tenantId, dto.accountId());
        LocalDateTime receivedAt = LocalDateTime.now(MsgTimes.CHAT_ZONE).truncatedTo(ChronoUnit.MILLIS);
        List<MessageItemDTO> items = dto.messages();
        List<ChatMessage> rows = new ArrayList<>(items.size());
        Set<String> seenInBatch = new HashSet<>();
        List<String> reasons = new ArrayList<>();
        int rejected = 0;

        for (MessageItemDTO item : items) {
            if (!DIRECTIONS.contains(item.direction()) || !SOURCES.contains(item.source())) {
                rejected++;
                reasons.add(item.msgKey() + ": direction/source 非法");
                continue;
            }
            if (SKIPPED_TYPES.contains(item.mediaType())) {
                rejected++;
                continue;
            }
            if (!ChatKeys.matchesPlatform(account.platform(), item.chatKey())) {
                rejected++;
                reasons.add(item.msgKey() + ": chat_key 与平台不匹配");
                continue;
            }
            String dedupeKey = item.chatKey() + "|" + item.msgKey();
            if (!seenInBatch.add(dedupeKey)) {
                rejected++;
                reasons.add(item.msgKey() + ": 同批重复");
                continue;
            }
            ChatMessage row = new ChatMessage();
            row.setTenantId(tenantId);
            row.setAccountId(account.accountId());
            row.setPlatform(account.platform());
            row.setChatKey(item.chatKey());
            row.setMsgKey(item.msgKey());
            row.setDirection(item.direction());
            row.setCustomerId(matchCustomer(tenantId, account.platformType(), item.chatKey()));
            row.setSenderKey(item.senderKey());
            row.setSenderName(item.senderName());
            row.setBody(item.body() == null || item.body().isBlank() ? null : item.body());
            row.setMediaType(normalizeMediaType(item.mediaType()));
            row.setMediaSummary(item.mediaSummary());
            row.setMsgTime(MsgTimes.toDbTime(item.msgTimeEpochSec(), receivedAt));
            row.setStatus(normalizeStatus(item.status(), item.direction()));
            row.setSource(item.source());
            row.setSendLocalId(item.sendLocalId());
            rows.add(row);
        }

        int accepted = 0;
        int duplicated = 0;
        for (ChatMessage row : rows) {
            // "是否新行"交给 SQL 的 affected rows：1 = 插入，0 = 被 uk_msg 忽略。
            // 会话头只由新行推动，重复行不能再加一次未读。
            // 2026-09-20 一次性 @SpringBootTest 探针实测（跑完已删）：单行新增 1、单行重复 0、
            // 两行里一条重复 1、两行全重复 0 —— 逐行调用与整批调用都成立，
            // 所以将来若改回"整批一次 insert"，duplicated 只能按 `提交条数 - affected rows` 算。
            if (messageMapper.insertIgnoreBatch(List.of(row)) != 1) {
                duplicated++;
                continue;
            }
            accepted++;
            ChatConversation head = new ChatConversation();
            head.setTenantId(tenantId);
            head.setAccountId(row.getAccountId());
            head.setPlatform(row.getPlatform());
            head.setChatKey(row.getChatKey());
            head.setTitle(titleOf(items, row.getChatKey()));
            head.setIsGroup(ChatKeys.isGroup(row.getChatKey()) ? 1 : 0);
            head.setCustomerId(row.getCustomerId());
            head.setLastMsgTime(row.getMsgTime());
            head.setLastMsgBody(row.getBody() != null ? row.getBody() : row.getMediaSummary());
            head.setUnreadDelta(unreadDelta(row, dto.activeChatKey()));
            conversationMapper.upsertHead(head);
        }
        return new BatchAcceptVO(accepted, duplicated, rejected, reasons.stream().limit(20).toList());
    }
```

四个私有方法接在同一个类里：

```java
    /** 一个批次可能跨多个会话，所以标题按 chatKey 取，不能取"批内第一个非空"。 */
    private String titleOf(List<MessageItemDTO> items, String chatKey) {
        return items.stream()
            .filter(i -> chatKey.equals(i.chatKey()))
            .map(MessageItemDTO::chatTitle)
            .filter(t -> t != null && !t.isBlank())
            .findFirst()
            .orElse(null);
    }

    /** 只有"别人发的 + 单聊 + 不是当前正打开的会话 + 实时来源"才 +1：补采历史不制造未读。 */
    private int unreadDelta(ChatMessage row, String activeChatKey) {
        boolean inbound = "in".equals(row.getDirection());
        boolean oneToOne = !ChatKeys.isGroup(row.getChatKey());
        boolean notActive = !row.getChatKey().equals(activeChatKey == null ? "" : activeChatKey);
        return inbound && oneToOne && notActive && "live".equals(row.getSource()) ? 1 : 0;
    }

    /** in 一律 received；out 只接受阶梯上的值，其它一律退回 pending。 */
    private String normalizeStatus(String status, String direction) {
        if ("in".equals(direction)) {
            return "received";
        }
        if ("failed".equals(status) || StatusLadder.isLadder(status)) {
            return status;
        }
        return "pending";
    }

    /**
     * 媒体类型是展示元数据，不是身份：认不出来的值降级成 unknown，让这条消息照样入库
     * （正文可能仍然有价值），而不是整行丢掉。但不能原样透传 —— 该列只有 16 个字符，
     * 而 INSERT IGNORE 会把超长值静默截成前 16 个字符：既没有报错也没有日志，
     * 事后从库里读出一个谁也对不上的半截类型名。降级至少是可解释的。
     */
    private String normalizeMediaType(String raw) {
        if (raw == null || raw.isBlank()) {
            return "text";
        }
        return MEDIA_TYPES.contains(raw) ? raw : "unknown";
    }

    /** open_id 与 chat_key 同形（种子里就是 8613800001001@c.us），手机号只做兜底。 */
    private Long matchCustomer(Long tenantId, Integer platformType, String chatKey) {
        Customer byOpenId = customerMapper.selectOne(new LambdaQueryWrapper<Customer>()
            .eq(Customer::getTenantId, tenantId)
            .eq(Customer::getPlatformType, platformType)
            .eq(Customer::getOpenId, chatKey)
            .last("LIMIT 1"));
        if (byOpenId != null) {
            return byOpenId.getId();
        }
        String phone = ChatKeys.peerPhoneOf(chatKey);
        if (phone == null) {
            return null;
        }
        return customerMapper.selectList(new LambdaQueryWrapper<Customer>()
                .eq(Customer::getTenantId, tenantId)
                .eq(Customer::getPlatformType, platformType))
            .stream()
            .filter(c -> phone.equals(ChatKeys.normalizePhone(c.getPhone())))
            .map(Customer::getId)
            .findFirst()
            .orElse(null);
    }
```

状态推进：

```java
    /**
     * 状态推进不查当前行：阶梯守卫整条放在 SQL 里（advanceStatus），affected rows 就是
     * 真正推进的条数。被挡住的乱序 ack 计不进 updated，也不报错——它是常态。
     */
    @Transactional
    public int applyStatus(Long tenantId, MessageStatusDTO dto) {
        ResolvedAccount account = resolveAccount(tenantId, dto.accountId());
        int updated = 0;
        for (StatusUpdateDTO u : dto.updates()) {
            String to = u.status();
            if (!StatusLadder.isAllowedTarget(to)) {
                throw new BizException(40000, "status 只能是 pending|sent|delivered|read|failed");
            }
            updated += messageMapper.advanceStatus(tenantId, account.platform(), account.accountId(),
                dto.chatKey(), u.msgKey(), to);
        }
        return updated;
    }
```

- [ ] **Step 3: Controller**

```java
package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.MessageService;
import com.smartscrm.server.web.dto.MessageBatchDTO;
import com.smartscrm.server.web.dto.MessageStatusDTO;
import com.smartscrm.server.web.vo.BatchAcceptVO;
import jakarta.validation.Valid;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/messages")
public class MessageController {

    private final MessageService service;

    public MessageController(MessageService service) {
        this.service = service;
    }

    @PostMapping("/batch")
    public ApiResponse<BatchAcceptVO> batch(@AuthenticationPrincipal AuthPrincipal principal,
                                            @Valid @RequestBody MessageBatchDTO dto) {
        return ApiResponse.ok(service.accept(principal.tenantId(), dto));
    }

    @PostMapping("/status")
    public ApiResponse<Map<String, Integer>> status(@AuthenticationPrincipal AuthPrincipal principal,
                                                    @Valid @RequestBody MessageStatusDTO dto) {
        return ApiResponse.ok(Map.of("updated", service.applyStatus(principal.tenantId(), dto)));
    }
}
```

- [ ] **Step 4: 编译 + 重启 + 契约探针**

```bash
cd apps/server && set -o pipefail && ./mvnw -q -DskipTests package
```

按 C8 换掉 8180 上的旧进程后，用 Write 工具落 `tmp/p6a-batch.json`（UTF-8，含一条中文正文）：

```json
{
  "accountId": 1,
  "activeChatKey": "8613800001002@c.us",
  "messages": [
    {"chatKey":"8613800001001@c.us","msgKey":"false_8613800001001@c.us_ABC1","direction":"in",
     "body":"你好，我想问下订单","mediaType":"text","msgTimeEpochSec":1759000000,"source":"live","chatTitle":"Alice 张"},
    {"chatKey":"8613800001002@c.us","msgKey":"true_8613800001002@c.us_ABC2","direction":"out",
     "body":"ok","mediaType":"text","msgTimeEpochSec":1759000100,"status":"sent","source":"app_send","chatTitle":"Bob 李"}
  ]
}
```

（`accountId` 不写死：**先登录、再 `GET /api/platform-accounts` 拿当次真实的 id**，把上面 JSON 里的 `accountId` 换成 WhatsApp 那条（`platformType:1`）。种子那两条 id 是 1/2，但演示账号会被删被建，按 1 发会直接吃 `40404 账号不存在`，那是一次空跑而不是被测行为。2026-09-20 实测：WA=7、TG=2、Facebook=6、Messenger=9。同一份输出里的 TG id 留给下面"平台反查"那一条用。）

```bash
tok=$(curl -s -X POST http://127.0.0.1:8180/api/auth/login -H 'content-type: application/json' \
  --data-binary '{"inviteCode":"DEMO0001","username":"admin","password":"admin123","deviceId":"p6-probe"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.accessToken))")
curl -s -X POST http://127.0.0.1:8180/api/messages/batch -H "authorization: Bearer $tok" -H 'content-type: application/json' \
  --data-binary @tmp/p6a-batch.json
curl -s -X POST http://127.0.0.1:8180/api/messages/batch -H "authorization: Bearer $tok" -H 'content-type: application/json' \
  --data-binary @tmp/p6a-batch.json
```

预期（顺序敏感，这一对就是幂等的区分性证据）：第一次 `{"accepted":2,"duplicated":0,"rejected":0,...}`；第二次 `{"accepted":0,"duplicated":2,"rejected":0}`。若第二次仍是 `accepted:2`，说明 `uk_msg` 没生效或 `insertIgnoreBatch` 被改成了普通 insert——回去读 Task 1 的 DDL。

> **两行的落库结果都要读出来，不能只看计数。** 本任务还没有读接口（`GET /api/messages`、会话列表都是 Task 4），所以这一步用一次性探针看库里两行：临时 `@SpringBootTest`（autowire `ChatConversationMapper` 或直接 `JdbcTemplate`，跑完即删、不进 `src/test`，与 Task 1 那次阶梯探针同一个口径）打印两条会话头的 `customer_id / unread_count / last_msg_body / title`。期望 Alice 那条 `customer_id` **非空且等于种子里 Alice 的客户 id**、`unread_count=1`；Bob 那条因为正是 `activeChatKey` → `unread_count=0`；`title` 落在各自会话上（证明 `titleOf` 按 chatKey 取，而不是"批内第一个非空"）。`customer_id` 是这一节唯一能区分"匹配规则真在跑"和"整批默默不匹配"的字段——只看 `accepted` 两种情况长得一样。Task 4 的契约矩阵会把这些字段改从 HTTP 再断一次，那时探针不必存在。

> **"账号不存在"与"该平台不支持采集"必须是两个 code。** 用 Facebook / Messenger 那条账号（`platformType` 5 / 6，`ChatKeys.platformOfAccountType` 返回 null）重发同一批 → `40000 该平台暂不支持消息采集`；用一个不存在的 id → `40404 账号不存在`。两条各打一次，把两个 message 原文贴进报告。合在一起的话，前端只能把"这台号还没接"显示成"号没了"。

> **认不出的媒体类型降级成 `unknown`，且必须看得见降级发生了。** **另发一批**（别混进上面那两行：混进去 `accepted` 就从 2 变 3，幂等那一对读数的口径就糊了）里放一条 `mediaType:"group_participant_add"`（21 字符，页内系统消息的真实原名）：预期它**照样 accepted**（媒体类型不是身份，不该为它丢正文），而探针里那一行的 `media_type` 是 `unknown` 而不是 `group_participa`。这一条区分的是两种"看起来都成功了"：有 `normalizeMediaType` 时读到 `unknown`，没有时 `INSERT IGNORE` 把超长值静默截成 16 字符照样返回成功 —— 少这道闸，Task 11 的图标映射会对上一个库里谁也没写过的半截类型名。

> **chat_key 与平台不匹配要整条拒掉，不是入库后再发现。** 把 `accountId` 换成 TG 账号 id 再发同一批，预期 `{"accepted":0,"duplicated":0,"rejected":2,"reasons":[...chat_key 与平台不匹配...]}`：`86…@c.us` 是 WhatsApp 形态，Telegram 的 chat id 是纯数字（群是 `-100…`）。没有这条判定，一个错配的 viewId→accountId 映射会把 WA 会话写进 TG 账号名下，而 `uk_msg` 会把它们当成不同行，永远查不出重复。这一条同时也是"`platform` 由账号反查、不信任请求字段"的证据：整批被拒后库里不该出现任何 `platform='telegram'` 且 `chat_key='86…@c.us'` 的行。

- [ ] **Step 5: 状态推进契约**

```bash
curl -s -X POST http://127.0.0.1:8180/api/messages/status -H "authorization: Bearer $tok" \
  -H 'content-type: application/json' \
  --data-binary '{"accountId":1,"chatKey":"8613800001002@c.us","updates":[{"msgKey":"true_8613800001002@c.us_ABC2","status":"delivered"},{"msgKey":"true_8613800001002@c.us_ABC2","status":"sent"}]}'
```

预期：`{"updated":1}` —— 两条更新里只有 `delivered` 落地，随后那条 `sent` 被 `advanceStatus` 的阶梯守卫挡成 0 行受影响。（若打印 2，说明守卫里的 `FIELD()` 比较反了或 `direction='out'` 条件丢了。）

（本步三条 curl 里的 `accountId` 与 `chatKey` 都沿用 Step 4 现取到的 WA 账号 id 和 Bob 那条会话，占位的 `1` 会直接吃 `40404`。）

> **再加一组：已落定的 `failed` 不得被迟到 ack 翻案。** 这一组**必须换一条自己的 msgKey**，不能接着用 `ABC2`：上面那条 curl 已经把 `ABC2` 推到 `delivered`，而 `failed` 只允许从 `pending`/`sent` 落定——同一条 msgKey 上"`failed` 能落地"与"`delivered` 不被 `failed` 翻案"两个期望永远不可能同时成立，写在一起就是一次自相矛盾的空跑。
>
> 落法：用 Write 工具另落 `tmp/p6a-abc3.json`（与 Step 4 同一形状，`accountId` 用现取值），里面只放一条 out 行——`chatKey:"8613800001002@c.us"`、`msgKey:"true_8613800001002@c.us_ABC3"`、`status:"pending"`、`body:"retry-me"`、`msgTimeEpochSec` 比 `ABC2` 早（顺带压一次 `upsertHead` 的时间守卫：会话头的预览不该被这条更晚入库、更早发生的行顶掉）。`POST /api/messages/batch` 它，预期 `{"accepted":1,"duplicated":0,"rejected":0}`。然后在这条**新的 `pending` 行**上按顺序打三次 `/api/messages/status`：`{"msgKey":"…ABC3","status":"failed"}` → `updated:1`；再 `sent` → `updated:0`；再 `delivered` → `updated:0`。终态用 Step 4 那个一次性探针读（本任务还没有读接口，`GET /api/messages` 是 Task 4），期望库里 `ABC3` 的 `status` 仍是 `failed`。这一组区分的是"回头路一律挡住"与"`sent`/`delivered` 数字比 `failed` 大所以能覆盖失败"——少了它，Task 12 的"重试"会对着一条已经变成 delivered 的气泡显示"发送失败请重试"。

再打一次终态断言（回到 `ABC2`，它现在是 `delivered`）：

```bash
curl -s -X POST http://127.0.0.1:8180/api/messages/status -H "authorization: Bearer $tok" \
  -H 'content-type: application/json' \
  --data-binary '{"accountId":1,"chatKey":"8613800001002@c.us","updates":[{"msgKey":"true_8613800001002@c.us_ABC2","status":"failed"}]}'
```

预期：`{"updated":0}`。这一行现在是 `delivered`，`failed` 只允许从 `pending`/`sent` 落定——区分的是"守卫只挡回头路"与"守卫连失败也一并按大小比"。

- [ ] **Step 6: 提交**

```bash
git add apps/server/src/main/java/com/smartscrm/server apps/server/src/main/java/com/smartscrm/server/web
git commit -m "feat(P6): 批量入库与会话头投影 + 发送状态单调推进"
```

---

### Task 4: 查询面（会话列表 / 会话内翻页 / 全局搜索 / 统计 / 清未读 / 重算会话头）

**Files:**
- Create: `apps/server/src/main/java/com/smartscrm/server/service/MessageQueryService.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/service/msg/Cursors.java`
- Create: `apps/server/src/test/java/com/smartscrm/server/service/msg/CursorsTest.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/web/vo/ConversationVO.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/web/vo/ConversationPageVO.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/web/vo/MessageVO.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/web/vo/MessagePageVO.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/web/vo/MessageSearchVO.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/web/vo/MessageStatsVO.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/web/vo/DayCountVO.java`
- Create: `apps/server/src/main/java/com/smartscrm/server/web/ConversationController.java`
- Modify: `apps/server/src/main/java/com/smartscrm/server/web/MessageController.java`（补 GET 三个端点）
- Modify: `apps/server/src/main/java/com/smartscrm/server/service/MessageService.java`（只动一处：客户匹配按批复用，见下面那条口径）
- Modify: `apps/server/src/main/java/com/smartscrm/server/mapper/ChatMessageMapper.java`（补 `linkCustomer` 用的批量回填由服务层用 wrapper 完成，本任务不新增 SQL；若 Step 4 需要按 chat_key 批量取 customerId 再加）

**Interfaces:**
- Consumes: Task 1 的两个 Mapper 与实体；Task 2 的 `SearchPattern`；Task 3 的 `MessageService.resolveAccount(tenantId, accountId) -> ResolvedAccount(accountId, platform, platformType)`。
- Produces（Task 13 的渲染层类型逐字对齐这里）：
  - `GET /api/conversations?accountId&platform&q&cursor&size` → `ConversationPageVO(ConversationVO[] records, String nextCursor, boolean hasMore)`
  - `GET /api/messages?accountId&chatKey&before&around&size` → `MessagePageVO(MessageVO[] records, String nextCursor, boolean hasMore)`（**records 按 msg_time 正序返回**，游标本身是倒序取页；前端不用再 reverse。`around=<消息行 id>` 把窗口定位到那条消息上，它自己是本页**最后**一条；`before` 与 `around` 同时给时 `around` 优先。Task 16 的"从搜索结果跳进会话并锚定"只用这一个参数，前端不自己拼游标串）
  - `GET /api/messages/search?q&platform&accountId&direction&from&to&customerId&cursor&size` → `MessageSearchVO(SearchHitVO[] records, String nextCursor, boolean hasMore)`，`SearchHitVO(MessageVO message, Long conversationId, String chatTitle)`（三个分页 VO 的列表字段一律叫 `records`，渲染层不要按 spec 里的 `hits` 取值）
  - `GET /api/messages/stats?accountId&days` → `MessageStatsVO(long total, long inCount, long outCount, long activeConversations, DayCountVO[] perDay)`，`DayCountVO(String day, long inCount, long outCount)`
  - `POST /api/conversations/{id}/read` → `{cleared: 0|1}`
  - `POST /api/conversations/{id}/replay-head` → `ConversationVO`
  - `ConversationVO(Long id, Long accountId, String platform, String chatKey, String title, Boolean isGroup, Long customerId, LocalDateTime lastMsgTime, String lastMsgBody, Integer unreadCount)`
  - `MessageVO(Long id, Long accountId, String platform, String chatKey, String msgKey, String direction, Long customerId, String senderKey, String senderName, String body, String mediaType, String mediaSummary, LocalDateTime msgTime, String status, String source, String sendLocalId)`
  - `Cursors.encode(LocalDateTime time, long id) -> String`（`"<epochMillis>:<id>"`）、`Cursors.decode(String) -> Pos(LocalDateTime time, long id) | null`

> **顺手收掉 Task 3 评审带出的一条：入库侧的客户匹配要按批复用。** `MessageService:108` 现在是**每条消息**调一次 `matchCustomer`，而它内部的手机号兜底那条分支要 `selectList` 全租户该平台客户再在内存里比（`MessageService.java:231-239`）。补底一批的上限是 500 条，同一会话的消息占绝大多数——不改，Task 11 点一次「同步历史」就是几百次重复点查加若干次全表扫。落法（就在 `accept` 的行构造循环里，不新增类）：
>
> ```java
>         // 一批里同一会话的归属只算一次：绝大多数批次只有两三个 chatKey，
>         // 而手机号兜底那条分支是"读全租户客户再比"，每条都跑一遍就是把补底变成扫库。
>         Map<String, Long> customerByChat = new HashMap<>();
>     // 循环内替换原来的 row.setCustomerId(matchCustomer(...))：
>         String ck = item.chatKey();
>         if (!customerByChat.containsKey(ck)) {
>             customerByChat.put(ck, matchCustomer(tenantId, account.platformType(), ck));
>         }
>         row.setCustomerId(customerByChat.get(ck));
> ```
>
> `containsKey` 那一步不能省成 `computeIfAbsent`：匹配不到客户时值是 `null`，而 `computeIfAbsent` 把"映射到 null"当成"没有映射"，未命中的会话每条还是会重算一次——恰好是这里要防的那种批次。验证不需要新脚本：本任务的 `tmp/p6b-query.mjs` 里"会话行的 `customerId` 非空"那几条断言跑的就是这条路径，改坏了它们会红；再把 `tmp/p6a-contract.mjs` 复跑一遍确认幂等那一对读数没变（`16/16`）。

- [ ] **Step 1: 先写游标的失败测试**

`CursorsTest.java`：

```java
package com.smartscrm.server.service.msg;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.time.LocalDateTime;
import org.junit.jupiter.api.Test;

class CursorsTest {

    @Test
    void roundTripsToMillisBecauseDateTime3IsTheSortKey() {
        LocalDateTime t = LocalDateTime.of(2026, 9, 20, 14, 33, 20, 123_000_000);
        String raw = Cursors.encode(t, 42L);
        Cursors.Pos back = Cursors.decode(raw);
        assertEquals(t, back.time());
        assertEquals(42L, back.id());
    }

    @Test
    void rejectsGarbageInsteadOfThrowing() {
        assertNull(Cursors.decode(null));
        assertNull(Cursors.decode(""));
        assertNull(Cursors.decode("abc"));
        assertNull(Cursors.decode("1759000000000"));
        assertNull(Cursors.decode("1759000000000:notanumber"));
    }

    /** 同一毫秒内的两条消息靠 id 断开平局；游标必须两个都带上，否则翻页会漏或重。 */
    @Test
    void keepsTheIdTieBreaker() {
        LocalDateTime same = LocalDateTime.of(2026, 9, 20, 14, 33, 20);
        assertEquals(Cursors.encode(same, 7L), Cursors.encode(same, 7L));
        assertEquals(7L, Cursors.decode(Cursors.encode(same, 7L)).id());
    }
}
```

```bash
cd apps/server && set -o pipefail && ./mvnw -q test -Dtest='CursorsTest' 2>&1 | tail -20
```

预期：编译失败，`cannot find symbol: class Cursors`。

- [ ] **Step 2: 实现 `Cursors`**

```java
package com.smartscrm.server.service.msg;

import java.time.Instant;
import java.time.LocalDateTime;

/**
 * 键集游标：`"<epochMillis>:<rowId>"`。不用 offset，因为采集是持续写入的——
 * 翻页过程中新行会把旧页往后推，offset 必然重复或漏行。
 * 毫秒 + id 一起带，是因为 DATETIME(3) 允许同一毫秒内有两条消息。
 */
public final class Cursors {

    public record Pos(LocalDateTime time, long id) {
    }

    private Cursors() {
    }

    public static String encode(LocalDateTime time, long id) {
        return time.atZone(MsgTimes.CHAT_ZONE).toInstant().toEpochMilli() + ":" + id;
    }

    public static Pos decode(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        int sep = raw.lastIndexOf(':');
        if (sep <= 0 || sep == raw.length() - 1) {
            return null;
        }
        try {
            long millis = Long.parseLong(raw.substring(0, sep));
            long id = Long.parseLong(raw.substring(sep + 1));
            return new Pos(LocalDateTime.ofInstant(Instant.ofEpochMilli(millis), MsgTimes.CHAT_ZONE), id);
        } catch (NumberFormatException notACursor) {
            return null;
        }
    }
}
```

```bash
cd apps/server && set -o pipefail && ./mvnw -q test -Dtest='CursorsTest' 2>&1 | tail -20
```

预期：`Tests run: 3, Failures: 0, Errors: 0`。

- [ ] **Step 3: 七个 VO**

```java
// MessageVO.java
package com.smartscrm.server.web.vo;

import com.smartscrm.server.entity.ChatMessage;
import java.time.LocalDateTime;

public record MessageVO(
    Long id, Long accountId, String platform, String chatKey, String msgKey, String direction,
    Long customerId, String senderKey, String senderName, String body, String mediaType,
    String mediaSummary, LocalDateTime msgTime, String status, String source, String sendLocalId
) {

    public static MessageVO of(ChatMessage m) {
        return new MessageVO(m.getId(), m.getAccountId(), m.getPlatform(), m.getChatKey(), m.getMsgKey(),
            m.getDirection(), m.getCustomerId(), m.getSenderKey(), m.getSenderName(), m.getBody(),
            m.getMediaType(), m.getMediaSummary(), m.getMsgTime(), m.getStatus(), m.getSource(),
            m.getSendLocalId());
    }
}
```

```java
// ConversationVO.java
package com.smartscrm.server.web.vo;

import com.smartscrm.server.entity.ChatConversation;
import java.time.LocalDateTime;

public record ConversationVO(
    Long id, Long accountId, String platform, String chatKey, String title, Boolean isGroup,
    Long customerId, LocalDateTime lastMsgTime, String lastMsgBody, Integer unreadCount
) {

    public static ConversationVO of(ChatConversation c) {
        return new ConversationVO(c.getId(), c.getAccountId(), c.getPlatform(), c.getChatKey(), c.getTitle(),
            c.getIsGroup() != null && c.getIsGroup() == 1, c.getCustomerId(), c.getLastMsgTime(),
            c.getLastMsgBody(), c.getUnreadCount());
    }
}
```

```java
// ConversationPageVO.java / MessagePageVO.java / MessageSearchVO.java
package com.smartscrm.server.web.vo;

import java.util.List;

public record ConversationPageVO(List<ConversationVO> records, String nextCursor, boolean hasMore) {}
public record MessagePageVO(List<MessageVO> records, String nextCursor, boolean hasMore) {}
public record MessageSearchVO(List<SearchHitVO> records, String nextCursor, boolean hasMore) {}

/** 搜索结果必须带会话锚点：点一条要能跳到它所属的会话并高亮（spec §8）。 */
public record SearchHitVO(MessageVO message, Long conversationId, String chatTitle) {}
```

`SearchHitVO` 单独成文件（`web/vo/SearchHitVO.java`），上面三行 record 分别落成 `ConversationPageVO.java`、`MessagePageVO.java`、`MessageSearchVO.java`——本仓库一个顶层类型一个文件。

```java
// DayCountVO.java / MessageStatsVO.java
package com.smartscrm.server.web.vo;

import java.util.List;

public record DayCountVO(String day, long inCount, long outCount) {}

/** total 是窗口内的总数，perDay 的长度恒等于 days：没有消息的日子补零，柱条数不能少。 */
public record MessageStatsVO(long total, long inCount, long outCount, long activeConversations,
                             List<DayCountVO> perDay) {}
```

- [ ] **Step 4: `MessageQueryService`**

```java
package com.smartscrm.server.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.ChatConversation;
import com.smartscrm.server.entity.ChatMessage;
import com.smartscrm.server.entity.Customer;
import com.smartscrm.server.mapper.ChatConversationMapper;
import com.smartscrm.server.mapper.ChatMessageMapper;
import com.smartscrm.server.mapper.CustomerMapper;
import com.smartscrm.server.service.msg.Cursors;
import com.smartscrm.server.service.msg.MsgTimes;
import com.smartscrm.server.service.msg.SearchPattern;
import com.smartscrm.server.web.vo.ConversationPageVO;
import com.smartscrm.server.web.vo.ConversationVO;
import com.smartscrm.server.web.vo.DayCountVO;
import com.smartscrm.server.web.vo.MessagePageVO;
import com.smartscrm.server.web.vo.MessageSearchVO;
import com.smartscrm.server.web.vo.MessageStatsVO;
import com.smartscrm.server.web.vo.MessageVO;
import com.smartscrm.server.web.vo.SearchHitVO;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MessageQueryService {

    private static final int DEFAULT_SIZE = 30;
    private static final int MAX_SIZE = 200;
    private static final Set<String> SEARCH_DIRECTIONS = Set.of("in", "out");

    private final ChatMessageMapper messageMapper;
    private final ChatConversationMapper conversationMapper;
    private final CustomerMapper customerMapper;
    private final MessageService messageService;

    public MessageQueryService(ChatMessageMapper messageMapper, ChatConversationMapper conversationMapper,
                               CustomerMapper customerMapper, MessageService messageService) {
        this.messageMapper = messageMapper;
        this.conversationMapper = conversationMapper;
        this.customerMapper = customerMapper;
        this.messageService = messageService;
    }

    // ============ 会话列表 ============

    public ConversationPageVO conversations(Long tenantId, Long accountId, String platform, String q,
                                            String cursor, Integer size) {
        int limit = sizeOf(size);
        if (platform != null && !platform.isBlank() && !"whatsapp".equals(platform) && !"telegram".equals(platform)) {
            throw new BizException(40000, "platform 只能是 whatsapp 或 telegram");
        }
        LambdaQueryWrapper<ChatConversation> w = new LambdaQueryWrapper<ChatConversation>()
            .eq(ChatConversation::getTenantId, tenantId);
        if (accountId != null) {
            messageService.resolveAccount(tenantId, accountId);
            w.eq(ChatConversation::getAccountId, accountId);
        }
        if (platform != null && !platform.isBlank()) {
            w.eq(ChatConversation::getPlatform, platform);
        }
        // q 命中三种可能：标题、chat_key、已绑客户名。像"搜联系人"那样用一个词就够。
        String like = SearchPattern.like(q);
        if (like == null && q != null && !q.isBlank()) {
            return new ConversationPageVO(List.of(), null, false);
        }
        if (like != null) {
            List<Long> customerIds = customerMapper.selectList(new LambdaQueryWrapper<Customer>()
                    .eq(Customer::getTenantId, tenantId)
                    .apply("nickname LIKE {0}", like))
                .stream().map(Customer::getId).toList();
            w.and(x -> {
                x.apply("title LIKE {0}", like).or().apply("chat_key LIKE {0}", like);
                if (!customerIds.isEmpty()) {
                    x.or().in(ChatConversation::getCustomerId, customerIds);
                }
            });
        }
        Cursors.Pos pos = Cursors.decode(cursor);
        if (pos != null) {
            w.and(x -> x.lt(ChatConversation::getLastMsgTime, pos.time())
                .or(y -> y.eq(ChatConversation::getLastMsgTime, pos.time()).lt(ChatConversation::getId, pos.id())));
        }
        w.orderByDesc(ChatConversation::getLastMsgTime).orderByDesc(ChatConversation::getId);
        List<ChatConversation> rows = conversationMapper.selectList(w.last("LIMIT " + (limit + 1)));
        boolean hasMore = rows.size() > limit;
        List<ChatConversation> page = hasMore ? rows.subList(0, limit) : rows;
        String next = page.isEmpty() || !hasMore
            ? null
            : Cursors.encode(page.get(page.size() - 1).getLastMsgTime(), page.get(page.size() - 1).getId());
        return new ConversationPageVO(page.stream().map(ConversationVO::of).toList(), next, hasMore);
    }

    // ============ 会话内消息 ============

    public MessagePageVO messages(Long tenantId, Long accountId, String chatKey, String before, Long around,
                                  Integer size) {
        if (chatKey == null || chatKey.isBlank()) {
            throw new BizException(40000, "chatKey 不能为空");
        }
        MessageService.ResolvedAccount account = messageService.resolveAccount(tenantId, accountId);
        int limit = sizeOf(size);
        LambdaQueryWrapper<ChatMessage> w = new LambdaQueryWrapper<ChatMessage>()
            .eq(ChatMessage::getTenantId, tenantId)
            .eq(ChatMessage::getAccountId, account.accountId())
            .eq(ChatMessage::getPlatform, account.platform())
            .eq(ChatMessage::getChatKey, chatKey);
        Cursors.Pos decoded = Cursors.decode(before);
        // `around` 覆盖 `before`：两者同时出现只可能是"从搜索结果跳进来又往上翻了"的中间态，
        // 以锚点为准更安全。pos 必须是 final：下面那个 wrapper 的 lambda 要捕获它，
        // 直接给 `pos` 二次赋值会连编译都过不去（effective finality）。
        final Cursors.Pos pos = around != null ? aroundPos(tenantId, account, chatKey, around) : decoded;
        if (pos != null) {
            w.and(x -> x.lt(ChatMessage::getMsgTime, pos.time())
                .or(y -> y.eq(ChatMessage::getMsgTime, pos.time()).lt(ChatMessage::getId, pos.id())));
        }
        // 倒序取"更早的一页"，正序返回：记录页是往上翻页的，前端拿到就能直接接在列表头上。
        w.orderByDesc(ChatMessage::getMsgTime).orderByDesc(ChatMessage::getId)
            .last("LIMIT " + (limit + 1));
        List<ChatMessage> rows = messageMapper.selectList(w);
        boolean hasMore = rows.size() > limit;
        List<ChatMessage> page = new ArrayList<>(hasMore ? rows.subList(0, limit) : rows);
        String next = hasMore && !page.isEmpty()
            ? Cursors.encode(page.get(page.size() - 1).getMsgTime(), page.get(page.size() - 1).getId())
            : null;
        page.sort((a, b) -> a.getMsgTime().isEqual(b.getMsgTime())
            ? Long.compare(a.getId(), b.getId())
            : a.getMsgTime().compareTo(b.getMsgTime()));
        return new MessagePageVO(page.stream().map(MessageVO::of).toList(), next, hasMore);
    }

    /**
     * 把"定位到某条消息"翻译成窗口位置。为什么不发一个 `<epochMillis>:<id>` 让前端自己拼：
     * 那串毫秒是按 `MsgTimes.CHAT_ZONE`（写死的 Asia/Shanghai）解释的，而前端手上的 `msgTime`
     * 是墙钟串、经浏览器时区换算成 epoch——同机部署看不出来，测试机时区一换就偏几个小时。
     * 偏了的后果不是报错，是"点了搜索结果却翻到空白页"，最难查。行 id 是两端唯一共享的稳定键，
     * 所以窗口由后端算，前端只传 id。
     *
     * `plusNanos(1ms)` 是因为下面的窗口条件是**严格早于**：不加这一个毫秒，锚点那条自己会被排除，
     * 而它正是要高亮的那一条。id 用 0（自增 id 恒 ≥ 1），所以同一毫秒内的兄弟行也都留在窗口里。
     */
    private Cursors.Pos aroundPos(Long tenantId, MessageService.ResolvedAccount account, String chatKey,
                                  Long around) {
        ChatMessage anchorRow = messageMapper.selectOne(new LambdaQueryWrapper<ChatMessage>()
            .eq(ChatMessage::getTenantId, tenantId)
            .eq(ChatMessage::getAccountId, account.accountId())
            .eq(ChatMessage::getPlatform, account.platform())
            .eq(ChatMessage::getChatKey, chatKey)
            .eq(ChatMessage::getId, around));
        if (anchorRow == null) {
            // 40404 而不是退回默认窗口：静默退回去会让前端把"锚定失败"当成"消息不存在"，
            // 而真实原因多半是 chatKey 与 accountId 传串了（跨账号搜索结果点了错误的锚点）。
            throw new BizException(40404, "around 指向的消息不在该会话内");
        }
        return new Cursors.Pos(anchorRow.getMsgTime().plusNanos(1_000_000L), 0L);
    }

    // ============ 全局搜索 ============

    public MessageSearchVO search(Long tenantId, String q, Long accountId, String platform, String direction,
                                  String from, String to, Long customerId, String cursor, Integer size) {
        String like = SearchPattern.like(q);
        if (like == null) {
            return new MessageSearchVO(List.of(), null, false);
        }
        if (direction != null && !direction.isBlank() && !SEARCH_DIRECTIONS.contains(direction)) {
            throw new BizException(40000, "direction 只能是 in 或 out");
        }
        int limit = sizeOf(size);
        LambdaQueryWrapper<ChatMessage> w = new LambdaQueryWrapper<ChatMessage>()
            .eq(ChatMessage::getTenantId, tenantId)
            .apply("body LIKE {0}", like)
            .isNotNull(ChatMessage::getBody);
        if (accountId != null) {
            MessageService.ResolvedAccount account = messageService.resolveAccount(tenantId, accountId);
            w.eq(ChatMessage::getAccountId, account.accountId());
        }
        if (platform != null && !platform.isBlank()) {
            w.eq(ChatMessage::getPlatform, platform);
        }
        if (direction != null && !direction.isBlank()) {
            w.eq(ChatMessage::getDirection, direction);
        }
        if (customerId != null) {
            w.eq(ChatMessage::getCustomerId, customerId);
        }
        LocalDateTime fromTime = parseDay(from, false);
        if (fromTime != null) {
            w.ge(ChatMessage::getMsgTime, fromTime);
        }
        LocalDateTime toTime = parseDay(to, true);
        if (toTime != null) {
            w.le(ChatMessage::getMsgTime, toTime);
        }
        Cursors.Pos pos = Cursors.decode(cursor);
        if (pos != null) {
            w.and(x -> x.lt(ChatMessage::getMsgTime, pos.time())
                .or(y -> y.eq(ChatMessage::getMsgTime, pos.time()).lt(ChatMessage::getId, pos.id())));
        }
        w.orderByDesc(ChatMessage::getMsgTime).orderByDesc(ChatMessage::getId)
            .last("LIMIT " + (limit + 1));
        List<ChatMessage> rows = messageMapper.selectList(w);
        boolean hasMore = rows.size() > limit;
        List<ChatMessage> page = hasMore ? rows.subList(0, limit) : rows;
        Map<String, ChatConversation> heads = headsOf(tenantId, page);
        List<SearchHitVO> hits = page.stream()
            .map(m -> {
                ChatConversation head = heads.get(m.getAccountId() + "|" + m.getChatKey());
                return new SearchHitVO(MessageVO.of(m), head == null ? null : head.getId(),
                    head == null ? null : head.getTitle());
            })
            .toList();
        String next = hasMore && !page.isEmpty()
            ? Cursors.encode(page.get(page.size() - 1).getMsgTime(), page.get(page.size() - 1).getId())
            : null;
        return new MessageSearchVO(hits, next, hasMore);
    }

    /** 一页命中的会话头一次取回，不在循环里查库。 */
    private Map<String, ChatConversation> headsOf(Long tenantId, List<ChatMessage> rows) {
        Set<Long> accounts = new HashSet<>();
        Set<String> keys = new HashSet<>();
        for (ChatMessage m : rows) {
            accounts.add(m.getAccountId());
            keys.add(m.getChatKey());
        }
        if (accounts.isEmpty()) {
            return Map.of();
        }
        Map<String, ChatConversation> out = new HashMap<>();
        conversationMapper.selectList(new LambdaQueryWrapper<ChatConversation>()
                .eq(ChatConversation::getTenantId, tenantId)
                .in(ChatConversation::getAccountId, accounts)
                .in(ChatConversation::getChatKey, keys))
            .forEach(c -> out.put(c.getAccountId() + "|" + c.getChatKey(), c));
        return out;
    }

    // ============ 统计 ============

    public MessageStatsVO stats(Long tenantId, Long accountId, Integer days) {
        MessageService.ResolvedAccount account = messageService.resolveAccount(tenantId, accountId);
        int window = days == null || days <= 0 ? 7 : Math.min(days, 90);
        LocalDateTime from = LocalDate.now(MsgTimes.CHAT_ZONE).minusDays(window - 1L).atStartOfDay();
        Map<String, Object> totals = messageMapper.statsTotals(tenantId, account.accountId(), from);
        Map<String, Object> perDay = new HashMap<>();
        for (Map<String, Object> row : messageMapper.statsPerDay(tenantId, account.accountId(), from)) {
            perDay.put(String.valueOf(row.get("day")), row);
        }
        List<DayCountVO> series = new ArrayList<>(window);
        LocalDate today = LocalDate.now(MsgTimes.CHAT_ZONE);
        for (int i = window - 1; i >= 0; i--) {
            String day = today.minusDays(i).toString();
            Object row = perDay.get(day);
            series.add(row == null
                ? new DayCountVO(day, 0, 0)
                : new DayCountVO(day, num(row, "inCount"), num(row, "outCount")));
        }
        return new MessageStatsVO(num(totals, "total"), num(totals, "inCount"), num(totals, "outCount"),
            num(totals, "activeConversations"), series);
    }

    /** COUNT 给 Long、SUM 给 BigDecimal，统一按 Number 取。 */
    private static long num(Map<String, Object> row, String key) {
        Object v = row == null ? null : row.get(key);
        return v instanceof Number n ? n.longValue() : 0L;
    }

    // ============ 未读与会话头修复 ============

    @Transactional
    public int markRead(Long tenantId, Long conversationId) {
        return conversationMapper.clearUnread(tenantId, conversationId);
    }

    @Transactional
    public ConversationVO replayHead(Long tenantId, Long conversationId) {
        ChatConversation head = requireOwned(tenantId, conversationId);
        conversationMapper.replayHead(tenantId, conversationId);
        return ConversationVO.of(conversationMapper.selectById(head.getId()));
    }

    public ChatConversation requireOwned(Long tenantId, Long conversationId) {
        ChatConversation head = conversationMapper.selectOne(new LambdaQueryWrapper<ChatConversation>()
            .eq(ChatConversation::getTenantId, tenantId)
            .eq(ChatConversation::getId, conversationId)
            .last("LIMIT 1"));
        if (head == null) {
            throw new BizException(40404, "会话不存在: " + conversationId);
        }
        return head;
    }

    private static int sizeOf(Integer size) {
        if (size == null || size <= 0) {
            return DEFAULT_SIZE;
        }
        return Math.min(size, MAX_SIZE);
    }

    /** from/to 是 `yyyy-MM-dd`；`to` 取当天最后一刻，否则当天的消息会被漏掉。 */
    private static LocalDateTime parseDay(String raw, boolean endOfDay) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            LocalDate d = LocalDate.parse(raw);
            return endOfDay ? d.atTime(23, 59, 59, 999_000_000) : d.atStartOfDay();
        } catch (DateTimeParseException bad) {
            throw new BizException(40000, "日期格式应为 yyyy-MM-dd: " + raw);
        }
    }
}
```

- [ ] **Step 5: 两个 Controller**

`MessageController` 追加三个 GET（同一个类，因为它已经是 `/api/messages` 的入口）：

```java
    @GetMapping
    public ApiResponse<MessagePageVO> list(@AuthenticationPrincipal AuthPrincipal principal,
                                           @RequestParam Long accountId,
                                           @RequestParam String chatKey,
                                           @RequestParam(required = false) String before,
                                           @RequestParam(required = false) Long around,
                                           @RequestParam(required = false) Integer size) {
        return ApiResponse.ok(query.messages(principal.tenantId(), accountId, chatKey, before, around, size));
    }

    @GetMapping("/search")
    public ApiResponse<MessageSearchVO> search(@AuthenticationPrincipal AuthPrincipal principal,
                                               @RequestParam String q,
                                               @RequestParam(required = false) Long accountId,
                                               @RequestParam(required = false) String platform,
                                               @RequestParam(required = false) String direction,
                                               @RequestParam(required = false) String from,
                                               @RequestParam(required = false) String to,
                                               @RequestParam(required = false) Long customerId,
                                               @RequestParam(required = false) String cursor,
                                               @RequestParam(required = false) Integer size) {
        return ApiResponse.ok(query.search(principal.tenantId(), q, accountId, platform, direction,
            from, to, customerId, cursor, size));
    }

    @GetMapping("/stats")
    public ApiResponse<MessageStatsVO> stats(@AuthenticationPrincipal AuthPrincipal principal,
                                             @RequestParam Long accountId,
                                             @RequestParam(required = false) Integer days) {
        return ApiResponse.ok(query.stats(principal.tenantId(), accountId, days));
    }
```

（构造器里加 `MessageQueryService query`，import 补 `GetMapping` / `RequestParam` / 三个 VO。路由顺序无需特殊处理：`/search`、`/stats` 是字面量路径，与 `GET /api/messages` 不冲突。）

`ConversationController.java` 新建：

```java
package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.MessageQueryService;
import com.smartscrm.server.web.vo.ConversationPageVO;
import com.smartscrm.server.web.vo.ConversationVO;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/conversations")
public class ConversationController {

    private final MessageQueryService query;

    public ConversationController(MessageQueryService query) {
        this.query = query;
    }

    @GetMapping
    public ApiResponse<ConversationPageVO> list(@AuthenticationPrincipal AuthPrincipal principal,
                                                @RequestParam(required = false) Long accountId,
                                                @RequestParam(required = false) String platform,
                                                @RequestParam(required = false) String q,
                                                @RequestParam(required = false) String cursor,
                                                @RequestParam(required = false) Integer size) {
        return ApiResponse.ok(query.conversations(principal.tenantId(), accountId, platform, q, cursor, size));
    }

    @PostMapping("/{id}/read")
    public ApiResponse<Map<String, Integer>> read(@AuthenticationPrincipal AuthPrincipal principal,
                                                  @PathVariable Long id) {
        query.requireOwned(principal.tenantId(), id);
        return ApiResponse.ok(Map.of("cleared", query.markRead(principal.tenantId(), id)));
    }

    /** 运维兜底：会话头是投影，怀疑它错了就按消息重算。UI 不暴露（spec §7）。 */
    @PostMapping("/{id}/replay-head")
    public ApiResponse<ConversationVO> replayHead(@AuthenticationPrincipal AuthPrincipal principal,
                                                  @PathVariable Long id) {
        return ApiResponse.ok(query.replayHead(principal.tenantId(), id));
    }
}
```

- [ ] **Step 6: 编译 + 重启 + 契约探针**

`set -o pipefail && ./mvnw -q -DskipTests package`，按 C8 重启后，用 Write 落 `tmp/p6b-query.mjs`（一次跑完、打印 PASS/FAIL 表；沿用 P5 的驱动脚本形状：`login()` 拿 token，`check(name, cond, detail)` 累加）：

| # | 断言 | 期望 |
|---|---|---|
| 1 | `GET /api/conversations?accountId=<wa>&size=50` | `code:0`，`records` 含 Task 3 写入的两个 chat_key，按 `lastMsgTime` 倒序 |
| 2 | 同一请求换 `cursor=<上一页 nextCursor>` | 第二页与第一页 `id` 集合不相交（区分 offset 型重复） |
| 3 | `GET /api/conversations?q=%E8%AE%A2%E5%8D%95` | 命中 0 条（会话标题里没有"订单"，但消息正文里有）→ 证明会话搜索只扫标题/chat_key/客户名，不做正文全文 |
| 4 | `GET /api/conversations?q=8613800001001` | 命中 1 条（chat_key 前缀匹配） |
| 5 | `GET /api/messages?accountId&chatKey=8613800001001@c.us&size=10` | `records` 正序（`msgTime` 单调不减），`hasMore:false` |
| 6 | 同一 chat 连翻 `before` 两页（size=1） | 两页不重不漏，第二页的 `msgTime` 严格早于第一页 |
| 6b | 先向第 5 行那个会话（`chatKey=8613800001001@c.us`，即种子客户 Alice 张）`batch` 写 5 条时间递增、`source:'live'` 的消息（正文 `p6b-anchor-1..5`），取第 3 条的**行 id** 打 `GET /api/messages?accountId&chatKey&around=<该 id>&size=2` | `records` 末条 `id` 等于 `around`（锚点自己必须进窗口，而不是被"严格早于"排除掉），`records[0]` 是第 2 条；`hasMore:true` 且用 `nextCursor` 续翻恰好得到第 1 条——两页不重不漏；`around=999999` → `code:40404`（不静默退回默认窗口） |
| 7 | `GET /api/messages/search?q=%E8%AE%A2%E5%8D%95` | ≥1 条，`records[0].conversationId` 非空、`chatTitle` 与会话头一致 |
| 8 | `search?q=100%25_off`（原文 `100%_off`） | 0 条且不报 500：转义生效，通配符没被当成模式 |
| 9 | `search?q=%` | `records:[]`（收敛 12：纯通配符返回空而不是全表） |
| 10 | `search?direction=in&q=<out 行的正文>` | 0 条；去掉 direction 后 ≥1 条（方向过滤真的在过滤） |
| 11 | `search?from=2020-01-01&to=2020-12-31&q=<刚写的正文>` | 0 条（时间窗生效）；`from=2000-01-01` 时 ≥1 条 |
| 12 | `GET /api/messages/stats?accountId&days=7` | `perDay.length === 7`、`total === inCount + outCount`、`activeConversations >= 2` |
| 13 | `days=30` | `perDay.length === 30`，且前 7 天的逐日值与 `days=7` 完全一致（窗口是右对齐的） |
| 14 | `POST /api/conversations/{id}/read` | `{cleared:1}`；紧接着列表里该会话 `unreadCount === 0`，另一个会话未读不变（区分"清零"与"把整列抹了"） |
| 15 | `POST /api/conversations/{id}/replay-head` | 返回的 `lastMsgTime` 等于该会话最新消息的 `msgTime`；先向该会话补写一条**更旧**的消息再重算，`lastMsgTime` 必须不变（投影 + 重算两条规则同时成立） |
| 16 | 用 `id=999999` 打 read | `code:40404` |

```bash
node tmp/p6b-query.mjs
```

预期：17 行全 PASS（6b 是锚点窗口那一行），末行 `ALL PASS (17/17)`。**任一条 FAIL 都停下修到位再往下走**；表里第 15 行尤其不能放过——它是"会话头只被新消息推动"唯一的直接证据。

- [ ] **Step 7: 提交**

```bash
git add apps/server/src/main/java/com/smartscrm/server apps/server/src/test/java/com/smartscrm/server
git commit -m "feat(P6): 会话列表与会话内消息的键集游标分页 + 全局搜索 + 统计"
```

---

### Task 5: 客户闭环（创建 API + link-customer 回填 + 客户时间线）

**Files:**
- Create: `apps/server/src/main/java/com/smartscrm/server/web/dto/CustomerCreateRequest.java`
- Modify: `apps/server/src/main/java/com/smartscrm/server/service/CustomerService.java`（+`create`）
- Modify: `apps/server/src/main/java/com/smartscrm/server/web/CustomerController.java`（+`POST /api/customers`、+`GET /api/customers/{id}/timeline`）
- Create: `apps/server/src/main/java/com/smartscrm/server/web/dto/ConversationLinkCustomerDTO.java`
- Modify: `apps/server/src/main/java/com/smartscrm/server/service/MessageQueryService.java`（+`linkCustomer`、+`timeline`）
- Modify: `apps/server/src/main/java/com/smartscrm/server/web/ConversationController.java`（+`POST /{id}/link-customer`）
- Create: `apps/server/src/main/java/com/smartscrm/server/web/vo/CustomerTimelineVO.java`

**Interfaces:**
- Consumes: `Customer` / `CustomerMapper`、Task 1 的 `ChatConversationMapper`、Task 4 的 `requireOwned` 与 `Cursors`。
- Produces:
  - `POST /api/customers` → `CustomerVO`（body：`platformType, openId, nickname?, phone?, email?, country?, remark?, sex?`）
  - `POST /api/conversations/{id}/link-customer` body `{customerId}` → `{conversationId, customerId, messagesLinked}`
  - `GET /api/customers/{id}/timeline?size` → `CustomerTimelineVO(List<MessageVO> messages, List<ConversationVO> conversations, long messageCount, long conversationCount)`
  - Task 17 的"建为客户"闭环与 Task 18 的客户抽屉时间线只认这三个形状。

- [ ] **Step 1: `CustomerCreateRequest` + `CustomerService.create`**

```java
package com.smartscrm.server.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record CustomerCreateRequest(
    @NotNull(message = "platformType 不能为空") Integer platformType,
    @NotBlank(message = "openId 不能为空") @Size(max = 128) String openId,
    @Size(max = 128) String nickname,
    @Size(max = 64) String phone,
    @Size(max = 128) String email,
    @Size(max = 64) String country,
    @Size(max = 255) String remark,
    Integer sex
) {
}
```

`openId` 必填的理由要写在注释里：`uk_customer_tenant_platform_openid` 是 NOT NULL 的唯一键，且 P6 的客户匹配靠的就是"`open_id` 与 `chat_key` 同形"（收敛 4）。手机号能靠"建为客户"按钮预填，但不能当主键——同号可多平台。

```java
    /**
     * open_id 是"这个人在这个平台上的 id"，聊天记录里的 chat_key 就是它。
     * 撞唯一键时报 40901 而不是让 MySQL 异常冒到 50000：前端要能区分"重名"和"已经存在"。
     */
    @Transactional
    public CustomerVO create(Long tenantId, CustomerCreateRequest req) {
        String openId = req.openId().trim();
        if (openId.isEmpty()) {
            throw new BizException(40000, "openId 不能为空白");
        }
        if (req.platformType() == null || req.platformType() < 1 || req.platformType() > 7) {
            throw new BizException(40000, "platformType 只能是 1..7");
        }
        long dup = customerMapper.selectCount(new LambdaQueryWrapper<Customer>()
            .eq(Customer::getTenantId, tenantId)
            .eq(Customer::getPlatformType, req.platformType())
            .eq(Customer::getOpenId, openId));
        if (dup > 0) {
            throw new BizException(40901, "该平台下此客户已存在: " + openId);
        }
        Customer customer = new Customer();
        customer.setTenantId(tenantId);
        customer.setPlatformType(req.platformType());
        customer.setOpenId(openId);
        customer.setNickname(trimToNull(req.nickname()));
        customer.setPhone(trimToNull(req.phone()));
        customer.setEmail(trimToNull(req.email()));
        customer.setCountry(trimToNull(req.country()));
        customer.setRemark(trimToNull(req.remark()));
        customer.setSex(req.sex() == null ? 0 : req.sex());
        customer.setFirstSeenAt(LocalDateTime.now());
        customerMapper.insert(customer);
        return detail(tenantId, customer.getId());
    }

    private static String trimToNull(String raw) {
        if (raw == null) {
            return null;
        }
        String t = raw.trim();
        return t.isEmpty() ? null : t;
    }
```

- [ ] **Step 2: Controller 入口**

`CustomerController` 追加：

```java
    @PostMapping
    public ApiResponse<CustomerVO> create(@AuthenticationPrincipal AuthPrincipal principal,
                                          @Valid @RequestBody CustomerCreateRequest req) {
        return ApiResponse.ok(service.create(principal.tenantId(), req));
    }
```

- [ ] **Step 3: `linkCustomer` —— 建客户与回填历史是两步，不隐式耦合（spec §6）**

```java
    /**
     * 回填的是这个会话的历史消息：新客户在被"建为联系人"之前，聊天早就照规则入库了
     * （customer_id 为空）。这里只补那一段，范围严格限定在单个会话。
     */
    @Transactional
    public Map<String, Object> linkCustomer(Long tenantId, Long conversationId, Long customerId) {
        ChatConversation head = requireOwned(tenantId, conversationId);
        Customer customer = customerMapper.selectOne(new LambdaQueryWrapper<Customer>()
            .eq(Customer::getTenantId, tenantId)
            .eq(Customer::getId, customerId)
            .last("LIMIT 1"));
        if (customer == null) {
            throw new BizException(40404, "客户不存在: " + customerId);
        }
        int messages = messageMapper.update(null, new LambdaUpdateWrapper<ChatMessage>()
            .eq(ChatMessage::getTenantId, tenantId)
            .eq(ChatMessage::getAccountId, head.getAccountId())
            .eq(ChatMessage::getPlatform, head.getPlatform())
            .eq(ChatMessage::getChatKey, head.getChatKey())
            .isNull(ChatMessage::getCustomerId)
            .set(ChatMessage::getCustomerId, customerId));
        conversationMapper.update(null, new LambdaUpdateWrapper<ChatConversation>()
            .eq(ChatConversation::getId, conversationId)
            .eq(ChatConversation::getTenantId, tenantId)
            .set(ChatConversation::getCustomerId, customerId));
        return Map.of("conversationId", conversationId, "customerId", customerId, "messagesLinked", messages);
    }
```

`isNull(...)` 是这条 SQL 的重点：同一会话里可能有**先前**已经匹配到别的客户的行（`open_id` 命中过），回填不能把它们改到新建的客户名下。

> 注意"改会话头"用的是无条件 `set`：手动 link 是用户的明确意图，覆盖自动匹配的结果是**期望行为**；消息只补空，因为消息上的归属是历史事实。

`ConversationController` 追加：

```java
    @PostMapping("/{id}/link-customer")
    public ApiResponse<Map<String, Object>> linkCustomer(@AuthenticationPrincipal AuthPrincipal principal,
                                                         @PathVariable Long id,
                                                         @Valid @RequestBody ConversationLinkCustomerDTO dto) {
        return ApiResponse.ok(query.linkCustomer(principal.tenantId(), id, dto.customerId()));
    }
```

```java
// ConversationLinkCustomerDTO.java
package com.smartscrm.server.web.dto;

import jakarta.validation.constraints.NotNull;

public record ConversationLinkCustomerDTO(@NotNull(message = "customerId 不能为空") Long customerId) {
}
```

- [ ] **Step 4: 客户时间线**

```java
// CustomerTimelineVO.java
package com.smartscrm.server.web.vo;

import java.util.List;

/**
 * 客户抽屉里"最近消息"一段的数据源：消息 + 该客户名下的会话头。
 * 分页只在消息上做，会话头一次给全（一个客户名下的会话数是个位数）。
 */
public record CustomerTimelineVO(List<MessageVO> messages, List<ConversationVO> conversations,
                                 long messageCount, long conversationCount) {}
```

```java
    public CustomerTimelineVO timeline(Long tenantId, Long customerId, Integer size) {
        long owned = customerMapper.selectCount(new LambdaQueryWrapper<Customer>()
            .eq(Customer::getTenantId, tenantId).eq(Customer::getId, customerId));
        if (owned == 0) {
            throw new BizException(40404, "客户不存在: " + customerId);
        }
        int limit = sizeOf(size);
        List<ChatMessage> rows = messageMapper.selectList(new LambdaQueryWrapper<ChatMessage>()
            .eq(ChatMessage::getTenantId, tenantId)
            .eq(ChatMessage::getCustomerId, customerId)
            .orderByDesc(ChatMessage::getMsgTime).orderByDesc(ChatMessage::getId)
            .last("LIMIT " + limit));
        long messageCount = messageMapper.selectCount(new LambdaQueryWrapper<ChatMessage>()
            .eq(ChatMessage::getTenantId, tenantId).eq(ChatMessage::getCustomerId, customerId));
        List<ChatConversation> heads = conversationMapper.selectList(new LambdaQueryWrapper<ChatConversation>()
            .eq(ChatConversation::getTenantId, tenantId)
            .eq(ChatConversation::getCustomerId, customerId)
            .orderByDesc(ChatConversation::getLastMsgTime));
        List<MessageVO> messages = new ArrayList<>(rows.stream().map(MessageVO::of).toList());
        messages.sort((a, b) -> a.msgTime().compareTo(b.msgTime()));
        return new CustomerTimelineVO(messages, heads.stream().map(ConversationVO::of).toList(),
            messageCount, heads.size());
    }
```

`CustomerController` 追加（路径挂 `/api/customers`，但实现放 `MessageQueryService`——它是消费 `chat_*` 的那一侧）：

```java
    @GetMapping("/{id}/timeline")
    public ApiResponse<CustomerTimelineVO> timeline(@AuthenticationPrincipal AuthPrincipal principal,
                                                    @PathVariable Long id,
                                                    @RequestParam(required = false) Integer size) {
        return ApiResponse.ok(timeline.timeline(principal.tenantId(), id, size));
    }
```

（`CustomerController` 的构造器再注入 `MessageQueryService timeline`。`MessageVO` 里带 `chatKey`，前端点一条时间线消息就能跳回对应会话。）

- [ ] **Step 5: 契约探针**

用 Write 落 `tmp/p6b-customer.mjs`：

| # | 断言 | 期望 |
|---|---|---|
| 1 | `POST /api/customers`（openId=`8613800001002@c.us`, platformType=1, nickname=`Bob 李`） | `code:0`，返回 `id`，`openId` 原样 |
| 2 | 同一 body 再发一次 | `code:40901`（区分"字段校验没过"与"唯一键冲突"） |
| 3 | `GET /api/customers?keyword=Bob` | `records` 含第 1 步创建的那条 |
| 4 | `POST /api/conversations/{Bob会话}/link-customer` | `messagesLinked >= 1`；响应里的 `customerId` 等于第 1 步的 id |
| 5 | `GET /api/customers/{id}/timeline` | `messageCount === messages.length`（未超 size 时）、`conversations` 含该会话、`messages` 按时间正序 |
| 6 | `GET /api/messages/search?customerId=<id>&q=<该会话正文>` | ≥1 条；换一个 `customerId` 查同一条正文 → 0 条（回填真的把归属写上了，不是搜索碰巧） |
| 7 | 对 Task 3 写入的 **Alice** 会话（`customer_id` 已被 open_id 自动命中）做 `link-customer` 到**新**客户 | 返回 `messagesLinked:0`（已有归属的行不被改走），但会话头 `customerId` 变成新客户 |
| 8 | `link-customer` 一个不存在的 `customerId` | `code:40404` |
| 9 | 用第二个租户 token 打 `POST /api/customers` 同 openId | `code:0`（跨租户允许同 openId）；再用它的 `conversationId` 打 link → `40404`（租户隔离） |

第 7 条是整个任务的关键断言：它区分"无条件覆盖"与"消息保历史、会话头听手动"。

```bash
node tmp/p6b-customer.mjs
```

预期：`ALL PASS (9/9)`。**收尾清理**：第 1/9 步创建的两条客户与它们的 link 都要删掉（`DELETE /api/customers/{id}`），并把第 4 步会话的 `customer_id` 用第 7 步的反向操作还原不了——所以第 1 步必须用一个**新** openId（`8613800001002@c.us` 已经被种子里的 Bob 占着的话就换 `8613800001008@c.us`），且第 4 步 link 的目标就是种子客户本身。脚本开头先 `GET /api/customers?keyword=` 查一遍、把要用的 id 记进日志，避免上一轮残留把断言带偏。

- [ ] **Step 6: 提交**

```bash
git add apps/server/src/main/java/com/smartscrm/server
git commit -m "feat(P6): 客户创建 API + 会话回填客户 + 客户时间线"
```

---

### Task 6: 按客户语向（兑现 `scope='customer'`）

**Files:**
- Create: `apps/server/src/main/java/com/smartscrm/server/service/msg/ScopeSettings.java`（纯函数：customer → global 的解析顺序）
- Create: `apps/server/src/test/java/com/smartscrm/server/service/msg/ScopeSettingsTest.java`
- Modify: `apps/server/src/main/java/com/smartscrm/server/service/TranslationService.java`
- Modify: `apps/server/src/main/java/com/smartscrm/server/web/dto/TranslateDTO.java`（+`customerId`）
- Modify: `apps/server/src/main/java/com/smartscrm/server/web/dto/TranslationSettingInput.java`（+`scope`,`scopeKey`）
- Modify: `apps/server/src/main/java/com/smartscrm/server/web/vo/TranslationSettingVO.java`（+`scope`,`scopeKey`,`inherited`）
- Modify: `apps/server/src/main/java/com/smartscrm/server/web/TranslationController.java`

**Interfaces:**
- Consumes: 既有 `translation_setting`（`scope` / `scope_key` 与 `uk_tset_tenant_scope` 早在 V5 就建好了）、`TranslateDTO`、`TranslationSettingVO`。
- Produces:
  - `GET /api/translation/settings?customerId=` → `TranslationSettingVO`（不带 `customerId` 时行为与 P5 完全一致）
  - `PUT /api/translation/settings` body 可选带 `scope='customer'` + `scopeKey=<customerId>`；不带即全局
  - `DELETE /api/translation/settings/customer/{customerId}` → `{cleared: 0|1}`（删掉覆盖行，回到全局）
  - `POST /api/translation/translate` body 可选带 `customerId` → 译文按该客户的语向解析
  - `ScopeSettings.resolve(Long customerId, TranslationSetting customer, TranslationSetting global) -> Resolved(TranslationSetting setting, boolean inherited)`

- [ ] **Step 1: 先写解析顺序的失败测试**

```java
package com.smartscrm.server.service.msg;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.smartscrm.server.entity.TranslationSetting;
import org.junit.jupiter.api.Test;

class ScopeSettingsTest {

    private static TranslationSetting setting(String id, String from, String to) {
        TranslationSetting s = new TranslationSetting();
        s.setId(Long.valueOf(id));
        s.setReceiveFromLang(from);
        s.setReceiveToLang(to);
        return s;
    }

    @Test
    void usesTheCustomerRowWhenThereIsOne() {
        ScopeSettings.Resolved r = ScopeSettings.resolve(7L, setting("2", "en", "zh-CN"), setting("1", "auto", "vi"));
        assertEquals(2L, r.setting().getId());
        assertFalse(r.inherited());
    }

    @Test
    void fallsBackToGlobalWhenTheCustomerHasNoOverride() {
        ScopeSettings.Resolved r = ScopeSettings.resolve(7L, null, setting("1", "en", "zh-CN"));
        assertEquals(1L, r.setting().getId());
        assertTrue(r.inherited(), "UI 要据此显示「跟随全局」");
    }

    @Test
    void nullCustomerIdAlwaysMeansGlobalEvenWithAnOverrideRow() {
        ScopeSettings.Resolved r = ScopeSettings.resolve(null, setting("2", "en", "zh-CN"), setting("1", "auto", "vi"));
        assertEquals(1L, r.setting().getId());
        assertTrue(r.inherited());
    }

    /** 全局行是 requireSettings 兜底建的，理论上不会是 null；这里只保证不抛 NPE。 */
    @Test
    void missingBothRowsYieldsNoSetting() {
        ScopeSettings.Resolved r = ScopeSettings.resolve(7L, null, null);
        assertEquals(null, r.setting());
    }
}
```

```bash
cd apps/server && set -o pipefail && ./mvnw -q test -Dtest='ScopeSettingsTest' 2>&1 | tail -20
```

预期：编译失败，`cannot find symbol: class ScopeSettings`。

- [ ] **Step 2: 实现解析**

```java
package com.smartscrm.server.service.msg;

import com.smartscrm.server.entity.TranslationSetting;

/**
 * 语向解析只有一条规则：客户有覆盖行就用它，否则用全局。
 * 不做"字段级合并"——那样一条消息会混用两个来源的语向，出问题无法解释。
 * 覆盖行是保存时从全局整份复制再改的（Task 6 Step 3），所以整行取用是安全的。
 */
public final class ScopeSettings {

    public record Resolved(TranslationSetting setting, boolean inherited) {
    }

    private ScopeSettings() {
    }

    public static Resolved resolve(Long customerId, TranslationSetting customer, TranslationSetting global) {
        if (customerId != null && customer != null) {
            return new Resolved(customer, false);
        }
        return new Resolved(global, true);
    }
}
```

```bash
cd apps/server && set -o pipefail && ./mvnw -q test -Dtest='ScopeSettingsTest' 2>&1 | tail -20
```

预期：`Tests run: 4, Failures: 0, Errors: 0`。

- [ ] **Step 3: `TranslationService` 接入**

三处改动：

```java
    // 1) 取设置：按 scope 定位，global 保持 P5 的兜底建行行为不变
    private TranslationSetting settingRow(Long tenantId, String scope, String scopeKey) {
        return settingMapper.selectOne(new LambdaQueryWrapper<TranslationSetting>()
            .eq(TranslationSetting::getTenantId, tenantId)
            .eq(TranslationSetting::getScope, scope)
            .eq(scopeKey == null, TranslationSetting::getScopeKey, null)
            .eq(scopeKey != null, TranslationSetting::getScopeKey, scopeKey)
            .last("LIMIT 1"));
    }

    /** 客户行的读取：不建行。没有覆盖行就是"跟随全局"。 */
    private TranslationSetting customerRow(Long tenantId, Long customerId) {
        return settingRow(tenantId, "customer", String.valueOf(customerId));
    }
```

`requireSettings(tenantId)` 保持原样（内部改用 `settingRow(tenantId, "global", null)`），这样 P5 已验证的全局行为一字不动。

```java
    // 2) translate()：入口先解析生效行，其余逻辑一律读 s.* 而不是全局
    public TranslateVO translate(Long tenantId, TranslateDTO dto) {
        if (!"receive".equals(dto.type()) && !"send".equals(dto.type())) {
            throw new BizException(40000, "type 只能是 receive 或 send");
        }
        TranslationSetting customer = dto.customerId() == null ? null : customerRow(tenantId, dto.customerId());
        ScopeSettings.Resolved resolved = ScopeSettings.resolve(dto.customerId(), customer, requireSettings(tenantId));
        TranslationSetting s = resolved.setting();
        // ……以下与 P5 相同：取 fromLang / toLang / channel、归一化、缓存、R7、线上路由
    }

    // 3) 缓存 key 不变：key 里已经含 type + channel + from + to（buildCacheKey），
    //    语向不同天然分键，所以按客户切换语向不需要新增失效逻辑（spec §5）。
```

```java
    /** 保存：scope=customer 时从全局整份复制后覆盖，保证"整行取用"成立。 */
    @Transactional
    public TranslationSettingVO updateScopedSettings(Long tenantId, String scope, Long scopeKey,
                                                     TranslationSettingInput input) {
        if (!"global".equals(scope) && !"customer".equals(scope)) {
            throw new BizException(40000, "scope 只能是 global 或 customer");
        }
        if ("global".equals(scope)) {
            return updateSettings(tenantId, input);
        }
        if (scopeKey == null) {
            throw new BizException(40000, "scope=customer 时必须带 scopeKey");
        }
        Customer customer = customerMapper.selectOne(new LambdaQueryWrapper<Customer>()
            .eq(Customer::getTenantId, tenantId).eq(Customer::getId, scopeKey).last("LIMIT 1"));
        if (customer == null) {
            throw new BizException(40404, "客户不存在: " + scopeKey);
        }
        TranslationSetting existing = customerRow(tenantId, scopeKey);
        if (existing == null) {
            existing = copyOf(requireSettings(tenantId), tenantId, scopeKey);
            settingMapper.insert(existing);
        }
        // updateSettings 只认全局行，这里复用它同样的校验 + 赋值：把行 id 换掉即可。
        return saveInto(existing, tenantId, input);
    }
```

落地时把现有 `updateSettings` 的"校验 + 逐字段赋值 + 写库"抽成 `private TranslationSettingVO saveInto(TranslationSetting current, Long tenantId, TranslationSettingInput input)`，`updateSettings` 与 `updateScopedSettings` 都调它——**校验规则（channel 白名单、hk 只配 Google）不能出现两份**（R5）。`copyOf(global, tenantId, customerId)` 复制除 `id / tenantId / scope / scopeKey / createdAt / updatedAt` 之外的全部字段，并设 `scope='customer'`、`scope_key=String.valueOf(customerId)`。

```java
    @Transactional
    public int clearCustomerSettings(Long tenantId, Long customerId) {
        return settingMapper.delete(new LambdaQueryWrapper<TranslationSetting>()
            .eq(TranslationSetting::getTenantId, tenantId)
            .eq(TranslationSetting::getScope, "customer")
            .eq(TranslationSetting::getScopeKey, String.valueOf(customerId)));
    }
```

`TranslationSettingInput` 尾部加 `String scope; String scopeKey;`（都可空，缺省即 global）；`TranslationSettingVO` 尾部加 `String scope, String scopeKey, boolean inherited`，`toVO` 相应补参数。`TranslateDTO` 尾部加 `Long customerId`。

`TranslationController`：

```java
    @GetMapping("/settings")
    public ApiResponse<TranslationSettingVO> getSettings(@AuthenticationPrincipal AuthPrincipal principal,
                                                         @RequestParam(required = false) Long customerId) {
        return ApiResponse.ok(service.getSettings(principal.tenantId(), customerId));
    }

    @DeleteMapping("/settings/customer/{customerId}")
    public ApiResponse<Map<String, Integer>> clearCustomer(@AuthenticationPrincipal AuthPrincipal principal,
                                                           @PathVariable Long customerId) {
        return ApiResponse.ok(Map.of("cleared", service.clearCustomerSettings(principal.tenantId(), customerId)));
    }
```

`getSettings(tenantId, customerId)` = `toVO(ScopeSettings.resolve(customerId, customerRow(...), requireSettings(...)))`，并让 VO 的 `inherited` 取解析结果；无参重载保留给 P5 已有调用方（`getSettings(tenantId)` → `getSettings(tenantId, null)`）。`PUT /settings` 改为把 `input.scope()` / `input.scopeKey()` 透传给 `updateScopedSettings`。

- [ ] **Step 4: 编译 + 重启 + 契约探针**

`set -o pipefail && ./mvnw -q -DskipTests package`，按 C8 重启。用 Write 落 `tmp/p6b-scope.json`（UTF-8）：`{"customerId":<id>,"text":"你好，我想问下订单","type":"receive"}`。

| # | 断言 | 期望 |
|---|---|---|
| 1 | `GET /api/translation/settings`（无 customerId） | `scope:'global'`、`inherited:true`、语向与 P5 验证值一致 |
| 2 | `PUT /api/translation/settings` body 带 `scope:'customer'`, `scopeKey:<customerId>`, `receiveFromLang:'auto'`, `receiveToLang:'vi'` | `code:0`，`scope:'customer'`，`inherited:false` |
| 3 | `GET /api/translation/settings?customerId=<id>` | 第 2 步写入的那一行；再 `GET ?customerId=<另一个客户 id>` → `inherited:true` 且等于全局（区分"按客户"与"按最近一次写入"） |
| 4 | `POST /api/translation/translate`（`tmp/p6b-scope.json`，customerId=上面那个） | 译文按 `vi` 方向产出，`toLangCode:'vi'` |
| 5 | 同 text 不带 customerId | `toLangCode` 是全局的 `zh-CN`，且 `fromLangCode/toLangCode/cacheKey` 与第 4 条**都不同**（缓存天然分键的证据） |
| 6 | 第 4 条重发一次 | `cached:true`（客户行确实参与了缓存命中，不是每次都重算） |
| 7 | `DELETE /api/translation/settings/customer/<id>` 后 `GET ?customerId=<id>` | `inherited:true`、值回到全局。**本条必须排在第 10 条之后跑**：DELETE 拆掉的正是第 10 条还要读的覆盖行，按表序执行会把第 10 条变成"全局回落"的空断言（Task 6 实跑即为此换了序） |
| 8 | `PUT /settings` 带 `scope:'customer'` 但不带 `scopeKey` | `code:40000` |
| 9 | `PUT /settings` 带 `scope:'customer'`, `scopeKey:999999` | `code:40404` |
| 10 | 第 2 步之后 `PUT /settings`（无 scope，改全局 `receiveToLang:'en'`）再 `GET ?customerId=<id>` | 客户行仍是 `vi`（改全局不能顺手改掉覆盖行） |

```bash
node tmp/p6b-scope-contract.mjs
```

预期：`ALL PASS (10/10)`。**收尾**：第 7 步的 DELETE 已经把客户覆盖行删了；第 10 步把全局 `receiveToLang` 改成了 `en`，脚本最后必须再 `PUT` 回验证前的原值并打印确认（C4：种子与全局设置保持原样）。

- [ ] **Step 5: 后端全量回归 + 提交**

```bash
cd apps/server && set -o pipefail && ./mvnw -q test 2>&1 | tail -20
```

预期：全绿（P5 既有用例 + 本阶段 5 个测试类）。

```bash
git add apps/server/src
git commit -m "feat(P6): 按客户语向解析（scope=customer）与客户级翻译契约"
```

---

## P6b — TS 侧地基（共享模型 + 桥构建管线）

### Task 7: `src/shared/` 纯模型与本仓库第一个 JS 单测闸门

**Files:**
- Create: `apps/desktop/src/shared/chatPlatform.ts` · `chatTypes.ts` · `chatStatus.ts` · `liveTail.ts`
- Test: `apps/desktop/src/shared/chatPlatform.test.ts` · `chatStatus.test.ts` · `liveTail.test.ts`
- Create: `apps/desktop/tsconfig.unit.json`
- Modify: `apps/desktop/package.json`（scripts：+`test:unit` / +`typecheck:unit`，`typecheck` 串上它）
- Modify: `apps/desktop/electron.vite.config.ts`（`main` 与 `renderer` 各加 `@shared` 别名）
- Modify: `apps/desktop/tsconfig.node.json` · `tsconfig.web.json`（`baseUrl` + `paths` + `allowImportingTsExtensions` + include 覆盖 `src/shared`）

**Interfaces:**
- Consumes: 无——这是 TS 侧第一块地基，只允许依赖语言本身。
- Produces（Task 8–18 逐字引用这里的名字与形状）：
  - `type ChatPlatform = 'whatsapp' | 'telegram'`、`isChatPlatform(v: unknown): v is ChatPlatform`、`platformOfAccountType(t: number | null | undefined): ChatPlatform | null`、`accountTypeOfPlatform(p: ChatPlatform): 1 | 4`
  - `type Direction = 'in' | 'out'`、`type MsgStatus = 'received' | 'pending' | 'sent' | 'delivered' | 'read' | 'failed'`、`type MsgSource = 'live' | 'backfill' | 'app_send' | 'native_send'`、`type MediaType = 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'contact' | 'location' | 'unknown'`
  - `interface NormalizedMessage { chatKey; msgKey; direction; senderKey?; senderName?; body?; mediaType; mediaSummary?; msgTimeEpochSec; status; source; sendLocalId?; chatTitle? }` —— 字段名与 Task 3 的 `MessageItemDTO` 一一对应，主进程把 `NormalizedMessage` 原样塞进 `messages[]`
  - `interface LiveFrame { viewId; accountId; platform; activeChatKey; message }`、`type BridgePhase = 'none' | 'mounting' | 'ready' | 'retry' | 'offline' | 'destroyed'`、`interface BridgeState { viewId; accountId; platform; phase; ready; since; detail }`
  - `interface SendRequest { accountId; chatKey; text; localId }`、`type SendError = 'BRIDGE_OFFLINE' | 'SEND_FAILED' | 'CHAT_NOT_FOUND' | 'TIMEOUT'`、`interface SendReceipt { localId; ok; msgKey?; error?; detail? }`
  - `type BridgeReport`（页→主，`kind` 判别）、`type BridgeCommand`（主→页，`kind` 判别）——见 Step 3
  - `WA_ACK`、`fromAck(ack, direction): MsgStatus`、`rankOf(status): number`、`canAdvance(from, to): boolean`
  - `interface TailRow { msgKey: string; ts: number }`、`pendingKey(localId)`、`mergeTail<T extends TailRow>(rows, incoming)`、`settlePending<T extends TailRow>(rows, localId, msgKey, extra?)`
- **不引入任何运行时依赖**：`src/shared` 里不允许 `import` 第三方包、Electron、DOM API。它是三处（页内 / 主进程 / 渲染层）唯一的公共语言。

- [ ] **Step 1: 建 `tsconfig.unit.json` 与脚本，先让它跑一个空测试**

`apps/desktop/tsconfig.unit.json`：

```json
{
  "extends": "@electron-toolkit/tsconfig/tsconfig.node.json",
  "include": ["src/shared/**/*.ts", "src/bridge/**/*.ts"],
  "compilerOptions": {
    "composite": false,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "types": ["node"],
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "baseUrl": ".",
    "paths": { "@shared/*": ["src/shared/*"] }
  }
}
```

两条不为默认的开关各自解决一个具体问题：`allowImportingTsExtensions` 让 `./chatPlatform.ts` 这种带后缀的写法通过类型检查（Node 的类型剥离不做扩展名推断），`erasableSyntaxOnly` 把"`enum` / `namespace` / 参数属性一律禁用"钉成编译错误（TS1294），因为这三种语法在 Node 侧会被剥离成完全不同的东西——闸门的意义就在这条上。

`package.json` 的 scripts 增加两行并把 unit 挂进 typecheck（其余保持不变）：

```json
        "typecheck:unit": "tsc --noEmit -p tsconfig.unit.json",
        "typecheck": "pnpm run typecheck:node && pnpm run typecheck:web && pnpm run typecheck:inject && pnpm run typecheck:unit",
        "test:unit": "node --test \"src/shared/**/*.test.ts\"",
```

（`test:unit` 的 glob 到 Task 8 再补 `src/bridge` 那条。）

```bash
cd apps/desktop && node -v && pnpm run typecheck:unit
```

预期：`v24.x`；**tsc 会以 TS18003 报"No inputs were found"**——Task 7 实跑裁定：include 里的 `src/bridge/**/*` 此时还不存在，空 include 的 tsc 永远不是 0 错误，这一档"空目录绿"是计划文本的错，不是闸门的错。闸门本身能跑的证明挪到 Step 6：src/shared 有第一个文件后 `typecheck:unit` 全绿 + `test:unit` 能跑 RED→GREEN，两件事合起来才算闸门就位。

- [ ] **Step 2: 先写 `chatPlatform.test.ts`（此时实现还不存在，测试必然失败）**

```ts
// src/shared/chatPlatform.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accountTypeOfPlatform, isChatPlatform, platformOfAccountType } from './chatPlatform.ts'

test('platform_type 1 / 4 才是 P6 的支持面，其它一律 null', () => {
  assert.equal(platformOfAccountType(1), 'whatsapp')
  assert.equal(platformOfAccountType(4), 'telegram')
  // 2/3/5/6/7 在既有 PlatformType 里是真实存在的平台：它们必须落到 null，
  // 而不是被当成 whatsapp —— 否则内嵌一个没有桥的平台会静默丢数据。
  for (const t of [0, 2, 3, 5, 6, 7, 1.5, Number.NaN]) assert.equal(platformOfAccountType(t), null)
  for (const t of [undefined, null]) assert.equal(platformOfAccountType(t), null)
})

test('双向映射互逆', () => {
  const wa = platformOfAccountType(1)
  const tg = platformOfAccountType(4)
  assert.equal(wa && accountTypeOfPlatform(wa), 1)
  assert.equal(tg && accountTypeOfPlatform(tg), 4)
})

test('列值是小写字面量：`WhatsApp` / `TELEGRAM` 都不是合法 platform', () => {
  assert.equal(isChatPlatform('whatsapp'), true)
  assert.equal(isChatPlatform('telegram'), true)
  assert.equal(isChatPlatform('WhatsApp'), false)
  assert.equal(isChatPlatform(''), false)
  assert.equal(isChatPlatform(undefined), false)
})
```

```bash
cd apps/desktop && pnpm run test:unit
```

预期：FAIL —— `Cannot find module .../chatPlatform.ts`。若这里就 PASS 了，说明测试没被执行，先修脚本再看。

- [ ] **Step 3: 写 `chatPlatform.ts` 与 `chatTypes.ts`**

```ts
// src/shared/chatPlatform.ts
/**
 * `chat_*` 表里 `platform` 列的取值，与 `platform_account.platform_type` 的映射。
 * Java 侧的同名映射在 `service/msg/ChatKeys.platformOfAccountType`：两处必须同时改。
 */
export type ChatPlatform = 'whatsapp' | 'telegram'

export const WHATSAPP_ACCOUNT_TYPE = 1
export const TELEGRAM_ACCOUNT_TYPE = 4

const BY_CODE = new Map<number, ChatPlatform>([
  [WHATSAPP_ACCOUNT_TYPE, 'whatsapp'],
  [TELEGRAM_ACCOUNT_TYPE, 'telegram']
])

export function isChatPlatform(value: unknown): value is ChatPlatform {
  return value === 'whatsapp' || value === 'telegram'
}

export function platformOfAccountType(type: number | null | undefined): ChatPlatform | null {
  return typeof type === 'number' ? BY_CODE.get(type) ?? null : null
}

export function accountTypeOfPlatform(platform: ChatPlatform): 1 | 4 {
  return platform === 'whatsapp' ? WHATSAPP_ACCOUNT_TYPE : TELEGRAM_ACCOUNT_TYPE
}
```

```ts
// src/shared/chatTypes.ts
import type { ChatPlatform } from './chatPlatform.ts'

export type Direction = 'in' | 'out'
/** `received` 只属于 in；out 用后五个。 */
export type MsgStatus = 'received' | 'pending' | 'sent' | 'delivered' | 'read' | 'failed'
export type MsgSource = 'live' | 'backfill' | 'app_send' | 'native_send'
export type MediaType =
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'document'
  | 'sticker'
  | 'contact'
  | 'location'
  | 'unknown'

export const MEDIA_TYPES: readonly MediaType[] = [
  'text', 'image', 'audio', 'video', 'document', 'sticker', 'contact', 'location', 'unknown'
]

/** 桥归一化产出的原子单位；字段名与后端 `MessageItemDTO` 逐字一致，主进程不做改名直传。 */
export interface NormalizedMessage {
  chatKey: string
  msgKey: string
  direction: Direction
  senderKey?: string
  senderName?: string
  body?: string | null
  mediaType: MediaType
  mediaSummary?: string | null
  /** 平台原始秒值，交给 Java 换算（收敛 #9）。 */
  msgTimeEpochSec: number
  status: MsgStatus
  source: MsgSource
  sendLocalId?: string
  chatTitle?: string
}

/** 主进程广播给渲染层的一帧：入库用的 message + 判断未读数要的活动会话。 */
export interface LiveFrame {
  viewId: string
  accountId: number
  platform: ChatPlatform
  activeChatKey: string | null
  message: NormalizedMessage
}

export type BridgePhase = 'none' | 'mounting' | 'ready' | 'retry' | 'offline' | 'destroyed'

export interface BridgeState {
  viewId: string
  accountId: number | null
  platform: ChatPlatform | null
  phase: BridgePhase
  ready: boolean
  /** 进入当前 phase 的时刻（epoch ms），UI 用来显示"上次心跳"。 */
  since: number
  detail: string | null
}

export interface SendRequest {
  accountId: number
  chatKey: string
  text: string
  localId: string
}

export type SendError = 'BRIDGE_OFFLINE' | 'SEND_FAILED' | 'CHAT_NOT_FOUND' | 'TIMEOUT'

export interface SendReceipt {
  localId: string
  ok: boolean
  msgKey?: string
  error?: SendError
  detail?: string
}

/** 页 → 主。全部经 `window.ele.sendToHost('msg-report', report)`，不带任何凭据（C2）。 */
export type BridgeReport =
  | { kind: 'ready'; bridgeVersion: string }
  | { kind: 'pong'; bridgeVersion: string }
  | { kind: 'message'; message: NormalizedMessage }
  | { kind: 'backfill_progress'; chatsDone: number; chatsTotal: number; messages: number }
  | { kind: 'backfill_gap'; chatKey: string; reason: string }
  | { kind: 'send_result'; localId: string; ok: boolean; msgKey?: string; error?: SendError; detail?: string }
  | { kind: 'ack'; chatKey: string; msgKey: string; status: MsgStatus }
  | { kind: 'active_chat'; chatKey: string | null }
  | { kind: 'logged_out' }

/** 主 → 页，走既有的 `view:host:msg-cmd` 推送通道。 */
export type BridgeCommand =
  | { kind: 'ping' }
  | { kind: 'send'; localId: string; chatKey: string; text: string }
  | { kind: 'backfill'; limit: number }
  | { kind: 'open_chat'; chatKey: string }

export interface BridgeInstallConfig {
  bridgeVersion: string
  platform: ChatPlatform
  viewId: string
  /** 补底每会话条数（spec §4 的 msgHistoryLimit）。 */
  historyLimit: number
}
```

- [ ] **Step 4: 写 `chatStatus.test.ts`，再写实现**

测试里最关键的一组是 `canAdvance` 的六条断言——它们是后端 `advanceStatus` 那条 SQL 守卫的镜像，两边必须一致：

```ts
// src/shared/chatStatus.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WA_ACK, canAdvance, fromAck, rankOf } from './chatStatus.ts'

test('发出消息的 ack → 状态词；缺省与未知值落 pending，不猜成功', () => {
  assert.equal(fromAck(WA_ACK.SENT, 'out'), 'sent')
  assert.equal(fromAck(WA_ACK.DELIVERED, 'out'), 'delivered')
  assert.equal(fromAck(WA_ACK.READ, 'out'), 'read')
  assert.equal(fromAck(WA_ACK.PLAYED, 'out'), 'read')
  assert.equal(fromAck(WA_ACK.FAILED, 'out'), 'failed')
  assert.equal(fromAck(WA_ACK.PENDING, 'out'), 'pending')
  assert.equal(fromAck(undefined, 'out'), 'pending')
  assert.equal(fromAck(99, 'out'), 'pending')
})

test('接收方向不看 ack：收到就是 received', () => {
  for (const ack of [undefined, 0, 1, 3, -1, 99]) assert.equal(fromAck(ack, 'in'), 'received')
})

test('canAdvance 与后端 SQL 守卫同形（这六条是 Task 3 契约探针的镜像）', () => {
  assert.equal(canAdvance('sent', 'delivered'), true)
  assert.equal(canAdvance('delivered', 'sent'), false)
  assert.equal(canAdvance('delivered', 'delivered'), false)
  assert.equal(canAdvance('read', 'failed'), false)
  assert.equal(canAdvance('pending', 'failed'), true)
  assert.equal(canAdvance('sent', 'failed'), true)
  assert.equal(canAdvance('failed', 'sent'), false)
  // in 的 received 不在阶梯上：它永远不接受后续推进。
  assert.equal(canAdvance('received', 'sent'), false)
  assert.equal(canAdvance('bogus', 'read'), false)
})

test('rankOf：阶梯外一律 -1，阶梯内单调', () => {
  assert.deepEqual(
    ['pending', 'sent', 'delivered', 'read'].map(rankOf),
    [0, 1, 2, 3]
  )
  assert.equal(rankOf('received'), -1)
  assert.equal(rankOf('failed'), -1)
  assert.equal(rankOf(''), -1)
})
```

```ts
// src/shared/chatStatus.ts
import type { Direction, MsgStatus } from './chatTypes.ts'

/**
 * WhatsApp 页内 `MsgModel.ack` 的取值。只在这里出现一次：
 * Java 侧收到的已经是翻译好的状态词（收敛 #3、#12），不重复这套数字。
 * 装包后用 `grep -n "Ack" node_modules/@wppconnect/wa-js/dist/*.d.ts` 复核（Task 8 Step 1）。
 */
export const WA_ACK = {
  FAILED: -1,
  PENDING: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  PLAYED: 4
} as const

const LADDER: readonly MsgStatus[] = ['pending', 'sent', 'delivered', 'read']

export function rankOf(status: string): number {
  return LADDER.indexOf(status as MsgStatus)
}

export function fromAck(ack: number | undefined | null, direction: Direction): MsgStatus {
  if (direction === 'in') return 'received'
  switch (ack) {
    case WA_ACK.FAILED:
      return 'failed'
    case WA_ACK.SENT:
      return 'sent'
    case WA_ACK.DELIVERED:
      return 'delivered'
    case WA_ACK.READ:
    case WA_ACK.PLAYED:
      return 'read'
    default:
      return 'pending'
  }
}

/**
 * `ChatMessageMapper.advanceStatus` 里那段 `FIELD()` 比较的 TS 同形实现。
 * 两边各写一次是有意的：页内要用它决定"这条 ack 事件值不值得上报"，
 * 后端要用它决定"这次更新值不值得写库"。测试把同一组断言喂给两边。
 */
export function canAdvance(from: string, to: string): boolean {
  if (to === 'failed') return from === 'pending' || from === 'sent'
  const f = rankOf(from)
  const t = rankOf(to)
  return f >= 0 && t > f
}
```

- [ ] **Step 5: 写 `liveTail.test.ts`，再写实现**

```ts
// src/shared/liveTail.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeTail, pendingKey, settlePending, type TailRow } from './liveTail.ts'

const row = (msgKey: string, ts: number, extra: Record<string, unknown> = {}): TailRow & Record<string, unknown> => ({
  msgKey,
  ts,
  ...extra
})

test('mergeTail：同 msgKey 覆盖字段而不新增行（状态推进的落点）', () => {
  const before = [row('a', 10, { status: 'sent' })]
  const after = mergeTail(before, [row('a', 10, { status: 'delivered' })])
  assert.equal(after.length, 1)
  assert.equal(after[0].status, 'delivered')
})

test('mergeTail：翻页窗口之外的旧尾巴丢弃，窗口之后的按时间插入', () => {
  const before = [row('b', 20), row('c', 30)]
  const after = mergeTail(before, [row('a', 10), row('d', 40), row('c2', 25)])
  // 'a' 比窗口里最早的一行还旧且不在库里 → 以库为准，丢弃。
  assert.deepEqual(after.map((r) => r.msgKey), ['b', 'c2', 'c', 'd'])
})

test('mergeTail：空入参与空 incoming 都不炸', () => {
  assert.deepEqual(mergeTail([], []), [])
  assert.deepEqual(mergeTail([], [row('x', 5)]).map((r) => r.msgKey), ['x'])
})

test('settlePending：乐观气泡原地换成真实 msgKey，位置不动、行数不增', () => {
  const before = [row(pendingKey('L1'), 100, { status: 'pending' }), row('c', 120)]
  const after = settlePending(before, 'L1', '真-39', { status: 'sent' })
  assert.equal(after.length, 2)
  assert.equal(after[0].msgKey, '真-39')
  assert.equal(after[0].status, 'sent')
  assert.equal(after[1].msgKey, 'c')
})

test('settlePending：库行已经先到时不重复插气泡', () => {
  const before = [row('真-39', 100), row('c', 120)]
  const after = settlePending(before, 'L1', '真-39', { status: 'read' })
  assert.equal(after.length, 2)
  assert.equal(after[0].msgKey, '真-39')
  // 找不到待空气泡但真实键已存在 → 就地把状态并进去，仍然不新增行。
  assert.equal(after[0].status, 'read')
})
```

```ts
// src/shared/liveTail.ts
/**
 * 记录页的"尾巴"合并：历史读库、live 吃推送，两路在同一个数组里相遇（spec §4 第 5 条）。
 * 只认 msgKey 与 ts 两个字段，所以调用方带什么行形状都行。
 */
export interface TailRow {
  msgKey: string
  ts: number
}

/** 乐观气泡还没有平台 id，用前缀标出来，避免与真实键撞车。 */
export const PENDING_PREFIX = '~'

export function pendingKey(localId: string): string {
  return `${PENDING_PREFIX}${localId}`
}

export function isPendingRow(row: TailRow): boolean {
  return row.msgKey.startsWith(PENDING_PREFIX)
}

/**
 * 并入 live 帧。三条规则，缺一会出肉眼可见的错：
 * 1) 同 msgKey 覆盖不新增——状态推进与"补底 + 实时"交叠；
 * 2) 比窗口头部还旧且没见过的行丢弃——否则上滑翻页时尾巴会往回长；
 * 3) 结果恒按 ts 升序——气泡顺序错乱是最刺眼的 bug。
 */
export function mergeTail<T extends TailRow>(rows: readonly T[], incoming: readonly T[]): T[] {
  if (incoming.length === 0) return [...rows]
  const out: T[] = [...rows]
  const oldest = out.length > 0 ? Math.min(...out.map((r) => r.ts)) : Number.NEGATIVE_INFINITY
  for (const next of incoming) {
    const at = out.findIndex((r) => r.msgKey === next.msgKey)
    if (at >= 0) {
      out[at] = { ...out[at], ...next, ts: Math.max(out[at].ts, next.ts) }
      continue
    }
    if (next.ts < oldest) continue
    out.push(next)
  }
  return out.sort((a, b) => a.ts - b.ts)
}

/**
 * 回执到了：把 `~localId` 那行原地改成真实 msgKey。
 * 气泡已经不在（例如列表刷新把库行拉进来了）时不新增行，只把真实键那行的字段并上。
 */
export function settlePending<T extends TailRow>(
  rows: readonly T[],
  localId: string,
  msgKey: string,
  extra?: Partial<T>
): T[] {
  const key = pendingKey(localId)
  const at = rows.findIndex((r) => r.msgKey === key)
  if (at < 0) return mergeTail(rows, msgKey ? [{ msgKey, ts: 0, ...extra } as T] : [])
  const out = [...rows]
  out[at] = { ...out[at], ...extra, msgKey }
  return out
}
```

- [ ] **Step 6: 跑测试到全绿，再把它接进 typecheck 与打包别名**

```bash
cd apps/desktop && pnpm run test:unit 2>&1 | tail -20 && pnpm run typecheck:unit
```

预期：`# pass 12` / `# fail 0`（chatPlatform 3 + chatStatus 4 + liveTail 5）；tsc 无错误。

`electron.vite.config.ts` 加别名（`main` 段现在是空的 `{}`，照下面写）：

```ts
export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    /* 原样不动 */
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
```

`tsconfig.node.json` 与 `tsconfig.web.json` 各加三处（`baseUrl` / `paths` / `allowImportingTsExtensions`），把 shared 纳入 include，**并把测试文件从这两个工程里排除出去**：

```jsonc
// tsconfig.node.json
{
  "extends": "@electron-toolkit/tsconfig/tsconfig.node.json",
  "include": ["electron.vite.config.*", "src/main/**/*", "src/preload/**/*", "src/shared/**/*"],
  "exclude": ["src/shared/**/*.test.ts"],
  "compilerOptions": {
    "composite": true,
    "types": ["electron-vite/node"],
    "allowImportingTsExtensions": true,
    "baseUrl": ".",
    "paths": { "@shared/*": ["src/shared/*"] }
  }
}
```

`tsconfig.web.json` 同样加 `"allowImportingTsExtensions": true`、`paths` 里加 `"@shared/*": ["src/shared/*"]`、`include` 里加 `"src/shared/**/*"`、`exclude` 里加 `"src/shared/**/*.test.ts"`。

> `exclude` 那一条不是洁癖：`tsconfig.node.json` 把 `types` 覆盖成了 `["electron-vite/node"]`，`node:test` / `node:assert` 在里面解析不到。测试文件只归 `tsconfig.unit.json` 管——那里 `types: ["node"]`。

> `allowImportingTsExtensions` 要求 `noEmit`；这两个工程本来就只被 `tsc --noEmit -p … --composite false` 调起（见 package.json 的 typecheck 脚本），所以能开。这是 shared 里必须写 `.ts` 后缀（Node 侧）与主/渲染侧走打包（不写后缀）两套口径能共存的前提。

```bash
cd apps/desktop && pnpm run typecheck
```

预期：四个 typecheck 全绿。

- [ ] **Step 7: 提交**

```bash
git add apps/desktop/src/shared apps/desktop/tsconfig.unit.json apps/desktop/package.json apps/desktop/electron.vite.config.ts apps/desktop/tsconfig.node.json apps/desktop/tsconfig.web.json
git commit -m "feat(P6): shared 聊天纯模型与 node:test 单测闸门"
```

---

### Task 8: 消息桥构建管线（wa-js 独立 bundle + 桥 bundle + 打包资源）

**Files:**
- Create: `apps/desktop/scripts/build-bridge.mjs`
- Modify: `apps/desktop/package.json`（devDep `@wppconnect/wa-js@4.6.0`；scripts +`build:bridge` / +`watch:bridge`；`predev` 与 `build` 串上它；`test:unit` glob 补 `src/bridge`）
- Modify: `apps/desktop/electron-builder.yml`（`extraResources` 两条）
- Modify: `.gitignore`（忽略两个生成 bundle）
- Create: `apps/desktop/src/bridge/host.ts` · `apps/desktop/src/bridge/index.ts`（本任务只到"能构建出 bundle 且能被 `executeJavaScript` 跑起来握手"，采集与发送在 Task 11/12）
- Test: `apps/desktop/src/bridge/host.test.ts`

**Interfaces:**
- Consumes: Task 7 的 `chatTypes.ts`（`BridgeReport` / `BridgeCommand` / `BridgeInstallConfig`）。
- Produces:
  - `resources/msg-bridge.bundle.js`（IIFE，全局 `__SCRM_BRIDGE_BUNDLE__`，导出 `install(config)` 与 `destroy()`）
  - `resources/wa-js.bundle.js`（`@wppconnect/wa-js` 的 `dist/wppconnect-wa.js` 原样复制；装载后页面里出现 `self.WPP`）
  - bundle 版本号：不产 `bridgeVersionOf` 具名函数——Task 10 的 `bridgeMount` 在注入点内联 `createHash('sha1').update(source).digest('hex').slice(0, 12)`，两份 bundle 各算各的（不额外产文件，不手填版本号）
  - `apps/desktop/src/bridge/host.ts`：`report(r: BridgeReport): void`（`window.ele.sendToHost('msg-report', r)` 的封装 + 上报节流）、`onCommand(cb: (c: BridgeCommand) => void): () => void`
  - 通道常量：页→主 `'msg-report'`；主→页 `'msg-cmd'`（Task 10 在 `routePageMessage` 里认这两个）

- [ ] **Step 1: 装包并按页内事实复核 ack 数字与全局名**

```bash
cd apps/desktop && pnpm add -D @wppconnect/wa-js@4.6.0
grep -n "self.WPP" node_modules/@wppconnect/wa-js/dist/wppconnect-wa.js | tail -3
grep -rn "ACK_SENT\|ACK_DELIVERED\|ACK_READ\|ACK_FAILED\|ACK_PLAYED" node_modules/@wppconnect/wa-js/dist/types/chat/functions/base.d.ts | head -20
```

预期：第一行命中 `self.WPP = exports`（证明"单独一次 executeJavaScript 后 `window.WPP` 可用"这个前提成立）；第二行给出 `ACK_SENT: 1 / ACK_DELIVERED: 2 / ACK_READ: 3 / ACK_PLAYED: 4 / ACK_FAILED: -1`。

**若第二个 grep 的取值与 `WA_ACK`（Task 7）不一致，以这里读到的为准改掉 `chatStatus.ts` 与其测试，并让测试跑绿后才继续**。这条不是形式：ack 数字错了，发出消息的状态会永久停在 pending 或直接跳错，而这只能靠读它自己的类型定义确认，不能凭记忆。

- [ ] **Step 2: 写 `scripts/build-bridge.mjs`**

```js
/**
 * 页内消息桥的独立构建。产物两份：
 *   resources/msg-bridge.bundle.js  —— 我们的桥（IIFE，全局 __SCRM_BRIDGE_BUNDLE__）
 *   resources/wa-js.bundle.js       —— @wppconnect/wa-js 原样搬运（IIFE，末尾 self.WPP = exports）
 * 分两份是刻意的：wa-js 体积按 MB 计、升级节奏与桥不同，
 * 主进程因此可以"先装 wa-js、再装桥"，并且只在页面首次 ready 时装前者。
 *
 *   node scripts/build-bridge.mjs          # 单次
 *   node scripts/build-bridge.mjs --watch  # watch（inline sourcemap，不压缩）
 */
import { build, context } from 'esbuild'
import { copyFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const isWatch = process.argv.includes('--watch')

const WA_SRC = path.join(root, 'node_modules/@wppconnect/wa-js/dist/wppconnect-wa.js')
const WA_OUT = path.join(root, 'resources/wa-js.bundle.js')

const config = {
  entryPoints: [path.join(root, 'src/bridge/index.ts')],
  bundle: true,
  outfile: path.join(root, 'resources/msg-bridge.bundle.js'),
  format: 'iife',
  globalName: '__SCRM_BRIDGE_BUNDLE__',
  platform: 'browser',
  target: ['chrome100'],
  sourcemap: isWatch ? 'inline' : false,
  minify: !isWatch,
  logLevel: 'info',
  // 桥跑在第三方页里：console 一律不带出去（C3），错误只经 report() 回主进程。
  ...(!isWatch ? { drop: ['console', 'debugger'] } : {})
}

async function main() {
  console.log(`[bridge] Build mode: ${isWatch ? 'watch' : 'production'}`)
  await copyFile(WA_SRC, WA_OUT)
  console.log(`[bridge] wa-js -> resources/wa-js.bundle.js`)
  if (isWatch) {
    const ctx = await context(config)
    await ctx.watch()
    console.log('[bridge] Watching for changes... Press Ctrl+C to stop.')
  } else {
    await build(config)
    console.log('[bridge] Build completed successfully')
  }
}

main().catch((e) => {
  console.error('[bridge] Build failed:', e)
  process.exit(1)
})
```

> `copyFile` 走的是 `node_modules` 里的路径；打包（`electron-builder`）时 `node_modules` 不在最终包内，所以复制必须发生在**构建期**（下一步的 scripts 串接），产物作为 `extraResources` 进包。

- [ ] **Step 3: 写 `host.ts` 与最小 `index.ts`，先只到握手**

`host.ts` 只解决一件事：页内脚本对外沟通的唯一出口，以及一个可单测的形状。

```ts
// src/bridge/host.ts
import type { BridgeCommand, BridgeReport } from '../shared/chatTypes.ts'

/** 页 → 主 的唯一上行通道名；主 → 页 的唯一下行通道名。Task 10 的白名单认这两个。 */
export const REPORT_CHANNEL = 'msg-report'
export const COMMAND_CHANNEL = 'msg-cmd'

/** 由 `preload/view.ts` 暴露。桥脚本零凭据、零 HTTP（C2），所以只需要这一个入口。 */
interface EleBridge {
  sendToHost: (channel: string, data?: unknown) => void
  on: (channel: string, cb: (payload: unknown) => void) => () => void
}

declare global {
  interface Window {
    ele?: EleBridge
  }
}

function ele(): EleBridge | null {
  return typeof window !== 'undefined' && window.ele ? window.ele : null
}

type Sink = (channel: string, data: unknown) => void

/**
 * 上行出口可替换：默认走 `window.ele`。
 * `node --test` 里没有 window，也没有 IPC——不注入就只能看着 report() 静默丢弃，
 * "哪些帧被合了、哪些没合"就永远测不到。生产路径不 set 它，行为与直接 sendToHost 完全一致。
 */
let sink: Sink | null = null

export function setSink(next: Sink | null): void {
  sink = next
}

export function report(r: BridgeReport): void {
  if (sink) sink(REPORT_CHANNEL, r)
  else ele()?.sendToHost(REPORT_CHANNEL, r)
}

/** 背压：live 帧在补底期间可能成百上千，按 kind 合帧上报，避免打爆 IPC。 */
export function makeThrottledReporter(intervalMs = 200): (r: BridgeReport) => void {
  const latest = new Map<string, BridgeReport>()
  let timer: ReturnType<typeof setTimeout> | null = null
  const drain = (): void => {
    timer = null
    for (const r of latest.values()) report(r)
    latest.clear()
  }
  return (r: BridgeReport): void => {
    // 只有"同 kind 的进度类"可合帧；message / send_result 每条都要真上报。
    if (r.kind === 'backfill_progress') {
      latest.set(r.kind, r)
      if (!timer) timer = setTimeout(drain, intervalMs)
      return
    }
    report(r)
  }
}

export function onCommand(cb: (c: BridgeCommand) => void): () => void {
  const bridge = ele()
  if (!bridge) return () => undefined
  return bridge.on(COMMAND_CHANNEL, (payload) => {
    if (payload && typeof payload === 'object' && 'kind' in payload) cb(payload as BridgeCommand)
  })
}
```

```ts
// src/bridge/index.ts —— 本任务到此为止：握手 + 心跳应答 + 卸载
import { makeThrottledReporter, onCommand, report } from './host.ts'
import type { BridgeCommand, BridgeInstallConfig } from '../shared/chatTypes.ts'

let installed: BridgeInstallConfig | null = null
let offCommand: (() => void) | null = null
/** 装好后由 mount 调用；send / backfill / open_chat 的 case 在 Task 12 / 14 里补。 */
let handle: ((cmd: BridgeCommand) => void) | null = null

export function install(config: BridgeInstallConfig): boolean {
  if (installed && installed.bridgeVersion === config.bridgeVersion) return false
  destroy()
  installed = config
  const push = makeThrottledReporter()
  handle = (cmd: BridgeCommand): void => {
    if (cmd.kind === 'ping') push({ kind: 'pong', bridgeVersion: config.bridgeVersion })
  }
  offCommand = onCommand((cmd) => handle?.(cmd))
  // 同步返回值给主进程：见下方注释
  push({ kind: 'pong', bridgeVersion: config.bridgeVersion })
  report({ kind: 'ready', bridgeVersion: config.bridgeVersion })
  return true
}

export function destroy(): void {
  offCommand?.()
  offCommand = null
  handle = null
  installed = null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).__SCRM_BRIDGE_DESTROY__ = (): void => {
  destroy()
}
```

> `install()` 在 `ready` 之前先 `pong` 一次：主进程用"同一段 `executeJavaScript` 的返回值"判断装没装上，而 `ready` 走异步 IPC 上行，返回值为 `true` 是最快的确认。这一点在 Task 10 的 `bridgeMount` 里会被依赖，别反过来。

- [ ] **Step 4: `host.test.ts` —— 合帧行为是这里唯一有逻辑的东西，逐条钉住**

```ts
// src/bridge/host.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COMMAND_CHANNEL, REPORT_CHANNEL, makeThrottledReporter, report, setSink } from './host.ts'
import type { BridgeReport } from '../shared/chatTypes.ts'

const message = (id: string): BridgeReport => ({
  kind: 'message',
  message: {
    chatKey: '861380000@c.us', msgKey: id, direction: 'in', mediaType: 'text',
    msgTimeEpochSec: 1_700_000_000, status: 'received', source: 'live', body: id
  }
})

/** 换一个收集器接住上行帧；每个用例自己决定要不要 setSink(null) 还原。 */
function collect(): { out: { channel: string; data: unknown }[] } {
  const out: { channel: string; data: unknown }[] = []
  setSink((channel, data) => void out.push({ channel, data }))
  return { out }
}

test('通道名固定：Task 10 的白名单与这里必须是同一字面值', () => {
  assert.equal(REPORT_CHANNEL, 'msg-report')
  assert.equal(COMMAND_CHANNEL, 'msg-cmd')
})

test('backfill_progress 在窗口内合帧，留的是最后一条', async () => {
  const { out } = collect()
  const push = makeThrottledReporter(10)
  push({ kind: 'backfill_progress', chatsDone: 1, chatsTotal: 3, messages: 5 })
  push({ kind: 'backfill_progress', chatsDone: 2, chatsTotal: 3, messages: 9 })
  push({ kind: 'backfill_progress', chatsDone: 3, chatsTotal: 3, messages: 14 })
  // 0 是区分性证据：没合帧时这里是 3。
  assert.equal(out.length, 0)
  await new Promise((r) => setTimeout(r, 40))
  assert.equal(out.length, 1)
  assert.equal((out[0].data as { chatsDone: number }).chatsDone, 3)
  assert.equal(out[0].channel, REPORT_CHANNEL)
  setSink(null)
})

test('message / send_result 每条直达，不进合帧窗口', () => {
  const { out } = collect()
  const push = makeThrottledReporter(1000)
  push(message('a'))
  push(message('b'))
  push({ kind: 'send_result', localId: 'L1', ok: true, msgKey: '真-1' })
  assert.equal(out.length, 3)
  setSink(null)
})

test('没有 sink 也没有 window.ele 时静默丢弃，不抛', () => {
  setSink(null)
  assert.doesNotThrow(() => report(message('x')))
})
```

```bash
cd apps/desktop && pnpm run test:unit 2>&1 | tail -15
```

预期：`# pass 16` / `# fail 0`（Task 7 的 12 条 + 本任务的 4 条）。

- [ ] **Step 5: 接进构建链，确认 bundle 真的产出来了且不含凭据**

`package.json`：

```json
        "build:bridge": "node scripts/build-bridge.mjs",
        "watch:bridge": "node scripts/build-bridge.mjs --watch",
        "test:unit": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test \"src/shared/**/*.test.ts\" \"src/bridge/**/*.test.ts\"",
        "predev": "pnpm run build:inject && pnpm run build:bridge",
        "build": "pnpm run typecheck && pnpm run build:inject && pnpm run build:bridge && electron-vite build",
```

`electron-builder.yml` 的 `extraResources`：

```yaml
extraResources:
  - from: resources/inject.bundle.js
    to: inject.bundle.js
  - from: resources/msg-bridge.bundle.js
    to: msg-bridge.bundle.js
  - from: resources/wa-js.bundle.js
    to: wa-js.bundle.js
```

`.gitignore`（紧接现有 inject bundle 那两行）：

```
# Generated message bridge bundles (built by apps/desktop build:bridge)
apps/desktop/resources/msg-bridge.bundle.js
apps/desktop/resources/wa-js.bundle.js
```

```bash
cd apps/desktop && pnpm run build:bridge && ls -l resources/
node -e "const f=['resources/msg-bridge.bundle.js','resources/wa-js.bundle.js'];for(const p of f){const s=require('fs').readFileSync(p,'utf8');console.log(p,s.length,/authorization|Bearer|accessToken|127\.0\.0\.1:8180/i.test(s)?'CREDENTIAL-LIKE-FOUND(FAIL)':'clean')}"
```

预期：两个文件都在，`msg-bridge.bundle.js` 约几 KB、`wa-js.bundle.js` 约 1 MB 级；两行都打印 `clean`。第二个检查是 C2 红线的静态一面：桥产物里不该出现凭据字样或后端地址（真正的运行时验证在 Task 11 Step 6，读的是页面里的实际网络行为）。

- [ ] **Step 6: 提交**

```bash
git add apps/desktop/package.json pnpm-lock.yaml apps/desktop/scripts/build-bridge.mjs apps/desktop/src/bridge .gitignore apps/desktop/electron-builder.yml
git commit -m "feat(P6): 消息桥构建管线（wa-js 独立 bundle + 桥 bundle + 打包资源）"
```

---

## P6c — 主进程三件套（采集队列 / 发送登记 / 后端跳）

### Task 9: `collectorHub` / `sendRegistry` / `msgApi`——不碰 Electron 也能进闸门的三块

**Files:**
- Create: `apps/desktop/src/main/services/msgBridge/collectorHub.ts` · `sendRegistry.ts` · `msgApi.ts`
- Test: `apps/desktop/src/main/services/msgBridge/collectorHub.test.ts` · `sendRegistry.test.ts` · `msgApi.test.ts`
- Modify: `apps/desktop/tsconfig.unit.json`（`include` 按名字追加三份实现 + 本目录测试）
- Modify: `apps/desktop/package.json`（`test:unit` 追加第三条 glob）

**Interfaces:**
- Consumes: Task 7 的 `@shared/chatTypes`（`NormalizedMessage` / `LiveFrame` / `SendReceipt` / `SendError` / `SendRequest` / `MsgStatus`）；Task 3 定下的两个响应形状（batch 的 `{accepted,duplicated,rejected,reasons}`、status 的 `{updated}`）。
- Produces（Task 10 / 12 只认这些）：
  - `collectorHub.ts`：`BatchPayload { accountId: number; activeChatKey: string | null; messages: NormalizedMessage[] }`、`BatchResult { accepted: number; duplicated: number; rejected: number; reasons: string[] }`、`type FlushFn`、`HubOptions { flush; batchSize?; maxQueue?; flushIntervalMs?; retries? }`、`class CollectorHub`（`push(frame: LiveFrame): void`、`flush(): Promise<void>`、`dispose(): void`、`size(): number`、`get dropped: number`）
  - `sendRegistry.ts`：`class SendRegistry`（`get size`、`pending(): string[]`、`add(localId, viewId): Promise<SendReceipt>`、`settle(receipt): boolean`、`failView(viewId, error, detail?): number`、`dispose(): void`）；Task 12 在同一文件追加 `SendAttribution`
  - `msgApi.ts`：`MsgApiOptions { token; fetchImpl?; apiBase? }`、`DEFAULT_API_BASE`、`createMsgApi(opts)` → `{ postBatch, postStatuses, listAccounts }`、`isSendable(req: SendRequest): boolean`
  - `async function listAccounts(): Promise<AccountRow[]>`，`AccountRow { id; platformType; viewId; name; status }`

> 这三块为什么值得单独成任务：它们是 P6 里唯一"行为复杂但没有宿主依赖"的主进程代码——攒批、退避、超时、归属都能在纯 Node 里断言。放进闸门的代价是它们必须保持可擦除语法（`erasableSyntaxOnly` 会把参数属性判成 TS1294，所以三份实现的构造器一律写成"字段声明 + 构造体赋值"）与零 `import 'electron'`；换来的是 Task 10 接线时，采集与发送的语义已经绿过一遍，主进程联调只需要盯挂载与路由。

- [ ] **Step 1: 先把闸门扩到 `src/main`，再写 `collectorHub` 的失败用例**

`tsconfig.unit.json` 的 `include` 从两条变五条——**按名字列三份实现，不给整目录**：

```json
  "include": [
    "src/shared/**/*.ts",
    "src/bridge/**/*.ts",
    "src/main/services/msgBridge/collectorHub.ts",
    "src/main/services/msgBridge/sendRegistry.ts",
    "src/main/services/msgBridge/msgApi.ts",
    "src/main/services/msgBridge/*.test.ts"
  ],
```

写成 `src/main/**/*.ts` 的后果：`bridgeMount.ts` 里那句 `import { app } from 'electron'` 会在 `types: ["node"]` 的这份配置下报一屏找不到模块，然后有人把 `erasableSyntaxOnly` 关掉——闸门最有价值的那一条就这么废了。三份干净文件按名字进来，脏文件自然留在外面。

`package.json` 的 `test:unit` 补第三条 glob（否则新建的三份测试根本不会被跑到，"全绿"是假的）：

```json
        "test:unit": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test \"src/shared/**/*.test.ts\" \"src/bridge/**/*.test.ts\" \"src/main/services/msgBridge/**/*.test.ts\"",
```

```ts
// src/main/services/msgBridge/collectorHub.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CollectorHub, type BatchPayload, type BatchResult } from './collectorHub.ts'
import type { LiveFrame, NormalizedMessage } from '../../shared/chatTypes.ts'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const msg = (chatKey: string, id: string): NormalizedMessage => ({
  chatKey, msgKey: id, direction: 'in', mediaType: 'text', body: id,
  msgTimeEpochSec: 1_700_000_000, status: 'received', source: 'live'
})

const frame = (accountId: number, chatKey: string, id: string): LiveFrame => ({
  viewId: `view-${accountId}`, accountId, platform: 'whatsapp', activeChatKey: chatKey, message: msg(chatKey, id)
})

/** 记录每次真正投出去的批次；`failFirst` 决定前几次 reject（模拟后端不可用）。 */
function recorder(failFirst = 0) {
  const calls: BatchPayload[] = []
  let n = 0
  const flush = async (payload: BatchPayload): Promise<BatchResult> => {
    calls.push(payload)
    if (n++ < failFirst) throw new Error('ECONNREFUSED')
    return { accepted: payload.messages.length, duplicated: 0, rejected: 0, reasons: [] }
  }
  return { calls, flush }
}

test('攒够 batchSize 才冲，一批跨会话要分组投', async () => {
  const r = recorder()
  const hub = new CollectorHub({ flush: r.flush, batchSize: 3, flushIntervalMs: 60_000 })
  hub.push(frame(1, 'a@c.us', '1'))
  hub.push(frame(1, 'b@c.us', '2'))
  // 区分性证据：如果实现是"来一条投一条"，这里 calls.length 已经是 2
  assert.equal(r.calls.length, 0)
  hub.push(frame(1, 'a@c.us', '3'))
  await wait(5)
  assert.deepEqual(
    r.calls.map((c) => [c.accountId, c.activeChatKey, c.messages.length]),
    [
      [1, 'a@c.us', 2],
      [1, 'b@c.us', 1]
    ]
  )
  assert.equal(hub.size(), 0)
  hub.dispose()
})

test('没攒够也按点到冲（2s 语义，这里 5ms）', async () => {
  const r = recorder()
  const hub = new CollectorHub({ flush: r.flush, batchSize: 100, flushIntervalMs: 5 })
  hub.push(frame(1, 'a@c.us', '1'))
  assert.equal(r.calls.length, 0)
  await wait(50)
  assert.equal(r.calls.length, 1)
  assert.equal(r.calls[0].messages.length, 1)
  hub.dispose()
})

test('队列越界丢最旧，丢了几个要可查', async () => {
  const r = recorder()
  const hub = new CollectorHub({ flush: r.flush, batchSize: 1_000, maxQueue: 3, flushIntervalMs: 60_000 })
  for (let i = 0; i < 5; i++) hub.push(frame(1, 'a@c.us', `${i}`))
  assert.equal(hub.size(), 3)
  assert.equal(hub.dropped, 2)
  await hub.flush()
  // 丢的必须是最旧的两条（0、1），留下的顺序不变
  assert.deepEqual(r.calls[0].messages.map((m) => m.msgKey), ['2', '3', '4'])
  hub.dispose()
})

test('投递失败：重试到上限后把没投出去的退回队首，恢复后按原顺序续投', async () => {
  let attempts = 0
  const calls: BatchPayload[] = []
  const flush = async (payload: BatchPayload): Promise<BatchResult> => {
    attempts++
    if (attempts <= 3) throw new Error('ECONNREFUSED')
    calls.push(payload)
    return { accepted: payload.messages.length, duplicated: 0, rejected: 0, reasons: [] }
  }
  const hub = new CollectorHub({ flush, batchSize: 2, maxQueue: 10, retries: 3, flushIntervalMs: 60_000 })
  hub.push(frame(1, 'a@c.us', '1'))
  hub.push(frame(1, 'a@c.us', '2'))
  await wait(5)
  assert.equal(attempts, 3)
  assert.equal(calls.length, 0)
  // 这一条是本任务的核心断言：投不出去时数据不蒸发（丢掉就等于采集永久缺口）
  assert.equal(hub.size(), 2)
  hub.push(frame(1, 'a@c.us', '3'))
  hub.push(frame(1, 'a@c.us', '4'))
  await hub.flush()
  assert.deepEqual(calls.flatMap((c) => c.messages.map((m) => m.msgKey)), ['1', '2', '3', '4'])
  assert.equal(hub.size(), 0)
  hub.dispose()
})
```

```bash
cd apps/desktop && node --test "src/main/services/msgBridge/**/*.test.ts" 2>&1 | tail -12
```

预期：`Cannot find module '.../collectorHub.ts'` 非 0 退出——实现还不存在。闸门里已有的 16 条（Task 7 的 12 + Task 8 的 4）不受影响。

- [ ] **Step 2: 实现 `collectorHub.ts`**

```ts
// src/main/services/msgBridge/collectorHub.ts
import type { LiveFrame, NormalizedMessage } from '../../shared/chatTypes.ts'

export interface BatchPayload {
  accountId: number
  activeChatKey: string | null
  messages: NormalizedMessage[]
}

/** 与后端 `BatchAcceptVO` 同形；主进程只用 accepted/duplicated 做日志。 */
export interface BatchResult {
  accepted: number
  duplicated: number
  rejected: number
  reasons: string[]
}

export type FlushFn = (payload: BatchPayload) => Promise<BatchResult>

export interface HubOptions {
  flush: FlushFn
  /** spec §4：500 条或 2s 先到先冲。 */
  batchSize?: number
  maxQueue?: number
  flushIntervalMs?: number
  retries?: number
}

interface Item {
  accountId: number
  activeChatKey: string | null
  message: NormalizedMessage
}

const groupKey = (item: Item): string => `${item.accountId}|${item.activeChatKey ?? ''}`

function groupOf(items: Item[]): BatchPayload {
  return {
    accountId: items[0].accountId,
    activeChatKey: items[0].activeChatKey,
    messages: items.map((i) => i.message)
  }
}

/** 一个批次可能横跨多个会话/账号：后端按 (accountId, activeChatKey) 决定未读数与归属，所以必须先分组再投。 */
function groupBy(items: Item[]): BatchPayload[] {
  const buckets = new Map<string, Item[]>()
  for (const item of items) {
    const key = groupKey(item)
    const list = buckets.get(key)
    if (list) list.push(item)
    else buckets.set(key, [item])
  }
  return [...buckets.values()].map(groupOf)
}

/**
 * 采集的内存缓冲：页内事件是持续流，后端写入是批量。
 * 三条边界都来自 spec §4 / §9：攒够冲、到点冲、装不下丢最旧。
 * 投递失败时不丢数据，把没投出去的组放回队首等下一次触发——DB 恢复后自然续上。
 */
export class CollectorHub {
  private readonly flushFn: FlushFn
  private readonly batchSize: number
  private readonly maxQueue: number
  private readonly intervalMs: number
  private readonly retries: number
  private queue: Item[] = []
  private timer: NodeJS.Timeout | null = null
  private running: Promise<void> | null = null
  private droppedCount = 0
  private disposed = false

  constructor(opts: HubOptions) {
    this.flushFn = opts.flush
    this.batchSize = opts.batchSize ?? 500
    this.maxQueue = opts.maxQueue ?? 10_000
    this.intervalMs = opts.flushIntervalMs ?? 2_000
    this.retries = opts.retries ?? 3
  }

  get dropped(): number {
    return this.droppedCount
  }

  size(): number {
    return this.queue.length
  }

  push(frame: LiveFrame): void {
    if (this.disposed) return
    this.queue.push({
      accountId: frame.accountId,
      activeChatKey: frame.activeChatKey ?? null,
      message: frame.message
    })
    this.trim()
    if (this.queue.length >= this.batchSize) {
      void this.flush().catch(() => undefined)
      return
    }
    this.arm()
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
    // 主进程的事件循环本来就长活，这个定时器不该成为"退出不干净"的理由。
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
        // 投不出去：这一组和它后面还没投的全部退回队首，保持时间顺序。
        const rest = groups
          .slice(i)
          .flatMap((g) => g.messages.map((message) => ({
            accountId: g.accountId,
            activeChatKey: g.activeChatKey,
            message
          })))
        this.queue = rest.concat(this.queue)
        this.trim()
        return
      }
    }
  }

  private async deliver(payload: BatchPayload): Promise<boolean> {
    for (let attempt = 1; attempt <= this.retries; attempt++) {
      try {
        await this.flushFn(payload)
        return true
      } catch (e) {
        // C3：日志只有计数与错误名，消息正文不进日志。
        console.warn(
          `[msgHub] 第 ${attempt}/${this.retries} 次投递失败 accountId=${payload.accountId} ` +
            `count=${payload.messages.length} err=${e instanceof Error ? e.name : String(e)}`
        )
      }
    }
    return false
  }
}
```

> `trim()` 在退回路径上也要调一次，否则 DB 长时间不可用时"退回 + 新推"会让队列越过 `maxQueue`——那正是内存爆掉的场景。

- [ ] **Step 3: `sendRegistry.ts` 与它的测试**

```ts
// src/main/services/msgBridge/sendRegistry.ts
import type { SendError, SendReceipt } from '../../shared/chatTypes.ts'

interface Pending {
  viewId: string
  resolve: (receipt: SendReceipt) => void
  timer: NodeJS.Timeout
}

/**
 * localId → 未决发送。页内的 `send_result` 是异步上行的，而渲染层在 `msg:send` 的
 * invoke 上等结果，所以这里是一张 Promise 表。
 * 超时与视图销毁都必须给 invoke 一个了结，否则回复框会永久卡在 pending 气泡上。
 */
export class SendRegistry {
  private readonly table = new Map<string, Pending>()
  // 参数属性（constructor(private readonly timeoutMs)）会被 `erasableSyntaxOnly` 判成 TS1294：
  // 这个文件在 tsconfig.unit.json 的 include 里，写成字段 + 赋值。
  private readonly timeoutMs: number

  constructor(timeoutMs = 20_000) {
    this.timeoutMs = timeoutMs
  }

  get size(): number {
    return this.table.size
  }

  pending(): string[] {
    return [...this.table.keys()]
  }

  add(localId: string, viewId: string): Promise<SendReceipt> {
    // 同 localId 再登记 = 渲染层拿同一个 id 重发。先把旧的结掉：
    // 不结的话上一条 invoke 永久挂着，界面上就是一条既不失败也不成功的幽灵气泡。
    this.settle({ localId, ok: false, error: 'SEND_FAILED', detail: 'duplicated localId' })
    return new Promise<SendReceipt>((resolve) => {
      const timer = setTimeout(() => {
        this.settle({ localId, ok: false, error: 'TIMEOUT', detail: `>${this.timeoutMs}ms` })
      }, this.timeoutMs)
      this.table.set(localId, { viewId, resolve, timer })
    })
  }

  /** @returns 命中未决表才 true；迟到或与本表无关的回执由调用方另作处理（状态推进仍要落库）。 */
  settle(receipt: SendReceipt): boolean {
    const entry = this.table.get(receipt.localId)
    if (!entry) return false
    this.table.delete(receipt.localId)
    clearTimeout(entry.timer)
    entry.resolve(receipt)
    return true
  }

  /** 视图销毁 / 桥掉线：只结这个视图的未决，别的账号不受影响。 */
  failView(viewId: string, error: SendError, detail?: string): number {
    const ids = [...this.table.entries()].filter(([, p]) => p.viewId === viewId).map(([id]) => id)
    for (const id of ids) this.settle({ localId: id, ok: false, error, detail })
    return ids.length
  }

  dispose(): void {
    for (const entry of this.table.values()) clearTimeout(entry.timer)
    this.table.clear()
  }
}
```

```ts
// src/main/services/msgBridge/sendRegistry.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SendRegistry } from './sendRegistry.ts'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

test('settle 命中未决表；未知 localId 返回 false', async () => {
  const reg = new SendRegistry(1_000)
  const p = reg.add('L1', 'acc-x')
  assert.equal(reg.settle({ localId: 'L1', ok: true, msgKey: '真-1' }), true)
  assert.deepEqual(await p, { localId: 'L1', ok: true, msgKey: '真-1' })
  assert.equal(reg.settle({ localId: 'L9', ok: true }), false)
  assert.equal(reg.size, 0)
})

test('超时先落地，迟到的成功回执不再改口', async () => {
  const reg = new SendRegistry(5)
  const p = reg.add('L1', 'acc-x')
  assert.equal((await p).error, 'TIMEOUT')
  // 区分性证据：没有"表里已删除"这一步，迟到的 ok 会把已经报超时的气泡翻成功。
  assert.equal(reg.settle({ localId: 'L1', ok: true, msgKey: '真-1' }), false)
  assert.deepEqual(await p, { localId: 'L1', ok: false, error: 'TIMEOUT', detail: '>5ms' })
})

test('重复登记同一 localId：上一条以 SEND_FAILED 结掉，不永久挂起', async () => {
  const reg = new SendRegistry(1_000)
  const first = reg.add('L1', 'acc-x')
  const second = reg.add('L1', 'acc-x')
  assert.equal((await first).ok, false)
  assert.equal((await first).error, 'SEND_FAILED')
  reg.settle({ localId: 'L1', ok: true, msgKey: '真-2' })
  assert.equal((await second).msgKey, '真-2')
})

test('failView 只结掉该视图的未决', async () => {
  const reg = new SendRegistry(1_000)
  const a = reg.add('L1', 'acc-x')
  const b = reg.add('L2', 'acc-y')
  assert.equal(reg.failView('acc-x', 'BRIDGE_OFFLINE'), 1)
  assert.equal((await a).error, 'BRIDGE_OFFLINE')
  reg.settle({ localId: 'L2', ok: true, msgKey: '真-3' })
  assert.equal((await b).ok, true)
})
```

- [ ] **Step 4: `msgApi.ts`（唯一持 JWT 的一跳）与测试**

```ts
// src/main/services/msgBridge/msgApi.ts
import type { MsgStatus, SendRequest } from '../../shared/chatTypes.ts'
import type { BatchPayload, BatchResult } from './collectorHub.ts'

export interface AccountRow {
  id: number
  platformType: number
  viewId: string
  name: string
  status: number
}

export interface MsgApiOptions {
  /** 只取 accessToken：token 不进页、不进渲染层（C2）。 */
  token: () => string | null
  apiBase?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export const DEFAULT_API_BASE = 'http://localhost:8180'

interface Envelope<T> {
  code: number
  message?: string
  data?: T
}

/**
 * 主进程 ↔ Java 的三跳。全部返回"成功与否"而不是抛错：
 * 采集链不能因为后端重启就断，交给 CollectorHub 的退避与重试。
 */
export function createMsgApi(opts: MsgApiOptions) {
  const base = (opts.apiBase ?? DEFAULT_API_BASE).replace(/\/$/, '')
  const doFetch = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? 5_000

  async function call<T>(path: string, body: unknown): Promise<T | null> {
    const token = opts.token()
    // 没登录就没有写入这件事：直接 null，让队列退避，而不是发一个必然 401 的请求。
    if (!token) return null
    try {
      const res = await doFetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      })
      if (!res.ok) return null
      const env = (await res.json()) as Envelope<T>
      return env.code === 0 && env.data !== undefined ? env.data : null
    } catch {
      return null
    }
  }

  return {
    postBatch(payload: BatchPayload): Promise<BatchResult | null> {
      return call<BatchResult>('/api/messages/batch', {
        accountId: payload.accountId,
        activeChatKey: payload.activeChatKey,
        messages: payload.messages
      })
    },
    /**
     * 后端收的是 `MessageStatusDTO{accountId, chatKey, updates[]}`：平铺 msgKey/status 会被
     * Bean Validation 打成 400，而 `call()` 把非 2xx 一律折成 null——状态推进静默不生效。
     * 一批一请求，切批只在这一处：调用方各自切就会切出不一样的边界。
     * 中途某批失败就停在这里返回 null——前面的批已经提交了，状态阶梯单调，重复推进无害，
     * 所以不为"半成功"另造一个部分结果类型。
     */
    async postStatuses(input: { accountId: number; chatKey: string; updates: StatusUpdate[] }): Promise<{ updated: number } | null> {
      let updated = 0
      for (let i = 0; i < input.updates.length; i += STATUS_BATCH_MAX) {
        const part = await call<{ updated: number }>('/api/messages/status', {
          accountId: input.accountId,
          chatKey: input.chatKey,
          updates: input.updates.slice(i, i + STATUS_BATCH_MAX)
        })
        if (!part) return null
        updated += part.updated
      }
      return { updated }
    },
    /** GET 用 fetch 单独走一遍：账号列表只有挂载与 5 分钟刷新时读，不需要批量语义。 */
    async listAccounts(): Promise<AccountRow[]> {
      const token = opts.token()
      if (!token) return []
      try {
        const res = await doFetch(`${base}/api/platform-accounts`, {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(timeoutMs)
        })
        if (!res.ok) return []
        const env = (await res.json()) as Envelope<AccountRow[]>
        return env.code === 0 && Array.isArray(env.data) ? env.data : []
      } catch {
        return []
      }
    }
  }
}

/** 发送前的一行校验：桥和渲染层都拦一次，空文本永远不该出主进程。 */
export function isSendable(req: SendRequest): boolean {
  return typeof req.text === 'string' && req.text.trim().length > 0 && req.text.length <= 5_000
}
```

```ts
// src/main/services/msgBridge/msgApi.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMsgApi, isSendable } from './msgApi.ts'
import type { NormalizedMessage } from '../../shared/chatTypes.ts'

const msg = (id: string): NormalizedMessage => ({
  chatKey: '861380000@c.us', msgKey: id, direction: 'in', mediaType: 'text', body: id,
  msgTimeEpochSec: 1_700_000_000, status: 'received', source: 'live'
})

interface Call { url: string; init: RequestInit }

function fakeFetch(response: { ok?: boolean; body: unknown }): { calls: Call[]; impl: typeof fetch } {
  const calls: Call[] = []
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return {
      ok: response.ok ?? true,
      async json(): Promise<unknown> {
        return response.body
      }
    }
  }) as unknown as typeof fetch
  return { calls, impl }
}

test('带 Bearer，且 body 就是 MessageBatchDTO 的形状', async () => {
  const { calls, impl } = fakeFetch({ body: { code: 0, data: { accepted: 1, duplicated: 0, rejected: 0, reasons: [] } } })
  const api = createMsgApi({ token: () => 'T', fetchImpl: impl, apiBase: 'http://h:8180/' })
  const out = await api.postBatch({ accountId: 7, activeChatKey: 'c1', messages: [msg('a')] })
  assert.equal(out?.accepted, 1)
  assert.equal(calls[0].url, 'http://h:8180/api/messages/batch')
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, 'Bearer T')
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    accountId: 7, activeChatKey: 'c1', messages: [msg('a')]
  })
})

test('未登录不发请求；后端 code!=0 也算失败（返回 null 让队列退避）', async () => {
  const noToken = fakeFetch({ body: { code: 0, data: {} } })
  assert.equal(await createMsgApi({ token: () => null, fetchImpl: noToken.impl }).postBatch({ accountId: 1, activeChatKey: null, messages: [msg('a')] }), null)
  assert.equal(noToken.calls.length, 0)

  const biz = fakeFetch({ body: { code: 40300, message: 'forbidden' } })
  assert.equal(await createMsgApi({ token: () => 'T', fetchImpl: biz.impl }).postStatuses({ accountId: 1, chatKey: 'c', updates: [{ msgKey: 'm', status: 'read' }] }), null)
})

test('listAccounts 在非 2xx / 结构不对时给空数组而不是抛', async () => {
  const down = fakeFetch({ ok: false, body: null })
  assert.deepEqual(await createMsgApi({ token: () => 'T', fetchImpl: down.impl }).listAccounts(), [])
})

test('空文本与超长文本不发出去', () => {
  assert.equal(isSendable({ accountId: 1, chatKey: 'c', text: '   ', localId: 'L' }), false)
  assert.equal(isSendable({ accountId: 1, chatKey: 'c', text: 'x'.repeat(5_001), localId: 'L' }), false)
  assert.equal(isSendable({ accountId: 1, chatKey: 'c', text: '你好', localId: 'L' }), true)
})
```

- [ ] **Step 5: 全绿 + 提交**

```bash
cd apps/desktop && pnpm run test:unit 2>&1 | tail -20 && pnpm run typecheck
```

预期：`# pass 28` / `# fail 0`（Task 7 的 12 + Task 8 的 4 + 本任务的 12）；四个 typecheck 全绿。这一步同时确认 `tsconfig.unit.json` 能穿过 `src/main` 里那三个文件——**它们不许 `import 'electron'`，一旦有人为了省事加上，`node --test` 会立刻在本步挂掉**，这就是把这三块留在闸门里的全部价值。

```bash
git add apps/desktop/src/main/services/msgBridge apps/desktop/tsconfig.unit.json
git commit -m "feat(P6): 采集队列、发送登记表与后端三跳（主进程侧，进单测闸门）"
```

---

### Task 10: 账号目录、桥挂载生命周期与主进程接线

**Files:**
- Create: `apps/desktop/src/main/services/msgBridge/accountDirectory.ts` · `bridgeMount.ts` · `index.ts`
- Modify: `apps/desktop/src/main/webContentsView/ipc.ts`（`ALLOWED_HOST_CHANNELS` / `ALLOWED_PUSH_CHANNELS` 各加一条；`routePageMessage` 把 `msg-report` 改道；`translate-api` 的 invoke 暂不动）
- Modify: `apps/desktop/src/main/index.ts`（`registerIpcHandlers()` 之后 `startMsgBridge()`；`before-quit` 里 `stopMsgBridge()`）
- Modify: `apps/desktop/src/main/webContentsView/manager.ts`（暴露 `webContentsOf(viewId)` 给 mount 用，避免 index 直接持有 `ManagedView`）

**Interfaces:**
- Consumes: Task 8 的 `install(config)` 契约与两份 bundle；Task 9 的 `createMsgApi` / `CollectorHub` / `SendRegistry`；既有 `getSession()`、`getMainWindow()`、`viewManager.getViewIdByWebContents()`、`viewManager.sendToView()`。
- Produces（Task 11–18 只认这些）：
  - `accountDirectory`：`accountOfView(viewId): AccountEntry | null`、`refreshAccounts(force?): Promise<AccountEntry[]>`、`AccountEntry { accountId; platformType; platform: ChatPlatform | null; name; viewId }`
  - `bridgeMount`：`class BridgeMount`（`constructor(opts: MountOptions)`、`get ready(): boolean`、`state(): BridgeState`、`mount(): Promise<boolean>`、`push(cmd: BridgeCommand): void`、`handle(report: BridgeReport): void`、`dispose(): void`）、`bridgeBundles(): { wa: string; bridge: string; version: string }`、`forgetPageBundleCache(webContentsId: number): void`
  - `msgBridge/index`：`startMsgBridge()`、`stopMsgBridge()`、`observeLoginStatus(viewId, isLogin)`、`handleBridgeReport(viewId, data: unknown)`、`bridgeStates(): BridgeState[]`、`activeChatOf(viewId): string | null`、`bridgeOf(viewId): BridgeMount | null`、`pushToBridge(viewId, cmd): boolean`、`collectorHub`
  - IPC：渲染层订阅 `msg:live`（`LiveFrame`）与 `msg:state`（`BridgeState[]`）；页→主唯一入口仍是 `view:toHost` 上的 `'msg-report'`
  - 广播通道名字面值就这三处：`'msg-report'`（页→主）、`'msg-cmd'`（主→页）、`'msg:live'` / `'msg:state'`（主→渲染层）

- [ ] **Step 1: `accountDirectory.ts`——挂载时机不能等渲染层**

```ts
// src/main/services/msgBridge/accountDirectory.ts
import { getSession } from '../../state/session'
import { platformOfAccountType, type ChatPlatform } from '@shared/chatPlatform'
import { createMsgApi, type AccountRow } from './msgApi'

export interface AccountEntry {
  accountId: number
  platformType: number
  platform: ChatPlatform | null
  name: string
  viewId: string
}

const TTL_MS = 5 * 60_000

let entries: AccountEntry[] = []
let fetchedAt = 0
let inflight: Promise<AccountEntry[]> | null = null

const api = createMsgApi({ token: () => getSession()?.accessToken ?? null })

function toEntry(row: AccountRow): AccountEntry {
  return {
    accountId: row.id,
    platformType: row.platformType,
    platform: platformOfAccountType(row.platformType),
    name: row.name,
    viewId: row.viewId
  }
}

/**
 * 视图可以后台存活，登录成功也可能发生在用户切走路由之后（同 useLoginStatusSync 的前提）。
 * 所以账号归属由主进程自己拉一次带 JWT 的列表，而不是问渲染层。
 */
export async function refreshAccounts(force = false): Promise<AccountEntry[]> {
  if (!force && Date.now() - fetchedAt < TTL_MS) return entries
  if (inflight) return inflight
  inflight = api
    .listAccounts()
    .then((rows) => {
      // 空数组 = 未登录或后端不可用：保留旧目录，不清空。
      // 清空的后果是"正在采集的视图突然查不到账号"，那比旧数据更糟。
      if (rows.length > 0) {
        entries = rows.map(toEntry)
        fetchedAt = Date.now()
      }
      return entries
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

export function accountOfView(viewId: string): AccountEntry | null {
  return entries.find((e) => e.viewId === viewId) ?? null
}

export function accountOfId(accountId: number): AccountEntry | null {
  return entries.find((e) => e.accountId === accountId) ?? null
}

export function resetAccountDirectory(): void {
  entries = []
  fetchedAt = 0
}
```

- [ ] **Step 2: `bridgeMount.ts`——两段注入、ready 握手、心跳与退避重挂**

```ts
// src/main/services/msgBridge/bridgeMount.ts
import { createHash } from 'crypto'
import { readFileSync, statSync } from 'fs'
import { join } from 'path'
import { app, type WebContents } from 'electron'
import type { BridgeCommand, BridgeInstallConfig, BridgeReport, BridgeState } from '@shared/chatTypes'

const READY_TIMEOUT_MS = 10_000
const HEARTBEAT_MS = 30_000
/** 连丢两次 pong 才算掉线：单次丢失很可能只是页面正在主线程做大重绘。 */
const MISS_LIMIT = 2
const MAX_BACKOFF_MS = 5 * 60_000

export interface Bundles {
  wa: string
  bridge: string
  /** wa-js 那份的内容哈希：换版本要允许重贴，否则升级 wa-js 后老页面永远不再装新 Store。 */
  waVersion: string
  /** 桥自身的内容哈希，就是 install() 收到的 bridgeVersion。 */
  version: string
}

function resourcePath(name: string): string {
  return app.isPackaged ? join(process.resourcesPath, name) : join(app.getAppPath(), 'resources', name)
}

let cached: { mtime: number; bundles: Bundles } | null = null

/** 版本号 = 内容哈希：不手填版本，就不会出现"改了代码忘了改版本号"。按 mtime 失效缓存。 */
export function bridgeBundles(): Bundles {
  const bridgePath = resourcePath('msg-bridge.bundle.js')
  const mtime = statSync(bridgePath).mtimeMs
  if (cached && cached.mtime === mtime) return cached.bundles
  const bridge = readFileSync(bridgePath, 'utf-8')
  const wa = readFileSync(resourcePath('wa-js.bundle.js'), 'utf-8')
  const bundles: Bundles = {
    wa,
    bridge,
    waVersion: createHash('sha1').update(wa).digest('hex').slice(0, 12),
    version: createHash('sha1').update(bridge).digest('hex').slice(0, 12)
  }
  cached = { mtime, bundles }
  return bundles
}

/**
 * 已装 wa-js 的 webContents → 装的是哪个版本。
 * 同一个页面重复执行 wa-js 会重建它自己的 Store，已挂的钩子集体指向旧 Store，
 * 现象就是"桥报 ready 但一条消息都收不到"——所以这里必须按 webContents 记一次。
 * 页面重新加载（导航 / reload）后旧 Store 已经没了，那一行必须清掉，见 Step 4。
 */
const waLoadedOn = new Map<number, string>()

export function forgetPageBundleCache(webContentsId: number): void {
  waLoadedOn.delete(webContentsId)
}

export interface MountOptions {
  viewId: string
  accountId: number
  platform: BridgeInstallConfig['platform']
  historyLimit: number
  webContents: WebContents
  onState: (state: BridgeState) => void
  /** 主 → 页的唯一下行出口，由 index 传 `viewManager.sendToView`。 */
  pushToView: (viewId: string, cmd: BridgeCommand) => void
}

/**
 * 一个视图一条桥（spec §4 第 1、2 条）：装 → 确认 → 养。
 * "养"这一段只看 pong：WhatsApp 页面热更新会让已装的钩子失效而脚本全局还在，
 * 所以 `window.__SCRM_BRIDGE_BUNDLE__` 存在不等于钩子还在。
 */
export class BridgeMount {
  private phase: BridgeState['phase'] = 'none'
  private since = Date.now()
  private detail: string | null = null
  private misses = 0
  private backoff = HEARTBEAT_MS
  private heartbeat: NodeJS.Timeout | null = null
  private retry: NodeJS.Timeout | null = null
  private confirmReady: (() => void) | null = null
  private stopped = false
  private readonly bundles: Bundles

  constructor(private readonly opts: MountOptions) {
    this.bundles = bridgeBundles()
  }

  get ready(): boolean {
    return this.phase === 'ready'
  }

  state(): BridgeState {
    return {
      viewId: this.opts.viewId,
      accountId: this.opts.accountId,
      platform: this.opts.platform,
      phase: this.phase,
      ready: this.phase === 'ready',
      since: this.since,
      detail: this.detail
    }
  }

  push(cmd: BridgeCommand): void {
    this.opts.pushToView(this.opts.viewId, cmd)
  }

  /**
   * 只消化生命周期三种上报，其余一律返回 false 让上层（`index.ts`）继续路由。
   * 不在这里回调上层：桥的 `handleBridgeReport` 又要经过 mount 才能到达，会把调用绕成环。
   */
  handle(report: BridgeReport): boolean {
    if (this.stopped) return true
    switch (report.kind) {
      case 'ready':
        this.confirmReady?.()
        return true
      case 'pong':
        this.onPong()
        return true
      case 'logged_out':
        this.stopTimers()
        this.setPhase('offline', '页面退出登录')
        return true
      default:
        return false
    }
  }

  async mount(): Promise<boolean> {
    if (this.stopped) return false
    this.setPhase('mounting')
    const wc = this.opts.webContents
    const confirmed = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), READY_TIMEOUT_MS)
      timer.unref()
      this.confirmReady = () => {
        clearTimeout(timer)
        resolve(true)
      }
    })
    const config: BridgeInstallConfig = {
      bridgeVersion: this.bundles.version,
      platform: this.opts.platform,
      viewId: this.opts.viewId,
      historyLimit: this.opts.historyLimit
    }
    try {
      if (waLoadedOn.get(wc.id) !== this.bundles.waVersion) {
        await wc.executeJavaScript(this.bundles.wa)
        waLoadedOn.set(wc.id, this.bundles.waVersion)
      }
      await wc.executeJavaScript(
        `${this.bundles.bridge}\n;window.__SCRM_BRIDGE_BUNDLE__ && window.__SCRM_BRIDGE_BUNDLE__.install(${JSON.stringify(config)});`
      )
    } catch (e) {
      this.confirmReady = null
      this.scheduleRetry(`注入失败：${e instanceof Error ? e.message : String(e)}`)
      return false
    }
    const ok = await confirmed
    this.confirmReady = null
    // dispose() 会把在途握手直接 resolve(true) 放行：这里必须再核一次 stopped，
    // 否则一条已销毁的 mount 会把阶段翻成 ready 并广播出去。
    if (this.stopped) return false
    if (!ok) {
      this.scheduleRetry('ready 握手超时')
      return false
    }
    this.misses = 0
    this.backoff = HEARTBEAT_MS
    this.setPhase('ready')
    this.startHeartbeat()
    return true
  }

  dispose(): void {
    if (this.stopped) return
    this.stopped = true
    this.stopTimers()
    this.confirmReady?.()
    this.confirmReady = null
    waLoadedOn.delete(this.opts.webContents.id)
    this.setPhase('destroyed')
  }

  private onPong(): void {
    this.misses = 0
    // pong 到手即说明桥还活着：必须撤销在途的 retry 定时器。
    // 不撤的话（scheduleRetry 已把心跳停掉、retry 挂在那儿等触发），恢复的 pong 把阶段
    // 提成 ready 后旧 timer 照样 firing → mount() → install() 版本去重只回 false 不报 ready
    // → 10s 握手超时又 scheduleRetry，backoff 翻倍，阶段永久震荡。
    if (this.retry) {
      clearTimeout(this.retry)
      this.retry = null
    }
    if (this.phase === 'ready') return
    // 桥还活着（钩子没掉），只是主进程先前误判：把心跳续上即可，不重装。
    this.backoff = HEARTBEAT_MS
    this.setPhase('ready')
    this.startHeartbeat()
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeat = setInterval(() => {
      if (this.stopped) return
      if (this.opts.webContents.isDestroyed()) {
        this.scheduleRetry('视图已销毁')
        return
      }
      this.push({ kind: 'ping' })
      this.misses += 1
      if (this.misses >= MISS_LIMIT) this.scheduleRetry('心跳连续丢失')
    }, HEARTBEAT_MS)
    this.heartbeat.unref()
  }

  private scheduleRetry(reason: string): void {
    if (this.stopped) return
    this.stopTimers()
    this.setPhase('retry', reason)
    const wait = this.backoff
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS)
    this.retry = setTimeout(() => {
      void this.mount()
    }, wait)
    this.retry.unref()
  }

  private stopHeartbeat(): void {
    if (!this.heartbeat) return
    clearInterval(this.heartbeat)
    this.heartbeat = null
  }

  private stopTimers(): void {
    this.stopHeartbeat()
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
  }

  private setPhase(phase: BridgeState['phase'], detail: string | null = null): void {
    this.phase = phase
    this.since = Date.now()
    this.detail = detail
    this.opts.onState(this.state())
  }
}
```

> `misses` 在 push 之后自增、pong 归零，所以 `MISS_LIMIT = 2` 实际给了 60s 的容忍带；把 `unref()` 加上是因为这两个定时器不该阻止进程退出（Electron 主进程的事件循环本来就长活）。

- [ ] **Step 3: `msgBridge/index.ts`——把挂载、路由、采集、广播接成一条链**

```ts
// src/main/services/msgBridge/index.ts
import { getSession } from '../../state/session'
import { getMainWindow } from '../../window/mainWindow'
import { viewManager } from '../../webContentsView/manager'
import { platformOfAccountType } from '@shared/chatPlatform'
import type { BridgeCommand, BridgeReport, BridgeState, LiveFrame } from '@shared/chatTypes'
import { accountOfView, refreshAccounts, type AccountEntry } from './accountDirectory'
import { BridgeMount, forgetPageBundleCache } from './bridgeMount'
import { CollectorHub } from './collectorHub'
import { createMsgApi } from './msgApi'

/** spec §4 的 msgHistoryLimit：每会话补底条数。 */
export const HISTORY_LIMIT_DEFAULT = 200

const api = createMsgApi({ token: () => getSession()?.accessToken ?? null })

const hub = new CollectorHub({
  flush: async (payload) => {
    const result = await api.postBatch(payload)
    // 后端不可用与业务拒绝都不该抛：抛出去会让 CollectorHub 走"退回重试"，
    // 而 40300 这类拒绝重试一万次也不会成功。
    if (!result) throw new Error('batch rejected')
    return result
  }
})

const mounts = new Map<string, BridgeMount>()
const activeChat = new Map<string, string | null>()
let refreshTimer: NodeJS.Timeout | null = null

function broadcastState(): void {
  getMainWindow()?.webContents.send('msg:state', bridgeStates())
}

export function bridgeStates(): BridgeState[] {
  return [...mounts.values()].map((m) => m.state())
}

export function activeChatOf(viewId: string): string | null {
  return activeChat.get(viewId) ?? null
}

function mountOne(entry: AccountEntry, viewId: string): void {
  // 闸门按"这个平台有没有页内采集实现"过，不按"平台认不认识"过。本任务只登记 whatsapp（Task 11）。
  // 不能写成 `if (!platform) return`：`platformOfAccountType` 只把 1/4 映射成采集平台，Facebook /
  // Messenger 天然是 null 被挡下；但"认得"不等于"接得上"：真接 TG 的是 bridge/index.ts 里那次分派，
  // 那里没登记 telegram 时，TG 视图会挂上一条没有 collect 实现的空桥——握手会 ready、心跳会 pong，
  // 却永远采不到东西，比"压根没挂"难查得多。所以 telegram 进这一行必须与 Task 12c 的那次分派同批落地。
  const platform = platformOfAccountType(entry.platformType)
  if (platform !== 'whatsapp') return
  const existing = mounts.get(viewId)
  if (existing) {
    void existing.mount()
    return
  }
  const wc = viewManager.webContentsOf(viewId)
  if (!wc) return
  const mount = new BridgeMount({
    viewId,
    accountId: entry.accountId,
    platform,
    historyLimit: HISTORY_LIMIT_DEFAULT,
    webContents: wc,
    onState: broadcastState,
    pushToView: (id, cmd) => viewManager.sendToView(id, 'msg-cmd', cmd)
  })
  mounts.set(viewId, mount)
  void mount.mount().then((ok) => {
    // 握手成功才补底：没 ready 就发 backfill 命令，桥还没挂上钩子，等于白发。
    if (ok) mount.push({ kind: 'backfill', limit: HISTORY_LIMIT_DEFAULT })
  })
}

/** 注入层每 3s 上报一次登录态：这是主进程唯一知道的"可以挂桥了 / 别采了"信号。 */
export function observeLoginStatus(viewId: string, isLogin: boolean): void {
  if (!isLogin) {
    activeChat.set(viewId, null)
    return
  }
  const known = accountOfView(viewId)
  if (known) {
    if (!mounts.has(viewId)) mountOne(known, viewId)
    else mounts.get(viewId)?.push({ kind: 'ping' })
    return
  }
  void refreshAccounts(true).then((rows) => {
    const entry = rows.find((r) => r.viewId === viewId)
    if (entry && !mounts.has(viewId)) mountOne(entry, viewId)
  })
}

/** 页 → 主。通道名 `msg-report`，白名单在 webContentsView/ipc.ts。 */
export function handleBridgeReport(viewId: string, data: unknown): void {
  const report = data as BridgeReport | null
  if (!report || typeof report !== 'object' || typeof report.kind !== 'string') return
  const entry = accountOfView(viewId)
  if (!entry) return
  const mount = mounts.get(viewId)
  if (report.kind === 'message') {
    // 同一条消息只走一条路：先入采集队列，再广播 live 尾巴（spec §4 第 4 条）。
    const frame: LiveFrame = {
      viewId,
      accountId: entry.accountId,
      platform: entry.platform ?? 'whatsapp',
      activeChatKey: activeChatOf(viewId),
      message: report.message
    }
    hub.push(frame)
    getMainWindow()?.webContents.send('msg:live', frame)
    return
  }
  if (report.kind === 'active_chat') {
    activeChat.set(viewId, report.chatKey ?? null)
    return
  }
  mount?.handle(report)
}

export function pushToBridge(viewId: string, cmd: BridgeCommand): boolean {
  const mount = mounts.get(viewId)
  if (!mount || !mount.ready) return false
  mount.push(cmd)
  return true
}

/** 记录页与离线态判定都要用：桥在不在，决定回复框能不能敲。 */
export function bridgeOf(viewId: string): BridgeMount | null {
  return mounts.get(viewId) ?? null
}

export function startMsgBridge(): void {
  if (refreshTimer) return
  refreshTimer = setInterval(() => void refreshAccounts(true), 5 * 60_000)
  refreshTimer.unref()
  void refreshAccounts(true).then(() => broadcastState())
}

export async function stopMsgBridge(): Promise<void> {
  if (refreshTimer) clearInterval(refreshTimer)
  refreshTimer = null
  for (const mount of mounts.values()) mount.dispose()
  mounts.clear()
  activeChat.clear()
  // 退出前把队列里剩下的冲一次。冲不掉也不追：下次启动由补底续上（spec §9）。
  await hub.flush().catch(() => undefined)
  hub.dispose()
}

export const collectorHub = hub
```

- [ ] **Step 4: `manager.ts` 开一个只读口子 + `ipc.ts` 改道 `msg-report` + 清缓存钩子**

`webContentsView/manager.ts` 在 `getViewIdByWebContents` 附近加（销毁视图时顺手清桥侧的缓存，否则 `webContents.id` 会被复用而留下过期的"已装 wa-js"记录）：

```ts
  /** 只读出口：msgBridge 需要按 viewId 拿到 WebContents 才能 executeJavaScript。 */
  webContentsOf(viewId: string): Electron.WebContents | null {
    return this.views.get(viewId)?.view.webContents ?? null
  }
```

`destroyView` 里在 `managed.view.webContents.close()` 之前加一行：

```ts
    forgetPageBundleCache(managed.view.webContents.id)
```

并在文件顶部 import：`import { forgetPageBundleCache } from '../services/msgBridge/bridgeMount'`。

`webContentsView/ipc.ts` 三处改动：

```ts
const ALLOWED_HOST_CHANNELS = new Set<string>([
  ...,
  'auth-status-change',
  /** 消息桥的唯一上行通道；它不改转发给渲染层，而是进 msgBridge。 */
  'msg-report'
])

const ALLOWED_PUSH_CHANNELS = new Set<string>([
  'update-translation-flags',
  'msg-cmd'
])
```

`routePageMessage` 在转发之前分流（分流后不再转给渲染层：渲染层从 `msg:live` 吃尾巴，避免同一帧两份副本）：

```ts
  const routePageMessage = (event: IpcMainEvent, kind: 'toHost' | 'send', arg: { channel: string; data: unknown }): void => {
    const viewId = viewManager.getViewIdByWebContents(event.sender.id)
    if (!viewId || !arg || !ALLOWED_HOST_CHANNELS.has(arg.channel)) return
    if (arg.channel === 'msg-report') {
      handleBridgeReport(viewId, arg.data)
      return
    }
    if (arg.channel === 'login-status') {
      observeLoginStatus(viewId, (arg.data as { isLogin?: boolean } | null)?.isLogin === true)
      // 仍然转发：渲染层的 useLoginStatusSync 要把在线态写回账号行。
    }
    forwardToHost(viewId, `${kind}:${arg.channel}`, arg.data)
  }
```

> `'msg-cmd'` 进 `ALLOWED_PUSH_CHANNELS` 是给渲染层留的口子（记录页可以直接命令某个视图"打开这个会话"）。主进程自己走 `viewManager.sendToView`，不经过这个白名单。

- [ ] **Step 5: 启动接线**

`src/main/index.ts`：

```ts
import { startMsgBridge, stopMsgBridge } from './services/msgBridge'
...
    registerIpcHandlers()
    startMsgBridge()
    const mainWindow = createMainWindow()
...
  app.on('before-quit', () => {
    setQuitting(true)
    void stopMsgBridge()
    viewManager.destroyAll()
  })
```

> `startMsgBridge()` 必须在 `createMainWindow()` 之前无所谓先后——它只起定时器；但 `broadcastState()` 依赖 `getMainWindow()`，所以首帧状态是靠 5 分钟刷新与下一次登录观察带出去的。本任务的验证里用"切到记录页时主动拉一次 `msg:bridges`"（Task 12 提供）来避开这个时序问题。

- [ ] **Step 6: 验证——握手、掉线重挂、离线不采**

```bash
cd apps/desktop && pnpm run typecheck && pnpm run test:unit 2>&1 | tail -5
pnpm --dir apps/desktop exec electron-vite dev --remoteDebuggingPort 9223
```

用 `tmp/p6c-mount.mjs`（CDP，套路见 `verify-renderer-cdp` 记忆：先 `tmp/p5c-top.ps1` 抬窗口）跑三档，主进程侧的 `console.log` 从 dev 终端读：

| # | 操作 | 期望（区分"生效 / 没动"） |
|---|---|---|
| 1 | 打开一个**已登录**的 WhatsApp 视图 | dev 终端出现 `[msgBridge]` 的挂载日志，且 `msg:state` 里该 viewId 的 `phase === 'ready'`、`version` 与 `resources/msg-bridge.bundle.js` 的 sha1 前 12 位一致 |
| 2 | 页内执行 `window.__SCRM_BRIDGE_DESTROY__()`（模拟热更新掉钩子） | 60s 内 `phase` 先变 `retry`、再回到 `ready`；**不是**停在 `retry`（停在 retry = pong 判定没生效） |
| 3 | 页内执行 `location.href='https://web.whatsapp.com/'`（真重载） | `waLoadedOn` 被清（第二次挂载日志里 wa 那段确实重跑了一次），桥重新 ready |
| 4 | 打开一个**未登录**的视图 | 一条 `[msgBridge]` 挂载日志都没有；`msg:state` 里没有该 viewId（未登录不挂桥，而不是挂了但采不到） |
| 5 | 未 ready 时调 `pushToBridge(viewId, {kind:'ping'})` | 返回 `false`，页内收不到任何命令 |
| 6 | 打开一个**已登录但不是 WhatsApp** 的视图（当前真实可用的是 Facebook，`platformType=5`） | 同样一条挂载日志都没有、`msg:state` 里没有该 viewId。这一档与第 4 档现象相同、**被拦的原因不同**：第 4 档倒在登录观察，第 6 档倒在 `mountOne` 里那道 `platform !== 'whatsapp'`。判据要能分开两者：先在 dev 终端确认该视图的 `login-status` 观察确实到了（`viewManager` 那侧的在线日志或账号行 `isLogin` 已为真），再确认桥仍零挂载——只写"没日志"会把"登录观察没触发"误当成闸门生效 |

第 2、3 条需要真实登录态；拿不到时按 C11 如实标 blocked，不要用"看起来没报错"代替。第 6 条需要一个真实登录的非 WhatsApp 视图（Facebook 已可用），它验证的是 **`platformOfAccountType` 映射不到采集平台的视图不会拿到一条空桥**——空桥会握手 `ready`、心跳 `pong`，却永远采不到东西，比"压根没挂"难查得多。（TG 有采集实现、走的是另一条闸门，不在这一条的射程里。）

- [ ] **Step 7: 提交**

```bash
git add apps/desktop/src/main
git commit -m "feat(P6): 消息桥挂载生命周期与主进程采集接线"
```

---

## P6d — 页内采集

### Task 11: WhatsApp 消息归一化、实时事件与补底（TG 侧同形状，落在 Task 12c）

**Files:**
- Create: `apps/desktop/src/bridge/types.ts`
- Create: `apps/desktop/src/bridge/whatsapp/normalize.ts` + `normalize.test.ts`
- Create: `apps/desktop/src/bridge/whatsapp/collect.ts`
- Modify: `apps/desktop/src/bridge/index.ts`（接上 `backfill` 命令与 live 订阅）
- **本任务不建**：`apps/desktop/src/bridge/telegram/*` —— TG 的采集与归一化是 **Task 12c** 的产物（同一套四入口签名、同一次平台分派），Task 11 只把 WhatsApp 那一支跑通；`index.ts` 顶部的分派形状要留成"按 platform 查表"，Task 12c 往里加一项而不是改结构
- Modify: `apps/desktop/tsconfig.unit.json`（include 已覆盖 `src/bridge/**`，新测试自动进门）

**Interfaces:**
- Consumes: Task 7 的 `chatTypes.ts` / `chatStatus.ts`；Task 8 的 `report()`；主进程在 Task 10 下发的 `BridgeCommand { kind:'backfill', limit }`。
- Produces:
  - `normalizeWa(raw: WaMsgModel, ctx: NormalizeCtx): NormalizedMessage | null`
  - `waChatKeyOf(raw: WaMsgModel): string | null`、`mediaTypeOf(rawType: string | undefined): MediaType`、`mediaSummaryOf(type: MediaType, raw?: WaMsgModel): string | null`
  - `startLiveCollect(ctx: CollectCtx): () => void`、`runBackfill(limit: number, ctx: CollectCtx): Promise<void>`、`reportActiveChat(ctx)`、`watchActiveChat(ctx)`
  - `CollectCtx { emit: (r: BridgeReport) => void }` 与 `CollectImpl`（四入口签名）——都声明在 `types.ts`，WhatsApp 与 Telegram 各自实现一份（Task 12c）
  - 页内上报的 `message.source` 只可能是 `live` 或 `backfill`；`app_send` / `native_send` 由主进程盖章（Step 2 的判定表解释为什么不能在页内定）。

- [ ] **Step 1: 页内类型声明（不 import wa-js 的类型，避免把 1 MB 依赖拖进桥的编译链）**

```ts
// src/bridge/types.ts
/**
 * 桥运行在用户正在看的 WhatsApp 页面里，能拿到的只有 wa-js 挂在 `window.WPP` 上的东西。
 * 这里只声明桥真正读到的字段子集：wa-js 升级时编译不会假绿，
 * 但运行期的探测（`ready` 握手 + 心跳）会立刻把它打成 retry，而不是静默采不到。
 */
export interface WaMsgId {
  _serialized?: string
  id?: string
  from?: string
  clientUrl?: string
}

export interface WaMsgModel {
  id?: WaMsgId
  body?: string
  type?: string
  /** unix 秒。缺失 / 0 / 未来值都不在这里钳制，交给后端 MsgTimes（收敛 #9）。 */
  t?: number
  from?: string
  to?: string
  author?: string
  isFromMe?: boolean
  ack?: number
  chatId?: { _serialized?: string }
  isNewMsg?: boolean
  /** 群里/单聊对方显示名，落 `sender_name`。 */
  notifyName?: string
  /** 媒体摘要用到的可选字段：有就用，没有就落回类型占位。 */
  caption?: string
  filename?: string
  mimetype?: string
  formattedTitle?: string
  loc?: string
  locName?: string
  contact?: { name?: string }
}

export interface WaChatModel {
  id?: { _serialized?: string }
  name?: string
  isGroup?: boolean
  archived?: boolean
}

export interface WppChatApi {
  list(options: Record<string, unknown>): Promise<WaChatModel[]>
  getMessages(chatId: string, options: Record<string, unknown>): Promise<WaMsgModel[]>
  getActiveChat(): { id?: { _serialized?: string } } | null
}

export interface WppLike {
  isReady?(): boolean
  chat?: WppChatApi
  /** 事件名与签名按 wa-js 4.x：返回值带 off()。装包后按 `dist/types/whatsappStore.d.ts` 复核。 */
  on(event: 'chat.new_message', cb: (msg: WaMsgModel) => void): { off(): void }
  on(event: 'chat.active_chat', cb: (chat: WaChatModel | null) => void): { off(): void }
  on(event: 'chat.msg_ack_change', cb: (payload: { id: string; ack: number }) => void): { off(): void }
  on(event: 'conn.logout', cb: () => void): { off(): void }
}

declare global {
  interface Window {
    WPP?: WppLike
  }
}
```

同一个文件末尾补采集层的公共形状——WhatsApp（本任务）与 Telegram（Task 12c）都要满足它，桥只看这张表：

```ts
import type { BridgeReport } from '../shared/chatTypes.ts'

/** 页内采集层唯一的对外依赖：把上报交回桥，不碰 IPC、不碰后端。 */
export interface CollectCtx {
  emit: (report: BridgeReport) => void
}

/**
 * 四入口的签名。命名按 WhatsApp 那一支已有的实现，Telegram 补齐同名四项即可登记；
 * 少任何一项都不算一个合法实现——登记进查表后 TS 会直接报错，而不是运行时静默少一路。
 */
export interface CollectImpl {
  startLiveCollect(ctx: CollectCtx): () => void
  watchActiveChat(ctx: CollectCtx): () => void
  reportActiveChat(ctx: CollectCtx): void
  runBackfill(limit: number, ctx: CollectCtx): Promise<void>
}
```

> `types.ts` 顶部已有 `import type` 的话不必重复；没有就把这行放在文件第一行（`BridgeReport` 是它唯一的 shared 依赖）。

- [ ] **Step 2: 先写 `normalize.test.ts`（六条，覆盖方向、群/单聊、媒体与两条"不收"的规则）**

`source` 的判定口径（本任务真正的决定，写下来避免实现阶段各显神通）：

| 场景 | 页内上报的 `source` | 谁盖章成什么 |
|---|---|---|
| 事件流里的收进消息 | `live` | 就这样入库 |
| 事件流里的发出消息 | `live` | **主进程**改写：命中 `SendRegistry` 的未决发送 → `app_send`；否则 `native_send` |
| 补底批量拉回来的每一条 | `backfill` | 就这样入库 |
| 记录页回复成功后页内自己回读的那条 | 不发第二条 | 回执已经带 `msgKey`，主进程直接按 `app_send` 入库（Task 12） |

> 为什么"是不是本应用发的"不能在页内定：wa-js 4.6.0 的 `SendMessageOptions` 没有 `messageID`，页内发送拿不到"我这条 = 那个 localId"的稳定关联；而主进程两边都知道（`msg:send` 的 localId 是它生成的，`send_result` 的 msgKey 是它收到的）。归属判断放在信息最全的一边，页内只负责如实上报。

```ts
// src/bridge/whatsapp/normalize.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mediaSummaryOf, mediaTypeOf, normalizeWa, waChatKeyOf } from './normalize.ts'
import type { WaMsgModel } from '../types.ts'

const ctx = { source: 'live' as const }

test('收进的单聊：chatKey 取 from，方向 in，状态 received（ack 不参与）', () => {
  const row = normalizeWa(
    { id: { _serialized: 'false_861380001001@c.us_HXD123' }, from: '861380001001@c.us', to: '8610000000000@c.us', body: 'hola', t: 1_700_000_000, isFromMe: false, ack: 3 },
    ctx
  )
  assert.equal(row?.chatKey, '861380001001@c.us')
  assert.equal(row?.direction, 'in')
  assert.equal(row?.status, 'received')
  assert.equal(row?.body, 'hola')
  assert.equal(row?.mediaType, 'text')
  assert.equal(row?.senderKey, undefined)
})

test('发出的单聊：chatKey 取 to（对端），不是自己；页内一律如实报 live，归属留给主进程', () => {
  const raw: WaMsgModel = {
    id: { _serialized: 'true_861380001001@c.us_Z@1', clientUrl: 'CU-9' },
    from: '8610000000000@c.us', to: '861380001001@c.us', body: 'hi', t: 1_700_000_010,
    isFromMe: true, ack: 2
  }
  const row = normalizeWa(raw, ctx)
  assert.equal(row?.chatKey, '861380001001@c.us')
  assert.equal(row?.direction, 'out')
  assert.equal(row?.source, 'live')
  assert.equal(row?.status, 'delivered')
  assert.equal(row?.sendLocalId, undefined)
  // 补底上下文里的同一条：只换 source，不碰归属
  assert.equal(normalizeWa(raw, { source: 'backfill' })?.source, 'backfill')
})

test('群聊：chatKey 是群，senderKey/senderName 来自 author，只有单聊才把 author 丢进 senderKey 是不对的', () => {
  const row = normalizeWa(
    { id: { _serialized: 'false_12036@g.us_ABC' }, from: '120361234@g.us', author: '861380002002@c.us', notifyName: undefined, body: '在吗', t: 1_700_000_020, isFromMe: false },
    ctx
  )
  assert.equal(row?.chatKey, '120361234@g.us')
  assert.equal(row?.senderKey, '861380002002@c.us')
  assert.equal(row?.direction, 'in')
})

test('媒体：body 落 null，mediaType 与摘要成对；未知类型不冒充 text', () => {
  const img = normalizeWa({ id: { _serialized: 'x' }, from: '123@c.us', type: 'image', t: 1, isFromMe: false }, ctx)
  assert.equal(img?.body, null)
  assert.equal(img?.mediaType, 'image')
  assert.equal(img?.mediaSummary, '[图片]')
  const doc = normalizeWa({ id: { _serialized: 'y' }, from: '123@c.us', type: 'document', filename: '报价.pdf', t: 1 }, ctx)
  assert.equal(doc?.mediaSummary, '[文件] 报价.pdf')
  assert.equal(mediaTypeOf('multi_attachment'), 'unknown')
  assert.equal(mediaTypeOf(undefined), 'text')
  assert.equal(mediaSummaryOf('text'), null)
  assert.equal(mediaTypeOf('sticker'), 'sticker')
})

test('没有 id._serialized 的行不入库：它无法参与 uk_msg 幂等，收下就是脏数据', () => {
  assert.equal(normalizeWa({ body: 'hi', t: 1, from: '1@c.us' }, ctx), null)
  assert.equal(normalizeWa({ id: {} }, ctx), null)
})

test('chatKey 取不到时返回 null，而不是把 undefined 写进 NOT NULL 列', () => {
  assert.equal(waChatKeyOf({ id: { _serialized: 'a' }, isFromMe: true }), null)
  assert.equal(normalizeWa({ id: { _serialized: 'a' }, isFromMe: true }, ctx), null)
})
```

```bash
cd apps/desktop && pnpm run test:unit 2>&1 | tail -20
```

预期：FAIL —— `Cannot find module './normalize.ts'`。

- [ ] **Step 3: 实现 `normalize.ts`**

```ts
// src/bridge/whatsapp/normalize.ts
import type { MediaType, MsgSource, NormalizedMessage } from '../../shared/chatTypes.ts'
import { fromAck } from '../../shared/chatStatus.ts'
import type { WaMsgModel } from '../types.ts'

export interface NormalizeCtx {
  /**
   * 页内只可能是 'live'（事件流）或 'backfill'（补底）。
   * `app_send` / `native_send` 不在这里判定：wa-js 4.6.0 的发送选项没有 messageID，
   * 页内拿不到"这条 = 那个 localId"，而主进程两边都知道（Step 2 的表）。
   */
  source: MsgSource
}

const MEDIA_BY_TYPE: Record<string, MediaType> = {
  chat: 'text',
  notification: 'text',
  vcard: 'contact',
  image: 'image',
  img: 'image',
  audio: 'audio',
  ptv: 'audio',
  voice: 'audio',
  video: 'video',
  vcards: 'contact',
  document: 'document',
  docs: 'document',
  sticker: 'sticker',
  location: 'location',
  live_location: 'location'
}

export function mediaTypeOf(rawType: string | undefined): MediaType {
  if (!rawType) return 'text'
  return MEDIA_BY_TYPE[rawType] ?? 'unknown'
}

/** 摘要是记录页与搜索命中的唯一可见文本（媒体本体不进 P6，spec §1）。 */
export function mediaSummaryOf(type: MediaType, raw?: WaMsgModel): string | null {
  switch (type) {
    case 'text':
      return null
    case 'image':
      return raw?.caption ? `[图片] ${raw.caption}` : '[图片]'
    case 'audio':
      return '[语音]'
    case 'video':
      return raw?.caption ? `[视频] ${raw.caption}` : '[视频]'
    case 'document':
      return raw?.filename ? `[文件] ${raw.filename}` : '[文件]'
    case 'sticker':
      return '[贴纸]'
    case 'contact':
      return raw?.contact?.name ? `[名片] ${raw.contact.name}` : '[名片]'
    case 'location':
      return raw?.locName ? `[位置] ${raw.locName}` : '[位置]'
    case 'unknown':
      return `[${raw?.type ?? '未知'}]`
  }
}

/** in 看 from，out 看 to：发出消息的 `to` 才是对端/群，`from` 是自己。 */
export function waChatKeyOf(raw: WaMsgModel): string | null {
  const key = raw.isFromMe ? raw.to : raw.from
  if (typeof key === 'string' && key.length > 0) return key
  const fromChatId = raw.chatId?._serialized
  return typeof fromChatId === 'string' && fromChatId.length > 0 ? fromChatId : null
}

export function normalizeWa(raw: WaMsgModel, ctx: NormalizeCtx): NormalizedMessage | null {
  const msgKey = raw.id?._serialized
  if (!msgKey) return null
  const chatKey = waChatKeyOf(raw)
  if (!chatKey) return null

  const direction = raw.isFromMe ? 'out' : 'in'
  const type = mediaTypeOf(raw.type)
  const text = type === 'text' ? raw.body ?? '' : null
  const mediaSummary = type === 'text' ? null : mediaSummaryOf(type, raw)

  return {
    chatKey,
    msgKey,
    direction,
    // 群里的 author 才是"谁说的"；单聊不填 senderKey，让会话标题去承担"是谁"。
    ...(chatKey.endsWith('@g.us') ? { senderKey: raw.author } : {}),
    ...(raw.notifyName ? { senderName: raw.notifyName } : {}),
    body: text,
    mediaType: type,
    ...(mediaSummary ? { mediaSummary } : {}),
    msgTimeEpochSec: typeof raw.t === 'number' ? raw.t : 0,
    status: direction === 'out' ? fromAck(raw.ack, 'out') : 'received',
    source: ctx.source
  }
}
```

```bash
cd apps/desktop && pnpm run test:unit 2>&1 | tail -20
```

预期：`# pass 34` / `# fail 0`（+ normalize 6 条）。

- [ ] **Step 4: `collect.ts`——事件流与补底**

```ts
// src/bridge/whatsapp/collect.ts
import type { MsgStatus } from '../../shared/chatTypes.ts'
import { canAdvance, fromAck } from '../../shared/chatStatus.ts'
import type { CollectCtx, WaChatModel, WaMsgModel, WppLike } from '../types.ts'
import { normalizeWa, type NormalizeCtx } from './normalize.ts'

/** 会话之间至少隔 200ms：WhatsApp 页面在自己的主线程上跑，挤太狠会直接把界面卡住。 */
const CHAT_GAP_MS = 200
/** 单批取 50 条：与主进程 CollectorHub 的批量下限对齐，不在这层做大批。 */
const PAGE_SIZE = 50
/** 单次补底的会话数上限：先近后远，一次跑不完就等下一次按钮，别把页面钉死。 */
const MAX_CHATS_PER_RUN = 100

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function wpp(): WppLike | null {
  return typeof window !== 'undefined' && window.WPP ? window.WPP : null
}

/**
 * 实时事件。三件事：新消息、活动会话（决定未读数加不加）、ack 推进。
 * `canAdvance` 在这里先判一次，是为了不让"已读→已送达"这种倒退事件白跑一趟 IPC，
 * 真正的守卫仍在后端 SQL 里（两处同形由 Task 7 的同一组断言保证）。
 */
export function startLiveCollect(ctx: CollectCtx): () => void {
  const store = wpp()
  if (!store) return () => undefined
  const live: NormalizeCtx = { source: 'live' }
  const lastStatus = new Map<string, MsgStatus>()

  const subs = [
    store.on('chat.new_message', (msg: WaMsgModel) => {
      const row = normalizeWa(msg, live)
      if (!row) return
      if (row.status !== 'received') lastStatus.set(row.msgKey, row.status)
      ctx.emit({ kind: 'message', message: row })
    }),
    store.on('chat.msg_ack_change', ({ id, ack }) => {
      const status = fromAck(ack, 'out')
      const prev = lastStatus.get(id)
      if (prev && !canAdvance(prev, status)) return
      lastStatus.set(id, status)
      // ack 事件只给 id，不给 chatKey：主进程按 msgKey 落库更新，chatKey 传空串由后端按唯一键查。
      ctx.emit({ kind: 'ack', chatKey: '', msgKey: id, status })
    }),
    store.on('conn.logout', () => ctx.emit({ kind: 'logged_out' }))
  ]

  return () => {
    for (const s of subs) {
      try {
        s.off()
      } catch {
        /* 页面已经把钩子拆了：没什么可做的 */
      }
    }
  }
}

/** 活动会话：wa-js 4.x 没有稳定的 active_chat 事件名，这里用"命令驱动 + 事件（若有）"双轨。 */
export function reportActiveChat(ctx: CollectCtx): void {
  const store = wpp()
  const chat = store?.chat?.getActiveChat?.()
  ctx.emit({ kind: 'active_chat', chatKey: chat?.id?._serialized ?? null })
}

export function watchActiveChat(ctx: CollectCtx): () => void {
  const store = wpp()
  if (!store) return () => undefined
  let sub: { off(): void } | null = null
  try {
    sub = (store as unknown as {
      on(event: 'chat.active_chat', cb: (chat: WaChatModel | null) => void): { off(): void }
    }).on('chat.active_chat', (chat) => ctx.emit({ kind: 'active_chat', chatKey: chat?.id?._serialized ?? null }))
  } catch {
    sub = null
  }
  return () => sub?.off()
}

/**
 * 补底：每会话最近 limit 条，倒着翻页直到够数或没有更多。
 * 失败只跳过该会话并上报 `backfill_gap`——一个坏会话不该让整轮采集停住（spec §9）。
 */
export async function runBackfill(limit: number, ctx: CollectCtx): Promise<void> {
  const store = wpp()
  const chatApi = store?.chat
  if (!chatApi) {
    ctx.emit({ kind: 'backfill_gap', chatKey: '*', reason: 'WPP.chat 不可用' })
    return
  }
  const backfill: NormalizeCtx = { source: 'backfill' }
  let chats: WaChatModel[]
  try {
    chats = await chatApi.list({ page: 0, limit: MAX_CHATS_PER_RUN, onlyGroupChats: false })
  } catch (e) {
    ctx.emit({ kind: 'backfill_gap', chatKey: '*', reason: e instanceof Error ? e.message : String(e) })
    return
  }

  let messages = 0
  let done = 0
  for (const chat of chats) {
    const chatKey = chat.id?._serialized
    if (!chatKey || chat.archived === true) {
      done += 1
      continue
    }
    try {
      const collected: WaMsgModel[] = []
      let page = 0
      while (collected.length < limit) {
        const batch = await chatApi.getMessages(chatKey, { page, limit: PAGE_SIZE })
        if (!Array.isArray(batch) || batch.length === 0) break
        collected.push(...batch)
        page += 1
      }
      for (const raw of collected.slice(0, limit)) {
        const row = normalizeWa(raw, backfill)
        if (!row) continue
        row.chatTitle = chat.name ?? undefined
        ctx.emit({ kind: 'message', message: row })
        messages += 1
      }
    } catch (e) {
      ctx.emit({ kind: 'backfill_gap', chatKey, reason: e instanceof Error ? e.message : String(e) })
    }
    done += 1
    ctx.emit({ kind: 'backfill_progress', chatsDone: done, chatsTotal: chats.length, messages })
    await wait(CHAT_GAP_MS)
  }
}
```

> `row.chatTitle = ...` 这行要求 `normalizeWa` 的返回值是可写字段（`NormalizedMessage` 里 `chatTitle?: string` 已经是可选属性，直接赋 OK）。补底带标题是刻意的：后端 `titleOf` 只在批次里找，找不到就不更新会话头——补底第一轮如果全不带标题，列表页就是一片空标题会话。

- [ ] **Step 5: 接进 `index.ts`，装 ready 后的第一动作**

`src/bridge/index.ts` 的 `handle` 赋值处替换为（先在模块顶部建采集实现查表，`handle` 里只查一次）：

```ts
import * as whatsappCollect from './whatsapp/collect.ts'
import type { CollectImpl } from './types.ts'

/**
 * 采集实现按平台查表，本任务只有 whatsapp 一项。用查表而不是在四个 case 里各判一次平台：
 * 一条命令的处理必须整体来自同一个实现，半 WA 半 TG 的混合体最坏处会采出混合形状的数据。
 * Task 12c 往这张表里加 telegram 一项，不改这里的取用方式。
 */
const COLLECT: Partial<Record<ChatPlatform, CollectImpl>> = { whatsapp: whatsappCollect }
```

```ts
  const impl = COLLECT[config.platform]
  if (!impl) {
    // 挂载闸门（Task 10）挡的就是"这个平台有没有采集实现"，走到这里说明两处不同步了。
    // 抛出去让握手失败，主进程按 retry → offline 收敛，比挂一条"ready 却永远采不到"的桥好查得多。
    throw new Error(`bridge: 该平台没有采集实现 ${config.platform}`)
  }
  const push = makeThrottledReporter()
  const collector = impl.startLiveCollect({ emit: push })
  const stopActiveWatch = impl.watchActiveChat({ emit: push })
  handle = (cmd: BridgeCommand): void => {
    switch (cmd.kind) {
      case 'ping':
        push({ kind: 'pong', bridgeVersion: config.bridgeVersion })
        return
      case 'backfill':
        // 补底是异步的且不阻塞命令回路：期间新消息仍走 live 事件，幂等交给 uk_msg。
        void impl.runBackfill(cmd.limit, { emit: push })
        return
      case 'open_chat':
        impl.reportActiveChat({ emit: push })
        return
      case 'send':
        // Task 12 落地；现在收到就明确报失败，不要静默。
        push({ kind: 'send_result', localId: cmd.localId, ok: false, error: 'SEND_FAILED', detail: 'send not wired yet' })
        return
    }
  }
  offCommand = onCommand((cmd) => handle?.(cmd))
  collectorRef = collector
  activeRef = stopActiveWatch
  report({ kind: 'ready', bridgeVersion: config.bridgeVersion })
  impl.reportActiveChat({ emit: push })
```

并在文件顶部补 `ChatPlatform` 的 import（`import type { BridgeCommand, ChatPlatform } from '../shared/chatTypes.ts'`，Task 8 已经把 `BridgeCommand` 引进来了，这里只是并一行）、模块级 `let collectorRef: (() => void) | null = null` / `let activeRef: (() => void) | null = null`，`destroy()` 里各调一次并置空。

> **Telegram 那一支同形状，落在 Task 12c**：四入口的签名一个都不改，Task 12c 只往 `COLLECT` 里加一项、并把 Task 10 的挂载闸门放开到 telegram（两处同批，理由写在那道闸门里）。本任务落地时**不加**表里没有实现的 `telegram: undefined` 之类的占位项——`Partial<Record<…>>` 已经允许缺一台，取不到就抛，形状本身就表达了"还没接"。

- [ ] **Step 6: 主进程消化三种新上报**

`msgBridge/index.ts` 的 `handleBridgeReport` 在 `message` 分支之后补：

```ts
  if (report.kind === 'ack') {
    // ack 只推后端状态，不广播 msg:live：这帧没有真的 body / direction / source，
    // 拼成 NormalizedMessage 会让渲染层按 msgKey 合并时把已有行的方向与归属改脏。
    // 要做状态气泡时另立一个"状态帧"形状，别复用消息类型。
    const keys = Array.isArray(report.msgKeys) ? report.msgKeys : []
    // 后端 `chatKey` 上是 `@NotBlank`、`updates` 上是 `@NotEmpty`：缺任一个都只是被 `call()` 折成 null 的 400。
    if (!report.chatKey || keys.length === 0) {
      console.log(`[msgBridge] ack 丢弃 viewId=${viewId} chat=${oneLine(report.chatKey)} keys=${keys.length}：页内没带 chatKey 或 msgKey`)
      return
    }
    // 一次页内事件一请求：整群读回执一条事件能带几十上百个 id，拆成一 id 一请求就是几十个
    // 带行锁的并发事务，而 `updates[]` 的 200 上限正是留给这种批的。
    void api
      .postStatuses({
        accountId: entry.accountId,
        chatKey: report.chatKey,
        updates: keys.map((msgKey) => ({ msgKey, status: report.status }))
      })
      .then((r) => {
        // updated:0 是常态（乱序 ack 被阶梯挡住），只有"整条请求没成"才值得刷屏。
        if (!r) console.log(`[msgBridge] ack 上报失败 viewId=${viewId} chat=${oneLine(report.chatKey)} keys=${keys.length}`)
      })
    return
  }
  if (report.kind === 'backfill_progress' || report.kind === 'backfill_gap') {
    // 只进主进程日志：计数与 chatKey，不含正文（C3）。页内来的文本（chatKey / reason）一律
    // 经 oneLine：不截会刷出无界长行，留换行则能被伪造日志行。
    // droppedTotal 是 CollectorHub 的进程累计丢弃数，不是本轮的：本轮看 msgs=。
    console.log(
      report.kind === 'backfill_gap'
        ? `[msgBridge] backfill 跳过 viewId=${viewId} chat=${oneLine(report.chatKey)} reason=${oneLine(report.reason)}`
        : `[msgBridge] backfill 进度 viewId=${viewId} ${report.chatsDone}/${report.chatsTotal} msgs=${report.messages} droppedTotal=${hub.dropped}`
    )
    return
  }
```

> `ack` 广播出去的那帧 `msgTimeEpochSec: 0`——渲染层只把它当"状态更新"用（按 `msgKey` 覆盖已有行），不参与排序。`mergeTail` 对已存在的 key 取 `Math.max(ts)`（Task 7 Step 5 的规则 1），所以 0 不会把行首时间改坏。这一条正是那两个函数要那么设计的原因。

- [ ] **Step 7: 验证——真实登录态下的补底与双入口同源**

```bash
cd apps/desktop && pnpm run test:unit 2>&1 | tail -8 && pnpm run typecheck
```

预期：`# pass 34`（+ normalize 6）；typecheck 全绿。

端到端（需要已登录 WhatsApp 视图；拿不到就整块标 blocked，别用桩数据代替——C11）：

```bash
pnpm --dir apps/desktop exec electron-vite dev --remoteDebuggingPort 9223
node tmp/p6d-collect.mjs     # 见下表
```

| # | 操作 | 期望 |
|---|---|---|
| 1 | 起服务前后各取一次 `GET /api/messages/stats?accountId=<wa>&days=30` 的 `total` | 差值 > 0 且与 dev 终端最后一行 `msgs=` 同量级（0 差值 = 补底根本没跑） |
| 2 | `GET /api/conversations?accountId=<wa>&size=50` | `records` 里出现了补底拿到的会话，`title` 非空（证明 `chatTitle` 真的随批次上来了） |
| 3 | 把 `HISTORY_LIMIT_DEFAULT` 临时改成 5，重复第 1 步 | 每会话行数 ≤ 5（限条数生效，而不是"全量拉回来了"） |
| 4 | 在**原生 WhatsApp 界面**（不是记录页）手动发一条给自聊 | `GET /api/messages?accountId&chatKey=...` 里出现该 `msg_key`，且 `source === 'native_send'` |
| 5 | 同一 `msg_key` 再查 | 只有一行（事件流与补底交叠被 `uk_msg` 消解） |
| 6 | 把 `tmp/p6d-collect.mjs` 的 `stats` 数字与 `SELECT COUNT(*)` 的等价查询用 `GET /api/messages/stats` 对照 | 两处 total 一致（本仓库没有 mysql CLI，所以"库内真值"只能由后端自己给，对照口径写清楚，不声称直接查了库） |
| 7 | 断线重挂：页内 `window.__SCRM_BRIDGE_DESTROY__()` → 等心跳重挂 → 再在原生界面发一条 | 新消息仍入库且**不产生重复行**（`uk_msg` + 幂等；这是 spec §12 "不重不漏"的那一条） |

第 4、7 两条是"双入口同源"的区分性证据：只有事件流在动时第 4 条才有值，只有幂等键生效时第 7 条才不重复。

- [ ] **Step 8: 提交**

```bash
git add apps/desktop/src/bridge apps/desktop/src/main/services/msgBridge
git commit -m "feat(P6): WhatsApp 页内消息归一化、实时事件与限速补底"
```

---

## P6e — 发送链

### Task 12: 应用内回复（`msg:send` 全链路 + 发送归属盖章）

**Files:**
- Modify: `apps/desktop/src/main/services/msgBridge/sendRegistry.ts`（新增 `SendAttribution`）+ `sendRegistry.test.ts`（+5 条）
- Create: `apps/desktop/src/bridge/whatsapp/send.ts` + `send.test.ts`（4 条）
- Modify: `apps/desktop/src/bridge/types.ts`（`WppChatApi` 补 `sendTextMessage`）
- Modify: `apps/desktop/src/bridge/index.ts`（`send` 命令分派给 `sendViaWa`）
- Modify: `apps/desktop/src/main/services/msgBridge/index.ts`（`sendText` / `requestBackfill` / 消化 `send_result` / 盖章 / 掉线结清）
- Modify: `apps/desktop/src/main/ipc.ts`（三条 invoke）
- Modify: `apps/desktop/src/preload/index.ts`（`scrm.msg` 五个成员）
- Modify: `apps/desktop/electron.vite.config.ts`（`preload` 也要 `@shared` 别名——Task 7 只加了 `main` / `renderer`）

**Interfaces:**
- Consumes: Task 9 的 `SendRegistry` / `isSendable` / `createMsgApi.postStatuses({accountId, chatKey, updates})`（一次一条消息也要写成 `updates: [{msgKey, status}]`，平铺形状会被后端 Bean Validation 打成 400，而 `call()` 把非 2xx 折成 null）；Task 10 的 `bridgeOf` / `pushToBridge` / `accountOfId` / `collectorHub`；Task 11 的 `normalizeWa` 与 `wa-js` 的 `WPP.chat.sendTextMessage`。
- Produces:
  - `class SendAttribution { claim(viewId, localId, chatKey, text): void; settle(localId, msgKey): SendIntentMeta | null; abandon(localId): void; stamp(viewId, msg): NormalizedMessage; dropView(viewId): number; pendingIntents(): string[] }`、`interface SendIntentMeta { chatKey; text }`
  - `sendText(req: SendRequest): Promise<SendReceipt>`、`requestBackfill(accountId: number): boolean`（主进程给 `ipc.ts` 用）
  - 页内 `sendViaWa(cmd: SendCmd, chat: SendChat | undefined): Promise<SendReceipt>`、`receiptFrom(cmd, result, err)`、`classify(err): SendError`
  - 渲染层表面 `window.scrm.msg = { send, syncHistory, bridges, onLive, onState }`
  - IPC channel 字面值：`'msg:send'` / `'msg:sync-history'` / `'msg:bridges'`（invoke）、`'msg:live'` / `'msg:state'`（main → renderer 推送）

- [ ] **Step 1: 复核 `sendTextMessage` 的真实签名（钉在类型上，不靠文档）**

Task 8 那次解包目录（`tmp/wajs-x/`）已经清掉了；4.6.0 的 `.d.ts` 就在 workspace 里，直接读：

```bash
WAJS="node_modules/.pnpm/@wppconnect+wa-js@4.6.0/node_modules/@wppconnect/wa-js/dist"
grep -n "sendTextMessage" "$WAJS/chat/functions/sendTextMessage.d.ts"
grep -n "createChat?\|waitForAck?\|delay?" "$WAJS/chat/types.d.ts"
sed -n '/export interface SendMessageReturn/,/^}/p' "$WAJS/chat/types.d.ts"
```

**本计划写作时已复核到的结果（Step 4 的代码就是照这个写的，跑上面三条只为确认没被版本变更推翻）**：
`sendTextMessage(chatId, content, options?) => Promise<SendMessageReturn>`，`SendMessageReturn` 是
`{ id: string; from?: string; to?: string; latestEditMsgKey?: MsgKey; ack: number; sendMsgResult: SendMsgResultObject | null }`
——**`id` 是字符串**，`sendMsgResult` 在不 `waitForAck` 时恒为 `null`；`SendMessageOptions` 里 `createChat?: boolean`、
`waitForAck?: boolean` 两个选项名都存在。与复核结果不一致时以复核结果为准改代码，不要改口径说明。

- [ ] **Step 2: 写失败的 `SendAttribution` 测试**

为什么需要这张表：记录页发的每一条，主进程和 WhatsApp 事件流会各自写一次同一 `msg_key`；谁先到谁定 `source`。没有这张表，事件流先到时那一行会被打成 `native_send`（页内不知道 localId），本应用发的消息就在数据里"消失"了。归属判定只能在主进程做，理由见 Task 11 Step 2。

```ts
// src/main/services/msgBridge/sendRegistry.test.ts —— 追加 5 条（原有 4 条不动）
import { SendAttribution } from './sendRegistry.ts'
import type { NormalizedMessage } from '../../shared/chatTypes.ts'

const out = (msgKey: string, over: Partial<NormalizedMessage> = {}): NormalizedMessage => ({
  chatKey: '861380001001@c.us', msgKey, direction: 'out', body: 'hi', mediaType: 'text',
  msgTimeEpochSec: 1_700_000_000, status: 'pending', source: 'live', ...over
})

test('回执先到：settle 交回正文与 chatKey（主进程要自己补一行），随后事件流同 msgKey 盖成 app_send', () => {
  const at = new SendAttribution()
  at.claim('acc-1', 'L1', '861380001001@c.us', 'hi')
  assert.deepEqual(at.settle('L1', 'K-1'), { chatKey: '861380001001@c.us', text: 'hi' })
  const stamped = at.stamp('acc-1', out('K-1'))
  assert.equal(stamped.source, 'app_send')
  assert.equal(stamped.sendLocalId, 'L1')
})

test('事件流先到：按 viewId+chatKey+文本消化 intent，回执随后返回 null（不再补写第二行）', () => {
  const at = new SendAttribution()
  at.claim('acc-1', 'L1', '861380001001@c.us', 'hi')
  const stamped = at.stamp('acc-1', out('K-1'))
  assert.equal(stamped.source, 'app_send')
  assert.equal(stamped.sendLocalId, 'L1')
  assert.equal(at.settle('L1', 'K-1'), null)
})

test('同会话连发两条相同文本：FIFO 各自对应自己的 localId，不会都盖到第一条上', () => {
  const at = new SendAttribution()
  at.claim('acc-1', 'L1', '861380001001@c.us', 'hi')
  at.claim('acc-1', 'L2', '861380001001@c.us', 'hi')
  assert.equal(at.stamp('acc-1', out('K-1'))?.sendLocalId, 'L1')
  assert.equal(at.stamp('acc-1', out('K-2'))?.sendLocalId, 'L2')
})

test('不属于本应用的发出消息一律 native_send；收进行原样不动', () => {
  const at = new SendAttribution()
  assert.equal(at.stamp('acc-1', out('K-9')).source, 'native_send')
  const inRow: NormalizedMessage = { ...out('K-8'), direction: 'in', source: 'backfill' }
  assert.deepEqual(at.stamp('acc-1', inRow), inRow)
})

test('abandon 之后同文本的消息不再被认领；过期 intent 同样失效；dropView 只清该视图', () => {
  const at = new SendAttribution()
  at.claim('acc-1', 'L1', '861380001001@c.us', 'hi')
  at.abandon('L1')
  assert.equal(at.stamp('acc-1', out('K-1')).source, 'native_send')

  const clock = { t: 1_000 }
  const at2 = new SendAttribution({ maxAgeMs: 10, now: () => clock.t })
  at2.claim('acc-1', 'L2', '861380001001@c.us', 'hi')
  clock.t = 2_000
  assert.equal(at2.stamp('acc-1', out('K-2')).source, 'native_send')

  const at3 = new SendAttribution()
  at3.claim('acc-1', 'L1', 'c1', 'hi')
  at3.claim('acc-2', 'L2', 'c2', 'hi')
  assert.equal(at3.dropView('acc-1'), 1)
  assert.deepEqual(at3.pendingIntents(), ['L2'])
})
```

```bash
cd apps/desktop && pnpm run test:unit 2>&1 | tail -20
```

预期：FAIL —— `SendAttribution is not a constructor` / 导出不存在。

- [ ] **Step 3: 实现 `SendAttribution`**

接在 Task 9 的 `sendRegistry.ts` 末尾（同一文件里两类登记：`SendRegistry` 管 invoke 的 Promise，`SendAttribution` 管数据行的归属）：

```ts
// src/main/services/msgBridge/sendRegistry.ts —— 追加
import type { MsgSource, NormalizedMessage } from '../../shared/chatTypes.ts'

interface Intent {
  localId: string
  viewId: string
  chatKey: string
  text: string
  at: number
}

export interface AttributionOptions {
  /** intent 活了多久就不再被事件流认领。 */
  maxAgeMs?: number
  /** 已知 msgKey 的保留时长：事件流可能比回执晚到很久（弱网 / 页面卡顿）。 */
  knownMs?: number
  now?: () => number
}

const DEFAULT_MAX_AGE_MS = 90_000
const DEFAULT_KNOWN_MS = 10 * 60_000
/** byMsgKey 的硬上限：这是主进程里的常驻内存，不能随消息量长。 */
const MAX_KNOWN = 5_000
/** 过期 intent 只留最近这么多条用于"迟到回执补写"，再多就是无意义的内存。 */
const MAX_EXPIRED = 200

/** 补写那一行需要的最小原文：只有主进程有（页内回执不带正文，C3 之外还省一份拷贝）。 */
export interface SendIntentMeta {
  chatKey: string
  text: string
}

/**
 * localId ⇄ msgKey 的双向登记。两条写入路径（事件流 / 发送回执）都来这里问一次，
 * 于是"谁先到"不再影响 `source` 的最终取值。
 * 认领规则刻意保守：只有同视图、同会话、同文本（FIFO）才允许在无 msgKey 时认领，
 * 认错的代价（把用户手发的消息算成本应用发的）比认漏（退化成 native_send + 一条重复写）高。
 */
export class SendAttribution {
  private readonly intents = new Map<string, Intent>()
  private readonly byMsgKey = new Map<string, { localId: string; at: number }>()
  private readonly maxAgeMs: number
  private readonly knownMs: number
  private readonly now: () => number

  constructor(opts: AttributionOptions = {}) {
    this.maxAgeMs = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS
    this.knownMs = opts.knownMs ?? DEFAULT_KNOWN_MS
    this.now = opts.now ?? Date.now
  }

  claim(viewId: string, localId: string, chatKey: string, text: string): void {
    this.intents.set(localId, { localId, viewId, chatKey, text, at: this.now() })
  }

  /**
   * 成功回执。@returns 事件流还没写过这一行时返回补写所需的原文，否则 null。
   * 三种落地：事件流已消化（false 路径 → null）、本表刚消掉 intent（meta）、
   * intent 已过期但回执仍到了（也要补写——那一刻主进程确实知道发出去了什么）。
   */
  settle(localId: string, msgKey: string): SendIntentMeta | null {
    const intent = this.intents.get(localId)
    this.intents.delete(localId)
    const now = this.now()
    if (this.byMsgKey.has(msgKey)) return null
    const meta = intent ?? this.recovered(localId)
    if (!meta) return null
    this.byMsgKey.set(msgKey, { localId, at: now })
    this.trim()
    return { chatKey: meta.chatKey, text: meta.text }
  }

  /** 失败 / 超时回执：intent 必须立刻失效，否则同会话同文本的原生消息会被误认领。 */
  abandon(localId: string): void {
    this.intents.delete(localId)
  }

  /** 盖 `source` / `sendLocalId` 之外的字段一律不动；in 行原样返回（同一个对象引用）。 */
  stamp(viewId: string, msg: NormalizedMessage): NormalizedMessage {
    if (msg.direction !== 'out') return msg
    const now = this.now()
    this.sweep(now)
    const known = this.byMsgKey.get(msg.msgKey)
    if (known) {
      known.at = now
      return withSource(msg, 'app_send', known.localId)
    }
    const queued = [...this.intents.values()]
      .filter((i) => i.viewId === viewId && i.chatKey === msg.chatKey && i.text === (msg.body ?? ''))
      .sort((a, b) => a.at - b.at)[0]
    if (!queued) return withSource(msg, 'native_send')
    this.intents.delete(queued.localId)
    this.byMsgKey.set(msg.msgKey, { localId: queued.localId, at: now })
    this.trim()
    return withSource(msg, 'app_send', queued.localId)
  }

  dropView(viewId: string): number {
    const ids = [...this.intents.values()].filter((i) => i.viewId === viewId).map((i) => i.localId)
    for (const id of ids) this.intents.delete(id)
    return ids.length
  }

  pendingIntents(): string[] {
    return [...this.intents.keys()]
  }

  private sweep(now: number): void {
    for (const [id, i] of this.intents) {
      if (now - i.at <= this.maxAgeMs) continue
      this.intents.delete(id)
      this.expired.set(id, i)
    }
    while (this.expired.size > MAX_EXPIRED) {
      const oldest = this.expired.keys().next().value
      if (oldest === undefined) break
      this.expired.delete(oldest)
    }
    for (const [key, v] of this.byMsgKey) if (now - v.at > this.knownMs) this.byMsgKey.delete(key)
  }

  /**
   * 过期不代表"不是本应用发的"，只代表 intent 表把它忘了。回执仍带 localId 回来时，
   * 用 `expired` 这份短命副本把补写所需的原文捞回来（上限 `MAX_EXPIRED` 条，只保这一份）。
   */
  private readonly expired = new Map<string, Intent>()

  private recovered(localId: string): Intent | undefined {
    return this.expired.get(localId)
  }

  private trim(): void {
    if (this.byMsgKey.size <= MAX_KNOWN) return
    // Map 的迭代顺序就是插入顺序：从头删最旧的。
    for (const key of [...this.byMsgKey.keys()].slice(0, this.byMsgKey.size - MAX_KNOWN)) {
      this.byMsgKey.delete(key)
    }
  }
}

function withSource(msg: NormalizedMessage, source: MsgSource, sendLocalId?: string): NormalizedMessage {
  return { ...msg, source, ...(sendLocalId ? { sendLocalId } : { sendLocalId: undefined }) }
}
```

> 三条设计约束值得单独说：① `settle` 只认 localId，不认 msgKey 之外的任何"猜测"，所以失败回执必须走 `abandon`，否则同会话同文本的原生消息会被误认领；② `sweep` 只在 `stamp` 入口跑，因为过期只在有人来认领时才有意义；③ `expired` 副本给"intent 过期但回执仍到"留了捞回原文的路，而它本身就是内存上限 200 的短命表——补写那一行值这点内存，值不了更多。

```bash
cd apps/desktop && pnpm run test:unit 2>&1 | tail -8
```

预期：`# pass 39`（+ 5 条），`# fail 0`。

- [ ] **Step 4: 页内 `send.ts`——把 wa-js 的返回与异常压成回执**

```ts
// src/bridge/whatsapp/send.ts
import type { BridgeCommand, SendError, SendReceipt } from '../../shared/chatTypes.ts'
import type { SendChatResult } from '../types.ts'

export type SendCmd = Extract<BridgeCommand, { kind: 'send' }>

/** 只依赖发送这一件事，测试用假对象即可，不需要真的 WPP。 */
export interface SendChat {
  sendTextMessage(to: string, content: string, options?: Record<string, unknown>): Promise<SendChatResult>
}

/**
 * 错误码分类。wa-js 抛的是普通 Error，文案随版本变，所以这里只是尽力归类：
 * 认不出一律 SEND_FAILED。真实分类词在 Step 6 的"坏 chatKey"一档里实测，不符就回来补正则。
 */
export function classify(err: unknown): SendError {
  const text = err instanceof Error ? err.message : String(err)
  return /chat|recipient|participant|number|not found|invalid|404|cannot send/i.test(text)
    ? 'CHAT_NOT_FOUND'
    : 'SEND_FAILED'
}

/**
 * 回执里的 key **原样用**，不去 `_out` 后缀、不剥前缀：这一串要与事件流那条的
 * `MsgModel.id._serialized` 逐字相等，后端 `uk_msg` 才认得出是同一行（Step 3 的归属登记与
 * 补写全靠这一致性）。去尾只属于页内 API 的入参（`deleteMessage` 要的是去掉 `_out` 的那串）。
 */
export function receiptFrom(cmd: SendCmd, result: SendChatResult | null | undefined, err: unknown): SendReceipt {
  if (err) {
    return { localId: cmd.localId, ok: false, error: classify(err), detail: err instanceof Error ? err.message : String(err) }
  }
  const msgKey = result?.id ?? ''
  // 没有 msgKey 就当失败：主进程无法把这一行与 localId 关联，成功返回只会造出一条查不到的幽灵气泡。
  if (!msgKey) return { localId: cmd.localId, ok: false, error: 'SEND_FAILED', detail: '平台未返回 msgKey' }
  return { localId: cmd.localId, ok: true, msgKey }
}

/**
 * `waitForAck: false`——回执要快，状态推进交给 ack 事件流（Task 11 的 msg_ack_change）。
 * 选项名以 Step 1 的 grep 结果为准。
 */
export async function sendViaWa(cmd: SendCmd, chat: SendChat | undefined): Promise<SendReceipt> {
  if (!chat) return { localId: cmd.localId, ok: false, error: 'BRIDGE_OFFLINE', detail: 'WPP.chat 不可用' }
  try {
    const result = await chat.sendTextMessage(cmd.chatKey, cmd.text, { createChat: true, waitForAck: false })
    return receiptFrom(cmd, result, null)
  } catch (e) {
    return receiptFrom(cmd, null, e)
  }
}
```

```ts
// src/bridge/whatsapp/send.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classify, receiptFrom, sendViaWa } from './send.ts'

const cmd = { kind: 'send' as const, localId: 'L1', chatKey: '861380001001@c.us', text: 'hi' }

test('发送成功：回执带 msgKey（真机返回的是字符串 id，不是 MsgKey 实例）', async () => {
  const calls: unknown[][] = []
  const chat = {
    async sendTextMessage(...args: unknown[]) {
      calls.push(args)
      return { id: 'true_861380001001@c.us_K-1_out', ack: 1, from: '861380000@c.us', to: '861380001001@c.us', sendMsgResult: 'OK' }
    }
  }
  assert.deepEqual(await sendViaWa(cmd, chat), { localId: 'L1', ok: true, msgKey: 'true_861380001001@c.us_K-1_out' })
  assert.deepEqual(calls[0], ['861380001001@c.us', 'hi', { createChat: true, waitForAck: false }])
})

test('桥在但 WPP 没就绪：BRIDGE_OFFLINE，不发就不算失败在平台上', async () => {
  assert.deepEqual(await sendViaWa(cmd, undefined), {
    localId: 'L1', ok: false, error: 'BRIDGE_OFFLINE', detail: 'WPP.chat 不可用'
  })
})

test('取不到 id 时按失败处理，不留无法关联的成功', () => {
  assert.equal(receiptFrom(cmd, {}, null)?.error, 'SEND_FAILED')
  assert.equal(receiptFrom(cmd, { id: '' }, null)?.error, 'SEND_FAILED')
  assert.equal(receiptFrom(cmd, undefined, null).ok, false)
})

test('错误分类：认得出的算 CHAT_NOT_FOUND，认不出的算 SEND_FAILED', () => {
  assert.equal(classify(new Error('Unable to find chat')), 'CHAT_NOT_FOUND')
  assert.equal(classify(new Error('Server error 500')), 'SEND_FAILED')
})
```

在 `src/bridge/types.ts` 里补回执类型并挂到 `WppChatApi` 上（回执形状属于"页内看到的 wa-js 面"，与 `WaMsgModel` 同一处；`send.ts` 从 `../types.ts` 取它，不要反过来 import `send.ts` 造成环）：

```ts
/**
 * wa-js 4.6.0 的类型与真机一致（`dist/chat/types.d.ts` 的 `SendMessageReturn`）：`sendTextMessage`
 * 结的不是 MsgModel，而是 `{ id, from, to, ack, sendMsgResult }`，且 **`id` 是序列化字符串**
 * （`true_<chatKey>_<ID>_out`，自带 `_out` 后缀）。按 `id._serialized` 取值会静默拿到 undefined，
 * 于是每次真发送都被判成"平台未返回 msgKey"。`sendMsgResult` 在不带 `waitForAck` 时恒为 null。
 */
export interface SendChatResult {
  id?: string
  ack?: number
  sendMsgResult?: unknown
}
```

```ts
  sendTextMessage(to: string, content: string, options?: Record<string, unknown>): Promise<SendChatResult>
```

- [ ] **Step 5: 接进桥与主进程**

`src/bridge/index.ts` 的 `case 'send'` 换成真发送（保持不阻塞命令回路：回执异步上行）：

```ts
      case 'send':
        // 不 await：命令回路是同步的，await 会让后面的 ping 排在这条消息后面。
        void sendViaWa(cmd, wppChat()).then((receipt) => {
          push({ kind: 'send_result', ...receipt })
        })
        return
```

并加 `import { sendViaWa } from './whatsapp/send.ts'` 与模块内：

```ts
const wppChat = () => (typeof window !== 'undefined' && window.WPP ? window.WPP.chat : undefined)
```

主进程 `msgBridge/index.ts`：

```ts
const registry = new SendRegistry()
const attribution = new SendAttribution()

/** 渲染层的唯一发送入口：localId 由渲染层生成，主进程只登记不发明。 */
export async function sendText(req: SendRequest): Promise<SendReceipt> {
  const localId = req.localId
  if (!isSendable(req)) return { localId, ok: false, error: 'SEND_FAILED', detail: '正文为空或超长' }
  const entry = accountOfId(req.accountId)
  const viewId = entry?.viewId
  if (!viewId) return { localId, ok: false, error: 'BRIDGE_OFFLINE', detail: '账号没有绑定视图' }
  const mount = bridgeOf(viewId)
  if (!mount || !mount.ready) return { localId, ok: false, error: 'BRIDGE_OFFLINE', detail: '会话未在线' }
  const wait = registry.add(localId, viewId)
  attribution.claim(viewId, localId, req.chatKey, req.text)
  mount.push({ kind: 'send', localId, chatKey: req.chatKey, text: req.text })
  // 超时（TIMEOUT）只在这条 Promise 上暴露，不会变成页内回执：必须在这里 abandon，
  // 否则同会话随后一条同文本的原生消息会被这条已经放弃的 intent 认领成 app_send。
  return wait.then((receipt) => {
    if (!receipt.ok) attribution.abandon(localId)
    return receipt
  })
}

/** 「同步历史」按钮：只在桥 ready 时下得去，否则返回 false 让 UI 保持禁用态一致。 */
export function requestBackfill(accountId: number): boolean {
  const viewId = accountOfId(accountId)?.viewId
  if (!viewId) return false
  return pushToBridge(viewId, { kind: 'backfill', limit: HISTORY_LIMIT_DEFAULT })
}
```

> `requestBackfill` 与 `sendText` 都不判 `platform`：命令到了页内才按 `config.platform` 分派（Task 8 Step 5 的 `install` 已经把平台带进去了）。所以 TG 的补底与发送在主进程这条链上不需要任何额外分支——Task 12c/12d 只要在页内把 `telegram` 的 `collect`/`send` 实现补进分派表，命令就自动接上；反过来说，在 12c 之前 TG 视图里根本没有页内接收方，命令会在「这个视图没有桥」那一步被拒（`BRIDGE_OFFLINE`），这也是 Task 10 的挂载闸门要与 12c 同批放开的理由。

`handleBridgeReport` 的两处改动——`message` 分支先盖章，再加 `send_result` 分支：

```ts
  if (report.kind === 'message') {
    const message = attribution.stamp(viewId, report.message)
    const frame: LiveFrame = {
      viewId, accountId: entry.accountId, platform: entry.platform ?? 'whatsapp',
      activeChatKey: activeChatOf(viewId), message
    }
    hub.push(frame)
    getMainWindow()?.webContents.send('msg:live', frame)
    return
  }
  if (report.kind === 'send_result') {
    const meta = report.ok && report.msgKey ? attribution.settle(report.localId, report.msgKey) : (attribution.abandon(report.localId), null)
    registry.settle(report)
    // meta === null 有两种：事件流已经把这一行写进去了，或这条根本不是本应用发的（迟到回执）。
    // 前者再写一次只是给 uk_msg 添压，后者压根不知道该写什么——都不补。
    if (meta?.chatKey && report.msgKey) {
      const frame: LiveFrame = {
        viewId, accountId: entry.accountId, platform: entry.platform ?? 'whatsapp',
        activeChatKey: activeChatOf(viewId),
        message: {
          chatKey: meta.chatKey, msgKey: report.msgKey, direction: 'out', body: meta.text,
          mediaType: 'text', msgTimeEpochSec: Math.floor(Date.now() / 1000),
          status: 'pending', source: 'app_send', sendLocalId: report.localId
        }
      }
      hub.push(frame)
      getMainWindow()?.webContents.send('msg:live', frame)
    }
    return
  }
```

> 补写那行的 `status: 'pending'` 是刻意的：那一刻主进程只知道"平台收了单"，之后的 `sent/delivered/read` 由 ack 事件经 `postStatuses` 推进（Task 11 Step 6），单调阶梯保证不会倒退。如果事件流随后才把真行带回来，`uk_msg` 会把它判为 duplicated——真时间因此丢一次，只影响 `msg_time` 的秒级误差；反过来（等事件流、不补写）会让记录页在事件流没到之前什么都有不了，代价更大。这条取舍记在这里，Task 19 的验收里用"自聊发送后 3s 内可见"来兜住它。

视图销毁 / 掉线时必须结清，否则回复框永久卡 pending。`bridgeMount.dispose()` 与 `logged_out` 分支都经过 `index.ts`，在 `onState` 里补：

```ts
function broadcastState(): void {
  const states = bridgeStates()
  for (const s of states) {
    if (s.phase === 'retry' || s.phase === 'offline' || s.phase === 'destroyed') {
      const n = registry.failView(s.viewId, 'BRIDGE_OFFLINE', s.detail ?? '桥未在线')
      attribution.dropView(s.viewId)
      if (n > 0) console.log(`[msgBridge] 结清未决发送 ${n} 条 view=${s.viewId}`)
    }
  }
  getMainWindow()?.webContents.send('msg:state', states)
}
```

> 日志只记条数与 viewId，不记正文（C3）。

- [ ] **Step 6: `ipc.ts` 三条 invoke + `preload` 的 `scrm.msg`**

`src/main/ipc.ts`：

```ts
import { sendText, requestBackfill, bridgeStates } from './services/msgBridge'
import type { SendRequest } from '@shared/chatTypes'
...
  /** 记录页回复：localId 由渲染层生成（乐观气泡的 key），主进程原样回带。 */
  ipcMain.handle('msg:send', (_e, req: SendRequest) => sendText(req))
  ipcMain.handle('msg:sync-history', (_e, accountId: number) => requestBackfill(accountId))
  ipcMain.handle('msg:bridges', () => bridgeStates())
```

`src/preload/index.ts` 的 `scrm` 对象里加一节（订阅型与 `win.onMaximizedChanged` 同形，返回解绑函数）：

```ts
  msg: {
    send: (req: SendRequest): Promise<SendReceipt> => ipcRenderer.invoke('msg:send', req),
    syncHistory: (accountId: number): Promise<boolean> => ipcRenderer.invoke('msg:sync-history', accountId),
    bridges: (): Promise<BridgeState[]> => ipcRenderer.invoke('msg:bridges'),
    onLive: (callback: (frame: LiveFrame) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, frame: LiveFrame): void => callback(frame)
      ipcRenderer.on('msg:live', listener)
      return () => ipcRenderer.removeListener('msg:live', listener)
    },
    onState: (callback: (states: BridgeState[]) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, states: BridgeState[]): void => callback(states)
      ipcRenderer.on('msg:state', listener)
      return () => ipcRenderer.removeListener('msg:state', listener)
    }
  }
```

并在文件顶部 `import type { BridgeState, LiveFrame, SendReceipt, SendRequest } from '@shared/chatTypes'`。**`electron.vite.config.ts` 的 `preload` 段也要 `resolve.alias`**（Task 7 只给 `main` / `renderer` 加了；preload 单独打包，没有别名会在构建期报 `@shared/chatTypes` 解析失败）：

```ts
  preload: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    build: { /* 原样保留 */ }
  },
```

- [ ] **Step 7: 验证**

```bash
cd apps/desktop && pnpm run test:unit 2>&1 | tail -8 && pnpm run build:bridge && pnpm run typecheck
```

预期：`# pass 43`（39 + send 4）；typecheck 全绿；`resources/msg-bridge.bundle.js` 重新产出且体积变化在几 KB 内（发送层很薄）。

真实登录态下的端到端（`tmp/p6e-send.mjs`，CDP 套路同 `verify-renderer-cdp` 记忆：抬窗口 → 断言 `visibilityState === 'visible'` → 结束前 `process.exit()`）。**测试正文统一带 `P6E-` 前缀与时间戳，跑完必须删除自聊里这几条**（spec §12 与既有约定）：

| # | 操作 | 期望（"生效 / 没动"的区分点） |
|---|---|---|
| 1 | 渲染层控制台 `await window.scrm.msg.bridges()` | 数组里有一条 `ready === true` 且 `platform === 'whatsapp'`；空数组 = 桥没挂上，后面全不用跑 |
| 2 | `window.scrm.msg.send({accountId, chatKey: <自聊>, text: 'P6E-<ts>', localId: crypto.randomUUID()})` | 回执 `{ok:true, msgKey}`；返回 `BRIDGE_OFFLINE` 时**不要**继续，先回 Task 10 的验证 |
| 3 | 等 3s 后 `GET /api/messages?accountId&chatKey=<自聊>&size=5` | 最新一条 `msg_key === 回执 msgKey`、`source === 'app_send'`、`send_local_id === 那个 localId`（第 2 步与事件流谁先到都不影响这一断言——这正是 Step 3 那张表存在的意义） |
| 4 | 同 `msg_key` 的行数 | `=== 1`（不是"看起来只有一条"，要拿 `total`/数组长度比对：两条说明补写与事件流没被登记消解） |
| 5 | 等 15s 再查同一条；原地不动时改用页内合成事件复测 | `status` 从 `pending` 前进到 `sent`/`delivered`/`read` 之一。**自聊档位拿不到这一步的 B 档通过**：wa-js 4.6.0 的 `chat.msg_ack_change` 只在"对端回执"或 ack 落到 1 时发，而自聊消息进 Store 时已经是已读，事件根本不发（Task 11 实测）。原地不动因此**不是**缺陷证据，要补一档：`WPP.emit('chat.msg_ack_change', {ids:[<序列化 key 的 MsgKey 形状>], chat, ack:3})` 合成一次事件 → 三条 id 应在**一个** `postStatuses` 请求里全部前进（合批的落库效果）。真实对端回执留给 Task 19 的多端场景 |
| 6 | 在**原生 WhatsApp 界面**手发一条 `P6E-NATIVE-<ts>` | 入库且 `source === 'native_send'`、`send_local_id` 为 `NULL`（与第 3 条构成反向对照：全打成 app_send 就说明认领过宽） |
| 7 | `send` 一个不存在的 chatKey（`'0@c.us'`） | 回执 `ok:false`；**记下 detail 原文**，与 `classify` 的归类不符就补正则并回到 Step 4 的测试 |
| 8 | 无桥账号（未登录视图的 accountId）调 `send` | `{ok:false, error:'BRIDGE_OFFLINE'}`，且页内没有新消息（"不排队"的口径：不在线就直接拒，不延迟发） |
| 9 | 桥在线但把视图 `destroyView` 掉之前发出的未回执那条 | invoke 以 `BRIDGE_OFFLINE` 结掉（Step 5 的 `broadcastState` 结清），dev 终端有 `结清未决发送` 一行 |
| 10 | 跑完在自聊里删除本轮 `P6E-*` 消息 | 原生页删除成功；库内行保留（P6 不做删除同步，spec §1 非目标），并在结论里写明这一条已知差异 |

第 3、4、6 三条是"发送归属"的成对证据：只跑第 3 条无法区分"认领生效"与"事件流根本没来所以没人反驳"。第 6 条给出反例通道，第 4 条钉住不重复。

**测试完清理**：`tmp/p6e-send.mjs` 结尾打印本轮产生的 `msg_key` 列表并删干净，不要留 `P6E-*` 在 WhatsApp 侧。删除走页内 `WPP.chat.deleteMessage(chatKey, id, true)`，**`id` 传"去掉 `_out` 后缀的那串序列化 key"**（保留 `true_<chatKey>_` 前缀）：带 `_out` 报 `wid error: invalid wid`，只留裸 id 报 `Cannot read properties of undefined (reading '_serialized')`（Task 11 三轮实测的口径，`tmp/p11-cleanup.mjs` 里有一份可用写法）。库内行保留（P6 不做删除同步，spec §1 非目标），并在结论里写明这一条已知差异。DEMO 种子不受影响（自聊不是种子客户）。

- [ ] **Step 8: 提交**

```bash
git add apps/desktop/src/bridge apps/desktop/src/main apps/desktop/src/preload apps/desktop/electron.vite.config.ts docs/superpowers/plans/2026-09-20-chat-history.md
git commit -m "feat(P6): 应用内回复发送链与发送归属登记"
```

---

## P6f — Telegram 链（官方 K 版 DOM 契约：探针 → 译文 → 采集 → 发送）

四档任务按 **12a → 12b → 12c → 12d** 顺序跑，整节接在 **Task 18 之后、Task 19 之前**（编号取 12x 是为了不给 Task 13～18 重排单测计数——那六个任务步骤里写死的预期 `# pass` 值是评审前的推演值，见 C14）。TG 这一节往闸门加的条数：**12a +2**（清单校验）、**12c +14**（DOM 解析与归一化）、**12d +6**（`out` 行认领的六条纯函数用例）、**12b +0**（`src/inject/**` 不在闸门白名单里，它的结论只有 CDP 那一档）。

**整节的硬前置是 Task 12a 的那一次扫码**：清单没有真值之前，12b/12c/12d 全部如实标 blocked。**不接受"先按猜测类名写代码、等扫码后再改"**——spec §11.0 的实测结论就是这条禁令的理由：猜出来的类名与真值在单测里长得一模一样，只有真机能区分，先写出来的代码只会把"没采到"伪装成"采到了 0 条"。

---

### Task 12a: Telegram 真机 DOM 探针（产出 spec §11.1 清单 + 脱敏快照）

**Goal：** 把"官方 K 版的 DOM 长什么样"从推测变成仓库里的两份产物——一份机器可读的选择器清单（`src/shared/tgDomContract.ts`，采集/发送/译文三处唯一的类名来源），一份脱敏的真机 DOM 快照（`apps/desktop/test/tg-probe/`，Task 12c 裁 fixture 的原料）。本任务不写任何采集逻辑。

**前置（不满足就 blocked，不要绕）**：
1. `pnpm --dir apps/desktop run dev -- --remoteDebuggingPort 9223` 起着，窗口抬起且 `visibilityState === 'visible'`（C9/C10）；
2. TG 账号视图已加载本任务 Step 1 钉好的 `/k/` 地址，且**用户用手机 Telegram 扫过一次码**（K 与 A 不共用会话登录态，spec §11.0 第 1 行）。

**Files:**
- Modify: `apps/desktop/src/renderer/src/lib/platform.ts`（Telegram 那一项的 `embedUrl` 与 `hint`）
- Create: `apps/desktop/src/shared/tgDomContract.ts`（`TgDomContract` 类型 + `TG_DOM` 清单 + `assertTgContract`）
- Test: `apps/desktop/src/shared/tgDomContract.test.ts`（2 条）
- Create: `tmp/p6-tg-probe.mjs`（探针；`tmp/` 在 gitignore 里，不入库）
- Create: `apps/desktop/test/tg-probe/manifest.json`、`apps/desktop/test/tg-probe/snapshots.md`（探针产物，入库）

**Interfaces:**
- Consumes: `tmp/cdp.mjs` 的 `openViewByUrl(urlPart, port)`（P5/P6 一直在用的宿主通道，attach 到内嵌视图本体）。
- Produces:
  - `interface TgDomContract`（字段见 Step 2）、`const TG_DOM: TgDomContract`、`assertTgContract(c: TgDomContract): string[]`（返回缺项列表，空数组=清单可用）
  - `test/tg-probe/manifest.json`：探针原样输出的 `{ probedAt, build, candidates, attrs, hashes, times, snapshot }`
  - Task 12c/12d/12b 只 `import { TG_DOM } from '@shared/tgDomContract'`（inject 侧用相对路径 `../../../shared/tgDomContract`），**不得自带任何类名字符串**

- [ ] **Step 1: 钉住内嵌地址（这一处代码改动是本任务的前置，不是可选优化）**

`apps/desktop/src/renderer/src/lib/platform.ts` 里 `PlatformType.Telegram` 那一项：

```ts
  [PlatformType.Telegram]: {
    type: PlatformType.Telegram,
    label: 'Telegram',
    ...
    channel: 'Telegram',
    // 根地址会被页面自己的路由带到 /a/（2026-09-22 实测 location.href 停在 /a/），
    // 而本期整套 TG 契约是按 K 版定的——路径必须钉死，不钉就不是同一份 DOM。
    embedUrl: 'https://web.telegram.org/k/',
    hint: '手机 Telegram 扫码登录（设置 > 设备 > 登录网页版）'
  },
```

改完跑 `pnpm --dir apps/desktop run typecheck`（预期 4/4 绿），再在 dev 实例里打开 TG 账号，用 CDP 断言落在 K 版而不是 A 版：

```js
// tmp/p6-tg-kurl.mjs
import { openViewByUrl } from './cdp.mjs'
const v = await openViewByUrl('web.telegram.org', 9223)
console.log(await v.ev('({ href: location.href, path: location.pathname, hasGetGlobal: "getGlobal" in window })'))
await v.close(); process.exit(0)
```

预期 `path === '/k/'`、`hasGetGlobal === false`。**`hasGetGlobal` 这一项必须是 false**：它是 spec §11.0 那条推翻旧裁定的观察，留在这一档的产出里，后续任何人想改回 store 路线时先要让它变 true。（2026-09-22 已在未登录态实测过这两条；本步是在**登录态 + 我们自己的视图分区**里再取一次，两者都算 A/B 档分开写。）

- [ ] **Step 2: `tgDomContract.ts` 的类型 + `assertTgContract` 先写红**

`apps/desktop/src/shared/tgDomContract.test.ts`（2 条，**必须能区分"清单填好了"和"清单是个空壳"**）：

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { TG_DOM, REQUIRED_KEYS, assertTgContract } from './tgDomContract.ts'

test('清单里必填项都已填（Task 12a 没跑完就红在这里，而不是让 12c 拿空串去 querySelector）', () => {
  const missing = assertTgContract(TG_DOM)
  assert.deepEqual(missing, [], `选择器清单未落地，缺：${missing.join(', ')}`)
})

test('id 来源两条路都判过：hash 与 attr 至少各有一条明确结论', () => {
  // 'none' 是合法结论（探针确实拿不到时就该写 none，采集侧据此降级），
  // 但空串/undefined 不是——那意味着这一档压根没跑。
  assert.ok(['hash', 'attr', 'none'].includes(TG_DOM.chatIdSource), `chatIdSource=${TG_DOM.chatIdSource}`)
  assert.ok(['attr', 'none'].includes(TG_DOM.msgIdSource), `msgIdSource=${TG_DOM.msgIdSource}`)
  if (TG_DOM.chatIdSource === 'attr') assert.ok(TG_DOM.chatIdAttr, 'chatIdSource=attr 却没记属性名')
  if (TG_DOM.msgIdSource === 'attr') assert.ok(TG_DOM.msgIdAttr, 'msgIdSource=attr 却没记属性名')
})
```

`assertTgContract` 的必填集合 = 除 `chatIdAttr` / `msgIdAttr`（条件必填，Step 2 第 2 条用例管）之外的全部字符串字段；`build` 与 `probedAt` 也在内（**没有探针时间戳的清单等同于没有清单**）。

- [ ] **Step 3: 实现类型与校验，让两条用例绿**

```ts
// apps/desktop/src/shared/tgDomContract.ts
/**
 * Telegram 官方 K 版页面（`https://web.telegram.org/k/`）的 DOM 契约。
 *
 * 这份清单是 TG 三条链（采集 / 发送 / 译文注入）**唯一**的类名来源：代码里不许出现第二个
 * Telegram 类名字符串。值不来自推测——由 `tmp/p6-tg-probe.mjs` 在真登录态跑出来的
 * `apps/desktop/test/tg-probe/manifest.json` 誊回，`probedAt` 与 `build` 就是那次运行的凭证。
 *
 * 为什么集中成一份配置：K 版是构建产物，类名跟着版本变（spec §11.0）。散布在三个文件里的
 * 字符串改版时会"坏一半"——译文还在、采集已经空了。集中一处，改版时的失效是一整块，
 * 且 `assertTgContract` 那两条闸门用例会替我们守着"清单没落地就别往下写"。
 */
export interface TgDomContract {
  /** 探针当次的构建标识：`localStorage.k_build` 优先，取不到时用主 chunk 文件名。 */
  build: string
  /** ISO 时间，探针跑的那一刻。 */
  probedAt: string
  /** 登录页容器（负判定）。 */
  loginForm: string
  /** 已登录才出现的节点（正判定）。与 loginForm 都不命中 = 未知态，不采不发（spec §9）。 */
  loggedIn: string
  chatList: string
  chatRow: string
  chatRowActive: string
  chatRowTitle: string
  chatRowUnread: string
  chatRowTime: string
  /** 打开会话后的消息滚动容器：补底靠滚它到顶（spec §11.2）。 */
  messageList: string
  messageRow: string
  incoming: string
  outgoing: string
  messageBody: string
  messageTime: string
  messageMedia: string
  /** 日期分组头：`messageTime` 只有 `HH:MM` 时，日期从这个节点的文本补。 */
  dateSeparator: string
  composerInput: string
  sendButton: string
  /** 会话 id 来源：`location.hash` / 行属性 / 两处都没有。 */
  chatIdSource: 'hash' | 'attr' | 'none'
  chatIdAttr?: string
  /** 消息 id 来源：行（或其后代）上的属性 / 没有。没有就走合成键，代价写死在 §11.2。 */
  msgIdSource: 'attr' | 'none'
  msgIdAttr?: string
}

/** 条件必填（两个 `*Attr`）之外的全部字段：缺一个都算清单没落地。 */
export const REQUIRED_KEYS: readonly (keyof TgDomContract)[] = [
  'build', 'probedAt', 'loginForm', 'loggedIn', 'chatList', 'chatRow', 'chatRowActive', 'chatRowTitle',
  'chatRowUnread', 'chatRowTime', 'messageList', 'messageRow', 'incoming', 'outgoing', 'messageBody',
  'messageTime', 'messageMedia', 'dateSeparator', 'composerInput', 'sendButton'
]

export function assertTgContract(c: TgDomContract): string[] {
  const missing: string[] = []
  for (const k of REQUIRED_KEYS) {
    const v = c[k]
    if (typeof v !== 'string' || v.trim() === '') missing.push(k)
  }
  return missing
}

/**
 * 占位清单：**Task 12a 的探针跑完才能填真值**，闸门第一条用例在此之前是红的。
 * 这是有意的——把"清单还没落地"暴露成一条会失败的检查，而不是让后续任务静默对着空串写代码。
 * 评审时若看到本对象仍是占位形状，说明 Task 12a 没跑，TG 后续三档不得开工。
 */
export const TG_DOM: TgDomContract = {
  build: '',
  probedAt: '',
  loginForm: '',
  loggedIn: '',
  chatList: '',
  chatRow: '',
  chatRowActive: '',
  chatRowTitle: '',
  chatRowUnread: '',
  chatRowTime: '',
  messageList: '',
  messageRow: '',
  incoming: '',
  outgoing: '',
  messageBody: '',
  messageTime: '',
  messageMedia: '',
  dateSeparator: '',
  composerInput: '',
  sendButton: '',
  chatIdSource: 'none',
  msgIdSource: 'none'
}
```

跑 `pnpm --dir apps/desktop run test:unit`：Step 2 那两条在实现前红（模块不存在），实现后第一条**仍然红**（占位清单就是没填），第二条绿。第一条转绿的条件是 Step 6 把真值誊进来——**这一档不接受为了让它绿而填假值**，宁可让 `# fail 1` 跟着提交并在报告里写明"清单未落地"。基线：闸门条数 = 真实基线 + 2（C14：不抄本文件里的绝对数）。

- [ ] **Step 4: 写探针 `tmp/p6-tg-probe.mjs`**

探针不猜类名：它把页面上"结构上像什么"的候选**统计**出来，再把判定需要的原始材料一次取全。正文一律不进产物（C3）——快照里的文字全部替换成占位符，时间文本允许留（它是解析规则的输入，不是客户内容）。

```js
// tmp/p6-tg-probe.mjs —— Task 12a：官方 K 版真登录态 DOM 探针
// 用法：node tmp/p6-tg-probe.mjs            （需要 dev 起着 + TG 视图已扫码登录）
//       node tmp/p6-tg-probe.mjs --open 2   （额外点开前 2 个会话，取消息行与 hash）
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { openViewByUrl } from './cdp.mjs'

const OUT_DIR = 'apps/desktop/test/tg-probe'
const OPEN_CHATS = (() => {
  const i = process.argv.indexOf('--open')
  return i > 0 ? Number(process.argv[i + 1] || 1) : 0
})()

/** 页内执行的一段：把类名频次、行属性、hash、时间文本一次取回来。正文一律打码。 */
const PROBE = `(async () => {
  const redact = (s) => String(s ?? '').replace(/\\S/g, '·').slice(0, 12)
  const attrsOf = (el) => {
    const o = {}
    for (const a of el?.attributes ?? []) if (/^data-/i.test(a.name) || a.name === 'id') o[a.name] = /^data-(text|content|message|msg)/i.test(a.name) ? redact(a.value) : a.value
    return o
  }
  /** 从某类容器里按"自身 + 直接子层"统计候选选择器：命中数、方向分布、是否含正文。 */
  const scan = (rootSel) => {
    const freq = new Map()
    const roots = [...document.querySelectorAll(rootSel)]
    for (const r of roots) {
      for (const el of [r, ...r.children, ...r.querySelectorAll('*')].slice(0, 400)) {
        if (typeof el.className !== 'string') continue
        for (const c of el.className.trim().split(/\\s+/)) {
          if (!c || c.length > 60) continue
          const cur = freq.get(c) || { n: 0, sample: null, textLen: 0, hasImg: false }
          cur.n++
          const t = (el.textContent || '').trim()
          cur.textLen = Math.max(cur.textLen, t.length)
          cur.hasImg = cur.hasImg || !!el.querySelector('img,video,svg')
          if (!cur.sample) cur.sample = { tag: el.tagName, attrs: attrsOf(el), cls: String(el.className).slice(0, 160) }
          freq.set(c, cur)
        }
      }
    }
    return [...freq.entries()]
      .sort((a, b) => b[1].n - a[1].n)
      .slice(0, 40)
      .map(([cls, v]) => ({ cls, n: v.n, maxTextLen: v.textLen, hasMedia: v.hasImg, sample: v.sample }))
  }
  return {
    href: location.href, path: location.pathname, title: document.title,
    build: localStorage.getItem('k_build') || localStorage.getItem('build') || '',
    lsKeys: Object.keys(localStorage).sort(),
    hasGetGlobal: 'getGlobal' in window,
    hasInvokeApi: typeof window.apiManagerProxy?.invokeApi,
    bodyClasses: [...document.body.children].map((e) => e.className || e.id || e.tagName),
    counts: {
      messages: document.querySelectorAll('.Message').length,
      composer: document.querySelectorAll('.composer').length,
      inputs: document.querySelectorAll('input,textarea,[contenteditable]').length,
      dialogs: document.querySelectorAll('.dialog-wrapper').length
    },
    shell: scan('body > *'),
    chatRows: scan('.sidebar, .chatlist-container, .tabs-container, .content-wrapper').slice(0, 25),
    msgRows: scan('.MessageList, .message-list, .middle-column, #page-chats').slice(0, 25),
    // 会话 id 来源之一：hash。逐个点开会话后这里会跟着变（--open 时重取）。
    hash: location.hash,
    timeSamples: [...document.querySelectorAll('.Message')].slice(0, 6).map((el) => {
      const cand = [...el.querySelectorAll('*')].filter((e) => /^\\s*\\d{1,2}[:.]\\d{2}\\s*$/.test(e.textContent || ''))
      return { n: cand.length, cls: cand.map((e) => String(e.className).slice(0, 60)), txt: cand.map((e) => e.textContent.trim()) }
    })
  }
})()`

/** 点开会话：用探针回来的候选行选择器试，直到 location.hash 变为止。 */
const CLICK_CHAT = `(async (sel) => {
  const row = document.querySelector(sel)
  if (!row) return { ok: false, why: 'no-row' }
  const before = location.hash
  ;['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((t) =>
    row.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })))
  await new Promise((r) => setTimeout(r, 1200))
  return { ok: location.hash !== before, before, after: location.hash, rowAttrs: JSON.stringify(row.attributes ? [...row.attributes].map((a) => [a.name, a.value]) : []) }
})`

const v = await openViewByUrl('web.telegram.org', 9223)
const first = await v.ev(PROBE)
const results = [first]

for (let i = 0; i < OPEN_CHATS; i++) {
  const cand = (first.chatRows.find((c) => c.n > 3 && c.sample?.tag === 'DIV')?.cls) || ''
  const r = await v.ev(`${CLICK_CHAT}(${JSON.stringify(`.${cand}`)})`)
  console.log('点开会话', i, r)
  results.push(await v.ev(PROBE))
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(results, null, 2))

// 人读的那一份：每个候选一段，配"它是不是消息行/正文/时间"的判断依据。
const md = results.map((r, i) => [
  `## 采样 ${i} — \`${r.path}${r.hash}\`（build ${r.build}，${r.href}）`,
  `- 顶层窗口标记：\`getGlobal\` ${r.hasGetGlobal}，\`apiManagerProxy.invokeApi\` ${r.hasInvokeApi}`,
  `- 计数：messages=${r.counts.messages} composer=${r.counts.composer} inputs=${r.counts.inputs} dialogs=${r.counts.dialogs}`,
  `- localStorage：${r.lsKeys.join(' ')}`,
  '',
  '### 会话列表候选（class / 命中数 / 最大文本长度 / 是否含媒体 / 样例属性）',
  ...r.chatRows.map((c) => `- \`.${c.cls}\` n=${c.n} maxTextLen=${c.maxTextLen} media=${c.hasMedia} ${JSON.stringify(c.sample)}`),
  '',
  '### 消息区候选',
  ...r.msgRows.map((c) => `- \`.${c.cls}\` n=${c.n} maxTextLen=${c.maxTextLen} media=${c.hasMedia} ${JSON.stringify(c.sample)}`),
  '',
  '### 时间形态样本（正文已打码）',
  ...r.timeSamples.map((s, j) => `- 第 ${j} 行：候选节点 ${s.n} 个，class=${JSON.stringify(s.cls)}，文本=${JSON.stringify(s.txt)}`),
  ''
].join('\n')).join('\n')
writeFileSync(path.join(OUT_DIR, 'snapshots.md'), `# TG 官方 K 版 DOM 探针产物（正文打码）\n\n${md}`)
console.log('写入', path.join(OUT_DIR, 'manifest.json'), '与 snapshots.md；采样次数', results.length)
await v.close()
process.exit(0)
```

- [ ] **Step 5: 跑探针，核对产物**

```bash
node tmp/p6-tg-probe.mjs --open 2
```

看三件事，缺一不可：
1. `counts.messages > 0` 且 `counts.inputs > 0` —— 这是"确实登录进去、确实打开会话了"的证据。全是 0 就说明停在空壳态（spec §11.0 第 6 行那条），**产物不能用**，先解决登录态再重跑；
2. `hash` 在两次采样之间变了 —— 变了就是 `chatIdSource: 'hash'` 成立，`snapshots.md` 里要留那两次 `path#hash` 的原文；两次都一样则判 `'none'`；
3. `snapshots.md` 全文没有可读正文（打码生效）。有正文就不提交，回去改 `redact`。

- [ ] **Step 6: 把 manifest 誊进 `TG_DOM`，逐字段核对**

规则：**每一处取值都必须能在 `manifest.json` 或 `snapshots.md` 里指到一条证据**（哪个候选、命中数多少）。指不到的字段写 `''`（必填项）或 `'none'`（两个 `*Source`），并在 `TG_DOM` 上方加一行注释写明"该字段探针未定，12c 的降级口径是……"。禁止"看着像就填"。

- [ ] **Step 7: 回归 + 提交**

`pnpm --dir apps/desktop run typecheck && pnpm --dir apps/desktop run test:unit`（第一条清单校验用例此时应转绿；仍红就是 Step 6 有字段没落地，如实写进报告）。

```bash
git add apps/desktop/src/renderer/src/lib/platform.ts apps/desktop/src/shared/tgDomContract.ts \
  apps/desktop/src/shared/tgDomContract.test.ts apps/desktop/test/tg-probe
git commit -m "feat(P6): Telegram 官方 K 版真机 DOM 探针与选择器清单"
```

（`tmp/` 在 gitignore 里，探针脚本不入库；它的完整文本在本计划正文里，需要重建时直接取。）

---

### Task 12b: 注入层 TG 适配器接清单（译文与 WA 同形）

**Goal：** P5 的注入层 TG 适配器里的类名全部是**未验证的猜测**（`.Imgs` 判登录、`.message-list-item`、`.text-content`、`#editable-message-text`、`.Transition_slide.Transition_slide-active>.MessageList`）。本任务把它们换成 Task 12a 清单里的真值，让 TG 内嵌页的**气泡译文**与**输入框预览**和 WhatsApp 一样能用。这一步排在采集之前：它只依赖登录态，不依赖采集链，且与 12c 共用同一份产物。

**Files:**
- Modify: `apps/desktop/src/inject/platforms/telegram/selectors.ts`（删掉猜测常量，改成从 `TG_DOM` 派生）
- Modify: `apps/desktop/src/inject/platforms/telegram/index.ts`（`checkLogin` 正/负双判定、`getInputElement`、`getMessageContainer`、`getMessageElements`、`getMessageId`、`getMessageText`）
- Modify: `apps/desktop/src/inject/core/translation/domScan.ts`（**只在需要新增"方向判定"注入点时**才动；`sideFromGaps` 那套按几何判方向的逻辑如果 K 版适用就不改，见 Step 1）

**Interfaces:**
- Consumes: `TG_DOM`（`../../../shared/tgDomContract`，esbuild 的 `bundle: true` 会把它并进 `resources/inject.bundle.js`，不新增构建步骤）
- Produces: `TelegramAdapter` 的 `checkLogin(): boolean`（三态收两态：`'in' | 'out' | 'unknown'` 里 unknown 一律按未登录处理，见 Step 2）与既有 `PlatformAdapter` 契约不变——Task 17b 的"气泡跟随客户语向"在 TG 上的生效面就是这一档给的

- [ ] **Step 1: 先确认哪些猜测值真的错了（不跑不写）**

dev 起着、TG 视图在 `/k/` 且已登录（Task 12a 的前置复用），逐个查现有选择器在真页面上的命中数：

```js
// tmp/p6-tg-oldsel.mjs
import { openViewByUrl } from './cdp.mjs'
const v = await openViewByUrl('web.telegram.org', 9223)
const sels = ['.Imgs', '.middle-column-footer', '#editable-message-text', '.message-list-item',
  '.text-content', '.Message', '.MessageList.custom-scroll',
  '.Transition_slide.Transition_slide_active>.MessageList']
console.log(await v.ev(`(${JSON.stringify(sels)}.map((s) => [s, document.querySelectorAll(s).length]))`))
await v.close(); process.exit(0)
```

命中数为 0 的就是要替换的；命中数>0 的也**不代表对**——比如 `.Imgs` 如果在登录页上也在，判登录就是错的。把这一条的输出贴进报告，作为"哪些字段被动过"的证据。

- [ ] **Step 2: 改 `selectors.ts` 与适配器**

`selectors.ts` 不再持有字符串，只做映射（保留导出名是为了不牵动 `PlatformAdapter` 的调用点）：

```ts
import { TG_DOM } from '../../../shared/tgDomContract'

/**
 * Telegram 侧的 DOM 触点全部来自 `TG_DOM`（Task 12a 探针产物）。这里**只映射不新增**：
 * 出现第二个 Telegram 类名字符串就说明清单不管用了，那是 12a 该修的，不是这里该补的。
 */
export const INPUT = { box: TG_DOM.composerInput, editInputId: TG_DOM.composerInput }
export const MESSAGE = {
  box: TG_DOM.messageList,
  container: TG_DOM.messageRow,
  item: TG_DOM.messageRow,
  text: TG_DOM.messageBody,
  scroll: TG_DOM.messageList
}
export const APP = { loggedIn: TG_DOM.loggedIn, loginForm: TG_DOM.loginForm }
export default { INPUT, MESSAGE, APP }
```

`index.ts` 里三处按清单改写：

```ts
  /**
   * 正反双判定（spec §11.0 第 6 行）：未登录态可能既没有会话也没有登录表单——那既不是
   * "已登录"也不是"未登录"，是"这一档别动"。返回 unknown 让上层不采不注，
   * 而不是猜一个方向把空壳页当成登录成功去扫消息。
   */
  async checkLogin(): Promise<boolean> {
    if (TG_DOM.loginForm && document.querySelector(TG_DOM.loginForm)) return false
    return !!(TG_DOM.loggedIn && document.querySelector(TG_DOM.loggedIn))
  }

  getMessageElements(): HTMLElement[] {
    if (!this.checkLoginSync()) return []
    return Array.from(document.querySelectorAll<HTMLElement>(TG_DOM.messageRow))
  }

  getMessageText(element: HTMLElement): string {
    // 只认清单点名的正文节点：整行兜底会把时间戳与状态图标的字体连字当正文送去翻译。
    return element.querySelector(TG_DOM.messageBody)?.textContent?.trim() ?? ''
  }
```

（`checkLoginSync()` 是适配器里加的一个同步小函数，包一次上面两个查询；`PlatformAdapter` 的异步 `checkLogin()` 保留原签名。）

- [ ] **Step 3: B 档真机验证（这一档没有 A 档，如实写）**

注入层不在 `tsconfig.unit.json` 白名单里，本任务的结论**只有真机那一档**。跑法：把翻译中心的双向设置设成 `en→zh`，TG 会话里让对端发一条英文消息（自聊：从"已保存消息"那个会话发），然后核对：

1. 气泡下方出现译文行（与 WA 同形）；
2. 输入框里敲一条英文 → 预览卡出现"用译文替换输入框"（复用 P5 的 `inputPreview`，TG 的 `composerInput` 是 contenteditable 时 `replaceEditorText` 已验证过同一条路径）；
3. 停后端（杀 `:8180`）后译文不出、原文照渲染，重启后**刷新视图**恢复。

三条各自要在报告里写"观察到 / 未观察"，不接受"代码改了所以应该生效"。若 Step 1 显示 `TG_DOM.messageBody` 与行内正文节点不符（译文注在错误节点上），停下报 DONE_WITH_CONCERNS——那说明清单粒度不够，回 12a 加字段，不在这里打补丁。

- [ ] **Step 4: 回归 + 提交**

`pnpm --dir apps/desktop run typecheck && pnpm --dir apps/desktop run build:inject`（注入 bundle 要重新构建；dev 不热更 `resources/*.js`，验完重启 dev）。闸门条数不变（本任务不加用例）。

```bash
git add apps/desktop/src/inject
git commit -m "feat(P6): Telegram 注入层改接探针清单，译文与 WhatsApp 同形"
```

---

### Task 12c: Telegram 采集链（DOM 读取 + 归一化 + 实时与滚动补底）

**Goal：** 按 `TG_DOM` 读官方 K 版页面，把消息归一化进 Task 3 的 `POST /api/messages/batch` 形状（经主进程 `collectorHub`，页内零凭据），并登记进 Task 11 留好的平台分派表；用一份从真机快照裁出的 fixture 页把整条链验到绿（A 档）。

**执行顺序**：接在 Task 12b 之后。编号仍取 12c，是为了不重排 Task 13～18 步骤里写死的 `# pass` 值（C14）。

**Files:**
- Create: `apps/desktop/src/bridge/telegram/tgParse.ts` + `tgParse.test.ts`（8 条，纯函数）
- Create: `apps/desktop/src/bridge/telegram/tgDom.ts`（清单 → `TgRowSnapshot[]` 的唯一 impure 读取处）
- Create: `apps/desktop/src/bridge/telegram/normalize.ts` + `normalize.test.ts`（6 条，纯函数）
- Create: `apps/desktop/src/bridge/telegram/collect.ts`（`CollectImpl` 四入口）
- Modify: `apps/desktop/src/bridge/index.ts`（`COLLECT` 表加 telegram 一项）
- Modify: `apps/desktop/src/main/services/msgBridge/index.ts`（挂载闸门放开 telegram）
- Create: `apps/desktop/test/tg-fixture.html`（由 `test/tg-probe/snapshots.md` 同源快照裁出，不进包）
- Create: `tmp/p6-tg-fixture.mjs`（A 档整链驱动，第 0～9 行）
- Create: `apps/server/src/main/resources/db/migration/V9__tg_openid_shape.sql`（**条件产物**，见 Step 7）
- Modify: `apps/server/src/main/java/com/smartscrm/server/service/msg/ChatKeys.java`（类注释里"形态未决 / 以探测为准"改成既定口径）

**Interfaces:**
- Consumes: Task 11 的 `CollectCtx` / `CollectImpl`（`src/bridge/types.ts`）、Task 7 的 `@shared/chatTypes` 的 `NormalizedMessage` / `BridgeReport`、Task 3 的 batch 形状（主进程组装）、Task 10 的挂载闸门、Task 12a 的 `TG_DOM`
- Produces:
  - `chatKeyFromHash(hash: string, src: TgDomContract['chatIdSource']): string | null`
  - `synthTgMsgKey(input: { chatKey: string; epochSec: number; dir: 'in' | 'out'; body: string }): string`
  - `parseTgTime(timeText: string | null, separatorText: string | null, nowSec: number): { t: number; precise: boolean }`
  - `parseTgUnread(text: string | null): number`、`mediaTypeOfTg(row: TgRowSnapshot): { mediaType: string; summary: string }`
  - `normalizeTg(row: TgRowSnapshot, ctx: NormalizeTgCtx): NormalizedMessage | null`
  - `tgDom.ts`：`readChatRows(): TgChatRow[]`、`readMessageRows(chatKey: string): TgRowSnapshot[]`、`scrollMessageListToTop(budget: { steps: number; ms: number }): Promise<{ reachedTop: boolean; steps: number }>`
  - `telegram/collect.ts` 的 `CollectImpl` 四入口（与 WhatsApp 同名同形）

**为什么切两层**：Node 24 的 strip-only TS 闸门里没有 DOM（没有 jsdom，也不引）。所以"从节点取字段"是 impure 的 `tgDom.ts`，"从字段推语义"是 pure 的 `tgParse.ts`/`normalize.ts`——单测跑后者，fixture 的 CDP 跑前者。这条切分同时是 WA 那一支已有的形状（`whatsapp/normalize.ts` 吃的是 plain object）。

- [ ] **Step 1: `tgParse.test.ts` 先写红（8 条）**

```ts
// apps/desktop/src/bridge/telegram/tgParse.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { chatKeyFromHash, synthTgMsgKey, parseTgTime, parseTgUnread } from './tgParse.ts'

test('hash 里的会话 id：单聊是正数、群与频道带负号，两种都要能取出来', () => {
  assert.equal(chatKeyFromHash('#123456789', 'hash'), '123456789')
  assert.equal(chatKeyFromHash('#-1001234567890', 'hash'), '-1001234567890')
  assert.equal(chatKeyFromHash('#-1001234567890/123', 'hash'), '-1001234567890')  // 话题/线程后缀丢掉
})

test('hash 里没有 id 时返回 null，不返回空串（空串会被后端当成合法 chatKey）', () => {
  assert.equal(chatKeyFromHash('#', 'hash'), null)
  assert.equal(chatKeyFromHash('#/settings', 'hash'), null)
  assert.equal(chatKeyFromHash('#anything', 'hash'), null)
})

test('探针判 none 时不解释 hash：宁可不采，也不要把路由名当成会话 id', () => {
  assert.equal(chatKeyFromHash('#123456789', 'none'), null)
})

test('合成键：同输入同键（幂等靠 uk_msg，键不稳就会重复入库）', () => {
  const a = synthTgMsgKey({ chatKey: '123', epochSec: 1700000000, dir: 'in', body: 'hello' })
  assert.equal(a, synthTgMsgKey({ chatKey: '123', epochSec: 1700000000, dir: 'in', body: 'hello' }))
  assert.ok(a.length <= 128, `uk_msg 一侧 msgKey 上限 128，超长会被整批 400`)
})

test('合成键：方向、正文、时间任一变化都要换键', () => {
  const base = { chatKey: '123', epochSec: 1700000000, dir: 'in' as const, body: 'hello' }
  const k = (p: Partial<typeof base>) => synthTgMsgKey({ ...base, ...p })
  assert.notEqual(k({ dir: 'out' }), k({}))
  assert.notEqual(k({ body: 'hello!' }), k({}))
  assert.notEqual(k({ epochSec: 1700000001 }), k({}))
  assert.notEqual(k({ chatKey: '124' }), k({}))
})

test('时间：只有 HH:MM 时靠日期分组头补日期', () => {
  const r = parseTgTime('14:03', '2026年9月20日 星期日', 1759000000)
  assert.equal(r.precise, true)
  const d = new Date(r.t * 1000)
  assert.equal(d.getHours(), 14)
  assert.equal(d.getMinutes(), 3)
})

test('时间：解析不出来时钳制为接收时刻并标 not precise（后端据此打 unknown 精度）', () => {
  const r = parseTgTime('', null, 1759000000)
  assert.equal(r.t, 1759000000)
  assert.equal(r.precise, false)
  assert.equal(parseTgTime(null, null, 1759000000).precise, false)
})

test('未读角标："3"→3、"99+"→99、"•"与 null→0（脏值不许变 NaN）', () => {
  assert.equal(parseTgUnread('3'), 3)
  assert.equal(parseTgUnread('99+'), 99)
  assert.equal(parseTgUnread('•'), 0)
  assert.equal(parseTgUnread(null), 0)
})
```

跑 `pnpm --dir apps/desktop run test:unit` 预期：8 条红（模块不存在）。

- [ ] **Step 2: 实现 `tgParse.ts`（让 8 条绿）**

要点（实现时按这段写，注释照抄）：

```ts
// apps/desktop/src/bridge/telegram/tgParse.ts
import type { TgDomContract } from '../../shared/tgDomContract.ts'

/** K 版的路由 hash：`#<peerId>` 或 `#-100…<threadId>`，`-100` 前缀就是群/频道。 */
const HASH_CHAT = /^#(-?\d{4,20})(?:\/.*)?$/

export function chatKeyFromHash(hash: string | null | undefined, src: TgDomContract['chatIdSource']): string | null {
  // 探针判 none 时**连 hash 都不解释**：路由形状是页面的自由，猜对了是运气，猜错了一个
  // 路由名（`#/settings`）就能被当成会话 id 写进 chat_key，脏数据无法自愈。
  if (src !== 'hash') return null
  const m = HASH_CHAT.exec(String(hash ?? ''))
  return m ? m[1] : null
}

/** FNV-1a：只要一个稳定散列，不引依赖。 */
function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * 清单判 `msgIdSource === 'none'` 时的合成键。**已知并接受的两个代价**（spec §11.2）：
 * 1) 消息被编辑过 → 正文变 → 新键 → 库里多一行历史（旧的不会被撤回，本期不接撤回）；
 * 2) 同一秒内同正文的两条真消息 → 同键 → `uk_msg` 吃掉第二条。
 * 这两条不是 bug，是 DOM 路线上拿不到平台 id 时付的代价；写在这里是为了让读代码的人
 * 不必从"为什么没有 msgId"反推行为。
 */
export function synthTgMsgKey(input: { chatKey: string; epochSec: number; dir: 'in' | 'out'; body: string }): string {
  const digits = input.chatKey.replace(/-/g, '').replace(/\D/g, '') || '0'
  return `tg${digits}_${input.epochSec}_${input.dir}_${fnv1a(input.body)}`
}

/** `2026年9月20日` / `9月20日` / `September 20, 2026` / `昨天` 四类分组头。 */
export function parseTgTime(timeText: string | null, separatorText: string | null, nowSec: number): { t: number; precise: boolean } {
  const hm = /(\d{1,2})[:.](\d{2})/.exec(String(timeText ?? ''))
  if (!hm) return { t: nowSec, precise: false }                    // 钳制交给 §9 的接收时刻
  const day = dayFromSeparator(separatorText, nowSec)               // 'YYYY-MM-DD' | null
  if (!day) return { t: nowSec, precise: false }                   // 有钟点没日期 = 不可信，别造一个"今天"
  const [Y, M, D] = day.split('-').map(Number)
  const t = new Date(Y, M - 1, D, Number(hm[1]), Number(hm[2])).getTime() / 1000
  if (!Number.isFinite(t)) return { t: nowSec, precise: false }
  return { t: Math.floor(t), precise: true }
}

export function parseTgUnread(text: string | null): number {
  const m = /(\d+)/.exec(String(text ?? ''))
  if (!m) return 0
  return Math.min(Number(m[1]), 99)
}
```

`dayFromSeparator` 的实现按 Step 5 在真机上采到的分组头文本写死分支（**它的输入样例来自 `snapshots.md`，不许凭印象造**）：解析不出返回 `null`。

- [ ] **Step 3: `normalize.test.ts` 先写红（6 条）**

固定输入（`chatKey: '123456789'`、`src: 'hash'`、`msgIdSource: 'none'`），六条断言分别是：
1. 纯文本行 → `{ direction:'in', body:'hi', mediaType:'text', msgTime 精确 }`；
2. `outgoing` 命中 → `direction:'out'`，`senderKey` 为空；
3. 正文空、但有媒体容器 → `body:''`、`mediaType` 判成 `photo|video|document` 之一、`summary` 非空（**证明"没采到"与"采到但没正文"可区分**）；
4. `messageBody` 取不到节点 → 返回 `null`（这一行不落，别让一行装饰性 DOM 变成空消息）；
5. 群聊：行里有发送者名节点 → `senderKey` 是该名字的 FNV-1a、`sender_name` 是原文；
6. `msgKey` 长于 128 时**截断并保留哈希后缀**（与主进程 `MSG_KEY_MAX` 同一条约束，不靠后端 400 才被发现）。

- [ ] **Step 4: 实现 `normalize.ts` + `tgDom.ts`**

`normalize.ts` 吃 `TgRowSnapshot`（plain object，字段就是 `tgDom.ts` 从节点上取出来的文本与标志位），按 §11.2 出 `NormalizedMessage`。`tgDom.ts` 是**唯一**碰 `document` 的 TG 文件，整体只有三个导出函数，每个都只做"按 `TG_DOM` 取节点、把字段抄成 plain object"：

```ts
// apps/desktop/src/bridge/telegram/tgDom.ts（骨架，字段按清单取全）
import { TG_DOM } from '../../shared/tgDomContract.ts'
import { chatKeyFromHash, parseTgUnread } from './tgParse.ts'

export interface TgRowSnapshot {
  chatKey: string
  msgKey: string | null        // 清单判 attr 时取属性；none 时留 null，交给 normalize 合成
  domIdAttr?: string
  timeText: string | null
  separatorText: string | null
  bodyText: string | null
  senderText: string | null
  outgoing: boolean
  mediaKind: 'photo' | 'video' | 'document' | null
}
```

`collect.ts` 的四入口（与 WhatsApp 同名同形，`COLLECT` 表按 `platform` 查表，Task 11 已留好结构）：

```ts
  /** 实时：只观察 `TG_DOM.messageList` 这一棵子树的新增/变更行，同一批 mutation 里的同一行按 msgKey 去重。 */
  export function startLiveCollect(ctx: CollectCtx): () => void {
    const root = document.querySelector(TG_DOM.messageList)
    if (!root) return () => {}                     // 未登录/未打开会话：只挂不调（spec §11.2）
    const seen = new Set<string>()
    const mo = new MutationObserver(() => {
      const now = Math.floor(Date.now() / 1000)
      for (const row of readMessageRows(currentChatKey())) {
        const n = normalizeTg(row, { nowSec: now })
        if (!n || seen.has(n.msgKey)) continue
        seen.add(n.msgKey)
        ctx.emit({ kind: 'message', ...n })
      }
    })
    mo.observe(root, { childList: true, subtree: true, characterData: true })
    return () => mo.disconnect()
  }
```

`runBackfill(limit, ctx)`：当前会话滚到顶（`scrollMessageListToTop({ steps: 20, ms: 250 })`）分步采，采满 `limit` 或到顶即停；`reachedTop === false` 时 `ctx.emit({ kind: 'backfill_gap', chatKey, reason: 'not-top' })`。**列表若虚拟化，"滚到顶"是唯一的补底手段**，所以这条必须真跑一次 A 档才能知道它有没有把行数堆到 `limit`（Step 6 的第 3 行断言）。

- [ ] **Step 5: 登记进桥、放开挂载闸门**

`bridge/index.ts` 的 `COLLECT` 表加 `telegram: { startLiveCollect, watchActiveChat, reportActiveChat, runBackfill }`；`main/services/msgBridge/index.ts` 的平台闸门从 `whatsapp`-only 放开到 `whatsapp | telegram`（Task 10 Step 里那条注释就是给这一步留的：telegram 进闸门必须与"有 collect 实现"同批落地，否则挂一条永远采不到的空桥）。`reportActiveChat` / `watchActiveChat` 在 TG 侧都只干一件事：把 `chatKeyFromHash(location.hash)` 报成 `active_chat`，主进程据此算未读。

- [ ] **Step 6: fixture 页 `apps/desktop/test/tg-fixture.html`（原料必须是快照，不是记忆）**

做法：把 `tg-probe/manifest.json` 采样里那 2～3 个真实节点的 `outerHTML` **原样**贴进 fixture（正文换成 `A1`/`B2` 这种可断言的短串，class 与嵌套一个字符都不改），再加上一个"脚本化时间线"小面板：`window.__scrmTgFixture.openChat(id)`（改 `location.hash` + 换 messageList 内容）、`.pushIn(n)`、`.pushOut(text)`、`.addDateSeparator(text)`。**结构照抄的价值**就在这：12c 的代码只认清单，fixture 只要类名一致就能替真页面作证；反过来，如果 fixture 是手写的，这条绿灯什么也不证明。

fixture 不进构建产物（`build-bridge.mjs` 的 entryPoints 只有 `src/bridge/index.ts`，`test/` 也不在 electron-builder 的 files 里）。

- [ ] **Step 7: `tmp/p6-tg-fixture.mjs` A 档整链（第 0～9 行）**

| # | 动作 | 断言（必须能区分"生效/没动"） |
|---|---|---|
| 0 | 打开 fixture 并挂桥 | `ready` 握手回 `bridgeVersion`；`chat_message` 里 `platform='telegram'` 行数 = 起点值 |
| 1 | `openChat('123456789')` + 预置 3 行 in | 补底后行数 +3，`msg_key` 集合与页内 `data-scrm-key` 一致 |
| 2 | 同一批再灌一次（同一组行） | 行数不变、`duplicated` 计数 >0 —— **证明 `uk_msg` 生效**而不是"第二次没跑" |
| 3 | `pushIn()` 一条新消息 | 2s 内行数 +1（live 通道），且 `chat_conversation.unread_count` 在**非活动会话**下 +1、活动会话下 +0 |
| 4 | `addDateSeparator('2026年9月20日 星期日')` + 一行 `14:03` | 该行 `msg_time` 落在 2026-09-20 14:03 的 ±60s 内（时间解析生效；不精确时钳制到接收时刻会让这条红） |
| 5 | 一行只有媒体、无正文 | 该行 `media_type != 'text'`、`body` 为空、`summary` 非空 |
| 6 | 打开一个 `-1001234567890` 群会话并采一条 | 会话出现且 `is_group=1`（**群与频道不跳过上报**），`platform` 仍是 telegram |
| 7 | 该会话对端已在 `customer` 里且 `open_id='123456789'` | 入库后 `customer_id` 被填上（自动匹配对 TG 命中，前提见 Step 8 的 V9） |
| 8 | 滚到底仍取不到顶部（fixture 里把 `scrollMessageListToTop` 的 steps 设 0） | 报出一条 `backfill_gap`（只进主进程日志，不含正文） |
| 9 | 清单判 `msgIdSource:'none'` 时，同秒同正文造两行 | 库里只有 1 行 —— **把 §11.2 那条代价变成断言而不是文档** |

第 0～9 行全绿才允许写"A 档绿"。B 档另跑：把 fixture 的 URL 换成 `/k/` 真页面，第 1、3、6 行各出一条真机证据（行数、`msg_key` 差集、群会话出现），其余如实未验证。

- [ ] **Step 8: 后端那侧的形态收敛（条件产物）**

**仅当** `TG_DOM.chatIdSource !== 'none'`（会话 id 是真数字串）时才写 `V9__tg_openid_shape.sql`，把 V3 里 `platform_type=4` 那两条种子的 `open_id` 改成 `chat_key` 同形的纯数字串（群含负号），并同步改 `ChatKeys.java` 的类注释。判据、SQL 与"改完前后各查一次"的口径沿用旧版正文，一字未增：

```bash
# 改前：过 :8180 查两条 TG 客户的 open_id（C7：不走 mysql CLI）
node tmp/p6t-openid.mjs     # GET /api/customers?platformType=4，打印 id/open_id
# 跑 V9：重启后端让 Flyway 应用，再查一次
node tmp/p6t-openid.mjs
```

两次输出必须不同，且第二次是纯数字串——**这一条就是"V9 生效了 vs 没动"的区分**（`tmp/p6t-openid.mjs` 由 `tmp/p11-*.mjs` 那批现成驱动改 20 行，不入库）。若 Step 6 的 fixture 或真机探针任一没过，跳过本步并在报告里写"TG open_id 形态未收敛，Task 19 的 TG 自动匹配档不成立"。

- [ ] **Step 9: 回归 + 提交**

`pnpm --dir apps/desktop run typecheck && pnpm --dir apps/desktop run test:unit`（闸门 +14）、`./mvnw -o -pl apps/server test`（V9 那档若跑了）；A 档 0～9 行全绿。C4：fixture 只打本地库，`chat_*` 行数打印前后差，DEMO 种子不动。

```bash
git add apps/desktop/src/bridge apps/desktop/src/main/services/msgBridge apps/desktop/test \
  docs/superpowers/plans/2026-09-20-chat-history.md
git commit -m "feat(P6): Telegram 采集链按官方 K 版 DOM 契约落地"
```

（V9 若存在，一并 `git add apps/server/src/main/resources/db/migration/V9__tg_openid_shape.sql`。）

---

### Task 12d: Telegram 发送链（切会话 → 写框 → 点发送 → 认领 `out` 行）

**Goal：** 让记录页的应用内回复在 TG 账号上真发出去，并把"发出去"这件事结清成 `sent`。DOM 路线没有 `localId`，结清靠认领（spec §11.3），这一步的全部难点都在认领上。

**Files:**
- Move: `classify()` 从 `apps/desktop/src/bridge/whatsapp/send.ts` 移到 `apps/desktop/src/bridge/sharedSend.ts`（两平台共用，WhatsApp 调用点改 import；旧版 Task 12d Step 1 的同一条安排沿用）
- Create: `apps/desktop/src/bridge/telegram/claim.ts` + `claim.test.ts`（6 条，纯函数）
- Create: `apps/desktop/src/bridge/telegram/send.ts`
- Modify: `apps/desktop/src/bridge/index.ts`（`SEND` 表加 telegram 一项）
- Modify: `apps/desktop/test/tg-fixture.html`（加 `.pushOut(text)` 与发送按钮的点击响应）
- Modify: `tmp/p6-tg-fixture.mjs`（第 10～14 行）

**Interfaces:**
- Consumes: Task 12 的 `SendRegistry`（主进程那侧不改语义）、Task 12 的 `msg:send` 通道与回执形状 `{ localId, ok, msgKey?, error? }`、Task 12a 的 `TG_DOM`、Task 12c 的 `readMessageRows` / `normalizeTg`
- Produces: `claimPending(input: ClaimInput): ClaimResult`（纯函数）、`telegram/send.ts` 的 `sendTextMessage({ chatKey, text, localId })` → `SendResult`

- [ ] **Step 1: 把 `classify` 挪到两平台共用**

纯搬运 + 改 import，行为一字不改（放最前面是为了让 Step 2 的红是"认领逻辑红"，不是"找不到函数"）。跑一遍闸门确认条数不变、全绿。

- [ ] **Step 2: `claim.test.ts` 先写红（6 条）**

1. 目标会话里出现一条正文完全相同、时间 ≥ 提交时刻的 `out` 行 → 认领成功，返回它的 `msgKey`；
2. 正文不同 → 不认领（返回 `pending`，让主进程按 TIMEOUT 收，而不是乱点别的 pending）；
3. 只有 `in` 行相同正文（对端回了一句一模一样的）→ **不认领**（方向的这一条断言就是"结果分类没写反"的证据）；
4. 同会话连发同一条文本两次 → 按提交 FIFO：第一个候选行归第一个 pending，第二个归第二个；两次认领的 `msgKey` 不同；
5. 一行被认领后再来一次观察 → 不重复认领（`claimed` 集合生效）；
6. 目标会话不是当前活动会话（hash 里是别的 id）→ 立即返回 `wrong_chat`，**不消费候选行**（发送侧据此报 `CHAT_NOT_FOUND`）。

- [ ] **Step 3: 实现 `claim.ts`**

```ts
// apps/desktop/src/bridge/telegram/claim.ts
export interface ClaimCandidate { msgKey: string; body: string; dir: 'in' | 'out'; t: number }
export interface ClaimPending { localId: string; chatKey: string; body: string; submittedAtSec: number }
export interface ClaimInput { chatKey: string; candidates: ClaimCandidate[]; pendings: ClaimPending[]; claimed: Set<string> }
export type ClaimResult = { kind: 'claimed'; localId: string; msgKey: string }[] | { kind: 'none' }

/**
 * DOM 路线没有 localId，"这条 out 是哪次发送"只能认：**同会话 + 正文完全相同 + 时间不早于提交 + 未被认领过**。
 * 已知代价（spec §11.3 第 3 条）：同会话连发同一条文本时靠提交 FIFO 排序，若对端也在同一时间窗内
 * 回了同文本的入向消息，方向判定（`dir === 'out'`）会把它挡住；但**同文本连发的两条本端消息**谁先落
 * DOM 不保证与提交顺序一致，认领就会串。认领不上或串了的都不静默：调用方要出一条
 * `send_attribution_ambiguous` 日志，宁可刷日志也不假装回执存在。
 */
export function claimPending(input: ClaimInput): ClaimResult { /* 按 Step 2 六条实现 */ }
```

- [ ] **Step 4: 实现 `send.ts`（三步 + 结清）**

1. `chatKeyFromHash(location.hash) !== chatKey` → 先点会话行（`readChatRows()` 里找 `chatKey` 匹配那行），等 hash 变化，最多 3 次 ×400ms；仍不等就返回 `CHAT_NOT_FOUND`，**不写框**（写进别人会话是比发不出去严重得多的错）。
2. `replaceEditorText(document.querySelector(TG_DOM.composerInput), text)`（复用 P5 已验证的 contenteditable 写入路径，含 `execCommand('insertText')`）；写不进或写完读回来不等于 `text` → `SEND_FAILED`（这条判据是 P5 那次"只写进首字母"教训的正面形态：写完必须回读比对）。
3. 真实点击 `document.querySelector(TG_DOM.sendButton)`（`InputEvent`/`click()` 合成事件在 K 版上会不会触发发送，属于 B 档观察项，A 档只证明"我们这侧按了按钮"）。
4. 点完立刻 `claimPending(...)` 一次，并在随后的 live 观察里再试（`collect.ts` 的 MutationObserver 之后串一段认领，认领成功就 `ctx.emit({ kind: 'send_receipt', localId, msgKey, status: 'sent' })`）；`watch` 上限 15s，超时按 `TIMEOUT` 结清（状态留 `pending`，与 WA 同口径）。

- [ ] **Step 5: A 档整链补发送段（`tmp/p6-tg-fixture.mjs` 第 10～14 行）**

| # | 动作 | 断言 |
|---|---|---|
| 10 | 对活动会话回复一条 | 页内出现 `out` 行 → 回执 `ok:true` 带 `msgKey`，库里那行 `status='sent'`、`app_send=1`、`customer_id` 命中 |
| 11 | 对**非**活动会话回复 | 先切会话（fixture 里 hash 变了）再发；若 fixture 造"切不过去"，回执 `CHAT_NOT_FOUND` 且库里 0 新行 |
| 12 | 同会话连发同一条文本两次 | 两条 pending 各拿一个不同 `msgKey`，库里两行 `app_send=1`（**证明 FIFO 认领没串**） |
| 13 | 造一条对端同文本的 `in` 行 + 本端无 `out` 行 | 两个 pending 都收 TIMEOUT，且库里 `status` 停在 `pending`（不被入向行误推进） |
| 14 | 认领不上时 | 主进程日志出现一行 `send_attribution_ambiguous`（不含正文） |

B 档另跑：真机 `/k/` 上自聊（TG 的"已保存的消息"）发一条，核对 `chat_message` 里 `platform='telegram'`、`app_send=1`、`status='sent'` 三件齐，然后**删掉这条测试消息**（C4，删除走页内 UI，不碰 API）。

- [ ] **Step 6: 回归 + 提交**

`pnpm --dir apps/desktop run typecheck && pnpm --dir apps/desktop run test:unit`（闸门 +6；累计 = Task 12c 终态 + 6，按 C14 不抄绝对数）、A 档第 0～14 行全绿、`git status` 干净。

```bash
git add apps/desktop/src/bridge apps/desktop/test tmp/p6-tg-fixture.mjs
git commit -m "feat(P6): Telegram 发送链与 DOM 认领结清回执"
```

---

## P6g — 渲染层：记录页


### Task 13: 数据层（VO 类型、Query hooks、live 尾巴并入缓存）

**Files:**
- Create: `apps/desktop/src/renderer/src/api/messages.ts`
- Modify: `apps/desktop/src/renderer/src/api/customers.ts`（+`CreateCustomerInput` 与 `useCreateCustomer`）
- Create: `apps/desktop/src/renderer/src/services/msgService.ts`
- Create: `apps/desktop/src/renderer/src/lib/liveTailSync.ts`
- Modify: `apps/desktop/src/renderer/src/layouts/AppLayout.tsx`（挂 `useLiveTailSync()`，与 `useTranslationSync()` / `useLoginStatusSync()` 并排）

**Interfaces:**
- Consumes: Task 4 的 VO 形状（字段名逐字对齐，包括 `MessageSearchVO.records`）、Task 5 的 `CustomerTimelineVO` 与 `POST /api/customers`、Task 7 的 `liveTail.ts`（`mergeTail` / `settlePending` / `pendingKey`）、Task 12 的 `window.scrm.msg`、既有 `http`（`@/lib/http`）、既有 `api/customers.ts` 的 `CustomerVO` 与 `useAuthStore`。
- Produces（Task 14–18 只认这些）：
  - VO：`ConversationVO`、`MessageVO`、`ConversationPageVO`、`MessagePageVO`、`MessageSearchVO`、`SearchHitVO`、`MessageStatsVO`、`DayCountVO`、`CustomerTimelineVO`
  - hooks：`useConversations(params)`、`useMessages(params)`、`useSearchMessages(params)`、`useMessageStats(accountId, days)`、`useMarkRead()`、`useLinkCustomer()`、`useCustomerTimeline(id, size)`
  - 来自 `api/customers.ts`（本任务补上）：`CreateCustomerInput`、`useCreateCustomer()` → `CustomerVO`
  - 行形状与拉平：`ThreadRow`（渲染层唯一的消息数组元素类型）、`rowOfMessage(m)`、`rowOfPending({ localId, accountId, chatKey, text })`、`flattenMessages(pages)`、`flattenConversations(pages)`、`flattenHits(pages)`、`flattenRows(pages)`
  - `queryKeys`（模块内导出的常量对象，liveTailSync 与页面都从这里取 key，避免字符串两份）
  - `msgService`：`{ isElectron, send, syncHistory, bridges, onLive, onState }`（浏览器降级同 `viewService` 写法）
  - `liveTailSync`：`useLiveTailSync(): void`、`useBridgeOf(accountId): BridgeState | null`（离线态禁用回复框）、`useThreadRows(accountId, chatKey, pages): ThreadRow[]`、`tailKey(accountId, chatKey)`、`rowOfLive(frame): ThreadRow`、`applyLiveFrame(qc, frame): FrameLanding`（`'row' | 'status' | 'dropped'`）、`settleLocalId(qc, { accountId, chatKey, localId, msgKey? }): void`。后三个导出是为了让 CDP 脚本能在控制台里单独喂一帧、喂一条回执验证。

- [ ] **Step 1: `api/messages.ts`——类型与 hooks**

类型必须与 Task 4 的 record 一一对应；`msgTime` / `lastMsgTime` 是 Jackson 序列化出来的本地墙钟串（收敛 9），渲染层一律 `dayjs(...).valueOf()` 参与排序。

```ts
// src/renderer/src/api/messages.ts
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/lib/http'
import type { Direction, MediaType, MsgSource, MsgStatus } from '@shared/chatTypes'
import type { ChatPlatform } from '@shared/chatPlatform'

export interface ConversationVO {
  id: number
  accountId: number
  platform: ChatPlatform
  chatKey: string
  title: string | null
  isGroup: boolean
  customerId: number | null
  lastMsgTime: string | null
  lastMsgBody: string | null
  unreadCount: number
}

export interface MessageVO {
  id: number
  accountId: number
  platform: ChatPlatform
  chatKey: string
  msgKey: string
  direction: Direction
  customerId: number | null
  senderKey: string | null
  senderName: string | null
  body: string | null
  mediaType: MediaType
  mediaSummary: string | null
  msgTime: string
  status: MsgStatus
  source: MsgSource
  sendLocalId: string | null
}

export interface ConversationPageVO { records: ConversationVO[]; nextCursor: string | null; hasMore: boolean }
export interface MessagePageVO { records: MessageVO[]; nextCursor: string | null; hasMore: boolean }
export interface SearchHitVO { message: MessageVO; conversationId: number | null; chatTitle: string | null }
export interface MessageSearchVO { records: SearchHitVO[]; nextCursor: string | null; hasMore: boolean }
export interface DayCountVO { day: string; inCount: number; outCount: number }
export interface MessageStatsVO {
  total: number
  inCount: number
  outCount: number
  activeConversations: number
  perDay: DayCountVO[]
}
export interface CustomerTimelineVO {
  messages: MessageVO[]
  conversations: ConversationVO[]
  messageCount: number
  conversationCount: number
}

export interface ConversationQuery {
  accountId: number | null
  platform?: ChatPlatform | null
  q?: string
  size?: number
}

export interface MessageQuery {
  accountId: number | null
  chatKey: string | null
  /** 上滑翻页：上一页的 nextCursor。首屏不传。 */
  before?: string | null
  /**
   * 锚点：把首屏窗口定位到这条消息上（它成为窗口最后一条）。只传库里的行 id，
   * 游标串由后端算——见 Task 4 `aroundPos` 的注释，客户端拼 epoch 会踩时区。
   * 传了它之后，第二页起仍然走 nextCursor（Task 16 的搜索跳转依赖这个组合）。
   */
  around?: number | null
  size?: number
}

export interface SearchQuery {
  q: string
  platform?: ChatPlatform | null
  accountId?: number | null
  direction?: Direction | null
  from?: string | null
  to?: string | null
  customerId?: number | null
  size?: number
}

/** 一处定义、三处消费（hooks / liveTailSync / 失效目标），字符串不重复。 */
export const queryKeys = {
  conversations: (p: ConversationQuery) => ['msg', 'conversations', p] as const,
  messages: (p: MessageQuery) => ['msg', 'messages', p] as const,
  search: (p: SearchQuery, cursor: string | null) => ['msg', 'search', p, cursor] as const,
  stats: (accountId: number | null, days: number) => ['msg', 'stats', accountId, days] as const,
  timeline: (id: number | null, size: number) => ['msg', 'timeline', id, size] as const,
  bridges: ['msg', 'bridges'] as const,
  /** 失效用的前缀：新消息会让整张列表与所有天数的统计同时过期，逐个 days 点名会漏。 */
  conversationsRoot: ['msg', 'conversations'] as const,
  statsRoot: ['msg', 'stats'] as const
}

const qs = (input: Record<string, unknown>): string => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || v === null || v === '') continue
    p.set(k, String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

export function useConversations(p: ConversationQuery) {
  return useInfiniteQuery({
    queryKey: queryKeys.conversations(p),
    enabled: p.accountId !== null,
    initialPageParam: null as string | null,
    // 游标分页只能 infinite：offset 型翻页在采集与补底同时发生时会让同一条会话出现在两页里。
    queryFn: ({ pageParam }) =>
      http.get<ConversationPageVO>(`/api/conversations${qs({ ...p, cursor: pageParam })}`),
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined)
  })
}

export function useMessages(p: MessageQuery) {
  return useInfiniteQuery({
    queryKey: queryKeys.messages(p),
    enabled: p.accountId !== null && !!p.chatKey,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, pageIndex }) =>
      http.get<MessagePageVO>(
        `/api/messages${qs({
          ...p,
          before: pageParam ?? p.before ?? null,
          // around 只作用于首屏：第二页起 pageParam 就是后端给的 nextCursor，此时还必须带上
          // around 会让每次续翻都被拽回锚点窗口，往上翻不动。qs() 会丢掉 null，所以这里显式覆盖。
          around: pageIndex === 0 ? (p.around ?? null) : null
        })}`
      ),
    // 后端 records 已经是正序（Task 4），页与页之间才是倒序：拼整体时整组 pages 要反序。
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined)
  })
}

export function useSearchMessages(p: SearchQuery) {
  return useInfiniteQuery({
    queryKey: queryKeys.search(p, null),
    enabled: p.q.trim().length >= 2,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      http.get<MessageSearchVO>(`/api/messages/search${qs({ ...p, cursor: pageParam })}`),
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined)
  })
}

export function useMessageStats(accountId: number | null, days: 7 | 30) {
  return useQuery({
    queryKey: queryKeys.stats(accountId, days),
    enabled: accountId !== null,
    queryFn: () => http.get<MessageStatsVO>(`/api/messages/stats${qs({ accountId, days })}`),
    refetchOnWindowFocus: false
  })
}

export function useCustomerTimeline(id: number | null, size = 20) {
  return useQuery({
    queryKey: queryKeys.timeline(id, size),
    enabled: id !== null,
    queryFn: () => http.get<CustomerTimelineVO>(`/api/customers/${id}/timeline${qs({ size })}`)
  })
}

export function useMarkRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (conversationId: number) =>
      http.post<{ cleared: number }>(`/api/conversations/${conversationId}/read`),
    onSuccess: (_data, conversationId) => {
      // 本地就把角标抹掉：等 refetch 会慢一拍，用户已经在看这个会话了。
      qc.setQueriesData<{ pages: ConversationPageVO[] }>({ queryKey: queryKeys.conversationsRoot }, (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                records: page.records.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c))
              }))
            }
          : data
      )
    }
  })
}

/** 「建为客户」的第一步在 `api/customers.ts`（Step 1b）：那里已经有改删查三份 hooks，创建是第四份。 */
export function useLinkCustomer() {
  return useMutation({
    mutationFn: (input: { conversationId: number; customerId: number }) =>
      http.post<{ conversationId: number; customerId: number; messagesLinked: number }>(
        `/api/conversations/${input.conversationId}/link-customer`,
        { customerId: input.customerId }
      )
  })
}

/** 拉平成"整体时间正序"的一维数组：pages[0] 是最新页，所以整组要反着接。 */
export function flattenMessages(pages: MessagePageVO[] | undefined): MessageVO[] {
  if (!pages) return []
  return [...pages].reverse().flatMap((page) => page.records)
}

export function flattenConversations(pages: ConversationPageVO[] | undefined): ConversationVO[] {
  if (!pages) return []
  return pages.flatMap((page) => page.records)
}

export function flattenHits(pages: MessageSearchVO[] | undefined): SearchHitVO[] {
  if (!pages) return []
  return pages.flatMap((page) => page.records)
}
```

**行形状（渲染层唯一的消息数组类型）**——库行、live 行、乐观气泡三种来源都要能进同一个 `mergeTail`，所以在这里定一次：

```ts
// src/renderer/src/api/messages.ts —— 续
import dayjs from 'dayjs'
import { pendingKey, type TailRow } from '@shared/liveTail'

export interface ThreadRow extends TailRow {
  /** 乐观气泡还没入库，用 0 表示"无库内 id"：key 用 msgKey，不用它。 */
  id: number
  accountId: number
  chatKey: string
  direction: Direction
  status: MsgStatus
  source: MsgSource
  body: string | null
  mediaType: MediaType
  mediaSummary: string | null
  senderKey: string | null
  senderName: string | null
  customerId: number | null
  sendLocalId: string | null
}

/** `msgTime` 是后端给的本地墙钟串（收敛 9），dayjs 直接解析即为浏览器的同一时刻。 */
export function rowOfMessage(m: MessageVO): ThreadRow {
  return { ...m, ts: dayjs(m.msgTime).valueOf() }
}

/** 乐观气泡：localId 派生出临时键，回执或 live 帧到达后由 `settlePending` 换成真实 msgKey。 */
export function rowOfPending(input: {
  localId: string
  accountId: number
  chatKey: string
  text: string
}): ThreadRow {
  return {
    msgKey: pendingKey(input.localId),
    ts: Date.now(),
    id: 0,
    accountId: input.accountId,
    chatKey: input.chatKey,
    direction: 'out',
    status: 'pending',
    source: 'app_send',
    body: input.text,
    mediaType: 'text',
    mediaSummary: null,
    senderKey: null,
    senderName: null,
    customerId: null,
    sendLocalId: input.localId
  }
}

/** 库页 → 渲染行：`useThreadRows` 与记录页共用这一条转换，不在页面里再 map 一次。 */
export function flattenRows(pages: MessagePageVO[] | undefined): ThreadRow[] {
  return flattenMessages(pages).map(rowOfMessage)
}
```

> `ThreadRow` 放在 `api/messages.ts` 而不是页面组件里：`liveTailSync`（写尾巴）、记录页（读两路）、客户抽屉时间线（复用气泡）三处都要这个形状，任何一处自己定义都会变成第四处。

- [ ] **Step 1b: `api/customers.ts` 补上「创建」这一份 mutation**

既有文件里只有 `useCustomers` / `useCustomer` / `useUpdateCustomer` / `useSetCustomerLabels` / `useDeleteCustomer`——改删查都有，创建是 Task 5 后端新开的端点，补在同一个文件里跟其余四份并排：

```ts
// src/renderer/src/api/customers.ts —— 追加在 useUpdateCustomer 之前
export interface CreateCustomerInput {
  platformType: number
  openId: string
  nickname?: string | null
  phone?: string | null
  email?: string | null
  country?: string | null
  remark?: string | null
  sex?: number
}

/** 字段与 Task 5 的 `CustomerCreateRequest` 逐字一致；`openId` 就是会话的 `chat_key`（收敛 4）。 */
export function useCreateCustomer() {
  return useMutation({ mutationFn: (input: CreateCustomerInput) => http.post<CustomerVO>('/api/customers', input) })
}
```

失效不在这里做：`useCreateCustomer` 的下一步一定是 link-customer（Task 17 的闭环里两步连着走），列表刷新由调用方在 link 成功后统一触发，避免"创建成功但没关联"时客户列表里多出一个陌生人。

> 为什么不在 `api/messages.ts` 里再声明一个"最小形状"的 `CustomerVO`：`api/customers.ts` 已经有一份和后端 `web/vo/CustomerVO.java` 对齐的完整版（含 `labels`），第二份窄声明只会让"哪个字段真的存在"变成两处口径。TS 的结构类型让完整值赋给窄类型没问题，但读代码的人会被误导。

- [ ] **Step 2: `services/msgService.ts`——`window.scrm.msg` 的浏览器降级**

照 `services/viewService.ts` 的既有写法（`NonNullable<Window['scrm']>['msg']` + fallback + `isElectron`），差别只在 live 订阅要能"没有主进程也不报错"：

```ts
// src/renderer/src/services/msgService.ts
import type { BridgeState, SendReceipt, SendRequest } from '@shared/chatTypes'

type MsgApi = NonNullable<Window['scrm']>['msg']

const noVal = <T>(v: T): (() => Promise<T>) => () => Promise.resolve(v)

/** 浏览器里没有内嵌视图：发送一律 BRIDGE_OFFLINE，比抛错更容易让 UI 保持离线态。 */
const fallback: MsgApi = {
  send: (req: SendRequest) =>
    Promise.resolve<SendReceipt>({ localId: req.localId, ok: false, error: 'BRIDGE_OFFLINE', detail: '浏览器模式无消息桥' }),
  syncHistory: noVal(false),
  bridges: noVal<BridgeState[]>([]),
  onLive: () => () => {},
  onState: () => () => {}
}

export const isElectron = typeof window !== 'undefined' && !!window.scrm

export const msgService: MsgApi & { isElectron: boolean } = {
  ...(window.scrm?.msg ?? fallback),
  isElectron
}
```

`MsgApi` 是从 `preload/index.d.ts` 的 `ScrmApi = typeof scrm` 推出来的：Task 12 给 preload 加了 `msg`，这里就自动有类型，不需要再手写一份接口。好处是 `fallback` 上没有 `as MsgApi` 断言——将来 `msg` 多一个成员，这一份降级实现会立刻报缺字段，逼着浏览器模式同步补齐（漏掉的后果是浏览器里点一下发送就 `is not a function`）。

- [ ] **Step 3: `lib/liveTailSync.ts`——把主进程广播并进 Query 缓存**

这是记录页"双源取数"的另一半：历史读库，尾巴吃广播。合并的三条规则在 `@shared/liveTail`（Task 7 已单测），本文件只做"帧 → 缓存"的搬运，加两个帧形状带来的特例（ack 只并状态、列表失效合流）。

```ts
// src/renderer/src/lib/liveTailSync.ts
import { useEffect } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { msgService } from '@/services/msgService'
import { flattenRows, queryKeys, type MessagePageVO, type ThreadRow } from '@/api/messages'
import { mergeTail, pendingKey, settlePending } from '@shared/liveTail'
import type { BridgeState, LiveFrame, MsgStatus } from '@shared/chatTypes'

/**
 * 一帧 live 的落点，也是 Step 5 要断言的返回值：
 * - `row`：并进了所属会话的尾巴（新消息，补底帧也算）
 * - `status`：只推进了已有行的状态（ack 帧）
 * - `dropped`：ack 找不到对应行——那条消息只存在于库页里，本会话尾巴没这份
 */
export type FrameLanding = 'row' | 'status' | 'dropped'

/** 尾巴缓存 key：一条会话一份，与库页那条 infinite query 分开存（理由见本步末尾）。 */
export const tailKey = (accountId: number, chatKey: string) =>
  ['msg', 'tail', accountId, chatKey] as const

/**
 * live 帧 → 行。字段名与 `ThreadRow` 逐一对齐，`mergeTail` 覆盖时是逐字段替换。
 * `id: 0` / `customerId: null` 是"帧里没有这个信息"的占位，不是数据库值——
 * 同键相遇时以库行为准，由 `useThreadRows` 换回真值，否则客户徽标会被盖没。
 * `ts`：帧只带平台秒值（收敛 9 由后端换成本地墙钟），这里乘 1000 只为排序，不参与展示。
 */
export function rowOfLive(frame: LiveFrame): ThreadRow {
  const m = frame.message
  return {
    msgKey: m.msgKey,
    ts: m.msgTimeEpochSec * 1000,
    id: 0,
    accountId: frame.accountId,
    chatKey: m.chatKey,
    direction: m.direction,
    status: m.status,
    source: m.source,
    body: m.body ?? null,
    mediaType: m.mediaType,
    mediaSummary: m.mediaSummary ?? null,
    senderKey: m.senderKey ?? null,
    senderName: m.senderName ?? null,
    customerId: null,
    sendLocalId: m.sendLocalId ?? null
  }
}

/** ack 帧专用：只把 `status` 并到已有行上。 */
function mergeStatus(rows: readonly ThreadRow[], msgKey: string, status: MsgStatus): ThreadRow[] {
  const at = rows.findIndex((r) => r.msgKey === msgKey)
  if (at < 0) return [...rows]
  const out = [...rows]
  out[at] = { ...out[at], status }
  return out
}

/**
 * 列表与统计的失效做 1s 合流。补底一次能推上百帧（Task 10 的 `message` 上报不分实时与补底），
 * 逐帧 invalidate 会把会话列表打成 refetch 风暴；尾巴本身是 setQueryData，不产生请求，无需合流。
 */
const LIST_INVALIDATE_MS = 1000
let listInvalidation: ReturnType<typeof setTimeout> | null = null

function scheduleListInvalidation(qc: QueryClient): void {
  if (listInvalidation) return
  listInvalidation = setTimeout(() => {
    listInvalidation = null
    void qc.invalidateQueries({ queryKey: queryKeys.conversationsRoot })
    void qc.invalidateQueries({ queryKey: queryKeys.statsRoot })
  }, LIST_INVALIDATE_MS)
}

/**
 * 帧 → 缓存。不分"当前会话 / 其它会话"：尾巴按 `tailKey` 各存一份，
 * 切会话时读自己那份，所以从别处切回来也不会丢下刚到的那几条
 * （采集是 500/2s 批量落库，此刻库页里还没有它们）。
 */
export function applyLiveFrame(qc: QueryClient, frame: LiveFrame): FrameLanding {
  const { accountId } = frame
  const { chatKey, msgKey, status } = frame.message
  const key = tailKey(accountId, chatKey)
  const tail = qc.getQueryData<ThreadRow[]>(key) ?? []

  // ack 帧的时间戳恒为 0（Task 11 Step 6）：它只推进状态，没有行可插。
  // 不能走 mergeTail——那一帧是主进程造的合成行（body 缺省、mediaType 'text'），
  // 逐字段覆盖会把库里已有的正文抹成 null。
  if (frame.message.msgTimeEpochSec === 0) {
    if (!tail.some((r) => r.msgKey === msgKey)) return 'dropped'
    qc.setQueryData(key, mergeStatus(tail, msgKey, status))
    return 'status'
  }

  qc.setQueryData(key, mergeTail(tail, [rowOfLive(frame)]))
  scheduleListInvalidation(qc)
  return 'row'
}

/**
 * 发送链的回执：乐观气泡换成真实 msgKey。与随后 `msg:live` 的那一帧是同一行——
 * `settlePending` 原地换键，live 帧再按同 msgKey 命中覆盖，不会长出第二行。
 */
export function settleLocalId(
  qc: QueryClient,
  input: { accountId: number; chatKey: string; localId: string; msgKey?: string }
): void {
  const key = tailKey(input.accountId, input.chatKey)
  const tail = qc.getQueryData<ThreadRow[]>(key) ?? []
  qc.setQueryData(
    key,
    // 成功只换键、不改状态：回执只证明平台当场收下了这条，推进阶梯是 ack 的事
    //（把 pending 直接写成 sent，失败的消息也会一路绿到底）。
    // 失败则必须留在窗口里：键保持 `~localId`，只翻状态，让人看得见并能重试。
    input.msgKey
      ? settlePending(tail, input.localId, input.msgKey)
      : settlePending(tail, input.localId, pendingKey(input.localId), { status: 'failed' })
  )
}

/**
 * 全局只挂一次（AppLayout）。桥状态同样进缓存：回复框的禁用态要知道桥在不在（spec §8 离线态）。
 */
export function useLiveTailSync(): void {
  const qc = useQueryClient()
  useEffect(() => {
    const offLive = msgService.onLive((frame) => applyLiveFrame(qc, frame))
    const offState = msgService.onState((states) => qc.setQueryData<BridgeState[]>(queryKeys.bridges, states))
    // 首帧不等广播：切到记录页时桥可能早就 ready 了，而 `msg:state` 是事件不是状态。
    void msgService.bridges().then((states) => qc.setQueryData(queryKeys.bridges, states))
    return () => {
      offLive()
      offState()
    }
  }, [qc])
}

/** 回复框与离线提示的数据源：桥不在 ready 就别让人敲字。写入方只有 useLiveTailSync 一处。 */
export function useBridgeOf(accountId: number | null): BridgeState | null {
  const { data } = useQuery({
    queryKey: queryKeys.bridges,
    queryFn: msgService.bridges,
    initialData: [] as BridgeState[],
    staleTime: Infinity,
    enabled: accountId !== null
  })
  if (accountId === null) return null
  return data.find((s) => s.accountId === accountId && s.ready) ?? null
}

/**
 * 记录页把"库页 + 尾巴"合成一份渲染数组：两条来源只在 msgKey 与 ts 上相遇。
 * 合并方向不能反：`mergeTail(库页, 尾巴)` 让比窗口头更旧的补底帧被规则 2 丢掉
 * （它们本来就在库里，上滑翻页才拿得到）；反过来以尾巴为底会把整页历史当"旧行"扔光。
 */
export function useThreadRows(
  accountId: number | null,
  chatKey: string | null,
  pages: MessagePageVO[] | undefined
): ThreadRow[] {
  const db = flattenRows(pages)
  const key = tailKey(accountId ?? -1, chatKey ?? '')
  const raw =
    useQuery({
      queryKey: key,
      queryFn: () => [] as ThreadRow[],
      enabled: false,
      initialData: [] as ThreadRow[]
    }).state.data ?? []
  // live 帧不知道库内自增 id，也不知道后端匹配到的客户；同键相遇时以库行为准。
  const tail = raw.map((r) => {
    const known = db.find((d) => d.msgKey === r.msgKey)
    return known ? { ...r, id: known.id, customerId: known.customerId } : r
  })
  return mergeTail(db, tail)
}
```

> `useThreadRows` 里那个 `useQuery({ enabled: false, queryFn: () => [] })` 是**读缓存的最小写法**：TanStack 没有"只订阅缓存不发起请求"的 hook，`enabled:false` + `initialData:[]` 正好是它。`queryFn` 永远不会被调用，所以返回值写成空数组没有语义。
>
> 尾巴为什么要按 `tailKey` 单独存一条缓存，而不是直接改写 `queryKeys.messages`：infinite query 的数据是 `pages[]`，改写它要在 `setQueryData` 里重建整个 `pages` 结构，而 live 帧到的时机可能与正在进行的翻页请求交错（请求回来会整体覆盖尾巴）。分开存之后，翻页覆盖的是"库页"，尾巴独立存活，渲染时合成——这也是 `mergeTail` 规则 2（丢弃比窗口头更旧的行）能简单成立的前提。
>
> 切会话不清尾巴：尾巴按会话各存一份，`-1`/`''` 只是"还没选中会话"时的占位键。会话切回来时读到同一份尾巴，而库页里那时可能还没有刚到的那几条（采集是 500/2s 批量落库）；未挂载的尾巴条目由 TanStack 的 `gcTime` 自然回收，不需要手写清理。
>
> 三条合并语义本身（同键覆盖 / 丢旧行 / 升序）在 Task 7 的 `liveTail.test.ts` 里已经是纯函数单测；本任务新增的是"帧 → 缓存"的搬运与两个特例（ack 只并状态、同键行的 id/customerId 以库为准），它们在浏览器里才看得见，所以 Step 5 用 CDP 断言而不是再加单测。

- [ ] **Step 4: 挂进 `AppLayout`**

`layouts/AppLayout.tsx` 里与既有两条同步 hook 并排：

```ts
import { useLiveTailSync } from '@/lib/liveTailSync'
...
  useTranslationSync()
  useLoginStatusSync()
  useLiveTailSync()
```

> 放在布局层而不是记录页里：`msg:live` 是广播，切走路由时如果取消订阅，回到记录页之前那段时间的尾巴就永久丢了（历史页能翻到，但未读与会话头要靠它）。

- [ ] **Step 5: 验证——双源取数与降级**

```bash
cd apps/desktop && pnpm run typecheck && pnpm run test:unit 2>&1 | tail -5
```

预期：typecheck 全绿（node / web / inject / unit 四个 tsconfig）、`# pass 43` 不变（合并语义的单测在 Task 7，本任务没有新的纯函数）。

`tmp/p6f-tail.mjs`（Node，打 8180 + 读 dev 终端）与 CDP 各跑一半。**后端与真实登录态拿不到时按 C11 标 blocked，不许用自造数据代替断言**：

| # | 操作 | 期望 |
|---|---|---|
| 1 | `curl` 五个 GET（conversations / messages / search / stats / timeline）逐字段核对 TS 接口 | 字段名与可空性一致；`records/nextCursor/hasMore` 三份分页 VO 同形（搜索结果字段是 `records` 不是 `hits`） |
| 2 | `GET /api/messages?size=3` 连取三页（带 `before`） | 三页 `id` 集合互不相交、整体按 `msgTime` 正序拼接后无乱序（`flattenMessages` 的反序拼接因此成立） |
| 3 | 记录页打开会话 A，另设备给 A 发一条 | 不点任何按钮就出现该条，且 `applyLiveFrame` 返回 `'row'`（CDP 里 `window.__p6f.landing` 打点） |
| 4 | 会话列表停在 A，给**另一个**会话 B 发消息 | 返回 `'row'` 且落进 `tailKey(B)`，A 的尾巴长度不变（区分"并进错的会话"）；切到 B 立刻看得到那条，不用等库页 refetch |
| 5 | ack 帧（`msgTimeEpochSec === 0`）到达 | 已有行 `status` 变化，行数、正文与首行时间全不变（`mergeStatus` 生效；正文变空 = 走了 mergeTail，判失败；行数 +1 = 把 ack 当新行，判失败） |
| 6 | 发送一条自聊消息后回执到达（`settleLocalId`） | 乐观气泡的 `~localId` 换成真 msgKey 且状态仍是 `pending`（换键就顺手写 sent = 把"平台收下"当成"已送达"，判失败）；随后到的同 msgKey live 帧并成一行，`id`/`customerId` 由库行补回（`mergeTail` 的 `Math.max(ts)` 让 ack 帧的 0 不污染行首） |
| 7 | 浏览器模式（`vite` 直开，无 `window.scrm`） | 页面渲染、`msgService.send` 返回 `BRIDGE_OFFLINE`、回复框禁用文案出现；控制台无未捕获异常 |
| 8 | 桥未 ready（未登录视图） | `useBridgeOf(accountId)` 返回 `null`，回复框 disabled（离线态：列表仍读得到库，spec §8） |

第 3、4、5、6 四条合起来才是"双源取数"的完整证据：只有 3 无法区分"并进缓存"与"整页 refetch 恰好带回来"；4 排除串会话，5 排除把 ack 当新行、把正文抹平，6 排除乐观气泡与真实行并存。

- [ ] **Step 6: 提交**

```bash
git add apps/desktop/src/renderer/src/api/messages.ts apps/desktop/src/renderer/src/api/customers.ts apps/desktop/src/renderer/src/services/msgService.ts apps/desktop/src/renderer/src/lib/liveTailSync.ts apps/desktop/src/renderer/src/layouts/AppLayout.tsx
git commit -m "feat(P6): 记录页数据层与 live 尾巴并入 Query 缓存"
```

---

### Task 14: 记录页骨架（会话列表 + 消息流 + 日分组 + 上滑翻页）

**Files:**
- Create: `apps/desktop/src/renderer/src/pages/MessagesPage.tsx`
- Create: `apps/desktop/src/renderer/src/components/messages/ConversationList.tsx`
- Create: `apps/desktop/src/renderer/src/components/messages/MessageThread.tsx`
- Create: `apps/desktop/src/renderer/src/components/messages/MessageBubble.tsx`
- Create: `apps/desktop/src/renderer/src/lib/chatDays.ts`
- Test: `apps/desktop/src/renderer/src/lib/chatDays.test.ts`
- Modify: `apps/desktop/src/renderer/src/lib/nav.ts`（`NAV_ITEMS` 加一条）
- Modify: `apps/desktop/src/renderer/src/App.tsx`（`/messages` 路由）
- Modify: `apps/desktop/tsconfig.unit.json`（`include` 追加两份 renderer 文件）
- Modify: `apps/desktop/package.json`（`test:unit` 追加第四条 glob）

**Interfaces:**
- Consumes: Task 13 的 `useConversations` / `useMessages` / `useMarkRead` / `flattenConversations` / `useThreadRows` / `useBridgeOf` / `ConversationVO` / `ThreadRow` / `msgService`；Task 7 的 `@shared/chatPlatform`（`isChatPlatform`）与 `@shared/chatTypes`（`MediaType` / `MsgStatus`）；既有 `useAccounts` / `useSelectionStore`（`@/stores/accounts`）、`platformOf`（`@/lib/platform`）、`useDebouncedValue`、`cn`、dayjs、`Button` / `Input` / `Select*` / `Badge`。
- Produces（Task 15–18 只认这些）：
  - `chatDays`：`interface DaySection<T> { day: string; rows: T[] }`、`function groupByDay<T extends { ts: number }>(rows: readonly T[]): DaySection<T>[]`、`function dayLabel(day: string, nowMs?: number): string`、`function listTime(ts: number, nowMs?: number): string`
  - `MessagesPage`：路由 `/messages`；页面持有 `accountId`（就是 `useSelectionStore.selectedId`）与 `picked: ConversationVO | null`
  - `ConversationList`：props `{ accountId, onAccountIdChange, picked, onPick }`——账号选择、平台过滤、标题搜索、补底入口都在这一个组件里
  - `MessageThread`：props `{ accountId: number; conversation: ConversationVO; footer?: ReactNode }`——**`footer` 就是 Task 15 回复框的插入口**，本任务不渲染它
  - `MessageBubble`：props `{ row: ThreadRow; showSender: boolean; failedHint?: ReactNode }`——**`failedHint` 是 Task 15 重试按钮的插入口**
  - DOM 约定：气泡所在容器带 `data-msg-key="<msgKey>"`（Task 16 的搜索跳转靠它定位与高亮）；滚动容器带 `data-p6-scroller="thread"`（CDP 断言取元素用，不让脚本去猜 Tailwind 类名）
- 不做（留给后面）：回复框与状态推进的手感（Task 15）、全局搜索视图与统计卡（Task 16）、语向弹层与「建为客户」（Task 17）、客户抽屉时间线复用气泡（Task 18）。

- [ ] **Step 1: 先写 `chatDays.test.ts`（日分组与时间文案是本阶段唯一能在浏览器外断言的渲染层逻辑）**

为什么单独把这个文件切出来：日头文案、"今天/昨天/跨年"的分支、列表右侧的相对时间，全是"看起来对、边界必错"的代码，而它们在浏览器里要造出跨日数据才能看见——`ts` 由后端墙钟串换算，测试环境里凑不出"昨天 23:59"。切成一个只依赖 `ts`（毫秒）的纯模块，闸门里就能逐条断言。

`groupByDay` 的泛型约束写成 `{ ts: number }` 而不是 `ThreadRow`：`api/messages.ts` 连着 react-query 与 `@/lib/http`，一旦被闸门里的文件 import，`node --test` 就会去解析整套渲染层依赖，`tsconfig.unit.json` 里也没有 `@/*` 别名。**闸门内的 renderer 文件只许引外部纯依赖（dayjs）与相对路径。**

```ts
// src/renderer/src/lib/chatDays.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dayLabel, groupByDay, listTime } from './chatDays.ts'

const row = (ts: number, msgKey: string): { ts: number; msgKey: string } => ({ ts, msgKey })

/** 用本地时间构造测试数据：断言与跑机器的时区无关。 */
const local = (y: number, m: number, d: number, hh = 12, mm = 0): number =>
  new Date(y, m - 1, d, hh, mm, 0, 0).getTime()

const dayKey = (y: number, m: number, d: number): string =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

test('按本地日切段，段内保持升序', () => {
  const rows = [row(local(2026, 9, 19, 23, 59), 'a'), row(local(2026, 9, 20, 0, 1), 'b')]
  const sections = groupByDay(rows)
  assert.deepEqual(sections.map((s) => s.day), [dayKey(2026, 9, 19), dayKey(2026, 9, 20)])
  assert.deepEqual(sections.map((s) => s.rows.map((r) => r.msgKey)), [['a'], ['b']])
  // 只有一条时也必须是"一段"，不是"零段"——右列空白是最难看的回归
  assert.equal(groupByDay([rows[0]]).length, 1)
  assert.deepEqual(groupByDay([]), [])
})

test('输入乱序也要切对：合并尾巴可能把昨天的帧送到今天那页后面', () => {
  const rows = [row(local(2026, 9, 20, 9), 'c'), row(local(2026, 9, 19, 20), 'a'), row(local(2026, 9, 20, 8), 'b')]
  const sections = groupByDay(rows)
  assert.deepEqual(sections.map((s) => s.day), [dayKey(2026, 9, 19), dayKey(2026, 9, 20)])
  assert.deepEqual(sections[1].rows.map((r) => r.msgKey), ['b', 'c'])
  // 区分性证据：不排序时同一天会切成两段，页面上出现两个「9月20日」日头
  assert.equal(sections.length, 2)
})

test('日头文案：今天 / 昨天 / 今年内到月日 / 跨年带年份', () => {
  const now = local(2026, 9, 20, 12, 0)
  assert.equal(dayLabel(dayKey(2026, 9, 20), now), '今天')
  assert.equal(dayLabel(dayKey(2026, 9, 19), now), '昨天')
  assert.equal(dayLabel(dayKey(2026, 1, 5), now), '1月5日')
  assert.equal(dayLabel(dayKey(2025, 12, 31), now), '2025年12月31日')
  // 月初的"昨天"必须跨年：不 subtract 而是比较 day 字符串差值时，这条会露出来
  assert.equal(dayLabel(dayKey(2026, 1, 31), local(2026, 2, 1, 0, 30)), '昨天')
})

test('会话时间：分钟级 → 时:分 → 昨天 → 月日 → 年月日', () => {
  const now = local(2026, 9, 20, 12, 0)
  assert.equal(listTime(now - 30_000, now), '刚刚')
  assert.equal(listTime(now - 5 * 60_000, now), '5分钟前')
  assert.equal(listTime(local(2026, 9, 20, 8, 5), now), '08:05')
  assert.equal(listTime(local(2026, 9, 19, 23, 59), now), '昨天')
  assert.equal(listTime(local(2026, 3, 3, 10, 0), now), '3月3日')
  assert.equal(listTime(local(2025, 3, 3, 10, 0), now), '2025年3月3日')
})

test('未来时间不写"负几分钟前"', () => {
  const now = local(2026, 9, 20, 12, 0)
  // 平台时钟与本机有几秒差是常态（spec §9 的 msg_time 异常一条）：列表右侧兜到"刚刚"
  assert.equal(listTime(now + 40_000, now), '刚刚')
})
```

```bash
cd apps/desktop && node --test "src/renderer/src/lib/**/*.test.ts" 2>&1 | tail -12
```

预期：`Cannot find module '.../chatDays.ts'`，非 0 退出。

闸门配置两处（缺任何一处，这 5 条都不会被跑到或被 typecheck 放过）：

`apps/desktop/tsconfig.unit.json` 的 `include` 追加两行：

```json
    "src/renderer/src/lib/chatDays.ts",
    "src/renderer/src/lib/chatDays.test.ts"
```

`apps/desktop/package.json` 的 `test:unit` 变成四条 glob：

```json
        "test:unit": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test \"src/shared/**/*.test.ts\" \"src/bridge/**/*.test.ts\" \"src/main/services/msgBridge/**/*.test.ts\" \"src/renderer/src/lib/**/*.test.ts\"",
```

> 只列 `chatDays.ts` 这一个名字，不给 `src/renderer/**/*.ts`：渲染层其余文件全都引 `@/` 别名与 react-query，整目录进来只会让 `typecheck:unit` 因为找不到别名而红，然后又被整体关掉。

- [ ] **Step 2: 实现 `chatDays.ts`**

```ts
// src/renderer/src/lib/chatDays.ts
import dayjs from 'dayjs'

const DAY_KEY = 'YYYY-MM-DD'

/** `day` 是本地日键，同时当 React key 用：它稳定、可比、可读。 */
export interface DaySection<T> {
  day: string
  rows: T[]
}

/**
 * 进来的数组正常已由 `mergeTail` 排成升序；这里仍排一次。
 * 分组函数不该把上游的不变量当契约——少排一次序的代价是页面上出现两个同样的日头，
 * 而那个 bug 只会在"补底帧比窗口头更晚到"这种时序里出现，回归时几乎复现不出来。
 */
export function groupByDay<T extends { ts: number }>(rows: readonly T[]): DaySection<T>[] {
  const out: DaySection<T>[] = []
  for (const row of [...rows].sort((a, b) => a.ts - b.ts)) {
    const day = dayjs(row.ts).format(DAY_KEY)
    const last = out[out.length - 1]
    if (last && last.day === day) last.rows.push(row)
    else out.push({ day, rows: [row] })
  }
  return out
}

/** 日头文案（spec §8 的"日分组"）。 */
export function dayLabel(day: string, nowMs: number = Date.now()): string {
  const today = dayjs(nowMs)
  const target = dayjs(day)
  if (target.format(DAY_KEY) === today.format(DAY_KEY)) return '今天'
  if (target.format(DAY_KEY) === today.subtract(1, 'day').format(DAY_KEY)) return '昨天'
  return target.year() === today.year() ? target.format('M月D日') : target.format('YYYY年M月D日')
}

/**
 * 会话列表右侧的时间。比 `dayLabel` 多两级："刚刚 / N分钟前"，因为销售在一眼里要判断
 * "这条会话是不是刚醒"，日期粒度做不到。未来时间兜在"刚刚"，不出现负数。
 */
export function listTime(ts: number, nowMs: number = Date.now()): string {
  const diffMs = nowMs - ts
  if (diffMs < 60_000) return '刚刚'
  if (diffMs < 60 * 60_000) return `${Math.floor(diffMs / 60_000)}分钟前`
  const at = dayjs(ts)
  const today = dayjs(nowMs)
  if (at.format(DAY_KEY) === today.format(DAY_KEY)) return at.format('HH:mm')
  if (at.format(DAY_KEY) === today.subtract(1, 'day').format(DAY_KEY)) return '昨天'
  return at.year() === today.year() ? at.format('M月D日') : at.format('YYYY年M月D日')
}
```

```bash
cd apps/desktop && pnpm run test:unit 2>&1 | tail -8 && pnpm run typecheck
```

预期：`# pass 48` / `# fail 0`（Task 13 结束的 43 + 本任务 5）；typecheck 全绿——这一步同时确认 `erasableSyntaxOnly` 吃得下泛型约束与默认参数（都是可擦除语法），不吃参数属性。

- [ ] **Step 3: 导航与路由**

`lib/nav.ts`：`NAV_ITEMS` 里 工作台 之后插一条（聊天记录是"看数据"的模块，排在账号工作台之后、客户之前），import 补 `History`：

```ts
import {
  FolderOpen,
  History,
  Languages,
  LayoutDashboard,
  MessagesSquare,
  Target,
  Tags,
  Users,
  type LucideIcon
} from 'lucide-react'

export const NAV_ITEMS: NavItem[] = [
  { path: '/workspace', label: '工作台', icon: LayoutDashboard },
  { path: '/messages', label: '聊天记录', icon: History },
  { path: '/customers', label: '客户', icon: Users },
  ...
]
```

`App.tsx`：`import MessagesPage from '@/pages/MessagesPage'`，在 `/workspace` 那条之后加：

```tsx
          <Route path="/messages" element={<MessagesPage />} />
```

`DEFAULT_NAV_PATH` 不动（仍是 `/workspace`）：记录页没有"默认落地"的资格，登录后先看账号状态。

- [ ] **Step 4: `lib/chatDisplay.ts`——"给人看的名字"这条规则只留一个地方**

会话标题、气泡时刻、以及后面几处"发送人怎么显示"的判断，都属于展示层格式化：需要浏览器时钟或引 React 类型，所以不进 `@shared/*`；但它们被左列、右列、气泡、Task 16 的搜索卡片与语向弹层同时引用，写两遍就会分叉。单独一个文件，只引 dayjs：

```ts
// src/renderer/src/lib/chatDisplay.ts
import dayjs from 'dayjs'
import type { ConversationVO } from '@/api/messages'

/**
 * 没有 title 时至少让人认得出这是谁：chat_key 的 `@c.us` / `@telegram` 后缀
 * 对销售没有信息量，取前缀（手机号或群 id）。
 */
export function titleOfConversation(c: Pick<ConversationVO, 'title' | 'chatKey'>): string {
  if (c.title) return c.title
  return c.chatKey.split('@')[0] ?? c.chatKey
}

/** 气泡里的时刻：日分组已经交代了"哪天"，这里只到分。 */
export function timeOfMessage(ts: number): string {
  return dayjs(ts).format('HH:mm')
}
```

> 这个文件不进单测闸门、也不给它写单测：`titleOfConversation` 的两个分支在 Step 9 的 CDP 断言里各有一条真数据（一条有 title 的群会话 + 一条 `title IS NULL` 的陌生单聊），而闸门里的 `chatDays.test.ts` 已经覆盖了真正会算错的部分（跨日、跨年、未来时间）。给一句 `if (c.title) return c.title` 补单测，只会多一个要维护的文件。
>
> `listTime` 留在 `chatDays.ts`、`timeOfMessage` 放在这里：前者带着跨日/跨年/未来时间的判断，是被闸门钉住的逻辑；后者就是一句 `format('HH:mm')`。

- [ ] **Step 5: `MessagesPage.tsx`——两列骨架与账号选择**

```tsx
// src/renderer/src/pages/MessagesPage.tsx
import { useEffect, useState } from 'react'
import { History } from 'lucide-react'
import ConversationList from '@/components/messages/ConversationList'
import MessageThread from '@/components/messages/MessageThread'
import { useSelectionStore } from '@/stores/accounts'
import type { ConversationVO } from '@/api/messages'

export default function MessagesPage(): React.JSX.Element {
  const selectedId = useSelectionStore((s) => s.selectedId)
  const select = useSelectionStore((s) => s.select)
  const [picked, setPicked] = useState<ConversationVO | null>(null)

  /**
   * 账号就是工作台选中的那个：发送要靠该账号的内嵌视图与桥，记录页另选一个"发送时才知道
   * 没登录"的账号没有意义。所以这里不建本地 state，读写都走同一个 store。
   */
  useEffect(() => {
    // chat_key 只在一个账号内唯一：选中的会话不属于当前账号就得清掉，否则右列读的是上一个账号的尾巴。
    // 判"归属"而不是判"selectedId 变了"：Task 16 的搜索跳转会一次同时改账号与选中会话（跨账号命中），
    // 无条件清会把刚跳进来的会话立刻抹掉——用户只看到右列闪一下就空了。
    if (picked !== null && picked.accountId !== selectedId) setPicked(null)
  }, [selectedId, picked])

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
      <ConversationList
        accountId={selectedId}
        onAccountIdChange={select}
        picked={picked}
        onPick={setPicked}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-border/60 px-6 py-4">
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <History className="size-5 text-primary" />
            聊天记录
          </h1>
        </header>
        {picked && selectedId !== null ? (
          <MessageThread accountId={selectedId} conversation={picked} />
        ) : (
          <p className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
            {selectedId === null ? '先在工作台添加并选择一个平台账号。' : '从左侧选择一个会话查看记录。'}
          </p>
        )}
      </main>
    </div>
  )
}
```

> 页头的 h1 与 `<main>` 的分工：`MessageThread` 自己不再画页头，它只负责"选中会话的流"，会话标题在它内部靠 `conversation` 显示。Task 15 的回复框从 `footer` 进来，正好落在流与页底之间。

- [ ] **Step 6: `ConversationList.tsx`——左列（账号 / 平台 / 标题搜索 / 补底）**

```tsx
// src/renderer/src/components/messages/ConversationList.tsx
import { useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { RefreshCw, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { cn } from '@/lib/utils'
import { useAccounts } from '@/stores/accounts'
import { platformOf } from '@/lib/platform'
import { msgService } from '@/services/msgService'
import { flattenConversations, useConversations, useBridgeOf, type ConversationVO } from '@/api/messages'
import { listTime } from '@/lib/chatDays'
import { titleOfConversation } from '@/lib/chatDisplay'
import { isChatPlatform } from '@shared/chatPlatform'

const ALL = 'all'
const LIST_SIZE = 30

interface Props {
  accountId: number | null
  onAccountIdChange: (id: number) => void
  picked: ConversationVO | null
  onPick: (conversation: ConversationVO) => void
}

export default function ConversationList({
  accountId,
  onAccountIdChange,
  picked,
  onPick
}: Props): React.JSX.Element {
  const { data: accounts = [] } = useAccounts()
  const [keyword, setKeyword] = useState('')
  const [platform, setPlatform] = useState<string>(ALL)
  const [syncHint, setSyncHint] = useState<string | null>(null)
  const debouncedKeyword = useDebouncedValue(keyword, 300)
  const bridge = useBridgeOf(accountId)

  const query = useMemo(
    () => ({
      accountId,
      platform: isChatPlatform(platform) ? platform : null,
      q: debouncedKeyword.trim() || undefined,
      size: LIST_SIZE
    }),
    [accountId, platform, debouncedKeyword]
  )
  const { data, isPending, isError, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useConversations(query)
  const conversations = flattenConversations(data?.pages)

  const syncHistory = (): void => {
    if (accountId === null) return
    void msgService.syncHistory(accountId).then((started) => {
      // 两种结果必须长得不一样：主进程返回 false 表示"命令发出去了但桥没接"，
      // 静默成功会让人以为在补底，然后对着空列表怀疑数据丢了。
      setSyncHint(started ? '补底已开始，消息到一条刷一条' : '会话未在线，补底未启动')
    })
  }

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-r border-border/60 bg-muted/30">
      <div className="space-y-2 border-b border-border/60 px-3 py-3">
        <Select
          value={accountId === null ? '' : String(accountId)}
          onValueChange={(v) => onAccountIdChange(Number(v))}
        >
          <SelectTrigger>
            <SelectValue placeholder="选择账号" />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((account) => (
              <SelectItem key={account.id} value={String(account.id)}>
                {platformOf(account.platformType)?.short ?? '?'} · {account.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="搜索会话标题"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2">
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger className="h-8 w-32">
              <SelectValue placeholder="平台" />
            </SelectTrigger>
            <SelectContent>
              {/* 只有这两个平台有消息桥：列全平台会出现"选了永远没结果"的筛选项 */}
              <SelectItem value={ALL}>全部平台</SelectItem>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
              <SelectItem value="telegram">Telegram</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            disabled={accountId === null || !bridge}
            onClick={syncHistory}
            title={bridge ? '让页面把当前会话列表往回补一段' : '会话未在线，无法补底'}
          >
            <RefreshCw className="size-4" />
            同步历史
          </Button>
        </div>

        {syncHint && <p className="text-xs text-muted-foreground">{syncHint}</p>}
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-2">
        {isPending && <p className="px-2 py-4 text-center text-xs text-muted-foreground">加载会话中…</p>}
        {isError && (
          <p className="px-2 py-4 text-center text-xs text-destructive">
            无法加载会话，请确认后端已启动。
          </p>
        )}
        {!isPending && !isError && conversations.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            这个账号还没有采集到会话。登录后会自动补底，也可以点上面的「同步历史」。
          </p>
        )}
        {conversations.map((c) => {
          const active = picked?.id === c.id
          const summary = c.lastMsgBody ?? ''
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onPick(c)}
              className={cn(
                'flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors',
                active ? 'bg-primary/10' : 'hover:bg-muted'
              )}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-background text-xs font-medium text-muted-foreground">
                {titleOfConversation(c).slice(0, 2)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-foreground">{titleOfConversation(c)}</span>
                  {c.isGroup && (
                    <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">
                      群
                    </Badge>
                  )}
                  {!c.isGroup && c.customerId === null && (
                    <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
                      陌生
                    </Badge>
                  )}
                </span>
                <span className="mt-0.5 flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-muted-foreground">
                    {summary || '（无文字内容）'}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {c.lastMsgTime
                      ? listTime(dayjs(c.lastMsgTime).valueOf())
                      : ''}
                  </span>
                </span>
              </span>
              {c.unreadCount > 0 && (
                <Badge className="shrink-0 rounded-full px-1.5 py-0 text-[10px]">
                  {c.unreadCount > 99 ? '99+' : c.unreadCount}
                </Badge>
              )}
            </button>
          )
        })}
        {hasNextPage && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            disabled={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            {isFetchingNextPage ? '加载中…' : '加载更多会话'}
          </Button>
        )}
      </div>
    </aside>
  )
}
```

> `platform` 的筛选项直接用字面量 `'whatsapp'` / `'telegram'`，与 `ConversationVO.platform` 同源（收敛 8：`platform` 列就是这两个小写值）。这里**不能**复用 `PLATFORMS`：那是账号侧的 7 个平台与数字 `platform_type`，与会话表的取值不是一套，混用会出现一个永远查不到结果的选项。`isChatPlatform` 负责把 Select 的字符串收窄成 `ChatPlatform | null`，`ALL` 落到 `null`（= 不过滤）。
>
> 「同步历史」放在左列而不是会话流里：它的作用域是整个账号的一批会话（桥按会话列表逐个回补），放在某个会话的头部会让人以为只补这一条。

- [ ] **Step 7: `MessageThread.tsx`——日分组、上滑翻页、跟底**

```tsx
// src/renderer/src/components/messages/MessageThread.tsx
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import MessageBubble from '@/components/messages/MessageBubble'
import { useMarkRead, useMessages, useThreadRows, type ConversationVO } from '@/api/messages'
import { dayLabel, groupByDay } from '@/lib/chatDays'
import { titleOfConversation } from '@/lib/chatDisplay'

const PAGE_SIZE = 30
/** 距底 80px 以内算"在看着底部"——差一个像素就把跟底关掉的话，滚动惯性会让人错过新消息。 */
const NEAR_BOTTOM_PX = 80

interface Props {
  accountId: number
  conversation: ConversationVO
  /** Task 15 的回复框从这里进来；本任务不传，线程照常展示历史。 */
  footer?: ReactNode
}

export default function MessageThread({ accountId, conversation, footer }: Props): React.JSX.Element {
  const markRead = useMarkRead().mutate
  const { data, isPending, isError, hasNextPage, isFetchingNextPage, fetchNextPage } = useMessages({
    accountId,
    chatKey: conversation.chatKey,
    size: PAGE_SIZE
  })
  const rows = useThreadRows(accountId, conversation.chatKey, data?.pages)
  const sections = useMemo(() => groupByDay(rows), [rows])

  const scrollerRef = useRef<HTMLDivElement | null>(null)
  /** 翻页前记下的视口尺寸：新页插进来之后要用它把高度差补回去。 */
  const anchorRef = useRef<{ height: number; top: number } | null>(null)
  const atBottomRef = useRef(true)

  useEffect(() => {
    // 进会话就清未读（收敛 11 的"尽力值"）：只看 `unreadCount > 0`，不比较游标——
    // 列表 refetch 会把刚到的消息又计成未读，那时本 effect 再清一次即可。
    if (conversation.unreadCount > 0) markRead(conversation.id)
  }, [conversation, markRead])

  const onScroll = (): void => {
    const el = scrollerRef.current
    if (!el) return
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX
    if (el.scrollTop <= 4 && hasNextPage && !isFetchingNextPage) {
      anchorRef.current = { height: el.scrollHeight, top: el.scrollTop }
      void fetchNextPage()
    }
  }

  // 1) 上滑补页：把新页插入造成的高度差抵消掉。不补的话视觉上是"跳到顶部又停住"，
  //    用户刚刚看到的那条消息会飞出视口。
  useLayoutEffect(() => {
    const el = scrollerRef.current
    const anchor = anchorRef.current
    if (!el || !anchor) return
    anchorRef.current = null
    el.scrollTop = el.scrollHeight - anchor.height + anchor.top
    atBottomRef.current = false
  }, [data?.pages])

  // 2) 跟底：声明顺序保证它跑在补位之后——补页时 atBottomRef 已被翻成 false，
  //    所以拉历史不会被强行拽回底部；live 帧到达时它才是"在底部的人"才跟。
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el || !atBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [rows.length])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-6 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {titleOfConversation(conversation)}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {conversation.chatKey}
            {conversation.customerId === null && !conversation.isGroup && (
              <Badge variant="outline" className="ml-2 px-1.5 py-0 text-[10px]">
                陌生
              </Badge>
            )}
          </p>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">{rows.length} 条</span>
      </div>

      <div
        ref={scrollerRef}
        onScroll={onScroll}
        data-p6-scroller="thread"
        className="min-h-0 flex-1 overflow-y-auto px-6 py-4"
      >
        {isPending && <p className="py-6 text-center text-xs text-muted-foreground">加载消息中…</p>}
        {isError && (
          <p className="py-6 text-center text-xs text-destructive">无法读取历史消息，请确认后端已启动。</p>
        )}
        {!isPending && !isError && rows.length === 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">这个会话还没有采集到消息。</p>
        )}
        {isFetchingNextPage && (
          <p className="py-2 text-center text-[11px] text-muted-foreground">正在拉更早的消息…</p>
        )}
        {!hasNextPage && rows.length > 0 && (
          <p className="py-2 text-center text-[11px] text-muted-foreground">已经到最早的一条</p>
        )}
        {sections.map((section) => (
          <section key={section.day}>
            <div className="my-3 flex justify-center">
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground">
                {dayLabel(section.day)}
              </span>
            </div>
            {section.rows.map((row) => (
              <MessageBubble key={row.msgKey} row={row} showSender={conversation.isGroup} />
            ))}
          </section>
        ))}
      </div>

      {footer}
    </div>
  )
}
```

三条实现口径，都是这一步的判断而不是风格：

- **不用 `ScrollArea`**（左列同样用原生 `overflow-y-auto`）：翻页锚点要读写这个容器自己的 `scrollTop` / `scrollHeight`，Radix 的那层是 viewport 包在组件内部 div 里，拿到的元素与滚动元素不是同一个，锚定计算会静默偏移。既有页面用 `ScrollArea` 的地方都没有滚动定位需求。
- **`enabled: false` 的尾巴读取放在 `useThreadRows` 里**（Task 13），本步骤只调它一次：`rows` 是库页与尾巴唯一的合流点，页面里再 map 一遍就会出现"第三份真相"。
- **`footer` 插槽而不是在流里直接写回复框**：Task 15 的回复框要同时知道 `conversation`、桥状态与语向，独立成组件从插槽进来，本任务完成后页面就是可用的（能看不能回），中间态可以单独跑 CDP。

- [ ] **Step 8: `MessageBubble.tsx`——in/out 气泡、媒体占位、out 状态**

```tsx
// src/renderer/src/components/messages/MessageBubble.tsx
import type { ReactNode } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCheck,
  Clock3,
  FileText,
  Film,
  Image,
  MapPin,
  Music,
  Sticker,
  User,
  type LucideIcon
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { timeOfMessage } from '@/lib/chatDisplay'
import type { ThreadRow } from '@/api/messages'
import type { MediaType, MsgStatus } from '@shared/chatTypes'

/**
 * 媒体只存"类型 + 摘要"（spec §3 的隐私口径），所以这里永远是占位，不是缩略图：
 * 采集链不下载、不落盘，`mediaSummary` 是页内能拿到的描述性文字（文件名、时长、地点名）。
 */
const MEDIA_ICON: Record<Exclude<MediaType, 'text'>, LucideIcon> = {
  image: Image,
  audio: Music,
  video: Film,
  document: FileText,
  sticker: Sticker,
  contact: User,
  location: MapPin,
  unknown: FileText
}

/** out 的投递阶梯：⏱ 待发送、✓ 已送平台、✓✓ 已送达、✓✓(主色) 已读、⚠ 失败。`received` 只属于 in，落到 default 返回 null。 */
function Tick({ status }: { status: MsgStatus }): React.JSX.Element | null {
  switch (status) {
    case 'pending':
      return <Clock3 className="size-3" />
    case 'failed':
      return <AlertTriangle className="size-3 text-destructive" />
    case 'sent':
      return <Check className="size-3" />
    case 'delivered':
      return <CheckCheck className="size-3" />
    case 'read':
      return <CheckCheck className="size-3 text-primary" />
    default:
      return null
  }
}

interface Props {
  row: ThreadRow
  /** 群聊才显示发送人：单聊里这一行永远是"对方"或"自己"，占了宽度不给信息。 */
  showSender: boolean
  /** Task 15 的「重试」按钮从这里进来；本任务用默认的失败文案。 */
  failedHint?: ReactNode
}

export default function MessageBubble({ row, showSender, failedHint }: Props): React.JSX.Element {
  const out = row.direction === 'out'
  // 先收到局部变量再判：TS 对 `row.mediaType` 这种属性路径的收窄不如局部 const 稳。
  const mediaType = row.mediaType
  const Media = mediaType === 'text' ? null : MEDIA_ICON[mediaType]
  return (
    <div
      data-msg-key={row.msgKey}
      className={cn('mb-2 flex flex-col', out ? 'items-end' : 'items-start')}
    >
      {showSender && !out && (
        <span className="mb-0.5 text-[11px] text-muted-foreground">
          {row.senderName ?? row.senderKey ?? '群成员'}
        </span>
      )}
      <div
        className={cn(
          'max-w-[560px] rounded-2xl px-3 py-2 text-sm leading-relaxed',
          out
            ? 'rounded-br-md bg-primary text-primary-foreground'
            : 'rounded-bl-md bg-muted text-foreground'
        )}
      >
        {Media && (
          <span className="mb-1 flex items-center gap-1.5 text-xs opacity-80">
            <Media className="size-3.5" />
            {row.mediaSummary ?? '媒体消息'}
          </span>
        )}
        {row.body ? (
          <span className="whitespace-pre-wrap break-words">{row.body}</span>
        ) : (
          // 三种"看起来该有字却没有字"的情况要分得开：纯媒体（上面那行已经交代）、
          // 真空消息（这里补一句，否则气泡会塌成一条线，读者以为是渲染坏了）
          !Media && <span className="opacity-60">（空消息）</span>
        )}
      </div>
      <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {timeOfMessage(row.ts)}
        {out && <Tick status={row.status} />}
        {out &&
          row.status === 'failed' &&
          (failedHint ?? <Badge variant="outline">发送失败</Badge>)}
        {out && row.source === 'native_send' && <span>· 页面内发送</span>}
      </span>
    </div>
  )
}
```

> `data-msg-key` 挂在外层容器而不是气泡上：Task 16 的搜索跳转要 `scrollIntoView` + 高亮整行（含发送人与状态行），选一个稳定且唯一的锚点，msgKey 正好是库里的唯一键（`uk_msg`）。
>
> 失败行不靠颜色单独表达：`Tick` 的 ⚠ 与「发送失败」文字同时在（色盲与灰度打印下只剩图标就看不出来），这也是 Step 9 第 7 行断言取文字而不是取 class 的原因。
>
> 乐观气泡（`source: 'app_send'` + `status: 'pending'` + `msgKey = ~localId`）走同一条渲染路径，所以 Task 15 不需要第二套气泡组件——它只要往尾巴缓存里塞一行 `rowOfPending`。

- [ ] **Step 9: 验证**

```bash
cd apps/desktop && pnpm run test:unit 2>&1 | tail -6 && pnpm run typecheck
```

预期：`# pass 48` / `# fail 0`；四个 tsconfig 全绿。

CDP 部分（C9 抬起窗口 + `visibilityState === 'visible'`；C10 一切点击与滚动用真实输入事件）：先确认 `chat_message` 里有可读数据（Task 11/12 的真实登录态验证留下的行，或点一次「同步历史」）。**拿不到真实会话数据时按 C11 把 2–8 行标 blocked，不许用 `setQueryData` 造行冒充端到端**——造出来的行会同时骗过"渲染"与"翻页"两类断言。

`tmp/p6f-page.mjs`：

| # | 操作（真实事件） | 断言 | 区分的是什么 |
|---|---|---|---|
| 1 | 真实鼠标点击左侧导航「聊天记录」 | URL 变 `#/messages`，`data-p6-scroller="thread"` 不存在（还没选会话），右列出现「从左侧选择一个会话查看记录。」 | 路由与导航挂载；直接改 `location.hash` 不能证明 `NAV_ITEMS` 那条没写错 |
| 2 | 真实点击左列第一条会话 | 右列标题与该条 title 一致；`[data-p6-scroller="thread"] img,[data-p6-scroller="thread"] .truncate` 首条文本与列表一致；气泡数 = `curl /api/messages?chatKey=...` 首页 `records` 数（未选会话时尾巴为空） | 选中态与取数真的接上了；只断言"有气泡"区分不出读了哪个会话 |
| 3 | 首屏滚到底（`Input.dispatchMouseEvent` `mouseWheel` 向下）后再向上滚到顶 | 触发第 2 页请求；翻页完成后**之前视口里第一条消息的 `getBoundingClientRect().top` 与翻页前差值 < 2px**，`scrollTop` 明显 > 0 | 补差值生效（不补 = 那条消息飞出视口；只做"停在顶部"= 差值巨大） |
| 4 | 停在底部时，另设备给当前会话发一条 | 1s 内该 `data-msg-key` 出现在 DOM，且 `scrollTop + clientHeight >= scrollHeight - 80` | 跟底逻辑；只断言"出现了"区分不出是不是用户自己滚的 |
| 5 | 上滚到中间（距底 > 80px）时再来一条 | 新气泡出现，但 `scrollTop` 与来消息前完全相同 | "跟底"与"每次跳到底"的区分——这一行没有，第 4 行等于没验 |
| 6 | 列表里点一条**未读 > 0** 的会话 | `POST /api/conversations/{id}/read` 发出（`list_network_requests` 计数 +1），左列该条角标消失，其它条不受影响 | 清未读确实由"进入会话"触发；只断言角标没了区分不出是不是整表 refetch 的巧合 |
| 7 | 用真实鼠标点「同步历史」在桥未 ready 的账号上 | 按钮 `disabled`，`title` 提示「会话未在线，无法补底」，左列会话仍然读得到（列表不因离线而清空） | spec §8 的离线态：列表照常、动作禁用 |
| 8 | 日头数量与库里 `SELECT COUNT(DISTINCT DATE(msg_time))`（走 `/api/messages/stats` 的 `perDay.length`）比对；选一条媒体消息看占位行 | 页面上 `section` 数 = `perDay` 里落在该会话窗口内的天数；媒体气泡显示图标 + `mediaSummary`，无 `<img>` 网络请求 | 日分组真的按天切；只断言"有日头"区分不出是不是每条一个 |
| 9 | `git status` 之外再看 `chat_message` 行数增量 | 本任务只读不写（除了 `read` 端点清未读），行数增量 = 0 | 骨架不该产生数据；写侧问题留给 Task 15 |

第 3、4、5 三行必须连着跑：它们合起来才说清"上滑看历史时不被拽走、在底部时才跟"这条交互，单独任何一行都能被"每次都跳底"或"从不跳底"两种错误实现蒙过去。

- [ ] **Step 10: 提交**

```bash
git add apps/desktop/src/renderer/src/lib/nav.ts apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/lib/chatDays.ts apps/desktop/src/renderer/src/lib/chatDays.test.ts apps/desktop/src/renderer/src/lib/chatDisplay.ts apps/desktop/src/renderer/src/pages/MessagesPage.tsx apps/desktop/src/renderer/src/components/messages apps/desktop/tsconfig.unit.json apps/desktop/package.json
git commit -m "feat(P6): 聊天记录页骨架（会话列表、消息流、日分组与翻页）"
```

---

### Task 15: 应用内回复（乐观气泡 → 先译再发 → 中文拦截 → 重试）

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/sendDraft.ts`
- Test: `apps/desktop/src/renderer/src/lib/sendDraft.test.ts`
- Create: `apps/desktop/src/renderer/src/components/messages/ReplyComposer.tsx`
- Modify: `apps/desktop/src/renderer/src/api/translation.ts`（客户级设置 + 译入参带 `customerId` + 整表单提交helper）
- Modify: `apps/desktop/src/renderer/src/lib/liveTailSync.ts`（尾巴缓存的第三个写入方 + 发送链）
- Modify: `apps/desktop/src/renderer/src/pages/MessagesPage.tsx`（把回复框接进 `footer`）
- Modify: `apps/desktop/src/renderer/src/components/messages/MessageThread.tsx`（`failedHint` 插槽填上重试）

**Interfaces:**
- Consumes: Task 14 的 `MessageThread` `footer` 与 `MessageBubble` 的 `failedHint` / `data-msg-key`；Task 13 的 `tailKey` / `settleLocalId` / `rowOfPending` / `useBridgeOf` / `msgService`；Task 12 的 `SendReceipt`（`ok` / `msgKey?` / `error?` / `detail?`）与四种 `SendError`；Task 6 的后端契约（`GET /api/translation/settings?customerId=` 的 `scope`/`scopeKey`/`inherited`，`POST /api/translation/translate` 的可选 `customerId`）；P5 既有 `useTrialTranslate` / `useUpdateTranslationSettings` / `TranslationSettingVO`。
- Produces（Task 16–18 只认这些）：
  - `sendDraft`：`MAX_DRAFT_LEN = 5_000`、`interface DraftFlags { sendEnabled; disableChinese; disableChinesePreventSend }`、`type DraftDecision = { kind: 'empty' } | { kind: 'tooLong' } | { kind: 'blocked'; reason: string } | { kind: 'translate'; text: string } | { kind: 'plain'; text: string }`、`decideDraft(raw, flags): DraftDecision`
  - `api/translation`：`useTranslationSettings(customerId?: number | null)`、`settingsKeyOf(customerId)`、`settingsInputOf(current, patch)`
  - `liveTailSync`：`appendPending(qc, { accountId, chatKey, text, localId })`、`SEND_ERROR_TEXT: Record<SendError, string>`、`useSendText(accountId, chatKey) → { send(text): Promise<{ ok: true } | { ok: false; message: string }> }`
  - `ReplyComposer`：props `{ accountId: number; conversation: ConversationVO }`，DOM 上带 `data-p6-composer="reply"`
- 不做：语向弹层与「建为客户」（Task 17）、客户抽屉时间线（Task 18）、真实登录态端到端（Task 19）。

- [ ] **Step 1: 先写 `sendDraft.test.ts`**

"先拦后译"与"拦不拦"这两条规则是回复框唯一的业务判断，而它在浏览器里最难复现——要同时凑出「设置开着」「草稿含中文」「自聊能收到」三件事，一旦失败分不清是判断错了还是链路断了。切成纯函数进闸门（Task 14 已经铺好第四条 glob，这里不需要再改配置）：

```ts
// src/renderer/src/lib/sendDraft.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideDraft, MAX_DRAFT_LEN, type DraftFlags } from './sendDraft.ts'

const flags = (over: Partial<DraftFlags> = {}): DraftFlags => ({
  sendEnabled: true,
  disableChinese: false,
  disableChinesePreventSend: false,
  ...over
})

test('空草稿与纯空白都不发：不能把回车当成一条消息', () => {
  assert.deepEqual(decideDraft('', flags()), { kind: 'empty' })
  assert.deepEqual(decideDraft('   \n  ', flags()), { kind: 'empty' })
})

test('长度边界：5000 放行、5001 拒绝（与主进程 isSendable 同一口径）', () => {
  assert.equal(MAX_DRAFT_LEN, 5_000)
  assert.deepEqual(decideDraft('a'.repeat(MAX_DRAFT_LEN), flags({ sendEnabled: false })), {
    kind: 'plain',
    text: 'a'.repeat(MAX_DRAFT_LEN)
  })
  assert.deepEqual(decideDraft('a'.repeat(MAX_DRAFT_LEN + 1), flags()), { kind: 'tooLong' })
})

test('开关关着就是原文直发，且发出去的是 trim 过的', () => {
  assert.deepEqual(decideDraft('  hello  ', flags({ sendEnabled: false })), { kind: 'plain', text: 'hello' })
})

test('开关开着走译文通道', () => {
  assert.deepEqual(decideDraft('hello', flags({ sendEnabled: true })), { kind: 'translate', text: 'hello' })
})

test('中文拦截：开着拦截时给出与注入层一致的文案', () => {
  const d = decideDraft('你好，我想问下订单', flags({ sendEnabled: false, disableChinese: true, disableChinesePreventSend: true }))
  assert.deepEqual(d, { kind: 'blocked', reason: '消息含中文，已拦截发送' })
})

test('只开 disableChinese 不开 preventSend 时不拦（那是提示，不是闸门）', () => {
  const d = decideDraft('你好', flags({ disableChinese: true, disableChinesePreventSend: false }))
  assert.equal(d.kind, 'translate')
})

test('拦截优先于翻译：先译后拦等于把中文交给厂商接口再照发', () => {
  const d = decideDraft('你好', flags({ sendEnabled: true, disableChinese: true, disableChinesePreventSend: true }))
  assert.equal(d.kind, 'blocked')
  // 区分性证据：判定顺序写反时这里会是 'translate'，端到端看起来"也拦了一下"但其实消息发出去了
  assert.notEqual(d.kind, 'translate')
})

test('全角标点与假名不算中文：只按 CJK 统一表意文字判', () => {
  const d = decideDraft('こんにちは！价格：OK', flags({ disableChinese: true, disableChinesePreventSend: true }))
  assert.equal(d.kind, 'translate')
})
```

```bash
cd apps/desktop && node --test "src/renderer/src/lib/sendDraft.test.ts" 2>&1 | tail -10
```

预期：`Cannot find module '.../sendDraft.ts'`，非 0 退出。

- [ ] **Step 2: 实现 `lib/sendDraft.ts`**

```ts
// src/renderer/src/lib/sendDraft.ts
/**
 * 与主进程 `msgApi.isSendable` 同一个上限：主进程是最后一道，这里只是别让人对着
 * 一条注定发不出去的消息敲字。两处数字改动必须一起改（注释互认，跨进程没法共享常量）。
 */
export const MAX_DRAFT_LEN = 5_000

export interface DraftFlags {
  sendEnabled: boolean
  disableChinese: boolean
  disableChinesePreventSend: boolean
}

export type DraftDecision =
  | { kind: 'empty' }
  | { kind: 'tooLong' }
  | { kind: 'blocked'; reason: string }
  | { kind: 'translate'; text: string }
  | { kind: 'plain'; text: string }

/**
 * CJK 统一表意文字。注入层的同名判定在 `inject/core/translation/inputPreview.ts`：
 * 那是另一个 bundle、引不到这里（P5 定的 bundle 边界），所以规则写两遍、注释互认。
 * 文案也要一致——「消息含中文，已拦截发送」在页内预览和这里必须是同一句。
 */
const CJK = /[\u4e00-\u9fa5]/

/** 回复框的全部判断：先判空与超长，再判拦截，最后才决定要不要走译文通道。 */
export function decideDraft(raw: string, flags: DraftFlags): DraftDecision {
  const text = raw.trim()
  if (!text) return { kind: 'empty' }
  if (text.length > MAX_DRAFT_LEN) return { kind: 'tooLong' }
  // 顺序是契约：拦在译前面。反过来就变成"把中文交给厂商接口，再把译文发出去"，
  // 用户要的"别把中文发出去"没实现，还多打了一次外呼（C1）。
  if (flags.disableChinese && flags.disableChinesePreventSend && CJK.test(text)) {
    return { kind: 'blocked', reason: '消息含中文，已拦截发送' }
  }
  return flags.sendEnabled ? { kind: 'translate', text } : { kind: 'plain', text }
}
```

```bash
cd apps/desktop && pnpm run test:unit 2>&1 | tail -6 && pnpm run typecheck
```

预期：`# pass 56` / `# fail 0`（Task 14 结束的 48 + 本任务 8 条）；typecheck 全绿。

- [ ] **Step 3: `api/translation.ts` 的客户级扩展**

这是 P5 的文件，改动只有三处，且**必须保持 P5 的两个调用方（`useTranslationSync`、`TranslationPage`）不传参数就能照原样跑**：

```ts
// src/renderer/src/api/translation.ts —— VO 尾部补 Task 6 后端新增的三个字段
export interface TranslationSettingVO {
  ...既有字段...
  /** 'global' | 'customer'：这次拿到的设置属于哪一层。 */
  scope: string
  /** scope='customer' 时是客户 id 的字符串形式；全局为 null。 */
  scopeKey: string | null
  /** true = 该客户没有覆盖行，这份是继承来的全局。 */
  inherited: boolean
}

export interface TranslationSettingInput {
  ...既有字段...
  /** 缺省即写全局；写客户覆盖行时与 `scopeKey` 成对出现。 */
  scope?: string
  scopeKey?: string
}

const SETTINGS_KEY = ['translation-settings'] as const

/** 一层一条缓存：global 与某个客户的覆盖行可以同时挂在屏上（回复框读客户、推送读全局）。 */
export const settingsKeyOf = (customerId?: number | null): readonly ['translation-settings', number | 'global'] =>
  [SETTINGS_KEY[0], customerId ?? 'global'] as const

export function useTranslationSettings(customerId?: number | null) {
  return useQuery({
    queryKey: settingsKeyOf(customerId),
    queryFn: () =>
      http.get<TranslationSettingVO>(
        `/api/translation/settings${customerId ? `?customerId=${customerId}` : ''}`
      )
  })
}
```

```ts
// useUpdateTranslationSettings 的 onSuccess 整段替换
onSuccess: () => {
  // 原来这里是 `setQueryData(SETTINGS_KEY, data)`：那次 PUT 写的到底是哪一层由
  // input.scope 决定，而全局与客户级两份可能同时在屏上。整前缀失效让每层各自重取，
  // 代价是一次 refetch（设置页保存是低频动作），换来的是"改全局不会顺手改掉覆盖行"
  // 这类断言在渲染层也成立。
  void qc.invalidateQueries({ queryKey: SETTINGS_KEY })
  void qc.invalidateQueries({ queryKey: STATS_KEY })
}
```

```ts
// useTrialTranslate 的入参加一个可选字段（Task 6 的 TranslateDTO 已经有它）
mutationFn: (input: { text: string; type: TranslateType; customerId?: number | null }) =>
  http.post<TranslateVO>('/api/translation/translate', input),
```

```ts
/**
 * 只改一两个开关时的整份提交：`PUT /settings` 收的是完整表单（P5 的翻译中心就是这么提的），
 * 不能只发 `{ sendEnabled: true }`——其余字段缺省会被后端按"没传"处理，客户覆盖行的
 * 复制语义就依赖这个"没传即保持原值"。逐字段列出来而不是解构 rest，是为了让
 * "以后 VO 多了一个字段"必须在这里显式表态，而不是被 rest 静默吃掉。
 */
export function settingsInputOf(
  current: TranslationSettingVO,
  patch: Partial<TranslationSettingInput>
): TranslationSettingInput {
  return {
    server: current.server,
    serverMode: current.serverMode,
    channel: current.channel,
    receiveEnabled: current.receiveEnabled,
    receiveFromLang: current.receiveFromLang,
    receiveToLang: current.receiveToLang,
    sendEnabled: current.sendEnabled,
    sendFromLang: current.sendFromLang,
    sendToLang: current.sendToLang,
    voiceEnabled: current.voiceEnabled,
    previewEnabled: current.previewEnabled,
    enterToSend: current.enterToSend,
    disableChinese: current.disableChinese,
    disableChinesePreventSend: current.disableChinesePreventSend,
    ...patch
  }
}
```

> `useTranslationSettings()` 的形参可选 ⇒ `lib/translationSync.ts` 与 `TranslationPage` 的现有调用一个字都不用改，键从 `['translation-settings']` 变成 `['translation-settings','global']`。缓存键变了不是问题：它是进程内的，重启即空，而 Task 15 Step 7 第 8 行会专门复跑"保存后开关不回弹"这条 P5 断言。

- [ ] **Step 4: `liveTailSync.ts` 的发送侧**

尾巴缓存的写入方从两个变三个（`applyLiveFrame` / `settleLocalId` / `appendPending`），全部留在同一个文件里：三个函数改的是同一份数组，散到组件里就一定会出现"谁负责去重"说不清的那天。

```ts
// src/renderer/src/lib/liveTailSync.ts —— import 补两个名字
import { mergeTail, pendingKey, settlePending } from '@shared/liveTail'   // 已有
import { flattenRows, queryKeys, rowOfPending, type MessagePageVO, type ThreadRow } from '@/api/messages'
import type { BridgeState, LiveFrame, MsgStatus, SendError } from '@shared/chatTypes'

/**
 * 乐观气泡进尾巴：键是 `pendingKey(localId)`（`~` 前缀），回执或 live 帧到达后换掉。
 * 之后落库的真行按 msgKey 与它合并，界面上始终只有一个节点。
 */
export function appendPending(
  qc: QueryClient,
  input: { accountId: number; chatKey: string; text: string; localId: string }
): void {
  const key = tailKey(input.accountId, input.chatKey)
  const tail = qc.getQueryData<ThreadRow[]>(key) ?? []
  qc.setQueryData(key, mergeTail(tail, [rowOfPending(input)]))
}

/** 四种失败的下一步完全不同，不能都糊成"发送失败"。 */
export const SEND_ERROR_TEXT: Record<SendError, string> = {
  BRIDGE_OFFLINE: '会话未在线，无法发送',
  CHAT_NOT_FOUND: '没找到这个会话，先在页面里把它打开一次',
  SEND_FAILED: '发送失败',
  TIMEOUT: '等回执超时，可以重试'
}

/**
 * 发送链的渲染层这一段：登记乐观气泡 → 等主进程回执 → 换键。
 * 不乐观翻状态（`ok:true` 只证明平台收下），推进阶梯是 ack 帧的事（Task 13 第 6 行断言）。
 */
export function useSendText(
  accountId: number | null,
  chatKey: string | null
): { send: (text: string) => Promise<{ ok: true } | { ok: false; message: string }> } {
  const qc = useQueryClient()
  return {
    async send(text) {
      if (accountId === null || chatKey === null) return { ok: false, message: '还没选中会话' }
      const localId = crypto.randomUUID()
      appendPending(qc, { accountId, chatKey, text, localId })
      const receipt = await msgService.send({ accountId, chatKey, text, localId })
      // ok 但没带 msgKey 时留 `~localId` 不猜键：Task 12 的页内发送一定回 id，
      // 真出现说明上游契约破了，让 Task 19 的端到端把它抓出来，而不是在这里编一个。
      settleLocalId(qc, { accountId, chatKey, localId, msgKey: receipt.ok ? receipt.msgKey : undefined })
      if (receipt.ok) return { ok: true }
      const base = SEND_ERROR_TEXT[receipt.error ?? 'SEND_FAILED']
      return { ok: false, message: receipt.detail ? `${base}：${receipt.detail}` : base }
    }
  }
}
```

> 乐观气泡不触发会话列表失效：`appendPending` 只写尾巴缓存，列表的 `lastMsgBody` 等页内那条 `app_send` 的 live 帧到达后再刷（`applyLiveFrame` 会合流失效）。差一两秒，但避免了"点了发送→列表和流各刷新一次"的抖动。

- [ ] **Step 5: `ReplyComposer.tsx` 与接线**

```tsx
// src/renderer/src/components/messages/ReplyComposer.tsx
import { useState } from 'react'
import { LoaderCircle, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  settingsInputOf,
  useTranslationSettings,
  useTrialTranslate,
  useUpdateTranslationSettings
} from '@/api/translation'
import { decideDraft, MAX_DRAFT_LEN } from '@/lib/sendDraft'
import { useBridgeOf, useSendText } from '@/lib/liveTailSync'
import type { ConversationVO } from '@/api/messages'

interface Props {
  accountId: number
  conversation: ConversationVO
}

export default function ReplyComposer({ accountId, conversation }: Props): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const [hint, setHint] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const bridge = useBridgeOf(accountId)
  // 陌生会话（customerId 为 null）拿到的就是全局：解析顺序 customer→global 在后端（Task 6）
  const { data: settings } = useTranslationSettings(conversation.customerId)
  const saveSettings = useUpdateTranslationSettings()
  const translate = useTrialTranslate()
  const { send } = useSendText(accountId, conversation.chatKey)
  const offline = !bridge || !settings

  const sendNow = async (): Promise<void> => {
    if (!settings) return
    const decision = decideDraft(draft, settings)
    if (decision.kind === 'empty') return
    if (decision.kind === 'tooLong') {
      setHint(`超过 ${MAX_DRAFT_LEN} 字，请分条发送`)
      return
    }
    if (decision.kind === 'blocked') {
      setHint(decision.reason)
      return
    }
    setHint(null)
    setBusy(true)
    try {
      let text = decision.text
      if (decision.kind === 'translate') {
        const result = await translate.mutateAsync({
          text,
          type: 'send',
          customerId: conversation.customerId ?? undefined
        })
        text = result.translation
      }
      const outcome = await send(text)
      if (outcome.ok) {
        setDraft('')
        setHint(null)
      } else {
        setHint(outcome.message)
      }
    } catch (e) {
      // 译文通道挂了就把原文留在框里。降级成"直接发中文"是最坏选择：
      // 用户以为发的是译文，实际发出去的是他刚敲的中文。
      setHint(`译文获取失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const toggleSendLang = (next: boolean): void => {
    if (!settings) return
    void saveSettings.mutateAsync({
      ...settingsInputOf(settings, { sendEnabled: next }),
      // 写回它读到的那一层：这份设置是某客户的覆盖行就改覆盖行，是继承来的全局就改全局。
      // 在客户会话里点一下开关就悄悄改掉全局，等于让别人的语向跟着变。
      ...(settings.scope === 'customer' && settings.scopeKey
        ? { scope: 'customer', scopeKey: settings.scopeKey }
        : {})
    })
  }

  return (
    <div className="border-t border-border/60 px-6 py-3">
      <div className="flex items-center justify-between gap-3 pb-2 text-xs text-muted-foreground">
        <label className="flex items-center gap-2">
          <Switch
            checked={settings?.sendEnabled ?? false}
            disabled={!settings || saveSettings.isPending}
            onCheckedChange={toggleSendLang}
          />
          先译再发
        </label>
        <span>
          {draft.length} / {MAX_DRAFT_LEN}
        </span>
      </div>
      <div className="flex items-end gap-2">
        <textarea
          data-p6-composer="reply"
          rows={2}
          value={draft}
          disabled={offline}
          placeholder={
            offline
              ? '会话未在线，登录后才能在这里回复'
              : '输入消息，Enter 发送，Shift+Enter 换行'
          }
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter 发送、Shift+Enter 换行（spec §8）。这里不看 `enterToSend`：
            // 那个开关管的是内嵌页自己的输入框，应用内回复框是普通 textarea，语义只有一套。
            if (e.key !== 'Enter' || e.shiftKey) return
            e.preventDefault()
            void sendNow()
          }}
          className="min-h-[52px] max-h-40 flex-1 resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:border-primary/60 disabled:opacity-60"
        />
        <Button
          size="sm"
          disabled={offline || busy || !draft.trim()}
          onClick={() => void sendNow()}
        >
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
          发送
        </Button>
      </div>
      {hint && <p className="pt-1.5 text-xs text-destructive">{hint}</p>}
    </div>
  )
}
```

`pages/MessagesPage.tsx` 里把 `footer` 填上（`import ReplyComposer from '@/components/messages/ReplyComposer'`）：

```tsx
        {picked && selectedId !== null ? (
          <MessageThread
            accountId={selectedId}
            conversation={picked}
            footer={<ReplyComposer accountId={selectedId} conversation={picked} />}
          />
        ) : (
```

- [ ] **Step 6: `MessageThread.tsx` 填上重试插槽**

`failedHint` 在 Task 14 留的是默认「发送失败」徽标，这一步换成真按钮（import 补 `Button` 与 `useSendText`，组件顶部加一行 `const { send } = useSendText(accountId, conversation.chatKey)`）：

```tsx
            {section.rows.map((row) => (
              <MessageBubble
                key={row.msgKey}
                row={row}
                showSender={conversation.isGroup}
                failedHint={
                  row.body ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 px-1.5 text-[11px]"
                      onClick={() => {
                        // 重发的是这条失败消息的正文，不再翻一遍：再译会让"重发出去的内容"
                        // 和"当初失败的内容"不一致。新 localId = 第二条气泡，旧的留在原地，
                        // 看得出重试过（spec §5 的幂等口径）。
                        if (row.body) void send(row.body)
                      }}
                    >
                      重试
                    </Button>
                  ) : undefined
                }
              />
            ))}
```

> 重试不额外提示成败：气泡自己的状态就是提示（ pending 转圈 / 失败仍是 ⚠ ）。再加一条 toast 只会把"两条气泡哪条是新的"这件事变得更难看清。

- [ ] **Step 7: 验证**

```bash
cd apps/desktop && pnpm run test:unit 2>&1 | tail -6 && pnpm run typecheck
```

预期：`# pass 56` / `# fail 0`（与 Step 2 同数，本步只动组件与 API 层，不加用例）；typecheck 全绿（四个 tsconfig 里 `TranslationSettingVO` 的新字段没被任何解构漏掉，`useTranslationSettings()` 的调用方一处不改也能过）。

CDP（C9 抬窗口；C10 输入全部走真实键盘；后端在 8180；真实登录态缺失时按 C11 把 3–7 行标 blocked）：

| # | 操作 | 断言 | 区分的是什么 |
|---|---|---|---|
| 1 | 未登录 / 桥未 ready 的账号进会话 | `textarea[data-p6-composer="reply"]` 的 `disabled === true`、placeholder 是「会话未在线…」；「先译再发」开关仍可读 | 离线态只禁动作，不禁设置可见性 |
| 2 | 关掉「先译再发」，真实键盘敲 `test-15` + Enter | 气泡立刻出现（`status:'pending'` 的 ⏱），`data-msg-key` 以 `~` 开头；`chat_message` 里随后出现 `body='test-15'` 的行 | 原文直发路径 |
| 3 | 打开「先译再发」，敲中文 `你好` + Enter | 发出去的气泡正文是**译文**（与草稿不同）；库里最新一条 `body` 等于气泡文本；`/api/translation/translate` 请求发出且 `type='send'` | 真的走了 HTTP 译文通道；只看"发出去了"区分不出有没有翻 |
| 4 | 「中文拦截」两开关都开，敲 `测试拦截` 点发送 | 出现「消息含中文，已拦截发送」；尾巴行数不变；`/api/translation/translate` 请求数不增；`chat_message` 行数不增 | 拦在译前面（第 4 条单测的端到端对应物）。只看文案会放过"提示完照样发"的实现 |
| 5 | 第 2 步之后等 ack 帧 | 同一 `data-msg-key` 节点上的图标 ⏱ → ✓ → ✓✓ 变化，且 `[data-msg-key]` 的**节点数不变** | 换键与状态推进都并在一行上；节点数 +1 就是把 ack 当新消息 |
| 6 | 造一次失败（对不存在的 `chatKey`：左列没有该会话时直连 `msgService.send`，或停掉桥） | 气泡停在 ⚠ + 「重试」按钮 + 文案属于 `SEND_ERROR_TEXT` 的某一种 | 失败必须有可见出口；只有 ⚠ 没有按钮 = 插槽没接上 |
| 7 | 真实鼠标点「重试」 | 出现**第二条** pending 气泡（新 `~localId`），第 6 行那条仍是 failed；两行的 `data-msg-key` 不同 | 「重试 = 新 localId 重发」；原地翻成功 = 把没发出去的说成发出去了 |
| 8 | 回归 P5：翻译中心改一个开关保存 | 保存后开关保持新值（`onSuccess` 从 `setQueryData` 改成整前缀失效之后必须复跑，缓存键形状也变了）；内嵌页仍收到 `update-translation-flags` 广播且 `revision` 递增 | Step 3 是唯一一处会动到 P5 行为的改动，这条就是它的回归 |
| 9 | Shift+Enter 换行 | textarea 里多出一行（`value.split('\n').length === 2`），没有消息发出 | 两个键位语义不互相吃掉 |
| 10 | 清理（C4） | 自聊里把本轮测试消息逐条删除；报告 `chat_message` 行数增量与本轮发送条数一致 | 测试痕迹清零 |

第 4、5、7 三行是这一步的硬证据：分别对应"拦截顺序"、"换键不换行"、"重试是真重发"，三条都是只看界面一眼看不出来、而错了会直接坑到销售的点。

- [ ] **Step 8: 提交**

```bash
git add apps/desktop/src/renderer/src/lib/sendDraft.ts apps/desktop/src/renderer/src/lib/sendDraft.test.ts apps/desktop/src/renderer/src/api/translation.ts apps/desktop/src/renderer/src/lib/liveTailSync.ts apps/desktop/src/renderer/src/components/messages/ReplyComposer.tsx apps/desktop/src/renderer/src/components/messages/MessageThread.tsx apps/desktop/src/renderer/src/pages/MessagesPage.tsx
git commit -m "feat(P6): 记录页应用内回复（先译再发、中文拦截、乐观气泡与重试）"
```

---

## P6h — 记录页外围：搜索、统计、客户与语向

### Task 16: 全局搜索视图与统计卡（含"跳到命中那条消息"）

**Files:**
- Create: `apps/desktop/src/shared/chatKeys.ts`
- Test: `apps/desktop/src/shared/chatKeys.test.ts`
- Create: `apps/desktop/src/renderer/src/lib/chatSearch.ts`
- Test: `apps/desktop/src/renderer/src/lib/chatSearch.test.ts`
- Create: `apps/desktop/src/renderer/src/lib/chatStats.ts`
- Test: `apps/desktop/src/renderer/src/lib/chatStats.test.ts`
- Modify: `apps/desktop/tsconfig.unit.json`（`include` 追加六个名字）
- Create: `apps/desktop/src/renderer/src/components/messages/StatsCards.tsx`
- Create: `apps/desktop/src/renderer/src/components/messages/SearchPanel.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/MessagesPage.tsx`（视图切换 / 统计卡 / 跳转接线）
- Modify: `apps/desktop/src/renderer/src/components/messages/MessageThread.tsx`（`anchor` prop、定位条、滚动与高亮）
- Modify: `apps/desktop/src/renderer/src/components/messages/MessageBubble.tsx`（`highlight` prop）

**Interfaces:**
- Consumes: Task 4 的 `GET /api/messages/search`、`GET /api/messages/stats`、`GET /api/messages?around=`；Task 13 的 `useSearchMessages` / `useMessageStats` / `useMarkRead` / `flattenHits` / `SearchHitVO` / `ConversationVO` / `MessageVO` / `ThreadRow`；Task 14 的 `MessageThread` / `MessageBubble` / `listTime` / `data-msg-key` / `data-p6-scroller`；Task 15 留在 `MessagesPage` 里的 `footer={<ReplyComposer …>}`；Task 7 的 `@shared/chatPlatform`（`isChatPlatform`、`accountTypeOfPlatform`、`type ChatPlatform`）；既有 `useAccounts` / `useSelectionStore`、`platformOf`、`useDebouncedValue`、`Button` / `Input` / `Select*` / `Badge`、`cn`、dayjs。
- Produces（Task 17–19 只认这些）：
  - `@shared/chatKeys`：`isGroupChatKey(chatKey: string | null | undefined): boolean`、`peerPhoneOfChatKey(chatKey: string | null | undefined): string | null`——后端 `ChatKeys.isGroup` / `ChatKeys.peerPhoneOf` 的 TS 镜像，Task 17 的「建为客户」预填要用后者
  - `lib/chatSearch`：`HIGHLIGHT_MS`、`anchorLabel(ts, nowMs?)`、`jumpToOfHit(hit: HitShape): JumpTarget | null`、`interface JumpTarget { conversation: JumpConversation; anchor: { msgKey: string; messageId: number; chatKey: string; label: string } }`
  - `lib/chatStats`：`BAR_DAYS = 7`、`interface DayBar`、`toBars(perDay, windowDays?)`、`shareOf(part, total): string`
  - `StatsCards`：props `{ accountId: number | null }`，DOM 上带 `data-p6-stats="cards"`、`data-p6-stats-window="7|30"`、每根柱子 `data-p6-bar="<YYYY-MM-DD>"`
  - `SearchPanel`：props `{ onJump: (t: JumpTarget) => void; currentCustomerId: number | null }`，DOM 上带 `data-p6-search="panel"`、`data-p6-search-input`、结果卡片 `data-p6-hit="<msgKey>"`
  - `MessageThread` 的 props 增加 `anchor?: JumpTarget['anchor'] | null` 与 `onClearAnchor?: () => void`；`MessageBubble` 增加 `highlight?: boolean`
  - `MessagesPage` 的页面 state：`view: 'conversations' | 'search'`、`anchor: JumpTarget['anchor'] | null`
- 不做（留给后面）：客户抽屉时间线（Task 18）、真实登录态端到端（Task 19）。

> 这一步的三个纯模块都进闸门，理由各不相同：`chatKeys` 是"两份实现必须同形"的对照表，`chatSearch` 是"跳错会话 / 跳空"的判定，`chatStats` 是"除零与补零"的算术。三者都能在浏览器外断言，而在浏览器里都要先凑出特定数据形状才看得见。
>
> **搜索过滤条本身不抽纯函数**：七个字段到 `SearchQuery` 的映射是逐字段转发，抽出来只会多一个"少写一个字段就静默失效"的中转层。每个维度的过滤语义由 Task 4 契约表第 7–11 行在服务端钉住，界面侧由 Step 8 第 7–9 行 CDP 钉住"参数真的接到了请求上"。

- [ ] **Step 1: `@shared/chatKeys`——chat_key 形态的 TS 侧解释**

先写测试：

```ts
// src/shared/chatKeys.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isGroupChatKey, peerPhoneOfChatKey } from './chatKeys.ts'

test('群判定只看形态：WA 的 @g.us 与 TG 的 -100 / @group', () => {
  assert.equal(isGroupChatKey('8613800001001@c.us'), false)
  assert.equal(isGroupChatKey('120363000000000000@g.us'), true)
  // 带连字符的 WhatsApp 群 id（V8 的列注释里就是这个例子）
  assert.equal(isGroupChatKey('1234567890-1234567890@g.us'), true)
  assert.equal(isGroupChatKey('-1001234567890'), true)
  assert.equal(isGroupChatKey('1234567890@group'), true)
  assert.equal(isGroupChatKey('421933'), false)
})

test('空与 null 都不算群：拼合成行时拿到 undefined 不能抛', () => {
  assert.equal(isGroupChatKey(''), false)
  assert.equal(isGroupChatKey(null), false)
  assert.equal(isGroupChatKey(undefined), false)
})

test('裸号码只对 WhatsApp 单聊成立', () => {
  assert.equal(peerPhoneOfChatKey('8613800001001@c.us'), '8613800001001')
  // `.lid` 与 `s.wallet` 也是 WA 单聊形态：后端 WA_PEER 就是这三个后缀
  assert.equal(peerPhoneOfChatKey('12345678@lid'), '12345678')
  assert.equal(peerPhoneOfChatKey('8613800001001@c.usx'), null)
  assert.equal(peerPhoneOfChatKey('120363000000000000@g.us'), null)
  assert.equal(peerPhoneOfChatKey('-1001234567890'), null)
})

test('号码长度边界与后端同一条正则：5..20 位，短一号就不是号码', () => {
  assert.equal(peerPhoneOfChatKey('1234@c.us'), null)
  assert.equal(peerPhoneOfChatKey('12345@c.us'), '12345')
  assert.equal(peerPhoneOfChatKey('1'.repeat(21) + '@c.us'), null)
})
```

```bash
cd apps/desktop && node --test "src/shared/**/*.test.ts" 2>&1 | tail -8
```

预期：`Cannot find module '.../chatKeys.ts'`，非 0 退出。

实现：

```ts
// src/shared/chatKeys.ts
/**
 * chat_key 形态的 TS 侧解释，与后端 `service/msg/ChatKeys.java`（Task 2）逐条同形。
 * 两份实现绕不开：桥与渲染层拿不到 Java，而"群判定"错了会让记录页把群当单聊（不显示发送人）、
 * 让「建为客户」给一个群建出一位不存在的客户。改这里必须同时改那一边——两边的用例钉的是同一批字面量。
 */
const WA_PEER = /^(\d{5,20})@(c\.us|lid|s\.wallet)$/

export function isGroupChatKey(chatKey: string | null | undefined): boolean {
  if (!chatKey) return false
  return chatKey.endsWith('@g.us') || chatKey.startsWith('-100') || chatKey.endsWith('@group')
}

/** 单聊对端的裸号码；群、Telegram 的一切、非数字形态都是 null。 */
export function peerPhoneOfChatKey(chatKey: string | null | undefined): string | null {
  if (!chatKey) return null
  const m = WA_PEER.exec(chatKey)
  return m ? m[1] : null
}
```

- [ ] **Step 2: `lib/chatSearch.ts`——一条搜索结果对应"跳到哪儿"**

```ts
// src/renderer/src/lib/chatSearch.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { anchorLabel, HIGHLIGHT_MS, jumpToOfHit, type HitShape } from './chatSearch.ts'

const local = (y: number, m: number, d: number, hh = 10, mm = 30): number =>
  new Date(y, m - 1, d, hh, mm, 0, 0).getTime()

/** 后端发的是本地墙钟串（收敛 9），渲染层一律按本地时区解释——这里同法造数据。 */
const wall = (ms: number): string => {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const base = (): HitShape['message'] => ({
  id: 77,
  accountId: 3,
  platform: 'whatsapp',
  chatKey: '8613800001001@c.us',
  msgKey: 'false_8613800001001@c.us_ABC',
  msgTime: wall(local(2026, 9, 20)),
  customerId: 12
})

const hit = (over: Partial<HitShape> = {}): HitShape => ({
  message: base(),
  conversationId: 41,
  chatTitle: 'Ana',
  ...over
})

test('正常命中：会话行由命中消息 + 会话头拼出来，字段一项都不许错位', () => {
  const t = jumpToOfHit(hit())
  assert.ok(t)
  assert.equal(t.conversation.id, 41)
  assert.equal(t.conversation.accountId, 3)
  assert.equal(t.conversation.chatKey, '8613800001001@c.us')
  assert.equal(t.conversation.title, 'Ana')
  assert.equal(t.conversation.isGroup, false)
  assert.equal(t.conversation.customerId, 12)
  // 合成行不谎报未读：未读由跳转时显式 markRead 去清，角标靠列表 refetch 抹平
  assert.equal(t.conversation.unreadCount, 0)
  assert.equal(t.anchor.messageId, 77)
  assert.equal(t.anchor.msgKey, 'false_8613800001001@c.us_ABC')
  assert.equal(t.anchor.chatKey, '8613800001001@c.us')
})

test('群命中：isGroup 从 chat_key 形态来，不从标题猜', () => {
  const t = jumpToOfHit(hit({ message: { ...base(), chatKey: '1234567890-1234@g.us' }, chatTitle: null }))
  assert.ok(t)
  assert.equal(t.conversation.isGroup, true)
  assert.equal(t.conversation.title, null)
})

test('会话头缺失时不跳：卡片 disabled 比"跳过去啥也没定位到"好解释', () => {
  assert.equal(jumpToOfHit(hit({ conversationId: null })), null)
})

test('定位条文案：今年省年份、跨年补年份；高亮停留 2 秒', () => {
  const now = local(2026, 9, 20, 23, 0)
  assert.equal(anchorLabel(local(2026, 9, 12, 8, 5), now), '9月12日 08:05')
  assert.equal(anchorLabel(local(2025, 12, 31, 23, 59), now), '2025年12月31日 23:59')
  assert.equal(HIGHLIGHT_MS, 2_000)
})
```

```bash
cd apps/desktop && node --test "src/renderer/src/lib/**/*.test.ts" 2>&1 | tail -8
```

预期：`Cannot find module '.../chatSearch.ts'`。

```ts
// src/renderer/src/lib/chatSearch.ts
import dayjs from 'dayjs'
import { isGroupChatKey } from '@shared/chatKeys'
import type { ChatPlatform } from '@shared/chatPlatform'

/** 搜索结果点进来之后高亮停留多久（spec §8「锚定高亮 2s」）。 */
export const HIGHLIGHT_MS = 2_000

/**
 * 只声明用得到的字段：`api/messages.ts` 连着 react-query 与 `@/lib/http`，一旦被闸门里的
 * 文件 import，`node --test` 就得去解析整套渲染层依赖，而 `tsconfig.unit.json` 里没有 `@/*` 别名。
 * TS 是结构类型，真实 VO 赋给这些窄形状天然成立——两侧的字段名由 Task 4 / Task 13 钉着。
 */
export interface HitMessageShape {
  id: number
  accountId: number
  platform: ChatPlatform
  chatKey: string
  msgKey: string
  msgTime: string
  customerId: number | null
}

export interface HitShape {
  message: HitMessageShape
  conversationId: number | null
  chatTitle: string | null
}

/** 与 Task 13 的 `ConversationVO` 逐字同形（`lastMsgTime` 在这里必然是 null：命中不是会话头）。 */
export interface JumpConversation {
  id: number
  accountId: number
  platform: ChatPlatform
  chatKey: string
  title: string | null
  isGroup: boolean
  customerId: number | null
  lastMsgTime: null
  lastMsgBody: null
  unreadCount: number
}

export interface JumpTarget {
  conversation: JumpConversation
  /** `chatKey` 是防御字段：锚点跟着会话走，不带它就识不破"切了会话却留着旧锚点"。 */
  anchor: { msgKey: string; messageId: number; chatKey: string; label: string }
}

/** 定位条上那句人话：今年内省掉年份，跨年补上——与 `chatDays.dayLabel` 同一套读法。 */
export function anchorLabel(ts: number, nowMs: number = Date.now()): string {
  const target = dayjs(ts)
  return target.year() === dayjs(nowMs).year()
    ? target.format('M月D日 HH:mm')
    : target.format('YYYY年M月D日 HH:mm')
}

/**
 * 一条搜索结果 → "跳进哪个会话、锚在哪一条"。返回 null 只有一种情况：命中消息有、会话头没有
 * （Task 4 的 `headsOf` 允许 null）。这时候不跳——右列保持原样，卡片自己显示"无法跳转"，
 * 比跳过去对着一个空白窗口好解释。
 */
export function jumpToOfHit(hit: HitShape): JumpTarget | null {
  if (hit.conversationId === null) return null
  const m = hit.message
  return {
    conversation: {
      id: hit.conversationId,
      accountId: m.accountId,
      platform: m.platform,
      chatKey: m.chatKey,
      title: hit.chatTitle,
      isGroup: isGroupChatKey(m.chatKey),
      customerId: m.customerId,
      lastMsgTime: null,
      lastMsgBody: null,
      unreadCount: 0
    },
    anchor: {
      msgKey: m.msgKey,
      messageId: m.id,
      chatKey: m.chatKey,
      label: anchorLabel(dayjs(m.msgTime).valueOf())
    }
  }
}
```

- [ ] **Step 3: `lib/chatStats.ts`——柱条算术**

```ts
// src/renderer/src/lib/chatStats.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BAR_DAYS, shareOf, toBars, type DayCountShape } from './chatStats.ts'

const day = (d: string, inCount: number, outCount: number): DayCountShape => ({ day: d, inCount, outCount })

test('days=30 也只画最近 7 根，保持时间正序、最后一根是窗口末尾', () => {
  const perDay: DayCountShape[] = Array.from({ length: 30 }, (_, i) =>
    day(`2026-09-${String(i + 1).padStart(2, '0')}`, (i % 5) + 1, i % 3)
  )
  const bars = toBars(perDay, 30)
  assert.equal(bars.length, BAR_DAYS)
  assert.equal(bars[bars.length - 1].day, '2026-09-30')
  assert.deepEqual(bars.map((b) => b.day).slice(0, 2), ['2026-09-24', '2026-09-25'])
  assert.equal(bars[0].label, '9/24')
})

test('归一：最大那根 100%、其余按比例；柱内收发两段正好铺满一根', () => {
  const bars = toBars([day('2026-09-18', 10, 10), day('2026-09-19', 3, 1), day('2026-09-20', 5, 5)])
  assert.deepEqual(bars.map((b) => b.heightPct), [100, 20, 50])
  assert.equal(bars[1].total, 4)
  assert.equal(bars[1].inShare, 75)
  assert.equal(bars[1].inShare + bars[1].outShare, 100)
})

test('全零窗口：0 高度、0 占比，不出现 NaN / Infinity / 负数', () => {
  const bars = toBars([day('2026-09-19', 0, 0), day('2026-09-20', 0, 0)])
  assert.deepEqual(bars.map((b) => b.heightPct), [0, 0])
  assert.deepEqual(bars.map((b) => [b.inShare, b.outShare]), [[0, 0], [0, 0]])
  for (const b of bars) {
    assert.ok(Number.isFinite(b.heightPct) && b.heightPct >= 0)
  }
})

test('后端漏了某天就少画几根：客户端不再补第二份零', () => {
  assert.equal(toBars([day('2026-09-20', 1, 0)], 7).length, 1)
  assert.equal(toBars([], 7).length, 0)
  assert.equal(shareOf(0, 0), '—')
  assert.equal(shareOf(3, 7), '43%')
  assert.equal(shareOf(7, 7), '100%')
})
```

```bash
cd apps/desktop && node --test "src/renderer/src/lib/**/*.test.ts" 2>&1 | tail -8
```

预期：`Cannot find module '.../chatStats.ts'`。

```ts
// src/renderer/src/lib/chatStats.ts
import dayjs from 'dayjs'

/** 与 Task 4 的 `DayCountVO` 同形（闸门里不 import `@/api/messages`）。 */
export interface DayCountShape {
  day: string
  inCount: number
  outCount: number
}

export interface DayBar {
  day: string
  /** 柱子底下那行小字：`9/20`。 */
  label: string
  inCount: number
  outCount: number
  total: number
  /** 柱高：窗口内当日最大总量为 100%；全零时是 0，不是 NaN。 */
  heightPct: number
  /** 柱内两段各占这一根柱子的多少；`total` 为 0 时都是 0，否则两者相加恒等于 100。 */
  inShare: number
  outShare: number
}

/**
 * 柱条永远只画最近这么多根：`days=30` 时 30 根在这个宽度下读不出差别，
 * 而"这周有没有量"才是销售要看的那件事。所以数字窗口（7/30 切换）与柱条窗口分开。
 */
export const BAR_DAYS = 7

/**
 * 补零是后端的职责（Task 4：`perDay.length` 恒等于 `days`），这里只做三件事：
 * 切末尾 `windowDays` 根、按最大量归一、把 `YYYY-MM-DD` 变成小字。
 * 万一哪天没补上就照实少画一根——客户端再补一份零，两处补法迟早对不上。
 */
export function toBars(perDay: readonly DayCountShape[], windowDays: number = BAR_DAYS): DayBar[] {
  const rows = perDay.slice(-Math.max(windowDays, 1))
  const peak = rows.reduce((max, r) => Math.max(max, r.inCount + r.outCount), 0)
  return rows.map((row) => {
    const total = row.inCount + row.outCount
    const inShare = total === 0 ? 0 : Math.round((row.inCount / total) * 100)
    return {
      day: row.day,
      label: dayjs(row.day).format('M/D'),
      inCount: row.inCount,
      outCount: row.outCount,
      total,
      heightPct: peak === 0 ? 0 : Math.round((total / peak) * 100),
      inShare,
      outShare: total === 0 ? 0 : 100 - inShare
    }
  })
}

/** 「收 / 发」占比文案：分母为 0 时给「—」，不给 `NaN%`。 */
export function shareOf(part: number, total: number): string {
  if (total <= 0) return '—'
  return `${Math.round((part / total) * 100)}%`
}
```

闸门配置：`apps/desktop/tsconfig.unit.json` 的 `include` 追加六个名字（沿用"逐个点名、不整目录"的口径，理由见 Task 9）：

```json
    "src/shared/chatKeys.ts",
    "src/shared/chatKeys.test.ts",
    "src/renderer/src/lib/chatSearch.ts",
    "src/renderer/src/lib/chatSearch.test.ts",
    "src/renderer/src/lib/chatStats.ts",
    "src/renderer/src/lib/chatStats.test.ts"
```

```bash
cd apps/desktop && pnpm run test:unit 2>&1 | tail -6 && pnpm run typecheck:unit
```

预期：`# pass 68`（Task 15 之后的 56 + 本轮 12）/ `# fail 0`；tsc 无输出。

- [ ] **Step 4: `StatsCards.tsx`——页顶统计卡**

```tsx
// src/renderer/src/components/messages/StatsCards.tsx
import { useState } from 'react'
import { Inbox, MessagesSquare, Send, Users } from 'lucide-react'
import { useMessageStats } from '@/api/messages'
import { BAR_DAYS, shareOf, toBars } from '@/lib/chatStats'
import { cn } from '@/lib/utils'

type StatsWindow = 7 | 30

const BAR_HEIGHT_PX = 40

function Metric({
  icon,
  label,
  value
}: {
  icon: React.ReactNode
  label: string
  value: string
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  )
}

/**
 * 纯读页：四个数与七根柱子全部来自 `GET /api/messages/stats`（Task 4），这里不做任何二次统计。
 * 不引图表库——四根数字加七根柱子 div 就够，而多一个依赖就要多过一次 C2 红线审计。
 */
export default function StatsCards({ accountId }: { accountId: number | null }): React.JSX.Element {
  const [days, setDays] = useState<StatsWindow>(7)
  const { data, isPending, isError } = useMessageStats(accountId, days)
  const bars = toBars(data?.perDay ?? [])

  return (
    <div
      data-p6-stats="cards"
      className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border/60 px-6 py-2.5"
    >
      <div className="flex items-center gap-1">
        {([7, 30] as StatsWindow[]).map((w) => (
          <button
            key={w}
            type="button"
            data-p6-stats-window={w}
            onClick={() => setDays(w)}
            className={cn(
              'rounded-md border px-2 py-1 text-xs transition-colors',
              days === w
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground hover:bg-muted'
            )}
          >
            {w} 天
          </button>
        ))}
      </div>

      {accountId === null && <span className="text-xs text-muted-foreground">选一个账号看统计。</span>}
      {accountId !== null && isPending && <span className="text-xs text-muted-foreground">统计加载中…</span>}
      {accountId !== null && isError && (
        <span className="text-xs text-destructive">统计读取失败，请确认后端已启动。</span>
      )}

      {data && (
        <>
          <Metric icon={<MessagesSquare className="size-3.5" />} label="消息" value={String(data.total)} />
          <Metric
            icon={<Inbox className="size-3.5" />}
            label="收到"
            value={`${data.inCount} · ${shareOf(data.inCount, data.total)}`}
          />
          <Metric
            icon={<Send className="size-3.5" />}
            label="发出"
            value={`${data.outCount} · ${shareOf(data.outCount, data.total)}`}
          />
          <Metric
            icon={<Users className="size-3.5" />}
            label="活跃会话"
            value={String(data.activeConversations)}
          />
          <div className="flex items-end gap-1.5">
            {bars.map((bar) => (
              <div key={bar.day} className="flex w-6 flex-col items-center gap-1">
                <div
                  className="flex w-2 flex-col justify-end overflow-hidden rounded-sm bg-muted"
                  style={{ height: BAR_HEIGHT_PX }}
                  title={`${bar.day} 收 ${bar.inCount} 发 ${bar.outCount}`}
                >
                  {/* 里层的百分比是"占这一根柱子"的：外层已经按 heightPct 缩过，两段加起来正好铺满。 */}
                  <div className="flex flex-col justify-end" style={{ height: `${bar.heightPct}%` }}>
                    <div className="w-full bg-primary/35" style={{ height: `${bar.outShare}%` }} />
                    <div className="w-full bg-primary" style={{ height: `${bar.inShare}%` }} />
                  </div>
                </div>
                <span className="text-[10px] tabular-nums text-muted-foreground">{bar.label}</span>
              </div>
            ))}
          </div>
          <span className="text-[10px] text-muted-foreground">近 {BAR_DAYS} 天：实心收到 / 浅色发出</span>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 5: `SearchPanel.tsx`——全局搜索视图**

```tsx
// src/renderer/src/components/messages/SearchPanel.tsx
import { useMemo, useState } from 'react'
import { LoaderCircle, Search, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { cn } from '@/lib/utils'
import { useAccounts } from '@/stores/accounts'
import { platformOf } from '@/lib/platform'
import { flattenHits, useSearchMessages } from '@/api/messages'
import { listTime } from '@/lib/chatDays'
import { jumpToOfHit, type JumpTarget } from '@/lib/chatSearch'
import { accountTypeOfPlatform, isChatPlatform, type ChatPlatform } from '@shared/chatPlatform'
import type { Direction } from '@shared/chatTypes'

const ALL = 'all'
const HIT_SIZE = 20
const MIN_QUERY = 2

interface Props {
  onJump: (target: JumpTarget) => void
  /** 右列当前会话的客户：「只看当前客户」开关只认这一个来源（口径见下方第 2 条）。 */
  currentCustomerId: number | null
}

export default function SearchPanel({ onJump, currentCustomerId }: Props): React.JSX.Element {
  const { data: accounts = [] } = useAccounts()
  const [keyword, setKeyword] = useState('')
  const [platform, setPlatform] = useState<string>(ALL)
  const [account, setAccount] = useState<string>(ALL)
  const [direction, setDirection] = useState<string>(ALL)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [onlyCurrentCustomer, setOnlyCurrentCustomer] = useState(false)
  const debounced = useDebouncedValue(keyword, 300)

  const query = useMemo(
    () => ({
      q: debounced.trim(),
      platform: isChatPlatform(platform) ? (platform as ChatPlatform) : null,
      accountId: account === ALL ? null : Number(account),
      direction: direction === ALL ? null : (direction as Direction),
      // from/to 交 'YYYY-MM-DD'：后端把 to 展到当天 23:59:59（Task 4 的 parseDay），前端不再拼时分
      from: from || null,
      to: to || null,
      customerId: onlyCurrentCustomer ? currentCustomerId : null,
      size: HIT_SIZE
    }),
    [debounced, platform, account, direction, from, to, onlyCurrentCustomer, currentCustomerId]
  )
  const { data, isPending, isFetching, isError, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useSearchMessages(query)
  const hits = flattenHits(data?.pages)
  const searchable = query.q.length >= MIN_QUERY
  const filtersOn =
    platform !== ALL ||
    account !== ALL ||
    direction !== ALL ||
    from !== '' ||
    to !== '' ||
    onlyCurrentCustomer

  const reset = (): void => {
    setPlatform(ALL)
    setAccount(ALL)
    setDirection(ALL)
    setFrom('')
    setTo('')
    setOnlyCurrentCustomer(false)
  }

  return (
    <div data-p6-search="panel" className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b border-border/60 px-6 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-72 max-w-full">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              data-p6-search-input
              className="pl-8"
              placeholder={`搜索消息正文（至少 ${MIN_QUERY} 个字）`}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="全部平台" />
            </SelectTrigger>
            <SelectContent>
              {/* 只有这两个平台有消息桥：列全平台会造出"选了永远没结果"的筛选项 */}
              <SelectItem value={ALL}>全部平台</SelectItem>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
              <SelectItem value="telegram">Telegram</SelectItem>
            </SelectContent>
          </Select>
          <Select value={account} onValueChange={setAccount}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="全部账号" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>全部账号</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>
                  {platformOf(a.platformType)?.short ?? '?'} · {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={direction} onValueChange={setDirection}>
            <SelectTrigger className="w-28">
              <SelectValue placeholder="全部方向" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>全部方向</SelectItem>
              <SelectItem value="in">收到</SelectItem>
              <SelectItem value="out">发出</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" className="w-36" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="text-xs text-muted-foreground">至</span>
          <Input type="date" className="w-36" value={to} onChange={(e) => setTo(e.target.value)} />
          <Button
            type="button"
            variant={onlyCurrentCustomer ? 'default' : 'outline'}
            size="sm"
            disabled={currentCustomerId === null}
            title={currentCustomerId === null ? '先在右侧选中一个已关联客户的会话' : undefined}
            onClick={() => setOnlyCurrentCustomer((v) => !v)}
          >
            只看当前客户
          </Button>
          {filtersOn && (
            <Button variant="ghost" size="sm" onClick={reset}>
              <X className="size-4" />
              清除过滤
            </Button>
          )}
        </div>
        {searchable && isFetching && !isPending && (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <LoaderCircle className="size-3 animate-spin" />
            搜索中…
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">
        {!searchable && (
          <p className="py-6 text-center text-xs text-muted-foreground">
            输入至少 {MIN_QUERY} 个字开始搜索。搜索扫的是已入库的消息正文。
          </p>
        )}
        {searchable && isPending && <p className="py-6 text-center text-xs text-muted-foreground">搜索中…</p>}
        {searchable && isError && (
          <p className="py-6 text-center text-xs text-destructive">搜索请求失败，请确认后端已启动。</p>
        )}
        {searchable && !isPending && !isError && hits.length === 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">
            没有命中。换个关键词，或把时间窗放宽。
          </p>
        )}
        {hits.map((hit) => {
          const target = jumpToOfHit(hit)
          return (
            <button
              key={hit.message.msgKey}
              type="button"
              data-p6-hit={hit.message.msgKey}
              disabled={target === null}
              onClick={() => {
                if (target) onJump(target)
              }}
              className={cn(
                'mb-2 block w-full rounded-lg border border-border/60 px-3 py-2 text-left transition-colors',
                target ? 'hover:bg-muted' : 'cursor-not-allowed opacity-60'
              )}
            >
              <div className="flex items-center gap-2 text-xs">
                <span className="truncate font-medium text-foreground">
                  {hit.chatTitle ?? hit.message.chatKey}
                </span>
                <Badge
                  variant={hit.message.direction === 'out' ? 'secondary' : 'outline'}
                  className="px-1.5 py-0 text-[10px]"
                >
                  {hit.message.direction === 'out' ? '发出' : '收到'}
                </Badge>
                <span className="text-muted-foreground">
                  {platformOf(accountTypeOfPlatform(hit.message.platform))?.label ?? hit.message.platform}
                </span>
                <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                  {listTime(new Date(hit.message.msgTime).getTime())}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-foreground">
                {hit.message.body ?? '（媒体消息）'}
              </p>
              {target === null && (
                <p className="mt-1 text-[11px] text-muted-foreground">这条消息没有对应的会话头，无法跳转。</p>
              )}
            </button>
          )
        })}
        {hasNextPage && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            disabled={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            {isFetchingNextPage ? '加载中…' : '加载更多'}
          </Button>
        )}
      </div>
    </div>
  )
}
```

四处口径，都要照做：

1. **平台下拉不绕 `PLATFORMS`**：`PLATFORMS` 的键是七个平台的 `platform_type` 数字，而 `search` 的 `platform` 参数收的是 `'whatsapp' | 'telegram'` 字符串（Task 4）。只有这两个平台有采集链，所以两项写死，字面值与 `@shared/chatPlatform` 对齐。反过来，卡片上要显示平台中文名时走 `platformOf(accountTypeOfPlatform(...))`——`accountTypeOfPlatform` 就是这两个世界之间唯一的换算处。
2. **「只看当前客户」而不是客户选择器**：`customerId` 这一维后端支持，但界面上再挂一个客户搜索框（防抖、列表、"当前选了谁"）换不来对应的价值——销售问"这个客户还说过什么"时，那个会话已经就在右手边。客户维度的完整入口在 Task 18 的客户时间线里。
3. **`listTime(new Date(msgTime).getTime())`**：`msgTime` 是后端墙钟串，`new Date()` 与 dayjs 在浏览器里都按本地时区解释，与 Task 13 `rowOfMessage` 同一套换算。别在这里再手写一遍格式。
4. **命中卡片不画 `<mark>` 关键词高亮**：大小写、变音符与 emoji 序列都要处理，标错位置的"高亮"比没有更糟。先只给正文摘要 + 会话名 + 时间。

- [ ] **Step 6: `MessagesPage.tsx` 接线**

页头加两个视图标签，统计卡挂在页头下方，右列按视图分派。整页替换为（`ReplyComposer` 那一行是 Task 15 留下的，必须保留）：

```tsx
// src/renderer/src/pages/MessagesPage.tsx
import { useEffect, useState } from 'react'
import { History, MessagesSquare, Search } from 'lucide-react'
import ConversationList from '@/components/messages/ConversationList'
import MessageThread from '@/components/messages/MessageThread'
import ReplyComposer from '@/components/messages/ReplyComposer'
import SearchPanel from '@/components/messages/SearchPanel'
import StatsCards from '@/components/messages/StatsCards'
import { useMarkRead, type ConversationVO } from '@/api/messages'
import { useSelectionStore } from '@/stores/accounts'
import { jumpToOfHit, type JumpTarget } from '@/lib/chatSearch'
import { cn } from '@/lib/utils'

type View = 'conversations' | 'search'

function ViewTab({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      data-p6-view={label}
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border text-muted-foreground hover:bg-muted'
      )}
    >
      {icon}
      {label}
    </button>
  )
}

export default function MessagesPage(): React.JSX.Element {
  const selectedId = useSelectionStore((s) => s.selectedId)
  const select = useSelectionStore((s) => s.select)
  const markRead = useMarkRead().mutate
  const [view, setView] = useState<View>('conversations')
  const [picked, setPicked] = useState<ConversationVO | null>(null)
  const [anchor, setAnchor] = useState<JumpTarget['anchor'] | null>(null)

  useEffect(() => {
    // 判"归属"而不是"selectedId 变了"：跨账号跳转要一次同时改账号与选中会话（Task 14 Step 5）
    if (picked !== null && picked.accountId !== selectedId) setPicked(null)
  }, [selectedId, picked])

  /** 搜索结果 → 换账号、选会话、记锚点、切回会话视图。四件事必须一起发生，所以在同一个函数里做完。 */
  const jump = (target: JumpTarget): void => {
    select(target.conversation.accountId)
    setPicked(target.conversation)
    setAnchor(target.anchor)
    setView('conversations')
    // 合成行的 unreadCount 是 0，不主动清就永远挂着角标：跳进来就等于"我已经看到这条了"。
    markRead(target.conversation.id)
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
      <ConversationList
        accountId={selectedId}
        onAccountIdChange={select}
        picked={picked}
        onPick={(c) => {
          // 从列表选会话 = 看最新，锚点要一起清掉。MessageThread 里还有一道 chatKey 校验：
          // 两处各管一半——这里管"用户意图"，那里管"别拿旧 around 去打新会话"（后端会回 40404，右列整个空掉）。
          setAnchor(null)
          setPicked(c)
        }}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-border/60 px-6 py-4">
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <History className="size-5 text-primary" />
            聊天记录
          </h1>
          <div className="ml-auto flex items-center gap-1">
            <ViewTab
              active={view === 'conversations'}
              icon={<MessagesSquare className="size-3.5" />}
              label="会话"
              onClick={() => setView('conversations')}
            />
            <ViewTab
              active={view === 'search'}
              icon={<Search className="size-3.5" />}
              label="全局搜索"
              onClick={() => setView('search')}
            />
          </div>
        </header>

        {/* 统计卡只在会话视图出现：搜索视图要的是尽可能多的结果行，两者抢同一条竖向空间。 */}
        {view === 'conversations' && <StatsCards accountId={selectedId} />}

        {view === 'search' ? (
          <SearchPanel onJump={jump} currentCustomerId={picked?.customerId ?? null} />
        ) : picked && selectedId !== null ? (
          <MessageThread
            accountId={selectedId}
            conversation={picked}
            anchor={anchor}
            onClearAnchor={() => setAnchor(null)}
            footer={<ReplyComposer accountId={selectedId} conversation={picked} />}
          />
        ) : (
          <p className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
            {selectedId === null
              ? '先在工作台添加并选择一个平台账号。'
              : '从左侧选择一个会话查看记录。'}
          </p>
        )}
      </main>
    </div>
  )
}
```

`jumpToOfHit` 在这里没有被直接调用——它由 `SearchPanel` 调，页面只收它产出的 `JumpTarget`。这一层分工让"跳去哪儿"的判定留在纯模块，而"跳过去要做几件事"留在页面上。

- [ ] **Step 7: `MessageThread.tsx` 的锚点窗口 + `MessageBubble` 的高亮**

`MessageThread` 的 props 与取数改三处：

```tsx
interface Props {
  accountId: number
  conversation: ConversationVO
  /** Task 15 的回复框从这里进来。 */
  footer?: ReactNode
  /** 搜索跳转带进来的锚点；`chatKey` 不匹配时一律忽略（陈旧锚点会让后端回 40404，整列空掉）。 */
  anchor?: JumpTarget['anchor'] | null
  onClearAnchor?: () => void
}
```

```tsx
export default function MessageThread({
  accountId,
  conversation,
  footer,
  anchor,
  onClearAnchor
}: Props): React.JSX.Element {
  const markRead = useMarkRead().mutate
  const around = anchor && anchor.chatKey === conversation.chatKey ? anchor.messageId : null
  const { data, isPending, isError, hasNextPage, isFetchingNextPage, fetchNextPage } = useMessages({
    accountId,
    chatKey: conversation.chatKey,
    size: PAGE_SIZE,
    around
  })
```

`around` 进了 `queryKeys.messages(p)`（Task 13 的 key 里带着整个 `p`），所以锚点窗口与默认窗口是两份缓存：点「回到最新」把 `anchor` 置空，默认窗口还热着，不必重新拉。

再加 state / ref 与锚定用的 layout effect。**声明顺序是硬要求**：必须排在已有那两个（补位、跟底）之后——同一个 `useLayoutEffect` 批次里后写的 `scrollTop` 覆盖先写的，排在跟底之前就会被"滚到底"抹掉。

```tsx
  const [highlightKey, setHighlightKey] = useState<string | null>(null)
  /** 每个锚点只滚一次：live 帧会让 rows 变化，不记一笔就会每来一条拽回去一次。 */
  const anchoredRef = useRef<string | null>(null)

  useEffect(() => {
    // 换会话就忘掉上一个锚点：anchor 由页面清，但 chatKey 一变，本组件里绝不能再滚
    anchoredRef.current = null
    setHighlightKey(null)
  }, [conversation.chatKey])

  useLayoutEffect(() => {
    const key = anchor?.msgKey ?? null
    if (!key || anchoredRef.current === key) return
    const row = scrollerRef.current?.querySelector<HTMLElement>(`[data-msg-key="${CSS.escape(key)}"]`)
    // 还没渲染出来：上滑翻页途中锚点行会自己出现，下一轮 rows 变化再来滚
    if (!row) return
    anchoredRef.current = key
    row.scrollIntoView({ block: 'end' })
    setHighlightKey(key)
    const timer = window.setTimeout(() => setHighlightKey(null), HIGHLIGHT_MS)
    return () => window.clearTimeout(timer)
    // rows 而不是 rows.length：锚点行可能在长度不变时由尾巴合并换进来
  }, [anchor, rows])
```

（import 补 `useState`、`HIGHLIGHT_MS`、`type JumpTarget`；`Button` 在 Task 15 已引。）

头部与滚动区之间插入定位条：

```tsx
      {anchor && around !== null && (
        <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-primary/5 px-6 py-1.5">
          <span className="truncate text-[11px] text-muted-foreground">
            已定位到 {anchor.label} 那条消息：更早的记录在下面，比它更新的消息不在这个窗口里。
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 shrink-0 px-2 text-[11px]"
            onClick={() => onClearAnchor?.()}
          >
            回到最新
          </Button>
        </div>
      )}
```

**`block: 'end'` 而不是 `'center'`**：后端的 `around` 把锚点放在窗口**最后一条**（Task 4 `aroundPos`：窗口条件严格早于"锚点时刻 +1ms"），把它居中会让视口下半截全是空白。

最后把高亮传给气泡，`section.rows.map` 那一处加一个 prop：

```tsx
              <MessageBubble
                key={row.msgKey}
                row={row}
                showSender={conversation.isGroup}
                highlight={highlightKey === row.msgKey}
                failedHint={/* Task 15 的重试插槽，原样保留 */}
              />
```

`MessageBubble` 的 props 与外层容器：

```tsx
interface Props {
  row: ThreadRow
  showSender: boolean
  /** Task 15 的「重试」按钮从这里进来。 */
  failedHint?: ReactNode
  /** 搜索跳转命中时的 2 秒描边：只加在外层行容器上，`data-msg-key` 与它同一处，CDP 取的就是这个节点。 */
  highlight?: boolean
}

    <div
      data-msg-key={row.msgKey}
      className={cn(
        'mb-2 flex flex-col rounded-lg transition-colors',
        out ? 'items-end' : 'items-start',
        highlight && 'bg-primary/10 ring-1 ring-primary/50'
      )}
    >
```

- [ ] **Step 8: 验证**

```bash
cd apps/desktop && pnpm run test:unit 2>&1 | tail -6 && pnpm run typecheck
```

预期：`# pass 68` / `# fail 0`；四个 tsconfig 全绿。

CDP（C9 抬窗口；C10 输入走真实键盘与真实鼠标；后端在 8180；库里要有 Task 4 契约脚本写过的 `订单` / `p6b-anchor-*` 行——没有就先跑一遍 `node tmp/p6b-query.mjs` 造数据。请求计数用 P5 §6.3 那套插桩）：

| # | 操作 | 断言 | 区分的是什么 |
|---|---|---|---|
| 1 | 切到「全局搜索」，真实键盘敲 `订` | `/api/messages/search` 请求数为 0；卡片区是「输入至少两个字」引导 | `enabled` 的门真的在，不是"每次击键一个请求" |
| 2 | 接着敲成 `订单` | 300ms 内不发请求，之后恰好 1 次；结果 ≥1 张，每张有会话名、方向徽标、正文摘要 | 防抖生效（立刻发与每键一发都算失败） |
| 3 | 真实鼠标点第一条结果 | 视图切回「会话」；`GET /api/messages` 带 `around=<该条 id>`；`[data-msg-key]` 序列的**最后一条**等于命中的 msgKey；该节点带 `ring` class | 锚点进了窗口且滚到了它。只看"切回会话"区分不出跳的是哪一条 |
| 4 | 等 2.2s | 同一节点的 `ring`/高亮 class 消失，节点仍在原位（`data-msg-key` 不变） | 高亮是 2 秒，不是永久停留也不是瞬间闪掉 |
| 5 | 点「回到最新」 | 定位条消失；下一次 `/api/messages` **不带** `around`；右列末条是该会话最新消息 | 窗口退回默认，锚点没粘住 |
| 6 | 重做一次第 3 步，然后从左列点另一个会话 | 定位条自动消失、请求不带 `around`、右列正常出消息且没有「无法读取历史消息」 | 陈旧锚点会被后端 40404 打成空白右列。Step 6 与 Step 7 的两处清理各管一半，缺一条这一行就露 |
| 7 | 方向=发出 + 一个只出现在收到消息里的词 | 0 结果；方向改回「全部方向」→ ≥1 结果 | 过滤条真的接到请求上（看 Network 里的 `direction=`） |
| 8 | 起=明天、止留空 | 0 结果；点「清除过滤」后恢复 | 时间窗接上了；同时验证「清除」不会把关键词一起抹掉 |
| 9 | 右列先选中一位已关联客户的会话，再点「只看当前客户」 | 请求带 `customerId=<该会话客户 id>`；未选中客户会话时按钮 `disabled === true` | 客户维度只挂在会话上，不会静默过滤成空结果 |
| 10 | 「账号」过滤选成另一个账号，点其中的结果 | 左列账号选择器同步变成那个账号，右列仍显示刚跳进来的会话（不闪空） | Task 14 Step 5 的 `selectedId` effect 若写成无条件清 `picked`，这一行就是闪一下空右列 |
| 11 | 统计卡切 7 / 30 | `/api/messages/stats` 的 `days` 跟着变；卡上四个数与同参数 `curl` 返回逐字一致 | 数字来自接口，不是前端数列表行 |
| 12 | 读柱条 | `[data-p6-bar]` 根数 === `min(7, perDay.length)`；最大那根内层 `style.height === '100%'`；切到一个没有消息的账号时全部 `'0%'`、收发比文案为「—」 | 归一与除零两条算术在真界面上同时成立 |

第 3、4、6、10、12 五行是本任务的硬证据：锚点进窗口、高亮会退场、陈旧锚点被清、跨账号跳转不被复位 effect 抹掉、除零不 NaN——全是看一眼界面看不出、错了却直接坑到销售的地方。真实登录态缺失也不影响本步（读的是库里已入库的消息），这一条与 Task 19 不同。

- [ ] **Step 9: 提交**

```bash
git add apps/desktop/src/shared/chatKeys.ts apps/desktop/src/shared/chatKeys.test.ts apps/desktop/tsconfig.unit.json apps/desktop/src/renderer/src/lib/chatSearch.ts apps/desktop/src/renderer/src/lib/chatSearch.test.ts apps/desktop/src/renderer/src/lib/chatStats.ts apps/desktop/src/renderer/src/lib/chatStats.test.ts apps/desktop/src/renderer/src/components/messages/StatsCards.tsx apps/desktop/src/renderer/src/components/messages/SearchPanel.tsx apps/desktop/src/renderer/src/components/messages/MessageThread.tsx apps/desktop/src/renderer/src/components/messages/MessageBubble.tsx apps/desktop/src/renderer/src/pages/MessagesPage.tsx
git commit -m "feat(P6): 记录页全局搜索视图与统计卡（搜索结果锚定跳转 + 高亮）"
```

---

### Task 17: 会话头「语向」弹层与「建为客户」闭环

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/createCustomerPrefill.ts`
- Test: `apps/desktop/src/renderer/src/lib/createCustomerPrefill.test.ts`
- Create: `apps/desktop/src/renderer/src/lib/directionDraft.ts`
- Test: `apps/desktop/src/renderer/src/lib/directionDraft.test.ts`
- Modify: `apps/desktop/tsconfig.unit.json`（`include` 追加四个名字：两份 lib + 两份 test）
- Create: `apps/desktop/src/renderer/src/components/translation/LangSelect.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/TranslationPage.tsx:347-380`（删掉本地 `LangSelect` + `AUTO_SOURCE`，改 import；连带删掉已经没人用的 `Select*` 与 `languageName` 两组 import）
- Modify: `apps/desktop/src/renderer/src/api/translation.ts`（+`useResetCustomerTranslationSettings`）
- Create: `apps/desktop/src/renderer/src/components/messages/CustomerDirectionDialog.tsx`
- Create: `apps/desktop/src/renderer/src/components/messages/CreateCustomerDialog.tsx`
- Create: `apps/desktop/src/renderer/src/components/messages/ConversationActions.tsx`
- Modify: `apps/desktop/src/renderer/src/components/messages/MessageThread.tsx`（+`headerExtra` 插槽）
- Modify: `apps/desktop/src/renderer/src/pages/MessagesPage.tsx`（接线 + 关联成功后的状态修正）

**Interfaces:**
- Consumes: Task 6 的后端契约（`PUT /api/translation/settings` 带 `scope`/`scopeKey`、`DELETE /api/translation/settings/customer/{id}`、`GET /settings?customerId=` 的 `inherited`）；Task 5 的后端契约（`POST /api/customers` → `CustomerVO`、`POST /api/conversations/{id}/link-customer` → `{conversationId, customerId, messagesLinked}`，撞唯一键回 `40901`）；Task 13 的 `useCreateCustomer` / `useLinkCustomer` / `CreateCustomerInput` / `ConversationVO` / `queryKeys`；Task 15 的 `useTranslationSettings(customerId?)` / `settingsInputOf` / `TranslationSettingVO.scope|scopeKey|inherited`；Task 16 的 `isGroupChatKey` / `peerPhoneOfChatKey` / `MessageThread`；Task 7 的 `@shared/chatPlatform`（`accountTypeOfPlatform`）；P5 既有的 `sourceLanguagesFor` / `targetLanguagesFor` / `languageName`、`Switch`、`Dialog*`、`useCustomer`、`platformOf`、`http.del`。
- Produces（Task 18–19 只认这些）：
  - `lib/createCustomerPrefill`：`interface Prefill { platformType: number; openId: string; nickname: string | null; phone: string | null }`、`interface PrefillSource`（`ConversationVO` 的五个字段）、`canCreateCustomer(c): boolean`、`prefillOfConversation(c): Prefill | null`
  - `lib/directionDraft`：`interface DirectionDraft`（收发各「启用 + 源 + 目标」六字段）、`type DirectionSource = DirectionDraft`、`draftOf(s): DirectionDraft`、`dirtyCount(base, next): number`、`directionSummary(s, kind: 'receive' | 'send'): string`
  - `components/translation/LangSelect`：`LangSelect({ value, options, allowAuto?, onChange })`、`AUTO_SOURCE`
  - `api/translation`：`useResetCustomerTranslationSettings()` → `useMutation<number, …, { cleared: number }>`
  - `ConversationActions`：props `{ conversation: ConversationVO; onLinked: (customerId: number) => void }`，DOM 上带 `data-p6-actions="header"`、`data-p6-action="direction|create"`、`data-p6-direction-summary`、`data-p6-customer-name`
  - `MessageThread` 的 props 增加 `headerExtra?: ReactNode`
- 不做（留给后面）：内嵌页气泡的客户级语向（下一个任务 Task 17b）、客户抽屉时间线（Task 18）、真实登录态端到端（Task 19）。

> 两个纯模块为什么要抽出来：`createCustomerPrefill` 决定"给谁建客户"——判错就是把一个群建成一个人，或者把已关联的会话再建一遍；`directionDraft` 决定"有没有改动"——`''` 与 `'auto'` 这一对同义值在库里都真实存在，直接用 `JSON.stringify` 比较会让弹层一打开就谎称有 3 处改动、把「保存」按钮错误地亮着。两个都是能在 node 里断死、在浏览器里却要先凑数据的判断。
>
> 弹层与建客户表单本身不抽纯函数：字段到 `settingsInputOf` / `CreateCustomerInput` 的映射是逐字段转发，多一层中转只是多一处"少写一个字段就静默失效"。

- [ ] **Step 1: `lib/createCustomerPrefill.ts`——会话 → 建客户表单**

先写测试：

```ts
// src/renderer/src/lib/createCustomerPrefill.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canCreateCustomer, prefillOfConversation, type PrefillSource } from './createCustomerPrefill.ts'

const src = (over: Partial<PrefillSource>): PrefillSource => ({
  chatKey: '8613800001001@c.us',
  title: 'Alice',
  platform: 'whatsapp',
  isGroup: false,
  customerId: null,
  ...over
})

test('陌生 WhatsApp 单聊：openId 就是 chatKey，手机号从形态里剥出来', () => {
  assert.equal(canCreateCustomer(src({})), true)
  assert.deepEqual(prefillOfConversation(src({})), {
    platformType: 1,
    openId: '8613800001001@c.us',
    nickname: 'Alice',
    phone: '8613800001001'
  })
})

test('三个否决各自单独成立：已关联、head 说是群、chatKey 是群形态', () => {
  assert.equal(canCreateCustomer(src({ customerId: 7 })), false)
  assert.equal(canCreateCustomer(src({ isGroup: true })), false)
  // head 标着"不是群"但键是 @g.us：两处都要过，只信 head 就会给群建出一位客户。
  assert.equal(canCreateCustomer(src({ chatKey: '120363000000000000@g.us' })), false)
  assert.equal(prefillOfConversation(src({ chatKey: '120363000000000000@g.us' })), null)
})

test('Telegram 单聊：没有电话号码形态，phone 留 null 而不是硬塞 chatKey', () => {
  const p = prefillOfConversation(src({ chatKey: '421933', platform: 'telegram' }))
  assert.deepEqual(p, { platformType: 4, openId: '421933', nickname: 'Alice', phone: null })
})

test('标题只有空白也不写空串：昵称留 null，列表页不会出现一个没有名字的客户', () => {
  assert.equal(prefillOfConversation(src({ title: '   ' }))?.nickname, null)
  assert.equal(prefillOfConversation(src({ title: null }))?.nickname, null)
  assert.equal(prefillOfConversation(src({ title: '  Bob  ' }))?.nickname, 'Bob')
})
```

```bash
cd apps/desktop && node --test "src/renderer/src/lib/createCustomerPrefill.test.ts" 2>&1 | tail -8
```

预期：`Cannot find module '.../createCustomerPrefill.ts'`，非 0 退出。

实现：

```ts
// src/renderer/src/lib/createCustomerPrefill.ts
import { accountTypeOfPlatform, type ChatPlatform } from '@shared/chatPlatform'
import { isGroupChatKey, peerPhoneOfChatKey } from '@shared/chatKeys'

/**
 * 与 Task 5 的 `CustomerCreateRequest` 里"预填得出的那四个字段"同形。
 * 闸门里的文件不许 import `@/api/customers`（那会把 react-query 拖进 node --test），
 * 所以这里按形状写一遍；提交时 `CreateCustomerInput` 的其余字段全部可空，展开即可。
 */
export interface Prefill {
  platformType: number
  openId: string
  nickname: string | null
  phone: string | null
}

/** 只用到 `ConversationVO` 的这五个字段，测试里能手搓一条会话。 */
export interface PrefillSource {
  chatKey: string
  title: string | null
  platform: ChatPlatform
  isGroup: boolean
  customerId: number | null
}

/**
 * 群判定看两处：会话头的 `isGroup` 与 `chatKey` 的形态，两处都要过。
 * 前者是采集时归一化写进去的结论，后者是键本身。只信一处时，一条 head 标错的群会话
 * 会被建成一位客户，而 link-customer 紧接着把整个群的历史消息回填到这位不存在的客户身上。
 */
export function canCreateCustomer(c: PrefillSource): boolean {
  return c.customerId === null && !c.isGroup && !isGroupChatKey(c.chatKey)
}

/** 不能建就返回 null：调用方拿一个 `null` 去禁用按钮，比自己再判一遍三个条件好。 */
export function prefillOfConversation(c: PrefillSource): Prefill | null {
  if (!canCreateCustomer(c)) return null
  const nickname = c.title?.trim() ?? ''
  return {
    platformType: accountTypeOfPlatform(c.platform),
    openId: c.chatKey,
    nickname: nickname || null,
    phone: peerPhoneOfChatKey(c.chatKey)
  }
}
```

- [ ] **Step 2: `lib/directionDraft.ts`——弹层的表单初值、改动计数与摘要**

先写测试：

```ts
// src/renderer/src/lib/directionDraft.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { directionSummary, dirtyCount, draftOf, type DirectionSource } from './directionDraft.ts'

/** 一份"完整设置"：语向六字段之外还有 channel / server / previewEnabled 等，弹层一个都不许带走。 */
const WHOLE = {
  channel: 'simulate',
  server: 'node-a',
  serverMode: 'auto',
  previewEnabled: true,
  receiveEnabled: true,
  receiveFromLang: 'en',
  receiveToLang: 'zh-CN',
  sendEnabled: false,
  sendFromLang: 'zh-CN',
  sendToLang: 'vi',
  voiceEnabled: false,
  enterToSend: true,
  disableChinese: true,
  disableChinesePreventSend: false
}

test('draftOf 只取那六个字段', () => {
  assert.deepEqual(Object.keys(draftOf(WHOLE)).sort(), [
    'receiveEnabled',
    'receiveFromLang',
    'receiveToLang',
    'sendEnabled',
    'sendFromLang',
    'sendToLang'
  ])
  assert.equal(draftOf(WHOLE).receiveToLang, 'zh-CN')
})

test('同义值不算改动：P5 的下拉写 `""`，Task 6 的契约写 `"auto"`，两者都是"自动检测"', () => {
  const base: DirectionSource = { ...draftOf(WHOLE), receiveFromLang: '' }
  const next: DirectionSource = { ...draftOf(WHOLE), receiveFromLang: 'auto' }
  assert.equal(dirtyCount(base, next), 0)
  assert.equal(dirtyCount(base, { ...base, receiveFromLang: 'en' }), 1)
})

test('改动处数逐字段累加，开关也算一处', () => {
  const base = draftOf(WHOLE)
  assert.equal(dirtyCount(base, base), 0)
  assert.equal(dirtyCount(base, { ...base, sendToLang: 'th' }), 1)
  assert.equal(dirtyCount(base, { ...base, sendEnabled: true, receiveToLang: 'ja' }), 2)
})

test('摘要文案：源为空显示 auto，目标为空显示未配置', () => {
  assert.equal(directionSummary({ ...draftOf(WHOLE), receiveFromLang: '' }, 'receive'), 'auto → zh-CN')
  assert.equal(directionSummary(draftOf(WHOLE), 'send'), 'zh-CN → vi')
  assert.equal(directionSummary({ ...draftOf(WHOLE), sendToLang: '' }, 'send'), '未配置')
})
```

```bash
cd apps/desktop && node --test "src/renderer/src/lib/directionDraft.test.ts" 2>&1 | tail -8
```

预期：`Cannot find module '.../directionDraft.ts'`。

实现：

```ts
// src/renderer/src/lib/directionDraft.ts
/** 语向弹层能改的全部字段：收 / 发各一条「启用 + 源 + 目标」。 */
export interface DirectionDraft {
  receiveEnabled: boolean
  receiveFromLang: string
  receiveToLang: string
  sendEnabled: boolean
  sendFromLang: string
  sendToLang: string
}

/** 弹层读得到的字段子集；`TranslationSettingVO` 结构上就满足它。 */
export type DirectionSource = DirectionDraft

/** 显式逐字段挑，不用 rest 剔除：以后 VO 多一个字段时必须在这里表态一次。 */
export function draftOf(s: DirectionSource): DirectionDraft {
  return {
    receiveEnabled: s.receiveEnabled,
    receiveFromLang: s.receiveFromLang,
    receiveToLang: s.receiveToLang,
    sendEnabled: s.sendEnabled,
    sendFromLang: s.sendFromLang,
    sendToLang: s.sendToLang
  }
}

/**
 * 库里"自动检测"有两种写法：P5 的 `LangSelect` 用 `''`（radix 的 SelectItem 不吃空串，
 * 组件内部换成 `auto` 哨兵再换回来），Task 6 的契约表用 `'auto'` 写过客户行。
 * 只在比较时归一，不改提交值——弹层照原样 PUT，避免顺手把全局行的 `''` 改写成 `'auto'`。
 */
const same = (a: string, b: string): boolean => {
  const n = (v: string): boolean => v === '' || v === 'auto'
  return n(a) && n(b) ? true : a === b
}

/** 保存按钮的 disabled 判定。用 `JSON.stringify` 比会在同义值上谎报改动。 */
export function dirtyCount(base: DirectionSource, next: DirectionSource): number {
  const b = draftOf(base)
  const n = draftOf(next)
  let count = 0
  if (b.receiveEnabled !== n.receiveEnabled) count += 1
  if (!same(b.receiveFromLang, n.receiveFromLang)) count += 1
  if (!same(b.receiveToLang, n.receiveToLang)) count += 1
  if (b.sendEnabled !== n.sendEnabled) count += 1
  if (!same(b.sendFromLang, n.sendFromLang)) count += 1
  if (!same(b.sendToLang, n.sendToLang)) count += 1
  return count
}

/** 会话头那颗按钮上的「这一位客户的发信语向」摘要。 */
export function directionSummary(s: DirectionSource, kind: 'receive' | 'send'): string {
  const from = kind === 'receive' ? s.receiveFromLang : s.sendFromLang
  const to = kind === 'receive' ? s.receiveToLang : s.sendToLang
  if (!to) return '未配置'
  return `${from && from !== 'auto' ? from : 'auto'} → ${to}`
}
```

```bash
cd apps/desktop && pnpm run test:unit 2>&1 | tail -6 && pnpm run typecheck
```

预期：`# pass 76` / `# fail 0`（Task 16 结束的 68 + 本轮 8）；tsc 无输出。四行名字要一起进 `tsconfig.unit.json` 的 `include`：

```jsonc
"src/renderer/src/lib/createCustomerPrefill.ts",
"src/renderer/src/lib/createCustomerPrefill.test.ts",
"src/renderer/src/lib/directionDraft.ts",
"src/renderer/src/lib/directionDraft.test.ts"
```

- [ ] **Step 3: 把 `LangSelect` 提取成共用组件，补上 reset mutation**

`LangSelect` 现在只有翻译中心在用（`TranslationPage.tsx:347-380`）。语向弹层要复制同一段"空串 ⇄ `auto` 哨兵"的边界处理——那正是 `dirtyCount` 的同义值问题的源头，复制一份就等于把坑复制一份。整段搬出去（连注释一起，那段注释解释的是哨兵为什么存在）：

```tsx
// src/renderer/src/components/translation/LangSelect.tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { languageName } from '@/lib/langData'

/** radix 的 SelectItem 不接受空串 value，用 `auto` 作哨兵并在边界换回 `''`。 */
export const AUTO_SOURCE = 'auto'

export function LangSelect({
  value,
  options,
  allowAuto,
  onChange
}: {
  value: string
  options: { code: string; zh: string }[]
  allowAuto?: boolean
  onChange: (v: string) => void
}): React.JSX.Element {
  return (
    <Select
      value={allowAuto && value === '' ? AUTO_SOURCE : value}
      onValueChange={(v) => onChange(v === AUTO_SOURCE ? '' : v)}
    >
      <SelectTrigger className="h-8 w-full text-xs">
        <SelectValue placeholder="自动检测" />
      </SelectTrigger>
      <SelectContent>
        {allowAuto && <SelectItem value={AUTO_SOURCE}>自动检测</SelectItem>}
        {options.map((lang) => (
          <SelectItem key={lang.code} value={lang.code}>
            {languageName(lang.code)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
```

`TranslationPage.tsx` 侧：删掉 347–380 整段，加 `import { LangSelect } from '@/components/translation/LangSelect'`，并把文件顶部已经没有使用者的 `Select, SelectContent, SelectItem, SelectTrigger, SelectValue` 与 `languageName` 两组 import 删掉（`DirectionCard` 里剩下的 `<LangSelect …>` 调用一个字都不用改——props 形状没变）。

reset mutation 补在 `api/translation.ts` 的 `useUpdateTranslationSettings` 之后：

```ts
/**
 * 删掉覆盖行 = 该客户回到全局。Task 6 的 `DELETE /settings/customer/{id}` 返回 `{cleared:0|1}`：
 * `cleared === 0` 也是成功（本来就没有覆盖行），不要拿它当失败提示——那只会让用户以为按钮坏了。
 * 失效走整前缀：与保存同一套理由（两层可能同时挂在屏上）。
 */
export function useResetCustomerTranslationSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (customerId: number) =>
      http.del<{ cleared: number }>(`/api/translation/settings/customer/${customerId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SETTINGS_KEY })
      void qc.invalidateQueries({ queryKey: STATS_KEY })
    }
  })
}
```

> `http` 的删除方法叫 `del`（`lib/http.ts` 既有导出，`useDeleteAccount` / `useDeleteCustomer` 都用它），不是 `delete`。写错不会编译失败在语义上——`http.delete` 会直接报「属性不存在」，所以这一步不用等运行期。

```bash
cd apps/desktop && pnpm run typecheck && pnpm run test:unit 2>&1 | tail -4
```

预期：typecheck 全绿（提取只动 import，`DirectionCard` 的三个调用点不改）；`# pass 76` 不变。

- [ ] **Step 4: `CustomerDirectionDialog.tsx`——一位客户的语向覆盖**

```tsx
// src/renderer/src/components/messages/CustomerDirectionDialog.tsx
import { useEffect, useState } from 'react'
import { Languages } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { LangSelect } from '@/components/translation/LangSelect'
import {
  settingsInputOf,
  useResetCustomerTranslationSettings,
  useTranslationSettings,
  useUpdateTranslationSettings
} from '@/api/translation'
import { sourceLanguagesFor, targetLanguagesFor } from '@/lib/langData'
import { draftOf, dirtyCount, type DirectionDraft } from '@/lib/directionDraft'

function LangRow({
  title,
  enabled,
  onEnabled,
  from,
  to,
  onFrom,
  onTo,
  channel
}: {
  title: string
  enabled: boolean
  onEnabled: (v: boolean) => void
  from: string
  to: string
  onFrom: (v: string) => void
  onTo: (v: string) => void
  channel: string
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-[52px_64px_minmax(0,1fr)_14px_minmax(0,1fr)] items-center gap-2">
      <span className="text-xs text-muted-foreground">{title}</span>
      <div>
        <Switch checked={enabled} onCheckedChange={(v) => onEnabled(v === true)} />
      </div>
      <LangSelect value={from} allowAuto options={sourceLanguagesFor(channel)} onChange={onFrom} />
      <span className="text-center text-xs text-muted-foreground">→</span>
      <LangSelect value={to} options={targetLanguagesFor(channel)} onChange={onTo} />
    </div>
  )
}

interface Props {
  customerId: number
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function CustomerDirectionDialog({ customerId, open, onOpenChange }: Props): React.JSX.Element {
  const { data } = useTranslationSettings(customerId)
  const save = useUpdateTranslationSettings()
  const reset = useResetCustomerTranslationSettings()
  const [draft, setDraft] = useState<DirectionDraft | null>(null)

  // 只在"打开的那一瞬间"抓一次初值：`data` 是取值来源，不是"重新铺表单"的触发器。
  // 把 data 加进依赖，一次后台 refetch（保存后的 invalidate、窗口重新聚焦）就会把用户
  // 改到一半的表单抹回服务端值——那种"我刚才选的没了"的手感最难查。
  useEffect(() => {
    if (open && data) setDraft(draftOf(data))
  }, [open])

  const patch = (p: Partial<DirectionDraft>): void => setDraft((d) => (d ? { ...d, ...p } : d))
  const dirty = data && draft ? dirtyCount(data, draft) : 0

  const submit = (): void => {
    if (!data || !draft) return
    save.mutate(settingsInputOf(data, { ...draft, scope: 'customer', scopeKey: String(customerId) }), {
      // 成功就关掉：`inherited` 从 true 翻成 false 是这次操作唯一"看得见做完了"的信号，
      // 而它只在重新打开时才该被读一次。留在原地等它翻，等于让表单和缓存赛跑。
      onSuccess: () => onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Languages className="size-4 text-primary" />
            该客户的语向
          </DialogTitle>
          <DialogDescription>
            只作用于记录页回复框的「先译再发」；内嵌 WhatsApp 页里的气泡仍按全局语向翻译。
          </DialogDescription>
        </DialogHeader>

        {!data && <p className="py-6 text-center text-xs text-muted-foreground">读取设置中…</p>}
        {data && draft && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={
                  data.inherited
                    ? 'border-border text-muted-foreground'
                    : 'border-0 bg-primary/10 text-primary'
                }
              >
                {data.inherited ? '沿用全局' : '该客户专属'}
              </Badge>
              <span className="text-[11px] text-muted-foreground">
                {data.inherited
                  ? '保存后只为这位客户建一份覆盖，全局设置不动。'
                  : `覆盖行 · 客户 #${customerId}`}
              </span>
            </div>

            <LangRow
              title="收信"
              enabled={draft.receiveEnabled}
              onEnabled={(v) => patch({ receiveEnabled: v })}
              from={draft.receiveFromLang}
              to={draft.receiveToLang}
              onFrom={(v) => patch({ receiveFromLang: v })}
              onTo={(v) => patch({ receiveToLang: v })}
              channel={data.channel}
            />
            <LangRow
              title="发信"
              enabled={draft.sendEnabled}
              onEnabled={(v) => patch({ sendEnabled: v })}
              from={draft.sendFromLang}
              to={draft.sendToLang}
              onFrom={(v) => patch({ sendFromLang: v })}
              onTo={(v) => patch({ sendToLang: v })}
              channel={data.channel}
            />

            {save.isError && (
              <p data-p6-direction-error="" className="text-xs text-destructive">
                保存失败：{save.error instanceof Error ? save.error.message : '后端不可用'}
              </p>
            )}
          </div>
        )}

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            data-p6-direction-reset=""
            disabled={!data || data.inherited || reset.isPending}
            onClick={() => reset.mutate(customerId, { onSuccess: () => onOpenChange(false) })}
          >
            {reset.isPending ? '恢复中…' : '恢复全局'}
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button
              size="sm"
              data-p6-direction-save=""
              disabled={dirty === 0 || save.isPending || !draft}
              onClick={submit}
            >
              {save.isPending ? '保存中…' : dirty > 0 ? `保存（${dirty} 处改动）` : '保存'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

三点口径：

1. **「恢复全局」只在已有覆盖行时可点**（`!data.inherited`）。对一份本来就继承全局的设置发 DELETE 什么也不会发生（`cleared:0`），按钮亮着却毫无反应比灰掉更糟。
2. **弹层不碰 channel / 节点 / 中文拦截**：那些是全局的运营决定，按客户覆盖会在翻译中心留下"这里改了个看不见的开关"。字段面由 `draftOf` 的六个字段钉住，`settingsInputOf` 把它们并进整份 VO 再 PUT。
3. **`Dialog` 而不是浮层**：`components/ui/` 里没有 popover，且这个表单要提交、要失败提示、要"改了就别急着关"，是标准弹层语义。为它新增一个 radix 组件不值当。

- [ ] **Step 5: `CreateCustomerDialog.tsx`——建客户 + 回填历史的两步闭环**

```tsx
// src/renderer/src/components/messages/CreateCustomerDialog.tsx
import { useEffect, useMemo, useState } from 'react'
import { UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/http'
import { useCreateCustomer } from '@/api/customers'
import { useLinkCustomer, type ConversationVO } from '@/api/messages'
import { prefillOfConversation } from '@/lib/createCustomerPrefill'

type Phase = 'form' | 'linking' | 'link-failed'

interface Props {
  conversation: ConversationVO
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 两步都成功才回调：只创建成功不算闭环完成（会话头还挂着「陌生」）。 */
  onLinked: (customerId: number) => void
}

export default function CreateCustomerDialog({ conversation, open, onOpenChange, onLinked }: Props): React.JSX.Element {
  const prefill = useMemo(() => prefillOfConversation(conversation), [conversation])
  const create = useCreateCustomer()
  const link = useLinkCustomer()
  const [nickname, setNickname] = useState('')
  const [phone, setPhone] = useState('')
  const [remark, setRemark] = useState('')
  const [phase, setPhase] = useState<Phase>('form')
  const [createdId, setCreatedId] = useState<number | null>(null)

  useEffect(() => {
    if (!open || !prefill) return
    // 每次打开都按会话快照重铺：上一轮失败留下的输入会让用户以为"我已经改过了"。
    setNickname(prefill.nickname ?? '')
    setPhone(prefill.phone ?? '')
    setRemark('')
    setPhase('form')
    setCreatedId(null)
  }, [open, prefill])

  const doLink = (customerId: number): void => {
    setPhase('linking')
    link.mutate(
      { conversationId: conversation.id, customerId },
      {
        onSuccess: (r) => {
          // messagesLinked 可以是 0（这个会话的历史消息此前已被自动匹配写过归属）。
          // 那仍是成功：会话头已经挂上，回填范围由后端的"只补空"口径决定。
          onLinked(r.customerId)
        },
        onError: () => setPhase('link-failed')
      }
    )
  }

  const submit = (): void => {
    if (!prefill) return
    create.mutate(
      {
        platformType: prefill.platformType,
        openId: prefill.openId,
        nickname: nickname.trim() || null,
        phone: phone.trim() || null,
        remark: remark.trim() || null
      },
      { onSuccess: (customer) => doLink(customer.id) }
    )
  }

  const duplicate = create.error instanceof ApiError && create.error.code === 40901

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <UserPlus className="size-4 text-primary" />
            建为客户
          </DialogTitle>
          <DialogDescription>创建这位会话对端的客户，并把该会话已入库的历史消息回填给他。</DialogDescription>
        </DialogHeader>

        {!prefill && (
          <p className="py-4 text-center text-xs text-muted-foreground">
            这个会话不能建客户（群会话或已关联客户）。
          </p>
        )}

        {prefill && phase !== 'link-failed' && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">会话 ID（open_id）</Label>
              <Input value={prefill.openId} readOnly className="bg-muted text-muted-foreground" />
              <p className="text-[11px] text-muted-foreground">
                就是这条会话的 chat_key，改它等于给另一个号码建客户。
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">昵称</Label>
                <Input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="留空则不填" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">手机号</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="留空则不填" />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">备注</Label>
              <Input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="可选" />
            </div>
            {create.isError && (
              <p data-p6-create-error="" className="text-xs text-destructive">
                {create.error instanceof Error ? create.error.message : '创建失败'}
                {duplicate &&
                  ' —— 该平台下这个 open_id 已经有客户了。当前没有"按 open_id 找已有客户"的入口（客户列表的关键词只搜昵称 / 手机 / 邮箱），请到客户管理页确认是哪一位。'}
              </p>
            )}
          </div>
        )}

        {phase === 'link-failed' && createdId !== null && (
          <div className="flex flex-col gap-2" data-p6-link-failed="">
            <p className="text-xs text-destructive">
              客户 #{createdId} 已经创建成功，但历史消息关联失败（会话头还没挂上）。
            </p>
            <p className="text-[11px] text-muted-foreground">
              重试只会补"关联"这一步，不会再建一位重复客户——重复的 open_id 会被后端挡在 40901。
            </p>
          </div>
        )}

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {phase === 'link-failed' ? '先关掉' : '取消'}
          </Button>
          {phase === 'link-failed' && createdId !== null ? (
            <Button size="sm" disabled={link.isPending} onClick={() => doLink(createdId)}>
              {link.isPending ? '关联中…' : '重试关联'}
            </Button>
          ) : (
            <Button
              size="sm"
              data-p6-action="create-submit"
              disabled={!prefill || create.isPending || phase === 'linking'}
              onClick={submit}
            >
              {phase === 'linking' ? '关联中…' : create.isPending ? '创建中…' : '建为客户并关联历史'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

> **为什么第一步成功、第二步失败要单独一个 phase，而不是笼统报"失败"**：客户行已经落库了，报"创建失败"会让用户再点一次、然后撞上 40901，得到一个前后矛盾的错误串。分开之后界面说的是事实：客户在，归属没挂上，重试只走第二步（`doLink(createdId)`）。这也是 spec §6"两个原子步骤、不隐式耦合"在界面上的落点——后端本来就没把两步包成一个事务。
>
> **`useCreateCustomer` 在 `api/customers.ts`、`useLinkCustomer` 在 `api/messages.ts`**（Task 13 按域分的：一个改客户表，一个改会话头与消息归属）。两个 import 路径写反不会编译失败在语义上，只会让人下次找不到。

- [ ] **Step 6: `ConversationActions.tsx` + `MessageThread.headerExtra` + `MessagesPage` 接线**

先建会话头那颗"归属"区域：

```tsx
// src/renderer/src/components/messages/ConversationActions.tsx
import { useState } from 'react'
import { Languages, UserPlus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import CustomerDirectionDialog from '@/components/messages/CustomerDirectionDialog'
import CreateCustomerDialog from '@/components/messages/CreateCustomerDialog'
import { useCustomer } from '@/api/customers'
import { useTranslationSettings } from '@/api/translation'
import type { ConversationVO } from '@/api/messages'
import { directionSummary } from '@/lib/directionDraft'
import { canCreateCustomer } from '@/lib/createCustomerPrefill'

/**
 * 已关联会话的身份 + 语向入口。单独成组件是为了让两个按 customerId 取数的 hook
 * 只在"真的有一位客户"时挂载：`useTranslationSettings(null)` 会退化成读**全局**设置
 * （`settingsKeyOf` 的 null 分支），未关联的会话拿它显示"该客户的语向"就是假信息。
 */
function LinkedIdentity({ customerId }: { customerId: number }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const { data: settings } = useTranslationSettings(customerId)
  const { data: customer } = useCustomer(customerId)
  return (
    <>
      <Badge variant="outline" className="h-6 max-w-[160px] truncate border-0 bg-primary/10 px-2 text-[11px] text-primary" data-p6-customer-name="">
        {customer?.nickname ?? `客户 #${customerId}`}
      </Badge>
      <Button
        size="sm"
        variant="outline"
        className="h-7 shrink-0 gap-1 px-2 text-[11px]"
        data-p6-action="direction"
        onClick={() => setOpen(true)}
      >
        <Languages className="size-3.5" />
        语向
      </Button>
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground" data-p6-direction-summary="">
        {settings ? directionSummary(settings, 'send') : '…'}
      </span>
      <CustomerDirectionDialog customerId={customerId} open={open} onOpenChange={setOpen} />
    </>
  )
}

interface Props {
  conversation: ConversationVO
  onLinked: (customerId: number) => void
}

export default function ConversationActions({ conversation, onLinked }: Props): React.JSX.Element {
  const [createOpen, setCreateOpen] = useState(false)
  const creatable = canCreateCustomer(conversation)
  return (
    <div className="flex shrink-0 items-center gap-1.5" data-p6-actions="header">
      {conversation.customerId !== null && <LinkedIdentity customerId={conversation.customerId} />}
      {creatable && (
        <>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-[11px]"
            data-p6-action="create"
            onClick={() => setCreateOpen(true)}
          >
            <UserPlus className="size-3.5" />
            建为客户
          </Button>
          <CreateCustomerDialog
            conversation={conversation}
            open={createOpen}
            onOpenChange={setCreateOpen}
            onLinked={(id) => {
              setCreateOpen(false)
              onLinked(id)
            }}
          />
        </>
      )}
    </div>
  )
}
```

`MessageThread.tsx` 加插槽（Props 补一个字段，头部右侧那个 `{rows.length} 条` 的 `span` 换成下面这个 div）：

```tsx
interface Props {
  accountId: number
  conversation: ConversationVO
  anchor?: JumpTarget['anchor'] | null
  onClearAnchor?: () => void
  footer?: ReactNode
  /** 会话头右侧的动作区（Task 17 的「语向」与「建为客户」）。线程组件不认识那两个弹层。 */
  headerExtra?: ReactNode
}
```

```tsx
        <div className="flex shrink-0 items-center gap-2">
          {headerExtra}
          <span className="text-xs text-muted-foreground">{rows.length} 条</span>
        </div>
```

`MessagesPage.tsx` 的改动只有三处——import 补 `ConversationActions`、`useQueryClient`、`queryKeys`，state 之外加一个回调，`<MessageThread>` 多传一个 prop：

```tsx
  const qc = useQueryClient()

  /**
   * 关联成功的三件收尾事，少一件界面就开始说谎：
   * 1) 本地 `picked.customerId` 必须立刻改——它是「建为客户」按钮的显示条件。
   *    不改的后果是按钮还在原地，再点一次就给同一个 open_id 建出第二个客户（撞 40901）。
   * 2) 会话列表要重取（标题旁的归属标记、`customerId` 过滤都变了）。
   * 3) 消息与搜索命中要重取（link-customer 把消息行的 customer_id 补上了，
   *    Task 16 的「只看当前客户」过滤拿的就是这个字段）。
   */
  const handleLinked = (customerId: number): void => {
    setPicked((p) => (p ? { ...p, customerId } : p))
    void qc.invalidateQueries({ queryKey: queryKeys.root })
  }
```

`api/messages.ts` 的 `queryKeys` 补一个整片前缀（`root`），因为归属这个维度一动，`['msg', …]` 下面五份缓存同时过期，逐个点名一定会漏：

```ts
  /** 失效用的整片前缀：客户归属变了会同时波及会话、消息、搜索、统计与时间线。 */
  root: ['msg'] as const

> `root` 不取代 `conversationsRoot` / `statsRoot`：那两个是采集与发送链上的窄面失效（Task 13 / Task 15），每条消息进来都跑一遍，范围越窄越不浪费请求；`root` 只在"归属变了"这种低频跨面事件上用。留一个的代价要么是每个窄面都全量重取，要么是归属变更时逐个点名漏掉时间线。
```

```tsx
          <MessageThread
            accountId={selectedId}
            conversation={picked}
            anchor={anchor}
            onClearAnchor={() => setAnchor(null)}
            headerExtra={<ConversationActions conversation={picked} onLinked={handleLinked} />}
            footer={<ReplyComposer accountId={selectedId} conversation={picked} />}
          />
```

> 客户删除后 `chat_conversation.customer_id` 与 `chat_message.customer_id` 都还指着那个已删的 id——V8 的两列都不带外键，`DELETE /api/customers/{id}` 也不清归属（P3 的既有语义）。所以界面上的回落是「客户 #<不存在的 id>」而不是「陌生」，`useCustomer` 404 时 `customer` 为 undefined，Badge 用 `??` 兜住不炸。这条当前行为由 Step 7 第 13 行钉住，改不改是后续期的决定，不在本任务里悄悄动。

- [ ] **Step 7: 验证**

```bash
cd apps/desktop && pnpm run test:unit 2>&1 | tail -6 && pnpm run typecheck
```

预期：`# pass 76` / `# fail 0`（本轮没有新纯函数，弹层与表单不改计数）；四个 tsconfig 全绿。

CDP（C9 抬窗口、`visibilityState === 'visible'` 再动手；C10 点与键全走真实事件；后端在 8180）。前置：用 Task 3 的 batch 端点造一条 open_id 不在种子里的陌生单聊（`tmp/p6-task17-seed.mjs`，号码用 `8613900000777@c.us`），跑完按第 13 行收尾。

| # | 操作 | 断言 | 区分的是什么 |
|---|---|---|---|
| 1 | 选中那条陌生单聊 | `[data-p6-action="create"]` 存在；`[data-p6-action="direction"]` 不存在；`[data-p6-customer-name]` 不存在 | 未关联时只谈"建客户"，没有"该客户语向"可显示 |
| 2 | 选中一条群会话（`@g.us`） | 两个按钮都不存在 | `isGroup` 与 chat_key 形态双重否决（head 标错也挡住） |
| 3 | 真实鼠标点「建为客户」 | 弹层里 open_id 输入框是 `readOnly` 且值 === 该会话 `chatKey`；昵称预填会话 title；手机号预填裸号码（无 `@c.us`） | 预填真的来自 `prefillOfConversation`，不是空白表单 |
| 4 | 填昵称、点「建为客户并关联历史」 | 弹层自动关闭；`[data-p6-customer-name]` 出现该昵称；`[data-p6-action="create"]` 消失；`[data-p6-action="direction"]` 出现 | 两步真的连着走完（只看客户名会漏掉"link 没跑"），且 `picked` 的本地修正生效 |
| 5 | `curl` 该会话与它的消息 | `GET /api/conversations` 里这条 `customerId` 非空；`GET /api/messages` 里旧消息 `customerId` 全等于新客户 id | 历史回填发生在库里，不是前端 state 的错觉 |
| 6 | 再点一次「建为客户」（先手动把会话切走再切回，或用同号码的第二条会话） | 后端回 40901，弹层里出现「该平台下这个 open_id 已经有客户了」而不是笼统的 50000 | 撞唯一键与服务器崩溃在界面上必须可分 |
| 7 | 点「语向」 | Badge 文案是「沿用全局」；`[data-p6-direction-save]` 的 `disabled === true` | `dirtyCount` 的同义值归一在真数据上成立（全局行无论是 `''` 还是 `'auto'` 都不该谎报改动） |
| 8 | 真实鼠标改发信目标语言 | 按钮文案变成「保存（1 处改动）」且可点；点保存 → 弹层关闭；重开 → Badge 变「该客户专属」、「恢复全局」从 disabled 变可点 | PUT 带 `scope/scopeKey` 生效，`inherited` 真的翻转；第 7 行与这行合起来证明按钮不是恒灰也不是恒亮 |
| 9 | `curl` 两次 `GET /api/translation/settings`（带与不带 `customerId`） | 带 customerId → `scope:'customer'`、`inherited:false`、发信目标是刚选的语言；不带 → 全局值一字未变 | 覆盖行没顺手改掉全局（Task 6 契约第 10 行的前端对应物） |
| 10 | 回到记录页，打开「先译再发」，真实键盘敲一句中文发出去 | 气泡正文的目标语言就是第 8 行给这位客户选的语言（不是全局目标语言） | 生效面 ① 的完整闭环：设置改了、发送路径也跟着改了。只验弹层显示区分不出"存了但没人读" |
| 11 | 点「恢复全局」 | 弹层关闭；重开 → Badge 回到「沿用全局」、摘要回到全局值；`curl` 带 customerId 的 GET → `inherited:true` | DELETE 生效；且 disabled 条件（`inherited` 时不可点）不会把人困住 |
| 12 | 去翻译中心页 | 源/目标下拉照常可选（提取 `LangSelect` 之后 P5 未回归），改一次全局设置能保存并回显 | 提取动作没弄坏唯一的老调用方 |
| 13 | 收尾（C4 + 种子） | `DELETE /api/customers/<新建 id>`；复跑 `GET /api/customers?keyword=` 确认 DEMO 种子计数回到原值；**并记录**：该会话 `customerId` 仍指向已删 id（当前契约如此，删客户不清归属） | 测试痕迹清零，同时把"悬空归属"这条既有语义留成书面事实而不是靠下个人发现 |

第 4、7、8、10 行是本任务的硬证据。第 10 行尤其不能省：它是"设置存对了但没有任何人按它翻译"这类错误的唯一暴露口；第 7 行与第 8 行必须成对读，单看任何一行都能被"按钮恒灰 / 恒亮"糊过去。真实登录态缺失时第 10 行按 C11 标 blocked（它要走发送链），其余 12 行读的是库与 HTTP，不受影响。

- [ ] **Step 8: 提交**

```bash
git add apps/desktop/src/renderer/src/lib/createCustomerPrefill.ts apps/desktop/src/renderer/src/lib/createCustomerPrefill.test.ts apps/desktop/src/renderer/src/lib/directionDraft.ts apps/desktop/src/renderer/src/lib/directionDraft.test.ts apps/desktop/tsconfig.unit.json apps/desktop/src/renderer/src/components/translation/LangSelect.tsx apps/desktop/src/renderer/src/pages/TranslationPage.tsx apps/desktop/src/renderer/src/api/translation.ts apps/desktop/src/renderer/src/api/messages.ts apps/desktop/src/renderer/src/components/messages/CustomerDirectionDialog.tsx apps/desktop/src/renderer/src/components/messages/CreateCustomerDialog.tsx apps/desktop/src/renderer/src/components/messages/ConversationActions.tsx apps/desktop/src/renderer/src/components/messages/MessageThread.tsx apps/desktop/src/renderer/src/pages/MessagesPage.tsx
git commit -m "feat(P6): 会话头语向弹层与陌生建客户闭环（覆盖行 + 历史回填两步）"
```

---

### Task 17b: 内嵌页气泡按客户取语向（spec §8 生效面 ②）

**执行顺序**：紧跟 Task 17、在 Task 18 之前跑。编号取 `17b` 是为了不重排 Task 18/19 与它们身上的全部交叉引用（"Task 18 的时间线""Task 19 的端到端"在计划里出现二十多次，重排一次就要复核二十多次）。

**Files:**
- Modify: `apps/server/src/main/java/com/smartscrm/server/web/dto/TranslateDTO.java`（尾部 +`chatKey`、+`accountId`）
- Modify: `apps/server/src/main/java/com/smartscrm/server/service/TranslationService.java`（+`customerOfChat`，`translate()` 顶部改走"显式 customerId → 会话投影 → 全局"）
- Modify: `apps/desktop/src/main/services/translationBridge.ts`（`requestTranslation(req, ctx, apiBase?)`）
- Modify: `apps/desktop/src/main/webContentsView/ipc.ts:77-98`（`view:invoke` 按 `viewId` 盖章）
- Modify: `apps/desktop/src/inject/core/translation/translationQueue.ts`（请求 +`chatHint`，去重键改走 `translateKey`）
- Create: `apps/desktop/src/shared/translateKey.ts` · `translateKey.test.ts`
- Modify: `apps/desktop/src/inject/core/translation/domScan.ts`、`apps/desktop/src/inject/core/translation/inputPreview.ts`（请求带上页内会话提示）
- Modify: `apps/desktop/src/inject/core/PlatformAdapter.ts`（+`chatHint(): string | null`，基类返回 null）、`apps/desktop/src/inject/platforms/whatsapp/index.ts`（实现：读 `document.title`）
- Modify: `apps/server/src/main/java/com/smartscrm/server/service/provider/TencentProvider.java`（补上 `from='auto'` 的对称缺口——Task 6 只放了百度那侧，腾讯渠道配 `auto` 仍会静默降级到模拟引擎；本任务的会话投影会把 `auto` 带上这条路径，缺口从"潜伏"变成"会被踩到"。改法与 Task 6 的 `BaiduProvider` 同形，`TencentProviderTest` 保持全绿）

**Interfaces:**
- Consumes: Task 6 的 `ScopeSettings.resolve(customerId, customer, global)` 与 `customerRow(tenantId, customerId)`、Task 1 的 `ChatConversation`（`uk_conv = (tenant_id, platform, account_id, chat_key)`）、Task 10 的 `accountOfView(viewId): AccountEntry | null`、Task 10/11 的 `activeChatOf(viewId): string | null`。
- Produces:
  - `POST /api/translation/translate` 的 body 多两个可空字段：`accountId?: number`、`chatKey?: string`。生效语向的解析顺序固定为 **① 显式 `customerId` → ② `(tenantId, accountId, chatKey)` 命中的 `chat_conversation.customer_id` → ③ 全局**，② 是 ① 的缺省填充而不是覆盖它的另一条通道。
  - `src/shared/translateKey.ts`：`interface TranslateKeyInput { type: 'send' | 'receive'; input?: boolean; chatHint?: string | null; text: string }`、`function translateKey(req: TranslateKeyInput): string`。
  - `PlatformAdapter.chatHint(): string | null`（与 `isOutgoingMessage` 同族的"平台给不出就返回 null"口径）。**它只进本页的 inflight 去重键，永远不出页、不进请求体**——注入层保持 P5 §4 的 DOM-only 边界，不读 `window.WPP`（那是桥 bundle 的地盘），所以页内拿不到也拿不准真正的 `chatKey`，这不是缺口。

**三条口径（写进对应文件的注释，不要只留在这里）**

1. **后端只认主进程盖的章。** `ipc.ts` 从 `arg.data` 里只挑 `text / type / input / noCache`，页面上报的其它字段一律丢弃；`accountId` 与 `chatKey` 由主进程按 `event.sender` 反查出的 `viewId` 自己填。于是页面永远说不出"我属于哪个账号的哪个会话"，一个错映射最多让语向选错，不会让它读到别人的客户行（查询还额外带 `tenant_id`）。
2. **投影即时效。** `activeChatOf(viewId)` 是主进程手里"这个视图正在看哪个会话"的最后一份已知值（桥的 `active_chat` 事件 + 命令驱动上报）。切了会话而事件没到时，气泡会按上一个会话的客户语向多译一次；下一轮扫描 msgId 变了自然纠正。不为此加页内轮询，也不加"会话切换"专属的失效广播。
3. **不新增缓存失效逻辑。** `buildCacheKey(type, channel, fromLang, toLang, normalized)` 里已经含两侧语种，客户语向天然分键（Task 6 契约第 5 条已核过一次，本任务第 7、8 行再按 ② 的路径核一次）。

- [ ] **Step 1: 后端接受 `accountId` / `chatKey` 并按会话投影解析客户**

```java
// TranslateDTO.java —— 尾部追加，都可空：不带即按全局译，P5 的调用方一字不改
    @Size(max = 128) String chatKey,
    Long accountId
```

```java
    /**
     * 生效面 ②：把"当前会话"换成客户 id。三种情况一律返回 null 回落全局——
     * 请求没带齐 accountId/chatKey、查不到会话行、行上没挂客户。
     * 只按 uk_conv 的三列精确匹配，不做前缀模糊：猜错语向译出的是别人家的语言，
     * 比"没译"更难排查。
     */
    private Long customerOfChat(Long tenantId, Long accountId, String chatKey) {
        if (accountId == null || chatKey == null || chatKey.isBlank()) {
            return null;
        }
        ChatConversation conv = conversationMapper.selectOne(new LambdaQueryWrapper<ChatConversation>()
            .eq(ChatConversation::getTenantId, tenantId)
            .eq(ChatConversation::getAccountId, accountId)
            .eq(ChatConversation::getChatKey, chatKey)
            .last("LIMIT 1"));
        return conv == null ? null : conv.getCustomerId();
    }
```

`translate()` 顶部把 Task 6 写下的那两行的入参换掉（其余逻辑一律不动）：

```java
        Long customerId = dto.customerId() != null
            ? dto.customerId()
            : customerOfChat(tenantId, dto.accountId(), dto.chatKey());
        TranslationSetting customer = customerId == null ? null : customerRow(tenantId, customerId);
        ScopeSettings.Resolved resolved = ScopeSettings.resolve(customerId, customer, requireSettings(tenantId));
        TranslationSetting s = resolved.setting();
```

构造函数注入 `ChatConversationMapper conversationMapper`（`TranslationService` 已经直接持有 setting / cache / node 三张 mapper，多一张同族）。

> **本步不写 JUnit**：`显式 customerId 优先，否则查投影` 的判定要连着 MyBatis 查询与 HTTP 才有意义，把那个三元表达式抽成纯函数再测一遍是不可能失败的检查（项目里已有教训：断言"传 null 返回 null"这种同义反复，红了绿了都不说明任何事）。判定全部落在 Step 2 的契约表上。

- [ ] **Step 2: 编译 + 重启 + 后端契约 `tmp/p6c-chatkey-direction.mjs`**

`set -o pipefail && MAVEN_OPTS="-Duser.language=en -Duser.country=US" ./mvnw -o -DskipTests package`，按 C8 重启 :8180。脚本用 Write 落成 UTF-8 文件，一次跑完打印 PASS/FAIL 表（`login()` → `check(name, cond, detail)`）。

**前置（先探再断）**：`GET /api/platform-accounts` 现取一个 WA 账号 id；`GET /api/conversations?accountId=<wa>&size=50` 里找 `chatKey === '8613800001001@c.us'` 的那一行，读出它的 `customerId`（Task 3/4 的 open_id 自动匹配应当已经把它挂上 Alice）。**读不到这一行就整批判 blocked 并退出**（C11）——契约脚本里不许顺手 `batch` 补数据来凑前置，那是 Task 3 的活。

| # | 断言 | 期望 |
|---|---|---|
| 1 | `PUT /api/translation/settings` body `{scope:'customer', scopeKey:<aliceId>, receiveFromLang:'en', receiveToLang:'vi'}` | `code:0`、`scope:'customer'`、`inherited:false` |
| 2 | `POST /api/translation/translate` `{text:'Good morning', type:'receive', accountId:<wa>, chatKey:'8613800001001@c.us'}` | `toLangCode === 'vi'` |
| 3 | 同 `text`/`type`，**不带** `accountId`/`chatKey` | `toLangCode` 等于全局接收目标语种（V5 种子 `zh-CN`）——与第 2 行必须不同，否则 ② 与"字段被忽略"无从区分 |
| 4 | `accountId` 换成 TG 账号 id，`chatKey` 仍是那个 `86…@c.us` | `code:0` 且 `toLangCode` 回到全局：平台错配的 chatKey 既不该 400，也不该串到别的客户（`(tenant, tg, '86…@c.us')` 在 `uk_conv` 上没有行） |
| 5 | `chatKey:'8613800009999@c.us'`（库里没有的会话）+ 正确 `accountId` | 全局语向（陌生会话跟全局，spec §8 的默认） |
| 6 | 同一请求里同时给 `customerId:<bobId>` 与 Alice 的 `chatKey` | 走 **Bob** 的语向。前置：先给 Bob 也建一条覆盖行且 `receiveToLang` 与 Alice 的 `vi` 不同（两行写成同一种语言就是一条空断言） |
| 7 | 第 2 行原样重发 | `cached === true` 且 `toLangCode === 'vi'`（客户语向进了缓存键，不是每次重算） |
| 8 | `DELETE /api/translation/settings/customer/<aliceId>` 之后重发第 2 行 | `toLangCode` 回到全局，且**不是**第 7 行那条 `vi` 缓存的命中（缓存分键的反证：删行即回落，同时证明第 7 行的 `cached` 来自客户键而非全局键） |

```bash
node tmp/p6c-chatkey-direction.mjs
```

收尾（C4）：脚本最后打印 `GET /api/translation/settings?customerId=<aliceId>` 的 `inherited:true`（覆盖行确清），并打印本轮 `translation_cache` 的行数增量——该表只增不减，新增若干行属预期；DEMO 种子计数不受影响（本任务不碰 `customer` 表）。

- [ ] **Step 3: 注入层的请求去重键按会话分开（先写失败测试）**

```ts
// apps/desktop/src/shared/translateKey.ts
export interface TranslateKeyInput {
  type: 'send' | 'receive'
  input?: boolean
  chatHint?: string | null
  text: string
}

/**
 * 同一段原文在两个会话里可能走两个语向（生效面 ②）。inflight 去重键必须把会话算进去：
 * 少了它，切会话时后到的那次会复用前一会话的 promise，把上一个会话客户的语种画到
 * 这个会话的气泡上，而 `isTranslated` 会把画错的那一行一直留着。
 *
 * `chatHint` 是页内能给出的**会话提示**（平台自己给的名字/标题一类），不是 `chatKey`：
 * 注入层不读平台内部对象，真正的 `chatKey` 由主进程盖章、只有主进程那份进后端。
 * 提示撞车（两个会话同名）时最多退化成今天的共用一次 promise，不会比现状更坏。
 */
export function translateKey(req: TranslateKeyInput): string {
  return `${req.type}|${req.input === true ? 'i' : 'f'}|${req.chatHint ?? ''}|${req.text}`
}
```

```ts
// apps/desktop/src/shared/translateKey.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { translateKey } from './translateKey.ts'

test('same text in two chats are two requests', () => {
  const a = translateKey({ type: 'receive', chatHint: 'Alice', text: 'Good morning' })
  const b = translateKey({ type: 'receive', chatHint: 'Bob', text: 'Good morning' })
  assert.notEqual(a, b)
})

test('chat hint changes nothing else about the key', () => {
  assert.equal(
    translateKey({ type: 'receive', chatHint: null, text: 'x' }),
    translateKey({ type: 'receive', text: 'x' }),
    'null 与不带提示都是"没有会话上下文"，不该分两次请求'
  )
})

test('input preview never shares a slot with a bubble', () => {
  assert.notEqual(
    translateKey({ type: 'send', input: true, chatHint: 'Alice', text: '你好' }),
    translateKey({ type: 'send', chatHint: 'Alice', text: '你好' })
  )
})
```

```bash
pnpm --dir apps/desktop test:unit
```

预期：`Cannot find module './translateKey.ts'`（RED，实现文件还没建）；建完文件后 `# pass 79` / `# fail 0`（Task 17 结束的 76 + 本任务 3）。

`translationQueue.ts` 两处改动：

```ts
import { translateKey } from '../../../shared/translateKey'

export interface TranslateRequest {
  text: string
  type: 'receive' | 'send'
  input?: boolean
  noCache?: boolean
  /** 页内此刻看的会话提示。只用于本页 inflight 去重；到后端的那份由主进程重新盖章。 */
  chatHint?: string | null
}
```

并把 `const key = \`${req.type}|${req.input === true ? 'i' : 'f'}|${req.text}\`` 换成 `const key = translateKey(req)`。

> 两处 import 后缀写法不同是有原因的：闸门那侧 `tsconfig.unit.json` 开了 `allowImportingTsExtensions`，必须写 `./translateKey.ts`；注入层走 `tsconfig.inject.json`（没开那条），写无后缀的相对路径，esbuild 按字面解析。给注入层补一条 `.ts` 后缀会让 `pnpm --dir apps/desktop run typecheck:inject` 直接红。

- [ ] **Step 4: 页内给自己一个"这是哪个会话"的提示**

注入层是 DOM-only 的（P5 §4 的既定边界：它不读平台内部对象，也不 import 桥 bundle 的任何东西）。所以这一步要的**不是**真正的 `chatKey`——真正的 `chatKey` 只有主进程那份算数（Step 5）——页内只需要一个"这次请求属于哪一个会话画面"的提示串，用来把 inflight 去重键分开。

```ts
// PlatformAdapter.ts —— 与 isOutgoingMessage 同一族口径：平台给不出就是 null
  /**
   * 页内此刻在跟谁说话的一个提示串。只用于本页的请求去重，不进请求体、不参与任何语种判定。
   * 名字故意不叫 chatKey：那是主进程盖章的字段，两者不是一个东西。
   */
  chatHint(): string | null {
    return null
  }
```

```ts
// platforms/whatsapp/index.ts
  /**
   * WhatsApp 打开某个会话时把会话名写进 `document.title`（P5 的 `getUserInfo` 已经在读它，
   * 连未读后缀 `(...)` 都是它剥的）。这是一条纯 DOM 事实，不需要平台内部对象。
   */
  chatHint(): string | null {
    return document.title.trim() || null
  }
```

两个已知退化，都写明在注释里、不额外修补：① 两个会话同名 → 提示撞车，退化成今天这样共用一次 promise；② 未读后缀会让同一会话在不同时刻给出不同提示 → 多一次请求，后端缓存仍然分键挡住。**都不影响正确性，只影响多问一次**。

调用点各一行（`domScan.ts` 的 `requestTranslate(injector, { text, type })`、`inputPreview.ts` 的 preview 与回车前两处 `requestTranslate(...)`）：

```ts
    const result = await requestTranslate(injector, { text, type, chatHint: adapter.chatHint() })
```

`inputPreview.ts` 里两处同理带上 `chatHint: adapter.chatHint()`——输入框里的草稿就是发给此刻这个会话的，② 对它同样成立（记录页回复框那条走的是 ①，与本任务无关）。

`TranslateRequest` 新增的 `chatHint?: string | null` 只活在页内：`ipc.ts` 的 `view:invoke` 是从 `arg.data` 里**挑**字段重组 body 的（`text / type / input / noCache`），没进清单的字段天然到不了后端——**不要为了"顺手"把 `chatHint` 加进那份清单**，那等于把语种判定权交回页面。

- [ ] **Step 5: 主进程盖章**

```ts
// translationBridge.ts
export interface TranslateContext {
  accountId?: number
  chatKey?: string
}
```

`requestTranslation(req, ctx: TranslateContext = {}, apiBase?: string)`——body 换成 `JSON.stringify({ ...req, ...ctx })`。全仓只有 `ipc.ts:87` 一个调用点，直接把参数顺序改掉，不留兼容重载。

```ts
// webContentsView/ipc.ts，view:invoke 里 requestTranslation 之前
      const entry = accountOfView(viewId)
      const activeChat = activeChatOf(viewId)
      // 后端那列是 VARCHAR(128)，超长会让整次翻译 400、页内只看得见"没译文"，所以在盖章处就丢掉。
      const chatKey = activeChat && activeChat.length <= 128 ? activeChat : undefined
      return requestTranslation(
        {
          text,
          type,
          ...(req?.input === true ? { input: true } : {}),
          ...(req?.noCache === true ? { noCache: true } : {})
        },
        {
          ...(entry ? { accountId: entry.accountId } : {}),
          ...(chatKey ? { chatKey } : {})
        },
        typeof apiBase === 'string' ? apiBase : undefined
      )
```

> 桥还没挂上（Task 10 之前、未登录、或 `activeChatOf` 还是 null）时两个字段都不带——后端那三档解析自然落到全局语向，P5 的行为一字不变。这条回落路径不是"没做完"，是 ② 的默认态。

- [ ] **Step 6: 真实内嵌页端到端 `tmp/p6c-page-direction.mjs`（需真实登录态）**

前置按 C9/C10：`pnpm --dir apps/desktop exec electron-vite dev --remoteDebuggingPort 9223`、`tmp/p5c-top.ps1` 抬窗、断言 `document.visibilityState === 'visible'`；页内插桩沿用 P5 §6.3 的既有口径——`window.__SCRM_INJECTOR__` 是 contextBridge 对象，直接赋值会被吞，必须用属性 setter 预装后再包 `injector.invoke`，把每笔 `{ channel, req, res }` 记进 `window.__REQS__`。

| # | 动作 | 断言 |
|---|---|---|
| 1 | 找出此刻页内会话：`GET /api/conversations?accountId=<wa>&size=50` 的第一行（自聊），记下它的 `conversationId` 与 `customerId` 原值 | 拿到行（拿不到 = 采集没跑通，本步整块 blocked，先回 Task 11 而不是在这里造数据） |
| 2 | `POST /api/customers {platformType:1, openId:<该会话 chatKey>}` → `POST /api/conversations/<id>/link-customer` | `code:0`、`messagesLinked` 打印出来；这个客户就是"这个会话的人" |
| 3 | `PUT /api/translation/settings` 给该客户 `sendFromLang:'zh-CN'`, `sendToLang:'vi'`（全局发送向保持种子 `en`） | `inherited:false` |
| 4 | 回工作台重新注入、等首扫落定 | 同一条**中文发出气泡**（R1 走 send）：`res.toLangCode === 'vi'` 且页面挂出的译文行与第 6 行那次不同 —— 这一行是 ② 的端到端证据：语种只能由"主进程盖的 chatKey → 后端查到的 customer_id"这条路得出，页面上报不了 |
| 5 | 顺带核对陌生会话：`GET /api/conversations?accountId=<wa>` 里挑一条 `customerId` 为空的会话（自聊没有第二条就标 `n/a`），它的气泡 `res.toLangCode` | 仍是全局 `en`（同一次注入里两种语向并存，才算"按客户"而不是"按最后一次设置"） |
| 6 | `DELETE /api/translation/settings/customer/<id>` → 触发一次重新扫描（`translationRevision` 递增那条例外路径） | 中文气泡的译文行回到英文；`res.toLangCode === 'en'` |
| 7 | 收尾（C4）：`DELETE /api/translation/settings/customer/<id>` + `DELETE /api/customers/<id>`；**若第 1 行读到的 `customerId` 原本非空，先 `link-customer` 回那个原值**；打印 `GET /api/customers` 的总数回到 5、`chat_conversation` 该行 `customerId` 的落点（原本为空时它仍指向已删 id——Task 17 第 13 行钉过的既有语义）、`translation_setting` 里 `scope='customer'` 的行数回到本轮开始前、草稿框为空 | 三个计数逐一打印，不静默 |

```bash
node tmp/p6c-page-direction.mjs
```

无真实登录态时本步整块标 blocked（C11），并写明"生效面 ② 的页内端到端未验证；Step 2 的 HTTP 面已验"。不接受用 curl 的结果冒充这一步。

- [ ] **Step 7: 文档回填**

- spec `docs/superpowers/specs/2026-09-20-chat-history-design.md` §8"按客户语向"那一行：生效面 ② 的落地口径写成"主进程按 `viewId` 盖 `accountId`+`chatKey`，后端按 `chat_conversation` 投影出 `customer_id`；页面上报的会话不进后端"。
- 本计划"对 spec 的十三处收敛"第 13 条与"与后续阶段的三条硬缝"第 3 条：从"本计划不做 ②"改为"② 由 Task 17b 落地"，并把当时写的三段缺口各自指到承接点（`activeChatOf` / `accountOfView` 在 Task 10/11、后端投影在 17b Step 1、页内去重键在 Step 3）。
- Task 19 Step 7 第 1、3 条：已知限制清单里"内嵌页气泡不跟客户语向"那一条删掉，换成实测结论；`docs/notes/…-verification.md` 的 ② 段落指到本任务两张表。
- P5 spec `docs/superpowers/specs/2026-09-19-translation-center-design.md` §4.2 的"页面说不出语种/渠道/令牌"那句旁边补一行：它同样说不出账号与会话——② 之后这两个字段由主进程注入。

- [ ] **Step 8: 提交**

```bash
cd /d/SmartSCRM && git add apps/server/src/main/java/com/smartscrm/server/web/dto/TranslateDTO.java apps/server/src/main/java/com/smartscrm/server/service/TranslationService.java apps/desktop/src/shared/translateKey.ts apps/desktop/src/shared/translateKey.test.ts apps/desktop/src/inject/core/translation/translationQueue.ts apps/desktop/src/inject/core/translation/domScan.ts apps/desktop/src/inject/core/translation/inputPreview.ts apps/desktop/src/inject/core/PlatformAdapter.ts apps/desktop/src/inject/platforms/whatsapp/index.ts apps/desktop/src/main/services/translationBridge.ts apps/desktop/src/main/webContentsView/ipc.ts docs/superpowers/specs/2026-09-20-chat-history-design.md docs/superpowers/specs/2026-09-19-translation-center-design.md docs/superpowers/plans/2026-09-20-chat-history.md
git commit -m "feat(P6): 内嵌页气泡按客户取语向（生效面 ②：主进程盖会话，后端按投影解析）"
```

`tmp/p6c-chatkey-direction.mjs` / `tmp/p6c-page-direction.mjs` 不入库。提交前跑一遍全量闸门：`./mvnw -o test`、`pnpm --dir apps/desktop test:unit`、`pnpm --dir apps/desktop run typecheck`，并把 `node tmp/p5-manual.mjs bubbles` 复跑一次——Step 3/4 动了 P5 那条链的请求构造，8/8 不退化才算完。

---

### Task 18: 客户抽屉时间线与「跳回记录页」

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/chatTimeline.ts`
- Test: `apps/desktop/src/renderer/src/lib/chatTimeline.test.ts`
- Modify: `apps/desktop/tsconfig.unit.json`（`include` 追加两个名字）
- Create: `apps/desktop/src/renderer/src/stores/chatJump.ts`
- Modify: `apps/desktop/src/renderer/src/components/messages/MessageThread.tsx`（根节点补 `data-p6-thread="<会话 id>"`）
- Create: `apps/desktop/src/renderer/src/components/customers/CustomerTimeline.tsx`
- Modify: `apps/desktop/src/renderer/src/components/customers/CustomerDrawer.tsx:218-221`（标签段之后、滚动容器收尾之前插入时间线段）
- Modify: `apps/desktop/src/renderer/src/pages/MessagesPage.tsx`（消费一次性投递）

**Interfaces:**
- Consumes: Task 5 的 `GET /api/customers/{id}/timeline?size`；Task 13 的 `useCustomerTimeline(id, size)` / `rowOfMessage(m)` / `ThreadRow` / `ConversationVO`；Task 14 的 `MessageBubble` / `titleOfConversation`、`chatDays` 的 `listTime`；Task 16 的 `isGroupChatKey`；既有 `useCustomer`（抽屉已经把整份 `CustomerVO` 传进来了，不需要再查）、`useNavigate`、zustand。
- Produces（Task 19 只认这些）：
  - `lib/chatTimeline`：`interface TimelineHead { chatKey: string; title: string | null; isGroup: boolean }`、`interface TimelineGroup<T> { chatKey: string; title: string; isGroup: boolean; lastTs: number; rows: T[] }`、`groupByConversation<T extends { chatKey: string; ts: number }>(messages, heads): TimelineGroup<T>[]`
  - `stores/chatJump`：`useChatJumpStore`（`target: ConversationVO | null`、`hold(c)`、`clear()`）
  - `CustomerTimeline`：props `{ customerId: number }`，DOM 上带 `data-p6-timeline="list|empty"`、`data-p6-timeline-group="<chatKey>"`、`data-p6-timeline-jump="<chatKey>"`
  - `MessageThread` 根节点的 `data-p6-thread="<conversationId>"`：跨页跳转的精确落点选择器（此前只能按标题文本来断"选中了哪条会话"）
- 不做（留给后面）：真实登录态端到端（Task 19）、时间线翻页（端点只有 `size`，没有游标；`SIZE = 20` 就是产品口径"最近消息"）。

> 为什么"按会话切成卡片"而不是一条混合流：`CustomerTimelineVO` 给的就是 `messages` + `conversations` 两份，一位客户常常同时有 WhatsApp 单聊和一个群、甚至两个账号。混合流要在每条气泡上标"来自哪个会话"，读起来比卡片更累；而卡片天然给出可点的落点（跳回记录页必须是整条会话，不是流里的某一行）。
>
> 唯一值得进闸门的判断是"消息落到哪张卡片、卡片怎么排序"：一条不属于任何会话头的消息（size 截断、或会话头还没投影出来）如果按 `Map.get()` 的结果直接跳过，它就在时间线上**凭空消失**——而 `messageCount` 仍写着总数，页面对不上库。这类"少了两条"的 bug 在界面上要人肉数气泡才看得出来，在 node 里是一行 `assert.equal(total, input.length)`。

- [ ] **Step 1: `lib/chatTimeline.ts`——消息按会话成组**

先写测试：

```ts
// src/renderer/src/lib/chatTimeline.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupByConversation, type TimelineHead } from './chatTimeline.ts'

const msg = (chatKey: string, id: number, ts: number): { chatKey: string; ts: number; id: number } => ({
  chatKey,
  ts,
  id
})

const head = (chatKey: string, title: string | null, isGroup = false): TimelineHead => ({
  chatKey,
  title,
  isGroup
})

test('两条会话交错输入：卡片按各卡最后一条倒序，组内按时间正序，一条不丢', () => {
  const input = [
    msg('a@c.us', 1, 10),
    msg('b@c.us', 2, 50),
    msg('a@c.us', 3, 20),
    msg('b@c.us', 4, 30)
  ]
  const out = groupByConversation(input, [head('a@c.us', 'Alice'), head('b@c.us', 'Bob')])
  assert.deepEqual(
    out.map((g) => [g.chatKey, g.lastTs, g.rows.map((r) => r.id)]),
    [
      ['b@c.us', 50, [4, 2]],
      ['a@c.us', 20, [1, 3]]
    ]
  )
  const total = out.reduce((n, g) => n + g.rows.length, 0)
  assert.equal(total, input.length)
})

test('没有会话头的 chatKey 照样成组：标题回落到号码，群按形态判，一条都不许掉', () => {
  const out = groupByConversation([msg('120363000000000000@g.us', 1, 5), msg('86138@c.us', 2, 6)], [])
  assert.deepEqual(
    out.map((g) => [g.title, g.isGroup]),
    [
      ['86138', false],
      ['120363000000000000', true]
    ]
  )
  assert.equal(out.reduce((n, g) => n + g.rows.length, 0), 2)
})

test('head 说不是群、键是 @g.us 形态：以形态为准', () => {
  const out = groupByConversation([msg('999@g.us', 1, 5)], [head('999@g.us', '项目组', false)])
  assert.equal(out[0].isGroup, true)
  // 标题仍取 head 给的（形态只影响"是不是群"这一项）。
  assert.equal(out[0].title, '项目组')
})

test('空输入给空数组；同一会话的消息被打乱也不会裂成两张卡', () => {
  assert.deepEqual(groupByConversation([], [head('a@c.us', 'A')]), [])
  const out = groupByConversation([msg('a@c.us', 1, 30), msg('a@c.us', 2, 10), msg('a@c.us', 3, 20)], [head('a@c.us', 'A')])
  assert.equal(out.length, 1)
  assert.deepEqual(out[0].rows.map((r) => r.id), [2, 3, 1])
})
```

```bash
cd apps/desktop && node --test "src/renderer/src/lib/chatTimeline.test.ts" 2>&1 | tail -8
```

预期：`Cannot find module '.../chatTimeline.ts'`。

实现：

```ts
// src/renderer/src/lib/chatTimeline.ts
import { isGroupChatKey } from '@shared/chatKeys'

/** `ConversationVO` 里时间线用到的那三个字段（闸门里不 import `@/api/messages`）。 */
export interface TimelineHead {
  chatKey: string
  title: string | null
  isGroup: boolean
}

export interface TimelineGroup<T> {
  chatKey: string
  /** 会话头缺 title 时回落到 `chatKey` 的 `@` 前缀——与 `lib/chatDisplay.titleOfConversation` 同一条规则（那边引 `@/api/messages`，闸门里引不到，宁可写两遍也别把 react-query 拖进 node --test）。 */
  title: string
  isGroup: boolean
  /** 该卡里最后一条消息的时间：排序只看它，不看会话头的 `lastMsgTime`（那是投影值，可能比这批消息新）。 */
  lastTs: number
  rows: T[]
}

/**
 * 按 `chatKey` 切卡片。用 Map 而不是"相邻同键归并"：输入是后端的 `msg_time` 正序，
 * 但两条会话交错时相邻判等会把一条会话拆成好几张卡（第 4 条用例钉的就是这个）。
 */
export function groupByConversation<T extends { chatKey: string; ts: number }>(
  messages: readonly T[],
  heads: readonly TimelineHead[]
): TimelineGroup<T>[] {
  const headOf = new Map(heads.map((h) => [h.chatKey, h]))
  const groups = new Map<string, TimelineGroup<T>>()
  for (const row of messages) {
    let group = groups.get(row.chatKey)
    if (!group) {
      const head = headOf.get(row.chatKey)
      group = {
        chatKey: row.chatKey,
        title: head?.title?.trim() || row.chatKey.split('@')[0] || row.chatKey,
        isGroup: head ? head.isGroup || isGroupChatKey(row.chatKey) : isGroupChatKey(row.chatKey),
        lastTs: row.ts,
        rows: []
      }
      groups.set(row.chatKey, group)
    }
    group.rows.push(row)
    if (row.ts > group.lastTs) group.lastTs = row.ts
  }
  for (const group of groups.values()) group.rows.sort((a, b) => a.ts - b.ts)
  return [...groups.values()].sort((a, b) => b.lastTs - a.lastTs)
}
```

`tsconfig.unit.json` 的 `include` 追加两行：

```jsonc
"src/renderer/src/lib/chatTimeline.ts",
"src/renderer/src/lib/chatTimeline.test.ts"
```

```bash
cd apps/desktop && pnpm run test:unit 2>&1 | tail -6 && pnpm run typecheck
```

预期：`# pass 83` / `# fail 0`（Task 17b 结束的 79 + 本任务 4）；typecheck 全绿。

- [ ] **Step 2: `stores/chatJump.ts` 与线程根节点的选择器**

```ts
// src/renderer/src/stores/chatJump.ts
import { create } from 'zustand'
import type { ConversationVO } from '@/api/messages'

interface ChatJumpState {
  /** 待选会话：抽屉点了「打开」之后、`MessagesPage` 挂载之前挂在这里。 */
  target: ConversationVO | null
  hold: (conversation: ConversationVO) => void
  clear: () => void
}

/**
 * 为什么是 store 而不是路由参数：跳过去要用的是**整条 `ConversationVO`**
 * （`accountId` + `chatKey` + `isGroup` + `customerId`），而 chat_key 里有 `@`、`.`、
 * 群 id 的连字符——塞进 hash query 要做编解码、会被截断显示、还把号码暴露在标题栏。
 * 抽屉里那份本来就是后端刚给的真实形状，直接递过去最省事。
 * `useSelectionStore`（账号维度的选中态）已经是同一个模式，这里不是新发明。
 */
export const useChatJumpStore = create<ChatJumpState>((set) => ({
  target: null,
  hold: (conversation) => set({ target: conversation }),
  clear: () => set({ target: null })
}))
```

`MessageThread.tsx` 的根 div 补一个 id 属性（`Props` 不变）：

```tsx
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-p6-thread={conversation.id}>
```

- [ ] **Step 3: `CustomerTimeline.tsx`**

```tsx
// src/renderer/src/components/customers/CustomerTimeline.tsx
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUpRight, MessageSquareDashed } from 'lucide-react'
import { Button } from '@/components/ui/button'
import MessageBubble from '@/components/messages/MessageBubble'
import { rowOfMessage, useCustomerTimeline, type ConversationVO } from '@/api/messages'
import { groupByConversation } from '@/lib/chatTimeline'
import { titleOfConversation } from '@/lib/chatDisplay'
import { listTime } from '@/lib/chatDays'
import { useChatJumpStore } from '@/stores/chatJump'

/** 产品口径就是"最近消息"：端点只有 `size`，没有游标，这里也不做翻页。 */
const SIZE = 20

export default function CustomerTimeline({ customerId }: { customerId: number }): React.JSX.Element {
  const { data, isPending, isError } = useCustomerTimeline(customerId, SIZE)
  const navigate = useNavigate()
  const hold = useChatJumpStore((s) => s.hold)

  // ThreadRow 是气泡唯一吃的行形状（Task 13），时间线复用气泡就不许再造第二种行。
  const groups = useMemo(
    () => (data ? groupByConversation(data.messages.map(rowOfMessage), data.conversations) : []),
    [data]
  )
  /** 跳转要整份 `ConversationVO`；回落组（没有会话头）拿不到 `accountId`，只能不给按钮。 */
  const headOf = useMemo(() => {
    const map = new Map<string, ConversationVO>()
    for (const c of data?.conversations ?? []) map.set(c.chatKey, c)
    return map
  }, [data])

  if (isPending) return <p className="text-xs text-muted-foreground">读取最近消息…</p>
  if (isError) return <p className="text-xs text-destructive">读不到时间线，请确认后端已启动。</p>
  if (groups.length === 0) {
    return (
      <p data-p6-timeline="empty" className="text-xs text-muted-foreground">
        还没有采到这位客户的消息。
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3" data-p6-timeline="list">
      {groups.map((group) => {
        const head = headOf.get(group.chatKey)
        return (
          <section
            key={group.chatKey}
            data-p6-timeline-group={group.chatKey}
            className="rounded-xl border border-border/60 px-3 pt-2 pb-1"
          >
            <header className="mb-1 flex items-center gap-2">
              <MessageSquareDashed className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                {head ? titleOfConversation(head) : group.title}
                {group.isGroup && <span className="ml-1 text-[10px] text-muted-foreground">群</span>}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground">{listTime(group.lastTs)}</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 shrink-0 gap-1 px-1.5 text-[11px]"
                data-p6-timeline-jump={group.chatKey}
                disabled={!head}
                title={head ? '在聊天记录页打开这个会话' : '这条会话的会话头还没投影出来，暂时跳不过去'}
                onClick={() => {
                  if (!head) return
                  hold(head)
                  navigate('/messages')
                }}
              >
                <ArrowUpRight className="size-3" />
                打开
              </Button>
            </header>
            {group.rows.map((row) => (
              <MessageBubble key={row.msgKey} row={row} showSender={group.isGroup} />
            ))}
          </section>
        )
      })}
    </div>
  )
}
```

两点口径：

1. **不给卡片内部套滚动**：抽屉本身已经是一个 `overflow-y-auto` 的滚动区（`CustomerDrawer.tsx:117`），卡片再套一层就是"滚轮在谁身上"的猜谜；总共最多 `SIZE` 条气泡，跟着抽屉一起滚比嵌套滚动好读。
2. **`MessageBubble` 原样复用**：日头、群发送人小字、媒体占位、out 状态图标全部继承记录页的画法。时间线不画自己的一套气泡，是"两处气泡会长得不一样"这个坑的唯一防法。

- [ ] **Step 4: 抽屉接线与记录页消费投递**

`CustomerDrawer.tsx`：import 补 `CustomerTimeline`，在标签段收尾的 `</div>`（第 220 行）之后、滚动容器收尾（第 221 行）之前插入：

```tsx
          <Separator className="my-5" />
          <div>
            <h3 className="mb-2 text-sm font-semibold">最近消息</h3>
            <CustomerTimeline customerId={customer.id} />
          </div>
```

`MessagesPage.tsx` 在 Task 16 那个"归属判定" effect 之后追加消费方（`import { useChatJumpStore } from '@/stores/chatJump'`）：

```tsx
  const jumpTarget = useChatJumpStore((s) => s.target)
  const clearJump = useChatJumpStore((s) => s.clear)

  useEffect(() => {
    if (!jumpTarget) return
    // 先 clear 再落 state：这是一次性投递。留着 target 的话，用户在记录页里手动换了会话、
    // 这个 effect 再跑一次就会把抽屉里那条抢回去——而且只有"离开路由再回来"时才看得见。
    clearJump()
    select(jumpTarget.accountId)
    setPicked(jumpTarget)
    setAnchor(null)
    setView('conversations')
  }, [jumpTarget, clearJump, select])
```

> `setAnchor(null)` 不能省：抽屉跳过来的是"看这个会话最新的样子"，若上一次搜索跳转的锚点还挂着，首屏会翻到几周前那条命中上（Task 16 的 `chatKey` 校验会挡住请求，但视口停在最旧窗口，用户看到的是"我明明点了会话，怎么是空的/旧的"）。

- [ ] **Step 5: 验证**

```bash
cd apps/desktop && pnpm run test:unit 2>&1 | tail -6 && pnpm run typecheck
```

预期：`# pass 83` / `# fail 0`；四个 tsconfig 全绿。

CDP（C9 抬窗口 + `visibilityState === 'visible'`；C10 真实鼠标）。本任务全程只读，不需要真实登录态，也不写库。前置：库里要有某位种子客户的消息——`node tmp/p6b-query.mjs` 跑过就有了（它往 Alice 张的会话 `8613800001001@c.us` 写过 `p6b-anchor-1..5` 与 `你好，我想问下订单` 那批行，Task 4 第 6b 行）。挑客户时挑 Alice，第 1 行的 `conversationCount` 才是非 0。

| # | 操作 | 断言 | 区分的是什么 |
|---|---|---|---|
| 1 | 客户管理页真实鼠标点开那位有消息的种子客户 | 抽屉里 `[data-p6-timeline="list"]` 存在；`section[data-p6-timeline-group]` 根数 === `curl /api/customers/{id}/timeline?size=20` 的 `conversationCount` | 时间线真的读了新端点，而不是把会话列表又渲染一遍 |
| 2 | 数气泡 | `[data-p6-timeline] [data-msg-key]` 总数 === `curl` 的 `messages.length`；且每个 `msgKey` 都出现在"自己那条会话"的卡片里 | **一条不丢 + 不落错卡**：`Map.get()` 后直接 `continue` 的实现会在这里掉消息，而页面看起来仍然满满当当 |
| 3 | 卡片顺序与卡内顺序 | 卡片按各卡最后一条 `msgTime` 倒序；卡内 `msgTime` 单调不减（对照 curl 的原始数组） | 排序基准是"卡内最新"，不是会话头的 `lastMsgTime` 投影值 |
| 4 | 看一张群卡片与一张单聊卡片 | 群卡片每条 in 气泡上方有发送人小字；单聊卡片没有 | `showSender` 按 `group.isGroup` 分派，而不是按"这位客户的全部会话" |
| 5 | 真实鼠标点某卡「打开」 | URL 变 `#/messages`；`[data-p6-thread="<该会话 id>"]` 存在；右列标题 === 该卡片标题 | 整条 `ConversationVO` 真的过了桥（只断言路由变了，等于没验 accountId 与 chatKey 有没有带过去） |
| 6 | 先在记录页切到另一个账号，再从抽屉跳同一个会话 | `[data-p6-thread]` 的 id 就是目标会话；账号下拉/侧栏选中的是该会话所属账号 | 跨账号投递与 Task 16 第 10 行共享同一个失效面（"归属判定"effect 会把刚跳进来的会话抹掉），这次由抽屉触发 |
| 7 | 回到客户页再跳另一条会话；然后在记录页手动点一条会话、切去翻译中心再切回 | 前一步 `[data-p6-thread]` 变成新目标；后一步选中的仍是手动点的那条 | 投递是一次性的：`clear()` 真的跑了，target 不会粘住把人一次次拽回抽屉里那条 |
| 8 | `curl /api/customers/{id}/timeline?size=2` | `messages.length <= 2`、`conversations` 只含这 2 条涉及的会话；抽屉默认 20 条时气泡数 === min(20, 真实总数) | "最近 N 条"的口径落在页面上；也顺带证明 `size` 不是游标翻页（本任务不做翻页） |
| 9 | 收尾 | 全程无 `POST` / `PUT` / `DELETE` 请求（看请求计数插桩）；`GET /api/customers?keyword=` 的种子计数与打开抽屉前一致 | 抽屉打开一次不该改动任何数据（种子与归属都不动） |

第 2、5、6、7 行是本任务的硬证据：不丢消息、整条会话过桥、跨账号不被复位 effect 抹掉、投递不粘住。这四条在界面上都要"看一眼就知道对不对"以外的情形才暴露，所以逐条给了对照组。

- [ ] **Step 6: 提交**

```bash
git add apps/desktop/src/renderer/src/lib/chatTimeline.ts apps/desktop/src/renderer/src/lib/chatTimeline.test.ts apps/desktop/tsconfig.unit.json apps/desktop/src/renderer/src/stores/chatJump.ts apps/desktop/src/renderer/src/components/messages/MessageThread.tsx apps/desktop/src/renderer/src/components/customers/CustomerTimeline.tsx apps/desktop/src/renderer/src/components/customers/CustomerDrawer.tsx apps/desktop/src/renderer/src/pages/MessagesPage.tsx
git commit -m "feat(P6): 客户抽屉时间线（复用气泡 + 一次性跳回记录页）"
```

---

### Task 19: 真实登录态端到端回归与交付

**Files:**
- Create: `tmp/p6g-e2e.mjs`（CDP 端到端脚本；`tmp/` 已被 gitignore，不进提交）
- Modify: `docs/superpowers/specs/2026-09-20-chat-history-design.md`（§8 的"客户级语向"一行写成两处的实际口径：① 记录页回复框、② 内嵌页气泡，各指到兑现它的任务；§12 验收表加一列实测结论）
- Create: `docs/notes/2026-09-20-p6-chat-history-verification.md`（逐条断言的实测结论 / blocked 原因 / 证据；形状沿用 `docs/notes/2026-09-20-tencent-online-translation-deferred.md`）

**Interfaces:**
- Consumes: Task 1–18 与 Task 17b 的全部产物，外加 Task 12c/12d 的 TG 链（其端到端只在本地契约假页面上跑过，见 spec §11）。因此 Step 4 的 TG 行是**两档**断言：假页面档复跑一遍证明没被后续任务改坏，真实站点档如实写"未验证"。
- Produces: 一份"哪些断言真的跑过、哪些没跑、为什么"的书面结论。**没有新增生产代码是本任务的正常结果**；如果回归里发现要改代码，改完必须复跑**那个任务自己的** CDP 表（不是只补本任务这张表），并单独提一个 `fix(P6):`。
- 不做：性能压测（本地单租户量级，spec §1 非目标）、Telegram **真实站点**的登录与收发（无账号，spec §12 B 档永久"未验证"，不是本任务的疏漏）、任何线上环境。

- [ ] **Step 1: 前置检查（5 道门，任一不满足就按 C11 把对应断言标 blocked）**

```bash
curl -s http://localhost:8180/api/health
node -e "const{createChatSession}=0" 2>/dev/null; echo '下面几行是人工核对，不是脚本'
```

按顺序确认，并把这些值抄进验收记录文档的"前置"一节（它们是后面所有增量的分母，C4）：

1. **后端是含 P6 全部新 Controller 的构建**：`GET /api/messages/stats?accountId=<wa>&days=7` 返回 `code:0`。若 404 / `No static resource` → 8180 上跑的是旧进程，按 C8 重启（`netstat -ano | grep ':8180'` → `taskkill //PID <pid> //F` → `set -o pipefail && ./mvnw -q -DskipTests package` → 后台 `java -jar apps/server/target/scrm-server-0.1.0.jar` → 轮询 `/api/health`）。
2. **真实登录态**：`pnpm --dir apps/desktop exec electron-vite dev --remoteDebuggingPort 9223`，先 `tmp/p5c-top.ps1` 抬窗口，再在渲染层读 `await window.scrm.msg.bridges()`，要求有一条 `{platform:'whatsapp', ready:true}`。拿不到 → Step 2、Step 3、Step 4 的登录态相关行全部 blocked，**不接受用 `POST /api/messages/batch` 自造数据冒充端到端**（C11）。
3. **种子完好 + 行数分母**：`GET /api/customers` total=5、`/api/label-groups`=2、`/api/audiences`=2、`/api/material-groups`=3、`/api/materials`=4、`/api/quick-reply-groups`=3、`/api/quick-replies`=3；`GET /api/messages/stats?days=30` 的 `total` 与 `GET /api/conversations?accountId=<wa>&size=1` 的 `total` 各记一次，作为本轮增量的基线。
4. **TG 只有假页面档**：本机没有 Telegram 账号，Task 12c/12d 的端到端是在 `apps/desktop/test/tg-fixture.html` 上跑的。本任务复跑它（证明后续任务没把 TG 分支改坏），并如实保留"真实站点未验证"的结论——**不要**因为跑绿了就写成"TG 已验证"（C11 两档分开）。
5. **前面任务的 `tmp/*.mjs` 脚本还在**（`p6b-query` / `p6b-customer` / `p6b-scope-contract` / `p6c-mount` / `p6c-chatkey-direction` / `p6c-page-direction` / `p6d-collect` / `p6e-send` / `p6f-page` / `p6f-tail` / `p6-tg-fixture`（Task 12c/12d 的 TG 契约驱动）/ `p6-task17-seed`）。`tmp/` 不入库，被清掉就按对应任务的 Step 原样重写——**不要在本任务里另造一套数据口径**，那会让两轮结论没法对照。

- [ ] **Step 2: 采集链端到端（复跑 Task 12 的断言，一次跑完）**

`tmp/p6g-e2e.mjs` 的采集段。每条都是"看数字变化"而不是"看有没有报错"：

| # | 操作 | 断言 | 与 Step 1 的哪个分母比 |
|---|---|---|---|
| 1 | 桥 ready 的账号上点「同步历史」（记录页左列） | 请求发 `msg-cmd {kind:'backfill', limit:5}`；`stats.total` 增量 > 0 | 基线 total |
| 2 | 取补底那批的 `msg_key` 集合，隔 3s 再点一次「同步历史」 | 第二次的 `chat_message` 增量 === 0（`uk_msg` + `INSERT IGNORE` 挡住）；会话头 `lastMsgTime` 不变 | 第一次的增量 |
| 3 | 在**原生 WhatsApp 界面**（不是记录页）给自聊手发一条 `P6E-native-<ts>` | `GET /api/messages?chatKey=<自聊>` 里出现该 `msg_key`，且 `source === 'native_send'` | 证明双入口同源：只走应用内发送的实现过不了这一行 |
| 4 | 记录页对同一会话发消息（走 Step 3 的发送链） | 该会话的 `source` 同时出现 `app_send` 与 `native_send` 两种值 | 同一张表混两种来源仍不重复 |
| 5 | 把内嵌页 `webContents.reload()`（或断网 30s 再恢复），等桥重挂 ready | 重新 ready 后不重复补底：`stats.total` 增量 === 期间真实新消息数；对同一个 `msg_key` `GET` 只有一条 | 断线重挂不重不漏（spec §12 那一行） |
| 6 | 读 dev 终端最后一行 `msgs=` 计数与 `stats` 的增量对照 | 同量级（本仓库没有 mysql CLI，"库内真值"由后端自己给，对照口径写清楚，不声称直接查了库） | — |

- [ ] **Step 3: 发送链端到端（含"3s 内可见"与清理）**

| # | 操作 | 断言 |
|---|---|---|
| 1 | 真实键盘在自聊会话的回复框敲 `P6E-send-<ts>` + Enter | 立即出现 `data-msg-key` 以 `~` 开头的乐观气泡（`status:'pending'`） |
| 2 | 轮询 `GET /api/messages?chatKey=<自聊>&size=5`，最长 3s | 3s 内出现 `msg_key === 回执 msgKey`、`source==='app_send'`、`send_local_id` 等于那个 localId 的行（这条兜住 Task 12 Step 6 记下的"补写行 vs 事件流"取舍） |
| 3 | 等 ack 帧 | 同一 `data-msg-key` 节点上 ⏱ → ✓ → ✓✓，节点数不因 ack 而 +1；`POST /api/messages/status` 的调用次数 >= 1 |
| 4 | 手机侧确认已读（或对端环境不可控时） | 状态停在能推进到的最高档即视为通过，并把"read 档未验证"如实写进结论（C11：不声称看到了没看到的） |
| 5 | **清理（C4）**：在自聊里把本轮 `P6E-*` 测试消息逐条删除 | 删除后 `chat_message` 里这几条的状态推进到删除态或按平台事件被标记；报告的最终增量 = 本轮发送条数；WhatsApp 侧不留 `P6E-*` |

| 6 | 同一会话**连发两条**（两条不同 `localId`，间隔 < 1s） | 两个乐观气泡同时存在；两份回执 `localId` 各自匹配、`msgKey` 不同；一条失败不把另一条打成 failed | 这是〈与后续阶段的三条硬缝〉第 1 条的唯一现场证据：`SendRegistry` 一旦按 `chatKey` 而不是 `localId` 登记，第二条回执就会覆盖第一条，而单发一条永远看不出来。P7 群发是它的放大版 |
| 7 | 第 6 行结束后再执行清理 | 第 6 行的两条一并删除（C4） | — |

- [ ] **Step 4: 记录页与外围全链走查**

复跑 Task 14–18 的 CDP 表（`tmp/p6f-page.mjs` / `tmp/p6f-tail.mjs` + 各任务表里之前 blocked 的行），逐行记 PASS / FAIL / blocked 到验收文档。补三条只有全链跑起来才看得见的组合断言：

| # | 操作 | 断言 | 为什么要组合 |
|---|---|---|---|
| 1 | 补底 + live 同时来（一边点「同步历史」一边在手机发一条） | `[data-msg-key]` 集合无重复；尾巴不出现同一条的两个副本 | 单跑 Task 12（只有 live）与 Task 14（只有库）都碰不到这个交叉 |
| 2 | 陌生会话 → 建客户 → 立刻在记录页搜该会话正文 | 命中行的 `customerId` 已是新客户；切「只看当前客户」能筛出它 | link-customer 的回填与搜索读的是同一份归属，中间没有缓存死角 |
| 3 | **TG 两档**：A 档复跑 `tmp/p6-tg-fixture.mjs`（内嵌 `apps/desktop/test/tg-fixture.html`，注入层按 spec §11.1 的契约收消息 / 回回执），再读 `GET /api/conversations?accountId=<tg>&size=50`；B 档人工确认本机无 Telegram 登录态 | A 档：会话头与消息行真的落库（`chat_key` 是纯数字串、群是 `-100…` 负号形态），发送回执按 `localId` 配平，`pending → sent` 阶梯走通，且 `platform='telegram'` 的行**只**带本轮唯一前缀；B 档：验收文档写"真实站点未验证" | 两档分开是这一行的全部意义：A 档绿只证明"我们这侧照契约接得上"，不证明公网 TG 页面暴露这些 API（C11）。而 A 档里"只带本轮前缀"是反向断言——若混进别的前缀，说明平台反查或桥挂载漏了分支，把 WA 的会话写进了 TG 账号名下，`uk_msg` 会把它们当成不同行、永远查不出重复（Task 3 那条 `chat_key 与平台不匹配` 整批拒就是为这个设的） |
| 4 | 一轮结束后重跑五份后端契约脚本（`tmp/p6a-contract.mjs` + `tmp/p6b-query.mjs` / `tmp/p6b-customer.mjs` / `tmp/p6b-scope-contract.mjs` + `tmp/p6c-chatkey-direction.mjs`）与 `pnpm run test:unit` + `pnpm run typecheck` | 全部原样绿（`16/16`、`17/17`、`9/9`、`10/10`、`8/8`、`# pass 103`、四个 tsconfig 无输出）。`103` = Task 18 终态 83 + Task 12c 的 14 + Task 12d 的 6（**改期望值必须与新增用例同批**，不接受"数字对不上就调大"） | 端到端过程中若有手工改库/改设置，这里会暴露（Task 6 第 10 步的全局值回滚也在这一条里复确认）。`tmp/` 不在版本控制里，这五份驱动是本阶段**唯一**覆盖 `MessageService.accept/applyStatus` 的可执行断言（Task 3 的落库探针按口径跑完即删），所以这一条不是"顺手再跑一遍"，是它们唯一的复现机会 |

- [ ] **Step 5: P5 回归（P6 动过 P5 的三个地方）**

P6 对 P5 的改动面只有三处，逐条复跑 `docs/superpowers/specs/2026-09-19-translation-center-design.md` §6.3 / §9.5 的对应断言：

| # | P6 动过的地方 | 回归断言 |
|---|---|---|
| 1 | `api/translation.ts` 的 `useTranslationSettings` 加了可选 `customerId`、缓存键从 `['translation-settings']` 变成 `['translation-settings','global']`、`onSuccess` 改成整前缀失效 | 翻译中心改任意开关保存 → 不回弹；`useTranslationSync` 的推送仍带递增 `revision`；内嵌页收到 `update-translation-flags` |
| 2 | `useTrialTranslate` 入参加 `customerId` | 试译（不传 customerId）仍按全局语向产出译文 |
| 3 | `LangSelect` 从 `TranslationPage.tsx` 提取到 `components/translation/LangSelect.tsx` | 翻译中心的源/目标下拉逐条可选（含"自动检测"回落到 `''`）；7 条渠道的选项列表仍随 channel 变 |

再加一条 P5e 那两个修复的现场复跑（它们在同一个输入框上）：打开「先译再发」，真实键盘敲一句含空格的中文，点「用译文替换输入框」→ 输入框里是**完整**译文（不首字母、不追加、不回滚）。

- [ ] **Step 6: 全量机械验证**

```bash
cd /d/SmartSCRM/apps/server && export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18" && set -o pipefail && ./mvnw test 2>&1 | tail -25
```

预期：`Tests run: 52, Failures: 0, Errors: 0` = 本机既有基线 30（`SimulatedTranslationEngineTest` 15 + `TencentProviderTest` 8 + `BaiduProviderTest` 7）+ P6 的 22（Task 2 的 15 + Task 4 的 3 + Task 6 的 4）。计数归属更正：这 15 条属 **Task 2**，Task 1 交付的是迁移与 mapper，没有 JUnit 用例（原先写成"Task 1 的 12"）。2026-09-20 Task 2 收口时实跑 `./mvnw test` = **`Tests run: 45, Failures: 0, Errors: 0`**，与这里的推演一致。**跑之前先记一次基线**：若合入前 `./mvnw test` 不是 30，就按实测基线改写这个总数并在验收文档里写差值，不要为了凑 52 去动断言。P6 那 22 条可以单独看：`./mvnw test -Dtest='ChatKeysTest,MsgTimesTest,StatusLadderTest,SearchPatternTest,CursorsTest,ScopeSettingsTest'` → `Tests run: 22`（别加 `-q`，surefire 的 `Tests run:` 摘要是 INFO 级，`-q` 会把它连同失败明细一起吞掉）。

```bash
cd /d/SmartSCRM/apps/desktop && pnpm run test:unit 2>&1 | tail -6 && pnpm run typecheck && pnpm run build:bridge && pnpm run build 2>&1 | tail -15
```

预期：`# pass 103` / `# fail 0`；四个 typecheck 全绿；`resources/msg-bridge.bundle.js` 与 `resources/wa-js.bundle.js` 都在；`electron-vite build` 成功产出 `out/`。

```bash
cd /d/SmartSCRM && node tmp/p6b-query.mjs && node tmp/p6b-customer.mjs && node tmp/p6b-scope-contract.mjs
```

预期：末行分别 `ALL PASS (17/17)`、`ALL PASS (9/9)`、`ALL PASS (10/10)`；三个脚本各自的收尾清理（Task 5 / Task 6 已写明的还原步骤）都跑到，最后再核一次 Step 1 第 3 条的七个种子计数与全局语向值未变。

```bash
cd /d/SmartSCRM && grep -c 'CREATE TABLE' apps/server/src/main/resources/db/migration/V8__chat_history.sql
```

预期：`2`（只有 `chat_conversation` / `chat_message`）。这是〈与后续阶段的三条硬缝〉第 2 条"P6 不预建聚合表"的可查形式——数字变成 3 说明有人在本阶段塞了汇总表，P8/P13 的读路径当时还没定，回头要改的是所有人。

- [ ] **Step 7: 结论回填**

1. **spec §8**：在"按客户语向"那一行落到本阶段实际口径——生效面 ①（记录页回复框）由 Task 6 兑现、生效面 ②（内嵌页气泡）由 Task 17b 兑现；两处都以 `ScopeSettings.resolve` 为唯一解析口，② 的 `customerId` 来自会话投影而不是页面声明。
2. **spec §12** 验收表加"实测（2026-09-20）"一列：逐行写 `PASS` / `FAIL→已修 <commit>` / `blocked（原因）` / `n/a（档位）`。
3. **`docs/notes/2026-09-20-p6-chat-history-verification.md`**：前置数据（Step 1 的分母）、每步的实测数字、blocked 清单与原因、已知限制（至少三条：删除客户后 `chat_*` 两表的 `customer_id` 仍指向已删 id，记录页显示为「客户 #<id>」；`stats`/会话头计数是尽力值，与 WhatsApp 侧栏不保证一致；会话切换事件没到位的那一拍上，气泡可能按上一个会话的客户语向多译一次——17b 口径第 2 条，下一轮扫描自然纠正）。客户级语向的两处实测结论分别指到 Task 6/17 与 Task 17b 的表。
4. **不写"全部通过"除非它真的全部通过**。哪一行没跑，就在那一行留下没跑的原因。

- [ ] **Step 8: 提交**

```bash
cd /d/SmartSCRM && git status --short
```

只有文档进本任务的提交（`tmp/` 不入库）。若 Step 2–5 修过生产代码，先按"改的是哪个任务"单独提 `fix(P6): …`（附对应任务 CDP 表的复跑结论），再提文档：

```bash
cd /d/SmartSCRM && git add docs/superpowers/specs/2026-09-20-chat-history-design.md docs/notes/2026-09-20-p6-chat-history-verification.md && git commit -m "update(P6): 聊天记录端到端验收结论回填与已知限制记录"
```

提交完即本阶段结束：**push 由用户手动执行（C5），助手不 push**。交付说明里要带上：Task 0–19 与 17b 共 21 个任务的 commit 列表、Step 6 的四组机械验证数字、blocked 清单、以及"本轮在自聊删掉的测试消息条数"（C4 的回执）。
