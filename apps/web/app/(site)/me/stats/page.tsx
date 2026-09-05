import { fmt, messages } from '@palscans/core/messages'
import { getDb, readingStats } from '@palscans/db'
import { Button, Chip, EmptyState, RelativeTime } from '@palscans/ui'
import type { Metadata } from 'next'
import { coverSrc } from '@/components/discovery/media'
import { ReadingActivity } from '@/components/me/ReadingActivity'
import { StatTile } from '@/components/me/StatTile'
import { PageTitle, Section } from '../_components/Section'
import { requireAccount } from '../_lib'

export const metadata: Metadata = { title: messages.me.stats.title }

/**
 * `/me/stats` — reading stats (docs/13 "Reading stats", docs/17 §G).
 *
 * Its own page rather than a block on `/me`: `/me` is a redirect into the account tabs, and
 * the activity chart plus the shelf counters would push bookmarks — the thing readers
 * actually come here for — below the fold on a phone. A tab costs one tap and keeps both
 * pages a single query deep.
 *
 * Every figure comes from a row the reader created. Nothing measures time on page, so
 * nothing here claims to.
 */
export default async function StatsPage() {
  const user = await requireAccount('/me/stats')
  const db = await getDb()
  const stats = await readingStats(db, user.id)
  const m = messages.me.stats
  const days = (n: number) => (n === 1 ? m.day : fmt(m.days, { n }))

  if (stats.chaptersRead === 0 && stats.seriesFollowed === 0 && stats.ratingsGiven === 0) {
    return (
      <>
        <PageTitle title={m.title} />
        <EmptyState
          title={m.empty}
          description={m.emptyLead}
          action={
            <Button href="/browse" variant="outline">
              {messages.me.bookmarks.browse}
            </Button>
          }
        />
      </>
    )
  }

  return (
    <>
      <PageTitle title={m.title} />
      <p className="mb-5 max-w-[65ch] text-[13px] text-fg-muted">{m.lead}</p>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label={m.chaptersRead} value={stats.chaptersRead.toLocaleString('en')} />
        <StatTile label={m.seriesRead} value={stats.seriesRead.toLocaleString('en')} />
        <StatTile label={m.seriesFollowed} value={stats.seriesFollowed.toLocaleString('en')} />
        <StatTile label={m.seriesCompleted} value={stats.seriesCompleted.toLocaleString('en')} />
        <StatTile label={m.currentStreak} value={days(stats.currentStreak)} />
        <StatTile label={m.longestStreak} value={days(stats.longestStreak)} />
        <StatTile label={m.daysRead} value={days(stats.daysRead)} />
        <StatTile
          label={m.ratingsGiven}
          value={stats.ratingsGiven.toLocaleString('en')}
          hint={
            stats.averageRating === null
              ? undefined
              : `${m.averageRating}: ${fmt(m.of10, { score: stats.averageRating })}`
          }
        />
      </div>

      <div className="flex flex-col gap-5">
        <Section title={m.activity} description={m.activityHint}>
          <ReadingActivity months={stats.months} />
          {stats.firstReadAt || stats.lastReadAt ? (
            <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-fg-muted">
              {stats.firstReadAt ? (
                <span>
                  {fmt(m.readingSince, {
                    date: stats.firstReadAt.toISOString().slice(0, 10),
                  })}
                </span>
              ) : null}
              {stats.lastReadAt ? (
                <span>
                  {m.lastRead} <RelativeTime iso={stats.lastReadAt.toISOString()} />
                </span>
              ) : null}
            </p>
          ) : null}
        </Section>

        {stats.topSeries.length > 0 ? (
          <Section title={m.mostRead} description={m.mostReadHint}>
            <ol className="flex flex-col divide-y divide-line-soft">
              {stats.topSeries.map((entry, index) => (
                <li key={entry.seriesId} className="flex items-center gap-3 py-2.5 first:pt-0">
                  <span className="w-5 text-center text-[13px] font-bold tabular-nums text-fg-subtle">
                    {index + 1}
                  </span>
                  <a href={`/series/${entry.slug}`} className="shrink-0">
                    <img
                      src={coverSrc(entry.coverKey, entry.coverColor)}
                      alt=""
                      width={400}
                      height={600}
                      loading="lazy"
                      decoding="async"
                      className="aspect-[2/3] w-9 rounded-sm bg-surface-2 object-cover"
                    />
                  </a>
                  <div className="min-w-0 flex-1">
                    <a
                      href={`/series/${entry.slug}`}
                      className="line-clamp-1 text-sm font-bold text-fg hover:text-brand-hover"
                    >
                      {entry.title}
                    </a>
                    <p className="mt-0.5 flex items-center gap-2 text-[12px] text-fg-muted">
                      {entry.type === 'novel' ? (
                        <Chip variant="genre" size="sm">
                          {messages.series.type.novel}
                        </Chip>
                      ) : (
                        <Chip
                          variant="type"
                          value={entry.type as 'manga' | 'manhwa' | 'manhua' | 'comic'}
                          size="sm"
                        />
                      )}
                      <span>{fmt(m.chaptersCount, { n: entry.chaptersRead })}</span>
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Section>
        ) : null}
      </div>
    </>
  )
}
