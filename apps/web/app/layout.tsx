import '@fontsource-variable/archivo'
import '@fontsource-variable/plus-jakarta-sans'
import './globals.css'

import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { ServiceWorker } from '@/components/shell/ServiceWorker'
import { ThemeScript } from '@/components/shell/ThemeScript'
import { AppearanceStyle } from '@/lib/appearance/AppearanceStyle'
import { SeoHead } from '@/lib/seo/SeoHead'
import { site } from '@/lib/site'

export const metadata: Metadata = {
  title: { default: site.name, template: `%s · ${site.name}` },
  description: site.tagline,
  // docs/06 "Mobile specifics" — installable, with the icon iOS uses on the home screen.
  applicationName: site.name,
  appleWebApp: { capable: true, title: site.name, statusBarStyle: 'black-translucent' },
  icons: {
    icon: [
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
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
