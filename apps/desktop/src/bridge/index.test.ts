// src/bridge/index.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { destroy, install } from './index.ts'
import type { BridgeCommand, BridgeInstallConfig, BridgeReport } from '../shared/chatTypes.ts'

const CONFIG: BridgeInstallConfig = { bridgeVersion: 'test-1', platform: 'whatsapp', viewId: 'v1', historyLimit: 10 }

interface Host {
  out: BridgeReport[]
  deliver(cmd: BridgeCommand): void
}

/**
 * 页内两头都伪造：`window.ele` 的下行喂命令、上行收帧。这里刻意不用 host.ts 的 sink，
 * 走的是生产那条 `sendToHost` 路径——要证的正是"帧有没有出 IPC"。
 */
function fakeHost(wpp: unknown): Host {
  const out: BridgeReport[] = []
  let onCmd: ((payload: unknown) => void) | null = null
  const g = globalThis as unknown as { window?: unknown }
  g.window = {
    WPP: wpp,
    ele: {
      sendToHost: (channel: string, data?: unknown) => {
        if (channel === 'msg-report') out.push(data as BridgeReport)
      },
      on: (_channel: string, cb: (payload: unknown) => void) => {
        onCmd = cb
        return () => {
          onCmd = null
        }
      }
    }
  }
  return { out, deliver: (cmd) => onCmd?.(cmd) }
}

/** 一个把第一页卡在 await 里的假 WPP：用来制造"destroy 时补底还在途"那个现场。 */
function gatedWpp(): { wpp: unknown; release: () => void } {
  let release: () => void = () => undefined
  const gate = new Promise<void>((r) => {
    release = r
  })
  return {
    release,
    wpp: {
      chat: {
        list: async () => [{ id: { _serialized: '861380001001@c.us' }, name: 'Alice' }],
        getMessages: async () => {
          await gate
          return []
        },
        getActiveChat: () => null
      },
      on: () => ({ off: () => undefined })
    }
  }
}

const idle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const progresses = (out: BridgeReport[]): BridgeReport[] => out.filter((f) => f.kind === 'backfill_progress')

test('install 认不得的平台先抛再改状态：同版本的下一次 install 还得真能装', async (t) => {
  const host = fakeHost(gatedWpp().wpp)
  t.after(() => {
    destroy()
    delete (globalThis as unknown as { window?: unknown }).window
  })
  assert.throws(() => install({ ...CONFIG, platform: 'telegram' }), /没有采集实现/)
  // 区分性证据：先把 installed 记上再抛的话，这一句会 return false——桥自称装好了却一帧不发，
  // 而同 bridgeVersion 让主进程永远不再重挂，现场只剩"ready 了但采不到"。
  assert.equal(install(CONFIG), true)
  assert.equal(host.out.filter((f) => f.kind === 'ready').length, 1)
})

test('补底还在 await 里时被 destroy：那一轮剩下的帧一律不出 IPC', async (t) => {
  const { wpp, release } = gatedWpp()
  const host = fakeHost(wpp)
  t.after(() => {
    destroy()
    delete (globalThis as unknown as { window?: unknown }).window
  })
  install(CONFIG)
  host.deliver({ kind: 'backfill', limit: 10 })
  await idle(0) // 让循环走到 getMessages 的 await 上
  destroy()
  release()
  await idle(320) // 越过合帧窗口（默认 200ms）：cancel() 撤掉的是当前这一枚定时器，拦不住下一趟重新起的
  assert.equal(progresses(host.out).length, 0, '代号没推进就等于卸载后还有进度帧出 IPC')
})

test('对照：不 destroy 时同一套夹具确实会出进度帧', async (t) => {
  const { wpp, release } = gatedWpp()
  const host = fakeHost(wpp)
  t.after(() => {
    destroy()
    delete (globalThis as unknown as { window?: unknown }).window
  })
  install(CONFIG)
  host.deliver({ kind: 'backfill', limit: 10 })
  await idle(0)
  release()
  await idle(320)
  // 上一个用例的 0 靠这一条才有意义：不是"什么都没发生"，是"发生的那一帧被代号拦下了"。
  assert.equal(progresses(host.out).length, 1)
})

/** 带 `sendTextMessage` 的假 WPP，且第一回执卡在 await 里：用来分"同步回执"与"异步上行"。 */
function gatedSend(): { wpp: unknown; calls: unknown[][]; release: () => void } {
  let release: () => void = () => undefined
  const gate = new Promise<void>((r) => {
    release = r
  })
  const calls: unknown[][] = []
  return {
    release,
    calls,
    wpp: {
      chat: {
        list: async () => [],
        getMessages: async () => [],
        getActiveChat: () => null,
        sendTextMessage: async (...args: unknown[]) => {
          calls.push(args)
          await gate
          return { id: 'true_861380001001@c.us_K-1_out', ack: 1, from: '861380000@c.us', sendMsgResult: null }
        }
      },
      on: () => ({ off: () => undefined })
    }
  }
}

test('send 命令交给 sendViaWa：回执异步单独一帧，命令回路不被它排住', async (t) => {
  const { wpp, calls, release } = gatedSend()
  const host = fakeHost(wpp)
  t.after(() => {
    destroy()
    delete (globalThis as unknown as { window?: unknown }).window
  })
  install(CONFIG)
  host.out.length = 0 // 只留命令阶段的帧
  host.deliver({ kind: 'send', localId: 'L1', chatKey: '861380001001@c.us', text: 'hi' })
  host.deliver({ kind: 'ping' })
  // 区分性证据：case 'send' 若还是那句写死的 "send not wired yet"，下面两条一条也过不了；
  // 若改成 await 再 return，pong 就排不到 send_result 前面。
  assert.equal(host.out[0]?.kind, 'pong')
  assert.equal(host.out.some((f) => f.kind === 'send_result'), false)
  release()
  await idle(0)
  assert.deepEqual(calls[0], ['861380001001@c.us', 'hi', { createChat: true, waitForAck: false }])
  assert.deepEqual(host.out.find((f) => f.kind === 'send_result'), {
    kind: 'send_result',
    localId: 'L1',
    ok: true,
    msgKey: 'true_861380001001@c.us_K-1_out'
  })
})

test('WPP.chat 不在时 send 也要有一帧回执：主进程的 invoke 不能白等超时', async (t) => {
  const host = fakeHost({ on: () => ({ off: () => undefined }) }) // 没有 chat 的 WPP
  t.after(() => {
    destroy()
    delete (globalThis as unknown as { window?: unknown }).window
  })
  install(CONFIG)
  host.out.length = 0
  host.deliver({ kind: 'send', localId: 'L2', chatKey: 'c', text: 'hi' })
  await idle(0)
  assert.deepEqual(host.out.find((f) => f.kind === 'send_result'), {
    kind: 'send_result',
    localId: 'L2',
    ok: false,
    error: 'BRIDGE_OFFLINE',
    detail: 'WPP.chat 不可用'
  })
})
