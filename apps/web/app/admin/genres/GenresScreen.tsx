'use client'

import { fmt, messages } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { Button, cn, useToast } from '@palscans/ui'
import {
  ArrowDown,
  ArrowUp,
  Check,
  GitMerge,
  Pencil,
  RotateCcw,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { del, patchJson, postJson } from '@/components/admin/client/api'
import { ConfirmTyped, Modal } from '@/components/admin/client/controls'
import {
  EmptyRow,
  Hint,
  inputClass,
  Num,
  Panel,
  PanelHeader,
  Pill,
  selectClass,
  Table,
  Td,
  Th,
} from '@/components/admin/ui'

/**
 * The genre list: create, rename, re-slug, reclassify, reorder, retire and restore.
 *
 * Two things on this screen change what a URL does, and both say so before the click rather
 * than after it — the slug field carries the redirect note inline, and retiring opens a
 * dialog that states what happens to the tagged series and to `/genres/<slug>`, with the
 * merge offered as the alternative that keeps the URL alive.
 */

export interface GenreView {
  id: number
  slug: string
  name: string
  kind: string
  position: number
  seriesCount: number
  publishedCount: number
  retired: boolean
  mergedIntoName: string | null
  mergedIntoSlug: string | null
}

const m = adminMessages.genreAdmin
const KINDS = ['genre', 'theme', 'format'] as const
type Kind = (typeof KINDS)[number]

const kindLabel = (k: string) => m.kinds[k as Kind] ?? k
const kindName = (k: string) => m.kindNames[k as Kind] ?? k

/** The lowercase-hyphen slug the API will accept, previewed as the operator types. */
const toSlug = (v: string) =>
  v
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

export function GenresScreen({
  initial,
  rights,
}: {
  initial: GenreView[]
  rights: { update: boolean; remove: boolean }
}) {
  const { toast } = useToast()
  const [rows, setRows] = useState<GenreView[]>(initial)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState<{ name: string; slug: string; kind: string }>({
    name: '',
    slug: '',
    kind: 'genre',
  })
  const [creating, setCreating] = useState({ name: '', slug: '', kind: 'genre' as string })
  const [busy, setBusy] = useState(false)
  const [retiring, setRetiring] = useState<GenreView | null>(null)

  const q = query.trim().toLowerCase()
  const matches = (g: GenreView) =>
    q === '' || g.name.toLowerCase().includes(q) || g.slug.toLowerCase().includes(q)

  // A site has tens of genres, not thousands: filtering on every keystroke is cheaper than
  // the memo bookkeeping would be, and keeps `matches` out of a dependency array.
  const live = rows.filter((g) => !g.retired)
  const retired = rows.filter((g) => g.retired).filter(matches)

  const byKind = (kind: string) =>
    live
      .filter((g) => g.kind === kind)
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))

  const fail = (message: string) =>
    toast({ title: adminMessages.admin.errorSaving, description: message, tone: 'danger' })

  /* ---------------------------------------------------------------- create */

  const create = async () => {
    const name = creating.name.trim()
    if (!name) return fail(m.nameRequired)
    setBusy(true)
    const res = await postJson<GenreView>('/api/admin/genres', {
      name,
      slug: creating.slug.trim(),
      kind: creating.kind,
    })
    setBusy(false)
    if (!res.ok) return fail(res.message || res.error)
    setRows((rs) => [
      ...rs,
      {
        ...res.data,
        seriesCount: 0,
        publishedCount: 0,
        retired: false,
        mergedIntoName: null,
        mergedIntoSlug: null,
      },
    ])
    setCreating({ name: '', slug: '', kind: creating.kind })
    toast({ title: fmt(m.created, { name }), tone: 'ok' })
  }

  /* ---------------------------------------------------------------- edit */

  const startEdit = (g: GenreView) => {
    setEditing(g.id)
    setDraft({ name: g.name, slug: g.slug, kind: g.kind })
  }

  const saveEdit = async (g: GenreView) => {
    const slug = toSlug(draft.slug || draft.name)
    if (!draft.name.trim()) return fail(m.nameRequired)
    if (!slug) return fail(m.slugInvalid)
    setBusy(true)
    const res = await patchJson<GenreView & { redirectedFrom: string | null }>(
      `/api/admin/genres/${g.id}`,
      { name: draft.name.trim(), slug, kind: draft.kind },
    )
    setBusy(false)
    if (!res.ok) return fail(res.message || res.error)
    setRows((rs) => rs.map((r) => (r.id === g.id ? { ...r, ...res.data } : r)))
    setEditing(null)
    toast({
      title: fmt(m.saved, { name: res.data.name }),
      description: res.data.redirectedFrom
        ? fmt(m.slugChanged, { from: res.data.redirectedFrom, to: res.data.slug })
        : undefined,
      tone: 'ok',
    })
  }

  /* ---------------------------------------------------------------- order */

  const move = async (g: GenreView, delta: -1 | 1) => {
    const list = byKind(g.kind)
    const i = list.findIndex((x) => x.id === g.id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= list.length) return
    const next = [...list]
    const a = next[i]
    const b = next[j]
    if (!a || !b) return
    next[i] = b
    next[j] = a
    const ids = next.map((x) => x.id)
    setRows((rs) =>
      rs.map((r) => {
        const at = ids.indexOf(r.id)
        return at === -1 ? r : { ...r, position: at + 1 }
      }),
    )
    const res = await patchJson<{ moved: number }>('/api/admin/genres', { kind: g.kind, ids })
    if (!res.ok) return fail(res.message || res.error)
    toast({ title: m.orderSaved, tone: 'ok' })
  }

  /* ---------------------------------------------------------------- retire / restore */

  const retire = async (g: GenreView) => {
    setBusy(true)
    const res = await del<GenreView>(`/api/admin/genres/${g.id}`)
    setBusy(false)
    setRetiring(null)
    if (!res.ok) return fail(res.message || res.error)
    setRows((rs) => rs.map((r) => (r.id === g.id ? { ...r, retired: true } : r)))
    toast({ title: fmt(m.deleted, { name: g.name }), tone: 'ok' })
  }

  const restore = async (g: GenreView) => {
    const res = await postJson<GenreView>(`/api/admin/genres/${g.id}`, { action: 'restore' })
    if (!res.ok) return fail(res.message || res.error)
    setRows((rs) => rs.map((r) => (r.id === g.id ? { ...r, ...res.data, retired: false } : r)))
    toast({ title: fmt(m.restored, { name: g.name }), tone: 'ok' })
  }

  /* ---------------------------------------------------------------- render */

  const row = (g: GenreView, index: number, lastIndex: number) => {
    const isEditing = editing === g.id
    return (
      <tr key={g.id}>
        <Td className="w-[28%]">
          {isEditing ? (
            <input
              className={inputClass}
              value={draft.name}
              aria-label={m.colName}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          ) : (
            <span className="font-semibold">{g.name}</span>
          )}
        </Td>
        <Td className="w-[26%]">
          {isEditing ? (
            <div className="flex flex-col gap-1">
              <input
                className={`${inputClass} font-mono text-[12px]`}
                value={draft.slug}
                aria-label={m.colSlug}
                onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
              />
              {toSlug(draft.slug || draft.name) !== g.slug ? (
                <span className="flex items-start gap-1.5 text-[12px] leading-4 text-warn">
                  <TriangleAlert size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                  {m.slugWarning}
                </span>
              ) : null}
            </div>
          ) : (
            <a
              href={`/genres/${g.slug}`}
              className="font-mono text-[12px] text-fg-muted hover:text-brand-hover"
            >
              /{g.slug}
            </a>
          )}
        </Td>
        <Td className="w-[12%]">
          {isEditing ? (
            <select
              className={selectClass}
              value={draft.kind}
              aria-label={m.colKind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {kindName(k)}
                </option>
              ))}
            </select>
          ) : (
            <Pill>{kindName(g.kind)}</Pill>
          )}
        </Td>
        <Td align="right" className="w-[14%]">
          <span title={m.seriesCountHint}>
            <Num className={g.seriesCount === 0 ? 'text-fg-subtle' : undefined}>
              {fmt(m.seriesCount, { total: g.seriesCount, published: g.publishedCount })}
            </Num>
          </span>
        </Td>
        <Td className="w-[8%]">
          <div className="flex gap-0.5">
            <IconButton
              label={`${m.moveUp}: ${g.name}`}
              disabled={!rights.update || index === 0 || isEditing}
              onClick={() => void move(g, -1)}
            >
              <ArrowUp size={14} />
            </IconButton>
            <IconButton
              label={`${m.moveDown}: ${g.name}`}
              disabled={!rights.update || index === lastIndex || isEditing}
              onClick={() => void move(g, 1)}
            >
              <ArrowDown size={14} />
            </IconButton>
          </div>
        </Td>
        <Td align="right">
          <div className="flex justify-end gap-1">
            {isEditing ? (
              <>
                <Button size="sm" disabled={busy} onClick={() => void saveEdit(g)}>
                  <Check size={13} aria-hidden="true" />
                  {m.save}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
                  {m.cancel}
                </Button>
              </>
            ) : (
              <>
                {rights.update ? (
                  <Button size="sm" variant="outline" onClick={() => startEdit(g)}>
                    <Pencil size={13} aria-hidden="true" />
                    {m.edit}
                  </Button>
                ) : null}
                {rights.remove ? (
                  <>
                    <a
                      href={`/admin/genres/merge?loser=${g.id}`}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[13px] font-semibold hover:bg-surface-2"
                    >
                      <GitMerge size={13} aria-hidden="true" />
                      {m.mergeAction}
                    </a>
                    <IconButton
                      label={`${m.deleteAction}: ${g.name}`}
                      danger
                      onClick={() => setRetiring(g)}
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </>
                ) : null}
              </>
            )}
          </div>
        </Td>
      </tr>
    )
  }

  return (
    <div className="flex flex-col gap-3.5">
      {rights.update ? (
        <Panel>
          <PanelHeader title={m.newTitle} hint={m.newHint} />
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-fg-muted">{m.colName}</span>
              <input
                className={`${inputClass} w-56`}
                placeholder={m.namePlaceholder}
                value={creating.name}
                onChange={(e) => setCreating({ ...creating, name: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-fg-muted">{m.colSlug}</span>
              <input
                className={`${inputClass} w-56 font-mono text-[12px]`}
                placeholder={toSlug(creating.name) || m.slugPlaceholder}
                value={creating.slug}
                onChange={(e) => setCreating({ ...creating, slug: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-fg-muted">{m.colKind}</span>
              <select
                className={`${selectClass} w-36`}
                value={creating.kind}
                onChange={(e) => setCreating({ ...creating, kind: e.target.value })}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {kindName(k)}
                  </option>
                ))}
              </select>
            </label>
            <Button size="sm" className="h-9" disabled={busy} onClick={() => void create()}>
              {m.add}
            </Button>
          </div>
          <Hint className="mt-2">{m.kindHint}</Hint>
        </Panel>
      ) : null}

      <input
        className={`${inputClass} max-w-xs`}
        placeholder={m.searchPlaceholder}
        aria-label={m.searchPlaceholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {KINDS.filter((k) => byKind(k).length > 0).map((kind) => {
        const list = byKind(kind).filter(matches)
        const full = byKind(kind)
        return (
          <section key={kind} className="flex flex-col gap-2">
            <h2 className="font-body text-[16px] font-bold normal-case tracking-normal">
              {kindLabel(kind)}
              <span className="ml-2 text-[13px] font-normal text-fg-muted">{full.length}</span>
            </h2>
            <Table>
              <thead>
                <tr>
                  <Th>{m.colName}</Th>
                  <Th>{m.colSlug}</Th>
                  <Th>{m.colKind}</Th>
                  <Th align="right">{m.colSeries}</Th>
                  <Th>{m.colOrder}</Th>
                  <Th align="right">{adminMessages.admin.actions}</Th>
                </tr>
              </thead>
              <tbody>
                {list.length === 0 ? (
                  // "Nothing matched" and "nothing exists" are different facts, and a search
                  // that hides a whole section must not read as an empty catalogue.
                  <EmptyRow colSpan={6}>{q ? adminMessages.admin.noResults : m.empty}</EmptyRow>
                ) : null}
                {list.map((g) =>
                  row(
                    g,
                    full.findIndex((x) => x.id === g.id),
                    full.length - 1,
                  ),
                )}
              </tbody>
            </Table>
            <Hint>{m.orderHint}</Hint>
          </section>
        )
      })}

      {retired.length > 0 ? (
        <Panel className="p-0 md:px-0">
          <div className="px-5 pt-4">
            <PanelHeader title={m.retiredTitle} hint={m.retiredHint} />
          </div>
          <Table className="rounded-none border-0 border-t">
            <thead>
              <tr>
                <Th>{m.colName}</Th>
                <Th>{m.colSlug}</Th>
                <Th align="right">{m.colSeries}</Th>
                <Th align="right">{adminMessages.admin.actions}</Th>
              </tr>
            </thead>
            <tbody>
              {retired.map((g) => (
                <tr key={g.id}>
                  <Td>
                    <span className="text-fg-muted">{g.name}</span>
                    {g.mergedIntoName ? (
                      <span className="ml-2 text-[12px] text-fg-subtle">
                        {fmt(m.mergedInto, { name: g.mergedIntoName })}
                      </span>
                    ) : null}
                  </Td>
                  <Td className="font-mono text-[12px] text-fg-subtle">/{g.slug}</Td>
                  <Td align="right">
                    <Num className="text-fg-subtle">{g.seriesCount}</Num>
                  </Td>
                  <Td align="right">
                    {rights.remove && !g.mergedIntoName ? (
                      <Button size="sm" variant="outline" onClick={() => void restore(g)}>
                        <RotateCcw size={13} aria-hidden="true" />
                        {m.restore}
                      </Button>
                    ) : (
                      <span className="text-[12px] text-fg-subtle">{m.retiredCannotRestore}</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      ) : null}

      <RetireDialog
        genre={retiring}
        busy={busy}
        onClose={() => setRetiring(null)}
        onConfirm={(g) => void retire(g)}
      />
    </div>
  )
}

function IconButton({
  label,
  children,
  onClick,
  disabled,
  danger,
}: {
  label: string
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-md border border-line text-fg-muted disabled:opacity-40',
        danger ? 'hover:border-danger hover:text-danger' : 'hover:bg-surface-2 hover:text-fg',
      )}
    >
      {children}
    </button>
  )
}

/**
 * Retiring says what it costs first.
 *
 * A genre nothing is tagged with is a plain confirm. A genre in use gets the typed
 * confirmation used everywhere else for destructive actions, and the body names the two
 * consequences that are not obvious: the series keep their rows (so a restore brings them
 * back) and `/genres/<slug>` starts answering 404 with no redirect — which is the reason to
 * merge instead, offered right there.
 */
function RetireDialog({
  genre,
  busy,
  onClose,
  onConfirm,
}: {
  genre: GenreView | null
  busy: boolean
  onClose: () => void
  onConfirm: (g: GenreView) => void
}) {
  if (!genre) return null
  const inUse = genre.seriesCount > 0
  const body = (
    <div className="flex flex-col gap-2">
      <p>
        {inUse
          ? fmt(m.deleteInUse, { count: genre.seriesCount, slug: genre.slug })
          : fmt(m.deleteUnused, { slug: genre.slug })}
      </p>
      {inUse ? (
        <p className="flex items-start gap-2 rounded-md bg-surface-2 p-2.5 text-[12.5px] leading-[17px]">
          <GitMerge size={14} className="mt-0.5 shrink-0 text-fg-subtle" aria-hidden="true" />
          <span>
            {m.deleteMergeInstead}{' '}
            <a
              className="font-semibold text-brand-hover underline"
              href={`/admin/genres/merge?loser=${genre.id}`}
            >
              {m.mergeTitle}
            </a>
          </span>
        </p>
      ) : null}
    </div>
  )
  return inUse ? (
    <ConfirmTyped
      open
      title={fmt(m.deleteTitle, { name: genre.name })}
      body={body}
      expected={genre.slug}
      confirmLabel={m.deleteButton}
      // Not "this cannot be undone": retiring keeps the rows, and Restore brings them back.
      hint={m.deleteUndoHint}
      onConfirm={() => onConfirm(genre)}
      onClose={onClose}
    />
  ) : (
    <Modal
      open
      title={fmt(m.deleteTitle, { name: genre.name })}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            {messages.common.cancel}
          </Button>
          <Button
            size="sm"
            disabled={busy}
            className="bg-danger text-white hover:bg-danger/90"
            onClick={() => onConfirm(genre)}
          >
            <X size={13} aria-hidden="true" />
            {m.deleteButton}
          </Button>
        </>
      }
    >
      <div className="text-[13px] leading-5 text-fg-muted">{body}</div>
    </Modal>
  )
}
