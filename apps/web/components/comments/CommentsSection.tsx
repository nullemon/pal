import { COMMENT_MAX_CHARS } from '@palscans/core/comments'
import { db } from '@palscans/db'
import { listComments, PAGE_SIZE, viewerFor } from '@/lib/comments/queries'
import { loadCommentSettings } from '@/lib/comments/settings'
import type { CommentSort, CommentTarget, CommentThreadConfig } from '@/lib/comments/types'
import { targetKey } from '@/lib/comments/types'
import type { AppUser } from '@/lib/comments/viewer'
import { CommentThread } from './CommentThread'

export interface CommentsSectionProps {
  target: CommentTarget
  user: AppUser | null
  sort?: CommentSort
  /** The series/chapter toggle. */
  enabled: boolean
  className?: string
}

/**
 * Server-rendered first page (docs/14 §9): the comments are in the HTML, the thread hydrates
 * as an island. Pending comments are only ever returned to their author.
 */
export async function CommentsSection({
  target,
  user,
  sort = 'best',
  enabled,
  className,
}: CommentsSectionProps) {
  const [viewer, settings] = await Promise.all([viewerFor(db, user), loadCommentSettings(db)])
  const page = await listComments(db, { target, sort, viewer, limit: PAGE_SIZE })
  const config: CommentThreadConfig = {
    editWindowMinutes: settings.edit_window_minutes,
    collapseThreshold: settings.collapse_threshold,
    maxMentions: settings.max_mentions,
    maxChars: COMMENT_MAX_CHARS,
    imagesEnabled: settings.images.collection,
    customGifs: settings.images.custom_gifs,
    pageSize: PAGE_SIZE,
  }
  return (
    <section id="comments" aria-labelledby="comments-title" className={className}>
      <CommentThread
        target={targetKey(target)}
        initial={page}
        viewer={viewer}
        config={config}
        enabled={enabled && settings.enabled}
      />
    </section>
  )
}
