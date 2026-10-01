// src/main/services/groupCollect/export.ts
//
// 群成员导出（spec §10）。本模块只做"拉数据 + 生成 XLSX + 落盘"，不碰 electron——
// `dialog.showSaveDialog` 留在 ipc.ts 的 group:export 处理器里（运行时才加载，不进单测）。
//
// 14 列表头与 shared/groupMembers.ts 的 EXPORT_COLUMNS 逐一对齐；行序由后端钉死
// （群按 chatKeys 顺序、群内按 latest_join_at 升序、seq 跨群连续），客户端只按序映射。

import ExcelJS from 'exceljs'
import { writeFile } from 'node:fs/promises'
import { EXPORT_COLUMNS, MAX_EXPORT_GROUPS } from '../../../shared/groupMembers.ts'

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

/** LocalDateTime 默认序列化成 `2026-09-30T12:00:00`，转成空格分隔更贴近 Excel 习惯，且不带 Z 以免被当 UTC 重算。 */
function formatDt(s: string): string {
  return s.includes('T') ? s.replace('T', ' ').replace(/Z$/, '') : s
}

function cell(field: (typeof ROW_FIELDS)[number], value: unknown): string | number {
  if (value === null || value === undefined) return ''
  if (field === 'joinAt' || field === 'leaveAt' || field === 'lastMsgAt') return formatDt(String(value))
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

/** 拉导出取数。`chatKeys` 多值走同一 query key 重复传（Spring `@RequestParam List` 的取数形态）。 */
export async function fetchExportRows(
  accountId: number,
  chatKeys: string[],
  opts: ExportFetchOptions
): Promise<GroupExportRow[]> {
  const params = new URLSearchParams()
  params.set('accountId', String(accountId))
  for (const k of chatKeys) params.append('chatKeys', k)
  const data = await callGet<GroupExportRow[]>(
    `/api/group-members/group/members/export-rows?${params.toString()}`,
    opts
  )
  return Array.isArray(data) ? data : []
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

export interface ExportResult {
  rowCount: number
  path?: string
  /** 没给 savePath 时返回（单测场景：只生成不落盘）。 */
  notSaved?: boolean
}

export interface ExportOptions extends ExportFetchOptions {
  /** 落盘路径。由调用方（IPC 层）经 dialog.showSaveDialog 取得，本模块不碰 electron。 */
  savePath?: string
}

/**
 * 导出主流程：校验 → 拉取 → 生成 → 落盘。
 * chatKeys 空或超 MAX_EXPORT_GROUPS 直接抛（与后端 400 一致；界面应提前拦住）。
 * 没给 savePath 时只生成返回（不写盘），方便单测验证 Buffer。
 */
export async function exportGroupMembers(
  accountId: number,
  chatKeys: string[],
  opts: ExportOptions
): Promise<ExportResult> {
  // IPC 边界是不可信调用方：chatKeys 可能缺失，先归一化再校验，避免 TypeError 掩盖真正的业务错误。
  if (!chatKeys || chatKeys.length === 0) throw new Error('至少需要选择一个群')
  if (chatKeys.length > MAX_EXPORT_GROUPS) {
    throw new Error(`一次导出不超过 ${MAX_EXPORT_GROUPS} 个群（当前 ${chatKeys.length}）`)
  }
  const rows = await fetchExportRows(accountId, chatKeys, opts)
  const buf = await buildXlsxBuffer(rows)
  if (!opts.savePath) return { rowCount: rows.length, notSaved: true }
  await writeFile(opts.savePath, buf)
  return { rowCount: rows.length, path: opts.savePath }
}
