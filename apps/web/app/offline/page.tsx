import { messages } from '@palscans/core/messages'
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { OfflineReader } from './OfflineReader'

export const metadata: Metadata = {
  title: messages.me.downloads.title,
  // A cached shell must never be indexed: its body is empty until the browser fills it.
  robots: { index: false, follow: false },
}

/**
 * The offline shell. Static on purpose — the service worker caches this exact document and
 * serves it for any navigation the network refuses, so it must not depend on a request,
 * a session or the database.
 */
export const dynamic = 'force-static'

export default function OfflinePage() {
  // `useSearchParams` in a statically rendered page needs a boundary; the fallback is never
  // seen in practice because the client resolves the param in the same tick it hydrates.
  return (
    <Suspense fallback={null}>
      <OfflineReader />
    </Suspense>
  )
}
