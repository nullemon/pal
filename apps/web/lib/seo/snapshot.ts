import { createHash } from 'node:crypto'
import { announcements, type Db, genres, getDb, redirects, series, slugHistory } from '@palscans/db'
import { and, eq, isNotNull, isNull, or, sql } from 'drizzle-orm'
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

export async function loadProxySnapshot(db?: Db): Promise<ProxySnapshot> {
  const database = db ?? (await getDb())
  const env = getEnv()
  const settings = await loadSeoSettings(database)
  // The proxy needs the staff path and the panel allowlist, and it must not import the
  // database itself — so they ride along in the same 60s snapshot as the SEO rules.
  const access = await readAccessSetting()

  const [rules, seriesSlugs, genreSlugs, announcementSlugs, removed] = await Promise.all([
    database
      .select({ from: redirects.fromPath, to: redirects.toPath, status: redirects.status })
      .from(redirects)
      .where(isNull(redirects.deletedAt)),
    database
      .select({ old: slugHistory.oldSlug, current: series.slug })
      .from(slugHistory)
      .innerJoin(series, eq(series.id, slugHistory.entityId))
      .where(eq(slugHistory.entityType, 'series')),
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
    database
      .select({ slug: series.slug })
      .from(series)
      .where(or(eq(series.state, 'removed'), isNotNull(series.deletedAt))),
  ])

  const host = new URL(env.SITE_URL).hostname.toLowerCase()
  const toMap = (rows: { old: string; current: string }[]) =>
    Object.fromEntries(rows.map((r) => [r.old.toLowerCase(), r.current]))

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
    gone: removed.map((r) => r.slug.toLowerCase()),
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
