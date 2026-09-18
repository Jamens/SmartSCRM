/** Telegram Web DOM selectors. */

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
