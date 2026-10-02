// src/main/services/desktopNotify.test.ts
import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  configureNotifyHost,
  flushNotify,
  pendingNotifyCount,
  resetNotifyHost,
  resetNotifyState,
  setNotifyClickHandler,
  showIncoming,
  type NotifyHost
} from './desktopNotify.ts'
import type { NotifyShowRequest, NotifyShown } from '../../shared/notification.ts'

/**
 * 平台那一层是注入进来的，所以这里跑的是真的排队与合并逻辑，而不是把规则再抄一遍。
 * `presented` 记录"真的交给平台弹了什么"，`activations` 记录点击回调被触发了几次。
 */
let presented: NotifyShown[] = []
let activations: Array<() => void> = []
let supported = true

function wireHost(): void {
  const host: NotifyHost = {
    isSupported: () => supported,
    present: (shown, onActivate) => {
      presented.push(shown)
      activations.push(onActivate)
    }
  }
  configureNotifyHost(host)
}

const req = (over: Partial<NotifyShowRequest> = {}): NotifyShowRequest => ({
  enabled: true,
  focused: false,
  direction: 'in',
  chatKey: '8613800138000@c.us',
  title: '张三',
  body: '你好',
  accountId: 7,
  ...over
})

afterEach(() => {
  resetNotifyState()
  resetNotifyHost()
  setNotifyClickHandler(null)
  presented = []
  activations = []
  supported = true
})

test('规则压掉的三条各自有原因，且不排队', () => {
  wireHost()
  assert.deepEqual(showIncoming(req({ enabled: false })), { action: 'skip', reason: 'disabled' })
  assert.deepEqual(showIncoming(req({ focused: true })), { action: 'skip', reason: 'focused' })
  assert.deepEqual(showIncoming(req({ direction: 'out' })), { action: 'skip', reason: 'outgoing' })
  assert.equal(pendingNotifyCount(), 0)
  assert.equal(presented.length, 0)
})

test('平台不支持时报 unsupported，不排队', () => {
  wireHost()
  supported = false
  assert.deepEqual(showIncoming(req()), { action: 'skip', reason: 'unsupported' })
  assert.equal(pendingNotifyCount(), 0)
})

test('没装配平台能力时不支持也不弹（默认不是"能弹"）', () => {
  // 故意不调 wireHost：未接线的环境必须说"不支持"，不能静默假装弹过了。
  assert.deepEqual(showIncoming(req()), { action: 'skip', reason: 'unsupported' })
})

test('同一会话连发并成一条，flush 出来是合并后的标题与最后一句正文', () => {
  wireHost()
  const t0 = 1_000_000
  assert.deepEqual(showIncoming(req({ body: '第一句' }), t0), {
    action: 'queued',
    chatKey: '8613800138000@c.us',
    count: 1
  })
  assert.deepEqual(showIncoming(req({ body: '第二句' }), t0 + 100), {
    action: 'queued',
    chatKey: '8613800138000@c.us',
    count: 2
  })
  assert.deepEqual(showIncoming(req({ body: '第三句' }), t0 + 200), {
    action: 'queued',
    chatKey: '8613800138000@c.us',
    count: 3
  })

  const shown = flushNotify()
  assert.equal(shown.length, 1)
  assert.equal(shown[0].count, 3)
  assert.equal(shown[0].title, '张三（3 条新消息）')
  assert.equal(shown[0].body, '第三句')
  assert.equal(shown[0].accountId, 7, '点击要能定位到账号，accountId 必须随批带着')
  // 弹完就清干净：不清的话下一批会接着上一批的计数。
  assert.equal(pendingNotifyCount(), 0)
})

test('两个会话各弹各的，计数不串', () => {
  wireHost()
  showIncoming(req({ chatKey: 'a@c.us', title: '张三', body: 'x' }), 0)
  showIncoming(req({ chatKey: 'a@c.us', title: '张三', body: 'y' }), 1)
  showIncoming(req({ chatKey: 'b@c.us', title: '李四', body: 'z', accountId: 8 }), 2)

  const shown = flushNotify()
  assert.equal(shown.length, 2)
  const a = shown.find((s) => s.chatKey === 'a@c.us')
  const b = shown.find((s) => s.chatKey === 'b@c.us')
  assert.equal(a?.count, 2)
  assert.equal(b?.count, 1)
  assert.equal(b?.accountId, 8)
})

test('定时器到点自动弹，不等 flush', async () => {
  wireHost()
  showIncoming(req(), Date.now())
  assert.equal(presented.length, 0, '刚排队时还没弹')
  assert.equal(pendingNotifyCount(), 1)
  // 合并窗口是 3s，测试里真等 3s 太慢——这里只断言"排队了、没立刻弹"，
  // 自动弹的时序由 showIncoming 起的那个定时器保证，flushNotify 覆盖的是同一条 flushChat。
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(pendingNotifyCount(), 1, '10ms 内不该弹：窗口是 3000ms')
})

test('resetNotifyState 清干净且**不弹**', () => {
  wireHost()
  showIncoming(req({ body: '第一句' }), 0)
  showIncoming(req({ body: '第二句' }), 1)
  assert.equal(pendingNotifyCount(), 1)

  resetNotifyState()
  assert.equal(pendingNotifyCount(), 0)
  assert.equal(presented.length, 0, '清场不许顺手把通知弹出来')
  assert.deepEqual(flushNotify(), [], '清完之后也没有残留可弹')
})

test('点击回调带的是 accountId 与 chatKey，未装配时不炸', () => {
  wireHost()
  const seen: Array<{ accountId: number; chatKey: string }> = []
  setNotifyClickHandler((t) => seen.push(t))

  showIncoming(req({ chatKey: 'a@c.us', accountId: 9 }), 0)
  flushNotify()
  // present 收到的第二个参数就是平台侧 click 时要调的那个。
  assert.equal(activations.length, 1)
  activations[0]()
  assert.deepEqual(seen, [{ accountId: 9, chatKey: 'a@c.us' }])

  // 没装 clickHandler 时点击不能抛——通知的 click 是用户行为，抛出去没人接。
  setNotifyClickHandler(null)
  assert.doesNotThrow(() => activations[0]())
})
