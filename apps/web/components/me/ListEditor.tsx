'use client'

import { fmt, messages } from '@palscans/core/messages'
import { Button, Chip, cn, type SeriesType, useToast } from '@palscans/ui'
import { ChevronDown, ChevronUp, Globe, Link2, Lock, Trash2, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useState } from 'react'
import { api, inputClasses, labelClasses } from '@/app/(site)/me/_components/api'

export interface ListEditorItem {
  seriesId: number
  slug: string
  title: string
  type: SeriesType | 'novel'
  cover: string
  chapterCount: number
}

export interface ListEditorList {
  id: number
  name: string
  description: string | null
  isPublic: boolean
  slug: string
}

interface SearchHit {
  id: number
  slug: string
  title: string
  cover: string
  type: string
}

/**
 * The owner's view of one reading list: rename, publish, add, reorder, remove.
 *
 * Order is held in component state and written through to
 * `PATCH /api/lists/:id/items/:seriesId`, so a move is instant on the thumb and the server
 * still owns the truth — a failed write re-reads the page rather than leaving the two out
 * of step. Reordering is buttons, not drag: it works with a keyboard, a screen reader and
 * one thumb on a phone, which is where most of these sessions happen (docs/06).
 */
export function ListEditor({
  list,
  items: initialItems,
  shareUrl,
}: {
  list: ListEditorList
  items: ListEditorItem[]
  /** Absolute `/lists/{owner}/{slug}` URL, built on the server from SITE_URL. */
  shareUrl: string
}) {
  const router = useRouter()
  const toast = useToast()
  const m = messages.me.lists
  const nameId = useId()
  const descriptionId = useId()
  const searchId = useId()

  const [items, setItems] = useState(initialItems)
  const [serverItems, setServerItems] = useState(initialItems)
  const [name, setName] = useState(list.name)
  const [description, setDescription] = useState(list.description ?? '')
  const [isPublic, setIsPublic] = useState(list.isPublic)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)

  // Adjust state when the props change, during render — the server sends a new array only
  // after `router.refresh()`, so this runs once per refresh and never in a loop.
  if (initialItems !== serverItems) {
    setServerItems(initialItems)
    setItems(initialItems)
  }

  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) {
      setHits([])
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}&limit=8`, {
          signal: controller.signal,
        })
        const json = (await res.json()) as { data?: { results?: SearchHit[] } }
        setHits(json.data?.results ?? [])
      } catch {
        // an aborted or failed lookup just leaves the previous results in place
      } finally {
        setSearching(false)
      }
    }, 250)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [query])

  const move = async (index: number, delta: number) => {
    const to = index + delta
    const entry = items[index]
    if (!entry || to < 0 || to >= items.length) return
    const next = [...items]
    next.splice(index, 1)
    next.splice(to, 0, entry)
    setItems(next)
    const res = await api<{ message: string }>(
      `/api/lists/${list.id}/items/${entry.seriesId}`,
      { toIndex: to },
      'PATCH',
    )
    if (!res.ok) {
      setItems(items)
      toast.toast({ title: res.message })
    }
  }

  const remove = async (seriesId: number) => {
    setBusy(true)
    const res = await api<{ message: string }>(
      `/api/lists/${list.id}/items/${seriesId}`,
      undefined,
      'DELETE',
    )
    setBusy(false)
    toast.toast({ title: res.ok ? res.data.message : res.message })
    if (res.ok) {
      setItems((current) => current.filter((i) => i.seriesId !== seriesId))
      router.refresh()
    }
  }

  const add = async (hit: SearchHit) => {
    setBusy(true)
    const res = await api<{ message: string }>(`/api/lists/${list.id}/items`, {
      seriesId: hit.id,
    })
    setBusy(false)
    toast.toast({ title: res.ok ? res.data.message : res.message })
    if (res.ok) {
      setQuery('')
      setHits([])
      router.refresh()
    }
  }

  const saveDetails = async () => {
    setBusy(true)
    const res = await api<{ message: string }>(
      `/api/lists/${list.id}`,
      { name: name.trim(), description: description.trim() || null },
      'PATCH',
    )
    setBusy(false)
    toast.toast({ title: res.ok ? res.data.message : res.message })
    if (res.ok) router.refresh()
  }

  const toggleVisibility = async () => {
    const next = !isPublic
    setBusy(true)
    const res = await api<{ message: string }>(`/api/lists/${list.id}`, { isPublic: next }, 'PATCH')
    setBusy(false)
    toast.toast({ title: res.ok ? res.data.message : res.message })
    if (res.ok) {
      setIsPublic(next)
      router.refresh()
    }
  }

  const destroy = async () => {
    if (!window.confirm(m.deleteConfirm)) return
    setBusy(true)
    const res = await api<{ message: string }>(`/api/lists/${list.id}`, undefined, 'DELETE')
    setBusy(false)
    toast.toast({ title: res.ok ? res.data.message : res.message })
    if (res.ok) router.push('/me/lists')
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      toast.toast({ title: m.copied })
    } catch {
      toast.toast({ title: shareUrl })
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-lg border border-line bg-surface-1 p-4 sm:p-5">
        <h2 className="mb-3 font-display text-base font-extrabold uppercase tracking-[-0.01em] text-fg">
          {m.settings}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClasses} htmlFor={nameId}>
              {m.name}
            </label>
            <input
              id={nameId}
              className={`${inputClasses} mt-1`}
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClasses} htmlFor={descriptionId}>
              {m.description}
            </label>
            <input
              id={descriptionId}
              className={`${inputClasses} mt-1`}
              value={description}
              maxLength={300}
              placeholder={m.descriptionPlaceholder}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" onClick={saveDetails} disabled={busy}>
            {m.save}
          </Button>
          <Button variant="outline" size="sm" onClick={toggleVisibility} disabled={busy}>
            {isPublic ? (
              <Lock size={14} aria-hidden="true" />
            ) : (
              <Globe size={14} aria-hidden="true" />
            )}
            {isPublic ? m.private : m.public}
          </Button>
          {isPublic ? (
            <Button variant="outline" size="sm" onClick={copy}>
              <Link2 size={14} aria-hidden="true" />
              {m.copyLink}
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={destroy} disabled={busy} className="ml-auto">
            <Trash2 size={14} aria-hidden="true" />
            {m.delete}
          </Button>
        </div>
        <p className="mt-3 text-[12px] text-fg-muted">{m.publicHint}</p>
        {isPublic ? <p className="mt-1 break-all text-[12px] text-fg-subtle">{shareUrl}</p> : null}
      </section>

      <section className="rounded-lg border border-line bg-surface-1 p-4 sm:p-5">
        <label className={labelClasses} htmlFor={searchId}>
          {m.addSeries}
        </label>
        <input
          id={searchId}
          type="search"
          className={`${inputClasses} mt-1`}
          value={query}
          placeholder={m.addPlaceholder}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query.trim().length >= 2 ? (
          <ul className="mt-3 flex flex-col gap-1">
            {hits.length === 0 && !searching ? (
              <li className="px-1 py-2 text-[13px] text-fg-muted">{m.addNoResults}</li>
            ) : null}
            {hits.map((hit) => (
              <li key={hit.id}>
                <button
                  type="button"
                  onClick={() => add(hit)}
                  disabled={busy}
                  className="flex w-full items-center gap-3 rounded-md p-2 text-left transition-colors hover:bg-surface-2 disabled:opacity-60"
                >
                  <img
                    src={hit.cover}
                    alt=""
                    width={400}
                    height={600}
                    loading="lazy"
                    decoding="async"
                    className="aspect-[2/3] w-8 rounded-sm object-cover"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
                    {hit.title}
                  </span>
                  <span className="text-[12px] font-bold uppercase text-fg-muted">{m.add}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-6 py-10 text-center text-sm text-fg-muted">
          {m.itemsEmptyLead}
        </p>
      ) : (
        <ol className="divide-y divide-line-soft rounded-lg border border-line bg-surface-1">
          {items.map((item, index) => (
            <li key={item.seriesId} className="flex items-center gap-3 p-3">
              <span className="w-6 shrink-0 text-center text-[13px] font-bold tabular-nums text-fg-subtle">
                {index + 1}
              </span>
              <a href={`/series/${item.slug}`} className="shrink-0">
                <img
                  src={item.cover}
                  alt=""
                  width={400}
                  height={600}
                  loading="lazy"
                  decoding="async"
                  className="aspect-[2/3] w-10 rounded-sm bg-surface-2 object-cover"
                />
              </a>
              <div className="min-w-0 flex-1">
                <a
                  href={`/series/${item.slug}`}
                  className="line-clamp-1 text-sm font-bold text-fg hover:text-brand-hover"
                >
                  {item.title}
                </a>
                <p className="mt-0.5 flex items-center gap-2 text-[12px] text-fg-muted">
                  {item.type === 'novel' ? (
                    <Chip variant="genre" size="sm">
                      {messages.series.type.novel}
                    </Chip>
                  ) : (
                    <Chip variant="type" value={item.type} size="sm" />
                  )}
                  <span>{fmt(messages.series.chapterCount, { n: item.chapterCount })}</span>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <IconButton label={m.moveUp} disabled={index === 0} onClick={() => move(index, -1)}>
                  <ChevronUp size={16} />
                </IconButton>
                <IconButton
                  label={m.moveDown}
                  disabled={index === items.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ChevronDown size={16} />
                </IconButton>
                <IconButton
                  label={m.removeItem}
                  disabled={busy}
                  onClick={() => remove(item.seriesId)}
                >
                  <X size={16} />
                </IconButton>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex size-9 items-center justify-center rounded-md border border-line bg-surface-1 text-fg-muted transition-colors',
        'hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-40',
      )}
    >
      {children}
    </button>
  )
}
