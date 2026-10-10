'use client'

import { CHAPTER_LANGUAGES, DEFAULT_CHAPTER_LANGUAGE } from '@palscans/core/languages'
import { fmt, messages } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { Button, useToast } from '@palscans/ui'
import { AlertTriangle, Link2, Loader2 } from 'lucide-react'
import { useCallback, useId, useState } from 'react'
import { inputClass, Panel, PanelHeader, Pill, selectClass } from '../ui'
import { api, postJson } from './api'
import { Toggle } from './controls'
import { SeriesSearch } from './SeriesEditor'

/**
 * Import a chapter from an ImgChest gallery link.
 *
 * Two steps on purpose. Check first — which costs one cheap request and writes nothing —
 * then Import. The preview is not decoration: a pasted link is the one input here, and the
 * difference between chapter 12 and somebody's holiday album is a page count and three
 * thumbnails. Committing straight from the box would mean finding out by looking at the
 * published chapter.
 */

interface Preview {
  provider: string
  id: string
  title: string | null
  nsfw: boolean
  count: number
  images: string[]
}

interface Picked {
  id: number
  title: string
}

/**
 * An existing chapter to rebuild, for the page editor.
 *
 * In that mode the series, number and language are already decided by the chapter itself, so
 * the pickers are hidden rather than shown pre-filled and ignored — a disabled field an
 * operator can see but not change is a question they will try to answer.
 */
export interface GalleryTarget {
  chapterId: number
  /** What is about to be replaced, e.g. "Solo Leveling · 12". */
  label: string
  /** Whether this chapter already has pages, which is what makes the warning honest. */
  hasPages: boolean
}

export function GalleryImport({
  preset,
  target,
  canPublish,
  canRepair,
}: {
  preset?: { id: number; title: string } | null
  target?: GalleryTarget
  canPublish: boolean
  canRepair: boolean
}) {
  const m = adminMessages.admin.galleryImport
  const { toast } = useToast()
  const urlId = useId()
  const [url, setUrl] = useState('')
  const [series, setSeries] = useState<Picked | null>(preset ?? null)
  const [number, setNumber] = useState('')
  const [title, setTitle] = useState('')
  const [language, setLanguage] = useState(DEFAULT_CHAPTER_LANGUAGE)
  const [publish, setPublish] = useState(false)
  const [premium, setPremium] = useState(false)
  const [replace, setReplace] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState<'check' | 'import' | null>(null)

  const check = useCallback(async () => {
    setBusy('check')
    setPreview(null)
    const result = await api<Preview>('/api/admin/chapters/import/preview', {
      method: 'POST',
      body: JSON.stringify({ url }),
    })
    setBusy(null)
    if (!result.ok) {
      toast({ title: result.message || messages.errors.generic, tone: 'danger' })
      return
    }
    setPreview(result.data)
  }, [url, toast])

  const start = useCallback(async () => {
    if (!preview) return
    let body: Record<string, unknown>
    if (target) {
      body = { url, chapterId: target.chapterId }
    } else {
      if (!series) return
      const parsed = Number(number)
      if (!Number.isFinite(parsed)) {
        toast({ title: adminMessages.admin.upload.chapterNumber, tone: 'danger' })
        return
      }
      body = {
        url,
        seriesId: series.id,
        number: parsed,
        title: title.trim() === '' ? null : title.trim(),
        language,
        ...(replace ? { replace: true } : {}),
        after: { mode: publish ? 'publish' : 'ready', isPremium: premium },
      }
    }
    setBusy('import')
    const result = await postJson<{ chapterId: number; pages: number }>(
      '/api/admin/chapters/import',
      body,
    )
    setBusy(null)
    if (!result.ok) {
      toast({ title: result.message || messages.errors.generic, tone: 'danger' })
      return
    }
    toast({ title: fmt(m.queued, { n: result.data.pages }), tone: 'ok' })
    setUrl('')
    setPreview(null)
    if (target) return
    // Deliberately kept for the create path: the next chapter in a series is almost always
    // the next number, and retyping the series and language for each one is the tedium this
    // panel exists to remove.
    setTitle('')
    setNumber((n) => {
      const next = Number(n) + 1
      return Number.isFinite(next) ? String(next) : n
    })
  }, [
    series,
    preview,
    number,
    url,
    title,
    language,
    replace,
    publish,
    premium,
    target,
    toast,
    m.queued,
  ])

  return (
    <Panel>
      <PanelHeader
        title={target ? m.refillTitle : m.title}
        hint={target ? fmt(m.refillSubtitle, { chapter: target.label }) : m.subtitle}
      />
      <div className="flex flex-col gap-3">
        {target?.hasPages ? (
          <p className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn/10 p-2.5 text-[12.5px] leading-[18px] text-fg">
            <AlertTriangle aria-hidden className="mt-px size-4 shrink-0 text-warn" />
            {m.refillWarning}
          </p>
        ) : null}
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
                setUrl(e.target.value)
                setPreview(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && url.trim() !== '' && busy === null) void check()
              }}
              placeholder={m.urlPlaceholder}
              spellCheck={false}
              value={url}
            />
            <Button
              disabled={url.trim() === '' || busy !== null}
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
                  <Link2 aria-hidden className="size-4" /> {m.check}
                </>
              )}
            </Button>
          </div>
        </div>

        {preview ? (
          <div className="flex flex-col gap-2.5 rounded-md border border-line bg-surface-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone="ok">{fmt(m.found, { n: preview.count })}</Pill>
              <span className="text-[13px] text-fg-muted">{preview.title ?? m.untitled}</span>
              {preview.nsfw ? (
                <Pill tone="warn">
                  <AlertTriangle aria-hidden className="size-3" /> {m.nsfw}
                </Pill>
              ) : null}
              {preview.title && title.trim() === '' ? (
                <button
                  className="text-[12.5px] text-accent underline-offset-2 hover:underline"
                  onClick={() => setTitle(preview.title ?? '')}
                  type="button"
                >
                  {m.useTitle}
                </button>
              ) : null}
            </div>
            {/* First few pages only: enough to tell a chapter from the wrong gallery. */}
            <div className="flex gap-2 overflow-x-auto">
              {preview.images.slice(0, 6).map((src) => (
                <img
                  alt=""
                  className="h-24 w-auto shrink-0 rounded border border-line bg-surface-1 object-cover"
                  key={src}
                  loading="lazy"
                  src={src}
                />
              ))}
            </div>
          </div>
        ) : null}

        {target ? null : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">{adminMessages.admin.upload.series}</span>
              {series ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1.5">
                  <span className="truncate text-[13px]">{series.title}</span>
                  <button
                    className="text-[12.5px] text-fg-muted hover:text-fg"
                    onClick={() => setSeries(null)}
                    type="button"
                  >
                    {m.change}
                  </button>
                </div>
              ) : (
                <SeriesSearch
                  onPick={(s) => setSeries({ id: s.id, title: s.title })}
                  placeholder={adminMessages.admin.upload.pickSeries}
                />
              )}
            </div>

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
              <span className="text-[13px] font-medium">
                {adminMessages.admin.upload.chapterNumber}
              </span>
              <input
                className={inputClass}
                inputMode="decimal"
                onChange={(e) => setNumber(e.target.value)}
                placeholder="12"
                value={number}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">
                {adminMessages.admin.upload.chapterTitle}
              </span>
              <input
                className={inputClass}
                onChange={(e) => setTitle(e.target.value)}
                value={title}
              />
            </div>
          </div>
        )}

        {target ? null : (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {canPublish ? (
              <Toggle
                checked={publish}
                label={adminMessages.admin.upload.afterPublish}
                onChange={setPublish}
              />
            ) : null}
            {canPublish ? (
              <Toggle
                checked={premium}
                label={adminMessages.admin.upload.premium}
                onChange={setPremium}
              />
            ) : null}
            {canRepair ? (
              <Toggle checked={replace} label={m.replace} onChange={setReplace} />
            ) : null}
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button
            disabled={!preview || busy !== null || (!target && (!series || number.trim() === ''))}
            onClick={() => void start()}
            type="button"
          >
            {busy === 'import' ? (
              <>
                <Loader2 aria-hidden className="size-4 animate-spin" /> {m.importing}
              </>
            ) : target ? (
              m.refillStart
            ) : (
              m.start
            )}
          </Button>
          <p className="text-[12.5px] text-fg-muted">{m.hint}</p>
        </div>
      </div>
    </Panel>
  )
}
