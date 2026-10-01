// src/main/services/groupCollect/dispatch.ts
//
// 群成员建档泵的"通电"层之二：依赖主进程运行时（msgBridge / state）的接线。
//
// - createGroupDispatch：把命令推给账号对应的视图，按 reqId 等桥回执。
// - runGroupBuild：宿主入口，每个账号一个 engine 实例。
//
// 本文件刻意不在 node --test 的单元测试里加载——它 transitively 引入的 msgBridge /
// state/session 在主进程侧有缺扩展名的导入，node --test 解析不了。这部分的正确性靠
// engine.ts（假 dispatch 单测已覆盖编排）与运行期集成验证，不在单测范围。

import { SNAPSHOT_TIMEOUT_MS } from '../../../shared/groupMembers.ts'
import { getSession } from '../../state/session.ts'
import { accountOfId } from '../msgBridge/accountDirectory.ts'
import { bridgeOf, pushToBridge } from '../msgBridge/index.ts'
import { addPending, dropPending, timeoutReply } from './registry.ts'
import {
  GroupCollectEngine,
  type BuildResult,
  type GroupCommand,
  type GroupDispatch,
  type GroupReply
} from './engine.ts'
import { createGroupCollectApi } from './api.ts'

/**
 * 给一个账号造 dispatch。闭包吃 accountId，所以泵实例天然 per-account。
 * 失败时 reject（视图不存在 / 会话未在线）——engine 的 ask() 会把 reject 当"这次拿不到"处理并走重试。
 */
export function createGroupDispatch(accountId: number, opts?: { timeoutMs?: number }): GroupDispatch {
  const fallback = opts?.timeoutMs ?? SNAPSHOT_TIMEOUT_MS
  return (cmd: GroupCommand, timeoutMs: number) => {
    const viewId = accountOfId(accountId)?.viewId
    if (!viewId) return Promise.reject(new Error('账号没有绑定视图'))
    const mount = bridgeOf(viewId)
    if (!mount || !mount.ready) return Promise.reject(new Error('会话未在线'))

    const timeout = timeoutMs || fallback
    const pending = new Promise<GroupReply>((resolve) => {
      const timer = setTimeout(() => {
        dropPending(cmd.reqId)
        resolve(timeoutReply(cmd))
      }, timeout)
      addPending(cmd.reqId, resolve, timer)
    })
    // 命令发出去之后再等回执：push 失败（mount 中途失效）时 engine 的 ask() 会捕获 reject 并重试。
    pushToBridge(viewId, cmd)
    return pending
  }
}

/**
 * 跑一个账号的一轮建档。每个账号一个 engine 实例（dispatch 闭包已绑定 accountId），
 * 故引擎内的全局 running 锁等价于"每账号串行"（spec §5）。
 *
 * chatKeys 不传 = 全量建档（从没建过档的优先，超 MAX 截断、剩下的 deferred 留给下一轮）；
 * 传入 = 只建这几个（弹层「刷新成员」）。
 *
 * snapshotAtOf 暂返回 null：排序优化当前不生效（所有群都当"从没建过档"，保输入顺序）。
 * 要真正按"上次成功快照时间"优先，需后端给一个按群查 last_snapshot_at 的端点——待补（spec §5 只要求排序，不要求精确值）。
 */
export function runGroupBuild(accountId: number, chatKeys?: string[]): Promise<BuildResult> {
  const api = createGroupCollectApi({ token: () => getSession()?.accessToken ?? null })
  const dispatch = createGroupDispatch(accountId)
  const engine = new GroupCollectEngine({
    api,
    dispatch,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    log: (where, e) => console.log(`[groupCollect] ${where} ${String(e)}`),
    snapshotAtOf: () => null
  })
  return engine.runBuildForAccount(accountId, chatKeys)
}
