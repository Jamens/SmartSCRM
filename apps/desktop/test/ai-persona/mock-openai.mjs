// apps/desktop/test/ai-persona/mock-openai.mjs
// B28 离线契约联调用的零依赖 OpenAI 兼容 mock（node:http，随机端口，只监听 127.0.0.1）。
//
// 与真实 Ollama / OpenAI 兼容端保持同样的线路形状：
//   GET  /v1/models             -> { data: [{ id }] }
//   POST /v1/chat/completions   -> { choices: [{ message: { role, content } }] }
//   POST /v1/embeddings         -> { data: [{ embedding: number[768] }] }
//
// 通过 setMode() 在**同一个 URL** 上切换异常响应，让 harness 能逐条验证客户端的失败口径：
//   ok / 401 / 500 / malformed / missing-choices / blank-content / slow
// requests 记录每一次请求的 method / path / headers / 原始 body / 解析后的 json，
// 供 harness 断言请求形状（model、messages、stream:false、apiKey 头规则）。
//
// 注意：本 mock 只模拟「模型端点」，不模拟 SCRM 自己的后端与数据库。
//
// 用法：
//   const mock = await startOpenAIMock()
//   mock.baseUrl / mock.setMode('401') / mock.requests / mock.lastRequest() / await mock.close()

import { createServer } from 'node:http'

export const MOCK_CONTENT = '请您提供订单号，以便我们查询发货情况。'
export const MOCK_MODELS = ['qwen2.5:3b', 'nomic-embed-text']

export async function startOpenAIMock() {
  const requests = []
  let mode = 'ok'
  let slowMs = 400

  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8')
    let json = null
    try { json = JSON.parse(raw) } catch { /* 畸形 body 原样留档，不解析 */ }
    requests.push({ method: req.method, path: req.url, headers: { ...req.headers }, raw, json })

    const send = (status, body) => {
      if (res.writableEnded) return
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(body)
    }
    const sendJson = (status, obj) => send(status, JSON.stringify(obj))

    if (req.method === 'GET' && req.url === '/v1/models') {
      return sendJson(200, { object: 'list', data: MOCK_MODELS.map((id) => ({ id, object: 'model', owned_by: 'local' })) })
    }

    if (req.method === 'POST' && req.url === '/v1/embeddings') {
      const vector = Array.from({ length: 768 }, (_, i) => Math.sin(i / 100))
      return sendJson(200, { object: 'list', model: json?.model ?? 'nomic-embed-text',
        data: [{ object: 'embedding', index: 0, embedding: vector }] })
    }

    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      const activeMode = mode
      if (activeMode === 'slow') await new Promise((r) => setTimeout(r, slowMs))
      if (activeMode === '401') return sendJson(401, { error: { message: 'invalid api key' } })
      if (activeMode === '500') return send(500, 'upstream exploded')
      if (activeMode === 'malformed') return send(200, '{ this is not json')
      if (activeMode === 'missing-choices') return sendJson(200, { model: json?.model, choices: [] })
      if (activeMode === 'blank-content') return sendJson(200, { choices: [{ message: { content: '   ' } }] })
      return sendJson(200, {
        id: 'chatcmpl-b28-mock', object: 'chat.completion', model: json?.model ?? 'qwen2.5:3b',
        choices: [{ index: 0, message: { role: 'assistant', content: MOCK_CONTENT }, finish_reason: 'stop' }]
      })
    }

    return sendJson(404, { error: { message: 'not found' } })
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    setMode: (next) => { mode = next },
    setSlowMs: (ms) => { slowMs = ms },
    lastRequest: () => requests[requests.length - 1],
    close: async () => {
      server.closeAllConnections?.()
      await new Promise((resolve) => server.close(resolve))
    }
  }
}
