/** biome-ignore-all lint/suspicious/noArrayIndexKey: preview paragraphs and repeater rows are positional */
'use client'

import { fmt, messages } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { Button, cn, useToast } from '@palscans/ui'
import { Check, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SeriesDoc } from '../schemas'
import { Field, Hint, inputClass, Panel, PanelHeader, selectClass, textareaClass } from '../ui'
import { api, del, patchJson, postJson, putJson } from './api'
import { type ChapterRowData, ChaptersTable } from './ChaptersTable'
import { SaveBar, Toggle, useDraft } from './controls'
import { sha256Hex, uploadWithRetry } from './upload-lib'
import { slugify } from './util'

export type EditorTab =
  | 'details'
  | 'titles'
  | 'art'
  | 'people'
  | 'genres'
  | 'relations'
  | 'visibility'
  | 'seo'
  | 'chapters'

export interface EditorPerms {
  update: boolean
  delete: boolean
  publish: boolean
  chapterUpdate: boolean
  chapterDelete: boolean
  repair: boolean
  create: boolean
}

interface Props {
  id: number
  initialTab: EditorTab
  doc: SeriesDoc
  genres: Array<{ id: number; name: string; kind: string }>
  linked: { id: number; title: string; slug: string } | null
  chapters: ChapterRowData[]
  coverUrl: string
  bannerUrl: string | null
  perms: EditorPerms
  deleted: boolean
}

const TABS: EditorTab[] = [
  'details',
  'titles',
  'art',
  'people',
  'genres',
  'relations',
  'visibility',
  'seo',
  'chapters',
]

export function SeriesEditor(props: Props) {
  const m = adminMessages.admin.series
  const f = m.fields
  const { toast } = useToast()
  const [tab, setTab] = useState<EditorTab>(props.initialTab)
  const [saved, setSaved] = useState<SeriesDoc>(props.doc)
  const [doc, setDoc] = useState<SeriesDoc>(props.doc)
  const [saving, setSaving] = useState(false)
  const [slugTouched, setSlugTouched] = useState(props.doc.slug !== slugify(props.doc.title))
  const [linked, setLinked] = useState(props.linked)
  const [deleted, setDeleted] = useState(props.deleted)
  const dirty = useMemo(() => JSON.stringify(doc) !== JSON.stringify(saved), [doc, saved])
  useDraft(`admin.series.${props.id}`, doc, dirty)

  const patch = useCallback((p: Partial<SeriesDoc>) => setDoc((d) => ({ ...d, ...p })), [])

  const selectTab = (t: EditorTab) => {
    setTab(t)
    const u = new URL(window.location.href)
    u.searchParams.set('tab', t)
    window.history.replaceState(null, '', u.toString())
  }

  const save = async () => {
    setSaving(true)
    const res = await putJson<{ id: number; slug: string }>(`/api/admin/series/${props.id}`, doc)
    setSaving(false)
    if (!res.ok) {
      toast({ title: adminMessages.admin.errorSaving, description: res.message, tone: 'danger' })
      return
    }
    setSaved(doc)
    toast({ title: m.saved, tone: 'ok' })
  }

  const remove = async () => {
    const res = await del(`/api/admin/series/${props.id}`)
    if (!res.ok) return toast({ title: adminMessages.admin.errorSaving, tone: 'danger' })
    setDeleted(true)
    toast({
      title: m.deleted,
      tone: 'danger',
      action: {
        label: messages.common.undo,
        onClick: () => {
          void del(`/api/admin/series/${props.id}?restore=1`).then((r) => {
            if (r.ok) setDeleted(false)
          })
        },
      },
    })
  }

  const tabLabel = (t: EditorTab) => m.tabs[t]

  return (
    <div className="flex flex-col gap-3.5">
      {props.perms.update ? (
        <SaveBar dirty={dirty} saving={saving} onSave={save} onDiscard={() => setDoc(saved)} />
      ) : null}
      <div className="flex flex-wrap items-center gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => selectTab(t)}
            aria-current={tab === t ? 'page' : undefined}
            className={cn(
              '-mb-px h-10 border-b-2 px-3 text-[13px] font-semibold transition-colors',
              tab === t ? 'border-brand text-fg' : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            {tabLabel(t)}
            {t === 'chapters' ? (
              <span className="ml-1.5 text-fg-subtle tabular-nums">
                {props.chapters.filter((c) => !c.deletedAt).length}
              </span>
            ) : null}
          </button>
        ))}
        {deleted ? (
          <span className="ml-auto flex items-center gap-2 text-[12px] text-danger">
            {m.deleted}
            <button
              type="button"
              className="underline"
              onClick={() =>
                void del(`/api/admin/series/${props.id}?restore=1`).then(() => setDeleted(false))
              }
            >
              {m.restore}
            </button>
          </span>
        ) : null}
      </div>

      {tab === 'details' ? (
        <Panel>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={f.title} htmlFor="s-title">
              <input
                id="s-title"
                className={inputClass}
                value={doc.title}
                onChange={(e) => {
                  const title = e.target.value
                  patch(slugTouched ? { title } : { title, slug: slugify(title) })
                }}
              />
            </Field>
            <Field label={f.slug} htmlFor="s-slug" hint={f.slugAuto}>
              <input
                id="s-slug"
                className={inputClass}
                value={doc.slug}
                onChange={(e) => {
                  setSlugTouched(true)
                  patch({ slug: slugify(e.target.value) })
                }}
              />
            </Field>
            <Field label={f.type} htmlFor="s-type">
              <select
                id="s-type"
                className={selectClass}
                value={doc.type}
                onChange={(e) => patch({ type: e.target.value as SeriesDoc['type'] })}
              >
                {['manhwa', 'manhua', 'manga', 'comic', 'novel'].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={f.status} htmlFor="s-status">
              <select
                id="s-status"
                className={selectClass}
                value={doc.status}
                onChange={(e) => patch({ status: e.target.value as SeriesDoc['status'] })}
              >
                {['ongoing', 'completed', 'hiatus', 'cancelled', 'dropped'].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={f.synopsis} htmlFor="s-syn" className="md:col-span-2">
              <div className="grid gap-3 md:grid-cols-2">
                <textarea
                  id="s-syn"
                  rows={8}
                  className={textareaClass}
                  value={doc.synopsis ?? ''}
                  onChange={(e) => patch({ synopsis: e.target.value || null })}
                />
                <div className="rounded-md border border-line-soft bg-bg p-3 text-[13px] leading-5 text-fg-muted">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-subtle">
                    {f.synopsisPreview}
                  </div>
                  {(doc.synopsis ?? '')
                    .split(/\n+/)
                    .filter(Boolean)
                    .map((p, i) => (
                      <p key={`${i}-${p.slice(0, 8)}`} className="mb-2 last:mb-0">
                        {p}
                      </p>
                    ))}
                </div>
              </div>
            </Field>
            <Field label={f.releasedYear} htmlFor="s-year">
              <input
                id="s-year"
                type="number"
                className={inputClass}
                value={doc.releasedYear ?? ''}
                onChange={(e) =>
                  patch({ releasedYear: e.target.value ? Number(e.target.value) : null })
                }
              />
            </Field>
            <Field label={f.serialization} htmlFor="s-ser">
              <input
                id="s-ser"
                className={inputClass}
                value={doc.serialization ?? ''}
                onChange={(e) => patch({ serialization: e.target.value || null })}
              />
            </Field>
            <Field label={f.ageRating} htmlFor="s-age">
              <select
                id="s-age"
                className={selectClass}
                value={doc.ageRating ?? ''}
                onChange={(e) =>
                  patch({ ageRating: (e.target.value || null) as SeriesDoc['ageRating'] })
                }
              >
                <option value="">—</option>
                <option value="all">all</option>
                <option value="teen">teen</option>
                <option value="mature">mature</option>
              </select>
            </Field>
            <Field label={f.readingDirection} htmlFor="s-dir">
              <select
                id="s-dir"
                className={selectClass}
                value={doc.readingDirection}
                onChange={(e) =>
                  patch({ readingDirection: e.target.value as SeriesDoc['readingDirection'] })
                }
              >
                <option value="vertical">vertical</option>
                <option value="ltr">ltr</option>
                <option value="rtl">rtl</option>
              </select>
            </Field>
            <Field label={f.releaseSchedule} htmlFor="s-wd">
              <div className="flex gap-2">
                <select
                  id="s-wd"
                  className={selectClass}
                  value={doc.releaseSchedule?.weekday ?? ''}
                  onChange={(e) =>
                    patch({
                      releaseSchedule:
                        e.target.value === ''
                          ? null
                          : { ...(doc.releaseSchedule ?? {}), weekday: Number(e.target.value) },
                    })
                  }
                >
                  <option value="">—</option>
                  {[
                    'Sunday',
                    'Monday',
                    'Tuesday',
                    'Wednesday',
                    'Thursday',
                    'Friday',
                    'Saturday',
                  ].map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
                <input
                  className={inputClass}
                  placeholder={f.releaseScheduleNote}
                  value={doc.releaseSchedule?.note ?? ''}
                  disabled={!doc.releaseSchedule}
                  onChange={(e) =>
                    doc.releaseSchedule &&
                    patch({ releaseSchedule: { ...doc.releaseSchedule, note: e.target.value } })
                  }
                />
              </div>
            </Field>
            <Field label={f.contentWarnings} htmlFor="s-cw">
              <input
                id="s-cw"
                className={inputClass}
                value={doc.contentWarnings.join(', ')}
                onChange={(e) =>
                  patch({
                    contentWarnings: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </Field>
          </div>
        </Panel>
      ) : null}

      {tab === 'titles' ? (
        <Panel>
          <PanelHeader title={f.altTitles} hint={f.altTitlesHint} />
          <div className="flex flex-col gap-2">
            {doc.titles.map((t, i) => (
              <div key={`${i}-${t.title}`} className="flex gap-2">
                <input
                  className={inputClass}
                  value={t.title}
                  aria-label={f.title}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData('text')
                    if (!text.includes('\n')) return
                    e.preventDefault()
                    const lines = text
                      .split(/\r?\n/)
                      .map((s) => s.trim())
                      .filter(Boolean)
                    const next = [...doc.titles]
                    next.splice(i, 1, ...lines.map((title) => ({ title, lang: null })))
                    patch({ titles: next })
                  }}
                  onChange={(e) =>
                    patch({
                      titles: doc.titles.map((x, j) =>
                        j === i ? { ...x, title: e.target.value } : x,
                      ),
                    })
                  }
                />
                <input
                  className={`${inputClass} w-24`}
                  placeholder={f.lang}
                  aria-label={f.lang}
                  value={t.lang ?? ''}
                  onChange={(e) =>
                    patch({
                      titles: doc.titles.map((x, j) =>
                        j === i ? { ...x, lang: e.target.value || null } : x,
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  aria-label={adminMessages.admin.remove}
                  className="inline-flex size-9 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-danger"
                  onClick={() => patch({ titles: doc.titles.filter((_, j) => j !== i) })}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => patch({ titles: [...doc.titles, { title: '', lang: null }] })}
              >
                {adminMessages.admin.add}
              </Button>
            </div>
          </div>
        </Panel>
      ) : null}

      {tab === 'art' ? (
        <div className="grid gap-3.5 md:grid-cols-2">
          <ArtDrop
            id={props.id}
            kind="cover"
            label={f.cover}
            hint={f.coverHint}
            initialUrl={props.coverUrl}
            width={200}
            height={300}
          />
          <ArtDrop
            id={props.id}
            kind="banner"
            label={f.banner}
            hint={f.bannerHint}
            initialUrl={props.bannerUrl}
            width={480}
            height={150}
          />
        </div>
      ) : null}

      {tab === 'people' ? (
        <div className="grid gap-3.5 md:grid-cols-3">
          {(['author', 'artist', 'translator'] as const).map((credit) => (
            <PeoplePicker
              key={credit}
              credit={credit}
              people={doc.people}
              onChange={(people) => patch({ people })}
            />
          ))}
        </div>
      ) : null}

      {tab === 'genres' ? (
        <Panel>
          <PanelHeader title={m.tabs.genres} hint={f.genresHint} />
          {Array.from(new Set(props.genres.map((g) => g.kind))).map((kind) => (
            <div key={kind} className="mb-4">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-subtle">
                {kind}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {props.genres
                  .filter((g) => g.kind === kind)
                  .map((g) => {
                    const on = doc.genreIds.includes(g.id)
                    return (
                      <button
                        key={g.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          patch({
                            genreIds: on
                              ? doc.genreIds.filter((x) => x !== g.id)
                              : [...doc.genreIds, g.id],
                          })
                        }
                        className={cn(
                          'h-7 rounded-full border px-3 text-[12px] font-semibold transition-colors',
                          on
                            ? 'border-brand bg-brand-wash text-brand-hover'
                            : 'border-line text-fg-muted hover:text-fg',
                        )}
                      >
                        {g.name}
                      </button>
                    )
                  })}
              </div>
            </div>
          ))}
        </Panel>
      ) : null}

      {tab === 'relations' ? (
        <Panel className="max-w-xl">
          <PanelHeader title={f.linkedSeries} hint={f.linkedSeriesHint} />
          {linked ? (
            <div className="flex items-center gap-3 rounded-md border border-line bg-bg p-3">
              <span className="font-semibold">{linked.title}</span>
              <span className="text-[12px] text-fg-subtle">/{linked.slug}</span>
              <button
                type="button"
                className="ml-auto text-[12px] font-semibold text-danger"
                onClick={() => {
                  setLinked(null)
                  patch({ linkedSeriesId: null })
                }}
              >
                {f.unlink}
              </button>
            </div>
          ) : (
            <SeriesSearch
              exclude={props.id}
              onPick={(s) => {
                setLinked(s)
                patch({ linkedSeriesId: s.id })
              }}
            />
          )}
        </Panel>
      ) : null}

      {tab === 'visibility' ? (
        <Panel>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={f.state} htmlFor="s-state">
              <select
                id="s-state"
                className={selectClass}
                value={doc.state}
                onChange={(e) => patch({ state: e.target.value as SeriesDoc['state'] })}
              >
                {['draft', 'scheduled', 'published', 'unlisted', 'removed'].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex flex-col gap-3 pt-5">
              <div className="flex items-center justify-between gap-3 text-[13px]">
                {f.featured}
                <Toggle
                  ariaLabel={f.featured}
                  size="sm"
                  checked={doc.isFeatured}
                  onChange={(v) => patch({ isFeatured: v })}
                />
              </div>
              <div className="flex items-center justify-between gap-3 text-[13px]">
                {f.pinned}
                <Toggle
                  ariaLabel={f.pinned}
                  size="sm"
                  checked={doc.isPinned}
                  onChange={(v) => patch({ isPinned: v })}
                />
              </div>
              <div className="flex items-center justify-between gap-3 text-[13px]">
                {f.commentsEnabled}
                <Toggle
                  ariaLabel={f.commentsEnabled}
                  size="sm"
                  checked={doc.commentsEnabled}
                  onChange={(v) => patch({ commentsEnabled: v })}
                />
              </div>
            </div>
            <Field label={f.geo} hint={f.geoHint} className="md:col-span-2">
              <div className="flex gap-2">
                <select
                  className={`${selectClass} w-36`}
                  aria-label={f.geo}
                  value={doc.geo.mode}
                  onChange={(e) =>
                    patch({ geo: { ...doc.geo, mode: e.target.value as 'allow' | 'block' } })
                  }
                >
                  <option value="block">{f.geoBlock}</option>
                  <option value="allow">{f.geoAllow}</option>
                </select>
                <input
                  className={inputClass}
                  placeholder={f.geoPlaceholder}
                  value={doc.geo.countries.join(', ')}
                  onChange={(e) =>
                    patch({
                      geo: {
                        ...doc.geo,
                        countries: e.target.value
                          .toUpperCase()
                          .split(',')
                          .map((s) => s.trim())
                          .filter((s) => /^[A-Z]{2}$/.test(s)),
                      },
                    })
                  }
                />
              </div>
            </Field>
          </div>
          {props.perms.delete && !deleted ? (
            <div className="mt-6 border-t border-line pt-4">
              <Button variant="outline" size="sm" className="text-danger" onClick={remove}>
                <Trash2 size={14} aria-hidden="true" />
                {messages.common.delete}
              </Button>
              <Hint className="mt-1">{adminMessages.admin.undoWindow}</Hint>
            </div>
          ) : null}
        </Panel>
      ) : null}

      {tab === 'seo' ? (
        <div className="grid gap-3.5 md:grid-cols-[1fr_280px]">
          <Panel>
            <div className="grid gap-4">
              <Field label={f.seoTitle} htmlFor="s-seot">
                <input
                  id="s-seot"
                  className={inputClass}
                  value={doc.seoTitle ?? ''}
                  onChange={(e) => patch({ seoTitle: e.target.value || null })}
                />
              </Field>
              <Field
                label={f.seoDescription}
                htmlFor="s-seod"
                hint={`${(doc.seoDescription ?? '').length} / 160`}
              >
                <textarea
                  id="s-seod"
                  rows={3}
                  className={textareaClass}
                  value={doc.seoDescription ?? ''}
                  onChange={(e) => patch({ seoDescription: e.target.value || null })}
                />
              </Field>
              <Field label={f.focusKeyword} htmlFor="s-kw">
                <input
                  id="s-kw"
                  className={inputClass}
                  value={doc.focusKeyword ?? ''}
                  onChange={(e) => patch({ focusKeyword: e.target.value || null })}
                />
              </Field>
              <Field label={f.seoText} htmlFor="s-about">
                <textarea
                  id="s-about"
                  rows={6}
                  className={textareaClass}
                  value={doc.seoText ?? ''}
                  onChange={(e) => patch({ seoText: e.target.value || null })}
                />
              </Field>
              <div className="flex items-center justify-between gap-3 text-[13px]">
                {f.noindex}
                <Toggle
                  ariaLabel={f.noindex}
                  size="sm"
                  checked={doc.noindex}
                  onChange={(v) => patch({ noindex: v })}
                />
              </div>
              <Field label={f.canonicalUrl} htmlFor="s-canon">
                <input
                  id="s-canon"
                  className={inputClass}
                  value={doc.canonicalUrl ?? ''}
                  onChange={(e) => patch({ canonicalUrl: e.target.value || null })}
                />
              </Field>
              <Field label={f.ogImageKey} htmlFor="s-og">
                <input
                  id="s-og"
                  className={inputClass}
                  value={doc.ogImageKey ?? ''}
                  onChange={(e) => patch({ ogImageKey: e.target.value || null })}
                />
              </Field>
            </div>
          </Panel>
          <Panel>
            <PanelHeader title={f.checklist} />
            <ul className="flex flex-col gap-2 text-[13px]">
              {[
                [
                  f.checkKeywordInTitle,
                  !!doc.focusKeyword &&
                    (doc.seoTitle ?? doc.title)
                      .toLowerCase()
                      .includes(doc.focusKeyword.toLowerCase()),
                ],
                [
                  f.checkKeywordInDescription,
                  !!doc.focusKeyword &&
                    (doc.seoDescription ?? '')
                      .toLowerCase()
                      .includes(doc.focusKeyword.toLowerCase()),
                ],
                [
                  f.checkDescriptionLength,
                  (doc.seoDescription ?? '').length >= 70 &&
                    (doc.seoDescription ?? '').length <= 160,
                ],
                [f.checkAbout, !!doc.seoText],
              ].map(([label, ok]) => (
                <li
                  key={String(label)}
                  className={cn('flex items-center gap-2', ok ? 'text-ok' : 'text-fg-muted')}
                >
                  <Check size={14} className={ok ? '' : 'opacity-30'} aria-hidden="true" />
                  {String(label)}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      ) : null}

      {tab === 'chapters' ? (
        <ChaptersTable seriesId={props.id} initial={props.chapters} perms={props.perms} />
      ) : null}
    </div>
  )
}

function ArtDrop({
  id,
  kind,
  label,
  hint,
  initialUrl,
  width,
  height,
}: {
  id: number
  kind: 'cover' | 'banner'
  label: string
  hint: string
  initialUrl: string | null
  width: number
  height: number
}) {
  const f = adminMessages.admin.series.fields
  const { toast } = useToast()
  const [url, setUrl] = useState(initialUrl)
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const inputId = `art-${kind}`
  const handle = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      const sha256 = await sha256Hex(file)
      const intent = await postJson<{
        key: string
        url: string
        method: 'PUT'
        headers: Record<string, string>
      }>(`/api/admin/series/${id}/art`, {
        kind,
        name: file.name,
        bytes: file.size,
        sha256,
        type: file.type,
      })
      if (!intent.ok) throw new Error(intent.message || intent.error)
      await uploadWithRetry(intent.data.url, intent.data.headers, file)
      const confirm = await patchJson<{ key: string; url: string | null; pending: boolean }>(
        `/api/admin/series/${id}/art`,
        { kind, key: intent.data.key },
      )
      if (!confirm.ok) throw new Error(confirm.message || confirm.error)
      // The worker re-encodes the original before it becomes the public cover / banner;
      // the current image stays until then.
      if (confirm.data.url) setUrl(confirm.data.url)
      toast({
        title: adminMessages.admin.saved,
        description: confirm.data.pending ? f.processing : undefined,
        tone: 'ok',
      })
    } catch (err) {
      toast({
        title: adminMessages.admin.errorSaving,
        description: err instanceof Error ? err.message : '',
        tone: 'danger',
      })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Panel>
      <PanelHeader title={label} hint={hint} />
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          void handle(e.dataTransfer.files[0])
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-[13px] text-fg-muted transition-colors',
          drag ? 'border-brand bg-brand-wash' : 'border-line hover:border-fg-subtle',
        )}
      >
        {url ? (
          <img
            src={url}
            width={width}
            height={height}
            alt=""
            className="rounded-md object-cover"
            style={{ width, height }}
          />
        ) : (
          <div className="rounded-md bg-surface-3" style={{ width, height }} />
        )}
        <span>{busy ? f.uploading : url ? f.replace : f.dropImage}</span>
        <input
          id={inputId}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          className="sr-only"
          onChange={(e) => void handle(e.target.files?.[0])}
        />
      </label>
    </Panel>
  )
}

function PeoplePicker({
  credit,
  people,
  onChange,
}: {
  credit: 'author' | 'artist' | 'translator'
  people: SeriesDoc['people']
  onChange: (p: SeriesDoc['people']) => void
}) {
  const f = adminMessages.admin.series.fields
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Array<{ id: number; name: string }>>([])
  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([])
      return
    }
    const t = setTimeout(() => {
      void api<Array<{ id: number; name: string }>>(
        `/api/admin/people?q=${encodeURIComponent(q.trim())}`,
      ).then((r) => {
        if (r.ok) setHits(r.data)
      })
    }, 200)
    return () => clearTimeout(t)
  }, [q])
  const mine = people.filter((p) => p.credit === credit)
  const add = (p: { id: number | null; name: string }) => {
    if (mine.some((x) => x.name.toLowerCase() === p.name.toLowerCase())) return
    onChange([...people, { credit, id: p.id, name: p.name }])
    setQ('')
    setHits([])
  }
  const label = f[credit]
  return (
    <Panel>
      <PanelHeader title={label} />
      <div className="flex flex-col gap-2">
        {mine.map((p) => (
          <div
            key={`${p.credit}-${p.name}`}
            className="flex items-center gap-2 rounded-md border border-line bg-bg px-3 py-1.5 text-[13px]"
          >
            <span className="font-semibold">{p.name}</span>
            {p.id === null ? <span className="text-[11px] text-gold">new</span> : null}
            <button
              type="button"
              aria-label={adminMessages.admin.remove}
              className="ml-auto text-fg-muted hover:text-danger"
              onClick={() => onChange(people.filter((x) => x !== p))}
            >
              <X size={14} />
            </button>
          </div>
        ))}
        <div className="relative">
          <input
            className={inputClass}
            placeholder={fmt(f.addPerson, { credit: label.toLowerCase() })}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && q.trim()) {
                e.preventDefault()
                add(hits[0] ?? { id: null, name: q.trim() })
              }
            }}
          />
          {q.trim().length >= 2 ? (
            <div className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-md border border-line bg-surface-2 shadow-2">
              {hits.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  className="block w-full px-3 py-2 text-left text-[13px] hover:bg-surface-3"
                  onClick={() => add(h)}
                >
                  {h.name}
                </button>
              ))}
              {!hits.some((h) => h.name.toLowerCase() === q.trim().toLowerCase()) ? (
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-[13px] text-brand-hover hover:bg-surface-3"
                  onClick={() => add({ id: null, name: q.trim() })}
                >
                  {fmt(f.createPerson, { name: q.trim() })}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </Panel>
  )
}

export function SeriesSearch({
  exclude,
  onPick,
  placeholder,
}: {
  exclude?: number
  onPick: (s: {
    id: number
    title: string
    slug: string
    type: string
    chapterCount: number
  }) => void
  placeholder?: string
}) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<
    Array<{ id: number; title: string; slug: string; type: string; chapterCount: number }>
  >([])
  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([])
      return
    }
    const t = setTimeout(() => {
      void api<typeof hits>(`/api/admin/series/search?q=${encodeURIComponent(q.trim())}`).then(
        (r) => {
          if (r.ok) setHits(r.data.filter((s) => s.id !== exclude))
        },
      )
    }, 200)
    return () => clearTimeout(t)
  }, [q, exclude])
  return (
    <div className="relative">
      <input
        className={inputClass}
        placeholder={placeholder ?? adminMessages.admin.search}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {hits.length ? (
        <div className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-md border border-line bg-surface-2 shadow-2">
          {hits.map((h) => (
            <button
              key={h.id}
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-surface-3"
              onClick={() => {
                onPick(h)
                setQ('')
                setHits([])
              }}
            >
              <span className="font-semibold">{h.title}</span>
              <span className="text-[11px] text-fg-subtle">/{h.slug}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
