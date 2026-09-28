// src/main/services/msgBridge/sendLock.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SendLock } from './sendLock.ts'

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

test('同一 viewId 的 job 严格串行，不交错', async () => {
  const lock = new SendLock()
  const log: string[] = []
  const job = (tag: string): Promise<string> => lock.run('v1', async () => {
    log.push(`in:${tag}`)
    await tick()
    log.push(`out:${tag}`)
    return tag
  })
  const all = await Promise.all([job('a'), job('b'), job('c')])
  assert.deepEqual(log, ['in:a', 'out:a', 'in:b', 'out:b', 'in:c', 'out:c'])
  assert.deepEqual(all, ['a', 'b', 'c'])
})

test('不同 viewId 并发：一条账号上的队列不该挡住另一条', async () => {
  const lock = new SendLock()
  const log: string[] = []
  await Promise.all([
    lock.run('v1', async () => { log.push('v1a'); await tick(); log.push('v1b') }),
    lock.run('v2', async () => { log.push('v2a'); await tick(); log.push('v2b') })
  ])
  assert.deepEqual(log.slice(0, 2).sort(), ['v1a', 'v2a'], '两条链应同时起步')
})

test('前一条抛错不会让后面的排队者拿到一个死锁：锁自己吞掉失败', async () => {
  const lock = new SendLock()
  await assert.rejects(() => lock.run('v1', async () => { throw new Error('页内炸了') }), /页内炸了/)
  assert.equal(await lock.run('v1', async () => 'ok'), 'ok')
  assert.equal(lock.pending('v1'), 0)
})

test('pending 计数含在途那条，dropView 之后新 job 仍能排队', async () => {
  const lock = new SendLock()
  let release = (): void => {}
  const held = lock.run('v1', () => new Promise<string>((r) => { release = () => r('done') }))
  assert.equal(lock.pending('v1'), 1)
  const queued = lock.run('v1', async () => 'second')
  assert.equal(lock.pending('v1'), 2)
  release()
  assert.deepEqual(await Promise.all([held, queued]), ['done', 'second'])
  lock.dropView('v1')
  assert.equal(await lock.run('v1', async () => 'third'), 'third')
})

test('作业同步就抛：这一环照样释放，后来的不被一条死尾链卡住', async () => {
  const lock = new SendLock()
  // 非 async 的闭包：抛出发生在 await 之前。起飞那一行若排在 try 之外，finally 就不跑，
  // done 永远没人 resolve——下一条会排在一个死 promise 上，而日志里什么都没有。
  await assert.rejects(() => lock.run('v1', () => { throw new Error('起飞前就炸') }), /起飞前就炸/)
  assert.equal(lock.pending('v1'), 0, '抛错那一环的计数要归还')
  assert.equal(await lock.run('v1', async () => 'ok'), 'ok')
})

test('排队中被 dropView：两条陆续收尾也不把 pending 减成负数', async () => {
  const lock = new SendLock()
  let release = (): void => {}
  const held = lock.run('v1', () => new Promise<string>((r) => { release = () => r('done') }))
  const queued = lock.run('v1', async () => 'second')
  assert.equal(lock.pending('v1'), 2)
  lock.dropView('v1') // 视图销毁：队列还在飞，两条的 finally 之后才各自收尾
  release()
  await Promise.all([held, queued])
  assert.equal(lock.pending('v1'), 0, '摘掉的 view 不许留下负计数')
  assert.equal(lock.pending(), 0, '全局求和也不许被负数拖下去')
})
