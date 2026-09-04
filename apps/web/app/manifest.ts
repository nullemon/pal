import type { MetadataRoute } from 'next'
import { site } from '@/lib/site'

/**
 * docs/06 "Mobile specifics": `display: standalone`, maskable icons, `theme-color` matched to
 * `--color-bg`, and a share target so a link shared to the installed app opens in it.
 *
 * `start_url` carries a marker so installed launches are distinguishable in the view data
 * from ordinary browser visits.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: site.name,
    short_name: site.name,
    description: site.tagline,
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    // Matches `--color-bg` in globals.css; a mismatch shows as a flash on launch.
    background_color: '#100d17',
    theme_color: '#100d17',
    categories: ['books', 'entertainment'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Browse', url: '/browse' },
      { name: 'My library', url: '/me/bookmarks' },
      { name: 'Downloads', url: '/me/downloads' },
    ],
  }
}
