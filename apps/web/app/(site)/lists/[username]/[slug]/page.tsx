import { fmt, messages } from '@palscans/core/messages'
import { getDb, type ReadingListDetail, readingListByOwnerSlug } from '@palscans/db'
import { Avatar, EmptyState, SeriesCard, type SeriesType } from '@palscans/ui'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { COVER_HEIGHT, COVER_WIDTH, coverSrc } from '@/components/discovery/media'
import { siteUrl } from '@/components/discovery/metadata'
import { avatarUrl } from '@/lib/auth/media'

/**
 * `/lists/[username]/[slug]` — a reader's published list (docs/13 "Custom reading lists").
 *
 * Public means public: no session is read, so the page is the same for a signed-out
 * visitor following a shared link as for its owner. A private list is a 404 here rather
 * than a 403 — a refusal would confirm that the URL names something real, which is exactly
 * what "private" is supposed to hide.
 */
export const dynamic = 'force-dynamic'

const load = async (username: string, slug: string): Promise<ReadingListDetail | null> => {
  if (!username || !slug || username.length > 32 || slug.length > 100) return null
  const list = await readingListByOwnerSlug(await getDb(), username, slug)
  return list?.isPublic ? list : null
}

/**
 * Written by hand rather than through `pageMetadata`: the docs/12 template set has no page
 * type for a reader-made list, and inventing one would put reader copy into the operator's
 * SEO screens. `noindex, follow` because a list is personal, not a catalogue surface — the
 * owner shared a link, they did not ask to be ranked.
 */
export async function generateMetadata({
  params,
}: PageProps<'/lists/[username]/[slug]'>): Promise<Metadata> {
  const { username, slug } = await params
  const list = await load(username, slug)
  if (!list) return { title: messages.errors.notFound, robots: { index: false } }
  const owner = list.owner.displayName || list.owner.username || username
  const url = siteUrl(`/lists/${username}/${slug}`)
  const description = list.description || fmt(messages.me.lists.byOwner, { name: owner })
  return {
    title: { absolute: `${list.name} · ${messages.site.name}` },
    description,
    alternates: { canonical: url },
    robots: { index: false, follow: true },
    openGraph: {
      title: list.name,
      description,
      url,
      siteName: messages.site.name,
      type: 'website',
    },
  }
}

export default async function PublicListPage({ params }: PageProps<'/lists/[username]/[slug]'>) {
  const { username, slug } = await params
  const list = await load(username, slug)
  if (!list) notFound()
  const m = messages.me.lists
  const owner = list.owner.displayName || list.owner.username || username

  return (
    <div className="container-page py-6 lg:py-8">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <Avatar name={owner} src={avatarUrl(list.owner.avatarKey)} size={44} />
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-extrabold uppercase tracking-[-0.02em] text-fg">
            {list.name}
          </h1>
          <p className="mt-0.5 text-[13px] text-fg-muted">
            {fmt(m.byOwner, { name: owner })}
            {' · '}
            {list.itemCount === 1 ? m.itemCountOne : fmt(m.itemCount, { n: list.itemCount })}
          </p>
        </div>
      </header>
      {list.description ? (
        <p className="mb-6 max-w-[65ch] text-sm text-fg-muted">{list.description}</p>
      ) : null}
      {list.items.length === 0 ? (
        <EmptyState title={m.itemsEmpty} />
      ) : (
        <ol className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {list.items.map((item, index) => (
            <li key={item.seriesId}>
              <SeriesCard
                title={item.title}
                href={`/series/${item.slug}`}
                type={(item.type === 'novel' ? 'manga' : item.type) as SeriesType}
                rank={index + 1}
                rating={item.ratingCount > 0 && item.ratingAvg ? item.ratingAvg : undefined}
                cover={{
                  src: coverSrc(item.coverKey, item.coverColor),
                  width: COVER_WIDTH,
                  height: COVER_HEIGHT,
                  alt: '',
                }}
                // The card's chapter slot, carrying the count rather than a chapter number:
                // `series.chapter_count` is how many exist, which is not the same claim as
                // "the latest chapter is number N".
                latestChapter={
                  item.chapterCount > 0
                    ? { number: fmt(messages.series.chapterCount, { n: item.chapterCount }) }
                    : undefined
                }
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
