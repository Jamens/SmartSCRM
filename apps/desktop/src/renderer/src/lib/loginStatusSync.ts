import { useEffect, useRef } from 'react'
import { useAccounts, useUpdateAccountStatus, type PlatformAccount } from '@/stores/accounts'
import { viewService } from '@/services/viewService'

/**
 * 注入层登录轮询上报的通道名（见 inject/core/BaseInjector 的 _startLoginPoll）。
 * 主进程转发页面消息时会带上来源前缀（view:toHost → `toHost:`，view:send → `send:`），
 * 所以渲染层看到的是拼好前缀的名字。
 */
const LOGIN_CHANNEL = 'toHost:login-status'
/**
 * 掉线要连续观测这么多次才写库。注入层每 3 秒无脑上报一次，
 * 而 WhatsApp Web 在重绘、切会话、手机临时离线时会让 #pane-side 短暂消失，
 * 单次 false 不足以判定离线，否则侧栏徽标会来回闪。
 */
const OFFLINE_CONFIRMATIONS = 2

interface LoginStatusPayload {
  isLogin?: boolean
}

/**
 * 内嵌页面里的扫码登录结果只存在于那个页面里，主进程和数据库都不知道。
 * 这个 hook 把「视图上报的登录态」落成「账号行的在线状态」，
 * 让侧栏状态点、舞台徽标和后续按在线态调度的模块有真实依据。
 *
 * 只在 AppLayout 挂载一次：视图可以后台存活，登录成功也可能发生在用户切走路由之后。
 */
export function useLoginStatusSync(): void {
  const { data } = useAccounts()
  const { mutate } = useUpdateAccountStatus()

  const accountsRef = useRef<PlatformAccount[]>([])
  accountsRef.current = data ?? []
  const mutateRef = useRef(mutate)
  mutateRef.current = mutate

  // 库里已经是什么，直接看查询缓存里的 account.status：写成功后 invalidate 会把它刷新，
  // 不需要另存一份「上次写了什么」。这里只留「正在写」的闸门，避免一次写没落定时被重复触发。
  const inFlight = useRef(new Set<number>())
  const offlineStreak = useRef(new Map<number, number>())

  useEffect(
    () =>
      viewService.onPageMessage((msg) => {
        if (msg.channel !== LOGIN_CHANNEL) return
        // 账号归属只认主进程按 webContents 反查出来的 viewId，
        // 页面自己声明的 webviewId 不作数：内嵌的是第三方页面，不能让它替别的账号上报。
        const { isLogin } = (msg.data ?? {}) as LoginStatusPayload
        if (!msg.viewId) return
        const account = accountsRef.current.find((a) => a.viewId === msg.viewId)
        if (!account) return

        if (isLogin === true) {
          offlineStreak.current.delete(account.id)
          if (account.status !== 1) writeStatus(account.id, 1)
          return
        }

        // 本来就离线：没有需要防抖的状态变化，直接结束，也不留残余计数。
        if (account.status !== 1) {
          offlineStreak.current.delete(account.id)
          return
        }
        const streak = (offlineStreak.current.get(account.id) ?? 0) + 1
        if (streak < OFFLINE_CONFIRMATIONS) {
          offlineStreak.current.set(account.id, streak)
          return
        }
        offlineStreak.current.delete(account.id)
        writeStatus(account.id, 0)
      }),
    []
  )

  function writeStatus(id: number, status: number): void {
    if (inFlight.current.has(id)) return
    inFlight.current.add(id)
    mutateRef.current(
      { id, status },
      { onSettled: () => void inFlight.current.delete(id) }
    )
  }
}
