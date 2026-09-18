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
  container: 'div#main',
  textNode: '.copyable-text',
  focusable: 'div[role="listitem"]'
}

export const APP = {
  /** Left chat list is present only after login. */
  loggedIn: '#pane-side',
  loginPanel: '#app .app-wrapper-web two-screen-wrapper'
}

export default { INPUT, SEND_BUTTON, MESSAGE, APP }
