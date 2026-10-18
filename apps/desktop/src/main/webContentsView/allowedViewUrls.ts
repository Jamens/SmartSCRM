/**
 * 受管视图（WebContentsView）可加载的 URL 白名单。
 *
 * <p>为什么需要它：这些视图装的是 WhatsApp / Telegram / LINE 的官方站点，是**第三方内容**。
 * 而 `wcv-create` / `wcv-navigate` 接受任意 URL 且主进程不做任何校验——一旦渲染层被 XSS
 * 攻破，攻击者就能让一个装在应用里的视图导航到任意页面（钓鱼页、内网地址），
 * 而视图带的是应用的权限与 cookie 上下文。
 *
 * <p>口径与 {@code ALLOWED_PUSH_CHANNELS} 一致：**默认拒绝，白名单显式放行**。
 * 新增平台时在这里加一条，不要改成通配。
 *
 * <p>三条硬规则，任何一条不满足即拒绝：
 * <ol>
 *   <li>只允许 {@code https:}——{@code http:} 明文可被中间人改写，{@code file:} 能读本地文件，
 *       {@code javascript:}/{@code data:} 能直接执行代码。</li>
 *   <li>host 必须在白名单内，且**精确匹配或子域匹配**（{@code .telegram.org} 匹配
 *       {@code web.telegram.org} 但不匹配 {@code telegram.org.evil.com}）。</li>
 *   <li>拒绝一切含用户信息的 URL（{@code user:pass@host}）——凭据不该出现在 URL 里。</li>
 * </ol>
 */

/** 允许加载的域（精确或子域）。新增平台改这里。 */
const ALLOWED_VIEW_HOSTS = [
  'whatsapp.com',
  'web.whatsapp.com',
  'web.telegram.org',
  'telegram.org',
  'line.me',
  'web.line.me'
] as const

/**
 * 判断一个 host 是否落在白名单内：命中精确项，或是被允许域的子域。
 *
 * <p>注意子域判定必须是「以 .边界 结尾」而不是「包含」——用 contains 会让
 * {@code telegram.org.evil.com} 通过，那正是绕过白名单最常见的写法。
 */
export function isAllowedViewHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (host === '') return false
  return ALLOWED_VIEW_HOSTS.some((allowed) => {
    const a = allowed.toLowerCase()
    return host === a || host.endsWith(`.${a}`)
  })
}

/**
 * 受管视图的 URL 准入判定。返回原因便于日志排查，拒绝时抛错而不是静默 false——
 * 静默会让「视图打不开」变成一个查不出原因的现象。
 */
export function assertViewUrlAllowed(url: string): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`invalid view url: ${url}`)
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`view url must be https, got ${parsed.protocol}: ${url}`)
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error('view url must not embed credentials')
  }
  if (!isAllowedViewHost(parsed.hostname)) {
    throw new Error(`view host not allowed: ${parsed.hostname}`)
  }
  return parsed
}
