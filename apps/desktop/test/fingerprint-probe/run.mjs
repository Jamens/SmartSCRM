// apps/desktop/test/fingerprint-probe/run.mjs
// B14 真机探针入口（spec §1.3 的硬性验收；计划任务 21）。
//
// 与 B27 的 test/protocol-integration/run.mjs 同构：先用 esbuild（JS API）把**真实的**
// applier.ts / runtime.ts（外加 mix32.ts，用来算 Canvas 噪声的期望增量）打成 Node 可跑的 ESM，
// 起一个静态服务托管 probe.html，再 spawn Electron 跑 probe-main.js 拿读数。
//
// 用法：
//   node run.mjs
//
// 三条断言（缺一即失败）：
//   ① 三个值都等于施加值 —— 证明页内脚本早于页面脚本（R4）
//   ② reload() 后三个值不变 —— R3：同一视图生命周期内稳定
//   ③ 换一份 runtime 后三个值改变 —— R3：只有换绑才变
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(__dirname, '../..')
// 从 apps/desktop 解析 esbuild / electron，避免 Windows 下 .bin 启动脚本无法直接 spawn 的问题。
const require = createRequire(resolve(desktopRoot, 'package.json'))
const { build } = require('esbuild')

/** 探针页的画布尺寸，改了 probe.html 这里必须跟着改（像素和 = W*H*4 个字节）。 */
const CANVAS_W = 64
const CANVAS_H = 64
const CANVAS_BYTES = CANVAS_W * CANVAS_H * 4

// 施加值。与 probe-main.js 里那份档案逐字段对齐，两边改一个都要改另一个。
const EXPECT = {
  hardwareConcurrency: 12,
  webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  canvasNoiseSeed: 13579
}
const EXPECT_B = {
  hardwareConcurrency: 4,
  webglRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  canvasNoiseSeed: 97531
}

const applierPath = resolve(desktopRoot, 'src/main/services/fingerprint/applier.ts')
const runtimePath = resolve(desktopRoot, 'src/main/services/fingerprint/runtime.ts')
const mix32Path = resolve(desktopRoot, 'src/fingerprint/core/mix32.ts')
const bundleSource = resolve(desktopRoot, 'resources/fingerprint.bundle.js')
const out = join(__dirname, '_fp.bundle.mjs')

console.log('[fp-probe] bundling applier.ts + runtime.ts + mix32.ts (esbuild) ...')
await build({
  stdin: {
    contents: [
      `export { applyFingerprint } from ${JSON.stringify(applierPath)}`,
      `export { resolveRuntime } from ${JSON.stringify(runtimePath)}`,
      `export { mix32 } from ${JSON.stringify(mix32Path)}`,
      ''
    ].join('\n'),
    resolveDir: desktopRoot,
    loader: 'ts'
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['electron'],
  alias: { '@shared': resolve(desktopRoot, 'src/shared') },
  outfile: out,
  logLevel: 'warning'
})
console.log(`[fp-probe] bundle -> ${out}`)
// Windows 下动态 import 绝对路径会被当成没有协议的 URL，必须转成 file://（两边都是同一个坑）。
const outUrl = pathToFileURL(out).href

// mix32 是页内 Canvas 噪声用的**同一份**实现（无状态查表）：用真源码算期望增量，
// 而不是在断言里写"和基线不同就行"——那会把"噪声恰好抵消"这种真失败也放过去。
const { mix32 } = await import(outUrl)
function canvasDelta(seed) {
  let delta = 0
  for (let i = 0; i < CANVAS_BYTES; i++) {
    if (i % 4 === 3) continue // alpha 不动（页内实现同口径）
    delta += (mix32(seed, i) & 1) === 0 ? -1 : 1
  }
  return delta
}

const html = readFileSync(join(__dirname, 'probe.html'))
const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const probeUrl = `http://127.0.0.1:${server.address().port}/probe.html`
console.log(`[fp-probe] probe page -> ${probeUrl}`)

const electronPath = require('electron')
// 宿主环境里可能带着 ELECTRON_RUN_AS_NODE（比如从另一个 Electron 应用里起这个脚本）：
// 带着它 Electron 会退化成纯 Node，require('electron') 返回的是可执行文件路径而不是 API。
const childEnv = { ...process.env }
delete childEnv.ELECTRON_RUN_AS_NODE

const child = spawn(electronPath, [join(__dirname, 'probe-main.js')], {
  env: { ...childEnv, FP_BUNDLE_PATH: bundleSource, FP_PROBE_URL: probeUrl, FP_BUNDLE_MAIN: outUrl },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true
})

let stdout = ''
let stderr = ''
child.stdout.on('data', (d) => (stdout += String(d)))
child.stderr.on('data', (d) => (stderr += String(d)))

const TIMEOUT_MS = 120_000
const exit = await new Promise((done) => {
  const timer = setTimeout(() => {
    child.kill('SIGKILL')
    done({ code: 'TIMEOUT' })
  }, TIMEOUT_MS)
  child.on('exit', (code) => {
    clearTimeout(timer)
    done({ code })
  })
  child.on('error', (e) => {
    clearTimeout(timer)
    done({ code: 'SPAWN_ERROR', error: e })
  })
})
server.close()

const line = stdout.split('\n').find((l) => l.startsWith('PROBE '))
const errLine = stdout.split('\n').find((l) => l.startsWith('PROBE_ERROR '))

if (exit.code === 'SPAWN_ERROR') {
  // 证据优于声称：起不来就直说起不来，不放宽断言、不伪造读数。
  console.log('[fp-probe] FAIL 本环境未跑通：Electron 无法启动')
  console.log(`[fp-probe]   ${exit.error?.message ?? exit.error}`)
  process.exit(1)
}
if (exit.code === 'TIMEOUT' || !line) {
  console.log(`[fp-probe] FAIL 本环境未跑通：Electron 未能在 ${TIMEOUT_MS}ms 内给出读数（退出码 ${exit.code}）`)
  if (errLine) console.log(`[fp-probe]   ${errLine}`)
  console.log('[fp-probe] --- stdout ---')
  console.log(stdout.trim() || '(空)')
  console.log('[fp-probe] --- stderr ---')
  console.log(stderr.trim().split('\n').slice(-20).join('\n') || '(空)')
  process.exit(1)
}

const data = JSON.parse(line.slice('PROBE '.length))
console.log('[fp-probe] 读数（hc|canvas 像素和|webgl RENDERER）')
console.log(`[fp-probe]   基线（未施加）  ${data.baseline}`)
console.log(`[fp-probe]   施加 A          ${data.appliedA}`)
console.log(`[fp-probe]   A reload 后     ${data.reloadedA}`)
console.log(`[fp-probe]   换成 B          ${data.appliedB}`)
console.log(`[fp-probe]   applyFingerprint(A) applied=${JSON.stringify(data.appliedAResult.applied)} error=${data.appliedAResult.error}`)

const parse = (s) => {
  const [hc, sum, renderer] = String(s).split('|')
  return { hc: Number(hc), sum: Number(sum), renderer }
}
const base = parse(data.baseline)
const a = parse(data.appliedA)
const ar = parse(data.reloadedA)
const b = parse(data.appliedB)

const expectSumA = base.sum + canvasDelta(EXPECT.canvasNoiseSeed)
// B 是在**同一个视图**上二次施加（这才是 R3 说的"换绑"）：CDP 的文档前脚本只会累加不会替换，
// 所以第三次装载跑的是 A、B 两份脚本，Canvas 的像素和是 base + ΔA + ΔB，不是 base + ΔB。
// 断言仍然只要求"变了"——累加是 CDP 的行为，不是指纹层的问题；真要精确等于 ΔB 就得换视图。
const expectSumB = base.sum + canvasDelta(EXPECT.canvasNoiseSeed) + canvasDelta(EXPECT_B.canvasNoiseSeed)

const results = []

// ① 三个值都等于施加值 —— 只有在页面脚本跑之前就装好 hook 才可能成立（R4）。
const c1 =
  a.hc === EXPECT.hardwareConcurrency &&
  a.renderer === EXPECT.webglRenderer &&
  a.sum === expectSumA
results.push({
  ok: c1,
  name: '① 施加值生效（脚本早于页面脚本，R4）',
  detail: `hc ${base.hc}→${a.hc}（期望 ${EXPECT.hardwareConcurrency}）· canvas ${base.sum}→${a.sum}（期望 ${expectSumA}）· renderer "${base.renderer}"→"${a.renderer}"`
})

// ② reload 后三个值不变 —— R3：同一视图生命周期内稳定。
const c2 = ar.hc === a.hc && ar.sum === a.sum && ar.renderer === a.renderer
results.push({
  ok: c2,
  name: '② reload 后不变（R3 生命周期内稳定）',
  detail: `${data.appliedA} → ${data.reloadedA}`
})

// ③ 换一份 runtime 后三个值改变 —— R3：只有换绑才变。
const c3 = b.hc !== a.hc && b.sum !== a.sum && b.renderer !== a.renderer
results.push({
  ok: c3,
  name: '③ 换绑后改变（R3 只有换绑才变）',
  detail: `hc ${a.hc}→${b.hc}（期望 ${EXPECT_B.hardwareConcurrency}）· canvas ${a.sum}→${b.sum}（期望 ${expectSumB}）· renderer "${a.renderer}"→"${b.renderer}"`
})

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}\n     ${r.detail}`)

const passed = results.filter((r) => r.ok).length
console.log('---')
console.log(`汇总：${passed} 通过 / ${results.length - passed} 失败`)
process.exit(passed === results.length ? 0 : 1)
