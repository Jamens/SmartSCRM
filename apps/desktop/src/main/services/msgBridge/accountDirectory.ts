// src/main/services/msgBridge/accountDirectory.ts
import { getSession } from '../../state/session'
import { platformOfAccountType, type ChatPlatform } from '@shared/chatPlatform'
import { createMsgApi, type AccountRow } from './msgApi'

export interface AccountEntry {
  accountId: number
  platformType: number
  platform: ChatPlatform | null
  name: string
  viewId: string
  /** B14：绑定的指纹档案 id；null = 不施加任何指纹（R2）。 */
  fingerprintProfileId: number | null
}

const TTL_MS = 5 * 60_000

let entries: AccountEntry[] = []
let fetchedAt = 0
let inflight: Promise<AccountEntry[]> | null = null

const api = createMsgApi({ token: () => getSession()?.accessToken ?? null })

function toEntry(row: AccountRow): AccountEntry {
  return {
    accountId: row.id,
    platformType: row.platformType,
    platform: platformOfAccountType(row.platformType),
    name: row.name,
    viewId: row.viewId,
    // `?? null`：后端没带这列（旧库 / 未跑 V53）时按未绑定处理，绝不当成"绑了某个档案"。
    fingerprintProfileId: row.fingerprintProfileId ?? null
  }
}

/**
 * 视图可以后台存活，登录成功也可能发生在用户切走路由之后（同 useLoginStatusSync 的前提）。
 * 所以账号归属由主进程自己拉一次带 JWT 的列表，而不是问渲染层。
 */
export async function refreshAccounts(force = false): Promise<AccountEntry[]> {
  if (!force && Date.now() - fetchedAt < TTL_MS) return entries
  if (inflight) return inflight
  inflight = api
    .listAccounts()
    .then((rows) => {
      // 空数组 = 未登录或后端不可用：保留旧目录，不清空。
      // 清空的后果是"正在采集的视图突然查不到账号"，那比旧数据更糟。
      if (rows.length > 0) {
        entries = rows.map(toEntry)
        fetchedAt = Date.now()
      }
      return entries
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

export function accountOfView(viewId: string): AccountEntry | null {
  return entries.find((e) => e.viewId === viewId) ?? null
}

export function accountOfId(accountId: number): AccountEntry | null {
  return entries.find((e) => e.accountId === accountId) ?? null
}

export function resetAccountDirectory(): void {
  entries = []
  fetchedAt = 0
}
