/**
 * 往第三方平台的 contenteditable 输入框里整段替换文本。
 *
 * 这类输入框由富文本编辑器接管（WhatsApp 用 ProseMirror）：赋 innerText 只改到 DOM，
 * 编辑器立刻按自己的文档状态同步回去，表现就是"点了没反应"。只有 insertText 命令会走
 * 它监听的原生 beforeinput；先把整段选中，替换才不会变成在光标处追加。
 *
 * 清空（text 为空）是另一回事：delete / forwardDelete / insertText('') 三条命令在这类
 * 编辑器上都返回 true 却什么都不删，所以必须复核一次，删不掉就返回 false，
 * 绝不把"没删动"报成成功。
 *
 * @returns 是否确认写成（传空串时 = 是否确认删空）
 */
export function replaceEditorText(el: HTMLElement, text: string): boolean {
  el.focus()
  const selection = window.getSelection()
  if (!selection) return false

  const range = document.createRange()
  range.selectNodeContents(el)
  selection.removeAllRanges()
  selection.addRange(range)
  let ok = false
  try {
    ok = text ? document.execCommand('insertText', false, text) : document.execCommand('delete')
  } catch {
    ok = false
  }
  selection.removeAllRanges()
  if (ok && !text) ok = !(el.textContent ?? '').trim()
  return ok
}
