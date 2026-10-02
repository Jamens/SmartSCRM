// apps/desktop/test/protocol-integration/run.mjs
// B27 离线联调入口：先用 esbuild（JS API）把「真实的」manager.ts（含 client.ts）打成 Node 可跑的 ESM 包，
// 再跑 b27-offline-integration.mjs 接入 mock 协议网关做端到端验证。
//
// 用法：
//   node run.mjs
// 或（已配 npm script）：
//   pnpm test:b27

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
// 从 apps/desktop 解析 esbuild，避免 Windows 下 .bin/esbuild 启动脚本无法直接 spawn 的问题
const require = createRequire(resolve(__dirname, '../../package.json'))
const { build } = require('esbuild')

const entry = resolve(__dirname, '../../src/renderer/src/services/protocol/manager.ts')
const sharedAlias = resolve(__dirname, '../../src/shared')
const out = join(__dirname, '_b27_manager.bundle.mjs')

console.log('[b27] bundling manager.ts (esbuild) ...')
await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  alias: { '@shared': sharedAlias },
  outfile: out,
  logLevel: 'warning'
})
console.log(`[b27] bundle -> ${out}`)

const { runB27 } = await import('./b27-offline-integration.mjs')
await runB27()
