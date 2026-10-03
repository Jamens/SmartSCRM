import { http } from '@/lib/http'

export interface ChangePasswordInput {
  oldPassword: string
  newPassword: string
}

/** POST /api/auth/change-password —— 校验原密码后重写哈希。成功后调用方应清掉本机会话强制重登。 */
export function changePassword(input: ChangePasswordInput): Promise<void> {
  return http.post<void>('/api/auth/change-password', input)
}
