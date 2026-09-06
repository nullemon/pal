import { createHash } from 'node:crypto'
import { announcements, type Db, genres, getDb, redirects, series, slugHistory } from '@palscans/db'
import { and, eq, isNull, ne, not, type SQL, sql } from 'drizzle-orm'
import { unstable_cache } from 'next/cache'
import { readAccessSetting } from '../auth/invites'
import { getEnv } from '../env'
import type { ProxySnapshot } from './proxy'
import { loadSeoSettings } from './settings'

/**
 * The rules proxy.ts applies, read from the database in one place and served by
 * /api/seo/snapshot. The proxy (Node runtime, but kept free of database imports so it stays
 * small and always boots) fetches this over loopback and caches it for 60s.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0'])

/**
 * A series a reader can still reach. Its negation is exactly the `gone` set (docs/12 §10:
 * 410 for removed series), so the two are written once and cannot drift apart — a slug that
 * 410s must never also be the target of a 301.
 */
const isLive = and(ne(series.state, 'removed'), isNull(series.deletedAt)) as SQL

export async function loadProxySnapshot(db?: Db): Promise<ProxySnapshot> {
  const database = db ?? (await getDb())
  const env = getEnv()
  const settings = await loadSeoSettings(database)
  // The proxy needs the staff path and the panel allowlist, and it must not import the
  // database itself — so they ride along in the same 60s snapshot as the SEO rules.
  const access = await readAccessSetting()

  const [rules, seriesSlugs, genreSlugs, announcementSlugs, goneRows] = await Promise.all([
    database
      .select({ from: redirects.fromPath, to: redirects.toPath, status: redirects.status })
      .from(redirects)
      .where(isNull(redirects.deletedAt)),
    database
      .select({ old: slugHistory.oldSlug, current: series.slug })
      .from(slugHistory)
      .innerJoin(series, eq(series.id, slugHistory.entityId))
      // Same rule as the genres below, for the same reason: history that lands on a series
      // nobody can reach is a 301 into a dead end. A removed or trashed series answers 410
      // (it is in `gone`), so the old slug would 301 to a 410 — two requests to say what one
      // can. Its old slugs are added to `gone` instead, just below, and answer 410 directly.
      .where(and(eq(slugHistory.entityType, 'series'), isLive)),
    database
      .select({ old: slugHistory.oldSlug, current: genres.slug })
      .from(slugHistory)
      .innerJoin(genres, eq(genres.id, slugHistory.entityId))
      // History that lands on a retired genre would 301 an old URL to a 404. A merge
      // repoints the loser's history at the winner (queries/genres.ts), so only a genre
      // deleted outright falls out here — and its old slugs then 404 directly.
      .where(and(eq(slugHistory.entityType, 'genre'), isNull(genres.deletedAt))),
    database
      .select({ old: slugHistory.oldSlug, current: announcements.slug })
      .from(slugHistory)
      .innerJoin(announcements, eq(announcements.id, slugHistory.entityId))
      .where(eq(slugHistory.entityType, 'announcement')),
    // Everything under /series/ that must answer 410: the current slug of every removed or
    // trashed series, and every slug it used to have. The left join is what carries the old
    // ones — without them an old URL falls through to a bare 404, which tells a crawler far
    // less than "this is gone" and keeps it coming back.
    database
      .select({ slug: series.slug, old: slugHistory.oldSlug })
      .from(series)
      .leftJoin(
        slugHistory,
        and(eq(slugHistory.entityId, series.id), eq(slugHistory.entityType, 'series')),
      )
      .where(not(isLive)),
  ])

  const host = new URL(env.SITE_URL).hostname.toLowerCase()
  const toMap = (rows: { old: string; current: string }[]) =>
    Object.fromEntries(rows.map((r) => [r.old.toLowerCase(), r.current]))
  const gone = new Set<string>()
  for (const row of goneRows) {
    gone.add(row.slug.toLowerCase())
    if (row.old) gone.add(row.old.toLowerCase())
  }

  return {
    canonicalHost: LOCAL_HOSTS.has(host) || host.startsWith('www.') ? null : host,
    indexable: settings.indexing.site,
    redirects: Object.fromEntries(
      rules.map((r) => [r.from, { to: r.to, status: r.status === 302 ? 302 : 301 }]),
    ),
    slugs: {
      series: toMap(seriesSlugs),
      genre: toMap(genreSlugs),
      announcement: toMap(announcementSlugs),
    },
    gone: [...gone],
    indexnowKey: settings.sitemap.indexnow_key,
    staffPath: access.staff_path,
    panelIps: access.panel_ips,
  }
}

export const cachedProxySnapshot = unstable_cache(
  () => loadProxySnapshot(),
  ['seo', 'proxy_snapshot'],
  { revalidate: 60, tags: ['settings', 'seo', 'redirects'] },
)

/** Count a redirect hit (docs/12 §8: hit counts so dead rules can be pruned). */
export async function recordRedirectHit(fromPath: string, db?: Db): Promise<void> {
  const database = db ?? (await getDb())
  await database
    .update(redirects)
    .set({ hits: sql`${redirects.hits} + 1` })
    .where(and(eq(redirects.fromPath, fromPath)))
}

/** A token the proxy sends on internal calls, derived from the session secret. */
export const proxyToken = (secret: string = getEnv().SESSION_SECRET): string =>
  createHash('sha256').update(`proxy:${secret}`).digest('hex')
