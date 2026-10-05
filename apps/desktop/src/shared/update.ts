/**
 * A6 自动更新——纯模型：自托管更新清单的形状、解析与版本比对。
 *
 * 放 shared 的理由与 `machine`/`perf` 同源：真正需要"只有一份"、且必须可单测的是
 * **"这份 JSON 算不算合法更新清单"** 与 **"latest 是不是比 current 新"** 这两个判定。
 * 拉网络与落盘在主进程（`services/updateChecker.ts`），这里不碰 I/O。
 *
 * 红线：本仓开源，更新源由部署方自托管；清单为空/未配 = 不检查、不外连。
 */

/** 一份合法的更新清单。`version` 是目标版本；`downloadUrl` 指向更新包（自托管）。 */
export interface UpdateManifest {
  version: string
  downloadUrl: string
  notes: string | null
  /** 更新包 sha256（十六进制）；给了就在下载后校验，不给就只记录不校验。 */
  sha256: string | null
}

/** 检查结论。`disabled` = 没配更新源（默认）；`uptodate` = 已是最新；`available` = 有新版。 */
export type UpdateStatus = 'disabled' | 'uptodate' | 'available' | 'error'

export interface UpdateVerdict {
  status: UpdateStatus
  current: string
  latest: string | null
  downloadUrl: string | null
  notes: string | null
  /** status==='error' 时的可读原因；成功时 null。 */
  error: string | null
}

/** 解析更新清单：形状不对就返回 null（宁可当作"没更新"，也不拿半截数据去下载）。 */
export function parseUpdateManifest(raw: unknown): UpdateManifest | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const version = typeof o.version === 'string' ? o.version.trim() : ''
  const downloadUrl = typeof o.downloadUrl === 'string' ? o.downloadUrl.trim() : ''
  if (!version || !downloadUrl) return null
  return {
    version,
    downloadUrl,
    notes: typeof o.notes === 'string' ? o.notes : null,
    sha256: typeof o.sha256 === 'string' ? o.sha256.trim() : null
  }
}

/**
 * 点分数字版本比较（`1.2.3`）：逐段按数字比，缺失段当 0；多出的大段算更新。
 * 任一段非纯数字（如 `1.2.3-beta` 的尾段）→ 保守判"不是更新"，不猜预发布语义。
 */
export function isNewerVersion(latest: string, current: string): boolean {
  const lp = parseVersion(latest)
  const cp = parseVersion(current)
  if (!lp || !cp) return false
  const len = Math.max(lp.length, cp.length)
  for (let i = 0; i < len; i++) {
    const l = lp[i] ?? 0
    const c = cp[i] ?? 0
    if (l > c) return true
    if (l < c) return false
  }
  return false
}

/** 纯数字点分段；任一段含非数字（预发布/后缀）→ null。 */
function parseVersion(v: string): number[] | null {
  const trimmed = (v ?? '').trim()
  if (!trimmed) return null
  const parts = trimmed.split('.')
  const out: number[] = []
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null
    out.push(Number(p))
  }
  return out
}

/** 没配更新源时的结论——默认路径，不外连。 */
export function disabledVerdict(current: string): UpdateVerdict {
  return { status: 'disabled', current, latest: null, downloadUrl: null, notes: null, error: null }
}

/** 由"清单 + 当前版本"得出结论的纯函数（主进程拉完清单后调它，不碰 I/O 好单测）。 */
export function verdictFrom(manifest: UpdateManifest | null, current: string): UpdateVerdict {
  if (!manifest) {
    return { status: 'error', current, latest: null, downloadUrl: null, notes: null, error: '清单不合法' }
  }
  if (!isNewerVersion(manifest.version, current)) {
    return { status: 'uptodate', current, latest: manifest.version, downloadUrl: null, notes: null, error: null }
  }
  return {
    status: 'available',
    current,
    latest: manifest.version,
    downloadUrl: manifest.downloadUrl,
    notes: manifest.notes,
    error: null
  }
}
