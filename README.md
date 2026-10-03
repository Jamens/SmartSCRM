# SmartSCRM

Electron + React + TypeScript 桌面 SCRM 客户端，配 Spring Boot + MySQL 后端。
本文件说明**项目架构**与**每个文件的作用**，供接手的人继续开发或自查。英文版本见 [README.en.md](./README.en.md)。

- 当前分支：`main`
- 已交付范围：P0 骨架 → P1 登录/窗口壳 → P2 平台账号与内嵌页 → P3 客户域 → P4 素材库/快捷回复 → P5 翻译中心 → P6 聊天记录 → **P7 批量群发（B7）+ 会话级设置（B16）** → **设置页（A12 角标 / A13 主题 / A14 设备信息 / A15）**
- **进行中**：**P8 群成员分析（B6）**——切面 1–5 已装到界面；**5c 交付闸已通过**（CDP 复检脚本 `tmp/cdp-recheck.mjs` 跑绿，界面真读到数 1 条群，验收台账见 `docs/notes/2026-10-02-b6-5c-acceptance.md`）；采集管线（Task 10 collector → Task 12 桥侧接线 → 8b 校准）**已交付**，见 §10
- 未交付：Telegram 采集/发送链、话术引擎、代理指纹、云手机、报表
- 体检与风险清单：[docs/notes/2026-09-25-module-audit.md](./docs/notes/2026-09-25-module-audit.md)（逐条带 `文件:行`）

## 一、环境要求

| 依赖 | 版本 / 说明 |
|---|---|
| Node.js | `>=20.19.0`（根 `package.json` 的 `engines`） |
| 包管理器 | **pnpm**（`packageManager: pnpm@11.18.0`）。本仓库不用 npm / npx，命令一律走 pnpm |
| JDK | 17（路径示例：`C:/Program Files/Java/jdk-17.0.18`） |
| MySQL | 8，本地 `localhost:3306`，用户 `root`，库名 `smartscrm_react`（由 `createDatabaseIfNotExist=true` 自动建） |

`apps/server/src/main/resources/application.yml` 是唯一的后端配置入口：数据源在 `:5-9`，服务端口在 `:17`（`8180`），JWT 密钥与两个 TTL 在 `:27-31`，日志级别在 `:33-35`（`com.smartscrm: debug` ⇒ MyBatis 会把每条 SQL、参数和命中行数打进控制台/日志文件）。

## 二、启动

```bash
# 0) 装依赖（仓库根目录）
pnpm install

# 1) 起后端（Flyway 自动跑 V1..V12 建表，DataSeeder 播种子账号）
export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18"
cd apps/server && ./mvnw spring-boot:run

# 2) 起桌面端（新终端，仓库根目录；predev 会先构建 inject 与 bridge 两份页面产物）
pnpm dev:desktop
```

健康检查：`GET http://localhost:8180/api/health`（`SecurityConfig.java:43` 放行的三个匿名端点之一，另两个是 login 与 refresh）。

种子登录：邀请码 `DEMO0001`，用户 `admin` / `agent01`；跨租户隔离验证用 `QA0002`（`config/DataSeeder.java`）。

## 三、顶层结构

```
SmartSCRM/
├── apps/
│   ├── desktop/          # Electron + React 19 + TS（electron-vite、Tailwind v4 + shadcn/ui）
│   └── server/           # Spring Boot 3.5 + Java 17 + MyBatis-Plus + Flyway
├── packages/
│   └── shared/           # 跨包共享的 TS 类型 / API 契约
├── docs/
│   ├── superpowers/specs/ # 设计文档（每个 Phase 一份，是实施计划的依据）
│   ├── superpowers/plans/ # 实施计划（逐任务、含测试步骤）
│   ├── notes/             # 验收记录、体检文档、延期说明
│   └── feature-checklist.md
├── tmp/                  # 本地验证脚本与日志（.gitignore 已忽略，不进仓）
└── README.md / README.en.md
```

## 四、后端架构（`apps/server`）

分层是 `controller → service → mapper → entity`，横切在 `security` / `config` / `common`。注意 **Controller 放在 `web/` 包**（`web/*Controller.java`），请求体在 `web/dto/`、响应体在 `web/vo/`——包名不是 `controller`。所有响应统一走 `ApiResponse{code,message,data}`，`code==0` 才是成功。

### 4.1 请求怎么被鉴权

```
HTTP 请求
 → security/JwtAuthFilter.doFilterInternal     读 Bearer token，解析 claims，写 SecurityContext
 → config/SecurityConfig                       无状态 + 默认拒绝；放行 login/refresh/health；401 回 code 40100
 → Controller                                  @AuthenticationPrincipal AuthPrincipal 拿到 userId/tenantId/inviteCode/role
 → Service                                     每条查询手写 eq(tenantId)（租户隔离就是这一处，见 §7）
 → 异常统一由 common/GlobalExceptionHandler 收敛（只管到 Controller/Service 层；过滤器里抛出的会绕过它，见体检文档 R-04）
```

| 文件 | 作用 |
|---|---|
| `security/JwtService.java` | 签发/解析 access 与 refresh token；claims 为 `tid`(租户)、`ic`(邀请码)、`role`、`typ`(access/refresh) |
| `security/JwtAuthFilter.java` | `OncePerRequestFilter`；只有 `typ=="access"` 才建立认证 |
| `security/AuthPrincipal.java` | record，Controller 里代表"当前登录者" |
| `config/SecurityConfig.java` | 无状态会话、默认拒绝、401 响应体、CORS 允许来源 |
| `config/MybatisPlusConfig.java` | 分页插件等 |
| `config/DataSeeder.java` | 首启动播 DEMO0001 / QA0002 两套种子数据 |
| `common/ApiResponse.java` | 统一响应信封 |
| `common/BizException.java` | 带 HTTP status + 业务 code 的异常 |
| `common/GlobalExceptionHandler.java` | `@RestControllerAdvice`：业务异常 / 参数校验 / 兜底 50000 |
| `common/PageResult.java` | 分页返回形状 |

### 4.2 业务面（按 Phase）

| Phase | Controller | Service | 说明 |
|---|---|---|---|
| P1 | `AuthController` | `AuthService` | 登录、刷新、`me`；BCrypt 校验、设备登记、双 token |
| P2a | `PlatformAccountController` | `PlatformAccountService` | 平台账号 CRUD + 状态位；`viewId` 是内嵌视图/分区标识 |
| P3 | `CustomerController` / `LabelController` / `AudienceController` | `CustomerService` / `LabelService` / `AudienceService` | 客户、标签组/标签、人群包；`CustomerService.countMatching` 是人群包成员数的唯一算法 |
| P4 | `MaterialController` / `QuickReplyController` | `MaterialService` / `QuickReplyService` | 素材组/素材、快捷回复组/回复/条目 |
| P5 | `TranslationController` | `TranslationService` + `SimulatedTranslationEngine` + `PhraseDict` + `service/provider/*` | 语向设置（全局 / 按客户）、缓存、测速、凭据 |
| P6 | `MessageController` / `ConversationController` | `MessageService`（写）+ `MessageQueryService`（读） | 批量入库、状态推进、列表/翻页/搜索/统计/时间线 |
| P7 | `BatchSendController` | `BatchSendService` + `services/batchSend/*` | 批量群发：笛卡尔展开、随机间隔、撤回、看门狗；第一版只认 `whatsapp` 且只到纯文本 |
| P8 | `GroupMemberController` | `GroupMemberService`（写）+ `GroupMemberQueryService`（读） | 群成员：群登记 / 状态快照 / 进退流水；ingest 三步同事务，覆盖率闸 0.6（见 §10） |

`service/msg/` 放的是**无状态纯函数**，也是 Java 单测主要覆盖的对象：

| 文件 | 作用 |
|---|---|
| `ChatKeys.java` | `chat_key` 形态判定（`@c.us` 单聊 / `@g.us` 群 / TG 数字 id）、平台推断、手机号规整 |
| `MsgTimes.java` | epoch 秒 → `DATETIME(3)`；时间戳不合理时钳到入库时刻 |
| `StatusLadder.java` | 发送状态单调阶梯（`pending→sent→delivered→read`，`failed` 旁路） |
| `Cursors.java` | `(time,id)` 游标编解码 |
| `SearchPattern.java` | LIKE 转义与"空词直接短路" |
| `ScopeSettings.java` | **语向解析的唯一入口**：有按客户覆盖行用覆盖，否则用全局 |

`service/provider/` 是翻译厂商适配层：`TranslationProvider`（接口）、`BaiduProvider`、`TencentProvider`、`Tc3Signer`（腾讯签名）、`Credentials`、`ProviderResult`、`ProviderException`。路由表在 `TranslationService.java:53-55`——只有 channel 5→百度、7→腾讯，其余 channel 走模拟引擎。

### 4.3 数据模型与迁移（`src/main/resources/db/migration`）

| 迁移 | 建了什么 | 关键约束 |
|---|---|---|
| `V1__baseline_tenant_user_device.sql` | `tenant` / `app_user` / `device` | 多租户根 |
| `V2__platform_account.sql` | `platform_account` | `viewId` 租户内唯一 |
| `V3__customer_domain.sql` | `customer` / `label_group` / `label` / `customer_label` / `customer_audience` | `uk_customer_tenant_platform_openid`；`customer_label` 对 customer 与 label 都 `CASCADE` |
| `V4__reply_material.sql` | 素材组/素材、回复组/回复/条目 | `material→group` 是 `SET NULL`；`quick_reply_item→quick_reply` 是 `CASCADE` |
| `V5__translation.sql` | `translation_setting` / `translation_node` / `translation_cache` / `translation_phrase` | `uk_tset_tenant_scope`；`uk_tcache_tenant_key` |
| `V6__translation_channel_comment.sql` | channel 取值注释 | — |
| `V7__translation_credential.sql` | `translation_credential` | 密钥按租户存，读出恒掩码 |
| `V8__chat_history.sql` | `chat_conversation` / `chat_message` | `uk_conv`、`uk_msg`（幂等键）、`idx_msg_conv`、`idx_msg_customer`；两表对 `platform_account` 都是 **`ON DELETE CASCADE`** |
| `V9__conversation_setting_scope_key.sql` | 会话设置的作用域键（列宽与大小写口径） | — |
| `V10__message_translation_persistence.sql` | 消息级译文持久化（`translated_*`、`msg_id`） | 译文回显的定位键 |
| `V11__batch_send.sql` | `batch_send_task` / `batch_send_detail` | `uk_bsd_seq`（同任务不跑出两条同序）；`dry_run` 在任务头不在明细 |
| `V12__group_member_analysis.sql` | `chat_group` / `group_member_state` / `group_member_event` | `uk_group`、`uk_member`、`uk_event`（重报不双计）；`group_member_event` **刻意不设 `chat_message` 外键**（事件比消息长寿）；`participant_count` 只被闸放行的快照覆盖 |

## 五、桌面端架构（`apps/desktop`）

四个进程边界，必须按这个顺序理解：**renderer（业务 UI）／main（窗口、内嵌视图、采集投递、发消息）／inject（注入进第三方页面的翻译层）／bridge（注入进第三方页面的采集与发送执行层）**。

```
                    ┌────────────────────────── 主窗口（本地 React）──────────────────────────┐
                    │ pages/9 个页面 · components/ · stores/(zustand) · api/ · lib/http.ts      │
                    └───────────────┬──────────────────────────────────────┬─────────────────┘
                          preload/index.ts (window.scrm)          preload/view.ts (window.ele)
                                    │                              ↑ 只给内嵌视图，不含 token
                    ┌───────────────▼──────────────────────────────┴──────┐
                    │ main：window/ · webContentsView/ · services/ · state/ │
                    └───┬────────────────────────────────────────┬────────┘
             executeJavaScript 注入                    msg:live / msg-report
                    │                                        │
        ┌───────────▼───────────────┐          ┌─────────────▼──────────────┐
        │ inject.bundle.js（页面内） │          │ msg-bridge.bundle.js + wa-js│
        │ 翻译气泡 / 输入框预览      │          │ 采集归一化 / 真实发送执行    │
        └───────────────────────────┘          └────────────────────────────┘
```

### 5.1 `src/main` 主进程

| 文件 | 作用 |
|---|---|
| `index.ts` | 入口：单实例锁、`registerIpcHandlers` → `startMsgBridge` → 建窗 → 建托盘；`before-quit` 里 `stopMsgBridge()` + `destroyAll()` |
| `ipc.ts` | 渲染层侧通道注册与窗口事件（最小化/最大化/关闭） |
| `window/mainWindow.ts` | 主窗口 `BrowserWindow`；开发态 `loadURL(ELECTRON_RENDERER_URL)`，打包态 `loadFile(...)`；`webSecurity: true` |
| `window/tray.ts` | 托盘 |
| `webContentsView/manager.ts` | **内嵌视图生命周期**：`createView`（分区 `persist:scrm-${viewId}`、`sandbox`/`contextIsolation` 开、`nodeIntegration` 关）、装载前设 UA、`dom-ready` 触发重注入、bounds 同步、`window.open` 拒绝并转外部浏览器、跨站导航拦截、`destroyView`/`unmountView`/`uninject` |
| `webContentsView/ipc.ts` | 三张通道白名单（host 11 条 / invoke 1 条 / push 若干）、`view:invoke` 限流 20 次/秒、正文 ≤5000 字、**主进程给翻译请求盖 `accountId`+`chatKey`**（口径②） |
| `webContentsView/chromeUserAgent.ts` | 标准 Chrome UA 生成（内嵌页要按正常浏览器加载第三方站点） |
| `services/authedFetch.ts` | 主进程带 token 的 fetch，5 秒超时，401 时刷新一次 |
| `services/translationBridge.ts` | 调 `/api/translation/translate`，把结果还给注入层/渲染层 |
| `services/msgBridge/index.ts` | 采集/发送总控：账号挂载、登录态观察、`handleBridgeReport`（含 ack 与补采进度）、`sendText`、`requestBackfill`、`unmountView`、`stopMsgBridge` |
| `services/msgBridge/collectorHub.ts` | **缓冲与投递**：按 `(accountId, activeChatKey)` 分组、500 条或 2 秒先冲、队列 10000 溢出丢最旧、失败退回队首、拒绝原因打一行 warn（正文不进日志） |
| `services/msgBridge/msgApi.ts` | `/api/messages/batch`、`/api/messages/status`、账号列表读取 |
| `services/msgBridge/sendRegistry.ts` | `SendRegistry`（`localId` → invoke 回执，20 秒超时、视图销毁即结清）与 `SendAttribution`（`msgKey → localId` 归属认领） |
| `services/msgBridge/bridgeMount.ts` | 往页面里分两段装载：先 wa-js、再桥；上报版本与 phase |
| `services/msgBridge/accountDirectory.ts` | `viewId ↔ 账号` 反查表（盖章 `accountId` 的来源） |
| `state/session.ts` | 登录态落盘：`userData/scrm-session.bin`，能加密就 `safeStorage`，否则明文 |

### 5.2 `src/preload`

| 文件 | 作用 |
|---|---|
| `index.ts` | 暴露 `window.scrm`（`session` / `win` / `view` / `msg`）与 `window.electron`，给主窗口用 |
| `view.ts` | 只暴露 `window.ele`（`sendToHost` / `send` / `invoke` / `on`）给内嵌视图，**不含 token、不含窗口控制** |
| `index.d.ts` | `window.scrm` 的类型声明 |

### 5.3 `src/renderer/src` 渲染层

| 目录 / 文件 | 作用 |
|---|---|
| `App.tsx` | `HashRouter` + 路由表；未登录跳 `LoginPage` |
| `layouts/AppLayout.tsx` | 整体框架：`TitleBar` + `ModuleRail` + `AccountSidebar` + 内容区 |
| `pages/` | 9 个页面：`HomePage`(工作台)、`MessagesPage`(聊天记录)、`CustomersPage`、`LabelsPage`、`AudiencesPage`、`QuickRepliesPage`、`MaterialsPage`、`TranslationPage`、`LoginPage` |
| `components/AccountSidebar.tsx` | 账号列表 + 增删（删除即销毁视图） |
| `components/AccountStage.tsx` | 内嵌视图舞台：量测容器 bounds，向主进程传 `injectConfig`（含 `apiBase`） |
| `components/AddAccountDialog.tsx` / `ModuleRail.tsx` / `TitleBar.tsx` / `ModulePlaceholder.tsx` | 新建账号弹窗 / 左侧模块导航 / 自绘标题栏 / 未实现模块占位 |
| `components/messages/` | 记录页的 9 个部件：`ConversationList`、`ConversationActions`(会话头语向弹层)、`CreateCustomerDialog`、`CustomerDirectionDialog`、`MessageThread`、`MessageBubble`、`ReplyComposer`(回复框)、`SearchPanel`(全局搜索，300ms 防抖)、`StatsCards` |
| `components/customers/` | `CustomerDrawer`（客户抽屉）、`CustomerTimeline`（时间线 + 跳回记录页） |
| `components/translation/LangSelect.tsx` | 语种选择器 |
| `components/ui/` | 11 个 shadcn 基础件 |
| `api/` | 按域分文件的后端调用：`customers` `labels` `audiences` `materials` `quickReplies` `messages` `translation` |
| `stores/auth.ts` | 登录态：token 只经 `window.scrm.session` 存（不进 localStorage），启动时 `boot` 恢复 |
| `stores/accounts.ts` | 账号列表与当前账号 |
| `stores/chatJump.ts` | 一次性交接信号：抽屉里 `hold(conversation)`，记录页挂载时取走并 `clear()`（整条 `ConversationVO`，不用路由参数——`chat_key` 含 `@`/`.`/连字符，且不该暴露在地址栏） |
| `hooks/useWebContentsView.ts` | 视图生命周期与容器绑定的 React 侧装配 |
| `hooks/useDebouncedValue.ts` | 输入防抖 |
| `lib/http.ts` | **渲染层唯一出口**：base 取 `VITE_API_BASE`，401 自动刷新一次，`code!=0` 抛 `ApiError` |
| `lib/translationSync.ts` / `lib/loginStatusSync.ts` | 把注入层回传的状态同步进 UI |
| `lib/liveTail.ts` 相关（实现在 `shared/liveTail.ts`） | 实时尾巴合并 |
| `lib/chatDisplay.ts` `chatDays.ts` `chatSearch.ts` `chatStats.ts` `chatTimeline.ts` `sendDraft.ts` `sendError.ts` `directionDraft.ts` `createCustomerPrefill.ts` `nodeSelect.ts` `langData.ts` `platform.ts` `nav.ts` `device.ts` | 纯展示/纯计算函数，配同名 `.test.ts` |
| `services/viewService.ts` / `viewOverlay.ts` / `msgService.ts` | `window.scrm` 的薄封装 |
| `services/protocol/{client,manager,send}.ts` / `hooks/useProtocolSync.ts` | B27 协议号（type 7）渲染进程直连外部网关：`client` 管 WS（裸 PING/PONG、`{event,data}` 信封、4001–4004 刷 token 重试、4005/4007 硬停）+ REST；`manager` 每账号一连接、把 `WA_MSG_IN_PUSH`/`WA_MSG_STATUS_PUSH` 归一化后分别入 `POST /api/messages/batch` 与 `/api/messages/status`，并暴露 `send()` 出站；`send.ts` + `useSendText` 按 `platformType===7` 把**出站**分流到网关 REST（不经 WebContentsView 桥——协议号无 viewId），复用乐观气泡 + 回声落库流程，回执 `msgKey` 与入站同键去重。纯映射在 `shared/protocol`（含出站编排 `runProtocolSend`）。状态推送无 `chatKey`，由 `manager` 用 `conversationId→peerJid` 映射反查 |

### 5.4 `src/inject` 注入层（打进 `resources/inject.bundle.js`）

| 文件 | 作用 |
|---|---|
| `index.ts` | 入口：按平台选适配器；预置 `window.__SCRM_DESTROY__` 供主进程卸载 |
| `core/BaseInjector.ts` | 生命周期：adapter 初始化、host IPC 装配、挂载、3 秒登录轮询、销毁 |
| `core/PlatformAdapter.ts` | 适配器接口（选择器 + 平台差异） |
| `core/StateManager.ts` | 页内状态：`translationRevision`（推送失效用）、`translatedMsgIds`（去重） |
| `core/translation/messageState.ts` | 消息行的读写状态表 + 节流 |
| `core/translation/domScan.ts` | 扫 DOM 找未翻译消息，按 revision 决定重绘 |
| `core/translation/renderTranslation.ts` | 气泡渲染 |
| `core/translation/bubbleDirection.ts` | 该气泡用哪个语向（与口径②联动） |
| `core/translation/inputPreview.ts` | 发送前输入框译文预览 |
| `core/translation/manualButton.ts` | 手动翻译按钮 |
| `core/translation/translationQueue.ts` | 请求排队与并发控制 |
| `core/editorText.ts` | 往富文本输入框写文本（`execCommand insertText` 路线） |
| `core/featureFlag.ts` | 页内开关 |
| `platforms/whatsapp/{index,selectors}.ts` | WhatsApp 适配器与选择器清单 |
| `platforms/telegram/{index,selectors}.ts` | Telegram 适配器骨架（**未接通**，见 §7） |
| `constants/{channels,config,events}.ts` | 通道名、轮询间隔、事件名 |
| `shared/ui/badge.ts` `utils/event-emitter.ts` `types.ts` | 小组件与工具 |

### 5.5 `src/bridge` 桥（打进 `resources/msg-bridge.bundle.js`）

| 文件 | 作用 |
|---|---|
| `index.ts` | 桥入口，向主进程报 ready、接收命令 |
| `host.ts` | 与 `window.ele` 的收发封装 |
| `types.ts` | 与 `shared/` 对齐的帧类型 |
| `whatsapp/collect.ts` | 会话/消息采集与补底（backfill）；命中群变动系统消息时额外产一条 `group_event`（§10） |
| `whatsapp/normalize.ts` | 原始对象 → `NormalizedMessage`（含 `chatKey`/`msgKey`/方向/媒体类型） |
| `whatsapp/send.ts` | 真实发送：切会话 → 写输入框 → 点发送 → 回 `send_result` |
| `whatsapp/recall.ts` | 撤回执行与 `isRevoked` 判定 |
| `whatsapp/groups.ts` | 群成员采集（§10）：群名单、成员快照（主副两源并集）、`participant_changed` 订阅、群系统消息旁路 |

### 5.6 `src/shared` 两端共用的纯模型

`chatTypes.ts`（帧形状）、`chatKeys.ts`、`chatTime.ts`、`chatStatus.ts`、`chatPlatform.ts`、`liveTail.ts`（尾巴合并 / 乐观行结清 / 状态推进）、`translateKey.ts`、`groupMembers.ts`（群成员的 wire 类型、常量与纯规则：action→event_type、系统消息分类、覆盖率闸）、`theme.ts`（三档主题与落盘）、`badge.ts`（角标口径）、`batchSend.ts`、`machine.ts`，各配 `.test.ts`。这是"渲染层与桥对同一条消息／同一个成员的理解一致"的地方，**node:test 直接跑**。

### 5.7 构建脚本与产物

| 路径 | 作用 |
|---|---|
| `scripts/build-inject.mjs` | esbuild 打 IIFE → `resources/inject.bundle.js`；生产 `minify` + `drop:['console']`，watch 才出 inline sourcemap |
| `scripts/build-bridge.mjs` | 打 `resources/msg-bridge.bundle.js`，并把 `@wppconnect/wa-js` 原样复制成 `resources/wa-js.bundle.js`（体积大、升级节奏不同，所以分两份） |
| `resources/*.bundle.js` | 生成产物，全部在 `.gitignore` 里；`electron-builder.yml` 通过 `extraResources` 带进安装包 |
| `electron.vite.config.ts` | 三入口（main / preload / renderer）构建配置 |
| `tsconfig.{node,web,inject,unit}.json` | 四个 typecheck 面，各自边界不同（页面侧代码不能引 Node API，注入层不能引 Electron API） |

## 六、验证与测试

```bash
# 渲染层/主进程/shared/桥：36 个 test 文件（295 条断言），跑在 node:test 上
cd apps/desktop && pnpm test:unit

# 后端纯函数与适配器：20 个测试类（118 条），跑在真库上
export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18"
cd apps/server && ./mvnw test

# 四个 typecheck 面
cd apps/desktop && pnpm typecheck

# 打包（含 inject/bridge 产物）
cd apps/desktop && pnpm build && pnpm build:win

# B27 协议号通道离线联调（不依赖真实网关，纯 Node 跑通协议接线）
cd apps/desktop && pnpm test:b27
```

约定：

- **`mvn package` 之前先释放 `:8180`**，否则测试期端口占用会给出误导性结果。
- 需要 surefire 输出时不要加 `-q`；建议 `set -o pipefail`。
- 后端 HTTP 契约验证以脚本形式放在 gitignore 的 `tmp/`（约 409 个 `.mjs`），它们是"接口真的按 spec 行为"的实际覆盖面；中文请求体走 UTF-8 文件而非命令行内联。
- **B27 协议号通道离线联调**（`apps/desktop/test/protocol-integration/`）：`pnpm test:b27` 先用 esbuild 把真实的 `services/protocol/manager.ts`（含 `client.ts`）打成 Node 可跑的 ESM，再对接零依赖的 mock 协议网关（`mock-protocol-gateway.mjs`，纯 `node:http`+`crypto` 实现 RFC6455 WS + REST，按协议网关契约模拟 `accesstoken` 鉴权、PING/PONG、4001–4004/4005/4007 关闭码），由 `b27-offline-integration.mjs` 跑通 6 条路径：入站 `WA_MSG_IN_PUSH`→`/api/messages/batch` 入库形状、状态 `WA_MSG_STATUS_PUSH` 用 `conversationId→peerJid` 反查 `chatKey`→`/api/messages/status`、`mgr.send`→`/messages/send` 回执 `msgKey` 与入站同键、PING/PONG 心跳、4001 鉴权失败 `onAuthFailure` 刷 token 后重连、4005 被踢硬停不重连。换真实网关只需把 manager 的 `baseUrl/wsUrl` 指向自托管 `VITE_PROTOCOL_URL`/`VITE_PROTOCOL_WS_URL`，并把 `ingest/applyStatus/getToken/onAuthFailure` 接到真实后端与 auth store。
- 渲染层交互验证通过 CDP，且**窗口必须抬起、`visibilityState==='visible'`**，事件用真实 `Input.dispatchMouseEvent` / `dispatchKeyEvent` / `insertText`，不用 `element.click()`。
- 已交付结论：`docs/notes/2026-09-20-p6-chat-history-verification.md`（P6 端到端验收）、`docs/superpowers/specs/2026-09-19-translation-center-design.md` §6.3（翻译页内链路）。

## 七、已知限制与未实现（读代码看不出、但会踩的）

1. **Telegram 采集/发送链未实现**。`inject/platforms/telegram/` 有骨架，但没有真机 DOM 探针与端到端验证；`chat_key` 的 TG 形态在 `V8__chat_history.sql:17` 注释里已定义（数字 chat id），后端 `platform` 白名单也已含 `telegram`（`MessageQueryService.java:43`）。**能在页面里打开 TG、能看到翻译气泡以外的能力都还没验过。**
2. **删除平台账号会级联删除其全部聊天记录**（`V8__chat_history.sql:30/59`），而侧栏删除按钮没有二次确认。归档不可再生，动手前先导出或改状态位。
3. **聊天消息与客户没有外键关系**：`chat_conversation.customer_id`（`V8__chat_history.sql:20`）无 FK，删客户后会话头会悬空，客户抽屉时间线就再也打不开。
4. **词典改动需重启后端**：`PhraseDict` 只在首次访问时加载且不失效（`service/PhraseDict.java:51-70`），且没有词典管理端点。
5. **全局搜索是 `body LIKE '%q%'`**（`MessageQueryService.java:190`），没有可用索引。消息量上来后要换 FULLTEXT/ngram。
6. **打包态未验证**：开发态渲染层跑在 `http://localhost`，打包后是 `file://`（`mainWindow.ts:66`），而后端 CORS 允许的是 `http://localhost:*`、`http://127.0.0.1:*`、`file://*`（`SecurityConfig.java:64`）。`file://` 文档发出的 `Origin` 实际是 `null`，因此推断打包版会被 CORS 挡住——**这一步没跑过，接手时优先验**。
7. **只有认证，没有授权**：全仓没有 `@PreAuthorize`/`hasRole`，`role` 只签发不参与判定。隔离维度只有 `tenant_id`。
8. **后端没有请求级日志**：应用代码只打 2 条 `log.info`（都在 `DataSeeder`），`GlobalExceptionHandler` 不带 logger 且会把异常栈吞掉（`common/GlobalExceptionHandler.java:25-28`）。运行期能看到的是 MyBatis 的 DEBUG SQL（`application.yml:33-35`）——有"查了什么"，没有"哪次请求失败/慢了"。排障要自己加日志或看库。
9. **页面侧产物在生产构建里 `drop:['console']`**（`build-inject.mjs:27`、`build-bridge.mjs:35`），注入层内部异常既不上屏也不留痕。
10. **腾讯翻译线路未做端到端验证**，延期记录在 `docs/notes/2026-09-20-tencent-online-translation-deferred.md`。
11. 内部比较材料（含商业项目的行级引用）一律不入库，只在本地留档，也不写进本文件与其他文档。
12. **B27 协议号网关契约**（2026-10-02 核定，详见 `docs/superpowers/specs/` 与 `shared/protocol/`）：WS 帧是 `{event,data}` 信封（非 `{type,...}`）；PING/PONG 是裸 socket 字符串（非 JSON）；`accesstoken` 走 query（Bearer 前缀已剥离）；`WA_MSG_IN_PUSH.data` 字段为 `peerJid`/`messageId`/`from`/`msgType`/`content.text`/`waTimestamp`/`wpMsgId`/`clientMsgId`/`status`，`WA_MSG_STATUS_PUSH` 仅含 `conversationId`+`messageId`（无 `chatKey`，由 `manager` 维护 `conversationId→peerJid` 映射反查）；状态用 0–6 数字码。关闭码：4001–4004 = 刷新 token 后重试（**非**永久停），4005/4007 = 被踢/被封硬停不重连。账号导入走 `importAccounts`、连接走 `connectAccounts`。**出站编排 `runProtocolSend`（纯函数，node 单测覆盖）已落 `shared/protocol/map.ts`**：调用网关 `/messages/send` 取回 `msgKey`（优先级 `messageId ?? wpMsgId ?? clientMsgId`，与入站 `normalizeInbound` 同键去重），回执形状与网页 WA 桥一致，供 `useSendText` 复用 `outcomeOf`。未联调自托管网关（无测试号），联调收不到消息时优先核对：① 网关实际 WS 地址/路径；② `accesstoken` 是否仍需 Bearer 剥离；③ 状态推送是否仍只带 `conversationId`；④ `/messages/send` 响应字段名是否与 `ProtocolSendResponse` 一致（不一致改 `map.ts` 一处即可）。

## 八、下一步在做什么

任务队列视角（详见 `docs/feature-checklist.md` 与 `docs/feature-backlog.md`）：

- **P8 群成员分析（B6）收尾**：主进程建档泵（4a）与导出（4b，exceljs 14 列 XLSX + `group:export` IPC）已通电；切面 5 渲染层已装到界面——客户抽屉「所在群」节（`CustomerGroupsSection`，含账号下拉、勾选与「导出所选」）与群成员弹层（`GroupMembersDialog`，两个 tab、三档筛选、「刷新成员」/「导出本群」）。**尚未声称界面可用**：判档只到编译，真读出数要等 CDP 界面腿 20 条（5c）。见 §10
- TG 链：真机 DOM 探针 → 注入层选择器 → 采集 → 发送（卡在"本机无 TG 账号"，外部阻塞）
- **B27 WhatsApp 协议号通道（入站 + 出站链路已通电）**：`chatPlatform.ts` + `ChatKeys.java` 先把 `platform_type=7` 映射成 `whatsapp` 形态（B27 入站识别层，commit `84cca2d`）；渲染层 `services/protocol`（`client.ts`/`manager.ts`/`send.ts`）+ `hooks/useProtocolSync.ts` 采用「渲染进程直连协议网关」形态——登录态下为每个 type-7 账号起一个原生 `WebSocket` 直连**部署方自托管的协议网关**（`VITE_PROTOCOL_WS_URL` 注入，开源版不内置商业云端点；`?accesstoken=` 鉴权、30s PING/PONG、4001–4004 关闭码刷 token 重试、4005/4007 硬停、指数退避重连），`WA_MSG_IN_PUSH` 经 `shared/protocol/map.ts` 归一化后 `POST /api/messages/batch`、`WA_MSG_STATUS_PUSH` 走 `/api/messages/status`，复用网页 WA 入库面。**出站腿已通电**：type-7 账号的发送在渲染层 `useSendText` 按 `platformType===7` 分流到协议网关 REST（不经 WebContentsView 桥——协议号无 `viewId`，`msgBridge.sendText` 会因 `viewId` 空返 `BRIDGE_OFFLINE`），`manager.send` 经 `send.ts` 调网关 `/messages/send`，回执 `msgKey` 与入站同键去重，复用乐观气泡 + 网关回声落库流程，UI 成败靠 `sendError.outcomeOf` 同构处理。走廊台仍依赖部署方自托管 protocol 服务（P16 外部阻塞），真机联调待自托管网关 + 测试号；但协议接线已用离线联调 harness 验证（`pnpm test:b27`，6/6 通过：入站入库、状态反查、出站同键回执、PING/PONG、4001 重连、4005 硬停）。`createCustomerPrefill` 已修复 type-7 客户回写被 `accountTypeOfPlatform` 错标成 1 的坑（现透传原始 `platformType`）。网关鉴权与字段 schema 见 §7 第 12 条。
- **壳层补强 A16–A19（2026-10-03 入册）**：补的是既有清单里没有落点的四项——**A16 角色 RBAC + 菜单权限树**（P13，排在 B22 之后；§7 第 7 条「只有认证没有授权」正是这一行）、**A17 桌面系统通知**（P14 可提前；OS 弹窗，不是 A10 的站内列表，**已交付** commit `27062f2`）、**A18 GPU 崩溃降级 + 硬件加速/DPI 开关**（P14 可提前；A7 只管监控，不管崩溃自愈，**已交付**：`--gpu-safe-mode` 自动重启降级 + 持久化 + 一键重试 + 硬件加速开关 + DPI 同步全部视图，设计见 `docs/superpowers/specs/2026-10-03-gpu-fallback-design.md`）、**A19 分类日志落盘 + 日志中心**（P14 可提前；只落本地，不做遥测外传，**已交付**：console 接管按 `[tag]` 归四类 + 未处理 Promise 拒绝捕获 + 内存环/按天批量落盘 + IPC 调用记录 + `/logs` 日志中心页，设计见 `docs/superpowers/specs/2026-10-03-log-center-design.md`）。A17/A18/A19 全在主进程与壳层，不碰业务面、不依赖外部服务，可插队。另有一批「行已有但字面写窄」的项（B28 缺转人工/接管队列/文档实体/人设助手、B24 首页另有三块卡片、B12 缺配额可视化等七行）已写成清单里的「B 档范围提示」，不新增编号。「每日养号 plan runner」未入册——形态依赖云端下发，属裁定问题。
- **A9 修改密码（2026-10-03 已交付）**：设置页新增「账户安全」卡，后端 `POST /api/auth/change-password`（`ChangePasswordRequest` record + `AuthService.changePassword` 校验原密码 / 新旧不可相同 + 重写哈希）+ 前端 `api/auth.ts` 与表单（原/新/确认 + 可见性切换 + 长度与一致性前端校验）；改密成功 `useAuthStore.logout()` 清掉本机会话、`App` 在 `phase==='anonymous'` 自动渲染登录页实现强制重登。未做 tokenVersion 失效机制（保持无状态 JWT 架构），设计见 `docs/superpowers/specs/2026-10-03-change-password-design.md`。
- **A4 多语言框架（已交付）**：`i18next` + `react-i18next` 接入主进程 `AppSettings.language`（落盘 + 启动读回），渲染层 `i18n` 实例 + 8 语种全量资源（`zh-CN`/`en`/`zh-TW`/`ja`/`ko`/`vi`/`id`/`th`，均在 `i18n/index.ts` 的 `resources` 注册生效），设置页「语言」卡一键切换即时生效；设计见 `docs/superpowers/specs/2026-10-03-i18n-design.md`。按业务域分批铺开 `t()` 抽取：**壳层**（设置/导航/登录/日志中心/标题栏/占位页）→ **messages 域**（10 组件）→ **customers 域**（客户列表/抽屉/时间线/所在群/群成员弹层 5 组件）；每个语种文件用 `DeepString<typeof zhCN>` 强制键同构，漏翻/多翻/层级错编译期即挂（漏键一处 typecheck 全红）。广播/其余页面域待续。
  - **覆盖面铺开**：`messages` 域 10 个组件（`MessagesPage` / `ConversationList` / `ConversationActions` / `ReplyComposer` / `MessageThread` / `SearchPanel` / `StatsCards` / `CreateCustomerDialog` / `CustomerDirectionDialog` / `MessageBubble`）的中文 UI 文案已抽 `t()`，`zh-CN.ts` 新增 `messages` 子树、`en.ts` 由 `DeepString<typeof zhCN>` 强制补齐同构英译；`customers` / `broadcast` 已抽 t()，其余页面与布局组件后续分批铺开。
- 体检文档 §12 列出的优先级修复项（删除确认、`apiBase` allowlist、采集重试停摆、`nickname` 清空、`refresh` 复查租户状态）

## 九、提交约定

- 每完成并验证一个功能点提交一次，前缀 `feat:` / `fix:` / `refa:` / `update:`，模块可带 scope（如 `feat(P6): ...`）。
- 一个任务一个提交，由**完成验证的那个人**提交。
- 提交后不推送，推送由维护者手动执行。
- 文档/注释/spec 只描述本项目的设计，不与其他实现做对比。


## 十、P8 群成员分析（B6）的核心口径

设计文档：`docs/superpowers/specs/2026-09-30-group-member-analysis-design.md`；
计划：`docs/superpowers/plans/2026-09-30-group-member-analysis.md`。

一句话形状：**快照定"谁在群里"，事件定"什么时候、被谁"**。
这两件事在库里就是分开的两张表（`group_member_state` / `group_member_event`），
读的时候不许互相补位——快照给不出进群时间，事件说不清此刻谁还在。

三条最容易写错的规则：

1. **`latest_join_at` 与 `first_seen_at` 必须分列。** 快照建档的人没有进群时间证据，
   把建档时刻写进 `latest_join_at` 就是造一条查不出来源的假记录。
2. **推定退群不写退群时间。** 快照只能证明"这一刻不在名单里"，证明不了何时走的，
   所以 `exit_method='snapshot_absent'` 的行 `latest_leave_at` 恒为 NULL；
   只有 `left`/`removed` **事件**才写它。界面上这两者要区分显示。
3. **覆盖率闸的分母只被"闸放行的快照"覆盖。** 被拦下的截断快照不配叫成功快照——
   拿它的 4 人覆盖原本 10 人的分母后，下次覆盖率变成"人数/4"，一个 10 人群回 4 人会得到 1.0，
   闸从此永久失效。代价是群真的缩员会被一直拦着（spec §2#3 明写接受）。

后端 ingest 三步同一事务：**群登记 → 事件先行 → 快照收口**。顺序不能反——
反过来先跑快照，一条迟到的退群事件会被上次快照的在场结论盖回去。

两处**待实测**（代码里已标注释，拿到真机样本前都是推断）：
群变动系统消息的 `subtype` 与目标人字段形态（spec §15#1）；
`getParticipants()` 对超大群是否分页截断（spec §15#3，这是最危险的一条）。

**进度（截至 2026-10-02）**：切面 1–4 全部交付——
`engine.ts`（纯编排）+ `registry.ts`（reqId 未决表）+ `api.ts`（POST `/api/group-members/batch`）
+ `dispatch.ts`（命令→视图→回执）+ `host.ts`（`runBuild` 每账号去重、等整轮、广播 `group:state`）
+ `export.ts`（14 列 XLSX，六档结论）+ `group:build` / `group:export` 两条 IPC 与 `window.scrm.group.{build,export,onState}`。
切面 5 渲染层已装到界面：`api/groupMembers.ts`（五个 hook + `groupKeys`）、`lib/groupDisplay.ts`（§8 文案纯函数，18 条单测）、
`components/ui/tabs.tsx`、`components/customers/CustomerGroupsSection.tsx`（抽屉「所在群」，账号下拉 + 勾选 + 导出所选）、
`components/customers/GroupMembersDialog.tsx`（两个 tab、三档筛选、刷新成员 / 导出本群）。
切面 5c **已通过**：CDP 复检脚本 `tmp/cdp-recheck.mjs` 强刷清缓存后开抽屉，断言 `[data-p8g-group-row]` 渲染 1 行群、
捕获 `GET /api/group-members/customer/45/groups?accountId=7` 返回 200 且 body 含真实群数据（台账见 `docs/notes/2026-10-02-b6-5c-acceptance.md`）。
**界面已证明真读到数**（客户 45 / P7CDP-muich5th-7 可见群「验收测试群-跨境电商交流」）。
事件攒批器已落地（Task 10）：`collector.ts` 的 `EventCollectorHub` 已建，6 条单测全过——长度闸（CHAT_KEY/MEMBER/DEDUP/BODY）、
越界丢最旧并计 `dropped`、投失败退避重试且退回队首不丢数据、跨账号拆分（POST /batch 一次一个 accountId）均覆盖；
`shared/groupMembers.ts` 补齐 `EVENT_BATCH_SIZE` / `EVENT_BATCH_INTERVAL_MS` / `EVENT_QUEUE_MAX` / `CHAT_KEY_MAX` / `MEMBER_KEY_MAX` / `DEDUP_KEY_MAX` / `GROUP_BODY_MAX`（数字照 V12 列宽）。

**采集管线已闭环（Task 12 + 8b，截至 2026-10-02）**：`group_event` 帧不再是死代码——
1. **桥侧路由**：`msgBridge/index.ts` 导出 `GroupBridgeHooks`（`onFrame` / `onReady` / `onViewDown`）与 `setGroupHooks`，
   `handleBridgeReport` 新增 `group_event` 分支转交 host 攒批；`mountOne` 握手成功后调 `onReady`（每账号只触发一次自动建档，去重在 host），
   `broadcastState` 掉线分支调 `onViewDown`。
2. **宿主接线**：`host.ts` 持有 `EventCollectorHub`（flush → `groupApi.ingest` 只带 events 段），`onFrame` 把事件 push 进攒批器，
   `onReady` 经 `autoBuilt` Set 每账号跑一次 `runBuild`，`onViewDown` 调 `registry.failView` 只结清该视图未决的群回执（不连坐别的账号在跑的建档）；
   新增 `startGroupHost()` / `stopGroupHost()` 在 `main/index.ts` 与 `startMsgBridge/stopMsgBridge` 同生命周期启停。
3. **registry 收窄**：`registry.ts` 的 `Pending` 增加 `viewId`，`addPending` 签名加 `viewId`，新增 `failView(viewId)`（只清指定视图），
   既有 `failAllPending` 行为不变；`dispatch.ts` 同步传 `viewId`；`registry.test.ts` 同步 + 新增 `failView` 隔离性单测。
4. **8b 校准**：后端 `GroupMemberController` 的 `members` 接口 `coverage` 为 null 时返回 `null`（不再折成空串，前端 `coverage: number | null` 拿到首次建档信号）；
   `customerGroups` 新增 `@RequestParam(required=false) Long accountId`，透传到 `GroupMemberQueryService.customerGroups(tenantId, accountId, customerId)`，
   按 `accountId` 收窄「所在群」匹配（byCustomer 与 byPhone 两路都加 `eq(accountId)`），`accountId` 为 null 时退化为旧行为。
   验证：桌面侧 `test:unit` 349 全过、`typecheck`（node/web/inject/unit 四路）全过、`eslint --quiet` 零输出；后端 `./mvnw -o compile` 通过。
5. **`unmountView` 补丁（闭环收尾）**：视图彻底销毁时主动调 `groupHooks?.onViewDown(viewId)` 结清该视图未决群回执，覆盖「destroyed 视图」这一格（原先只靠引擎 dispatch 超时兜底）。
   端到端验证：对 8180 跑 `POST /api/group-members/batch`（只带 events 段，等价于 `EventCollectorHub.flush` 的载荷）→ 返回 `eventsInserted:1`、事件计数 +1、events 接口读回命中。群事件后端落库链路 OK。

**桌面 lint 存量清零（2026-10-02 起）**：`apps/desktop` 全量 `eslint` 曾因 gitignore 构建产物刷爆 formatter 而崩溃，先以 `eslint.config.mjs` 的 ignores（`**/*.bundle.js`、`**/tmp/**`）根治；
随后用 TS 编译器 API codemod 补 107 处 `explicit-function-return-type`（构建脚本目录单独关该规则）。存量 error 由 144 收敛至 37 后分两批清零：
- 机械可修批（37→13，commit d26cb76）：`no-unused-vars` 加 `argsIgnorePattern`/`varsIgnorePattern '^_'`，忽略接口/回调里 `_` 前缀的未用参数；
  测试文件关 `no-empty-function`（mock/stub 空方法体属正常写法）；inject 的 `any` 改 `unknown`；`badge`/`button` 组件文件不再导出 cva 变体常量（满足 react-refresh only-export-components）。
- 剩余 13 个均为 react-hooks 规则，需逐个重构而非加注解，分两批清零：
  - **H1（refs / immutability / static-components，13→5）**：把"渲染期给 `ref.current` 同步赋值"移入 `useEffect`（`loginStatusSync.ts` 的 `accountsRef`/`mutateRef`、`useWebContentsView.ts` 的 `boundsRef`）；
    `CustomersPage` 在各筛选 handler 加 `setPage(1)` 并给 `CustomerDrawer` 加 `key` 触发重挂载、`CustomerDrawer` 表单改用挂载初值替代打开即铺表的 effect；
    `MaterialsPage` 内联 `Film`/`Music`/`FileText` 取代渲染期 `const Icon = typeIcon(type)`（修复 static-components）。剩余 5 个均为 `set-state-in-effect`，进行中。
  - **H2（set-state-in-effect，5→0）**：弹层/对话框改用"挂载初值 + `key` 重挂载"替代"打开即铺表"的 effect。
    `CreateCustomerDialog` 表单用 `prefill` 挂载初值、外层 `ConversationActions` 用 `key={String(createOpen)}` 重挂载清空错误态；
    `CustomerDirectionDialog`/`ConversationSettingsDialog` 拆出内层 `DirectionForm`/`ConvSettingsForm`，`data` 到达才挂载、关闭时清错误态；
    `MessagesPage` 改用 `useChatJumpStore.subscribe` 消费一次性跳转投递（外部系统回调里 setState，规则允许）；
    `TranslationPage` 删主 draft 回填 effect、`ProviderKeyForm` 改用 `credential?.appId ?? ''` 挂载初值并换 `key` 触发重初始化。
    **全部清零**：`eslint --quiet` 0 error；`typecheck`（node/web/inject/unit 四路）全过；`test:unit` 371/371。
