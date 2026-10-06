// src/bridge/whatsapp/groupOps.ts
import type { WppContactApi, WppGroupApi } from '../types.ts'

/**
 * B18/B19 群操作（加群/踢人）的**页内实现**。执行链的最后一公里（spec §5/§9）：
 * Java 只编排状态（谁是 pending、间隔多久、要不要 failover），真正动 WhatsApp 的动作全在这里。
 *
 * 三条纪律贯穿本文件：
 *
 * 1. **只声明真正用到的那几个 WPP 能力**，测试喂假对象即可（与 `groups.ts`/`send.ts` 同路子）。
 *    这里要 `join`（加群）、`canRemove`/`removeParticipants`（踢人）——都是 wa-js 4.x
 *    `dist/group/functions/` 下实测存在的。
 * 2. **wpp 允许为空、失败返回 `ok:false`，不抛**。页内 `window.WPP` 还没挂上时（刚注入、
 *    页面还在加载）主进程就会来问；抛异常会让调用方拿到一个看不出原因的崩溃。
 * 3. **不可逆动作的兜底在执行侧**：`kickTarget` 先 `canRemove` 再 `removeParticipants`，
 *    能力不允许的成员只报 `skipped`——踢超管/踢自己找不回来（spec §5 第 2 道门）。
 *    注意人工门（approvalStatus）**不在这里判**：那在 Java 侧执行链入口判过了（`requireApproved`），
 *    页内拿到的命令已经是"获准执行"的。页内只做能力兜底。
 */

/** 本模块用到的 WPP 群能力。**直接吃既有的 {@link WppGroupApi}**（已含 join/canRemove/
 *  removeParticipants 可选方法），不另建一套——同一个 `WPP.group` 有两套类型定义的话，
 *  迟早有一处改了另一处没改，wa-js 升级时就在那里炸。 */
export interface GroupOpsWpp {
  group?: WppGroupApi
  contact?: WppContactApi
}

export interface JoinResult {
  ok: boolean
  groupId?: string
  /** 进了待审批（群设���了审核）——**算成功但要标出来**，否则会被误判成失败而重试。 */
  pendingApproval?: boolean
  error?: string
}

export interface PreviewResult {
  ok: boolean
  groupId?: string
  owner?: string | null
  participantCount?: number
  error?: string
}

export interface KickResult {
  ok: boolean
  /** 实际踢掉的。 */
  removed?: string[]
  /** 能力不允许、**没踢**的（canRemove=false）——防不可逆事故的关键。 */
  skipped?: string[]
  /** 真踢了但失败的。 */
  failed?: Array<{ id: string; error: string }>
  error?: string
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ---------------------------------------------------------------------------
// B18 加群
// ---------------------------------------------------------------------------

/**
 * 凭邀请码加群。
 *
 * `pendingApproval: true` 也返回 `ok:true`——群设了入群审核，此时我们**已经提交成功**，
 * 只是等群主批。判成失败会触发上层重试，重复提交审核申请反而更糟。
 */
export async function joinGroup(wpp: GroupOpsWpp | undefined, inviteCode: string): Promise<JoinResult> {
  if (!wpp?.group?.join) {
    return { ok: false, error: 'WPP.group.join 不可用' }
  }
  if (!inviteCode) {
    return { ok: false, error: '邀请码为空' }
  }
  try {
    const r = await wpp.group.join(inviteCode)
    if (!r?.id) {
      return { ok: false, error: 'join 未返回 groupId' }
    }
    return { ok: true, groupId: r.id, pendingApproval: r.pendingApproval === true }
  } catch (e) {
    // 邀请码失效/已被封都会走到这里。**不重试**（spec §5）：重试只是浪费配额还加深风控。
    return { ok: false, error: errText(e) }
  }
}

/** join 前预览：群名/群主/成员数，让人知道这个码是哪个群。失败不阻断主流程。 */
export async function previewInvite(
  wpp: GroupOpsWpp | undefined,
  inviteCode: string
): Promise<PreviewResult> {
  if (!wpp?.group?.getGroupInfoFromInviteCode) {
    return { ok: false, error: 'WPP.group.getGroupInfoFromInviteCode 不可用' }
  }
  try {
    const r = await wpp.group.getGroupInfoFromInviteCode(inviteCode)
    if (!r?.id) {
      return { ok: false, error: '邀请码无对应群' }
    }
    return {
      ok: true,
      groupId: r.id,
      owner: r.owner ?? null,
      participantCount: Array.isArray(r.participants) ? r.participants.length : 0
    }
  } catch (e) {
    return { ok: false, error: errText(e) }
  }
}

// ---------------------------------------------------------------------------
// B19 踢人
// ---------------------------------------------------------------------------

/**
 * 踢一批成员。**逐个判 canRemove**：整批一次 canRemove 只能得一个布尔，
 * 会把「可踢的」和「不可踢的」混在一起分不出来——必须逐个判，才能把超管/自己
 * 标成 skipped 而不是跟着一起硬踢（不可逆）。
 *
 * 返回值把三种结局分开：removed（真踢掉）/ skipped（能力不允许，没踢）/
 * failed（真踢了但报错）。上层据此分别回填，别把 skipped 当失败重试。
 */
export async function kickParticipants(
  wpp: GroupOpsWpp | undefined,
  groupId: string,
  participantIds: string[]
): Promise<KickResult> {
  if (!wpp?.group?.removeParticipants || !wpp.group.canRemove) {
    return { ok: false, error: 'WPP.group 踢人能力不可用' }
  }
  if (!groupId) {
    return { ok: false, error: 'groupId 为空' }
  }
  const ids = (participantIds ?? []).filter((x) => typeof x === 'string' && x.length > 0)
  if (ids.length === 0) {
    return { ok: true, removed: [], skipped: [], failed: [] }
  }

  const removed: string[] = []
  const skipped: string[] = []
  const failed: Array<{ id: string; error: string }> = []

  for (const id of ids) {
    // 能力门：先问能不能踢。不能踢就跳过，绝不硬来。
    let can = false
    try {
      can = (await wpp.group.canRemove(groupId, id)) === true
    } catch (e) {
      // 校验本身抛了＝判不出来。宁可跳过：不可逆动作，宁可不做。
      failed.push({ id, error: `canRemove 失败: ${errText(e)}` })
      continue
    }
    if (!can) {
      skipped.push(id)
      continue
    }
    try {
      await wpp.group.removeParticipants(groupId, id)
      removed.push(id)
    } catch (e) {
      failed.push({ id, error: errText(e) })
    }
  }
  return { ok: true, removed, skipped, failed }
}
