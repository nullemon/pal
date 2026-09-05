import { ToastProvider } from '@palscans/ui'
import type { ReactNode } from 'react'
import { AnnouncementBar } from '@/components/shell/AnnouncementBar'
import { BottomNav } from '@/components/shell/BottomNav'
import { Footer } from '@/components/shell/Footer'
import { Header } from '@/components/shell/Header'
import { SiteCopyProvider } from '@/lib/copy/SiteCopyProvider'

/**
 * Public-site chrome. Admin and auth route groups render their own layouts. `useToast` works
 * anywhere below.
 *
 * Async now that the header, footer, bottom nav and announcement bar are operator-editable
 * (docs/15). That does not make the routes below dynamic: every one of those components
 * reads the same cached settings entry and nothing request-scoped — see `lib/chrome/load.ts`.
 */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <SiteCopyProvider>
      <ToastProvider>
        <AnnouncementBar />
        <Header />
        <main id="main" className="pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
          {children}
        </main>
        <Footer />
        <BottomNav />
      </ToastProvider>
    </SiteCopyProvider>
  )
}
