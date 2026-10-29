// 期一：契约层，未经真机验证
// 期二待办：换成真实 MTProto 网关后，帧里四个待实测字段（msgType 取值域、时间戳落在 waTimestamp 还是 createdAt、
//           senderJid 是否带 user#id 形态、已读回执的等价事件）需拿真实账号逐条回填到 normalize.ts / map.ts
// 契约见 docs/superpowers/specs/2026-10-28-telegram-mtproto-collection-design.md
//
// apps/desktop/test/telegram-protocol/tg-offline-integration.mjs
// TG 协议源（期一）离线联调 harness。
// 用「真实的」ProtocolSyncManager + ProtocolClient（来自 esbuild 打包的 _tg_manager.bundle.mjs）
// 对接「零依赖 mock TG 网关」（mock-tg-gateway.mjs），跑通：
//   T1 建连：start([{accountId, source:'telegram'}]) 后网关收到带 token 的 WS 握手
//   T2 心跳：网关发裸文本 PING，client 回 PONG
//   T3 鉴权失败 4001 -> onAuthFailure 刷新 token 后重连，入站恢复
//   T4 硬停 4005 -> 不重连，连接保持断开
//   T5 入站归一：TG_MSG_IN_PUSH（群 -1001234567890 / msgType 'photo'）-> /api/messages/batch 形态正确
//   T6 状态推进：TG_MSG_STATUS_PUSH 只带 conversationId + messageId -> 反查 chatKey 后写 status
//   T7 多源并存：wa-protocol 与 telegram 两个账号同时 start()，各自推帧 -> 落库形状各自正确、互不串台
// 零外网连接（R9）：所有流量只走 127.0.0.1 上的 mock 网关。
//
// 运行：node run.mjs  （会先用 esbuild 打包 manager.ts，再跑本 harness）

import { startGateway, TG_WS_TYPES } from './mock-tg-gateway.mjs'
// T7 的 WA 那条腿直接复用 B27 的 mock（同一份零依赖实现），以此证明两个源打的是**两个不同网关**
import { startGateway as startWaGateway } from '../protocol-integration/mock-protocol-gateway.mjs'

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
  if (a !== b)
    throw new Error(`${msg || 'eq'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
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

// TG 数字形态的 chat_key（与 @shared/protocol/map.ts 的 tgChatKeyOf、Java ChatKeys.TG_CHAT 同形）
const TG_GROUP_KEY = '-1001234567890' // 超级群
const TG_PEER_KEY = '1234567890' // 单聊
const WA_CHAT_KEY = '8613800138000@c.us' // T7 的 WA 那条腿

/**
 * 只给 TG 地址（baseUrl/wsUrl 故意留空）：这样若 manager 没把 telegram 源路由到 tgWsUrl，
 * client 会因 wsUrl 为空而静默不连，T1 立刻变红——而不是"碰巧同一个网关也算过"。
 */
function buildManager(ProtocolSyncManager, gw, sinks, extra = {}) {
  return new ProtocolSyncManager({
    baseUrl: '',
    wsUrl: '',
    tgBaseUrl: gw.baseUrl,
    tgWsUrl: gw.wsUrl,
    getToken: extra.getToken ?? (() => 'ok'),
    ingest: sinks.ingest,
    applyStatus: sinks.applyStatus,
    ...extra
  })
}

export async function runTG() {
  // 真实实现来自 esbuild 打包产物（run.mjs 已先行构建）
  const { ProtocolSyncManager } = await import('./_tg_manager.bundle.mjs')

  // ---- T1 建连 ----
  await test('T1 建连：start([{source:telegram}]) 后网关收到带 token 的 WS 握手', async () => {
    const gw = await startGateway()
    const sinks = makeSinks()
    const mgr = buildManager(ProtocolSyncManager, gw, sinks)
    mgr.start([{ accountId: 11, source: 'telegram' }])
    await waitFor(() => gw.clients.size >= 1)
    const tokens = [...gw.clients].map((c) => c.token)
    assert(tokens.includes('ok'), `WS 握手应带 accesstoken=ok，实际 ${JSON.stringify(tokens)}`)
    eq(gw.handshakes.length, 1, '握手次数')
    mgr.stop()
    await gw.close()
  })

  // ---- T2 心跳 ----
  await test('T2 心跳：网关发裸文本 PING，client 回 PONG', async () => {
    const gw = await startGateway()
    const sinks = makeSinks()
    const mgr = buildManager(ProtocolSyncManager, gw, sinks)
    mgr.start([{ accountId: 12, source: 'telegram' }])
    await waitFor(() => gw.clients.size >= 1)
    const before = gw.pongCount
    gw.pingClients()
    await waitFor(() => gw.pongCount > before, 4000)
    assert(gw.pongCount > before, 'client replied PONG')
    mgr.stop()
    await gw.close()
  })

  // ---- T3 鉴权失败 4001 -> 刷新 token 后重连 ----
  await test('T3 鉴权失败 4001 -> onAuthFailure 刷新 token 后重连并入站成功', async () => {
    const gw = await startGateway()
    const sinks = makeSinks()
    let token = 'reject'
    let authFailures = 0
    const mgr = buildManager(ProtocolSyncManager, gw, sinks, {
      getToken: () => token,
      onAuthFailure: async () => {
        authFailures += 1
        token = 'ok'
        return 'ok'
      }
    })
    mgr.start([{ accountId: 13, source: 'telegram' }])
    await waitFor(() => gw.clients.size >= 1, 6000)
    eq(authFailures, 1, 'onAuthFailure 调用次数（证明走了 4001 分支）')
    assert(
      gw.handshakes[0] === 'reject' && gw.handshakes[1] === 'ok',
      `重连前后握手 token 应为 reject->ok，实际 ${JSON.stringify(gw.handshakes)}`
    )
    gw.pushInbound({
      conversationId: 7001,
      messageId: 8001,
      from: 0,
      peerJid: TG_GROUP_KEY,
      content: { text: 'recovered' }
    })
    await waitFor(() => sinks.ingests.length >= 1, 4000)
    eq(sinks.ingests[0].accountId, 13, 'recovered accountId')
    mgr.stop()
    await gw.close()
  })

  // ---- T4 硬停 4005 -> 不重连 ----
  await test('T4 硬停 4005 -> 不重连，连接保持断开', async () => {
    const gw = await startGateway()
    const sinks = makeSinks()
    const mgr = buildManager(ProtocolSyncManager, gw, sinks, { getToken: () => 'kick' })
    mgr.start([{ accountId: 14, source: 'telegram' }])
    await waitFor(() => gw.handshakes.length >= 1, 4000)
    // 退避第一次是 1s：真重连的话 1.5s 内一定已经再来握手过
    await sleep(1500)
    eq(gw.handshakes.length, 1, '硬停后不再握手（重连次数）')
    eq(gw.clients.size, 0, '硬停后无在线连接')
    gw.pushInbound({
      conversationId: 7002,
      messageId: 8002,
      from: 0,
      peerJid: TG_GROUP_KEY,
      content: { text: 'x' }
    })
    await sleep(300)
    eq(sinks.ingests.length, 0, '硬停后无 ingest')
    mgr.stop()
    await gw.close()
  })

  // ---- T5 入站归一 ----
  await test('T5 入站归一：TG_MSG_IN_PUSH（群 -1001234567890 / photo）-> batch 形态正确', async () => {
    const gw = await startGateway()
    const sinks = makeSinks()
    const mgr = buildManager(ProtocolSyncManager, gw, sinks)
    mgr.start([{ accountId: 15, source: 'telegram' }])
    await waitFor(() => gw.clients.size >= 1)
    gw.pushInbound({
      conversationId: 7003,
      messageId: 8003,
      from: 0,
      peerJid: TG_GROUP_KEY,
      senderJid: '555000111',
      senderName: 'TG 客户',
      msgType: 'photo',
      content: { text: '看图', fileName: 'a.jpg' },
      waTimestamp: '1700000000',
      wpMsgId: 'TG_8003'
    })
    await waitFor(() => sinks.ingests.length >= 1)
    const batch = sinks.ingests[0]
    eq(batch.accountId, 15, 'accountId')
    eq(batch.activeChatKey, null, 'activeChatKey')
    eq(batch.messages.length, 1, 'messages length')
    const m = batch.messages[0]
    eq(m.chatKey, TG_GROUP_KEY, 'chatKey（TG 超级群形态）')
    eq(m.msgKey, '8003', 'msgKey')
    eq(m.direction, 'in', 'direction')
    eq(m.status, 'received', 'status')
    eq(m.body, '看图', 'body')
    eq(m.mediaType, 'image', 'mediaType（TG photo -> image）')
    eq(m.msgTimeEpochSec, 1700000000, 'epoch')
    eq(m.msgId, 'TG_8003', 'msgId')
    eq(m.source, 'live', 'source')
    mgr.stop()
    await gw.close()
  })

  // ---- T6 状态推进 ----
  await test('T6 状态推进：TG_MSG_STATUS_PUSH 只带 conversationId+messageId -> 反查 chatKey 后写 status', async () => {
    const gw = await startGateway()
    const sinks = makeSinks()
    const mgr = buildManager(ProtocolSyncManager, gw, sinks)
    mgr.start([{ accountId: 16, source: 'telegram' }])
    await waitFor(() => gw.clients.size >= 1)
    gw.pushInbound({
      conversationId: 7004,
      messageId: 8004,
      from: 0,
      peerJid: TG_PEER_KEY,
      content: { text: 'hi' }
    })
    await waitFor(() => sinks.ingests.length >= 1)
    gw.pushStatus({ conversationId: 7004, messageId: 8004, status: 4 })
    await waitFor(() => sinks.statuses.length >= 1)
    const st = sinks.statuses[0]
    eq(st.accountId, 16, 'accountId')
    eq(st.chatKey, TG_PEER_KEY, 'chatKey（反查得 TG 单聊形态）')
    assert(Array.isArray(st.updates) && st.updates.length === 1, 'updates length')
    eq(st.updates[0].msgKey, '8004', 'status msgKey')
    eq(st.updates[0].status, 'read', 'status 映射 (4->read)')
    mgr.stop()
    await gw.close()
  })

  // ---- T7 多源并存 ----
  await test('T7 多源并存：wa-protocol 与 telegram 同时在线，落库形状各自正确、互不串台', async () => {
    const waGw = await startWaGateway() // WA 源打这个网关（baseUrl/wsUrl）
    const tgGw = await startGateway() // TG 源打这个网关（tgBaseUrl/tgWsUrl）
    const sinks = makeSinks()
    const mgr = new ProtocolSyncManager({
      baseUrl: waGw.baseUrl,
      wsUrl: waGw.wsUrl,
      tgBaseUrl: tgGw.baseUrl,
      tgWsUrl: tgGw.wsUrl,
      getToken: () => 'ok',
      ingest: sinks.ingest,
      applyStatus: sinks.applyStatus
    })
    mgr.start([
      { accountId: 71, source: 'wa-protocol' },
      { accountId: 81, source: 'telegram' }
    ])
    await waitFor(() => waGw.clients.size >= 1 && tgGw.clients.size >= 1)

    // 两个源故意用**同一个 conversationId**，且事件名各自不同源：
    // 若 conversationId->chatKey 的映射不是按账号隔离的，状态推送就会串到对方的 chatKey 上。
    const SHARED_CONV = 777
    waGw.broadcast('WA_MSG_IN_PUSH', {
      conversationId: SHARED_CONV,
      messageId: 9501,
      from: 0,
      peerJid: WA_CHAT_KEY,
      senderName: 'WA 客户',
      msgType: 2,
      content: { text: 'wa 图' },
      waTimestamp: '1700000001',
      wpMsgId: 'WA_9501'
    })
    tgGw.pushInbound({
      conversationId: SHARED_CONV,
      messageId: 9502,
      from: 0,
      peerJid: TG_GROUP_KEY,
      senderName: 'TG 客户',
      msgType: 'voice',
      content: { text: 'tg 语音' },
      waTimestamp: '1700000002',
      wpMsgId: 'TG_9502'
    })
    await waitFor(() => sinks.ingests.length >= 2)
    eq(sinks.ingests.length, 2, '两个源各一条，不多不少')
    eq(waGw.clients.size, 1, 'WA 网关只被 WA 源连')
    eq(tgGw.clients.size, 1, 'TG 网关只被 TG 源连')

    const wa = sinks.ingests.find((b) => b.accountId === 71)
    const tg = sinks.ingests.find((b) => b.accountId === 81)
    assert(
      wa && tg,
      `两条入站应分属两个账号，实际 ${JSON.stringify(sinks.ingests.map((b) => b.accountId))}`
    )
    eq(wa.messages[0].chatKey, WA_CHAT_KEY, 'WA 源 chatKey 保持 WA 形态')
    eq(wa.messages[0].mediaType, 'image', 'WA 源 msgType 2 -> image（WA 数值域）')
    eq(wa.messages[0].msgKey, '9501', 'WA 源 msgKey')
    eq(tg.messages[0].chatKey, TG_GROUP_KEY, 'TG 源 chatKey 保持 TG 形态')
    eq(tg.messages[0].mediaType, 'audio', 'TG 源 voice -> audio（TG 名称域）')
    eq(tg.messages[0].msgKey, '9502', 'TG 源 msgKey')

    // 状态腿：同一个 conversationId 两边各推一帧，反查出的 chatKey 必须各回各家
    waGw.broadcast('WA_MSG_STATUS_PUSH', {
      conversationId: SHARED_CONV,
      messageId: 9501,
      status: 4
    })
    tgGw.pushStatus({ conversationId: SHARED_CONV, messageId: 9502, status: 4 })
    await waitFor(() => sinks.statuses.length >= 2)
    eq(sinks.statuses.length, 2, '两条状态推送')
    const waSt = sinks.statuses.find((s) => s.accountId === 71)
    const tgSt = sinks.statuses.find((s) => s.accountId === 81)
    assert(waSt && tgSt, '两条状态应分属两个账号')
    eq(waSt.chatKey, WA_CHAT_KEY, 'WA 状态反查回 WA chatKey（未串到 TG）')
    eq(tgSt.chatKey, TG_GROUP_KEY, 'TG 状态反查回 TG chatKey（未串到 WA）')
    eq(waSt.updates[0].msgKey, '9501', 'WA 状态 msgKey')
    eq(tgSt.updates[0].msgKey, '9502', 'TG 状态 msgKey')
    eq(tgSt.updates[0].status, 'read', 'TG 状态 4->read')

    assert(TG_WS_TYPES.MSG_IN === 'TG_MSG_IN_PUSH', 'TG 事件名常量')
    mgr.stop()
    await waGw.close()
    await tgGw.close()
  })

  console.log(`\nTG 期一离线联调结果：${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}
