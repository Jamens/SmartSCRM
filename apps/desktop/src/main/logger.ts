import { app, ipcMain, shell } from 'electron'
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  formatLogLine,
  inferCategory,
  parseTag,
  type LogCategory,
  type LogEntry,
  type LogFilter,
  type LogLevel
} from '@shared/log'

/**
 * 主进程日志中心（A19）。
 *
 * 设计取舍：
 * - **不引第三方日志库**。这个应用主进程已经在用 `console.*` 打了满屏带 `[tag]` 前缀的日志，
 *   与其再让所有人改成 `logger.xxx`，不如在启动期把 `console` 接管掉——同样的调用，
 *   自动按 `[tag]` 归到四类之一并落盘。已有 50+ 处调用点一个都不用改。
 * - **内存环 + 批量落盘**。内存里留最近 5000 条供 UI 实时读；磁盘按天切文件、攒够一批再写，
 *   避免每条日志都来一次 fs  syscall 把主进程 IO 拖垮。
 * - **只落本地，不上报**。这是开源红线的硬要求：任何日志都不外传服务端（spec §1）。
 *
 * 递归防护：`emit` 不碰 `console`，所以接管后的 `console.*` 调 `emit` 不会回到自己身上。
 */

const RING_MAX = 5000
const FLUSH_INTERVAL_MS = 1500

let buffer: LogEntry[] = []
let nextId = 1
let pending: string[] = []
let flushTimer: NodeJS.Timeout | null = null
let installed = false

function logsDir(): string {
  return join(app.getPath('userData'), 'logs')
}

function currentLogFile(): string {
  const day = new Date().toISOString().slice(0, 10)
  return join(logsDir(), `scrm-${day}.log`)
}

function ensureDir(): void {
  const dir = logsDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function emit(category: LogCategory, level: LogLevel, message: string, meta?: unknown): void {
  const entry: LogEntry = { id: nextId++, ts: Date.now(), category, level, message, meta }
  buffer.push(entry)
  if (buffer.length > RING_MAX) buffer.splice(0, buffer.length - RING_MAX)
  pending.push(formatLogLine(entry))
}

/** 把攒着的行刷进当天日志文件（同步写，before-quit 时也要调用）。 */
export function flushLogs(): void {
  if (pending.length === 0) return
  try {
    ensureDir()
    appendFileSync(currentLogFile(), pending.join('\n') + '\n', 'utf-8')
  } catch {
    // 写不进磁盘只影响"事后排查"，内存环还在，不抛出。
  }
  pending = []
}

export function getLogs(filter: LogFilter = {}): LogEntry[] {
  const category = filter.category ?? 'all'
  const level = filter.level ?? 'all'
  const matched = buffer.filter((e) => {
    if (category !== 'all' && e.category !== category) return false
    if (level !== 'all' && e.level !== level) return false
    return true
  })
  const limit = filter.limit && filter.limit > 0 ? filter.limit : 500
  return matched.slice(-limit)
}

export function clearLogs(): void {
  buffer = []
  pending = []
  try {
    ensureDir()
    writeFileSync(currentLogFile(), '', 'utf-8')
  } catch {
    /* 清不掉也不影响内存环 */
  }
}

export function openLogsFolder(): void {
  try {
    ensureDir()
    void shell.openPath(logsDir())
  } catch {
    /* 打开文件夹失败不是致命错误 */
  }
}

/**
 * 接管 console：原调用照样打到 devtools，同时按 `[tag]` 归到四类之一并落盘。
 * 必须在 app.ready 之后装（要 `app.getPath('userData')` 算日志目录）。
 */
export function installConsoleCapture(): void {
  const wrap = (method: 'log' | 'info' | 'warn' | 'error' | 'debug'): void => {
    const original = console[method] as (...args: unknown[]) => void
    const level: LogLevel = method === 'warn' ? 'warn' : method === 'error' ? 'error' : 'info'
    // console 是只读结构，这里用一次性的类型放宽把它接管掉；原方法保留下来照常打到 devtools。
    ;(console as unknown as Record<string, (...args: unknown[]) => void>)[method] = (
      ...args: unknown[]
    ): void => {
      const tag = parseTag(args[0])
      emit(inferCategory(tag, level), level, args.map(String).join(' '))
      original.apply(console, args)
    }
  }
  wrap('log')
  wrap('info')
  wrap('warn')
  wrap('error')
  wrap('debug')
}

/** 进程级错误：未捕获异常与未处理 Promise 拒绝都归 error 类，给日志中心一个"真出事"的入口。 */
export function captureProcessErrors(): void {
  process.on('uncaughtException', (e) => {
    const msg = e instanceof Error ? e.stack ?? e.message : String(e)
    emit('error', 'error', `uncaughtException: ${msg}`)
  })
  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.stack ?? reason.message : String(reason)
    emit('error', 'error', `unhandledRejection: ${msg}`)
  })
}

/**
 * 包一层 ipcMain.handle：每个渲染↔主进程调用都记一条 debug 级 ipc 日志（含耗时与成败）。
 * 必须在 registerIpcHandlers 之前调用，这样所有 handler 都被包上。
 */
export function installIpcLogging(): void {
  const originalHandle = ipcMain.handle.bind(ipcMain)
  // 接管 ipcMain.handle：包一层记录每次调用的耗时与成败（debug 级，可按级别过滤掉）。
  // ipcMain.handle 不是可写属性，用一次性类型放宽赋值。
  ;(ipcMain as unknown as {
    handle: (channel: string, listener: (...args: unknown[]) => unknown) => void
  }).handle = (channel: string, listener: (...args: unknown[]) => unknown): void => {
    originalHandle(channel, async (event, ...args) => {
      const start = Date.now()
      try {
        const result = await listener(event, ...args)
        emit('ipc', 'debug', `ok ${channel} (${Date.now() - start}ms)`, { channel })
        return result
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        emit('ipc', 'error', `fail ${channel}: ${msg}`, { channel })
        throw e
      }
    })
  }
}

/** 启动期一次性装配：目录、console 接管、进程错误、IPC 记录、批量刷盘定时器。 */
export function installLogger(): void {
  if (installed) return
  installed = true
  ensureDir()
  installConsoleCapture()
  captureProcessErrors()
  if (flushTimer === null) {
    flushTimer = setInterval(() => flushLogs(), FLUSH_INTERVAL_MS)
    // 不阻止进程退出：定时器是 unref 的，进程没别的事时就该走。
    flushTimer.unref()
  }
  emit('app', 'info', `logger 装配完成；userData=${app.getPath('userData')}`)
}
