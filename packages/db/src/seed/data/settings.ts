import { DEFAULT_SEO_TEMPLATES } from '@palscans/core'

/** settings.layouts — docs/04 Appearance → Layouts. */
export const LAYOUTS = { home: 'A', series: 'B', reader: { default_mode: 'strip' } }

/** settings.ads — reader ad switches (docs/04, docs/11). */
export const ADS = {
  reader: { skyscrapers: true, sky_size: '160x600', mobile_interval: 4, end_slot: true },
  slots: {
    home_top: { enabled: true, tag: null },
    home_sidebar: { enabled: true, tag: null },
    home_infeed: { enabled: true, tag: null },
    series_top: { enabled: true, tag: null },
    series_sidebar: { enabled: true, tag: null },
    reader_end: { enabled: true, tag: null },
    mobile_anchor: { enabled: true, tag: null },
  },
}

/**
 * settings.entitlements — docs/17 §B `Admin → Business → Premium`. Every feature ships on
 * `premium` (today's behaviour); the operator flips one to `free` / `disabled`, or throws
 * the `all_free` master switch with an optional `free_until` window.
 */
export const ENTITLEMENTS = {
  all_free: false,
  free_until: null,
  features: {
    early_access: 'premium',
    premium_content: 'premium',
    offline: 'premium',
    no_ads: 'premium',
    priority_comments: 'premium',
    see_reactors: 'premium',
    custom_gifs: 'premium',
    animated_avatar: 'premium',
    profile_banner: 'premium',
  },
}

/** settings.comments and comment_settings — docs/14 §3 defaults. */
export const COMMENTS = {
  enabled: true,
  require_verified_email: true,
  min_account_age_minutes: 10,
  hold_links: true,
  hold_new_accounts_hours: 24,
  hold_new_accounts_first_n: 3,
  images: { collection: true, custom_gifs: 'premium' },
  max_mentions: 5,
  edit_window_minutes: 15,
  collapse_threshold: -5,
  rate_limits: { per_minute: 5, per_hour: 60, new_per_minute: 2, new_per_hour: 20 },
  automod: { hold: 6, shadow: 10 },
  auto_lock_days: null,
  report_threshold: { unique: 5, premium: 2 },
  lockdown: false,
}

/** The community links, shared by `MENUS` and the SEO `same_as` list so they cannot drift. */
export const SOCIALS = {
  x: 'https://x.com/palscans',
  instagram: 'https://instagram.com/palscans',
  reddit: 'https://reddit.com/r/palscans',
  youtube: 'https://youtube.com/@palscans',
  facebook: 'https://facebook.com/palscans',
}

export const DISCORD_URL = 'https://discord.gg/palscans'

/**
 * settings.site — the identity row Admin → Settings writes and the site header, footer and
 * page titles read (docs/15 "Brand and identity"). The chrome's links live in `MENUS`; this
 * row is the name, the tagline, the address and the two operating switches.
 */
export const SITE = {
  name: 'PALScans',
  tagline: 'Read manhwa, manga and manhua, updated daily.',
  url: 'https://palscans.org',
  discord_url: DISCORD_URL,
  registration: 'open',
  maintenance: { enabled: false, eta: null },
  formatting: {
    relative_times: 'both',
    clock: '24h',
    compact_numbers: true,
    chapter_label: 'short',
    week_starts: 'monday',
  },
}

/** settings.home_layout — docs/13 homepage sections editor. */
export const HOME_LAYOUT = {
  hero: { enabled: true, style: 'carousel', count: 6 },
  sections: [
    { id: 'continue', enabled: true, title: 'Continue reading', count: 8 },
    { id: 'trending', enabled: true, title: 'Trending', count: 12 },
    { id: 'latest', enabled: true, title: 'Latest updates', count: 20 },
    { id: 'popular', enabled: true, title: 'Popular', count: 10 },
    { id: 'recently_added', enabled: true, title: 'Recently added', count: 12 },
    { id: 'recently_completed', enabled: false, title: 'Recently completed', count: 12 },
    { id: 'announcements', enabled: true, title: 'Announcements', count: 1 },
  ],
}

/**
 * settings.menus — Appearance → Header, footer, menus (docs/15).
 *
 * The shipped chrome, written out as data. It has to stay identical to `DEFAULT_CHROME` in
 * apps/web/lib/site.ts: a freshly seeded site and a site with no row at all must look the
 * same, and this row is the one that would silently make them differ. Change both together.
 */
export const MENUS = {
  header: [
    { label: 'Home', href: '/', prefix: false, mobile: false },
    { label: 'Browse', href: '/browse', prefix: true, mobile: false },
    { label: 'Rankings', href: '/rankings', prefix: true, mobile: false },
    { label: 'Genres', href: '/genres', prefix: true, mobile: false },
    { label: 'Bookmarks', href: '/me/bookmarks', prefix: true, mobile: false },
  ],
  primary_button: { enabled: true, label: 'Premium', href: '/subscribe' },
  footer: [
    {
      title: 'Browse',
      links: [
        { label: 'Latest updates', href: '/?sort=latest' },
        { label: 'Popular', href: '/rankings' },
        { label: 'Genres', href: '/genres' },
        { label: 'Rankings', href: '/rankings' },
        { label: 'Random', href: '/random' },
        { label: 'Announcements', href: '/announcements' },
        { label: 'Requests', href: '/requests' },
      ],
    },
    {
      title: 'Account',
      links: [
        { label: 'Bookmarks', href: '/me/bookmarks' },
        { label: 'Reading history', href: '/me/history' },
        { label: 'Lists', href: '/me/lists' },
        { label: 'Stats', href: '/me/stats' },
        { label: 'Notifications', href: '/me/settings#notifications' },
        { label: 'PALScans Premium', href: '/subscribe' },
      ],
    },
    {
      title: 'Legal',
      links: [
        { label: 'DMCA', href: '/dmca' },
        { label: 'Terms of service', href: '/terms' },
        { label: 'Privacy policy', href: '/privacy' },
        { label: 'Contact', href: '/contact' },
        { label: 'Status', href: '/status' },
      ],
    },
  ],
  bottom_nav: ['home', 'browse', 'bookmarks', 'profile'],
  community: {
    discord_url: DISCORD_URL,
    socials: SOCIALS,
    support: { patreon: null, kofi: null, buymeacoffee: null },
    rss: false,
  },
  copyright: '© 2026 PALScans. All series belong to their respective authors and publishers.',
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
}

/** seo_settings rows — docs/12 §2, §5–§8. */
export const SEO: Record<string, unknown> = {
  identity: {
    site_name: 'PALScans',
    separator: '·',
    default_description:
      'Read the latest manhwa, manga and manhua chapters on PALScans, updated daily. Free, fast, mobile-friendly.',
    default_og_image_key: null,
    logo_key: null,
    x_handle: '@palscans',
    same_as: Object.values(SOCIALS).concat(DISCORD_URL),
  },
  templates: DEFAULT_SEO_TEMPLATES,
  sitemap: {
    enabled: true,
    custom_url: null,
    sections: ['series', 'chapters', 'genres', 'announcements', 'images', 'pages'],
    include_unlisted: false,
    chapters_per_file: 20000,
    indexnow_key: null,
  },
  feeds: { enabled: true, custom_url: null, items: 50, include_early_access: false },
  indexing: { site: true, chapters: true, profiles: false, browse_filters: false },
  verification: { google: null, bing: null, yandex: null, pinterest: null },
  robots: { custom: null, disallow_ai: false },
}

/** Dark tokens from docs/16 (the chosen A/B palette) and the light block from docs/05. */
export const DARK_TOKENS: Record<string, string> = {
  '--color-bg': '#100d17',
  '--color-surface-1': '#181423',
  '--color-surface-2': '#1f1a2c',
  '--color-surface-3': '#26203a',
  '--color-line': '#2c2540',
  '--color-line-soft': '#221d33',
  '--color-fg': '#ece9f4',
  '--color-fg-muted': '#9e97b8',
  '--color-fg-subtle': '#6f6890',
  '--color-brand': '#7c3aed',
  '--color-brand-hover': '#8b5cf6',
  '--color-brand-dim': '#4c2a8f',
  '--color-brand-wash': 'rgb(124 58 237 / 0.14)',
  '--color-brand-ink': '#ffffff',
  '--color-gold': '#f5c451',
  '--color-ok': '#22c55e',
  '--color-warn': '#f59e0b',
  '--color-danger': '#ef4444',
  '--color-type-manhwa': '#e5484d',
  '--color-type-manhua': '#12a594',
  '--color-type-manga': '#3b82f6',
  '--color-type-comic': '#a78bfa',
  '--color-status-ongoing': '#3b82f6',
  '--color-status-completed': '#22c55e',
  '--color-status-hiatus': '#f59e0b',
  '--color-status-cancelled': '#6f6890',
  '--font-display': '"Archivo Variable", ui-sans-serif, system-ui, sans-serif',
  '--font-body': '"Plus Jakarta Sans Variable", ui-sans-serif, system-ui, sans-serif',
  '--radius-sm': '4px',
  '--radius-md': '8px',
  '--radius-lg': '14px',
}

export const LIGHT_TOKENS: Record<string, string> = {
  '--color-bg': 'oklch(0.985 0.004 300)',
  '--color-surface-1': 'oklch(1 0 300)',
  '--color-surface-2': 'oklch(0.968 0.006 300)',
  '--color-surface-3': 'oklch(0.94 0.01 300)',
  '--color-line': 'oklch(0.89 0.012 300)',
  '--color-line-soft': 'oklch(0.935 0.008 300)',
  '--color-fg': 'oklch(0.2 0.02 300)',
  '--color-fg-muted': 'oklch(0.45 0.022 300)',
  '--color-fg-subtle': 'oklch(0.58 0.02 300)',
  '--color-brand': 'oklch(0.51 0.21 300)',
  '--color-brand-wash': 'oklch(0.96 0.03 300)',
}

export const APPEARANCE = {
  version: 1,
  // Brand and identity are not part of this document: they live in `settings.site` and
  // `settings.brand`, edited by Appearance -> Brand (docs/15).
  color: {
    accent: '#7c3aed',
    secondary: '#f5c451',
    surface_tint: 0.02,
    type: { manhwa: '#e5484d', manhua: '#12a594', manga: '#3b82f6', comic: '#a78bfa' },
    status: { ongoing: '#3b82f6', completed: '#22c55e', hiatus: '#f59e0b', cancelled: '#6f6890' },
  },
  theme: { default: 'dark', allow_switch: true, reader_background: 'dark', no_shimmer: false },
  typography: {
    display: 'Archivo Variable',
    body: 'Plus Jakarta Sans Variable',
    base_size: 16,
    heading_weight: 800,
    pairing: 'Bold condensed + humanist',
  },
  shape: {
    radius: 'soft',
    card_style: 'flat',
    density: 'comfortable',
    cover_grid: 'title-below',
    cover_aspect: '2:3',
    badges: { rating: true, type: true, new_hours: 24 },
  },
  layout: {
    home: 'A',
    series: 'B',
    hero: 'carousel',
    hero_count: 6,
    series_banner: 'blurred-cover',
    chapter_sort: 'desc',
    sidebar: true,
  },
  reader: {
    default_mode: 'strip',
    skyscrapers: true,
    sky_size: '160x600',
    mobile_interval: 4,
    end_slot: true,
    page_gap: 0,
    preload: 3,
  },
  copy: {
    hero_eyebrow: 'Featured',
    empty_bookmarks: 'No bookmarks yet — start with Trending.',
    login_tagline: 'Welcome back. Your bookmarks are waiting.',
    not_found: 'That page could not be found.',
  },
  tokens: { dark: DARK_TOKENS, light: LIGHT_TOKENS },
}

const block = (selector: string, tokens: Record<string, string>) =>
  `${selector}{${Object.entries(tokens)
    .map(([k, v]) => `${k}:${v}`)
    .join(';')}}`

/** The CSS custom-property block the shell inlines in <head> (docs/15 "How it works"). */
export const resolveCss = (dark: Record<string, string>, light: Record<string, string>): string =>
  `${block(':root', dark)}\n${block(':root[data-theme="light"]', light)}`
