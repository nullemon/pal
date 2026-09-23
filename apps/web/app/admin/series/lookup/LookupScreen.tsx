'use client'

import { fmt } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import type { SeriesMetadata } from '@palscans/core/metadata'
import { Button, useToast } from '@palscans/ui'
import Link from 'next/link'
import { useState } from 'react'
import { Hint, inputClass, Panel, Pill } from '@/components/admin/ui'

/**
 * Search AniList, tick the matches, create them as drafts.
 *
 * The screen is deliberately a *picker*, not an importer that runs on its own. Third-party
 * metadata is frequently almost-right — the wrong entry in a long-running series, an English
 * title nobody uses — so nothing happens until an operator has looked at the cover and the
 * byline and ticked the box. Everything created is a draft for the same reason.
 */
interface Outcome {
  seriesId: number
  slug: string
  title: string
  coverQueued: boolean
  unmatchedGenres: string[]
}

const m = adminMessages.seriesLookup

const anilistId = (sourceId: string): number => Number(sourceId.split(':')[1] ?? 0)

export function LookupScreen() {
  const { toast } = useToast()
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<SeriesMetadata[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [searching, setSearching] = useState(false)
  const [adding, setAdding] = useState(false)
  const [created, setCreated] = useState<Outcome[]>([])

  const search = async () => {
    if (term.trim().length < 2) return
    setSearching(true)
    setPicked(new Set())
    try {
      const res = await fetch(`/api/admin/metadata/search?q=${encodeURIComponent(term.trim())}`)
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        toast({
          title: res.status === 429 ? m.rateLimited : m.sourceUnavailable,
          tone: 'danger',
        })
        setResults([])
        return
      }
      setResults(body?.data?.results ?? [])
    } catch {
      toast({ title: m.sourceUnavailable, tone: 'danger' })
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  const toggle = (sourceId: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(sourceId)) next.delete(sourceId)
      else next.add(sourceId)
      return next
    })

  const add = async () => {
    const ids = [...picked].map(anilistId).filter((n) => n > 0)
    if (ids.length === 0) return
    setAdding(true)
    try {
      const res = await fetch('/api/admin/metadata/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        toast({
          title: res.status === 429 ? m.rateLimited : m.sourceUnavailable,
          tone: 'danger',
        })
        return
      }
      const madeNow: Outcome[] = body?.data?.created ?? []
      const failed: unknown[] = body?.data?.failed ?? []
      setCreated((prev) => [...madeNow, ...prev])
      // Drop what landed from the picker so a second press cannot duplicate it.
      setPicked(new Set())
      setResults((prev) =>
        prev ? prev.filter((r) => !madeNow.some((c) => c.title === r.title)) : prev,
      )
      toast({
        title: fmt(m.createdTitle, { n: madeNow.length }),
        description: failed.length ? fmt(m.failedTitle, { n: failed.length }) : m.createdHint,
        tone: failed.length ? 'neutral' : 'ok',
      })
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="flex flex-col gap-3.5">
      <Panel>
        <div className="flex flex-col gap-2">
          <label className="text-[13px] text-fg-muted" htmlFor="lookup-term">
            {m.searchLabel}
          </label>
          <div className="flex gap-2">
            <input
              id="lookup-term"
              className={inputClass}
              value={term}
              placeholder={m.searchPlaceholder}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void search()
                }
              }}
            />
            <Button onClick={() => void search()} disabled={searching || term.trim().length < 2}>
              {searching ? m.searching : m.search}
            </Button>
          </div>
          <Hint>{m.draftNote}</Hint>
        </div>
      </Panel>

      {created.length > 0 ? (
        <Panel>
          <h2 className="mb-2 text-[13px] font-semibold text-fg">
            {fmt(m.createdTitle, { n: created.length })}
          </h2>
          <ul className="flex flex-col gap-2 text-[13px]">
            {created.map((c) => (
              <li key={c.seriesId} className="flex flex-wrap items-center gap-2">
                <Link className="text-brand hover:underline" href={`/admin/series/${c.seriesId}`}>
                  {c.title}
                </Link>
                <Pill tone={c.coverQueued ? 'ok' : 'warn'}>
                  {c.coverQueued ? m.coverPending : m.coverMissing}
                </Pill>
                {c.unmatchedGenres.length > 0 ? (
                  <span className="text-fg-subtle">
                    {fmt(m.unmatchedGenres, { names: c.unmatchedGenres.join(', ') })}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {results === null ? (
        <Panel>
          <p className="text-[13px] text-fg-muted">{m.prompt}</p>
        </Panel>
      ) : results.length === 0 ? (
        <Panel>
          <p className="text-[13px] text-fg-muted">{m.noResults}</p>
        </Panel>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <Button onClick={() => void add()} disabled={adding || picked.size === 0}>
              {adding ? m.adding : fmt(m.addSelected, { n: picked.size })}
            </Button>
            {picked.size > 0 ? (
              <button
                type="button"
                className="text-[13px] text-fg-muted hover:text-fg"
                onClick={() => setPicked(new Set())}
              >
                {m.clearSelection}
              </button>
            ) : null}
          </div>
          <ul className="flex flex-col gap-2.5">
            {results.map((r) => {
              const on = picked.has(r.sourceId)
              const byline =
                r.people
                  .filter((p) => p.credit === 'author')
                  .map((p) => p.name)
                  .join(', ') || m.unknownAuthor
              return (
                <li key={r.sourceId}>
                  <Panel className={on ? 'border-brand' : undefined}>
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1 size-4 shrink-0 accent-[var(--brand)]"
                        checked={on}
                        onChange={() => toggle(r.sourceId)}
                      />
                      {r.coverUrl ? (
                        // Shown only in this picker; the real cover is copied into our own
                        // bucket on import and readers never load anilist.co.
                        <img
                          src={r.coverUrl}
                          alt=""
                          width={56}
                          height={80}
                          className="h-20 w-14 shrink-0 rounded border border-line object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="h-20 w-14 shrink-0 rounded border border-line bg-surface-2" />
                      )}
                      <div className="flex min-w-0 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-fg">{r.title}</span>
                          <Pill tone="brand">{r.type}</Pill>
                          <Pill>{r.status}</Pill>
                          {r.releasedYear ? <Pill>{r.releasedYear}</Pill> : null}
                        </div>
                        <div className="text-[12px] text-fg-subtle">{byline}</div>
                        <p className="line-clamp-2 text-[12px] text-fg-muted">
                          {r.synopsis ?? m.noSynopsis}
                        </p>
                        {r.genres.length > 0 ? (
                          <div className="text-[11px] text-fg-subtle">{r.genres.join(' · ')}</div>
                        ) : null}
                      </div>
                    </label>
                  </Panel>
                </li>
              )
            })}
          </ul>
          <Hint>{m.attribution}</Hint>
        </>
      )}
    </div>
  )
}
