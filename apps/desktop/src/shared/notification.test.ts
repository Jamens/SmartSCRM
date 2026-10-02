// src/shared/notification.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  NOTIFY_BODY_MAX,
  NOTIFY_EMPTY_BODY,
  NOTIFY_MERGE_WINDOW_MS,
  mergeNotifyPending,
  notifyBodyOf,
  notifyDecisionOf,
  notifyTitleOf,
  type NotifyCandidate,
  type NotifyPending
} from './notification.ts'

const candidate = (over: Partial<NotifyCandidate> = {}): NotifyCandidate => ({
  enabled: true,
  focused: false,
  direction: 'in',
  chatKey: '8613800138000@c.us',
  title: '张三',
  body: '你好',
  ...over
})

test('三条闸各自能把通知压掉，且原因分得开', () => {
  assert.deepEqual(notifyDecisionOf(candidate({ enabled: false })), {
    action: 'skip',
    reason: 'disabled'
  })
  assert.deepEqual(notifyDecisionOf(candidate({ focused: true })), {
    action: 'skip',
    reason: 'focused'
  })
  // 出站必须压掉：自聊与页面回声也会来一帧，不判方向会把通知刷满。
  assert.deepEqual(notifyDecisionOf(candidate({ direction: 'out' })), {
    action: 'skip',
    reason: 'outgoing'
  })
  const ok = notifyDecisionOf(candidate())
  assert.equal(ok.action, 'show')
  if (ok.action === 'show') {
    assert.equal(ok.chatKey, '8613800138000@c.us')
    assert.equal(ok.title, '张三')
    assert.equal(ok.body, '你好')
  }
})

test('三条闸同时命中时报第一个（disabled），不是互相顶掉', () => {
  const all = notifyDecisionOf(candidate({ enabled: false, focused: true, direction: 'out' }))
  assert.deepEqual(all, { action: 'skip', reason: 'disabled' })
})

test('同一会话在合并窗口内的连发并成一条，正文是最后一条', () => {
  const t0 = 1_000_000
  const one = mergeNotifyPending(null, { chatKey: 'a@c.us', title: '张三', body: '第一句' }, t0)
  assert.equal(one.count, 1)
  assert.equal(one.firstAt, t0)

  const two = mergeNotifyPending(one, { chatKey: 'a@c.us', title: '张三', body: '第二句' }, t0 + 500)
  const three = mergeNotifyPending(
    two,
    { chatKey: 'a@c.us', title: '张三', body: '第三句' },
    t0 + NOTIFY_MERGE_WINDOW_MS - 1
  )
  assert.equal(three.count, 3)
  assert.equal(three.body, '第三句')
  // 合并窗口内 firstAt 不动：它是这一批的起点，被改写会让窗口无限延长。
  assert.equal(three.firstAt, t0)
})

test('跨窗口重开一批，计数不串到上一批', () => {
  const t0 = 1_000_000
  const prev = mergeNotifyPending(null, { chatKey: 'a@c.us', title: '张三', body: '第一句' }, t0)
  const next = mergeNotifyPending(
    prev,
    { chatKey: 'a@c.us', title: '张三', body: '新一批' },
    t0 + NOTIFY_MERGE_WINDOW_MS
  )
  assert.equal(next.count, 1)
  assert.equal(next.firstAt, t0 + NOTIFY_MERGE_WINDOW_MS)
})

test('换会话立刻重开，不等窗口', () => {
  const t0 = 1_000_000
  const a = mergeNotifyPending(null, { chatKey: 'a@c.us', title: '张三', body: 'x' }, t0)
  const b = mergeNotifyPending(a, { chatKey: 'b@c.us', title: '李四', body: 'y' }, t0 + 10)
  assert.equal(b.chatKey, 'b@c.us')
  assert.equal(b.count, 1)
  assert.equal(b.firstAt, t0 + 10)
})

test('标题：单条是会话名，多条带条数', () => {
  const one = mergeNotifyPending(null, { chatKey: 'a@c.us', title: '张三', body: 'x' }, 0)
  assert.equal(notifyTitleOf(one), '张三')
  const three = mergeNotifyPending(one, { chatKey: 'a@c.us', title: '张三', body: 'y' }, 1)
  const more = mergeNotifyPending(three, { chatKey: 'a@c.us', title: '张三', body: 'z' }, 2)
  assert.equal(notifyTitleOf(more), '张三（3 条新消息）')
})

test('正文：换行折成空格、超长裁剪、空正文有占位', () => {
  const pending = (body: string): NotifyPending =>
    mergeNotifyPending(null, { chatKey: 'a@c.us', title: '张三', body }, 0)

  // 折行：不折的话一大段复制文本会把通知撑成一整块。
  assert.equal(notifyBodyOf(pending('第一行\n第二行\t第三行')), '第一行 第二行 第三行')
  assert.equal(notifyBodyOf(pending('  两边有空白  ')), '两边有空白')

  const long = '长'.repeat(NOTIFY_BODY_MAX + 20)
  const cut = notifyBodyOf(pending(long))
  assert.equal(cut.length, NOTIFY_BODY_MAX + 1, '裁剪后带一个省略号')
  assert.ok(cut.endsWith('…'))

  assert.equal(notifyBodyOf(pending('')), NOTIFY_EMPTY_BODY)
  assert.equal(notifyBodyOf(pending('   \n  ')), NOTIFY_EMPTY_BODY)
})
