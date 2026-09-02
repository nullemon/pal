import { getEnv } from '../env'

/**
 * Public URL for a storage key (covers for the auth collage, avatars). Path-only when the
 * CDN shares the site origin (the local fs driver at `/_storage`), so screenshots and
 * previews work on any port.
 */
export const mediaUrl = (key: string): string => {
  const env = getEnv()
  const path = key.split('/').map(encodeURIComponent).join('/')
  const base = env.PUBLIC_CDN_URL.replace(/\/+$/, '')
  try {
    const cdn = new URL(base)
    const site = new URL(env.SITE_URL)
    if (cdn.origin === site.origin) return `${cdn.pathname.replace(/\/+$/, '')}/${path}`
  } catch {
    // relative base
  }
  return `${base}/${path}`
}

export const avatarUrl = (key: string | null | undefined): string | null =>
  key ? mediaUrl(key) : null
