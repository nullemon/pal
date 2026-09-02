import { messages } from '@palscans/core/messages'
import { ToastProvider } from '@palscans/ui'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Wordmark } from '@/components/shell/Wordmark'
import { Collage, loadCollageCovers } from './_components/Collage'

/**
 * Auth chrome: form on the left, a drifting collage of catalogue covers on the right
 * (desktop); stacked with a short cover strip on mobile. No header/footer — the wordmark
 * and a "back" link are the only way out. Dynamic (every page here reads cookies).
 */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const covers = await loadCollageCovers()
  return (
    <ToastProvider>
      <div className="grid min-h-dvh grid-rows-[auto_1fr] bg-bg lg:grid-cols-[minmax(0,560px)_1fr] lg:grid-rows-1">
        <div className="order-first min-w-0 overflow-hidden lg:sticky lg:top-0 lg:order-last lg:h-dvh">
          <Collage covers={covers} />
        </div>
        <div className="flex min-w-0 flex-col px-5 py-6 sm:px-10 lg:min-h-dvh lg:px-14 lg:py-10">
          <div className="flex items-center justify-between">
            <Wordmark />
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-fg-muted transition-colors hover:text-fg"
            >
              <ArrowLeft size={14} aria-hidden="true" />
              {messages.authPage.backToSite}
            </Link>
          </div>
          <main id="main" className="flex flex-1 flex-col justify-center py-10 lg:py-14">
            <div className="mx-auto w-full max-w-[400px]">{children}</div>
          </main>
          <p className="text-[12px] text-fg-subtle">{messages.site.copyright}</p>
        </div>
      </div>
    </ToastProvider>
  )
}
