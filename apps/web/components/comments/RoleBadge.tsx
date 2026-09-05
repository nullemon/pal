import type { Role } from '@palscans/core'
import { messages } from '@palscans/core/messages'
import { Pin, Sparkles } from 'lucide-react'

const badge =
  'inline-flex h-[18px] items-center gap-1 rounded-full px-[7px] text-[11px] font-bold leading-none whitespace-nowrap'

/** Admin / Moderator / Uploader badges (docs/14 "Staff and mod styling"). */
export function RoleBadge({ role }: { role: Role }) {
  if (role === 'admin')
    return (
      <span className={`${badge} bg-brand/10 text-brand-hover`}>
        {messages.commentThread.roleAdmin}
      </span>
    )
  if (role === 'moderator')
    return (
      <span className={`${badge} bg-type-manga/15 text-type-manga`}>
        {messages.commentThread.roleModerator}
      </span>
    )
  if (role === 'uploader')
    return (
      <span className={`${badge} border border-line bg-surface-2 text-fg-muted`}>
        {messages.commentThread.roleUploader}
      </span>
    )
  return null
}

export function PremiumBadge() {
  return (
    <span className={`${badge} border border-gold/55 text-gold`}>
      <Sparkles size={10} aria-hidden="true" />
      {messages.commentThread.premiumBadge}
    </span>
  )
}

export function PinnedBadge() {
  return (
    <span className={`${badge} border border-line bg-surface-2 text-fg-muted`}>
      <Pin size={10} aria-hidden="true" />
      {messages.commentThread.pinned}
    </span>
  )
}

export function PendingBadge() {
  return (
    <span className={`${badge} bg-warn/15 text-warn`} title={messages.commentThread.awaitingReview}>
      {messages.comments.pending}
    </span>
  )
}
