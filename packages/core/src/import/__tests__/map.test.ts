import { describe, expect, it } from 'vitest'
import {
  legacyBookmarks,
  legacyChapters,
  legacyComments,
  legacySeries,
  legacyUsers,
} from '../__fixtures__/index.js'
import { mapBookmark, mapChapter, mapComment, mapSeries, mapTerm, mapUser } from '../map.js'
import { phpUnserialize, readMetaValue } from '../php-serialize.js'

const bySlug = (slug: string) => legacySeries.find((p) => p.name === slug)

describe('mapSeries', () => {
  it('maps the confirmed docs/09 fields', () => {
    const post = bySlug('ashfall-requiem')
    if (!post) throw new Error('fixture missing')
    const s = mapSeries(post)
    expect(s.uniqueId).toBe('mu-ashfall-0001')
    expect(s.synthesisedUniqueId).toBe(false)
    expect(s.slug).toBe('ashfall-requiem')
    expect(s.type).toBe('manhwa')
    expect(s.status).toBe('ongoing')
    expect(s.state).toBe('published')
    expect(s.synopsis).toBe('A knight wakes in the ruins of her own capital.\n\nShe is not alone.')
    // The title itself is dropped from the alternatives, duplicates collapse.
    expect(s.altTitles).toEqual(['Requiem of Ash', '잿빛 진혼곡'])
    expect(s.genres.map((g) => g.slug)).toEqual(['action', 'fantasy', 'female-lead'])
    expect(s.people).toEqual([
      { slug: 'yoon-hae', name: 'Yoon Hae', credit: 'author' },
      { slug: 'kim-doha', name: 'Kim Doha', credit: 'artist' },
    ])
    expect(s.releasedYear).toBe(2021)
    expect(s.viewCount).toBe(184213)
    expect(s.periodViews).toEqual({ day: 1204, week: 9331, month: 40122, year: 150004 })
    expect(s.ratingCount).toBe(412)
    expect(s.ratingAvg).toBe(9.2)
    expect(s.ratingSum).toBe(Math.round(4.6 * 2 * 412))
    expect(s.badges).toEqual(['hot'])
    expect(s.coverAttachmentId).toBe(9001)
    expect(s.createdAt).toBe('2021-03-04T09:15:00.000Z')
    expect(s.warnings).toEqual([])
  })

  it('maps the legacy status vocabulary', () => {
    const quiet = bySlug('the-quiet-blade')
    if (!quiet) throw new Error('fixture missing')
    expect(mapSeries(quiet).status).toBe('completed')
    const cloud = legacySeries.find((p) => p.id === 103)
    if (!cloud) throw new Error('fixture missing')
    const mapped = mapSeries(cloud)
    expect(mapped.status).toBe('hiatus')
    expect(mapped.type).toBe('manhua')
    expect(mapped.state).toBe('draft')
    // No manga_unique_id and no post_name: keyed on the post id, both warned about.
    expect(mapped.uniqueId).toBe('wp-post-103')
    expect(mapped.synthesisedUniqueId).toBe(true)
    expect(mapped.slug).toBe('cloudbreaker')
    expect(mapped.warnings).toHaveLength(2)
  })

  it('warns instead of inventing values for unknown vocabulary', () => {
    const saint = bySlug('saint-of-the-ninth-ward')
    if (!saint) throw new Error('fixture missing')
    const s = mapSeries(saint)
    expect(s.type).toBe('manhwa') // webtoon → manhwa
    expect(s.status).toBe('ongoing')
    expect(s.warnings).toEqual(['unknown _wp_manga_status "weird-status" → ongoing'])
  })

  it('marks a trashed post as removed so nothing publishes it', () => {
    const trashed = legacySeries.find((p) => p.status === 'trash')
    if (!trashed) throw new Error('fixture missing')
    const s = mapSeries(trashed)
    expect(s.deleted).toBe(true)
    expect(s.state).toBe('removed')
    expect(s.publishedAt).toBeNull()
  })
})

describe('mapChapter', () => {
  it('parses the name and normalises the page order', () => {
    const c = mapChapter(legacyChapters[0] as (typeof legacyChapters)[number], 'mu-ashfall-0001')
    expect(c.number).toBe('12.5')
    expect(c.seriesUniqueId).toBe('mu-ashfall-0001')
    expect(c.pages).toHaveLength(18)
    expect(c.pages[0]?.idx).toBe(0)
    expect(c.legacySlug).toBe('chapter-12-5')
  })

  it('keeps the raw name for the review CSV when the number will not parse', () => {
    const prologue = legacyChapters.find((c) => c.name === 'Prologue')
    if (!prologue) throw new Error('fixture missing')
    const c = mapChapter(prologue)
    expect(c.number).toBeNull()
    expect(c.rawName).toBe('Prologue')
    expect(c.title).toBe('Prologue')
  })
})

describe('mapUser', () => {
  it('carries the account and never the password', () => {
    const u = mapUser(legacyUsers[0] as (typeof legacyUsers)[number])
    expect(u.passwordHash).toBeNull()
    expect(u.email).toBe('admin@old-site.test')
    expect(u.username).toBe('admin')
    expect(u.role).toBe('admin')
    expect(u.createdAt).toBe('2018-01-01T00:00:00.000Z')
    expect(u.emailVerifiedAt).toBe('2018-01-01T00:00:00.000Z')
  })

  it('maps the WordPress roles and slugifies awkward logins', () => {
    const roles = legacyUsers.map((u) => mapUser(u).role)
    expect(roles).toEqual(['admin', 'uploader', 'user', 'moderator'])
    expect(mapUser(legacyUsers[1] as (typeof legacyUsers)[number]).username).toBe('uploader-one')
    // 'ø' is outside the slug table, so it degrades rather than silently guessing.
    expect(mapUser(legacyUsers[3] as (typeof legacyUsers)[number]).username).toBe('m-derator')
  })
})

describe('mapComment', () => {
  it('converts stored HTML into the structured body', () => {
    const c = mapComment(legacyComments[0] as (typeof legacyComments)[number])
    expect(c.status).toBe('published')
    expect(c.legacyParentId).toBeNull()
    expect(c.body).toEqual({
      type: 'doc',
      version: 1,
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', text: 'This chapter ' },
            { type: 'text', text: 'broke', marks: ['bold'] },
            { type: 'text', text: ' me.' },
          ],
        },
        { type: 'paragraph', children: [{ type: 'text', text: 'Read it twice.' }] },
      ],
    })
  })

  it('keeps links and entities, and maps the approval vocabulary', () => {
    const reply = mapComment(legacyComments[1] as (typeof legacyComments)[number])
    expect(reply.legacyParentId).toBe(8001)
    const [para] = reply.body.children
    if (para?.type !== 'paragraph') throw new Error('expected a paragraph')
    expect(para.children[0]).toEqual({ type: 'text', text: 'Agreed & seconded — see ' })
    expect(para.children[1]).toEqual({
      type: 'link',
      href: 'https://example.test/post',
      children: [{ type: 'text', text: 'this' }],
    })
    expect(mapComment(legacyComments[2] as (typeof legacyComments)[number]).status).toBe('rejected')
    expect(mapComment(legacyComments[3] as (typeof legacyComments)[number]).status).toBe('pending')
  })

  it('treats a guest comment as having no legacy user', () => {
    expect(mapComment(legacyComments[2] as (typeof legacyComments)[number]).legacyUserId).toBeNull()
  })
})

describe('mapBookmark and mapTerm', () => {
  it('reads PHP-serialized and JSON bookmark payloads', () => {
    const a = mapBookmark(legacyBookmarks[0] as (typeof legacyBookmarks)[number])
    expect(a).toMatchObject({ legacyUserId: 3, seriesLegacyId: 101, status: 'reading' })
    const b = mapBookmark(legacyBookmarks[1] as (typeof legacyBookmarks)[number])
    expect(b).toMatchObject({ seriesLegacyId: 102, status: 'completed' })
  })

  it('ignores taxonomies outside the mapping', () => {
    expect(mapTerm({ termId: 1, taxonomy: 'category', slug: 'x', name: 'X', count: 1 })).toBeNull()
    expect(
      mapTerm({ termId: 2, taxonomy: 'wp-manga-genre', slug: 'action', name: 'Action', count: 3 }),
    ).toEqual({ slug: 'action', name: 'Action', role: 'genre' })
  })

  it('reads the PHP serialize forms WordPress meta uses', () => {
    expect(phpUnserialize('a:2:{s:7:"post_id";i:101;s:6:"status";s:7:"reading";}')).toEqual({
      post_id: 101,
      status: 'reading',
    })
    expect(phpUnserialize('a:2:{i:0;s:3:"hot";i:1;s:3:"new";}')).toEqual(['hot', 'new'])
    expect(phpUnserialize('b:1;')).toBe(true)
    expect(phpUnserialize('not serialized')).toBeNull()
    expect(readMetaValue('plain string')).toBe('plain string')
    expect(readMetaValue(undefined)).toBeNull()
  })
})
