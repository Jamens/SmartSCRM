// src/main/services/batchSend/sensitiveGate.ts
//
// A8 群发敏感词判定门：从真发路径里抽出来的**可单测**的一层。
//
// 为什么要单独成文件而不是把逻辑塞在 `host.ts` 的 `makeRealDispatch` 里：`host.ts` import 了
// `msgBridge`（进而 electron），node --test 拉不起来，于是"命中到底有没有真的拦住 sendText"
// 这条最要紧的接线永远只能靠人肉点一遍。这里对 `engine.ts` 只做 `import type`（编译期擦除），
// 运行时零依赖，单测能直接验证"命中 → 不发、记 SENSITIVE_WORD"。
import type { Dispatch } from './engine.ts'

/** 与 `batchApi.checkSensitive` 同形：返回命中词数组；`null` = 这一跳没成。 */
export type CheckFn = (text: string) => Promise<string[] | null>

/** 命中时写进明细 errorCode 的稳定标识（详情页/日志据此认出"风控拦的"而非"发送失败"）。 */
export const SENSITIVE_ERROR_CODE = 'SENSITIVE_WORD'

/**
 * 给真发派发包一层敏感词门：
 * - 命中（`[词…]`）→ **不调 send**，返回 `ok:false` + `SENSITIVE_WORD`，由引擎按 failed 记账；
 * - 未命中（`[]`）或判定这一跳没成（`null`）→ 照原样发（fail-open：风控是旁路，不因它抖动停整批）。
 * - 明细没有正文（纯媒体等）→ 跳过判定直接发。
 */
export const withSensitiveGate =
  (check: CheckFn, send: Dispatch): Dispatch =>
  async (d, viewId, localId) => {
    if (d.body) {
      const hits = await check(d.body)
      if (hits && hits.length > 0) {
        return { ok: false, error: SENSITIVE_ERROR_CODE, detail: `敏感词拦截：${hits.join('、')}` }
      }
    }
    return send(d, viewId, localId)
  }
