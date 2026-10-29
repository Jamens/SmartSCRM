// src/shared/protocol/tgDispatch.test.ts
// TG 协议源（期一）：WS 帧分派。TG_* 事件名与 WA_* 走同一批 handler，只在事件名上分源。
// 期一：契约层，未经真机验证——事件名由本仓与网关约定，尚未对过真实网关（spec §0.3 / R7）。
// 期二待办：真实网关上线后按实测核对三个 TG_* 事件名与 payload 形状。
// 契约见 docs/superpowers/specs/2026-10-28-telegram-mtproto-collection-design.md

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dispatchWsFrame, type ProtocolWsHandlers } from './dispatch.ts'
import { PROTOCOL_WS_TYPES, type ProtocolWsEnvelope } from './types.ts'

function makeHandlers(): { calls: string[]; handlers: ProtocolWsHandlers } {
  const calls: string[] = []
  return {
    calls,
    handlers: {
      onMessage: () => calls.push('msg'),
      onStatus: () => calls.push('status'),
      onAccountStatus: () => calls.push('acct'),
      onKickOut: () => calls.push('kick'),
      onUnknown: () => calls.push('unknown')
    }
  }
}

function frameOf(event: string, data: unknown): ProtocolWsEnvelope {
  return { event, data } as ProtocolWsEnvelope
}

test('dispatchWsFrame：TG 三个事件各自触发对应 handler，且只触发一次', () => {
  const { calls, handlers } = makeHandlers()
  dispatchWsFrame(frameOf(PROTOCOL_WS_TYPES.TG_MSG_IN, { a: 1 }), handlers)
  dispatchWsFrame(frameOf(PROTOCOL_WS_TYPES.TG_MSG_STATUS, { b: 2 }), handlers)
  dispatchWsFrame(frameOf(PROTOCOL_WS_TYPES.TG_ACCOUNT_STATUS, { c: 3 }), handlers)
  assert.deepEqual(calls, ['msg', 'status', 'acct'])
})

test('dispatchWsFrame：TG 帧与 WA 帧路由到同一批 handler，且不误触 KICK_OUT 专属路径', () => {
  const { calls, handlers } = makeHandlers()
  // TG 帧：只走业务 handler，绝不落 KICK_OUT（那是 WA_* 之外的独立事件）。
  dispatchWsFrame(frameOf(PROTOCOL_WS_TYPES.TG_MSG_IN, { a: 1 }), handlers)
  dispatchWsFrame(frameOf(PROTOCOL_WS_TYPES.TG_MSG_STATUS, { a: 1 }), handlers)
  dispatchWsFrame(frameOf(PROTOCOL_WS_TYPES.TG_ACCOUNT_STATUS, { a: 1 }), handlers)
  assert.equal(calls.filter((c) => c === 'kick').length, 0)
  assert.equal(calls.filter((c) => c === 'unknown').length, 0)
  // WA 同一批 handler：行为与 TG 一致（证明是同一条路，不是第二套分派）。
  const wa = makeHandlers()
  dispatchWsFrame(frameOf(PROTOCOL_WS_TYPES.MSG_IN, { a: 1 }), wa.handlers)
  dispatchWsFrame(frameOf(PROTOCOL_WS_TYPES.KICK_OUT, { a: 1 }), wa.handlers)
  assert.deepEqual(wa.calls, ['msg', 'kick'])
})

test('dispatchWsFrame：未知事件仍走 onUnknown（TG 事件名拼错也不静默吞掉）', () => {
  const { calls, handlers } = makeHandlers()
  dispatchWsFrame(frameOf('TG_MSG_PUSH', { x: 1 }), handlers)
  dispatchWsFrame(frameOf('WA_MSG_IN_PUSH_TYPO', { x: 1 }), handlers)
  assert.deepEqual(calls, ['unknown', 'unknown'])
})
