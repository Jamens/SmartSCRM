// src/shared/liveTail.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { advanceStatus, furtherStatus, mergeTail, pendingKey, settlePending, type TailRow } from './liveTail.ts'
import type { MsgStatus } from './chatTypes.ts'

const row = (msgKey: string, ts: number, extra: Record<string, unknown> = {}): TailRow & Record<string, unknown> => ({
  msgKey,
  ts,
  ...extra
})

/** `advanceStatus` 吃的是"带 status 的尾巴行"（`TailRow` 本身没有这一格），`body` 用来盯"只动状态"。 */
interface StatusRow extends TailRow {
  status: MsgStatus
  body?: string | null
}

const srow = (msgKey: string, ts: number, status: MsgStatus, body?: string | null): StatusRow => ({
  msgKey,
  ts,
  status,
  body
})

test('mergeTail：同 msgKey 覆盖字段而不新增行（状态推进的落点）', () => {
  const before = [row('a', 10, { status: 'sent' })]
  const after = mergeTail(before, [row('a', 10, { status: 'delivered' })])
  assert.equal(after.length, 1)
  assert.equal(after[0].status, 'delivered')
  // ts 不同时取更大者（`ts: Math.max(...)` 的落点）：同键行仍不新增。
  assert.equal(mergeTail([row('a', 10)], [row('a', 20)])[0].ts, 20)
  // 反方向也要钉住：迟到的旧 ts 覆盖不得把行拉回去（纯 spread 会在这里露馅）
  assert.equal(mergeTail([row('a', 20)], [row('a', 10)])[0].ts, 20)
})

test('mergeTail：翻页窗口之外的旧尾巴丢弃，窗口之后的按时间插入', () => {
  const before = [row('b', 20), row('c', 30)]
  const after = mergeTail(before, [row('a', 10), row('d', 40), row('c2', 25)])
  // 'a' 比窗口里最早的一行还旧且不在库里 → 以库为准，丢弃。
  assert.deepEqual(after.map((r) => r.msgKey), ['b', 'c2', 'c', 'd'])
})

test('mergeTail：空入参与空 incoming 都不炸', () => {
  assert.deepEqual(mergeTail([], []), [])
  assert.deepEqual(mergeTail([], [row('x', 5)]).map((r) => r.msgKey), ['x'])
})

test('settlePending：乐观气泡原地换成真实 msgKey，位置不动、行数不增', () => {
  const before = [row(pendingKey('L1'), 100, { status: 'pending' }), row('c', 120)]
  const after = settlePending(before, 'L1', '真-39', { status: 'sent' })
  assert.equal(after.length, 2)
  assert.equal(after[0].msgKey, '真-39')
  assert.equal(after[0].status, 'sent')
  assert.equal(after[1].msgKey, 'c')
})

test('settlePending：库行已经先到时不重复插气泡', () => {
  const before = [row('真-39', 100), row('c', 120)]
  const after = settlePending(before, 'L1', '真-39', { status: 'read' })
  assert.equal(after.length, 2)
  assert.equal(after[0].msgKey, '真-39')
  // 找不到待空气泡但真实键已存在 → 就地把状态并进去，仍然不新增行。
  assert.equal(after[0].status, 'read')
})

test('advanceStatus：一批三个键里两个命中就推两条，没命中的那把键不长出幽灵气泡', () => {
  const before = [srow('a', 10, 'pending', '正文 A'), srow('b', 20, 'pending'), srow('c', 30, 'read')]
  const out = advanceStatus(before, ['a', '不在尾巴里的键', 'b'], 'delivered')
  // 区分"推进了两条"与"什么都没做"的就是这三条断言。
  assert.equal(out.changed, 2)
  assert.equal(out.rows[0].status, 'delivered')
  assert.equal(out.rows[1].status, 'delivered')
  // 不新增：帧里那把找不到的键没凑出一行空白气泡。
  assert.equal(out.rows.length, 3)
  assert.deepEqual(out.rows.map((r) => r.msgKey), ['a', 'b', 'c'])
  // 只并 status：正文与 ts 不是它的字段，碰不得（逐字段覆盖那条老路的反面）。
  assert.equal(out.rows[0].body, '正文 A')
  assert.equal(out.rows[0].ts, 10)
  // 命中行必须是**新对象**，入参那一份一个字节都不能动。
  // 这不是风格问题：`out = [...rows]` 只是浅拷贝，`out[at].status = ...` 那种就地改写的正是
  // 缓存里正被观察者引用的行对象；而 TanStack v5 的 `setQueryData` 默认走结构共享
  // （`replaceData → replaceEqualDeep`，深度相等时直接把旧引用还回去），于是"新数据"与旧数据
  // 是同一个对象、观察者收不到任何通知——症状恰好是本项目最刺眼的那一条：勾永远画不上。
  assert.notEqual(out.rows[0], before[0])
  assert.equal(before[0].status, 'pending')
  // 帧里没点名的行不被牵连（c 已在 read，见下一条的兜底）。
  assert.equal(out.rows[2].status, 'read')
})

test('advanceStatus：read → sent 的迟到 ack 一条都不推，数组逐字段等值且入参不被改', () => {
  const before = [srow('a', 10, 'read', '正文 A'), srow('b', 20, 'read')]
  const snapshot = [srow('a', 10, 'read', '正文 A'), srow('b', 20, 'read')]
  const out = advanceStatus(before, ['a', 'b'], 'sent')
  assert.equal(out.changed, 0)
  assert.deepEqual(out.rows, snapshot)
  // 入参数组不被修改：改的是返回的那一份。
  assert.deepEqual(before, snapshot)
  assert.notEqual(out.rows, before)
})

test('advanceStatus：pending → sent → delivered 连推两次，各自 changed === 1', () => {
  const first = advanceStatus([srow('a', 10, 'pending')], ['a'], 'sent')
  assert.equal(first.changed, 1)
  assert.equal(first.rows[0].status, 'sent')
  const second = advanceStatus(first.rows, ['a'], 'delivered')
  assert.equal(second.changed, 1)
  assert.equal(second.rows[0].status, 'delivered')
  assert.equal(second.rows.length, 1)
})

test('advanceStatus：changed 数的是"真的变了"，不是"命中了几行"', () => {
  // 两行都命中、状态却都已经到位（重复回执）：命中数 2，变化数 0。
  const done = advanceStatus([srow('a', 10, 'delivered'), srow('b', 20, 'read')], ['a', 'b'], 'delivered')
  assert.equal(done.changed, 0)
  assert.deepEqual(done.rows, [srow('a', 10, 'delivered'), srow('b', 20, 'read')])
  // 同一帧里的重复键也只按"变了几行"算：四把键命中两行、只有 b 真的上来了。
  const dup = advanceStatus(
    [srow('a', 10, 'delivered'), srow('b', 20, 'pending')],
    ['a', 'a', 'b', 'b'],
    'delivered'
  )
  assert.equal(dup.changed, 1)
  assert.equal(dup.rows.length, 2)
  assert.equal(dup.rows[1].status, 'delivered')
})

test('advanceStatus：failed 行不被 ack 翻成 sent，failed 目标也只落在 pending/sent 上', () => {
  // 终态那一侧：页面上已经带重试按钮了，迟到的回执不能把它顶绿。
  const failedFirst = advanceStatus([srow('a', 10, 'failed', '正文 A')], ['a'], 'sent')
  assert.equal(failedFirst.changed, 0)
  assert.equal(failedFirst.rows[0].status, 'failed')
  assert.equal(failedFirst.rows[0].body, '正文 A')
  // 阶梯外的一侧不倒着走：已经 delivered 的行不会被一帧 failed 拽下去（后端同形，Task 7 镜像）。
  const delivered = advanceStatus([srow('b', 20, 'delivered')], ['b'], 'failed')
  assert.equal(delivered.changed, 0)
  assert.equal(delivered.rows[0].status, 'delivered')
  // 而 pending/sent → failed 是真推进（`canAdvance` 给 failed 开的那条例外分支）。
  const toFailed = advanceStatus([srow('c', 30, 'pending'), srow('d', 40, 'sent')], ['c', 'd'], 'failed')
  assert.equal(toFailed.changed, 2)
  assert.equal(toFailed.rows[0].status, 'failed')
  assert.equal(toFailed.rows[1].status, 'failed')
})

test('advanceStatus：空 msgKeys 与空 rows 各自原样返回，不新增也不炸', () => {
  const before = [srow('a', 10, 'pending')]
  const noKeys = advanceStatus(before, [], 'read')
  assert.equal(noKeys.changed, 0)
  assert.deepEqual(noKeys.rows, before)
  // 空尾巴 + 有键：ack 不是"把库里那行搬进尾巴"的入口，一行都不该造出来。
  const noRows = advanceStatus([], ['a', 'b'], 'read')
  assert.equal(noRows.changed, 0)
  assert.deepEqual(noRows.rows, [])
})

test('furtherStatus：两个方向都问，都推不动时保留第一个参数', () => {
  // 尾巴更新（库页是上一次翻页的快照）→ 取 incoming。
  assert.equal(furtherStatus('sent', 'delivered'), 'delivered')
  // 库行更新（ack 早于尾巴被 gcTime 收走过）→ 取 current，不倒退。
  assert.equal(furtherStatus('read', 'sent'), 'read')
  // 两条都不在阶梯上时谁也不服谁：这条兜底决定 failed / received 的归属。
  assert.equal(furtherStatus('failed', 'received'), 'failed')
  assert.equal(furtherStatus('received', 'failed'), 'received')
  assert.equal(furtherStatus('pending', 'pending'), 'pending')
})

