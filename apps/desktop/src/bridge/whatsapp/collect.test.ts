// src/bridge/whatsapp/collect.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runBackfill, startLiveCollect } from './collect.ts'
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

/** 会话侧同样按真实形状做：`chat.list()` 回来的也是模型实例，字段在原型上。 */
class ChatLike {
  d: Record<string, unknown>
  constructor(d: Record<string, unknown>) {
    this.d = d
  }
  get id(): WaChatModel['id'] {
    return this.d['id'] as WaChatModel['id']
  }
  get name(): string | undefined {
    return this.d['name'] as string | undefined
  }
  get formattedTitle(): string | undefined {
    return this.d['formattedTitle'] as string | undefined
  }
  get archived(): boolean | undefined {
    return this.d['archived'] as boolean | undefined
  }
}

function chat(d: Record<string, unknown>): WaChatModel {
  return new ChatLike(d) as unknown as WaChatModel
}

test('补底把会话标题随批次带上：WA 的自聊 name 是空的，标题在 formattedTitle 上', async () => {
  const chats = [chat({ id: { _serialized: '861380001001@c.us' }, formattedTitle: '@Jamensd' })]
  const getMessages = async (): Promise<WaMsgModel[]> => [msg(true, 'AAA'), msg(false, 'BBB')]
  await withWpp({ chat: { list: async () => chats, getMessages } } as unknown as WppLike, async () => {
    const frames: BridgeReport[] = []
    const ctx: CollectCtx = { emit: (r) => frames.push(r) }
    await runBackfill(10, ctx)
    const messages = frames.filter((f) => f.kind === 'message')
    // 不满一页就是历史到底：只有"还在按 limit 硬翻页"时会拿到 10 帧（2 行 × 5 页）。
    assert.equal(messages.length, 2)
    assert.equal(new Set(messages.map((m) => (m.kind === 'message' ? m.message.msgKey : ''))).size, 2)
    // 每一帧都必须带标题：后端 titleOf 只在批次里找，全不带就是列表页一片空标题
    for (const m of messages) {
      assert.ok(m.kind === 'message')
      assert.equal(m.message.chatTitle, '@Jamensd')
    }
  })
})

test('整页都没有 id._serialized 时报 gap，不许让它长得像"这个会话没历史"', async () => {
  const noId = (): WaMsgModel =>
    new MsgLike({
      id: {},
      from: { _serialized: '861380001001@c.us' },
      to: { _serialized: '8610000000000@c.us' },
      body: 'x',
      type: 'chat',
      t: 1_700_000_000,
      ack: 2
    }) as unknown as WaMsgModel
  let calls = 0
  const getMessages = async (): Promise<WaMsgModel[]> => {
    calls += 1
    return [noId(), noId()]
  }
  await withWpp(
    { chat: { list: async () => [chat({ id: { _serialized: '861380001001@c.us' }, name: 'Alice' })], getMessages } } as unknown as WppLike,
    async () => {
      const frames: BridgeReport[] = []
      await runBackfill(10, { emit: (r) => frames.push(r) })
      const gaps = frames.filter((f) => f.kind === 'backfill_gap')
      assert.equal(gaps.length, 1, '取不到 id 要单独报一帧：否则日志里只剩 msgs=0，与"翻到底了"分不出来')
      assert.equal((gaps[0] as { chatKey: string }).chatKey, '861380001001@c.us')
      assert.equal(calls, 1, '报完 gap 就收手，不必再翻下一页')
      assert.equal(frames.filter((f) => f.kind === 'message').length, 0)
    }
  )
})

test('整页都是重叠旧行时不再往前翻：limit 够不满也要停，不然这个循环永不结束', async () => {
  let calls = 0
  const limits: number[] = []
  const page = (): WaMsgModel[] => Array.from({ length: 50 }, (_, i) => msg(true, `S${i}`))
  const getMessages = async (_ck: string, opts: { limit: number }): Promise<WaMsgModel[]> => {
    calls += 1
    // 每页都给满 PAGE_SIZE（所以"不满一页"不会先兜住），且翻到哪都是同一批 50 条。
    // 记下来而不是在这里断言：断言抛进 getMessages 会被 runBackfill 折成一帧 gap，看不出真因。
    limits.push(opts.limit)
    return page()
  }
  await withWpp(
    { chat: { list: async () => [chat({ id: { _serialized: '861380001001@c.us' }, name: 'Alice' })], getMessages } } as unknown as WppLike,
    async () => {
      const frames: BridgeReport[] = []
      // limit 取真实那一档（200）：80 时改前的老循环也只翻两页，calls 那条断言就白写了。
      await runBackfill(200, { emit: (r) => frames.push(r) })
      const emitted = frames.filter((f) => f.kind === 'message')
      assert.deepEqual(limits, [50, 50], '每页都按 PAGE_SIZE 要')
      assert.equal(calls, 2, '第二页一条新行都没有就该收手，不是继续翻到 limit')
      assert.equal(emitted.length, 50, '老循环会把重叠页照单全收，emit 出 200 帧')
      assert.equal(new Set(emitted.map((m) => (m.kind === 'message' ? m.message.msgKey : ''))).size, 50)
    }
  )
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
        list: async () => [chat({ id: { _serialized: '861380001001@c.us' }, name: 'Alice' })],
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

/**
 * 页内事件流的夹具：wa-js 那两处 emit 给的载荷本身就是普通对象字面量
 * （`emit('chat.msg_ack_change', { ack, chat, ids })`），只有里面的 MsgKey / Chat 模型字段在原型上。
 */
function withEvents(): { wpp: WppLike; fire(event: string, payload: unknown): void } {
  const handlers = new Map<string, (p: unknown) => void>()
  const wpp = {
    on: (event: string, cb: (p: unknown) => void) => {
      handlers.set(event, cb)
      return { off: () => handlers.delete(event) }
    }
  } as unknown as WppLike
  return { wpp, fire: (event, payload) => handlers.get(event)?.(payload) }
}

test('一次 ack 事件一帧：整群读回执的 ids[] 不许拆成几十条上报', async () => {
  const { wpp, fire } = withEvents()
  await withWpp(wpp, async () => {
    const frames: BridgeReport[] = []
    startLiveCollect({ emit: (r) => frames.push(r) })
    fire('chat.msg_ack_change', {
      ack: 3,
      chat: { _serialized: '1203630@g.us' },
      ids: [{ _serialized: 'K1' }, { _serialized: 'K2' }, { _serialized: 'K3' }]
    })
    const acks = frames.filter((f) => f.kind === 'ack')
    assert.equal(acks.length, 1, '拆成一 id 一帧就是几十个并发请求，每个在落库侧都是一个带行锁的事务')
    const only = acks[0]
    assert.ok(only && only.kind === 'ack')
    assert.deepEqual(only.msgKeys, ['K1', 'K2', 'K3'])
    assert.equal(only.chatKey, '1203630@g.us')
    assert.equal(only.status, 'read')
  })
})

test('同一批里倒退的那几条被剔掉，剩下的仍并在一帧里', async () => {
  const { wpp, fire } = withEvents()
  await withWpp(wpp, async () => {
    const frames: BridgeReport[] = []
    startLiveCollect({ emit: (r) => frames.push(r) })
    const acks = (): Extract<BridgeReport, { kind: 'ack' }>[] => frames.filter((f) => f.kind === 'ack') as Extract<BridgeReport, { kind: 'ack' }>[]
    fire('chat.msg_ack_change', { ack: 3, chat: { _serialized: 'c@g.us' }, ids: [{ _serialized: 'K1' }, { _serialized: 'K2' }] })
    // 迟到的 delivered：K1/K2 已经是 read，只有没见过的 K3 该跟着这一帧出去。
    fire('chat.msg_ack_change', { ack: 2, chat: { _serialized: 'c@g.us' }, ids: [{ _serialized: 'K1' }, { _serialized: 'K2' }, { _serialized: 'K3' }] })
    assert.equal(acks().length, 2, '倒退那一次也不是白发一帧空批')
    assert.deepEqual(acks()[1].msgKeys, ['K3'])
    assert.equal(acks()[1].status, 'delivered')
  })
})
