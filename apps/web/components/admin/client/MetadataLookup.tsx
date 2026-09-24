'use client'

import { adminMessages } from '@palscans/core/messages/admin'
import type { SeriesMetadata } from '@palscans/core/metadata'
import { slugify } from '@palscans/core/slug'
import { Button, useToast } from '@palscans/ui'
import { useEffect, useRef, useState } from 'react'
import { inputClass, Panel, Pill } from '@/components/admin/ui'

/**
 * The series editor's "Look up" dialog: search AniList, pick one, fill the form.
 *
 * It fills the *form*, not the database — the operator still presses Save. That is the whole
 * point of having it here rather than a one-press import: a candidate is usually right and
 * occasionally the wrong entry in a long-running series, so the fields land in front of
 * someone who can see they are wrong before anything is written.
 *
 * The one exception is the cover, which cannot ride along in the form: it has to be
 * downloaded server-side and re-encoded by the worker. It is applied immediately and safely —
 * `coverKey` only moves once the worker finishes, so the current cover keeps serving in the
 * meantime and a Discard afterwards leaves nothing broken.
 */
const m = adminMessages.seriesLookup

export interface LookupPatch {
  title: string
  type: string
  status: string
  synopsis: string | null
  releasedYear: number | null
  ageRating: string | null
  titles: Array<{ title: string; lang: string | null }>
  people: Array<{ id: number | null; name: string; credit: string }>
  genreIds: number[]
}

interface Props {
  seriesId: number
  currentTitle: string
  genres: Array<{ id: number; name: string; kind: string }>
  onApply: (patch: LookupPatch) => void
  onClose: () => void
}

const anilistId = (sourceId: string): number => Number(sourceId.split(':')[1] ?? 0)

export function MetadataLookup({ seriesId, currentTitle, genres, onApply, onClose }: Props) {
  const { toast } = useToast()
  const [term, setTerm] = useState(currentTitle)
  const [results, setResults] = useState<SeriesMetadata[] | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const search = async () => {
    if (term.trim().length < 2) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/metadata/search?q=${encodeURIComponent(term.trim())}`)
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        toast({ title: res.status === 429 ? m.rateLimited : m.sourceUnavailable, tone: 'danger' })
        setResults([])
        return
      }
      setResults(body?.data?.results ?? [])
    } catch {
      toast({ title: m.sourceUnavailable, tone: 'danger' })
      setResults([])
    } finally {
      setBusy(false)
    }
  }

  /** AniList genre names against this site's own list, by slug — never inventing a genre. */
  const matchGenres = (names: readonly string[]): number[] => {
    const bySlug = new Map(genres.map((g) => [slugify(g.name), g.id]))
    return names
      .map((n) => bySlug.get(slugify(n)))
      .filter((id): id is number => typeof id === 'number')
  }

  const use = async (meta: SeriesMetadata) => {
    onApply({
      title: meta.title,
      type: meta.type,
      status: meta.status,
      synopsis: meta.synopsis,
      releasedYear: meta.releasedYear,
      ageRating: meta.ageRating,
      titles: meta.altTitles.map((title) => ({ title, lang: null })),
      people: meta.people.map((p) => ({ id: null, name: p.name, credit: p.credit })),
      genreIds: matchGenres(meta.genres),
    })
    onClose()
    toast({ title: m.applied, tone: 'ok' })
    if (!meta.coverUrl) return
    // Best effort and out of band: a series whose text is filled is worth having even if the
    // image host is down.
    try {
      const res = await fetch('/api/admin/metadata/cover', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ seriesId, anilistId: anilistId(meta.sourceId) }),
      })
      const body = await res.json().catch(() => null)
      toast({
        title: res.ok && body?.data?.queued ? m.coverQueued : m.coverFailed,
        tone: res.ok && body?.data?.queued ? 'ok' : 'neutral',
      })
    } catch {
      toast({ title: m.coverFailed, tone: 'neutral' })
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={m.dialogTitle}
    >
      <div className="w-full max-w-2xl rounded-lg border border-line bg-surface-1 p-4 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-fg">{m.dialogTitle}</h2>
            <p className="mt-0.5 text-[12px] text-fg-muted">{m.dialogHint}</p>
          </div>
          <Button variant="outline" onClick={onClose}>
            {m.close}
          </Button>
        </div>

        <div className="mb-3 flex gap-2">
          <input
            ref={inputRef}
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
          <Button onClick={() => void search()} disabled={busy || term.trim().length < 2}>
            {busy ? m.searching : m.search}
          </Button>
        </div>

        {results === null ? (
          <p className="text-[13px] text-fg-muted">{m.prompt}</p>
        ) : results.length === 0 ? (
          <p className="text-[13px] text-fg-muted">{m.noResults}</p>
        ) : (
          <ul className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
            {results.map((r) => (
              <li key={r.sourceId}>
                <Panel>
                  <div className="flex items-start gap-3">
                    {r.coverUrl ? (
                      // Preview only — the real cover is copied into our own bucket.
                      <img
                        src={r.coverUrl}
                        alt=""
                        width={48}
                        height={68}
                        className="h-17 w-12 shrink-0 rounded border border-line object-cover"
                        loading="lazy"
                      />
                    ) : null}
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium text-fg">{r.title}</span>
                        <Pill tone="brand">{r.type}</Pill>
                        {r.releasedYear ? <Pill>{r.releasedYear}</Pill> : null}
                      </div>
                      <p className="line-clamp-2 text-[12px] text-fg-muted">
                        {r.synopsis ?? m.noSynopsis}
                      </p>
                    </div>
                    <Button onClick={() => void use(r)}>{m.use}</Button>
                  </div>
                </Panel>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[11px] text-fg-subtle">{m.attribution}</p>
      </div>
    </div>
  )
}
