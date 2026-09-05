import type { MetadataRoute } from 'next'
import { iconHref } from '@/lib/chrome/icons'
import { brandIcons, siteChrome } from '@/lib/chrome/load'

/**
 * docs/06 "Mobile specifics": `display: standalone`, maskable icons, `theme-color` matched to
 * `--color-bg`, and a share target so a link shared to the installed app opens in it.
 *
 * `start_url` carries a marker so installed launches are distinguishable in the view data
 * from ordinary browser visits.
 *
 * Name, short name and icons come from Appearance → Brand (docs/15); with no monogram
 * uploaded the shipped `public/icons/` files are used, unchanged.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const [{ brand }, icons] = await Promise.all([siteChrome(), brandIcons()])
  return {
    id: '/',
    name: brand.name,
    short_name: brand.name,
    description: brand.tagline,
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    // Matches `--color-bg` in globals.css; a mismatch shows as a flash on launch.
    background_color: '#100d17',
    theme_color: '#100d17',
    categories: ['books', 'entertainment'],
    icons: icons
      ? [
          {
            src: iconHref(icons.version, 'icon-192.png'),
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: iconHref(icons.version, 'icon-512.png'),
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: iconHref(icons.version, 'maskable-192.png'),
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: iconHref(icons.version, 'maskable-512.png'),
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ]
      : [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icons/maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
    shortcuts: [
      { name: 'Browse', url: '/browse' },
      { name: 'My library', url: '/me/bookmarks' },
      { name: 'Downloads', url: '/me/downloads' },
    ],
  }
}
