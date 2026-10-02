// src/main/services/groupCollect/export.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { EXPORT_COLUMNS } from '../../../shared/groupMembers.ts'
import { buildXlsxBuffer, exportGroupMembers, fetchExportRows, type GroupExportRow } from './export.ts'

const sampleRows: GroupExportRow[] = [
  {
    seq: 1,
    groupName: '群A',
    groupId: 'g1@g.us',
    phone: '8613800000001',
    name: '张三',
    role: 'admin',
    inGroup: 'true',
    joinAt: '2026-09-01T08:30:00',
    joinCount: 1,
    leaveAt: null,
    exitMethod: '',
    lastMsgAt: '2026-09-30T22:00:00',
    dayMsgCount: 3,
    msgCount: 12
  },
  {
    seq: 2,
    groupName: '群A',
    groupId: 'g1@g.us',
    phone: null,
    name: '李四',
    role: 'member',
    inGroup: 'false',
    joinAt: null,
    joinCount: 0,
    leaveAt: '2026-09-15T10:00:00',
    exitMethod: 'removed',
    lastMsgAt: null,
    dayMsgCount: null,
    msgCount: 5
  }
]

function fakeFetch(body: unknown, { ok = true, code = 0 } = {}): { calls: string[]; impl: typeof fetch } {
  const calls: string[] = []
  const impl = (async (url: string | URL) => {
    calls.push(String(url))
    return { ok, async json(): Promise<unknown> { return { code, data: body } } }
  }) as unknown as typeof fetch
  return { calls, impl }
}

// exceljs 的 .d.ts 把 xlsx.load 首个参数钉成老式 Buffer，而当前 @types/node 的 Buffer 已是泛型
// Buffer<ArrayBufferLike>，直接传会触发 TS2345。用 Parameters 取出它真实期望的类型做桥接，避免 any。
async function reopenXlsx(data: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(data as unknown as Parameters<typeof wb.xlsx.load>[0])
  return wb
}

test('buildXlsxBuffer 生成 14 列表头 + 行序与输入一致，日期去 T', async () => {
  const buf = await buildXlsxBuffer(sampleRows)
  // XLSX 本质是 zip，魔数为 PK
  assert.equal(buf[0], 0x50)
  assert.equal(buf[1], 0x4b)

  const wb = await reopenXlsx(buf)
  const ws = wb.getWorksheet('群成员')
  assert.ok(ws, '工作表 群成员 存在')
  const headers = (ws?.getRow(1).values as unknown[]).slice(1) as string[]
  assert.deepEqual(headers, [...EXPORT_COLUMNS])
  assert.equal(ws?.rowCount, 3, '表头 1 行 + 数据 2 行')
  // 第一行数据的进群时间应被格式化成空格分隔（去 T）
  const firstData = (ws?.getRow(2).values as unknown[]).slice(1) as string[]
  assert.equal(firstData[7], '2026-09-01 08:30:00')
  // 退群时间为 null 应写成空串（首行张三 leaveAt 为 null）
  assert.equal(firstData[9], '', 'null 退群时间 → 空单元格')
  // 第二行李四有退群时间，应被格式化成空格分隔
  const secondData = (ws?.getRow(3).values as unknown[]).slice(1) as string[]
  assert.equal(secondData[9], '2026-09-15 10:00:00', '非 null 退群时间 → 空格分隔')
})

test('fetchExportRows 拼出 accountId 与多 chatKeys 的 query', async () => {
  const { calls, impl } = fakeFetch(sampleRows)
  const rows = await fetchExportRows(7, ['g1@g.us', 'g2@g.us'], {
    token: () => 'T',
    fetchImpl: impl,
    apiBase: 'http://h:8180/'
  })
  assert.ok(rows, '取数成功时给回数组而不是 null')
  assert.equal(rows.length, 2)
  const url = calls[0]
  assert.ok(url.includes('accountId=7'), '带 accountId')
  assert.ok(url.includes('chatKeys=g1%40g.us') && url.includes('chatKeys=g2%40g.us'), '多 chatKeys 重复传同一 key')
})

test('fetchExportRows：这一跳没成是 null，不是空数组', async () => {
  const rows = await fetchExportRows(7, ['g1@g.us'], {
    token: () => 'T',
    fetchImpl: fakeFetch(sampleRows, { ok: false }).impl
  })
  assert.equal(rows, null, 'null 与 [] 必须分开：界面靠它区分"取数没成"与"还没建档"')
})

test('exportGroupMembers 落盘成可用 XLSX 并报 saved', async () => {
  const tmp = join(tmpdir(), `group-export-test-${Date.now()}.xlsx`)
  const out = await exportGroupMembers(7, ['g1@g.us'], {
    savePath: tmp,
    token: () => 'T',
    fetchImpl: fakeFetch(sampleRows).impl
  })
  assert.equal(out.reason, 'saved')
  assert.equal(out.path, tmp)
  assert.equal(out.rows, 2)
  assert.ok(out.bytes > 0, '体积量一次（R23）')
  const onDisk = await readFile(tmp)
  const wb = await reopenXlsx(onDisk)
  assert.equal(wb.getWorksheet('群成员')?.rowCount, 3)
})

test('exportGroupMembers：超 50 群报 too_many，不发请求', async () => {
  const many = Array.from({ length: 51 }, (_, i) => `g${i}@g.us`)
  const { calls, impl } = fakeFetch(sampleRows)
  const out = await exportGroupMembers(7, many, {
    savePath: join(tmpdir(), 'never-written.xlsx'),
    token: () => 'T',
    fetchImpl: impl
  })
  assert.equal(out.reason, 'too_many')
  assert.equal(out.path, null)
  assert.equal(calls.length, 0, '主进程这一判是为了不把"选了 51 个群"报成"取数没成"')
})

test('exportGroupMembers：0 行不落盘，报 no_rows', async () => {
  const tmp = join(tmpdir(), `group-export-empty-${Date.now()}.xlsx`)
  const out = await exportGroupMembers(7, ['g1@g.us'], {
    savePath: tmp,
    token: () => 'T',
    fetchImpl: fakeFetch([]).impl
  })
  assert.equal(out.reason, 'no_rows', '写一份只有表头的文件会让人读成"群里没人"')
  assert.equal(out.path, null)
  await assert.rejects(() => readFile(tmp), /ENOENT|no such file/, '确实没落盘')
})

test('exportGroupMembers：取数没成报 failed', async () => {
  const out = await exportGroupMembers(7, ['g1@g.us'], {
    savePath: join(tmpdir(), 'never-written.xlsx'),
    token: () => 'T',
    fetchImpl: fakeFetch(sampleRows, { ok: false }).impl
  })
  assert.equal(out.reason, 'failed')
})

test('exportGroupMembers：非法群键被剔掉，全非法时报 empty_keys', async () => {
  // 含逗号的键会被后端拆成两个键，静默导出两份不相干的数据——必须在这一层剔掉
  const out = await exportGroupMembers(7, ['a,b@g.us', 'not-a-key', ''], {
    savePath: join(tmpdir(), 'never-written.xlsx'),
    token: () => 'T',
    fetchImpl: fakeFetch(sampleRows).impl
  })
  assert.equal(out.reason, 'empty_keys')
})
