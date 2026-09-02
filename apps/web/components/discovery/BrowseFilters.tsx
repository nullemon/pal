import { fmt, messages } from '@palscans/core/messages'
import { buttonClasses, cn } from '@palscans/ui'
import { X } from 'lucide-react'
import Link from 'next/link'
import {
  BROWSE_SORTS,
  type BrowseParams,
  type BrowseSort,
  browseHref,
  isFiltered,
  MIN_CHAPTER_OPTIONS,
  MIN_RATING_OPTIONS,
  SERIES_STATUSES,
  SERIES_TYPES,
} from './filters'
import type { GenreSummary } from './types'

export const SORT_LABELS: Record<BrowseSort, string> = {
  latest: messages.browse.sortLatest,
  popular: messages.browse.sortPopular,
  rating: messages.browse.sortRating,
  newest: messages.browse.sortNewest,
  title: messages.browse.sortTitle,
}

const KIND_LABELS: Record<string, string> = {
  genre: messages.browse.genres,
  theme: messages.genres.themes,
  format: messages.genres.formats,
}

const select =
  'h-9 w-full rounded-md border border-line bg-surface-2 px-2.5 text-[13px] font-medium text-fg outline-none focus-visible:border-brand'
const label = 'text-[11px] font-extrabold uppercase tracking-[0.12em] text-fg-muted'

export interface BrowseFiltersProps {
  params: BrowseParams
  genres: GenreSummary[]
  className?: string
}

/**
 * Plain GET form: every control is a real input, so filters work without JavaScript and
 * the result is a shareable URL. Genres are two checkbox lists — include (all must match)
 * and exclude (none may match), docs/13 "Exclude filters".
 */
export function BrowseFilters({ params, genres, className }: BrowseFiltersProps) {
  const byKind = new Map<string, GenreSummary[]>()
  for (const g of genres) byKind.set(g.kind, [...(byKind.get(g.kind) ?? []), g])
  const kinds = ['genre', 'theme', 'format'].filter((k) => byKind.has(k))

  return (
    <form
      action="/browse"
      method="get"
      className={cn(
        'flex flex-col gap-4 rounded-[10px] border border-line bg-surface-1 p-3',
        className,
      )}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
        <Field id="f-type" text={messages.browse.type}>
          <select id="f-type" name="type" defaultValue={params.type ?? ''} className={select}>
            <option value="">{messages.discovery.any}</option>
            {SERIES_TYPES.map((t) => (
              <option key={t} value={t}>
                {messages.series.type[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field id="f-status" text={messages.browse.status}>
          <select id="f-status" name="status" defaultValue={params.status ?? ''} className={select}>
            <option value="">{messages.discovery.any}</option>
            {SERIES_STATUSES.map((s) => (
              <option key={s} value={s}>
                {messages.series.status[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field id="f-chapters" text={messages.browse.minChapters}>
          <select
            id="f-chapters"
            name="minChapters"
            defaultValue={String(params.minChapters)}
            className={select}
          >
            {MIN_CHAPTER_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n === 0 ? messages.discovery.any : fmt(messages.discovery.plus, { n })}
              </option>
            ))}
          </select>
        </Field>
        <Field id="f-rating" text={messages.browse.minRating}>
          <select
            id="f-rating"
            name="minRating"
            defaultValue={String(params.minRating)}
            className={select}
          >
            {MIN_RATING_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n === 0
                  ? messages.discovery.any
                  : fmt(messages.discovery.plus, { n: n.toFixed(1) })}
              </option>
            ))}
          </select>
        </Field>
        <Field id="f-sort" text={messages.browse.sort}>
          <select id="f-sort" name="sort" defaultValue={params.sort} className={select}>
            {BROWSE_SORTS.map((s) => (
              <option key={s} value={s}>
                {SORT_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <GenrePicker
        name="genre"
        title={messages.browse.genres}
        hint={messages.discovery.includeHint}
        selected={params.genre}
        kinds={kinds}
        byKind={byKind}
        open={params.genre.length > 0}
      />
      <GenrePicker
        name="exclude"
        title={messages.browse.exclude}
        hint={messages.discovery.excludeHint}
        selected={params.exclude}
        kinds={kinds}
        byKind={byKind}
        open={params.exclude.length > 0}
      />

      <div className="flex items-center gap-2">
        <button type="submit" className={buttonClasses('primary', 'sm', 'flex-1')}>
          {messages.browse.apply}
        </button>
        <Link href="/browse" className={buttonClasses('outline', 'sm')}>
          {messages.browse.reset}
        </Link>
      </div>
    </form>
  )
}

function Field({ id, text, children }: { id: string; text: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={label}>
        {text}
      </label>
      {children}
    </div>
  )
}

function GenrePicker({
  name,
  title,
  hint,
  selected,
  kinds,
  byKind,
  open,
}: {
  name: 'genre' | 'exclude'
  title: string
  hint: string
  selected: string[]
  kinds: string[]
  byKind: Map<string, GenreSummary[]>
  open: boolean
}) {
  const chosen = new Set(selected)
  return (
    <details open={open} className="group rounded-md border border-line bg-surface-2/40">
      <summary className="flex cursor-pointer select-none items-center justify-between px-2.5 py-2 text-[12px] font-extrabold uppercase tracking-[0.12em] text-fg-muted marker:hidden [&::-webkit-details-marker]:hidden">
        <span>
          {title}
          {selected.length > 0 ? (
            <span className="ml-1.5 rounded-sm bg-brand px-1.5 py-0.5 text-[10px] text-brand-ink">
              {selected.length}
            </span>
          ) : null}
        </span>
        <span
          aria-hidden="true"
          className="text-fg-subtle transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <div className="flex flex-col gap-3 px-2.5 pb-2.5">
        <p className="text-[12px] text-fg-subtle">{hint}</p>
        {kinds.map((kind) => (
          <fieldset key={kind} className="flex flex-col gap-1.5">
            <legend className="mb-1 text-[11px] font-bold uppercase tracking-[0.1em] text-fg-subtle">
              {KIND_LABELS[kind] ?? kind}
            </legend>
            <div className="grid grid-cols-2 gap-x-2 gap-y-1 sm:grid-cols-3 lg:grid-cols-2">
              {(byKind.get(kind) ?? []).map((g) => (
                <label
                  key={g.id}
                  className="flex min-h-7 cursor-pointer items-center gap-1.5 text-[13px] text-fg-muted hover:text-fg"
                >
                  <input
                    type="checkbox"
                    name={name}
                    value={g.slug}
                    defaultChecked={chosen.has(g.slug)}
                    className="size-3.5 accent-brand"
                  />
                  <span className="truncate">{g.name}</span>
                  <span className="ml-auto text-[11px] tabular-nums text-fg-subtle">{g.count}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
    </details>
  )
}

/** The active filters as removable chips above the grid, each a link to the URL without it. */
export function ActiveFilters({
  params,
  genres,
}: {
  params: BrowseParams
  genres: GenreSummary[]
}) {
  if (!isFiltered({ ...params, page: 1, sort: 'latest' })) return null
  const name = (slug: string) => genres.find((g) => g.slug === slug)?.name ?? slug
  const chips: { label: string; href: string }[] = []
  if (params.type)
    chips.push({
      label: messages.series.type[params.type],
      href: browseHref({ ...params, type: undefined, page: 1 }),
    })
  if (params.status)
    chips.push({
      label: messages.series.status[params.status],
      href: browseHref({ ...params, status: undefined, page: 1 }),
    })
  for (const g of params.genre)
    chips.push({
      label: name(g),
      href: browseHref({ ...params, genre: params.genre.filter((x) => x !== g), page: 1 }),
    })
  for (const g of params.exclude)
    chips.push({
      label: `${messages.browse.exclude}: ${name(g)}`,
      href: browseHref({ ...params, exclude: params.exclude.filter((x) => x !== g), page: 1 }),
    })
  if (params.minChapters > 0)
    chips.push({
      label: `${messages.browse.minChapters} ${fmt(messages.discovery.plus, { n: params.minChapters })}`,
      href: browseHref({ ...params, minChapters: 0, page: 1 }),
    })
  if (params.minRating > 0)
    chips.push({
      label: `${messages.browse.minRating} ${fmt(messages.discovery.plus, { n: params.minRating.toFixed(1) })}`,
      href: browseHref({ ...params, minRating: 0, page: 1 }),
    })
  if (chips.length === 0) return null
  return (
    <ul aria-label={messages.discovery.activeFilters} className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <li key={c.label}>
          <Link
            href={c.href}
            aria-label={fmt(messages.discovery.removeFilter, { label: c.label })}
            className="inline-flex h-6 items-center gap-1 rounded-sm bg-brand-wash px-2 text-[11px] font-bold uppercase tracking-[0.08em] text-brand-hover hover:bg-brand/25"
          >
            {c.label}
            <X size={12} aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  )
}
