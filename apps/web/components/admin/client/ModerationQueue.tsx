'use client'

import { fmt, messages } from '@palscans/core/messages'
import { Button, cn, useToast } from '@palscans/ui'
import { useCallback, useEffect, useState } from 'react'
import type { CommentAction } from '../schemas-moderation'
import type { ModerationTab, QueueComment } from '../server/moderation'
import { inputClass, Pill, type PillTone } from '../ui'
import { postJson } from './api'
import { Modal } from './controls'
import { formatChapterNumber, relativeTime } from './util'

const statusTone: Record<string, PillTone> = {
  published: 'ok',
  pending: 'warn',
  shadow: 'brand',
  rejected: 'danger',
  removed: 'neutral',
}

/**
 * Pending · Reported · Flagged · All (docs/14 §3): each row shows the comment in context
 * with the author card; j/k move, a approve, r reject, d delete, b opens the ban menu.
 */
export function ModerationQueue({
  tab,
  counts,
  items,
}: {
  tab: ModerationTab
  counts: { pending: number; reported: number; flagged: number }
  items: QueueComment[]
}) {
  const m = messages.admin.moderation
  const { toast } = useToast()
  const [rows, setRows] = useState(items)
  const [cursor, setCursor] = useState(0)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [menu, setMenu] = useState<{ id: number; kind: 'ban' | 'reject' | 'warn' } | null>(null)
  const [text, setText] = useState('')
  const now = new Date()

  const act = useCallback(
    async (id: number, action: CommentAction) => {
      const res = await postJson<Record<string, unknown>>(`/api/admin/comments/${id}`, action)
      if (!res.ok) {
        toast({
          title: messages.admin.errorSaving,
          description: res.message || res.error,
          tone: 'danger',
        })
        return
      }
      setRows((rs) =>
        rs.map((r) => {
          if (r.id !== id) return r
          switch (action.action) {
            case 'approve':
            case 'approve_allowlist':
              return { ...r, status: 'published', reports: 0 }
            case 'reject':
              return { ...r, status: 'rejected', reports: 0 }
            case 'delete':
            case 'ban':
              return { ...r, status: 'removed', reports: 0 }
            case 'pin':
              return { ...r, isPinned: action.value }
            case 'lock':
              return { ...r, locked: action.value }
            case 'shadow_ban':
              return { ...r, status: 'shadow' }
            default:
              return r
          }
        }),
      )
      toast({ title: m.actioned, tone: 'ok' })
      setMenu(null)
    },
    [toast, m.actioned],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (menu) return
      const row = rows[cursor]
      switch (e.key) {
        case 'j':
          setCursor((c) => Math.min(rows.length - 1, c + 1))
          break
        case 'k':
          setCursor((c) => Math.max(0, c - 1))
          break
        case 'a':
          if (row) void act(row.id, { action: 'approve' })
          break
        case 'r':
          if (row) setMenu({ id: row.id, kind: 'reject' })
          break
        case 'd':
          if (row) void act(row.id, { action: 'delete' })
          break
        case 'b':
          if (row) setMenu({ id: row.id, kind: 'ban' })
          break
        case 'x':
          if (row)
            setSelected((s) => {
              const n = new Set(s)
              if (n.has(row.id)) n.delete(row.id)
              else n.add(row.id)
              return n
            })
          break
        default:
          return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rows, cursor, act, menu])

  useEffect(() => {
    document
      .getElementById(`mod-row-${rows[cursor]?.id ?? ''}`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [cursor, rows])

  const bulk = async (action: 'approve' | 'reject' | 'delete') => {
    const ids = [...selected]
    const res = await postJson('/api/admin/comments/bulk', { ids, action })
    if (!res.ok) return toast({ title: messages.admin.errorSaving, tone: 'danger' })
    setRows((rs) =>
      rs.map((r) =>
        ids.includes(r.id)
          ? {
              ...r,
              status:
                action === 'approve' ? 'published' : action === 'reject' ? 'rejected' : 'removed',
              reports: 0,
            }
          : r,
      ),
    )
    setSelected(new Set())
    toast({ title: m.actioned, tone: 'ok' })
  }

  const tabs: Array<[ModerationTab, string, number | null]> = [
    ['pending', m.tabs.pending, counts.pending],
    ['reported', m.tabs.reported, counts.reported],
    ['flagged', m.tabs.flagged, counts.flagged],
    ['all', m.tabs.all, null],
  ]

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1 border-b border-line">
        {tabs.map(([key, label, n]) => (
          <a
            key={key}
            href={`/admin/comments?tab=${key}`}
            aria-current={tab === key ? 'page' : undefined}
            className={cn(
              '-mb-px flex h-10 items-center gap-2 border-b-2 px-3 text-[13px] font-semibold',
              tab === key
                ? 'border-brand text-fg'
                : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            {label}
            {n !== null ? (
              <span
                className={cn(
                  'rounded-full px-1.5 text-[11px] tabular-nums',
                  n > 0 && key !== 'all'
                    ? 'bg-danger/15 text-danger'
                    : 'bg-surface-3 text-fg-muted',
                )}
              >
                {n}
              </span>
            ) : null}
          </a>
        ))}
        {selected.size > 0 ? (
          <div className="ml-auto flex items-center gap-2 pb-1">
            <span className="text-[12px] text-fg-muted">
              {fmt(messages.admin.selected, { n: selected.size })}
            </span>
            <Button size="sm" onClick={() => bulk('approve')}>
              {m.bulkApprove}
            </Button>
            <Button size="sm" variant="outline" onClick={() => bulk('reject')}>
              {m.bulkReject}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-danger"
              onClick={() => bulk('delete')}
            >
              {m.bulkDelete}
            </Button>
          </div>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface-1 p-10 text-center text-[13px] text-fg-muted">
          {m.empty}
        </div>
      ) : null}
      <ol className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <li
            key={r.id}
            id={`mod-row-${r.id}`}
            className={cn(
              'rounded-lg border bg-surface-1 p-3 transition-colors',
              i === cursor
                ? 'border-brand shadow-[0_0_0_2px_var(--color-brand-wash)]'
                : 'border-line',
            )}
          >
            <div className="flex gap-3">
              <input
                type="checkbox"
                className="mt-1"
                aria-label={String(r.id)}
                checked={selected.has(r.id)}
                onChange={(e) =>
                  setSelected((s) => {
                    const n = new Set(s)
                    if (e.target.checked) n.add(r.id)
                    else n.delete(r.id)
                    return n
                  })
                }
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-[12px] text-fg-muted">
                  <a
                    href={`/admin/users/${r.user.id}`}
                    className="font-semibold text-fg hover:text-brand-hover"
                  >
                    {r.user.username ?? `#${r.user.id}`}
                  </a>
                  <span className="rounded-sm bg-surface-3 px-1 text-[10px] font-bold uppercase">
                    {r.user.role}
                  </span>
                  <span>
                    {fmt(m.accountAge, {
                      age: relativeTime(new Date(r.user.createdAt), now).replace(' ago', ''),
                    })}
                  </span>
                  <span>· {fmt(m.commentCount, { n: r.user.commentCount })}</span>
                  {r.user.priorActions > 0 ? (
                    <span className="text-warn">
                      · {fmt(m.priorActions, { n: r.user.priorActions })}
                    </span>
                  ) : null}
                  {r.user.commentBannedUntil && new Date(r.user.commentBannedUntil) > now ? (
                    <span className="text-danger">· {messages.admin.users.commentBanned}</span>
                  ) : null}
                  <span className="ml-auto flex items-center gap-2">
                    {r.reports > 0 ? (
                      <Pill tone="danger">{fmt(m.reports, { n: r.reports })}</Pill>
                    ) : null}
                    {r.automodScore > 0 ? (
                      <Pill tone="warn" className="normal-case tracking-normal">
                        {fmt(m.automod, { score: r.automodScore })}
                        {r.automodRules.length ? ` · ${r.automodRules.join(', ')}` : ''}
                      </Pill>
                    ) : null}
                    <Pill tone={statusTone[r.status] ?? 'neutral'}>
                      {m.statuses[r.status as keyof typeof m.statuses] ?? r.status}
                    </Pill>
                    {r.isPinned ? <Pill tone="gold">{m.pin}</Pill> : null}
                    {r.locked ? <Pill>{m.lockThread}</Pill> : null}
                  </span>
                </div>
                {r.parent ? (
                  <div className="mt-1 truncate text-[12px] text-fg-subtle">
                    {fmt(m.parent, { name: r.parent.username ?? '?' })}: “{r.parent.text}”
                  </div>
                ) : null}
                <p className="mt-1.5 whitespace-pre-wrap text-[13.5px] leading-5">{r.text}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-fg-muted">
                  {r.series ? (
                    <a
                      href={
                        r.chapter
                          ? `/series/${r.series.slug}/chapter-${formatChapterNumber(r.chapter.number)}`
                          : `/series/${r.series.slug}`
                      }
                      className="hover:text-brand-hover"
                    >
                      {r.chapter
                        ? fmt(m.chapterContext, {
                            series: r.series.title,
                            n: formatChapterNumber(r.chapter.number),
                          })
                        : fmt(m.context, { series: r.series.title })}
                    </a>
                  ) : null}
                  <time dateTime={r.createdAt}>{relativeTime(new Date(r.createdAt), now)}</time>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button size="sm" onClick={() => act(r.id, { action: 'approve' })}>
                    {m.approve}
                  </Button>
                  {r.hasLink ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => act(r.id, { action: 'approve_allowlist' })}
                    >
                      {m.approveAllowlist}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setText('')
                      setMenu({ id: r.id, kind: 'reject' })
                    }}
                  >
                    {m.reject}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-danger"
                    onClick={() => act(r.id, { action: 'delete' })}
                  >
                    {m.delete}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => act(r.id, { action: 'pin', value: !r.isPinned })}
                  >
                    {r.isPinned ? m.unpin : m.pin}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => act(r.id, { action: 'lock', value: !r.locked })}
                  >
                    {r.locked ? m.unlockThread : m.lockThread}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setText('')
                      setMenu({ id: r.id, kind: 'warn' })
                    }}
                  >
                    {m.warn}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setMenu({ id: r.id, kind: 'ban' })}
                  >
                    {m.banAccount}…
                  </Button>
                  <a
                    href={`/admin/users/${r.user.id}`}
                    className="inline-flex h-8 items-center px-2 text-[13px] text-fg-muted hover:text-fg"
                  >
                    {m.viewAllComments}
                  </a>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <Modal
        open={menu?.kind === 'reject'}
        title={m.reject}
        onClose={() => setMenu(null)}
        footer={
          <Button
            size="sm"
            onClick={() => menu && act(menu.id, { action: 'reject', reason: text || undefined })}
          >
            {m.reject}
          </Button>
        }
      >
        <input
          className={inputClass}
          placeholder={m.rejectReason}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </Modal>
      <Modal
        open={menu?.kind === 'warn'}
        title={m.warn}
        onClose={() => setMenu(null)}
        footer={
          <Button
            size="sm"
            disabled={!text.trim()}
            onClick={() => menu && act(menu.id, { action: 'warn', message: text })}
          >
            {m.warn}
          </Button>
        }
      >
        <textarea
          className={inputClass}
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </Modal>
      <Modal open={menu?.kind === 'ban'} title={m.banAccount} onClose={() => setMenu(null)}>
        <div className="grid grid-cols-2 gap-2">
          {[
            [m.commentBan1d, 1],
            [m.commentBan7d, 7],
            [m.commentBan30d, 30],
            [m.commentBanPermanent, null],
          ].map(([label, days]) => (
            <Button
              key={String(label)}
              size="sm"
              variant="outline"
              onClick={() =>
                menu && act(menu.id, { action: 'comment_ban', days: days as number | null })
              }
            >
              {m.commentBan} · {String(label)}
            </Button>
          ))}
          <Button
            size="sm"
            variant="outline"
            onClick={() => menu && act(menu.id, { action: 'shadow_ban' })}
          >
            {m.shadowBan}
          </Button>
          <Button
            size="sm"
            className="bg-danger text-white hover:bg-danger/90"
            onClick={() => menu && act(menu.id, { action: 'ban' })}
          >
            {m.banAccount}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
