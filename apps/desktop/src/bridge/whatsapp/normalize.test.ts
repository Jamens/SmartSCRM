// src/bridge/whatsapp/normalize.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mediaSummaryOf, mediaTypeOf, normalizeWa, waChatKeyOf } from './normalize.ts'
import type { WaMsgModel } from '../types.ts'

const ctx = { source: 'live' as const }

test('收进的单聊：chatKey 取 from，方向 in，状态 received（ack 不参与）', () => {
  const row = normalizeWa(
    { id: { _serialized: 'false_861380001001@c.us_HXD123' }, from: '861380001001@c.us', to: '8610000000000@c.us', body: 'hola', t: 1_700_000_000, isFromMe: false, ack: 3 },
    ctx
  )
  assert.equal(row?.chatKey, '861380001001@c.us')
  assert.equal(row?.direction, 'in')
  assert.equal(row?.status, 'received')
  assert.equal(row?.body, 'hola')
  assert.equal(row?.mediaType, 'text')
  assert.equal(row?.senderKey, undefined)
})

test('发出的单聊：chatKey 取 to（对端），不是自己；页内一律如实报 live，归属留给主进程', () => {
  const raw: WaMsgModel = {
    id: { _serialized: 'true_861380001001@c.us_Z@1', clientUrl: 'CU-9' },
    from: '8610000000000@c.us', to: '861380001001@c.us', body: 'hi', t: 1_700_000_010,
    isFromMe: true, ack: 2
  }
  const row = normalizeWa(raw, ctx)
  assert.equal(row?.chatKey, '861380001001@c.us')
  assert.equal(row?.direction, 'out')
  assert.equal(row?.source, 'live')
  assert.equal(row?.status, 'delivered')
  assert.equal(row?.sendLocalId, undefined)
  // 补底上下文里的同一条：只换 source，不碰归属
  assert.equal(normalizeWa(raw, { source: 'backfill' })?.source, 'backfill')
})

test('群聊：chatKey 是群，senderKey/senderName 来自 author，只有单聊才把 author 丢进 senderKey 是不对的', () => {
  const row = normalizeWa(
    { id: { _serialized: 'false_12036@g.us_ABC' }, from: '120361234@g.us', author: '861380002002@c.us', notifyName: undefined, body: '在吗', t: 1_700_000_020, isFromMe: false },
    ctx
  )
  assert.equal(row?.chatKey, '120361234@g.us')
  assert.equal(row?.senderKey, '861380002002@c.us')
  assert.equal(row?.direction, 'in')
})

test('媒体：body 落 null，mediaType 与摘要成对；未知类型不冒充 text', () => {
  const img = normalizeWa({ id: { _serialized: 'x' }, from: '123@c.us', type: 'image', t: 1, isFromMe: false }, ctx)
  assert.equal(img?.body, null)
  assert.equal(img?.mediaType, 'image')
  assert.equal(img?.mediaSummary, '[图片]')
  const doc = normalizeWa({ id: { _serialized: 'y' }, from: '123@c.us', type: 'document', filename: '报价.pdf', t: 1 }, ctx)
  assert.equal(doc?.mediaSummary, '[文件] 报价.pdf')
  assert.equal(mediaTypeOf('multi_attachment'), 'unknown')
  assert.equal(mediaTypeOf(undefined), 'text')
  assert.equal(mediaSummaryOf('text'), null)
  assert.equal(mediaTypeOf('sticker'), 'sticker')
})

test('没有 id._serialized 的行不入库：它无法参与 uk_msg 幂等，收下就是脏数据', () => {
  assert.equal(normalizeWa({ body: 'hi', t: 1, from: '1@c.us' }, ctx), null)
  assert.equal(normalizeWa({ id: {} }, ctx), null)
})

test('chatKey 取不到时返回 null，而不是把 undefined 写进 NOT NULL 列', () => {
  assert.equal(waChatKeyOf({ id: { _serialized: 'a' }, isFromMe: true }), null)
  assert.equal(normalizeWa({ id: { _serialized: 'a' }, isFromMe: true }, ctx), null)
})

/**
 * wa-js 4.6.0 的 `Msg` 不是字面量：`id/from/to/body/t/type/ack` 全在原型上是 getter，
 * 实例自己只有 `__x_*` 那批内部字段（2026-09-22 真实登录态实测：原型 572 个属性、
 * `hasOwnProperty(m,'to') === false`）。用对象字面量当夹具时字段全是自有属性，
 * 任何"先 {...raw 复制一份再读"的写法都能蒙过测试，到了真页面却一条都归一化不出来。
 */
class WaMsgModelLike {
  d: Record<string, unknown>
  constructor(d: Record<string, unknown>) {
    this.d = d
  }
  get id(): WaMsgModel['id'] {
    return this.d['id'] as WaMsgModel['id']
  }
  get from(): WaMsgModel['from'] {
    return this.d['from'] as WaMsgModel['from']
  }
  get to(): WaMsgModel['to'] {
    return this.d['to'] as WaMsgModel['to']
  }
  get author(): WaMsgModel['author'] {
    return this.d['author'] as WaMsgModel['author']
  }
  get body(): string | undefined {
    return this.d['body'] as string | undefined
  }
  get type(): string | undefined {
    return this.d['type'] as string | undefined
  }
  get t(): number | undefined {
    return this.d['t'] as number | undefined
  }
  get ack(): number | undefined {
    return this.d['ack'] as number | undefined
  }
}

test('补底行的真实形状（字段在原型上）：不能靠展开复制取字段，否则每条都判死', () => {
  const model = new WaMsgModelLike({
    id: { fromMe: true, remote: '261963795943523@lid', id: 'ACBEDD', _serialized: 'true_261963795943523@lid_ACBEDD_out' },
    from: { server: 'c.us', user: '8613226651570', _serialized: '8613226651570@c.us' },
    to: { server: 'lid', user: '261963795943523', _serialized: '261963795943523@lid' },
    body: 'hello',
    type: 'chat',
    t: 1_789_775_757,
    ack: 3
  }) as unknown as WaMsgModel
  // 夹具自己先立此存照：这些字段确实不是自有属性
  assert.equal(Object.prototype.hasOwnProperty.call(model, 'to'), false)
  assert.equal((model as unknown as { isFromMe?: boolean }).isFromMe, undefined)

  const row = normalizeWa(model, { source: 'backfill' })
  assert.equal(row?.chatKey, '261963795943523@lid')
  assert.equal(row?.msgKey, 'true_261963795943523@lid_ACBEDD_out')
  // 顶层 isFromMe 缺失时方向要落回 id.fromMe，不能默认成 in
  assert.equal(row?.direction, 'out')
  assert.equal(row?.status, 'read')
  assert.equal(row?.body, 'hello')
  assert.equal(row?.msgTimeEpochSec, 1_789_775_757)
})
