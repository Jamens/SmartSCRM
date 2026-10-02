// tmp/mock-protocol-gateway.mjs
// B27（WA 协议号）离线联调用的零依赖 mock 协议网关。
// 仅用 Node 内置模块（http + crypto）实现一个最小但正确的 RFC6455 WebSocket 服务端 + REST 接口，
// 严格按已对齐旧版 D:\electron-client 的契约模拟外部 protocol 服务：
//   - WS 帧是 { event, data } 信封（JSON）；PING/PONG 是裸 socket 文本字符串（"PING"/"PONG"），不走 JSON。
//   - WS 鉴权：accesstoken 走 query（Bearer 前缀由 client 先剥离）。
//   - 关闭码：'reject' token -> 4001（鉴权失败，刷新 token 后重试）；'kick' token -> 4005（硬停，不重连）。
//   - REST：POST /messages/send 记录请求体并返回 ProtocolSendResponse；其余端点回 200。
// 注意：本 mock 只模拟「外部协议网关」，不模拟 SCRM 自己的后端（/api/messages/batch 等由 harness 注入桩）。
//
// 用法：
//   const gw = await startGateway()            // 随机端口
//   gw.baseUrl  /  gw.wsUrl                    // 给 ProtocolSyncManager 的 baseUrl / wsUrl
//   gw.broadcast(event, data)                  // 向所有已连 client 推一帧 WS 业务帧
//   gw.sentMessages                           // 捕获到的 /messages/send 请求体数组
//   gw.pongCount                              // client 回过的 PONG 数（测心跳通路）
//   gw.clients.size                           // 当前在线 WS 连接数
//   await gw.close()

import { createServer } from 'node:http'
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

function computeAccept(key) {
  return crypto.createHash('sha1').update(key + WS_GUID).digest('base64')
}

// 服务端->客户端帧：必不加掩码（b1 高位为 0），FIN=1。
function encodeFrame(payload, opcode = 0x1) {
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8')
  const len = buf.length
  let header
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len])
  } else if (len < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x80 | opcode
    header[1] = 126
    header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x80 | opcode
    header[1] = 127
    header.writeBigUInt64BE(BigInt(len), 2)
  }
  return Buffer.concat([header, buf])
}

function encodeClose(code, reason = '') {
  const reasonBuf = Buffer.from(reason, 'utf8')
  const body = Buffer.alloc(2 + reasonBuf.length)
  body.writeUInt16BE(code, 0)
  reasonBuf.copy(body, 2)
  return encodeFrame(body, 0x8)
}

// 解析客户端->服务端（带掩码）帧，逐帧回调 (opcode, payloadBuffer)。返回未消费剩余字节。
function parseFrames(buffer, onFrame) {
  let offset = 0
  while (offset + 2 <= buffer.length) {
    const b0 = buffer[offset]
    const b1 = buffer[offset + 1]
    const opcode = b0 & 0x0f
    const masked = (b1 & 0x80) === 0x80
    let len = b1 & 0x7f
    let pos = offset + 2
    if (len === 126) {
      if (pos + 2 > buffer.length) break
      len = buffer.readUInt16BE(pos)
      pos += 2
    } else if (len === 127) {
      if (pos + 8 > buffer.length) break
      len = Number(buffer.readBigUInt64BE(pos))
      pos += 8
    }
    let maskKey
    if (masked) {
      if (pos + 4 > buffer.length) break
      maskKey = buffer.subarray(pos, pos + 4)
      pos += 4
    }
    if (pos + len > buffer.length) break
    let payload = buffer.subarray(pos, pos + len)
    if (masked) {
      const unmasked = Buffer.alloc(len)
      for (let i = 0; i < len; i++) unmasked[i] = payload[i] ^ maskKey[i % 4]
      payload = unmasked
    }
    onFrame(opcode, payload)
    offset = pos + len
  }
  return buffer.subarray(offset)
}

export async function startGateway(opts = {}) {
  const port = opts.port ?? 0
  const ee = new EventEmitter()
  const sentMessages = [] // 捕获的 /messages/send 请求体
  const sentReplies = [] // 网关为每次 send 分配的回执（含 messageId）
  const clients = new Set() // 每个元素 { socket, buffer, alive, token }
  let pongCount = 0 // client 回过的 PONG 数
  let msgSeq = 1 // 自增 messageId，便于断言

  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost')
    if (req.method === 'POST' && u.pathname === '/messages/send') {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        let body = {}
        try {
          body = JSON.parse(raw || '{}')
        } catch {
          /* ignore */
        }
        sentMessages.push(body)
        const messageId = opts.nextMessageId ? opts.nextMessageId() : msgSeq++
        const reply = {
          messageId,
          wpMsgId: `wa-${body.clientMsgId ?? ''}`,
          msgKey: String(messageId),
          status: 2
        }
        sentReplies.push(reply)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(reply))
      })
      return
    }
    // 其余 REST 端点（/conversations、/media/sts-credential 等）回 200 占位
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, path: u.pathname }))
  })

  server.on('upgrade', (req, socket, head) => {
    const key = req.headers['sec-websocket-key']
    if (!key) {
      socket.destroy()
      return
    }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${computeAccept(key)}\r\n\r\n`
    )

    const u = new URL(req.url, 'http://localhost')
    const token = u.searchParams.get('accesstoken') || u.searchParams.get('token') || ''
    const state = { socket, buffer: Buffer.from(head || ''), alive: true, token }

    // 鉴权模拟：reject -> 4001（刷新重试）；kick -> 4005（硬停）
    if (token === 'reject' || token === 'kick') {
      const code = token === 'reject' ? 4001 : 4005
      socket.write(encodeClose(code, token))
      socket.end()
      return
    }

    clients.add(state)
    ee.emit('connect', state)
    socket.on('data', (chunk) => {
      state.buffer = Buffer.concat([state.buffer, chunk])
      state.buffer = parseFrames(state.buffer, (opcode, payload) => {
        if (opcode === 0x8) {
          // close
          state.alive = false
          try {
            socket.end()
          } catch {
            /* noop */
          }
          return
        }
        if (opcode === 0x1) {
          const text = payload.toString('utf8')
          if (text === 'PING') {
            // client 发来的心跳 -> 回 PONG（裸字符串，非 JSON）
            socket.write(encodeFrame('PONG'))
          } else if (text === 'PONG') {
            pongCount += 1
            ee.emit('pong')
          }
          // 其他文本帧忽略
        }
        // 协议级 ping(0x9)/pong(0xa) 由底层处理，这里无需动作
      })
    })
    socket.on('close', () => {
      state.alive = false
      clients.delete(state)
      ee.emit('disconnect', state)
    })
    socket.on('error', () => {
      state.alive = false
      clients.delete(state)
    })
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve())
  })
  const actualPort = server.address().port

  function broadcast(event, data) {
    const frame = encodeFrame(JSON.stringify({ event, data }))
    for (const c of clients) {
      if (c.alive) c.socket.write(frame)
    }
  }

  // 向所有在线 client 发裸 "PING" 字符串帧，用于验证 client 心跳回 PONG 的通路。
  function pingClients() {
    for (const c of clients) {
      if (c.alive) c.socket.write(encodeFrame('PING'))
    }
  }

  async function close() {
    for (const c of clients) {
      try {
        c.socket.destroy()
      } catch {
        /* noop */
      }
    }
    clients.clear()
    // server.close() 在存在遗留连接/半开 socket 时可能不回调，强制兜底 resolve。
    await new Promise((resolve) => {
      server.close(() => resolve())
      setTimeout(resolve, 300)
    })
  }

  return {
    get port() {
      return actualPort
    },
    get baseUrl() {
      return `http://127.0.0.1:${actualPort}`
    },
    get wsUrl() {
      return `ws://127.0.0.1:${actualPort}`
    },
    get pongCount() {
      return pongCount
    },
    sentMessages,
    sentReplies,
    clients,
    ee,
    broadcast,
    pingClients,
    close
  }
}
