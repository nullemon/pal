import { FormatProvider } from '@palscans/ui'
import type { ReactNode } from 'react'
import { CopyProvider } from './context'
import { siteCopySettings } from './settings'

/**
 * Puts Appearance → Copy and Appearance → Formatting in front of the public site's client
 * components (docs/15). Server component: it reads the settings, the two providers below it
 * are the client boundary.
 *
 * Mounted once, in the `(site)` layout, so the header, the home page, the series page, the
 * reader and the comment thread are all under it. The auth pages and the 404 render their
 * copy on the server and need no provider.
 *
 * The read is `unstable_cache`d and tagged `settings`, exactly like the layouts and ads
 * reads the same layout tree already does, so this does not make a static route dynamic.
 */
export async function SiteCopyProvider({ children }: { children: ReactNode }) {
  const { overrides, formatting } = await siteCopySettings()
  return (
    <CopyProvider value={overrides}>
      <FormatProvider value={formatting}>{children}</FormatProvider>
    </CopyProvider>
  )
}
