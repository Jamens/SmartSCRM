// apps/desktop/test/ai-persona/e2e-retrieval.mjs
// B28 端到端 **检索腿**：验「知识库命中时 source=retrieval、带 qaId/score、正文是标准答案」。
//
// 与 e2e-http.mjs 分开跑的原因：两条腿要求后端配置不同。
//   e2e-http.mjs      后端只配 chat（不配 embedding）→ D1 跳过检索 → 全部走 model
//   e2e-retrieval.mjs 后端同时配 embedding → 检索优先 → 命中即 retrieval，**不再调模型**
// 因此不要在同一次后端启动里同时期望两种 source。
//
// 前置：后端注入 SCRM_EMBEDDING_BASE_URL（本地 Ollama，model 默认 nomic-embed-text），
//       且已跑过 test:ai:e2e 的同一份会话/人设种子。
//
// 环境变量同 e2e-http.mjs，另加：
//   B28_E2E_QA_ROLE_ID   新建 QA 挂的角色 id（应与绑定人设的 roleId 一致）
//   B28_E2E_QUERY        检索 query（默认与客户入站消息同文）
//
// 用法：pnpm --filter smartscrm-desktop run test:ai:e2e:retrieval

import { readFile } from 'node:fs/promises'

const BASE = (process.env.B28_E2E_BASE_URL || 'http://127.0.0.1:8180').replace(/\/+$/, '')
const TIMEOUT_MS = Number(process.env.B28_E2E_TIMEOUT_MS || 180000)
const QUERY = process.env.B28_E2E_QUERY || '我的订单已经三天没发货了，到底什么时候能发？'
const ANSWER = '请先提供订单号，我们将在 24 小时内为您核实发货进度并回复。'

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
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed') }
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || 'eq'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
}

async function call(path, { method = 'GET', token, body } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const resp = await fetch(`${BASE}${path}`, {
    method, headers, signal: AbortSignal.timeout(TIMEOUT_MS),
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const text = await resp.text()
  let parsed = null
  try { parsed = JSON.parse(text) } catch { /* 非 JSON 原样留着 */ }
  return { status: resp.status, body: parsed, raw: text }
}
const requireOk = (r, label) => {
  assert(r.status === 200 && r.body?.code === 0,
    `${label} 失败: HTTP ${r.status} code=${r.body?.code} msg=${r.body?.message}`)
  return r.body.data
}
async function readConv(token, convId) {
  const r = await call('/api/conversations/takeover-queue', { token })
  const conv = (requireOk(r, '队列') ?? []).find((x) => x.id === convId)
  assert(conv, `队列里找不到会话 ${convId}`)
  return conv
}
async function idsFromEnv() {
  let f = {}
  if (process.env.B28_E2E_IDS_FILE) {
    try { f = JSON.parse(await readFile(process.env.B28_E2E_IDS_FILE, 'utf8')) } catch { /* 忽略 */ }
  }
  const num = (key, fb) => {
    const v = process.env[key]
    return v === undefined || v === '' ? fb : Number(v)
  }
  return {
    convId: num('B28_E2E_CONV_ID', f.convId),
    personaId: num('B28_E2E_TERSE_ID', f.terseId),
    roleId: num('B28_E2E_QA_ROLE_ID', f.aiRoleId)
  }
}

console.log(`\nB28 端到端检索腿 · ${BASE}`)
console.log('（后端需配 SCRM_EMBEDDING_BASE_URL；命中后不应调用 chat 模型）\n')

const { convId, personaId, roleId } = await idsFromEnv()
assert([convId, personaId, roleId].every(Number.isFinite),
  '缺少 B28_E2E_CONV_ID / B28_E2E_TERSE_ID / B28_E2E_QA_ROLE_ID（或 B28_E2E_IDS_FILE）')

let token = process.env.B28_E2E_TOKEN || ''
let qaId = null

try {
  await test('R1 登录 / 复用 token', async () => {
    if (token) return
    const d = requireOk(await call('/api/auth/login', {
      method: 'POST',
      body: {
        username: process.env.B28_E2E_USERNAME,
        password: process.env.B28_E2E_PASSWORD,
        inviteCode: process.env.B28_E2E_INVITE_CODE || 'DEMO0001',
        deviceId: process.env.B28_E2E_DEVICE_ID || 'b28-e2e-device'
      }
    }), '登录')
    assert(d?.accessToken, '响应缺少 accessToken')
    token = d.accessToken
  })

  await test('R2 检索能力已启用（embedding 端点确实配上了）', async () => {
    const cap = requireOk(await call('/api/knowledge-qa/search/capability', { token }), 'capability')
    eq(cap.available, true, 'available')
    console.log(`        model=${cap.model}`)
  })

  await test('R3 造一条标准问答并建向量索引', async () => {
    const qa = requireOk(await call('/api/knowledge-qa', {
      method: 'POST', token,
      body: { roleId, question: QUERY, answer: ANSWER, status: 1 }
    }), '建 QA')
    qaId = qa.id
    assert(Number.isFinite(qaId), 'QA 应返回 id')
    const idx = requireOk(await call('/api/knowledge-qa/search-index', { method: 'POST', token }), '建索引')
    console.log(`        qaId=${qaId} indexed=${idx.indexed} model=${idx.model}`)
    assert(idx.indexed >= 1, '至少应索引一条 QA')
  })

  await test('R4 检索端点确实召回该 QA（分数 ≥ 0.6）', async () => {
    const hits = requireOk(await call(
      `/api/knowledge-qa/search?q=${encodeURIComponent(QUERY)}`, { token }), 'search')
    assert(hits.length >= 1, '应至少召回一条')
    console.log(`        score=${hits[0].score} qaId=${hits[0].qaId ?? hits[0].qa?.id ?? '(字段见 VO)'}`)
    assert(Number(hits[0].score) >= 0.6, `相似度应 ≥0.6，实际 ${hits[0].score}`)
  })

  await test('R5 生成建议 → source=retrieval，正文=标准答案，qaId/score 有值', async () => {
    requireOk(await call(`/api/conversations/${convId}/ai-persona`,
      { method: 'PUT', token, body: { personaId } }), '绑定人设')
    const d = requireOk(await call(`/api/conversations/${convId}/generate-ai-suggestion`,
      { method: 'POST', token }), '生成建议')
    eq(d.aiSuggestionSource, 'retrieval', '来源必须是 retrieval（检索优先 R3）')
    eq(d.aiSuggestion, ANSWER, '正文必须是知识库标准答案，不是模型生成的')
    assert(d.aiSuggestionQaId != null, 'qaId 不应为空')
    assert(d.aiSuggestionScore != null && d.aiSuggestionScore >= 0.6, 'score 不应为空且应达标')
    const c = await readConv(token, convId)
    eq(c.aiSuggestionSource, 'retrieval', '回查：来源已落库')
    eq(c.aiSuggestionQaId, d.aiSuggestionQaId, '回查：qaId 已落库')
    console.log(`        建议: ${JSON.stringify(d.aiSuggestion)} score=${d.aiSuggestionScore} qaId=${d.aiSuggestionQaId}`)
  })

  await test('R6 否决建议 → 四列全清，来源不残留', async () => {
    const d = requireOk(await call(`/api/conversations/${convId}/dismiss-ai-suggestion`,
      { method: 'POST', token }), '否决')
    for (const k of ['aiSuggestion', 'aiSuggestionScore', 'aiSuggestionQaId', 'aiSuggestionSource']) {
      eq(d[k], null, k)
    }
  })
} finally {
  // 无论成功失败都清掉本轮造的 QA，避免污染本地库
  if (token && qaId != null) {
    try {
      await call(`/api/knowledge-qa/${qaId}`, { method: 'DELETE', token })
      console.log(`\n        已清理测试 QA id=${qaId}`)
    } catch (e) {
      console.log(`\n        ⚠️ 测试 QA 清理失败（id=${qaId}）：${e.message}`)
    }
  }
}

console.log(`\nB28 端到端检索腿结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1
