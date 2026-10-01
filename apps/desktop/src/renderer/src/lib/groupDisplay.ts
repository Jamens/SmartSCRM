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

import { exitMethodLabel, formatExportTime } from '../../../shared/groupMembers.ts'
import type { CoverageReason } from '@shared/groupMembers'

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

/** 进群时间**只**取 `latestJoinAt`（§11 第 2 条：`first_seen_at` 不是进群时间，空就是"我们没看见他进来"）。 */
export function joinTimeCopy(row: { latestJoinAt: string | null }): string {
  return row.latestJoinAt ? formatExportTime(row.latestJoinAt) : '—'
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
  return firstSeenAt ? formatExportTime(firstSeenAt) : '—'
}

export type { CoverageReason }
