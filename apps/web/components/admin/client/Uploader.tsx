'use client'

import { fmt, messages } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { Button, cn, useToast } from '@palscans/ui'
import { unzip } from 'fflate'
import { AlertTriangle, FolderOpen, Plus, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { inputClass, Panel, PanelHeader, selectClass } from '../ui'
import { api, postJson } from './api'
import { Toggle } from './controls'
import { SeriesSearch } from './SeriesEditor'
import {
  imageSize,
  isImageName,
  mimeFor,
  naturalCompare,
  parseChapterNumber,
  runPool,
  sha256Hex,
  uploadWithRetry,
} from './upload-lib'
import { formatChapterNumber } from './util'

interface UPage {
  id: string
  name: string
  file: Blob
  type: string
  url: string
  width: number
  height: number
  sha256: string
  warnings: string[]
  progress: number
  status: 'idle' | 'uploading' | 'done' | 'failed'
  key?: string
  put?: { url: string; headers: Record<string, string> }
}

interface UChapter {
  id: string
  name: string
  number: string
  title: string
  pages: UPage[]
  status: 'idle' | 'uploading' | 'committing' | 'queued' | 'failed'
  chapterId?: number
  error?: string
}

type Existing = Array<{ id: number; number: number; state: string; pageCount: number }>

let seq = 0
const uid = () => `u${++seq}`

/** Walk dropped DirectoryEntry trees into [relativePath, File] pairs. */
const readEntry = (
  entry: FileSystemEntry,
  prefix: string,
  out: Array<[string, File]>,
): Promise<void> =>
  new Promise((resolve) => {
    if (entry.isFile) {
      ;(entry as FileSystemFileEntry).file(
        (f) => {
          out.push([`${prefix}${f.name}`, f])
          resolve()
        },
        () => resolve(),
      )
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      const all: FileSystemEntry[] = []
      const step = () =>
        reader.readEntries(
          async (batch) => {
            if (batch.length === 0) {
              for (const e of all) await readEntry(e, `${prefix}${entry.name}/`, out)
              resolve()
            } else {
              all.push(...batch)
              step()
            }
          },
          () => resolve(),
        )
      step()
    } else resolve()
  })

const unzipToFiles = (file: File): Promise<Array<[string, File]>> =>
  new Promise((resolve, reject) => {
    file.arrayBuffer().then((buf) => {
      unzip(
        new Uint8Array(buf),
        { filter: (f) => isImageName(f.name) && !f.name.includes('__MACOSX') },
        (err, data) => {
          if (err) return reject(err)
          const stem = file.name.replace(/\.(cbz|zip)$/i, '')
          resolve(
            Object.entries(data).map(([name, bytes]) => {
              const base = name.split('/').pop() ?? name
              return [
                `${stem}/${base}`,
                new File([bytes as BlobPart], base, { type: mimeFor(base) ?? '' }),
              ]
            }),
          )
        },
      )
    }, reject)
  })

/** Group [path, file] pairs into chapters: the deepest folder containing images names the chapter. */
const groupChapters = (pairs: Array<[string, File]>): Map<string, File[]> => {
  const groups = new Map<string, File[]>()
  for (const [path, file] of pairs) {
    const parts = path.split('/')
    const folder =
      parts.length >= 2 ? (parts[parts.length - 2] ?? 'chapter') : file.name.replace(/\.[^.]+$/, '')
    const list = groups.get(folder) ?? []
    list.push(file)
    groups.set(folder, list)
  }
  return groups
}

export function Uploader({
  preset,
  canPublish,
}: {
  preset: { id: number; title: string; slug: string } | null
  canPublish: boolean
}) {
  const m = adminMessages.admin.upload
  const { toast } = useToast()
  const [series, setSeries] = useState(preset)
  const [existing, setExisting] = useState<Existing>([])
  const [chapters, setChapters] = useState<UChapter[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const [after, setAfter] = useState<{
    mode: 'ready' | 'publish' | 'schedule'
    publishedAt: string
    isPremium: boolean
  }>({ mode: 'ready', publishedAt: '', isPremium: false })
  const [uploading, setUploading] = useState(false)
  const chaptersRef = useRef(chapters)
  useEffect(() => {
    chaptersRef.current = chapters
  }, [chapters])
  const insertTarget = useRef<{ chapter: string; index: number } | null>(null)
  const insertInput = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!series) return
    void api<Existing>(`/api/admin/series/${series.id}/numbers`).then((r) => {
      if (r.ok) setExisting(r.data)
    })
  }, [series])

  const buildPages = useCallback(
    async (files: File[]): Promise<UPage[]> => {
      const sorted = [...files].sort((a, b) => naturalCompare(a.name, b.name))
      const pages: UPage[] = []
      await runPool(sorted, 4, async (file) => {
        const type = file.type || mimeFor(file.name) || ''
        const image = isImageName(file.name) && type.startsWith('image/')
        const size = image ? await imageSize(file) : null
        const sha256 = image ? await sha256Hex(file) : ''
        pages.push({
          id: uid(),
          name: file.name,
          file,
          type,
          url: image ? URL.createObjectURL(file) : '',
          width: size?.width ?? 0,
          height: size?.height ?? 0,
          sha256,
          warnings: image ? [] : [m.warnings.nonImage],
          progress: 0,
          status: 'idle',
        })
      })
      return pages.sort((a, b) => naturalCompare(a.name, b.name))
    },
    [m.warnings.nonImage],
  )

  const addFiles = useCallback(
    async (pairs: Array<[string, File]>) => {
      const expanded: Array<[string, File]> = []
      for (const [path, file] of pairs) {
        if (/\.(cbz|zip)$/i.test(file.name)) {
          setBusy(fmt(m.unzipping, { name: file.name }))
          try {
            expanded.push(...(await unzipToFiles(file)))
          } catch {
            toast({ title: messages.errors.generic, description: file.name, tone: 'danger' })
          }
        } else if (isImageName(file.name)) expanded.push([path, file])
      }
      setBusy(m.hashing)
      const groups = groupChapters(expanded)
      const built: UChapter[] = []
      for (const [name, files] of groups) {
        const n = parseChapterNumber(name)
        built.push({
          id: uid(),
          name,
          number: n === null ? '' : formatChapterNumber(n),
          title: '',
          pages: await buildPages(files),
          status: 'idle',
        })
      }
      built.sort((a, b) => Number.parseFloat(a.number || '0') - Number.parseFloat(b.number || '0'))
      setChapters((cs) => [...cs, ...built])
      setBusy(null)
    },
    [buildPages, m.hashing, m.unzipping, toast],
  )

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDrag(false)
    const pairs: Array<[string, File]> = []
    const items = Array.from(e.dataTransfer.items)
    const entries = items.map((i) =>
      typeof i.webkitGetAsEntry === 'function' ? i.webkitGetAsEntry() : null,
    )
    if (entries.some(Boolean)) {
      for (const entry of entries) if (entry) await readEntry(entry, '', pairs)
    } else {
      for (const f of Array.from(e.dataTransfer.files)) pairs.push([f.name, f])
    }
    await addFiles(pairs)
  }

  const onPick = async (files: FileList | null) => {
    if (!files) return
    const pairs: Array<[string, File]> = Array.from(files).map((f) => [
      f.webkitRelativePath || f.name,
      f,
    ])
    await addFiles(pairs)
  }

  // warnings computed over the current state (docs/04 "warnings surface inline before upload")
  const annotated = useMemo(() => {
    const numbers = chapters
      .map((c) => Number.parseFloat(c.number))
      .filter((n) => Number.isFinite(n))
    const maxExisting = existing.reduce((a, b) => Math.max(a, b.number), Number.NEGATIVE_INFINITY)
    const all = [...numbers, ...(Number.isFinite(maxExisting) ? [maxExisting] : [])].sort(
      (a, b) => a - b,
    )
    return chapters.map((c) => {
      const n = Number.parseFloat(c.number)
      const warnings: string[] = []
      if (!Number.isFinite(n)) warnings.push(m.warnings.badNumber)
      else {
        const ex = existing.find((e) => e.number === n)
        if (ex && ex.pageCount > 0)
          warnings.push(fmt(m.warnings.exists, { n: formatChapterNumber(n) }))
        const i = all.indexOf(n)
        const prev = i > 0 ? all[i - 1] : undefined
        if (prev !== undefined && n - prev > 1.5) warnings.push(m.warnings.gap)
      }
      const widths = c.pages
        .map((p) => p.width)
        .filter((w) => w > 0)
        .sort((a, b) => a - b)
      const median = widths[Math.floor(widths.length / 2)] ?? 0
      const seen = new Map<string, number>()
      const pages = c.pages.map((p, idx) => {
        const w = [...p.warnings]
        if (p.width > 0 && median > 0 && p.width < median * 0.6) w.push(m.warnings.narrow)
        if (p.sha256) {
          const first = seen.get(p.sha256)
          if (first !== undefined) w.push(fmt(m.warnings.duplicate, { n: first + 1 }))
          else seen.set(p.sha256, idx)
        }
        return { ...p, warnings: w }
      })
      return { ...c, warnings, pages }
    })
  }, [chapters, existing, m.warnings])

  const updateChapter = (id: string, patch: Partial<UChapter> | ((c: UChapter) => UChapter)) =>
    setChapters((cs) =>
      cs.map((c) =>
        c.id === id ? (typeof patch === 'function' ? patch(c) : { ...c, ...patch }) : c,
      ),
    )

  const movePage = (chapterId: string, from: number, to: number) =>
    updateChapter(chapterId, (c) => {
      const pages = [...c.pages]
      const [p] = pages.splice(from, 1)
      if (p) pages.splice(to, 0, p)
      return { ...c, pages }
    })

  const dragFrom = useRef<{ chapter: string; index: number } | null>(null)

  const upload = async (retryOnly = false) => {
    if (!series) return
    const targets = annotated.filter(
      (c) =>
        c.status !== 'queued' && c.pages.some((p) => !p.warnings.includes(m.warnings.nonImage)),
    )
    if (targets.length === 0) return
    setUploading(true)
    try {
      let intents: Record<
        string,
        {
          chapterId: number
          files: Array<{ name: string; key: string; url: string; headers: Record<string, string> }>
        }
      > = {}
      const needIntent = targets.filter((c) => !retryOnly || !c.chapterId)
      if (needIntent.length) {
        const res = await postJson<{
          chapters: Array<{
            chapterId: number
            number: number
            files: Array<{
              name: string
              key: string
              url: string
              headers: Record<string, string>
            }>
          }>
        }>('/api/upload/intent', {
          seriesId: series.id,
          chapters: needIntent.map((c) => ({
            number: Number.parseFloat(c.number),
            title: c.title || null,
            files: c.pages
              .filter((p) => p.sha256)
              .map((p) => ({ name: p.name, bytes: p.file.size, sha256: p.sha256, type: p.type })),
          })),
        })
        if (!res.ok) {
          toast({
            title: adminMessages.admin.errorSaving,
            description: res.message || res.error,
            tone: 'danger',
          })
          return
        }
        needIntent.forEach((c, i) => {
          const r = res.data.chapters[i]
          if (r) intents[c.id] = r
        })
      }
      // assign keys / put targets
      setChapters((cs) =>
        cs.map((c) => {
          const it = intents[c.id]
          if (!it) return c
          let fi = 0
          return {
            ...c,
            chapterId: it.chapterId,
            status: 'uploading',
            pages: c.pages.map((p) => {
              if (!p.sha256) return p
              const f = it.files[fi++]
              return f
                ? {
                    ...p,
                    key: f.key,
                    put: { url: f.url, headers: f.headers },
                    status: 'idle',
                    progress: 0,
                  }
                : p
            }),
          }
        }),
      )
      intents = {}
      // 4-wide across every file (docs/03 step 5)
      const jobs: Array<{ chapter: string; page: string }> = []
      for (const c of targets)
        for (const p of c.pages)
          if (p.sha256 && (!retryOnly || p.status !== 'done'))
            jobs.push({ chapter: c.id, page: p.id })
      const latest = async () => {
        await new Promise((r) => setTimeout(r, 0))
        return chaptersRef.current
      }
      const state = await latest()
      await runPool(jobs, 4, async (job) => {
        const c = state.find((x) => x.id === job.chapter)
        const p = c?.pages.find((x) => x.id === job.page)
        if (!c || !p?.put) return
        const setPage = (patch: Partial<UPage>) =>
          updateChapter(c.id, (ch) => ({
            ...ch,
            pages: ch.pages.map((x) => (x.id === p.id ? { ...x, ...patch } : x)),
          }))
        setPage({ status: 'uploading', progress: 0 })
        try {
          await uploadWithRetry(p.put.url, p.put.headers, p.file, (f) => setPage({ progress: f }))
          setPage({ status: 'done', progress: 1 })
        } catch {
          setPage({ status: 'failed' })
        }
      })
      // commit chapters whose files all landed (docs/03 step 6)
      const done = await latest()
      for (const c of done) {
        if (!c.chapterId || c.status === 'queued') continue
        const pages = c.pages.filter((p) => p.key)
        if (pages.some((p) => p.status !== 'done')) {
          updateChapter(c.id, {
            status: 'failed',
            error: fmt(m.failedFiles, { n: pages.filter((p) => p.status !== 'done').length }),
          })
          continue
        }
        updateChapter(c.id, { status: 'committing' })
        const res = await postJson<{ chapterId: number }>('/api/upload/commit', {
          chapterId: c.chapterId,
          keys: pages.map((p) => p.key),
          after: {
            mode: after.mode,
            publishedAt:
              after.mode === 'schedule' && after.publishedAt
                ? new Date(after.publishedAt).toISOString()
                : null,
            isPremium: after.isPremium,
          },
        })
        updateChapter(
          c.id,
          res.ok ? { status: 'queued' } : { status: 'failed', error: res.message || res.error },
        )
      }
      toast({
        title: m.committed,
        tone: 'ok',
        action: {
          label: m.goToQueue,
          onClick: () => (window.location.href = '/admin/upload/queue'),
        },
      })
    } finally {
      setUploading(false)
    }
  }

  const totalFiles = annotated.reduce((n, c) => n + c.pages.length, 0)
  const doneFiles = annotated.reduce(
    (n, c) => n + c.pages.filter((p) => p.status === 'done').length,
    0,
  )
  const anyFailed = annotated.some((c) => c.status === 'failed')
  const pending = annotated.filter((c) => c.status !== 'queued').length

  return (
    <div className="grid gap-3.5 xl:grid-cols-[1fr_300px]">
      <div className="flex flex-col gap-3.5">
        <Panel>
          <PanelHeader title={m.series} />
          {series ? (
            <div className="flex items-center gap-3 rounded-md border border-line bg-bg px-3 py-2 text-[13px]">
              <span className="font-semibold">{series.title}</span>
              <span className="text-fg-subtle">/{series.slug}</span>
              <button
                type="button"
                className="ml-auto text-[12px] text-fg-muted underline"
                onClick={() => setSeries(null)}
              >
                {adminMessages.admin.edit}
              </button>
            </div>
          ) : (
            <SeriesSearch
              placeholder={m.pickSeries}
              onPick={(s) => setSeries({ id: s.id, title: s.title, slug: s.slug })}
            />
          )}
        </Panel>

        {/* biome-ignore lint/a11y/noStaticElementInteractions: drop target; the buttons inside are the keyboard path */}
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          className={cn(
            'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center transition-colors',
            drag ? 'border-brand bg-brand-wash' : 'border-line bg-surface-1',
          )}
        >
          <FolderOpen size={28} className="text-fg-subtle" aria-hidden="true" />
          <div className="text-[15px] font-semibold">{m.dropzone}</div>
          <p className="max-w-md text-[13px] text-fg-muted">{m.dropzoneHint}</p>
          <div className="mt-1 flex gap-2">
            <label className="inline-flex h-8 cursor-pointer items-center rounded-md border border-line bg-surface-2 px-3 text-[13px] font-semibold hover:bg-surface-3">
              {m.chooseFolder}
              <input
                type="file"
                className="sr-only"
                multiple
                {...({ webkitdirectory: '' } as Record<string, string>)}
                onChange={(e) => void onPick(e.target.files)}
              />
            </label>
            <label className="inline-flex h-8 cursor-pointer items-center rounded-md border border-line bg-surface-2 px-3 text-[13px] font-semibold hover:bg-surface-3">
              {m.chooseFiles}
              <input
                type="file"
                className="sr-only"
                multiple
                accept=".cbz,.zip,image/*"
                onChange={(e) => void onPick(e.target.files)}
              />
            </label>
          </div>
          {busy ? <div className="text-[12px] text-brand-hover">{busy}</div> : null}
        </div>

        {annotated.map((c) => (
          <Panel key={c.id}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-[12px] font-medium text-fg-muted">
                {m.chapterNumber}
                <input
                  className={`${inputClass} w-24 font-semibold text-fg tabular-nums`}
                  value={c.number}
                  disabled={c.status === 'queued'}
                  onChange={(e) => updateChapter(c.id, { number: e.target.value })}
                  aria-invalid={c.warnings.includes(m.warnings.badNumber)}
                />
              </label>
              <input
                className={`${inputClass} max-w-xs`}
                placeholder={m.chapterTitle}
                value={c.title}
                disabled={c.status === 'queued'}
                onChange={(e) => updateChapter(c.id, { title: e.target.value })}
              />
              <span className="text-[12px] text-fg-subtle">{c.name}</span>
              <span className="text-[12px] text-fg-muted">
                · {fmt(m.pages, { n: c.pages.length })}
              </span>
              {c.status === 'queued' ? (
                <span className="rounded-full bg-ok/15 px-2 py-0.5 text-[11px] font-bold text-ok">
                  {m.committed}
                </span>
              ) : null}
              {c.status === 'failed' ? (
                <span className="rounded-full bg-danger/15 px-2 py-0.5 text-[11px] font-bold text-danger">
                  {c.error}
                </span>
              ) : null}
              <button
                type="button"
                aria-label={m.removeChapter}
                className="ml-auto inline-flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-danger"
                onClick={() => setChapters((cs) => cs.filter((x) => x.id !== c.id))}
              >
                <X size={14} />
              </button>
            </div>
            {c.warnings.length ? (
              <ul className="mb-3 flex flex-wrap gap-2">
                {c.warnings.map((w) => (
                  <li
                    key={w}
                    className="inline-flex items-center gap-1 rounded-md bg-warn/15 px-2 py-1 text-[12px] font-medium text-warn"
                  >
                    <AlertTriangle size={12} aria-hidden="true" />
                    {w}
                  </li>
                ))}
              </ul>
            ) : null}
            <ol className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
              {c.pages.map((p, idx) => (
                <li
                  key={p.id}
                  draggable={c.status !== 'queued'}
                  onDragStart={() => {
                    dragFrom.current = { chapter: c.id, index: idx }
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    const from = dragFrom.current
                    if (from && from.chapter === c.id && from.index !== idx)
                      movePage(c.id, from.index, idx)
                    dragFrom.current = null
                  }}
                  className={cn(
                    'group relative rounded-md border bg-bg p-1',
                    p.warnings.length ? 'border-warn/60' : 'border-line',
                  )}
                >
                  {p.url ? (
                    <img
                      src={p.url}
                      alt=""
                      width={96}
                      height={144}
                      className="h-36 w-full rounded-sm object-cover object-top"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-36 items-center justify-center text-[11px] text-fg-subtle">
                      {p.name}
                    </div>
                  )}
                  <div className="mt-1 flex items-center justify-between text-[10px] text-fg-muted">
                    <span className="tabular-nums">{idx + 1}</span>
                    <span className="tabular-nums">{p.width ? `${p.width}×${p.height}` : ''}</span>
                  </div>
                  {p.status !== 'idle' ? (
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-3">
                      <div
                        className={cn('h-full', p.status === 'failed' ? 'bg-danger' : 'bg-brand')}
                        style={{ width: `${Math.round(p.progress * 100)}%` }}
                      />
                    </div>
                  ) : null}
                  {p.warnings.length ? (
                    <div
                      className="absolute top-1.5 left-1.5 rounded-sm bg-warn px-1 text-[10px] font-bold text-black"
                      title={p.warnings.join(' · ')}
                    >
                      !
                    </div>
                  ) : null}
                  {c.status !== 'queued' ? (
                    <div className="absolute top-1 right-1 hidden gap-1 group-hover:flex">
                      <button
                        type="button"
                        title={m.insertHere}
                        aria-label={m.insertHere}
                        className="inline-flex size-6 items-center justify-center rounded-sm bg-surface-3/90 text-fg hover:bg-brand"
                        onClick={() => {
                          insertTarget.current = { chapter: c.id, index: idx + 1 }
                          insertInput.current?.click()
                        }}
                      >
                        <Plus size={12} />
                      </button>
                      <button
                        type="button"
                        title={m.removePage}
                        aria-label={m.removePage}
                        className="inline-flex size-6 items-center justify-center rounded-sm bg-surface-3/90 text-fg hover:bg-danger"
                        onClick={() =>
                          updateChapter(c.id, (ch) => ({
                            ...ch,
                            pages: ch.pages.filter((x) => x.id !== p.id),
                          }))
                        }
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          </Panel>
        ))}
        <input
          ref={insertInput}
          type="file"
          className="sr-only"
          multiple
          accept="image/*"
          onChange={async (e) => {
            const target = insertTarget.current
            const files = e.target.files ? Array.from(e.target.files) : []
            if (!target || files.length === 0) return
            const pages = await buildPages(files)
            updateChapter(target.chapter, (ch) => {
              const next = [...ch.pages]
              next.splice(target.index, 0, ...pages)
              return { ...ch, pages: next }
            })
            e.target.value = ''
          }}
        />
      </div>

      <aside className="flex flex-col gap-3.5 xl:sticky xl:top-[76px] xl:self-start">
        <Panel>
          <PanelHeader title={m.after} />
          <div className="flex flex-col gap-3">
            <select
              className={selectClass}
              value={after.mode}
              onChange={(e) => setAfter({ ...after, mode: e.target.value as typeof after.mode })}
              aria-label={m.after}
            >
              <option value="ready">{m.afterReady}</option>
              {canPublish ? <option value="publish">{m.afterPublish}</option> : null}
              {canPublish ? <option value="schedule">{m.afterSchedule}</option> : null}
            </select>
            {after.mode === 'schedule' ? (
              <input
                type="datetime-local"
                className={inputClass}
                value={after.publishedAt}
                onChange={(e) => setAfter({ ...after, publishedAt: e.target.value })}
              />
            ) : null}
            <div className="flex items-center justify-between gap-3 text-[13px]">
              {m.premium}
              <Toggle
                ariaLabel={m.premium}
                size="sm"
                checked={after.isPremium}
                onChange={(v) => setAfter({ ...after, isPremium: v })}
              />
            </div>
          </div>
        </Panel>
        <Panel>
          <div className="flex flex-col gap-2">
            <Button
              disabled={
                !series ||
                pending === 0 ||
                uploading ||
                annotated.some(
                  (c) => c.status !== 'queued' && c.warnings.includes(m.warnings.badNumber),
                )
              }
              onClick={() => upload(false)}
            >
              {uploading
                ? fmt(m.uploading, { done: doneFiles, total: totalFiles })
                : fmt(m.uploadN, { n: pending })}
            </Button>
            {anyFailed && !uploading ? (
              <Button variant="outline" onClick={() => upload(true)}>
                {m.retryFailed}
              </Button>
            ) : null}
            <a
              href="/admin/upload/queue"
              className="text-center text-[12.5px] text-fg-muted underline"
            >
              {m.goToQueue}
            </a>
          </div>
        </Panel>
      </aside>
    </div>
  )
}
