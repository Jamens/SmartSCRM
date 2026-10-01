// src/main/services/groupCollect/host.ts
//
// 建档泵的宿主入口（与 batchSend/host.ts 同路子）。负责两件事：
//   1. per-account 在途去重——engine 实例是每次 request 现建的，running 锁不跨调用，
//      所以必须在这里挡住同一账号的并发二轮（spec §5 "每账号串行"）。
//   2. 后台跑：不在 IPC invoke 里 await 整轮（可能跑几分钟），立即返回 accepted/busy，
//      建档在后台进行，完成/异常只记日志；进度广播留给 Task 5 的渲染层接入。

import { runGroupBuild } from './dispatch.ts'
import type { BuildResult } from './engine.ts'

const building = new Set<number>()

export interface GroupBuildRequest {
  accountId: number
  /** 传了就只建这几个（弹层「刷新成员」）；不传 = 全量建档。 */
  chatKeys?: string[]
}

export type GroupBuildResponse =
  | { accepted: true }
  | { accepted: false; reason: 'already_building' }

/**
 * 入口。一个账号同时只跑一轮。返回 accepted=false 表示被拒（上一轮还没跑完），
 * 渲染层据此保持按钮禁用。真正耗时的 runGroupBuild 不在此 await，后台跑完即清在途标记。
 */
export function requestGroupBuild(req: GroupBuildRequest): GroupBuildResponse {
  const { accountId, chatKeys } = req
  if (building.has(accountId)) return { accepted: false, reason: 'already_building' }
  building.add(accountId)
  void runGroupBuild(accountId, chatKeys)
    .then((r: BuildResult) => {
      const tail = r.abandoned ? ` abandoned=${r.abandoned}` : ''
      console.log(
        `[groupCollect] 建档完成 account=${accountId} built=${r.built} failed=${r.failed} deferred=${r.deferred}${tail}`
      )
    })
    .catch((e: unknown) => {
      console.log(`[groupCollect] 建档异常 account=${accountId} ${String(e)}`)
    })
    .finally(() => {
      building.delete(accountId)
    })
  return { accepted: true }
}

/** 测试/运维用：当前有哪些账号在途。 */
export function buildingAccounts(): number[] {
  return [...building]
}
