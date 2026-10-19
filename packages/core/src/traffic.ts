/**
 * Where a visit came from (docs/13).
 *
 * Aggregate only, and that is the design rather than a limitation: a row here is a day, a
 * source and a count. There is no visitor in it, nothing to join back to a person, and
 * nothing that becomes a browsing history if the database is read by someone it should not
 * be. The site's rule is no logs, and a counter is not a log.
 *
 * What it answers is the question actually worth asking — "are these readers coming from
 * the post on X, or from Discord, or from search?" — which is a property of the traffic,
 * not of any one reader.
 */

/** A source bucket. Narrow on purpose: a hundred referrer hosts is not a report. */
export type TrafficSource =
  | 'x'
  | 'discord'
  | 'reddit'
  | 'google'
  | 'bing'
  | 'duckduckgo'
  | 'yandex'
  | 'facebook'
  | 'instagram'
  | 'tiktok'
  | 'youtube'
  | 'telegram'
  | 'pinterest'
  | 'mangaupdates'
  | 'direct'
  | 'other'
  /** Another page of this site. Counted nowhere — see `isCountableSource`. */
  | 'internal'

/**
 * Host suffixes, longest-first within each entry so `t.co` cannot be mistaken for `.co`.
 *
 * Matched on the registrable tail rather than by equality because every one of these has a
 * country variant, a shortener or a mobile host: `google.de`, `m.facebook.com`, `t.co`,
 * `discord.gg`, `fb.me`, `youtu.be`.
 */
const HOSTS: ReadonlyArray<[TrafficSource, readonly string[]]> = [
  ['x', ['x.com', 'twitter.com', 't.co']],
  ['discord', ['discord.com', 'discord.gg', 'discordapp.com']],
  ['reddit', ['reddit.com', 'redd.it']],
  ['google', ['google.', 'googleusercontent.com']],
  ['bing', ['bing.com']],
  ['duckduckgo', ['duckduckgo.com']],
  ['yandex', ['yandex.']],
  ['facebook', ['facebook.com', 'fb.me', 'fb.com']],
  ['instagram', ['instagram.com']],
  ['tiktok', ['tiktok.com']],
  ['youtube', ['youtube.com', 'youtu.be']],
  ['telegram', ['telegram.org', 't.me']],
  ['pinterest', ['pinterest.', 'pin.it']],
  ['mangaupdates', ['mangaupdates.com']],
]

/** What the admin panel calls each one. */
export const TRAFFIC_SOURCE_LABELS: Record<TrafficSource, string> = {
  x: 'X / Twitter',
  discord: 'Discord',
  reddit: 'Reddit',
  google: 'Google',
  bing: 'Bing',
  duckduckgo: 'DuckDuckGo',
  yandex: 'Yandex',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  telegram: 'Telegram',
  pinterest: 'Pinterest',
  mangaupdates: 'MangaUpdates',
  direct: 'Direct / app',
  other: 'Other sites',
  internal: 'Within the site',
}

/**
 * The `?ref=` tag on a link, normalised.
 *
 * Lowercase, short, and only the characters a hand-written campaign tag needs. It is the
 * one free-text field that reaches the database, so it is also the one that has to be
 * bounded: `?ref=` with a kilobyte of junk in it is a row per attempt otherwise.
 */
export const CAMPAIGN_MAX = 32

export const normaliseCampaign = (value: string | null | undefined): string => {
  if (!value) return ''
  const clean = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
  return clean.slice(0, CAMPAIGN_MAX)
}

const hostOf = (referrer: string | null | undefined): string | null => {
  if (!referrer) return null
  try {
    const host = new URL(referrer).hostname.toLowerCase()
    return host.startsWith('www.') ? host.slice(4) : host
  } catch {
    return null
  }
}

export interface TrafficHit {
  source: TrafficSource
  campaign: string
}

/**
 * Bucket one visit.
 *
 * The referrer decides the source and `?ref=` is carried alongside rather than instead of
 * it: the two answer different questions. "Discord" is where the click came from; "x-bio"
 * is which link was clicked. Keeping both means a link posted in two places can still be
 * told apart, and a source with no tag is still counted.
 *
 * A referrer from this site is `internal` — a reader moving between chapters is not a new
 * visit from anywhere, and counting it would bury every real source under the site itself.
 */
export const classifyTraffic = (
  referrer: string | null | undefined,
  ref: string | null | undefined,
  selfHost: string,
): TrafficHit => {
  const campaign = normaliseCampaign(ref)
  const host = hostOf(referrer)
  if (host === null) return { source: 'direct', campaign }
  const self = selfHost.toLowerCase().replace(/^www\./, '')
  if (host === self || host.endsWith(`.${self}`)) return { source: 'internal', campaign }
  for (const [source, suffixes] of HOSTS) {
    for (const suffix of suffixes) {
      // A suffix written with a trailing dot matches anywhere a label boundary allows:
      // `google.` covers google.de, google.co.uk and news.google.com, which is forty
      // country hosts and their subdomains without forty entries. Everything else matches
      // the registrable tail, so `x.com` catches `mobile.x.com` and `evil-x.com` neither.
      const hit = suffix.endsWith('.')
        ? host.startsWith(suffix) || host.includes(`.${suffix}`)
        : host === suffix || host.endsWith(`.${suffix}`)
      if (hit) return { source, campaign }
    }
  }
  return { source: 'other', campaign }
}

/** Internal referrals are classified so they can be recognised, then dropped. */
export const isCountableSource = (source: TrafficSource): boolean => source !== 'internal'
