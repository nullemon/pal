import { messages } from '@palscans/core/messages'
import { ToastProvider } from '@palscans/ui'
import type { Metadata } from 'next'
import { BottomNav } from '@/components/shell/BottomNav'
import { Footer } from '@/components/shell/Footer'
import { Header } from '@/components/shell/Header'
import { NotFoundPanel } from '@/components/shell/NotFoundPanel'

export const metadata: Metadata = {
  title: messages.notFoundPage.title,
  robots: { index: false, follow: true },
}

export default async function NotFound() {
  // Next renders this outside `(site)/layout.tsx` — its markup carries `id="__next_error__"`
  // — so it draws its own chrome. Anything inside the site group is caught by
  // `(site)/not-found.tsx`, which draws none and inherits the layout's.
  return (
    <ToastProvider>
      <Header />
      <main id="main" className="pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
        <NotFoundPanel />
      </main>
      <Footer />
      <BottomNav />
    </ToastProvider>
  )
}
