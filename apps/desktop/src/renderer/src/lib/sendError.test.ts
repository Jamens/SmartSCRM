// src/renderer/src/lib/sendError.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SendError, SendReceipt } from '../../../shared/chatTypes.ts'
import {
  ipcFailureText,
  NO_MSG_KEY_TEXT,
  outcomeOf,
  SEND_ERROR_TEXT,
  sendErrorLogText,
  sendErrorText
} from './sendError.ts'

/**
 * 这份文件存在的理由就是 `liveTailSync.ts` 进不了闸门（它引 React 与 `@tanstack/react-query`）。
 * 下面每条都只依赖 `./sendError.ts` + `chatTypes` 的类型：`sendError.ts` 一旦添上运行时依赖
 * （`@/services/*` 走的是 vite 别名、`electron` 走的是原生模块，`node --test` 直跑 .ts 时都解析不了），
 * 这份用例就会在这里当场断掉——这条链的干净程度由闸门本身守着，不靠约定。
 */

/** 只填必要字段的最小回执，缺谁一眼看得出（`msgKey` 的"缺失"与"空串"是两档）。 */
const receipt = (over: Partial<SendReceipt> & Pick<SendReceipt, 'ok'>): SendReceipt => ({
  localId: 'local-1',
  ...over
})

// —— 1~5：错误码 → 文案

test('四条码各自归自己那句：下一步不同的失败不能糊成同一句', () => {
  // 先钉表（改文案要显式过这里），再钉"查表这条路确实把每个码送到那一句"。
  // 只测其中一条时，另外三条被并成同一句也照样绿——四种失败的下一步完全不同。
  assert.deepEqual(SEND_ERROR_TEXT, {
    BRIDGE_OFFLINE: '会话未在线，无法发送',
    CHAT_NOT_FOUND: '没找到这个会话，先在页面里把它打开一次',
    SEND_FAILED: '发送失败',
    TIMEOUT: '等回执超时，可以重试'
  })
  assert.equal(sendErrorText('BRIDGE_OFFLINE'), '会话未在线，无法发送')
  assert.equal(sendErrorText('CHAT_NOT_FOUND'), '没找到这个会话，先在页面里把它打开一次')
  assert.equal(sendErrorText('SEND_FAILED'), '发送失败')
  assert.equal(sendErrorText('TIMEOUT'), '等回执超时，可以重试')
})

test('sendErrorText(undefined)：没有码就是最泛的那一档，而不是 undefined', () => {
  assert.equal(sendErrorText(undefined), '发送失败')
})

test('表外字符串走兜底：`SendError` 只是类型，页内上来的码没人校验过形状', () => {
  const out = sendErrorText('NO_SUCH_CODE' as unknown as SendError)
  assert.equal(out, '发送失败')
  // 兜底必须是那句真话，不是把未知码拼给人看（"未知错误：NO_SUCH_CODE" 这种写法在这里会红）。
  assert.ok(!out.includes('NO_SUCH_CODE'))
})

test('`toString` 这类原型链上的键不能命中：兜底必须是字符串，不是函数', () => {
  // `hasOwnProperty` 换回 `in` 时，`SEND_ERROR_TEXT['toString']` 会命中原型链上的函数并原样返回，
  // 于是界面文案变成 `function toString() { [native code] }：…`。下面两条都是它的判别子。
  const viaToString = sendErrorText('toString' as unknown as SendError)
  assert.equal(typeof viaToString, 'string')
  assert.equal(viaToString, '发送失败')
  const viaConstructor = sendErrorText('constructor' as unknown as SendError)
  assert.equal(typeof viaConstructor, 'string')
  assert.equal(viaConstructor, '发送失败')
  // 也绝不能是"把整张表拼进文案"那种怪东西。
  assert.ok(!viaToString.includes('[object Object]'))
  assert.ok(!viaConstructor.includes('[object Object]'))
})

test('非字符串的码（null / 数字 / 对象）同样兜底，不抛也不返回 undefined', () => {
  for (const bad of [null, 123, {}] as unknown[]) {
    const out = sendErrorText(bad as SendError)
    assert.equal(typeof out, 'string', `${String(bad)}：返回值必须是字符串`)
    assert.equal(out, '发送失败', `${String(bad)}：认不出的一律走兜底`)
  }
})

// —— 6：成败判定

test('outcomeOf：唯一的 `ok:true` 出口要求 ok 为真且 msgKey 非空', () => {
  assert.deepEqual(outcomeOf(receipt({ ok: true, msgKey: 'ABC' })), { ok: true })
  assert.deepEqual(outcomeOf(receipt({ ok: true })), { ok: false, message: NO_MSG_KEY_TEXT })
  // 空串同样不算标识。这一条专门钉"用 `!msgKey` 而不是 `msgKey === undefined`"：
  // 写成后者时空串会落到 `if (receipt.ok) return { ok:true }`，草稿被清、气泡却是 ⚠。
  assert.deepEqual(outcomeOf(receipt({ ok: true, msgKey: '' })), {
    ok: false,
    message: NO_MSG_KEY_TEXT
  })
  assert.deepEqual(outcomeOf(receipt({ ok: false, error: 'TIMEOUT' })), {
    ok: false,
    message: '等回执超时，可以重试'
  })
  // 失败且没有码：归类兜底，不能是 `undefined`。
  assert.deepEqual(outcomeOf(receipt({ ok: false })), { ok: false, message: '发送失败' })
  // 那句"平台没有回消息标识"的原文也钉在这里：它同时是 `NO_MSG_KEY_TEXT` 的定义。
  assert.equal(NO_MSG_KEY_TEXT, '发送失败：平台没有回消息标识，这条是否真的发出去了无法确认')
})

test('outcomeOf 不把 `detail` 漏进用户可见文案：wa-js 原文只准去控制台', () => {
  const out = outcomeOf(receipt({ ok: false, error: 'SEND_FAILED', detail: 'STACK-SECRET' }))
  assert.deepEqual(out, { ok: false, message: '发送失败' })
  assert.ok(!JSON.stringify(out).includes('STACK-SECRET'))
})

// —— 7：IPC reject 的文案

test('ipcFailureText：Error 取 message，非 Error 取原文，都不加特例', () => {
  assert.equal(ipcFailureText(new Error('boom')), '发送失败：boom')
  assert.equal(ipcFailureText('boom'), '发送失败：boom')
  // `String(undefined)` 就是 'undefined'：那是那条路径上唯一能给的原文，故意不为它写特例。
  // 哪天有人改成"undefined 就说'未知错误'"，这条会红——那是另一件事，要显式过这里。
  assert.equal(ipcFailureText(undefined), '发送失败：undefined')
})

// —— 8：日志用的消毒文本

test('sendErrorLogText：detail 里的换行与控制字符压成一行，防止伪造日志行', () => {
  const detail = `line1\nline2\r\v${'z'.repeat(300)}`
  const s = sendErrorLogText(receipt({ ok: false, error: 'SEND_FAILED', detail }))
  // `\r\v` 是相邻的两个控制字符，一起收成**一个**空格（与主进程那份 `oneLine` 同形）；
  // 压完再截断到 200，所以尾巴是 188 个 z。顺序反了（先截后压）这条也是红的。
  assert.equal(s, `code=SEND_FAILED detail=line1 line2 ${'z'.repeat(188)}`)
  // eslint-disable-next-line no-control-regex
  assert.ok(!/[\x00-\x1f]/.test(s), `日志文本里不该还有控制字符：${JSON.stringify(s)}`)
})

test('sendErrorLogText：长度有界（wa-js 的原文能到几千字符）', () => {
  const s = sendErrorLogText(receipt({ ok: false, error: 'TIMEOUT', detail: 'y'.repeat(5000) }))
  const detailPart = s.slice('code=TIMEOUT detail='.length)
  assert.equal(detailPart.length, 200)
  assert.ok(!s.includes('y'.repeat(201)))
})

test('sendErrorLogText：code 缺失时报成兜底码，detail 缺失时留空而不是 undefined', () => {
  assert.equal(
    sendErrorLogText(receipt({ ok: false, detail: 'boom' })),
    'code=SEND_FAILED detail=boom'
  )
  const noDetail = sendErrorLogText(receipt({ ok: false, error: 'BRIDGE_OFFLINE' }))
  assert.equal(noDetail, 'code=BRIDGE_OFFLINE detail=')
  assert.ok(!noDetail.includes('detail=undefined'))
})
