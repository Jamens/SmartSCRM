# SmartSCRM

Electron + React + TypeScript 桌面 SCRM 客户端，配 Spring Boot + MySQL 后端。
本文件说明**项目架构**与**每个文件的作用**，供接手的人继续开发或自查。英文版本见 [README.en.md](./README.en.md)。

- 当前分支：`main`
- 已交付范围：P0 骨架 → P1 登录/窗口壳 → P2 平台账号与内嵌页 → P3 客户域 → P4 素材库/快捷回复 → P5 翻译中心 → P6 聊天记录
- 未交付：Telegram 采集/发送链、批量群发、群分析、话术引擎、代理指纹、云手机、报表、设置页、i18n
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

# 1) 起后端（Flyway 自动跑 V1..V8 建表，DataSeeder 播种子账号）
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
| `whatsapp/collect.ts` | 会话/消息采集与补底（backfill） |
| `whatsapp/normalize.ts` | 原始对象 → `NormalizedMessage`（含 `chatKey`/`msgKey`/方向/媒体类型） |
| `whatsapp/send.ts` | 真实发送：切会话 → 写输入框 → 点发送 → 回 `send_result` |

### 5.6 `src/shared` 两端共用的纯模型

`chatTypes.ts`（帧形状）、`chatKeys.ts`、`chatTime.ts`、`chatStatus.ts`、`chatPlatform.ts`、`liveTail.ts`（尾巴合并 / 乐观行结清 / 状态推进）、`translateKey.ts`，各配 `.test.ts`。这是"渲染层与桥对同一条消息的理解一致"的地方，**node:test 直接跑**。

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
# 渲染层/主进程/shared/桥：22 个 test 文件，跑在 node:test 上
cd apps/desktop && pnpm test:unit

# 后端纯函数与适配器：10 个测试类
export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18"
cd apps/server && ./mvnw test

# 四个 typecheck 面
cd apps/desktop && pnpm typecheck

# 打包（含 inject/bridge 产物）
cd apps/desktop && pnpm build && pnpm build:win
```

约定：

- **`mvn package` 之前先释放 `:8180`**，否则测试期端口占用会给出误导性结果。
- 需要 surefire 输出时不要加 `-q`；建议 `set -o pipefail`。
- 后端 HTTP 契约验证以脚本形式放在 gitignore 的 `tmp/`（约 409 个 `.mjs`），它们是"接口真的按 spec 行为"的实际覆盖面；中文请求体走 UTF-8 文件而非命令行内联。
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
11. `docs/notes/2026-09-22-legacy-feature-gap.md`（旧版功能差距表）**刻意不入库**，本地文档。

## 八、下一步在做什么

任务队列视角（详见 `docs/feature-checklist.md`）：

- P6 收尾：任务栏未读角标、设置页（含主题切换、设备信息一节）
- TG 链：真机 DOM 探针 → 注入层选择器 → 采集 → 发送
- 体检文档 §12 列出的优先级修复项（删除确认、`apiBase` allowlist、采集重试停摆、`nickname` 清空、`refresh` 复查租户状态）

## 九、提交约定

- 每完成并验证一个功能点提交一次，前缀 `feat:` / `fix:` / `refa:` / `update:`，模块可带 scope（如 `feat(P6): ...`）。
- 一个任务一个提交，由**完成验证的那个人**提交。
- 提交后不推送，推送由维护者手动执行。
- 文档/注释/spec 只描述本项目的设计，不与其他实现做对比。
