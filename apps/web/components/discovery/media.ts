import { cdnBase } from '@/lib/config/mirror'
import { getEnv } from '@/lib/env'
import { COVER_HEIGHT, COVER_WIDTH } from './cover'

// Re-exported so server callers keep importing the pair from here; `./cover` holds them so
// client components can size a cover without pulling this module's server imports in.
export { COVER_HEIGHT, COVER_WIDTH }

/**
 * Public URL for a storage key. When the CDN shares the site's origin (the local `fs`
 * driver at `/_storage`), emit a path-only URL so the page works on whichever port serves
 * it; otherwise the absolute CDN URL.
 */
export function mediaUrl(key: string): string {
  const path = key.split('/').map(encodeURIComponent).join('/')
  const base = cdnBase()
  try {
    const cdn = new URL(base)
    const site = new URL(getEnv().SITE_URL)
    if (cdn.origin === site.origin) return `${cdn.pathname.replace(/\/+$/, '')}/${path}`
  } catch {
    // relative PUBLIC_CDN_URL — use as-is
  }
  return `${base}/${path}`
}

/** A cover URL, or a flat placeholder in the series' dominant colour when none is stored. */
export function coverSrc(key: string | null, color: string | null): string {
  if (key) return mediaUrl(key)
  // No dominant colour stored: a transparent rect lets the card's token background
  // (`bg-surface-*`) show through — an <img> data URI cannot read CSS custom properties.
  const fill = color && /^#[0-9a-f]{3,8}$/i.test(color) ? color : 'transparent'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${COVER_WIDTH}" height="${COVER_HEIGHT}"><rect width="100%" height="100%" fill="${fill}"/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
