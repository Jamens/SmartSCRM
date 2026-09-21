// src/bridge/whatsapp/normalize.ts
import type { MediaType, MsgSource, NormalizedMessage } from '../../shared/chatTypes.ts'
import { fromAck } from '../../shared/chatStatus.ts'
import type { WaMsgModel, WaWid } from '../types.ts'

export interface NormalizeCtx {
  /**
   * 页内只可能是 'live'（事件流）或 'backfill'（补底）。
   * `app_send` / `native_send` 不在这里判定：wa-js 4.6.0 的发送选项没有 messageID，
   * 页内拿不到"这条 = 那个 localId"，而主进程两边都知道（Step 2 的表）。
   */
  source: MsgSource
}

const MEDIA_BY_TYPE: Record<string, MediaType> = {
  chat: 'text',
  notification: 'text',
  vcard: 'contact',
  image: 'image',
  img: 'image',
  audio: 'audio',
  ptv: 'audio',
  voice: 'audio',
  video: 'video',
  vcards: 'contact',
  document: 'document',
  docs: 'document',
  sticker: 'sticker',
  location: 'location',
  live_location: 'location'
}

export function mediaTypeOf(rawType: string | undefined): MediaType {
  if (!rawType) return 'text'
  return MEDIA_BY_TYPE[rawType] ?? 'unknown'
}

/** 摘要是记录页与搜索命中的唯一可见文本（媒体本体不进 P6，spec §1）。 */
export function mediaSummaryOf(type: MediaType, raw?: WaMsgModel): string | null {
  switch (type) {
    case 'text':
      return null
    case 'image':
      return raw?.caption ? `[图片] ${raw.caption}` : '[图片]'
    case 'audio':
      return '[语音]'
    case 'video':
      return raw?.caption ? `[视频] ${raw.caption}` : '[视频]'
    case 'document':
      return raw?.filename ? `[文件] ${raw.filename}` : '[文件]'
    case 'sticker':
      return '[贴纸]'
    case 'contact':
      return raw?.contact?.name ? `[名片] ${raw.contact.name}` : '[名片]'
    case 'location':
      return raw?.locName ? `[位置] ${raw.locName}` : '[位置]'
    case 'unknown':
      return `[${raw?.type ?? '未知'}]`
  }
}

/** in 看 from，out 看 to：发出消息的 `to` 才是对端/群，`from` 是自己。 */
export function waChatKeyOf(raw: WaMsgModel): string | null {
  return peerKeyOf(raw, isFromMeOf(raw))
}

/**
 * 方向已经算出来了就直接传进来：不要再 `{ ...raw }` 复制一份。
 * wa-js 4.6.0 的 `Msg` 把 `id/from/to/body/t/type/ack` 全挂在原型上做成 getter，
 * 展开只复制自有属性，复制体上这些字段一律 undefined——真实登录态下每条补底行都会
 * 在这里被判死（2026-09-22 实测 nulls=200/200）。原始对象取值才有原型链。
 */
function peerKeyOf(raw: WaMsgModel, fromMe: boolean): string | null {
  return widKeyOf(fromMe ? raw.to : raw.from) ?? widKeyOf(raw.chatId?._serialized) ?? null
}

/**
 * 对端字段的真实形态有两套：事件流里可能是裸字符串，`chat.getMessages` 实测（wa-js 4.6.0，
 * 2026-09-21 真实登录态）给的是 Wid 对象 `{ user, server, _serialized }`。
 * 只吃字符串会把每一条真实补底行都判死——归一化两处都收。
 */
function widKeyOf(value: string | WaWid | undefined): string | null {
  if (typeof value === 'string') return value.length > 0 ? value : null
  const serialized = value?._serialized
  return typeof serialized === 'string' && serialized.length > 0 ? serialized : null
}

/** 顶层 `isFromMe` 只有事件流给；`getMessages` 的行要把方向落回 `id.fromMe`。 */
function isFromMeOf(raw: WaMsgModel): boolean {
  return raw.isFromMe ?? raw.id?.fromMe ?? false
}

export function normalizeWa(raw: WaMsgModel, ctx: NormalizeCtx): NormalizedMessage | null {
  const msgKey = raw.id?._serialized
  if (!msgKey) return null
  const fromMe = isFromMeOf(raw)
  const chatKey = peerKeyOf(raw, fromMe)
  if (!chatKey) return null

  const direction = fromMe ? 'out' : 'in'
  const type = mediaTypeOf(raw.type)
  const text = type === 'text' ? (raw.body ?? '') : null
  const mediaSummary = type === 'text' ? null : mediaSummaryOf(type, raw)
  const senderKey = chatKey.endsWith('@g.us') ? widKeyOf(raw.author) ?? undefined : undefined

  return {
    chatKey,
    msgKey,
    direction,
    // 群里的 author 才是"谁说的"；单聊不填 senderKey，让会话标题去承担"是谁"。
    ...(senderKey !== undefined ? { senderKey } : {}),
    ...(raw.notifyName ? { senderName: raw.notifyName } : {}),
    body: text,
    mediaType: type,
    ...(mediaSummary ? { mediaSummary } : {}),
    msgTimeEpochSec: typeof raw.t === 'number' ? raw.t : 0,
    status: direction === 'out' ? fromAck(raw.ack, 'out') : 'received',
    source: ctx.source
  }
}
