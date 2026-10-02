// src/shared/protocol/dispatch.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dispatchWsFrame, isAuthCloseCode, isStopReconnectCode, nextBackoff } from './dispatch.ts'
import { PROTOCOL_WS_TYPES, type ProtocolWsEnvelope } from './types.ts'

test('dispatchWsFrame：按 envelope.event 分派，并把 envelope.data 透传给 handler', () => {
  const calls: Array<{ kind: string; data: unknown }> = []
  const handlers = {
    onMessage: (data: unknown) => calls.push({ kind: 'msg', data }),
    onStatus: (data: unknown) => calls.push({ kind: 'status', data }),
    onAccountStatus: (data: unknown) => calls.push({ kind: 'acct', data }),
    onKickOut: (data: unknown) => calls.push({ kind: 'kick', data })
  }
  dispatchWsFrame(
    { event: PROTOCOL_WS_TYPES.MSG_IN, data: { a: 1 } } as ProtocolWsEnvelope,
    handlers
  )
  dispatchWsFrame(
    { event: PROTOCOL_WS_TYPES.MSG_STATUS, data: { b: 2 } } as ProtocolWsEnvelope,
    handlers
  )
  dispatchWsFrame(
    { event: PROTOCOL_WS_TYPES.ACCOUNT_STATUS, data: { c: 3 } } as ProtocolWsEnvelope,
    handlers
  )
  dispatchWsFrame(
    { event: PROTOCOL_WS_TYPES.KICK_OUT, data: { d: 4 } } as ProtocolWsEnvelope,
    handlers
  )
  assert.deepEqual(calls, [
    { kind: 'msg', data: { a: 1 } },
    { kind: 'status', data: { b: 2 } },
    { kind: 'acct', data: { c: 3 } },
    { kind: 'kick', data: { d: 4 } }
  ])
})

test('dispatchWsFrame：未知事件走 onUnknown，无 onUnknown 不抛', () => {
  const captured: ProtocolWsEnvelope[] = []
  const handlers = {
    onMessage: () => {},
    onStatus: () => {},
    onAccountStatus: () => {},
    onKickOut: () => {},
    onUnknown: (env: ProtocolWsEnvelope) => {
      captured.push(env)
    }
  }
  dispatchWsFrame({ event: 'WHATEVER', data: { x: 1 } } as ProtocolWsEnvelope, handlers)
  assert.equal(captured.length, 1)
  assert.deepEqual(captured[0].data, { x: 1 })
  // 无 onUnknown 也应安全返回
  dispatchWsFrame({ event: 'WHATEVER' } as ProtocolWsEnvelope, {
    onMessage: () => {},
    onStatus: () => {},
    onAccountStatus: () => {},
    onKickOut: () => {}
  })
})

test('nextBackoff：指数退避且封顶', () => {
  assert.equal(nextBackoff(0), 0)
  assert.equal(nextBackoff(1), 1000)
  assert.equal(nextBackoff(2), 2000)
  assert.equal(nextBackoff(3), 4000)
  assert.equal(nextBackoff(10), 30_000)
})

test('isAuthCloseCode / isStopReconnectCode：4001–4004 鉴权失败重试，4005/4007 硬停', () => {
  assert.equal(isAuthCloseCode(4001), true)
  assert.equal(isAuthCloseCode(4004), true)
  assert.equal(isAuthCloseCode(4005), false)
  assert.equal(isStopReconnectCode(4005), true)
  assert.equal(isStopReconnectCode(4007), true)
  assert.equal(isStopReconnectCode(4001), false)
  assert.equal(isAuthCloseCode(1000), false)
})
