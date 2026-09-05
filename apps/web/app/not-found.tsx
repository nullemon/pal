import { messages } from '@palscans/core/messages'
import { getDb, type PopularItem, popular } from '@palscans/db'
import { buttonClasses, SeriesCard, type SeriesType, ToastProvider } from '@palscans/ui'
import { Compass, Search } from 'lucide-react'
import type { Metadata } from 'next'
import { unstable_cache } from 'next/cache'
import { BottomNav } from '@/components/shell/BottomNav'
import { Footer } from '@/components/shell/Footer'
import { Header } from '@/components/shell/Header'
import { siteCopy } from '@/lib/copy/settings'
import { storageSrc } from '@/lib/seo/urls'

export const metadata: Metadata = {
  title: messages.notFoundPage.title,
  robots: { index: false, follow: true },
}

const COVER_W = 400
const COVER_H = 600

/** The six most-read series this week, falling back to all time on a fresh install. */
const cachedPopular = unstable_cache(
  async (): Promise<PopularItem[]> => {
    const db = await getDb()
    const weekly = await popular(db, 'weekly', { limit: 6 })
    return weekly.length >= 3 ? weekly : popular(db, 'all', { limit: 6 })
  },
  ['not_found', 'popular'],
  { revalidate: 300, tags: ['catalog'] },
)

const uiType = (t: PopularItem['type']): SeriesType => (t === 'novel' ? 'comic' : t)

/**
 * Designed 404 (docs/13 "404 / 410 / 500 pages"): the site chrome, a search box and the
 * popular series so a dead link still lands somewhere useful. Rendered by `notFound()` from
 * anywhere in the app; removed series get 410 from proxy.ts instead.
 */
export default async function NotFound() {
  let items: PopularItem[] = []
  try {
    items = await cachedPopular()
  } catch {
    items = []
  }
  const copy = await siteCopy()
  const m = messages.notFoundPage
  // Next renders this one *outside* `(site)/layout.tsx` — its markup carries
  // `id="__next_error__"` — so it has to draw its own chrome or a broken link lands on an
  // unbranded page. Anything inside the site group is caught by `(site)/not-found.tsx`
  // instead, which deliberately draws none: that is what stops the two from stacking.
  return (
    <ToastProvider>
      <Header />
      <main id="main" className="pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
        <div className="container-page pt-10 pb-12">
          <section className="mx-auto flex max-w-[640px] flex-col items-center text-center">
            <div className="font-display text-[88px] font-extrabold leading-none tracking-[-0.04em] text-brand md:text-[120px]">
              {m.code}
            </div>
            <h1 className="mt-2 font-display text-[28px] font-extrabold uppercase leading-8 tracking-[-0.02em] text-fg md:text-[34px]">
              {m.title}
            </h1>
            <p className="mt-3 max-w-[48ch] text-[15px] leading-6 text-fg-muted">
              {copy('notFoundPage.hint')}
            </p>
            <form
              action="/search"
              method="get"
              className="mt-6 flex w-full max-w-[520px] items-center gap-2"
            >
              <label className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-[12px] border border-line bg-surface-1 pl-3 pr-2 text-fg-muted focus-within:border-brand">
                <Search size={16} aria-hidden="true" />
                <span className="sr-only">{m.searchLabel}</span>
                <input
                  type="search"
                  name="q"
                  placeholder={m.searchPlaceholder}
                  autoComplete="off"
                  className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-muted"
                />
              </label>
              <button type="submit" className={buttonClasses('primary', 'lg', 'rounded-[12px]')}>
                {messages.nav.search}
              </button>
            </form>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <a href="/" className={buttonClasses('outline', 'md')}>
                {m.home}
              </a>
              <a href="/browse" className={buttonClasses('ghost', 'md')}>
                <Compass size={15} aria-hidden="true" />
                {m.browse}
              </a>
            </div>
          </section>

          {items.length > 0 ? (
            <section aria-labelledby="nf-popular" className="mt-12">
              <h2 id="nf-popular" className="section-title mb-4">
                {m.popular}
              </h2>
              <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 md:gap-4">
                {items.map((s) => (
                  <li key={s.id}>
                    <SeriesCard
                      title={s.title}
                      href={`/series/${s.slug}`}
                      type={uiType(s.type)}
                      rating={s.ratingCount > 0 ? (s.ratingAvg ?? undefined) : undefined}
                      rank={s.rank}
                      cover={{
                        src: storageSrc(s.coverKey) ?? '',
                        width: COVER_W,
                        height: COVER_H,
                        alt: `${s.title} cover`,
                      }}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </main>
      <Footer />
      <BottomNav />
    </ToastProvider>
  )
}
