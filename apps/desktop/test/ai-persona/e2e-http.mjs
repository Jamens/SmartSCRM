// apps/desktop/test/ai-persona/e2e-http.mjs
// B28 **端到端 HTTP 验收**：打真实 Spring Boot + 真实 MySQL + 真实模型端点，
// 走 登录 → 绑定人设 → 点按生成 → 回查四列 → 否决 → 解绑 → 双闸拒绝。
//
// 与 offline / real-model-probe 的分工（三者互不替代）：
//   test:ai        零外网 mock，验线路契约 + 生产源码静态守卫
//   test:ai:real   直连模型端点，验「换人设语气真的变」
//   test:ai:e2e    这里，验**整套 HTTP 链路 + 权限 + 落库四列 + 否决清理**
//
// 前置条件：
//   1. MySQL 起好、后端 spring-boot:run 起好（需注入 SCRM_DB_PASSWORD / SCRM_JWT_SECRET /
//      SCRM_CHAT_BASE_URL / SCRM_CHAT_MODEL；见 README §八）
//   2. 准备一个账号 + 一份会话/人设种子（见 docs/superpowers/specs/2026-11-01-b28-persona-engine-design.md §1.3）
//   3. 通过环境变量给本脚本凭据与 ID，**仓库里不写死任何账号、口令、token**
//
// 环境变量：
//   B28_E2E_BASE_URL        默认 http://127.0.0.1:8180
//   B28_E2E_TOKEN           直接给 access token（给了就跳过登录）
//   B28_E2E_USERNAME / B28_E2E_PASSWORD / B28_E2E_INVITE_CODE / B28_E2E_DEVICE_ID   登录四要素
//   B28_E2E_CONV_ID         待测会话 id
//   B28_E2E_TERSE_ID        极简人设 id
//   B28_E2E_EMPATHIC_ID     共情人设 id
//   B28_E2E_IDS_FILE        可选：种子输出的 ids JSON（优先级低于逐个 env）
//
// 用法：pnpm --filter smartscrm-desktop run test:ai:e2e

import { readFile } from 'node:fs/promises'

const BASE = (process.env.B28_E2E_BASE_URL || 'http://127.0.0.1:8180').replace(/\/+$/, '')
const TIMEOUT_MS = Number(process.env.B28_E2E_TIMEOUT_MS || 180000)

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

/** 统一请求：返回 { status, body }，业务错误也照常解析 body（ApiResponse.code != 0）。 */
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

async function idsFromEnv() {
  let fileIds = {}
  if (process.env.B28_E2E_IDS_FILE) {
    try { fileIds = JSON.parse(await readFile(process.env.B28_E2E_IDS_FILE, 'utf8')) } catch { /* 忽略 */ }
  }
  const num = (key, fallback) => {
    const v = process.env[key]
    return v === undefined || v === '' ? fallback : Number(v)
  }
  return {
    convId: num('B28_E2E_CONV_ID', fileIds.convId),
    terseId: num('B28_E2E_TERSE_ID', fileIds.terseId),
    empathicId: num('B28_E2E_EMPATHIC_ID', fileIds.empathicId)
  }
}

/** 从接管队列回查四列（这就是前端看到的数据，不绕后端直接查库）。 */
async function readConv(token, convId) {
  const r = await call('/api/conversations/takeover-queue', { token })
  assert(r.status === 200 && r.body?.code === 0, `队列读取失败: HTTP ${r.status} ${r.raw.slice(0, 160)}`)
  const conv = (r.body.data ?? []).find((x) => x.id === convId)
  assert(conv, `队列里找不到会话 ${convId}（确认 handling_status=WAITING_TAKEOVER 且租户一致）`)
  return conv
}

const requireOk = (r, label) => {
  assert(r.status === 200 && r.body?.code === 0,
    `${label} 失败: HTTP ${r.status} code=${r.body?.code} msg=${r.body?.message}`)
  return r.body.data
}

console.log(`\nB28 端到端 HTTP 验收 · ${BASE}`)
console.log('（真实 Spring Boot + MySQL + 模型端点；凭据与 ID 全走环境变量）\n')

const { convId, terseId, empathicId } = await idsFromEnv()
assert(Number.isFinite(convId) && Number.isFinite(terseId) && Number.isFinite(empathicId),
  '缺少 B28_E2E_CONV_ID / B28_E2E_TERSE_ID / B28_E2E_EMPATHIC_ID（或 B28_E2E_IDS_FILE）')

let token = process.env.B28_E2E_TOKEN || ''
let terseText = ''
let empathicText = ''

await test('E1 登录真实后端拿到 access token', async () => {
  if (token) { console.log('        使用外部注入的 token'); return }
  const r = await call('/api/auth/login', {
    method: 'POST',
    body: {
      username: process.env.B28_E2E_USERNAME,
      password: process.env.B28_E2E_PASSWORD,
      inviteCode: process.env.B28_E2E_INVITE_CODE || 'DEMO0001',
      deviceId: process.env.B28_E2E_DEVICE_ID || 'b28-e2e-device'
    }
  })
  const data = requireOk(r, '登录')
  assert(data?.accessToken, '响应缺少 accessToken')
  token = data.accessToken
  console.log(`        登录成功 tenantId=${data.user?.tenantId} role=${data.user?.role}`)
})

await test('E2 初始状态：目标会话在接管队列里、四列为空', async () => {
  const c = await readConv(token, convId)
  eq(c.aiPersonaId, null, '初始未绑人设')
  eq(c.aiSuggestion, null, '初始无建议')
  eq(c.aiSuggestionSource, null, '初始无来源')
})

await test('E3 绑定人设：PUT 生效并回显 aiPersonaId', async () => {
  const data = requireOk(await call(`/api/conversations/${convId}/ai-persona`,
    { method: 'PUT', token, body: { personaId: terseId } }), '绑定')
  eq(data.aiPersonaId, terseId, '绑定后 VO')
  eq((await readConv(token, convId)).aiPersonaId, terseId, '回查队列')
})

await test('E4 绑定不存在的人设被拒，且不改动现有绑定', async () => {
  const r = await call(`/api/conversations/${convId}/ai-persona`,
    { method: 'PUT', token, body: { personaId: 99999999 } })
  assert(r.body?.code !== 0, `应返回业务错误，实际 code=${r.body?.code}`)
  eq((await readConv(token, convId)).aiPersonaId, terseId, '失败绑定不得改动现有值')
})

await test('E5 点按生成（极简人设）→ 落库 source=model、score/qaId 为 null', async () => {
  const data = requireOk(await call(`/api/conversations/${convId}/generate-ai-suggestion`,
    { method: 'POST', token }), '生成建议')
  assert(typeof data.aiSuggestion === 'string' && data.aiSuggestion.trim() !== '', '建议正文不应为空')
  eq(data.aiSuggestionSource, 'model', '来源（未配 embedding 时走模型兜底 D1）')
  eq(data.aiSuggestionScore, null, '模型建议 score 必须显式置空（D2）')
  eq(data.aiSuggestionQaId, null, '模型建议 qaId 必须显式置空（D2）')
  terseText = data.aiSuggestion.trim()
  const c = await readConv(token, convId)
  eq(c.aiSuggestion, data.aiSuggestion, '回查：正文已落库')
  eq(c.aiSuggestionSource, 'model', '回查：来源已落库')
  console.log(`        极简: ${JSON.stringify(terseText)}（${terseText.length} 字）`)
})

await test('E6 换共情人设再生成 → 语气真的变（端到端核心假设）', async () => {
  requireOk(await call(`/api/conversations/${convId}/ai-persona`,
    { method: 'PUT', token, body: { personaId: empathicId } }), '换绑')
  const data = requireOk(await call(`/api/conversations/${convId}/generate-ai-suggestion`,
    { method: 'POST', token }), '再次生成')
  empathicText = (data.aiSuggestion ?? '').trim()
  assert(empathicText.length > 0, '第二次建议不应为空')
  assert(empathicText !== terseText, '换人设后输出完全相同，人设没有起作用')
  const longer = empathicText.length > terseText.length * 1.5
  const markers = /抱歉|对不起|理解|着急|歉意|请放心|非常|感谢/
  const toneGap = markers.test(empathicText) && !markers.test(terseText)
  console.log(`        共情: ${JSON.stringify(empathicText.slice(0, 120))}（${empathicText.length} 字）`)
  console.log(`        长度 ${terseText.length} vs ${empathicText.length}；显著更长=${longer}；措辞可区分=${toneGap}`)
  assert(longer || toneGap, `语气差异不足：A=${JSON.stringify(terseText)} B=${JSON.stringify(empathicText)}`)
  eq(data.aiSuggestionSource, 'model', '第二次仍为 model')
})

await test('E7 否决建议 → 四列全清，source 一并清掉（D3）', async () => {
  const data = requireOk(await call(`/api/conversations/${convId}/dismiss-ai-suggestion`,
    { method: 'POST', token }), '否决')
  eq(data.aiSuggestion, null, '正文')
  eq(data.aiSuggestionScore, null, 'score')
  eq(data.aiSuggestionQaId, null, 'qaId')
  eq(data.aiSuggestionSource, null, 'source 必须一并清空')
  const c = await readConv(token, convId)
  eq(c.aiSuggestionSource, null, '回查：徽标不会挂在已否决的建议上')
})

await test('E8 解绑后再生成被拒（前端禁用 + 后端拒绝的双闸）', async () => {
  const unbound = requireOk(await call(`/api/conversations/${convId}/ai-persona`,
    { method: 'PUT', token, body: { personaId: null } }), '解绑')
  eq(unbound.aiPersonaId, null, '解绑后 VO')
  const r = await call(`/api/conversations/${convId}/generate-ai-suggestion`, { method: 'POST', token })
  assert(r.body?.code !== 0, `未绑人设应被拒，实际 code=${r.body?.code}`)
  const c = await readConv(token, convId)
  eq(c.aiSuggestion, null, '失败时不得写库（R5）')
  eq(c.aiSuggestionSource, null, '失败时不得留半截来源')
  console.log(`        拒绝码=${r.body?.code} msg=${r.body?.message}`)
})

await test('E9 无 token 调两个 B28 端点均被拒', async () => {
  for (const [method, path, body] of [
    ['PUT', `/api/conversations/${convId}/ai-persona`, { personaId: terseId }],
    ['POST', `/api/conversations/${convId}/generate-ai-suggestion`, undefined]
  ]) {
    const r = await call(path, { method, body })
    assert(r.status === 401 || r.status === 403, `应 401/403，实际 HTTP ${r.status}`)
  }
})

await test('E10 租户隔离：不存在的会话 id 被拒，不泄漏其它租户数据', async () => {
  const r = await call('/api/conversations/99999999/generate-ai-suggestion', { method: 'POST', token })
  assert(r.body?.code !== 0, `应拒绝，实际 code=${r.body?.code}`)
  console.log(`        拒绝码=${r.body?.code}`)
})

console.log(`\nB28 端到端 HTTP 验收结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1
