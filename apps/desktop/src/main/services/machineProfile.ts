/**
 * 设备信息（A14）在主进程这一侧的取值。
 *
 * 拆成两个函数是因为它们**根本不是一种调用**：
 * - `readMachineProfile()` 读的全是进程里的常量，同步、失败不了；
 * - `readStorageUsage()` 要遍历 `userData` 目录，异步、可能读到一半被权限或耗时挡住。
 * 合成一份返回的话，那十行内存里的字段会被目录遍历的耗时拖住——设置页只想早点把它们画出来。
 *
 * 字段口径：`process.*` 与 `app.*` 是"这个应用运行在什么上面"，`os.*` 是"这台机器是什么"。
 * 两边都给，是因为这张卡片的用处就是拿它们对照后端 `device` 表里那几串原文。
 * 取不到的字段一律给空串，"空串在界面上说什么话"由 `@shared/machine` 单点决定。
 */
import fs from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import type { MachineProfile, StorageUsage } from '@shared/machine'

/** 单独一项取不到不该让整张卡片空掉，所以每项各自包一层。 */
function text(read: () => string | undefined): string {
  try {
    return read() ?? ''
  } catch {
    return ''
  }
}

/** 同步取十个字段。 */
export function readMachineProfile(): MachineProfile {
  return {
    platform: text(() => process.platform),
    arch: text(() => process.arch),
    // `os.release()` 是内核版本串（Windows 上形如 10.0.26100），不是产品名。
    release: text(() => os.release()),
    electron: text(() => process.versions.electron),
    chrome: text(() => process.versions.chrome),
    node: text(() => process.versions.node),
    appVersion: text(() => app.getVersion()),
    userData: text(() => app.getPath('userData')),
    locale: text(() => app.getLocale()),
    timezone: text(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  }
}

/** 一次遍历的时间预算。超了就把手上的数交出去，让界面上那个「至少」替我说实话。 */
const WALK_BUDGET_MS = 1500
const WALK_MAX_DEPTH = 12

const NO_USAGE: StorageUsage = { bytes: null, files: null, incomplete: true }

/**
 * 本机数据目录的占用：递归求和 `userData` 下普通文件的大小与个数。
 *
 * 三条口径要写清楚，否则这个数字会被读成"资源管理器里那个数"：
 * - **只算文件**，目录项自身不计（Windows 上恒为 0、macOS 上是一个块，跨平台不可比）；
 * - **符号链接不跟**，既不重复计也不跟环，记为「没读完」；
 * - 读不动的条目（权限、被占用）**只置 `incomplete`，不抛错**——此时给出去的是下界。
 * 根目录本身读不到时返回 `{ bytes: null }`：那才是真的"没有这个信息"，界面上说「未知」。
 */
export async function readStorageUsage(): Promise<StorageUsage> {
  const root = text(() => app.getPath('userData'))
  if (!root) return NO_USAGE
  return walk(root, 0, Date.now() + WALK_BUDGET_MS)
}

async function walk(dir: string, depth: number, deadline: number): Promise<StorageUsage> {
  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    // 根读不到 = 未知；子目录读不到 = 少了一块。这个区别正是"这个数能不能被信"。
    return depth === 0 ? NO_USAGE : { bytes: 0, files: 0, incomplete: true }
  }
  if (depth > WALK_MAX_DEPTH) return { bytes: 0, files: 0, incomplete: true }
  let bytes = 0
  let files = 0
  let incomplete = false
  for (const entry of entries) {
    if (Date.now() > deadline) return { bytes, files, incomplete: true }
    const target = path.join(dir, entry.name)
    try {
      if (entry.isSymbolicLink()) {
        incomplete = true
      } else if (entry.isDirectory()) {
        const inner = await walk(target, depth + 1, deadline)
        if (inner.bytes === null || inner.files === null) {
          incomplete = true
        } else {
          bytes += inner.bytes
          files += inner.files
          incomplete ||= inner.incomplete
        }
      } else if (entry.isFile()) {
        const stat = await fs.stat(target)
        bytes += stat.size
        files += 1
      }
    } catch {
      incomplete = true
    }
  }
  return { bytes, files, incomplete }
}
