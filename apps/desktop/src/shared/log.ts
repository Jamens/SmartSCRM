/**
 * 主进程日志的共享类型与纯规则。主进程与渲染层共用，本身不碰 electron（要单测）。
 *
 * 四类：app（生命周期/设置/任务栏等宿主能力）、ipc（渲染↔主进程调用）、
 * bridge（内嵌页桥接：msgBridge/inject/batch/group）、error（错误与未处理拒绝）。
 * 落盘与界面都按这四类切，所以类别判定是稳定契约，挪一处两头都要跟着改。
 */

export type LogCategory = 'app' | 'ipc' | 'bridge' | 'error'
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export const LOG_CATEGORIES: LogCategory[] = ['app', 'ipc', 'bridge', 'error']

export interface LogEntry {
  /** 单调递增 id，渲染层用它做 React key，也方便"只看比某条新的"。 */
  id: number
  /** epoch 毫秒。 */
  ts: number
  category: LogCategory
  level: LogLevel
  message: string
  /** 可选结构化上下文；落盘时序列化成字符串附在行尾。 */
  meta?: unknown
}

export interface LogFilter {
  category?: LogCategory | 'all'
  level?: LogLevel | 'all'
  /** 最多返回多少条（取最新的）。默认 500。 */
  limit?: number
}

/** 从 console 的 `[tag]` 前缀推断类别；level 由调用方法决定。level 为 error 时一律归 error 类。 */
export function inferCategory(tag: string | null, level: LogLevel): LogCategory {
  if (level === 'error') return 'error'
  if (tag) {
    const t = tag.toLowerCase()
    if (t.includes('ipc')) return 'ipc'
    if (
      t.includes('batch') ||
      t.includes('msgbridge') ||
      t.includes('inject') ||
      t.includes('group') ||
      t.includes('bridge')
    ) {
      return 'bridge'
    }
  }
  return 'app'
}

/** 解析 console 首个参数里的 `[tag]`（形如 `[msgBridge] ...`）。没有则返回 null。 */
export function parseTag(firstArg: unknown): string | null {
  if (typeof firstArg !== 'string') return null
  const m = firstArg.match(/^\[([^\]]+)\]/)
  return m ? m[1] : null
}

/** 单行落盘格式：`<iso> [LEVEL] [CATEGORY] message[ :: meta]`。meta 只在不含对象时附上，避免把大对象刷进日志。 */
export function formatLogLine(e: LogEntry): string {
  const iso = new Date(e.ts).toISOString()
  const meta = e.meta !== undefined ? ` :: ${safeStringify(e.meta)}` : ''
  return `${iso} [${e.level.toUpperCase()}] [${e.category}] ${e.message}${meta}`
}

function safeStringify(v: unknown): string {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}
