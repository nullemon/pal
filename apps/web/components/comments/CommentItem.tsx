'use client'

import { fmt, messages } from '@palscans/core/messages'
import { Avatar, cn, RelativeTime, useToast } from '@palscans/ui'
import { ChevronDown, ChevronUp, MoreHorizontal, Shield } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { bodyToMarkup } from '@/lib/comments/markup'
import type {
  CommentThreadConfig,
  CommentView,
  CommentViewer,
  ReactionKind,
} from '@/lib/comments/types'
import { CommentBody } from './CommentBody'
import { Composer, type ComposerResult, type ComposerSubmission } from './Composer'
import { ReactionBar } from './ReactionBar'
import { PendingBadge, PinnedBadge, PremiumBadge, RoleBadge } from './RoleBadge'

export interface CommentActions {
  react: (comment: CommentView, kind: ReactionKind) => Promise<void>
  reply: (parent: CommentView, s: ComposerSubmission) => Promise<ComposerResult>
  edit: (comment: CommentView, s: ComposerSubmission) => Promise<ComposerResult>
  remove: (comment: CommentView) => Promise<void>
  openReport: (comment: CommentView) => void
  block: (userId: number) => Promise<void>
  loadReplies: (comment: CommentView) => Promise<void>
  seeReactors: (comment: CommentView) => Promise<void>
}

export interface CommentItemProps {
  comment: CommentView
  viewer: CommentViewer | null
  config: CommentThreadConfig
  actions: CommentActions
  depth?: 0 | 1
  /** All replies are loaded for this comment (so the "show N replies" line hides). */
  repliesExpanded?: boolean
  highlighted?: boolean
}

const actionLink =
  'inline-flex h-6 items-center px-1.5 text-[12px] font-semibold text-fg-muted transition-colors hover:text-fg'

const isStaffRole = (role: CommentView['author']['role']) =>
  role === 'admin' || role === 'moderator'

/** One comment (docs/14 §1): header with badges, body, reactions, actions, one level of replies. */
export function CommentItem({
  comment,
  viewer,
  config,
  actions,
  depth = 0,
  repliesExpanded = false,
  highlighted = false,
}: CommentItemProps) {
  const { toast } = useToast()
  const [replying, setReplying] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [showAnyway, setShowAnyway] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loadingReplies, setLoadingReplies] = useState(false)
  const [repliesHidden, setRepliesHidden] = useState(false)
  const menuRef = useRef<HTMLDetailsElement>(null)
  const rootRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (highlighted) rootRef.current?.scrollIntoView({ block: 'center' })
  }, [highlighted])

  const own = viewer?.id === comment.author.id
  const ageMs = Date.now() - new Date(comment.createdAt).getTime()
  const canEdit = own && !comment.deleted && ageMs <= config.editWindowMinutes * 60_000
  const canDelete = !comment.deleted && (own || !!viewer?.canModerate)
  const staffRow = comment.isPinned && isStaffRole(comment.author.role)
  const reply = depth === 1
  const collapsed =
    !comment.deleted && !own && comment.score <= config.collapseThreshold && !showAnyway
  const remainingReplies = comment.replyCount - comment.replies.length

  const closeMenu = () => {
    if (menuRef.current) menuRef.current.open = false
  }

  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}#comment-${comment.id}`
    try {
      await navigator.clipboard.writeText(url)
      toast({ title: messages.commentThread.linkCopied, tone: 'ok' })
    } catch {
      window.prompt(messages.common.copyLink, url)
    }
  }

  if (collapsed) {
    return (
      <article
        id={`comment-${comment.id}`}
        className={cn(
          'flex items-center gap-3 py-2 text-[12px] text-fg-muted',
          !reply && 'border-t border-line',
        )}
      >
        <Avatar
          name={comment.author.displayName}
          src={comment.author.avatarUrl}
          size={reply ? 24 : 28}
          className="opacity-60"
        />
        <span className="truncate">
          <span className="font-semibold">{comment.author.username}</span> ·{' '}
          {messages.commentThread.lowScore}
        </span>
        <button
          type="button"
          onClick={() => setShowAnyway(true)}
          className="font-semibold text-brand-hover hover:text-fg"
        >
          {messages.comments.showAnyway}
        </button>
      </article>
    )
  }

  return (
    <article
      ref={rootRef}
      id={`comment-${comment.id}`}
      className={cn(
        'scroll-mt-24',
        reply ? 'mt-1 flex items-start gap-2.5' : 'py-2',
        !reply && !staffRow && 'border-t border-line',
        staffRow &&
          'mt-3 rounded-r-[12px] border-l-[3px] border-brand-hover bg-linear-to-r from-brand/16 via-brand/3 to-transparent px-3.5 py-2',
        highlighted && 'rounded-md ring-2 ring-brand/60',
      )}
    >
      <div className={cn('flex items-start gap-3', reply && 'w-full gap-2.5')}>
        {staffRow ? (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-hover text-brand-ink">
            <Shield size={18} aria-hidden="true" />
          </span>
        ) : (
          <Avatar
            name={comment.author.displayName}
            src={comment.author.avatarUrl}
            size={reply ? 32 : 40}
            className="border-2 border-line"
          />
        )}
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              'flex flex-wrap items-center gap-x-2 gap-y-1',
              reply ? 'min-h-[18px] text-[13px]' : 'min-h-5 text-sm',
            )}
          >
            <a
              href={`/u/${encodeURIComponent(comment.author.username)}`}
              className="font-bold text-fg hover:text-brand-hover"
            >
              {comment.deleted
                ? messages.comments.deleted
                : staffRow && comment.author.role === 'admin'
                  ? `${messages.site.name} Team`
                  : comment.author.username}
            </a>
            {!comment.deleted ? <RoleBadge role={comment.author.role} /> : null}
            {!comment.deleted && comment.author.isPremium && !isStaffRole(comment.author.role) ? (
              <PremiumBadge />
            ) : null}
            {comment.isPinned ? <PinnedBadge /> : null}
            {comment.status === 'pending' ? <PendingBadge /> : null}
            <RelativeTime
              iso={comment.createdAt}
              className="text-[12px] font-medium text-fg-muted"
            />
            {comment.editedAt ? (
              <span className="text-[12px] text-fg-subtle" title={comment.editedAt}>
                ({messages.comments.edited})
              </span>
            ) : null}
          </div>

          {editing ? (
            <div className="mt-2">
              <Composer
                viewer={viewer}
                config={config}
                mode="edit"
                autoFocus
                initialText={bodyToMarkup(comment.body).text}
                initialImage={comment.image}
                onCancel={() => setEditing(false)}
                onSubmit={async (s) => {
                  const ok = await actions.edit(comment, s)
                  if (ok) setEditing(false)
                  return ok
                }}
              />
            </div>
          ) : (
            <CommentBody body={comment.body} image={comment.image} deleted={comment.deleted} />
          )}

          {comment.status === 'pending' ? (
            <p className="mt-1 text-[12px] text-warn">{messages.commentThread.awaitingReview}</p>
          ) : null}

          {!comment.deleted && !editing ? (
            <div className={cn('flex flex-wrap items-center gap-1.5', reply ? 'mt-1' : 'mt-1.5')}>
              <ReactionBar
                counts={comment.reactionCounts}
                mine={comment.viewerReactions}
                size={reply ? 'sm' : 'md'}
                disabled={busy || comment.status !== 'published'}
                onToggle={async (kind) => {
                  if (!viewer) {
                    toast({ title: messages.seriesDetail.signInFirst })
                    return
                  }
                  setBusy(true)
                  try {
                    await actions.react(comment, kind)
                  } finally {
                    setBusy(false)
                  }
                }}
                onSeeReactors={
                  viewer && (viewer.canSeeReactors || viewer.canModerate)
                    ? () => void actions.seeReactors(comment)
                    : undefined
                }
              />
              <span aria-hidden="true" className="mx-1 h-3.5 w-px bg-line" />
              {!comment.locked || viewer?.canModerate ? (
                <button
                  type="button"
                  className={actionLink}
                  onClick={() =>
                    setReplying((r) =>
                      r === null ? (reply ? `@${comment.author.username} ` : '') : null,
                    )
                  }
                >
                  {messages.comments.reply}
                </button>
              ) : null}
              <button type="button" className={actionLink} onClick={() => void share()}>
                {messages.commentThread.share}
              </button>
              {!own && viewer ? (
                <button
                  type="button"
                  className={actionLink}
                  onClick={() => actions.openReport(comment)}
                >
                  {messages.comments.report}
                </button>
              ) : null}
              {viewer && (canEdit || canDelete || !own) ? (
                <details ref={menuRef} className="relative">
                  <summary
                    aria-label={messages.commentThread.more}
                    className="inline-flex size-6 cursor-pointer list-none items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg [&::-webkit-details-marker]:hidden"
                  >
                    <MoreHorizontal size={16} />
                  </summary>
                  <div className="absolute left-0 top-full z-20 mt-1 flex min-w-40 flex-col overflow-hidden rounded-[10px] border border-line bg-surface-2 py-1 text-sm shadow-2">
                    {canEdit ? (
                      <button
                        type="button"
                        className="px-3 py-2 text-left hover:bg-surface-3"
                        onClick={() => {
                          closeMenu()
                          setEditing(true)
                        }}
                      >
                        {messages.comments.edit}
                      </button>
                    ) : null}
                    {canDelete ? (
                      <button
                        type="button"
                        className="px-3 py-2 text-left text-danger hover:bg-surface-3"
                        onClick={async () => {
                          closeMenu()
                          if (!window.confirm(messages.commentThread.deleteConfirm)) return
                          await actions.remove(comment)
                        }}
                      >
                        {messages.comments.delete}
                      </button>
                    ) : null}
                    {!own ? (
                      <button
                        type="button"
                        className="px-3 py-2 text-left hover:bg-surface-3"
                        onClick={async () => {
                          closeMenu()
                          await actions.block(comment.author.id)
                        }}
                      >
                        {messages.comments.block}
                      </button>
                    ) : null}
                  </div>
                </details>
              ) : null}
            </div>
          ) : null}

          {replying !== null ? (
            <div className="mt-2">
              <Composer
                viewer={viewer}
                config={config}
                mode="reply"
                autoFocus
                initialText={replying}
                placeholder={messages.comments.placeholderReply}
                onCancel={() => setReplying(null)}
                onSubmit={async (s) => {
                  const ok = await actions.reply(comment, s)
                  if (ok) setReplying(null)
                  return ok
                }}
              />
            </div>
          ) : null}
        </div>
      </div>

      {depth === 0 && (comment.replies.length > 0 || remainingReplies > 0) ? (
        <div className="ml-14">
          {!repliesHidden
            ? comment.replies.map((r) => (
                <CommentItem
                  key={r.id}
                  comment={r}
                  viewer={viewer}
                  config={config}
                  actions={actions}
                  depth={1}
                />
              ))
            : null}
          {remainingReplies > 0 && !repliesExpanded && !repliesHidden ? (
            <div className="mt-1 flex h-[18px] items-center">
              <button
                type="button"
                disabled={loadingReplies}
                onClick={async () => {
                  setLoadingReplies(true)
                  try {
                    await actions.loadReplies(comment)
                  } finally {
                    setLoadingReplies(false)
                  }
                }}
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-brand-hover hover:text-fg disabled:opacity-60"
              >
                <ChevronDown size={14} aria-hidden="true" />
                {loadingReplies
                  ? messages.commentThread.loadingReplies
                  : remainingReplies === 1 && comment.replies.length === 0
                    ? messages.commentThread.showReply
                    : fmt(messages.commentThread.showReplies, { n: comment.replyCount })}
              </button>
            </div>
          ) : comment.replies.length > 0 ? (
            <div className="mt-1 flex h-[18px] items-center">
              <button
                type="button"
                onClick={() => setRepliesHidden((h) => !h)}
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-fg-muted hover:text-fg"
              >
                {repliesHidden ? (
                  <ChevronDown size={14} aria-hidden="true" />
                ) : (
                  <ChevronUp size={14} aria-hidden="true" />
                )}
                {repliesHidden
                  ? fmt(messages.commentThread.showReplies, { n: comment.replies.length })
                  : messages.commentThread.hideReplies}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}
