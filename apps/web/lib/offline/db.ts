import type { OfflineChapter, OfflineChapterSummary } from './types'

/**
 * The manifest half of offline downloads (docs/06 "Progress and offline": pages go in the
 * Cache API, the manifest in IndexedDB).
 *
 * Hand-rolled rather than a wrapper library: one object store, five operations, and the
 * reader island is on the critical path for LCP — an IndexedDB helper is a dependency the
 * page would pay for on every load, downloads or not.
 */
export const DB_NAME = 'palscans-offline'
export const DB_VERSION = 1
export const STORE = 'downloads'

/** True when this browser can hold downloads at all (Safari private mode cannot). */
export const offlineSupported = (): boolean =>
  typeof indexedDB !== 'undefined' && typeof caches !== 'undefined'

const open = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'chapterId' })
        // The downloads screen groups by series and sorts by recency.
        store.createIndex('seriesId', 'seriesId', { unique: false })
        store.createIndex('downloadedAt', 'downloadedAt', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('indexeddb open failed'))
  })

const run = async <T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('indexeddb request failed'))
      tx.onabort = () => reject(tx.error ?? new Error('indexeddb transaction aborted'))
    })
  } finally {
    db.close()
  }
}

export const putChapter = (row: OfflineChapter): Promise<IDBValidKey> =>
  run('readwrite', (s) => s.put(row))

export const getChapter = (chapterId: number): Promise<OfflineChapter | undefined> =>
  run('readonly', (s) => s.get(chapterId) as IDBRequest<OfflineChapter | undefined>)

export const deleteChapter = (chapterId: number): Promise<undefined> =>
  run('readwrite', (s) => s.delete(chapterId) as IDBRequest<undefined>)

/** Newest first. Drops `data` and `urls` so a long list stays cheap to hold in memory. */
export const listChapters = async (): Promise<OfflineChapterSummary[]> => {
  const all = await run('readonly', (s) => s.getAll() as IDBRequest<OfflineChapter[]>)
  return all
    .map(({ data: _data, urls: _urls, ...rest }) => rest)
    .sort((a, b) => b.downloadedAt - a.downloadedAt)
}

export const allChapters = (): Promise<OfflineChapter[]> =>
  run('readonly', (s) => s.getAll() as IDBRequest<OfflineChapter[]>)

export const clearChapters = (): Promise<undefined> =>
  run('readwrite', (s) => s.clear() as IDBRequest<undefined>)
