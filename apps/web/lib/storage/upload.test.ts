import { describe, expect, it } from 'vitest'
import { naturalCompare, parseChapterNumber } from '../../components/admin/client/upload-lib'
import { bulkActionSchema, uploadIntentSchema } from '../../components/admin/schemas'
import { diffJson } from '../../components/admin/server/audit-log'
import { sniffImage } from './upload'

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
