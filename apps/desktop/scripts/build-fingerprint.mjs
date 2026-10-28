/**
 * 页内指纹脚本的独立构建。产物一份：
 *   resources/fingerprint.bundle.js —— IIFE，**不挂全局**（全文由 CDP
 *   `Page.addScriptToEvaluateOnNewDocument` 注入，脚本自己会在文档创建前跑完）。
 *
 * 它是第三份独立产物（R8）：不依赖 wa-js、不依赖 `window.ele`、不发 IPC，
 * 唯一的输入是主进程注入的 `window.__FP_CONFIG__`。
 *
 *   node scripts/build-fingerprint.mjs          # 单次
 *   node scripts/build-fingerprint.mjs --watch  # watch（inline sourcemap，不压缩）
 */
import { build, context } from 'esbuild'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const isWatch = process.argv.includes('--watch')

const config = {
  entryPoints: [path.join(root, 'src/fingerprint/index.ts')],
  bundle: true,
  outfile: path.join(root, 'resources/fingerprint.bundle.js'),
  format: 'iife',
  // 不设 globalName：脚本全文进 CDP，不需要在页面上留下 `__SCRM_*` 之类的痕迹。
  platform: 'browser',
  target: ['chrome100'],
  sourcemap: isWatch ? 'inline' : false,
  minify: !isWatch,
  logLevel: 'info',
  // 跑在第三方页里：console 一律不带出去（C3）。指纹层的失败模式是"不生效"，不上报。
  ...(!isWatch ? { drop: ['console', 'debugger'] } : {})
}

async function main() {
  console.log(`[fingerprint] Build mode: ${isWatch ? 'watch' : 'production'}`)
  if (isWatch) {
    const ctx = await context(config)
    await ctx.watch()
    console.log('[fingerprint] Watching for changes... Press Ctrl+C to stop.')
  } else {
    await build(config)
    console.log('[fingerprint] Build completed successfully')
  }
}

main().catch((e) => {
  console.error('[fingerprint] Build failed:', e)
  process.exit(1)
})
