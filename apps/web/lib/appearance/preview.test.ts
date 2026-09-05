import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * **The one that must not break: an unpublished draft never reaches a reader.**
 *
 * Preview works by rendering a different document for one viewer, on the site's own URLs.
 * Two things stand between that and a draft header appearing for the public, and both are
 * asserted here rather than assumed:
 *
 * 1. Next's draft mode is off — which it is during every prerender and for every request
 *    that does not carry the `__prerender_bypass` cookie — so nothing else is even read.
 * 2. The session is re-checked on the render. A viewer holding both cookies but without
 *    `settings.write` sees what is published.
 *
 * The second test group runs the real `siteChrome()` over the real resolver with the draft
 * documents mocked, because "the gate returns an empty list" is only interesting if the
 * thing behind the gate honours it.
 */

const state = vi.hoisted(() => ({
  draftEnabled: false,
  cookie: undefined as string | undefined,
  user: null as { id: number; role: string; permissions: string[] } | null,
  rows: {} as Record<string, unknown>,
  drafts: {} as Record<string, unknown>,
  loads: 0,
}))

vi.mock('next/headers', () => ({
  draftMode: async () => ({ isEnabled: state.draftEnabled }),
  cookies: async () => ({ get: (name: string) => (name ? { value: state.cookie } : undefined) }),
}))

vi.mock('next/cache', () => ({
  // The data cache needs a Next request to hang on; calling through is not the rule under test.
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  revalidateTag: () => undefined,
  revalidatePath: () => undefined,
}))

vi.mock('@/lib/auth', () => ({ getSessionUser: async () => state.user }))

vi.mock('@palscans/db', () => ({
  getDb: async () => ({}),
  getSetting: async <T>(_db: unknown, key: string, fallback: T) =>
    (key in state.rows ? state.rows[key] : fallback) as T,
}))

vi.mock('@/lib/config/install', () => ({ ensureConfig: async () => undefined }))
vi.mock('@/lib/storage', () => ({ storageUrl: (key: string) => `/_storage/${key}` }))

vi.mock('@/lib/appearance/versions', () => ({
  draftDocuments: async (scopes: readonly string[]) => {
    state.loads += 1
    return Object.fromEntries(
      scopes.filter((s) => s in state.drafts).map((s) => [s, state.drafts[s]]),
    )
  },
}))

const { previewScopes } = await import('./preview')
const { siteChrome } = await import('@/lib/chrome/load')
const { DEFAULT_CHROME } = await import('@/lib/site')

const STAFF = { id: 1, role: 'admin', permissions: ['settings.write'] }
const READER = { id: 2, role: 'user', permissions: [] }

beforeEach(() => {
  state.draftEnabled = false
  state.cookie = undefined
  state.user = null
  state.rows = {}
  state.drafts = {}
  state.loads = 0
})

describe('who is previewing', () => {
  it('is nobody, on a request with no draft mode — the prerender case', async () => {
    state.cookie = 'brand.menus'
    state.user = STAFF
    expect(await previewScopes()).toEqual([])
  })

  it('is nobody for an anonymous visitor, even holding both cookies', async () => {
    state.draftEnabled = true
    state.cookie = 'brand.menus'
    state.user = null
    expect(await previewScopes()).toEqual([])
  })

  it('is nobody for a signed-in reader, even holding both cookies', async () => {
    state.draftEnabled = true
    state.cookie = 'brand.menus'
    state.user = READER
    expect(await previewScopes()).toEqual([])
  })

  it('is the staff member who asked, for the scopes they asked for', async () => {
    state.draftEnabled = true
    state.cookie = 'brand.menus'
    state.user = STAFF
    expect(await previewScopes()).toEqual(['brand', 'menus'])
  })

  it('drops a scope name it does not recognise rather than trusting the cookie', async () => {
    state.draftEnabled = true
    state.cookie = 'brand.__proto__.everything'
    state.user = STAFF
    expect(await previewScopes()).toEqual(['brand'])
  })

  it('is nobody when the session store throws — a failure closes the gate', async () => {
    state.draftEnabled = true
    state.cookie = 'brand'
    Object.defineProperty(state, 'user', {
      get() {
        throw new Error('redis is away')
      },
      configurable: true,
    })
    await expect(previewScopes()).resolves.toEqual([])
    Object.defineProperty(state, 'user', { value: null, writable: true, configurable: true })
  })
})

describe('what the site actually renders', () => {
  const draftMenus = {
    ...structuredClone(DEFAULT_CHROME),
    header: [{ label: 'Secret section', href: '/secret', prefix: false, mobile: true }],
  }

  beforeEach(() => {
    state.rows = {
      menus: {
        header: [{ label: 'Browse', href: '/browse', prefix: true, mobile: true }],
        primary_button: { enabled: true, label: 'Premium', href: '/subscribe' },
        footer: [],
        bottom_nav: ['home'],
        community: {
          discord_url: null,
          socials: { x: null, instagram: null, reddit: null, youtube: null, facebook: null },
          support: { patreon: null, kofi: null, buymeacoffee: null },
          rss: false,
        },
        copyright: '© Published',
        attribution: null,
        announcement: {
          enabled: false,
          text: '',
          tone: 'info',
          starts_at: null,
          ends_at: null,
          audience: 'everyone',
          dismissible: true,
        },
      },
    }
    state.drafts = { menus: { ...draftMenus, copyright: '© Draft' } }
  })

  it('serves the published header to an anonymous visitor with the preview cookie', async () => {
    state.draftEnabled = false
    state.cookie = 'menus'
    state.user = null
    const chrome = await siteChrome()
    expect(chrome.header.map((l) => l.label)).toEqual(['Browse'])
    expect(chrome.copyright).toBe('© Published')
    // …and did not even look for a draft.
    expect(state.loads).toBe(0)
  })

  it('serves the published header to a reader who has both cookies', async () => {
    state.draftEnabled = true
    state.cookie = 'menus'
    state.user = READER
    const chrome = await siteChrome()
    expect(chrome.copyright).toBe('© Published')
    expect(state.loads).toBe(0)
  })

  it('serves the draft to staff who asked for it', async () => {
    state.draftEnabled = true
    state.cookie = 'menus'
    state.user = STAFF
    const chrome = await siteChrome()
    expect(chrome.copyright).toBe('© Draft')
    expect(chrome.header.map((l) => l.label)).toEqual(['Secret section'])
  })

  it('previews only the scope that was asked for', async () => {
    state.draftEnabled = true
    state.cookie = 'brand'
    state.user = STAFF
    state.drafts = { brand: undefined as never, menus: { ...draftMenus, copyright: '© Draft' } }
    const chrome = await siteChrome()
    expect(chrome.copyright).toBe('© Published')
  })

  it('renders exactly the shipped chrome when nothing is configured at all', async () => {
    state.rows = {}
    state.drafts = {}
    state.draftEnabled = false
    expect(await siteChrome()).toEqual(DEFAULT_CHROME)
  })
})
