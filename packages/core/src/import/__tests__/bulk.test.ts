import { describe, expect, it } from 'vitest'
import {
  classifyPageName,
  createZipGuard,
  detectChapterNumber,
  naturalCompare,
  planDrop,
  sanitizeEntryPath,
  ZIP_LIMITS,
} from '../bulk.js'

/**
 * The bulk drop is a *proposal*, so what these tests protect is the honesty of the
 * proposal: page order that matches what a reader expects, chapter numbers that are either
 * right or visibly absent, and an archive that cannot make the browser do something it
 * should not (a bomb, a path escape, a file that is not an image).
 */

const entries = (...paths: string[]) => paths.map((path) => ({ path, bytes: 1000 }))
const numbers = (plan: ReturnType<typeof planDrop>) => plan.chapters.map((c) => c.number)
const pageNames = (plan: ReturnType<typeof planDrop>, idx = 0) =>
  (plan.chapters[idx]?.pages ?? []).map((p) => p.name)

describe('naturalCompare', () => {
  it('orders 1, 2, 10 the way a reader reads them', () => {
    expect(['10.jpg', '1.jpg', '2.jpg'].sort(naturalCompare)).toEqual(['1.jpg', '2.jpg', '10.jpg'])
  })

  it('treats zero padding as the same number', () => {
    expect(['009.jpg', '10.jpg', '0008.jpg'].sort(naturalCompare)).toEqual([
      '0008.jpg',
      '009.jpg',
      '10.jpg',
    ])
    expect(naturalCompare('007', '7')).toBeGreaterThan(0) // stable, not equal
    expect(naturalCompare('7', '007')).toBeLessThan(0)
  })

  it('sorts numbered names before worded ones and is case-insensitive', () => {
    expect(['credits.png', '1.jpg', 'Cover.jpg'].sort(naturalCompare)).toEqual([
      '1.jpg',
      'Cover.jpg',
      'credits.png',
    ])
  })

  it('does not depend on the runtime locale for multi-run names', () => {
    expect(['p1-2.jpg', 'p1-10.jpg', 'p1-1.jpg'].sort(naturalCompare)).toEqual([
      'p1-1.jpg',
      'p1-2.jpg',
      'p1-10.jpg',
    ])
  })
})

describe('sanitizeEntryPath', () => {
  it('refuses every shape of path escape', () => {
    expect(sanitizeEntryPath('../../etc/passwd')).toEqual({ ok: false, reason: 'traversal' })
    expect(sanitizeEntryPath('chapter/../../etc/passwd')).toEqual({
      ok: false,
      reason: 'traversal',
    })
    expect(sanitizeEntryPath('..\\..\\windows\\system32\\a.jpg')).toEqual({
      ok: false,
      reason: 'traversal',
    })
    expect(sanitizeEntryPath('/etc/passwd')).toEqual({ ok: false, reason: 'absolute' })
    expect(sanitizeEntryPath('C:\\Users\\admin\\a.jpg')).toEqual({ ok: false, reason: 'absolute' })
    expect(sanitizeEntryPath('~/.ssh/id_rsa')).toEqual({ ok: false, reason: 'absolute' })
    expect(sanitizeEntryPath('ok/\u0000evil.jpg')).toEqual({ ok: false, reason: 'control_chars' })
  })

  it('keeps a relative path and normalises the separators', () => {
    expect(sanitizeEntryPath('Chapter 1/./001.jpg')).toEqual({
      ok: true,
      path: 'Chapter 1/001.jpg',
    })
    expect(sanitizeEntryPath('Chapter 1\\001.jpg')).toEqual({ ok: true, path: 'Chapter 1/001.jpg' })
  })

  it('drops archive junk quietly', () => {
    expect(sanitizeEntryPath('__MACOSX/._001.jpg').ok).toBe(false)
    expect(sanitizeEntryPath('ch1/.DS_Store')).toEqual({ ok: false, reason: 'hidden' })
    expect(sanitizeEntryPath('ch1/Thumbs.db')).toEqual({ ok: false, reason: 'metadata' })
    expect(sanitizeEntryPath('ch1/')).toEqual({ ok: false, reason: 'directory' })
  })

  it('bounds length and depth', () => {
    expect(sanitizeEntryPath(`${'a'.repeat(301)}.jpg`)).toEqual({ ok: false, reason: 'too_long' })
    expect(sanitizeEntryPath(`${'a/'.repeat(13)}x.jpg`)).toEqual({ ok: false, reason: 'too_deep' })
  })
})

describe('createZipGuard', () => {
  const info = (name: string, originalSize: number, size = originalSize) => ({
    name,
    size,
    originalSize,
  })

  it('takes ordinary image entries and reports their safe path', () => {
    const guard = createZipGuard()
    expect(guard.check(info('Chapter 1/001.jpg', 400_000, 399_000))).toEqual({
      take: true,
      path: 'Chapter 1/001.jpg',
    })
    expect(guard.bytes).toBe(400_000)
    expect(guard.rejected).toEqual([])
  })

  it('refuses a traversing entry before it is ever decompressed', () => {
    const guard = createZipGuard()
    expect(guard.check(info('../../etc/passwd.jpg', 10)).take).toBe(false)
    expect(guard.rejected).toEqual([{ path: '../../etc/passwd.jpg', reason: 'traversal' }])
  })

  it('refuses non-images and oversized entries', () => {
    const guard = createZipGuard()
    expect(guard.check(info('ch1/notes.txt', 10)).take).toBe(false)
    expect(guard.check(info('ch1/huge.png', ZIP_LIMITS.maxEntryBytes + 1)).take).toBe(false)
    expect(guard.rejected.map((r) => r.reason)).toEqual(['not_image', 'entry_too_large'])
  })

  it('refuses an entry that claims an impossible compression ratio', () => {
    const guard = createZipGuard()
    // 4 KB of deflate claiming 40 MB of PNG: the classic bomb entry.
    expect(guard.check(info('ch1/bomb.png', 40 * 1024 * 1024, 4096)).take).toBe(false)
    expect(guard.rejected[0]?.reason).toBe('suspicious_ratio')
    expect(guard.bytes).toBe(0)
  })

  it('stops the archive at the entry cap and refuses everything after it', () => {
    const guard = createZipGuard({ ...ZIP_LIMITS, maxEntries: 3 })
    for (let i = 0; i < 3; i++) expect(guard.check(info(`ch1/${i}.jpg`, 100)).take).toBe(true)
    expect(guard.check(info('ch1/4.jpg', 100)).take).toBe(false)
    expect(guard.aborted).toBe('entry_limit')
    expect(guard.check(info('ch1/5.jpg', 100)).take).toBe(false)
  })

  it('stops the archive at the decompressed-size cap', () => {
    const guard = createZipGuard({ ...ZIP_LIMITS, maxTotalBytes: 1000 })
    expect(guard.check(info('ch1/1.jpg', 600)).take).toBe(true)
    expect(guard.check(info('ch1/2.jpg', 600)).take).toBe(false)
    expect(guard.aborted).toBe('size_limit')
    expect(guard.bytes).toBe(600)
  })
})

describe('detectChapterNumber', () => {
  it('reads the forms real releases use', () => {
    expect(detectChapterNumber('Chapter 12.5')).toMatchObject({ number: '12.5', source: 'marker' })
    expect(detectChapterNumber('ch_012')).toMatchObject({ number: '12', source: 'marker' })
    expect(detectChapterNumber('[Group] Series - 012')).toMatchObject({ number: '12' })
    expect(detectChapterNumber('c012')).toMatchObject({ number: '12', source: 'marker' })
    expect(detectChapterNumber('Ch. 154 - The Long Night')).toMatchObject({
      number: '154',
      title: 'The Long Night',
    })
    expect(detectChapterNumber('Episode 7')).toMatchObject({ number: '7' })
    expect(detectChapterNumber('012')).toMatchObject({ number: '12', source: 'single' })
    expect(detectChapterNumber('[Group] Series v03 c045 (2024).cbz')).toMatchObject({
      number: '45',
      volume: 3,
    })
  })

  it('prefers an explicit marker over any other number in the name', () => {
    expect(detectChapterNumber('Solo Cartographer 2 - Chapter 8')).toMatchObject({
      number: '8',
      source: 'marker',
    })
    expect(detectChapterNumber('[Scans] 1080p Ch.31')).toMatchObject({ number: '31' })
  })

  it('flags a name with more than one bare number instead of picking silently', () => {
    const many = detectChapterNumber('Series Season 2 - 012')
    expect(many.number).toBe('12')
    expect(many.source).toBe('trailing')
    expect(many.candidates.length).toBeGreaterThan(1)
  })

  it('returns nothing rather than guessing', () => {
    expect(detectChapterNumber('Prologue').number).toBeNull()
    expect(detectChapterNumber('Chapter 1-2').number).toBeNull() // a range, not 1 with title 2
    expect(detectChapterNumber('').number).toBeNull()
    expect(detectChapterNumber('extras').number).toBeNull()
  })

  it('normalises through the strict parser (007 → 7, 12.500 → 12.5)', () => {
    expect(detectChapterNumber('Chapter 007').number).toBe('7')
    expect(detectChapterNumber('Chapter 12.500').number).toBe('12.5')
    expect(detectChapterNumber('Chapter 12.5001').number).toBeNull() // numeric(10,3) cannot hold it
  })
})

describe('classifyPageName', () => {
  it('separates covers, pages and strays', () => {
    expect(classifyPageName('cover.jpg')).toEqual({ role: 'cover', num: null })
    expect(classifyPageName('00_cover.png')).toEqual({ role: 'cover', num: 0 })
    expect(classifyPageName('credits.png')).toEqual({ role: 'extra', num: null })
    expect(classifyPageName('join-us.jpg')).toEqual({ role: 'extra', num: null })
    expect(classifyPageName('001.jpg')).toEqual({ role: 'page', num: 1 })
    expect(classifyPageName('Series_ch12_p07.jpg')).toEqual({ role: 'page', num: 7 })
    expect(classifyPageName('nonsense.jpg')).toEqual({ role: 'extra', num: null })
  })
})

describe('planDrop', () => {
  it('orders pages naturally and parks a cover and credits around them', () => {
    const plan = planDrop(
      entries(
        'Chapter 9/10.jpg',
        'Chapter 9/2.jpg',
        'Chapter 9/1.jpg',
        'Chapter 9/credits.png',
        'Chapter 9/cover.jpg',
      ),
    )
    expect(plan.chapters).toHaveLength(1)
    expect(pageNames(plan)).toEqual(['cover.jpg', '1.jpg', '2.jpg', '10.jpg', 'credits.png'])
    expect(plan.chapters[0]?.number).toBe('9')
  })

  it('keeps chapter 9 before chapter 10', () => {
    const plan = planDrop(entries('Chapter 10/001.jpg', 'Chapter 9/001.jpg', 'Chapter 8.5/001.jpg'))
    expect(numbers(plan)).toEqual(['8.5', '9', '10'])
  })

  it('reads one chapter per folder inside a nested archive', () => {
    const plan = planDrop(
      entries(
        'Series/Chapter 1/001.jpg',
        'Series/Chapter 1/002.jpg',
        'Series/Chapter 2/001.jpg',
        'Series/[Group] Series - 003/001.jpg',
      ),
    )
    expect(numbers(plan)).toEqual(['1', '2', '3'])
    expect(plan.chapters[0]?.pages).toHaveLength(2)
    expect(plan.totalPages).toBe(4)
  })

  it('treats a flat archive as one chapter named by its stem', () => {
    const plan = planDrop(entries('My Series Ch 12/001.jpg', 'My Series Ch 12/002.jpg'))
    expect(plan.chapters).toHaveLength(1)
    expect(plan.chapters[0]?.number).toBe('12')
  })

  it('splits a flat folder whose file names carry the chapter, but not one whose pages do', () => {
    const split = planDrop(
      entries('drop/ch01_001.jpg', 'drop/ch01_002.jpg', 'drop/ch02_001.jpg', 'drop/ch02_002.jpg'),
    )
    expect(numbers(split)).toEqual(['1', '2'])
    const notSplit = planDrop(
      entries('Chapter 4/c01.jpg', 'Chapter 4/c02.jpg', 'Chapter 4/c03.jpg'),
    )
    expect(notSplit.chapters).toHaveLength(1)
    expect(notSplit.chapters[0]?.number).toBe('4')
  })

  it('folds a numberless subfolder into its parent chapter as extras', () => {
    const plan = planDrop(
      entries('Chapter 3/001.jpg', 'Chapter 3/002.jpg', 'Chapter 3/extras/credits.png'),
    )
    expect(plan.chapters).toHaveLength(1)
    expect(pageNames(plan)).toEqual(['001.jpg', '002.jpg', 'credits.png'])
    expect(plan.chapters[0]?.pages[2]?.role).toBe('extra')
  })

  it('says when it could not find a number instead of inventing one', () => {
    const plan = planDrop(entries('Prologue/001.jpg'))
    expect(plan.chapters[0]?.number).toBeNull()
    expect(plan.chapters[0]?.issues).toContainEqual({ kind: 'no_number' })
  })

  it('flags two folders that resolve to the same chapter number', () => {
    const plan = planDrop(entries('Chapter 5/001.jpg', 'ch_005/001.jpg'))
    expect(numbers(plan)).toEqual(['5', '5'])
    for (const chapter of plan.chapters)
      expect(chapter.issues).toContainEqual({ kind: 'duplicate_number', number: '5' })
  })

  it('flags a hole in the page numbering and a repeated page number', () => {
    const gap = planDrop(entries('Ch 1/001.jpg', 'Ch 1/002.jpg', 'Ch 1/004.jpg'))
    expect(gap.chapters[0]?.issues).toContainEqual({ kind: 'missing_pages', numbers: [3] })
    const dupe = planDrop(entries('Ch 1/1.jpg', 'Ch 1/01.jpg', 'Ch 1/2.jpg'))
    expect(dupe.chapters[0]?.issues).toContainEqual({ kind: 'repeated_page_number', numbers: [1] })
  })

  it('rejects unsafe and non-image entries with a reason, and swallows archive junk', () => {
    const plan = planDrop(
      entries(
        'Ch 1/001.jpg',
        '../../etc/passwd',
        'Ch 1/notes.txt',
        '__MACOSX/._001.jpg',
        'Ch 1/.DS_Store',
      ),
    )
    expect(plan.chapters).toHaveLength(1)
    expect(plan.chapters[0]?.pages).toHaveLength(1)
    expect(plan.rejected).toEqual([
      { path: '../../etc/passwd', reason: 'traversal' },
      { path: 'Ch 1/notes.txt', reason: 'not_image' },
    ])
    expect(plan.quiet).toBe(2)
  })

  it('marks a chapter that would exceed the per-chapter page cap', () => {
    const paths = Array.from({ length: 5 }, (_, i) => `Ch 1/${String(i).padStart(3, '0')}.jpg`)
    const plan = planDrop(entries(...paths), { maxPages: 4 })
    expect(plan.chapters[0]?.issues).toContainEqual({ kind: 'too_many_pages', max: 4 })
  })
})
