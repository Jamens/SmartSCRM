// src/main/services/groupCollect/export.ts
//
// 群成员导出（spec §10）。本模块只做"拉数据 + 生成 XLSX + 落盘"，不碰 electron——
// `dialog.showSaveDialog` 留在 ipc.ts 的 group:export 处理器里（运行时才加载，不进单测）。
//
// 14 列表头与 shared/groupMembers.ts 的 EXPORT_COLUMNS 逐一对齐；行序由后端钉死
// （群按 chatKeys 顺序、群内按 latest_join_at 升序、seq 跨群连续），客户端只按序映射。

import ExcelJS from 'exceljs'
import { writeFile } from 'node:fs/promises'
import {
  EXPORT_COLUMNS,
  MAX_EXPORT_GROUPS,
  formatExportTime,
  oneLine,
  type GroupExportResult
} from '../../../shared/groupMembers.ts'

/** 与后端 GroupExportRowVO 逐字段对齐（列序即 VO 字段序）。 */
export interface GroupExportRow {
  seq: number | null
  groupName: string | null
  groupId: string | null
  phone: string | null
  name: string | null
  role: string | null
  inGroup: string | null
  joinAt: string | null
  joinCount: number | null
  leaveAt: string | null
  exitMethod: string | null
  lastMsgAt: string | null
  dayMsgCount: number | null
  msgCount: number | null
}

/** 字段顺序必须和 EXPORT_COLUMNS 逐列对齐（spec §10 列序钉死）。 */
const ROW_FIELDS = [
  'seq',
  'groupName',
  'groupId',
  'phone',
  'name',
  'role',
  'inGroup',
  'joinAt',
  'joinCount',
  'leaveAt',
  'exitMethod',
  'lastMsgAt',
  'dayMsgCount',
  'msgCount'
] as const

/** 后端那列是 VARCHAR(128)，超长会让整次取数 400。与 `@shared/chatKeys` 的裁剪同口径。 */
const CHAT_KEY_MAX = 128

export interface ExportFetchOptions {
  token: () => string | null
  apiBase?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

interface Envelope<T> {
  code: number
  message?: string
  data?: T
}

function cell(field: (typeof ROW_FIELDS)[number], value: unknown): string | number {
  if (value === null || value === undefined) return ''
  // 时刻文本的唯一作者是 shared 的 formatExportTime（R46）：导出表格与渲染层名单共用一份，
  // 两处各写一遍就会在"文件到秒、界面到毫秒"这种缝里错开。
  if (field === 'joinAt' || field === 'leaveAt' || field === 'lastMsgAt') return formatExportTime(String(value))
  return value as string | number
}

async function callGet<T>(path: string, opts: ExportFetchOptions): Promise<T | null> {
  const token = opts.token()
  if (!token) return null
  const doFetch = opts.fetchImpl ?? fetch
  const base = (opts.apiBase ?? 'http://localhost:8180').replace(/\/$/, '')
  try {
    const res = await doFetch(`${base}${path}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000)
    })
    if (!res.ok) return null
    const env = (await res.json()) as Envelope<T>
    return env.code === 0 && env.data !== undefined ? env.data : null
  } catch {
    return null
  }
}

/**
 * 拉导出取数。
 *
 * **返回值 `null` 与 `[]` 是两件事**：`null` = 这一跳没成（没 token / 后端拒了 / 没起来），
 * `[]` = 成了但这些群一行成员都没有。界面拿到前者说"取数没成"，拿到后者说"还没建档"——
 * 下一步动作完全不同，所以这里不许把 null 压成 []。
 */
export async function fetchExportRows(
  accountId: number,
  chatKeys: string[],
  opts: ExportFetchOptions
): Promise<GroupExportRow[] | null> {
  const params = new URLSearchParams()
  params.set('accountId', String(accountId))
  for (const k of chatKeys) params.append('chatKeys', k)
  return callGet<GroupExportRow[]>(
    `/api/group-members/group/members/export-rows?${params.toString()}`,
    opts
  )
}

/** 把行渲染成 14 列 XLSX，返回 Buffer。空行也照写（保留表头与 seq 连续性）。 */
export async function buildXlsxBuffer(rows: GroupExportRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('群成员')
  ws.columns = EXPORT_COLUMNS.map((h) => ({ header: h, key: h, width: 16 }))
  for (const r of rows) {
    ws.addRow(ROW_FIELDS.map((f) => cell(f, r[f])))
  }
  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf as ArrayBuffer)
}

/**
 * 半可信入参的四道剔非法：非字符串、空串、超长、形状不对。
 * `!k.includes(',')` 单列一条是必须的：`exportRows` 用重复 key 拼 query，
 * 一个含逗号的键会被后端拆成两个键，静默导出两份不相干的数据。
 */
function sanitizeChatKeys(keys: string[]): { kept: string[]; dropped: number } {
  const kept = keys.filter(
    (k) =>
      typeof k === 'string' &&
      k.length > 0 &&
      k.length <= CHAT_KEY_MAX &&
      k.includes('@') &&
      !k.includes(',')
  )
  return { kept, dropped: keys.length - kept.length }
}

export interface ExportOptions extends ExportFetchOptions {
  /** 落盘路径。由调用方（IPC 层）经 dialog.showSaveDialog 取得，本模块不碰 electron。 */
  savePath: string
}

/**
 * 导出主流程：校验 → 拉取 → 生成 → 落盘。
 *
 * 六种结论都**返回**不抛（界面按 `reason` 给文案）：`empty_keys` / `too_many` 是入参问题，
 * `failed` 是这一跳没成，`no_rows` 是还没建档（**0 行不落盘**——写一份只有表头的文件
 * 会让人读成"群里没人"），`saved` 才真的写成了。
 *
 * `too_many` 主进程再判一次，不是为了省一跳：是为了不把"选了 51 个群"报成"取数没成"，
 * 那会把用户引到重试的死路上（界面前拦、主进程再判、后端 40016 三处判的不是同一件事）。
 */
export async function exportGroupMembers(
  accountId: number,
  chatKeys: string[],
  opts: ExportOptions
): Promise<GroupExportResult> {
  const none = (reason: GroupExportResult['reason']): GroupExportResult => ({
    reason,
    path: null,
    rows: 0,
    bytes: 0
  })
  if (!Number.isInteger(accountId) || accountId <= 0) {
    console.log(`[group] 导出入参不合格 account=${oneLine(String(accountId))}`)
    return none('failed')
  }
  const { kept, dropped } = sanitizeChatKeys(chatKeys)
  if (dropped > 0) console.log(`[group] 导出剔除非法群键 ${dropped} 条，留 ${kept.length} 条`)
  if (kept.length === 0) return none('empty_keys')
  if (kept.length > MAX_EXPORT_GROUPS) return none('too_many')

  const rows = await fetchExportRows(accountId, kept, opts)
  if (!rows) return none('failed')
  if (rows.length === 0) return none('no_rows')

  let buf: Buffer
  try {
    buf = await buildXlsxBuffer(rows)
  } catch (e) {
    console.warn('[group] 导出生成工作簿失败', e)
    return none('failed')
  }

  try {
    await writeFile(opts.savePath, buf)
    // 体积量一次（R23）：这一行是唯一能拿到"50 群 × 几百人有多大"的地方。
    console.log(`[group] 导出落盘 rows=${rows.length} bytes=${buf.byteLength} path=${oneLine(opts.savePath, 260)}`)
    return { reason: 'saved', path: opts.savePath, rows: rows.length, bytes: buf.byteLength }
  } catch (e) {
    // 写盘失败（目标被占用 / 只读目录 / 权限）：日志留原文，界面上只说"没写成"。
    console.warn('[group] 导出写盘失败', e)
    return none('failed')
  }
}
