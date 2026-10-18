// 受管视图 URL 白名单的行为验证。
//
// 为什么用 .mjs 而不是 vitest：这个文件守的是**主进程的准入判定**，
// 而桌面端当前没装 node_modules（本仓库的开源协作里不主动装依赖）。
// 把逻辑原样抄一份跑攻击向量，是不依赖任何依赖就能验证的正确姿势。
//
// 改动 src/main/webContentsView/allowedViewUrls.ts 的判定逻辑时，
// 记得同步本文件——两者口径必须一致。
//
// 跑法：node src/main/webContentsView/allowedViewUrls.verify.mjs

const ALLOWED_VIEW_HOSTS = [
  'whatsapp.com',
  'web.whatsapp.com',
  'web.telegram.org',
  'telegram.org',
  'line.me',
  'web.line.me'
]

function isAllowedViewHost (hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (host === '') return false
  return ALLOWED_VIEW_HOSTS.some((allowed) => {
    const a = allowed.toLowerCase()
    return host === a || host.endsWith(`.${a}`)
  })
}

function verdict (url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return 'REJECT(invalid)'
  }
  if (parsed.protocol !== 'https:') return 'REJECT(protocol)'
  if (parsed.username !== '' || parsed.password !== '') return 'REJECT(creds)'
  if (!isAllowedViewHost(parsed.hostname)) return 'REJECT(host)'
  return 'ACCEPT'
}

const CASES = [
  // 正常路径：三个平台各自的官方入口都必须放行
  ['https://web.telegram.org/k/', 'ACCEPT'],
  ['https://telegram.org/', 'ACCEPT'],
  ['https://web.whatsapp.com/', 'ACCEPT'],
  ['https://web.line.me/', 'ACCEPT'],
  ['https://WEB.TELEGRAM.ORG/k/', 'ACCEPT'], // host 大小写

  // 域名绕过：用 contains 判子域就会漏掉第一个
  ['https://telegram.org.evil.com/', 'REJECT(host)'],
  ['https://web.telegram.org.evil.com/k/', 'REJECT(host)'],
  // 合法域出现在 query 里，不等于目标就是合法域
  ['https://evil.com/?next=https://web.telegram.org', 'REJECT(host)'],
  // 内网与本地：受管视图带应用上下文，不该被引到内网
  ['https://192.168.1.1/admin', 'REJECT(host)'],
  ['https://localhost:8080/', 'REJECT(host)'],

  // 协议绕过：http 明文可被中间人改写；file 能读本地；js/data 能直接执行
  ['http://web.telegram.org/', 'REJECT(protocol)'],
  ['file:///C:/Users/victim/secret.txt', 'REJECT(protocol)'],
  ['javascript:alert(document.cookie)', 'REJECT(protocol)'],
  ['data:text/html,<script>alert(1)</script>', 'REJECT(protocol)'],

  // URL 里嵌凭据不该被接受
  ['https://user:pass@web.telegram.org/', 'REJECT(creds)'],

  // 形状错误
  ['not a url', 'REJECT(invalid)'],
  ['', 'REJECT(invalid)']
]

let failed = 0
for (const [url, want] of CASES) {
  const got = verdict(url)
  const ok = got === want
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${url || '(空)'}  -> ${got}${ok ? '' : ` (期望 ${want})`}`)
}
console.log(`\n${CASES.length - failed}/${CASES.length} 通过`)
process.exit(failed > 0 ? 1 : 0)
