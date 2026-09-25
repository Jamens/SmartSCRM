# P7 / B16 会话级设置实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给「某个账号视图里的某个会话」一份自己的翻译设置（`translation_setting` 第三档 `scope='conversation'`），优先级高于客户档，并让内嵌页气泡、输入框预览与记录页回复框都按这一档生效。

**Architecture:** Java 后端仍是唯一数据层：Flyway V9 把 `scope_key` 扩到 160 并改 `utf8mb4_bin`（不加列，一档一种键形态），会话档的键 `<accountId>:<chatKey>` 只在 `ConversationScopeKey` 一处成形、全程不反解析。解析链从两档改三档（`conv ?? cust ?? global`），`getSettings` 与 `translate` 共用同一个 `resolveSetting`，所以两个入口不可能读出不同的生效值。主进程把「这个视图正在看哪个会话」挂进既有的 `msg:state` 广播（不新增 IPC 通道），渲染层从 `queryKeys.bridges` 挑本账号那条 ready 桥读 `activeChatKey`，工作台工具条因此有一颗「会话设置」按钮与一个三档徽标的弹层。页内开关位仍是进程级一份 flags（来源全局行），本阶段只改**怎么说**（语种、线路），不改**要不要说**。

**Tech Stack:** Java 17 · Spring Boot 3.5.16 · MyBatis-Plus 3.5.17 · Flyway · MySQL 8（`smartscrm_react`）· JUnit 5 · Electron 39 + React 19 + TS(strict) + Tailwind v4 + radix-ui + TanStack Query v5 + Zustand · esbuild（注入 bundle / 消息桥 bundle）· Node 24 原生 `node --test` + TS 类型剥离 · CDP（`tmp/cdp.mjs`）

**Spec:** `docs/superpowers/specs/2026-09-25-conversation-settings-design.md`（数据模型、接口、解析链、生效面、活动会话出口、UI、错误表、验证方案以该文件为准；本计划只对其中八处做落地收敛，见下一节）

## Global Constraints

逐条抄自 spec §0 与本机既定事实（沿用 P5/P6 计划的编号），每个任务的隐含前提：

- **C0 本地闭环**：MySQL 只有本机 `smartscrm_react`（root / `1234560`），后端只有 `:8180`。**绝不碰 42 张表的 `smartscrm` 老库**；迁移只加不改已发布迁移（本阶段只出 `V9__conversation_setting_scope_key.sql`，只做 `ALTER`）。
- **C5 工具链**：前端一律 `pnpm`（禁 npm / npx）；后端 `./mvnw`，不是 17.x 就先 `export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18"`，管道前 `set -o pipefail`，看 surefire 输出时**不加 `-q`**。提交前缀 `feat:` / `fix:` / `refa:` / `update:`；**每片测试通过即 commit，push 由用户手动执行，助手不得 push、不得 amend**。
- **C6 文档口径**：注释与文档只描述本项目的方案，不写与其它实现的对比、不引用外部仓库路径。
- **C7 后端验证只走 `http://localhost:8180`**：本机没有 mysql CLI、Docker 守护进程未运行，所以 V9 的列宽 / 排序规则**没有 `DESCRIBE` 这类直接证据**，只有行为证据（见 Task 1 Step 4 与 Task 5 第 1 行）。中文 payload 必须先用 Write 工具落成 UTF-8 文件；多断言契约用 `tmp/*.mjs` 驱动，一次跑完打印 PASS/FAIL 表。
- **C8 重启口径**：新端点 404 且报 "No static resource" = 8180 上跑的是旧进程。`netstat -ano | grep ':8180'` → `taskkill //PID <pid> //F` → `./mvnw -DskipTests package`（打包前必须先杀进程，否则 jar 被占用）→ 后台 `java -jar apps/server/target/scrm-server-0.1.0.jar` → 轮询 `GET /api/health`。
- **C9 渲染层验证只走 CDP**：`pnpm --dir apps/desktop exec electron-vite dev --remoteDebuggingPort 9223` + `tmp/cdp.mjs`（`openPage(9223, 'localhost:5173')` / `ev()` / `send()`），跑前先 `powershell -NoProfile -ExecutionPolicy Bypass -File tmp/p5c-top.ps1` 抬起窗口并断言 `document.visibilityState === 'visible'`，否则 Radix 出场动画不结束、`pointer-events` 永久卡在 `<body>` 上，所有点击静默失效。脚本结尾必须 `process.exit()`。
- **C10 输入路径口径**：凡涉及界面交互的断言一律用 CDP `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` / `Input.insertText`。合成 `element.click()` 不经过 `mousedown` 的默认焦点行为，会把焦点与选区竞态全部掩盖成"通过"。
- **C11 不得越权声称验证**：分两档写清——**A 档**=布景（会话行、客户行、bridge 帧）由脚本手喂进真实入库面 / 真实缓存面；**B 档**=被测界面行为本身是真的（真实输入事件、真实 PUT/DELETE 落库、真实后端读回）。没有真实 WhatsApp 登录态就跑不了的那一条要么标 blocked 要么如实写"未验证"，不接受用桩数据冒充端到端。TG 会话档只能到 fixture（Task 12a 未做），本阶段不声称 TG 生效。
- **C12 业务错误码沿用既有词表**：`40000` 参数/取值非法、`40100` 未鉴权、`40404` 目标行不存在、`40901` 冲突、`50000` 未预期异常。`@Valid` 失败经 `GlobalExceptionHandler.handleValidation` 也是 `40000`（消息形如 `chatKey 最长 128 字符`）。本阶段所有"不成形"一律 `40000`，spec §7 已把"accountId 不属于本租户"判成 `40000` 而不是 `40404`。
- **C13 主进程 → 后端的请求走 `authedFetch`**：本阶段不新增主进程侧的后端调用，翻译请求仍走 `webContentsView/ipc.ts` 里那条 `requestTranslation`；如果实现顺手加了别的调用点，按本条接。
- **C14 单测计数以实测基线为准**：本计划写的 `# pass N` 是**推演值**。执行每个任务时先跑一次拿真实基线，期望值 = 真实基线 + 本任务确实新增的用例数；"数字对不上就把期望调大"不接受。终态交付时把这条链按实测重算写进报告。
- **JS 单测闸门**：`pnpm --dir apps/desktop test:unit`。被测模块只用**可擦除 TS 语法**（无 `enum` / `namespace` / 参数属性），import 带 `.ts` 后缀，由 `tsconfig.unit.json` 的 `erasableSyntaxOnly` 钉死。**注意 `tsconfig.unit.json` 的 `include` 是显式清单**：新建 `src/renderer/src/lib/*.ts` 必须同批把 `.ts` 与 `.test.ts` 两行加进去，否则闸门根本看不见它（`src/shared/**` 已在 glob 覆盖内，不必加）。
- **类型闸门**：`pnpm -r typecheck`（node / web / inject / unit 四份 tsconfig）。
- **`tmp/` 与差距表不进提交**：`tmp/*.mjs` 驱动、`tmp/.p17-fixture.json` 都被 gitignore；`docs/notes/2026-09-22-legacy-feature-gap.md` 永不提交。

## 对 spec 的八处落地收敛

计划执行时按下述口径落地。这些是 spec 文字落到本仓库代码时必须做的决定（含一处 spec 与现实冲突的裁定），先在此声明，避免实现阶段各自发挥：

1. **P-01 缓存键用数组段，不拼串。** `SettingsRef` 是判别联合（`global` / `customer` / `conversation`），`settingsKeyOf` 回 `['translation-settings', 'conversation', accountId, chatKey]` 这样的**多段数组**。理由：那条 `scope_key` 的形态只有 Java 知道（spec §3.4），渲染层哪怕只拼一个缓存键，也会让人误以为可以拿它去比对、去解析。
   **键段不含 `customerId`**（此处比 spec §6 的读侧参数少一项，是落地时的取舍）：工作台舞台手里只有桥报上来的 `accountId + chatKey`，没有 `customerId`（`BridgeState` 里没有这一列，为它去翻会话列表缓存是把 UI 的取数塞进数据层）。而 `customerId` 对会话档**读到的那一行**没有影响——键由 `accountId + chatKey` 合成，`customerId` 只参与"没有会话档时落到哪一档"，而那一步后端会用 `customerOfChat` 现算（Task 3 的读侧），前端带不带都得到同一个结论。
   代价如实记在这里：给这条会话**建了客户**之后，会话档那份缓存里"回落过去的客户档值"可能过期一格。兜法是把 `link-customer` 那条 mutation 的失效补成 `['translation-settings']` 整前缀（Task 7 Step 10），与保存/删除同一套理由。
2. **P-02 舞台取活动会话复用既有 `useBridgeOf(accountId)`**（`lib/liveTailSync.ts:296`），不新建 hook。它已经是"按 accountId 筛 + `ready` 才算数"的同一份口径，spec §6 要的正是这条筛选链。
3. **P-03 `DirectionLangRows.tsx` 导出两格：`LangRow`（开关改为可选）与 `ChannelRow`。** 线路是**一整档一个值**（`channel` 一列同时决定收发两侧的可选语种），塞进 `LangRow` 会变成两个弹层格各带一份线路，所以它是弹层级的第三格。客户档弹层继续用带开关的 `LangRow`、不显示 `ChannelRow`（今天只有翻译中心改线路，弹层加它=扩范围）；会话档弹层用不带开关的 `LangRow` × 2 + `ChannelRow`。
4. **P-04 `__p6f` 增加 dev-only 写入口 `setBridges(states)`。** spec §8 CDP 行 1 要断言 `ready===false` 与 `ready===true && activeChatKey===null` 两种失败形态，而探针只有读的那一半（`bridgeStates()`）。没有真桥就造不出 `ready:true` 那一格，所以给 dev 探针补一个写入口（生产构建里整块不存在，与既有四个入口同一处 `import.meta.env.DEV` 闸）。这一格断言的是"渲染层的禁用链读的是哪两个字段"，不是"真桥会不会给值"——后者仍是真实登录档（Task 11）。
5. **P-05 CDP 加第 5 行：回复框那颗开关在会话档生效时写回哪一层。** spec §8 只有 4 行，但 §3.4 / §4② 点名的 bug 类正是"写错层"（`toggleSendLang` 今天靠 `settings.scope === 'customer'` 判层，`scopeKey` 拿去当客户 id 用；会话档上线后那一格会是 `5:xxx@c.us`，照旧代码会把成形键塞进 `scopeKey` 提交 → 控制器的数字校验 40000，或更糟：悄悄改掉全局）。这一行是那次改动的回归口，代价只是多一条断言。（第 6 行由 P-07 带出来：客户档弹层保存后线路一字未动。整支驱动因此是**六行 32 条**，不是 spec §8 那四行。）
6. **P-06 裁定（spec §3.4 与 §3.3 冲突）：会话档的成形调用点落在 service 的会话分支，controller 只做 `rejectReason` 的 40000 分派。** spec §3.4 写"controller 分派后把已成形的键传给 service，service 不再关心键的形态"，但 §3.3 要求会话档整份复制的源是 `cust ?? global`——找那位客户要的是 `accountId` + `chatKey` 的投影，只拿一条成形键就**必须反解析**键。键只用于整串比对、没有任何一处解析它，这条比 §3.4 那句字面参数形态更重要，所以选前者：键的唯一作者仍是 `ConversationScopeKey.compose`，仍是四个操作（PUT 写入 / DELETE 删除 / GET 解析 / translate 解析）各调一次，差别只在 PUT 那一处位于 service 内。附带后果：`updateScopedSettings(tenantId, scope, Long scopeKey, input)` 这个"一个方法里 switch 三档形态"的形状消失，换成 `updateCustomerSettings(tenantId, customerId, input)` 与 `updateConversationSettings(tenantId, input)` 两条命名入口 + 既有的 `updateSettings(tenantId, input)`（签名不动，全局分支继续走它；补 `@Transactional`，它今天恰好只写一行所以无所谓，拆成三档后它成了"全局那一档"的公开入口，不能再靠外层方法兜事务），scope 白名单只在 controller 一处。
7. **P-07 `DirectionDraft` 增 `channel` 一列**（会话弹层要改线路）。`draftOf` / `dirtyCount` 同步扩，客户档弹层的提交形状因此多一个 `channel: data.channel`——与 `settingsInputOf` 本来要写的那一格同值，**行为逐字段不变**：单测那一层由 Task 8 Step 2 兜（线路算一处改动、不进摘要文案），界面那一层由 Task 10 CDP 第 6 行兜（客户档弹层保存后从库里读回线路一字未动）。
8. **P-08 `BridgeStateCore = Omit<BridgeState, 'activeChatKey'>`。** `BridgeMount.state()` 手里只有 phase/since/detail，`activeChat` 那张 map 在 `msgBridge/index.ts`，必填字段会让 `bridgeMount.ts:94` 直接编译不过。所以 `state(): BridgeStateCore`，`bridgeStates()` 负责 `{...core, activeChatKey}` 那一半——"组装口只有一处"这条 spec §5 的要求仍然成立，因为 `msg:state` 广播与 `msg:bridges` 拉取共用 `bridgeStates()`。

## 验收口径速览（对应 spec §8）

| 层 | 谁来做 | 通过标准 |
|---|---|---|
| 迁移 | 启动日志 + 老行仍读得到 | Flyway 打印应用到 version `9`；`GET /api/translation/settings` 回到同一份全局行（**区分"应用了"与"重建空了"**）；列宽/排序规则无直接证据，由 Task 5 第 1 行的行为差异充当 |
| Java 纯函数 | scoped `./mvnw test -Dtest='ConversationScopeKeyTest,ScopeSettingsTest'`（Task 2/3）、全量 `./mvnw test`（Task 10） | `ConversationScopeKeyTest` 8 条 + `ScopeSettingsTest` 4 条（三档组合），全量 `Failures: 0, Errors: 0` |
| 后端契约 | `tmp/p7a-conv-settings.mjs`（Node，打 8180，中文载荷走 UTF-8 文件） | 16 条 `check` 全绿：spec §8 那 8 行（大小写敏感、三档优先级、回落、整份复制源、缓存分键、开关位不设闸、DELETE 幂等）+ 边界五例 `5a..5e` + 收尾三条；打印 `ALL PASS (16/16)`，exit 1=断言失败 / exit 2=前提不成立 |
| TS 纯函数 | `pnpm --dir apps/desktop test:unit` | `activeChatKeyOf` 9 条（Task 6）+ `scopeLabel` 18 条（Task 7）+ `directionDraft` 线路新增 2 条（Task 8，另有一条既有断言随 `channel` 改形）全绿，计数 = 实测基线 + 29（C14）；TS 侧**不得**出现会话键拼装函数（出现即实现越了 spec §3.4 的范围） |
| 渲染层 | CDP `tmp/p7a-stage-dialog.mjs`，真实鼠标/键盘（C10） | **六行 32 条**：禁用链两种形态分别断言、真实改语种→保存→徽标翻成本会话专属**且从后端按同键读回**、恢复继承翻回它下面那一档、切会话后回复框生效档徽标跟着变、回复框开关写回会话档那一行而全局与客户行一字未动、客户档弹层保存后线路一字未动（P-07 的回归口） |
| 真实登录档 | 需用户在场（代理 + WhatsApp 已登录，Task 11） | 两棒：A 棒给"此刻在屏的那条会话"设一档并断真桥给得出键、键与库同源、页内那一笔请求按这一档出译文（6 条）；人切到另一条会话后 B 棒设另一档、做两档对照并收尾删回继承（7 条）。未跑完之前 spec §4① 只标"读码成立" |

## 文件清单（谁负责什么）

**新建**

| 文件 | 责任 | 出自 |
|---|---|---|
| `apps/server/src/main/resources/db/migration/V9__conversation_setting_scope_key.sql` | 键列扩宽 + 二进制排序，一档一种键形态 | Task 1 |
| `apps/server/src/main/java/com/smartscrm/server/service/msg/ConversationScopeKey.java` | 会话档 `scope_key` 的唯一成形处（含 `rejectReason`） | Task 2 |
| `apps/server/src/test/java/com/smartscrm/server/service/msg/ConversationScopeKeyTest.java` | 键形态与拒因的离线证据 | Task 2 |
| `apps/desktop/src/renderer/src/lib/scopeLabel.ts` | 三态表（`scope`+`inherited` → 档位 → 文案）+ `SettingsRef` 全套寻址函数，渲染层唯一的档位解释处 | Task 7 |
| `apps/desktop/src/renderer/src/lib/scopeLabel.test.ts` | 同上（18 条） | Task 7 |
| `apps/desktop/src/renderer/src/components/translation/DirectionLangRows.tsx` | `LangRow`（开关可选）+ `ChannelRow`，两个弹层共用 | Task 8 |
| `apps/desktop/src/renderer/src/components/translation/ConversationSettingsDialog.tsx` | 会话档弹层：三格控件 + 三态徽标 + 恢复继承 + 取消 + 保存 | Task 9 |
| `tmp/p7a-conv-settings.mjs` | spec §8 那 8 行 HTTP 契约驱动（16 条 `check`） | Task 5 |
| `tmp/p7a-stage-dialog.mjs` | spec §8 那 4 行（+P-05 一条 +P-07 一条）CDP 驱动：六行 32 条 | Task 10 |
| `tmp/p7b-prereq.mjs` | 真实登录档的只读前置与三分母（不写任何设置） | Task 11 |
| `tmp/p7b-live.mjs` | 真实登录档两棒驱动（A 棒 6 条 / B 棒 7 条，靠 `tmp/p7b-live-state.json` 传状态） | Task 11 |
| `docs/notes/2026-09-25-conversation-settings-verification.md` | 验收结论：四级证据词 + 前置分母 + 已知限制 | Task 11 |

**修改**：`service/msg/ScopeSettings.java`（三档，Task 3）· `service/TranslationService.java`（resolveSetting / getSettings / translate / 两条写入口 / DELETE / 复制源 / 租户闸，Task 3+4）· `web/TranslationController.java`（GET 两参数、PUT 分派、新 DELETE，Task 3+4）· `web/dto/TranslationSettingInput.java`（`accountId` + `chatKey`）· `web/vo/TranslateVO.java`（`scope`）· `src/test/.../ScopeSettingsTest.java`（三档重写）· `src/shared/chatKeys.ts`（`activeChatKeyOf`）+ `chatKeys.test.ts` · `src/shared/chatTypes.ts`（`BridgeState.activeChatKey` + `BridgeStateCore`）· `src/main/services/msgBridge/bridgeMount.ts` · `src/main/services/msgBridge/index.ts` · `src/main/webContentsView/ipc.ts` · `src/renderer/src/lib/liveTailSync.ts`（dev 探针写入口）· `src/renderer/src/api/translation.ts`（`SettingsRef` 全套）· `ReplyComposer.tsx` / `MessageThread.tsx`（会话 ref + 请求带账号会话 + 生效档徽标 + 写回层 + 两颗驱动标记）· `ConversationActions.tsx` / `CustomerDirectionDialog.tsx`（改共享行组件、ref 形态、文案修正）· `pages/TranslationPage.tsx` / `lib/translationSync.ts`（`useTranslationSettings()` → `GLOBAL_REF`，Task 7 Step 8）· `AccountStage.tsx`（入口按钮）· `components/AccountSidebar.tsx`（账号行那颗 `data-p7-account-row` 标记，Task 10 Step 1）· `lib/directionDraft.ts` + `.test.ts`（`channel`）· `apps/desktop/tsconfig.unit.json`（include 两行）

---

### Task 1: V9 迁移（键列扩宽 + 二进制排序）

**Files:**
- Create: `apps/server/src/main/resources/db/migration/V9__conversation_setting_scope_key.sql`

**Interfaces:**
- Consumes: 既有 `translation_setting` 表（`V5__translation.sql`，`scope_key VARCHAR(64) NULL`，唯一键 `uk_tset_tenant_scope(tenant_id, scope, scope_key)`，表排序 `utf8mb4_unicode_ci`）
- Produces: 一条能装下 `<accountId>:<chatKey>`（最长 148）且按二进制比较的 `scope_key VARCHAR(160) COLLATE utf8mb4_bin`；Task 2 起所有键写入都落在这条列上

- [ ] **Step 1: 写迁移文件**

`apps/server/src/main/resources/db/migration/V9__conversation_setting_scope_key.sql` 全文：

```sql
-- P7 B16: conversation-scoped translation settings (checklist B16).
-- `scope_key` carries exactly one key form per scope: global = NULL,
-- customer = <customerId>, conversation = <accountId>:<chatKey>.
--
-- Two columns (account_id / chat_key) were deliberately NOT added. MySQL unique keys do not
-- constrain NULL, so a (tenant_id, account_id, chat_key) key would simply not exist for
-- global/customer rows; keeping them distinct would need a generated column. A single key
-- column keeps `settingRow(tenant, scope, key)` the one lookup path for all three tiers.
-- The price is that the key form is per-scope magic — so it is written into this comment.
--
-- COLLATE utf8mb4_bin is the point of this migration. The table is utf8mb4_unicode_ci, and
-- platform ids are case-sensitive: two conversations whose serialised ids differ only in
-- letter case would collide into one row, the later write silently overwriting the earlier
-- one with no trace. Purely numeric customer ids have no observable change.
--
-- Width: accountId <= 19 digits + ':' + chatKey <= 128 = 148 <= 160.
-- Index key length: 8 + 16*4 + 160*4 = 712 bytes, inside InnoDB DYNAMIC's 3072 limit.

ALTER TABLE `translation_setting`
    MODIFY COLUMN `scope`     VARCHAR(16) NOT NULL DEFAULT 'global'
        COMMENT 'global | customer | conversation',
    MODIFY COLUMN `scope_key` VARCHAR(160) COLLATE utf8mb4_bin NULL
        COMMENT 'key form per scope: global=NULL | customer=<customerId> | conversation=<accountId>:<chatKey>';
```

- [ ] **Step 2: 打包前先杀掉 8180 上的旧进程**

```bash
cd /d/SmartSCRM && netstat -ano | grep ':8180' | grep LISTEN
# 有输出就：taskkill //PID <pid> //F
```

期望：下一次 `grep` 无输出。**这一条不能跳过——jar 被占用时 `package` 会以 `Failed to delete ...scrm-server-0.1.0.jar` 失败。**

- [ ] **Step 3: 打包并后台启动，日志落文件**

```bash
cd /d/SmartSCRM/apps/server && export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18" && set -o pipefail && ./mvnw -DskipTests package 2>&1 | tail -8
cd /d/SmartSCRM && (java -jar apps/server/target/scrm-server-0.1.0.jar > tmp/p7-server.log 2>&1 &)
for i in $(seq 1 40); do sleep 1; curl -s --max-time 2 http://127.0.0.1:8180/api/health && break; done
```

期望：`package` 尾部 `BUILD SUCCESS`；`/api/health` 回 `{"code":0,...}`。

- [ ] **Step 4: 断言迁移应用了、且老行还在**

```bash
grep -iE "Migrating schema|Successfully applied|Schema.*up to date|Flyway" /d/SmartSCRM/tmp/p7-server.log | tail -6
curl -s -X POST http://127.0.0.1:8180/api/auth/login -H 'content-type: application/json' \
  -d '{"inviteCode":"DEMO0001","username":"admin","password":"admin123","deviceId":"p7-v9"}'
# 用回到的 accessToken 再打一次（TOK 换成真值）
curl -s http://127.0.0.1:8180/api/translation/settings -H "authorization: Bearer $TOK"
```

两条都要成立，且**必须互相配合才算证据**：

1. 日志出现 `Migrating schema \`smartscrm_react\` to version "9 - conversation setting scope key"` 与 `Successfully applied 1 migration`（若此前已应用过，则是 `Schema ... is up to date`，此时把这一条如实写成"本轮未重新应用，V9 已在库里"，不算通过也不算失败）。
2. `GET /api/translation/settings` 回 `code:0` 且 `data.scope === "global"`、`data.id` 是一个**既有行的 id**（不是刚建的）。

第 2 条区分的是"迁移应用了并且老数据还在"与"表被重建空了"——只有第 1 条时，一个空表也算通过。本机没有 mysql CLI（C7），`DESCRIBE` 拿不到，所以列宽 160 与 `utf8mb4_bin` 的**直接证据不存在**：宽度证据 = Task 4 写入 148 字符键成功、排序证据 = Task 5 第 1 行（同一 accountId 下 `AA@c.us` 与 `aa@c.us` 两条会话档读到不同值）。这两条没跑完，V9 就只能标"已应用，行为证据待 Task 5"。

- [ ] **Step 5: Commit**

```bash
cd /d/SmartSCRM && git add apps/server/src/main/resources/db/migration/V9__conversation_setting_scope_key.sql
git commit -m "feat(P7/B16): V9 迁移——translation_setting.scope_key 扩到 160 并改 utf8mb4_bin

一档一种键形态，不加 account_id/chat_key 两列：MySQL 唯一键不约束 NULL，
三列键对 global/customer 行形同不存在，要挡住重复得引 generated column。
单列保住 settingRow(tenant, scope, key) 走全部三档。
排序规则是本迁移的目的：表是 unicode_ci，只差大小写的平台 id 会撞进同一行，
后写的静默覆盖前一份且无痕迹。宽度 19+1+128=148<=160，索引键长 712<3072。"
```

（主题与正文之间留一个空行，heredoc 写法照 C5；不 push。）

---

### Task 2: `ConversationScopeKey`——会话档键的唯一成形处

**Files:**
- Create: `apps/server/src/main/java/com/smartscrm/server/service/msg/ConversationScopeKey.java`
- Test: `apps/server/src/test/java/com/smartscrm/server/service/msg/ConversationScopeKeyTest.java`

**Interfaces:**
- Consumes: `common/BizException`（`new BizException(40000, msg)` → HTTP 400 + `code:40000`）
- Produces: `ConversationScopeKey.CHAT_KEY_MAX = 128`、`static String rejectReason(Long accountId, String chatKey)`（`null` = 可成形）、`static String compose(Long accountId, String chatKey)`（不成形抛 40000）、`static String composeOrNull(Long accountId, String chatKey)`（不成形回 `null`）。Task 3 的读侧用 `composeOrNull`，Task 4 的写侧用 `compose` + `rejectReason`

- [ ] **Step 1: 写失败的用例**

`apps/server/src/test/java/com/smartscrm/server/service/msg/ConversationScopeKeyTest.java` 全文（风格照同目录 `ScopeSettingsTest.java`：纯 JUnit 5、无 Spring 上下文、私有工厂造数据）：

```java
package com.smartscrm.server.service.msg;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.smartscrm.server.common.BizException;
import org.junit.jupiter.api.Test;

/**
 * 会话档 `scope_key` 形态的离线证据：本项目的后端里只有这里能把 (accountId, chatKey) 变成一条键，
 * 只有这一处断得清它什么时候不该变成键。跑不到的部分全在 tmp/p7a-conv-settings.mjs 的 8 行里。
 */
class ConversationScopeKeyTest {

    @Test
    void composesAccountIdColonChatKey() {
        assertEquals("5:8613800001001@c.us", ConversationScopeKey.compose(5L, "8613800001001@c.us"));
    }

    @Test
    void keepsChatKeyBytesUntouched() {
        // 键里不出现大小写折叠、不出现 trim：两条只差大小写的会话必须是两条（V9 的全部意义）
        String upper = ConversationScopeKey.compose(5L, "P7A-CASE-AA@c.us");
        String lower = ConversationScopeKey.compose(5L, "P7A-CASE-aa@c.us");
        assertTrue(!upper.equals(lower), "同 accountId 下只差大小写必须成出两条键");
        assertEquals("5:P7A-CASE-aa@c.us", lower);
    }

    @Test
    void rejectsMissingHalf() {
        assertEquals(40000, assertThrows(BizException.class,
            () -> ConversationScopeKey.compose(null, "8613800001001@c.us")).getCode());
        assertEquals(40000, assertThrows(BizException.class,
            () -> ConversationScopeKey.compose(5L, null)).getCode());
        assertEquals(40000, assertThrows(BizException.class,
            () -> ConversationScopeKey.compose(5L, "   ")).getCode());
    }

    @Test
    void rejectsWhitespaceAndControlsInside() {
        for (String bad : new String[] {"861380000100 1@c.us", "8613800001001@c.us\n", "a\tb"}) {
            assertEquals(40000, assertThrows(BizException.class,
                () -> ConversationScopeKey.compose(5L, bad)).getCode(), "应拒绝: " + bad);
        }
    }

    @Test
    void rejectsOverlongChatKey() {
        String atLimit = "x".repeat(ConversationScopeKey.CHAT_KEY_MAX);
        String over = "x".repeat(ConversationScopeKey.CHAT_KEY_MAX + 1);
        assertEquals("5:" + atLimit, ConversationScopeKey.compose(5L, atLimit));
        assertEquals(40000, assertThrows(BizException.class,
            () -> ConversationScopeKey.compose(5L, over)).getCode());
    }

    /** 读取那条出口不抛：页内上报的脏 chatKey 不该把整次翻译打成 400（spec §4① 的代价是回落，不是报错）。 */
    @Test
    void composeOrNullNeverThrows() {
        assertEquals("5:8613800001001@c.us", ConversationScopeKey.composeOrNull(5L, "8613800001001@c.us"));
        assertNull(ConversationScopeKey.composeOrNull(null, "8613800001001@c.us"));
        assertNull(ConversationScopeKey.composeOrNull(5L, " "));
        assertNull(ConversationScopeKey.composeOrNull(5L, "x".repeat(129)));
    }
}
```

- [ ] **Step 2: 跑到失败**

```bash
cd /d/SmartSCRM/apps/server && export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18" && set -o pipefail && \
  ./mvnw test -Dtest='ConversationScopeKeyTest' 2>&1 | grep -E "ERROR|COMPILATION|symbol|Tests run" | head -12
```

期望：编译失败 `cannot find symbol: class ConversationScopeKey`。**这一步不能跳**：直接写实现就看不到"闸门真的在跑这一批用例"。

- [ ] **Step 3: 写实现**

`apps/server/src/main/java/com/smartscrm/server/service/msg/ConversationScopeKey.java` 全文：

```java
package com.smartscrm.server.service.msg;

import com.smartscrm.server.common.BizException;
import java.util.regex.Pattern;

/**
 * 会话档 `translation_setting.scope_key` 的唯一成形处：`<accountId>:<chatKey>`（V9 的列注释就是这一句）。
 * <p>
 * 只有一个作者，且四处调用它：PUT 写入（{@code TranslationService.updateConversationSettings}）、
 * DELETE 删除（{@code clearConversationSettings}）、GET 解析（{@code resolveSetting}）、
 * translate 解析（同一个 {@code resolveSetting}）。渲染层永远不拼、也永远不解析这个串（spec §3.4）：
 * 两处各拼一次的风险不是编译错，是**写进去的键与读出来的键差一个字符**——保存提示成功、气泡仍按
 * 上一档走、日志一句不响。
 * <p>
 * 键只用于整串比对，没有任何一处反解析它，所以 chatKey 里出现 `:` 不破坏定位（真实的 WA / TG
 * 形态本来也不含冒号，见同目录 {@code ChatKeys}）。宽度的两道闸在 `V9__conversation_setting_scope_key.sql`
 * 的注释里：accountId 最长 19 位 + ':' + chatKey 最长 128 = 148 <= 160。
 */
public final class ConversationScopeKey {

    /**
     * 与 `chat_conversation.chat_key` 同宽。TS 侧的镜像常量在 `@shared/chatKeys.ts` 的
     * `CHAT_KEY_MAX`（盖章处与广播处要用它裁），两边数字改动必须一起改：
     * 弹层里存得下的会话，翻译请求才可能用上它（spec §5 / §7）。
     */
    public static final int CHAT_KEY_MAX = 128;

    /** 空白与控制符：`\s` 管空格与制表/换行，`\p{Cntrl}` 补 0x00-0x1F 与 0x7F。 */
    private static final Pattern FORBIDDEN = Pattern.compile("[\\p{Cntrl}\\s]");

    private ConversationScopeKey() {
    }

    /** 能不能成形。{@code null} = 可以；否则是给调用方直接回 40000 的那句话。 */
    public static String rejectReason(Long accountId, String chatKey) {
        if (accountId == null) {
            return "scope=conversation 时必须带 accountId";
        }
        if (chatKey == null || chatKey.isBlank()) {
            return "scope=conversation 时必须带 chatKey";
        }
        if (chatKey.length() > CHAT_KEY_MAX) {
            return "chatKey 最长 " + CHAT_KEY_MAX + " 字符";
        }
        if (FORBIDDEN.matcher(chatKey).find()) {
            return "chatKey 不能含空白或控制字符";
        }
        return null;
    }

    /** 写入口用的那条：不成形就是坏请求，40000。 */
    public static String compose(Long accountId, String chatKey) {
        String reason = rejectReason(accountId, chatKey);
        if (reason != null) {
            throw new BizException(40000, reason);
        }
        return accountId + ":" + chatKey;
    }

    /**
     * 读取口用的那条：不成形不抛，回 {@code null} 表示"这一档不查"。
     * 页内那条链上 chatKey 来自主进程盖章，脏值只该让语向回落到下一档，不该让整次翻译失败——
     * 气泡没译文是一回事，内嵌页输入框预览整个报错是另一回事。
     */
    public static String composeOrNull(Long accountId, String chatKey) {
        return rejectReason(accountId, chatKey) == null ? accountId + ":" + chatKey : null;
    }
}
```

- [ ] **Step 4: 跑到通过**

```bash
cd /d/SmartSCRM/apps/server && export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18" && set -o pipefail && \
  ./mvnw test -Dtest='ConversationScopeKeyTest' 2>&1 | grep -E "Tests run|BUILD" | tail -4
```

期望：`Tests run: 8, Failures: 0, Errors: 0, Skipped: 0` + `BUILD SUCCESS`。

（实测 8 条，不是本计划推演的 6 条：brief 那 6 条之外，实现阶段补了 2 条尾随空白的判据——
`utf8mb4_bin` 是 PAD SPACE 排序规则，`"…:AA@c.us "` 与 `"…:AA@c.us"` 在唯一键里相等，
唯一能挡的地方就是这里。变异取证见 `.superpowers/sdd/…/task-2-report.md`。）

- [ ] **Step 5: Commit**

```bash
cd /d/SmartSCRM && git add apps/server/src/main/java/com/smartscrm/server/service/msg/ConversationScopeKey.java \
                          apps/server/src/test/java/com/smartscrm/server/service/msg/ConversationScopeKeyTest.java
git commit -m "feat(P7/B16): ConversationScopeKey——会话档 scope_key 的唯一成形处

一个作者四处调用（PUT 写入 / DELETE 删除 / GET 解析 / translate 解析），渲染层不拼也不解析：
两处各拼一次的风险不是编译错，是写进去的键与读出来的键差一个字符，保存提示成功而气泡照旧。
两条出口：compose 抛 40000（写入口），composeOrNull 回 null（读取口——页内那条脏 chatKey
只该让语向回落一档，不该让整次翻译失败）。键只整串比对、不反解析。"
```

---

### Task 3: 三档解析链与读侧（GET / translate / `TranslateVO.scope`）

**Files:**
- Modify: `apps/server/src/main/java/com/smartscrm/server/service/msg/ScopeSettings.java`
- Modify: `apps/server/src/main/java/com/smartscrm/server/service/TranslationService.java`（`getSettings` / `resolveSetting` 新增 / `translate` / `toVO` / 删掉两个旧重载）
- Modify: `apps/server/src/main/java/com/smartscrm/server/web/TranslationController.java`（GET 两个新参数）
- Modify: `apps/server/src/main/java/com/smartscrm/server/web/vo/TranslateVO.java`（`scope`）
- Test: `apps/server/src/test/java/com/smartscrm/server/service/msg/ScopeSettingsTest.java`（三档重写）

**Interfaces:**
- Consumes: Task 2 的 `ConversationScopeKey.composeOrNull` / `CHAT_KEY_MAX`
- Produces:
  - `ScopeSettings.Resolved(TranslationSetting setting, boolean inherited, String scope)`；`ScopeSettings.resolve(TranslationSetting conversation, TranslationSetting customer, TranslationSetting global)`（**旧的 `resolve(Long, TranslationSetting, TranslationSetting)` 不留重载**）
  - `TranslationService.getSettings(Long tenantId, Long customerId, Long accountId, String chatKey)`（旧的 `getSettings(tenantId)` 与 `getSettings(tenantId, customerId)` 全删；`TranslationController` 是 Java 侧唯一调用方，已 grep 证实）
  - `TranslateVO` 末位多一个 `String scope`
  - `private TranslationSettingVO toVO(TranslationSetting s, String scope, boolean inherited)`
  - `private ScopeSettings.Resolved resolveSetting(Long tenantId, Long customerId, Long accountId, String chatKey)`
- 注意：本任务**不动写侧**（`updateScopedSettings` 仍是 `Long scopeKey` 那一份）。此时会话档还没有写入口，读侧的会话分支在 HTTP 上是"永远回落"——这是有意的中间态，Task 4 补写侧，Task 5 一次验两边。

- [ ] **Step 1: 重写解析单测，先让它失败**

`apps/server/src/test/java/com/smartscrm/server/service/msg/ScopeSettingsTest.java` 全文替换：

```java
package com.smartscrm.server.service.msg;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.smartscrm.server.entity.TranslationSetting;
import org.junit.jupiter.api.Test;

/**
 * 优先级只有这一处定义（spec §3.2），所以这三档的组合是全项目"生效档正确"唯一的离线证据。
 * 跑得起来的部分到此为止：行能不能命中、键对不对，全在 tmp/p7a-conv-settings.mjs 那 8 行里。
 */
class ScopeSettingsTest {

    private static TranslationSetting setting(String id, String scope, String to) {
        TranslationSetting s = new TranslationSetting();
        s.setId(Long.valueOf(id));
        s.setScope(scope);
        s.setSendToLang(to);
        return s;
    }

    /** 会话档赢，且连"客户档也在、请求还显式带了 customerId"也算它赢（D-01）。 */
    @Test
    void conversationRowBeatsEverythingBelowIt() {
        ScopeSettings.Resolved r = ScopeSettings.resolve(
            setting("3", "conversation", "hi"), setting("2", "customer", "vi"), setting("1", "global", "en"));
        assertEquals(3L, r.setting().getId());
        assertEquals("hi", r.setting().getSendToLang());
        assertEquals("conversation", r.scope());
        assertFalse(r.inherited());
    }

    @Test
    void customerRowWinsWhenThereIsNoConversationRow() {
        ScopeSettings.Resolved r = ScopeSettings.resolve(
            null, setting("2", "customer", "vi"), setting("1", "global", "en"));
        assertEquals(2L, r.setting().getId());
        assertEquals("customer", r.scope());
        assertFalse(r.inherited(), "UI 要据此显示「该客户专属」");
    }

    @Test
    void globalIsTheInheritedTier() {
        ScopeSettings.Resolved r = ScopeSettings.resolve(null, null, setting("1", "global", "en"));
        assertEquals(1L, r.setting().getId());
        assertEquals("global", r.scope());
        assertTrue(r.inherited(), "UI 要据此显示「沿用全局」");
    }

    /** 全局行是 requireSettings 兜底建的，理论上不会是 null；这里只保证不抛 NPE。 */
    @Test
    void missingAllRowsYieldsNoSettingButStillAGlobalTier() {
        ScopeSettings.Resolved r = ScopeSettings.resolve(null, null, null);
        assertNull(r.setting());
        assertEquals("global", r.scope());
        assertTrue(r.inherited());
    }
}
```

```bash
cd /d/SmartSCRM/apps/server && export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18" && set -o pipefail && \
  ./mvnw test -Dtest='ScopeSettingsTest' 2>&1 | grep -E "ERROR|cannot find|symbol|Tests run" | head -12
```

期望：编译失败（`resolve` 参数形态不对 / `scope()` 不存在）。

- [ ] **Step 2: 改 `ScopeSettings` 成三档**

`service/msg/ScopeSettings.java` 全文替换：

```java
package com.smartscrm.server.service.msg;

import com.smartscrm.server.entity.TranslationSetting;

/**
 * 语向解析只有一条规则：会话档 -> 客户档 -> 全局，取到第一个存在的行就停（spec §3.2）。
 * 不做"字段级合并"——那样一条消息会混用两三个来源的语向，出问题无法解释。
 * 高档行是保存时从"它要覆盖的那一档"整份复制再改的（spec §3.3），所以整行取用是安全的。
 * <p>
 * 判定只看哪一档有行，不看请求带了哪些字段：客户档答"我对这位客户一般怎么说"，
 * 会话档答"我在这个会话里怎么说"，语义更近的赢。反过来（按字段决定）会让同一会话在
 * 内嵌页与记录页两个入口读出不同的生效值。
 */
public final class ScopeSettings {

    public record Resolved(TranslationSetting setting, boolean inherited, String scope) {
    }

    private ScopeSettings() {
    }

    /**
     * 三档输入，任一为 null 就是"这一档没有行"。`global` 为 null 时仍回 `("global", true)`——
     * 调用方（`requireSettings`）理论上不会给出 null，这条只保证这里不抛 NPE。
     */
    public static Resolved resolve(TranslationSetting conversation, TranslationSetting customer,
                                   TranslationSetting global) {
        if (conversation != null) {
            return new Resolved(conversation, false, "conversation");
        }
        if (customer != null) {
            return new Resolved(customer, false, "customer");
        }
        return new Resolved(global, true, "global");
    }
}
```

- [ ] **Step 3: `TranslationService` 读侧改完**

3a. 把 `getSettings` 那两个方法（`:83-92`）整体换成：

```java
    /**
     * 生效行解析：会话档 -> 客户档 -> 全局。**GET 与 translate 共用这一处**（spec §3.2），
     * 所以两个入口不可能读出不同的生效值——回复框旁的摘要与那次发送真正用的语向是同一份。
     * <p>
     * 答的是"这个作用域下的生效行"，不是"这一档有没有行"：会话档不存在时回落到生效档，
     * `inherited` 按 resolve 的结论（spec §3.1 的三态表）。
     */
    public TranslationSettingVO getSettings(Long tenantId, Long customerId, Long accountId, String chatKey) {
        ScopeSettings.Resolved resolved = resolveSetting(tenantId, customerId, accountId, chatKey);
        return toVO(resolved.setting(), resolved.scope(), resolved.inherited());
    }

    private ScopeSettings.Resolved resolveSetting(Long tenantId, Long customerId, Long accountId, String chatKey) {
        String key = ConversationScopeKey.composeOrNull(accountId, chatKey);
        TranslationSetting conversation = key == null ? null : settingRow(tenantId, "conversation", key);
        if (conversation != null) {
            // 命中就不再往下查：优先级与下面两档无关（spec §3.2），传 null 是把"未被咨询"写进调用形状。
            return ScopeSettings.resolve(conversation, null, null);
        }
        Long projected = customerId != null ? customerId : customerOfChat(tenantId, accountId, chatKey);
        TranslationSetting customer = projected == null ? null : customerRow(tenantId, projected);
        return ScopeSettings.resolve(null, customer, requireSettings(tenantId));
    }
```

并在 import 区加 `import com.smartscrm.server.service.msg.ConversationScopeKey;`（与既有的 `import com.smartscrm.server.service.msg.ScopeSettings;` 同组、按字母序在前）。

3b. `translate()`（`:288-369`）整体替换为下面这份——**唯一的变化是 resolve 那一块换成 `resolveSetting`，以及六个 `new TranslateVO(...)` 末尾各多一个 `scope`**：

```java
    // 2) translate()：入口先解析生效行，其余逻辑一律读 s.* 而不是全局
    public TranslateVO translate(Long tenantId, TranslateDTO dto) {
        if (!"receive".equals(dto.type()) && !"send".equals(dto.type())) {
            throw new BizException(40000, "type 只能是 receive 或 send");
        }
        ScopeSettings.Resolved resolved = resolveSetting(tenantId, dto.customerId(), dto.accountId(), dto.chatKey());
        TranslationSetting s = resolved.setting();
        // 生效档随响应带出去：记录页要在"这一条实际按哪一档译出"上说一句话（spec §4③）。
        // 档位取 resolve 的结论而不是行上的列——列写坏了也不该让这里报出一个不存在的档。
        String scope = resolved.scope();
        // 缓存 key 不变：key 里已经含 type + channel + from + to（buildCacheKey），
        // 语向不同天然分键，所以按客户 / 按会话切换语向都不需要新增失效逻辑（spec §5）。
        String fromLang = "receive".equals(dto.type()) ? s.getReceiveFromLang() : s.getSendFromLang();
        String toLang = "receive".equals(dto.type()) ? s.getReceiveToLang() : s.getSendToLang();
        String channel = s.getChannel();
        String normalized = SimulatedTranslationEngine.normalize(dto.text());
        if (normalized.isEmpty()) {
            throw new BizException(40000, "text 不能为空白");
        }
        String cacheKey = buildCacheKey(dto.type(), channel, fromLang, toLang, normalized);
        boolean keepInCache = !Boolean.TRUE.equals(dto.input());

        if (!Boolean.TRUE.equals(dto.noCache())) {
            TranslationCache hit = cacheMapper.selectOne(new LambdaQueryWrapper<TranslationCache>()
                .eq(TranslationCache::getTenantId, tenantId)
                .eq(TranslationCache::getCacheKey, cacheKey));
            if (hit != null) {
                cacheMapper.update(null, new LambdaUpdateWrapper<TranslationCache>()
                    .eq(TranslationCache::getId, hit.getId())
                    .setSql("hit_count = hit_count + 1"));
                return new TranslateVO(hit.getTargetText(), true, Boolean.TRUE.equals(hit.getPartial()),
                    containsChinese(hit.getTargetText()), dto.type(), channel,
                    displayFrom(fromLang, hit.getFromLang()), toLang, cacheKey, false, null, scope);
            }
        }

        // R7: same in and out language — hand back the source, and do not cache it.
        if (fromLang != null && fromLang.equals(toLang)) {
            return new TranslateVO(normalized, false, false, containsChinese(normalized), dto.type(), channel,
                fromLang, toLang, cacheKey, false, null, scope);
        }

        String providerId = CHANNEL_TO_PROVIDER.get(channel);
        if (providerId != null) {
            Credentials creds = loadCredentials(tenantId, providerId);
            if (creds != null) {
                try {
                    ProviderResult online = providers.get(providerId).translate(creds, normalized, fromLang, toLang);
                    if (keepInCache) {
                        writeCache(tenantId, cacheKey, dto.type(), channel, fromLang, toLang,
                            normalized, online.translation(), false);
                    }
                    return new TranslateVO(online.translation(), false, false,
                        containsChinese(online.translation()), dto.type(), channel,
                        displayFrom(fromLang, online.detectedFrom()), toLang, cacheKey, false, null, scope);
                } catch (ProviderException e) {
                    // The request already carries a 4s timeout; one fall-through to the
                    // simulated engine, with the vendor error surfaced instead of swallowed.
                    SimulatedTranslationEngine.EngineResult fallback =
                        engine.translate(normalized, fromLang, toLang, channel);
                    return new TranslateVO(fallback.translation(), false, fallback.partial(),
                        containsChinese(fallback.translation()), dto.type(), channel,
                        fallback.fromLang(), toLang, cacheKey, true, e.getMessage(), scope);
                }
            }
            SimulatedTranslationEngine.EngineResult fallback =
                engine.translate(normalized, fromLang, toLang, channel);
            return new TranslateVO(fallback.translation(), false, fallback.partial(),
                containsChinese(fallback.translation()), dto.type(), channel,
                fallback.fromLang(), toLang, cacheKey, true,
                providerId + " 未配置密钥，此结果来自本地模拟引擎", scope);
        }

        SimulatedTranslationEngine.EngineResult result = engine.translate(normalized, fromLang, toLang, channel);
        if (keepInCache) {
            writeCache(tenantId, cacheKey, dto.type(), channel, fromLang, toLang,
                normalized, result.translation(), result.partial());
        }
        return new TranslateVO(result.translation(), false, result.partial(), containsChinese(result.translation()),
            dto.type(), channel, result.fromLang(), toLang, cacheKey, false, null, scope);
    }
```

3c. `toVO`（`:512-519`）换成三参数，`scope` 由调用方给：

```java
    /**
     * VO 上那一格 `scope` 写的是"这次生效的是哪一档"，由调用方给：读侧给 `ScopeSettings.resolve`
     * 的结论，写侧给刚写入那行自己的列值。不再从 `s.getScope()` 反推——优先级的唯一定义是 resolve，
     * 让 VO 从列上猜会绕开它（spec §3.1 / §3.2）。
     */
    private TranslationSettingVO toVO(TranslationSetting s, String scope, boolean inherited) {
        return new TranslationSettingVO(s.getId(), s.getServer(), s.getServerMode(), s.getChannel(),
            s.getReceiveEnabled(), s.getReceiveFromLang(), s.getReceiveToLang(),
            s.getSendEnabled(), s.getSendFromLang(), s.getSendToLang(),
            s.getVoiceEnabled(), s.getPreviewEnabled(), s.getEnterToSend(),
            s.getDisableChinese(), s.getDisableChinesePreventSend(),
            scope, s.getScopeKey(), inherited);
    }
```

同时 `saveInto` 的最后两行（`:167-168`）改成：

```java
        TranslationSetting saved = settingMapper.selectById(current.getId());
        // 刚写入的那行：档位就是它自己的列值，`inherited` 只有全局行算真。
        return toVO(saved, saved.getScope(), "global".equals(saved.getScope()));
```

3d. `customerOfChat` 上方那段 javadoc 里"生效面 ②"的措辞改成"客户档的会话投影"，并补一句：`resolveSetting` 只在**会话档没命中**时才调它（D-01：会话档优先，与投影无关）。方法本身不动。

3e. **旧重载必须删干净**（不留两参/一参版本，spec §3.2 "只有一处调用方，不留两参重载"）：`grep -rn "getSettings(tenantId)\|ScopeSettings.resolve(" apps/server/src/main/java` 只能剩下新调用形状；`service/TranslationService.java` 里不得再出现 `getSettings(Long tenantId)` 与 `getSettings(Long tenantId, Long customerId)`。

- [ ] **Step 4: `TranslateVO` 带出生效档**

`web/vo/TranslateVO.java`：在 `degradeReason` 之后追加一个组件（放末位是为了让"新字段"在六个构造点上都只是尾巴加一项，不动既有 positional 阅读顺序）：

```java
    /** Why the result is degraded: "未配置密钥" or the vendor error; null otherwise. */
    String degradeReason,
    /**
     * 这次实际用了哪一档：'global' | 'customer' | 'conversation'（spec §3.2）。
     * 与 GET /settings 的 `scope` 同一取值、同一含义，但它是**这一次翻译**的档位——
     * 记录页回复框要在译出之后如实说这一句（§4③），因为屏幕上那枚档位来自更早的一次 GET。
     */
    String scope
```

**同一批还要修 `web/dto/TranslateDTO.java` 的类注释**（`:13-19` 那段现在写着"会话投影是显式 `customerId` 的缺省填充，不是能压过它的另一条通道"——D-01 上线后这句正好说反了：会话**档**能压过显式 `customerId`，而"投影"这件事改成了只在会话档没命中时才参与）。把那段 javadoc 换成：

```java
    /**
     * 可空：不带即按全局译，P5 的调用方一字不改。
     * 生效档的解析顺序固定为 conversation 档 -> customer 档 -> global（spec §3.2 / 裁定 D-01），
     * 与请求带了哪几个字段无关：`accountId` + `chatKey` 齐备就先查会话档，命中即止；
     * 没命中才取 `customerId`（显式带的那一个，或由 `chatKey` 投影出来的那一位）查客户档。
     * 128 与 `chat_conversation.chat_key` 同宽：主进程在盖章处已经裁过一刀，这一层是给
     * 直接打 HTTP 的调用方（记录页、契约脚本）留的兜底，超长只可能是坏请求而不是长会话。
     */
```

`customerId` 那一行的注释同时改掉（它还写着"覆盖行优先，缺省回全局"，两档时代的说法）：换成「可空：会话档没命中时用它定位客户档；不带则由 `accountId` + `chatKey` 投影出会话挂的客户」。DTO 的组件与注解一字不动——只改注释，因为字段形态本来就够了（Task 5 第 2 行断的正是"显式带 `customerId` 也让会话档赢"）。

- [ ] **Step 5: 控制器 GET 多两个参数**

`web/TranslationController.java` 的 `getSettings`（`:42-46`）换成：

```java
    /**
     * 三个作用域参数按 spec §3 的形态给：都不带 = 全局；带 `customerId` = 客户档优先；
     * `accountId` + `chatKey` **齐备** = 会话档优先。只带其中一个等于没带（`composeOrNull` 回 null，
     * 不查这一档、也不报错——读取那条链的容错口径见 Task 2 那条 javadoc）。
     */
    @GetMapping("/settings")
    public ApiResponse<TranslationSettingVO> getSettings(@AuthenticationPrincipal AuthPrincipal principal,
                                                         @RequestParam(required = false) Long customerId,
                                                         @RequestParam(required = false) Long accountId,
                                                         @RequestParam(required = false) String chatKey) {
        return ApiResponse.ok(service.getSettings(principal.tenantId(), customerId, accountId, chatKey));
    }
```

PUT / DELETE 本任务**不动**（Task 4）。

- [ ] **Step 6: Java 全量测试 + 打包 + 起服回归**

```bash
cd /d/SmartSCRM/apps/server && export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18" && set -o pipefail && \
  ./mvnw test 2>&1 | grep -E "Tests run:|BUILD|ERROR" | tail -12
```

期望：`BUILD SUCCESS`，`Tests run` 汇总里 `Failures: 0, Errors: 0`，且 `ScopeSettingsTest` 4 条 + `ConversationScopeKeyTest` 8 条都在跑（`-Dtest` 不带时是全量，P6 那六个测试类一条都不能少）。

**没有 `@SpringBootTest`**（`src/test/.../mapper/` 是空的），所以 service 构造器与 bean 装配的错**只有启动时才暴露**——本任务恰好动了 `toVO` / `resolveSetting`，必须真起一次：

```bash
cd /d/SmartSCRM/apps/server && netstat -ano | grep ':8180' | grep LISTEN   # 有就 taskkill //PID <pid> //F
export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18" && set -o pipefail && ./mvnw -DskipTests package 2>&1 | tail -5
cd /d/SmartSCRM && (java -jar apps/server/target/scrm-server-0.1.0.jar > tmp/p7-server.log 2>&1 &)
for i in $(seq 1 40); do sleep 1; curl -s --max-time 2 http://127.0.0.1:8180/api/health && break; done
curl -s "http://127.0.0.1:8180/api/translation/settings?accountId=5&chatKey=8613800001001%40c.us" -H "authorization: Bearer $TOK"
```

期望：health 通；那条带会话参数的 GET 回 `code:0`、`data.scope` 是 `customer` 或 `global`（此刻还没有会话档写入口，任何结果都**不该**是 `conversation`——出现即说明 resolve 形状写反了）。

- [ ] **Step 7: 老契约不回归（P6 那 10 行仍要全绿）**

```bash
cd /d/SmartSCRM && node tmp/p6b-scope-contract.mjs 2>&1 | tail -16
```

期望：`ALL PASS (10/10)`。这一条是本任务读侧改动的**唯一回归口**：它验的正是"无 customerId 时 `scope:global, inherited:true`"与"客户档命中时 `scope:customer, inherited:false`"两态（spec §3.1 说三态不需要新字段，靠的就是这两个既有字段没被改坏）。它同时会清掉自己建的客户覆盖行（脚本自带的 C4 收尾）。

- [ ] **Step 8: Commit**

```bash
cd /d/SmartSCRM && git add apps/server/src/main/java/com/smartscrm/server/service/msg/ScopeSettings.java \
                          apps/server/src/main/java/com/smartscrm/server/service/TranslationService.java \
                          apps/server/src/main/java/com/smartscrm/server/web/TranslationController.java \
                          apps/server/src/main/java/com/smartscrm/server/web/vo/TranslateVO.java \
                          apps/server/src/test/java/com/smartscrm/server/service/msg/ScopeSettingsTest.java
git commit -m "feat(P7/B16): 三档解析链与读侧——conv ?? cust ?? global

resolveSetting 是 GET 与 translate 共用的一处优先级定义，所以两个入口不可能读出不同的生效值。
三态不加新字段：既有 scope + inherited 的组合已够（本会话专属 / 该客户专属 / 沿用全局），
P5/P6 的两态读法不必同步升级。TranslateVO 带出 scope，档位取 resolve 的结论而不是行上的列。
旧的两个 getSettings 重载删干净——控制器是 Java 侧唯一调用方（已 grep 证实）。"
```

---

### Task 4: 会话档写侧（PUT 三档分派 + DELETE + 租户闸）

**Files:**
- Modify: `apps/server/src/main/java/com/smartscrm/server/web/dto/TranslationSettingInput.java`（末位两个组件）
- Modify: `apps/server/src/main/java/com/smartscrm/server/service/TranslationService.java`（注入 `PlatformAccountMapper`；`updateSettings` 补 `@Transactional`；新增 `updateCustomerSettings` / `updateConversationSettings` / `clearConversationSettings` / `requireAccount`；`copyOf` 泛化；**删掉 `updateScopedSettings`**）
- Modify: `apps/server/src/main/java/com/smartscrm/server/web/TranslationController.java`（PUT 分派为三档 + 新 `DELETE /settings/conversation`）

**Interfaces:**
- Consumes: Task 2 的 `ConversationScopeKey.compose` / `rejectReason`；Task 3 起的 `settingRow` / `customerRow` / `customerOfChat` / `requireSettings` / `saveInto` / `toVO(s, scope, inherited)`
- Produces（Task 5 的驱动与 Task 8 的渲染层写侧以此为准）:
  - `PUT /api/translation/settings`，body `{scope:'conversation', accountId:<Long>, chatKey:'<原始 chat_key>', ...改动字段}` → `TranslationSettingVO`，且 `data.scope==='conversation'`、`data.scopeKey === accountId + ':' + chatKey`
  - `DELETE /api/translation/settings/conversation?accountId=<Long>&chatKey=<原始 chat_key>` → `{cleared:0|1}`（`0` 也是成功）
  - `updateSettings(tenantId, input)` = 全局档；`updateCustomerSettings(tenantId, customerId, input)`；`updateConversationSettings(tenantId, input)`；`clearConversationSettings(tenantId, accountId, chatKey): int`
  - `TranslationSettingInput` 的组件顺序末尾为 `..., String scope, String scopeKey, Long accountId, String chatKey`

**本任务不新增 Java 单测**：没有 `@SpringBootTest`，service 的三个 mapper 在纯 JUnit 里得手动搭一套假库，那份成本不如直接由 Task 5 的 HTTP 驱动拿真实 MySQL 来断言（C7 的既定口径：后端契约在 8180 上验）。本任务的离线闸门是**编译**，运行时闸门是**启动**（构造器多一个参数，装配错只有 boot 才报——见 Step 5）。

- [ ] **Step 1: DTO 加两个定位字段**

`TranslationSettingInput.java`：把末段两行替换为四行，并在 import 区加 `jakarta.validation.constraints.Size`（`MessageItemDTO` 里 `@NotBlank @Size(max = 128) String chatKey` 就是这个用法的先例）：

```java
    /** 可空：缺省即 global；'customer' 时必须带 scopeKey=客户 id；'conversation' 时不接受 scopeKey。 */
    String scope,
    String scopeKey,
    /** scope='conversation' 时必填：`platform_account` 主键。会话档的键由服务端合成，这里只交半件。 */
    Long accountId,
    /** 原样 chat_key（含 `@c.us` / `@g.us` 后缀），不 trim、不折叠大小写。 */
    @Size(max = 128, message = "chatKey 最长 128 字符")
    String chatKey
) {
```

类注释末尾补一段，说清这条 `@Size` 与 service 那道闸的关系（否则以后有人以为删掉它就没人管长度了）：

```java
/**
 * ...（原文照旧）
 * <p>
 * `chatKey` 上的 `@Size(max = 128)` 是**顺手的早退**，不是权威：真正的长度闸在
 * `ConversationScopeKey.rejectReason`（常量 `CHAT_KEY_MAX` 在那里），写入与删除两条路都过它。
 * 两处数字万一不同步，先触发的是 `@Valid`，走 `GlobalExceptionHandler.handleValidation`
 * 也是 `HTTP 400 + code:40000`，只是文案换成 `chatKey 最长 128 字符`。
 * 所以 Task 5 第 5b 行断的是 `code===40000` 而不是具体文案——两道闸谁先响都算守住。
 */
```

- [ ] **Step 2: service——注入账号 mapper**

字段区 `conversationMapper` 之后加一行，构造器参数在 `ChatConversationMapper conversationMapper` 之后插入 `PlatformAccountMapper accountMapper`（`PlatformAccountMapper` 已存在于 `mapper/` 包，`PlatformAccount` 有 `id` / `tenantId` / `platformType`）：

```java
    private final ChatConversationMapper conversationMapper;
    private final PlatformAccountMapper accountMapper;
```

```java
    public TranslationService(TranslationSettingMapper settingMapper, TranslationNodeMapper nodeMapper,
                              TranslationCacheMapper cacheMapper, TranslationCredentialMapper credentialMapper,
                              CustomerMapper customerMapper, ChatConversationMapper conversationMapper,
                              PlatformAccountMapper accountMapper,
                              SimulatedTranslationEngine engine, List<TranslationProvider> providerBeans) {
        this.settingMapper = settingMapper;
        this.nodeMapper = nodeMapper;
        this.cacheMapper = cacheMapper;
        this.credentialMapper = credentialMapper;
        this.customerMapper = customerMapper;
        this.conversationMapper = conversationMapper;
        this.accountMapper = accountMapper;
        this.engine = engine;
        this.providers = providerBeans.stream()
            .collect(Collectors.toMap(TranslationProvider::providerId, Function.identity()));
    }
```

import 区补 `com.smartscrm.server.entity.PlatformAccount` 与 `com.smartscrm.server.mapper.PlatformAccountMapper`（`ConversationScopeKey` 与 `ScopeSettings` 已在 Task 3 前后引入过 `service.msg` 包，本类已有 `import com.smartscrm.server.service.msg.ScopeSettings;`，改成同包的 `ConversationScopeKey` 需另起一行 import）。

- [ ] **Step 3: service——三档写入口，替换 `updateSettings` + `updateScopedSettings` 整段**

把现有的 `updateSettings(Long, TranslationSettingInput)` 与 `updateScopedSettings(...)` 两个方法（`// ============ settings ============` 之后那 30 行）整段换成下面这份。`clearCustomerSettings` 保持原样，紧接其后加会话档的删除与租户闸：

```java
    /** 全局档：唯一不需要定位参数的档位，"库里还没有全局行"由 requireSettings 兜底建行。 */
    @Transactional
    public TranslationSettingVO updateSettings(Long tenantId, TranslationSettingInput input) {
        return saveInto(requireSettings(tenantId), tenantId, input);
    }

    /**
     * 客户档：从**全局行**整份复制后覆盖。这里的"整份"是 P6 定下的语义（未提交的列不能是 NULL，
     * 得是复制那一刻全局的值），复制源不含会话档——客户那一行是全局给这位客户的默认，
     * 与某一条会话里改过什么无关。
     * customerId 由控制器解好数字（P-06：档位形态的判定只在一处），所以这里判 null 只可能是
     * 调用方漏了参数，直接 40000。
     */
    @Transactional
    public TranslationSettingVO updateCustomerSettings(Long tenantId, Long customerId, TranslationSettingInput input) {
        if (customerId == null) {
            throw new BizException(40000, "scope=customer 时必须带 scopeKey");
        }
        Customer customer = customerMapper.selectOne(new LambdaQueryWrapper<Customer>()
            .eq(Customer::getTenantId, tenantId).eq(Customer::getId, customerId).last("LIMIT 1"));
        if (customer == null) {
            throw new BizException(40404, "客户不存在: " + customerId);
        }
        TranslationSetting existing = customerRow(tenantId, customerId);
        if (existing == null) {
            existing = copyOf(requireSettings(tenantId), tenantId, "customer", String.valueOf(customerId));
            settingMapper.insert(existing);
        }
        // saveInto 只认"改哪些字段"，行由调用方给：三档共用同一份校验 + 赋值（R5：规则不出现两份）。
        return saveInto(existing, tenantId, input);
    }

    /**
     * 会话档。键在 service 内合成（P-06 裁定）：spec §3.3 要求复制源是"这一条会话此刻的生效值"
     * = `cust ?? global`，而找那位客户要的是 `accountId` + `chatKey` 的投影——只给一条成形键就
     * 必须反解析它。键只整串比对、不反解析，比参数形态的字面一致更重要。
     * <p>
     * 首次建行抄的是 `customerRow ?? global`：从弹层里第一次保存时前端手里那份就是 resolve 的结果，
     * 整份复制让"新出现的会话行"与"用户此刻看到的值"逐字段相同。合成链与读侧同一条
     * （`customerOfChat` → `customerRow` → `requireSettings`），所以第一次 PUT 建出的行，
     * 与 PUT 之前 GET 读到的那一行只差本次改动的那几个字段。
     */
    @Transactional
    public TranslationSettingVO updateConversationSettings(Long tenantId, TranslationSettingInput input) {
        Long accountId = requireAccount(tenantId, input.accountId());
        String key = ConversationScopeKey.compose(accountId, input.chatKey());
        TranslationSetting existing = settingRow(tenantId, "conversation", key);
        if (existing != null) {
            return saveInto(existing, tenantId, input);
        }
        Long projected = customerOfChat(tenantId, accountId, input.chatKey());
        TranslationSetting source = projected == null ? null : customerRow(tenantId, projected);
        if (source == null) {
            source = requireSettings(tenantId);
        }
        TranslationSetting created = copyOf(source, tenantId, "conversation", key);
        settingMapper.insert(created);
        return saveInto(created, tenantId, input);
    }
```

```java
    /**
     * 删会话覆盖行 = 这条会话回到"客户档，没有客户档再回全局"。
     * 形状判定用 `rejectReason` 而不是 `compose`：两者抛的都是 40000，但这条方法要把
     * "参数不合法"与"库里没有这一行"分开报（C12）——后者是 `cleared:0` 的正常成功，
     * 拿异常去表达它，界面读到的就是"按钮坏了"。
     */
    @Transactional
    public int clearConversationSettings(Long tenantId, Long accountId, String chatKey) {
        String reason = ConversationScopeKey.rejectReason(accountId, chatKey);
        if (reason != null) {
            throw new BizException(40000, reason);
        }
        requireAccount(tenantId, accountId);
        return settingMapper.delete(new LambdaQueryWrapper<TranslationSetting>()
            .eq(TranslationSetting::getTenantId, tenantId)
            .eq(TranslationSetting::getScope, "conversation")
            .eq(TranslationSetting::getScopeKey, ConversationScopeKey.compose(accountId, chatKey)));
    }

    /**
     * 会话档的定位半边之一：`accountId` 必须是**本租户**的账号。判 40000 而不是 40404（spec §7），
     * 因为调用方拿到的是"你给的这半件配不成一条键"，不是"某个资源不见了"。
     * <p>
     * 不拦的后果不自愈：合成出的 `scope_key` 挂在别人家账号名下，读侧按同一条合成链永远查不到这一行，
     * 界面表现为「保存成功、徽标却不动」，而后端一句不响。
     */
    private Long requireAccount(Long tenantId, Long accountId) {
        if (accountId == null) {
            throw new BizException(40000, "scope=conversation 时必须带 accountId");
        }
        Long owned = accountMapper.selectCount(new LambdaQueryWrapper<PlatformAccount>()
            .eq(PlatformAccount::getTenantId, tenantId)
            .eq(PlatformAccount::getId, accountId));
        if (owned == 0) {
            throw new BizException(40000, "accountId 不属于本租户: " + accountId);
        }
        return accountId;
    }
```

- [ ] **Step 4: service——`copyOf` 泛化（键的形态由调用方给）**

`copyOf` 的签名从 `(TranslationSetting global, Long tenantId, Long customerId)` 换成 `(TranslationSetting source, Long tenantId, String scope, String scopeKey)`，16 个字段照抄的部分一字不改，只换定位那三行与形参名：

```java
    /**
     * 整份复制一条覆盖行：除定位列外的全部字段照抄，之后由 saveInto 打上本次改动。
     * `source` 不必是全局行——客户档从全局复制，会话档从"该会话此刻的生效行"复制（见调用处），
     * 所以源与目标档位都是参数。
     */
    private static TranslationSetting copyOf(TranslationSetting source, Long tenantId, String scope, String scopeKey) {
        TranslationSetting row = new TranslationSetting();
        row.setTenantId(tenantId);
        row.setScope(scope);
        row.setScopeKey(scopeKey);
        row.setServer(source.getServer());
        row.setServerMode(source.getServerMode());
        row.setChannel(source.getChannel());
        row.setReceiveEnabled(source.getReceiveEnabled());
        row.setReceiveFromLang(source.getReceiveFromLang());
        row.setReceiveToLang(source.getReceiveToLang());
        row.setSendEnabled(source.getSendEnabled());
        row.setSendFromLang(source.getSendFromLang());
        row.setSendToLang(source.getSendToLang());
        row.setVoiceEnabled(source.getVoiceEnabled());
        row.setPreviewEnabled(source.getPreviewEnabled());
        row.setEnterToSend(source.getEnterToSend());
        row.setDisableChinese(source.getDisableChinese());
        row.setDisableChinesePreventSend(source.getDisableChinesePreventSend());
        return row;
    }
```

- [ ] **Step 5: controller——PUT 分三档 + 新 DELETE**

替换 `updateSettings` 方法体，并在 `clearCustomer` 之后加会话档那条；import 区补 `com.smartscrm.server.service.msg.ConversationScopeKey`：

```java
    @PutMapping("/settings")
    public ApiResponse<TranslationSettingVO> updateSettings(@AuthenticationPrincipal AuthPrincipal principal,
                                                            @Valid @RequestBody TranslationSettingInput input) {
        String scope = input.scope() == null || input.scope().isBlank() ? "global" : input.scope();
        return switch (scope) {
            // 全局档无定位参数；库里没有全局行时由 requireSettings 建。
            case "global" -> ApiResponse.ok(service.updateSettings(principal.tenantId(), input));
            // 客户档的键就是客户 id 的十进制形态，数字解析留在这里（P-06：service 只认解好的 id）。
            case "customer" -> ApiResponse.ok(
                service.updateCustomerSettings(principal.tenantId(), customerScopeKey(input), input));
            // 会话档：先就地判形状（`compose` 抛的也是 40000，但这里能给出更好的分派时机），
            // 再显式拒掉"带 scopeKey"的请求——那条键的形态只有 Java 知道，让调用方递一条成形键进来,
            // 等于把"键可以拼"这件事重新开放出去（spec §3.4）。
            case "conversation" -> {
                String reason = ConversationScopeKey.rejectReason(input.accountId(), input.chatKey());
                if (reason != null) {
                    throw new BizException(40000, reason);
                }
                if (input.scopeKey() != null && !input.scopeKey().isBlank()) {
                    throw new BizException(40000, "scope=conversation 用 accountId + chatKey 定位，不接受 scopeKey");
                }
                yield ApiResponse.ok(service.updateConversationSettings(principal.tenantId(), input));
            }
            default -> throw new BizException(40000, "scope 只能是 global / customer / conversation");
        };
    }

    /** 客户档的键：既有语义（数字客户 id 的字符串形态），只是从 `updateScopedSettings` 里搬了出来。 */
    private static Long customerScopeKey(TranslationSettingInput input) {
        if (input.scopeKey() == null || input.scopeKey().isBlank()) {
            return null;
        }
        try {
            return Long.valueOf(input.scopeKey().trim());
        } catch (NumberFormatException e) {
            throw new BizException(40000, "scopeKey 必须是数字客户 id: " + input.scopeKey());
        }
    }
```

```java
    /**
     * 两个参数都 `required = false`：少了哪半件都要回 40000 且文案指名道姓（`rejectReason` 供），
     * 而 Spring 的 `MissingServletRequestParameterException` 到不了那个形状。
     * 删除的幂等由 `{cleared:0|1}` 如实表达，"本来就没有"不报成失败。
     */
    @DeleteMapping("/settings/conversation")
    public ApiResponse<Map<String, Integer>> clearConversation(@AuthenticationPrincipal AuthPrincipal principal,
                                                               @RequestParam(required = false) Long accountId,
                                                               @RequestParam(required = false) String chatKey) {
        return ApiResponse.ok(Map.of("cleared",
            service.clearConversationSettings(principal.tenantId(), accountId, chatKey)));
    }
```

- [ ] **Step 6: 全量测试 + 重启（构造器改动的运行时闸门）**

```bash
cd /d/SmartSCRM/apps/server && export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18" && set -o pipefail && ./mvnw test 2>&1 | grep -E "Tests run:|BUILD|ERROR" | tail -8
```

期望：`BUILD SUCCESS`、`Failures: 0, Errors: 0`，`ConversationScopeKeyTest` 8 条与 `ScopeSettingsTest` 4 条都在跑，P6/P5 那八个测试类一条不少。

然后按 C8 重启（**这一条不能跳**：`PlatformAccountMapper` 是新增的构造参数，Spring 装配错只在启动时暴露，`./mvnw test` 里没有 `@SpringBootTest`，测不出它）：

```bash
cd /d/SmartSCRM && netstat -ano | grep ':8180' | grep LISTEN   # 有就 taskkill //PID <pid> //F
cd /d/SmartSCRM/apps/server && export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18" && set -o pipefail && ./mvnw -DskipTests package 2>&1 | tail -4
cd /d/SmartSCRM && (java -jar apps/server/target/scrm-server-0.1.0.jar > tmp/p7-server.log 2>&1 &)
for i in $(seq 1 40); do sleep 1; curl -s --max-time 2 http://127.0.0.1:8180/api/health && break; done
```

期望：health 通；`tmp/p7-server.log` 里**没有** `UnsatisfiedDependencyException` / `NoSuchBeanDefinitionException`（有即 `PlatformAccountMapper` 没被扫到，如实记为未通过）。

- [ ] **Step 7: 四条冒烟（写入 → 读回 → 删除 → 拒 sneak）**

```bash
cd /d/SmartSCRM && TOK=$(curl -s -X POST http://127.0.0.1:8180/api/auth/login -H 'content-type: application/json' \
  -d '{"inviteCode":"DEMO0001","username":"admin","password":"admin123","deviceId":"p7-w1"}' | sed 's/.*"accessToken":"\([^"]*\)".*/\1/')
# 账号 id 现取一条 WhatsApp 账号（不硬编码：种子换过 id 会整批假失败）
ACC=$(curl -s "http://127.0.0.1:8180/api/platform-accounts" -H "authorization: Bearer $TOK" | sed 's/},{"platformType":/\n{"platformType":/g' | grep '"platformType":1' | head -1 | sed 's/.*"id":\([0-9]*\).*/\1/')
echo "ACC=$ACC"
curl -s -X PUT http://127.0.0.1:8180/api/translation/settings -H "authorization: Bearer $TOK" -H 'content-type: application/json' \
  -d "{\"scope\":\"conversation\",\"accountId\":$ACC,\"chatKey\":\"P7A-smoke@c.us\",\"channel\":\"1\",\"sendToLang\":\"hi\"}"
curl -s "http://127.0.0.1:8180/api/translation/settings?accountId=$ACC&chatKey=P7A-smoke%40c.us" -H "authorization: Bearer $TOK"
curl -s -X DELETE "http://127.0.0.1:8180/api/translation/settings/conversation?accountId=$ACC&chatKey=P7A-smoke%40c.us" -H "authorization: Bearer $TOK"
curl -s -X PUT http://127.0.0.1:8180/api/translation/settings -H "authorization: Bearer $TOK" -H 'content-type: application/json' \
  -d "{\"scope\":\"conversation\",\"accountId\":$ACC,\"chatKey\":\"P7A-smoke@c.us\",\"scopeKey\":\"9\",\"sendToLang\":\"hi\"}"
```

四条各自的期望（一条达不到就停在原地查，不要往下跑 Task 5）：

1. `code:0`、`data.scope==="conversation"`、`data.scopeKey==="<ACC>:P7A-smoke@c.us"`（**键由服务端合成，`chatKey` 里不含 `<ACC>:`**）、`data.sendToLang==="hi"`、`data.channel==="1"`。
2. `code:0`、`data.scope==="conversation"`、`data.inherited===false`、`data.sendToLang==="hi"`——读侧与写侧在同一把键上会师，这条是 Task 3 那个"永远回落"中间态的出口。
3. `code:0`、`data.cleared===1`。
4. `code:40000`，`message` 含 `不接受 scopeKey`。**这条断的是"调用方拼不出别人的键"这道闸还在**；返回 `code:0` 就说明分派写漏了，会话档可以被塞进任意一条键。

跑完第 4 条后库里不该留冒烟行（第 3 条已删）。若第 1 条成功、第 3 条 `cleared===0`，那是**合成不对称**的铁证：写入用了一把键、删除用了另一把——先查 `compose` 的两个调用处有没有各自加工 `chatKey`。

- [ ] **Step 8: 老契约不回归**

```bash
cd /d/SmartSCRM && node tmp/p6b-scope-contract.mjs 2>&1 | tail -16
```

期望：`ALL PASS (10/10)`。这条同时守住了 `updateScopedSettings` 被拆掉之后客户档的行为（#2 / #8 / #9 三行验的正是 `scope=customer` 的写入、缺 `scopeKey` 的 40000、客户不存在的 40404）——那三行现在是新路径 `updateCustomerSettings` 在服务，老驱动是唯一还盯着它们的证据。

- [ ] **Step 9: Commit**

```bash
cd /d/SmartSCRM && git add apps/server/src/main/java/com/smartscrm/server/web/dto/TranslationSettingInput.java \
                          apps/server/src/main/java/com/smartscrm/server/service/TranslationService.java \
                          apps/server/src/main/java/com/smartscrm/server/web/TranslationController.java
git commit -m "feat(P7/B16): 会话档写侧——PUT 三档分派、DELETE 与租户闸

updateScopedSettings 拆成三档命名入口：一个方法里 switch 档位形态的形状留着，
下一次加档位还会有人顺手往那个 switch 里塞。scope 白名单只在控制器一处。
会话档首次建行的复制源是「该会话此刻的生效行」= cust ?? global，与 GET 的 resolve 同一条链；
所以从弹层第一次保存不需要先 GET 再 PUT，也不会把没看见的列写成 NULL。
accountId 不属于本租户判 40000 不判 40404：调用方拿到的是「这半件配不成键」。
不拦的后果不自愈——合成键挂在别人家账号下，读侧永远查不到，界面表现为保存成功但徽标不动。"
```

---

### Task 5: 后端契约驱动 `tmp/p7a-conv-settings.mjs`（spec §8 那 8 行）

**Files:**
- Create: `tmp/p7a-conv-settings.mjs`（gitignored，**本任务无 commit**）
- Create: `tmp/p7a-conv-settings.json`（中文载荷，由驱动自己写出，见 Step 1）

**Interfaces:**
- Consumes: Task 4 的 PUT / DELETE / GET 三档形态；`GET /api/platform-accounts`（取真 `accountId`）；`GET /api/conversations?accountId=&size=`（取真 `chatKey` + 真 `customerId`）；`GET /api/customers?pageSize=`（取一个客户 id）
- Produces: 一份 16 行的 PASS/FAIL 表（§8 八条契约行 + 边界五例 + 收尾三条），`ALL PASS (16/16)` 是 Task 11 验收文档里"后端契约"那一档的唯一证据来源

- [ ] **Step 1: 先跑一次「前提探测」，确认本机有可用的会话夹具**

驱动的 1/4/5 三行需要一条**已挂客户**的真实会话（spec §8 第 4 行断的是"会话档压过显式 customerId"，没有这样一条会话就只能退成 fixture，那一条的断言强度会掉一档）。开工前先手工确认：

```bash
cd /d/SmartSCRM && TOK=$(curl -s -X POST http://127.0.0.1:8180/api/auth/login -H 'content-type: application/json' \
  -d '{"inviteCode":"DEMO0001","username":"admin","password":"admin123","deviceId":"p7-w0"}' | sed 's/.*"accessToken":"\([^"]*\)".*/\1/')
ACC=$(curl -s "http://127.0.0.1:8180/api/platform-accounts" -H "authorization: Bearer $TOK" | sed 's/},{"platformType":/\n{"platformType":/g' | grep '"platformType":1' | head -1 | sed 's/.*"id":\([0-9]*\).*/\1/')
curl -s "http://127.0.0.1:8180/api/conversations?accountId=$ACC&size=200" -H "authorization: Bearer $TOK" \
  | sed 's/},{"accountId":/\n{"accountId":/g' | grep -v '"customerId":null' | head -5
```

期望：至少一行 `customerId` 非 `null`。拿不到就先补种子再回来（`node tmp/p6-task17-seed.mjs 21` 是 P6 Task 17 留的补数据口）；**补不出来就把第 4 行改写成"该会话未挂客户 → 会话档压过全局"并在报告里如实标注这一行弱了一档**，不接受直接删掉那一行。

- [ ] **Step 2: 写驱动**

`tmp/p7a-conv-settings.mjs` 全文（**一整块连续代码**，中间不再分节粘贴）。执行顺序是 **1 → 7 → 5 → 2 → 3 → 4 → 8 → 6 → 边界 → 收尾**（与 P6 驱动同一套思路：把"依赖前面写入状态"的行往后排，把还原放最后；#5 必须紧跟 #7，因为它要的形状是"客户档在、会话档还没有"）：

```js
// tmp/p7a-conv-settings.mjs — P7/B16 后端契约：会话档 scope='conversation'
// 用法：node tmp/p7a-conv-settings.mjs        （后端需在 :8180 上跑 Task 4 的构建）
// 退出码：0=全绿 / 1=断言失败 / 2=前提不成立（没有真账号、没有已挂客户的会话、全局行读不到）
// 口径：accountId / chatKey / customerId 一律现取，不硬编码种子 id；中文正文走 UTF-8 文件。
// 本驱动写的每一行都带 channel:'1'（本地模拟引擎）：全局行可能停在百度/腾讯线，
//   契约验证不该把一次真实厂商调用变成前提——那需要用户授权出网，也不该由脚本触发。
// 收尾：脚本自己建的会话档全部删净，客户档与全局行还原为开跑前读到的那份快照。
import { readFileSync, writeFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:8180';
const rows = [];
const responses = {};
let failures = 0;
let tok = null;

function check(name, pass, expected, actual) {
  rows.push({ name, pass, expected, actual });
  if (!pass) failures++;
}

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
  return await res.json();
}
const get = (p) => req('GET', p);
const post = (p, body) => req('POST', p, body);
const put = (p, body) => req('PUT', p, body);
const del = (p) => req('DELETE', p);

const ok = (r) => r?.code === 0;
const keyOf = (acct, chat) => `${acct}:${chat}`;

// —— 前提：登录、取一条 WhatsApp 账号、取一条已挂客户的会话、取全局与客户行快照 ——
const login = await post('/api/auth/login', {
  inviteCode: 'DEMO0001', username: 'admin', password: 'admin123', deviceId: 'p7b16-conv',
});
tok = login?.data?.accessToken;
if (!tok) { console.log('login failed: ' + JSON.stringify(login)); process.exit(1); }
responses.login = login.code;

const accts = await get('/api/platform-accounts');
const acct = (accts.data ?? []).find((a) => a.platformType === 1);
if (!acct?.id) {
  console.log('前提不成立：租户内没有 platformType=1 的账号，会话档无处定位。'
    + ` 读到 ${JSON.stringify((accts.data ?? []).map((a) => `${a.id}:${a.platformType}`))}`);
  process.exit(2);
}
const ACCT = acct.id;
// 一条不存在的账号：租户闸的对照项。取现读最大值 +100 万，不猜 id 段。
const ids = (accts.data ?? []).map((a) => Number(a.id)).filter((n) => Number.isFinite(n));
const FOREIGN = (ids.length ? Math.max(...ids) : 0) + 1_000_000;

const convs = await get(`/api/conversations?accountId=${ACCT}&size=200`);
const linked = (convs.data?.records ?? []).find((c) => c.customerId != null && typeof c.chatKey === 'string');
if (!linked) {
  console.log('前提不成立：这个账号下没有已挂客户的会话，第 4 行退不成"压过显式 customerId"。'
    + ' 先跑 node tmp/p6-task17-seed.mjs 21 补会话-客户关联。');
  process.exit(2);
}
const LINKED_CHAT = linked.chatKey;
const CUST = linked.customerId;
console.log(`fixtures: ACCT=${ACCT} LINKED_CHAT=${LINKED_CHAT} CUST=${CUST}`);

const g0r = await get('/api/translation/settings');
if (!ok(g0r) || !g0r.data?.id) {
  console.log('前提不成立：读不到全局设置行。' + JSON.stringify(g0r));
  process.exit(2);
}
const G0 = g0r.data; // 全局快照，收尾逐字段比对用
responses.pre = { ACCT, FOREIGN, LINKED_CHAT, CUST, globalId: G0.id, channel: G0.channel };

// 客户档快照：#7 会改它（铺成两个新码），收尾必须原样还回去。
// 没有覆盖行时记 null（表示"该客户开跑前跟随全局"），收尾据此决定是 PUT 还原还是 DELETE 清掉。
const c0r = await get(`/api/translation/settings?customerId=${CUST}`);
const C0 = c0r.data?.inherited === false ? c0r.data : null;

// 三个互不相同、且都不等于全局两个现值的语种码：客户档收信 / 客户档发信 / 会话档收信。
// 不能用同一个码——"读到了对的那一行"与"读到了任意一行"必须分得开（断言要能区分"生效了"与"没做事"）。
const pool = ['hi', 'vi', 'th', 'en', 'ja', 'ko'].filter((l) => l !== G0.receiveToLang && l !== G0.sendToLang);
if (pool.length < 3) {
  console.log(`前提不成立：挑不出三个与全局都不同的语种码。全局现值 recv=${JSON.stringify(G0.receiveToLang)} send=${JSON.stringify(G0.sendToLang)}，候选剩 ${JSON.stringify(pool)}`);
  process.exit(2);
}
const [LANG_RECV, LANG_SEND, LANG_CONV] = pool;

// 读某一档：会话档带 accountId+chatKey，客户档带 customerId，全局无参
const settingsOf = (ref) => get('/api/translation/settings'
  + (ref?.conv ? `?accountId=${ref.a}&chatKey=${encodeURIComponent(ref.c)}`
    : ref?.cust ? `?customerId=${ref.cust}` : ''));
// 写：会话档 / 客户档，都强制 channel:'1'
const putConv = (chat, patch) => put('/api/translation/settings',
  { scope: 'conversation', accountId: ACCT, chatKey: chat, channel: '1', ...patch });
const delConv = (chat) => del(`/api/translation/settings/conversation?accountId=${ACCT}&chatKey=${encodeURIComponent(chat)}`);
const putCust = (id, patch) => put('/api/translation/settings',
  { scope: 'customer', scopeKey: String(id), channel: '1', ...patch });
const delCust = (id) => del(`/api/translation/settings/customer/${id}`);
const created = [];

// ============ #1 大小写敏感（V9 utf8mb4_bin 的行为证据）============
const UP = `P7A-${ACCT}-CASE-UP@c.us`;
const LOW = `P7A-${ACCT}-CASE-up@c.us`;
const w1a = await putConv(UP, { receiveToLang: LANG_RECV });
const w1b = await putConv(LOW, { receiveToLang: LANG_SEND });
created.push(UP, LOW);
const r1a = await settingsOf({ conv: true, a: ACCT, c: UP });
const r1b = await settingsOf({ conv: true, a: ACCT, c: LOW });
responses.r1 = { w1a, w1b, r1a, r1b };
check('#1 只差大小写的两条会话档 → 两条行、两个值（unicode_ci 会撞成一条）',
  ok(w1a) && ok(w1b) && w1a.data?.id !== w1b.data?.id
    && w1a.data?.scopeKey === keyOf(ACCT, UP) && w1b.data?.scopeKey === keyOf(ACCT, LOW)
    && r1a.data?.receiveToLang === LANG_RECV && r1b.data?.receiveToLang === LANG_SEND,
  `两条 PUT 都 code:0 且 id 不同；scopeKey 分别 "${keyOf(ACCT, UP)}" / "${keyOf(ACCT, LOW)}"；两次 GET 读回 ${LANG_RECV} / ${LANG_SEND}`,
  `id=${w1a.data?.id}/${w1b.data?.id} key=${JSON.stringify(w1a.data?.scopeKey)}/${JSON.stringify(w1b.data?.scopeKey)} 读回=${JSON.stringify(r1a.data?.receiveToLang)}/${JSON.stringify(r1b.data?.receiveToLang)}`);

// ============ #7 删会话档 → 回落到下一档（先建后删，为 #5/#2..#4 铺好夹具）============
// 本行排在最前是有意的：它把 LINKED_CHAT 这条会话摆成"客户档存在、会话档不存在"的形状，
// 而 #5 的复制源断言**只有在这个形状下才测得到客户档**——会话档一旦存在，读到的就是它自己。
const setupCust = await putCust(CUST, { receiveToLang: LANG_RECV, sendToLang: LANG_SEND });
if (!ok(setupCust)) {
  console.log(`前提不成立：铺客户档夹具失败（#5/#7/#2 全依赖这一份）。code=${setupCust.code} msg="${setupCust.message ?? ''}"`);
  process.exit(2);
}
const d7 = await delConv(LINKED_CHAT); // 本来就没有这一档：cleared 应为 0，且不算失败
const r7 = await settingsOf({ conv: true, a: ACCT, c: LINKED_CHAT });
responses.r7 = { d7, r7 };
check('#7 DELETE 未建立过的会话档 → cleared:0 且 code:0；GET 回落客户档',
  d7.code === 0 && d7.data?.cleared === 0
    && ok(r7) && r7.data?.scope === 'customer' && r7.data?.inherited === false
    && r7.data?.receiveToLang === LANG_RECV,
  `cleared=0 / code=0（幂等：没有覆盖行不是错误）；GET: scope=customer inherited=false to=${LANG_RECV}`,
  `DELETE code=${d7.code} cleared=${JSON.stringify(d7.data?.cleared)} msg="${d7.message ?? ''}" | GET scope=${r7.data?.scope} inherited=${r7.data?.inherited} to=${JSON.stringify(r7.data?.receiveToLang)}`);

// ============ #5 首次建会话档的复制源 = 该会话此刻的生效行（spec §3.3）============
// 判别点在**这次没提交的那几列**：本次 PUT 只交定位半件 + `channel:'1'`（不发厂商请求），
// receiveToLang / sendToLang 走的是 PUT 的局部提交语义（不传即保留库里现值），
// 于是它们的值只能来自**新行建出来时的复制源**。源是全局 → 等于 G0；源是客户档 → 等于 LANG_*。
// 形状前提由 #7 摆好：这一条会话此刻没有会话档、有客户档。
const w5 = await putConv(LINKED_CHAT, {});
created.push(LINKED_CHAT);
const r5 = w5.data ?? {};
responses.r5 = { w5, G0, C0, langs: { LANG_RECV, LANG_SEND, LANG_CONV } };
check('#5 首次建会话档：未提交的列取自「该会话的生效档」= 客户档，不是全局（spec §3.3）',
  ok(w5) && r5.scope === 'conversation' && r5.scopeKey === keyOf(ACCT, LINKED_CHAT)
    && r5.receiveToLang === LANG_RECV && r5.receiveToLang !== G0.receiveToLang
    && r5.sendToLang === LANG_SEND && r5.sendToLang !== G0.sendToLang,
  `新行 scope=conversation / scopeKey="${keyOf(ACCT, LINKED_CHAT)}" / receiveToLang=${LANG_RECV} / sendToLang=${LANG_SEND}，两者都 != 全局(${JSON.stringify(G0.receiveToLang)}/${JSON.stringify(G0.sendToLang)})`,
  `code=${w5.code} scope=${r5.scope} key=${JSON.stringify(r5.scopeKey)} recv=${JSON.stringify(r5.receiveToLang)} send=${JSON.stringify(r5.sendToLang)} 全局=(${JSON.stringify(G0.receiveToLang)}/${JSON.stringify(G0.sendToLang)}) msg="${w5.message ?? ''}"`);

// ============ #2 会话档压过显式 customerId（D-01）============
// #5 刚建出的那一行，`receiveToLang` 与客户档同值（那正是"整份复制"的证据），
// 所以这一行先把它改成第三个码：三个互不相同的值，"读到了会话档"才与"读到了客户档"分得开。
const w2 = await putConv(LINKED_CHAT, { receiveToLang: LANG_CONV });
const r2 = await settingsOf({ conv: true, a: ACCT, c: LINKED_CHAT });
const r2c = await get(`/api/translation/settings?customerId=${CUST}`);
responses.r2 = { w2, r2, r2c };
check(`#2 会话档存在时 GET 读会话档（${LANG_CONV}），客户档那一份 ${LANG_RECV} 被压过`,
  ok(w2) && w2.data?.scope === 'conversation' && w2.data?.inherited === false
    && r2.data?.receiveToLang === LANG_CONV && r2.data?.scope === 'conversation'
    && r2c.data?.receiveToLang === LANG_RECV,
  `PUT: scope=conversation / inherited=false；会话 GET: receiveToLang=${LANG_CONV}；客户 GET: 仍是 ${LANG_RECV}（两份并存、互不覆盖）`,
  `PUT code=${w2.code} scope=${w2.data?.scope} | 会话 GET to=${JSON.stringify(r2.data?.receiveToLang)} scope=${r2.data?.scope} | 客户 GET to=${JSON.stringify(r2c.data?.receiveToLang)}`);

// ============ #3 客户档在、会话档没有 → 读客户档（三档链的第二跳）============
const r3 = await settingsOf({ cust: CUST });
const g3 = await get('/api/translation/settings');
responses.r3 = { r3, g3 };
check('#3 客户档 GET 仍是它自己；无参全局 GET 未被上面任何一次写入带动',
  ok(r3) && r3.data?.scope === 'customer' && r3.data?.inherited === false
    && r3.data?.receiveToLang === LANG_RECV && r3.data?.sendToLang === LANG_SEND
    && ok(g3) && g3.data?.id === G0.id && g3.data?.scope === 'global' && g3.data?.inherited === true,
  `客户档: scope=customer to=${LANG_RECV} sendTo=${LANG_SEND}；全局: id=${G0.id} inherited=true（channel=${JSON.stringify(G0.channel)} 也不该动）`,
  `客户档 code=${r3.code} scope=${r3.data?.scope} recv=${JSON.stringify(r3.data?.receiveToLang)} send=${JSON.stringify(r3.data?.sendToLang)} | 全局 id=${g3.data?.id} inherited=${g3.data?.inherited} channel=${JSON.stringify(g3.data?.channel)}`);

// ============ #4 显式 customerId 也压不过会话档（POST /translate 那一侧的同一优先级）============
// 中文正文写在脚本里、由脚本以 UTF-8 写出文件再按文件字节发（C7：不经 shell 的 `-d`）。
const payload = {
  accountId: ACCT, chatKey: LINKED_CHAT, customerId: CUST,
  text: '我的包裹什么时候能到？麻烦帮我查一下，谢谢。', type: 'receive',
};
writeFileSync('tmp/p7a-conv-settings.json', JSON.stringify(payload) + '\n', 'utf8');
const rawUtf8 = readFileSync('tmp/p7a-conv-settings.json', 'utf8'); // 中文正文以文件字节进请求（C7）
const t4 = await post('/api/translation/translate', rawUtf8);
responses.r4 = t4;
check('#4 POST /translate 带 customerId 仍按会话档出译文（两个入口同一条 resolve）',
  t4.code === 0 && t4.data?.toLangCode === LANG_CONV && t4.data?.scope === 'conversation'
    && t4.data?.channel === '1',
  `code:0 / toLangCode="${LANG_CONV}"（会话档那份，不是客户档的 ${LANG_RECV}）/ scope="conversation" / channel="1"`,
  `code=${t4.code} to=${JSON.stringify(t4.data?.toLangCode)} scope=${JSON.stringify(t4.data?.scope)} channel=${JSON.stringify(t4.data?.channel)} from=${JSON.stringify(t4.data?.fromLangCode)} key=${t4.data?.cacheKey} msg="${t4.message ?? ''}"`);

// ============ #8 换一条会话 → 缓存分键，且不影响上一条（cacheKey 由语种决定，不由档位决定）============
// OTHER 是**没有**会话档的一条会话：`customerId` 显式带上，所以它不依赖 chat_conversation 里
// 有没有这一行（`resolveSetting` 的投影只在 customerId 缺席时才查）。它测的是"会话档缺席 → 落到客户档"
// 那一跳在**翻译**这条入口上成立，而 #3 测的是它在 GET 上成立。
const OTHER = `P7A-${ACCT}-NOCONV@c.us`;
const t8a = await post('/api/translation/translate', rawUtf8);
const t8b = await post('/api/translation/translate', JSON.stringify({
  accountId: ACCT, chatKey: OTHER, customerId: CUST, text: payload.text, type: 'receive',
}));
responses.r8 = { t8a, t8b };
check('#8 同 text 两条会话（会话档 vs 客户档）→ cacheKey 不同；重发同一条 → cached:true',
  t8a.code === 0 && t8a.data?.cached === true && t8a.data?.cacheKey === t4.data?.cacheKey
    && t8b.code === 0 && t8b.data?.toLangCode === LANG_RECV && t8b.data?.scope === 'customer'
    && t8b.data?.cacheKey !== t4.data?.cacheKey,
  `重发: cached=true / cacheKey 与 #4 同；另一条会话: toLangCode=${LANG_RECV}（客户档）/ scope="customer" / cacheKey 与 #4 不同`,
  `重发 cached=${t8a.data?.cached} key=${t8a.data?.cacheKey} | 另一条 code=${t8b.code} to=${JSON.stringify(t8b.data?.toLangCode)} scope=${JSON.stringify(t8b.data?.scope)} key=${t8b.data?.cacheKey}`);

// ============ #6 开关位不参与翻译判定（spec §4①：flags 只管"要不要说"由注入层读，后端不设闸）============
const w6 = await putConv(LINKED_CHAT, { sendEnabled: false, receiveEnabled: false });
const t6 = await post('/api/translation/translate', JSON.stringify({
  accountId: ACCT, chatKey: LINKED_CHAT, text: payload.text, type: 'receive',
}));
responses.r6 = { w6, t6 };
check('#6 会话档两枚 enabled 关到底 → 翻译请求仍 code:0（后端拿它们设过闸即回归）',
  ok(w6) && w6.data?.sendEnabled === false && w6.data?.receiveEnabled === false
    && t6.code === 0 && typeof t6.data?.translation === 'string' && t6.data.translation !== '',
  `PUT 后 sendEnabled=false/receiveEnabled=false；POST /translate: code=0 且 translation 非空`,
  `PUT code=${w6.code} send=${JSON.stringify(w6.data?.sendEnabled)} recv=${JSON.stringify(w6.data?.receiveEnabled)} | POST code=${t6.code} translation=${JSON.stringify(t6.data?.translation)}`);

// ============ 边界五例（spec §8"边界"那一格，标 5a..5e）============
// 5a 若**通过不了**（租户闸失效），FOREIGN 名下会留下一条会话档，而本驱动的 delConv 只清 ACCT 名下的行。
// 那种情况下手工收：DELETE /api/translation/settings/conversation?accountId=<FOREIGN>&chatKey=P7A-x%40c.us
const b1 = await put('/api/translation/settings',
  { scope: 'conversation', accountId: FOREIGN, chatKey: 'P7A-x@c.us', channel: '1' });
const b2 = await put('/api/translation/settings',
  { scope: 'conversation', accountId: ACCT, chatKey: 'x'.repeat(129), channel: '1' });
const b3 = await put('/api/translation/settings',
  { scope: 'conversation', accountId: ACCT, chatKey: 'P7A two@c.us', channel: '1' });
const b4 = await put('/api/translation/settings', { scope: 'nonsense', channel: '1' });
const b5 = await del(`/api/translation/settings/conversation?accountId=${ACCT}`);
responses.boundary = { b1, b2, b3, b4, b5 };
check('5a PUT accountId 不属于本租户 → code:40000（不判 40404，spec §7）',
  b1.code === 40000 && (b1.message ?? '').includes('accountId'),
  'code=40000 且文案指到 accountId', `code=${b1.code} msg="${b1.message ?? ''}"`);
check('5b PUT chatKey 129 字符 → code:40000（两道闸谁先响都算守住，故不断文案）',
  b2.code === 40000, 'code=40000', `code=${b2.code} msg="${b2.message ?? ''}"`);
check('5c PUT chatKey 含空格 → code:40000（含空白/控制符不成形）',
  b3.code === 40000, 'code=40000', `code=${b3.code} msg="${b3.message ?? ''}"`);
check('5d PUT scope=nonsense → code:40000（白名单只在控制器一处）',
  b4.code === 40000, 'code=40000', `code=${b4.code} msg="${b4.message ?? ''}"`);
check('5e DELETE 缺 chatKey → code:40000 而不是按 NULL 删（不静默删 0 行）',
  b5.code === 40000 && (b5.message ?? '').includes('chatKey'),
  'code=40000 且文案指到 chatKey', `code=${b5.code} msg="${b5.message ?? ''}"`);

// ============ 收尾：删净会话档、还原客户档与全局行 ============
const delResults = [];
for (const chat of [...new Set(created)]) {
  const d = await delConv(chat);
  delResults.push({ chat, code: d.code, cleared: d.data?.cleared });
}
const afterDel = await Promise.all([...new Set(created)].map((chat) => settingsOf({ conv: true, a: ACCT, c: chat })));
responses.cleanup = { delResults, afterDel };
check('收尾1 本驱动建的会话档全部 deleted（每条 cleared:1，删后 GET 不再命中 conversation）',
  delResults.length === new Set(created).size
    && delResults.every((r) => r.code === 0 && r.cleared === 1)
    && afterDel.every((r) => ok(r) && r.data?.scope !== 'conversation'),
  `每条 cleared=1；删后 GET 的 scope != conversation（回落到客户档或全局）`,
  JSON.stringify(delResults) + ' | scopes=' + JSON.stringify(afterDel.map((r) => r.data?.scope)));
// 客户档：开跑前有覆盖行就 PUT 回它那份；开跑前没有就 DELETE 掉本次建的那条。
let custRestore;
if (C0) {
  custRestore = await putCust(CUST, {
    receiveFromLang: C0.receiveFromLang, receiveToLang: C0.receiveToLang,
    sendFromLang: C0.sendFromLang, sendToLang: C0.sendToLang,
  });
} else {
  custRestore = await delCust(CUST);
}
const custAfter = await get(`/api/translation/settings?customerId=${CUST}`);
responses.custRestore = { mode: C0 ? 'put' : 'delete', custRestore, custAfter, C0 };
check('收尾2 客户档还原为开跑前那份快照',
  ok(custRestore)
    && (C0 ? custAfter.data?.receiveToLang === C0.receiveToLang && custAfter.data?.sendToLang === C0.sendToLang
      : custAfter.data?.inherited === true && custAfter.data?.scope === 'global'),
  C0 ? `回到覆盖行 to=${C0.receiveToLang}/${C0.sendToLang}` : '该客户回到 inherited:true（开跑前它就没有覆盖行）',
  `restore code=${custRestore.code} | 现值 inherited=${custAfter.data?.inherited} scope=${custAfter.data?.scope} recv=${JSON.stringify(custAfter.data?.receiveToLang)} send=${JSON.stringify(custAfter.data?.sendToLang)}`);
const gAfter = await get('/api/translation/settings');
const WATCH = ['server', 'serverMode', 'channel', 'receiveEnabled', 'receiveFromLang', 'receiveToLang',
  'sendEnabled', 'sendFromLang', 'sendToLang', 'voiceEnabled', 'previewEnabled', 'enterToSend',
  'disableChinese', 'disableChinesePreventSend'];
const diffCols = WATCH.filter((k) => String(G0[k]) !== String(gAfter.data?.[k]));
responses.globalAfter = { before: G0, after: gAfter.data, diffCols };
check('收尾3 全局行逐字段与开跑前一致（会话档/客户档的写入不越层，也不被本驱动改动）',
  ok(gAfter) && gAfter.data?.id === G0.id && diffCols.length === 0,
  `id=${G0.id} 且 14 个业务列全部等于开跑前`, `diff=${JSON.stringify(diffCols)} id=${gAfter.data?.id}`);

console.log('\n== P7/B16 contract: 会话档 scope=conversation ==');
for (const r of rows) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'} | ${r.name}\n       expected: ${r.expected}\n       actual:   ${r.actual}`);
}
writeFileSync('tmp/p7a-conv-settings-responses.json', JSON.stringify(responses, null, 2));
const pass = rows.filter((r) => r.pass).length;
if (failures === 0) {
  console.log(`\nALL PASS (${pass}/${rows.length})`);
  process.exit(0);
}
console.log(`\n${pass}/${rows.length} PASS`);
process.exit(1);
```

- [ ] **Step 3: 跑到全绿**

```bash
cd /d/SmartSCRM && node tmp/p7a-conv-settings.mjs; echo "exit=$?"
```

期望：`ALL PASS (16/16)`，`exit=0`。

**计数口径先说清**（C14）：本驱动一共 **16 条 `check`** —— spec §8 那 8 行各一条（`#1 #7 #5 #2 #3 #4 #8 #6`），§8"边界"那一格展开成 `5a..5e` 五条，收尾（删净 / 还原客户档 / 全局行未被越层）三条。速览表里写的 `N/8 PASS` 指的是**前八条契约行**，打印出来的是 `rows.length=16`；两种数法都对，但**每次跑都用同一种**，并在验收文档里写明这里报的是 16。**任何一条 FAIL 都要留在报告里，不接受把期望改成实际值。**

若某一条不过，先分清是"前提不成立"还是"实现不对"：`exit=2` 是前提（缺账号 / 缺已挂客户的会话 / 读不到全局行 / 挑不出三个互不相同的语种码），修数据再跑；`exit=1` 是实现或本驱动的期望写错，去读 `tmp/p7a-conv-settings-responses.json` 里那一行的完整响应再判断，不要改断言迁就结果。

- [ ] **Step 4: P6 老契约与 P5 引擎回归（本任务的改动只碰 translation_setting 的读写，两边都要看一眼）**

```bash
cd /d/SmartSCRM && node tmp/p6b-scope-contract.mjs 2>&1 | tail -4
cd /d/SmartSCRM/apps/server && export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18" && set -o pipefail && ./mvnw test 2>&1 | grep -E "Tests run:.*Failures|BUILD" | tail -3
```

期望：`ALL PASS (10/10)` + `BUILD SUCCESS` 且 `Failures: 0, Errors: 0`。

- [ ] **Step 5: 无 commit（本任务只产出 gitignored 驱动）**

`tmp/` 已在 `.gitignore` 内，所以本任务不产生提交。若 Step 3 暴露出后端实现的问题并顺手改了 Java，那次改动**归回 Task 4 的口径**：单独 commit（`fix(P7/B16): …`），正文写清是哪一条断言行抓到的、根因在哪一侧。

```bash
cd /d/SmartSCRM && git status --short   # 期望：无 apps/server 与 apps/desktop 下的未提交改动（tmp/ 不显示）
```

---

### Task 6: 活动会话出口——盖章与广播共用同一份裁剪（spec §5 / D-04 / D-11）

**Files:**
- Modify: `apps/desktop/src/shared/chatKeys.ts`
- Test: `apps/desktop/src/shared/chatKeys.test.ts`
- Modify: `apps/desktop/src/shared/chatTypes.ts`
- Modify: `apps/desktop/src/main/services/msgBridge/bridgeMount.ts`
- Modify: `apps/desktop/src/main/services/msgBridge/index.ts`
- Modify: `apps/desktop/src/main/webContentsView/ipc.ts`
- Modify: `apps/desktop/src/renderer/src/lib/liveTailSync.ts`

**Interfaces:**
- Consumes: 既有 `activeChat` map（`msgBridge/index.ts:49`）、`activeChatOf(viewId)`（`:75`）、`bridgeStates()`（`:71`）、`active_chat` 分支（`:279`）、`ipc.ts:116` 那句内联 `length <= 128`
- Produces（Task 7 的按钮禁用链与 Task 10 的 CDP 布景以此为准）:
  - `CHAT_KEY_MAX = 128` 与 `activeChatKeyOf(raw: string | null | undefined): string | null`（`@shared/chatKeys`）
  - `BridgeState.activeChatKey: string | null`；`BridgeStateCore = Omit<BridgeState, 'activeChatKey'>`（P-08）
  - `bridgeStates(): BridgeState[]` 是**唯一组装口**——`msg:state` 广播与 `msg:bridges` 拉取共用它，两条路不可能给渲染层两份"最后已知值"
  - dev 探针新入口 `window.__p6f.setBridges(states: BridgeState[]): void`（P-04，生产构建里整块不存在）
  - 渲染层零新增：`msg:state` / `msg:bridges` 早已写进 `queryKeys.bridges`，多一个字段自动到位

**为什么这一格必须与盖章处同口径**：按钮能不能点亮，判的是"这个视图此刻在看哪条会话"；后端会不会用上这个 `chatKey`，判的是同一条会话裁不裁得进 128。两处各写一遍就会分叉，分叉的样子是**保存提示成功、气泡仍按上一档走、日志一句不响**（spec §7 第二行）。

- [ ] **Step 1: 先写 9 条失败用例**

`apps/desktop/src/shared/chatKeys.test.ts` 末尾追加（import 那行改成 `import { activeChatKeyOf, CHAT_KEY_MAX, isGroupChatKey, peerPhoneOfChatKey } from './chatKeys.ts'`）：

```ts
test('活动会话裁剪：三种真实形态原样返回，不裁内容', () => {
  assert.equal(activeChatKeyOf('8613800001001@c.us'), '8613800001001@c.us')
  assert.equal(activeChatKeyOf('120363000000000000@g.us'), '120363000000000000@g.us')
  // Telegram 的会话 id 是纯数字（Task 12a 未做，但裁剪函数不该按平台分家）
  assert.equal(activeChatKeyOf('-1001234567890'), '-1001234567890')
})

test('null 与 undefined → null：桥还没报过活动会话是正常状态', () => {
  assert.equal(activeChatKeyOf(null), null)
  assert.equal(activeChatKeyOf(undefined), null)
})

test('空串 → null（不是"合法的 0 长度会话"）', () => {
  assert.equal(activeChatKeyOf(''), null)
})

test('纯空白 → null：空格 tab 都是不成形', () => {
  assert.equal(activeChatKeyOf('   '), null)
  assert.equal(activeChatKeyOf('\t'), null)
})

test('含换行或内部空白 → null：页内字段带进主进程的东西不能有两段', () => {
  assert.equal(activeChatKeyOf('8613@c.us\n'), null)
  assert.equal(activeChatKeyOf('a\nb'), null)
  assert.equal(activeChatKeyOf('8613 @c.us'), null)
})

test('128 字符通过：与后端 chat_conversation.chat_key 同宽', () => {
  const key = 'x'.repeat(128)
  assert.equal(activeChatKeyOf(key), key)
})

test('129 字符 → null：超长只可能是坏上报，裁掉比带给后端 400 好', () => {
  assert.equal(activeChatKeyOf('x'.repeat(129)), null)
})

test('控制符 → null：与 Java 的 [\\p{Cntrl}\\s] 同一批字符', () => {
  assert.equal(activeChatKeyOf('a\u0000b'), null)
  assert.equal(activeChatKeyOf('a\u001fb'), null)
  assert.equal(activeChatKeyOf('a\u007fb'), null)
})

test('不 trim、不折叠大小写：平台 id 大小写敏感，这里 normalize 一次就和入库键差一个字符', () => {
  assert.equal(activeChatKeyOf(' 8613@c.us'), null) // 前置空格属于"含空白"，不是"trim 后能用"
  assert.equal(activeChatKeyOf('AA@C.US'), 'AA@C.US')
  assert.equal(CHAT_KEY_MAX, 128) // 与 ConversationScopeKey.CHAT_KEY_MAX 同数：改这边要同步改那边
})
```

- [ ] **Step 2: 跑到失败**

```bash
cd /d/SmartSCRM && pnpm --dir apps/desktop exec node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "src/shared/chatKeys.test.ts" 2>&1 | tail -12
```

期望：**整个文件加载失败**（`does not provide an export named 'activeChatKeyOf'`），`# pass 0`、`# fail 1`。这一条不是"9 条红"而是"0 条跑起来"——把它写成期望，是为了下次有人看到 0 不误判成闸门坏了。

- [ ] **Step 3: 实现 `activeChatKeyOf`**

`chatKeys.ts` 末尾追加：

```ts
/** 与后端 `ConversationScopeKey.CHAT_KEY_MAX` 同一个数字，也是 `chat_conversation.chat_key` 的列宽。 */
export const CHAT_KEY_MAX = 128

// eslint-disable-next-line no-control-regex
const UNUSABLE = /[\s\x00-\x1f\x7f]/

/**
 * 「这个视图此刻正在看哪个会话」的唯一裁剪处。主进程两个出口共用它：
 * 翻译请求的盖章（`webContentsView/ipc.ts`）与桥状态广播（`msgBridge/index.ts` 的 `bridgeStates()`）。
 *
 * 判定只做两件事：空白 / 含任何空白或控制符 / 超过 128 → `null`，其余**原样**。
 * 不 trim、不折叠大小写、不按后缀分平台——`scope_key` 与 `chat_key` 两列都是二进制比较，
 * 这里"顺手 normalize"一次，盖章处与入库处就差一个字符。
 *
 * 与 Java 那道闸的差别只朝安全方向开：JS 的 `\s` 认全角空格与 U+00A0，Java 的 `\s` 不认。
 * 于是这类键在页内会被丢掉（按钮不亮、翻译不带 chatKey），而直接打 HTTP 仍可写入。
 * 别反过来把这边放宽去对齐——那会打开"按钮点亮了但那条会话从没被采到过"的方向。
 */
export function activeChatKeyOf(raw: string | null | undefined): string | null {
  if (!raw) return null
  if (raw.length > CHAT_KEY_MAX) return null
  if (UNUSABLE.test(raw)) return null
  return raw
}
```

- [ ] **Step 4: `chatTypes.ts`——`BridgeState` 多一个字段，`BridgeStateCore` 管装配前那一半**

`BridgeState`（`:67-76`）整块换成：

```ts
export interface BridgeState {
  viewId: string
  accountId: number | null
  platform: ChatPlatform | null
  phase: BridgePhase
  ready: boolean
  /** 进入当前 phase 的时刻（epoch ms），UI 用来显示"上次心跳"。 */
  since: number
  detail: string | null
  /**
   * 这个视图正在看哪个会话（按 `activeChatKeyOf()` 裁过）；桥不在线、没选中会话、或页内报来即不成形 → null。
   * 与 `LiveFrame.activeChatKey` 同一个叫法、同一份来源（`msgBridge/index.ts` 的 `activeChat` map），不引入第二个名字。
   * 组装只发生在 `bridgeStates()` 一处，那是 `msg:state` 与 `msg:bridges` 的共同出口（spec §5 / D-04）。
   */
  activeChatKey: string | null
}

/**
 * `BridgeMount` 手里的那一半：它只有 phase/since/detail，`activeChat` 那张 map 在 index 里，
 * 必填字段会让 `bridgeMount.ts` 的 `state()` 直接编译不过。所以装配返回这一份，
 * `activeChatKey` 由 `bridgeStates()` 补齐——"只有一个组装口"这条要求仍然成立（P-08）。
 */
export type BridgeStateCore = Omit<BridgeState, 'activeChatKey'>
```

- [ ] **Step 5: `bridgeMount.ts`——`state()` 返回装配前那一半**

三处改动，其余一字不动（`import type { ... }` 里加 `BridgeStateCore`）：

```ts
  onState: (state: BridgeStateCore) => void      // :64，MountOptions
  state(): BridgeStateCore {                     // :94，函数体那七个字段照旧
```

`bridgeMount.ts:253` 的 `this.opts.onState(this.state())` 不用改（两边同时换成 `BridgeStateCore`）。

- [ ] **Step 6: `msgBridge/index.ts`——唯一组装口 + 两处广播**

6a. import 区加一行（`@shared` 别名在本文件已在用：`@shared/chatPlatform`）：

```ts
import { activeChatKeyOf } from '@shared/chatKeys'
```

6b. `bridgeStates()`（`:71-73`）换成：

```ts
/**
 * 桥状态的唯一组装口：`msg:state` 广播（`broadcastState`）与 `msg:bridges` 初次拉取（`main/ipc.ts`）
 * 都读这里，所以两个出口不可能给渲染层两份不同的"最后已知值"。
 * `activeChatKey` 在这一处补上，不在 `BridgeMount.state()` 里——那条 map 不属于单条桥（P-08）。
 */
export function bridgeStates(): BridgeState[] {
  return [...mounts.values()].map((m) => {
    const core = m.state()
    return { ...core, activeChatKey: activeChatKeyOf(activeChatOf(core.viewId)) }
  })
}
```

6c. `active_chat` 分支（`:279-282`）在 `set` 之后补一次广播：

```ts
  if (report.kind === 'active_chat') {
    activeChat.set(viewId, report.chatKey ?? null)
    // 切会话要让工作台那颗按钮跟着翻。不新开 `active-chat-changed` 通道（D-04）：
    // `msg:state` 是"最后已知值"的单一来源，再开一条就等于同一件事有两个真值。
    // 代价是每次切会话多广播一帧（最多 7 个视图、一帧 IPC）。这一支不会被 3s 心跳触发：
    // 页侧只有两处发 `active_chat`——wa-js 的 `chat.active_chat` 事件与 `open_chat` 命令回执
    // （`bridge/whatsapp/collect.ts` 的 `reportActiveChat` / `watchActiveChat`），都是事件驱动。
    broadcastState()
    return
  }
```

6d. `observeLoginStatus` 的掉线分支（`:117-120`）改成"值真的变了才广播"：

```ts
  if (!isLogin) {
    // 登出这一刻，主进程手里就不再有"这个视图在看哪条会话"的可靠答案：清掉，并让渲染层看见这次清除。
    // 广播条件读的是**当前值**而不是"这一帧有没有登录翻转"：注入层每 3s 报一次登录态，
    // 无条件广播会把"登出静置"变成每 3s 一帧 IPC；而只在第一次翻转时广播又会漏掉
    // "先有会话、后报登出"这一格。判"有值可清"两边都-cover：清完即 null，下一次自然不播。
    const had = activeChatOf(viewId)
    activeChat.set(viewId, null)
    if (had !== null) broadcastState()
    return
  }
```

`unmountView`（`:336-337`）已经是 `delete` + `broadcastState()`，不动。

- [ ] **Step 7: `webContentsView/ipc.ts`——盖章改调同一份函数**

`:5` 那行 import **只加不减**：`activeChatOf` 下面还要用（它就是那个 map 的唯一读口），只在末尾追加 `import { activeChatKeyOf } from '@shared/chatKeys'`。把 `:114-116` 那三行（`const activeChat = ...` + 裁剪注释 + `const chatKey = ...`）换成：

```ts
      const entry = accountOfView(viewId)
      // 裁剪与广播共用 `activeChatKeyOf`（Task 6 Step 6）。原来这里内联了一份 `length <= 128`，
      // 两处各写一遍就会分叉成"按钮点亮了、后端却从没用上这个 chatKey"。
      // 后端那列是 VARCHAR(128)，超长会让整次翻译 400、页内只看得见"没译文"，所以在盖章处就丢掉。
      const chatKey = activeChatKeyOf(activeChatOf(viewId)) ?? undefined
```

上面那段"口径①/口径②"的既有注释块**保持原样**，只有 `口径②` 里那句对 `activeChatOf` 的描述仍然成立（它讲的"投影即时效"没变，变的只是裁剪去了共享函数）。

- [ ] **Step 8: dev 探针补一个写入口（P-04）**

`liveTailSync.ts` 的 `P6Probe`（`:246-253`）加一项，`interface` 末尾：

```ts
  bridgeStates: () => BridgeState[]
  /**
   * 手喂一份桥状态进渲染层那份缓存（dev-only）。spec §8 CDP 行 1 要断**两种失败形态分得开**，
   * 而 `ready===true && activeChatKey===null` 那一格在没有真 WhatsApp 登录的机器上造不出来。
   * 写的是 `useBridgeOf` 读的同一个键，所以消费链是真的；布景本身不是——它证明"渲染层读对了这两个字段"，
   * 不证明"真桥会不会给值"（后者仍是真实登录档，Task 11）。
   */
  setBridges: (states: BridgeState[]) => void
```

DEV 块（`:276-285`）里 `bridgeStates` 那行之后加：

```ts
        setBridges: (states: BridgeState[]) => qc.setQueryData<BridgeState[]>(queryKeys.bridges, states),
```

`queryFn` 那一侧不用改：这条缓存**没有任何 mutation 会失效它**（`queryKeys.root` 只在 `MessagesPage.tsx:128` 被整片失效过一次，那条走的是路由切换，不在 CDP 驱动的点击路径上），`staleTime: Infinity` + `refetchOnWindowFocus: false` 一起保证了手喂的那份不会被后台 refetch 抹掉。Task 10 的驱动仍然在每次断言前重读一次 `__p6f.bridgeStates()`，读不到布景就**判失败并打印现值**，不静默通过。

- [ ] **Step 9: 全量闸门**

```bash
cd /d/SmartSCRM && pnpm --dir apps/desktop test:unit 2>&1 | tail -6
cd /d/SmartSCRM && pnpm --dir apps/desktop typecheck 2>&1 | tail -6
cd /d/SmartSCRM && pnpm --dir apps/desktop lint 2>&1 | tail -8
```

期望：`# pass 161`（**2026-09-25 实测基线 152 + 本任务 9 条**，C14；跑之前自己再量一次基线，对不上就停下来查为什么少了）、`# fail 0`；四份 tsconfig 全绿；eslint 无新增 error（尤其看 `no-control-regex` 那条 disable 注释有没有生效）。

- [ ] **Step 10: 真桥回归（这一条不跑就不算交付：本任务改的是 P6 已交付的取数路径）**

```bash
cd /d/SmartSCRM && powershell -NoProfile -ExecutionPolicy Bypass -File tmp/p5c-top.ps1
cd /d/SmartSCRM && node tmp/p6g-row12.mjs 2>&1 | tail -20
```

期望：现有桥状态相关驱动 `ALL PASS`（或它自己的全绿口径）。它跑的是真实 WhatsApp 视图里的桥：**`activeChatOf` 换了实现、`active_chat` 多了广播**，这两件事只有真桥在场才看得见没弄坏。跑不动（没登录 / 没代理）→ 如实记"本任务这一档未验证"，不接受用 `typecheck` 绿代替。

- [ ] **Step 11: Commit**

```bash
cd /d/SmartSCRM && git add apps/desktop/src/shared/chatKeys.ts apps/desktop/src/shared/chatKeys.test.ts \
                          apps/desktop/src/shared/chatTypes.ts \
                          apps/desktop/src/main/services/msgBridge/bridgeMount.ts \
                          apps/desktop/src/main/services/msgBridge/index.ts \
                          apps/desktop/src/main/webContentsView/ipc.ts \
                          apps/desktop/src/renderer/src/lib/liveTailSync.ts
git commit -m "feat(P7/B16): 活动会话出口——activeChatKey 挂进 msg:state（B16 前置）

不新增 IPC 通道：bridgeStates() 是 msg:state 广播与 msg:bridges 拉取的共同组装口，补这一处两条路都有值。
128 裁剪从 ipc.ts 的内联判断提成 shared/chatKeys.ts 的 activeChatKeyOf()，盖章与广播同一份代码——
两处各写一遍会分叉成「工作台按钮点亮、后端却从没用上这个 chatKey」，那种样子是保存提示成功而气泡不动。
active_chat 与登出两条路各补一次广播，登出那一支按「当前值非 null」判，避免注入层 3s 一报变成每 3s 一帧。
BridgeStateCore = Omit<BridgeState,'activeChatKey'>：那条 map 不属于单条桥，装配只在一处。"
```

---

### Task 7: 渲染层读侧与写回层——三档寻址、生效档徽标（spec §4②③ / §6 / P-01 / P-05）

**Files:**

- Create: `apps/desktop/src/renderer/src/lib/scopeLabel.ts`
- Create: `apps/desktop/src/renderer/src/lib/scopeLabel.test.ts`
- Modify: `apps/desktop/tsconfig.unit.json`（`include` 补两行）
- Modify: `apps/desktop/src/renderer/src/api/translation.ts`（hook 收 `SettingsRef`、input 补两字段、`TranslateVO.scope`、会话档 DELETE、导出 `SETTINGS_KEY`）
- Modify: `apps/desktop/src/renderer/src/components/messages/ReplyComposer.tsx`（读会话档 + 摘要与徽标 + 写回层 + translate 请求带账号会话）
- Modify: `apps/desktop/src/renderer/src/components/messages/MessageThread.tsx:7,55`（同一份 ref，注释跟着改）
- Modify: `apps/desktop/src/renderer/src/components/messages/ConversationActions.tsx:9,16-21`
- Modify: `apps/desktop/src/renderer/src/components/messages/CustomerDirectionDialog.tsx:19,69`
- Modify: `apps/desktop/src/renderer/src/lib/translationSync.ts:62`
- Modify: `apps/desktop/src/renderer/src/pages/TranslationPage.tsx:68`
- Modify: `apps/desktop/src/renderer/src/api/messages.ts`（`useLinkCustomer.onSuccess` 补一次整前缀失效，P-01 的代价）

**Interfaces:**

- Consumes：Task 3 的 `GET /settings?accountId=&chatKey=` 与 `TranslateVO.scope`；Task 4 的 PUT body `accountId` / `chatKey` 与 `DELETE /settings/conversation?accountId=&chatKey=`。本任务的驱动跑不到那两个新端点之前（Task 4 已交付），它可以独立编译、独立跑单测。
- Produces（Task 8/9/10 都从这里取）：
  - `scopeLabel.ts`：`GlobalSettingsRef` / `CustomerSettingsRef` / `ConversationSettingsRef` / `SettingsRef`、`GLOBAL_REF`、`customerRefOf(id)`、`conversationRefOf(accountId, chatKey)`、`settingsKeyOf(ref)`、`settingsParamsOf(ref)`、`settingsScopeOf(ref)`、`scopeBadgeOf(scope)`、`refOfScope(scope, targets)`、`WriteTargets`、`SettingsScopeFields`
  - `api/translation.ts`：`useTranslationSettings(ref: SettingsRef)`（**参数必填**）、`useResetConversationTranslationSettings()`、`SETTINGS_KEY`（导出，供整前缀失效）、`TranslationSettingInput.accountId?/chatKey?`、`TranslateVO.scope: string`、`useTrialTranslate` 的 input 多 `accountId?/chatKey?`
  - DOM 标记：`data-p7-send-summary`、`data-p7-scope-badge` + `data-p7-scope`、`data-p7-sent-scope`、`data-p7-composer-bar`（回复框那一行，Switch 与徽标的共同父节点）、`data-p7-composer-hint`（那颗提示）——Task 10 的 CDP 第 4、5 行认这几个

- [ ] **Step 1: 量一次基线（C14）**

```bash
cd /d/SmartSCRM && pnpm --dir apps/desktop test:unit 2>&1 | tail -6
```

记下 `# pass` 与 `# fail`。Task 6 之后应为 `# pass 161 / # fail 0`；不是就先去查为什么（本任务期望值 = 这里实测 + 18）。

- [ ] **Step 2: 先写失败的单测**

`apps/desktop/src/renderer/src/lib/scopeLabel.test.ts` 全文：

```ts
// src/renderer/src/lib/scopeLabel.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  conversationRefOf,
  customerRefOf,
  GLOBAL_REF,
  refOfScope,
  scopeBadgeOf,
  settingsKeyOf,
  settingsParamsOf,
  settingsScopeOf
} from './scopeLabel.ts'

const CONV = conversationRefOf(5, '8613814968550@c.us')
const CUST = customerRefOf(7)

test('全局档的缓存键只有档位那一格', () => {
  assert.deepEqual(settingsKeyOf(GLOBAL_REF), ['translation-settings', 'global'])
})

test('客户档的缓存键带**数字** id，不是字符串', () => {
  assert.deepEqual(settingsKeyOf(CUST), ['translation-settings', 'customer', 7])
})

test('会话档的缓存键是四段：chatKey 整段作第三段，没有任何一格是拼好的键串', () => {
  const key = settingsKeyOf(CONV)
  assert.deepEqual(key, ['translation-settings', 'conversation', 5, '8613814968550@c.us'])
  // 前端一旦自己拼出 `5:8613…@c.us`，就会有一格含冒号——那正是 spec §3.4 禁止的事。
  assert.equal(key.some((seg) => String(seg).includes(':')), false)
})

test('同一个 chatKey 在两个账号下是两条缓存（不串档）', () => {
  assert.notDeepEqual(settingsKeyOf(CONV), settingsKeyOf(conversationRefOf(6, '8613814968550@c.us')))
})

test('GET：全局档不带参数', () => {
  assert.equal(settingsParamsOf(GLOBAL_REF), '')
})

test('GET：客户档只带 customerId', () => {
  assert.equal(settingsParamsOf(CUST), 'customerId=7')
})

test('GET：会话档带 accountId + chatKey，且**不带** customerId（缓存键里没有它，就不能让它影响请求）', () => {
  assert.equal(settingsParamsOf(CONV), 'accountId=5&chatKey=8613814968550%40c.us')
  assert.equal(settingsParamsOf(CONV).includes('customerId'), false)
})

test('GET：chatKey 按 query 编码，群键里的 `-` 与 `@g.us` 也不会漏成两个参数', () => {
  assert.equal(
    settingsParamsOf(conversationRefOf(5, '120363000000000000@g.us')),
    'accountId=5&chatKey=120363000000000000%40g.us'
  )
  assert.equal(settingsParamsOf(conversationRefOf(5, 'a b@c.us')), 'accountId=5&chatKey=a%20b%40c.us')
})

test('PUT：会话档交 accountId + chatKey 两个字段，没有 scopeKey（spec §3.4）', () => {
  assert.deepEqual(Object.keys(settingsScopeOf(CONV)).sort(), ['accountId', 'chatKey', 'scope'])
  assert.deepEqual(settingsScopeOf(CONV), { scope: 'conversation', accountId: 5, chatKey: '8613814968550@c.us' })
})

test('PUT：客户档交 scopeKey，没有 accountId / chatKey', () => {
  assert.deepEqual(settingsScopeOf(CUST), { scope: 'customer', scopeKey: '7' })
})

test('PUT：全局档只有 scope', () => {
  assert.deepEqual(settingsScopeOf(GLOBAL_REF), { scope: 'global' })
})

test('徽标三态：本会话专属 / 该客户专属 / 沿用全局', () => {
  assert.equal(scopeBadgeOf('conversation'), '本会话专属')
  assert.equal(scopeBadgeOf('customer'), '该客户专属')
  assert.equal(scopeBadgeOf('global'), '沿用全局')
})

test('认不出的档位不猜名字（猜错就是屏幕上摆一句假话）', () => {
  assert.equal(scopeBadgeOf(''), '生效档未识别')
  assert.equal(scopeBadgeOf('tenant'), '生效档未识别')
})

test('写回层：生效档是全局就写全局，哪怕手里握着客户 ref', () => {
  assert.deepEqual(refOfScope('global', { conversation: CONV, customer: CUST }), GLOBAL_REF)
})

test('写回层：生效档是会话且调用方握着会话 ref → 就是它', () => {
  assert.deepEqual(refOfScope('conversation', { conversation: CONV, customer: CUST }), CONV)
})

test('写回层：生效档是客户时只认客户 ref，会话 ref 不算数', () => {
  assert.deepEqual(refOfScope('customer', { conversation: CONV, customer: CUST }), CUST)
})

test('写回层：定位不到那一档时回 null，绝不退回别的档', () => {
  assert.equal(refOfScope('conversation', { customer: CUST }), null)
  assert.equal(refOfScope('customer', { conversation: CONV }), null)
  assert.equal(refOfScope('customer', {}), null)
  assert.equal(refOfScope('未识别', { conversation: CONV, customer: CUST }), null)
})

test('写回层：客户 ref 可以是 null（陌生会话没有 customerId），此时客户档定位不到', () => {
  assert.equal(refOfScope('customer', { conversation: CONV, customer: null }), null)
})
```

- [ ] **Step 3: 跑一次，确认它是"加载失败"而不是"断言失败"**

```bash
cd /d/SmartSCRM && pnpm --dir apps/desktop test:unit 2>&1 | tail -8
```

期望：`# pass` 不变、`# fail 1`，失败原因是 `Cannot find module .../scopeLabel.ts`（整文件加载不进来）。**看到 `# pass 161 / # fail 1` 才是对的**——别把它当成"闸门坏了"，也别因为文件读不到就当 0 条通过。

- [ ] **Step 4: 写 `scopeLabel.ts`**

```ts
// src/renderer/src/lib/scopeLabel.ts
/**
 * 翻译设置「档」在渲染层的唯一解释处：一档位怎么寻址（`SettingsRef`）、怎么变成缓存键与请求参数、
 * 读回来的那一档叫什么、写回去该写到哪一档。
 * 这里**不 import 任何模块**：`tsconfig.unit.json` 没有 `@/` 别名，import 进来就进不了 `node --test`；
 * 也**不拼、不解析会话档的 `scope_key`**——那条串只有一个作者（后端 `ConversationScopeKey`，spec §3.4）。
 * 反向依赖同样禁止：`api/translation.ts` 可以 import 这里，这里谁都不 import。
 */

export interface GlobalSettingsRef {
  kind: 'global'
}
export interface CustomerSettingsRef {
  kind: 'customer'
  customerId: number
}
/** 两个字段而不是一个键串：这样渲染层拼不出也解析不出 `<accountId>:<chatKey>`。 */
export interface ConversationSettingsRef {
  kind: 'conversation'
  accountId: number
  chatKey: string
}
export type SettingsRef = GlobalSettingsRef | CustomerSettingsRef | ConversationSettingsRef

export const GLOBAL_REF: SettingsRef = { kind: 'global' }

export const customerRefOf = (customerId: number): CustomerSettingsRef => ({
  kind: 'customer',
  customerId
})

export const conversationRefOf = (
  accountId: number,
  chatKey: string
): ConversationSettingsRef => ({ kind: 'conversation', accountId, chatKey })

/**
 * 一档一条缓存（spec §6「取数与缓存要加第三个维度」）。会话那条按 `accountId + chatKey` 分两段：
 * 拼成串再切回去就是"渲染层在解析会话键"；而且 `chatKey` 里本来就有 `@` 与 `.`,拼串只是把
 * 一个数组能表达的东西换成一条需要转义的字面量。**键段不含 `customerId`**（P-01）：会话档读到的
 * 那一行由它决定不了，客户档由后端按同一条 chat 现算（spec §3.2）。
 */
export const settingsKeyOf = (
  ref: SettingsRef
): readonly ('translation-settings' | 'global' | 'customer' | 'conversation' | number | string)[] => {
  if (ref.kind === 'customer') return ['translation-settings', 'customer', ref.customerId] as const
  if (ref.kind === 'conversation')
    return ['translation-settings', 'conversation', ref.accountId, ref.chatKey] as const
  return ['translation-settings', 'global'] as const
}

/** GET 的查询串（不含 `?`）。与 `settingsKeyOf` 同源，所以"同一把键 ⇒ 同一个请求"是构造出来的。 */
export const settingsParamsOf = (ref: SettingsRef): string => {
  if (ref.kind === 'customer') return `customerId=${ref.customerId}`
  if (ref.kind === 'conversation')
    return `accountId=${ref.accountId}&chatKey=${encodeURIComponent(ref.chatKey)}`
  return ''
}

/** PUT body 里定位档位的那几格（`settingsInputOf` 的结果之上再叠一层）。 */
export interface SettingsScopeFields {
  scope: 'global' | 'customer' | 'conversation'
  scopeKey?: string
  accountId?: number
  chatKey?: string
}

export const settingsScopeOf = (ref: SettingsRef): SettingsScopeFields => {
  if (ref.kind === 'customer') return { scope: 'customer', scopeKey: String(ref.customerId) }
  if (ref.kind === 'conversation')
    return { scope: 'conversation', accountId: ref.accountId, chatKey: ref.chatKey }
  return { scope: 'global' }
}

/** 三态徽标文案（spec §3.1 那张表）。`inherited` 不在这里参与判断：§3.2 里 `scope` 已经唯一决定档位。 */
export const scopeBadgeOf = (scope: string): string => {
  if (scope === 'conversation') return '本会话专属'
  if (scope === 'customer') return '该客户专属'
  if (scope === 'global') return '沿用全局'
  // 不猜：这枚徽标是在替后端说"这一条按哪档生效"，猜错就是屏幕上摆一句假话（spec §4③）。
  return '生效档未识别'
}

/** 调用方手里**能定位**的那几档（翻译中心一档都不给，它只改全局）。 */
export interface WriteTargets {
  conversation?: ConversationSettingsRef | null
  customer?: CustomerSettingsRef | null
}

/**
 * 「写回它读到的那一档」——`ReplyComposer.toggleSendLang` 那条既有规则扩到三档（P-05）。
 * 关键在**不回退**：定位不到那一档就回 `null`，调用方必须不写。退回全局是最坏选择——
 * 在某个会话里点一下开关就把全局行改了，别人的语向跟着变（那正是这条规则当初要挡的事）。
 * 也不从 `vo.scopeKey` 反解任何一档的身份：会话档那一格是 `<accountId>:<chatKey>`（spec §3.1
 * 明写"只显示、不解析"），而客户档那一格 `Number()` 出来的数字调用方本来就有（`conversation.customerId`）。
 */
export const refOfScope = (scope: string, targets: WriteTargets): SettingsRef | null => {
  if (scope === 'global') return GLOBAL_REF
  if (scope === 'conversation') return targets.conversation ?? null
  if (scope === 'customer') return targets.customer ?? null
  return null
}
```

- [ ] **Step 5: 跑闸门，确认 18 条绿**

```bash
cd /d/SmartSCRM && pnpm --dir apps/desktop test:unit 2>&1 | tail -6
```

期望：`# pass` = Step 1 实测 + 18、`# fail 0`。

- [ ] **Step 6: 把新文件放进类型闸门（显式 include 清单，否则 `typecheck:unit` 看不见它）**

`tsconfig.unit.json` 的 `include` 末尾两行（紧跟 `chatTimeline.test.ts` 那行之后）：

```json
    "src/renderer/src/lib/scopeLabel.ts",
    "src/renderer/src/lib/scopeLabel.test.ts"
```

`test:unit` 那条是按 glob 收的（`src/renderer/src/lib/**/*.test.ts`），不需要改脚本；两份清单不一致正是"测试跑了但类型没查"的来源，所以每次新建 `lib/*.ts` 都要走这一步。

- [ ] **Step 7: `api/translation.ts`——hook 收 `SettingsRef`**

顶部 import 加一行（只 import，**不 re-export**：`scopeLabel.ts` 是那几个 ref 工具的唯一住所，`api/translation.ts` 再开一道门就会有人只 import 到其中一半），并把 `SETTINGS_KEY` 改成导出（`api/messages.ts` 要按整前缀失效）：

```ts
import { settingsKeyOf, settingsParamsOf, type SettingsRef } from '@/lib/scopeLabel'

const SETTINGS_KEY = ['translation-settings'] as const
```
→
```ts
import {
  settingsKeyOf,
  settingsParamsOf,
  type ConversationSettingsRef,
  type SettingsRef
} from '@/lib/scopeLabel'

/** 整前缀：一档一条缓存，保存/删除后要失效的是"每一档"。导出常量而不是 `settingsKeyOf`，是为了让失效方只能按前缀点名。 */
export const SETTINGS_KEY = ['translation-settings'] as const
```

`settingsKeyOf` 原来那个本地定义（`:126-127`）**删掉**，换成从 `scopeLabel` 导入的版本；`useTranslationSettings` 改形：

```ts
/**
 * 读**这一个作用域下的生效行**（不是"这一档有没有行"）。参数必填：每个读设置的地方都要写清它读哪一档，
 * 少写一档就是 P6 那条 bug 类的翻版（`useTranslationSettings(null)` 会静默退化成读全局，
 * 而调用方以为拿到的是"这一位/这一条"的值）。
 */
export function useTranslationSettings(ref: SettingsRef) {
  const params = settingsParamsOf(ref)
  return useQuery({
    queryKey: settingsKeyOf(ref),
    queryFn: () =>
      http.get<TranslationSettingVO>(`/api/translation/settings${params ? `?${params}` : ''}`)
  })
}
```

`TranslationSettingInput` 在 `scope` / `scopeKey` 之后补两格：

```ts
  /** 缺省即写全局；写客户覆盖行时与 `scopeKey` 成对出现。 */
  scope?: string
  scopeKey?: string
  /** 会话档靠这两个字段定位（spec §3.4：不接受客户端拼好的 `scopeKey`）。 */
  accountId?: number
  chatKey?: string
```

`TranslateVO` 末尾补：

```ts
  /** 这次翻译**实际**用的那一档：`global` | `customer` | `conversation`（spec §3.1 / §4③）。 */
  scope: string
```

`useTrialTranslate` 的 input  widen：

```ts
    mutationFn: (input: {
      text: string
      type: TranslateType
      customerId?: number | null
      accountId?: number
      chatKey?: string
    }) => http.post<TranslateVO>('/api/translation/translate', input),
```

新增会话档 DELETE（放在 `useResetCustomerTranslationSettings` 之后，注释口径同一份）：

```ts
/**
 * 删掉会话档 = 这一条会话回到它下面那一档（客户档，或全局）。与 `useTranslationSettings` 的读侧同一句：
 * 这里交出去的是 `accountId` + `chatKey`，不是那条成形键（spec §3.4），所以拼键的那一处只有一个作者。
 * 走 query 不进路径段：`chatKey` 里带 `@` 与 `.`。`cleared === 0` 也是成功（本来就没有这一档的行）。
 */
export function useResetConversationTranslationSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ref: ConversationSettingsRef) =>
      http.del<{ cleared: number }>(
        `/api/translation/settings/conversation?${settingsParamsOf(ref)}`
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SETTINGS_KEY })
      void qc.invalidateQueries({ queryKey: STATS_KEY })
    }
  })
}
```

（`ConversationSettingsRef` 一起加进顶部那条 `import { ... } from '@/lib/scopeLabel'`。）

- [ ] **Step 8: 五个既有调用点改形（同一批，否则 `typecheck:web` 红）**

| 文件 | 原来 | 改成 |
|---|---|---|
| `TranslationPage.tsx:68` | `useTranslationSettings()` | `useTranslationSettings(GLOBAL_REF)` |
| `translationSync.ts:62` | `useTranslationSettings()` | `useTranslationSettings(GLOBAL_REF)` |
| `ConversationActions.tsx:21` | `useTranslationSettings(customerId)` | `useTranslationSettings(customerRefOf(customerId))` |
| `CustomerDirectionDialog.tsx:69` | `useTranslationSettings(customerId)` | `useTranslationSettings(customerRefOf(customerId))` |
| `MessageThread.tsx:55` | `useTranslationSettings(conversation.customerId)` | `useTranslationSettings(conversationRefOf(accountId, conversation.chatKey))` |

三处 import 各自补 `@/lib/scopeLabel` 里用到的那个名字。`ConversationActions.tsx:16-17` 那段注释里的 `useTranslationSettings(null)` 说法跟着改成新签名（它讲的判断仍然成立：未关联会话拿客户档去显示"这位客户的语向"就是假信息，所以那个组件还是按 `customerId` 挂载）。

`MessageThread.tsx:49-54` 那段"设置读的是回复框那一层（同一个 `customerId`、同一份缓存条目，TanStack 会去重）"里，**"同一个 customerId"改成"同一个 `accountId + chatKey`"**——去重靠的是缓存键，两个组件现在传的是同一个会话 ref，所以还是同一条缓存。这句话不改就是文档在描述一个已经不存在的键。

- [ ] **Step 9: `ReplyComposer.tsx`——读会话档、写回它读到的那一档、补生效档标注**

import 补：

```ts
import { Badge } from '@/components/ui/badge'
import { directionSummary } from '@/lib/directionDraft'
import { conversationRefOf, customerRefOf, refOfScope, scopeBadgeOf, settingsScopeOf } from '@/lib/scopeLabel'
```

取数那两行（`:27-28`）换成：

```ts
  // 会话档优先（spec §3.2 / §4②）：这里的 `settings` 是"这一条会话的生效行"，
  // 它同时决定「先译再发」的初值、`decideDraft` 的中文拦截、以及旁边那枚摘要与徽标。
  // 连带效果要写清（spec §9 的边界之外）：会话行里的 `disableChinese` 等开关**会**影响回复框，
  // 因为回复框读的就是生效行；本阶段不给它们控件，值只随 §3.3 的整份复制携带。
  // 记录页那颗「语向」仍只编辑客户档（D-07），所以它显示的档位可能与这里不同——徽标就是为此而存在。
  const convRef = conversationRefOf(accountId, conversation.chatKey)
  const custRef = conversation.customerId !== null ? customerRefOf(conversation.customerId) : null
  const { data: settings } = useTranslationSettings(convRef)
```

`chatKey` 不再过一次 128 裁剪：`conversation.chatKey` 出自 `chat_conversation.chat_key`（`VARCHAR(128) COLLATE utf8mb4_bin`，V8），能出现在这一列里的值本来就装得下；Task 6 那份 `activeChatKeyOf` 管的是**页内投影**那条自由字符串，两处的输入不同。（这一句写进代码注释，避免下一个人以为漏了一道闸。）

`sendNow` 里那次 translate 请求补会话身份（原 `{ text, type: 'send', customerId: conversation.customerId ?? undefined }`）：

```ts
      let text = decision.text
      if (decision.kind === 'translate') {
        const result = await translate.mutateAsync({
          text,
          type: 'send',
          // §4②：不补这两个字段就是"会话档已生效、回复框却按客户档预览"的反例。
          // `customerId` 不再带：后端按 `accountId + chatKey` 自己现算客户档（§3.2），
          // 而这里手里的 `conversation.customerId` 是会话列表缓存的投影，可能与库里差一拍——
          // 少一个来源，读侧（`useTranslationSettings(convRef)`）与译侧就不可能各拿一份。
          accountId,
          chatKey: conversation.chatKey
        })
        text = result.translation
        // §4③ 的第二个来源：这次**实际**用了哪一档。它可能与上面那枚徽标不同——弹层改档位与
        // 后端解析之间隔着一次缓存失效，所以两处都要，不是重复标注。
        setSentScope(result.scope)
      } else {
        setSentScope(null)
      }
```

`sendNow` 里 `decision.kind === 'keep'`（不译直接发）那一支要 `setSentScope(null)`——上面那段 `if / else` 已经写了：**每一次发送都重新落这一格**，留着上一次的档位名就是拿旧译文替新消息说话。组件顶部补声明：

```ts
  const [sentScope, setSentScope] = useState<string | null>(null)
```

`toggleSendLang` 整体换成：

```ts
  const toggleSendLang = (next: boolean): void => {
    if (!settings) return
    // 写回它读到的那一层（P-05，既有那条"别悄悄改掉全局"的规则扩到三档）。
    // 旧写法是 `settings.scope === 'customer' ? settings.scopeKey : null`，把 `scopeKey` 当客户 id 用；
    // 会话档上线后那一格是 `5:8613…@c.us`，照旧写下去就是把成形键塞进 `scopeKey`：
    // 控制器的数字校验回 40000，或者更糟——分派写歪，改掉别人的行。所以层由 `refOfScope` 从
    // "手里能定位的那几档"里挑，任何一格都不从 `scopeKey` 反解。
    const target = refOfScope(settings.scope, { conversation: convRef, customer: custRef })
    if (!target) {
      setHint('这一档的定位不在手里，未写入任何一行')
      return
    }
    void saveSettings
      .mutateAsync({ ...settingsInputOf(settings, { sendEnabled: next }), ...settingsScopeOf(target) })
      .then((saved) => {
        // P5 的不变式：谁改了 flags 谁广播。**只有真正写到全局行那一次**才广播——payload 是进程级
        // 的一份 flags（来源全局行，§4①b），客户档/会话档那一份对页内没有任何影响，推下去反而
        // 把一份和页内无关的开关塞进所有内嵌页。
        if (target.kind !== 'global') return
        void broadcastTranslationFlags(saved).catch(() => {
          setHint('开关已保存，但没能同步到内嵌页')
        })
      })
      .catch((e: unknown) => {
        setHint(`开关保存失败：${e instanceof Error ? e.message : String(e)}`)
      })
  }
```

表头那一行（`:120` 那颗 `<div className="flex items-center justify-between ...">`）本身挂一颗 `data-p7-composer-bar=""`：`data-p6-composer="reply"` 在 `<textarea>` 上（`:137`），那颗 Switch 与这枚徽标都在它的**兄弟**节点里，驱动拿"后代选择器 + `data-p6-composer`"去点是点不到的。然后在 Switch 那个 `<label>` 之后、计数器那个 `<span>` 之前插入摘要 + 徽标：

```tsx
        {/* §4③：这一枚是"这一条会话实际按哪档生效"，与会话头那枚"这位客户一般怎么说"并列是有意的（D-07）。 */}
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate tabular-nums" data-p7-send-summary="">
            {settings ? directionSummary(settings, 'send') : '…'}
          </span>
          <Badge
            variant="outline"
            className={
              settings && settings.scope !== 'global'
                ? 'shrink-0 border-0 bg-primary/10 text-primary'
                : 'shrink-0 border-border text-muted-foreground'
            }
            data-p7-scope-badge=""
            data-p7-scope={settings?.scope ?? ''}
          >
            {settings ? scopeBadgeOf(settings.scope) : '…'}
          </Badge>
        </span>
```

组件末尾：先给**既有**那句提示（`:163` 的 `{hint && <p className="pt-1.5 text-xs text-destructive">{hint}</p>}`）挂一颗标记——它是 `toggleSendLang` 唯一的失败出口，驱动要能区分"提示还在"与"没提示"，不能按文案猜：

```tsx
      {hint && <p className="pt-1.5 text-xs text-destructive" data-p7-composer-hint="">{hint}</p>}
```

再在它之后加发送后的那一句：

```tsx
      {sentScope && (
        <p className="pt-1.5 text-[11px] text-muted-foreground" data-p7-sent-scope={sentScope}>
          这一条按{scopeBadgeOf(sentScope)}译出
        </p>
      )}
```

- [ ] **Step 10: `api/messages.ts` 补一次失效（P-01 记下的代价）**

`useLinkCustomer.onSuccess` 里，`setQueriesData(...)` 之后加：

```ts
      // 建/关联客户会改变**会话档**那份缓存的回落结果：会话档没有行时，读到的那一档从"全局"
      // 变成"这位客户"。缓存键里没有 customerId（P-01），所以不失效就会有一段窗口——
      // 徽标写着「沿用全局」而下一次翻译按客户档走。整前缀一次，代价是每条在用的档各自 refetch。
      void qc.invalidateQueries({ queryKey: SETTINGS_KEY })
```

顶部 import 补 `import { SETTINGS_KEY } from '@/api/translation'`。方向是 `messages.ts → translation.ts`，`translation.ts` 不 import `messages.ts`（它今天只 import `@/lib/http`），所以不成环。

- [ ] **Step 11: 全量闸门**

```bash
cd /d/SmartSCRM && pnpm --dir apps/desktop test:unit 2>&1 | tail -6
cd /d/SmartSCRM && pnpm --dir apps/desktop typecheck 2>&1 | tail -8
cd /d/SmartSCRM && pnpm --dir apps/desktop lint 2>&1 | tail -8
```

期望：`# pass` = Step 1 实测 + 18、`# fail 0`；四份 tsconfig 全绿（`typecheck:web` 这一份是这次改动的正面闸——六个调用点漏一个就红）；eslint 无新增 error。

- [ ] **Step 12: 后端在场时跑一次真实读侧（这一条不做就等于没验过 `?accountId=&chatKey=`）**

```bash
cd /d/SmartSCRM && netstat -ano | grep ':8180' | head -3
cd /d/SmartSCRM && node tmp/p7a-conv-settings.mjs 2>&1 | tail -25
```

期望：Task 5 那份契约驱动仍然 `ALL PASS (16/16)`。它跑的是 HTTP 侧、不经过渲染层，所以这一步只证明"后端没被本任务的改动碰坏"；界面侧的真实验证在 Task 10（那一步之后才有按钮可点）。

- [ ] **Step 13: Commit**

```bash
cd /d/SmartSCRM && git add apps/desktop/src/renderer/src/lib/scopeLabel.ts \
                          apps/desktop/src/renderer/src/lib/scopeLabel.test.ts \
                          apps/desktop/tsconfig.unit.json \
                          apps/desktop/src/renderer/src/api/translation.ts \
                          apps/desktop/src/renderer/src/api/messages.ts \
                          apps/desktop/src/renderer/src/components/messages/ReplyComposer.tsx \
                          apps/desktop/src/renderer/src/components/messages/MessageThread.tsx \
                          apps/desktop/src/renderer/src/components/messages/ConversationActions.tsx \
                          apps/desktop/src/renderer/src/components/messages/CustomerDirectionDialog.tsx \
                          apps/desktop/src/renderer/src/lib/translationSync.ts \
                          apps/desktop/src/renderer/src/pages/TranslationPage.tsx
git commit -m "feat(P7/B16): 渲染层三档寻址 + 生效档标注——回复框读会话档、写回它读到的那一层

SettingsRef 是判别联合，会话那一档带 accountId + chatKey 两个字段：渲染层拼不出也解析不出 `<accountId>:<chatKey>`，
那条串只有一个作者（后端 ConversationScopeKey）。缓存键按段分档，且刻意不含 customerId——键里没有的字段也不能出现在请求里，
否则同一把键会对应两种请求，读侧与译侧各拿一份就是「徽标说沿用全局、译文按客户档」。
useTranslationSettings 的参数改成必填：以前少传一个 customerId 会静默退化成读全局，现在必须写清读哪一档。
toggleSendLang 判层从 scopeKey 反解改为 refOfScope(scope, 手里能定位的档)：会话档上线后 scopeKey 那一格是成形键，
旧写法会把 `5:xxx@c.us` 当客户 id 提交；定位不到就当不写，不退回全局。
发送后那一句「这一条按 X 译出」读 TranslateVO.scope，与 GET 那枚徽标两处并存，因为一次翻译实际用的档可能与表单现值不同档。"
```

---

### Task 8: 共享行组件 + 线路进 draft（spec §6 / P-03 / P-07，行为逐字段不变）

**Files:**

- Create: `apps/desktop/src/renderer/src/components/translation/DirectionLangRows.tsx`
- Modify: `apps/desktop/src/renderer/src/lib/directionDraft.ts`（`channel` 一列）
- Modify: `apps/desktop/src/renderer/src/lib/directionDraft.test.ts`（test 1 从六格改七格 + 新增 2 条）
- Modify: `apps/desktop/src/renderer/src/components/messages/CustomerDirectionDialog.tsx`（删本地 `LangRow`、改 import、描述文案修正）

**Interfaces:**

- Consumes：Task 7 的 `settingsScopeOf` / `customerRefOf`（提交体改由它们成形）。
- Produces（Task 9 的弹层就三格控件，全部来自这里）：
  - `LangRow({ title, enabled?, onEnabled?, from, to, onFrom, onTo, channel })` — `enabled` 与 `onEnabled` **同时给或同时不给**，不给时那一列不渲染
  - `ChannelRow({ value, onChange })`
  - `DirectionDraft` 多一个 `channel: string`；`draftOf` 带出它，`dirtyCount` 把它算作一处
  - DOM 标记：沿用既有的 `data-p6-direction-save` / `data-p6-direction-error` / `data-p6-error-code`（Task 10 的 CDP 第 6 行认这三个，不新起名字）

- [ ] **Step 1: 量一次基线（C14）**

```bash
cd /d/SmartSCRM && pnpm --dir apps/desktop test:unit 2>&1 | tail -6
```

Task 7 之后应为 `# pass 179 / # fail 0`（161 + 18）。本任务新增 2 条 test 块，期望 = 实测 + 2。

- [ ] **Step 2: 先改那条会被 `channel` 打破的既有断言，再写两条新的**

`directionDraft.test.ts` 的 test 1（`:24-34`）里那份清单从 6 项变 7 项——**这一条现在就改，它先红**，因为 `WHOLE` 里本来就有 `channel: 'simulate'`，而今天的 `draftOf` 故意不把它带进弹层（那句注释写的是"弹层一个都不许带走"）。这条断言翻面就是 P-07 的落地时刻：

```ts
test('draftOf 取那七个字段（含线路：会话档弹层要能改线路）', () => {
  assert.deepEqual(Object.keys(draftOf(WHOLE)).sort(), [
    'channel',
    'receiveEnabled',
    'receiveFromLang',
    'receiveToLang',
    'sendEnabled',
    'sendFromLang',
    'sendToLang'
  ])
  assert.equal(draftOf(WHOLE).receiveToLang, 'zh-CN')
  assert.equal(draftOf(WHOLE).channel, 'simulate')
})
```

文件末尾追加两条：

```ts
test('线路算一处改动：只改线路时保存按钮该亮', () => {
  const base = draftOf(WHOLE)
  assert.equal(dirtyCount(base, { ...base, channel: '2' }), 1)
  assert.equal(dirtyCount(base, { ...base, channel: base.channel }), 0)
})

test('线路不进摘要文案（摘要答的是"哪两个语种"，与走哪条线路无关）', () => {
  const base = draftOf(WHOLE)
  assert.equal(directionSummary({ ...base, channel: '2' }, 'send'), 'zh-CN → vi')
})
```

- [ ] **Step 3: 跑一次，确认红的是这三条**

```bash
cd /d/SmartSCRM && pnpm --dir apps/desktop test:unit 2>&1 | grep -E "^# (pass|fail)|not ok" | tail -8
```

期望：`# fail 3`，三条名字是改过的那条 + 新加的两条；其余 174 条不受影响。（只红 1 条或红 5 条都说明改错了地方。）

- [ ] **Step 4: `directionDraft.ts` 加 `channel`**

```ts
/** 语向弹层能改的全部字段：收 / 发各一条「启用 + 源 + 目标」，外加整档共用的线路。 */
export interface DirectionDraft {
  /**
   * 线路是**一整档一个值**：它同时决定收发两侧的可选语种，所以塞进 `LangRow` 会变成
   * 两格各带一份线路。会话档弹层有控件（Task 9），客户档弹层没有——那里 `draft.channel`
   * 恒等于打开时读到的那一份，提交时带回去是同一个值（P-07 的"行为逐字段不变"，由 Task 10 CDP 第 6 行兜）。
   */
  channel: string
  receiveEnabled: boolean
  receiveFromLang: string
  receiveToLang: string
  sendEnabled: boolean
  sendFromLang: string
  sendToLang: string
}
```

`draftOf` 的返回值加 `channel: s.channel`（继续逐字段列，不用 rest 剔除）；`dirtyCount` 在 `sendToLang` 那两行之后加：

```ts
  // 线路不进 `same()`：它没有"自动检测"那种同义写法，`''` 也不是合法线路码。
  if (b.channel !== n.channel) count += 1
```

`directionSummary` **不动**（它只看四个语种列）。

- [ ] **Step 5: 跑闸门，确认三条绿**

```bash
cd /d/SmartSCRM && pnpm --dir apps/desktop test:unit 2>&1 | tail -6
```

期望：`# pass` = Step 1 实测 + 2、`# fail 0`。

- [ ] **Step 6: 新建 `DirectionLangRows.tsx`**

```tsx
// src/renderer/src/components/translation/DirectionLangRows.tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { LangSelect } from '@/components/translation/LangSelect'
import { sourceLanguagesFor, targetLanguagesFor, TRANSLATION_CHANNELS } from '@/lib/langData'

/** 标题列宽：带开关时多让出 64px + 8px 给那颗 Switch，两种形态共用同一个 52px 标题列。 */
const GRID_WITH_SWITCH = 'grid-cols-[52px_64px_minmax(0,1fr)_14px_minmax(0,1fr)]'
const GRID_NO_SWITCH = 'grid-cols-[52px_minmax(0,1fr)_14px_minmax(0,1fr)]'

/**
 * 语向的一行（收 / 发各一行）。从 `CustomerDirectionDialog` 原位提出，两个弹层共用一份控件——
 * 会话档那一行**没有开关**（spec §6：那里的开关位既不在后端设闸也不在页内生效，
 * 给了就是一颗按了没反应的按钮；值由 §3.3 的整份复制从生效行带过去）。
 * `enabled` 缺省时那一整列不渲染，其余部分（标题、两个语种下拉）与带开关时逐字段同形，
 * 所以两个弹层里"收信"那一行的语种位置不会错位一格。
 */
export function LangRow({
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
  enabled?: boolean
  onEnabled?: (v: boolean) => void
  from: string
  to: string
  onFrom: (v: string) => void
  onTo: (v: string) => void
  channel: string
}): React.JSX.Element {
  const hasSwitch = enabled !== undefined && onEnabled !== undefined
  return (
    <div className={`grid ${hasSwitch ? GRID_WITH_SWITCH : GRID_NO_SWITCH} items-center gap-2`}>
      <span className="text-xs text-muted-foreground">{title}</span>
      {hasSwitch && (
        <div>
          <Switch checked={enabled} onCheckedChange={(v) => onEnabled(v === true)} />
        </div>
      )}
      <LangSelect value={from} allowAuto options={sourceLanguagesFor(channel)} onChange={onFrom} />
      <span className="text-center text-xs text-muted-foreground">→</span>
      <LangSelect value={to} options={targetLanguagesFor(channel)} onChange={onTo} />
    </div>
  )
}

/**
 * 线路那一行。它属于**整档**而不是收/发某一侧（一个 `channel` 同时决定两侧可选语种），
 * 所以是弹层的第三格而不是 `LangRow` 的一部分。
 * 灰显规则留在翻译中心：那里同时管密钥，缺哪家的 key 一目了然；这个弹层只负责把值写进那一档，
 * 选了一条没配密钥的线路由后端如实降级（`TranslateVO.degraded` / `degradeReason`），不在此处拦。
 */
export function ChannelRow({
  value,
  onChange
}: {
  value: string
  onChange: (v: string) => void
}): React.JSX.Element {
  return (
    <div className={`grid ${GRID_NO_SWITCH} items-center gap-2`}>
      <span className="text-xs text-muted-foreground">线路</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-full text-xs" data-p7-channel="">
          <SelectValue placeholder="未配置" />
        </SelectTrigger>
        <SelectContent>
          {TRANSLATION_CHANNELS.map((c) => (
            <SelectItem key={c.code} value={c.code}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
```

**这里不写 `channel` 的同义值处理**：`TRANSLATION_CHANNELS` 的 code 是 `'1'..'7'`（`lib/langData.ts:77-85`），库里那列存的就是它；模拟线路与线上线路在同一张清单里，不做灰显也不做兜底转换。

- [ ] **Step 7: `CustomerDirectionDialog.tsx` 换用共享行 + 修文案**

删掉本地 `LangRow`（`:26-56`）与随之无用的两个 import（`Switch`、`LangSelect`、`sourceLanguagesFor` / `targetLanguagesFor`——**`Switch` 与 `LangSelect` 全文件只有那一处用到，`langData` 那两个函数同理**，留下未用 import 会让 `typecheck:web` 与 eslint 各红一次），换成：

```ts
import { LangRow } from '@/components/translation/DirectionLangRows'
import { customerRefOf, settingsScopeOf } from '@/lib/scopeLabel'
```

`submit` 里的提交体换成（`scope: 'customer', scopeKey: String(customerId)` 那一对手写字段不再出现在这里）：

```ts
    save.mutate(
      settingsInputOf(data, {
        ...draft,
        // 定位那一档的形状由 `scopeLabel` 一处成形（Task 7）：这里再手写一遍 `scopeKey`，
        // 就会有第二个"客户档的键长什么样"的作者。
        ...settingsScopeOf(customerRefOf(customerId))
      }),
      { onSuccess: () => onOpenChange(false) }
    )
```

两处 `<LangRow ... channel={data.channel} />` 换成 `channel={draft.channel}`（该弹层没有线路控件，所以 `draft.channel` 恒等于 `data.channel`，两格语种选项与今天逐字段相同）。

`:115-117` 那句描述换掉——它今天已经与 P6 Task 17b 的交付矛盾（气泡早已按客户语向生效），会话档上线后更不准：

```tsx
          <DialogDescription>
            只改这位客户的语向。页内气泡与记录页回复框都按「会话 → 客户 → 全局」取第一条命中的档，
            所以这一份覆盖实际作用到哪一层，看上方那枚徽标与回复框旁的「本会话专属」标注。
          </DialogDescription>
```

- [ ] **Step 8: 全量闸门**

```bash
cd /d/SmartSCRM && pnpm --dir apps/desktop test:unit 2>&1 | tail -6
cd /d/SmartSCRM && pnpm --dir apps/desktop typecheck 2>&1 | tail -8
cd /d/SmartSCRM && pnpm --dir apps/desktop lint 2>&1 | tail -8
```

期望：`# pass` = Step 1 实测 + 2、`# fail 0`；四份 tsconfig 全绿；eslint 无新增 error。**本任务不新增行为**：它唯一的可观察变化是客户档弹层的提交体多一格 `channel: <与库里同值>`，那一格的验收入在 Task 10 CDP 第 6 行（保存后从库里读回 `channel` 未变）。

- [ ] **Step 9: Commit**

```bash
cd /d/SmartSCRM && git add apps/desktop/src/renderer/src/components/translation/DirectionLangRows.tsx \
                          apps/desktop/src/renderer/src/components/messages/CustomerDirectionDialog.tsx \
                          apps/desktop/src/renderer/src/lib/directionDraft.ts \
                          apps/desktop/src/renderer/src/lib/directionDraft.test.ts
git commit -m "refa(P7/B16): 语向行组件抽共享 + DirectionDraft 纳入线路，为会话档弹层让出三格控件

LangRow 的开关改成可选：会话档那一行不给开关（开关位不在后端设闸、也不在页内生效，给了就是按了没反应的按钮），
不渲染那一列时标题与两个语种下拉与带开关时逐字段同形，两个弹层不会错位一格。
ChannelRow 是弹层级第三格：一个 channel 同时决定收发两侧的可选语种，塞进 LangRow 就变成两格各带一份线路。
DirectionDraft 多一列 channel，客户档弹层没有它的控件，提交时带回去的仍是打开时那一份——行为逐字段不变由 Task 10 CDP 第 6 行兜。
顺手修掉「气泡仍按全局语向翻译」那句：气泡按客户语向生效是 P6 已交付的，那句话今天在屏幕上就是假话。"
```

---

### Task 9: 会话档弹层 + 舞台入口（spec §6 / P-02 / P-03）

**Files:**

- Create: `apps/desktop/src/renderer/src/components/translation/ConversationSettingsDialog.tsx`
- Modify: `apps/desktop/src/renderer/src/components/AccountStage.tsx`

**Interfaces:**

- Consumes：Task 6 的 `BridgeState.activeChatKey` + `useBridgeOf`（P-02）、Task 7 的 `conversationRefOf` / `settingsScopeOf` / `scopeBadgeOf` / `useResetConversationTranslationSettings`、Task 8 的 `LangRow`（不带开关）/ `ChannelRow` / `DirectionDraft.channel`。
- Produces（Task 10 的 CDP 认这些标记）：
  - `data-p7-stage-settings`（舞台那颗按钮，`disabled` 与"不挂载弹层"同源）
  - `data-p7-conv-dialog`（`DialogContent`，内含 `data-p7-conv-chatkey` 显示 chatKey 原文）
  - `data-p7-conv-badge` + `data-p7-scope`（三态徽标，属性值是后端答的 `scope`）
  - `data-p7-conv-save` / `data-p7-conv-reset` / `data-p7-conv-cancel` / `data-p7-conv-error` + `data-p7-error-code`
  - `data-p7-channel`（线路那一格的下拉）
  - 组件签名：`ConversationSettingsDialog({ accountId, chatKey, open, onOpenChange })`

- [ ] **Step 1: 新建弹层组件**

三格控件全部来自 Task 8，档位语义全部来自 Task 7——这个文件里不该再出现第二处 `scope` 字符串比较（徽标那一句读 `data.scope` 除外）和另一份手写的提交形状。

```tsx
// src/renderer/src/components/translation/ConversationSettingsDialog.tsx
import { useEffect, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
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
import { ChannelRow, LangRow } from '@/components/translation/DirectionLangRows'
import {
  settingsInputOf,
  useResetConversationTranslationSettings,
  useTranslationSettings,
  useUpdateTranslationSettings
} from '@/api/translation'
import { scopeBadgeOf, settingsScopeOf, type ConversationSettingsRef } from '@/lib/scopeLabel'
import { ApiError } from '@/lib/http'
import { draftOf, dirtyCount, type DirectionDraft } from '@/lib/directionDraft'

interface Props {
  accountId: number
  chatKey: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * 会话档编辑器。入口只有一个（工作台舞台那颗「会话设置」），记录页的「语向」仍只编辑客户档（D-07）：
 * 两处开同一个弹层会让用户分不清自己在改哪一层。
 * 这里**没有任何 enabled 开关**（spec §6 / D-09）：会话档改的是"怎么说"（语种、线路），
 * 不是"要不要说"——页内开关位仍是进程级一份 flags、来源全局行。给了控件就是给一颗按了没反应的按钮，
 * 所以那几列只随 §3.3 的整份复制从生效行带过去，界面上既不说谎也不逐个解释列的去处。
 */
export default function ConversationSettingsDialog({
  accountId,
  chatKey,
  open,
  onOpenChange
}: Props): React.JSX.Element {
  const ref: ConversationSettingsRef = { kind: 'conversation', accountId, chatKey }
  const { data } = useTranslationSettings(ref)
  const save = useUpdateTranslationSettings()
  const reset = useResetConversationTranslationSettings()
  const [draft, setDraft] = useState<DirectionDraft | null>(null)

  // 与 `CustomerDirectionDialog` 同一套铺法：只在打开那一瞬间抓一次初值。
  // 按 `data` 无条件重铺的话，保存后的整前缀失效会触发一次 refetch，把用户改到一半的表单抹回库里值。
  useEffect(() => {
    if (!open) {
      setDraft(null)
      // Radix 关闭只卸载 `DialogContent`，组件本体常驻：不清错误态的话，重开弹层第一眼看过去的
      // "保存失败"是上一轮的残留，那是假话。
      save.reset()
      reset.reset()
      return
    }
    if (data) setDraft((d) => d ?? draftOf(data))
  }, [open, data, save, reset])

  const patch = (p: Partial<DirectionDraft>): void => setDraft((d) => (d ? { ...d, ...p } : d))
  const dirty = data && draft ? dirtyCount(data, draft) : 0
  // 徽标答的是"这一份值来自哪一档"，不是"这一档有没有行"：`data.scope` 是后端按 §3.2 解析出的生效档，
  // 所以第一次打开时它多半写着「沿用全局」——那正是下面那句提示要交代的东西。
  const badge = data ? scopeBadgeOf(data.scope) : '…'
  const ownRow = data?.scope === 'conversation'

  const submit = (): void => {
    if (!data || !draft) return
    save.mutate(settingsInputOf(data, { ...draft, ...settingsScopeOf(ref) }), {
      onSuccess: () => onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-p7-conv-dialog="">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <SlidersHorizontal className="size-4 text-primary" />
            当前会话的语向
          </DialogTitle>
          <DialogDescription>
            只作用于这一条会话，优先级高于该客户的语向与全局设置。
            {/* 标题在 `chat_conversation.title`，为舞台一颗按钮去拉会话列表不划算（spec §6）：
                这里显示 `chatKey` 原文，`8613…@c.us` 这个形态本身可读。 */}
            <span
              className="mt-1 block truncate font-mono text-[11px] text-muted-foreground"
              data-p7-conv-chatkey=""
            >
              {chatKey}
            </span>
            未关联客户时这是这条会话的唯一标识。只改语种与线路：开关位（先译再发 / 接收翻译 / 输入框预览 /
            中文拦截）本阶段仍是全局那一份。
          </DialogDescription>
        </DialogHeader>

        {!data && <p className="py-6 text-center text-xs text-muted-foreground">读取设置中…</p>}
        {data && draft && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={
                  ownRow
                    ? 'border-0 bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground'
                }
                data-p7-conv-badge=""
                data-p7-scope={data.scope}
              >
                {badge}
              </Badge>
              <span className="text-[11px] text-muted-foreground">
                {ownRow
                  ? '这一档已有覆盖行，保存会整份覆盖它。'
                  : `保存后只为这条会话建一份覆盖，${badge === '该客户专属' ? '该客户的设置' : '全局设置'}不动。`}
              </span>
            </div>

            <LangRow
              title="收信"
              from={draft.receiveFromLang}
              to={draft.receiveToLang}
              onFrom={(v) => patch({ receiveFromLang: v })}
              onTo={(v) => patch({ receiveToLang: v })}
              channel={draft.channel}
            />
            <LangRow
              title="发信"
              from={draft.sendFromLang}
              to={draft.sendToLang}
              onFrom={(v) => patch({ sendFromLang: v })}
              onTo={(v) => patch({ sendToLang: v })}
              channel={draft.channel}
            />
            <ChannelRow value={draft.channel} onChange={(v) => patch({ channel: v })} />

            {/* 改线路会把两侧的可选语种整组换掉，而表单里可能留着一份上一线路不支持的组合。
                这里不预先回退（那等于悄悄改掉用户没碰过的那几列）：交下去由后端判，
                它回 40000 + 点名句式的文案，下面这一行如实显示码值（C12）。 */}
            {save.isError && (
              <p
                data-p7-conv-error=""
                data-p7-error-code={save.error instanceof ApiError ? String(save.error.code) : ''}
                className="text-xs text-destructive"
              >
                保存失败：{save.error instanceof Error ? save.error.message : '后端不可用'}
              </p>
            )}
            {reset.isError && (
              <p
                data-p7-conv-error=""
                data-p7-error-code={reset.error instanceof ApiError ? String(reset.error.code) : ''}
                className="text-xs text-destructive"
              >
                恢复失败：{reset.error instanceof Error ? reset.error.message : '后端不可用'}
              </p>
            )}
          </div>
        )}

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            data-p7-conv-reset=""
            // 「恢复继承」只在**本档有行**时才是"删掉它"：没有行时删是空操作（`cleared:0` 也回 200），
            // 按钮亮着而点了什么都不发生，那就是假按钮。客户档那个弹层同一条规矩。
            disabled={!data || !ownRow || reset.isPending}
            onClick={() => reset.mutate(ref, { onSuccess: () => onOpenChange(false) })}
          >
            {reset.isPending ? '恢复中…' : '恢复继承'}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              // 驱动要能"不保存就关掉"这颗弹层。`button:last-child` 那种位置选择器在这里会点到「保存」
              // （它在同一个 `<div>` 里排在取消之后），而保存是 disabled 的——点了什么都不发生，
              // 于是"关闭失败"看起来像"弹层卡住了"。给它一颗自己的标记。
              data-p7-conv-cancel=""
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button
              size="sm"
              data-p7-conv-save=""
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

上面 `submit` 里用到的 `settingsScopeOf` 要一起 import（`import { scopeBadgeOf, settingsScopeOf } from '@/lib/scopeLabel'`）。与 Task 7 第 7 步的口径不同的一点：这里 **只 import 值、不 re-export**，`ConversationSettingsRef` 直接从 `@/lib/scopeLabel` 取（不是从 `api/translation`），所以 `api/translation.ts` 那一行 re-export **不需要**——本任务因此不碰 `api/translation.ts`。

- [ ] **Step 2: `AccountStage.tsx` 接入口**

import 补三行：

```ts
import { Languages, LoaderCircle, MonitorOff, RotateCw, SlidersHorizontal } from 'lucide-react'
import ConversationSettingsDialog from '@/components/translation/ConversationSettingsDialog'
import { useBridgeOf } from '@/lib/liveTailSync'
```

组件体内、**早于 `if (!account) return`（`:40`）那道提前返回**——放在 `const { loading, reload } = useWebContentsView(...)` 之后（hook 全部在提前返回之前，这是本文件既有的规矩）：

```ts
  // P-02：活动会话从既有那条链上来（按 accountId 筛 + 只有 `ready` 才算数），不新建 hook。
  // 桥不在、或挑到的那条 `activeChatKey === null`，都落到同一个禁用条件——后者在桥掉线时本就是 null，
  // 两个条件同源。不能拿"最后一条"或"任意一条"：多个账号视图同时在线（最多 7 个）时
  // 那会把语向写到另一个账号的同名会话上（spec §6）。
  const stageAccountId = account?.id ?? null
  const bridge = useBridgeOf(stageAccountId)
  const activeChatKey = bridge?.activeChatKey ?? null
  const [settingsOpen, setSettingsOpen] = useState(false)
```

工具条里、那颗「注入」按钮（`:70`）**之前**插入：

```tsx
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 px-2 text-xs"
          data-p7-stage-settings=""
          disabled={activeChatKey === null}
          title={activeChatKey === null ? '会话未在线' : '为当前会话设置语向与线路'}
          onClick={() => setSettingsOpen(true)}
        >
          <SlidersHorizontal className="size-4" />
          会话设置
        </Button>
```

`<section>` 末尾（`<div className="relative min-h-0 flex-1">…</div>` 之后、`</section>` 之前）挂载弹层：

```tsx
      {/* 拿不到 chatKey 就不挂载（spec §7）：禁用态已经把入口挡住了，这里再挡一次是为了让
          "弹层里揣着一条空会话键"这种状态在代码里不存在。`account.id` 就是后端那列
          `platform_account.id`（= `accountId`），不是 `account.viewId`。 */}
      {stageAccountId !== null && activeChatKey !== null && (
        <ConversationSettingsDialog
          accountId={stageAccountId}
          chatKey={activeChatKey}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
        />
      )}
```

**`bridge === null` 时 `activeChatKey` 也是 `null`**：所以那一格同时挡住"没桥"与"有桥但没选中会话"。而 Task 10 第 1 行的证据是 `__p6f.bridgeStates()` 里 `ready` 与 `activeChatKey` 两个字段各查一次——一个 `disabled` 属性背后必须有两条分得开的证据，否则挑错桥的那类 bug 会被一起放过（spec §8 行 1）。

- [ ] **Step 3: 全量闸门**

```bash
cd /d/SmartSCRM && pnpm --dir apps/desktop test:unit 2>&1 | tail -6
cd /d/SmartSCRM && pnpm --dir apps/desktop typecheck 2>&1 | tail -8
cd /d/SmartSCRM && pnpm --dir apps/desktop lint 2>&1 | tail -8
```

期望：`# pass` 与 Task 8 结束时**一字不差**（本任务不新增纯函数）、`# fail 0`；四份 tsconfig 全绿；eslint 无新增 error。

- [ ] **Step 4: Commit**

```bash
cd /d/SmartSCRM && git add apps/desktop/src/renderer/src/components/translation/ConversationSettingsDialog.tsx \
                          apps/desktop/src/renderer/src/components/AccountStage.tsx
git commit -m "feat(P7/B16): 工作台「会话设置」入口 + 会话档弹层（收/发语向 + 线路）

入口的禁用链只有一条：useBridgeOf(accountId) 挑不到 ready 桥、或挑到那条的 activeChatKey 为 null。
两个条件同源，但证据要分得开——CDP 第 1 行按 ready 与 activeChatKey 各断一次，防的是把语向写到另一个账号的同名会话。
弹层三格控件里没有开关位：会话档只改怎么说（语种、线路），不改要不要说；那几列只随整份复制携带，给了控件就是假按钮。
「恢复继承」只在本档有行时亮：没有行时 DELETE 回 cleared:0 也是 200，亮着点了什么都不发生。
不显示会话标题、显示 chatKey 原文：为工具条一颗按钮去拉会话列表不划算，且陌生会话可能压根没有行（D-06 允许先设后采）。"
```

---

### Task 10: 渲染层 CDP 驱动 + 全量回归（spec §8 后两块 / P-04 / P-05）

**Files:**

- Create: `tmp/p7a-stage-dialog.mjs`（gitignored，不进提交）
- Modify: `apps/desktop/src/renderer/src/components/AccountSidebar.tsx`（账号行加一颗定位标记，驱动要用 id 认行）

**Interfaces:**

- Consumes：Task 6 的 `__p6f.setBridges`（P-04）、Task 7/8/9 的全部 `data-p7-*` 标记、Task 4 的 PUT / DELETE 三档、Task 5 的契约驱动（本任务最后重跑一次）。
- Produces：一张 `check()` 表（**32 条**，全绿时）+ `ALL PASS (32/32)`；`docs/notes/` 之外的验收结论由 Task 11 落档。

**A/B 档口径（C11，写在驱动文件头，跑完照抄进报告）**：布景是手喂的（桥帧 `__p6f.setBridges`、会话/客户档行 HTTP PUT），**行为是真的**（真实 `Input.dispatchMouseEvent` 点击、真实 PUT/DELETE 落库、读回走 node 侧另一条 HTTP 连接而不是界面现值）。所以这些行证明的是"渲染层读对了字段、写对了那一档"，**不**证明"真桥会不会给出这个 activeChatKey"（那是 Task 11 的真实登录档）。

- [ ] **Step 1: 给账号行加一颗 id 标记（驱动靠 id 认行，不靠文案）**

`AccountSidebar.tsx:70` 那颗账号按钮上加一行：

```tsx
                data-p7-account-row={account.id}
```

理由写进提交体：侧栏一行里同时有名称、状态点、重命名按钮，按文案匹配会把内部按钮点中；`account.id` 正是后端那列 `platform_account.id`（= 会话档键里的 `accountId`），用它认行是唯一不歧义的那条路。

- [ ] **Step 2: 写驱动 `tmp/p7a-stage-dialog.mjs`**

```js
// tmp/p7a-stage-dialog.mjs —— P7/B16 渲染层：三档生效面的界面侧证据。
// 前置：后端 :8180 在跑；dev app 以 --remoteDebuggingPort 9223 起且已登录；先跑 tmp/p5c-top.ps1 抬窗口。
// 出口：前置不满足 → exit 2（不谎报）；断言失败 → exit 1；全绿 → exit 0。
// A/B 档：桥帧与会话/客户档行是手喂的（A 档布景），点击、PUT/DELETE 落库、读回全是真的（B 档行为）。
//   证明的是"渲染层读对了字段、写对了那一档"，不证明"真桥会不会给出 activeChatKey"（Task 11 的真实登录档）。
import { openPage } from './cdp.mjs'

const BASE = 'http://127.0.0.1:8180'
const STAMP = Date.now().toString(36)
const CHAT_A = `P7CDP-${STAMP}-a@c.us`
const DECOY = `P7DECOY-${STAMP}@c.us`
const OTHER_ACCT = 987654

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let bad = 0
let n = 0
/** 布景说明：前置失败时打印它，人才知道库里可能留了哪几条 `P7CDP-*` 行。 */
let sceneNote = '（还没建布景）'
const check = (name, pass, expected, actual) => {
  n++
  if (!pass) bad++
  console.log(`${String(n).padStart(2, '0')} ${pass ? 'ok  ' : 'FAIL'} ${name}${pass ? '' : ` —— 期望 ${expected} / 实得 ${actual}`}`)
  return pass
}
/**
 * 前置不满足：exit 2，且**必须**在打印后立刻退出。
 * 不用 throw：throw 会冒出 unhandledRejection，node 以 1 退出，把"前置不满足"报成"断言失败"——
 * 那正是 C7 要分开的两种红。这里也不做异步清扫：清扫要 await，而 premise 的调用点全是
 * `if (…) premise(...)` 这种同步写法，异步化就等于"报完错还继续往下跑"。留在库里的行由 sceneNote 交代。
 */
const premise = (l, d) => {
  console.log(`\nBLOCKED(premise) ${l}${d ? ` —— ${d}` : ''}`)
  console.log(`  [注] 布景说明：${sceneNote}`)
  process.exit(2)
}
async function wait(ms, fn, label) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > ms) {
      console.log(`  [超时] ${label}`)
      return null
    }
    await sleep(150)
  }
}

// ---------------------------------------------------------------- 后端侧（布景 + 读回）
const login = await (
  await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ inviteCode: 'DEMO0001', username: 'admin', password: 'admin123', deviceId: 'p7a-stage' })
  })
).json().catch((e) => ({ __err: String(e) }))
const token = login?.data?.accessToken
if (!token) premise('后端登录不上（:8180 没起 / 是旧进程 / 登录参数变了）', JSON.stringify(login).slice(0, 160))
const H = { authorization: 'Bearer ' + token }
const JH = { ...H, 'content-type': 'application/json' }
const unwrap = (j, p) => {
  if (j.code !== 0) throw new Error(`${p} -> ${j.code} ${j.message}`)
  return j.data
}
const get = async (p) => unwrap(await (await fetch(BASE + p, { headers: H })).json(), p)
const putRaw = async (p, body) => (await (await fetch(BASE + p, { method: 'PUT', headers: JH, body: JSON.stringify(body) })).json())
const delRaw = async (p) => (await (await fetch(BASE + p, { method: 'DELETE', headers: H })).json())
const convQ = (acct, chat) => `accountId=${acct}&chatKey=${encodeURIComponent(chat)}`
const settingsOf = (q) => get(`/api/translation/settings${q ? `?${q}` : ''}`)
const saveConv = (acct, chat, patch) => putRaw('/api/translation/settings', { scope: 'conversation', accountId: acct, chatKey: chat, ...patch })
const dropConv = (acct, chat) => delRaw(`/api/translation/settings/conversation?${convQ(acct, chat)}`)
// 只有语言/线路四列 + channel 可写；开关位与 server 等整份复制，断言"别的档一字未动"要拿整行比。
const FLAG_FIELDS = ['server', 'serverMode', 'channel', 'receiveEnabled', 'receiveFromLang', 'receiveToLang',
  'sendEnabled', 'sendFromLang', 'sendToLang', 'voiceEnabled', 'previewEnabled', 'enterToSend',
  'disableChinese', 'disableChinesePreventSend']
const snapshot = (vo) => JSON.stringify(FLAG_FIELDS.map((k) => vo[k]))
/** 把读回来的 VO 整份写回同一档：收尾恢复现场用，不手挑字段（挑漏一格就留下半个布景）。 */
const bodyOf = (vo) => Object.fromEntries(FLAG_FIELDS.map((k) => [k, vo[k]]))

// ---------------------------------------------------------------- 界面侧
const page = await openPage(9223, 'localhost:5173')
await page.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})
await page.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {})
const ev = (expr) => page.ev(expr)
const vis = await ev(`document.visibilityState`)
if (vis !== 'visible') premise('窗口不可见：Radix 出场动画不结束，点击会全部静默失败', `visibilityState=${vis}`)
if (!(await ev(`typeof window.__p6f?.setBridges === 'function'`)))
  premise('__p6f.setBridges 不在（dev 探针是旧构建，要重启 electron-vite dev 而不是 vite 热更）')

const pointOf = (sel) =>
  `(() => { const el = (${sel}); if (!el) return null; el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) return null;
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    const h = document.elementFromPoint(x, y); return { x, y, hit: !!h && (h === el || el.contains(h)) } })()`
async function clickSel(sel, label) {
  const p = await ev(pointOf(sel))
  if (!p) { console.log(`  [定位失败] ${label} :: ${sel}`); return false }
  if (!p.hit) console.log(`  [注] ${label} 的中心点被别的东西盖住（仍按真实事件发）`)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1, buttons: 1 })
  await sleep(40)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1, buttons: 0 })
  return true
}
async function clickNth(sel, idx, label) {
  const p = await ev(`(() => { const el = document.querySelectorAll(${JSON.stringify(sel)})[${idx}]);
    if (!el) return null; const r = el.getBoundingClientRect();
    return r.width ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null })()`)
  if (!p) { console.log(`  [定位失败] ${label} :: ${sel}[${idx}]`); return false }
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1, buttons: 1 })
  await sleep(40)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1, buttons: 0 })
  return true
}
/** 某个弹层里第 idx 个下拉（会话档弹层：收 0/1、发 2/3、线路 4）选中文案含 want 的那一项。 */
async function pickIn(scopeSel, idx, want) {
  if (!(await clickNth(`${scopeSel} [data-slot="select-trigger"]`, idx, `${scopeSel} 下拉#${idx}`))) return false
  const ITEM = `[data-slot="select-content"] [data-slot="select-item"]`
  const got = await wait(4000, async () =>
    ev(`(() => { const a = [...document.querySelectorAll(${JSON.stringify(ITEM)})]);
      const el = a.find(x => (x.textContent||'').includes(${JSON.stringify(want)}));
      if (!el) return null; const r = el.getBoundingClientRect();
      return r.width ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null })()`),
  `下拉#${idx} 的选项「${want}」`)
  if (!got) return false
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: got.x, y: got.y, button: 'left', clickCount: 1, buttons: 1 })
  await sleep(40)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: got.x, y: got.y, button: 'left', clickCount: 1, buttons: 0 })
  return true
}
/** 会话档弹层里第 idx 个下拉（收 0/1、发 2/3、线路 4）选中文案含 `want` 的那一项。 */
const pickConvSel = (idx, want) => pickIn('[data-p7-conv-dialog]', idx, want)
/** 客户档弹层没有 `data-p7-*` 标记（P6 交付时只有 `data-p6-direction-*` 那几颗），按 radix 的 role 认它。 */
const pickCustSel = (idx, want) => pickIn('[role="dialog"]', idx, want)
const attrOf = (sel, name) => ev(`document.querySelector(${JSON.stringify(sel)})?.getAttribute(${JSON.stringify(name)}) ?? null`)
const textOf = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.textContent?.trim() ?? null`)
const isDisabled = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.disabled ?? null`)
const exists = (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`)
const countOf = (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
const setBridges = (states) => ev(`window.__p6f.setBridges(${JSON.stringify(states)})`)
const frame = (over) => ({ viewId: 'v-p7a', accountId: OTHER_ACCT, platform: 'whatsapp', phase: 'ready',
  ready: true, since: Date.now(), detail: null, activeChatKey: null, ...over })
/** 按 `NAV_ITEMS` 的真实 href 点（`lib/nav.ts:21-32`）：`:has-text` 那种伪类 `querySelector` 不认。 */
async function go(href) {
  if (!(await clickSel(`nav a[href="${href}"]`, `导航 ${href}`))) return false
  return !!(await wait(5000, async () => (await ev(`location.pathname`)) === href, href))
}
/** 记录页的会话行没有 per-row 标记（P6 至今如此），只能按行内标题文本定位。 */
async function clickConvByTitle(title) {
  const p = await ev(`(() => { const b = [...document.querySelectorAll('[data-p6-scroller="list"] button')]
      .find(x => (x.textContent||'').includes(${JSON.stringify(title)}));
    if (!b) return null; const r = b.getBoundingClientRect();
    return r.width ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null })()`)
  if (!p) return false
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1, buttons: 1 })
  await sleep(40)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1, buttons: 0 })
  return true
}

// ---------------------------------------------------------------- 选一个真实账号 + 记录页的两条真实会话
await go('/workspace')
const accounts = await get('/api/platform-accounts')
const list = Array.isArray(accounts) ? accounts : (accounts?.records ?? [])
if (!list.length) premise('本租户没有平台账号，舞台挂不起来')
const acct = list.find((a) => a.platformType === 1) ?? list[0]
// 按标记认行，不按文案：侧栏一行里同时有名称、状态点与重命名按钮，按文本匹配会点进内部那颗按钮。
if (!(await clickSel(`[data-p7-account-row="${acct.id}"]`, '账号行')))
  premise(`工作台里没有 data-p7-account-row="${acct.id}" 这一行（Step 1 没做 / 侧栏没渲染这个账号）`)
// 舞台真挂到这个账号上了才往下跑：选不中账号时后面每一行都红在同一个原因上，那是前置失败不是行为失败。
if (!(await wait(5000, () => exists('[data-p7-stage-settings]'), '工作台的工具条')))
  premise('点了账号行但工作台没出现「会话设置」那颗按钮（Task 9 的入口没渲染？）')
const ACCT_ID = acct.id
// "会话档存得下"与"页内投影容得下"同一条 128 上限（spec §5 / §7）：装不下的那条拿去布景就是自欺。
const usable = (c) => typeof c?.chatKey === 'string' && c.chatKey.length > 0 && c.chatKey.length <= 128
const convs = ((await get(`/api/conversations?accountId=${ACCT_ID}&size=50`))?.records ?? []).filter(usable)
const linked = convs.filter((c) => c.customerId !== null)
if (convs.length < 2 || linked.length < 1) premise('记录页会话不足（要 ≥2 条可用的、其中 ≥1 条已关联客户）', `共 ${convs.length}，已关联 ${linked.length}`)
const RX = linked[0]
const RY = convs.find((c) => c.chatKey !== RX.chatKey)
const global0 = snapshot(await settingsOf(''))
sceneNote = `账号 ${ACCT_ID} · 合成会话 ${CHAT_A} · 真实会话 ${RX.chatKey}（客户 ${RX.customerId}）与 ${RY.chatKey}`
console.log(`  [注] ${sceneNote}`)
```

> 导航一律按 `nav a[href="/messages"]` 这类真实属性点（`NAV_ITEMS` 的 `path` 是 `/workspace`、`/messages`，见 `lib/nav.ts:21-32`）——`:has-text` 那种伪类是 Playwright 的扩展，CDP 的 `querySelector` 不认。Step 2 里那颗 `go()` 就是为此而存在。

- [ ] **Step 3: 六行断言接上去（逐行照抄，32 条 `check`）**

```js
const STAGE = '[data-p7-stage-settings]'
const DIALOG = '[data-p7-conv-dialog]'
const BADGE = '[data-p7-conv-badge]'
const TRIG = `${DIALOG} [data-slot="select-trigger"]`
const CUST = '[role="dialog"]'
const CUST_TRIG = `${CUST} [data-slot="select-trigger"]`
const BAR = '[data-p7-composer-bar]'
const COMP = BAR + ' [data-p7-scope-badge]'
const openDialog = async () => {
  if (!(await clickSel(STAGE, '会话设置'))) return false
  return !!(await wait(4000, () => exists(DIALOG), '弹层'))
}
const closeDialog = async () => {
  await clickSel(`${DIALOG} [data-p7-conv-cancel]`, '取消')
  await wait(3000, async () => !(await exists(DIALOG)), '弹层关闭')
}
/**
 * 目标语种不能写死：全局行的 `sendToLang` 是库里现值，万一它已经是 `en`，
 * "改成 en"就是 0 处改动，行 2 会红在布景撞值上而不是被测行为上。挑一个与当前生效值不同的。
 * 下拉里的文案形如 `英语（en）`（`languageName`：`${zh}（${code}）`），所以按带括号的 code 认。
 */
const otherLang = (v) => (v === 'en' ? 'vi' : 'en')
/** 读渲染层手里那一格桥帧（`msg:state` / `msg:bridges` 共同写进的那份缓存），一次读全两个字段。 */
const bridgeOf = async (acct) =>
  JSON.parse(await ev(`JSON.stringify(window.__p6f.bridgeStates().find(s=>s.accountId===${acct}) ?? null)`))

// ---- 行 1：禁用链的两种失败形态要分得开（spec §8 行 1）
await setBridges([frame({ accountId: ACCT_ID, ready: false, phase: 'offline', activeChatKey: CHAT_A })])
check('1a 桥不 ready → 按钮禁用', (await isDisabled(STAGE)) === true, 'true', await isDisabled(STAGE))
const b1 = await bridgeOf(ACCT_ID)
check('1b 这一格的禁用原因是 ready=false（activeChatKey 那一格是有值的）',
  b1?.ready === false && b1?.activeChatKey === CHAT_A, 'ready=false & chatKey 有值', JSON.stringify(b1))
await setBridges([frame({ accountId: ACCT_ID, ready: true, activeChatKey: null })])
check('1c 桥 ready 但没选中会话 → 按钮禁用', (await isDisabled(STAGE)) === true, 'true', await isDisabled(STAGE))
const b2 = await bridgeOf(ACCT_ID)
check('1d 这一格的禁用原因换成 activeChatKey=null（与 1a 分得开，不是同一个条件）',
  b2?.ready === true && b2?.activeChatKey === null, 'ready=true & chatKey=null', JSON.stringify(b2))
await setBridges([
  frame({ accountId: OTHER_ACCT, activeChatKey: DECOY }),
  frame({ viewId: 'v-p7b', accountId: ACCT_ID, activeChatKey: CHAT_A })
])
check('1e 另一账号也有值时按钮点亮（按 accountId 筛，不是取最后一条）', (await isDisabled(STAGE)) === false, 'false', await isDisabled(STAGE))
check('1f 弹层打得开', (await openDialog()) === true, '已打开', '未打开')
check('1g 弹层里显示的会话是本账号那条，不是 decoy', (await textOf('[data-p7-conv-chatkey]')) === CHAT_A, CHAT_A, await textOf('[data-p7-conv-chatkey]'))
check('1h 三格控件齐全：收/发各两个语种下拉 + 一个线路下拉', (await countOf(TRIG)) === 5, '5', await countOf(TRIG))
check('1i 弹层里没有任何开关位（§6/D-09：给了就是按了没反应的按钮）', (await countOf(`${DIALOG} [data-slot="switch"]`)) === 0, '0', await countOf(`${DIALOG} [data-slot="switch"]`))
check('1j 未建会话档时徽标读作「沿用全局」', (await attrOf(BADGE, 'data-p7-scope')) === 'global', 'global', await attrOf(BADGE, 'data-p7-scope'))
await closeDialog()

// ---- 行 2：真实改语种 → 保存 → 后端按同键读回（spec §8 行 2）
const WANT = otherLang((await settingsOf(convQ(ACCT_ID, CHAT_A))).sendToLang)
await openDialog()
check('2a 改之前保存按钮是死的（无改动）', (await isDisabled('[data-p7-conv-save]')) === true, 'true', await isDisabled('[data-p7-conv-save]'))
if (!(await pickConvSel(3, `（${WANT}）`))) premise(`发信目标下拉里找不到「（${WANT}）」这一项（语种清单或线路变了，行 2 无法继续）`)
if (!(await wait(4000, async () => (await textOf('[data-p7-conv-save]'))?.includes('1 处改动'), '保存按钮文案带改动数')))
  premise('改了发信目标却没出现「1 处改动」（dirtyCount 或线路联动重置把改动数抹掉了）', await textOf('[data-p7-conv-save]'))
check('2b 改一处后按钮活过来且写明一处', (await isDisabled('[data-p7-conv-save]')) === false &&
  (await textOf('[data-p7-conv-save]'))?.includes('1 处改动') === true, '可点 & 含「1 处改动」', await textOf('[data-p7-conv-save]'))
await clickSel('[data-p7-conv-save]', '保存')
const saved = await wait(6000, async () => {
  const j = await settingsOf(convQ(ACCT_ID, CHAT_A)).catch(() => null)
  return j?.scope === 'conversation' ? j : null
}, '后端读回会话档')
check('2c 保存后弹层关闭', (await wait(3000, async () => !(await exists(DIALOG)), '关闭')) !== null, '已关闭', (await textOf(`${DIALOG} [data-p7-conv-error]`)) ?? '仍在')
check('2d 后端那一行的档名是 conversation（不是客户/全局）', saved?.scope === 'conversation', 'conversation', saved?.scope)
check(`2e 落库的 sendToLang 是 ${WANT}（真实 PUT，不读表单现值）`, saved?.sendToLang === WANT, WANT, saved?.sendToLang)
const globalNow = await settingsOf('')
check('2f 全局行一字未动（会话档没顺手改到全局）', snapshot(globalNow) === global0, '与开局相同', snapshot(globalNow))
await openDialog()
check('2g 重开徽标翻成「本会话专属」', (await attrOf(BADGE, 'data-p7-scope')) === 'conversation', 'conversation', await attrOf(BADGE, 'data-p7-scope'))
await closeDialog()

// ---- 行 3：恢复继承 → 翻回它下面那一档（spec §8 行 3）
await openDialog()
check('3a 本档有行时「恢复继承」可点', (await isDisabled('[data-p7-conv-reset]')) === false, 'false', await isDisabled('[data-p7-conv-reset]'))
await clickSel('[data-p7-conv-reset]', '恢复继承')
const afterReset = await wait(6000, async () => {
  const j = await settingsOf(convQ(ACCT_ID, CHAT_A))
  return j.scope === 'global' ? j : null
}, '恢复后读回')
check('3b 合成会话（下面没有客户档）恢复后回到「沿用全局」', afterReset?.scope === 'global', 'global', afterReset?.scope)
const again = await dropConv(ACCT_ID, CHAT_A)
check('3c 再删一次回 cleared:0（那一行确实不在了，DELETE 幂等）', again.data?.cleared === 0, 'cleared=0', JSON.stringify(again))
// 真实已关联客户的会话：先给它一档客户覆盖，再叠会话档，删会话档后应回落到「该客户专属」
const cust0 = await settingsOf(`customerId=${RX.customerId}`)
await putRaw('/api/translation/settings', { scope: 'customer', scopeKey: String(RX.customerId), sendToLang: 'vi' })
await saveConv(ACCT_ID, RX.chatKey, { sendToLang: 'hi' })
await setBridges([frame({ accountId: ACCT_ID, activeChatKey: RX.chatKey })])
await openDialog()
check('3d 会话档在位时徽标是「本会话专属」而它下面才是客户档', (await attrOf(BADGE, 'data-p7-scope')) === 'conversation', 'conversation', await attrOf(BADGE, 'data-p7-scope'))
await clickSel('[data-p7-conv-reset]', '恢复继承')
const fell = await wait(6000, async () => {
  const j = await settingsOf(convQ(ACCT_ID, RX.chatKey))
  return j.scope === 'customer' ? j : null
}, '回落到客户档')
check('3e 恢复继承回落到「该客户专属」而不是全局（§3.2 回落 + §3.1 三态）',
  fell?.scope === 'customer' && fell?.inherited === false, 'customer & inherited=false', `${fell?.scope} & ${fell?.inherited}`)
// 现场恢复：开局那一档有客户行就整份写回原值，本来没有就删掉本次建的覆盖行（行 3 与行 6 各借过一次）。
const restoreCust = async () => {
  if (cust0.scope === 'customer') {
    await putRaw('/api/translation/settings', { scope: 'customer', scopeKey: String(RX.customerId), ...bodyOf(cust0) })
  } else {
    await delRaw(`/api/translation/settings/customer/${RX.customerId}`)
  }
}
await restoreCust()

// ---- 行 4：切会话，回复框旁那枚徽标跟着变（spec §4②③ / §8 行 4）
await saveConv(ACCT_ID, RX.chatKey, { sendToLang: 'en' })
await go('/messages')
if (!(await clickConvByTitle(RX.title)) || !(await wait(6000, () => exists(COMP), 'X 的回复框徽标')))
  premise('选不中会话 X 或回复框那枚徽标没出现（标题为空/重名，或 Task 7 的表头没渲染）', String(RX.title))
check('4a 选中设过会话档的 X → 回复框徽标「本会话专属」', (await attrOf(COMP, 'data-p7-scope')) === 'conversation', 'conversation', await attrOf(COMP, 'data-p7-scope'))
if (!(await clickConvByTitle(RY.title))) premise('选不中会话 Y，行 4 比不了"切会话"', String(RY.title))
const badgeY = await wait(6000, async () => {
  const v = await attrOf(COMP, 'data-p7-scope')
  return v !== 'conversation' ? v : null
}, 'Y 的徽标≠conversation')
check('4b 切到未设会话档的 Y → 徽标跟着变（不是留在 X 那一档）', badgeY !== null && badgeY !== 'conversation', '≠conversation', await attrOf(COMP, 'data-p7-scope'))
await clickConvByTitle(RX.title)
check('4c 切回 X 仍是「本会话专属」（缓存按 accountId+chatKey 分键，两档不互相铺值）',
  (await wait(6000, async () => ((await attrOf(COMP, 'data-p7-scope')) === 'conversation' ? 1 : null), '回到 X')) === 1,
  'conversation', await attrOf(COMP, 'data-p7-scope'))

// ---- 行 5（P-05）：会话档生效时，那颗开关写回**会话档那一行**
const custSnap0 = snapshot(await settingsOf(`customerId=${RX.customerId}`))
const convBefore = await settingsOf(convQ(ACCT_ID, RX.chatKey))
const SW = `${BAR} [data-slot="switch"]`
// 那颗 Switch 在 `disabled={!settings || saveSettings.isPending}` 之下：读侧没落位就点，点的是空气。
const armed = await wait(6000, async () => ((await isDisabled(SW)) === false ? 1 : null), '开关可点')
if (armed !== 1) check('5x 开关一直不可点（读侧没落位，行 5 无从下手）', false, '可点', await isDisabled(SW))
if (!(await clickNth(SW, 0, '先译再发')))
  premise(`回复框表头那颗 Switch 定位不到（Task 7 的 ${BAR} 没挂上？）`)
const flipped = await wait(6000, async () => {
  const j = await settingsOf(convQ(ACCT_ID, RX.chatKey))
  return j.sendEnabled !== convBefore.sendEnabled ? j : null
}, '会话行的 send_enabled 变了')
const convAfter = await settingsOf(convQ(ACCT_ID, RX.chatKey))
check('5a 点开关真的翻了那一格（不是"什么都没做"）', flipped !== null && convAfter.sendEnabled !== convBefore.sendEnabled, `≠${convBefore.sendEnabled}`, convAfter.sendEnabled)
check('5b 写的是会话档那一行（scopeKey 反解那条老路没走回来）', convAfter.scope === 'conversation', 'conversation', convAfter.scope)
const globalAfter5 = await settingsOf('')
check('5c 全局行一字未动', snapshot(globalAfter5) === global0, '与开局相同', snapshot(globalAfter5))
const custAfter5 = await settingsOf(`customerId=${RX.customerId}`)
check('5d 客户行一字未动（没把成形键当客户 id 提交）', snapshot(custAfter5) === custSnap0, '与开局相同', snapshot(custAfter5))
check('5e 没有报"保存失败"（旧写法在这里会撞 40000 或悄悄改掉全局）', (await exists('[data-p7-composer-hint]')) === false, '无提示', await textOf('[data-p7-composer-hint]'))

// ---- 行 6（P-07 的兜）：客户档弹层保存后**线路没动**
await clickSel('[data-p6-action="direction"]', '语向')
if (!(await wait(4000, () => exists('[data-p6-direction-save]'), '客户档弹层'))) premise('客户档弹层打不开，行 6 无法继续')
check('6a 客户档弹层里是 4 颗下拉（收发各两个语种，没有线路那一格）', (await countOf(CUST_TRIG)) === 4, '4', await countOf(CUST_TRIG))
const custBefore6 = await settingsOf(`customerId=${RX.customerId}`)
const WANT6 = otherLang(custBefore6.receiveToLang)
if (!(await pickCustSel(1, `（${WANT6}）`))) premise(`客户档弹层的收信目标下拉里找不到「（${WANT6}）」，行 6 无法继续`)
await clickSel('[data-p6-direction-save]', '保存')
const custAfter = await wait(6000, async () => {
  const s = await settingsOf(`customerId=${RX.customerId}`)
  return s.scope === 'customer' && s.receiveToLang === WANT6 ? s : null
}, '客户行读回（且改的就是那一个字段）')
check('6b 客户档弹层能保存并落下覆盖行', custAfter?.scope === 'customer', 'customer', custAfter?.scope)
check('6c 保存后线路与保存前同一值（draft 多带 channel 没改到它）', custAfter?.channel === custBefore6.channel, custBefore6.channel, custAfter?.channel)
await restoreCust()
```

> 计数说明：行 5 里那条 `5x` 只在"开关始终不可点"这一种失败下才发生，所以驱动打印的分母是 **32**（全绿时）或 33（走了 5x 那条前置失败）。报告照抄驱动打印的那一行，不按这里的数字写（C14）。

收尾（正常跑完时执行；premise 那条路已经在 `process.exit(2)` 前打印过布景说明）：

```js
await dropConv(ACCT_ID, RX.chatKey)
await dropConv(ACCT_ID, RY.chatKey)
await ev(`window.__p6f?.setBridges([])`)
console.log(`\n${bad === 0 ? 'ALL PASS' : 'FAILURES'} (${n - bad}/${n})`)
await page.close()
process.exit(bad === 0 ? 0 : 1)
```

**残留清理**：合成会话那些行的 chatKey 都带 `P7CDP-` / `P7DECOY-` 前缀，要清就按 `sceneNote` 里那一条 DELETE：
`curl -X DELETE "…/api/translation/settings/conversation?accountId=<id>&chatKey=P7CDP-…@c.us"`。D-06 允许这类无主会话档留在库里（本地库、键唯一、下次同键命中），所以它不算污染，只是要如实交代。

- [ ] **Step 4: 跑驱动（前置一次到位，跑不动就 exit 2 而不是"跳过"**

```bash
cd /d/SmartSCRM && pnpm --dir apps/desktop exec electron-vite dev --remoteDebuggingPort 9223   # 后台
cd /d/SmartSCRM && powershell -NoProfile -ExecutionPolicy Bypass -File tmp/p5c-top.ps1
cd /d/SmartSCRM && node tmp/p7a-stage-dialog.mjs 2>&1 | tail -45
```

期望：`ALL PASS (32/32)`，exit 0。**`# check` 的总数按驱动实跑打印的那一行写进报告**（C14 同一口径：这份计划里的 32 是按上面列出的 `check()` 调用数推演的，删掉或补上一条都要重算）。任何一条 `BLOCKED(premise)` → exit 2，先修前置再谈"验过了"。

**行 5 是这一批里最可能红的一条**：那颗 Switch 在 `disabled={!settings || saveSettings.isPending}` 之下——生效档没读回来就点，点的是空气，所以行 5 前面那句"等它可点"是必需的，不是保险。它另一处依赖是 RX 那条真实会话**此刻的 `send_enabled` 由会话档那一行说话**（行 4 开头刚 PUT 出这一档），否则 5a 的"翻了一格"没有对照物。

- [ ] **Step 5: 后端契约与 Java 全量重跑（本阶段收口）**

```bash
cd /d/SmartSCRM && node tmp/p7a-conv-settings.mjs 2>&1 | tail -25
cd /d/SmartSCRM/apps/server && export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18" && set -o pipefail && ./mvnw test 2>&1 | grep -E "Tests run|BUILD|ERROR" | tail -12
```

期望：契约驱动 `ALL PASS (16/16)`；`./mvnw test` 打 `Failures: 0, Errors: 0` 与 `BUILD SUCCESS`（不加 `-q`，surefire 那段汇总要看）。

- [ ] **Step 6: JS 全量闸门 + 既有回归能跑则跑**

```bash
cd /d/SmartSCRM && pnpm --dir apps/desktop test:unit 2>&1 | tail -6
cd /d/SmartSCRM && pnpm -r typecheck 2>&1 | tail -8
cd /d/SmartSCRM && pnpm --dir apps/desktop lint 2>&1 | tail -8
cd /d/SmartSCRM && powershell -NoProfile -ExecutionPolicy Bypass -File tmp/p5c-top.ps1 && node tmp/p6g-row12.mjs 2>&1 | tail -22
```

期望：单测 `# fail 0`、计数 = 各任务实测之和；`pnpm -r typecheck` 全绿；eslint 无新增 error。`p6g-row12` 要真实 WhatsApp 登录态，跑不动就如实记"本档未验证"（不接受用 `typecheck` 绿代替）。

- [ ] **Step 7: 杀 :8180（避免下一次 `package` 撞占用）并记录端口状态**

```bash
cd /d/SmartSCRM && netstat -ano | grep ':8180' | head -3
```

记下 PID；`taskkill //PID <pid> //F` 只在要重新打包前做。

- [ ] **Step 8: Commit（只提交那颗标记，`tmp/` 被 gitignore）**

```bash
cd /d/SmartSCRM && git add apps/desktop/src/renderer/src/components/AccountSidebar.tsx
git commit -m "feat(P7/B16): 渲染层三档生效面的 CDP 验收 + 账号行定位标记

驱动 tmp/p7a-stage-dialog.mjs 六行 32 条断言（在本地 gitignored，不入库）：
禁用链两种失败形态分开断（只断 disabled 会把"挑了另一个账号的桥"一起放过）、
改语种保存后从后端按同键读回 scope=conversation（不读表单现值）、恢复继承回落到它下面那一档而不是全局、
切会话时回复框徽标跟着变、回复框那颗开关写会话档那一行而全局与客户行一字未动、客户档弹层保存后线路没动。
目标语种按"与当前生效值不同的那一个"现挑，写死 en 会在库里已是 en 时红在布景撞值上。
premise 走 process.exit(2) 而不是 throw：throw 冒出 unhandledRejection 会以 1 退出，把"前置不满足"报成"断言失败"。
侧栏那颗标记是因为按文案匹配会点进重命名按钮；account.id 正是会话档键里的 accountId。"
```

---

### Task 11: 真实登录档验收 + 验收文档（spec §8 最后一块 / §4① 的证据词）

**Files:**

- Create: `tmp/p7b-prereq.mjs`、`tmp/p7b-live.mjs`（都在 gitignored 的 `tmp/`，不进提交；两棒之间由 `tmp/p7b-live-state.json` 传 A 那条会话，同样 gitignored，B 棒收尾时删掉）
- Create: `docs/notes/2026-09-25-conversation-settings-verification.md`
- Modify: `docs/superpowers/specs/2026-09-25-conversation-settings-design.md`（只回填 §8 的"真实登录档"那一行与 §4① 的证据词）

**Interfaces:**

- Consumes：Task 1–10 的全部实测数（各任务报告里的 `# pass` / `ALL PASS (N/N)` 抄录值）、既有 `tmp/cdp.mjs` 的 `openPage(port, urlPart)` 与 `openViewByUrl(urlPart, port)`（**两棵参数顺序相反**，抄错就是连不上）。
- Produces：一份带四级证据词（实测 / 读码 / 推断 / 待验证）的验收文档；spec §4① 从"读码成立"升级或保持原样。

**这一步要的是前面所有驱动都给不了的那一条证据**：Task 10 的桥帧是 `__p6f.setBridges` 手喂的（P-04 明说它断的是"渲染层读哪两个字段"），所以"真桥到底会不会给出 `activeChatKey`、给了会不会跟着 WhatsApp 里的切会话走"这一格仍然空着。spec §8 因此把这一档单列，并写明未跑完之前 §4① 只能标"读码成立"。

- [ ] **Step 1: 确认在场的三件事（任一不成立就别开火，直接进 Step 5 写"未验证"）**

```bash
cd /d/SmartSCRM && powershell -NoProfile -ExecutionPolicy Bypass -File tmp/p5c-top.ps1
cd /d/SmartSCRM && node -e "fetch('http://127.0.0.1:8180/api/health').then(r=>r.json()).then(j=>console.log('health',JSON.stringify(j))).catch(e=>console.log('DOWN',String(e)))"
```

1. **系统代理开着**（`web.whatsapp.com` 出得去）——这是用户的手，助手不代开。
2. dev app 以 `pnpm --dir apps/desktop exec electron-vite dev --remoteDebuggingPort 9223` 起，**且是主进程改动之后重启过的**（Task 6 动了 `ipc.ts` / `msgBridge`，热更覆盖不到主进程）。
3. 该 WhatsApp 账号在视图里真的登录着，并且**同一个账号名下至少两条单聊、各有一条中文消息可看**（会话档要作用在收信翻译上，空会话看不出任何事；两棒各断一条，第二条要人在 A 棒之后手动切过去）。

- [ ] **Step 2: 只读前置驱动 `tmp/p7b-prereq.mjs`（分母先落到纸上）**

**这一档的分母问的是"能不能切出两条会话"，不是"有几条桥"**：`activeChatKey` 答的是"这个视图此刻在看谁"，一个账号一条视图、只可能带一条键。两条会话因此来自**两次采样**（真人切一次会话），任何一刻驱动同时只看得见一条。写前置时不能要求"两条带键的桥"——那个形状在单账号下永远不成立；把期望降到"一条就行"又正好掩盖掉本轮要验的东西。

```js
// tmp/p7b-prereq.mjs —— P7/B16 真实登录档的前置与分母（只读，不改任何一行设置）。
// 出口：前置不满足 exit 2 并打印缺哪一件；齐了 exit 0，打印验收文档要照抄的三分母。
import { openPage } from './cdp.mjs'

const BASE = 'http://127.0.0.1:8180'
const login = await (await fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ inviteCode: 'DEMO0001', username: 'admin', password: 'admin123', deviceId: 'p7b-live' })
})).json().catch(() => null)
const token = login?.data?.accessToken
const die = (l, d) => { console.log(`BLOCKED(premise) ${l}${d ? ` —— ${d}` : ''}`); process.exit(2) }
if (!token) die('后端 :8180 没起 / 是旧进程 / 登录参数变了', JSON.stringify(login ?? '').slice(0, 160))
const H = { authorization: 'Bearer ' + token }
const get = async (p) => {
  const j = await (await fetch(BASE + p, { headers: H })).json()
  if (j.code !== 0) throw new Error(`${p} -> ${j.code} ${j.message}`)
  return j.data
}
/** 会话行与桥帧共用这一个判定：桥帧只有 `activeChatKey` 一列，包一层同形状的对象即可。 */
const usable = (o) => typeof o?.chatKey === 'string' && o.chatKey.length > 0 && o.chatKey.length <= 128 && !o.chatKey.endsWith('@g.us')

const page = await openPage(9223, 'localhost:5173').catch(() => null)
if (!page) die('CDP 连不上（dev app 没起 / 端口不是 9223）')
if ((await page.ev('document.visibilityState')) !== 'visible') die('窗口不可见，先跑 tmp/p5c-top.ps1')

const frames = JSON.parse(await page.ev('JSON.stringify(window.__p6f?.bridgeStates() ?? [])'))
const wa = frames.filter((b) => b.platform === 'whatsapp' && b.ready === true)
if (!wa.length) die('没有 ready 的 WhatsApp 桥（代理 / 登录态 / 主进程改过没重启）',
  JSON.stringify(frames.map((b) => [b.accountId, b.platform, b.phase, b.ready])))
const keyed = wa.filter((b) => usable({ chatKey: b.activeChatKey }))
console.log(`分母① ready 的 WhatsApp 桥 ${wa.length} 条，其中带 activeChatKey 的 ${keyed.length} 条`)
if (!keyed.length) die('一条键都没给：spec §8 那一格的结论由 p7b-live 的 A1 去断言并写进文档，这里只提醒后面几行没有可断的对象')
console.log('桥帧:', JSON.stringify(keyed.map((b) => ({ acct: b.accountId, chatKey: b.activeChatKey }))))

const accounts = await get('/api/platform-accounts')
const list = Array.isArray(accounts) ? accounts : (accounts?.records ?? [])
for (const b of keyed) {
  const kind = list.find((a) => a.id === b.accountId)?.platformType
  const recs = ((await get(`/api/conversations?accountId=${b.accountId}&size=200`))?.records ?? []).filter(usable)
  const hit = recs.filter((c) => c.chatKey === b.activeChatKey).length
  console.log(`分母② 账号 ${b.accountId}（platformType=${kind}）：可用单聊 ${recs.length} 条（≥2 才够第二棒切），`
    + `activeChatKey 在 chat_conversation 里命中 ${hit} 条（0 = 桥报的键与库里那一列不同源，那是缺陷，不是"还没同步"）`)
  if (recs.length < 2) console.log('  → 少于 2 条：两档对照那一行跑不了，如实写待验证；其余行照断')
  for (const c of recs.slice(0, 2)) {
    const s = await get(`/api/translation/settings?accountId=${b.accountId}&chatKey=${encodeURIComponent(c.chatKey)}`)
    console.log(`  开局: ${c.chatKey} 生效档=${s.scope} inherited=${s.inherited} recv=${s.receiveToLang} send=${s.sendToLang} channel=${s.channel}`)
  }
}
const g = await get('/api/translation/settings')
console.log('分母③ 全局行:', JSON.stringify({ scope: g.scope, recv: g.receiveToLang, send: g.sendToLang, channel: g.channel }))
await page.close()
process.exit(0)
```

跑：`node tmp/p7b-prereq.mjs 2>&1 | tail -20`。**它打印的每一行都要抄进验收文档的"前置分母"**——`分母②` 里"可用单聊 N 条"决定第二棒有没有对象，`分母③` 决定 B 棒回落那一行该看到什么档（不预设答案是"全局"）。

- [ ] **Step 3: 真实登录档驱动 `tmp/p7b-live.mjs`（两棒：A 棒 6 条、B 棒 7 条）**

取证口径沿用 P5 §6.3 那套：`window.__SCRM_INJECTOR__` 是 contextBridge 对象，直接赋值会被吞，所以把 `invoke` 换成覆写版，把每笔 `translate-api` 的 `res` 记进 `window.__REQS__`；计数器必须在注入器诞生之前挂好（`Page.addScriptToEvaluateOnNewDocument` + reload）。**为什么只能这么取**：页内气泡那侧没有任何 `data-*` 可点（注入层只在手动翻译按钮上设了 `role`），而"档对不对"的页内证据只有一条——**这一笔请求拿回来的 `res.scope` 与 `res.toLangCode` 是不是刚给这条会话设的那一档**。`translationBridge.ts:61-62` 是 `return body.data` 原样透传（那份 `TranslateResponse` 接口没列 `scope`，但运行时不裁剪），所以 `scope` 到得了页内；A6/B5 那一行同时是这处读码的现场核对。

两个坑先说死：

1. **改的是收信语种（弹层第 2 格，trigger index 1），不是发信那格**。气泡走 `type:'receive'`，读的是 `receiveToLang`；Task 10 第 2 行点 index 3 是因为它断的是"写回哪一列"，与本档无关。
2. **语种码从下拉清单里现读**，不写死 `en` / `vi`。当前线路支持哪几个语种由后端给的清单决定，写死会让"清单里没有 vi"这种环境问题长成一条断言失败。

```js
// tmp/p7b-live.mjs —— P7/B16 生效面 ① 的真实登录档（需代理 + WA 已登录 + 真人抬窗）。
// 两棒：`--a` 给"此刻在看的那条会话"（A）设一档；真人把 WhatsApp 切到同账号另一条会话之后再跑 `--b`（B），
//       B 棒做两档对照与收尾恢复。为什么要两棒：activeChatKey 是"这个视图此刻在看谁"，驱动不能替
//       WhatsApp 切会话（那是 P6 Task 12a 那条链，本阶段没做）。两棒之间靠 tmp/p7b-live-state.json 传 A。
// 出口：exit 2 前置不满足（环境缺东西，不是代码坏了）；exit 1 本棒有断言失败；0 本棒全绿。
//       两棒各打各的分母（6 / 7），验收文档两行都照抄。
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { openPage, openViewByUrl } from './cdp.mjs'

const STAGE = process.argv[2] === '--b' ? 'b' : 'a'
const STATE = 'tmp/p7b-live-state.json'
const TEXT = '你好，今天过得怎么样' // 中文写在脚本源里（UTF-8 文件），不经 shell 的 -d（C7）
const TRIGS = '[data-p7-conv-dialog] [data-slot="select-trigger"]'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let bad = 0
let n = 0
const check = (name, pass, expected, actual) => {
  n++
  if (!pass) bad++
  console.log(`${String(n).padStart(2, '0')} ${pass ? 'ok  ' : 'FAIL'} ${name}${pass ? '' : ` —— 期望 ${expected} / 实得 ${actual}`}`)
  return pass
}
const premise = (l, d) => { console.log(`\nBLOCKED(premise) ${l}${d ? ` —— ${d}` : ''}`); process.exit(2) }
async function wait(ms, fn, label) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > ms) { console.log(`  [超时] ${label}`); return null }
    await sleep(200)
  }
}
const BASE = 'http://127.0.0.1:8180'
const login = await (await fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ inviteCode: 'DEMO0001', username: 'admin', password: 'admin123', deviceId: 'p7b-live' })
})).json().catch(() => null)
const token = login?.data?.accessToken
if (!token) premise('后端 :8180 没起 / 是旧进程')
const H = { authorization: 'Bearer ' + token }
const get = async (p) => {
  const j = await (await fetch(BASE + p, { headers: H })).json()
  if (j.code !== 0) throw new Error(`${p} -> ${j.code} ${j.message}`)
  return j.data
}
const convQ = (a, c) => `accountId=${a}&chatKey=${encodeURIComponent(c)}`
const dropConv = (a, c) => fetch(BASE + `/api/translation/settings/conversation?${convQ(a, c)}`,
  { method: 'DELETE', headers: H }).then((r) => r.json())

const page = await openPage(9223, 'localhost:5173').catch(() => null)
if (!page) premise('CDP 连不上（dev app / 端口）')
if ((await page.ev('document.visibilityState')) !== 'visible') premise('渲染层窗口不可见，先跑 tmp/p5c-top.ps1')
/** 拿第 idx 个可点、可见的节点的屏幕中心；disabled / 没宽度一律回 null（"灰着"与"点到了"必须可分）。 */
const boxOf = (sel, idx = 0) => page.ev(`(() => { const a=[...document.querySelectorAll(${JSON.stringify(sel)})];`
  + ` const el=a[${idx}]; if(!el||el.disabled) return null; const r=el.getBoundingClientRect();`
  + ` return r.width?{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}:null })()`)
const realClick = async (p) => {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1, buttons: 1 })
  await sleep(60)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1, buttons: 0 })
}
const esc = async () => {
  for (const type of ['keyDown', 'keyUp'])
    await page.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  await wait(2000, () => page.ev(`!document.querySelector('[data-slot="select-content"]')`), '下拉收起')
}
/**
 * 真点一遍：开弹层 → 数控件 → 开第 idx 格下拉 → **从清单里现读**一个不在 exclude 里的语种码
 * （标签形态 `英语（en）`）→ 点它 → 保存。回 `{ok, shown, trigs, code, why}`：`why` 说的是
 * "哪一步没发生"，不是一个笼统的 false——"保存是灰的"与"弹层没开"是两种坏法。
 */
async function setLangViaUi(idx, exclude) {
  const entry = await boxOf('[data-p7-stage-settings]')
  if (!entry) return { ok: false, why: 'entry-missing-or-disabled' }
  await realClick(entry)
  if (!(await wait(4000, () => page.ev(`!!document.querySelector('[data-p7-conv-dialog]')`), '弹层')))
    return { ok: false, why: 'no-dialog' }
  const shown = await page.ev(`document.querySelector('[data-p7-conv-chatkey]')?.textContent?.trim() ?? null`)
  const trigs = await page.ev(`document.querySelectorAll(${JSON.stringify(TRIGS)}).length`)
  const trig = await boxOf(TRIGS, idx)
  if (!trig) return { ok: false, shown, trigs, why: 'no-trigger' }
  await realClick(trig)
  const raw = await wait(4000, async () => page.ev(
    `(() => { const a=[...document.querySelectorAll('[data-slot="select-content"] [data-slot="select-item"]')];`
    + ` if(!a.length) return null;`
    + ` return JSON.stringify(a.map((el) => { const r=el.getBoundingClientRect();`
    + ` const m=/（([A-Za-z-]+)）/.exec(el.textContent||'');`
    + ` return { code: m?m[1]:null, x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2) } })) })()`
  ).catch(() => null), '语种清单')
  const opts = JSON.parse(raw ?? '[]')
  const pick = opts.find((o) => o.code && !exclude.includes(o.code))
  if (!pick) { await esc(); return { ok: false, shown, trigs, why: `清单里没有新语种（${opts.map((o) => o.code).join(',') || '空'}）——换语种或换线路再跑，别把它算成断言失败` } }
  await realClick(pick)
  const sv = await boxOf('[data-p7-conv-save]')
  if (!sv) { await esc(); return { ok: false, shown, trigs, code: pick.code, why: 'save-disabled（选了语种却没变脏？改动没落到这一格）' } }
  await realClick(sv)
  if (!(await wait(6000, () => page.ev(`!document.querySelector('[data-p7-conv-dialog]')`), '保存后关闭')))
    return { ok: false, shown, trigs, code: pick.code, why: 'not-saved' }
  return { ok: true, shown, trigs, code: pick.code }
}

// 页内插桩：只在文档开头挂一次，把每笔 translate-api 的 res 记进 __REQS__。
const HOOK = `(() => {
  window.__REQS__ = []
  let hooked = false
  const tryHook = () => {
    const obj = window.__SCRM_INJECTOR__
    if (hooked || !obj) return
    const d = Object.getOwnPropertyDescriptor(obj, 'invoke')
    if (!d || typeof d.value !== 'function') return
    const real = d.value.bind(obj)
    Object.defineProperty(obj, 'invoke', {
      configurable: true,
      value: async (ch, req) => {
        const res = await real(ch, req)
        if (ch === 'translate-api') {
          window.__REQS__.push({ at: Date.now(), type: req && req.type ? req.type : null, res: JSON.parse(JSON.stringify(res === undefined ? null : res)) })
        }
        return res
      }
    })
    hooked = true
  }
  tryHook()
  let k = 0
  const t = setInterval(() => { tryHook(); if (hooked || ++k > 4000) clearInterval(t) }, 5)
})()`

/**
 * 挂插桩 → reload 视图（WA 登录态在 IndexedDB 里，reload 不用重扫二维码）→ 等到页内出现
 * 一笔按会话档解析的请求。重扫那一瞬可能撞主进程那颗限流（`ipc.ts` 的 `rateLimited`），
 * 命中的那几笔 `res` 是 null，所以这里找的是"至少一笔"，并把看到过的档位全打出来。
 */
async function inPageEvidence() {
  const view = await openViewByUrl('web.whatsapp.com', 9223).catch(() => null)
  if (!view) premise('拿不到 WhatsApp 视图 target（内嵌页没开；openViewByUrl 自己会先等 90 秒再抛）')
  await view.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK }).catch((e) => premise(`插桩挂不上：${e}`))
  await view.send('Page.reload', {})
  const hit = await wait(120000, async () => {
    const s = await view.ev(`(() => { const a=(window.__REQS__||[]).filter((x)=>x.res&&x.res.scope==='conversation');`
      + ` return a.length?JSON.stringify(a[a.length-1].res):null })()`).catch(() => null)
    return s ? JSON.parse(s) : null
  }, '页内出现 scope=conversation 的那一笔（重扫 + 盖章到位）')
  const seenRaw = await view.ev(`JSON.stringify((window.__REQS__||[]).map((x)=>x.res?x.res.scope:'null'))`).catch(() => null)
  const keysRaw = await view.ev(`JSON.stringify(Object.keys((window.__REQS__||[]).slice(-1)[0]?.res ?? {}))`).catch(() => null)
  await view.close()
  return { hit, seen: JSON.parse(seenRaw ?? '[]'), keys: JSON.parse(keysRaw ?? '[]') }
}

/** 后端直发一笔 receive 翻译：证的是解析链，**不是**页内证据（它不经过注入层，账号由调用方给）。 */
const probe = async (acct, chatKey) => {
  const j = await (await fetch(BASE + '/api/translation/translate', {
    method: 'POST', headers: { ...H, 'content-type': 'application/json' },
    body: JSON.stringify({ text: TEXT, type: 'receive', noCache: true, accountId: acct, chatKey })
  })).json()
  if (j.code !== 0) premise(`translate 打不通：${j.code} ${j.message}`)
  return j.data
}

// ---------- 两棒共用的前置：读桥帧（ready 的 WhatsApp 桥；多账号时优先挑已给出键的那条） ----------
const frames = JSON.parse(await page.ev('JSON.stringify(window.__p6f?.bridgeStates() ?? [])'))
const wa = frames.filter((b) => b.platform === 'whatsapp' && b.ready === true)
if (!wa.length) premise('没有 ready 的 WhatsApp 桥（代理 / 登录态 / 主进程改过没重启）',
  JSON.stringify(frames.map((b) => [b.accountId, b.phase, b.ready])))
const dbRecs = async (acct) => ((await get(`/api/conversations?accountId=${acct}&size=200`))?.records ?? [])
  .filter((c) => typeof c.chatKey === 'string' && c.chatKey.length > 0 && c.chatKey.length <= 128)

if (STAGE === 'a') {
  // ===== A 棒：给"此刻在看的那条会话"设一档，并把真桥那几格证据落下来 =====
  const BR = wa.find((b) => b.activeChatKey) ?? wa[0]
  // A1 是本轮的头条证据，所以它是**断言**不是前置：真桥给不出键就是这一档的结论（exit 1），
  // 拿 premise 把它滑过去等于把"没测到"写成"测不了"。
  const keyOk = typeof BR.activeChatKey === 'string' && BR.activeChatKey.length > 0 && BR.activeChatKey.length <= 128
  check('A1 真桥给得出 activeChatKey（Task 10 的桥帧是手喂的，这一格第一次由真桥回答）',
    keyOk, '非空且 ≤128', JSON.stringify(BR.activeChatKey))
  if (!keyOk) { console.log(`\nA 棒：FAIL (${n - bad}/${n}) —— 后面几行没有可断的对象`); await page.close(); process.exit(1) }
  const ACCT = BR.accountId
  const A = BR.activeChatKey
  const recs = await dbRecs(ACCT)
  check('A2 桥报的键与 chat_conversation.chat_key 同源（D-11：盖章与列表读的是同一列）',
    recs.some((c) => c.chatKey === A), '命中 ≥1', `库里 ${recs.length} 条，命中 ${recs.filter((c) => c.chatKey === A).length} 条`)
  const r0 = await boxOf('[data-p7-stage-settings]')
  check('A3 舞台那颗「会话设置」在真桥下可点（禁用链的反面：ready + 有键 → 亮着）',
    r0 !== null, '非 null', JSON.stringify(r0))
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 }).catch(() => {})

  const ra = await setLangViaUi(1, [])
  check('A4 弹层显示的就是桥给的那条会话，且三格控件齐（收/发各两格 + 线路一格 = 5 个下拉）',
    ra.ok === true && ra.shown === A && ra.trigs === 5, `${A} & 5 格`, `${ra.shown ?? ra.why} & ${ra.trigs} 格`)
  const savedA = await wait(6000, async () => {
    const j = await get(`/api/translation/settings?${convQ(ACCT, A)}`).catch(() => null)
    return j?.scope === 'conversation' && j?.receiveToLang === ra.code ? j : null
  }, 'A 档读回')
  check('A5 真实点击保存写进会话档那一行（后端按同键读回，档位与刚选的语种码都对上）',
    savedA !== null, `conversation & ${ra.code}`, `${savedA?.scope} & ${savedA?.receiveToLang}`)

  const ea = await inPageEvidence()
  console.log('  [注] 页内看到过的档位:', JSON.stringify(ea.seen), '· res 字段:', JSON.stringify(ea.keys))
  check('A6 页内那一条请求按刚设的会话档出译文（res.scope=conversation 且 toLangCode 就是刚选的语种）',
    !!ea.hit && ea.hit.scope === 'conversation' && ea.hit.toLangCode === ra.code,
    `conversation & ${ra.code}`, ea.hit ? `${ea.hit.scope} & ${ea.hit.toLangCode}` : '一笔都没有')
  writeFileSync(STATE, JSON.stringify({ acct: BR.accountId, aKey: A, aLang: ra.code, at: new Date().toISOString() }) + '\n', 'utf8')
  console.log(`  [记] 交给 B 棒的状态: ${STATE} → ${JSON.stringify({ acct: BR.accountId, aKey: A, aLang: ra.code })}`)
  console.log(`\nA 棒：${bad === 0 ? 'ALL PASS' : 'FAILURES'} (${n - bad}/${n})`)
  await page.close()
  process.exit(bad === 0 ? 0 : 1)
}

// ===== B 棒：真人把 WhatsApp 切到同账号另一条会话之后跑 =====
let st = null
try { st = JSON.parse(readFileSync(STATE, 'utf8')) } catch { /* 下面按前置不成立处理 */ }
if (!st?.aKey || !st?.acct) premise('B 棒要先跑完 A 棒（tmp/p7b-live-state.json 不在）', STATE)
const ACCT = st.acct
const BR = wa.find((b) => b.accountId === ACCT) ?? wa[0]
// "切了没有"是环境动作，不是被测行为：没切就是前置不成立（exit 2），不占一行"永远为真"的断言。
if (!BR.activeChatKey) premise('这个账号的桥此刻没给键（切完会话那一拍还没广播上来；等两秒重跑，不是代码坏了）')
if (BR.activeChatKey === st.aKey)
  premise('桥还在 A 那条上：B 棒要真人把 WhatsApp 切到**同一个账号的另一条会话**再跑（切错账号也算没切）',
    `${st.aKey} vs ${BR.activeChatKey}`)
const B = BR.activeChatKey
console.log(`  [注] 桥给的键已经换了一条：${st.aKey} → ${B}`)
const recs = await dbRecs(ACCT)
check('B1 B 这条也在 chat_conversation 里（两条会话都挂在同源那一列上）',
  recs.some((c) => c.chatKey === B), '命中 ≥1', `库里 ${recs.length} 条`)
await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 }).catch(() => {})
const rb = await setLangViaUi(1, [st.aLang])
check('B2 弹层跟着换到了 B（渲染层读的是桥的新键），且 B 设的是另一个语种',
  rb.ok === true && rb.shown === B && rb.code !== st.aLang, `${B} & ≠${st.aLang}`, `${rb.shown ?? rb.why} & ${rb.code}`)
const savedB = await wait(6000, async () => {
  const j = await get(`/api/translation/settings?${convQ(ACCT, B)}`).catch(() => null)
  return j?.scope === 'conversation' && j?.receiveToLang === rb.code ? j : null
}, 'B 档读回')
const againA = await get(`/api/translation/settings?${convQ(ACCT, st.aKey)}`)
check('B3 两条会话各自一行、互不覆盖（给 B 建档没把 A 抹掉，也没串档）',
  savedB !== null && againA.scope === 'conversation' && againA.receiveToLang === st.aLang,
  `B=conversation & ${rb.code} / A=conversation & ${st.aLang}`,
  `B=${savedB?.scope} & ${savedB?.receiveToLang} / A=${againA.scope} & ${againA.receiveToLang}`)
const pa = await probe(ACCT, st.aKey)
const pb = await probe(ACCT, B)
check('B4 同一句原文在两档下按各自语种解析（后端解析按会话分岔；**这一行不经过注入层，不是页内证据**）',
  pa.toLangCode === st.aLang && pb.toLangCode === rb.code && pa.scope === 'conversation' && pb.scope === 'conversation',
  `${st.aLang} & ${rb.code} & 两笔都 conversation`, `${pa.toLangCode} & ${pb.toLangCode} & ${pa.scope}/${pb.scope}`)
console.log('  [注] 两笔译文只作旁证（语种码才是判据）:', JSON.stringify(pa.translation), 'vs', JSON.stringify(pb.translation))

const eb = await inPageEvidence()
console.log('  [注] 页内看到过的档位:', JSON.stringify(eb.seen), '· res 字段:', JSON.stringify(eb.keys))
check('B5 页内当前在屏的 B 会话按它自己那一档出译文', !!eb.hit && eb.hit.toLangCode === rb.code,
  rb.code, eb.hit ? String(eb.hit.toLangCode) : '一笔都没有')
console.log('  [请用户看] 在 WhatsApp 里 A↔B 来回切两次，各看一条中文消息：气泡语种应跟着会话变（A='
  + st.aLang + '、B=' + rb.code + '）。这一格只能目视，驱动不代答。')

const dB = await dropConv(ACCT, B)
const dA = await dropConv(ACCT, st.aKey)
check('B6 两条真会话各删掉一行（cleared 各 1：刚写进去的确实是两行，而不是一行被改了两次）',
  dB.data?.cleared === 1 && dA.data?.cleared === 1, '1 & 1', `${dB.data?.cleared} & ${dA.data?.cleared}`)
const back = await get(`/api/translation/settings?${convQ(ACCT, st.aKey)}`)
check('B7 删掉后回落到它下面那一档（客户还是全局按分母③的现值记，这里不预设答案）',
  back.scope !== 'conversation', '≠conversation', `${back.scope} inherited=${back.inherited}`)
rmSync(STATE, { force: true })
console.log(`\nB 棒：${bad === 0 ? 'ALL PASS' : 'FAILURES'} (${n - bad}/${n})（收尾：两条会话档都已删回继承）`)
await page.close()
process.exit(bad === 0 ? 0 : 1)
```

跑（两棒之间由人切会话，助手不代点内嵌页）：

```bash
cd /d/SmartSCRM && node tmp/p7b-live.mjs --a 2>&1 | tail -15
# 然后在 WhatsApp 里手动切到同一个账号的另一条会话（等两秒让 active_chat 广播落进主进程）
cd /d/SmartSCRM && node tmp/p7b-live.mjs --b 2>&1 | tail -20
```

三处口径写死在这里，省得跑的时候各自解释：

- **A1 是断言，"切了没有"是前提**：真桥给不给键是本轮要量的东西（给不出 → exit 1，那句结论进文档）；而 B 棒进来先核对桥的键是否已换一条，没换是环境动作没做（exit 2）。不给"永远为真"的断言留位置——那是速览表上的假分母。
- **B4 不算页内证据**：它打的是 `POST /api/translation/translate`，不经过注入层，证明的是解析链按会话分岔。页内那一半只由 A6/B5 承担（同一笔 `translate-api` 的 `res`）。两半分别写进验收文档，不合并成一句"端到端已验"。
- **A6/B5 依赖重扫**：`Page.reload` 之后注入器重挂、消息整屏重扫才会发请求；撞限流的那几笔 `res` 是 `null`，所以判据是"至少一笔命中"，并把 `seen` 那份档位清单打进报告——全 `global` 与一笔都没有是两种不同的坏法（前者 = 盖章没跟上，后者 = 插桩或重扫没发生）。

- [ ] **Step 4: 复跑机械闸门，把实测数抄成表**

```bash
cd /d/SmartSCRM && node tmp/p7a-conv-settings.mjs 2>&1 | tail -22
cd /d/SmartSCRM && node tmp/p7a-stage-dialog.mjs 2>&1 | tail -40
cd /d/SmartSCRM && pnpm --dir apps/desktop test:unit 2>&1 | tail -6
cd /d/SmartSCRM && pnpm -r typecheck 2>&1 | tail -8
cd /d/SmartSCRM/apps/server && export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18" && set -o pipefail && ./mvnw test 2>&1 | grep -E "Tests run|BUILD" | tail -6
```

每一行**照抄驱动打印的那一行**（`ALL PASS (N/N)` / `# pass N` / `Tests run: N, Failures: 0, Errors: 0`）。C14：计划里的推演数不进文档，文档里只有实跑数；两者不一致时以实跑为准，并在文档里写明差在哪（新增/删除了哪条断言）。

- [ ] **Step 5: 写 `docs/notes/2026-09-25-conversation-settings-verification.md`**

结构照 P6 那份验收文档（`2026-09-20-p6-chat-history-verification.md`），但**每一行都要落四级证据词之一**：

```markdown
# P7 / B16 会话级设置 · 验收结论

日期：YYYY-MM-DD · 关联：`docs/superpowers/specs/2026-09-25-conversation-settings-design.md` · 计划：`docs/superpowers/plans/2026-09-25-conversation-settings.md`

> 本文只记本项目的实测口径。驱动都在 `tmp/`（gitignore，不入库），断言均为当场真跑的数；未跑的行如实标 blocked / 待验证，不合并成"全绿"。

## 总体结论（不是"全部通过"）
## 前置分母（`tmp/p7b-prereq.mjs` 只读记录）
## 逐步实测
### 后端（V9 行为证据 / `ConversationScopeKeyTest` + `ScopeSettingsTest` / `tmp/p7a-conv-settings.mjs` 那 16 条）
### 渲染层（`activeChatKeyOf` 9 条 + `scopeLabel` 18 条 + `directionDraft` 线路 2 条 / `tmp/p7a-stage-dialog.mjs` 六行 32 条）
### 真实登录档（`tmp/p7b-live.mjs` A 棒 6 条 / B 棒 7 条，两棒之间由人切会话；两行分母各抄各的）
## 已知限制（≥3）
## 交付与提交范围
```

**逐条要写清、不许含糊的四处**：

1. **V9 的列宽没有直接证据**（本机无 mysql CLI），证据形态是"同一账号下 `AA@c.us` 与 `aa@c.us` 存成两条不同行"这一条行为差异（Task 5 第 1 行）。这句话要写在 V9 那一节，不能只写"迁移成功"。
2. **A 档与 B 档分开写**（C11）：Task 10 那六行的布景是手喂的（`setBridges` + HTTP PUT），行为是真的（真实鼠标事件 + 真实落库 + 后端读回）；Task 11 的 A1 才第一次由真桥回答"给不给得出 `activeChatKey`"，A2 回答"给的键与库同源"，B2 回答"切会话之后它跟着换"。两档各覆盖到哪、没覆盖到哪，逐行写。
3. **生效面 ①（内嵌页气泡）的证据词**：A6 与 B5 都绿才写"实测"（页内那一笔请求按各自会话的档位出译文）；只绿到 A5 / B4（后端读回 + 直发对照）就写"读码 + 部分实测，页内语种切换仍待验证"；一棒都没跑就保持 spec §8 的原话（"未跑完之前只能标读码成立"）。**不拿 B4 的在线 HTTP 对照冒充页内证据**——`probe()` 打的是后端，不经过注入层，它证明的是解析链，不是气泡。
4. **TG 一行**：会话档在 Telegram 上只能到 fixture（P6 Task 12a 未做），本阶段不声称 TG 生效（spec §8 已知验证缺口）。

已知限制这一节至少写满三条，其中这两条是本轮改动带出来的，必须记：

- **会话档的开关位在页内不生效**（D-09）：用户在会话 A 关掉接收翻译、会话 B 开着，页内实际只有一份进程级 flags（来源全局行）。回复框那一侧会跟着会话档变（它读的就是生效行），页内那一侧不会——同一屏两种表现，是设计边界不是 bug。
- **桥掉线后 `activeChatKey` 归 `null`，会话档不级联删除**：重连后同键命中；期间那颗「会话设置」按钮是灰的。切会话事件没到位的那一拍仍可能按上一个会话解析一次（P6 已知限制 3 的同一口径，会话档上线后不影响它成立）。

- [ ] **Step 6: spec 回填（只动证据词，不动裁定）**

若 A 棒与 B 棒全绿：`docs/superpowers/specs/2026-09-25-conversation-settings-design.md` §8 里"这档未跑完之前，§4① 只能标'读码成立'"那一句改成指向验收文档的实测结论（写明 A1/A2/A5/A6 与 B2/B4/B5 绿到哪几条）；若某一棒没跑成，那句原样留着，并在句尾补一行"未跑原因（前置不成立 / 断言失败，两者的说法不一样）"。**§10 的裁定表不重开**——实测与裁定冲突时才改，且要把冲突那一行原文留在文档里再写新结论。

- [ ] **Step 7: Commit（只提交两份文档；驱动不入库）**

```bash
cd /d/SmartSCRM && git status --short && git add docs/notes/2026-09-25-conversation-settings-verification.md docs/superpowers/specs/2026-09-25-conversation-settings-design.md
git commit -m "update(P7/B16): 会话级设置验收文档 + spec §4① 证据词回填

三级证据分开记：后端契约与 Java 单测在真库上跑、渲染层六行的布景是手喂而行为是真的、
真实登录档这一格只有 L1 起才算证明真桥会给 activeChatKey。
V9 的列宽无直接证据（本机无 mysql CLI），证据形态是大小写两条键存成两行这一条行为差异。
会话档开关位页内不生效、桥掉线后会话档不级联删除，两条按边界记进已知限制。"
```

**push 由用户手动执行。** 若 Step 3 一棒都没开火（无代理 / 无登录态），本文档仍然照写，但总体结论那一节要明写"真实登录档：未验证"，且提交体里不能说"端到端已验"。

---
