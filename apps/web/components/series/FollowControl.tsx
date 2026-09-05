import { messages } from '@palscans/core/messages'
import { chapters, db, followState, series } from '@palscans/db'
import { and, eq, isNull } from 'drizzle-orm'
import { getSessionUser } from '@/lib/auth/session'
import { DEFAULT_FOLLOW_MODE } from '@/lib/notifications/schema'
import { FollowButton, type FollowInitialState } from './FollowButton'

/**
 * The follow control with its state already resolved (docs/17 §D). A server component so the
 * series page and the reader render the right label in the HTML — a button that says
 * "Follow" for a second and then flips to "Following" is worse than no button.
 *
 * `followState` is where the model lives: an explicit `series_follows` row wins, and a
 * bookmark with no row is still an implicit follow on `all` (which is what every bookmarker
 * had before this feature, and why nobody was unsubscribed by it).
 */
const resolve = async (seriesId: number): Promise<FollowInitialState> => {
  const user = await getSessionUser()
  if (!user) return { following: false, mode: DEFAULT_FOLLOW_MODE, source: null }
  const state = await followState(db, user.id, seriesId)
  if (!state) return { following: false, mode: DEFAULT_FOLLOW_MODE, source: null }
  return { following: state.mode !== 'off', mode: state.mode, source: state.source }
}

export async function FollowControl({
  seriesId,
  seriesSlug,
  variant = 'full',
  className,
}: {
  seriesId: number
  seriesSlug: string
  variant?: 'full' | 'compact'
  className?: string
}) {
  const [user, initial] = await Promise.all([getSessionUser(), resolve(seriesId)])
  return (
    <FollowButton
      seriesId={seriesId}
      seriesSlug={seriesSlug}
      signedIn={!!user}
      initial={initial}
      variant={variant}
      className={className}
    />
  )
}

/**
 * The same control at the end of a chapter, where the reader is most likely to want it and
 * where all the page knows is the chapter id. One indexed lookup for the series behind it;
 * nothing is rendered for a chapter whose series has gone away.
 */
export async function ChapterFollowStrip({ chapterId }: { chapterId: number }) {
  const [row] = await db
    .select({ id: series.id, slug: series.slug })
    .from(chapters)
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(and(eq(chapters.id, chapterId), isNull(chapters.deletedAt), isNull(series.deletedAt)))
    .limit(1)
  if (!row) return null
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-1 px-4 py-3">
      <p className="m-0 max-w-[52ch] text-[13px] text-fg-muted">{messages.follows.reader}</p>
      <FollowControl seriesId={row.id} seriesSlug={row.slug} variant="compact" />
    </div>
  )
}
