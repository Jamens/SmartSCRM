// src/main/services/groupCollect/host.ts
//
// 建档泵的宿主入口（与 batchSend/host.ts 同路子）。负责三件事：
//   1. per-account 在途去重——`runGroupBuild` 每次现建一个 engine，引擎内的 running 锁不跨调用，
//      所以必须在这里挡住同一账号的并发二轮（spec §5 "每账号串行"）。
//   2. **等整轮跑完再给结论**：`group:build` 的 promise 在整轮跑完才回（可能几分钟），
//      渲染层 `useGroupBuild().pending` 靠的就是这一条——改成"立即返 accepted"会让按钮态永远不对。
//   3. 广播 `group:state` 的 running / settled：渲染层据此失效缓存。
//
// 本文件不在 node --test 的单元测试里加载——它经 dispatch.ts transitively 引入 msgBridge /
// state，而主进程侧那几个文件有缺扩展名的导入，node --test 解析不了。编排的正确性由
// engine.ts 的假 dispatch 单测覆盖。

import { getMainWindow } from '../../window/mainWindow.ts'
import { oneLine, type GroupBuildOutcome, type GroupStateEvent } from '../../../shared/groupMembers.ts'
import { runGroupBuild } from './dispatch.ts'

const building = new Set<number>()

function broadcast(event: GroupStateEvent): void {
  // 与 `broadcastState`/`broadcastTheme` 同一条口径：`getMainWindow()` 可能给回一枚已销毁的窗口。
  const win = getMainWindow()
  if (win && !win.isDestroyed()) win.webContents.send('group:state', event)
}

/** 一轮都没跑时的空结论。`list:'ok'` 是"没有失败可报"，不是"名单拿到了"。 */
function emptyOutcome(accountId: number): GroupBuildOutcome {
  return {
    accountId,
    skipped: null,
    list: 'ok',
    registered: 0,
    attempted: 0,
    snapshotted: 0,
    postedFailed: 0,
    failed: 0,
    skippedFinal: 0,
    truncated: false,
    aborted: false
  }
}

/** 泵抛出来时的合成结论：界面必须拿到一个 settled，不能让按钮永远灰在 running。 */
function crashOutcome(accountId: number): GroupBuildOutcome {
  return { ...emptyOutcome(accountId), list: 'error' }
}

/**
 * 跑一个账号的一轮建档并返回结论。
 *
 * `chatKey` 省略 = 整账号一轮；带上 = 只补这一群（弹层「刷新成员」，R49 单数码）。
 * 返回 `null` 只表示入参不合格——业务失败都结在 outcome 的字段里，不抛。
 */
export async function runBuild(accountId: number, chatKey?: string): Promise<GroupBuildOutcome | null> {
  if (!Number.isInteger(accountId) || accountId <= 0) {
    console.log(`[group] 建档入参不合格 account=${oneLine(String(accountId))}`)
    return null
  }
  if (building.has(accountId)) {
    // 同一账号已有在途一轮。给回 busy 而不是排队等它：排队会让「刷新成员」的按钮
    // 在一轮全量建档期间灰上好几分钟，而用户以为自己只是补一个群。
    return { ...emptyOutcome(accountId), skipped: 'busy' }
  }
  building.add(accountId)
  broadcast({ accountId, phase: 'running', outcome: null })
  let outcome: GroupBuildOutcome
  try {
    outcome = await runGroupBuild(accountId, chatKey)
  } catch (e) {
    // 泵把可预期失败都结进了 outcome，逃到这里的只剩实现缺陷（帧形状变了 / 空引用）。
    // 日志点名是 catch 段，界面那句「这一轮没跑成」不许写成「这个账号没有群」。
    console.warn(`[group] 建档抛出（非业务失败）account=${accountId}`, e)
    outcome = crashOutcome(accountId)
  } finally {
    building.delete(accountId)
  }
  broadcast({ accountId, phase: 'settled', outcome })
  console.log(
    `[group] 建档结清 account=${accountId} list=${outcome.list} 登记=${outcome.registered}` +
      ` 尝试=${outcome.attempted} 成=${outcome.snapshotted} 投败=${outcome.postedFailed}` +
      ` 拉败=${outcome.failed} 终态跳=${outcome.skippedFinal} 截断=${outcome.truncated}` +
      ` 中止=${outcome.aborted} 跳过=${outcome.skipped ?? '-'}`
  )
  return outcome
}

/** 测试/运维用：当前有哪些账号在途。 */
export function buildingAccounts(): number[] {
  return [...building]
}
