// src/bridge/whatsapp/collect.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runBackfill } from './collect.ts'
import type { BridgeReport } from '../../shared/chatTypes.ts'
import type { CollectCtx, WaChatModel, WaMsgModel, WppLike } from '../types.ts'

/**
 * 夹具按 wa-js 的真实形状做：字段挂在原型上是 getter，实例只有 `__x_*` 那些内部字段。
 * 用对象字面量做夹具时 `{ ...raw }` 之类的写法能蒙过去，真页面却一条都取不到。
 */
class MsgLike {
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

function msg(fromMe: boolean, id: string): WaMsgModel {
  const peer = { server: 'c.us', user: '861380001001', _serialized: '861380001001@c.us' }
  const self = { server: 'c.us', user: '8610000000000', _serialized: '8610000000000@c.us' }
  return new MsgLike({
    id: { fromMe, remote: peer._serialized, id, _serialized: `${fromMe ? 'true' : 'false'}_${peer._serialized}_${id}` },
    from: fromMe ? self : peer,
    to: fromMe ? peer : self,
    body: '在吗',
    type: 'chat',
    t: 1_700_000_000,
    ack: 2
  }) as unknown as WaMsgModel
}

/** 在 node 里造一个 window.WPP：桥脚本本来跑在页内，只有伪造才能把 runBackfill  driving 起来。 */
function withWpp(wpp: Partial<WppLike> | null, fn: () => Promise<void>): Promise<void> {
  const g = globalThis as unknown as { window?: { WPP?: unknown } }
  if (wpp) g.window = { WPP: wpp }
  else delete g.window
  return fn().finally(() => {
    delete g.window
  })
}

test('补底把会话标题随批次带上：WA 的自聊 name 是空的，标题在 formattedTitle 上', async () => {
  const chats = [{ id: { _serialized: '861380001001@c.us' }, formattedTitle: '@Jamensd' }] as unknown as WaChatModel[]
  const getMessages = async (): Promise<WaMsgModel[]> => [msg(true, 'AAA'), msg(false, 'BBB')]
  await withWpp({ chat: { list: async () => chats, getMessages } } as unknown as WppLike, async () => {
    const frames: BridgeReport[] = []
    const ctx: CollectCtx = { emit: (r) => frames.push(r) }
    await runBackfill(10, ctx)
    const messages = frames.filter((f) => f.kind === 'message')
    // 补底是"先整页取够 limit 再切片"，所以帧数按 limit 收口而不去重——去重交给 uk_msg。
    const distinct = new Set(messages.map((m) => (m.kind === 'message' ? m.message.msgKey : '')))
    assert.equal(distinct.size, 2)
    assert.ok(messages.length >= 2)
    // 每一帧都必须带标题：后端 titleOf 只在批次里找，全不带就是列表页一片空标题
    for (const m of messages) {
      assert.ok(m.kind === 'message')
      assert.equal(m.message.chatTitle, '@Jamensd')
    }
  })
})

test('补底按 limit 收口：够数就停，不把整个会话拉穿', async () => {
  let calls = 0
  const getMessages = async (_ck: string, opts: { limit: number }): Promise<WaMsgModel[]> => {
    calls += 1
    // 真实页面里翻页会重叠返回，这里同样每页都给满
    return Array.from({ length: opts.limit }, (_, i) => msg(true, `P${calls}_${i}`))
  }
  await withWpp(
    {
      chat: {
        list: async () => [{ id: { _serialized: '861380001001@c.us' }, name: 'Alice' }] as unknown as WaChatModel[],
        getMessages
      }
    } as unknown as WppLike,
    async () => {
      const frames: BridgeReport[] = []
      await runBackfill(5, { emit: (r) => frames.push(r) })
      const emitted = frames.filter((f) => f.kind === 'message')
      assert.equal(emitted.length, 5, 'emit 出去的行数就是 limit，不是"全量拉回来了"')
      assert.equal(calls, 1, '一页就够数时不该再翻第二页')
    }
  )
})

test('WPP 不在时报 backfill_gap，而不是静默跑完假装采过了', async () => {
  await withWpp(null, async () => {
    const frames: BridgeReport[] = []
    await runBackfill(10, { emit: (r) => frames.push(r) })
    const gap = frames.find((f) => f.kind === 'backfill_gap')
    assert.ok(gap && gap.kind === 'backfill_gap')
    assert.equal(gap.chatKey, '*')
    assert.equal(frames.filter((f) => f.kind === 'message').length, 0)
  })
})
