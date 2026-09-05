'use client'

import { fmt } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { cn } from '@palscans/ui'
import { CheckCircle2 } from 'lucide-react'
import { useState } from 'react'
import { postJson } from '@/components/admin/client/api'

/**
 * The one interactive part of the genre merge screen. Everything above it is server-rendered,
 * so this carries no copy of the preview it could disagree with: it posts two ids, and the
 * route recomputes the whole preview inside the transaction before writing anything.
 *
 * Typing the retiring slug is the deliberate friction. The two sides look alike by
 * definition — that is why they are on this screen — and the merge cannot be undone, so the
 * confirmation asks for the one string that differs.
 */

interface Result {
  move: number
  merge: number
  redirect: { fromPath: string; toPath: string }
  auditId: number
  winnerId: number
}

const m = adminMessages.genreAdmin

export function GenreMergeConfirm({
  winnerId,
  loserId,
  loserSlug,
  winnerName,
  blocked,
}: {
  winnerId: number
  loserId: number
  loserSlug: string
  winnerName: string
  blocked: boolean
}) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<Result | null>(null)

  if (done) {
    return (
      <section className="rounded-lg border border-ok/50 bg-surface-1 p-4 md:px-5">
        <div className="flex items-start gap-3">
          <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-ok" aria-hidden="true" />
          <div>
            <h2 className="font-body text-[16px] font-bold leading-[22px]">
              {adminMessages.merge.doneTitle}
            </h2>
            <p className="mt-1 text-[13.5px] leading-5 text-fg-muted">
              {fmt(m.mergeDone, {
                move: done.move,
                merge: done.merge,
                from: done.redirect.fromPath,
                to: done.redirect.toPath,
              })}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <a
                href="/admin/genres"
                className="inline-flex h-8 items-center rounded-[9px] bg-brand px-3 text-[13px] font-bold text-brand-ink hover:bg-brand-hover"
              >
                {m.title}
              </a>
              <a
                href={`/admin/audit?target=genre&targetId=${winnerId}`}
                className="inline-flex h-8 items-center rounded-md border border-line px-3 text-[13px] font-semibold hover:bg-surface-2"
              >
                {adminMessages.merge.viewAudit}
              </a>
            </div>
          </div>
        </div>
      </section>
    )
  }

  const matches = typed.trim().toLowerCase() === loserSlug.toLowerCase()

  const submit = async () => {
    setBusy(true)
    setError(null)
    const res = await postJson<Result>('/api/admin/genres/merge', { winnerId, loserId })
    setBusy(false)
    if (res.ok) setDone(res.data)
    else setError(res.message || m.mergeFailed)
  }

  return (
    <section className="rounded-lg border border-line bg-surface-1 p-4 md:px-5">
      <h2 className="font-body text-[16px] font-bold leading-[22px]">
        {fmt(m.mergeReview, { loser: loserSlug, winner: winnerName })}
      </h2>
      <p className="mt-1 text-[13px] leading-[18px] text-fg-muted">
        {m.mergeConfirmTyped}: <code className="rounded-sm bg-surface-3 px-1">{loserSlug}</code>
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          disabled={blocked || busy}
          placeholder={loserSlug}
          aria-label={m.mergeConfirmTyped}
          className="h-9 w-72 rounded-md border border-line bg-bg px-3 text-[13px] text-fg placeholder:text-fg-subtle focus-visible:border-brand focus-visible:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          disabled={blocked || busy || !matches}
          onClick={submit}
          className={cn(
            'inline-flex h-9 items-center rounded-[9px] px-4 text-[13px] font-bold',
            blocked || !matches
              ? 'cursor-not-allowed bg-surface-3 text-fg-subtle'
              : 'bg-danger text-white hover:opacity-90',
          )}
        >
          {busy ? m.mergeWorking : m.mergeButton}
        </button>
        {typed.length > 0 && !matches ? (
          <span className="text-[12.5px] text-danger">{adminMessages.merge.confirmMismatch}</span>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-[13px] text-danger">{error}</p> : null}
    </section>
  )
}
