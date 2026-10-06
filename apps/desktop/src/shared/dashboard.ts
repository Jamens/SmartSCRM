/**
 * B11 仪表盘导出——把「总览 + 逐日趋势 + 按账号下钻」拼成一份 CSV（纯函数，可单测）。
 *
 * 前端生成（与 A11 FAQ 模板同一手法）：下载接口要带 Bearer 头，裸 <a href> 带不了，
 * 不必为此给 http 客户端加"取原始文本"。CSV 在客户端拼，Blob 下载，不落应用目录。
 * 开头的 BOM 让 Excel 打开中文不乱码。
 */

export interface CsvOverview {
  accountsOnline: number
  accountsTotal: number
  customersTotal: number
  conversationsTotal: number
  tasksRunning: number
  tasksTotal: number
  messageIn: number
  messageOut: number
  messageTotal: number
  activeConversations: number
  perDay: { day: string; inCount: number; outCount: number }[]
}
export interface CsvAccount {
  accountId: number
  accountName: string
  online: boolean
  messageIn: number
  messageOut: number
  activeConversations: number
}

const cell = (v: string | number | boolean | null | undefined): string => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

export function dashboardCsv(o: CsvOverview, accounts: CsvAccount[]): string {
  const lines: string[] = []
  lines.push('指标,值')
  lines.push(['账号在线', o.accountsOnline].join(','))
  lines.push(['账号总数', o.accountsTotal].join(','))
  lines.push(['客户总数', o.customersTotal].join(','))
  lines.push(['会话总数', o.conversationsTotal].join(','))
  lines.push(['群发任务运行中', o.tasksRunning].join(','))
  lines.push(['群发任务总数', o.tasksTotal].join(','))
  lines.push(['消息收', o.messageIn].join(','))
  lines.push(['消息发', o.messageOut].join(','))
  lines.push(['消息合计', o.messageTotal].join(','))
  lines.push(['活跃会话', o.activeConversations].join(','))
  lines.push('')
  lines.push('日期,收,发')
  for (const d of o.perDay) lines.push([d.day, d.inCount, d.outCount].join(','))
  lines.push('')
  lines.push('账号ID,账号名,在线,收,发,活跃会话')
  for (const a of accounts) {
    // 每个字段只过一次 cell()——内层再 cell 一次会双重转义（`a,b"c` → 引号翻倍）。
    lines.push([a.accountId, a.accountName, a.online ? '是' : '否',
      a.messageIn, a.messageOut, a.activeConversations].map((x) => cell(x as string | number)).join(','))
  }
  return '﻿' + lines.join('\r\n') + '\r\n'
}
