/** WhatsApp Web DOM selectors. */

export const INPUT = {
  main: '#main div[contenteditable="true"]',
  mainAlt: '._ak1q [contenteditable=true]'
}

export const SEND_BUTTON = {
  main: '._ak1r span[data-icon="send"]',
  mainNew: 'button span[data-icon*="send-"]'
}

export const MESSAGE = {
  /** 观察容器：整个会话面板在切会话时重建，挂在它上面才不会一换会话就失去 MutationObserver。 */
  container: 'div#main',
  /**
   * 一条消息的行。`data-id` 挂在这一层的外层 div 上，消息标识从这里取。
   * 用 `.copyable-area` 把范围收在消息列表内：会话面板的标题栏里也有可复制文本，那不是消息。
   */
  row: '#main .copyable-area [data-id]',
  /**
   * 行内正文。外层 `div.copyable-text` 把发送时间一起包在 textContent 里，
   * 取内层 span 才拿得到不带时间戳的一句话；内层 span 不存在（纯表情、系统提示）就是没有正文。
   */
  textNode: 'span.copyable-text',
  /** 气泡本体：与消息同宽同侧的那一层，译文挂在它下面。 */
  bubble: 'div.copyable-text',
  focusable: 'div[role="listitem"]',
  /** 长文本折叠后的展开控件：没展开就没有完整文本，宁可不译。 */
  expandMore: '[data-testid="caption-read-more-button"]'
}

export const APP = {
  /** Left chat list is present only after login. */
  loggedIn: '#pane-side',
  loginPanel: '#app .app-wrapper-web two-screen-wrapper'
}

export default { INPUT, SEND_BUTTON, MESSAGE, APP }
