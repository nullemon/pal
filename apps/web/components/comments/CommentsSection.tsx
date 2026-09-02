import { isStaff } from '@palscans/core'
import { COMMENT_MAX_CHARS } from '@palscans/core/comments'
import { db } from '@palscans/db'
import { turnstileEnabled } from '@/lib/auth/turnstile'
import { challengeRequired } from '@/lib/comments/pipeline'
import { listComments, PAGE_SIZE, viewerFor } from '@/lib/comments/queries'
import { loadCommentSettings } from '@/lib/comments/settings'
import type { CommentSort, CommentTarget, CommentThreadConfig } from '@/lib/comments/types'
import { targetKey } from '@/lib/comments/types'
import type { AppUser } from '@/lib/comments/viewer'
import { entitlementGate } from '@/lib/entitlements'
import { getEnv } from '@/lib/env'
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
  const gate = await entitlementGate()
  const [viewer, settings] = await Promise.all([viewerFor(db, user, gate), loadCommentSettings(db)])
  const page = await listComments(db, { target, sort, viewer, limit: PAGE_SIZE })
  // docs/14 §2 step 3: the widget is only rendered when the server will verify tokens, and
  // up front for the viewers the pipeline is sure to challenge (a rate-limit hit adds the
  // widget on the client when the API answers `turnstile`).
  const turnstile = turnstileEnabled() ? (getEnv().NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null) : null
  const config: CommentThreadConfig = {
    editWindowMinutes: settings.edit_window_minutes,
    collapseThreshold: settings.collapse_threshold,
    maxMentions: settings.max_mentions,
    maxChars: COMMENT_MAX_CHARS,
    imagesEnabled: settings.images.collection,
    // docs/17 §B: an operator who switches `custom_gifs` off takes the button away for
    // everyone; who gets it otherwise is `viewer.canUseCustomGifs`.
    customGifs: gate.mode('custom_gifs') === 'disabled' ? 'off' : settings.images.custom_gifs,
    pageSize: PAGE_SIZE,
    turnstileSiteKey: turnstile,
    challenge: !!turnstile && !!user && !isStaff(user) && challengeRequired(user, settings, false),
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
