# A19 分类日志落盘 + 日志中心 设计（2026-10-03）

清单行 **A19**（`docs/feature-checklist.md`，P14 可提前）。桌面客户端的排查基线：主进程四类日志 +
未处理 Promise 拒绝 + 批量刷盘，配一个能筛选/导出查看的日志中心页。**只落本地，不上报服务端。**

---

## §1 范围与不做

**做**：
1. 主进程日志按四类归集：`app`（生命周期/设置/任务栏等宿主能力）、`ipc`（渲染↔主进程调用）、
   `bridge`（内嵌页桥接：msgBridge/inject/batch/group）、`error`（错误与未处理拒绝）。
2. 接管 `console.*`：现有 50+ 处带 `[tag]` 前缀的 `console.log/warn/error` 自动按 tag 归到四类并落盘，调用点一个都不用改。
3. 捕获进程级错误：`uncaughtException` 与 `unhandledRejection` 归 `error` 类。
4. 批量落盘：内存留最近 5000 条供 UI 实时读；磁盘按天切文件、攒够一批再写；退出前 flush。
5. 日志中心页：按类别/级别筛选、刷新、清空、打开日志目录（系统文件管理器）。
6. IPC 调用记录：每个 `ipcMain.handle` 调用记一条 debug 级 `ipc` 日志（含耗时与成败）。

**不做（写死）**：
1. **不做遥测/上报**。日志只落本地 `userData/logs`，绝不外传任何服务端（开源红线）。
2. **不做日志上传/分享到云端**、不做 Web 端查看（浏览器预览没有主进程，页面如实说"桌面端才可用"）。
3. **不做结构化远程告警**。error 类只是"能在日志中心看到真出事了"，不接任何通知渠道。
4. **不做日志内容脱敏**。落盘的是主进程运行日志（不含凭据——凭据走 `session.ts` 加密区，不进这里）；若日后要打敏感字段再单独评估。

---

## §2 数据来源与分工

| 谁 | 知道什么 | 因此负责 |
|---|---|---|
| `shared/log.ts` | 类别/级别/条目的形状与判定规则 | 纯函数，主进程与渲染层共用，有单测 |
| `main/logger.ts` | 内存环 + 磁盘刷盘 + console 接管 + 进程错误 + IPC 记录 | 唯一的日志权威，不碰 UI |
| `main/ipc.ts` | 把内存环暴露给渲染层（`logs:list`）、打开目录、清空 | 平台动作只在主进程 |
| `preload` | `scrm.logs.{list,openFolder,clear}` | IPC 透传 |
| `renderer/lib/logs.ts` | 轮询拉取、刷新、清空、打开目录 | 渲染层只持有快照 |
| `renderer/pages/LogCenterPage.tsx` | 筛选 UI + 列表呈现 | 只展示，不持有权威数据 |

**为什么接管 console 而不是让所有人改 `logger.xxx`**：主进程已经用 `console.*` 打了满屏带 `[tag]` 的日志，
50+ 处调用点逐个改既繁琐又易漏。在启动期把 `console` 接管掉，同样的调用自动归类落盘，零改动。
"`[tag]` → 类别"的映射在 `shared/log.ts` 的 `inferCategory` 里，是稳定契约。

**为什么内存环 + 批量落盘**：每条日志都来一次 `fs` syscall 会把主进程 IO 拖垮；
攒一批（1.5s 一次 unref 定时器 + 退出前 flush）既保证不丢最后的日志，又平摊了写盘成本。

---

## §3 纯规则（`src/shared/log.ts`）

跨进程共用，放 shared，与 `shared/badge.ts` 同构（不碰 electron，有单测）。

```ts
export type LogCategory = 'app' | 'ipc' | 'bridge' | 'error'
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export interface LogEntry { id: number; ts: number; category: LogCategory; level: LogLevel; message: string; meta?: unknown }
export interface LogFilter { category?: LogCategory | 'all'; level?: LogLevel | 'all'; limit?: number }

/** 由 [tag] 前缀与级别推断类别：level==='error' 一律归 error 类。 */
export function inferCategory(tag: string | null, level: LogLevel): LogCategory
/** 解析 console 首个参数里的 [tag]。 */
export function parseTag(firstArg: unknown): string | null
/** 单行落盘格式：<iso> [LEVEL] [CATEGORY] message[ :: meta]。 */
export function formatLogLine(e: LogEntry): string
```

`inferCategory` / `parseTag` / `formatLogLine` 由 `shared/log.test.ts`（`node --test`）覆盖：tag→类别映射、error 级别全覆盖、无 tag 默认 app、meta 序列化。

---

## §4 主进程（`src/main/logger.ts`）

```
installLogger()        // whenReady 内、建窗前：目录 + console 接管 + 进程错误 + 批量刷盘定时器 + 启动行
installIpcLogging()    // registerIpcHandlers 之前：包一层 ipcMain.handle 记录每次调用
flushLogs()            // 攒着的行落盘；before-quit 调一次
getLogs(filter)        // 内存环按 filter 取最新 N 条
clearLogs()            // 清空内存环 + 截断当天日志文件
openLogsFolder()       // shell.openPath(userData/logs)
```

- **递归防护**：`emit` 不碰 `console`，所以接管后的 `console.*` 调 `emit` 不会回到自己身上。
- **console 接管**：`wrap` 保留原方法（仍打到 devtools），同时 `emit(inferCategory(tag, level), ...)`。
- **进程错误**：`process.on('uncaughtException'|'unhandledRejection')` → `emit('error','error', ...)`。
- **IPC 记录**：`installIpcLogging` 把 `ipcMain.handle` 换成"包一层记录耗时与成败"的版本，必须在 `registerIpcHandlers` 之前调用（否则 handler 没被包上）。记录是 debug 级，可按级别过滤掉。
- **磁盘**：`userData/logs/scrm-<YYYY-MM-DD>.log`，按天切；`appendFileSync` 批量写；`clearLogs` 用 `writeFileSync('')` 截断。
- **退出 flush**：`index.ts` 的 `before-quit` 里调 `flushLogs()`，否则最后 1.5s 的日志会丢。

---

## §5 IPC 与 preload

| 通道 | 方向 | 载荷 |
|---|---|---|
| `logs:list` | 渲染 → 主进程（invoke） | `LogFilter \| undefined` → `LogEntry[]` |
| `logs:open-folder` | 渲染 → 主进程（invoke） | 无 → 无（`shell.openPath` 打开系统文件管理器） |
| `logs:clear` | 渲染 → 主进程（invoke） | 无 → 无 |

preload 增 `scrm.logs = { list, openFolder, clear }`。**渲染层只读内存环，不读磁盘大文件**——日志可能很大，直接读文件会卡 UI；导出/排查用"打开日志目录"走系统文件管理器。

---

## §6 渲染层

`lib/logs.ts` 的 `useLogs(category, level)`：轮询（`setInterval` 2s）+ 手动刷新 + 清空 + 打开目录。
轮询而非订阅的理由：日志是排查用的，不是实时仪表盘，2s 延迟可接受，也省得每条日志推一次 IPC。

`pages/LogCenterPage.tsx`（落点 `/logs`，导航新增「日志中心」项）：
- 顶部：类别下拉（全部 / app / ipc / bridge / error）、级别下拉（全部 / debug / info / warn / error）、刷新、打开日志目录、清空。
- 列表：等宽字体，每条显示 时间 / 类别徽标 / 级别 / 消息。
- 浏览器预览宿主：如实显示"日志由主进程产生，桌面端打开才能查看与导出"。
- 顶部副标题写明"只落本地、不上报服务端"（红线陈述）。

---

## §7 验收面

| # | 断言 | 手段 |
|---|---|---|
| 1 | `inferCategory`：error 级别覆盖任意 tag；`[msgBridge]`/`[batch]`/`[inject]`/`[group]`→bridge；`[ipc]`→ipc；`[settings]`/`[badge]`→app；无 tag→app | shared 单测 |
| 2 | `formatLogLine` 含 iso/level/category/message，meta 序列化成行尾 | shared 单测 |
| 3 | 启动期 console 接管生效：任意 `console.log('[msgBridge] x')` 进 bridge 类内存环 | 手动 / 内存环断言 |
| 4 | `uncaughtException` / `unhandledRejection` 进 error 类 | 手动抛错 |
| 5 | `logs:list` 按类别/级别/limit 过滤返回最新 N 条；`logs:clear` 清空内存环与当天文件 | 主进程 + CDP |
| 6 | 退出前最后 1.5s 日志已落盘（磁盘文件非空） | 手动重启比对 |
| 7 | 日志中心页可按类别/级别筛选、打开目录、清空；浏览器预览显示提示 | CDP |

类型与静态门禁：四路 `pnpm typecheck` + `pnpm test:unit` + `eslint --quiet` 零 error。

---

## §8 陷阱

1. **`emit` 不能碰 `console`**：否则接管后的 `console.*` → `emit` → 又调 `console` → 死循环爆栈。所有落盘/内存操作都不许走 console。
2. **`installIpcLogging` 必须在 `registerIpcHandlers` 之前**：它是通过替换 `ipcMain.handle` 实现的，handler 注册在那之后才被包上；顺序反了 IPC 调用就没有记录。
3. **`app.getPath('userData')` 要等 ready**：`installLogger` 在 whenReady 内调用，别提前到模块顶层。
4. **批量刷盘要 unref 定时器 + 退出前 flush**：unref 保证没别的事时进程能正常退出；`before-quit` 里的 `flushLogs` 保证最后 1.5s 日志不丢。
5. **渲染层只读内存环**：直接读磁盘大日志文件会卡 UI；导出走"打开日志目录"。
6. **共享规则不碰 disk/electron**：`shared/log.ts` 只放纯函数，磁盘/进程逻辑留在主进程——否则 shared 单测要起 Electron 环境。
