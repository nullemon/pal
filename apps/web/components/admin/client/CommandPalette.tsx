'use client'

import { adminMessages } from '@palscans/core/messages/admin'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { type AdminNavItem, adminNav } from '@/components/admin/nav-shared'

/**
 * ⌘K across the panel.
 *
 * 52 admin screens and no search: reaching one specific series meant opening the list and
 * filtering it. This is the shortcut, and it searches rows as well as screens, because the
 * thing an operator is usually looking for is a series, not the series list.
 *
 * Screens are matched locally from the same nav definition the sidebar renders, so a new
 * screen is searchable the moment it is added rather than when somebody remembers to add it
 * here too. Rows come from the server, which filters each section by the permission its
 * destination needs — an uploader is never offered a user they cannot open.
 *
 * No dependency: a dialog, an input and a list, which is all this needs.
 */
const m = adminMessages.palette

interface Hit {
  id: number
  label: string
  href: string
}

interface Results {
  series: Hit[]
  chapters: Hit[]
  users: Hit[]
}

const EMPTY: Results = { series: [], chapters: [], users: [] }

/** The nav items this account can actually open, flattened once. */
const screensFor = (allowed: readonly string[]): AdminNavItem[] =>
  adminNav.flatMap((group) => group.items.filter((item) => allowed.includes(item.permission)))

export function CommandPalette({ permissions }: { permissions: readonly string[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Results>(EMPTY)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((current) => !current)
      }
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) inputRef.current?.focus()
    else {
      setQ('')
      setResults(EMPTY)
    }
  }, [open])

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) {
      setResults(EMPTY)
      return
    }
    // Debounced, and the in-flight request is abandoned when the term moves on: without that
    // a slow response for "on" arrives after a fast one for "one punch" and replaces it.
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const response = await fetch(`/api/admin/search?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        })
        if (response.ok) setResults((await response.json()) as Results)
      } catch {
        /* aborted or offline — the previous results stay on screen */
      } finally {
        setLoading(false)
      }
    }, 180)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [q])

  const go = useCallback(
    (href: string) => {
      setOpen(false)
      router.push(href)
    },
    [router],
  )

  if (!open) return null

  const term = q.trim().toLowerCase()
  const screens = term
    ? screensFor(permissions)
        .filter((item) => item.label.toLowerCase().includes(term))
        .slice(0, 5)
    : []
  const sections: Array<[string, Hit[]]> = [
    [m.screens, screens.map((s, i) => ({ id: -i - 1, label: s.label, href: s.href }))],
    [m.series, results.series],
    [m.chapters, results.chapters],
    [m.users, results.users],
  ]
  const total = sections.reduce((n, [, hits]) => n + hits.length, 0)

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[12vh]"
      role="presentation"
      onClick={() => setOpen(false)}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: click-through guard for the backdrop */}
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface-1 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={m.open}
        onClick={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="w-full border-line border-b bg-transparent px-4 py-3 text-[15px] outline-none"
          placeholder={m.placeholder}
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
        <div className="max-h-[50vh] overflow-y-auto p-2">
          {total === 0 ? (
            <p className="px-2 py-3 text-fg-muted text-sm">{loading ? m.searching : m.empty}</p>
          ) : (
            sections.map(([label, hits]) =>
              hits.length === 0 ? null : (
                <div key={label} className="mb-2">
                  <p className="px-2 py-1 font-semibold text-[11px] text-fg-subtle uppercase tracking-wide">
                    {label}
                  </p>
                  {hits.map((hit) => (
                    <button
                      key={`${label}-${hit.id}`}
                      type="button"
                      className="block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-surface-2"
                      onClick={() => go(hit.href)}
                    >
                      {hit.label}
                    </button>
                  ))}
                </div>
              ),
            )
          )}
        </div>
      </div>
    </div>
  )
}
