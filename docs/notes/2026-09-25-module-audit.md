# SmartSCRM 模块体检文档（P0–P6 已交付面）

**基准提交**：`312f014`（branch `main`）
**取证方式**：深读代码 + 行级取证。文档里每一条风险/指标都带 `文件:行`，可点回原处核对。
**覆盖范围**：P0 骨架、P1 登录/窗口壳、P2a 平台账号 + 内嵌视图、P2b 注入层 + 桥、P3 客户域、P4 素材库 + 快捷回复、P5 翻译中心、P6 聊天记录。
**不在范围**：Telegram 采集/发送链（Task 12a–12d 未实现）、P7+（批量群发、群分析、话术引擎、代理指纹、云手机、报表、设置页、i18n）。

## 0. 怎么读这份文档

四种标记，含义严格区分，不要混用：

| 标记 | 含义 |
|---|---|
| **实测** | 本项目跑过、有可复跑脚本或验收记录支撑（脚本在 gitignore 的 `tmp/`，结论在 `docs/notes/`） |
| **读码** | 从当前代码/SQL 直接读出，无需运行即可确认的事实 |
| **推断** | 由读码推出的后果，但没在对应环境跑过（典型：打包态、高并发态、真机第三方） |
| **待验证** | 需要人工或真机动作才能判定，本窗口没有做 |

风险分级：**高**＝会造成不可逆数据后果或安全后果；**中**＝会造成用户可见故障或配额损失；**低**＝工程质量问题，不影响正确性。

自检顺序建议：先跑 §9 的十分钟基线包（typecheck + 单测 + 后端测试 + 健康检查），再看 §10 的症状速查表定位症状落在哪条链，最后回到对应模块章节看风险条目。

---

## 1. 横切层（不属于任何单一模块，但所有模块都依赖）

### 1.1 预期功能达成

后端以 `ApiResponse{code,message,data}` 统一信封，`code==0` 才算成功；异常经 `GlobalExceptionHandler` 收敛（`common/GlobalExceptionHandler.java:11/16/25`）；安全面默认拒绝，只有 `/api/auth/login`、`/api/auth/refresh`、`/api/health` 放行（`config/SecurityConfig.java:43-44`），会话无状态（`:41`），未登录统一回 `40100 未登录或登录已过期`（`:49`）。**达成**：任意端点不带 token 都是 401；租户隔离靠 `AuthPrincipal.tenantId()` 在每个 service 手写 `eq(tenantId)` 落实。

### 1.2 逻辑链：一次渲染层请求

```
renderer/lib/http.ts:60  fetch(API_BASE+path, Authorization: Bearer <access>)
  ├─ 网络异常 → ApiError 50001（http.ts:66）
  ├─ 401 且非 /api/auth/ → tokens.refresh() → 成功则重放一次 → 失败则 40100（http.ts:69-74）
  └─ 200 但 code!=0 → ApiError(message, code)（http.ts:81-83，服务端中文文案原样透出）
```

主进程侧另有一条平行链：`services/authedFetch.ts:80`，带 5 秒超时（`:4`、`:30`、`:65`）。**两条链语义不等价**，见风险 R-01。

### 1.3 隐藏风险

**R-01（中）渲染层 HTTP 无超时，主进程有。** `renderer/src/lib/http.ts:60` 的 `fetch` 没有 `AbortSignal`，而 `main/services/authedFetch.ts:4` 定义了 `REQUEST_TIMEOUT_MS = 5000` 并在 `:30`/`:65` 使用。后端 hang 住（连接建立但不返回）时，页面侧的请求永远不 settle：记录页停在转圈，且 `refreshPromise`（`http.ts:34`）不会被清理路径触发。**实测过的是"后端没起"这一支**——那走 `catch` 回 50001，能正常报错；hang 住这一支没跑过。

**R-02（高，推断）打包态渲染层大概率被 CORS 挡住。** 打包后渲染层走 `file://`（`main/window/mainWindow.ts:66` `loadFile`，且 `:44` 明确 `webSecurity: true`），此时 Chromium 发出的 `Origin` 是 `null`；`SecurityConfig.java:64` 的允许列表是 `http://localhost:*`、`http://127.0.0.1:*`、`file://*`，预检必然不匹配。**全仓没有第二处 `webSecurity`**（已 grep），也没有 `registerSchemesAsPrivileged`。开发态走 `ELECTRON_RENDERER_URL`（`mainWindow.ts:64`）所以从未暴露。**未打包验证过，判定为推断**——修复方向是把 `null` 放进 allowedOriginPatterns，或改用自定义协议。

**R-03（中）后端地址在四处分别硬编码。** `renderer/src/lib/http.ts:1`（`VITE_API_BASE` 可覆盖）、`main/services/authedFetch.ts:3`、`main/services/msgBridge/msgApi.ts:29`（后两处纯字面量，无覆盖入口）。仓内没有 `.env*` 文件（已 `ls`）。换后端主机时只有渲染层那条链可配，主进程采集投递链会静默打到 localhost。

**R-04（低，实测）签名有效但 schema 过期的 token 会被吞成"未登录"。** `security/JwtAuthFilter.java:33-35` 依次做 `Long.valueOf(claims.getSubject())`、`claims.get("tid",Number.class).longValue()`、`role.toUpperCase()`，整个 `doFilterInternal`（`:28-42`）没有 try/catch。实测：用同一密钥签发、缺 `tid` 的 access token 打 `GET /api/customers` → **`401` + `{"code":40100,"message":"未登录或登录已过期"}`**，`tmp/p6-backend.log:12400` 有 `NullPointerException ... JwtAuthFilter.java:34` 的完整栈；`sub="not-a-number"` 那发同样只回 `401`，栈在 `:12473`。**本条最初的推断（"客户端拿到裸 500、且没有任何日志"）被这两次实测否掉了**：栈是有的（容器 `dispatcherServlet` 打的 ERROR），状态码也不是 500——异常从 servlet 抛出后转发到 `/error`，而 Spring Boot 默认让 `ERROR` dispatch 也过安全链，未认证的 `/error` 命中 `SecurityConfig.java:45-49` 的 entry point，于是套上了 401 信封（这一层机制解释是推断，观测结果不是）。剩下的真问题是**语义塌陷**：token schema 不匹配这类服务端 bug，在客户端与"登录过期"完全同形，UI 只会安静地把人踢回登录页，重试不会好。修复：过滤器内 try/catch，回一个可区分的 code 并记一行 WARN。**复跑取证：§9.1。**

**R-05（中）`refresh()` 不复查租户状态，且租户缺失会 NPE。** `service/AuthService.java:43` 登录时校验 `tenant.getStatus()!=1`；`refresh()` 在 `:63-77` 只校验 `user.getStatus()!=1`（`:70`），`:73` 取到的 `tenant` 没有非空判断就在 `:74` 解引用。实测过其中一支：签名有效、`sub` 指向不存在用户的 refresh token 打 `POST /api/auth/refresh`，回 `401 {"code":40100,"message":"账号不可用"}`（`:70` 的守卫是有效的）。**没跑的两支是**：租户被停用后仍能续期（access token 未过期期间可继续访问全部端点，授权只看 `JwtAuthFilter`，不查库）、以及用户行指向不存在的租户时 `:74` 抛 NPE——两者都要改 `tenant`/`app_user` 行才能触发，本窗口按约定不动数据，判为**读码**。

**R-06（低）鉴权完整、授权缺失。** 全仓 **0** 处 `@PreAuthorize|hasRole|hasAuthority|@Secured`（已 grep）。`role` 被签发（`security/JwtService.java:50`）、被解析（`JwtAuthFilter.java:35`）、被回给 UI，但从不参与判定。当前唯一隔离维度是 `tenant_id`。这不是漏洞（P0–P6 没有角色语义），但它是"看起来有角色模型"的陷阱：任何人按 `ROLE_AGENT` 写权限判断前，要先知道那一层根本不存在。

**R-07（中）JWT 密钥是仓内字面量。** `resources/application.yml:29` 直接写死 `smartscrm-local-dev-secret-key-please-change-32bytes-min`，虽然 `JwtService.java:22` 用了 `@Value("${app.jwt.secret}")` 可以外部覆盖，但默认值就是可伪造租户 token 的那把钥匙。本地工程可接受，任何对外部署前必须换。

**R-08（低）`GlobalExceptionHandler` 吞掉异常栈。** `common/GlobalExceptionHandler.java:25-28` 捕获所有 `Exception` 并把 `e.getMessage()` 拼进响应体，**整个类没有 logger**（已读完整文件，29 行）。对照实测（R-04 那一轮）：过滤器里抛的异常因为**没有**被这个 advice 接管，反而在日志里留下了完整栈（容器 `dispatcherServlet` 的 ERROR，`tmp/p6-backend.log:12400/12473`）；而那一轮的后端日志里 ERROR 级只有那 2 条——**经过程序内 `Exception` 处理链的失败，一条记录都不留**（判据见 §9.1 末尾的 ERROR 计数：接口明明在返 5xx，计数却不动）。后果双输：运维拿不到 Controller/Service 层的栈，客户端拿到了可能含 SQL/表名的原始报错文本。

**R-09（低）会话文件读失败等同"从未登录"。** `main/state/session.ts:38-49` 的 `getSession()` 用 `catch { return null }` 兜住一切；`:30-36` 在 `safeStorage.isEncryptionAvailable()` 为假时静默写明文。换机器/重装系统后旧文件不可解密时，用户表现为"莫名其妙掉登录"，且无日志区分两种成因。

**R-10（低）设备绑定只写不读。** `AuthService.java:56` 每次登录 `bindDevice`，但请求路径上没有任何一处校验 `deviceId`——它是登记表，不是门禁。这与 P0–P6 的设计一致（无文档冲突），但接手的人容易误以为它有防护作用。

### 1.4 可优化 / 精简

- **错误日志**：`GlobalExceptionHandler` 加 `log.error("未处理异常", e)` 并把响应文案固定成不含 `e.getMessage()`；`JwtAuthFilter` 把 claims 解析包在 try 里，失败即不设置认证（走既有 401 分支）。
- **超时统一**：`http.ts:60` 补 `signal: AbortSignal.timeout(...)`，与 `authedFetch.ts:4` 同一个常量语义。
- **配置收口**：`authedFetch.ts:3` 与 `msgApi.ts:29` 的默认值合并到一个入口，`VITE_API_BASE` 之外再给主进程一条 env/设置项。
- **`resolveBase` 无 allowlist**（`authedFetch.ts:13`）：见 §4.3 的 R-24（内嵌页信任边界），与它一起处理。

### 1.5 可观测指标

当前后端**应用代码里的日志只有 2 条**，都在种子里（`config/DataSeeder.java:31`、`:50`；grep 全仓 `log.info|log.warn|log.error` 只此两处）。运行期能看到的信息几乎全部来自**框架**而不是本项目：`application.yml:33-35` 把 `com.smartscrm` 开到 `debug`，于是 MyBatis 会打出每条 SQL、绑定参数与命中行数——本轮实测就是靠日志里的 `AppUserMapper.selectById : Parameters: 999999 / Total: 0` 确认刷新接口走的是"用户不存在"分支（`AuthService.java:70`）。代价是体量：一次开发会话的 `tmp/p6-backend.log` 有 12543 行，其中 ERROR 只有 2 条（都是 R-04 那两次探针）。⇒ **有"查了什么"，没有"哪次请求失败或慢了"**。可依赖的面：

| 指标 | 来源 | 状态 |
|---|---|---|
| 服务存活 | `GET /api/health`（`web/HealthController.java`），`SecurityConfig.java:43` 放行 | 可用 |
| 请求是否被认证拦住 | 401 响应体固定 `code:40100`（`SecurityConfig.java:45-49`） | 可用 |
| 业务失败原因 | `code!=0` + 中文 `message` | 可用 |
| 每条 SQL 与命中行数 | MyBatis DEBUG（`application.yml:33-35`） | 可用，但默认只在 debug 档 |
| 5xx 根因 | 经 `GlobalExceptionHandler` 的异常不留栈；只有逃出到容器那一层的抛出才有 ERROR（R-04 实测） | **半缺** |
| 慢查询/连接池 | 无（未开 HikariCP 指标，未引入 actuator） | **缺** |
| 谁在什么时候伪造/滥用 token | 无审计日志 | **缺** |

---

## 2. P1 登录 + 窗口壳

### 2.1 预期功能达成

邀请码定位租户 → 用户名密码校验（BCrypt）→ 设备登记 → 双 token 下发 → 渲染层存会话并自启恢复。**达成**，且密码错误/用户不存在回同一句话（`AuthService.java:50`）不泄露账号存在性。

### 2.2 逻辑链：token 生命周期

```
LoginPage → POST /api/auth/login → {accessToken, refresh, expiresIn, user}
  → stores/auth.ts:26-28  window.scrm.session.save  →（主进程）session.ts:30-36  safeStorage 加密落盘
下次启动 → auth.ts:40-41  boot → session.get → 内存里有 access 即用
access 过期 → 任一请求 401 → http.ts:69-74 → tokens.refresh() → POST /api/auth/refresh → 重放一次
```

**关键事实：token 不进 localStorage**（`auth.ts:26-28` 只走 `window.scrm`），注入到第三方页面的脚本拿不到它——`preload/view.ts:8-24` 只暴露 `window.ele` 的四个方法，`ipc.ts:103` 的 `apiBase` 是唯一从注入配置读出的值。

### 2.3 隐藏风险

**R-11（中）刷新令牌无并发去重跨 base、无吊销。** `main/services/authedFetch.ts:11` 的 `let refreshing` 是单槽且不带 `base` 维度；`renderer/lib/http.ts:34-49` 的 `refreshPromise` 同样单槽。两端各自去重，彼此不知道对方在刷新——一个刚被 rotate 的 refresh token 可能被另一路并发请求重复使用。更本质的是**服务端没有 refresh 吊销表/黑名单**（`AuthService.java:63-77` 只签发不记录），所以 30 天 TTL（`application.yml:31`）内任何一份泄露的 refresh 串都能换新 access。

**R-12（低）登录无失败限速。** `AuthService.java:37-61` 没有任何计数/锁定，字典攻击只受网络带宽限制。

### 2.4 可优化 / 精简

`session.ts` 的两种失败（不可解密 / 文件不存在）应分别返回并记一行日志（合 R-09）。`auth.ts` 的 boot 与 `getAccessToken`/`refresh`（`:91-99`）有重复的 null 判定，可收一个 `currentToken()`。

### 2.5 可观测指标

| 指标 | 现在能否看到 | 建议 |
|---|---|---|
| 登录成功/失败次数 | 不能 | 后端 `log.info` 一行（不带密码字段） |
| refresh 触发频率（access TTL 是否合理） | 不能 | `AuthService.refresh` 计数 |
| 会话文件是否加密 | 不能 | `session.ts:32` 分支各记一行 |

---

## 3. P2a 平台账号 + 内嵌视图

### 3.1 预期功能达成

账号 CRUD、状态位、`viewId` 作为 Electron 分区标识；渲染层侧栏 + 舞台承载 `WebContentsView`，视图带标准 Chrome UA 加载第三方站点。**达成**（UA 修复已单独交付）。

### 3.2 逻辑链：开一个账号窗口

```
AccountSidebar/AddAccountDialog → POST /api/platform-accounts（viewId 缺省时后端 UUID，PlatformAccountService.java:30-32）
→ renderer/services/viewService → ipc.ts:52 'wcv-create'
→ manager.ts:58  partition = persist:scrm-${viewId}
→ manager.ts:59-67  webPreferences: sandbox / contextIsolation:true, nodeIntegration:false
→ manager.ts:71-72  先 setUserAgent 再 loadURL（`:94`）
→ manager.ts:81-87  dom-ready → forgetPageBundleCache + runInject
```

### 3.3 隐藏风险

**R-13（高）删除账号会级联删掉整个聊天归档，且 UI 无二次确认。** 后端 `service/PlatformAccountService.java:52-55` 直接 `deleteById`，schema 侧 `V8__chat_history.sql:30` 与 `:59` 把 `fk_conv_account` / `fk_msg_account` 定为 `ON DELETE CASCADE`。渲染层 `components/AccountSidebar.tsx:99-106` 的删除按钮是 hover 才出现的图标，`:31` 成功后立刻 `window.scrm.view.destroy(...)`，**没有 confirm**。一次误点＝该账号名下所有 `chat_message` 行永久消失。

**R-14（中）`viewId` 由客户端提供且只校验唯一性。** `PlatformAccountService.java:30-35` 只查重名；这个字符串直接成为分区名（`manager.ts:58`）。它不是安全边界（分区只影响 cookie 归属），但一个含 `/` 或空格的 viewId 会造出一个难以清理的分区目录。同时 `create` 的入参类型是实体本身（`PlatformAccount`），不是 DTO——意味着客户端可以塞 `tenantId`/`id`（`:28-29` 有覆盖，靠的是每行手工 set，而不是白名单）。

**R-15（中）`platformType` 在账号端点没有取值范围校验。** 对照：`CustomerService.java:74-76` 明确 `1..7` 并回 40000；`web/dto/PlatformAccountRequest.java` 只有 `@NotNull platformType`（已 grep 该文件，无 `@Min/@Max`），而 `web/PlatformAccountController.java` 的 `StatusRequest` 连 `@Valid` 都没有。后果：存进一个非法 platformType 的账号行，会在采集时才被 `MessageService.resolveAccount`（`service/MessageService.java:60-70`）拒掉，报错点离错误来源很远。

**R-16（中）`update` 没有可空字段的清空通路。** `PlatformAccountService.java:41-50` 把 5 个字段照抄后 `updateById`，MyBatis-Plus 跳过 null ⇒ `phone`/`avatar`/`remark` 一旦写进去就清不掉。这个坑本项目在别处已经修过并留下了正确写法：`CustomerService.java:133-137`、`MaterialService.java:110-113`、`AudienceService.java:65-70` 都补了显式 `.set()`。**账号这一处是遗漏，不是设计**。

**R-17（中）非 http(s) 导航未被拦截。** `manager.ts:251-254` 的 `will-navigate` 第一句是 `if (!/^https?:/.test(url)) return`——不是"允许"，是"直接放行不处理"。第三方页面若触发 `javascript:`/自定义 scheme 导航，主进程不会拦。`setWindowOpenHandler`（`:246`）只覆盖新开窗口那一类。

**R-18（低）`rootHost` 取末三段标签，公共后缀会判错。** `manager.ts:34-37`。对 `example.co.uk` 这类域名，"同根"判定会误纳/误排一个层级，影响 `:254` 的同站放行宽度。当前只作用于 whatsapp/telegram 两个域名，实际影响有限。

**R-19（低）切走的账号视图不销毁，长期驻留。** `renderer/src/hooks/useWebContentsView.ts:80` 的依赖里**没有** `injectConfig`（详见 R-21），`:75/:78` 的清理只做 `uninject` + `hideAll`，**从不调用 destroy**。真正销毁的只有 `main/index.ts:44` 的 `destroyAll` 和账号删除路径。每开一个账号就常驻一个 WebContents，并带着 3 秒一次的登录轮询（`inject/constants/config.ts:6` `LOGIN_CHECK_INTERVAL = 3000`，`inject/core/BaseInjector.ts:124-130`）。

### 3.4 可优化 / 精简

1. `AccountSidebar.tsx` 删除加 `confirm()` + 一行提示"将级联删除 N 条消息"（后端补一个只读计数端点即可）。
2. `PlatformAccountService.update` 补显式 `.set()`，与 `CustomerService.java:133-137` 同形。
3. `PlatformAccountRequest` 加 `@Min(1) @Max(7)`（`platformType`）与 `@Size(max=64)`（`viewId`），`StatusRequest` 补 `@Valid`。
4. `manager.ts:269-272` 的 `emitFromContents` 在 `views` 上做 O(n) 扫描，而 `:43` 的 `wcToView` 已有答案——直接用反查表。
5. `main/webContentsView/ipc.ts:52-71` 的 11 个 `wcv-*` handler 全部不校验 viewId 归属，靠 `manager` 内部 map 未命中时返回 null。可以接受，但值得在注释里写明"未命中即静默失败"这一约定。

### 3.5 可观测指标

| 指标 | 现在 | 缺口 |
|---|---|---|
| 当前开了几个视图 | `wcv-get-open-ids`（`ipc.ts:60`）可查 | 无 UI 呈现 |
| 视图 phase 变化 | `bridgeMount.ts:252` `phase=...` | 只覆盖挂了桥的视图 |
| 页面被拦截的跨站导航 | 无 | **缺**：R-17 类问题不可见 |
| 常驻视图数 / 内存 | 无 | **缺**：R-19 无计数 |

---

## 4. P2b 注入层 + 桥构建管线

### 4.1 预期功能达成

构建出两份页面侧产物（`resources/inject.bundle.js`、`resources/msg-bridge.bundle.js` + 原样搬运的 `wa-js.bundle.js`），按 `channel` 装配适配器，提供翻译气泡、输入框预览、消息采集、发送执行与销毁。**达成**。

### 4.2 逻辑链：注入与销毁

```
manager.ts:210 runInject(viewId) → 读 resources 产物 → executeJavaScript
→ inject/index.ts:11-14 按 WHATSAPP/TELEGRAM 选适配器
→ BaseInjector 装配 state + translation + login poll（:124-130）
销毁：manager.ts:187-196 → window.__SCRM_DESTROY__?.()
     → inject/index.ts:44-51 injector.destroy() + adapter.cleanup()
     → BaseInjector.ts:139-148 _destroyed=true, state.destroy()
     → StateManager.ts:126-128 reset() + listeners.clear()
```

### 4.3 隐藏风险

**R-20（中）生产构建把诊断输出整条删掉，页面侧不可观测。** `scripts/build-inject.mjs:27` 与 `scripts/build-bridge.mjs:35` 在非 watch 模式加 `drop: ['console']`（桥还多 drop `debugger`）。`BaseInjector.ts:133-137` 的 `_reportError` 唯一动作就是 `console.error`，而 `constants/events.ts` 那套 host 通道里 `error-msg-tips`/`report-error` **没有任何渲染层监听者**（见 R-23）。⇒ 打包后：注入层内部异常既不上屏也不留痕。历史最难查的那类问题（"内嵌页翻译不稳定"）在交付形态下恰好落在信号盲区。

**R-21（中）`injectConfig` 改了不会重新注入。** `useWebContentsView.ts:80` 的依赖数组 `[active?.viewId, active?.url, active?.channel, containerRef]` 排除了 `injectConfig`。当前 `injectConfig` 携带 `apiBase`（`components/AccountStage.tsx:33`）与邀请码，所以影响面小；一旦把语向开关/词典版本塞进 config，就会出现"改了设置要重开账号才生效"。这是结构性的，不是当前 bug。

**R-22（中）`translatedMsgIds` 只在销毁时清空。** `inject/core/StateManager.ts:34` 的 Set 在页面存续期内单调增长（`:100` 添加，`:104` 查询），`reset()`（`:107-124`）只有 `destroy()`（`:126`）一个调用点——切会话不 reset。长挂的 WhatsApp 页面会积累 id；更值得注意的是**语义**：换会话后同一 `msgKey` 不会重绘，依赖的是"旧 DOM 已经没了"这一隐式前提。

**R-23（中）host 通道白名单 11 项里 8 项无人消费。** 已逐个 grep：渲染层监听只在 `lib/translationSync.ts:12,84`（`injector-ready`）、`lib/loginStatusSync.ts:10,45`（`login-status`）和 `msg:live`。`ipc.ts:9-22` 放行的 `operateLogs`、`error-msg-tips`、`report-error`、`upload-msg`、`get-new-message`、`update-unread-count`、`translation-flags-applied`、`auth-status-change` 全部落到 `forwardToHost` 后被丢弃（该文件 **0** 条日志）。`BaseInjector.ts:86` 每应用一次翻译就 emit 一条 `translation-flags-applied`，属于纯开销。

**R-24（高）信任边界的实际强度要写清楚。** `preload/view.ts:24` 把 `window.ele` 暴露给 **main world**，也就是第三方页面本身可调用。约束是：invoke 通道只有 `translate-api`（`ipc.ts:25`）、20 次/秒（`:32-33`、`:98`）、单次正文 ≤5000 字（`:101`）。⇒ 页面可自主消耗租户翻译配额；也可伪造 `msg-report` 帧，但因 `accountId` 由主进程盖章（`ipc.ts:113-116`），写入范围被限制在它自己那个账号。`ipc.ts:104-112` 的注释已明确声明"类型标注不提供运行时过滤，别当安全边界读"——**这条边界是靠得住的，但靠的是那几行运行时判断，不是类型**。真正没有守卫的是 `apiBase`（`ipc.ts:103` 取注入配置，`authedFetch.ts:13` 无 allowlist）：注入配置来自渲染层，目前渲染层只填 `API_BASE`，但一旦 view 配置被污染，bearer token 就会被发往任意 host。

### 4.4 可优化 / 精简

- **删**：`BaseInjector.ts:18/32` 的 `userCode` 全仓无读者（已 grep）；`StateManager.ts:43-62` 的 `get/set/update/watch` + `_listeners`（含 `this as Record<string, unknown>` 那段）零调用点；`manager.ts:19/183/191/224` 的 `entry.injected` 只写不读；`inject/index.ts:44-51` 与 `BaseInjector.ts:147` 重复的 `adapter.cleanup()`（`platforms/whatsapp/index.ts:134-137` 幂等，所以无害，可保留但加一行注释说明为何两次）。
- **补**：给 `_reportError` 接一条真实出口（最小改动是复用 `msg-report` 那类已存在的通道，发到主进程记一行），或者干脆把 `drop:['console']` 换成只 drop `log/debug`、保留 `error/warn`。
- 白名单收敛到"有消费者的通道"，其余从 `ipc.ts:9-22` 摘掉，减少 R-24 的攻击面。

### 4.5 可观测指标

| 指标 | 现在 |
|---|---|
| 桥装载版本 | `bridgeMount.ts:152`（wa-js 版本）/`:156`（桥版本） |
| 桥阶段 | `bridgeMount.ts:252` |
| 注入成功/失败 | `manager.ts:216`/`:226` 两处 |
| 页面侧内部错误 | **缺**（R-20） |
| 未消费的 host 消息数 | **缺**（R-23，可加一行 warn 做发现） |

---

## 5. P5 翻译中心

### 5.1 预期功能达成

七渠道白名单、按作用域（全局 / 按客户）的语向设置、词典模拟引擎与在线厂商适配器分层、结果缓存 + 命中计数、节点测速、凭据掩码存取与连通性测试、推送到内嵌页。**达成**。腾讯线路已实现但未接入默认路由（`TranslationService.java:53-55` 只有 5→baidu、7→tencent，其余走模拟引擎），其端到端状态见 `docs/notes/2026-09-20-tencent-online-translation-deferred.md`。

### 5.2 逻辑链：一条接收消息的翻译

```
① 生效面①（显式）：renderer → /api/translation/translate {accountId, chatKey}
② 生效面②（投影）：ipc.ts:113-116 主进程盖 accountId+chatKey → translationBridge:51-58
   → TranslationService.translate(:288)
   → customerId = dto.customerId ?? customerOfChat(:240)      // 按 chat_message 的投影解析
   → ScopeSettings.resolve(:18-20)  // 有客户覆盖行用覆盖，否则全局
   → buildCacheKey(:395) → 命中则 hit_count+1(:316-318) 直接返回
   → CHANNEL_TO_PROVIDER(:331) 命中厂商 → 在线调用 → writeCache(:371)
   → 厂商抛错 → 模拟引擎兜底，degraded=true + 厂商原文(:344-352)
```

### 5.3 隐藏风险

**R-25（中）在线翻译的耗时预算比调用方超时宽。** `provider/BaiduProvider.java:29` 单请求上限 5000 字，`:136-160` 按行切块，`:89` 的 `for` 循环**串行**投递，`:113` 每块 4 秒超时。一段 15000 字的文本最坏 3 块 × 4s ≈ 12s；而 `main/services/authedFetch.ts:4` 在 5s 就 abort。⇒ 页面表现为"没译文"，但厂商侧请求已经发出并消耗配额。**这条链的超时不匹配是读码推出的，未在真机复现（无 15k 字语料）**。

**R-26（中）词典只在启动时加载一次，且没有维护入口。** `service/PhraseDict.java:23` `volatile index`，`:51-70` 首次访问时构建、之后从不失效（没有 `refresh()`、没有 TTL）。同时 `web/` 下 **没有** phrase 相关 controller/端点（已 ls `web/`）。⇒ 改词典必须重启后端；运营侧无法自助加词。

**R-27（低）按客户作用域没有 FK 也没有清理。** `db/migration/V5__translation.sql:29-30` 只给 `translation_setting` 定了 `fk_tset_tenant`，`scope='customer'` 的 `scope_key` 指向的 customer 行没有外键；`CustomerService` 的构造器（`:37-46`）只注入 3 个 mapper，删除客户时不清理这些行。后果是幽灵配置行（按 id 查不到客户 ⇒ `ScopeSettings.resolve` 走不到覆盖分支），不影响正确性，只影响数据整洁与"配置数"类统计。

**R-28（低）`getSettings(tenantId)` 单参重载是死代码。** `TranslationService.java:83-84` 定义后转发到双参版本；grep 全仓唯一调用点在 `web/TranslationController.java:45`，走的是双参版本。

**R-29（低）缓存并发写靠"先查后插 + 冲突改计数"，没有唯一键冲突分支的日志。** `TranslationService.java:371-393`：`:390-391` 的兜底路径与 `uk_tcache_tenant_key`（`V5__translation.sql:66`）配合是正确的，但一次竞态发生在这里完全静默——与"cacheStats 数字对不上"的排查体验相关。

### 5.4 可优化 / 精简

1. 把 `BaiduProvider` 的分块改成并行（或把 `authedFetch` 的超时提到与厂商侧一致）——两边择一，不要都放宽。
2. `PhraseDict` 加一个 `invalidate()` + 管理端点（哪怕只有 `POST /api/translation/phrases/reload`）。
3. 删 `TranslationService.java:83-85`。
4. `V9` 迁移补 `translation_setting` 的 `fk_..._customer`（`ON DELETE CASCADE`），或在 `CustomerService` 删除时清行——与 P6 已知限制 #1（`chat_conversation.customer_id` 无 FK，`V8__chat_history.sql:20/26-30`）一起做，一次迁移解决两处。

### 5.5 可观测指标

| 指标 | 现在 | 来源 |
|---|---|---|
| 缓存命中率/条数/Top 命中 | **有** | `GET /api/translation/cache/stats` → `TranslationService.java:403-414`，前端 `api/translation.ts:188` |
| 是否降级到模拟引擎 | **有** | `TranslateVO.degraded`（`TranslationService.java:344-352/354-359`） |
| 厂商原始错误 | **有** | 同一 VO 的 message 字段 |
| 节点延迟 | **有** | `delays()`（`:276-283`）+ `/api/translation/nodes/delays` |
| 凭据有效性 | **有** | `POST /api/translation/credentials/test`（`:465-484`），凭据读出恒掩码（`:418-426`） |
| 推送链是否成功 | **没有** | `main/services/translationBridge.ts:60/62/63` 三处失败全部 `return null`，该文件 0 条日志 ⇒ 整条页内推送失败不可见 |

---

## 6. P3 客户域（客户 / 标签 / 人群包）

### 6.1 预期功能达成

客户 CRUD + 批量打标 + 多维筛选（关键词/平台/国家/标签交集或并集）、标签组与标签、人群包（关键词 + 标签条件）与成员计数。**达成**。跨租户隔离靠每处 `eq(tenantId)` + `uk_customer_tenant_platform_openid`（`V3__customer_domain.sql`）。

### 6.2 逻辑链：客户筛选

```
GET /api/customers?keyword&platformType&country&labelIds&matchAllLabels
→ CustomerService.page(:48) → filterWrapper(:182)
   ├─ keyword → nickname/phone/chat 关键词 OR
   ├─ matchAllLabels=false → inSql(... customer_id ...)  // :202/:207 拼 Long，类型安全
   └─ 计数 → useCounts(:239) 统计每个标签的绑定数
→ PageResult<CustomerVO>
```

### 6.3 隐藏风险

**R-30（中）`nickname` 永远清不掉。** `CustomerService.java:124` `setNickname(req.nickname())` 后走 `updateById`（`:131`），而 `:133-137` 的显式 `.set()` 列表只覆盖 `country`/`email`/`remark`。同一文件里正确写法就在下面 3 行，属漏写。

**R-31（低）人群包列表是 N+1。** `AudienceService.java:29-36` 取全部人群包后逐个 `toVO`，`:90` 每次都调 `customerService.countMatching` 真跑一次 COUNT。人群包数量小（演示种子 2 个），但这是每次进页面都执行的线性 DB 往返。

**R-32（低）标签使用数统计逻辑重复两份。** `CustomerService.java:239-250` 与 `LabelService.java:128-139` 逐字相同；`LabelService.java:3` 已经 `import static ...CustomerService.toVO`，说明共享是既定做法，`useCounts` 只是漏搬。

**R-33（低）删除客户后 `chat_conversation.customer_id` 悬空。** 见 README §7 已知限制 #3：`V8__chat_history.sql:20` 那一列没有 FK，`CustomerService` 也不清理。后果：客户抽屉时间线（`MessageQueryService.java:363-384`）按 `customer_id` 查，客户行没了就再也打不开，但会话头仍带着一个不存在的 id。

**R-34（低）人群包 `tag_ids` 是 CSV，不随标签删除维护。** `AudienceService.java:110-123`（join/parse）。删掉的标签 id 会留在字符串里；`countMatching` 用 `inSql` 时多一个不存在的 id 不报错，所以只是脏数据不可见。

**R-35（低）`matchAllLabels` 会放大成 N 个相关子查询。** `CustomerService.java:202` 起，`inSql` 按标签数逐个 AND 拼。标签选得多时列表页变慢——当前没有索引/改写问题，只有规模问题。

### 6.4 可优化 / 精简

`useCounts` 上提到共用（合 R-32）；`CustomerService.java:133-137` 补 `.set(nickname)`；人群包列表的计数改成一条 `GROUP BY` 或异步刷新（合 R-31）；`tag_ids` 若要继续留 CSV，就在标签删除处顺手清理（合 R-34）。

### 6.5 可观测指标

| 指标 | 现在 | 建议 |
|---|---|---|
| 每标签绑定数 | **有**（VO 里带 `useCount`） | — |
| 人群包成员数 | **有**（`countMatching`） | — |
| 悬空引用数（会话头指向不存在客户） | 无 | 一条 `SELECT COUNT(*)` 巡检 SQL（§9 第 6 条已给） |
| 列表接口耗时 | 无 | 同 R-08：后端只有 MyBatis 的 DEBUG SQL，没有请求级耗时 |

---

## 7. P4 素材库 + 快捷回复

### 7.1 预期功能达成

素材分组/素材 CRUD、快捷回复分组/回复/条目、条目支持文本或素材引用、使用次数记录。**达成**。V4 的外键语义经核：`label`/`quick_reply_item`/`customer_label` 是 `ON DELETE CASCADE`，`material→material_group` 是 `SET NULL`——四条"删组会不会造成脏数据"的候选风险里，**只有素材组是真 SET NULL，其余三支被 SQL 证伪**。

### 7.2 逻辑链：一次"发送快捷回复"

```
QuickRepliesPage 选中条目 → /api/quick-replies/{id}/use
→ QuickReplyService.recordUse(:145-150)：先 setSql("use_count = use_count + 1")(:149)，再两次回读
→ 渲染层把 content / mediaUrl 填入输入框（走 P6 的发送链或 view 写入）
```

### 7.3 隐藏风险

**R-36（中）素材 URL 无协议白名单。** `MaterialService.java:129` `material.setUrl(req.url().trim())`，只 trim。素材 URL 会被填进聊天输入框/展示给第三方页面，`javascript:` 之类协议在这一层没有拦。当前渲染层是否二次过滤未逐一核对 ⇒ 判为风险而非已确认漏洞。

**R-37（低）快捷回复对素材是快照，不是引用。** `QuickReplyService.java:176-178` 把 `material.getUrl()` 复制进 `item.mediaUrl`。之后改素材 URL，已建回复仍指向旧地址——这是产品语义选择，需明写。补两点读码事实：条目随回复级联删除（`fk_item_reply`，`V4__reply_material.sql:93`）所以**回复侧**完整性够；但 `quick_reply_item.material_id` 这列**没有 FK**（同一张表的 CONSTRAINT 只有 tenant 与 reply 两条），而 `MaterialService.delete`（`:117-120`）是无条件 `deleteById`，于是删掉素材后 `material_id` 会悬空——发送时不重新解析素材（全仓只有 `:175` 读它，用于取快照），所以表现为"图片照常发、点不进素材详情"。巡检 SQL §9 第 9 条用 `JOIN`，恰好漏掉这一类；要一起看就是把 JOIN 换成 `LEFT JOIN` 后筛 `m.id IS NULL`。

**R-38（低）`recordUse` 三次往返。** `QuickReplyService.java:145-150`：1 次 UPDATE + 2 次 SELECT。热路径（每次点一条回复都走）。

**R-39（低）`delete` 未标注 `@Transactional`。** `QuickReplyService.java:140-143`。因为 items 由 DB 级联删除，单条 `deleteById` 实际是原子的，所以不构成缺陷；但与同类方法（`:115`、`:126` 都有 `@Transactional`）风格不一致，容易被后来者误改。

**R-40（低）素材/分组的计数在 Java 侧做。** `MaterialService.java:32-46`，与 §6 R-31 同类（当前量级无影响）。

### 7.4 可优化 / 精简

`MaterialService.java:129` 加协议白名单（`http`/`https`）；`recordUse` 改成一条 UPDATE + 一条返回 SELECT；`useCounts`/素材计数改成 `GROUP BY`。

### 7.5 可观测指标

| 指标 | 现在 |
|---|---|
| 回复使用次数 | **有**（`use_count` 列，`/use` 端点） |
| 素材被引用次数 | **有**（VO 统计） |
| 非法协议 URL 被拒次数 | **缺**（R-36） |
| 快照与素材当前值不一致的条目数 | **缺**（R-37，可写巡检 SQL） |

---

## 8. P6 聊天记录（采集 / 入库 / 查询 / 搜索 / 统计 / 发送 / 语向）

这是当前最大的一面，也是日志最齐全的一面。

### 8.1 预期功能达成

按 spec §4 的口径：**达成**且已端到端验收（`docs/notes/2026-09-20-p6-chat-history-verification.md`）。

- 幂等入库：`uk_msg(tenant,platform,account_id,chat_key,msg_key)`（`V8__chat_history.sql:55`）+ `INSERT IGNORE`（`mapper/ChatMessageMapper.java:22-32`）。
- 会话头投影：`upsertHead` 只由新行推动（`service/MessageService.java:145-156`）。
- 未读规则：入向 + 单聊 + 非当前会话 + `source='live'` 才 +1（`:197-202`）。
- 状态阶梯：单调推进守卫放在 SQL（`ChatMessageMapper.java:42-51`、`MessageService.java:171-184`）。
- 翻页游标：`(last_msg_time, id)` 全序 + `isNotNull(last_msg_time)` 堵洞（`MessageQueryService.java:90-103`）。
- 采集批量：`CollectorHub` 500 条 / 2s 先到先冲，溢出丢最旧（`main/services/msgBridge/collectorHub.ts:76-79`）。
- 发送闭环：`SendRegistry` 以 `localId` 结清，20s 超时（`main/services/msgBridge/sendRegistry.ts:20-22/38-39`）。
- 实时尾巴：`shared/liveTail.ts:31` 同 `msgKey` 覆盖不新增，`:51` 把 `~localId` 原地换成真实 msgKey。

### 8.2 逻辑链 A：采集入库（含失败路径）

```
WhatsApp 页面 → 桥 normalize → post 'view:toHost' {channel:'msg-report'}
→ ipc.ts:77-80 分流（不再转渲染层，避免双份）
→ msgBridge/index.ts:141 handleBridgeReport → hub.push(frame)
→ collectorHub.ts:90-102 push → trim → 攒够 500 立即 flush，否则 arm 2s 定时器(:120-128，unref)
→ :143-161 drain：按 (accountId, activeChatKey) 分组，逐组投递
→ msgApi → POST /api/messages/batch
→ MessageService.accept(:81) → 逐条校验 → 逐行 insertIgnoreBatch(:140) → 新行才 upsertHead(:150-156)
→ 回 {accepted, duplicated, rejected, reasons}
→ collectorHub.ts:182-203 reportRejected 打一行 warn
```

**失败路径**：投递异常 → `:164-177` 立刻重试 3 次（**无退避**）→ 仍失败则把未投出的组退回队首（`:156`）并 `return`。

### 8.3 隐藏风险

**R-41（高）补采停滞时不会自己续上。** `collectorHub.ts:105-106` 的 `flush()` 会 `disarm()`，而 `arm()` 只在 `push()` 里调用（`:102`）。⇒ 若后端在某个时刻不可用、批次退回队列，此后**没有新消息进来就永远不再重试**：数据不丢（在内存里），但会静默滞留，直到下一条页面事件把它顺带冲出去。会话安静时（例如夜间只补采不实时）这正是"看起来补过了但库里没有"的形态。**读码确定的结构性缺陷，未在真机复现。**

**R-42（中）重试无退避、无熔断。** `collectorHub.ts:164-177` 三次连续重试之间不 sleep。后端 500 或连接被拒时，每个批次都变成 3 次背靠背请求；叠加 2s 定时器，DB 故障期间是持续加压而非退让。

**R-43（中）`reasons` 只回 20 条且不报剩余数。** `MessageService.java:158` `reasons.stream().limit(20)`。`rejected` 计数是真的，但被截掉的原因不可见——一批 500 条因同一原因被拒时，前端只能看到前 20 条和一个总数。**`reportRejected` 已经做了去重与 3 条上限（`collectorHub.ts:182-203`），所以真正的信息损失在服务端那 20 条截断之前**：建议回一个"原因分布"而不是原因样本。

**R-44（中）`body LIKE '%q%'` 没有可用索引，是最大的规模风险。** `MessageQueryService.java:190` 前置通配；`V8__chat_history.sql:56-57` 只有 `idx_msg_conv` 与 `idx_msg_customer`，都没有 `body`。消息量到百万级后全局搜索会全表扫。候选：MySQL FULLTEXT + ngram 解析器（中文友好），或外挂索引。**这是设计取舍，不是 bug——spec 里就是 LIKE。**

**R-45（中）`matchCustomer` 的手机号兜底会扫全租户同平台客户。** `MessageService.java:229-250`：openId 未命中时 `selectList(tenantId, platformType)` 全量取出再在 Java 里比 `normalizePhone`。虽有 per-batch 缓存（`:85`、`:116-119`）摊薄，但缓存按 chatKey 计——**首次采集一个新会话密集期仍可能多次触发**。注释里说明了"为什么不能用 `computeIfAbsent`"（未命中值为 null 会被当成没映射，`:116` 用 `containsKey`），说明作者是清楚这一点的。

**R-46（中）逐行 INSERT 而不是整批。** `MessageService.java:134-143` 在 Java 循环里对每条消息调一次 `insertIgnoreBatch(List.of(row))`。注释给出了理由：需要区分 affected rows 语义，实测过（单行 1 / 重复 0 / 混合正确），改回整批必须把 `duplicated` 换成 `提交数 - affected`。⇒ 一批 500 条 = 500 次往返。**当前是已知取舍，不是遗漏。**

**R-47（低）`titleOf` 对每条新行重扫整批 items。** `MessageService.java:187-194` + 调用点 `:150` ⇒ O(n²)。n≤500 时是 25 万次比较，纯内存，但这是最便宜的下一个性能改法（先按 chatKey 建 Map）。

**R-48（低）`SKIPPED_TYPES` 计入 rejected 但不给原因。** `MessageService.java:93-96`（与 `:88-90`/`:99`/`:105` 三处都 `reasons.add` 对比明显）。通知类行被丢掉是对的，但 `rejected` 计数因此无法拆分"非法"与"故意忽略"。

**R-49（低）未捕获异常导致整个批次回滚。** `MessageService.accept` 带 `@Transactional`（`:80`）：一条行抛出（例如某列超长在 `normalizeMediaType` 之外）会让整批 500 条回滚，而 `CollectorHub` 的三次重试每次都撞同一堵墙。`normalizeMediaType`（`:221-226`）的存在恰好是为了避免最可能的那一种（VARCHAR(16) 截断 + `INSERT IGNORE` 静默），所以剩余概率低。

**R-50（中）`num()` 把异常值一律折成 0。** `MessageQueryService.java:284-293`：`v instanceof Number n ? n.longValue() : 0L`。SUM 返回 null、返回字符串、键名拼错——三种"坏了"与"真的是 0"在输出上完全不可区分。统计卡因此不可信。同时 `:262-266` 的 `statsTotals` 与 `statsPerDay` 是两条独立语句，注释已明说并发下 `total` 与 ΣperDay 会差一条（尽力值口径）。

**R-51（低）时间线会话头不分页。** `MessageQueryService.java:380-382`：`heads` 只按 `customer_id` 全取。消息侧有 `LIMIT`（`:374`），头没有。一个跨多账号多会话的客户会一次性带回所有头。

**R-52（中）账号删除会带走聊天归档**（= R-13 在 P6 侧的另一半）。`V8__chat_history.sql:30/59` 的 CASCADE 让 P2a 那个无确认按钮变成高危操作。归档是不可再生数据（第三方页面已划走的会话补采不回来），所以这一条是本文档认为**优先级最高**的修复项。

**R-53（低）`applyStatus` 与 `accept` 的校验不对称是刻意的。** `MessageService.java:171-184` 的注释已解释（UPDATE 的 WHERE 钉住四列，错配只会 0 行；INSERT 错配会造脏行）。留在这里是为了防止后来者"顺手统一"。

### 8.4 可优化 / 精简（P6 侧）

1. `collectorHub`：`flush()` 失败后重新 `arm()`（修 R-41），并在 `deliver` 的三次重试之间加指数退避（修 R-42）。这两处改动小、收益直接。
2. `MessageService.accept`：把 `titleOf` 改成批前一次 `Map<chatKey,title>`（R-47）；`reasons` 换成 `Map<reason,count>`（R-43）；`SKIPPED_TYPES` 分支补 `reasons.add`（R-48）。
3. `MessageQueryService.num`：值缺失时抛或至少记一行（R-50）。
4. `hub.size()`（`collectorHub.ts:85-87`）**除单测外没有消费者**（已 grep：仅 `collectorHub.test.ts` 4 处断言用到）。免费指标，缺的只是一个出口。
5. `body` 搜索改 FULLTEXT（R-44）作为容量路线，不是现在必须做。

### 8.5 可观测指标（P6 现状：全项目最好的一面）

| 链 | 指标 | 来源 |
|---|---|---|
| 桥装载 | wa-js / 桥版本、phase | `bridgeMount.ts:152/156/252` |
| 账号挂载 | `挂载账号 account=... view=... platform=...` | `msgBridge/index.ts:94` |
| 登录态 | `login-status view=... isLogin=...` | `msgBridge/index.ts:115` |
| ack | 丢弃 / 剔除非法 key / 上报失败 / 全批未推进 | `msgBridge/index.ts:219/223/256/263` |
| 补采 | 进度 `chatsDone/chatsTotal msgs=` + 进程累计 `droppedTotal` | `msgBridge/index.ts:272-275` |
| 投递 | 第 n/3 次失败（只带计数与错误名，不带正文） | `collectorHub.ts:171-174` |
| 逐行拒绝 | `本批拒绝 x/y ... reasons=...` | `collectorHub.ts:199`（`reportRejected`，Task 12 行 7 的教训） |
| 发送结清 | `结清未决发送 n 条` | `msgBridge/index.ts:65` |
| 未决发送数 | `sendRegistry.pending()`（`:29`） | 有 API，无展示 |
| 队列深度 | `hub.size()`（`collectorHub.ts:85`） | 有 API，无消费者 |
| 入库结果 | `{accepted,duplicated,rejected,reasons}` | `MessageService.java:158` |
| 搜索/统计 | 结果条数、`total/in/out/activeConversations` | `MessageQueryService.java:259-282` |
| 后端侧写入耗时/失败 | **缺**（R-08） | — |

---

## 9. 十分钟基线自检包

按顺序跑，任何一步红了就停在对应章节。

```bash
# 1) 类型四面（node/web/inject/unit 各一个 tsconfig）
cd D:/SmartSCRM && pnpm --filter @smartscrm/desktop typecheck

# 2) 页面侧/主进程/shared 单测（22 个 test 文件，含 shared 纯函数与 CollectorHub）
cd apps/desktop && pnpm test:unit

# 3) 后端纯函数单测（10 个测试类：ChatKeys/Cursors/MsgTimes/ScopeSettings/SearchPattern/StatusLadder/两 provider/模拟引擎/MessageVO 排序）
export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18"
cd ../server && ./mvnw test

# 4) 健康检查（需 MySQL 在跑；:8180 若被占先 kill）
curl -s http://localhost:8180/api/health
```

打包/发布前额外两步（当前**没有**自动化，且第 5 步是 R-02 唯一能证伪的地方）：

```bash
cd apps/desktop && pnpm build && pnpm build:win   # 5) 装 inject/bridge 产物 + electron-builder
```

数据巡检 SQL（只读，不改）：

```sql
-- 6) 悬空客户引用（README §7 已知限制 #3 / R-33）
SELECT COUNT(*) FROM chat_conversation c
 WHERE c.customer_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM customer k WHERE k.id = c.customer_id);

-- 7) 幽灵按客户语向行（R-27）
SELECT COUNT(*) FROM translation_setting t
 WHERE t.scope = 'customer'
   AND NOT EXISTS (SELECT 1 FROM customer k WHERE k.id = CAST(t.scope_key AS UNSIGNED));

-- 8) 会话头与消息不一致（重算入口：POST /api/conversations/{id}/replay-head）
SELECT c.id, c.last_msg_time, MAX(m.msg_time) AS real_max
  FROM chat_conversation c JOIN chat_message m
    ON m.tenant_id=c.tenant_id AND m.account_id=c.account_id AND m.chat_key=c.chat_key
 GROUP BY c.id, c.last_msg_time HAVING c.last_msg_time <> MAX(m.msg_time);

-- 9) 快捷回复图片条目：快照漂移 / 素材被删后的悬空引用（R-37）
SELECT i.id, i.media_url AS snapshot, m.url AS current,
       CASE WHEN i.material_id IS NULL            THEN 'no-ref'
            WHEN m.id IS NULL                     THEN 'dangling'
            WHEN NOT (i.media_url <=> m.url)      THEN 'drift'
            ELSE 'ok' END AS state
  FROM quick_reply_item i
  LEFT JOIN material m ON m.id = i.material_id
 WHERE i.type = 2;

-- 10) 归档体量（判断 R-44 何时必须做）
SELECT COUNT(*) FROM chat_message;
```

### 9.1 鉴权探针（R-04 / R-05 的可复跑取证）

这一步要的是"签得对但形状不对"的 token，只有本机自签一条路。产物都在 gitignore 的 `tmp/`，日志行号只在本机成立。

```bash
export JAVA_HOME="C:/Program Files/Java/jdk-17.0.18"
cd D:/SmartSCRM

# 一次性：导出全量依赖 classpath 到 apps/server/target/cp.txt
(cd apps/server && ./mvnw -o dependency:build-classpath -Dmdep.outputFile=target/cp.txt) >/dev/null

# tmp/MkToken.java 用 application.yml:29 那把 dev 密钥签三枚 token，三行结果进 tmp/tokens.txt
#   ACCESS_NO_TID（缺 tid）/ ACCESS_BAD_SUB（sub 非数字）/ REFRESH_NO_SUCH_USER（sub 指向不存在的用户）
# 坑：源文件路径不要写成 ../tmp/MkToken.java —— java 的单文件源码模式会把带 `..` 的路径当类名解析（实测 ClassNotFoundException）。
CP="$(cat apps/server/target/cp.txt);."
"$JAVA_HOME/bin/java" --class-path "$CP" tmp/MkToken.java > tmp/tokens.txt

# 断言 1、2：两条都必须回 401。哪天变成裸 500，说明过滤器或错误转发变了
for k in ACCESS_NO_TID ACCESS_BAD_SUB; do
  printf '%s -> ' "$k"
  curl -s -o /dev/null -w '%{http_code}\n' \
    -H "Authorization: Bearer $(grep "^$k=" tmp/tokens.txt | cut -d= -f2)" \
    http://127.0.0.1:8180/api/customers
done

# 断言 3：refresh 的"用户不存在"分支 —— 期望 401 + {"code":40100,"message":"账号不可用"}
printf '{"refreshToken":"%s"}' "$(grep '^REFRESH_NO_SUCH_USER=' tmp/tokens.txt | cut -d= -f2)" > tmp/refresh-body.json
curl -s -X POST -H 'Content-Type: application/json' --data @tmp/refresh-body.json http://127.0.0.1:8180/api/auth/refresh
```

跑完顺手数一下后端日志的错误行数（本文取证时用的就是这条）：

```bash
grep -c "^2026.* ERROR " tmp/p6-backend.log   # 后端以日志文件启动时；否则看控制台缓冲
```

**这个数只该因为探针而增长**：每跑一轮上面两条断言，它就 `+2`（一条 NPE、一条 NumberFormatException）。反过来，若接口在返回 5xx 而这个数一动不动，说明失败被 `GlobalExceptionHandler` 吞了（R-08）——栈没留，只有响应体里那句 `internal error: …`。

---

## 10. 按链速查（症状 → 位置）

| 症状 | 先查 | 相关风险 |
|---|---|---|
| 页面一直转圈，后端"其实在跑" | `renderer/lib/http.ts:60` 无超时 | R-01 |
| 打包版全部请求失败 | CORS `Origin: null` | R-02 |
| 换后端地址后采集不落库 | `msgApi.ts:29` 字面量 | R-03 |
| 莫名其妙掉登录、重登也不解释 | `JwtAuthFilter.java:33-35`（token schema 变更）→ 容器 ERROR + 客户端 40100 | R-04 |
| 停用租户仍能访问 | `AuthService.java:63-77` | R-05 |
| 某字段改不回空 | 该 service 的 update 有没有显式 `.set()` | R-16 / R-30 |
| 账号一点消息全没 | `AccountSidebar.tsx:99-106` + V8 CASCADE | R-13 / R-52 |
| 内嵌页跳到奇怪页面 | `manager.ts:251-254` 的提前 return | R-17 |
| 改了注入配置没反应 | `useWebContentsView.ts:80` 依赖数组 | R-21 |
| 打包版查不到页面侧报错 | `build-inject.mjs:27` `drop:['console']` | R-20 |
| 长文本"有时有译文有时没" | 厂商分块耗时 vs 主进程 5s | R-25 |
| 页内推送整条无声失败 | `translationBridge.ts:60/62/63` | §5.5 |
| 补采看起来完成、库里 0 行 | 先看 `[msgHub] 本批拒绝`，再看队列是否停摆 | R-41 / R-43 |
| 统计卡数字是 0 但不确定真假 | `MessageQueryService.java:284-293` | R-50 |
| 搜索慢 | `body LIKE` 无索引 | R-44 |

---

## 11. 未实现 / 不在范围

明确列出，防止接手者按"应该有"去找。

| 项 | 状态 | 说明 |
|---|---|---|
| Telegram 采集链 | **未实现** | Task 12a（真机 DOM 探针）→ 12b（注入层清单）→ 12c（采集）。`inject/platforms/telegram/` 有骨架文件，但没有任何端到端验证。 |
| Telegram 发送链 | **未实现** | Task 12d。需要用户扫码登录真机。 |
| 角色/权限模型 | **未实现** | `role` 字段全链路存在但不参与判定（R-06）。 |
| refresh token 吊销 / 登录限速 | **未实现** | R-11 / R-12。 |
| 设置页、主题切换、任务栏角标、设备信息 | **未实现** | P6 收尾 Q1–Q3（任务清单里 pending）。 |
| 批量群发、群分析、话术引擎、代理与指纹、云手机、报表、i18n | **P7+** | 见 `docs/feature-checklist.md`。 |
| 打包态任何端到端验证 | **未做** | R-02 之所以停在"推断"。 |
| 并发采集压力验证 | **未做** | R-45/R-46/R-49 的概率估计来自读码。 |
| 词典维护入口 | **不存在** | R-26。 |

---

## 12. 修复优先级建议（不在本次改动范围内，仅结论）

按"不可逆后果优先"排：

1. `AccountSidebar.tsx` 删除加确认 + 影响条数提示（R-13/R-52）。
2. `authedFetch`/`ipc` 给 `apiBase` 加 allowlist（R-24）。
3. `collectorHub` 失败后重新 `arm()` + 退避（R-41/R-42）。
4. `AuthService.refresh` 补 `tenant.status` 与非空判断（R-05）。
5. `CustomerService.java:133-137` 补 `.set(nickname)`；`PlatformAccountService.update` 同修（R-30/R-16）。
6. `GlobalExceptionHandler` 记栈 + 固定文案（R-08）；`num()` 不再把坏值折成 0（R-50）。
7. `http.ts` 补超时（R-01）；打包态 CORS 验证或修复（R-02）。
8. 保留 `console.error`（R-20），补推送链一行日志（§5.5）。
9. 删死代码：`TranslationService.java:83-85`、`BaseInjector.ts:18/32`、`StateManager.ts:43-62`、`manager.ts` 的 `injected`、`ipc.ts:9-22` 里无消费者的 8 条通道（R-23/R-28 + §4.4）。
