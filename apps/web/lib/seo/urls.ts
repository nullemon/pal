import { formatChapterNumber } from '@palscans/core'
import { getEnv } from '../env'

/**
 * URL helpers for everything SEO emits: canonical URLs, sitemap entries, feed links and
 * JSON-LD ids must be absolute and share one host (docs/12 §1, one canonical host).
 */

export const siteOrigin = (): string => new URL(getEnv().SITE_URL).origin

/** Absolute URL for a site path, or an already-absolute URL passed through. */
export const absoluteUrl = (pathOrUrl: string, origin: string = siteOrigin()): string => {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
  return new URL(pathOrUrl, origin).toString()
}

/** Public URL of a storage object key: the dev storage host locally, the CDN on S3/R2. */
export const storagePublicUrl = (key: string | null | undefined): string | null => {
  if (!key) return null
  const safe = key.split('/').map(encodeURIComponent).join('/')
  const env = getEnv()
  if (env.STORAGE_DRIVER === 'fs') return `${siteOrigin()}/_storage/${safe}`
  return `${env.PUBLIC_CDN_URL.replace(/\/+$/, '')}/${safe}`
}

/**
 * Image `src` for in-page use: path-only when the storage host shares the site origin (the
 * local `fs` driver), so the page works on whichever port serves it; the CDN URL otherwise.
 */
export const storageSrc = (key: string | null | undefined): string | null => {
  if (!key) return null
  const safe = key.split('/').map(encodeURIComponent).join('/')
  const env = getEnv()
  if (env.STORAGE_DRIVER === 'fs') return `/_storage/${safe}`
  try {
    const cdn = new URL(env.PUBLIC_CDN_URL)
    if (cdn.origin === siteOrigin()) return `${cdn.pathname.replace(/\/+$/, '')}/${safe}`
  } catch {
    // fall through to the absolute URL
  }
  return `${env.PUBLIC_CDN_URL.replace(/\/+$/, '')}/${safe}`
}

export const seriesPath = (slug: string): string => `/series/${slug}`
export const chapterPath = (slug: string, n: number): string =>
  `/series/${slug}/chapter-${formatChapterNumber(n)}`
export const genrePath = (slug: string): string => `/genres/${slug}`
export const announcementPath = (slug: string): string => `/announcements/${slug}`

export { normalisePath } from './proxy'
