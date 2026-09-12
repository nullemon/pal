import { describe, expect, it } from 'vitest'
import { mirrorOne, reconcileMirror, restoreFromBackup } from './mirror.js'
import { backupKey } from './profiles.js'
import { StorageRouter } from './router.js'
import type { ObjectInfo, SignedPutUrl, Storage } from './types.js'

/**
 * A backup is only worth having if you find out it is broken *before* you need it, so these
 * are written against the ways a mirror silently does nothing: it never runs for the objects
 * the browser uploads directly, it writes a truncated copy, or it reports success for an
 * object that was not there.
 */

/** A real bucket, in memory, so a round trip is an actual round trip. */
const memory = (): Storage & { data: Map<string, Uint8Array> } => {
  const data = new Map<string, Uint8Array>()
  const bytes = (b: Uint8Array | string) =>
    typeof b === 'string' ? new TextEncoder().encode(b) : b
  return {
    data,
    driver: 's3',
    put: async (k, b) => {
      data.set(k, bytes(b))
    },
    get: async (k) => data.get(k) ?? null,
    head: async (k): Promise<ObjectInfo | null> => {
      const v = data.get(k)
      return v ? { size: v.byteLength, contentType: null } : null
    },
    exists: async (k) => data.has(k),
    delete: async (k) => {
      data.delete(k)
    },
    list: async (prefix) => [...data.keys()].filter((k) => k.startsWith(prefix)).sort(),
    getRange: async () => null,
    getUrl: (k) => `https://public/${k}`,
    getSignedPutUrl: async (): Promise<SignedPutUrl> => ({
      url: '',
      method: 'PUT',
      headers: {},
      expiresAt: new Date(),
    }),
    getSignedGetUrl: async () => '',
  }
}

const rig = () => {
  const pub = memory()
  const priv = memory()
  const backup = memory()
  return { pub, priv, backup, router: new StorageRouter({ public: pub, private: priv, backup }) }
}

const body = (n: number) => new Uint8Array(n).fill(7)

describe('mirrorOne', () => {
  it('copies an object into the mirror under its source profile', async () => {
    const { pub, backup, router } = rig()
    await pub.put('pages/1/2/a.avif', body(64))
    expect(await mirrorOne(router, 'public', 'pages/1/2/a.avif')).toEqual({
      copied: true,
      bytes: 64,
    })
    expect(backup.data.get('public/pages/1/2/a.avif')).toEqual(body(64))
  })

  /**
   * The whole point of verifying. A bucket that accepts a write and stores something shorter
   * looks identical to a working one until a restore, so the job refuses to call it done.
   */
  it('throws when the stored copy is not the size that was written', async () => {
    const { pub, backup, router } = rig()
    await pub.put('pages/1/2/a.avif', body(64))
    backup.put = async (k) => {
      backup.data.set(k, body(9))
    }
    await expect(mirrorOne(router, 'public', 'pages/1/2/a.avif')).rejects.toThrow(
      /verified wrong: wrote 64 bytes, found 9/,
    )
  })

  it('throws rather than reporting success when the copy did not store at all', async () => {
    const { pub, backup, router } = rig()
    await pub.put('pages/1/2/a.avif', body(64))
    backup.put = async () => {}
    await expect(mirrorOne(router, 'public', 'pages/1/2/a.avif')).rejects.toThrow(/found nothing/)
  })

  /** Listed, then deleted before the job ran. Retrying will not bring it back. */
  it('treats an object that vanished before the job ran as done, not failed', async () => {
    const { router } = rig()
    expect(await mirrorOne(router, 'public', 'pages/gone.avif')).toEqual({
      copied: false,
      bytes: 0,
    })
  })

  it('does not mirror objects a job rebuilds', async () => {
    const { priv, backup, router } = rig()
    await priv.put('sitemaps/sitemap-1.xml', '<xml/>')
    expect(await mirrorOne(router, 'private', 'sitemaps/sitemap-1.xml')).toEqual({
      copied: false,
      bytes: 0,
    })
    expect(backup.data.size).toBe(0)
  })

  it('refuses to pretend when no mirror is configured', async () => {
    const router = new StorageRouter({ public: memory() })
    await expect(mirrorOne(router, 'public', 'pages/a.avif')).rejects.toThrow(/No image backup/)
  })
})

describe('reconcileMirror', () => {
  /**
   * The case the write-time hook cannot cover: the admin panel uploads originals from the
   * *browser* to a presigned URL, so nothing in this process ever calls `put` for them. If
   * the sweep missed `uploads/`, the one copy of every original would be unprotected and
   * nothing would say so.
   */
  it('finds raw originals that were uploaded straight to the bucket', async () => {
    const { priv, router } = rig()
    await priv.put('uploads/1/2/0-abc.jpg', body(32))
    await priv.put('uploads/1/2/1-def.jpg', body(32))
    const seen: string[] = []
    const report = await reconcileMirror(router, { enqueue: (p, k) => seen.push(`${p}:${k}`) })
    expect(seen).toEqual(['private:uploads/1/2/0-abc.jpg', 'private:uploads/1/2/1-def.jpg'])
    expect(report).toMatchObject({ total: 2, mirrored: 0, enqueued: 2, truncated: false })
  })

  it('leaves alone what the mirror already holds', async () => {
    const { pub, backup, router } = rig()
    await pub.put('pages/1/a.avif', body(10))
    await pub.put('pages/1/b.avif', body(10))
    await backup.put(backupKey('public', 'pages/1/a.avif'), body(10))
    const seen: string[] = []
    const report = await reconcileMirror(router, { enqueue: (p, k) => seen.push(`${p}:${k}`) })
    expect(seen).toEqual(['public:pages/1/b.avif'])
    expect(report).toMatchObject({ total: 2, mirrored: 1, enqueued: 1 })
  })

  /**
   * The first sweep of an existing site has everything to do. Enqueuing all of it would
   * starve the jobs readers are waiting on, so it stops — and says that it stopped, because a
   * bounded sweep that reported "done" would look like a finished backup.
   */
  it('stops at the limit and reports that there is more to do', async () => {
    const { pub, router } = rig()
    for (let i = 0; i < 5; i += 1) await pub.put(`pages/1/${i}.avif`, body(4))
    const seen: string[] = []
    const report = await reconcileMirror(router, {
      limit: 2,
      enqueue: (p, k) => seen.push(`${p}:${k}`),
    })
    expect(seen).toHaveLength(2)
    expect(report).toMatchObject({ total: 5, mirrored: 0, enqueued: 2, truncated: true })
  })

  it('counts nothing and enqueues nothing for a rebuildable tree', async () => {
    const { priv, router } = rig()
    await priv.put('sitemaps/sitemap-1.xml', '<xml/>')
    await priv.put('_healthcheck/probe', 'x')
    const report = await reconcileMirror(router, { enqueue: () => {} })
    expect(report).toMatchObject({ total: 0, enqueued: 0 })
  })
})

describe('restoreFromBackup', () => {
  it('puts back an object that is gone', async () => {
    const { pub, backup, router } = rig()
    await backup.put(backupKey('public', 'pages/1/a.avif'), body(20))
    expect(await restoreFromBackup(router, 'pages/1/a.avif')).toEqual({
      restored: true,
      reason: 'missing',
    })
    expect(pub.data.get('pages/1/a.avif')).toEqual(body(20))
  })

  it('puts back an object whose bytes no longer match the copy', async () => {
    const { pub, backup, router } = rig()
    await pub.put('pages/1/a.avif', body(3))
    await backup.put(backupKey('public', 'pages/1/a.avif'), body(20))
    expect(await restoreFromBackup(router, 'pages/1/a.avif')).toMatchObject({
      restored: true,
      reason: 'size-mismatch',
    })
    expect(pub.data.get('pages/1/a.avif')).toEqual(body(20))
  })

  /** A restore that overwrote a healthy object every time it ran would be its own outage. */
  it('leaves an intact object alone unless forced', async () => {
    const { backup, pub, router } = rig()
    await pub.put('pages/1/a.avif', body(20))
    await backup.put(backupKey('public', 'pages/1/a.avif'), body(20))
    expect(await restoreFromBackup(router, 'pages/1/a.avif')).toEqual({
      restored: false,
      reason: 'intact',
    })
    expect(await restoreFromBackup(router, 'pages/1/a.avif', { force: true })).toEqual({
      restored: true,
      reason: 'forced',
    })
  })

  it('restores a private original into the vault, not the public bucket', async () => {
    const { pub, priv, backup, router } = rig()
    await backup.put(backupKey('private', 'uploads/1/2/a.jpg'), body(11))
    await restoreFromBackup(router, 'uploads/1/2/a.jpg')
    expect(priv.data.get('uploads/1/2/a.jpg')).toEqual(body(11))
    expect(pub.data.size).toBe(0)
  })

  it('says so when there is no copy to restore from', async () => {
    const { router } = rig()
    await expect(restoreFromBackup(router, 'pages/1/a.avif')).rejects.toThrow(/No mirrored copy/)
  })
})
