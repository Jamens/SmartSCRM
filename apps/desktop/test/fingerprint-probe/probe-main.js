// apps/desktop/test/fingerprint-probe/probe-main.js
//
// B14 真机探针的 Electron 主脚本。由 run.mjs spawn 起来，跑完把四条读数打到 stdout 后退出。
//
// 它施加的是**真实的** applier / runtime（run.mjs 用 esbuild 打好的那份 ESM），不复制一份逻辑，
// 也不手搓注入脚本——手搓的能绿，但绿的是手搓的那份，不是产品里跑的那份（R4 只能这样证伪）。
//
// 隔离设置与主进程建视图同口径：contextIsolation / sandbox / nodeIntegration / webSecurity
// 一个都不动（spec §0.1）。指纹全部走 CDP 文档前脚本，不需要靠关沙箱换能力。
const { app, BrowserWindow, WebContentsView } = require('electron')
const { readFileSync, writeSync } = require('node:fs')

/** run.mjs 通过环境传进来：页内产物路径、探针页地址、esbuild 产物路径。 */
const BUNDLE_PATH = process.env.FP_BUNDLE_PATH
const PROBE_URL = process.env.FP_PROBE_URL
const FP_MODULE = process.env.FP_BUNDLE_MAIN

let seq = 0

// 无缓冲写：挂在某一路时，被看门狗 app.exit 掉的是**缓冲里的**日志，那只会把人引到错的那一路上。
const step = (msg) => writeSync(1, 'STEP ' + msg + '\n')

// 兜底看门狗：真机探针挂在某一路上时，宁可自己退出并留一句 STEP 线索，也不要挂到调用方超时被杀——
// 被杀的时候 stdout 里什么都没有，排查只能靠猜。
setTimeout(() => {
  step('WATCHDOG 60s 未跑完，主动退出')
  app.exit(4)
}, 60_000)

// 让 Chromium 在没有可用 GPU 的机器上走 SwiftShader 软件 WebGL（写进 commandLine 而不是 CLI 参数：
// Electron 只认自己那份开关白名单，不认识的命令行开关会被当成 bad option 直接拒掉）。
// 这是让 WebGL **可用**，不是放松断言——真取不到 RENDERER 时第 ① 条照样判失败。
app.commandLine.appendSwitch('enable-unsafe-swiftshader')

async function makeView(win) {
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      // 每个视图独占分区：施加指纹会动 session 级 UA，共用分区会串到别的视图上。
      partition: `persist:fp-probe-${++seq}`
    }
  })
  // 探针页是本机临时服务，而宿主环境可能带着 http_proxy——Chromium 会老老实实把 localhost
  // 的请求也送去代理，然后一直挂着。这里显式走直连（这一趟只访问本机），不依赖开关被不被认。
  await view.webContents.session.setProxy({ mode: 'direct' })
  win.contentView.addChildView(view)
  view.setBounds({ x: 0, y: 0, width: 800, height: 600 })
  return view
}

/**
 * 等这一轮装载落地。三选一：did-finish-load / did-fail-load / 15s 兜底。
 *
 * 兜底不是"放宽断言"——等不到就放行，读数照读，判 FAIL 的是后面的断言而不是这里的等待。
 * 挂住不返回只会让整个探针被外层的超时杀掉，stdout 里什么都不剩。
 */
function loaded(wc) {
  return new Promise((resolve) => {
    let done = false
    const fire = (why) => {
      if (done) return
      done = true
      wc.removeListener('did-finish-load', ok)
      wc.removeListener('did-fail-load', bad)
      step('  等到了：' + why)
      resolve()
    }
    const ok = () => fire('did-finish-load')
    const bad = (_e, code, desc) => fire(`did-fail-load ${code} ${desc}`)
    wc.on('did-finish-load', ok)
    wc.on('did-fail-load', bad)
    setTimeout(() => fire('15s 兜底'), 15_000)
  })
}

async function loadAndRead(view, url) {
  const wc = view.webContents
  step('  loadURL ' + url)
  const done = loaded(wc)
  await wc.loadURL(url)
  await done
  return readTitle(wc)
}

async function reloadAndRead(wc) {
  step('  reload')
  const done = loaded(wc)
  wc.reload()
  await done
  return readTitle(wc)
}

async function readTitle(wc) {
  // 用 getTitle 而不是 executeJavaScript：后者在隐藏窗口里的沙箱 WebContentsView 上会一直不回
  // （实测 Electron 39 / 本机环境），而标题在页面脚本里是同步写好的，装载完成后必然已是它。
  const title = wc.getTitle()
  step('  读到：' + JSON.stringify(title))
  return title
}

async function main() {
  step('importing bundled applier/runtime')
  const fp = await import(FP_MODULE)
  const bundle = readFileSync(BUNDLE_PATH, 'utf8')

  const win = new BrowserWindow({ show: false, width: 800, height: 600 })
  const out = {}

  // ① 基线：不施加任何指纹（对应 R2 的"未绑定档案"）。后面算 Canvas 期望值要用它的像素和。
  step('baseline: load without fingerprint')
  const v0 = await makeView(win)
  out.baseline = await loadAndRead(v0, PROBE_URL)

  // ② 施加 A。
  //
  // 走的就是产品里的 D3 顺序：**建视图 → 施加 → 首次 loadURL**，一次逆都不做。
  // 未导航过的视图上没有 CDP target（实测 attach 会成功、之后任何 CDP 命令永久不返回），
  // applier 自己先导航一次 about:blank 把 target 拿到手；文档前脚本登记完之后才发第一个请求，
  // 所以首屏的这个文档里，指纹脚本已经早于页面脚本跑完了（R4）。
  step('apply A on a fresh view (create → apply → first loadURL)')
  const runtimeA = fp.resolveRuntime(PROFILE_A, { enabled: true, toggles: {} })
  const v1 = await makeView(win)
  const resA = await fp.applyFingerprint(v1.webContents, runtimeA, bundle)
  out.appliedAResult = { applied: resA.applied, error: resA.error ?? null }
  out.appliedA = await loadAndRead(v1, PROBE_URL)

  // ③ 同视图再 reload：R3 要求同一生命周期内稳定。
  out.reloadedA = await reloadAndRead(v1.webContents)

  // ④ 同一视图上换成 B：R3 要求只有换绑才变。
  step('apply B on the same view')
  const runtimeB = fp.resolveRuntime(PROFILE_B, { enabled: true, toggles: {} })
  const resB = await fp.applyFingerprint(v1.webContents, runtimeB, bundle)
  out.appliedBResult = { applied: resB.applied, error: resB.error ?? null }
  out.appliedB = await reloadAndRead(v1.webContents)

  writeSync(1, 'PROBE ' + JSON.stringify(out) + '\n')
}

/** 与后端 FingerprintRuntimeVO 逐字段同形的两份固定档案。seed / 噪声种子都是写死的——探针要的是可复现。 */
const PROFILE_A = {
  profileId: 1,
  seed: 20261028,
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  uaPlatform: '"Windows"',
  uaPlatformVersion: '"15.0.0"',
  brands: [{ brand: 'Chromium', version: '140' }],
  locale: 'en-US',
  timezone: 'Asia/Shanghai',
  hardwareConcurrency: 12,
  deviceMemory: 8,
  webglVendor: 'Google Inc. (NVIDIA)',
  webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  canvasNoiseSeed: 13579,
  audioNoiseSeed: 24680
}

const PROFILE_B = {
  profileId: 2,
  seed: 20261029,
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
  uaPlatform: '"macOS"',
  uaPlatformVersion: '"14.7.1"',
  brands: [{ brand: 'Chromium', version: '139' }],
  locale: 'ja-JP',
  timezone: 'Asia/Tokyo',
  hardwareConcurrency: 4,
  deviceMemory: 4,
  webglVendor: 'Google Inc. (Intel)',
  webglRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  canvasNoiseSeed: 97531,
  audioNoiseSeed: 86420
}

app
  .whenReady()
  .then(main)
  .catch((e) => {
    writeSync(1, 'PROBE_ERROR ' + (e && e.stack ? e.stack : String(e)) + '\n')
    process.exitCode = 1
  })
  .finally(() => app.quit())
