import { describe, expect, it } from 'vitest'
import {
  docToMarkdown,
  docToPlain,
  excerptFrom,
  isDocEmpty,
  markdownToDoc,
  safeLinkHref,
} from '@/components/admin/content/markdown'
import {
  announcementDocSchema,
  fromLocalInput,
  MAX_BODY_CHARS,
  pageDocSchema,
  parseTags,
  publicPagePath,
  toLocalInput,
} from '@/components/admin/content/schemas'
import { publishAt } from './shared'

/**
 * The announcement / page editors round-trip an operator's Markdown through the rich-text
 * JSON the site stores, so the tests that matter are: what the parser produces, that a
 * document loaded for editing serialises back to the same source, and that the wire schema
 * refuses what the tables cannot hold.
 */

const roundTrip = (markdown: string) => docToMarkdown(markdownToDoc(markdown))

describe('markdownToDoc', () => {
  it('splits paragraphs on blank lines and keeps single newlines as breaks', () => {
    const doc = markdownToDoc('one\ntwo\n\nthree')
    expect(doc.children).toHaveLength(2)
    expect(doc.children[0]).toEqual({
      type: 'paragraph',
      children: [
        { type: 'text', text: 'one' },
        { type: 'hard_break' },
        { type: 'text', text: 'two' },
      ],
    })
    expect(docToPlain(doc)).toBe('one\ntwo\nthree\n')
  })

  it('clamps headings to the levels the renderer supports', () => {
    expect(markdownToDoc('# Top').children[0]).toMatchObject({ type: 'heading', level: 2 })
    expect(markdownToDoc('### Three').children[0]).toMatchObject({ type: 'heading', level: 3 })
    expect(markdownToDoc('###### Six').children[0]).toMatchObject({ type: 'heading', level: 4 })
  })

  it('groups consecutive bullets and numbers into one list each', () => {
    const doc = markdownToDoc('- a\n- b\n\n1. one\n2. two')
    expect(doc.children).toHaveLength(2)
    expect(doc.children[0]).toMatchObject({ type: 'bullet_list' })
    expect(doc.children[0]?.children).toHaveLength(2)
    expect(doc.children[1]).toMatchObject({ type: 'ordered_list' })
    expect(doc.children[1]?.children).toHaveLength(2)
  })

  it('reads inline marks, including nested ones', () => {
    const [para] = markdownToDoc('plain **bold _both_** `code`').children
    expect(para?.children).toEqual([
      { type: 'text', text: 'plain ' },
      { type: 'text', text: 'bold ', marks: ['bold'] },
      { type: 'text', text: 'both', marks: ['bold', 'italic'] },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'code', marks: ['code'] },
    ])
  })

  it('keeps only link targets the site renderer would keep', () => {
    const [safe] = markdownToDoc('[docs](/terms)').children
    expect(safe?.children[0]).toMatchObject({ type: 'link', href: '/terms' })
    const unsafe = markdownToDoc('[x](javascript:alert(1))')
    expect(JSON.stringify(unsafe)).not.toContain('javascript')
    expect(JSON.stringify(unsafe)).not.toContain('"link"')
    expect(docToPlain(unsafe)).toContain('x')
  })

  it('never emits a node type outside the renderer vocabulary', () => {
    const allowed = new Set([
      'doc',
      'paragraph',
      'heading',
      'bullet_list',
      'ordered_list',
      'list_item',
      'quote',
      'hard_break',
      'text',
      'link',
    ])
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return
      const record = node as Record<string, unknown>
      if (typeof record.type === 'string') expect(allowed).toContain(record.type)
      if (Array.isArray(record.children)) for (const child of record.children) walk(child)
    }
    walk(markdownToDoc('## H\n\n- a **b** [c](https://x.test)\n\n> quoted\n\n<script>x</script>'))
  })

  it('treats HTML as literal text — nothing is ever stored as markup', () => {
    const doc = markdownToDoc('<script>alert(1)</script>')
    expect(docToPlain(doc).trim()).toBe('<script>alert(1)</script>')
  })

  it('is empty only when there is no visible text', () => {
    expect(isDocEmpty(markdownToDoc(''))).toBe(true)
    expect(isDocEmpty(markdownToDoc('   \n\n  '))).toBe(true)
    expect(isDocEmpty(markdownToDoc('## '))).toBe(false)
    expect(isDocEmpty(markdownToDoc('hi'))).toBe(false)
  })
})

describe('docToMarkdown', () => {
  it('round-trips every construct the editor offers', () => {
    const source = [
      '## Heading two',
      '',
      'A paragraph with **bold**, _italic_, ~~strike~~, `code` and a [link](https://palscans.org/).',
      '',
      '### Heading three',
      '',
      '- first bullet',
      '- second **bullet**',
      '',
      '1. first step',
      '2. second step',
      '',
      '> a quoted line',
      '',
      'line one\nline two',
    ].join('\n')
    expect(roundTrip(source)).toBe(source)
    expect(roundTrip(roundTrip(source))).toBe(source)
  })

  it('escapes literal text that would otherwise be re-read as markup', () => {
    const literal = (text: string) => ({
      type: 'doc',
      version: 1,
      children: [{ type: 'paragraph', children: [{ type: 'text', text }] }],
    })
    for (const text of [
      '- not a bullet',
      '## not a heading',
      '> not a quote',
      '1. not a step',
      'a * b _ c ` d',
      '[not](a-link)',
    ]) {
      expect(docToPlain(markdownToDoc(docToMarkdown(literal(text)))).trim()).toBe(text)
    }
  })

  it('loads the plain paragraphs the seed writes', () => {
    const seeded = {
      type: 'doc',
      version: 1,
      children: [
        { type: 'paragraph', children: [{ type: 'text', text: 'First.' }] },
        { type: 'paragraph', children: [{ type: 'text', text: 'Second.' }] },
      ],
    }
    expect(docToMarkdown(seeded)).toBe('First.\n\nSecond.')
  })

  it('ignores anything that is not a document', () => {
    expect(docToMarkdown(null)).toBe('')
    expect(docToMarkdown({ type: 'paragraph' })).toBe('')
  })
})

describe('excerptFrom', () => {
  it('flattens the body and cuts on a word boundary', () => {
    expect(excerptFrom(markdownToDoc('## Title\n\nBody text here.'))).toBe('Title Body text here.')
    const long = excerptFrom(markdownToDoc('word '.repeat(80)), 40)
    expect(long.length).toBeLessThanOrEqual(41)
    expect(long.endsWith('…')).toBe(true)
  })
})

describe('safeLinkHref', () => {
  it('accepts site-relative and http(s) targets only', () => {
    expect(safeLinkHref('/terms')).toBe('/terms')
    expect(safeLinkHref('https://palscans.org/x')).toBe('https://palscans.org/x')
    expect(safeLinkHref('//evil.test')).toBeNull()
    expect(safeLinkHref('javascript:alert(1)')).toBeNull()
    expect(safeLinkHref('data:text/html,x')).toBeNull()
    expect(safeLinkHref('  ')).toBeNull()
  })
})

describe('announcementDocSchema', () => {
  const valid = {
    title: '  New release  ',
    slug: 'New-Release',
    body: 'hello',
    excerpt: '',
    coverKey: null,
    tags: ['Changelog', 'downtime'],
    state: 'published',
    publishedAt: null,
  }

  it('normalises the slug, tags and empty optional text', () => {
    const parsed = announcementDocSchema.parse(valid)
    expect(parsed).toMatchObject({
      title: 'New release',
      slug: 'new-release',
      tags: ['changelog', 'downtime'],
      excerpt: null,
    })
  })

  it('refuses a slug that is not a slug', () => {
    for (const slug of ['', 'has space', 'trailing-', 'em—dash', 'a'.repeat(81)])
      expect(announcementDocSchema.safeParse({ ...valid, slug }).success).toBe(false)
  })

  it('refuses an empty title and an over-long body', () => {
    expect(announcementDocSchema.safeParse({ ...valid, title: '   ' }).success).toBe(false)
    expect(
      announcementDocSchema.safeParse({ ...valid, body: 'x'.repeat(MAX_BODY_CHARS + 1) }).success,
    ).toBe(false)
  })

  it('refuses states and tags outside the enum', () => {
    expect(announcementDocSchema.safeParse({ ...valid, state: 'deleted' }).success).toBe(false)
    expect(announcementDocSchema.safeParse({ ...valid, tags: ['not a tag!'] }).success).toBe(false)
    expect(
      announcementDocSchema.safeParse({ ...valid, tags: Array.from({ length: 11 }, () => 'a') })
        .success,
    ).toBe(false)
  })
})

describe('pageDocSchema', () => {
  it('accepts the shape the legal pages need', () => {
    const parsed = pageDocSchema.parse({
      title: 'Terms of service',
      slug: 'terms',
      body: '## Terms',
      state: 'published',
    })
    expect(parsed.slug).toBe('terms')
  })

  it('refuses a missing body field entirely', () => {
    expect(pageDocSchema.safeParse({ title: 'x', slug: 'x', state: 'draft' }).success).toBe(false)
  })
})

describe('publishAt', () => {
  const doc = {
    ...announcementDocSchema.parse({
      title: 'x',
      slug: 'x',
      body: 'x',
      excerpt: null,
      coverKey: null,
      tags: [],
      state: 'draft',
      publishedAt: null,
    }),
  }

  it('stamps now when publishing without a date', () => {
    const before = Date.now()
    const at = publishAt({ ...doc, state: 'published' }, null)
    expect(at).toBeInstanceOf(Date)
    expect((at as Date).getTime()).toBeGreaterThanOrEqual(before)
  })

  it('keeps the original date when editing a published post', () => {
    const original = new Date('2026-01-02T03:04:05.000Z')
    expect(publishAt({ ...doc, state: 'published' }, original)).toBe(original)
  })

  it('honours an explicit date, and clears it for unpublished states', () => {
    const chosen = '2026-05-06T07:08:09.000Z'
    expect(
      publishAt({ ...doc, state: 'scheduled', publishedAt: chosen }, null)?.toISOString(),
    ).toBe(chosen)
    expect(publishAt({ ...doc, state: 'draft' }, new Date())).toBeNull()
  })
})

describe('form helpers', () => {
  it('parses tags from what an operator types', () => {
    expect(parseTags('Changelog, down time,,changelog')).toEqual(['changelog', 'down-time'])
    expect(parseTags('   ')).toEqual([])
    expect(parseTags(Array.from({ length: 20 }, (_, i) => `t${i}`).join(','))).toHaveLength(10)
  })

  it('round-trips the datetime-local field', () => {
    const iso = new Date(2026, 4, 6, 7, 8).toISOString()
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso)
    expect(toLocalInput(null)).toBe('')
    expect(toLocalInput('not a date')).toBe('')
    expect(fromLocalInput('')).toBeNull()
  })

  it('gives every page a path, including one with no route of its own', () => {
    expect(publicPagePath('privacy')).toBe('/privacy')
    // Served by the `[slug]` catch-all, so a page created in the panel is reachable
    // without a deploy — this used to be null and the screens warned "No route".
    expect(publicPagePath('handbook')).toBe('/handbook')
    // Slugs that could never be a page still have nowhere to go.
    expect(publicPagePath('')).toBeNull()
    expect(publicPagePath('_next')).toBeNull()
    expect(publicPagePath('api')).toBeNull()
  })
})

/**
 * Everything a body can start with, round-tripped. A paragraph opening with bold used to
 * come back as a literal `*` wrapping italic text, because the line-start escaper treated
 * the first `*` of `**` as a bullet marker — so every announcement whose first words were
 * bold quietly lost that bold the first time somebody reopened and saved it.
 */
describe('a body survives being reopened and saved', () => {
  const bodies = [
    '**hello**',
    '**a** and **b**',
    '**bold** then text',
    '_italic first_',
    '~~struck first~~',
    '`code first`',
    '*not a list, just a star',
    '- a real bullet',
    '1. a real numbered item',
    '1.no space, so not a list',
    '## a heading',
    '#hashtag, not a heading',
    '> a quote',
    '**<script>alert(1)</script>**',
  ]
  for (const body of bodies) {
    it(`round-trips ${JSON.stringify(body)}`, () => {
      const doc = markdownToDoc(body)
      expect(markdownToDoc(docToMarkdown(doc))).toEqual(doc)
    })
  }
})

/**
 * The bodies are structured JSON rendered by `RichText` as React elements, so markup can
 * only ever survive as literal text. These assert the two things that would break that:
 * a node type the renderer would treat as markup, and an href with an executable scheme.
 */
describe('a body cannot carry markup or an executable link', () => {
  const attacks = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '[click](javascript:alert(1))',
    '[click](  JaVaScRiPt:alert(1))',
    '[click](data:text/html;base64,PHNjcmlwdD4=)',
    '[click](vbscript:msgbox(1))',
    '[click](//evil.example/x)',
    '<svg/onload=alert(1)>',
  ]
  const hrefsIn = (node: unknown, out: string[] = []): string[] => {
    if (Array.isArray(node)) for (const n of node) hrefsIn(n, out)
    else if (node && typeof node === 'object') {
      const n = node as Record<string, unknown>
      if (typeof n.href === 'string') out.push(n.href)
      for (const v of Object.values(n)) if (v && typeof v === 'object') hrefsIn(v, out)
    }
    return out
  }
  for (const attack of attacks) {
    it(`neutralises ${JSON.stringify(attack.slice(0, 36))}`, () => {
      const doc = markdownToDoc(attack)
      for (const href of hrefsIn(doc)) {
        expect(href.toLowerCase()).not.toMatch(/^\s*(javascript|data|vbscript):/)
        // Protocol-relative would send a reader off-site from a link that looks internal.
        expect(href).not.toMatch(/^\/\//)
      }
      expect(JSON.stringify(doc)).not.toMatch(/"type"\s*:\s*"(script|iframe|html|raw)"/)
    })
  }
})
