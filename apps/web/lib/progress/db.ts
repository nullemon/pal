import type { LocalProgress } from './types'

/**
 * The roomy half of local progress: one IndexedDB object store of reading positions.
 *
 * Same shape as `lib/offline/db.ts` and for the same reasons — one store, a handful of
 * operations, opened per call and closed again, no wrapper library on the reader's
 * critical path. Every operation resolves rather than rejects when storage is refused
 * (private browsing, a blocked upgrade, a disabled origin), because a reader whose browser
 * will not remember their place should still be able to read.
 */
export const DB_NAME = 'palscans-progress'
export const DB_VERSION = 1
export const STORE = 'positions'

/** True when this browser can hold positions past the 60 the journal keeps. */
export const progressDbSupported = (): boolean => typeof indexedDB !== 'undefined'

const open = (): Promise<IDBDatabase | null> =>
  new Promise((resolve) => {
    if (!progressDbSupported()) return resolve(null)
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      return resolve(null)
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'chapterId' })
        // "Continue reading" groups by series; history and pruning read by recency.
        store.createIndex('seriesId', 'seriesId', { unique: false })
        store.createIndex('updatedAt', 'updatedAt', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
    // Another tab holding an old version open: give up rather than hang the reader.
    req.onblocked = () => resolve(null)
  })

/**
 * One request in one transaction, resolving to `fallback` on any refusal. `IDBRequest<T>`
 * is invariant in `T` (its handlers are typed by `this`), so the callback is typed loosely
 * and the result is asserted here rather than at every call site.
 */
const run = async <T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest,
  fallback: T,
): Promise<T> => {
  const db = await open()
  if (!db) return fallback
  try {
    return await new Promise<T>((resolve) => {
      let req: IDBRequest
      try {
        req = fn(db.transaction(STORE, mode).objectStore(STORE))
      } catch {
        return resolve(fallback)
      }
      req.onsuccess = () => resolve(req.result as T)
      req.onerror = () => resolve(fallback)
      req.transaction?.addEventListener('abort', () => resolve(fallback))
    })
  } finally {
    db.close()
  }
}

export const putPosition = async (row: LocalProgress): Promise<boolean> => {
  const key = await run<IDBValidKey | undefined>('readwrite', (s) => s.put(row), undefined)
  return key !== undefined
}

/** Write several positions in one transaction — the journal catching IndexedDB up. */
export const putPositions = async (rows: readonly LocalProgress[]): Promise<boolean> => {
  if (rows.length === 0) return true
  const db = await open()
  if (!db) return false
  try {
    return await new Promise<boolean>((resolve) => {
      let tx: IDBTransaction
      try {
        tx = db.transaction(STORE, 'readwrite')
      } catch {
        return resolve(false)
      }
      const store = tx.objectStore(STORE)
      for (const row of rows) store.put(row)
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => resolve(false)
      tx.onabort = () => resolve(false)
    })
  } finally {
    db.close()
  }
}

export const getPosition = (chapterId: number): Promise<LocalProgress | null> =>
  run<LocalProgress | undefined>('readonly', (s) => s.get(chapterId), undefined).then(
    (row) => row ?? null,
  )

/** Every stored position, newest first. */
export const allPositions = async (): Promise<LocalProgress[]> => {
  const rows = await run<LocalProgress[]>('readonly', (s) => s.getAll(), [])
  return rows.sort((a, b) => b.updatedAt - a.updatedAt)
}

export const clearPositions = (): Promise<void> =>
  run<void>('readwrite', (s) => s.clear(), undefined)

/** Drop the oldest rows past `keep`, so a heavy reader's store cannot grow without end. */
export const prunePositions = async (keep: number): Promise<void> => {
  const rows = await allPositions()
  if (rows.length <= keep) return
  const db = await open()
  if (!db) return
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    for (const row of rows.slice(keep)) store.delete(row.chapterId)
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    })
  } catch {
    // storage refused mid-prune: the cap is best-effort, never a reason to fail a read
  } finally {
    db.close()
  }
}
