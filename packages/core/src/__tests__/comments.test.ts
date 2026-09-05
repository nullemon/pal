import { describe, expect, it } from 'vitest'
import { type AutomodAuthor, automod, trigramSimilarity } from '../comments/automod.js'
import {
  bodyDepth,
  bodyFromText,
  type CommentBody,
  linkHrefs,
  mentions,
  misleadingLinks,
  plainText,
} from '../comments/body.js'
import { allAllowlisted, detectLinks, domainOf, hasLink } from '../comments/links.js'
import { safeHref } from '../comments/render.js'
import { commentBodySchema, isCommentBody } from '../comments/schema.js'

const now = new Date('2026-09-02T12:00:00Z')
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000)
const veteran: AutomodAuthor = {
  createdAt: daysAgo(400),
  publishedComments: 120,
  actionedReports30d: 0,
  isPremium: false,
  isStaff: false,
}
const newbie: AutomodAuthor = { ...veteran, createdAt: daysAgo(0.2), publishedComments: 0 }

describe('link detection', () => {
  it('finds urls, bare domains, obfuscations, discord and telegram', () => {
    expect(detectLinks('check https://example.com/path?x=1 now').map((l) => l.kind)).toEqual([
      'url',
    ])
    expect(detectLinks('go to www.example.org').map((l) => l.kind)).toEqual(['url'])
    expect(detectLinks('read it on example.com instead').map((l) => l.domain)).toEqual([
      'example.com',
    ])
    expect(detectLinks('example[dot]com has it').map((l) => l.kind)).toEqual(['obfuscated'])
    expect(detectLinks('example (dot) com').map((l) => l.kind)).toEqual(['obfuscated'])
    expect(detectLinks('hxxp://bad.example/x').map((l) => l.kind)).toEqual(['obfuscated'])
    expect(detectLinks('join discord.gg/abc123').map((l) => l.kind)).toEqual(['discord'])
    expect(detectLinks('https://discord.com/invite/abc').map((l) => l.kind)).toEqual(['discord'])
    expect(detectLinks('dm me on t.me/someone').map((l) => l.kind)).toEqual(['telegram'])
    expect(domainOf('hxxp://www.Bad.Example/x')).toBe('bad.example')
    expect(domainOf('example [dot] com')).toBe('example.com')
  })
  it('sees through invisible characters, unicode dots and spaced dots', () => {
    expect(detectLinks('exam\u200Bple.com').map((l) => [l.kind, l.domain])).toEqual([
      ['obfuscated', 'example.com'],
    ])
    expect(detectLinks('example\u3002com').map((l) => l.domain)).toEqual(['example.com'])
    expect(detectLinks('example\u2024com').map((l) => l.domain)).toEqual(['example.com'])
    expect(detectLinks('example\uFF0Ecom').map((l) => l.domain)).toEqual(['example.com'])
    expect(
      detectLinks('\uFF45\uFF58\uFF41\uFF4D\uFF50\uFF4C\uFF45.com').map((l) => l.domain),
    ).toEqual(['example.com'])
    expect(detectLinks('example . com').map((l) => l.kind)).toEqual(['obfuscated'])
    expect(detectLinks('example (.) com').map((l) => l.domain)).toEqual(['example.com'])
    expect(detectLinks('example [.] com').map((l) => l.domain)).toEqual(['example.com'])
    expect(allAllowlisted(detectLinks('pal\u200Bscans.org'), ['palscans.org'])).toBe(false)
    expect(domainOf('example . com')).toBe('example.com')
  })
  it('ignores chapter numbers, ratings, mentions and emails', () => {
    expect(hasLink('Ch. 12.5 was 9.6/10, ver 1.2.3')).toBe(false)
    expect(hasLink('thanks @kael.v for the tip')).toBe(false)
    expect(hasLink('mail me: someone@example.com')).toBe(false)
    expect(hasLink('the file is main.ts')).toBe(false)
    expect(hasLink('This is great. Really.')).toBe(false)
  })
  it('allowlist matches domains and subdomains', () => {
    const links = detectLinks('see palscans.org/series/x and cdn.palscans.org')
    expect(allAllowlisted(links, ['palscans.org'])).toBe(true)
    expect(allAllowlisted(detectLinks('see evil.com'), ['palscans.org'])).toBe(false)
    expect(allAllowlisted(detectLinks('palscans[dot]org'), ['palscans.org'])).toBe(false)
  })
})

describe('comment body', () => {
  const body: CommentBody = {
    type: 'doc',
    version: 1,
    children: [
      {
        type: 'paragraph',
        children: [
          { type: 'text', text: 'Hello ', marks: ['bold'] },
          { type: 'mention', username: 'kael' },
          { type: 'text', text: ' <script>alert(1)</script> ' },
          { type: 'spoiler', children: [{ type: 'text', text: 'he dies' }] },
          { type: 'hard_break' },
          {
            type: 'link',
            href: 'javascript:alert(1)',
            children: [{ type: 'text', text: 'click' }],
          },
          {
            type: 'link',
            href: 'https://palscans.org/x',
            children: [{ type: 'text', text: 'ok' }],
          },
        ],
      },
      { type: 'image', imageId: 7, alt: 'panel' },
      {
        type: 'quote',
        username: 'mod',
        commentId: 3,
        children: [{ type: 'paragraph', children: [{ type: 'text', text: 'q' }] }],
      },
    ],
  }
  const safeBody: CommentBody = {
    ...body,
    children: body.children.map((b) =>
      b.type === 'paragraph'
        ? {
            ...b,
            children: b.children.filter((n) => n.type !== 'link' || !/^javascript:/.test(n.href)),
          }
        : b,
    ),
  }
  it('validates structure', () => {
    // the javascript: link fails the href refinement; without it the body is valid
    expect(isCommentBody(body)).toBe(false)
    expect(isCommentBody(safeBody)).toBe(true)
    expect(
      isCommentBody({ type: 'doc', version: 1, children: [{ type: 'html', html: '<b>' }] }),
    ).toBe(false)
    expect(
      isCommentBody({
        type: 'doc',
        version: 1,
        children: [
          { type: 'paragraph', children: [{ type: 'text', text: 'x', marks: ['blink'] }] },
        ],
      }),
    ).toBe(false)
    expect(isCommentBody('nope')).toBe(false)
  })
  it('caps width and depth', () => {
    const p = (children: unknown[]) => ({ type: 'paragraph', children })
    const t = { type: 'text', text: 'x' }
    expect(isCommentBody({ type: 'doc', version: 1, children: Array(51).fill(p([t])) })).toBe(false)
    expect(isCommentBody({ type: 'doc', version: 1, children: [p(Array(201).fill(t))] })).toBe(
      false,
    )
    let quote: unknown = p([t])
    for (let i = 0; i < 3; i++) quote = { type: 'quote', children: [quote] }
    expect(isCommentBody({ type: 'doc', version: 1, children: [quote] })).toBe(false)
    let spoiler: unknown = t
    for (let i = 0; i < 5; i++) spoiler = { type: 'spoiler', children: [spoiler] }
    expect(isCommentBody({ type: 'doc', version: 1, children: [p([spoiler])] })).toBe(false)
    expect(bodyDepth(safeBody)).toEqual({ quote: 1, inline: 1 })
    expect(
      commentBodySchema.safeParse({
        type: 'doc',
        version: 1,
        children: [p([{ type: 'link', href: 'https://a.example/x', children: [t] }])],
      }).success,
    ).toBe(true)
  })
  it('flags link nodes whose label is a different address', () => {
    const link = (href: string, label: string) => ({
      type: 'doc' as const,
      version: 1 as const,
      children: [
        {
          type: 'paragraph' as const,
          children: [
            { type: 'link' as const, href, children: [{ type: 'text' as const, text: label }] },
          ],
        },
      ],
    })
    expect(misleadingLinks(link('https://spam.tld/x', 'click here'))).toHaveLength(1)
    expect(misleadingLinks(link('https://spam.tld/x', 'palscans.org'))).toHaveLength(1)
    expect(misleadingLinks(link('https://palscans.org/x', 'palscans.org/x'))).toHaveLength(0)
    expect(misleadingLinks(link('https://palscans.org/x', 'https://palscans.org/x/'))).toHaveLength(
      0,
    )
    expect(misleadingLinks(link('https://palscans.org/x', ''))).toHaveLength(0)
  })
  it('extracts plain text, mentions, links', () => {
    expect(plainText(body)).toBe(
      'Hello @kael <script>alert(1)</script> he dies\nclickok\n\npanel\n\nq',
    )
    expect(mentions(body)).toEqual(['kael'])
    expect(linkHrefs(body)).toEqual(['javascript:alert(1)', 'https://palscans.org/x'])
    expect(bodyFromText('a\nb\n\nc').children).toHaveLength(2)
    expect(plainText(bodyFromText('a\nb\n\nc'))).toBe('a\nb\n\nc')
  })
  it('promotes bare domains and refuses every other scheme', () => {
    expect(safeHref('example.com/x')).toBe('https://example.com/x')
    expect(safeHref('https://palscans.org/x')).toBe('https://palscans.org/x')
    expect(safeHref('data:text/html,hi')).toBeNull()
    expect(safeHref('javascript:alert(1)')).toBeNull()
  })

  it('has no HTML-string renderer left to reach for', async () => {
    // `renderHtml` was deleted in the pre-launch security pass — it was unused, and the only
    // path in the comment system that produced markup as a string. Comments render as React
    // elements (`components/comments/CommentBody.tsx`). This asserts the deletion rather
    // than describing it, so a well-meaning revival has to argue with a failing test first.
    const render: Record<string, unknown> = await import('../comments/render.js')
    expect(Object.keys(render)).toEqual(['safeHref'])
    const barrel: Record<string, unknown> = await import('../comments/index.js')
    expect(barrel.renderHtml).toBeUndefined()
  })
})

describe('automod', () => {
  it('publishes an ordinary comment from a veteran', () => {
    const r = automod(
      { body: 'Great chapter, the art keeps getting better.', author: veteran },
      now,
    )
    expect(r.rules).toEqual(['reputation_credit'])
    expect(r.score).toBe(-3)
    expect(r.decision).toBe('publish')
  })
  it('holds links regardless of score and scores new accounts', () => {
    const r = automod({ body: 'read ahead at example.com', author: newbie }, now)
    expect(r.rules).toEqual(['new_account_24h', 'link_present'])
    expect(r.score).toBe(8)
    expect(r.hasLink).toBe(true)
    expect(r.decision).toBe('hold')
    const v = automod(
      { body: 'see palscans.org/x', author: veteran, linkAllowlist: ['palscans.org'] },
      now,
    )
    expect(v.hasLink).toBe(false)
    expect(v.decision).toBe('publish')
    const link = automod({ body: 'see https://example.com', author: veteran }, now)
    expect(link.score).toBe(2)
    expect(link.decision).toBe('hold')
  })
  it('detects shouting, char spam, emoji, mention flood, velocity, repeats', () => {
    const r = automod(
      {
        body: 'THIS IS THE BEST CHAPTER EVER!!!!!!!!!! 🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥 @ab @cd @ef @gh',
        author: { ...newbie, createdAt: daysAgo(3) },
        recentCommentTimes: [now, now, now, now],
      },
      now,
    )
    expect(r.rules).toEqual([
      'new_account_7d',
      'shouting',
      'char_spam',
      'emoji_spam',
      'mention_flood',
      'velocity',
    ])
    expect(r.score).toBe(9)
    expect(r.decision).toBe('hold')
    const rep = automod({ body: 'first!', author: veteran, recentBodies: ['First!'] }, now)
    expect(rep.rules).toContain('repeated_text')
    const near = automod(
      {
        body: 'this chapter was absolutely amazing wow',
        author: veteran,
        recentBodies: ['this chapter was absolutely amazing, wow'],
      },
      now,
    )
    expect(near.rules).toContain('near_duplicate')
    expect(trigramSimilarity('abc', 'abc')).toBe(1)
  })
  it('shadows repeat offenders above 10 and never holds staff', () => {
    const r = automod(
      {
        body: 'buy now at example.com !!!!!!!!!!',
        author: { ...newbie, actionedReports30d: 2 },
        recentBodies: ['buy now at example.com !!!!!!!!!!'],
      },
      now,
    )
    expect(r.score).toBeGreaterThanOrEqual(10)
    expect(r.decision).toBe('shadow')
    const staff = automod(
      { body: 'official: discord.gg/palscans', author: { ...veteran, isStaff: true } },
      now,
    )
    expect(staff.hasLink).toBe(false)
    expect(staff.decision).toBe('publish')
    const prem = automod({ body: 'hi', author: { ...newbie, isPremium: true } }, now)
    expect(prem.rules).toEqual(['new_account_24h', 'premium_credit'])
    expect(prem.score).toBe(2)
  })
})
