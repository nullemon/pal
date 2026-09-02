import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createStorage, FsStorage, findRepoRoot } from '../storage/index.js'
import { assertSafeKey, contentTypeFor, joinUrl } from '../storage/types.js'

let root: string
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'palscans-storage-'))
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('FsStorage', () => {
  it('round-trips put / exists / get / delete', async () => {
    const s = new FsStorage({ root, publicUrl: 'http://localhost:3000/_storage' })
    expect(s.driver).toBe('fs')
    expect(await s.exists('covers/a b.svg')).toBe(false)
    await s.put('covers/a b.svg', '<svg/>', { contentType: 'image/svg+xml' })
    expect(await s.exists('covers/a b.svg')).toBe(true)
    expect(new TextDecoder().decode((await s.get('covers/a b.svg')) as Uint8Array)).toBe('<svg/>')
    expect(s.getUrl('covers/a b.svg')).toBe('http://localhost:3000/_storage/covers/a%20b.svg')
    const signed = await s.getSignedPutUrl('pages/x/0.avif', { contentType: 'image/avif' })
    expect(signed.method).toBe('PUT')
    expect(signed.url).toBe('http://localhost:3000/_storage/pages/x/0.avif')
    expect(signed.headers['content-type']).toBe('image/avif')
    expect(await s.head('covers/a b.svg')).toEqual({ size: 6, contentType: 'image/svg+xml' })
    expect(await s.head('covers/missing.svg')).toBeNull()
    expect(new TextDecoder().decode((await s.getRange('covers/a b.svg', 0, 3)) as Uint8Array)).toBe(
      '<svg',
    )
    expect(await s.getRange('covers/missing.svg', 0, 15)).toBeNull()
    expect(await s.getSignedGetUrl('covers/a b.svg')).toBe(s.getUrl('covers/a b.svg'))
    await s.put('covers/sub/b.svg', '<svg/>')
    await s.put('coversx/c.svg', '<svg/>')
    expect(await s.list('covers/')).toEqual(['covers/a b.svg', 'covers/sub/b.svg'])
    expect(await s.list('covers/a')).toEqual(['covers/a b.svg'])
    expect(await s.list('nothing/')).toEqual([])
    await s.delete('covers/sub/b.svg')
    await s.delete('coversx/c.svg')
    await s.delete('covers/a b.svg')
    expect(await s.exists('covers/a b.svg')).toBe(false)
    expect(await s.get('covers/a b.svg')).toBeNull()
    await s.delete('covers/missing.svg') // no throw
  })
  it('rejects unsafe keys', () => {
    expect(() => assertSafeKey('../etc/passwd')).toThrow()
    expect(() => assertSafeKey('/abs')).toThrow()
    expect(() => assertSafeKey('a//b')).toThrow()
    expect(() => assertSafeKey('')).toThrow()
    expect(assertSafeKey('ok/fine.avif')).toBe('ok/fine.avif')
    expect(contentTypeFor('x.AVIF')).toBe('image/avif')
    expect(joinUrl('https://cdn/', 'a/b')).toBe('https://cdn/a/b')
  })
  it('createStorage picks fs by default and resolves relative roots to the repo', async () => {
    const prev = process.env.STORAGE_DRIVER
    delete process.env.STORAGE_DRIVER
    const s = (await createStorage({ fs: { root: '.data/test-storage' } })) as FsStorage
    expect(s.driver).toBe('fs')
    expect(s.root).toBe(path.join(findRepoRoot(), '.data/test-storage'))
    if (prev !== undefined) process.env.STORAGE_DRIVER = prev
  })
})
