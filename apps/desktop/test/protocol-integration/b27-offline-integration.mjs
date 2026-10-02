// apps/desktop/test/protocol-integration/b27-offline-integration.mjs
// B27（WA 协议号）通道离线联调 harness。
// 用「真实的」ProtocolSyncManager + ProtocolClient（来自 esbuild 打包的 _b27_manager.bundle.mjs）
// 对接「零依赖 mock 协议网关」（mock-protocol-gateway.mjs），跑通：
//   A1 入站 WA_MSG_IN_PUSH -> /api/messages/batch 入库形状
//   A2 状态 WA_MSG_STATUS_PUSH -> 用 conversationId 反查 chatKey 后写 /api/messages/status
//   A3 出站 mgr.send -> POST /messages/send 且回执 msgKey 与入站同键
//   A4 心跳：网关发 PING，client 回 PONG
//   B  鉴权失败 4001 -> onAuthFailure 刷新 token 后重连恢复
//   C  硬停 4005 -> 不重连，连接断开
// 替换真机联调时，只需把 manager 的 baseUrl/wsUrl 指向真实网关（VITE_PROTOCOL_URL/WS_URL），
// ingest/applyStatus/getToken/onAuthFailure 接入真实 SCRM 后端与 auth store 即可。
//
// 运行：node run.mjs  （会先用 esbuild 打包 manager.ts，再跑本 harness）

import { startGateway } from './mock-protocol-gateway.mjs'

let passed = 0
let failed = 0

async function test(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  \x1b[32mPASS\x1b[0m  ${name}`)
  } catch (e) {
    failed += 1
    console.error(`  \x1b[31mFAIL\x1b[0m  ${name}\n        ${e.message}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed')
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || 'eq'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(fn, timeout = 5000, interval = 25) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (fn()) return
    await sleep(interval)
  }
  throw new Error('waitFor timeout')
}

function makeSinks() {
  const ingests = []
  const statuses = []
  return {
    ingests,
    statuses,
    ingest: async (b) => {
      ingests.push(b)
    },
    applyStatus: async (s) => {
      statuses.push(s)
    }
  }
}

const CHAT_KEY = '8613800138000@c.us'

function buildManager(ProtocolSyncManager, gw, sinks, extra = {}) {
  return new ProtocolSyncManager({
    baseUrl: gw.baseUrl,
    wsUrl: gw.wsUrl,
    getToken: extra.getToken ?? (() => 'ok'),
    ingest: sinks.ingest,
    applyStatus: sinks.applyStatus,
    ...extra
  })
}

export async function runB27() {
  // 真实实现来自 esbuild 打包产物（run.mjs 已先行构建）
  const { ProtocolSyncManager } = await import('./_b27_manager.bundle.mjs')

  // ---- A1 入站 -> 入库形状 ----
  await test('A1 入站 WA_MSG_IN_PUSH -> /api/messages/batch 形状正确', async () => {
    const gw = await startGateway()
    const sinks = makeSinks()
    const mgr = buildManager(ProtocolSyncManager, gw, sinks)
    mgr.start([7])
    await waitFor(() => gw.clients.size >= 1)
    gw.broadcast('WA_MSG_IN_PUSH', {
      conversationId: 555,
      messageId: 9001,
      from: 0,
      peerJid: CHAT_KEY,
      senderJid: CHAT_KEY,
      senderName: '客户A',
      msgType: 1,
      content: { text: '你好' },
      waTimestamp: '1700000000',
      wpMsgId: 'WA_BLUE_123'
    })
    await waitFor(() => sinks.ingests.length >= 1)
    const batch = sinks.ingests[0]
    eq(batch.accountId, 7, 'accountId')
    eq(batch.activeChatKey, null, 'activeChatKey')
    eq(batch.messages.length, 1, 'messages length')
    const m = batch.messages[0]
    eq(m.chatKey, CHAT_KEY, 'chatKey')
    eq(m.msgKey, '9001', 'msgKey')
    eq(m.direction, 'in', 'direction')
    eq(m.status, 'received', 'status')
    eq(m.body, '你好', 'body')
    eq(m.mediaType, 'text', 'mediaType')
    eq(m.msgTimeEpochSec, 1700000000, 'epoch')
    eq(m.msgId, 'WA_BLUE_123', 'msgId')
    eq(m.source, 'live', 'source')
    mgr.stop()
    await gw.close()
  })

  // ---- A2 状态 -> 反查 chatKey ----
  await test('A2 状态 WA_MSG_STATUS_PUSH -> conversationId 反查 chatKey 后写 status', async () => {
    const gw = await startGateway()
    const sinks = makeSinks()
    const mgr = buildManager(ProtocolSyncManager, gw, sinks)
    mgr.start([7])
    await waitFor(() => gw.clients.size >= 1)
    gw.broadcast('WA_MSG_IN_PUSH', {
      conversationId: 555,
      messageId: 9001,
      from: 0,
      peerJid: CHAT_KEY,
      content: { text: 'hi' }
    })
    await waitFor(() => sinks.ingests.length >= 1)
    gw.broadcast('WA_MSG_STATUS_PUSH', { conversationId: 555, messageId: 9001, status: 4 })
    await waitFor(() => sinks.statuses.length >= 1)
    const st = sinks.statuses[0]
    eq(st.accountId, 7, 'accountId')
    eq(st.chatKey, CHAT_KEY, 'chatKey (反查)')
    assert(Array.isArray(st.updates) && st.updates.length === 1, 'updates length')
    eq(st.updates[0].msgKey, '9001', 'status msgKey')
    eq(st.updates[0].status, 'read', 'status 映射 (4->read)')
    mgr.stop()
    await gw.close()
  })

  // ---- A3 出站 ----
  await test('A3 出站 mgr.send -> POST /messages/send 且回执 msgKey 与入站同键', async () => {
    const gw = await startGateway()
    const sinks = makeSinks()
    const mgr = buildManager(ProtocolSyncManager, gw, sinks)
    mgr.start([7])
    await waitFor(() => gw.clients.size >= 1)
    const receipt = await mgr.send(7, CHAT_KEY, 'hello')
    assert(receipt.ok === true, `send receipt ok (got ${JSON.stringify(receipt)})`)
    assert(typeof receipt.msgKey === 'string' && receipt.msgKey.length > 0, 'msgKey present')
    await waitFor(() => gw.sentMessages.length >= 1, 4000)
    const sent = gw.sentMessages[0]
    const reply = gw.sentReplies[0]
    eq(sent.accountId, 7, 'send accountId')
    eq(sent.toJid, CHAT_KEY, 'send toJid')
    eq(sent.content?.text, 'hello', 'send content.text')
    eq(sent.msgType, 1, 'send msgType')
    assert(typeof sent.clientMsgId === 'string' && sent.clientMsgId.length > 0, 'clientMsgId present')
    eq(receipt.msgKey, String(reply.messageId), 'receipt.msgKey == mock 分配的 messageId')
    mgr.stop()
    await gw.close()
  })

  // ---- A4 心跳 ----
  await test('A4 心跳：网关发 PING，client 回 PONG', async () => {
    const gw = await startGateway()
    const sinks = makeSinks()
    const mgr = buildManager(ProtocolSyncManager, gw, sinks)
    mgr.start([7])
    await waitFor(() => gw.clients.size >= 1)
    const before = gw.pongCount
    gw.pingClients()
    await waitFor(() => gw.pongCount > before, 4000)
    assert(gw.pongCount > before, 'client replied PONG')
    mgr.stop()
    await gw.close()
  })

  // ---- B 鉴权失败 4001 -> 刷新重连 ----
  await test('B 鉴权失败 4001 -> onAuthFailure 刷新 token 后重连并入站成功', async () => {
    const gw = await startGateway()
    const sinks = makeSinks()
    let token = 'reject'
    const mgr = buildManager(ProtocolSyncManager, gw, sinks, {
      getToken: () => token,
      onAuthFailure: async () => {
        token = 'ok'
        return 'ok'
      }
    })
    mgr.start([8])
    await waitFor(() => gw.clients.size >= 1, 6000)
    gw.broadcast('WA_MSG_IN_PUSH', {
      conversationId: 556,
      messageId: 9101,
      from: 0,
      peerJid: '8613900000000@c.us',
      content: { text: 'recovered' }
    })
    await waitFor(() => sinks.ingests.length >= 1, 4000)
    eq(sinks.ingests[0].accountId, 8, 'recovered accountId')
    mgr.stop()
    await gw.close()
  })

  // ---- C 硬停 4005 -> 不重连 ----
  await test('C 被踢 4005 -> 硬停不重连，连接断开', async () => {
    const gw = await startGateway()
    const sinks = makeSinks()
    const mgr = buildManager(ProtocolSyncManager, gw, sinks, { getToken: () => 'kick' })
    mgr.start([9])
    await waitFor(() => gw.clients.size === 0, 6000)
    gw.broadcast('WA_MSG_IN_PUSH', {
      conversationId: 557,
      messageId: 9201,
      from: 0,
      peerJid: '8613700000000@c.us',
      content: { text: 'x' }
    })
    await sleep(300)
    eq(sinks.ingests.length, 0, '硬停后无 ingest')
    mgr.stop()
    await gw.close()
  })

  console.log(`\nB27 离线联调结果：${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}
