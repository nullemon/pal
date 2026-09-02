import type { ObjectInfo, Storage } from '@palscans/core/storage'
import { describe, expect, it } from 'vitest'
import { naturalCompare, parseChapterNumber } from '../../components/admin/client/upload-lib'
import { bulkActionSchema, uploadIntentSchema } from '../../components/admin/schemas'
import { diffJson } from '../../components/admin/server/audit-log'
import {
  sniffImage,
  storageGetSignature,
  uploadSignature,
  verifyStorageGetSignature,
  verifyUploadedObject,
  verifyUploadSignature,
} from './upload'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0])

/** A store that answers HEAD and ranges only — the checks must never call `get`. */
const fakeStorage = (objects: Record<string, { info: ObjectInfo; head: Uint8Array }>): Storage =>
  ({
    driver: 'fs',
    head: async (key: string) => objects[key]?.info ?? null,
    getRange: async (key: string, start: number, end: number) =>
      objects[key]?.head.subarray(start, end + 1) ?? null,
    get: async () => {
      throw new Error('body must not be read')
    },
  }) as unknown as Storage

describe('upload signatures', () => {
  it('binds key, type, uploader, expiry and size; rejects expiry and tampering', () => {
    const exp = Date.now() + 60_000
    const sig = uploadSignature('uploads/1/2/0000-abc.jpg', 'image/jpeg', 7, exp, 1234)
    expect(sig).toMatch(/^[a-f0-9]{64}$/)
    expect(verifyUploadSignature(sig, 'uploads/1/2/0000-abc.jpg', 'image/jpeg', 7, exp, 1234)).toBe(
      true,
    )
    expect(verifyUploadSignature(sig, 'uploads/1/2/0000-abc.jpg', 'image/jpeg', 7, exp, 1235)).toBe(
      false,
    )
    expect(verifyUploadSignature(sig, 'uploads/1/2/0000-abc.jpg', 'image/png', 7, exp, 1234)).toBe(
      false,
    )
    expect(verifyUploadSignature(sig, 'uploads/1/2/0000-abc.jpg', 'image/jpeg', 8, exp, 1234)).toBe(
      false,
    )
    expect(
      verifyUploadSignature(sig, 'uploads/1/2/0000-abc.jpg', 'image/jpeg', 7, exp, 1234, exp + 1),
    ).toBe(false)
  })
  it('signs locked-page GETs for a limited time', () => {
    const exp = Date.now() + 600_000
    const sig = storageGetSignature('pages/1/2/0000-abc.720.webp', exp)
    expect(verifyStorageGetSignature(sig, 'pages/1/2/0000-abc.720.webp', exp)).toBe(true)
    expect(verifyStorageGetSignature(sig, 'pages/1/2/0001-abc.720.webp', exp)).toBe(false)
    expect(verifyStorageGetSignature(sig, 'pages/1/2/0000-abc.720.webp', exp + 1)).toBe(false)
    expect(verifyStorageGetSignature(sig, 'pages/1/2/0000-abc.720.webp', exp, exp + 1)).toBe(false)
  })
})

describe('verifyUploadedObject', () => {
  const types = new Set(['image/png', 'image/jpeg'])
  it('accepts an in-cap object whose stored type matches its magic bytes', async () => {
    const s = fakeStorage({
      'uploads/1/2/a.png': { info: { size: 100, contentType: 'image/png' }, head: PNG },
    })
    expect(await verifyUploadedObject(s, 'uploads/1/2/a.png', { maxBytes: 1000, types })).toEqual({
      ok: true,
      bytes: 100,
      type: 'image/png',
    })
  })
  it('refuses missing, oversized, disallowed and mislabelled objects without reading the body', async () => {
    const s = fakeStorage({
      big: { info: { size: 5000, contentType: 'image/png' }, head: PNG },
      gif: { info: { size: 10, contentType: 'image/gif' }, head: PNG },
      lie: { info: { size: 10, contentType: 'image/jpeg' }, head: PNG },
      text: {
        info: { size: 10, contentType: 'image/png' },
        head: new TextEncoder().encode('<svg onload=x>'),
      },
    })
    const opts = { maxBytes: 1000, types }
    expect(await verifyUploadedObject(s, 'nope', opts)).toEqual({ ok: false, code: 'missing' })
    expect(await verifyUploadedObject(s, 'big', opts)).toEqual({ ok: false, code: 'too_large' })
    expect(await verifyUploadedObject(s, 'gif', opts)).toEqual({
      ok: false,
      code: 'unsupported_type',
    })
    expect(await verifyUploadedObject(s, 'lie', opts)).toEqual({
      ok: false,
      code: 'unsupported_type',
    })
    expect(await verifyUploadedObject(s, 'text', opts)).toEqual({
      ok: false,
      code: 'unsupported_type',
    })
  })
})

describe('upload helpers', () => {
  it('sniffs magic bytes and rejects mismatches', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0])
    expect(sniffImage(png)).toBe('image/png')
    expect(sniffImage(jpg)).toBe('image/jpeg')
    expect(sniffImage(webp)).toBe('image/webp')
    expect(sniffImage(new Uint8Array(16))).toBeNull()
    expect(sniffImage(new Uint8Array(3))).toBeNull()
  })

  it('parses chapter numbers from folder and archive names (a suggestion, never silent)', () => {
    expect(parseChapterNumber('Ch. 154')).toBe(154)
    expect(parseChapterNumber('chapter-154')).toBe(154)
    expect(parseChapterNumber('154.5')).toBe(154.5)
    expect(parseChapterNumber('Solo Leveling c012.cbz')).toBe(12)
    expect(parseChapterNumber('Episode 7 - The Gate.zip')).toBe(7)
    expect(parseChapterNumber('cover')).toBeNull()
  })

  it('natural-sorts page names', () => {
    expect(['page10.jpg', 'page2.jpg', 'page1.jpg'].sort(naturalCompare)).toEqual([
      'page1.jpg',
      'page2.jpg',
      'page10.jpg',
    ])
  })

  it('validates the upload manifest and bulk actions', () => {
    const sha = 'a'.repeat(64)
    expect(
      uploadIntentSchema.safeParse({
        seriesId: 1,
        chapters: [
          { number: 12.5, files: [{ name: '01.jpg', bytes: 10, sha256: sha, type: 'image/jpeg' }] },
        ],
      }).success,
    ).toBe(true)
    expect(uploadIntentSchema.safeParse({ seriesId: 1, chapters: [] }).success).toBe(false)
    expect(
      bulkActionSchema.safeParse({
        action: 'schedule',
        ids: [1],
        publishedAt: '2030-01-01T00:00:00Z',
      }).success,
    ).toBe(true)
    expect(bulkActionSchema.safeParse({ action: 'schedule', ids: [1] }).success).toBe(false)
  })

  it('diffs audit snapshots by flattened path', () => {
    expect(diffJson({ a: 1, b: { c: 'x' } }, { a: 1, b: { c: 'y' }, d: true })).toEqual([
      { path: 'b.c', before: 'x', after: 'y' },
      { path: 'd', before: '', after: 'true' },
    ])
  })
})
