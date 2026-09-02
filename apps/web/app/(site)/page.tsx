import { fmt, messages } from '@palscans/core/messages'
import { AdSlot, Chip, Rail, RatingStars, SeriesCard } from '@palscans/ui'
import { ChevronRight, Flame } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { sampleCatalog } from '@/lib/sample-catalog'

/**
 * Placeholder home. P1 replaces this with layout A (design/mockups/A/Main.dc.html) backed by
 * the real query helpers; the shell around it is what F1 delivers.
 */
export default function HomePage() {
  const featured = sampleCatalog[0]
  const trending = sampleCatalog.slice(0, 8)
  return (
    <div className="container-page flex flex-col gap-6 pt-4 md:pt-6">
      {/* Hero placeholder: cover-derived backdrop, one featured series. */}
      {featured ? (
        <section
          aria-label={messages.home.heroEyebrow}
          className="relative overflow-hidden rounded-lg border border-line-soft bg-surface-1"
        >
          <Image
            src={featured.cover}
            alt=""
            width={400}
            height={600}
            aria-hidden="true"
            className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl"
          />
          <div className="relative flex flex-col gap-4 bg-linear-to-r from-bg/90 via-bg/70 to-bg/20 p-5 md:flex-row md:items-end md:gap-8 md:p-8">
            <Image
              src={featured.cover}
              alt={featured.title}
              width={400}
              height={600}
              priority
              className="aspect-[2/3] w-[120px] shrink-0 rounded-md object-cover shadow-2 md:w-[180px]"
            />
            <div className="flex min-w-0 flex-col gap-3">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-brand-hover">
                {messages.home.heroEyebrow} · {fmt(messages.series.rank, { n: featured.rank })}
              </p>
              <h1 className="font-display text-[clamp(1.6rem,1.3rem+1.4vw,2.2rem)] font-extrabold leading-tight">
                {featured.title}
              </h1>
              <div className="flex flex-wrap items-center gap-2">
                <Chip variant="type" value={featured.type} />
                <Chip variant="status" value={featured.status} />
                <RatingStars value={featured.rating} count={12481} size={14} />
              </div>
              <p className="max-w-[68ch] text-sm text-fg-muted">
                Executed by the empire he built, Kael Vantheris wakes three hundred years in the
                past with his memories intact and his power gone. The Frost Monarch has one winter
                to rebuild an army, and this time he remembers every betrayal.
              </p>
              <div className="flex gap-2">
                <Link
                  href={`/series/${featured.slug}/chapter-1`}
                  className="inline-flex h-[38px] items-center rounded-md bg-brand px-4 text-sm font-semibold text-brand-ink hover:bg-brand-hover"
                >
                  {messages.series.readFirst}
                </Link>
                <Link
                  href={`/series/${featured.slug}`}
                  className="inline-flex h-[38px] items-center rounded-md border border-line bg-surface-1 px-4 text-sm font-semibold text-fg hover:bg-surface-2"
                >
                  {messages.series.chapters}
                </Link>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <AdSlot slot="home_top" label={messages.ads.leaderboard} width={970} height={90} />

      <section aria-labelledby="trending-title" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 id="trending-title" className="section-title flex items-center gap-2">
            <Flame size={18} className="text-brand-hover" aria-hidden="true" />
            {messages.home.trending}
          </h2>
          <Link
            href="/rankings"
            className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-hover hover:text-fg"
          >
            {messages.nav.rankings}
            <ChevronRight size={14} aria-hidden="true" />
          </Link>
        </div>
        <Rail label={messages.home.trending}>
          {trending.map((s, i) => (
            <SeriesCard
              key={s.slug}
              title={s.title}
              href={`/series/${s.slug}`}
              cover={{ src: s.cover, width: 400, height: 600, alt: s.title }}
              type={s.type}
              rank={s.rank}
              rating={s.rating}
              priority={i < 3}
              latestChapter={{
                number: s.latestChapter,
                href: `/series/${s.slug}/chapter-${s.latestChapter}`,
              }}
            />
          ))}
        </Rail>
      </section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section aria-labelledby="latest-title" className="flex flex-col gap-3">
          <h2 id="latest-title" className="section-title">
            {messages.home.latestUpdates}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {sampleCatalog.slice(0, 6).map((s) => (
              <article
                key={s.slug}
                className="flex gap-3 rounded-md border border-line-soft bg-surface-1 p-3"
              >
                <Image
                  src={s.cover}
                  alt=""
                  width={400}
                  height={600}
                  loading="lazy"
                  className="aspect-[2/3] w-[64px] shrink-0 rounded-sm object-cover"
                />
                <div className="flex min-w-0 flex-col gap-1">
                  <Link
                    href={`/series/${s.slug}`}
                    className="line-clamp-2 text-sm font-bold leading-5 hover:text-brand-hover"
                  >
                    {s.title}
                  </Link>
                  <Chip variant="type" value={s.type} size="sm" className="self-start" />
                  <span className="text-xs tabular-nums text-fg-muted">{fmt(messages.series.chapterShort, { n: s.latestChapter })}</span>
                </div>
              </article>
            ))}
          </div>
        </section>
        <aside className="flex flex-col gap-4">
          <section
            aria-labelledby="popular-title"
            className="rounded-md border border-line-soft bg-surface-1 p-4"
          >
            <h2 id="popular-title" className="section-title mb-3">
              {messages.home.popular}
            </h2>
            <ol className="flex flex-col gap-2 text-sm">
              {sampleCatalog.slice(0, 5).map((s) => (
                <li key={s.slug} className="flex items-center gap-3">
                  <span className="w-5 font-display text-lg font-extrabold tabular-nums text-fg-subtle">
                    {s.rank}
                  </span>
                  <Link href={`/series/${s.slug}`} className="truncate hover:text-brand-hover">
                    {s.title}
                  </Link>
                </li>
              ))}
            </ol>
          </section>
          <AdSlot
            slot="home_sidebar"
            label={messages.ads.mpu}
            width={300}
            height={250}
            className="hidden lg:flex"
          />
        </aside>
      </div>
    </div>
  )
}
