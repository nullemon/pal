import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Draft, publish and restore against a real database (docs/15 "Presets, preview, history").
 *
 * Three promises are made to the operator by this feature, and each one is a way to lose
 * their work if it is wrong:
 *
 * 1. **A saved draft does not change the site.** The live `settings` rows must be untouched
 *    until Publish — otherwise the whole exercise is a rename of the Save button.
 * 2. **Restore gives back exactly what was stored.** Byte for byte, not "the fields the form
 *    happens to render"; a version that comes back subtly different is worse than no history.
 * 3. **Nothing configured still means nothing configured.** With no version rows, every read
 *    returns what it returned before any of this existed.
 */

vi.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
  revalidateTag: () => undefined,
  revalidatePath: () => undefined,
}))

/** The bucket, stubbed: `exists` is what the brand publish preflight asks. */
const storage = vi.hoisted(() => ({ present: new Set<string>() }))
vi.mock('@/lib/storage', () => ({
  storageUrl: (key: string) => `/_storage/${key}`,
  getStorage: async () => ({ exists: async (key: string) => storage.present.has(key) }),
}))

process.env.DATABASE_URL = 'pglite://memory'

const {
  closeDb,
  getDb,
  getDbHandle,
  getSetting,
  runMigrations,
  settings,
  appearanceSettings,
  users,
} = await import('@palscans/db')
const { loadScopeState, publishScope, saveDraft, discardDraft, versionWithBase, draftDocument } =
  await import('./versions')
const { scopeAdapter, missingBrandAssets } = await import('./documents')
const { DEFAULT_CHROME } = await import('@/lib/site')

const OPERATOR = 1

beforeAll(async () => {
  await runMigrations(await getDbHandle())
  const db = await getDb()
  await db.insert(users).values({ email: 'operator@palscans.test', username: 'op', role: 'admin' })
}, 180_000)

afterAll(async () => {
  await closeDb()
})

beforeEach(async () => {
  const db = await getDb()
  await db.delete(appearanceSettings)
  await db.delete(settings)
  storage.present = new Set()
})

describe('nothing configured', () => {
  it('reads back the shipped defaults, and reports no draft and no history', async () => {
    const state = await loadScopeState('menus')
    expect(state.draft).toBeNull()
    expect(state.published).toBeNull()
    expect(state.versions).toEqual([])
    expect(state.live.copyright).toBe(DEFAULT_CHROME.copyright)
    expect(state.live.header.map((l) => l.label)).toEqual(DEFAULT_CHROME.header.map((l) => l.label))
  })

  it('leaves the brand document on the shipped name and tagline', async () => {
    const state = await loadScopeState('brand')
    expect(state.live.name).toBe(DEFAULT_CHROME.brand.name)
    expect(state.live.tagline).toBe(DEFAULT_CHROME.brand.tagline)
  })
})

describe('a draft does not touch the live site', () => {
  it('writes one appearance row and no settings row', async () => {
    const db = await getDb()
    const live = await scopeAdapter('menus').live(db)
    await saveDraft('menus', { ...live, copyright: '© Draft only' }, OPERATOR)

    expect(await getSetting<unknown>(db, 'menus', null)).toBeNull()
    const state = await loadScopeState('menus')
    expect(state.draft?.doc.copyright).toBe('© Draft only')
    expect(state.live.copyright).toBe(DEFAULT_CHROME.copyright)
  })

  it('replaces the draft rather than stacking rows', async () => {
    const db = await getDb()
    const live = await scopeAdapter('menus').live(db)
    await saveDraft('menus', { ...live, copyright: '© One' }, OPERATOR)
    await saveDraft('menus', { ...live, copyright: '© Two' }, OPERATOR)
    const state = await loadScopeState('menus')
    expect(state.versions).toHaveLength(1)
    expect(state.draft?.doc.copyright).toBe('© Two')
  })

  it('is gone after a discard, and the site never saw it', async () => {
    const db = await getDb()
    const live = await scopeAdapter('menus').live(db)
    await saveDraft('menus', { ...live, copyright: '© Draft only' }, OPERATOR)
    await discardDraft('menus')
    expect(await draftDocument('menus')).toBeNull()
    expect(await getSetting<unknown>(db, 'menus', null)).toBeNull()
  })

  it('keeps the four screens apart — publishing one leaves the others drafted', async () => {
    const db = await getDb()
    const menus = await scopeAdapter('menus').live(db)
    const brand = await scopeAdapter('brand').live(db)
    await saveDraft('menus', { ...menus, copyright: '© Menus draft' }, OPERATOR)
    await saveDraft('brand', { ...brand, name: 'Draft Name' }, OPERATOR)

    await publishScope('menus', { userId: OPERATOR })

    expect(await getSetting<{ copyright: string }>(db, 'menus', { copyright: '' })).toMatchObject({
      copyright: '© Menus draft',
    })
    // The brand draft is untouched and the site still carries the published name.
    expect((await draftDocument('brand'))?.name).toBe('Draft Name')
    expect(await getSetting<unknown>(db, 'site', null)).toBeNull()
  })
})

describe('publishing', () => {
  it('writes the live row and turns the draft into the published version', async () => {
    const db = await getDb()
    const live = await scopeAdapter('menus').live(db)
    await saveDraft('menus', { ...live, copyright: '© Published now' }, OPERATOR)
    const result = await publishScope('menus', { userId: OPERATOR })
    expect('error' in result).toBe(false)

    const row = await getSetting<{ copyright: string }>(db, 'menus', { copyright: '' })
    expect(row.copyright).toBe('© Published now')
    const state = await loadScopeState('menus')
    expect(state.draft).toBeNull()
    expect(state.published?.doc.copyright).toBe('© Published now')
    expect(state.versions.map((v) => v.status)).toEqual(['published'])
  })

  it('refuses when there is no draft', async () => {
    expect(await publishScope('copy', { userId: OPERATOR })).toEqual({ error: 'no_draft' })
  })

  it('only replaces the two fields Brand owns in `settings.site`', async () => {
    const db = await getDb()
    await db.insert(settings).values({
      key: 'site',
      value: { name: 'Old', tagline: 'Old tagline', maintenance: { enabled: true }, url: 'x' },
    })
    const live = await scopeAdapter('brand').live(db)
    await saveDraft('brand', { ...live, name: 'New', tagline: 'New tagline' }, OPERATOR)
    await publishScope('brand', { userId: OPERATOR })

    expect(await getSetting<Record<string, unknown>>(db, 'site', {})).toEqual({
      name: 'New',
      tagline: 'New tagline',
      maintenance: { enabled: true },
      url: 'x',
    })
  })
})

describe('restoring gives back exactly what was stored', () => {
  it('reproduces the stored document byte for byte', async () => {
    const db = await getDb()
    const base = await scopeAdapter('menus').live(db)
    const v1 = {
      ...base,
      copyright: '© Version one',
      attribution: 'Scanlated by v1',
      header: [{ label: 'One', href: '/one', prefix: false, mobile: true }],
      bottom_nav: ['home', 'browse'] as typeof base.bottom_nav,
    }
    await saveDraft('menus', v1, OPERATOR)
    const first = await publishScope('menus', { userId: OPERATOR })
    if ('error' in first) throw new Error(first.error)

    await saveDraft('menus', { ...base, copyright: '© Version two', header: [] }, OPERATOR)
    await publishScope('menus', { userId: OPERATOR })
    expect(
      (await getSetting<{ copyright: string }>(db, 'menus', { copyright: '' })).copyright,
    ).toBe('© Version two')

    const restored = await publishScope('menus', { userId: OPERATOR, versionId: first.id })
    if ('error' in restored) throw new Error(restored.error)

    // The document that came back, and the row the site now reads, are both exactly v1.
    expect(restored.doc).toEqual(v1)
    expect(await getSetting<unknown>(db, 'menus', null)).toEqual(v1)
  })

  it('leaves the version it replaced in the log rather than resurrecting a row', async () => {
    const db = await getDb()
    const base = await scopeAdapter('copy').live(db)
    await saveDraft('copy', { ...base, copy: { 'browse.empty': 'One' } }, OPERATOR)
    const first = await publishScope('copy', { userId: OPERATOR })
    if ('error' in first) throw new Error(first.error)
    await saveDraft('copy', { ...base, copy: { 'browse.empty': 'Two' } }, OPERATOR)
    await publishScope('copy', { userId: OPERATOR })
    await publishScope('copy', { userId: OPERATOR, versionId: first.id })

    const state = await loadScopeState('copy')
    expect(state.versions).toHaveLength(3)
    expect(state.versions.filter((v) => v.status === 'published')).toHaveLength(1)
    expect(state.published?.doc.copy).toEqual({ 'browse.empty': 'One' })
  })

  it('restores the copy overrides *and* the formatting the version carried', async () => {
    const db = await getDb()
    const base = await scopeAdapter('copy').live(db)
    const v1 = {
      copy: { 'browse.empty': 'Nothing here. Try fewer filters.' },
      formatting: { ...base.formatting, clock: '12h' as const, chapterLabel: 'hash' as const },
    }
    await saveDraft('copy', v1, OPERATOR)
    const first = await publishScope('copy', { userId: OPERATOR })
    if ('error' in first) throw new Error(first.error)
    await saveDraft('copy', { copy: {}, formatting: base.formatting }, OPERATOR)
    await publishScope('copy', { userId: OPERATOR })

    const restored = await publishScope('copy', { userId: OPERATOR, versionId: first.id })
    if ('error' in restored) throw new Error(restored.error)
    expect(restored.doc).toEqual(v1)
    expect(await getSetting<unknown>(db, 'copy', null)).toEqual(v1.copy)
    expect(await getSetting<unknown>(db, 'formatting', null)).toEqual(v1.formatting)
  })

  it('shows what a version changed against the one before it', async () => {
    const db = await getDb()
    const base = await scopeAdapter('menus').live(db)
    await saveDraft('menus', { ...base, copyright: '© One' }, OPERATOR)
    const first = await publishScope('menus', { userId: OPERATOR })
    if ('error' in first) throw new Error(first.error)
    await saveDraft('menus', { ...base, copyright: '© Two' }, OPERATOR)
    const second = await publishScope('menus', { userId: OPERATOR })
    if ('error' in second) throw new Error(second.error)

    expect((await versionWithBase('menus', first.id))?.base).toBeNull()
    const { doc, base: previous } = (await versionWithBase('menus', second.id)) ?? {}
    expect(doc?.copyright).toBe('© Two')
    expect(previous?.copyright).toBe('© One')
  })
})

describe('restoring a brand version whose upload is gone', () => {
  const asset = (key: string) => ({ key, width: 200, height: 60, type: 'image/png' })

  it('is refused rather than restored into a broken mark', async () => {
    const db = await getDb()
    storage.present = new Set(['brand/logo_dark-aaaaaaaaaaaa.png'])
    const live = await scopeAdapter('brand').live(db)
    const withLogo = { ...live, logo_dark: asset('brand/logo_dark-aaaaaaaaaaaa.png') }
    await saveDraft('brand', withLogo, OPERATOR)
    const first = await publishScope('brand', { userId: OPERATOR })
    if ('error' in first) throw new Error(first.error)

    // The object leaves the bucket some time later.
    storage.present = new Set()
    const stored = (await versionWithBase('brand', first.id))?.doc
    expect(stored && (await missingBrandAssets(stored))).toEqual([
      { slot: 'logo_dark', key: 'brand/logo_dark-aaaaaaaaaaaa.png' },
    ])
  })

  it('restores the rest of the document with the slot cleared, when asked to', async () => {
    const db = await getDb()
    storage.present = new Set(['brand/logo_dark-aaaaaaaaaaaa.png'])
    const live = await scopeAdapter('brand').live(db)
    await saveDraft(
      'brand',
      { ...live, name: 'With logo', logo_dark: asset('brand/logo_dark-aaaaaaaaaaaa.png') },
      OPERATOR,
    )
    const first = await publishScope('brand', { userId: OPERATOR })
    if ('error' in first) throw new Error(first.error)
    await saveDraft('brand', { ...live, name: 'Without' }, OPERATOR)
    await publishScope('brand', { userId: OPERATOR })

    storage.present = new Set()
    const stored = (await versionWithBase('brand', first.id))?.doc
    if (!stored) throw new Error('missing version')
    const missing = await missingBrandAssets(stored)
    const restored = await publishScope('brand', {
      userId: OPERATOR,
      versionId: first.id,
      transform: (doc) => ({ ...doc, logo_dark: null }),
    })
    if ('error' in restored) throw new Error(restored.error)

    expect(missing).toHaveLength(1)
    expect(restored.doc.name).toBe('With logo')
    expect(restored.doc.logo_dark).toBeNull()
    expect(await getSetting<{ logo_dark: unknown }>(db, 'brand', { logo_dark: 'x' })).toMatchObject(
      {
        logo_dark: null,
      },
    )
  })

  it('is not refused when the upload is still there', async () => {
    const db = await getDb()
    storage.present = new Set(['brand/monogram-bbbbbbbbbbbb.png'])
    const live = await scopeAdapter('brand').live(db)
    const doc = { ...live, monogram: asset('brand/monogram-bbbbbbbbbbbb.png') }
    expect(await missingBrandAssets(doc)).toEqual([])
  })
})
