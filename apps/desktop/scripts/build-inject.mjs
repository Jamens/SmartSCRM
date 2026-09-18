/**
 * Standalone build for the injected page scripts.
 * Produces resources/inject.bundle.js (IIFE) that the main process loads into WebContentsViews.
 *
 *   node scripts/build-inject.mjs          # single build
 *   node scripts/build-inject.mjs --watch  # watch mode (inline sourcemap)
 */
import { build, context } from 'esbuild'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const isWatch = process.argv.includes('--watch')

const config = {
  entryPoints: [path.join(root, 'src/inject/index.ts')],
  bundle: true,
  outfile: path.join(root, 'resources/inject.bundle.js'),
  format: 'iife',
  globalName: '__SCRM_INJECT_BUNDLE__',
  platform: 'browser',
  target: ['chrome100'],
  sourcemap: isWatch ? 'inline' : false,
  minify: !isWatch,
  logLevel: 'info',
  ...(!isWatch ? { drop: ['console'] } : {})
}

async function main() {
  console.log(`[inject] Build mode: ${isWatch ? 'watch' : 'production'}`)
  if (isWatch) {
    const ctx = await context(config)
    await ctx.watch()
    console.log('[inject] Watching for changes... Press Ctrl+C to stop.')
  } else {
    await build(config)
    console.log('[inject] Build completed successfully')
  }
}

main().catch((e) => {
  console.error('[inject] Build failed:', e)
  process.exit(1)
})
