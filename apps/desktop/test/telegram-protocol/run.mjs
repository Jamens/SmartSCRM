// 期一：契约层，未经真机验证
// 期二待办：把 mock 网关换成真实 MTProto 网关后，本 runner 的启动方式不变（仍是 esbuild 打真实 manager.ts），
//           只需把 tgBaseUrl/tgWsUrl 指向真实网关，并逐条实测四个待实测字段
// 契约见 docs/superpowers/specs/2026-10-28-telegram-mtproto-collection-design.md
//
// apps/desktop/test/telegram-protocol/run.mjs
// TG 期一离线联调入口：先用 esbuild（JS API）把「真实的」manager.ts（含 client.ts）打成 Node 可跑的 ESM 包，
// 再跑 tg-offline-integration.mjs 接入 mock TG 网关做端到端验证。
//
// 用法：
//   node run.mjs
// 或（已配 npm script）：
//   pnpm test:tg

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
// 从 apps/desktop 解析 esbuild，避免 Windows 下 .bin/esbuild 启动脚本无法直接 spawn 的问题
const require = createRequire(resolve(__dirname, '../../package.json'))
const { build } = require('esbuild')

const entry = resolve(__dirname, '../../src/renderer/src/services/protocol/manager.ts')
const sharedAlias = resolve(__dirname, '../../src/shared')
const out = join(__dirname, '_tg_manager.bundle.mjs')

console.log('[tg] bundling manager.ts (esbuild) ...')
await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  alias: { '@shared': sharedAlias },
  outfile: out,
  logLevel: 'warning'
})
console.log(`[tg] bundle -> ${out}`)

const { runTG } = await import('./tg-offline-integration.mjs')
await runTG()
