import { compactNumber, formatChapterNumber } from '@palscans/core'
import { fmt } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import {
  type ChapterOverlap,
  getDb,
  type MergePreview,
  previewMerge,
  type SeriesBrief,
} from '@palscans/db'
import { cn } from '@palscans/ui'
import { AlertTriangle, ArrowRight, Info, Link2, ScrollText, XCircle } from 'lucide-react'
import { z } from 'zod'
import { parseSearch, type SearchParams } from '@/components/admin/server/params'
import {
  EmptyRow,
  Hint,
  Num,
  PageHeader,
  Panel,
  PanelHeader,
  Pill,
  PubStatePill,
  Table,
  Td,
  Th,
} from '@/components/admin/ui'
import { coverSrc } from '@/components/discovery/media'
import { withPermission } from '@/lib/auth'
import { MergeConfirm } from './MergeConfirm'

/**
 * `Admin → Content → Duplicates → Review merge` (docs/09, docs/12 §7).
 *
 * Permission: **`series.delete`**. A merge retires a series row and rewrites every reader
 * association that pointed at it, which is a strictly larger action than the soft delete
 * that permission already gates — and it is admin-only, which is where an irreversible
 * catalogue change belongs. `series.update` would let a moderator do it, and a moderator who
 * picks the wrong winner cannot undo it.
 *
 * The whole page is the preview, rendered fresh on every load from `previewMerge` — the same
 * function the transaction re-runs under `FOR UPDATE` before it writes. What is on screen is
 * what will happen, or the merge does not happen.
 */

const schema = z.object({
  winner: z.coerce.number().int().positive().optional().catch(undefined),
  loser: z.coerce.number().int().positive().optional().catch(undefined),
})

const m = adminMessages.merge

export default async function MergePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await withPermission('series.delete', { returnTo: '/admin/series/merge' })
  const p = parseSearch(schema, await searchParams)
  if (!p.winner || !p.loser) {
    return (
      <>
        <PageHeader title={m.title} subtitle={m.subtitle} />
        <Panel>
          <Hint>{m.pick}</Hint>
          <a
            href="/admin/series/duplicates"
            className="mt-2 inline-flex h-8 items-center rounded-md border border-line px-3 text-[13px] font-semibold hover:bg-surface-2"
          >
            {adminMessages.duplicates.title}
          </a>
        </Panel>
      </>
    )
  }
  const db = await getDb()
  const preview = await previewMerge(db, p.winner, p.loser)
  const blocked = preview.refusals.length > 0

  return (
    <>
      <PageHeader
        title={m.title}
        subtitle={m.subtitle}
        actions={
          <a
            href={`/admin/series/merge?winner=${p.loser}&loser=${p.winner}`}
            className="inline-flex h-9 items-center rounded-md border border-line px-3 text-[13px] font-semibold hover:bg-surface-2"
          >
            {m.swap}
          </a>
        }
      />

      <div className="grid gap-3.5 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
        <SidePanel side={preview.winner} kind="winner" />
        <ArrowRight
          size={22}
          aria-hidden="true"
          className="mx-auto hidden shrink-0 rotate-180 text-fg-subtle lg:block"
        />
        <SidePanel side={preview.loser} kind="loser" />
      </div>

      {blocked ? (
        <Panel className="border-danger/50">
          <PanelHeader title={m.refusedTitle} hint={m.refusedHint} />
          <ul className="flex flex-col gap-2">
            {preview.refusals.map((r) => (
              <li key={r.code} className="flex items-start gap-2 text-[13.5px] leading-5">
                <XCircle size={15} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
                <span>
                  <code className="mr-2 rounded-sm bg-surface-3 px-1 text-[12px]">{r.code}</code>
                  {r.message}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {preview.warnings.length > 0 ? (
        <Panel className="border-warn/40">
          <PanelHeader title={m.warningsTitle} />
          <ul className="flex flex-col gap-2">
            {preview.warnings.map((w) => (
              <li key={w.code} className="flex items-start gap-2 text-[13.5px] leading-5">
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" aria-hidden="true" />
                <span>{w.message}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <div className="grid gap-3.5 xl:grid-cols-[1fr_minmax(320px,420px)]">
        <MovesPanel preview={preview} />
        <div className="flex flex-col gap-3.5">
          <UrlPanel preview={preview} />
          <Panel>
            <PanelHeader title={m.auditTitle} />
            <p className="flex items-start gap-2 text-[13px] leading-[18px] text-fg-muted">
              <ScrollText size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              {m.auditHint}
            </p>
          </Panel>
        </div>
      </div>

      {preview.chapterOverlaps.length > 0 ? (
        <ChaptersPanel overlaps={preview.chapterOverlaps} />
      ) : null}

      <MergeConfirm
        winnerId={preview.winner.id}
        loserId={preview.loser.id}
        loserSlug={preview.loser.slug}
        winnerSlug={preview.winner.slug}
        blocked={blocked}
      />
    </>
  )
}

function SidePanel({ side, kind }: { side: SeriesBrief; kind: 'winner' | 'loser' }) {
  const winner = kind === 'winner'
  return (
    <Panel className={cn(winner ? 'border-ok/40' : 'border-line')}>
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            'text-[12px] font-semibold uppercase leading-4 tracking-[0.06em]',
            winner ? 'text-ok' : 'text-fg-muted',
          )}
        >
          {winner ? m.winner : m.loser}
        </span>
        <PubStatePill state={side.state} />
      </div>
      <div className="mt-2 flex gap-3">
        <img
          src={coverSrc(side.coverKey, side.coverColor)}
          width={44}
          height={66}
          alt=""
          className="h-[66px] w-11 shrink-0 rounded-sm object-cover"
        />
        <div className="min-w-0">
          <a
            href={`/admin/series/${side.id}`}
            className="block truncate font-body text-[16px] font-bold hover:text-brand-hover"
          >
            {side.title}
          </a>
          <div className="truncate text-[12.5px] text-fg-subtle">/{side.slug}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Pill>{side.type}</Pill>
          </div>
          <div className="mt-1 text-[12.5px] text-fg-muted tabular-nums">
            <Num>{side.chapterCount}</Num> ch · <Num>{compactNumber(side.bookmarkCount)}</Num>{' '}
            bookmarks · <Num>{compactNumber(side.viewCount)}</Num> views
          </div>
        </div>
      </div>
      <Hint className="mt-2 text-[12.5px]">{winner ? m.winnerHint : m.loserHint}</Hint>
    </Panel>
  )
}

function MovesPanel({ preview }: { preview: MergePreview }) {
  const rows = preview.moves.filter((r) => r.move + r.merge > 0)
  return (
    <Panel className="p-0 md:px-0">
      <div className="px-5 pt-4">
        <PanelHeader
          title={m.movesTitle}
          hint={m.movesHint}
          aside={
            <span className="tabular-nums">
              {fmt(m.totals, { move: preview.totals.move, merge: preview.totals.merge })}
            </span>
          }
        />
      </div>
      <Table className="rounded-none border-0 border-t">
        <thead>
          <tr>
            <Th>{m.colTable}</Th>
            <Th align="right">{m.colMove}</Th>
            <Th align="right">{m.colMerge}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <EmptyRow colSpan={3}>{m.movesEmpty}</EmptyRow> : null}
          {rows.map((r) => (
            <tr key={r.key}>
              <Td>
                {m.tables[r.key as keyof typeof m.tables] ?? r.key}
                <span className="ml-2 font-mono text-[11.5px] text-fg-subtle">{r.key}</span>
              </Td>
              <Td align="right">
                <Num className={r.move > 0 ? 'font-semibold' : 'text-fg-subtle'}>{r.move}</Num>
              </Td>
              <Td align="right">
                <Num className={r.merge > 0 ? 'text-warn' : 'text-fg-subtle'}>{r.merge}</Num>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Hint className="px-5 py-3 text-[12.5px]">{m.conflictNote}</Hint>
    </Panel>
  )
}

function UrlPanel({ preview }: { preview: MergePreview }) {
  const lines = [
    fmt(m.urlRedirect, { from: preview.redirect.fromPath, to: preview.redirect.toPath }),
    fmt(m.urlHistory, { from: preview.redirect.fromPath }),
    fmt(m.urlTombstone, { slug: `/series/${preview.tombstoneSlug}` }),
    m.urlCache,
  ]
  return (
    <Panel>
      <PanelHeader title={m.urlTitle} />
      <ul className="flex flex-col gap-1.5">
        {lines.map((line) => (
          <li
            key={line}
            className="flex items-start gap-2 text-[13px] leading-[18px] text-fg-muted"
          >
            <Link2 size={14} className="mt-0.5 shrink-0 text-fg-subtle" aria-hidden="true" />
            {line}
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function ChaptersPanel({ overlaps }: { overlaps: ChapterOverlap[] }) {
  return (
    <Panel className="p-0 md:px-0">
      <div className="px-5 pt-4">
        <PanelHeader title={m.chaptersTitle} />
      </div>
      <Table className="rounded-none border-0 border-t">
        <thead>
          <tr>
            <Th>{m.colNumber}</Th>
            <Th align="right">{m.colWinnerPages}</Th>
            <Th align="right">{m.colLoserPages}</Th>
            <Th>{m.colVerdict}</Th>
          </tr>
        </thead>
        <tbody>
          {overlaps.map((o) => (
            <tr key={o.number}>
              <Td className="font-semibold">Ch. {formatChapterNumber(o.number)}</Td>
              <Td align="right">
                <Num>{o.winnerPages}</Num>
              </Td>
              <Td align="right">
                <Num>{o.loserPages}</Num>
              </Td>
              <Td>
                <span
                  className={cn(
                    'flex items-center gap-1.5 text-[12.5px]',
                    o.identical ? 'text-fg-muted' : 'text-danger',
                  )}
                >
                  {o.identical ? (
                    <Info size={13} aria-hidden="true" />
                  ) : (
                    <XCircle size={13} aria-hidden="true" />
                  )}
                  {o.identical ? m.chaptersIdentical : m.chaptersDiffer}
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Panel>
  )
}
