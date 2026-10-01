// src/main/services/groupCollect/registry.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addPending, dropPending, settleGroupReply, failAllPending, size } from './registry.ts'
import type { GroupReply } from './engine.ts'

// 测试里不需要真计时器：clearTimeout 收任何对象都无副作用。
const dummyTimer = { ref() {}, unref() {} } as unknown as NodeJS.Timeout

function listReply(reqId: string, ok = true): GroupReply & { reqId: string } {
  return { kind: 'group_list_result', reqId, ok, groups: [{ chatKey: 'g1@g.us', title: '群一' }] }
}

test('addPending 后 settleGroupReply 命中并 resolve 对应回执', async () => {
  const p = new Promise<GroupReply>((resolve) => addPending('r1', resolve, dummyTimer))
  assert.equal(settleGroupReply(listReply('r1')), true)
  const got = (await p) as GroupReply & { reqId: string }
  assert.equal(got.kind, 'group_list_result')
  assert.equal(size(), 0, '结算后从表移除')
})

test('settleGroupReply 对未知 reqId 返回 false 且不 resolve', async () => {
  const p = new Promise<GroupReply>((resolve) => addPending('r2', resolve, dummyTimer))
  assert.equal(settleGroupReply(listReply('nope')), false)
  assert.equal(size(), 1, '未结算，仍在表里')
  // 清场，避免影响后续
  dropPending('r2')
  await Promise.race([p, Promise.resolve('unresolved')])
})

test('dropPending 后 settle 不再 resolve（超时路径的等价物）', async () => {
  let resolved = false
  const p = new Promise<GroupReply>((resolve) => {
    addPending('r3', (r) => {
      resolved = true
      resolve(r)
    }, dummyTimer)
  })
  dropPending('r3')
  assert.equal(size(), 0)
  assert.equal(settleGroupReply(listReply('r3')), false)
  await Promise.race([p.then(() => 'resolved'), Promise.resolve('unresolved')])
  assert.equal(resolved, false, 'drop 后不应再结算')
})

test('failAllPending 把所有在途结掉并清空', async () => {
  const results: GroupReply[] = []
  const p1 = new Promise<GroupReply>((resolve) => addPending('a', resolve, dummyTimer)).then((r) => results.push(r))
  const p2 = new Promise<GroupReply>((resolve) => addPending('b', resolve, dummyTimer)).then((r) => results.push(r))
  const n = failAllPending()
  assert.equal(n, 2)
  assert.equal(size(), 0)
  await Promise.all([p1, p2])
  assert.equal(results.length, 2)
  for (const r of results) assert.equal((r as GroupReply & { ok: boolean }).ok, false, '视图没了，回执只能是失败')
})
