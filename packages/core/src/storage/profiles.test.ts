import { describe, expect, it, vi } from 'vitest'
import {
  backupKey,
  EPHEMERAL_PREFIXES,
  isEphemeralKey,
  isMirroredKey,
  PUBLIC_PREFIXES,
  parseBackupKey,
  profileForKey,
} from './profiles.js'
import { StorageRouter } from './router.js'
import type { ObjectInfo, SignedPutUrl, Storage } from './types.js'

/**
 * The routing table decides which bucket an object lands in, and one of those buckets has a
 * public hostname. A mistake here publishes raw uploads, so these are written against the
 * consequence — "could a reader fetch this" — rather than against the implementation.
 */

/** A Storage that records what it was asked to do and nothing else. */
const fake = (name: string): Storage & { calls: string[] } => {
  const calls: string[] = []
  const note = <T>(op: string, key: string, result: T): T => {
    calls.push(`${op} ${key}`)
    return result
  }
  return {
    calls,
    driver: 's3',
    put: async (k) => note('put', k, undefined),
    get: async (k) => note('get', k, null),
    getSignedPutUrl: async (k) =>
      note('signPut', k, {
        url: `https://${name}/${k}`,
        method: 'PUT',
        headers: {},
        expiresAt: new Date(),
      } as SignedPutUrl),
    getSignedGetUrl: async (k) => note('signGet', k, `https://${name}/signed/${k}`),
    getUrl: (k) => `https://${name}/${k}`,
    delete: async (k) => note('delete', k, undefined),
    exists: async (k) => note('exists', k, false),
    head: async (k) => note('head', k, null as ObjectInfo | null),
    getRange: async (k) => note('range', k, null),
    list: async (p) => note('list', p, [] as string[]),
  }
}

const split = (onWrite?: (p: 'public' | 'private', k: string) => void) => {
  const pub = fake('public')
  const priv = fake('vault')
  const backup = fake('backup')
  return {
    pub,
    priv,
    backup,
    router: new StorageRouter({ public: pub, private: priv, backup }, onWrite),
  }
}

describe('storage key routing', () => {
  it('sends only reader-facing prefixes to the bucket with a hostname', () => {
    for (const prefix of PUBLIC_PREFIXES) {
      expect(profileForKey(`${prefix}whatever/x.avif`), prefix).toBe('public')
    }
  })

  /**
   * The one that matters. `uploads/` is the un-re-encoded original of every page of every
   * chapter, carrying whatever EXIF the source had, and it must never be addressable.
   */
  it('keeps raw uploads, sitemaps and the healthcheck private', () => {
    expect(profileForKey('uploads/12/34/0-abc.jpg')).toBe('private')
    expect(profileForKey('uploads/art/12/cover.png')).toBe('private')
    expect(profileForKey('sitemaps/sitemap-1.xml')).toBe('private')
    expect(profileForKey('_healthcheck/probe')).toBe('private')
  })

  /**
   * Regression: `brand/` holds the operator's uploaded logo and every page renders it, but it
   * is not an obvious "image" prefix and was missed on the first pass — the logo was routed
   * to the vault while the header still linked it on the image host.
   */
  it('publishes the brand assets the header links on every page', () => {
    expect(profileForKey('brand/logo_dark-9f2c1ab4de07.png')).toBe('public')
    expect(profileForKey('brand/monogram-9f2c1ab4de07.svg')).toBe('public')
    // ...but their *originals* still go to the vault, like every other upload.
    expect(profileForKey('uploads/brand/logo_dark-9f2c1ab4de07.png')).toBe('private')
  })

  /** Default-deny: a prefix nobody thought about is private, not published. */
  it('routes an unknown prefix to the private bucket', () => {
    expect(profileForKey('exports/2026/report.csv')).toBe('private')
    expect(profileForKey('anything-at-all')).toBe('private')
  })

  /**
   * `covers/` must not make `covers-backup/` public too. S3 prefixes are string matches, and
   * a public prefix that matches more than it names is how a private tree gets published.
   */
  it('does not let a public prefix capture a sibling that merely starts the same way', () => {
    expect(profileForKey('coversx/secret.jpg')).toBe('private')
    expect(profileForKey('pages-private/1.avif')).toBe('private')
    expect(profileForKey('uploads/covers/original.png')).toBe('private')
  })

  it('mirrors durable objects and skips the ones a job rebuilds', () => {
    expect(isMirroredKey('pages/1/2/a.avif')).toBe(true)
    expect(isMirroredKey('uploads/1/2/a.jpg')).toBe(true)
    for (const prefix of EPHEMERAL_PREFIXES) {
      expect(isEphemeralKey(`${prefix}x`), prefix).toBe(true)
      expect(isMirroredKey(`${prefix}x`), prefix).toBe(false)
    }
  })

  /** A mirrored copy has to say which bucket it came from, or a restore cannot put it back. */
  it('round-trips a backup key through its profile namespace', () => {
    for (const key of ['pages/1/2/a.avif', 'uploads/1/2/a.jpg']) {
      const profile = profileForKey(key)
      expect(parseBackupKey(backupKey(profile, key))).toEqual({ profile, key })
    }
    expect(parseBackupKey('nonsense')).toBeNull()
    expect(parseBackupKey('elsewhere/pages/x')).toBeNull()
    expect(parseBackupKey('public/')).toBeNull()
  })
})

describe('storage router', () => {
  it('reads and writes each key against its own bucket', async () => {
    const { pub, priv, router } = split()
    await router.put('pages/1/2/a.avif', new Uint8Array())
    await router.get('uploads/1/2/a.jpg')
    await router.head('covers/x/y.webp')
    await router.list('uploads/')
    expect(pub.calls).toEqual(['put pages/1/2/a.avif', 'head covers/x/y.webp'])
    expect(priv.calls).toEqual(['get uploads/1/2/a.jpg', 'list uploads/'])
  })

  /**
   * A private object has no public URL. Returning one anyway would render a broken image at
   * best and link somebody's raw upload at worst, so this throws where the mistake is made.
   */
  it('refuses to invent a public URL for a private key once the buckets are split', () => {
    const { router } = split()
    expect(router.getUrl('pages/1/2/a.avif')).toBe('https://public/pages/1/2/a.avif')
    expect(() => router.getUrl('uploads/1/2/a.jpg')).toThrow(/private bucket/)
  })

  /** Nothing changes for a deployment that has not separated the buckets yet. */
  it('is a pass-through in single-bucket mode, public URLs included', async () => {
    const only = fake('one')
    const router = new StorageRouter({ public: only })
    expect(router.separated).toBe(false)
    expect(router.getUrl('uploads/1/2/a.jpg')).toBe('https://one/uploads/1/2/a.jpg')
    await router.put('uploads/1/2/a.jpg', new Uint8Array())
    expect(only.calls).toEqual(['put uploads/1/2/a.jpg'])
  })

  it('announces a durable write for mirroring, and stays quiet for a rebuildable one', async () => {
    const onWrite = vi.fn()
    const { router } = split(onWrite)
    await router.put('pages/1/2/a.avif', new Uint8Array())
    await router.put('uploads/1/2/a.jpg', new Uint8Array())
    await router.put('sitemaps/sitemap-1.xml', '<xml/>')
    expect(onWrite.mock.calls).toEqual([
      ['public', 'pages/1/2/a.avif'],
      ['private', 'uploads/1/2/a.jpg'],
    ])
  })

  /** A mirror job for an object that never stored would retry against nothing. */
  it('does not announce a write that failed', async () => {
    const onWrite = vi.fn()
    const pub = fake('public')
    pub.put = async () => {
      throw new Error('bucket said no')
    }
    const router = new StorageRouter({ public: pub, backup: fake('backup') }, onWrite)
    await expect(router.put('pages/1/2/a.avif', new Uint8Array())).rejects.toThrow('bucket said no')
    expect(onWrite).not.toHaveBeenCalled()
  })

  /**
   * Surviving a delete is most of what the mirror is for: propagating one would make it
   * useless for the case it exists to cover.
   */
  it('leaves the mirrored copy alone when the primary object is deleted', async () => {
    const { priv, backup, router } = split()
    await router.delete('uploads/1/2/a.jpg')
    expect(priv.calls).toEqual(['delete uploads/1/2/a.jpg'])
    expect(backup.calls).toEqual([])
  })

  /** Erasure that must be total is a separate, explicit call. */
  it('purges the mirrored copy only when asked outright', async () => {
    const { backup, router } = split()
    await router.purgeFromBackup('uploads/1/2/a.jpg')
    expect(backup.calls).toEqual(['delete private/uploads/1/2/a.jpg'])
  })

  it('reports whether a mirror is configured at all', () => {
    expect(split().router.hasBackup).toBe(true)
    expect(new StorageRouter({ public: fake('one') }).hasBackup).toBe(false)
  })
})
