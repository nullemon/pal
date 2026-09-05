import { ToastProvider } from '@palscans/ui'
import type { ReactNode } from 'react'
import { BottomNav } from '@/components/shell/BottomNav'
import { Footer } from '@/components/shell/Footer'
import { Header } from '@/components/shell/Header'
import { SiteCopyProvider } from '@/lib/copy/SiteCopyProvider'

/** Public-site chrome. Admin and auth route groups render their own layouts. `useToast` works anywhere below. */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <SiteCopyProvider>
      <ToastProvider>
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
