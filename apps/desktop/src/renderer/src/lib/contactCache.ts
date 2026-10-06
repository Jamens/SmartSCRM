import type { CustomerVO, PageResult } from '@/api/customers'

/**
 * 联系人（客户）本地缓存层。
 *
 * 落盘到 IndexedDB（库 `scrm-cache`），断电/刷新后仍在；网络不可用时回退到本地缓存，
 * 让联系人列表与详情「断网也能看、刷新秒开」。未配置外部依赖（不引入 Dexie），
 * 直接用原生 IndexedDB 包一层 Promise——本沙箱装依赖不稳，零依赖更可靠，且功能等价。
 *
 * 所有读取/写入都包了 try/catch 降级：缓存层任何异常都不能拖垮业务请求，
 * 最坏情况只是「这一回没用上缓存」，而不是白屏或报错。
 */

const DB_NAME = 'scrm-cache'
const DB_VERSION = 1
const STORE_CUSTOMERS = 'customers'
const STORE_PAGES = 'pages'
const STORE_META = 'meta'

/** 开关走 localStorage（同步读，hooks 里不异步门控）；值为 'false' 才视为关。 */
const ENABLED_KEY = 'scrm-contact-cache-enabled'

export interface ContactCacheMeta {
  /** customers 表里已缓存的联系人条数。 */
  count: number
  /** 最近一次成功写缓存的时间戳（ms），从未写过错 null。 */
  lastSync: number | null
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      // 极老环境没有 indexedDB：直接 reject，上层 catch 降级为「不用缓存」。
      reject(new Error('indexedDB unavailable'))
      return
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_CUSTOMERS)) {
        db.createObjectStore(STORE_CUSTOMERS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_PAGES)) {
        db.createObjectStore(STORE_PAGES, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('open db failed'))
  })
  return dbPromise
}

function store(db: IDBDatabase, name: string, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(name, mode).objectStore(name)
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('tx failed'))
    tx.onabort = () => reject(tx.error ?? new Error('tx aborted'))
  })
}

/** 同步判断缓存是否启用（hooks 直接用，不异步）。默认启用。 */
export function isContactCacheEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== 'false'
  } catch {
    return true
  }
}

export function setContactCacheEnabled(value: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, value ? 'true' : 'false')
  } catch {
    /* localStorage 不可用时静默忽略，等价于「不设开关」 */
  }
}

/** 把列表结果连同每条联系人一起写入缓存；随后刷新 lastSync。 */
export async function putPage(key: string, page: PageResult<CustomerVO>): Promise<void> {
  try {
    const db = await openDb()
    const tx = db.transaction([STORE_PAGES, STORE_CUSTOMERS], 'readwrite')
    tx.objectStore(STORE_PAGES).put({ key, ...page })
    const customerStore = tx.objectStore(STORE_CUSTOMERS)
    for (const c of page.records) customerStore.put(c)
    await txDone(tx)
    await touchSync()
  } catch {
    /* 写缓存失败不抛，业务继续走网络数据 */
  }
}

export async function getCachedPage(key: string): Promise<PageResult<CustomerVO> | null> {
  try {
    const db = await openDb()
    return await new Promise<PageResult<CustomerVO> | null>((resolve, reject) => {
      const req = store(db, STORE_PAGES, 'readonly').get(key)
      req.onsuccess = () => resolve((req.result as PageResult<CustomerVO>) ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

export async function putCustomer(vo: CustomerVO): Promise<void> {
  try {
    const db = await openDb()
    const tx = db.transaction(STORE_CUSTOMERS, 'readwrite')
    tx.objectStore(STORE_CUSTOMERS).put(vo)
    await txDone(tx)
  } catch {
    /* 忽略 */
  }
}

export async function getCachedCustomer(id: number): Promise<CustomerVO | null> {
  try {
    const db = await openDb()
    return await new Promise<CustomerVO | null>((resolve, reject) => {
      const req = store(db, STORE_CUSTOMERS, 'readonly').get(id)
      req.onsuccess = () => resolve((req.result as CustomerVO) ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

/** 清空联系人缓存（列表页 + 详情 + lastSync 置空）。开关关闭时调用。 */
export async function clearContactCache(): Promise<void> {
  try {
    const db = await openDb()
    const tx = db.transaction([STORE_PAGES, STORE_CUSTOMERS, STORE_META], 'readwrite')
    tx.objectStore(STORE_PAGES).clear()
    tx.objectStore(STORE_CUSTOMERS).clear()
    tx.objectStore(STORE_META).put({ key: 'lastSync', value: null })
    await txDone(tx)
  } catch {
    /* 忽略 */
  }
}

export async function getCacheMeta(): Promise<ContactCacheMeta> {
  try {
    const db = await openDb()
    const count = await new Promise<number>((resolve, reject) => {
      const req = store(db, STORE_CUSTOMERS, 'readonly').count()
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const lastSync = await new Promise<number | null>((resolve, reject) => {
      const req = store(db, STORE_META, 'readonly').get('lastSync')
      req.onsuccess = () =>
        resolve(req.result ? ((req.result as { value: number | null }).value ?? null) : null)
      req.onerror = () => reject(req.error)
    })
    return { count, lastSync }
  } catch {
    return { count: 0, lastSync: null }
  }
}

async function touchSync(): Promise<void> {
  try {
    const db = await openDb()
    const tx = db.transaction(STORE_META, 'readwrite')
    tx.objectStore(STORE_META).put({ key: 'lastSync', value: Date.now() })
    await txDone(tx)
  } catch {
    /* 忽略 */
  }
}
