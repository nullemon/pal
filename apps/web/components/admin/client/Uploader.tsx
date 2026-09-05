'use client'

import type {
  ChapterIssue,
  NumberSource,
  PlannedChapter,
  RejectReason,
} from '@palscans/core/import'
import { fmt, messages } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { Button, cn, useToast } from '@palscans/ui'
import { AlertTriangle, FolderOpen, Info, Plus, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { inputClass, Panel, PanelHeader, Pill, selectClass } from '../ui'
import { api, postJson } from './api'
import { Toggle } from './controls'
import { SeriesSearch } from './SeriesEditor'
import {
  imageSize,
  isImageName,
  mimeFor,
  planDrop,
  runPool,
  sanitizeEntryPath,
  sha256Hex,
  unzipEntries,
  uploadWithRetry,
} from './upload-lib'
import { formatChapterNumber } from './util'

interface UPage {
  id: string
  path: string
  name: string
  file: Blob
  type: string
  url: string
  role: 'cover' | 'page' | 'extra'
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
  group: string
  number: string
  title: string
  volume: number | null
  numberSource: NumberSource
  candidates: string[]
  issues: ChapterIssue[]
  pages: UPage[]
  /** What to do when this number already exists with pages — never decided silently. */
  conflict: 'skip' | 'replace'
  status: 'idle' | 'uploading' | 'committing' | 'queued' | 'skipped' | 'failed'
  chapterId?: number
  error?: string
}

type Existing = Array<{ id: number; number: number; state: string; pageCount: number }>
type Rejection = { path: string; reason: RejectReason }

/** One intent request carries a whole batch of chapters; route bodies are capped at 64 KB. */
const INTENT_BATCH_FILES = 150
const INTENT_BATCH_CHAPTERS = 20
/** Mirrors MAX_PAGES_PER_CHAPTER on the upload intent (../schemas), without pulling zod in. */
const MAX_PAGES = 400
/** Images picked without a folder: one chapter, and deliberately no digits to read. */
const LOOSE_GROUP = 'dropped-files'

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

const isArchive = (name: string) => /\.(cbz|zip|cbr|rar|7z)$/i.test(name)

export function Uploader({
  preset,
  canPublish,
  canRepair,
}: {
  preset: { id: number; title: string; slug: string } | null
  canPublish: boolean
  canRepair: boolean
}) {
  const m = adminMessages.admin.upload
  const b = adminMessages.bulkImport
  const { toast } = useToast()
  const [series, setSeries] = useState(preset)
  const [existing, setExisting] = useState<Existing>([])
  const [chapters, setChapters] = useState<UChapter[]>([])
  const [rejected, setRejected] = useState<Rejection[]>([])
  const [quiet, setQuiet] = useState(0)
  const [aborted, setAborted] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const [after, setAfter] = useState<{
    mode: 'ready' | 'publish' | 'schedule'
    publishedAt: string
    isPremium: boolean
  }>({ mode: 'ready', publishedAt: '', isPremium: false })
  const [uploading, setUploading] = useState(false)
  const insertTarget = useRef<{ chapter: string; index: number } | null>(null)
  const insertInput = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!series) return
    void api<Existing>(`/api/admin/series/${series.id}/numbers`).then((r) => {
      if (r.ok) setExisting(r.data)
    })
  }, [series])

  /** Measure and hash the accepted images; the plan already decided order and role. */
  const buildPages = useCallback(
    async (planned: PlannedChapter['pages'], files: Map<string, File>): Promise<UPage[]> => {
      const pages: UPage[] = planned.map((p) => {
        const file = files.get(p.path) as File
        return {
          id: uid(),
          path: p.path,
          name: p.name,
          file,
          type: file.type || mimeFor(p.name) || '',
          url: '',
          role: p.role,
          width: 0,
          height: 0,
          sha256: '',
          warnings: [],
          progress: 0,
          status: 'idle' as const,
        }
      })
      await runPool(pages, 4, async (page) => {
        const size = await imageSize(page.file)
        page.url = URL.createObjectURL(page.file)
        page.width = size?.width ?? 0
        page.height = size?.height ?? 0
        page.sha256 = await sha256Hex(page.file)
        if (!page.type) page.warnings = [m.warnings.nonImage]
      })
      return pages
    },
    [m.warnings.nonImage],
  )

  const addFiles = useCallback(
    async (pairs: Array<[string, File]>) => {
      const files = new Map<string, File>()
      const rejections: Rejection[] = []
      const aborts: string[] = []
      for (const [path, file] of pairs) {
        if (isArchive(file.name)) {
          setBusy(fmt(m.unzipping, { name: file.name }))
          try {
            const result = await unzipEntries(file)
            for (const entry of result.entries) files.set(entry.path, entry.file)
            rejections.push(...result.rejected)
            if (result.aborted) aborts.push(`${file.name}: ${b.aborted[result.aborted]}`)
          } catch {
            toast({ title: messages.errors.generic, description: file.name, tone: 'danger' })
          }
        } else {
          const safe = sanitizeEntryPath(path.includes('/') ? path : `${LOOSE_GROUP}/${path}`)
          if (!safe.ok) {
            rejections.push({ path, reason: safe.reason })
            continue
          }
          if (!isImageName(safe.path)) {
            rejections.push({ path: safe.path, reason: 'not_image' })
            continue
          }
          files.set(safe.path, file)
        }
      }
      setBusy(b.reading)
      const plan = planDrop(
        [...files].map(([path, file]) => ({ path, bytes: file.size })),
        { maxPages: MAX_PAGES },
      )
      const built: UChapter[] = []
      for (const chapter of plan.chapters) {
        built.push({
          id: uid(),
          group: chapter.group,
          number: chapter.number ?? '',
          title: chapter.title ?? '',
          volume: chapter.volume,
          numberSource: chapter.numberSource,
          candidates: chapter.candidates,
          issues: chapter.issues,
          pages: await buildPages(chapter.pages, files),
          conflict: 'skip',
          status: 'idle',
        })
      }
      setChapters((cs) => [...cs, ...built])
      setRejected((rs) => [...rs, ...rejections, ...plan.rejected])
      setQuiet((n) => n + plan.quiet)
      setAborted((a) => [...a, ...aborts])
      setBusy(null)
    },
    [buildPages, m.unzipping, toast],
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

  // Warnings computed over the current state (docs/04 "warnings surface inline before
  // upload"): the plan's own issues, plus what only the series can tell us — a number that
  // already exists, and a gap against what is already published.
  const annotated = useMemo(() => {
    const numbers = chapters
      .map((c) => Number.parseFloat(c.number))
      .filter((n) => Number.isFinite(n))
    const maxExisting = existing.reduce((a, b2) => Math.max(a, b2.number), Number.NEGATIVE_INFINITY)
    const all = [...numbers, ...(Number.isFinite(maxExisting) ? [maxExisting] : [])].sort(
      (a, b2) => a - b2,
    )
    return chapters.map((c) => {
      const n = Number.parseFloat(c.number)
      const warnings: string[] = []
      let clash: { id: number; pageCount: number } | null = null
      if (!Number.isFinite(n)) warnings.push(m.warnings.badNumber)
      else {
        const ex = existing.find((e) => e.number === n)
        if (ex && ex.pageCount > 0) clash = { id: ex.id, pageCount: ex.pageCount }
        const i = all.indexOf(n)
        const prev = i > 0 ? all[i - 1] : undefined
        if (prev !== undefined && n - prev > 1.5) warnings.push(m.warnings.gap)
      }
      const widths = c.pages
        .map((p) => p.width)
        .filter((w) => w > 0)
        .sort((a, b2) => a - b2)
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
      return { ...c, warnings, clash, pages }
    })
  }, [chapters, existing, m.warnings])

  const conflicts = annotated.filter((c) => c.clash && c.status !== 'queued')
  const issueText = (issue: ChapterIssue): string => {
    switch (issue.kind) {
      case 'ambiguous_number':
        return fmt(b.issues.ambiguous_number, { candidates: issue.candidates.join(', ') })
      case 'duplicate_number':
        return fmt(b.issues.duplicate_number, { number: issue.number })
      case 'missing_pages':
        return fmt(b.issues.missing_pages, { numbers: issue.numbers.join(', ') })
      case 'repeated_page_number':
        return fmt(b.issues.repeated_page_number, { numbers: issue.numbers.join(', ') })
      case 'extra_files':
        return fmt(b.issues.extra_files, { count: issue.count })
      case 'too_many_pages':
        return fmt(b.issues.too_many_pages, { max: issue.max })
      default:
        return b.issues[issue.kind]
    }
  }

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
    // Skipped conflicts never reach the wire; the rest carry an explicit replace flag.
    const targets = annotated.filter(
      (c) =>
        c.status !== 'queued' &&
        !(c.clash && c.conflict === 'skip') &&
        c.pages.some((p) => p.sha256 && !p.warnings.includes(m.warnings.nonImage)),
    )
    for (const c of annotated)
      if (c.clash && c.conflict === 'skip' && c.status !== 'queued')
        updateChapter(c.id, { status: 'skipped' })
    if (targets.length === 0) return
    setUploading(true)
    try {
      const intents = new Map<
        string,
        {
          chapterId: number
          files: Array<{ name: string; key: string; url: string; headers: Record<string, string> }>
        }
      >()
      const needIntent = targets.filter((c) => !retryOnly || !c.chapterId)
      // One request per batch: the manifest is JSON and route bodies are capped at 64 KB.
      const batches: Array<typeof needIntent> = []
      let batch: typeof needIntent = []
      let batchFiles = 0
      for (const c of needIntent) {
        const count = c.pages.filter((p) => p.sha256).length
        if (
          batch.length > 0 &&
          (batch.length >= INTENT_BATCH_CHAPTERS || batchFiles + count > INTENT_BATCH_FILES)
        ) {
          batches.push(batch)
          batch = []
          batchFiles = 0
        }
        batch.push(c)
        batchFiles += count
      }
      if (batch.length) batches.push(batch)

      for (const group of batches) {
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
          chapters: group.map((c) => ({
            number: Number.parseFloat(c.number),
            title: c.title || null,
            replace: c.clash ? c.conflict === 'replace' : false,
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
          for (const c of group) updateChapter(c.id, { status: 'failed', error: res.error })
          continue
        }
        group.forEach((c, i) => {
          const r = res.data.chapters[i]
          if (r) intents.set(c.id, r)
        })
      }
      // The upload plan is a plain object, not React state: `runPool` must not race the
      // renderer to find out where a page PUTs. What is written to state below is display.
      interface PlanPage {
        id: string
        file: Blob
        key: string
        put: { url: string; headers: Record<string, string> }
        done: boolean
      }
      const plan: Array<{ chapter: string; chapterId: number; pages: PlanPage[] }> = []
      for (const c of targets) {
        const it = intents.get(c.id)
        if (it) {
          const files = c.pages.filter((p) => p.sha256)
          plan.push({
            chapter: c.id,
            chapterId: it.chapterId,
            pages: files.flatMap((p, i): PlanPage[] => {
              const f = it.files[i]
              return f
                ? [
                    {
                      id: p.id,
                      file: p.file,
                      key: f.key,
                      put: { url: f.url, headers: f.headers },
                      done: retryOnly && p.status === 'done',
                    },
                  ]
                : []
            }),
          })
          continue
        }
        // "Retry failed" on a chapter that already has an intent: the presigned PUTs from
        // the first attempt are still valid (15 minutes), so only the files that did not
        // land are sent again.
        if (!retryOnly || !c.chapterId) continue
        const kept = c.pages.flatMap((p): PlanPage[] =>
          p.key && p.put
            ? [{ id: p.id, file: p.file, key: p.key, put: p.put, done: p.status === 'done' }]
            : [],
        )
        if (kept.length) plan.push({ chapter: c.id, chapterId: c.chapterId, pages: kept })
      }
      if (plan.length === 0) return
      // assign keys / put targets (the grid's progress bars read these)
      setChapters((cs) =>
        cs.map((c) => {
          const entry = plan.find((x) => x.chapter === c.id)
          if (!entry) return c
          return {
            ...c,
            chapterId: entry.chapterId,
            status: 'uploading',
            pages: c.pages.map((p) => {
              const target = entry.pages.find((x) => x.id === p.id)
              return target
                ? {
                    ...p,
                    key: target.key,
                    put: target.put,
                    status: target.done ? ('done' as const) : ('idle' as const),
                    progress: target.done ? 1 : 0,
                  }
                : p
            }),
          }
        }),
      )
      // 4-wide across every file of every chapter (docs/03 step 5)
      const jobs = plan.flatMap((entry) =>
        entry.pages.filter((p) => !p.done).map((p) => ({ entry, page: p })),
      )
      const failures = new Set<string>()
      await runPool(jobs, 4, async ({ entry, page }) => {
        const setPage = (patch: Partial<UPage>) =>
          updateChapter(entry.chapter, (ch) => ({
            ...ch,
            pages: ch.pages.map((x) => (x.id === page.id ? { ...x, ...patch } : x)),
          }))
        setPage({ status: 'uploading', progress: 0 })
        try {
          await uploadWithRetry(page.put.url, page.put.headers, page.file, (f) =>
            setPage({ progress: f }),
          )
          page.done = true
          setPage({ status: 'done', progress: 1 })
        } catch {
          failures.add(page.id)
          setPage({ status: 'failed' })
        }
      })
      // commit the chapters whose files all landed (docs/03 step 6)
      let committed = 0
      for (const entry of plan) {
        const missed = entry.pages.filter((p) => failures.has(p.id) || !p.done).length
        if (missed > 0) {
          updateChapter(entry.chapter, {
            status: 'failed',
            error: fmt(m.failedFiles, { n: missed }),
          })
          continue
        }
        updateChapter(entry.chapter, { status: 'committing' })
        const res = await postJson<{ chapterId: number }>('/api/upload/commit', {
          chapterId: entry.chapterId,
          keys: entry.pages.map((p) => p.key),
          after: {
            mode: after.mode,
            publishedAt:
              after.mode === 'schedule' && after.publishedAt
                ? new Date(after.publishedAt).toISOString()
                : null,
            isPremium: after.isPremium,
          },
        })
        if (res.ok) committed += 1
        updateChapter(
          entry.chapter,
          res.ok ? { status: 'queued' } : { status: 'failed', error: res.message || res.error },
        )
      }
      if (committed === 0) return
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
  const pending = annotated.filter(
    (c) => c.status !== 'queued' && !(c.clash && c.conflict === 'skip'),
  ).length
  const blocked = annotated.some(
    (c) =>
      c.status !== 'queued' &&
      !(c.clash && c.conflict === 'skip') &&
      (c.warnings.includes(m.warnings.badNumber) ||
        c.issues.some((i) => i.kind === 'duplicate_number' || i.kind === 'too_many_pages')),
  )

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
          <div className="text-[15px] font-semibold">{b.dropzone}</div>
          <p className="max-w-md text-[13px] text-fg-muted">{b.dropzoneHint}</p>
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

        {annotated.length > 0 ? (
          <Panel>
            <PanelHeader
              title={b.reviewTitle}
              hint={b.reviewLead}
              aside={
                <button
                  type="button"
                  className="underline hover:text-fg"
                  onClick={() => {
                    setChapters([])
                    setRejected([])
                    setQuiet(0)
                    setAborted([])
                  }}
                >
                  {b.clear}
                </button>
              }
            />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-fg-muted">
              <span className="font-semibold text-fg">
                {fmt(b.detected, { chapters: annotated.length, pages: totalFiles })}
              </span>
              {conflicts.length ? (
                <span className="text-warn">{fmt(b.conflictCount, { n: conflicts.length })}</span>
              ) : null}
              {quiet ? <span>{fmt(b.rejectedQuiet, { n: quiet })}</span> : null}
            </div>
            {conflicts.length > 1 ? (
              <div className="mt-3 flex items-center gap-2 text-[12px]">
                <span className="text-fg-muted">{b.conflictAll}</span>
                <button
                  type="button"
                  className="rounded-md border border-line bg-surface-2 px-2 py-1 font-semibold hover:bg-surface-3"
                  onClick={() =>
                    setChapters((cs) =>
                      cs.map((c) => (c.status === 'queued' ? c : { ...c, conflict: 'skip' })),
                    )
                  }
                >
                  {b.conflict.skip}
                </button>
                {canRepair ? (
                  <button
                    type="button"
                    className="rounded-md border border-line bg-surface-2 px-2 py-1 font-semibold hover:bg-surface-3"
                    onClick={() =>
                      setChapters((cs) =>
                        cs.map((c) => (c.status === 'queued' ? c : { ...c, conflict: 'replace' })),
                      )
                    }
                  >
                    {b.conflict.replace}
                  </button>
                ) : null}
              </div>
            ) : null}
            {aborted.map((a) => (
              <p
                key={a}
                className="mt-3 rounded-md bg-danger/15 px-2.5 py-2 text-[12.5px] text-danger"
              >
                {a}
              </p>
            ))}
            {rejected.length ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-[12.5px] font-semibold text-warn">
                  {fmt(b.rejectedTitle, { n: rejected.length })}
                </summary>
                <ul className="mt-2 flex max-h-48 flex-col gap-1 overflow-auto text-[12px] text-fg-muted">
                  {rejected.slice(0, 60).map((r) => (
                    <li key={`${r.path}-${r.reason}`} className="flex gap-2">
                      <span className="truncate font-mono text-[11px]">{r.path}</span>
                      <span className="ml-auto shrink-0 text-fg-subtle">
                        {b.rejectedReasons[r.reason] ?? r.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </Panel>
        ) : null}

        {annotated.map((c) => (
          <Panel
            key={c.id}
            className={cn(
              c.status === 'skipped' || (c.clash && c.conflict === 'skip') ? 'opacity-60' : '',
            )}
          >
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
              <span className="text-[12px] text-fg-subtle" title={c.group}>
                {fmt(b.foundIn, { path: c.group })}
              </span>
              <span className="text-[12px] text-fg-muted">
                · {fmt(m.pages, { n: c.pages.length })}
              </span>
              <span className="text-[12px] text-fg-subtle">
                ·{' '}
                {c.numberSource === 'none'
                  ? b.numberFrom.none
                  : fmt(b.numberFrom[c.numberSource], { text: c.candidates[0] ?? '' })}
              </span>
              {c.status === 'queued' ? (
                <Pill tone="ok">{m.committed}</Pill>
              ) : c.status === 'skipped' ? (
                <Pill tone="neutral">{b.conflict.skipped}</Pill>
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
            {c.clash && c.status !== 'queued' ? (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[12.5px]">
                <AlertTriangle size={14} className="text-warn" aria-hidden="true" />
                <span className="font-semibold text-warn">
                  {fmt(b.conflict.title, {
                    n: formatChapterNumber(c.number),
                    pages: c.clash.pageCount,
                  })}
                </span>
                <select
                  className={`${selectClass} ml-auto w-56`}
                  aria-label={fmt(b.conflict.title, {
                    n: formatChapterNumber(c.number),
                    pages: c.clash.pageCount,
                  })}
                  value={c.conflict}
                  onChange={(e) =>
                    updateChapter(c.id, { conflict: e.target.value as 'skip' | 'replace' })
                  }
                >
                  <option value="skip">{b.conflict.skip}</option>
                  {canRepair ? <option value="replace">{b.conflict.replace}</option> : null}
                </select>
              </div>
            ) : null}
            {c.warnings.length || c.issues.length ? (
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
                {c.issues.map((issue) => (
                  <li
                    key={issue.kind}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium',
                      issue.kind === 'extra_files'
                        ? 'bg-surface-3 text-fg-muted'
                        : 'bg-warn/15 text-warn',
                    )}
                  >
                    {issue.kind === 'extra_files' ? (
                      <Info size={12} aria-hidden="true" />
                    ) : (
                      <AlertTriangle size={12} aria-hidden="true" />
                    )}
                    {issueText(issue)}
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
                  {p.role !== 'page' ? (
                    <div className="absolute bottom-8 left-1.5 rounded-sm bg-surface-3/90 px-1 text-[10px] font-bold uppercase tracking-[0.04em] text-fg-muted">
                      {p.role === 'cover' ? b.pageRole.cover : b.pageRole.extra}
                    </div>
                  ) : null}
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
            const map = new Map<string, File>()
            for (const f of files) map.set(`inserted/${f.name}`, f)
            const pages = await buildPages(
              files.map((f) => ({
                path: `inserted/${f.name}`,
                name: f.name,
                bytes: f.size,
                role: 'page' as const,
                num: null,
              })),
              map,
            )
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
              disabled={!series || pending === 0 || uploading || blocked}
              onClick={() => upload(false)}
            >
              {uploading
                ? fmt(m.uploading, { done: doneFiles, total: totalFiles })
                : fmt(m.uploadN, { n: pending })}
            </Button>
            {blocked ? <p className="text-[12px] text-warn">{b.blocked}</p> : null}
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
