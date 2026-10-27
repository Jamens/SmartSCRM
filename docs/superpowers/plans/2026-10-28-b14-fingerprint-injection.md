# B14 浏览器指纹注入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把租户下的指纹档案**真正应用**到内嵌视图上——同一租户下多个账号的运行环境互相区分，且每个视图的指纹在其生命周期内稳定不变。

**Architecture:** 三段式。**Java** 持有绑定关系与参数解析：账号 ↔ 档案一对一绑定，账号详情吐出已解析的 `FingerprintRuntime`（而非原始档案——避免客户端各写一份解析）。**主进程**是唯一施加方：视图创建时按 `viewId → accountId → 档案` 解析，`session.setUserAgent` 保 UA/Accept-Language，CDP `Emulation.setTimezoneOverride` 保时区，`Page.addScriptToEvaluateOnNewDocument` 保页内脚本早于任何页面脚本。**页内**是第三份独立 esbuild 产物（`fingerprint.bundle.js`），只从 `window.__FP_CONFIG__` 读配置跑 hook，不依赖 wa-js、不依赖 `window.ele`、不回传任何 IPC。

**Tech Stack:** MySQL 8 + Flyway `V53`；Spring Boot 3.5 / Java 17 / MyBatis-Plus；Electron 39 主进程（`WebContentsView` + `webContents.debugger` CDP）；esbuild 三份产物并存；React 19 + @tanstack/react-query 5；`node --test`、JUnit 5。

**Spec:** `docs/superpowers/specs/2026-10-28-b14-fingerprint-injection-design.md`（冲突时以 spec 为准；spec 未覆盖处按下面 §0 决策表裁定）

**工作区：** `.worktrees/b14-fingerprint`（分支 `feat/b14-fingerprint-injection`）。**所有改动只发生在该工作区内。**

---

## §0 相对 spec 的决策（执行前先读）

| # | spec 原文 | 本计划裁定 | 理由 |
|---|---|---|---|
| D1 | §2.1「`webRequest.onBeforeSendHeaders` 改 Accept-Language」 | **改用 `wc.session.setUserAgent(ua, locale)`** —— 一次调用同时定 UA 与 Accept-Language | Electron 的 `session.setUserAgent` 第二参数就是 Accept-Language，且是会话级、随首个请求头发出、无竞态。每个视图独占 `persist:scrm-<viewId>` 分区，会话级设置即视图级，不会串到别的账号。`webRequest` 拦截反而要挂过滤器、每次请求回调，多一处失败面 |
| D2 | §1.1-3「主进程 `applier.ts`：CDP 文档前脚本注册」 | 拆成三个文件：`bundle.ts`（产物+哈希）、`runtime.ts`（参数解析）、`applier.ts`（施加） | 照抄 `bridgeBundles()` 的写法；`runtime.ts` 与 `applier.ts` 各自可单测，前者不碰 Electron、后者不碰档案字段 |
| D3 | 未涉及「什么时候解析」 | **`createView` 里不再同步 `loadURL`**，改为异步 `loadWithFingerprint()`：解析 → 施加 → 再 `loadURL` | 解析要读后端（异步），而 UA/时区必须在首个请求前设好。同步创建 + 异步加载是唯一能满足 R5/R4 的形状。期间视图被销毁要能安全放弃（见 Task 15 Step 5） |
| D4 | §0.2-R4 真机验收 | 落 `test/fingerprint-probe/`：静态探针页 + Electron 主脚本 + `run.mjs`，断言三条 | 与 B27 的 `test/protocol-integration/run.mjs` 同构（esbuild 打真实源码 → Node 断言），不往产品里塞调试面 |
| D5 | §4-Q2「换绑后立即重载还是下次装载生效」 | **立即重载**，UI 二次确认（采纳 spec 暂定口径） | R3 要求"只有换绑才变"；不重载就退化成"重启才生效"，难以验证 |
| D6 | §1.1-5「设置页加全局开关」 | `AppSettings` 加 `fingerprintEnabled: boolean`（默认 **false**）与 `fingerprintToggles: Partial<Record<FpToggleKey, boolean>>` | 沿用 `state/settings.ts` 既有的 `mergeKnown` 逐键校验与 preload `settings.get/set/onChanged` 通道，零新 IPC。**默认关**是对 §0.1 红线越界的对冲：能力就位，但不默认启用 |

### §0.1 安全 posture（不得违背）

`contextIsolation: true` / `sandbox: true` / `nodeIntegration: false` / `webSecurity: true` **一个都不动**。本项目靠 `executeJavaScript` 与 CDP 拿能力，不需要像对标项目那样关沙箱换能力。

---

## §1 后端：绑定关系与参数解析

### 任务 1：Flyway `V53__account_fingerprint.sql`

- 文件路径：`apps/server/src/main/resources/db/migration/V53__account_fingerprint.sql`（新建）
- 要做的：走仓库惯例的 `information_schema` 守卫 + `PREPARE/EXECUTE`（照抄 `V52__ai_suggestion_columns.sql` 的写法），加四列：
  - `platform_account.fingerprint_profile_id` `BIGINT NULL`，`AFTER view_id`，注释「绑定的指纹档案；NULL = 不施加任何指纹（R2）」
  - `fingerprint_profile.ua_platform` `VARCHAR(32) NULL`
  - `fingerprint_profile.ua_platform_version` `VARCHAR(32) NULL`
  - `fingerprint_profile.brands_json` `VARCHAR(512) NULL`，注释「Client Hints brands JSON；形如 [{"brand":"Chromium","version":"140"}]」
- 验证：文件在 `information_schema` 守卫下重复执行无报错（本地库执行两次看 Flyway 校验和不变）；`ls | grep V53` 命中

### 任务 2：实体补字段

- 文件路径：
  - `apps/server/src/main/java/com/smartscrm/server/entity/PlatformAccount.java`
  - `apps/server/src/main/java/com/smartscrm/server/entity/FingerprintProfile.java`
- 要做的：
  - `PlatformAccount` 加 `private Long fingerprintProfileId;`（放在 `viewId` 之后）
  - `FingerprintProfile` 加 `uaPlatform` / `uaPlatformVersion` / `brandsJson` 三个 `String` 字段
- 验证：`./mvnw -q -pl apps/server compile` 通过

### 任务 3：`FingerprintRuntimeVO` 与解析

- 文件路径：`apps/server/src/main/java/com/smartscrm/server/web/vo/FingerprintRuntimeVO.java`（新建）
- 要做的：一个 `record`：
  ```java
  public record FingerprintRuntimeVO(
      Long profileId, Long seed,
      String userAgent, String uaPlatform, String uaPlatformVersion,
      List<BrandVO> brands, String locale, String timezone,
      Integer hardwareConcurrency, Integer deviceMemory,
      String webglVendor, String webglRenderer,
      Long canvasNoiseSeed, Long audioNoiseSeed) {
    public record BrandVO(String brand, String version) {}
  }
  ```
  在 `FingerprintProfileService` 加 `FingerprintRuntimeVO runtimeOf(Long tenantId, Long accountId)`：查账号 → 未绑档案或档案不属于本租户返回 `null` → 否则把档案字段解析成 runtime（`brandsJson` 用 `ObjectMapper` 解析，解析失败返回 `null` 而不是抛——**缺项不改**，不能因为一个字段坏了让整个账号的指纹全丢）。`canvasNoise` / `audioNoise` 是字符串种子，解析成 `Long` 失败时返回 `null`。
- 验证：`./mvnw -q -pl apps/server compile` 通过；下方任务 5 的单测覆盖

### 任务 4：绑定/解绑/runtime 三个接口

- 文件路径：`apps/server/src/main/java/com/smartscrm/server/web/PlatformAccountController.java`
- 要做的：加三个接口，全部 `@PreAuthorize("hasAuthority('account:write')")`（runtime 读接口用 `account:read`）：
  - `PATCH /{id}/fingerprint`，body `record BindRequest(Long profileId)`：`profileId` 为 `null` 即解绑；非 `null` 时校验该档案属于本租户，否则抛业务异常
  - `DELETE /{id}/fingerprint`：解绑（与 `PATCH` 带 null 等价，给 UI 一个语义明确的出口）
  - `GET /{id}/fingerprint-runtime`：`@PreAuthorize("hasAuthority('account:read')")`，返回 `ApiResponse<FingerprintRuntimeVO>`，未绑定时 `data` 为 `null` 且 `code` 仍为 0
- 账号列表 `GET /api/platform-accounts` 因实体加了字段会自动带上 `fingerprintProfileId`，**不需要改 controller**
- 验证：`./mvnw -q -pl apps/server compile` 通过；`curl` 手测（需登录后带 token）未绑定账号的 runtime 返回 `code:0, data:null`

### 任务 5：Java 单测

- 文件路径：`apps/server/src/test/java/com/smartscrm/server/service/FingerprintRuntimeTest.java`（新建）
- 要做的：至少 6 条，覆盖：
  1. 未绑档案 → `null`
  2. 绑了档案但档案属于别的租户 → `null`（越权读到别人档案 = 泄露运行环境配置）
  3. 绑了档案 → 字段逐一对上
  4. `brandsJson` 非法 JSON → 只有 `brands` 为 `null`，其余字段照常返回（R7 的"缺项不改"）
  5. `canvasNoise` 非数字 → `canvasNoiseSeed` 为 `null`，其余不变
  6. 解绑后再查 → `null`
- 验证：`./mvnw -pl apps/server test -Dtest=FingerprintRuntimeTest` 全绿

---

## §2 shared：运行时参数的契约

### 任务 6：`FingerprintRuntime` 类型与开关常量

- 文件路径：`apps/desktop/src/shared/fingerprint.ts`（新建）
- 要做的：
  ```ts
  export const FP_TOGGLE_KEYS = [
    'navigator', 'canvas', 'webgl', 'audio', 'font', 'mediaDevices', 'iframe', 'timezone'
  ] as const
  export type FpToggleKey = (typeof FP_TOGGLE_KEYS)[number]

  export interface FingerprintRuntime {
    profileId: number
    seed: number
    userAgent?: string
    uaPlatform?: string
    uaPlatformVersion?: string
    brands?: Array<{ brand: string; version: string }>
    locale?: string
    timezone?: string
    hardwareConcurrency?: number
    deviceMemory?: number
    webglVendor?: string
    webglRenderer?: string
    canvasNoiseSeed?: number
    audioNoiseSeed?: number
    /** 缺省视为 true；关掉的项不施加（R9）。 */
    toggles: Partial<Record<FpToggleKey, boolean>>
  }
  ```
  每个字段都是 `?` —— 这是 R7「档案缺某一项 = 该项不改」在类型上的体现。
- 验证：`pnpm typecheck:node` 通过

---

## §3 主进程：解析与施加

### 任务 7：`runtime.ts` 参数解析

- 文件路径：`apps/desktop/src/main/services/fingerprint/runtime.ts`（新建）
- 要做的：
  ```ts
  export interface FingerprintProfileRow { /* 与后端 FingerprintRuntimeVO 逐字段同形 */ }
  export interface FingerprintSettings { enabled: boolean; toggles: Partial<Record<FpToggleKey, boolean>> }
  export function resolveRuntime(
    profile: FingerprintProfileRow | null | undefined,
    settings: FingerprintSettings
  ): FingerprintRuntime | null
  ```
  三条短路，任一成立返回 `null`：`!profile`（R2 未绑定不施加）、`!settings.enabled`（R9 全局关）、`profile` 里除 `profileId`/`seed` 外全空（等于没配）。
  `toggles` 合并规则：`settings.toggles` 覆盖默认值 `true`；**未出现在 `settings.toggles` 里的项视为开**。
- 验证：见任务 8

### 任务 8：`runtime.test.ts`

- 文件路径：`apps/desktop/src/main/services/fingerprint/runtime.test.ts`（新建）
- 要做的：至少 7 条：未绑档案→null；全局关→null；单项关→该项不在 `toggles` 里且为 false；缺 `timezone`→`runtime.timezone` 为 `undefined`（不是空串、不是默认值）；缺 `brands`→undefined；`brands` 空数组→保留空数组（空是显式意图，与缺失不同）；`canvasNoise` 为 `null`→`canvasNoiseSeed` 为 `undefined`
- 验证：`node --test src/main/services/fingerprint/runtime.test.ts` 全绿

### 任务 9：`bundle.ts` 产物与内容哈希

- 文件路径：`apps/desktop/src/main/services/fingerprint/bundle.ts`（新建）
- 要做的：照抄 `bridgeMount.ts` 的 `bridgeBundles()`：按 mtime 缓存、读 `resources/fingerprint.bundle.js`、版本号 = 内容 SHA1 前 12 位。导出 `fingerprintBundle(): { source: string; version: string } | null`（产物不存在返回 `null`，让调用方降级为"不施加"而不是崩）
- 验证：`pnpm typecheck:node` 通过；任务 16 里被 applier 单测用 fake 覆盖

### 任务 10：`applier.ts` 施加（UA / Client Hints / Accept-Language / 时区 / 文档前脚本）

- 文件路径：`apps/desktop/src/main/services/fingerprint/applier.ts`（新建）
- 要做的：导出三个东西：
  ```ts
  /** 纯函数：runtime + bundle 源码 → 文档前脚本全文。可单测，不碰 Electron。 */
  export function buildFingerprintSource(runtime: FingerprintRuntime, bundle: string): string

  /** 副作用函数：把 runtime 施加到视图上。 */
  export async function applyFingerprint(
    wc: Electron.WebContents, runtime: FingerprintRuntime, bundle: string
  ): Promise<ApplyResult>

  export interface ApplyResult { applied: FpToggleKey[]; skipped: FpToggleKey[]; error?: string }
  ```
  实现顺序：
  1. `wc.session.setUserAgent(runtime.userAgent, runtime.locale)` —— 只在 `userAgent` 非空时调（D1）。`locale` 为空时只传第一个参数（传 `undefined` 会让 Electron 清掉 Accept-Language）
  2. 时区：仅当 `runtime.timezone` 非空且 `toggles.timezone !== false` 时，`await wc.debugger.attach('1.3')` 后 `sendCommand('Emulation.setTimezoneOverride', { timezoneId: runtime.timezone })`。**attach 后不 detach**（R6）
  3. 文档前脚本：仅当页内 bundle 存在时，`sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: buildFingerprintSource(runtime, bundle) })`
  4. 每一步各自 `try/catch`：任一步失败只把它记进 `error` 并降级为"该项不施加"，**不降级为 `did-navigate` 注入**（那违反 R4）。整段失败时 `applied` 为空数组
  `buildFingerprintSource` 产出：`'(function(){window.__FP_CONFIG__=' + JSON.stringify(publicPart) + ';})();' + bundle`，其中 `publicPart` 已按 `toggles` 剔除被关掉的项（关掉 canvas 时配置里连 `canvasNoiseSeed` 都不出现——R9 要求"不留空跑"，配置里带着种子却不用是隐患）
- 验证：见任务 11

### 任务 11：`applier.test.ts`

- 文件路径：`apps/desktop/src/main/services/fingerprint/applier.test.ts`（新建）
- 要做的：用 fake `WebContents`（只需 `session.setUserAgent` / `debugger.attach` / `debugger.sendCommand` 三个方法，记录调用序列）：
  1. `userAgent` 为空 → 不调 `setUserAgent`
  2. `locale` 为空 → `setUserAgent` 只收到一个参数
  3. `timezone` 为空 → 不 attach debugger（R6：只在需要时区覆盖时 attach）
  4. `timezone` 有值 → attach 一次，且 `sendCommand` 收到 `Emulation.setTimezoneOverride`
  5. **attach 之后没有 detach 调用**（R6 的回归哨兵）
  6. 关掉 canvas → 产出的脚本里不含 `canvasNoiseSeed`
  7. 全局关闭（runtime 为 null）→ 全部三个方法都没被调用过（R9 的"不留空跑"）
  8. `sendCommand` 抛错 → `ApplyResult.error` 有值、不抛出、后续步骤继续
- 验证：`node --test src/main/services/fingerprint/applier.test.ts` 全绿

---

## §4 页内：第三份独立产物

### 任务 12：`core/seededRandom.ts` 与 `core/hookFrame.ts`

- 文件路径：`apps/desktop/src/fingerprint/core/seededRandom.ts`、`apps/desktop/src/fingerprint/core/hookFrame.ts`（新建）
- 要做的：
  - `seededRandom.ts`：导出 `mulberry32(seed: number): () => number`。同 seed 稳定、不同 seed 各异（指纹要"每个视图各自稳定且互不相同"）
  - `hookFrame.ts`：导出 `installHook<T>(target: object, prop: string, make: (orig: T, rand: () => number) => T, rand: () => number): boolean` —— 用 `Object.defineProperty` 覆盖属性，返回是否覆盖成功；失败（属性不可配置）时返回 `false` 不抛出。内部用一个 `WeakSet` 记住"自己人"（我们伪造出来的值/对象），避免 hook 递归咬到自己
- 验证：见任务 15

### 任务 13：navigator / mediaDevices / font 三个任务

- 文件路径：`apps/desktop/src/fingerprint/tasks/navigator.ts`、`mediaDevices.ts`、`font.ts`（新建）
- 要做的：每个文件导出 `install(ctx: FpContext): void`，`FpContext` 里放 `{ rand, cfg, win }`——**把要 patch 的全局对象从参数传入**，这样 `node --test` 能传 stub 跑，不需要 DOM：
  - `navigator.ts`：`hardwareConcurrency` / `deviceMemory` / `languages` / `platform` / `vendor` / `userAgentData`（Client Hints：`getHighEntropyValues()` 返回 `brands` / `platform` / `platformVersion`）
  - `mediaDevices.ts`：`enumerateDevices()` 返回固定两三条设备（kind/label/deviceId 由 seed 派生）
  - `font.ts`：只在 canvas 关闭时也保持静默——字体探测靠 `measureText`，归到 `font` 开关下
- 验证：见任务 15

### 任务 14：canvas / webgl / audio / iframe 四个任务

- 文件路径：`apps/desktop/src/fingerprint/tasks/canvas.ts`、`webgl.ts`、`audio.ts`、`iframe.ts`（新建）
- 要做的：同样 `install(ctx)` 形状：
  - `canvas.ts`：只 hook **读取路径** `getImageData` 与 `toDataURL`，按 `rand` 给像素加 ±1 噪声；**绝不碰绘制路径**（`fillRect` 等）——页面自己画的东西一个像素都不能变
  - `webgl.ts`：`getParameter(VENDOR)` / `getParameter(RENDERER)` 返回配置里的 `webglVendor` / `webglRenderer`
  - `audio.ts`：`AudioBuffer.getChannelData` 返回的数组按 `rand` 做极小扰动（幅度 ≤ 1e-6，人耳不可闻但足以改变指纹）
  - `iframe.ts`：`MutationObserver` 监听新增 iframe，对其 `contentWindow` 递归跑一遍同一批 `install`。**注意**：只处理同源 iframe；跨域 iframe 的 `contentWindow` 访问会抛，必须 `try/catch` 吞掉
- 验证：见任务 15

### 任务 15：`index.ts` 组装 + 页内单测

- 文件路径：`apps/desktop/src/fingerprint/index.ts`、`apps/desktop/src/fingerprint/*.test.ts`（新建）
- 要做的：`index.ts` 只在 `window.__FP_CONFIG__` 存在时按开关逐项 `install`，每一项各自 `try/catch`（一项装失败不能连累其它项）。单测至少 8 条，覆盖：
  1. `mulberry32` 同 seed 两次序列相同、不同 seed 序列不同
  2. navigator 项：`hardwareConcurrency` 被覆盖成配置值
  3. 配置缺 `hardwareConcurrency` → 原值保持不动（R7）
  4. canvas：`toDataURL` 两次调用结果**相同**（同 seed 稳定），且与未 hook 时的基线不同（噪声确实生效）
  5. canvas 关闭 → `toDataURL` 与基线完全一致
  6. webgl：`getParameter(RENDERER)` 返回配置值
  7. iframe 跨域抛错 → 不冒泡、其余 hook 照常装上
  8. 全部开关关闭 → 所有原值保持不动，且不产生任何额外调用
- 验证：`node --test src/fingerprint/**/*.test.ts` 全绿

---

## §5 构建与接线

### 任务 16：第三份 esbuild 产物与脚本

- 文件路径：
  - `apps/desktop/scripts/build-fingerprint.mjs`（新建，照抄 `build-bridge.mjs`）
  - `apps/desktop/tsconfig.fingerprint.json`（新建，照抄 `tsconfig.inject.json`，`include` 改成 `["src/fingerprint/**/*"]`）
  - `apps/desktop/package.json`
- 要做的：产物 `resources/fingerprint.bundle.js`（IIFE，无 globalName —— 脚本全文由 `addScriptToEvaluateOnNewDocument` 注入，不需要挂全局）。`drop: ['console','debugger']`，与 bridge 同口径（C3：页内脚本的日志一律不带出去）。package.json 改四处：`typecheck:fingerprint` 新增并串进 `typecheck`；`build:fingerprint` 新增并串进 `build` 与 `predev`；`test:unit` 的 glob 补 `"src/fingerprint/**/*.test.ts"` 与 `"src/main/services/fingerprint/**/*.test.ts"`
- 验证：`pnpm run build:fingerprint` 产出文件；`pnpm run typecheck` 四路 + fingerprint 全绿；`pnpm run test:unit` 能跑到新增的页内用例

### 任务 17：`msgApi` 与 `accountDirectory` 扩展

- 文件路径：
  - `apps/desktop/src/main/services/msgBridge/msgApi.ts`
  - `apps/desktop/src/main/services/msgBridge/accountDirectory.ts`
- 要做的：
  - `MsgApi` 接口加 `fingerprintRuntime(accountId: number): Promise<FingerprintRuntime | null>`，实现照抄 `listAccounts()` 的 GET 写法（`GET /api/platform-accounts/{id}/fingerprint-runtime`，非 2xx / 信封 `code !== 0` 一律折 `null`，**不抛**）
  - `AccountRow` 加 `fingerprintProfileId?: number | null`
  - `accountDirectory.ts` 的 `AccountEntry` 加 `fingerprintProfileId`，`toEntry` 里带上
- 验证：`node --test src/main/services/msgBridge/msgApi.test.ts` 全绿（补一条"runtime 接口 500 时返回 null 而不是抛"）

### 任务 18：`manager.ts` 接线（关键：延后 `loadURL`）

- 文件路径：`apps/desktop/src/main/webContentsView/manager.ts`
- 要做的：
  1. `createView` 里把 `view.webContents.loadURL(url)` 一行替换成 `void this.loadWithFingerprint(viewId, url)`
  2. 新增私有方法：
     ```ts
     private async loadWithFingerprint(viewId: string, url: string): Promise<void> {
       const runtime = await resolveRuntimeForView(viewId)
       const managed = this.views.get(viewId)
       if (!managed) return                       // 等待期间视图被销毁（D3）
       if (runtime) {
         const bundle = fingerprintBundle()
         if (bundle) await applyFingerprint(managed.view.webContents, runtime, bundle.source)
         if (!this.views.has(viewId)) return      // 施加期间又被销毁
       }
       try { managed.view.webContents.loadURL(url) } catch { /* 视图已失效 */ }
     }
     ```
  3. 新增 `src/main/services/fingerprint/resolve.ts`：`resolveRuntimeForView(viewId)` = `await refreshAccounts()` → `accountOfView(viewId)` → 读 `AppSettings` 判全局开关 → `api.fingerprintRuntime(accountId)` → `resolveRuntime(...)`。任一步拿不到就返回 `null`（R2 的"宁可没有"）
  4. `syncZoomToWindow()` 与 `emit(created)` 留在原处不动（它们不依赖加载）
- 验证：`pnpm typecheck:node` 全绿；手工确认未绑档案的账号视图行为与改动前一致

### 任务 19：设置项落地

- 文件路径：`apps/desktop/src/main/state/settings.ts`、`apps/desktop/src/preload/index.ts`（仅类型，无需改逻辑）
- 要做的：`AppSettings` 加两个键，`DEFAULTS` 里 `fingerprintEnabled: false`、`fingerprintToggles: {}`；`mergeKnown` 里逐键校验（**只认真布尔**，与既有的 `badgeEnabled` 同口径；`fingerprintToggles` 只认对象且逐项过滤未知键）
- 验证：`pnpm typecheck:node` 全绿；`pnpm run test:unit` 全绿

---

## §6 渲染层与验收

### 任务 20：账号绑定 UI + 设置页全局开关

- 文件路径：
  - `apps/desktop/src/renderer/src/pages/CloudAccountPage.tsx`（或账号列表所在的卡片组件——**先确认账号卡片在哪个组件**）
  - `apps/desktop/src/renderer/src/api/fingerprintProfile.ts`
  - `apps/desktop/src/renderer/src/pages/SettingsPage.tsx`
- 要做的：
  - api 层加 `bindProfile(accountId, profileId | null)` 与 `fingerprintRuntime(accountId)` 两个函数
  - 账号卡片加一个「指纹档案」下拉：选项取自 `useQuery(['fingerprint-profiles'])`，可清空（清空 = 解绑）。换绑时按 D5 弹二次确认，确认后调 `wcv-reload`
  - 设置页加两个控件：总开关 `fingerprintEnabled`（默认关，旁注一行说明"开启后会对已绑定档案的账号施加浏览器指纹"）与八个单项开关
  - i18n 八个语言包补 key（zh-CN 必填，其余可回退）
- 验证：`pnpm typecheck:web` 全绿；`pnpm lint` 无新增告警

### 任务 21：真机探针 harness（R4 的硬性验收）

- 文件路径：`apps/desktop/test/fingerprint-probe/`（新建 `probe.html`、`probe-main.js`、`run.mjs`）
- 要做的：照 B27 的 `test/protocol-integration/run.mjs` 同构：
  1. `probe.html` 在**页面脚本执行时**（不是等 DOMContentLoaded）就把 `navigator.hardwareConcurrency`、canvas 像素和、WebGL RENDERER 写进 `document.title`——早到什么程度正是要验的东西
  2. `run.mjs` 用 esbuild 把**真实的** `applier.ts` + `runtime.ts` 打成 Node 可跑的 bundle，起一个静态服务托管 `probe.html`，`spawn` Electron 跑 `probe-main.js`
  3. `probe-main.js` 建一个 `WebContentsView`，施加一份固定 runtime，加载探针页，读 `document.title`，打印结果后退出
  4. 三条断言（缺一即失败）：① 三个值都等于施加值（**证明脚本早于页面脚本**）；② `reload()` 后三个值不变（R3 稳定）；③ 换一份 runtime 后三个值改变（R3 换绑才变）
- 验证：`node test/fingerprint-probe/run.mjs` 三条全过并打印读数

### 任务 22：README 口径修订

- 文件路径：`README.md`
- 要做的：按 spec §0.1 与 §1.1-6 修订 B10 / B13 / B14 / A6 处「模拟、不探测真实设备」的定位表述——**这版越过了原红线，必须同步写明，不得悄悄改**。补一段 §7 说明：指纹注入默认关闭、只在显式绑定且显式开启时生效、其目的就是对抗平台的自动化检测
- 验证：人读一遍，确认没有留下与新行为矛盾的旧表述

---

## §7 收尾

- [ ] `pnpm run test:unit` 全绿（基线 496 → 新增用例后 ≥ 530）
- [ ] `pnpm run typecheck` 五路全绿（含新增 `typecheck:fingerprint`）
- [ ] `pnpm run test:b27` 仍 6/6（确认没碰坏协议号链路）
- [ ] `node test/fingerprint-probe/run.mjs` 三条断言全过
- [ ] `./mvnw -pl apps/server test` 全绿
- [ ] `pnpm lint` 无新增告警
