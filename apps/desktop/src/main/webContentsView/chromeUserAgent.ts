/**
 * 内嵌视图对外的浏览器身份。
 *
 * 第三方站点会读 User-Agent 决定给不给它自己的应用：WhatsApp Web 只要看到 Electron 或应用标识，
 * 就渲染「浏览器不受支持」页面并就此停下，连自己的 bundle 都不加载，扫码后的注册握手永远不会完成，
 * 手机端因此一直停在转圈等待。内嵌视图的用途就是充当这些站点的浏览器，所以对外按标准 Chrome 表态。
 *
 * 主版本号取自当前 Electron 真正内置的 Chromium，不做虚报：站点据此做的能力探测才仍然成立。
 * 只作用于内嵌视图，宿主窗口（自有页面）保持默认 UA。
 */
function platformToken(platform: NodeJS.Platform, arch: string): string {
  if (platform === 'darwin') return 'Macintosh; Intel Mac OS X 10_15_7'
  if (platform === 'win32') return 'Windows NT 10.0; Win64; x64'
  return `X11; Linux ${arch === 'arm64' ? 'aarch64' : 'x86_64'}`
}

/** `null` 表示拿不到内核版本，此时宁可不改 UA，也不编一个版本号出去。 */
export function chromeUserAgent(): string | null {
  const chrome = (process.versions as Record<string, string | undefined>).chrome
  const major = chrome ? Number(chrome.split('.')[0]) : Number.NaN
  if (!Number.isFinite(major) || major <= 0) return null
  return `Mozilla/5.0 (${platformToken(process.platform, process.arch)}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`
}
