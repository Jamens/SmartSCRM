# A18 GPU 崩溃降级与图形开关 设计（2026-10-03）

清单行 **A18**（`docs/feature-checklist.md`，P14 可提前）。形态是桌面客户端的通行做法：
GPU 进程崩了自动切到软件渲染并自愈，用户也能手动关硬件加速、或在降级态手动"重试标准模式"。
**不是** A7 的监控——监控是"看 GPU 占用"，本行是"GPU 崩了怎么办"。

---

## §1 范围与不做

**做**：
1. GPU 后端在 `app.ready` 之前定下来：带 `--gpu-safe-mode` 启动则关 GPU。
2. GPU 子进程崩溃 → 自动记 `gpuSafeMode` 并带 `--gpu-safe-mode` 重启降级（自愈）。
3. 降级态持久化于 `scrm-settings.json`（下次启动默认进降级）。
4. 设置页「图形」卡：硬件加速开关 + 「重试标准模式」按钮。
5. 所有内嵌视图（WebContentsView）的缩放对齐主窗口，并在 DPI / 显示器变化时同步。

**不做（写死，不是"以后再说"）**：
1. **不做崩溃上报 / 遥测**。降级只在本地发生与记录，不上传任何服务端（开源红线：外部服务一律自托管或不接）。
2. **不做图形诊断面板 / 驱动自动修复**。降级模式仍崩时只提示"多半是显卡驱动问题，建议更新驱动"，不替用户改系统。
3. **不做按账号 / 按视图粒度的硬件加速开关**。第一版只有全局一个开关。

---

## §2 数据来源与分工

按"谁知道什么"切，与 A12 角标、A17 通知同一套理由（`lib/unreadBadge.ts` 头注释）：

| 谁 | 知道什么 | 因此负责 |
|---|---|---|
| 启动期（模块顶层） | 本次进程是否带 `--gpu-safe-mode` | 在 `app.ready` 之前把 `disable-gpu` 落到 `commandLine` |
| 主进程 GPU 模块 | GPU 子进程什么时候没、该不该重启、重启带什么参数 | 崩溃检测 + 降级重启 + 重启前的设置落盘 |
| 主进程 settings | `hardwareAcceleration` / `gpuSafeMode` 的权威值 | 合并校验、落盘、广播 |
| `WebContentsViewManager` | 现在开着哪些视图、主窗口缩放多少 | 把缩放对齐到每个视图，并在 DPI 变化时重做 |
| 渲染层 | 开关当前显示什么、用户点了什么 | 把"用户想要的模式"写进设置并请求主进程重启 |

**为什么降级开关必须在 `app.ready` 之前**：Electron 的 `app.commandLine.appendSwitch('disable-gpu')` 只有在 app 进入 ready 之前调用才对本次启动生效。模块顶层（whenReady 之前）是唯一的合法时机，所以它只认**启动参数**（`--gpu-safe-mode`），不读设置文件（读盘要等 ready）。

**为什么崩溃检测不能放渲染层**：`child-process-gone` 是主进程级事件，渲染层收不到；而且重启这种"杀进程"的动作只有主进程能做。渲染层只负责"改设置 + 请主进程重启"。

---

## §3 纯规则（`src/shared/gpu.ts`）

跨进程共用，所以放 shared，与 `shared/badge.ts` 同构（不碰 electron，有单测）。

```ts
export const GPU_DEGRADED_FLAG = '--gpu-safe-mode'

/** 降级模式下 GPU 仍崩溃时主进程推给渲染层的诊断信息。 */
export interface GpuFatalInfo {
  reason: string
  exitCode: number | null
}

/** 本进程是否应当软件渲染（三来源任一为真即降级）。 */
export function resolveDesiredDegraded(o: {
  hardwareAcceleration: boolean
  gpuSafeMode: boolean
  launchedDegraded: boolean
}): boolean

/** 计算下一个启动进程的命令行参数（抹掉旧 flag 再按目标态决定加不加，避免重复叠加）。 */
export function nextRelaunchArgs(argv: string[], desiredDegraded: boolean): string[]
```

不读盘：`readGpuPrefsFromJson` 这类磁盘逻辑留在主进程（shared 不碰 fs）。`resolveDesiredDegraded` 与 `nextRelaunchArgs` 是纯函数，由 `shared/gpu.test.ts`（`node --test`）覆盖：四路 `hardwareAcceleration`×`gpuSafeMode`×`launchedDegraded` 的判定、参数叠加与去重。

---

## §4 主进程（`src/main/gpu.ts`）

```
applyGpuLaunchMode()           // 模块顶层调用：launchedDegraded → appendSwitch('disable-gpu')
ensureGpuModeBeforeWindow()    // whenReady 内、建窗前：设置想要降级但本次没带参 → relaunchGpu(true) 并返回 true
registerGpuCrashHandler()      // whenReady 内、建窗后：监听 child-process-gone
relaunchGpu(desiredDegraded)   // 带参重启（只执行一次）
```

- `applyGpuLaunchMode`：`launchedDegraded()` 为真则 `app.commandLine.appendSwitch('disable-gpu')`。**只认启动参数**——读盘要等 ready，那时再 appendSwitch 已经晚了。
- `ensureGpuModeBeforeWindow`：用 `getSettings()` 重新算 `resolveDesiredDegraded`；若想要降级但本次没带 `--gpu-safe-mode`，`relaunchGpu(true)` 并返回 true，调用方据此 `return` 不再建窗。覆盖"设置改了但进程还没重启"的窗口期。
- `registerGpuCrashHandler`：`app.on('child-process-gone', …)`，只处理 `details.type === 'gpu'`（Electron 39 起 `gpu-process-crashed` 已废弃，改用这个）。关键边界：
  - 正在退出（`getQuitting()`）或已经决定重启（`relaunching`）→ 不动作，避免重复与退出噪音。
  - **已降级仍崩**（`launchedDegraded()` 真）→ 不再重启（否则死循环），改 `win.webContents.send('gpu:fatal', { reason, exitCode })` 让渲染层提示排查驱动。
  - **标准态崩溃** → `patchSettings({ gpuSafeMode: true })` 落盘，再 `relaunchGpu(true)` 带参重启一次。
- `relaunchGpu`：`relaunching` 守卫保证只跑一次；`app.relaunch({ args: nextRelaunchArgs(process.argv.slice(1), desiredDegraded) })` 后 `app.exit(0)`。

`details.type` 是小写 `'gpu'`（ProcessType 字符串字面量），不是 `'GPU'`——这里写错会让整条崩溃检测永不命中。

---

## §5 IPC 与 preload

| 通道 | 方向 | 载荷 |
|---|---|---|
| `gpu:restart` | 渲染 → 主进程（invoke） | `desiredDegraded: boolean` → `boolean` |
| `gpu:fatal` | 主进程 → 渲染（send） | `GpuFatalInfo`（降级态仍崩时） |

preload 增 `scrm.gpu = { restart, onFatal }`，`onFatal` 返回解绑函数（与 `win.onMaximizedChanged` 同形）。`gpu:restart` 的处理器在主进程调 `relaunchGpu`——渲染层不直接碰 `app`。

---

## §6 主进程视图缩放（`src/main/webContentsView/manager.ts`）

```
syncZoomToWindow()   // 给每个视图的 webContents.setZoomFactor(主窗口 getZoomFactor())
```

- 主窗口自身的 `getZoomFactor()` 已经把系统 DPI / 用户缩放折算进去，直接复用，不另算。
- 在 `createView` 末尾调一次（新视图第一帧就对齐，不会先按默认 1.0 闪一下）；
- 在 `index.ts` 建窗后调一次，并注册 `screen.on('display-metrics-changed', () => viewManager.syncZoomToWindow())`——拖到另一块不同 DPI 的屏上比例会漂移，靠这个补。
- `setZoomFactor` 包 try/catch：视图可能正在卸载（webContents 已失效），忽略即可，下个生命周期会重新对齐。

---

## §7 设置项与 UI

`AppSettings`（`main/state/settings.ts`）增两个布尔：

- `hardwareAcceleration: boolean`（默认 **true**）——用户偏好，关 = 软件渲染。
- `gpuSafeMode: boolean`（默认 **false**）——运行时状态，true = 上次因 GPU 崩溃被自动降级。

两者都必须在 `mergeKnown` 里加判定——那是读盘与 `settings:set` 唯一的合并口，漏一处表现为"能写进文件但读不回来"（与 A17 的 `notificationEnabled` 同理由）。

设置页新增「图形」Card（`pages/SettingsPage.tsx`，A15 落点），含：
- **硬件加速**开关：关闭会请求主进程带 `--gpu-safe-mode` 重启（改动必须重启才生效）。
- 若 `gpuSafeMode` 为真：显示"当前处于图形降级模式"提示 + 「重试标准模式」按钮（清 `gpuSafeMode`、开硬件加速、重启进标准模式）。
- 若 `gpuFatal` 有值：提示里补一句"降级模式下 GPU 仍崩溃（原因：…），多半是显卡驱动问题"。
- 浏览器预览宿主（`window.scrm` 不存在）：开关禁用并提示"当前宿主（浏览器预览）没有 GPU 后端可切换"。

渲染层 hook `lib/gpu.ts`：
- `useGpuSettings()`：读初值 → 订阅 `settings:changed` → 写时先翻本地值再 `settings.set` 并 `finally` 调 `gpu.restart`（`.finally` 保证落盘后再重启）。
- `useGpuFatal()`：订阅 `gpu:fatal`。

---

## §8 验收面

| # | 断言 | 手段 |
|---|---|---|
| 1 | `resolveDesiredDegraded` 四路：硬件加速关 → 降级；`gpuSafeMode` 真 → 降级；带参启动 → 降级；三者皆否 → 不降级 | shared 单测 |
| 2 | `nextRelaunchArgs` 标准态抹掉 flag、降级态补上且不重复叠加 | shared 单测 |
| 3 | 带 `--gpu-safe-mode` 启动 → `commandLine` 含 `disable-gpu`，主窗口与视图以软件渲染运行 | 手动 / 启动参数 |
| 4 | 标准态 GPU 崩 → `gpuSafeMode` 落盘为 true，进程带 `--gpu-safe-mode` 重启一次 | 手动注入崩溃 / 日志 |
| 5 | 降级态仍崩 → **不再重启**，渲染层收到 `gpu:fatal` 提示 | 手动 / CDP |
| 6 | 设置页翻硬件加速 → 进程重启后进对应模式，`scrm-settings.json` 持久化 | 手动 / CDP |
| 7 | 「重试标准模式」→ `gpuSafeMode=false` + 硬件加速开 + 重启进标准模式 | 手动 / CDP |
| 8 | DPI / 显示器切换 → 所有 WebContentsView 缩放与主窗口保持一致 | 手动拖屏 |

类型与静态门禁：四路 `pnpm typecheck`（node/web/inject/unit）+ `pnpm test:unit` + `eslint --quiet` 零 error。

---

## §9 陷阱

1. **`disable-gpu` 必须在 `app.ready` 之前 appendSwitch**。晚一步（建窗后）不生效，表现是"开关明明关了、重启后还是 GPU 崩"。所以启动期的 `applyGpuLaunchMode` 只认启动参数，不读设置——设置里的偏好由 whenReady 的 `ensureGpuModeBeforeWindow` 用一次重启补齐。
2. **`details.type` 是小写 `'gpu'`**。写成 `'GPU'` 会让 `child-process-gone` 的 GPU 分支永不命中，整条自愈链路静默失效。
3. **降级态仍崩绝不重启**。`relaunchGpu` 若无条件执行会卡在"崩→重启→崩"死循环，用户连设置页都进不去。所以 `launchedDegraded()` 为真时只推 `gpu:fatal`。
4. **`relaunchGpu` 必须只执行一次**：崩溃事件可能连发，`relaunching` 守卫挡掉重复重启；同时 `getQuitting()` 为真时不动作（退出时 GPU 子进程本就会消失）。
5. **渲染层重启要在落盘之后**：`gpu:restart` 会 `app.exit(0)`，而 `settings:set` 在主进程是同步写盘、promise resolve 时文件已改好；hook 用 `.finally` 保证"写完了再重启"，避免设置没落地就退出。
6. **`--disable-gpu` 会让嵌入式 WebGL 受限**（WhatsApp Web 等重度依赖 GPU）。这是"降级"的代价，已在 §1 写明不做诊断修复；用户可在设置页「重试标准模式」回到标准渲染。
7. **共享规则不碰 disk/electron**：`shared/gpu.ts` 只放纯函数，磁盘读取（settings）留在主进程——否则 shared 的单测要起一个 Electron 环境。
