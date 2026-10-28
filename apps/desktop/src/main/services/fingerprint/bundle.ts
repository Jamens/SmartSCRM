// src/main/services/fingerprint/bundle.ts
import { createHash } from 'crypto'
import { readFileSync, statSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

/**
 * 指纹页内脚本产物（spec R8：`fingerprint.bundle.js` 与 `inject.bundle.js` 是两份独立产物）。
 * 写法照抄 `msgBridge/bridgeMount.ts` 的 `bridgeBundles()`：按 mtime 缓存、版本号 = 内容 SHA1 前 12 位。
 * 不手填版本 —— 改了代码忘了改版本号是最难查的一类 bug。
 */
export interface FingerprintBundle {
  source: string
  version: string
}

function resourcePath(name: string): string {
  return app.isPackaged ? join(process.resourcesPath, name) : join(app.getAppPath(), 'resources', name)
}

let cached: { mtime: number; bundle: FingerprintBundle } | null = null

/**
 * 产物不存在（没构建 / 打包漏了）时返回 `null`，让调用方降级为"不施加指纹"（R4 的失败处置），
 * 而不是让整个建视图流程崩掉。指纹是增强，不是能跑起来的前提。
 */
export function fingerprintBundle(): FingerprintBundle | null {
  try {
    const path = resourcePath('fingerprint.bundle.js')
    const mtime = statSync(path).mtimeMs
    if (cached && cached.mtime === mtime) return cached.bundle
    const source = readFileSync(path, 'utf-8')
    const bundle: FingerprintBundle = {
      source,
      version: createHash('sha1').update(source).digest('hex').slice(0, 12)
    }
    cached = { mtime, bundle }
    return bundle
  } catch {
    return null
  }
}
