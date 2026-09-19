const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 往第三方平台的 contenteditable 输入框里整段替换文本。
 *
 * 这类输入框由富文本编辑器接管（WhatsApp 用 ProseMirror）：赋 innerText 只改到 DOM，
 * 编辑器立刻按自己的文档状态同步回去，表现就是"点了没反应"。
 *
 * 未信任的 `execCommand('insertText')` 同样不可靠：WhatsApp 对**含空格**的整段写入会
 * 只收前一两个字符再异步回滚（命令返回 true，最终文档却不是），逐字符补写也会被回滚。
 * 真正走它输入管线的是 **paste**：`ClipboardEvent('paste')` 被处理器 preventDefault 后，
 * 编辑器按自己的事务整段替换选中内容，且文档更新是异步的——所以写完必须轮询复核，
 * 命令路径只作为不识别合成 paste 的平台（或粘贴失败时）的兜底。
 *
 * 清空（text 为空）是另一回事：delete / forwardDelete / insertText('') 三条命令在这类
 * 编辑器上都返回 true 却什么都不删，所以必须复核一次，删不掉就返回 false，
 * 绝不把"没删动"报成成功。
 *
 * @returns 是否确认写成（传空串时 = 是否确认删空）
 */
export async function replaceEditorText(el: HTMLElement, text: string): Promise<boolean> {
  el.focus()
  const selection = window.getSelection()
  if (!selection) return false

  const selectAll = (): void => {
    const range = document.createRange()
    range.selectNodeContents(el)
    selection.removeAllRanges()
    selection.addRange(range)
  }
  // 编辑器会把空格渲染成 \u00a0，复核前归一化，否则整段比对永远不相等
  const written = (): string => (el.textContent ?? '').replace(/\u00a0/g, ' ').trim()
  const target = text.trim()

  if (!target) {
    selectAll()
    try {
      document.execCommand('delete')
    } catch {
      /* 命令不可用按"没删动"处理 */
    }
    return !written()
  }

  // 1) 合成 paste：走编辑器自己的输入事务，含空格/IME 之后的整段替换只认这条路。
  //    全选后必须让出一个宏任务再发 paste：真实鼠标点击场景下，编辑器（ProseMirror）
  //    轮询 DOM 选区有约 20ms 的节流，同任务里全选+paste 会让粘贴落在旧的折叠光标上
  //    （变成追加）；等待后二次全选，覆盖期间被第三方处理器改掉的选区。
  selectAll()
  await sleep(60)
  selectAll()
  const dt = new DataTransfer()
  dt.setData('text/plain', text)
  el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  for (let i = 0; i < 6; i++) {
    if (written() === target) return true
    await sleep(100)
  }

  // 2) 兜底（不拦截合成 paste 的编辑器）：整段命令失败就逐字补写，每步都复核实际内容。
  selectAll()
  try {
    document.execCommand('insertText', false, text)
    if (written() === target) return true
    selectAll()
    for (const ch of text) document.execCommand('insertText', false, ch)
  } catch {
    return false
  }
  return written() === target
}
