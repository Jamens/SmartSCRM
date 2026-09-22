// src/renderer/src/lib/sendError.ts
/**
 * 发送回执 → 「人看到的那句话」，以及这句话背后的成 / 败判定。
 *
 * 为什么它单独成一个文件、而不是留在 `liveTailSync.ts`：那边是"hook + 缓存搬运"，
 * 整个模块引 React 与 `@tanstack/react-query`，因而进不了 `tsconfig.unit.json` 的闸门
 * （那份 include 只收 node 下能直接跑的文件）。结果就是"回执 → 用户可见文案"这条映射
 * 一直只有读码级别的保证。可它其实是纯函数：四条码各归哪句、认不出的码怎么办、
 * `ok:true` 却没带 msgKey 怎么办——全都能在 node 下逐条断言。于是把纯的这半边搬出来测，
 * 缓存与 IPC 那半边留在原处。
 *
 * 因此本文件的 import 只能是 `@shared/chatTypes` 里的**类型**：不碰 React、不碰查询库、
 * 不碰 electron、不碰任何 `@/services/*`。多一条依赖，它就跑不进 unit 闸门了。
 */
import type { SendError, SendReceipt } from '@shared/chatTypes'

/** 四种失败的下一步完全不同，不能都糊成"发送失败"。 */
export const SEND_ERROR_TEXT: Record<SendError, string> = {
  BRIDGE_OFFLINE: '会话未在线，无法发送',
  CHAT_NOT_FOUND: '没找到这个会话，先在页面里把它打开一次',
  SEND_FAILED: '发送失败',
  TIMEOUT: '等回执超时，可以重试'
}

/**
 * 按一个**未知值**去那份表里取文案。
 *
 * `SendError` 是类型不是校验器：`msgBridge/index.ts` 把页内上来的 `send_result` 原样转进
 * `registry.settle(report)`，`error` 那个字段没人验过形状（`chatTypes.ts:87`）。查到并集外
 * 的字符串（或非字符串）时 `SEND_ERROR_TEXT[坏值]` 是 `undefined`，拼出来的提示就成
 * "undefined：…" 端给销售看。
 *
 * 用 `hasOwnProperty` 而不是 `in`：后者会顺原型链查到 `toString` / `constructor` 之类的函数，
 * 那就不是"取不到文案"而是"把函数拼进文案"了。
 *
 * `SEND_FAILED` 是这条映射的**兜底值**，不是"未知的第四种码"——认不出的一律走它，宁可文案粗一点。
 */
export function sendErrorText(error: SendError | undefined): string {
  const code = error ?? 'SEND_FAILED'
  return Object.prototype.hasOwnProperty.call(SEND_ERROR_TEXT, code)
    ? SEND_ERROR_TEXT[code]
    : SEND_ERROR_TEXT.SEND_FAILED
}

/** `ok:true` 却没带 msgKey 时的文案。界面上必须留在失败态，理由见 `outcomeOf`。 */
export const NO_MSG_KEY_TEXT = `${SEND_ERROR_TEXT.SEND_FAILED}：平台没有回消息标识，这条是否真的发出去了无法确认`

/**
 * 主进程 IPC 直接 reject 时的文案（`发送失败：<原始 message>`）。
 * 这一句**保留**原始 message，和失败回执那条不一样：那条有四种码可归类，而这条路径上
 * `SEND_FAILED` 四个字什么也没说，Electron 那句 `Error invoking remote method …` 是人能看到的
 * 唯一线索（更完整的上下文在主进程侧）。要收成归类码的话得连着主进程的日志一起动。
 */
export function ipcFailureText(e: unknown): string {
  return `${SEND_ERROR_TEXT.SEND_FAILED}：${e instanceof Error ? e.message : String(e)}`
}

/**
 * 发送结果 → 用户可见的成败。唯一的 `ok:true` 出口要求 msgKey 非空。
 *
 * 三段判定的顺序就是 `useSendText` 里原来的那三段，搬过来时一字未改：先堵"ok 但没有标识"，
 * 再放行 ok，剩下的都归到失败文案。
 *
 * 为什么"ok 却没 msgKey"必须报失败（`liveTailSync.ts` 的 `settleLocalId` 那一行的另一半）：
 * 那边已经把气泡翻成了 ⚠ + 重试，这里若报成功，调用方就把草稿清空了——界面上就是
 * "平台说收下了，却留一条失败气泡"这种自相矛盾，而点那次重试会把同一条正文再发一遍。
 * 今天的 WA 桥造不出这一组合（`bridge/whatsapp/send.ts` 的 `receiptFrom` 没有 msgKey 就直接回
 * 失败），但 Task 12d 的 Telegram 回执是另一段代码，不继承那个保证。
 */
export function outcomeOf(receipt: SendReceipt): { ok: true } | { ok: false; message: string } {
  if (receipt.ok && !receipt.msgKey) return { ok: false, message: NO_MSG_KEY_TEXT }
  if (receipt.ok) return { ok: true }
  // 只给人看那句归类后的文案，不带 `receipt.detail`：detail 是 wa-js 抛出的原文
  //（`bridge/whatsapp/send.ts` 的 `err.message`），销售读不懂也不该读，要看去控制台——
  // 那一行由 `sendErrorLogText` 负责。
  return { ok: false, message: sendErrorText(receipt.error) }
}

/**
 * 页内来的文本进日志前先压成一行、截断。
 * 与主进程 `src/main/services/msgBridge/index.ts` 的 `oneLine` 同形（那份是私有的，
 * 且跨了进程边界没法共用），"页内来的文本进日志前先压一行"这条规则两边同形、改动要两边一起。
 */
function oneLine(text: string | undefined, max = 200): string {
  // \v \f 之类也算换行（Chrome 的 console 会把它们断行），所以按 C0 控制字符整体收。
  // eslint-disable-next-line no-control-regex
  return (text ?? '').replace(/[\x00-\x1f]+/g, ' ').slice(0, max)
}

/**
 * 一行日志用的消毒后文本：`code=` + `detail=`，两段都过 `oneLine`（压成一行 + 截断）。
 * `detail` 可能是几千字符的 wa-js 原文，留着换行等于允许伪造日志行。
 * 只给渲染层控制台用（C2/C3：不进 preload、不进注入页），也不参与任何用户可见文案。
 * `error` 缺失时报成 `SEND_FAILED` 而不是字面的 `code=undefined`——那是这条回执真正所属的
 * 那一档，与 `sendErrorText` 同一条兜底规矩。
 *
 * `code` 也过消毒，**不是**因为它现在有怪值：今天送得上来的确实只有合法字面量
 * （`bridge/whatsapp/send.ts` 的 `classify()` 与 `sendRegistry.ts` 里那几处）。要消毒的理由是
 * "上游只送合法码"这个前提**不在本文件里**，而类型挡不住它——`SendError` 是类型不是校验器，
 * `chatTypes.ts:87` 那个 `error` 字段从页内到这一步没人验过形状（同 `sendErrorText` 那段）。
 * 少消毒这半边就是在这行日志上留一个闸外缺口：非并集值的码能把换行和超长原样带出去，
 * 而 `detail` 那半边却被压平了。更要紧的是这里不能顺手折成 `SEND_FAILED`：给人看的那句走归类
 * 兜底是对的，可这行日志是"上游送过一个怪码"这件事**唯一**的落点，替掉就等于抹平事实。
 */
export function sendErrorLogText(receipt: SendReceipt): string {
  const code = oneLine(String(receipt.error ?? 'SEND_FAILED'))
  return `code=${code} detail=${oneLine(receipt.detail)}`
}
