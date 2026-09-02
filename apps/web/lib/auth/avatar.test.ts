import type { PutOptions, Storage } from '@palscans/core/storage'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { AVATAR_MAX_BYTES, AVATAR_SIZE, avatarKeyFor, reencodeAvatar, storeAvatar } from './avatar'

const png = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#7c3aed' } })
    .png()
    .withExif({ IFD0: { Copyright: 'secret-metadata', ImageDescription: 'gps-here' } })
    .toBuffer()

describe('avatar re-encode', () => {
  it('produces a 256×256 WebP with the metadata gone', async () => {
    const out = await reencodeAvatar(new Uint8Array(await png(640, 200)))
    expect(out).not.toBeNull()
    const meta = await sharp(out as Buffer).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.width).toBe(AVATAR_SIZE)
    expect(meta.height).toBe(AVATAR_SIZE)
    expect(meta.exif).toBeUndefined()
    expect(Buffer.from(out as Buffer).includes('secret-metadata')).toBe(false)
  })
  it('refuses non-images, empty and oversized bodies', async () => {
    expect(await reencodeAvatar(new TextEncoder().encode('<svg onload=alert(1)/>'))).toBeNull()
    expect(await reencodeAvatar(new Uint8Array(0))).toBeNull()
    expect(await reencodeAvatar(new Uint8Array(AVATAR_MAX_BYTES + 1))).toBeNull()
  })
  it('names the stored object by its content and writes only WebP', async () => {
    const puts: Array<{ key: string; opts?: PutOptions; bytes: number }> = []
    const storage = {
      put: async (key: string, body: Uint8Array | string, opts?: PutOptions) => {
        puts.push({ key, opts, bytes: typeof body === 'string' ? body.length : body.byteLength })
      },
    } as unknown as Storage
    const key = await storeAvatar(storage, 42, new Uint8Array(await png(64, 64)))
    expect(key).toMatch(/^avatars\/42\/[a-f0-9]{12}\.webp$/)
    expect(puts).toHaveLength(1)
    expect(puts[0]?.key).toBe(key)
    expect(puts[0]?.opts?.contentType).toBe('image/webp')
    expect(avatarKeyFor(42, new Uint8Array([1, 2, 3]))).toBe(
      avatarKeyFor(42, new Uint8Array([1, 2, 3])),
    )
    expect(avatarKeyFor(42, new Uint8Array([1, 2, 3]))).not.toBe(
      avatarKeyFor(42, new Uint8Array([1, 2, 4])),
    )
    expect(await storeAvatar(storage, 42, new Uint8Array([0, 1, 2, 3]))).toBeNull()
    expect(puts).toHaveLength(1)
  })
})
