'use client'

import { CHAPTER_LANGUAGES, DEFAULT_CHAPTER_LANGUAGE } from '@palscans/core/languages'
import { fmt, messages } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { Button, useToast } from '@palscans/ui'
import { AlertTriangle, FileJson, Loader2 } from 'lucide-react'
import { useCallback, useId, useMemo, useState } from 'react'
import { inputClass, Panel, PanelHeader, Pill, selectClass } from '../ui'
import { postJson } from './api'
import { Toggle } from './controls'
import { SeriesSearch } from './SeriesEditor'

/**
 * Import every chapter of a series from one manifest link.
 *
 * Two steps, and the first one is the reason this is usable at all: a hundred-chapter file
 * is precisely the case where an operator must see what is about to happen. The preview
 * writes nothing and shows which numbers are new, which already exist, and which entries
 * could not be read — so the decision is made before a hundred rows exist rather than after.
 */

interface PreviewChapter {
  key: string
  number: number
  title: string | null
  volume: number | null
  group: string | null
  provider: string
  pages: number | null
  exists: boolean
}

interface Preview {
  url: string
  title: string | null
  author: string | null
  artist: string | null
  groups: string[]
  chapters: PreviewChapter[]
  skipped: Array<{ key: string; reason: string }>
}

export function ManifestImport({
  seriesId: fixedSeriesId,
  preset,
  url: externalUrl,
  canPublish,
  canRepair,
}: {
  /** Set on a series' own page, where there is nothing to choose. */
  seriesId?: number
  /** Set on the upload screen, where a series may have been preselected but is changeable. */
  preset?: { id: number; title: string } | null
  /**
   * Supplied when the panel above owns the link field.
   *
   * One box that works out what was pasted beats two boxes an operator has to choose
   * between — choosing wrongly is exactly how a manifest ends up in the gallery field.
   */
  url?: string
  canPublish: boolean
  canRepair: boolean
}) {
  const m = adminMessages.admin.manifestImport
  const { toast } = useToast()
  const urlId = useId()
  const [ownUrl, setOwnUrl] = useState('')
  const url = externalUrl ?? ownUrl
  const [picked, setPicked] = useState<{ id: number; title: string } | null>(preset ?? null)
  const seriesId = fixedSeriesId ?? picked?.id ?? null
  const [group, setGroup] = useState('')
  const [language, setLanguage] = useState(DEFAULT_CHAPTER_LANGUAGE)
  const [store, setStore] = useState(false)
  const [publish, setPublish] = useState(false)
  const [replace, setReplace] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [chosen, setChosen] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState<'check' | 'import' | null>(null)

  const counts = useMemo(() => {
    const all = preview?.chapters ?? []
    return { all: all.length, fresh: all.filter((c) => !c.exists).length }
  }, [preview])

  const check = useCallback(async () => {
    if (!seriesId) return
    setBusy('check')
    setPreview(null)
    const result = await postJson<Preview>('/api/admin/chapters/import/manifest/preview', {
      url,
      seriesId,
      language,
      ...(group.trim() === '' ? {} : { group: group.trim() }),
    })
    setBusy(null)
    if (!result.ok) {
      toast({ title: result.message || messages.errors.generic, tone: 'danger' })
      return
    }
    setPreview(result.data)
    // Pre-selected to the new ones: the common intent is "catch me up", and a backfill that
    // silently re-imported everything already here would be the expensive mistake.
    setChosen(new Set(result.data.chapters.filter((c) => !c.exists).map((c) => c.number)))
  }, [url, seriesId, language, group, toast])

  const start = useCallback(async () => {
    if (!preview || chosen.size === 0 || !seriesId) return
    setBusy('import')
    const result = await postJson<{ queued: number; lastStartsInSeconds: number }>(
      '/api/admin/chapters/import/manifest',
      {
        url,
        seriesId,
        language,
        store: store ? 'storage' : 'remote',
        onExisting: replace ? 'replace' : 'skip',
        only: [...chosen],
        ...(group.trim() === '' ? {} : { group: group.trim() }),
        after: { mode: publish ? 'publish' : 'ready' },
      },
    )
    setBusy(null)
    if (!result.ok) {
      toast({ title: result.message || messages.errors.generic, tone: 'danger' })
      return
    }
    toast({
      title:
        result.data.queued === 0
          ? m.queuedNone
          : fmt(m.queued, {
              n: result.data.queued,
              mins: Math.max(1, Math.round(result.data.lastStartsInSeconds / 60)),
            }),
      tone: result.data.queued === 0 ? 'neutral' : 'ok',
    })
    setPreview(null)
    setChosen(new Set())
  }, [preview, chosen, url, seriesId, language, store, replace, group, publish, toast, m])

  const toggleOne = (number: number) =>
    setChosen((prev) => {
      const next = new Set(prev)
      if (next.has(number)) next.delete(number)
      else next.add(number)
      return next
    })

  const Wrap = externalUrl === undefined ? Panel : 'div'
  return (
    <Wrap>
      {externalUrl === undefined ? <PanelHeader title={m.title} hint={m.subtitle} /> : null}
      <div className="flex flex-col gap-3">
        {externalUrl === undefined ? (
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium" htmlFor={urlId}>
              {m.url}
            </label>
            <div className="flex gap-2">
              <input
                className={inputClass}
                id={urlId}
                inputMode="url"
                onChange={(e) => {
                  setOwnUrl(e.target.value)
                  setPreview(null)
                }}
                placeholder={m.urlPlaceholder}
                spellCheck={false}
                value={url}
              />
              <Button
                disabled={url.trim() === '' || busy !== null || !seriesId}
                onClick={() => void check()}
                type="button"
                variant="outline"
              >
                {busy === 'check' ? (
                  <>
                    <Loader2 aria-hidden className="size-4 animate-spin" /> {m.checking}
                  </>
                ) : (
                  <>
                    <FileJson aria-hidden className="size-4" /> {m.check}
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : null}

        {externalUrl !== undefined ? (
          <div className="flex items-center gap-2">
            <Button
              disabled={url.trim() === '' || busy !== null || !seriesId}
              onClick={() => void check()}
              type="button"
              variant="outline"
            >
              {busy === 'check' ? (
                <>
                  <Loader2 aria-hidden className="size-4 animate-spin" /> {m.checking}
                </>
              ) : (
                <>
                  <FileJson aria-hidden className="size-4" /> {m.check}
                </>
              )}
            </Button>
            <span className="text-[12.5px] text-fg-muted">
              {seriesId ? m.subtitle : m.pickSeriesFirst}
            </span>
          </div>
        ) : null}

        {preview ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone="brand">{fmt(m.found, { n: counts.all })}</Pill>
              <Pill tone="ok">{fmt(m.newOnes, { n: counts.fresh })}</Pill>
              {counts.all - counts.fresh > 0 ? (
                <Pill tone="neutral">{fmt(m.existing, { n: counts.all - counts.fresh })}</Pill>
              ) : null}
              {preview.skipped.length > 0 ? (
                <Pill tone="warn">
                  <AlertTriangle aria-hidden className="size-3" />{' '}
                  {fmt(m.unreadable, { n: preview.skipped.length })}
                </Pill>
              ) : null}
              {preview.title ? (
                <span className="text-[13px] text-fg-muted">{preview.title}</span>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
              <button
                className="rounded border border-line px-2 py-1 hover:bg-surface-2"
                onClick={() => setChosen(new Set(preview.chapters.map((c) => c.number)))}
                type="button"
              >
                {m.selectAll}
              </button>
              <button
                className="rounded border border-line px-2 py-1 hover:bg-surface-2"
                onClick={() =>
                  setChosen(new Set(preview.chapters.filter((c) => !c.exists).map((c) => c.number)))
                }
                type="button"
              >
                {m.selectNew}
              </button>
              <button
                className="rounded border border-line px-2 py-1 hover:bg-surface-2"
                onClick={() => setChosen(new Set())}
                type="button"
              >
                {m.selectNone}
              </button>
            </div>

            {/* Scrolls rather than paginates: this is a list to scan, not to navigate. */}
            <div className="max-h-72 overflow-y-auto rounded-md border border-line">
              <table className="w-full text-[13px]">
                <tbody>
                  {preview.chapters.map((c) => (
                    <tr className="border-line border-b last:border-0" key={c.key}>
                      <td className="w-9 px-2 py-1.5">
                        <input
                          aria-label={String(c.number)}
                          checked={chosen.has(c.number)}
                          onChange={() => toggleOne(c.number)}
                          type="checkbox"
                        />
                      </td>
                      <td className="px-2 py-1.5 font-semibold tabular-nums">{c.number}</td>
                      <td className="px-2 py-1.5 text-fg-muted">{c.title ?? ''}</td>
                      <td className="px-2 py-1.5 text-right text-[12px] text-fg-muted">
                        {c.provider}
                      </td>
                      <td className="w-24 px-2 py-1.5 text-right">
                        {c.exists ? (
                          <Pill tone="neutral">{m.existing.replace('{n} ', '')}</Pill>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {preview.skipped.length > 0 ? (
              <details className="text-[12.5px] text-fg-muted">
                <summary className="cursor-pointer">{m.skippedTitle}</summary>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {preview.skipped.slice(0, 20).map((s) => (
                    <li key={s.key}>
                      {s.key}: {s.reason}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          {fixedSeriesId === undefined ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">{adminMessages.admin.upload.series}</span>
              {picked ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1.5">
                  <span className="truncate text-[13px]">{picked.title}</span>
                  <button
                    className="text-[12.5px] text-fg-muted hover:text-fg"
                    onClick={() => setPicked(null)}
                    type="button"
                  >
                    {adminMessages.admin.galleryImport.change}
                  </button>
                </div>
              ) : (
                <SeriesSearch
                  onPick={(s) => setPicked({ id: s.id, title: s.title })}
                  placeholder={adminMessages.admin.upload.pickSeries}
                />
              )}
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">{adminMessages.admin.upload.language}</span>
            <select
              className={selectClass}
              onChange={(e) => setLanguage(e.target.value)}
              value={language}
            >
              {CHAPTER_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">{m.group}</span>
            <select
              className={selectClass}
              onChange={(e) => setGroup(e.target.value)}
              value={group}
            >
              <option value="">{m.anyGroup}</option>
              {(preview?.groups ?? []).map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
          <span className="inline-flex items-center gap-2.5">
            {adminMessages.admin.galleryImport.store}
            <Toggle
              ariaLabel={adminMessages.admin.galleryImport.store}
              checked={store}
              onChange={setStore}
              size="sm"
            />
          </span>
          {canPublish ? (
            <span className="inline-flex items-center gap-2.5">
              {adminMessages.admin.upload.afterPublish}
              <Toggle
                ariaLabel={adminMessages.admin.upload.afterPublish}
                checked={publish}
                onChange={setPublish}
                size="sm"
              />
            </span>
          ) : null}
          {canRepair ? (
            <span className="inline-flex items-center gap-2.5">
              {m.replaceExisting}
              <Toggle
                ariaLabel={m.replaceExisting}
                checked={replace}
                onChange={setReplace}
                size="sm"
              />
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={!preview || chosen.size === 0 || busy !== null || !seriesId}
            onClick={() => void start()}
            type="button"
          >
            {busy === 'import' ? (
              <>
                <Loader2 aria-hidden className="size-4 animate-spin" /> {m.importing}
              </>
            ) : (
              fmt(m.start, { n: chosen.size })
            )}
          </Button>
          <p className="text-[12.5px] text-fg-muted">{seriesId ? m.pacing : m.pickSeriesFirst}</p>
        </div>
      </div>
    </Wrap>
  )
}
