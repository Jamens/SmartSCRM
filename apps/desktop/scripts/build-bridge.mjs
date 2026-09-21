/**
 * 页内消息桥的独立构建。产物两份：
 *   resources/msg-bridge.bundle.js  —— 我们的桥（IIFE，全局 __SCRM_BRIDGE_BUNDLE__）
 *   resources/wa-js.bundle.js       —— @wppconnect/wa-js 原样搬运（IIFE，末尾 self.WPP = exports）
 * 分两份是刻意的：wa-js 体积按 MB 计、升级节奏与桥不同，
 * 主进程因此可以"先装 wa-js、再装桥"，并且只在页面首次 ready 时装前者。
 *
 *   node scripts/build-bridge.mjs          # 单次
 *   node scripts/build-bridge.mjs --watch  # watch（inline sourcemap，不压缩）
 */
import { build, context } from 'esbuild'
import { copyFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const isWatch = process.argv.includes('--watch')

const WA_SRC = path.join(root, 'node_modules/@wppconnect/wa-js/dist/wppconnect-wa.js')
const WA_OUT = path.join(root, 'resources/wa-js.bundle.js')

const config = {
  entryPoints: [path.join(root, 'src/bridge/index.ts')],
  bundle: true,
  outfile: path.join(root, 'resources/msg-bridge.bundle.js'),
  format: 'iife',
  globalName: '__SCRM_BRIDGE_BUNDLE__',
  platform: 'browser',
  target: ['chrome100'],
  sourcemap: isWatch ? 'inline' : false,
  minify: !isWatch,
  logLevel: 'info',
  // 桥跑在第三方页里：console 一律不带出去（C3），错误只经 report() 回主进程。
  ...(!isWatch ? { drop: ['console', 'debugger'] } : {})
}

async function main() {
  console.log(`[bridge] Build mode: ${isWatch ? 'watch' : 'production'}`)
  await copyFile(WA_SRC, WA_OUT)
  console.log(`[bridge] wa-js -> resources/wa-js.bundle.js`)
  if (isWatch) {
    const ctx = await context(config)
    await ctx.watch()
    console.log('[bridge] Watching for changes... Press Ctrl+C to stop.')
  } else {
    await build(config)
    console.log('[bridge] Build completed successfully')
  }
}

main().catch((e) => {
  console.error('[bridge] Build failed:', e)
  process.exit(1)
})
