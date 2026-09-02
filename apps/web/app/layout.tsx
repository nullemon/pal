import '@fontsource-variable/archivo'
import '@fontsource-variable/plus-jakarta-sans'
import './globals.css'

import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { ThemeScript } from '@/components/shell/ThemeScript'
import { site } from '@/lib/site'

export const metadata: Metadata = {
  title: { default: site.name, template: `%s · ${site.name}` },
  description: site.tagline,
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
 * paint; pages that need the theme on the server read it themselves via `resolveTheme()`.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className="font-body" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="bg-bg text-fg">{children}</body>
    </html>
  )
}
