import '@fontsource-variable/archivo'
import '@fontsource-variable/plus-jakarta-sans'
import './globals.css'

import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { ServiceWorker } from '@/components/shell/ServiceWorker'
import { ThemeScript } from '@/components/shell/ThemeScript'
import { AppearanceStyle } from '@/lib/appearance/AppearanceStyle'
import { iconHref } from '@/lib/chrome/icons'
import { brandIcons, siteChrome } from '@/lib/chrome/load'
import { SeoHead } from '@/lib/seo/SeoHead'

/**
 * Titles, the application name and the icons all come from Appearance → Brand (docs/15).
 *
 * `generateMetadata` rather than a static `metadata` object because the site name is now a
 * setting. It stays compatible with prerendering: it reads the same cached settings entry the
 * shell does and nothing request-scoped (see `lib/chrome/load.ts`).
 *
 * Icons fall back to the files in `public/icons/` whenever no monogram has been uploaded, so
 * an unconfigured site links exactly the icons it always did.
 */
export async function generateMetadata(): Promise<Metadata> {
  const [{ brand }, icons] = await Promise.all([siteChrome(), brandIcons()])
  return {
    title: { default: brand.name, template: `%s · ${brand.name}` },
    description: brand.tagline,
    // docs/06 "Mobile specifics" — installable, with the icon iOS uses on the home screen.
    applicationName: brand.name,
    appleWebApp: { capable: true, title: brand.name, statusBarStyle: 'black-translucent' },
    icons: icons
      ? {
          icon: [
            ...(icons.svgUrl ? [{ url: icons.svgUrl, type: 'image/svg+xml' }] : []),
            { url: iconHref(icons.version, 'icon-32.png'), sizes: '32x32', type: 'image/png' },
            { url: iconHref(icons.version, 'icon-192.png'), sizes: '192x192', type: 'image/png' },
          ],
          apple: iconHref(icons.version, 'apple-touch-icon.png'),
        }
      : {
          icon: [
            { url: '/icons/icon.svg', type: 'image/svg+xml' },
            { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          ],
          apple: '/icons/apple-touch-icon.png',
        },
  }
}

export const viewport: Viewport = {
  themeColor: '#100d17',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

/**
 * Static: no `cookies()`/`headers()` here, or every route becomes dynamic (docs/06 wants `/`
 * and the series/chapter pages prerendered). The theme is applied by <ThemeScript> before
 * paint (after <AppearanceStyle>, whose meta tag carries the admin default theme); pages that need the theme on the server read it themselves via `resolveTheme()`.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className="font-body" suppressHydrationWarning>
      <head>
        <AppearanceStyle />
        <ThemeScript />
        {/* P6: Organization/WebSite JSON-LD, sitemap + feed links (cached, never throws) */}
        <SeoHead />
      </head>
      <body className="bg-bg text-fg">
        {children}
        <ServiceWorker />
      </body>
    </html>
  )
}
