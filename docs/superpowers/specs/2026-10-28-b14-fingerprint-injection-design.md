# B14 浏览器指纹注入（把档案真正应用到内嵌视图）

日期：2026-10-28
阶段：B14 补齐（现状只有档案 CRUD + 后端确定性模拟生成，生成结果只用于展示，从未下发到视图）
前置：P2b 内嵌视图（`webContentsView/manager.ts`）、B14 指纹档案（`fingerprint_profile`）、A16 权限

---

## 0. 目标与约束

把租户下的指纹档案**真实应用**到内嵌视图上，使同一租户下多个账号的运行环境互相区分，且**每个视图的指纹在其生命周期内稳定不变**。

### 0.1 与现有红线口径的冲突（必须先读）

本仓 README 在 B10 / B13 / B14 / A6 反复写明「模拟生成、不探测真实设备、不接真实 VMOS、不发起真实外连」。而指纹注入执行层（Canvas 噪声、WebGL 伪装、Audio 扰动、Proxy 堆栈伪造）的**全部目的就是让页面的自动化检测读不到真实值**——这是对抗性能力，不是"模拟"。

**决定：全套对齐对标项目，越过现有红线口径。** 因此落地时必须同步修订 README 的定位表述，不得悄悄改（见 §1.1-6）。

仍然守住的两条：

- **指纹档案的生成算法不变**：仍是后端由 seed 派生的确定性模拟，不读取本机任何真实设备信息。
- **安全 posture 不变**：`contextIsolation: true` / `sandbox: true` / `nodeIntegration: false` / `webSecurity: true` 一个都不动。对标项目是靠 `sandbox: false` + `webSecurity: false` 换能力的，本项目不这么做——指纹全部走 `executeJavaScript`（主世界）与 CDP，不需要关沙箱。

### 0.2 核心语义规则（实现与验收都以此为准，不得自行放宽）

| # | 规则 |
|---|---|
| R1 | **指纹按账号绑定**，不是按租户、不是按视图全局。一个账号最多绑一份档案 |
| R2 | **未绑定档案的账号不施加任何指纹**，行为与今天完全一致。不做"兜底生成一份"——静默生效的指纹比没有指纹危险 |
| R3 | **同一视图生命周期内指纹必须稳定**：seed 在视图首次装载时定一次，reload / 重新挂载不变；只有换绑档案才变 |
| R4 | **页内指纹脚本必须早于页面脚本执行**。晚于页面脚本 = 功能未生效，按未完成处理（这不是"更保险"，是 R4 的全部内容） |
| R5 | **能在主进程做的，一律走主进程 API**：UA、Client Hints、`Accept-Language`、时区。这些都随请求头发出，页内脚本改不了 |
| R6 | `debugger.attach` **只在需要时区覆盖时发生，且全生命周期不 detach**——detach 会把时区重置回系统值 |
| R7 | **档案缺某一项 = 该项不改**，不猜、不填默认值。与项目一贯口径一致（对照 `normalize.ts` 的"取不到就留空，不猜"） |
| R8 | **指纹脚本与注入层是两份独立产物**（`fingerprint.bundle.js` 与 `inject.bundle.js`），互不打包进对方。指纹脚本不依赖 wa-js、不依赖 `window.ele` |
| R9 | **每一项指纹能力都可关闭**（全局开关 + 单项开关）。关闭时不产生任何额外 IPC / CDP 调用，不留空跑的定时器 |
| R10 | 指纹参数**只由主进程构造与下发**，渲染层只负责"选哪份档案"，不参与参数拼装 |

---

## 1. 范围

### 1.1 做

| # | 内容 |
|---|---|
| 1 | Flyway `V53__account_fingerprint.sql`：`platform_account.fingerprint_profile_id`（可空，绑定列）；`fingerprint_profile` 补 Client Hints 三列（`ua_platform` / `ua_platform_version` / `brands_json`） |
| 2 | 后端：账号绑定 / 解绑档案接口；账号详情返回**已解析**的指纹参数（`FingerprintRuntime`） |
| 3 | 主进程 `src/main/services/fingerprint/`：参数解析 → UA/Client Hints 覆盖 → `Accept-Language` 劫持 → CDP 时区覆盖 → CDP 文档前脚本注册 |
| 4 | 页内指纹脚本 `src/fingerprint/`（独立 esbuild 产物）：navigator 属性、Canvas、WebGL、Audio、Font、媒体设备枚举、动态 iframe 覆盖、Proxy 堆栈伪造 |
| 5 | 渲染层：账号卡片 / 详情里选档案；设置页加全局开关 |
| 6 | **README 口径修订**（§0.1 的红线表述同步改） |

### 1.2 不做（明确推迟）

- **不动 `contextIsolation` / `sandbox` / `webSecurity`**（§0.1）
- **不做 WebRTC IP 泄漏防护**：v1 不碰 `RTCPeerConnection`，留到确认需要再做
- **不做"指纹是否生效"的应用内自检 UI**：验收走 §1.3 的探针脚本，不往产品里塞调试面
- **不替换档案生成算法**：仍是后端确定性模拟
- **不实现 `screen` / `screenResolution` 的伪造**：分辨率由窗口 bounds 决定，改它需要动 `webContents.setZoomFactor` 与窗口尺寸，牵扯面过大且收益低

### 1.3 验收

| 层 | 条件 |
|---|---|
| 离线 | `pnpm test:unit` 全绿；新增：参数解析（缺项不改）、脚本拼装（开关生效）、绑定关系解析 |
| 类型 | `pnpm typecheck` 四路全绿（含新增的 `typecheck:fingerprint`） |
| **真机（硬性）** | 用一个本地探针页面（自己起的静态页，`document.title` 里吐出 `navigator.hardwareConcurrency` / Canvas 像素和 / WebGL RENDERER），验证：① **在页面自己的脚本运行之前**这些值就已被覆盖；② 同一视图 reload 后值不变；③ 换绑档案后值改变。三条都过才算完成 |

> 真机验收是硬性的。R4 只能这样证伪——不验，就等于写了个不知道有没有生效的东西。

---

## 2. 关键设计

### 2.1 注入时序（R4 / R5 / R6）

```
createView(viewId, url)
  ├─ 主进程：session.setUserAgent(档案 UA)              ← R5，随首个请求头发出，无竞态
  ├─ 主进程：webRequest.onBeforeSendHeaders 改 Accept-Language   ← R5
  ├─ 主进程：debugger.attach('1.3') + Emulation.setTimezoneOverride  ← R6，只在此刻 attach
  ├─ 主进程：debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',
  │            { source: fingerprintBundle })            ← R4，文档创建前，早于任何页面脚本
  └─ loadURL(url)

dom-ready（既有行为，不动）
  ├─ maybeSeed（凭据）
  ├─ runInject（inject.bundle.js —— 翻译层，与指纹无关）
  └─ msgBridge 挂载（wa-js + bridge）
```

**为什么不用对标项目的 `did-navigate` + `executeJavaScript`**：它自己在注释里写「比 dom-ready 快一点点」，本质仍有竞态——WhatsApp Web 的指纹采集脚本可能先跑完，hook 装了等于白装。本项目的 R4 不允许这种"大概率生效"。

**CDP 的代价**：`debugger.attach` 后浏览器进入被调试状态。这是本项目为 R4 主动接受的代价，且只在绑了档案的视图上发生（R2）。

### 2.2 目录结构（三份 bundle 并存）

```
apps/desktop/
├── src/fingerprint/              # 新增：页内指纹脚本（独立产物，不依赖 wa-js / window.ele）
│   ├── index.ts
│   ├── core/hookFrame.ts         # Proxy 通用 hook 框架 + WeakSet 自己人去重
│   ├── core/seededRandom.ts      # mulberry32：同 seed 稳定、不同 seed 各异
│   ├── tasks/canvas.ts           # toDataURL / getImageData 噪声
│   ├── tasks/webgl.ts            # getParameter(VENDOR/RENDERER)
│   ├── tasks/audio.ts            # AudioBuffer 采样扰动
│   ├── tasks/font.ts
│   ├── tasks/navigator.ts        # hardwareConcurrency / deviceMemory / languages / platform / vendor
│   ├── tasks/mediaDevices.ts     # enumerateDevices
│   ├── tasks/iframe.ts           # MutationObserver 覆盖动态 iframe
│   └── *.test.ts
├── src/main/services/fingerprint/
│   ├── bundle.ts                 # 读产物 + 内容哈希（照抄 bridgeBundles 的写法）
│   ├── runtime.ts                # 档案 → FingerprintRuntime 参数解析（R7）
│   ├── applier.ts                # UA / Client Hints / Accept-Language / 时区 / 文档前脚本
│   └── *.test.ts
└── scripts/build-fingerprint.mjs # 第三份 esbuild 构建（照抄 build-bridge.mjs）
```

### 2.3 与现有三层的关系

指纹层**完全独立**：不进 `bridge`（那是采集与发送）、不进 `inject`（那是翻译）、不走 `msg-report`。它唯一的输入是主进程在 `createView` 时注入的一份只读配置 `window.__FP_CONFIG__`。

---

## 3. 风险

| # | 风险 | 处置 |
|---|---|---|
| 1 | **`debugger.attach` 与 DevTools 冲突**：attach 后用户手动开 DevTools 可能异常 | 记录：attach 状态随视图生命周期管理；开发模式下在日志里打一行提示 |
| 2 | **CDP 版本漂移**：`Page.addScriptToEvaluateOnNewDocument` 随 Chromium 演进而改名 | 只用到最稳定的两个命令（`Page.addScriptToEvaluateOnNewDocument` / `Emulation.setTimezoneOverride`），失败时降级为"不施加指纹"并打 warn，**不降级为 did-navigate**（那会违反 R4） |
| 3 | **Canvas 噪声破坏页面自身渲染** | 噪声只作用于**读取路径**（`getImageData` / `toDataURL`），不碰绘制路径。页面自己画的东西一个像素都不变 |
| 4 | **指纹生效 = 页面判定为自动化 = 账号风控** | 这是功能目的，不是缺陷。但 R2 / R9 保证它**只在显式绑定且显式开启时**发生 |
| 5 | **档案参数与真实 UA 冲突**：档案 UA 的 Chrome 大版本与内核实际版本差太远，站点能力探测失真 | R7 已覆盖一部分（缺项不改）；另在 UI 上对"UA 大版本与内核不一致"给出提示，不做自动纠正 |

---

## 4. 未决问题

| # | 问题 | 当前处置 |
|---|---|---|
| Q1 | 指纹脚本出错时是否要上报主进程？页内脚本目前一律 `drop: ['console']` | 暂定：不上报。指纹层的失败模式是"不生效"，R4 由探针验证覆盖，不需要运行时告警。若实测发现需要，再补一条只带错误名的上报 |
| Q2 | 同一账号换绑档案后，是立即重载视图还是下次装载生效？ | 暂定：立即重载视图（R3 要求换绑才变）。重载会丢当前会话未发送内容，UI 需二次确认 |
