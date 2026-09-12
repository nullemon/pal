import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createStorageRouter } from './index.js'

/**
 * `createStorageRouter` decides, from the settings, whether the site is running on one bucket
 * or three. Getting that wrong is silent in the worst way: every read and write still works,
 * because one bucket serves them all perfectly well, and the only symptom is that the split
 * you configured is not happening. So this drives the real factory against real folders
 * rather than constructing the router by hand.
 */

let root: string
const roots = () => ({
  image: join(root, 'image'),
  vault: join(root, 'vault'),
  backup: join(root, 'backup'),
})

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'palscans-storage-'))
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

const split = () => {
  const r = roots()
  return createStorageRouter({
    driver: 'fs',
    fs: { root: r.image, publicUrl: 'https://palimages.test' },
    vault: { fs: { root: r.vault } },
    objectBackup: { fs: { root: r.backup } },
  })
}

describe('createStorageRouter', () => {
  it('puts each object in the bucket its key names', async () => {
    const router = await split()
    expect(router.separated).toBe(true)
    expect(router.hasBackup).toBe(true)

    await router.put('pages/1/a.avif', 'page bytes')
    await router.put('uploads/1/a.jpg', 'original bytes')

    // Read back through the router...
    expect(new TextDecoder().decode((await router.get('pages/1/a.avif')) ?? undefined)).toBe(
      'page bytes',
    )
    expect(new TextDecoder().decode((await router.get('uploads/1/a.jpg')) ?? undefined)).toBe(
      'original bytes',
    )
    // ...and confirm against each bucket directly, which is the part that would still pass if
    // both profiles were secretly the same folder.
    const image = router.target('public')
    const vault = router.target('private')
    expect(await image?.exists('pages/1/a.avif')).toBe(true)
    expect(await image?.exists('uploads/1/a.jpg')).toBe(false)
    expect(await vault?.exists('uploads/1/a.jpg')).toBe(true)
    expect(await vault?.exists('pages/1/a.avif')).toBe(false)
  })

  /** The vault has no hostname, so there is no URL to hand out and the router says so. */
  it('serves a public URL from the image bucket and refuses one for the vault', async () => {
    const router = await split()
    expect(router.getUrl('covers/x/y.webp')).toBe('https://palimages.test/covers/x/y.webp')
    expect(() => router.getUrl('uploads/1/a.jpg')).toThrow(/private bucket/)
  })

  /** A bucket left blank is not configured, and the site falls back to how it worked before. */
  it('runs as one bucket when no vault or mirror is named', async () => {
    const router = await createStorageRouter({
      driver: 'fs',
      fs: { root: roots().image, publicUrl: 'https://palimages.test' },
    })
    expect(router.separated).toBe(false)
    expect(router.hasBackup).toBe(false)
    expect(router.getUrl('uploads/1/a.jpg')).toBe('https://palimages.test/uploads/1/a.jpg')
    expect(router.target('public')).toBe(router.target('private'))
  })

  it('ignores a profile whose bucket is blank rather than half-configuring it', async () => {
    const router = await createStorageRouter({
      driver: 'fs',
      fs: { root: roots().image, publicUrl: 'https://palimages.test' },
      vault: { fs: {} },
      objectBackup: {},
    })
    expect(router.separated).toBe(false)
    expect(router.hasBackup).toBe(false)
  })
})
