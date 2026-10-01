// src/renderer/src/lib/groupDisplay.ts
//
// 群成员名单与流水的所有"这一格该出什么话"的判断（spec §8 / §11）。
//
// 放进 `lib/` 而不是组件里，是因为它是本阶段**唯一能自动验证的显示面**：组件里的 JSX 没有
// 单测闸门，而这些判断全是纯函数，能进 `node --test`。改文案判断就是改断言，评审看得见。
//
// 运行时值一律走相对路径 + `.ts` 后缀（技术要点 / R46）：`node --test` 不解析 `@shared/*`，
// 而 `pnpm run typecheck` 认 `@shared/*`。相对路径两边都走得通（先例 `lib/chatDays.ts:4`）。
// 只用类型的 import 可以留别名——编译后被擦除，运行时不需要解析。

import {
  MAX_EXPORT_GROUPS,
  MAX_GROUPS_PER_BUILD,
  exitMethodLabel,
  formatExportTime
} from '../../../shared/groupMembers.ts'
import type {
  CoverageReason,
  GroupBuildOutcome,
  GroupEventSource,
  GroupEventType,
  GroupExportResult
} from '@shared/groupMembers'

/**
 * 覆盖率 → 「少 x%」。一位小数：`DOUBLE` 列会带浮点尾巴（0.9333333333333333），
 * 原样上界面就是「少 6.666666666666667%」。
 */
export function shortfallPercent(coverage: number): number {
  return Math.round((1 - coverage) * 1000) / 10
}

/**
 * 弹层右上角那一行（spec §8 第三行）。只有 `coverage_too_low` 出文案；
 * `first_build` 是正常显示，`ok` 什么都没发生，`no_snapshot` 说的是"这批没带快照"，
 * 拿它当"少人了"会给用户一个凭空出现的百分比。
 */
export function gateNote(reason: string | null, coverage: number | null): string | null {
  if (reason !== 'coverage_too_low') return null
  // 读数没落库（列可空）时不许编一个百分比出来——"少 NaN%"比不显示更糟。
  if (coverage === null) return '本次快照人数低于上次，未做退群判定'
  return `本次快照人数较上次少 ${shortfallPercent(coverage)}%，未做退群判定`
}

/**
 * 成员区的三档（spec §8 第六行）。
 * `unavailable`（非 WhatsApp，采集只在 WhatsApp 上做）与 `never_built`（还没建过档）
 * 是两句话，不许合成"暂无数据"——前者是"这里不支持"，后者是"点刷新就有了"。
 */
export function memberAreaState(row: {
  platform: string
  snapshotCount: number
}): 'unavailable' | 'never_built' | 'built' {
  if (row.platform !== 'whatsapp') return 'unavailable'
  return row.snapshotCount === 0 ? 'never_built' : 'built'
}

/**
 * 空给 `—`，有值只换形不换算。§8 那几格里"没有这个时刻"永远是 `—`，不是空格、不是 0。
 * 「空 → `—`」这条规则从此只有这一处（`joinTimeCopy` / `firstSeenCopy` 都走它）。
 */
export function timeCopy(value: string | null | undefined): string {
  return value ? formatExportTime(value) : '—'
}

/** 进群时间**只**取 `latestJoinAt`（§11 第 2 条：`first_seen_at` 不是进群时间，空就是"我们没看见他进来"）。 */
export function joinTimeCopy(row: { latestJoinAt: string | null }): string {
  return timeCopy(row.latestJoinAt)
}

/**
 * 退群时间列与退出方式列一起算（§8 第四行）。三件事在这一格里分得开：
 * - 在群的人两格空着（`exit_method` 是历史值，不能显示成"现在退群了"）；
 * - 有 `exitMethod` 没 `latestLeaveAt` 是"有证据说人没了、没证据说时间"，给 `—`；
 * - `exitMethod` 本身为空就一字不出——`exitMethodLabel(null)` 给的是 `—`，
 *   直接拿它当"退出方式"显示会让每个在群的人都被读成"退群方式未知"。
 */
export function exitCell(row: {
  isInGroup: boolean
  exitMethod: string | null
  latestLeaveAt: string | null
}): { time: string; method: string } {
  if (row.isInGroup) return { time: '', method: '' }
  if (!row.exitMethod) return { time: '', method: '' }
  return {
    time: row.latestLeaveAt ? formatExportTime(row.latestLeaveAt) : '—',
    method: exitMethodLabel(row.exitMethod)
  }
}

/** 「首次见到」不是「进群时间」：它说的是我们第一次在快照里看见这个人。 */
export function firstSeenCopy(firstSeenAt: string | null): string {
  return timeCopy(firstSeenAt)
}

/** 成员区三档的两句长短：横幅用长的，徽标用短的。`built` 那一档没有话要说。 */
export function memberAreaCopy(state: 'unavailable' | 'never_built' | 'built'): string {
  if (state === 'unavailable') return '该平台的成员采集尚未开通'
  if (state === 'never_built') return '这个群还没建过档——名单为空不等于群里没人'
  return ''
}

export function memberAreaShort(state: 'unavailable' | 'never_built' | 'built'): string {
  if (state === 'unavailable') return '未开通'
  if (state === 'never_built') return '未建档'
  return ''
}

/**
 * 事件类型与来源的中文词（R51）：只有界面读它们，所以作者在这里而不是 shared。
 * 形状照 shared 那两张表（`Partial<Record<…>>` + 未知回落原词）——未知值留空白是最坏的回落。
 */
const EVENT_TYPE_LABEL: Partial<Record<GroupEventType, string>> = {
  added: '被加入',
  joined: '主动加入',
  left: '自行退群',
  removed: '被移出',
  promoted: '升为管理员',
  demoted: '降为成员'
}
const EVENT_SOURCE_LABEL: Partial<Record<GroupEventSource, string>> = {
  system_message: '系统消息',
  live_event: '实时事件'
}

export function eventTypeCopy(eventType: string): string {
  return EVENT_TYPE_LABEL[eventType as GroupEventType] ?? eventType
}

export function sourceCopy(source: string): string {
  return EVENT_SOURCE_LABEL[source as GroupEventSource] ?? source
}

/**
 * 「是 / 否」这一对在 Java 侧已经格式化过一次（§A.2 ⑥ 的 `inGroup`）。跨语言共不了同一份表，
 * 所以这里用 `groupDisplay.test.ts` 那条断言把两侧钉住：改成"在群/已退群"会红，改 Java 也会红。
 */
export function inGroupCopy(isInGroup: boolean): string {
  return isInGroup ? '是' : '否'
}

/** 操作人：有名字用名字，没名字用键，两个都没有才是 `—`（系统消息那一路常常没有 actorName）。 */
export function actorCopy(row: { actorName: string | null; actorKey: string | null }): string {
  if (row.actorName) return row.actorName
  if (row.actorKey) return row.actorKey
  return '—'
}

/** 「首次见到」只在"没有进群时间"时补一句——两行并排会把人引向"到底哪个是进群时间"。 */
export function firstSeenNote(row: { latestJoinAt: string | null; firstSeenAt: string | null }): string {
  if (row.latestJoinAt || !row.firstSeenAt) return ''
  return `首次见到 ${firstSeenCopy(row.firstSeenAt)}`
}

/**
 * 导出上限那一句话在**渲染层**的唯一作者：界面前拦带 `count`（「当前勾了 51 个」），
 * 主进程回 `too_many` 时不带（「一次最多导出 50 个群」）。
 */
export function tooManyCopy(count?: number): string {
  return `一次最多导出 ${MAX_EXPORT_GROUPS} 个群${count == null ? '' : `，当前勾了 ${count} 个`}`
}

/**
 * 导出结论 → 界面文案（spec §10 的六格 + preload 没接上那一格）。
 * `null` 与 `failed` 必须分开：前者是"这个构建里宿主没接上"，后者是"接上了但取数/写文件没成"，
 * 塌成一句会让人去重试一个根本不存在的通道。
 */
export function exportOutcomeCopy(result: GroupExportResult | null): string {
  if (!result) return '宿主没有给出导出结果（这个构建里 `group:export` 没接上）'
  switch (result.reason) {
    case 'saved':
      return `已导出 ${result.rows} 行：${result.path ?? ''}`
    case 'cancel':
      return '已取消保存，什么都没写'
    case 'empty_keys':
      return '没有可导出的群：先勾选至少一个'
    case 'too_many':
      return tooManyCopy()
    case 'no_rows':
      return '这些群还没有成员名单，先建一次档再导'
    case 'failed':
      return '导出没成：后端取数或本地写文件失败，详情看主进程日志'
    default:
      return `导出结果：${result.reason}` // 以后加新 reason 时至少能看见码，不给空白
  }
}

/**
 * 一轮建档的结论 → 若干行提示（§8 第一行的本期形状，R50：逐群原因不在 IPC 载荷里）。
 *
 * 返回数组是因为一轮里"截断 + 两群快照没成"可以同时成立，合成一行就会只剩第一个；
 * 但 `skipped` 那一档要**早退**——那意味着这一轮根本没去读，此时再报"页内没答"是假话。
 */
export function buildFailureNotes(outcome: GroupBuildOutcome | null): string[] {
  if (!outcome) return ['宿主没有给出建档结果（这个构建里 `group:build` 没接上）']
  if (outcome.skipped === 'busy') return ['这个账号已有一轮建档在跑，这一轮没开']
  if (outcome.skipped === 'no_view') return ['这个账号的窗口没挂着，采集下不去']
  const notes: string[] = []
  if (outcome.list === 'silent') notes.push('页内没回答群名单（桥没就绪或 wa-js 没答），这一轮没建档')
  if (outcome.list === 'error') notes.push('群名单没读到（页内报错了）')
  if (outcome.aborted) notes.push('这一轮被中止（账号掉线或退出），已经入库的那部分仍算数')
  if (outcome.truncated) notes.push(`这一轮只跑了 ${MAX_GROUPS_PER_BUILD} 个群，剩下的等下一次触发`)
  if (outcome.failed > 0) notes.push(`${outcome.failed} 个群的快照没成`)
  if (outcome.postedFailed > 0) notes.push(`${outcome.postedFailed} 个群入库没成（后端没答或报错）`)
  return notes
}

/** 流水页脚那句（§15#5）：说的是这一列的读数含义，不预报偏差量级——那条还没实测。 */
export const LIVE_EVENT_TIME_NOTE =
  '来源为「实时事件」的行，时间是主进程收到它的时刻；平台本身没给出发生时刻。'

export type { CoverageReason }
