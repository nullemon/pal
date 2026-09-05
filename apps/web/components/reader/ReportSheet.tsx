'use client'

import { fmt, messages } from '@palscans/core/messages'
import { Sheet } from '@palscans/ui'
import { useId, useState } from 'react'
import { CHAPTER_REPORT_REASONS, type ChapterReportReason, MAX_NOTE } from './report'

export interface ReportSheetProps {
  open: boolean
  onClose: () => void
  chapterId: number
  chapterLabel: string
  /** 0-based, the page the reader is on when they open the sheet. */
  pageIdx: number
  pageCount: number
  signedIn: boolean
}

/**
 * "Report an issue" (docs/04 Reports). Deliberately open to signed-out readers: the reader
 * who lands on a chapter with a missing page has usually never made an account, and if the
 * only way to tell anyone is to sign up first, nobody tells anyone and the chapter stays
 * broken.
 *
 * The page number goes with the report without being asked for — the reader already knows
 * where they are, and a moderator who has to guess cannot act on "a page is missing".
 */
export function ReportSheet({
  open,
  onClose,
  chapterId,
  chapterLabel,
  pageIdx,
  pageCount,
  signedIn,
}: ReportSheetProps) {
  const m = messages.chapterReport
  const groupId = useId()
  const noteId = useId()
  const [reason, setReason] = useState<ChapterReportReason>('missing_page')
  const [note, setNote] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')

  const close = () => {
    onClose()
    // Reset a moment later so the sheet does not visibly change while it slides away.
    window.setTimeout(() => {
      setState('idle')
      setNote('')
      setReason('missing_page')
    }, 250)
  }

  const submit = async () => {
    setState('sending')
    try {
      const res = await fetch('/api/reports/chapter', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chapterId,
          reason,
          note: note.trim() || undefined,
          pageIdx,
        }),
      })
      setState(res.ok ? 'sent' : 'failed')
    } catch {
      setState('failed')
    }
  }

  return (
    <Sheet open={open} onClose={close} title={m.title}>
      {state === 'sent' ? (
        <div className="flex flex-col gap-4 py-2">
          <p className="text-sm font-semibold text-fg">{m.thanks}</p>
          <button
            type="button"
            onClick={close}
            className="h-11 self-start rounded-[10px] bg-brand-hover px-4 text-sm font-bold text-brand-ink transition-colors hover:bg-brand"
          >
            {messages.readerUi.done}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-fg-muted">{m.lead}</p>
          <fieldset aria-labelledby={groupId} className="flex flex-col gap-1.5">
            <legend id={groupId} className="mb-1 text-sm font-semibold text-fg">
              {m.reason}
            </legend>
            {CHAPTER_REPORT_REASONS.map((value) => (
              <label
                key={value}
                className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] border px-3 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand ${
                  reason === value
                    ? 'border-brand bg-brand-wash font-semibold text-fg'
                    : 'border-line text-fg-muted hover:bg-surface-3 hover:text-fg'
                }`}
              >
                <input
                  type="radio"
                  name="chapter-report-reason"
                  value={value}
                  checked={reason === value}
                  onChange={() => setReason(value)}
                  className="size-4 accent-[var(--color-brand-hover)]"
                />
                <span>{m.reasons[value]}</span>
              </label>
            ))}
          </fieldset>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={noteId} className="text-sm font-semibold text-fg">
              {m.note}
            </label>
            <textarea
              id={noteId}
              value={note}
              maxLength={MAX_NOTE}
              rows={3}
              onChange={(e) => setNote(e.target.value)}
              placeholder={m.notePlaceholder}
              className="w-full resize-y rounded-[10px] border border-line bg-bg-deep p-3 text-sm text-fg outline-none placeholder:text-fg-subtle focus-visible:border-brand-hover"
            />
          </div>
          <p className="text-[12px] text-fg-subtle">
            {pageCount > 0
              ? fmt(m.context, { chapter: chapterLabel, page: pageIdx + 1 })
              : fmt(m.contextNoPage, { chapter: chapterLabel })}
            {signedIn ? null : ` ${m.anonymousNote}`}
          </p>
          {state === 'failed' ? (
            <p role="alert" className="text-sm font-semibold text-danger">
              {m.failed}
            </p>
          ) : null}
          <button
            type="button"
            onClick={submit}
            disabled={state === 'sending'}
            className="h-11 rounded-[10px] bg-brand-hover px-4 text-sm font-bold text-brand-ink transition-colors hover:bg-brand disabled:opacity-60"
          >
            {state === 'sending' ? m.sending : m.submit}
          </button>
        </div>
      )}
    </Sheet>
  )
}
