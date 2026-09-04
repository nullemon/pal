'use client'

import { fmt, messages } from '@palscans/core/messages'
import { Button, EmptyState } from '@palscans/ui'
import { CloudOff, Download } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Reader } from '@/components/reader/Reader'
import { getChapter, listChapters, offlineSupported } from '@/lib/offline/db'
import type { OfflineChapter, OfflineChapterSummary } from '@/lib/offline/types'

const m = messages.me.downloads

type View =
  | { state: 'loading' }
  | { state: 'library'; rows: OfflineChapterSummary[] }
  | { state: 'chapter'; row: OfflineChapter }
  | { state: 'missing' }
  | { state: 'unsupported' }

/**
 * `/offline` — the only route that works with no network (docs/17 §G).
 *
 * The service worker caches this one document and serves it for any navigation the network
 * refuses, so the chapter arrives as `?c=` and is resolved on the client — the cached
 * document is always the parameterless one. It has to be `useSearchParams` rather than
 * `window.location`: moving between the library and a chapter is a client-side navigation
 * that keeps this component mounted, so a value read once on mount never changes and the
 * library would never open anything.
 */
export function OfflineReader() {
  const params = useSearchParams()
  const id = Number(params.get('c'))
  const [view, setView] = useState<View>({ state: 'loading' })
  const [online, setOnline] = useState(true)

  useEffect(() => {
    setOnline(navigator.onLine)
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!offlineSupported()) return setView({ state: 'unsupported' })
      setView({ state: 'loading' })
      try {
        if (Number.isFinite(id) && id > 0) {
          const row = await getChapter(id)
          if (cancelled) return
          return setView(row ? { state: 'chapter', row } : { state: 'missing' })
        }
        const rows = await listChapters()
        if (!cancelled) setView({ state: 'library', rows })
      } catch {
        if (!cancelled) setView({ state: 'unsupported' })
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [id])

  if (view.state === 'loading')
    return <p className="py-16 text-center text-sm text-fg-muted">{messages.common.loading}</p>

  if (view.state === 'chapter') return <Reader data={view.row.data} />

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 py-10">
      {!online ? (
        <p className="mb-5 flex items-center gap-2 rounded-[10px] border border-warn/40 bg-warn/10 px-3 py-2 text-[13px] text-fg">
          <CloudOff size={15} aria-hidden="true" className="shrink-0" />
          {m.offlineNotice}
        </p>
      ) : null}

      <h1 className="mb-5 font-display text-2xl font-extrabold uppercase tracking-[-0.02em] text-fg">
        {m.title}
      </h1>

      {view.state === 'unsupported' ? (
        <EmptyState
          icon={<CloudOff size={28} aria-hidden="true" />}
          title={m.unsupported}
          description={m.unsupportedLead}
        />
      ) : view.state === 'missing' ? (
        <EmptyState
          icon={<Download size={28} aria-hidden="true" />}
          title={m.missing}
          description={m.emptyLead}
          action={
            <Button href="/offline" variant="outline" size="sm">
              {m.backToLibrary}
            </Button>
          }
        />
      ) : view.rows.length === 0 ? (
        <EmptyState
          icon={<Download size={28} aria-hidden="true" />}
          title={m.empty}
          description={m.emptyLead}
        />
      ) : (
        <ul className="flex list-none flex-col gap-2 p-0">
          {view.rows.map((r) => (
            <li key={r.chapterId}>
              <Link
                href={`/offline?c=${r.chapterId}`}
                className="flex items-center gap-3 rounded-[12px] border border-line bg-surface-1 p-3 transition-colors hover:border-brand/60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-fg">
                    {r.seriesTitle}
                  </span>
                  <span className="block truncate text-[12px] text-fg-muted">
                    {r.label} · {fmt(m.pages, { n: String(r.pageCount) })}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {online ? (
        <p className="mt-6 text-center text-[13px]">
          <Link href="/me/downloads" className="font-semibold text-brand-hover hover:underline">
            {m.openOnline}
          </Link>
        </p>
      ) : null}
    </div>
  )
}
