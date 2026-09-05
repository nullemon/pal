import { messages } from '@palscans/core/messages'
import { Button } from '@palscans/ui'
import { Search } from 'lucide-react'

/**
 * The 404 for anything inside the site group — a missing series, chapter, genre or list.
 *
 * It exists so that `notFound()` from one of those routes is caught *here*, inside
 * `(site)/layout.tsx`, and inherits the header, footer and bottom nav from it. The root
 * `not-found.tsx` is a sibling that Next renders outside this layout (its markup carries
 * `id="__next_error__"`), which is why that one draws its own chrome and this one must not:
 * duplicating it here gave every broken link two navbars and two footers.
 */
export default function SiteNotFound() {
  const m = messages.notFoundPage
  return (
    <div className="container-page pt-10 pb-12">
      <section className="mx-auto flex max-w-[560px] flex-col items-center text-center">
        <div className="font-display text-[88px] font-extrabold leading-none tracking-[-0.04em] text-brand md:text-[120px]">
          {m.code}
        </div>
        <h1 className="mt-2 font-display text-[28px] font-extrabold uppercase leading-8 tracking-[-0.02em] text-fg md:text-[34px]">
          {m.title}
        </h1>
        <p className="mt-3 max-w-[46ch] text-[15px] leading-6 text-fg-muted">
          {messages.errors.notFoundHint}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Button href="/browse" variant="primary">
            {messages.nav.browse}
          </Button>
          <Button href="/search" variant="outline">
            <Search size={15} aria-hidden="true" />
            {messages.nav.search}
          </Button>
        </div>
      </section>
    </div>
  )
}
