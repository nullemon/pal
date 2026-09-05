'use client'

import {
  describeImportSource,
  type ImportSetting,
  importSourceModes,
  importSourceReady,
  importUploadsModes,
} from '@palscans/core/import'
import { fmt } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { Button, useToast } from '@palscans/ui'
import { Download, Pause, Play, RefreshCw, Square } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, patchJson, postJson, putJson } from '@/components/admin/client/api'
import { SaveBar, Segmented, Toggle } from '@/components/admin/client/controls'
import {
  EmptyRow,
  Field,
  Hint,
  inputClass,
  Panel,
  PanelHeader,
  Pill,
  StatTile,
  Table,
  Td,
  Th,
} from '@/components/admin/ui'
import type { ImportDoc, RunView } from './types'

const m = adminMessages.admin.import
const nf = new Intl.NumberFormat('en-GB')

type RunState = 'idle' | 'discovering' | 'dryRunning'

const when = (iso: string): string => new Date(iso).toISOString().replace('T', ' ').slice(0, 16)

function Warnings({ items }: { items: readonly string[] }) {
  if (items.length === 0) return null
  return (
    <div className="mt-3.5 rounded-md border border-warn/40 bg-warn/10 p-3">
      <div className="mb-1 text-[12.5px] font-bold text-warn">{m.warnings}</div>
      <ul className="flex list-disc flex-col gap-1 pl-4 text-[12.5px] leading-[18px] text-fg-muted">
        {items.slice(0, 8).map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </div>
  )
}

function CountGrid({
  items,
}: {
  items: readonly { label: string; value: number; tone?: 'warn' }[]
}) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((c) => (
        <StatTile key={c.label} label={c.label} value={nf.format(c.value)} tone={c.tone} />
      ))}
    </div>
  )
}

/** Status tones for the run banner: what the operator should feel at a glance. */
const RUN_TONE: Record<RunView['status'], 'ok' | 'warn' | 'danger' | undefined> = {
  queued: undefined,
  running: undefined,
  paused: 'warn',
  done: 'ok',
  cancelled: 'warn',
  failed: 'danger',
}

const RUN_NOTE: Record<RunView['status'], string> = {
  queued: m.queued,
  running: m.runningNow,
  paused: m.pausedNow,
  done: m.doneNow,
  cancelled: m.cancelledNow,
  failed: m.failedNow,
}

/**
 * The import run: start it, watch it, stop it. Progress is polled rather than streamed —
 * the run outlives this page and any number of tabs may be watching, so the row in
 * `import_runs` is the only source of truth about where it has got to.
 */
function RunPanel({ initial, ready }: { initial: RunView | null; ready: boolean }) {
  const { toast } = useToast()
  const [view, setView] = useState<RunView | null>(initial)
  const [busy, setBusy] = useState(false)
  const live = view !== null && (view.status === 'queued' || view.status === 'running')

  useEffect(() => {
    if (!live) return
    let cancelled = false
    const tick = async () => {
      const res = await api<RunView | null>('/api/admin/import/run')
      if (!cancelled && res.ok) setView(res.data)
    }
    const timer = setInterval(() => void tick(), 2000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [live])

  const send = async (action: 'start' | 'pause' | 'resume' | 'cancel') => {
    if (action === 'cancel' && !window.confirm(m.confirmCancel)) return
    setBusy(true)
    const res =
      action === 'start'
        ? await postJson<RunView>('/api/admin/import/run', {})
        : await patchJson<RunView>('/api/admin/import/run', { id: view?.id, action })
    setBusy(false)
    if (!res.ok) return toast({ title: m.startFailed, description: res.message, tone: 'danger' })
    setView(res.data)
  }

  const counts = view?.counts ?? {}
  const tiles = (
    [
      ['series', m.counts.series],
      ['chapters', m.counts.chapters],
      ['pages', m.counts.chapterPages],
      ['users', m.counts.users],
      ['comments', m.counts.comments],
      ['bookmarks', m.counts.bookmarks],
      ['redirects', m.counts.redirects],
      ['skipped', m.skippedCount],
    ] as const
  ).map(([key, label]) => ({ label, value: counts[key] ?? 0 }))

  return (
    <Panel>
      <PanelHeader title={m.runTitle} hint={m.runHint} />
      <div className="flex flex-wrap items-center gap-2">
        {live || view?.status === 'paused' ? (
          <>
            {view?.status === 'paused' ? (
              <Button size="sm" disabled={busy} onClick={() => void send('resume')}>
                <Play size={14} aria-hidden="true" />
                {m.resume}
              </Button>
            ) : (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void send('pause')}>
                <Pause size={14} aria-hidden="true" />
                {m.pause}
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void send('cancel')}>
              <Square size={14} aria-hidden="true" />
              {m.cancel}
            </Button>
          </>
        ) : (
          <Button size="sm" disabled={!ready || busy} onClick={() => void send('start')}>
            <Play size={14} aria-hidden="true" />
            {m.start}
          </Button>
        )}
        {view ? (
          <Pill tone={RUN_TONE[view.status]}>
            {m.phase}: {m.phases[view.phase]}
          </Pill>
        ) : null}
        {!ready && !view ? <Hint>{m.runUnavailable}</Hint> : null}
      </div>

      {view ? (
        <>
          <p className="mt-3 text-[12.5px] leading-[18px] text-fg-muted">
            {view.stopping && live ? m.pausedNow : RUN_NOTE[view.status]}{' '}
            {fmt(m.startedWhen, { when: when(view.startedAt) })}
          </p>
          <div className="mt-3.5">
            <div className="mb-1.5 text-[12.5px] font-bold text-fg">{m.written}</div>
            <CountGrid items={tiles} />
          </div>
          {view.errors.length > 0 ? (
            <Warnings items={view.errors.map((e) => `${e.scope}: ${e.message}`)} />
          ) : null}
        </>
      ) : null}

      <div className="mt-3.5 flex flex-col gap-1 text-[12.5px] leading-[18px] text-fg-muted">
        <p>{m.passwordsNote}</p>
        <p>{m.redirectsNote}</p>
        <p>{m.guestCommentsNote}</p>
        <p>{m.imagesNote}</p>
      </div>
    </Panel>
  )
}

export function ImportScreen({
  initial,
  run: initialRun,
}: {
  initial: ImportDoc
  run: RunView | null
}) {
  const { toast } = useToast()
  const [doc, setDoc] = useState(initial)
  const [saved, setSaved] = useState<ImportSetting>(initial.config)
  const [s, setS] = useState<ImportSetting>(initial.config)
  const [saving, setSaving] = useState(false)
  const [run, setRun] = useState<RunState>('idle')

  const dirty = JSON.stringify(s) !== JSON.stringify(saved)
  const ready = importSourceReady(s) && !dirty
  const set = (patch: Partial<ImportSetting>) => setS({ ...s, ...patch })

  const save = async () => {
    setSaving(true)
    const res = await putJson<ImportDoc>('/api/admin/import', s)
    setSaving(false)
    if (!res.ok)
      return toast({
        title: adminMessages.admin.errorSaving,
        description: res.message,
        tone: 'danger',
      })
    setDoc(res.data)
    setSaved(res.data.config)
    setS(res.data.config)
    toast({ title: m.saved, tone: 'ok' })
  }

  const start = async (kind: 'discover' | 'dry-run') => {
    setRun(kind === 'discover' ? 'discovering' : 'dryRunning')
    const res = await postJson<ImportDoc>(`/api/admin/import/${kind}`, {})
    setRun('idle')
    if (!res.ok)
      return toast({
        title: adminMessages.admin.errorSaving,
        description: res.message,
        tone: 'danger',
      })
    setDoc(res.data)
  }

  const discovery = doc.discovery
  const dry = doc.dryRun
  const t = dry?.totals

  return (
    <div className="flex flex-col gap-3.5">
      <SaveBar
        dirty={dirty}
        saving={saving}
        onDiscard={() => setS(saved)}
        onSave={() => void save()}
        status={describeImportSource(saved)}
      />

      <div className="grid items-start gap-3.5 lg:grid-cols-2">
        <Panel>
          <PanelHeader title={m.sourceTitle} hint={m.sourceHint} />
          <Segmented
            value={s.mode}
            onChange={(mode) => set({ mode })}
            options={importSourceModes.map((mode) => ({ value: mode, label: m.modes[mode] }))}
          />
          <div className="mt-3.5 flex flex-col gap-3.5">
            {s.mode === 'dsn' ? (
              <Field label={m.dsn} hint={m.dsnHint}>
                <input
                  className={inputClass}
                  value={s.dsn}
                  spellCheck={false}
                  placeholder={m.dsnPlaceholder}
                  onChange={(e) => set({ dsn: e.target.value })}
                />
              </Field>
            ) : null}
            {s.mode === 'dump' ? (
              <Field label={m.dumpPath} hint={m.dumpHint}>
                <input
                  className={inputClass}
                  value={s.dumpPath}
                  spellCheck={false}
                  placeholder="legacy/wordpress-2026-09-01.sql"
                  onChange={(e) => set({ dumpPath: e.target.value })}
                />
              </Field>
            ) : null}
            {s.mode === 'sample' ? <Hint>{m.sampleNotice}</Hint> : null}
            <Field label={m.tablePrefix} hint={m.tablePrefixHint}>
              <input
                className={inputClass}
                value={s.tablePrefix}
                spellCheck={false}
                onChange={(e) => set({ tablePrefix: e.target.value })}
              />
            </Field>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title={m.uploadsTitle} hint={m.uploadsHint} />
          <Segmented
            value={s.uploadsMode}
            onChange={(uploadsMode) => set({ uploadsMode })}
            options={importUploadsModes.map((mode) => ({
              value: mode,
              label: m.uploadsModes[mode],
            }))}
          />
          <div className="mt-3.5 flex flex-col gap-3.5">
            {s.uploadsMode === 'path' ? (
              <Field label={m.uploadsPath}>
                <input
                  className={inputClass}
                  value={s.uploadsPath}
                  spellCheck={false}
                  placeholder={m.uploadsPathPlaceholder}
                  onChange={(e) => set({ uploadsPath: e.target.value })}
                />
              </Field>
            ) : (
              <Field label={m.uploadsArchive}>
                <input
                  className={inputClass}
                  value={s.uploadsArchive}
                  spellCheck={false}
                  placeholder="legacy/uploads.tar.zst"
                  onChange={(e) => set({ uploadsArchive: e.target.value })}
                />
              </Field>
            )}
            <Field label={m.batchSize} hint={m.batchSizeHint}>
              <input
                className={inputClass}
                type="number"
                min={1}
                max={500}
                value={s.batchSize}
                onChange={(e) => set({ batchSize: Number.parseInt(e.target.value, 10) || 1 })}
              />
            </Field>
            <div className="flex items-start justify-between gap-4 border-t border-line-soft pt-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] font-semibold">{m.skipImages}</span>
                <Hint>{m.skipImagesHint}</Hint>
              </div>
              <Toggle
                checked={s.skipImages}
                ariaLabel={m.skipImages}
                onChange={(skipImages) => set({ skipImages })}
              />
            </div>
          </div>
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          title={m.discoveryTitle}
          hint={m.discoveryHint}
          aside={discovery ? fmt(m.lastRun, { when: when(discovery.ranAt) }) : m.neverRun}
        />
        <div className="mb-3.5 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={!ready || run !== 'idle'}
            onClick={() => void start('discover')}
          >
            <RefreshCw size={14} aria-hidden="true" />
            {run === 'discovering' ? m.runningDiscovery : m.runDiscovery}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!ready || run !== 'idle'}
            onClick={() => void start('dry-run')}
          >
            <Play size={14} aria-hidden="true" />
            {run === 'dryRunning' ? m.runningDryRun : m.runDryRun}
          </Button>
          {s.mode === 'dsn' ? (
            <Hint className="ml-1">{fmt(m.connectorMissing, { mode: m.modes[s.mode] })}</Hint>
          ) : null}
        </div>
        {discovery ? (
          <>
            <div className="mb-3.5 flex flex-wrap items-center gap-2 text-[12.5px] text-fg-muted">
              <Pill tone="brand">{discovery.source}</Pill>
              <span>{m.chapterStorage}:</span>
              <Pill tone={discovery.chapterStorage === 'custom-tables' ? 'ok' : 'warn'}>
                {m.chapterStorageValues[discovery.chapterStorage]}
              </Pill>
            </div>
            <CountGrid
              items={[
                { label: m.counts.series, value: discovery.counts.series },
                { label: m.counts.chapters, value: discovery.counts.chapters },
                { label: m.counts.chapterPages, value: discovery.counts.chapterPages },
                { label: m.counts.terms, value: discovery.counts.terms },
                { label: m.counts.users, value: discovery.counts.users },
                { label: m.counts.bookmarks, value: discovery.counts.bookmarks },
                { label: m.counts.comments, value: discovery.counts.comments },
                {
                  label: m.counts.chaptersUnparsed,
                  value: dry?.totals.chaptersUnparsed ?? 0,
                  tone: (dry?.totals.chaptersUnparsed ?? 0) > 0 ? 'warn' : undefined,
                },
              ]}
            />
            <div className="mt-3.5 grid items-start gap-3.5 lg:grid-cols-2">
              <div>
                <div className="mb-1.5 text-[12.5px] font-bold text-fg-muted">{m.taxonomies}</div>
                <Table>
                  <thead>
                    <tr>
                      <Th>{m.taxonomies}</Th>
                      <Th align="right">{m.counts.terms}</Th>
                      <Th align="right">{m.mapped}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(discovery.taxonomies).map(([tax, info]) => (
                      <tr key={tax}>
                        <Td className="font-mono text-[12.5px]">{tax}</Td>
                        <Td align="right">{nf.format(info.terms)}</Td>
                        <Td align="right">
                          <Pill tone={info.mapped ? 'ok' : 'neutral'}>
                            {info.mapped ? m.mapped : m.unmapped}
                          </Pill>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              <div>
                <div className="mb-1.5 text-[12.5px] font-bold text-fg-muted">{m.metaKeys}</div>
                <Table>
                  <thead>
                    <tr>
                      <Th>{m.metaKeys}</Th>
                      <Th align="right">{m.counts.series}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(discovery.metaKeys)
                      .filter(([, info]) => info.mapped)
                      .map(([key, info]) => (
                        <tr key={key}>
                          <Td className="font-mono text-[12.5px]">{key}</Td>
                          <Td align="right">{nf.format(info.present)}</Td>
                        </tr>
                      ))}
                  </tbody>
                </Table>
              </div>
            </div>
            <Warnings items={discovery.warnings} />
          </>
        ) : (
          <Hint>{m.discoveryEmpty}</Hint>
        )}
      </Panel>

      <Panel>
        <PanelHeader
          title={m.dryRunTitle}
          hint={m.dryRunHint}
          aside={dry ? fmt(m.lastRun, { when: when(dry.ranAt) }) : m.neverRun}
        />
        {dry && t ? (
          <>
            <CountGrid
              items={[
                { label: m.counts.series, value: t.series },
                { label: m.counts.chapters, value: t.chapters },
                { label: m.counts.chapterPages, value: t.chapterPages },
                { label: m.counts.redirects, value: t.redirects },
                { label: m.counts.genres, value: t.genres },
                { label: m.counts.people, value: t.people },
                { label: m.counts.users, value: t.users },
                {
                  label: m.counts.bookmarksOrphaned,
                  value: t.bookmarksOrphaned,
                  tone: t.bookmarksOrphaned > 0 ? 'warn' : undefined,
                },
              ]}
            />
            <div className="mt-3.5 flex flex-wrap gap-1.5 text-[12.5px]">
              <span className="text-fg-muted">{m.byType}:</span>
              {Object.entries(dry.byType).map(([type, n]) => (
                <Pill key={type} tone="neutral">{`${type} · ${nf.format(n)}`}</Pill>
              ))}
              <span className="ml-2 text-fg-muted">{m.byStatus}:</span>
              {Object.entries(dry.byStatus).map(([status, n]) => (
                <Pill key={status} tone="neutral">{`${status} · ${nf.format(n)}`}</Pill>
              ))}
            </div>

            <div className="mt-4 mb-2 flex items-start justify-between gap-4">
              <div>
                <div className="text-[13px] font-bold">{m.unparsed}</div>
                <Hint>{m.unparsedHint}</Hint>
              </div>
              <Button size="sm" variant="outline" href="/api/admin/import/unparsed" download>
                <Download size={14} aria-hidden="true" />
                {m.downloadCsv}
              </Button>
            </div>
            <Table>
              <thead>
                <tr>
                  <Th>{m.counts.series}</Th>
                  <Th>{m.unparsed}</Th>
                  <Th align="right">ID</Th>
                </tr>
              </thead>
              <tbody>
                {dry.unparsedChapters.length === 0 ? (
                  <EmptyRow colSpan={3}>{m.unparsedNone}</EmptyRow>
                ) : (
                  dry.unparsedChapters.slice(0, 25).map((c) => (
                    <tr key={c.legacyChapterId}>
                      <Td>{c.seriesTitle}</Td>
                      <Td className="font-mono text-[12.5px]">{c.name}</Td>
                      <Td align="right">{c.legacyChapterId}</Td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
            <Warnings items={dry.warnings} />
          </>
        ) : (
          <Hint>{m.dryRunEmpty}</Hint>
        )}
      </Panel>

      <RunPanel initial={initialRun} ready={importSourceReady(saved)} />
    </div>
  )
}
