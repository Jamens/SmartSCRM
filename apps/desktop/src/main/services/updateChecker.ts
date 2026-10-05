/**
 * A6 自动更新——主进程侧：拉自托管清单、比对版本、按需下载更新包到本地目录。
 *
 * 红线：更新源**由部署方自托管并配置**；`updateManifestUrl` 为空（默认）时直接返回
 * `disabled`，一个网络请求都不发，绝不外连任何商业云。
 *
 * 本版只到"检查 + 通知 + 下载到本地目录"，**不自动安装/替换 exe**（Windows 下替换正在
 * 运行的程序有坑，留给后续）。纯判定（清单解析/版本比对）在 `@shared/update`，那里有单测。
 */
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { app } from 'electron'
import {
  disabledVerdict,
  parseUpdateManifest,
  verdictFrom,
  type UpdateVerdict
} from '@shared/update'

/** 拉清单 + 比版本。`manifestUrl` 空 ⇒ disabled（不外连）。网络/形状错 ⇒ error，不当成"无更新"。 */
export async function checkForUpdate(manifestUrl: string, currentVersion: string): Promise<UpdateVerdict> {
  const url = (manifestUrl ?? '').trim()
  if (!url) return disabledVerdict(currentVersion)
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    if (!res.ok) {
      return { status: 'error', current: currentVersion, latest: null, downloadUrl: null, notes: null, error: `清单 HTTP ${res.status}` }
    }
    const manifest = parseUpdateManifest(await res.json())
    return verdictFrom(manifest, currentVersion)
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e)
    return { status: 'error', current: currentVersion, latest: null, downloadUrl: null, notes: null, error: `拉清单失败: ${why}` }
  }
}

/**
 * 把更新包下载到 `app.getPath('downloads')`，返回落盘绝对路径。**不执行、不安装**。
 * 文件名取 URL 末段，太长/为空则退回 `scrm-update.bin`。
 */
export async function downloadUpdate(downloadUrl: string): Promise<string> {
  const dir = app.getPath('downloads')
  await mkdir(dir, { recursive: true })
  const base = downloadUrl.split('?')[0].split('/').pop() || ''
  const safe = /^[A-Za-z0-9._-]{1,80}$/.test(base) ? base : 'scrm-update.bin'
  const dest = join(dir, safe)
  const res = await fetch(downloadUrl)
  if (!res.ok || !res.body) throw new Error(`下载 HTTP ${res.status}`)
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(dest))
  return dest
}
