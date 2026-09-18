import { app, safeStorage } from 'electron'
import { machineIdSync } from 'node-machine-id'
import { createHash } from 'crypto'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'

export interface StoredSession {
  accessToken: string
  refreshToken: string
  user: unknown
}

let cachedDeviceId: string | null = null

export function getDeviceId(): string {
  if (cachedDeviceId) return cachedDeviceId
  try {
    cachedDeviceId = machineIdSync(true)
  } catch {
    cachedDeviceId = createHash('sha256')
      .update(`${app.getPath('home')}|${app.getName()}`)
      .digest('hex')
      .slice(0, 32)
  }
  return cachedDeviceId
}

const sessionFile = (): string => join(app.getPath('userData'), 'scrm-session.bin')

export function saveSession(session: StoredSession): void {
  const json = JSON.stringify(session)
  const buffer = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(json)
    : Buffer.from(json, 'utf-8')
  writeFileSync(sessionFile(), buffer)
}

export function getSession(): StoredSession | null {
  const file = sessionFile()
  if (!existsSync(file)) return null
  try {
    const raw = readFileSync(file)
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(raw)
      : raw.toString('utf-8')
    return JSON.parse(json) as StoredSession
  } catch {
    return null
  }
}

export function clearSession(): void {
  const file = sessionFile()
  if (existsSync(file)) rmSync(file)
}
