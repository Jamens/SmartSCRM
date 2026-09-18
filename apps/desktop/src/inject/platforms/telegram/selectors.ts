/** Telegram Web DOM selectors (compact port of legacy platforms/telegram/selectors.js). */

export const INPUT = {
  box: '.middle-column-footer',
  editInputId: '#editable-message-text',
  imgInputId: '#editable-message-text-modal'
}

export const MESSAGE = {
  box: '.Transition_slide.Transition_slide-active>.MessageList',
  item: '.message-list-item',
  idAttr: 'data-message-id',
  text: '.text-content',
  container: '.Message',
  scroll: '.MessageList.custom-scroll'
}

export const APP = {
  loggedIn: '.Imgs'
}

export default { INPUT, MESSAGE, APP }
