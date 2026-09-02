'use client'

import { messages } from '@palscans/core/messages'
import { Button, Sheet } from '@palscans/ui'
import { useState } from 'react'
import { REPORT_REASONS, type ReportReason } from '@/lib/comments/types'

export interface ReportDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (reason: ReportReason, detail: string) => Promise<void>
}

/** One tap with a reason (docs/14 §1 "Report"). */
export function ReportDialog({ open, onClose, onSubmit }: ReportDialogProps) {
  const [reason, setReason] = useState<ReportReason>('spam')
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Sheet open={open} onClose={onClose} title={messages.commentThread.reportTitle}>
      <form
        className="flex flex-col gap-3 p-4"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          try {
            await onSubmit(reason, detail)
            setDetail('')
          } finally {
            setBusy(false)
          }
        }}
      >
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-[13px] font-semibold text-fg-muted">
            {messages.commentThread.reportTitle}
          </legend>
          {REPORT_REASONS.map((r) => (
            <label
              key={r}
              className="flex h-11 cursor-pointer items-center gap-3 rounded-md border border-line px-3 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-wash"
            >
              <input
                type="radio"
                name="reason"
                value={r}
                checked={reason === r}
                onChange={() => setReason(r)}
                className="accent-brand"
              />
              {messages.comments.reportReasons[r]}
            </label>
          ))}
        </fieldset>
        <textarea
          value={detail}
          onChange={(e) => setDetail(e.target.value.slice(0, 1000))}
          placeholder={messages.commentThread.reportDetail}
          rows={2}
          className="w-full resize-none rounded-md border border-line bg-surface-1 px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-muted focus:border-brand"
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {messages.common.cancel}
          </Button>
          <Button type="submit" disabled={busy}>
            {messages.commentThread.sendReport}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
