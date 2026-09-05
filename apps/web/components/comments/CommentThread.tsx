'use client'

import { fmt, messages } from '@palscans/core/messages'
import { Button, cn, Sheet, useToast } from '@palscans/ui'
import { ChevronDown } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, del, patchJson, postJson } from '@/lib/comments/client'
import type {
  CommentPage,
  CommentSort,
  CommentThreadConfig,
  CommentView,
  CommentViewer,
  ReactionKind,
  ReportReason,
} from '@/lib/comments/types'
import { COMMENT_SORTS } from '@/lib/comments/types'
import { useCopy } from '@/lib/copy/context'
import { type CommentActions, CommentItem } from './CommentItem'
import { Composer, type ComposerResult, type ComposerSubmission } from './Composer'
import { ReportDialog } from './ReportDialog'

export interface CommentThreadProps {
  target: string
  initial: CommentPage
  viewer: CommentViewer | null
  config: CommentThreadConfig
  /** Series/chapter comments switch (docs/14 §1 "Where"). */
  enabled: boolean
}

interface ReactionPatch {
  id: number
  reactionCounts: CommentView['reactionCounts']
  score: number
  viewerReactions: ReactionKind[]
}

const sortLabel: Record<CommentSort, string> = {
  best: messages.comments.sortBest,
  newest: messages.comments.sortNewest,
  oldest: messages.comments.sortOldest,
}

const mapTree = (
  list: CommentView[],
  id: number,
  fn: (c: CommentView) => CommentView,
): CommentView[] =>
  list.map((c) =>
    c.id === id ? fn(c) : c.replies.length ? { ...c, replies: mapTree(c.replies, id, fn) } : c,
  )

const filterTree = (list: CommentView[], keep: (c: CommentView) => boolean): CommentView[] =>
  list.filter(keep).map((c) => (c.replies.length ? { ...c, replies: c.replies.filter(keep) } : c))

/**
 * The interactive thread (docs/14): the first page arrives server-rendered as `initial`;
 * sorting, load more, posting, reactions, replies, edits, reports and blocks all go through
 * /api/comments. A light poll every 60s (visible tab only) surfaces new comments.
 */
export function CommentThread({ target, initial, viewer, config, enabled }: CommentThreadProps) {
  const copy = useCopy()
  const { toast } = useToast()
  const [page, setPage] = useState<CommentPage>(initial)
  const [sort, setSort] = useState<CommentSort>(initial.sort)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())
  const [hidden, setHidden] = useState<Set<number>>(() => new Set())
  const [blocked, setBlocked] = useState<Set<number>>(() => new Set(viewer?.blockedIds ?? []))
  const [fresh, setFresh] = useState(0)
  const [highlightId, setHighlightId] = useState<number | null>(null)
  const [reactors, setReactors] = useState<{
    open: boolean
    rows: Array<{ kind: string; username: string; displayName: string }>
  }>({ open: false, rows: [] })
  const [reportTarget, setReportTarget] = useState<CommentView | null>(null)
  const pollTotal = useRef(initial.total)

  useEffect(() => {
    const m = /^#comment-(\d+)$/.exec(window.location.hash)
    if (m?.[1]) setHighlightId(Number(m[1]))
  }, [])

  const fetchPage = useCallback(
    async (s: CommentSort, cursor?: string | null) => {
      const params = new URLSearchParams({ target, sort: s, limit: String(config.pageSize) })
      if (cursor) params.set('cursor', cursor)
      return api<CommentPage>(`/api/comments?${params.toString()}`, { cache: 'no-store' })
    },
    [target, config.pageSize],
  )

  // poll for new comments while the tab is visible
  useEffect(() => {
    let timer: number | undefined
    const tick = async () => {
      if (document.visibilityState !== 'visible') return
      const params = new URLSearchParams({ target, sort: 'newest', limit: '1' })
      const res = await api<CommentPage>(`/api/comments?${params.toString()}`, {
        cache: 'no-store',
      })
      if (res.ok && res.data.total > pollTotal.current) setFresh(res.data.total - pollTotal.current)
    }
    timer = window.setInterval(() => void tick(), 60_000)
    return () => window.clearInterval(timer)
  }, [target])

  const changeSort = async (s: CommentSort) => {
    if (s === sort || loading) return
    setLoading(true)
    const res = await fetchPage(s)
    setLoading(false)
    if (!res.ok) {
      toast({ title: res.message || messages.errors.generic, tone: 'danger' })
      return
    }
    setSort(s)
    setPage(res.data)
    setExpanded(new Set())
    pollTotal.current = res.data.total
    setFresh(0)
  }

  const reload = async () => {
    setLoading(true)
    const res = await fetchPage(sort)
    setLoading(false)
    if (res.ok) {
      setPage(res.data)
      setExpanded(new Set())
      pollTotal.current = res.data.total
      setFresh(0)
    }
  }

  const loadMore = async () => {
    if (!page.nextCursor || loading) return
    setLoading(true)
    const res = await fetchPage(sort, page.nextCursor)
    setLoading(false)
    if (!res.ok) {
      toast({ title: res.message || messages.errors.generic, tone: 'danger' })
      return
    }
    const seen = new Set(page.comments.map((c) => c.id))
    setPage((p) => ({
      ...res.data,
      comments: [...p.comments, ...res.data.comments.filter((c) => !seen.has(c.id))],
    }))
  }

  const updateOne = useCallback(
    (id: number, fn: (c: CommentView) => CommentView) =>
      setPage((p) => ({ ...p, comments: mapTree(p.comments, id, fn) })),
    [],
  )

  const post = async (s: ComposerSubmission): Promise<ComposerResult> => {
    const res = await postJson<{ comment: CommentView | null; status: string; message: string }>(
      '/api/comments',
      {
        target,
        body: s.body,
        image_id: s.imageId,
        is_spoiler: s.isSpoiler,
        turnstile: s.turnstile,
      },
    )
    if (!res.ok) {
      toast({ title: res.message || messages.errors.generic, tone: 'danger' })
      return res.error === 'turnstile' ? 'challenge' : false
    }
    const c = res.data.comment
    if (c) {
      setPage((p) => {
        const pinned = p.comments.filter((x) => x.isPinned)
        const rest = p.comments.filter((x) => !x.isPinned)
        const published = c.status === 'published'
        const total = published ? p.total + 1 : p.total
        if (published) pollTotal.current = total
        return { ...p, total, comments: [...pinned, c, ...rest] }
      })
    }
    toast({ title: res.data.message, tone: res.data.status === 'published' ? 'ok' : 'neutral' })
    return true
  }

  const sendReport = async (reason: ReportReason, detail: string) => {
    const comment = reportTarget
    if (!comment) return
    const res = await postJson<{ id: number; message: string }>(
      `/api/comments/${comment.id}/report`,
      {
        reason,
        detail,
      },
    )
    setReportTarget(null)
    if (!res.ok) {
      toast({ title: res.message || messages.errors.generic, tone: 'danger' })
      return
    }
    setHidden((h) => new Set(h).add(comment.id))
    toast({ title: res.data.message, tone: 'ok' })
  }

  const actions: CommentActions = useMemo(
    () => ({
      react: async (comment, kind) => {
        const had = comment.viewerReactions.includes(kind)
        const patch = (c: CommentView): CommentView => {
          const counts = { ...c.reactionCounts }
          counts[kind] = Math.max(0, (counts[kind] ?? 0) + (had ? -1 : 1))
          return {
            ...c,
            reactionCounts: counts,
            viewerReactions: had
              ? c.viewerReactions.filter((k) => k !== kind)
              : [...c.viewerReactions, kind],
          }
        }
        updateOne(comment.id, patch)
        const res = had
          ? await del<ReactionPatch>(`/api/comments/${comment.id}/reactions/${kind}`)
          : await postJson<ReactionPatch>(`/api/comments/${comment.id}/reactions`, { kind })
        if (!res.ok) {
          updateOne(comment.id, () => comment)
          toast({ title: res.message || messages.errors.generic, tone: 'danger' })
          return
        }
        updateOne(comment.id, (c) => ({
          ...c,
          reactionCounts: res.data.reactionCounts,
          score: res.data.score,
          viewerReactions: res.data.viewerReactions,
        }))
      },
      reply: async (parent, s) => {
        const res = await postJson<{
          comment: CommentView | null
          status: string
          message: string
        }>('/api/comments', {
          target,
          parent_id: parent.id,
          body: s.body,
          image_id: s.imageId,
          is_spoiler: s.isSpoiler,
          turnstile: s.turnstile,
        })
        if (!res.ok) {
          toast({ title: res.message || messages.errors.generic, tone: 'danger' })
          return res.error === 'turnstile' ? 'challenge' : false
        }
        const c = res.data.comment
        if (c)
          updateOne(parent.id, (p) => ({
            ...p,
            replies: [...p.replies, c],
            replyCount: c.status === 'published' ? p.replyCount + 1 : p.replyCount,
          }))
        toast({ title: res.data.message, tone: res.data.status === 'published' ? 'ok' : 'neutral' })
        return true
      },
      edit: async (comment, s) => {
        const res = await patchJson<{ comment: CommentView | null; status: string }>(
          `/api/comments/${comment.id}`,
          {
            body: s.body,
            is_spoiler: s.isSpoiler,
          },
        )
        if (!res.ok) {
          toast({ title: res.message || messages.errors.generic, tone: 'danger' })
          return false
        }
        const c = res.data.comment
        if (c) updateOne(comment.id, (old) => ({ ...c, replies: old.replies }))
        return true
      },
      remove: async (comment) => {
        const res = await del<{ id: number; stub: boolean }>(`/api/comments/${comment.id}`)
        if (!res.ok) {
          toast({ title: res.message || messages.errors.generic, tone: 'danger' })
          return
        }
        if (res.data.stub) {
          updateOne(comment.id, (c) => ({
            ...c,
            deleted: true,
            body: { type: 'doc', version: 1, children: [] },
            image: null,
            isSpoiler: false,
          }))
        } else {
          setPage((p) => ({
            ...p,
            total:
              comment.parentId === null && comment.status === 'published' ? p.total - 1 : p.total,
            comments:
              comment.parentId === null
                ? p.comments.filter((c) => c.id !== comment.id)
                : mapTree(p.comments, comment.parentId, (parent) => ({
                    ...parent,
                    replies: parent.replies.filter((r) => r.id !== comment.id),
                    replyCount: Math.max(0, parent.replyCount - 1),
                  })),
          }))
        }
        toast({ title: messages.commentThread.deleted })
      },
      openReport: (comment) => setReportTarget(comment),
      block: async (userId) => {
        const res = await postJson<{ blocked: number; message: string }>(
          `/api/comments/users/${userId}/block`,
          {},
        )
        if (!res.ok) {
          toast({ title: res.message || messages.errors.generic, tone: 'danger' })
          return
        }
        setBlocked((b) => new Set(b).add(userId))
        toast({
          title: res.data.message,
          action: {
            label: messages.commentThread.unblock,
            onClick: () => {
              void del(`/api/comments/users/${userId}/block`)
              setBlocked((b) => {
                const n = new Set(b)
                n.delete(userId)
                return n
              })
            },
          },
        })
      },
      loadReplies: async (comment) => {
        const res = await api<{ replies: CommentView[] }>(`/api/comments/${comment.id}/replies`, {
          cache: 'no-store',
        })
        if (!res.ok) {
          toast({ title: res.message || messages.errors.generic, tone: 'danger' })
          return
        }
        updateOne(comment.id, (c) => ({ ...c, replies: res.data.replies }))
        setExpanded((e) => new Set(e).add(comment.id))
      },
      seeReactors: async (comment) => {
        const res = await api<{
          reactors: Array<{ kind: string; username: string; displayName: string }>
        }>(`/api/comments/${comment.id}/reactors`)
        if (!res.ok) {
          toast({ title: res.message || messages.errors.generic })
          return
        }
        setReactors({ open: true, rows: res.data.reactors })
      },
    }),
    [target, toast, updateOne],
  )

  const visible = filterTree(page.comments, (c) => !hidden.has(c.id) && !blocked.has(c.author.id))
  const shown = visible.length

  return (
    <div>
      <div className="flex min-h-8 flex-wrap items-center gap-2.5">
        <h2 id="comments-title" className="m-0 font-display text-xl font-bold tracking-[-0.01em]">
          {messages.comments.title}
        </h2>
        <span className="text-[13px] font-medium tabular-nums text-fg-muted">
          {page.total.toLocaleString('en')}
        </span>
        <div className="flex-1" />
        <div
          role="tablist"
          aria-label={messages.browse.sort}
          className="grid h-8 w-[222px] grid-cols-3 gap-1 rounded-[10px] border border-line bg-bg p-[3px] text-[13px] font-semibold"
        >
          {COMMENT_SORTS.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={sort === s}
              disabled={loading}
              onClick={() => void changeSort(s)}
              className={cn(
                'flex items-center justify-center rounded-[7px] transition-colors',
                sort === s ? 'bg-brand-wash text-brand-hover' : 'text-fg-muted hover:text-fg',
              )}
            >
              {sortLabel[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3">
        {enabled ? (
          <Composer viewer={viewer} config={config} onSubmit={post} />
        ) : (
          <p className="rounded-[12px] border border-line bg-surface-1 px-4 py-3 text-sm text-fg-muted">
            {messages.comments.locked}
          </p>
        )}
      </div>

      {fresh > 0 ? (
        <button
          type="button"
          onClick={() => void reload()}
          className="mt-3 w-full rounded-md border border-brand/40 bg-brand-wash py-2 text-[13px] font-semibold text-brand-hover hover:text-fg"
        >
          {fmt(messages.commentThread.newComments, { n: fresh })}
        </button>
      ) : null}

      <div className={cn('mt-1.5', loading && 'opacity-60')} aria-busy={loading}>
        {visible.length === 0 ? (
          <p className="border-t border-line py-8 text-center text-sm text-fg-muted">
            {copy('comments.empty', messages.comments.empty)}
          </p>
        ) : (
          visible.map((c) => (
            <CommentItem
              key={c.id}
              comment={c}
              viewer={viewer}
              config={config}
              actions={actions}
              repliesExpanded={expanded.has(c.id)}
              highlighted={highlightId === c.id}
            />
          ))
        )}
      </div>

      <div className="mt-1.5 grid grid-cols-[1fr_auto_1fr] items-center border-t border-line pt-2">
        <span className="text-[12px] leading-4 text-fg-muted">
          {fmt(messages.commentThread.showing, {
            shown: shown.toLocaleString('en'),
            total: page.total.toLocaleString('en'),
          })}
        </span>
        {page.nextCursor ? (
          <Button
            variant="outline"
            size="lg"
            className="rounded-[12px] px-[22px] text-sm"
            disabled={loading}
            onClick={() => void loadMore()}
          >
            {messages.comments.loadMore}
            <ChevronDown size={16} aria-hidden="true" />
          </Button>
        ) : (
          <span />
        )}
        <span />
      </div>

      <ReportDialog
        open={reportTarget !== null}
        onClose={() => setReportTarget(null)}
        onSubmit={sendReport}
      />

      <Sheet
        open={reactors.open}
        onClose={() => setReactors((r) => ({ ...r, open: false }))}
        title={messages.commentThread.reactorsTitle}
      >
        <ul className="flex flex-col gap-1 p-4 text-sm">
          {reactors.rows.length === 0 ? (
            <li className="text-fg-muted">{copy('comments.empty', messages.comments.empty)}</li>
          ) : null}
          {reactors.rows.map((r) => (
            <li key={`${r.kind}-${r.username}`} className="flex items-center justify-between gap-3">
              <span className="font-semibold">@{r.username}</span>
              <span className="text-[12px] text-fg-muted">
                {messages.comments.reactions[r.kind as ReactionKind] ?? r.kind}
              </span>
            </li>
          ))}
        </ul>
      </Sheet>
    </div>
  )
}
