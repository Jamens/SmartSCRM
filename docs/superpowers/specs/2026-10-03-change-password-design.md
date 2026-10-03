# A9 · 修改密码（改密后强制重新登录）

日期：2026-10-03 ｜ 落点：设置页「账户安全」卡 ｜ 阶段：P14

## 1. 背景与缺口

认证体系（A1）已交付：登录 / 刷新 / 取当前用户都在。但**没有改密入口**——
用户一旦拿到账号就永远用初始密码，这与「只有认证没有授权」（README §7.7）是同一个根上的另一半缺口：
能进得来，却改不了自己的凭据。A9 补上这条闭环。

## 2. 落点

设置页（A15）新增「账户安全」卡，不另开页面。卡片含三项输入：原密码 / 新密码 / 确认新密码，
带可见性切换、长度与一致性前端校验、提交后状态反馈。

## 3. 后端

- `web/dto/ChangePasswordRequest.java`（record）：
  `oldPassword`（`@NotBlank`）、`newPassword`（`@NotBlank @Size(min=8, max=64)`）。
  长度约束在 DTO 层由 `@Valid` 拦截，不进 Service。
- `service/AuthService.changePassword(userId, oldPassword, newPassword)`：
  1. 查用户，不存在或 `status != 1` → `BizException.unauthorized`
  2. 原密码不匹配 → `BizException(40001, "原密码错误")`
  3. 新密码与原密码哈希匹配（即没改） → `BizException(40002, "新密码不能与原密码相同")`
  4. `passwordEncoder.encode(newPassword)` 写回 `passwordHash` 并 `updateById`
- `web/AuthController`：`POST /api/auth/change-password`，`@AuthenticationPrincipal AuthPrincipal`
  取 userId，返回 `ApiResponse<Void>`。

## 4. 前端

- `api/auth.ts`：`changePassword({ oldPassword, newPassword })` → `http.post<void>('/api/auth/change-password', ...)`
- `pages/SettingsPage.tsx`：账户安全卡。本地 state 管三字段 + 可见性 + 提交中 / 错误 / 成功；
  提交前前端校验（新密码 ≥8 位、两次一致），失败直接拦截不发请求；
  调接口成功后 `useAuthStore.getState().logout()` 清掉本机会话。
- 强制重登的语义落在**前端清 token**：`logout()` 把 `phase` 置回 `anonymous`，
  `App.tsx` 在 `phase==='anonymous'` 时渲染 `LoginPage`，无需手动导航。

## 5. 「强制重新登录」的实现边界（重要）

当前 JWT 是无状态、不带版本号，**改密后旧的 access/refresh token 在过期前仍可被接受**。
A9 采用「前端清 token 跳登录」的最小方案，精确匹配清单原话「改密后清 token 强制重登」：
正常用户的客户端立即失活，必须重新登录。

**未做**：`tokenVersion` 失效机制（改密时版本 +1、过滤器每次查库校验）。那是纵深防御，
会改变无状态架构、每次请求多一次 DB 查，且超出本次「前端清 token」的口径。若日后要做，
单列一笔，不动本实现的契约。

## 6. 验证

- 后端：`AuthServiceTest` 覆盖四条分支（成功 / 原密码错 40001 / 新旧相同 40002 / 用户缺失 40100）。
- 前端：四路 `pnpm typecheck` + `pnpm test:unit` + `pnpm lint` 全绿。
- 真机联调门槛：需要一个能登录的账号，在设置页改密后用新密码能否登回——属用户在场实测项。

## 7. 文件清单

- 新增：`web/dto/ChangePasswordRequest.java`、`api/auth.ts`
- 改：`service/AuthService.java`、`web/AuthController.java`、`pages/SettingsPage.tsx`
- 测：`service/AuthServiceTest.java`
