'use client'

import { fmt, messages } from '@palscans/core/messages'
import { cn } from '@palscans/ui'
import { useMemo, useState } from 'react'
import { RichText } from '@/components/discovery/RichText'
import { Hint, textareaClass } from '../ui'
import { markdownToDoc } from './markdown'

/**
 * The body editor both content screens share: a plain textarea in the Markdown subset, and a
 * preview rendered by the same `RichText` component the public page uses — so what the
 * operator approves is literally what readers get.
 */
export function BodyField({
  value,
  onChange,
  rows = 18,
  disabled,
}: {
  value: string
  onChange: (next: string) => void
  rows?: number
  disabled?: boolean
}) {
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const doc = useMemo(() => (tab === 'preview' ? markdownToDoc(value) : null), [tab, value])
  const m = messages.adminContent.body
  const tabClass = (active: boolean) =>
    cn(
      'h-7 rounded-md px-2.5 text-[12.5px] font-semibold transition-colors',
      active ? 'bg-brand-wash text-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
    )
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] font-medium leading-4 text-fg-muted">{m.label}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={tabClass(tab === 'write')}
            onClick={() => setTab('write')}
          >
            {m.write}
          </button>
          <button
            type="button"
            className={tabClass(tab === 'preview')}
            onClick={() => setTab('preview')}
          >
            {m.preview}
          </button>
        </div>
      </div>
      {tab === 'write' ? (
        <textarea
          className={cn(textareaClass, 'font-mono text-[12.5px] leading-[1.7]')}
          rows={rows}
          value={value}
          disabled={disabled}
          spellCheck
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <div className="min-h-[200px] rounded-md border border-line bg-bg px-3 py-3">
          {doc?.children.length ? (
            <RichText doc={doc} />
          ) : (
            <p className="text-[13px] text-fg-subtle">{m.empty}</p>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Hint className="max-w-[70ch] text-[12px] text-fg-subtle">{m.formatting}</Hint>
        <span className="text-[12px] tabular-nums text-fg-subtle">
          {fmt(m.characters, { n: value.length })}
        </span>
      </div>
    </div>
  )
}
