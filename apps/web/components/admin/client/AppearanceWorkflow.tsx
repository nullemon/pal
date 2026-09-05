'use client'

import { fmt } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { Button, cn, useToast } from '@palscans/ui'
import { Check, ExternalLink, History } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type ReactNode, useState } from 'react'
import { type DiffEntry, diffDocuments, documentsEqual } from '@/lib/appearance/diff'
import { type AppearanceScope, previewStartHref } from '@/lib/appearance/scope'
import { api, del, postJson, putJson } from './api'
import { Modal, TopBarActions } from './controls'
import { relativeTime } from './util'

const m = adminMessages.appearanceVersions

export interface AppearanceVersion {
  id: number
  status: string
  createdAt: string
  publishedAt: string | null
  by: string | null
}

/**
 * The half of the workflow the *page* knows and the form does not: whether a draft exists,
 * when it was saved, when the screen was last published, and the log. One object so a screen
 * spreads it in and never has to be edited again when the workflow grows a field.
 */
export interface AppearanceWorkflowState {
  hasDraft: boolean
  draftSavedAt: string | null
  draftBy: string | null
  publishedAt: string | null
  publishedBy: string | null
  versions: AppearanceVersion[]
}

export interface AppearanceWorkflowProps<T> extends AppearanceWorkflowState {
  scope: AppearanceScope
  /** Draft `PUT`/`DELETE` here; publish at `${endpoint}/publish`. */
  endpoint: string
  /** What the form holds right now. */
  doc: T
  /** What is stored — the draft when there is one, otherwise what is live. */
  saved: T
  /** Put a document back into the form, after Discard. */
  onApply: (doc: T) => void
  /** Hold Save and Publish back while the form is invalid, without disabling Discard. */
  canSave?: boolean
  /** Extra controls for the status strip (Theme's presets link, say). */
  children?: ReactNode
}

/**
 * Draft → preview → publish → history, as the operator meets it: the top-bar controls, the
 * status strip, the version log and its diff — identical on Theme, Brand, Menus and Copy
 * (docs/15 "Presets, preview, history").
 *
 * Mount it once, where the status strip belongs (above the screen's panels); the Save,
 * Discard and Publish buttons portal themselves into the admin shell's top bar from here.
 *
 * ## Why the component owns the requests
 *
 * Every screen has to get the same four sequences right: save the draft; save-then-publish
 * when the form is dirty; discard back to what is live; and restore a version, including the
 * brand case where the restore has to be refused and re-asked with the operator's consent.
 * Four screens each doing that from their own handler is four places for the sequences to
 * drift, which is how three of them ended up with no workflow at all. So a screen hands over
 * the document and a way to put one back, and nothing else.
 *
 * A publish or a restore reloads the page rather than reconciling in place: it changes the
 * live document, the version list, the badges and every field of the form at once, and the
 * honest way to show all of that is the server's own render of it.
 */
export function AppearanceWorkflow<T>({
  scope,
  endpoint,
  doc,
  saved,
  hasDraft,
  draftSavedAt,
  draftBy,
  publishedAt,
  publishedBy,
  versions,
  onApply,
  canSave = true,
  children,
}: AppearanceWorkflowProps<T>) {
  const { toast } = useToast()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [missing, setMissing] = useState<{ id?: number; slots: string } | null>(null)
  const dirty = !documentsEqual(doc, saved)
  const now = new Date()
  const system = adminMessages.admin.audit.system

  const fail = (message?: string) =>
    toast({ title: adminMessages.admin.errorSaving, description: message, tone: 'danger' })

  /** Store the form as the draft. Returns true when it landed. */
  const persist = async (): Promise<boolean> => {
    const res = await putJson<{ id: number }>(endpoint, { settings: doc })
    if (!res.ok) {
      fail(res.message)
      return false
    }
    return true
  }

  /**
   * Re-render the server half — the badges, the "published … by …" line and the version log
   * all come from the page, and `saved` with them, so this is what turns the form clean
   * again. Client state survives, which is why a Save on the copy screen does not throw the
   * operator back to the top of 29 fields the way a full reload would.
   */
  const refresh = () => router.refresh()

  const saveDraft = async () => {
    setBusy(true)
    const okay = await persist()
    setBusy(false)
    if (!okay) return
    toast({ title: m.draftSaved, tone: 'ok' })
    refresh()
  }

  const discard = async () => {
    if (!hasDraft) return onApply(saved)
    setBusy(true)
    const res = await del<{ id: number }>(endpoint)
    setBusy(false)
    if (!res.ok) return fail(res.message)
    toast({ title: m.draftDiscarded, tone: 'ok' })
    window.location.reload()
  }

  const publish = async (versionId?: number, dropMissingAssets?: boolean) => {
    setBusy(true)
    if (!versionId && dirty && !(await persist())) {
      setBusy(false)
      return
    }
    const res = await postJson<{ id: number }>(`${endpoint}/publish`, {
      ...(versionId ? { versionId } : {}),
      ...(dropMissingAssets ? { dropMissingAssets } : {}),
    })
    setBusy(false)
    if (!res.ok) {
      if (res.error === 'missing_assets') return setMissing({ id: versionId, slots: res.message })
      return fail(res.message)
    }
    toast({
      title: versionId ? fmt(m.revertedToast, { id: versionId }) : m.publishedToast,
      tone: 'ok',
    })
    // Publishing the draft leaves the form holding what is now live, so a server refresh is
    // enough. A *restore* replaces the document under the form, and only a full load resets
    // the fields the operator is looking at.
    if (versionId) window.location.reload()
    else refresh()
  }

  return (
    <>
      <TopBarActions>
        <div className="mr-1 hidden items-center text-[13px] text-fg-muted lg:flex">
          {publishedAt
            ? fmt(m.lastPublished, {
                time: relativeTime(new Date(publishedAt), now),
                name: publishedBy ?? system,
              })
            : m.neverPublished}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 rounded-[9px]"
          disabled={busy || (!dirty && !hasDraft)}
          onClick={discard}
        >
          {hasDraft ? m.discardDraft : adminMessages.admin.discard}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-9 rounded-[9px]"
          disabled={busy || !dirty || !canSave}
          onClick={saveDraft}
        >
          {busy ? m.saving : m.saveDraft}
        </Button>
        <Button
          size="sm"
          className="h-9 rounded-[9px] px-4 font-bold"
          disabled={busy || !canSave || (!dirty && !hasDraft)}
          onClick={() => publish()}
        >
          <Check size={14} aria-hidden="true" />
          {m.publish}
        </Button>
      </TopBarActions>

      <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-line bg-surface-1 px-3 py-2">
        <StatusPill dirty={dirty} hasDraft={hasDraft} />
        {hasDraft && draftSavedAt ? (
          <span className="text-[12px] text-fg-muted">
            {fmt(m.draftBadgeHint, {
              time: relativeTime(new Date(draftSavedAt), now),
              name: draftBy ?? system,
            })}
          </span>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {children}
          <a
            href={previewStartHref([scope], '/')}
            target="_blank"
            rel="noreferrer"
            title={m.previewHint}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-line px-2.5 text-[13px] font-semibold hover:bg-surface-2"
          >
            <ExternalLink size={13} aria-hidden="true" />
            {m.previewOnSite}
          </a>
          <button
            type="button"
            onClick={() => setShowHistory(true)}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-line px-2.5 text-[13px] font-semibold hover:bg-surface-2"
          >
            <History size={13} aria-hidden="true" />
            {m.versionHistory}
          </button>
        </div>
      </div>

      <VersionModal
        open={showHistory}
        scope={scope}
        versions={versions}
        busy={busy}
        onClose={() => setShowHistory(false)}
        onRestore={(id) => void publish(id)}
      />
      <Modal
        open={missing !== null}
        title={m.missingAssetsTitle}
        onClose={() => setMissing(null)}
        footer={
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              const pending = missing
              setMissing(null)
              void publish(pending?.id, true)
            }}
          >
            {m.restoreWithout}
          </Button>
        }
      >
        <p className="text-[13px] leading-5 text-fg-muted">
          {fmt(m.missingAssetsBody, { slots: missing?.slots ?? '' })}
        </p>
      </Modal>
    </>
  )
}

/**
 * The one thing on the screen an operator must not misread: is what I am looking at live?
 *
 * Three states, and the **word** carries every one of them — "Unsaved changes", "Draft · not
 * published", "Published". The colour is a second, redundant cue, and it is deliberately in
 * the tint and the dot rather than in the text: `--color-ok`, `--color-warn` and
 * `--color-gold` are the same hex in both themes, and as *text* on the light theme's white
 * surface none of the three reaches 4.5:1. `text-fg` does, in both. The dot is decorative and
 * marked so.
 */
function StatusPill({ dirty, hasDraft }: { dirty: boolean; hasDraft: boolean }) {
  const { tint, dot, label } = dirty
    ? { tint: 'bg-gold/15', dot: 'bg-gold', label: m.unsavedBadge }
    : hasDraft
      ? { tint: 'bg-warn/15', dot: 'bg-warn', label: m.draftBadge }
      : { tint: 'bg-ok/15', dot: 'bg-ok', label: m.liveBadge }
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold text-fg',
        tint,
      )}
    >
      <span className={cn('size-1.5 rounded-full', dot)} aria-hidden="true" />
      {label}
    </span>
  )
}

export function VersionModal({
  open,
  scope,
  versions,
  busy,
  onClose,
  onRestore,
}: {
  open: boolean
  scope: AppearanceScope
  versions: readonly AppearanceVersion[]
  busy: boolean
  onClose: () => void
  onRestore: (id: number) => void
}) {
  const [expanded, setExpanded] = useState<number | null>(null)
  const [diffs, setDiffs] = useState<Record<number, DiffEntry[] | 'loading' | 'first'>>({})
  const now = new Date()

  const toggle = async (id: number) => {
    if (expanded === id) return setExpanded(null)
    setExpanded(id)
    if (diffs[id]) return
    setDiffs((d) => ({ ...d, [id]: 'loading' }))
    const res = await api<{ doc: unknown; base: unknown }>(
      `/api/admin/appearance/version?scope=${scope}&id=${id}`,
    )
    setDiffs((d) => ({
      ...d,
      [id]: !res.ok
        ? []
        : res.data.base === null
          ? 'first'
          : diffDocuments(res.data.base, res.data.doc),
    }))
  }

  return (
    <Modal open={open} title={m.history} onClose={onClose}>
      {versions.length === 0 ? (
        <p className="text-[13px] text-fg-muted">{m.historyEmpty}</p>
      ) : (
        <ul className="flex max-h-[26rem] flex-col gap-1 overflow-y-auto text-[13px]">
          {versions.map((v) => (
            <li key={v.id} className="rounded-md border border-line bg-bg px-3 py-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold tabular-nums">{fmt(m.version, { id: v.id })}</span>
                {/* Tint for the glance, the word for the meaning — see `StatusPill`. */}
                <span
                  className={cn(
                    'rounded-full px-1.5 text-[10px] font-bold uppercase text-fg',
                    v.status === 'published'
                      ? 'bg-ok/15'
                      : v.status === 'draft'
                        ? 'bg-warn/15'
                        : 'bg-surface-3',
                  )}
                >
                  {m.status[v.status as keyof typeof m.status] ?? v.status}
                </span>
                <span className="text-fg-muted">
                  <time dateTime={v.createdAt}>{relativeTime(new Date(v.createdAt), now)}</time> ·{' '}
                  {v.by ?? adminMessages.admin.audit.system}
                </span>
                <button
                  type="button"
                  className="ml-auto text-[12px] font-semibold text-brand-hover hover:underline"
                  aria-expanded={expanded === v.id}
                  onClick={() => void toggle(v.id)}
                >
                  {expanded === v.id ? m.hideChanges : m.whatChanged}
                </button>
                {v.status !== 'published' ? (
                  <button
                    type="button"
                    disabled={busy}
                    className="text-[12px] font-semibold text-brand-hover hover:underline disabled:opacity-50"
                    onClick={() => onRestore(v.id)}
                  >
                    {m.restore}
                  </button>
                ) : null}
              </div>
              {expanded === v.id ? <DiffTable entry={diffs[v.id]} /> : null}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

function DiffTable({ entry }: { entry: DiffEntry[] | 'loading' | 'first' | undefined }) {
  if (entry === undefined || entry === 'loading')
    return <p className="mt-1.5 text-[12px] text-fg-muted">{m.loadingChanges}</p>
  if (entry === 'first') return <p className="mt-1.5 text-[12px] text-fg-muted">{m.firstVersion}</p>
  if (entry.length === 0) return <p className="mt-1.5 text-[12px] text-fg-muted">{m.noChanges}</p>
  return (
    <div className="mt-1.5 overflow-x-auto">
      <table className="w-full text-left text-[12px]">
        <thead className="text-fg-muted">
          <tr>
            <th scope="col" className="py-1 pr-3 font-medium">
              {m.colField}
            </th>
            <th scope="col" className="py-1 pr-3 font-medium">
              {m.colBefore}
            </th>
            <th scope="col" className="py-1 font-medium">
              {m.colAfter}
            </th>
          </tr>
        </thead>
        <tbody>
          {entry.map((d) => (
            <tr key={d.path} className="border-t border-line-soft align-top">
              <td className="py-1 pr-3 font-mono text-[11px]">{d.path}</td>
              <td className="py-1 pr-3 text-fg-muted line-through">{d.before ?? '—'}</td>
              <td className="py-1 font-medium">{d.after ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
