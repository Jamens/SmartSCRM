import { create } from 'zustand'
import { configureHttp, http, ApiError } from '@/lib/http'
import { getDeviceId, type UserInfo } from '@/lib/device'

export type AuthPhase = 'boot' | 'anonymous' | 'authenticated'

interface AuthState {
  phase: AuthPhase
  user: UserInfo | null
  accessToken: string | null
  refreshToken: string | null
  error: string | null
  submitting: boolean
  boot: () => Promise<void>
  login: (req: { username: string; password: string; inviteCode: string }) => Promise<boolean>
  logout: () => Promise<void>
}

interface LoginResult {
  accessToken: string
  refreshToken: string
  expiresIn: number
  user: UserInfo
}

async function persistSession(session: { accessToken: string; refreshToken: string; user: UserInfo | null }): Promise<void> {
  await window.scrm?.session.save(session)
}

const store = create<AuthState>((set) => ({
  phase: 'boot',
  user: null,
  accessToken: null,
  refreshToken: null,
  error: null,
  submitting: false,

  boot: async () => {
    const saved = (await window.scrm?.session.get()) as LoginResult | null
    if (saved?.accessToken) {
      set({ accessToken: saved.accessToken, refreshToken: saved.refreshToken })
      try {
        const user = await http.get<UserInfo>('/api/auth/me')
        set({ phase: 'authenticated', user })
        return
      } catch {
        await window.scrm?.session.clear()
      }
    }
    set({ phase: 'anonymous' })
  },

  login: async ({ username, password, inviteCode }) => {
    set({ submitting: true, error: null })
    try {
      const deviceId = await getDeviceId()
      const result = await http.post<LoginResult>('/api/auth/login', {
        username,
        password,
        inviteCode,
        deviceId,
        deviceName: navigator.userAgent.includes('Electron') ? 'SmartSCRM Desktop' : 'Dev Browser'
      })
      set({
        phase: 'authenticated',
        user: result.user,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        submitting: false,
        error: null
      })
      await persistSession({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        user: result.user
      })
      return true
    } catch (e) {
      set({ submitting: false, error: e instanceof ApiError ? e.message : '登录失败，请重试' })
      return false
    }
  },

  logout: async () => {
    await window.scrm?.session.clear()
    set({ phase: 'anonymous', user: null, accessToken: null, refreshToken: null, error: null })
  }
}))

configureHttp({
  getAccessToken: () => store.getState().accessToken,
  refresh: async () => {
    const refresh = store.getState().refreshToken
    if (!refresh) return null
    const access = await http.refreshOnce(refresh)
    if (access) {
      store.setState({ accessToken: access })
      await persistSession({
        accessToken: access,
        refreshToken: store.getState().refreshToken ?? refresh,
        user: store.getState().user
      })
    } else {
      void store.getState().logout()
    }
    return access
  }
})

export const useAuthStore = store
