import { compactNumber } from '@palscans/core'
import { fmt } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import {
  DEFAULT_MIN_SCORE,
  type DuplicateCandidate,
  type DuplicateSide,
  findDuplicateSeries,
  getDb,
  type MatchReason,
  series,
} from '@palscans/db'
import { cn } from '@palscans/ui'
import { count, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { parseSearch, type SearchParams } from '@/components/admin/server/params'
import {
  Hint,
  inputClass,
  Num,
  PageHeader,
  Panel,
  PanelHeader,
  Pill,
  PubStatePill,
} from '@/components/admin/ui'
import { coverSrc } from '@/components/discovery/media'
import { withPermission } from '@/lib/auth'

/**
 * `Admin → Content → Duplicates` (docs/09 legacy import).
 *
 * Permission: **`series.read`** — this screen only reads and ranks. The merge it links to
 * needs `series.delete`, which is admin-only, because a merge retires a row and rewrites
 * every reader association that pointed at it.
 *
 * The screen never says "these are duplicates". It shows the evidence with the weight each
 * piece carried, and the one fact that decides whether a merge is even possible: whether a
 * chapter number is used on both sides.
 */

const schema = z.object({
  min: z.coerce.number().int().min(1).max(100).catch(DEFAULT_MIN_SCORE),
})

const m = adminMessages.duplicates

export default async function DuplicatesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  await withPermission('series.read', { returnTo: '/admin/series/duplicates' })
  const p = parseSearch(schema, await searchParams)
  const db = await getDb()
  const [candidates, [live]] = await Promise.all([
    findDuplicateSeries(db, { minScore: p.min, limit: 50 }),
    db.select({ n: count() }).from(series).where(isNull(series.deletedAt)),
  ])

  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <form
        method="get"
        action="/admin/series/duplicates"
        className="flex flex-wrap items-center gap-2"
      >
        <label htmlFor="min" className="text-[12px] font-medium text-fg-muted">
          {m.threshold}
        </label>
        <input
          id="min"
          name="min"
          type="number"
          min={1}
          max={100}
          defaultValue={p.min}
          className={`${inputClass} w-24`}
        />
        <button
          type="submit"
          className="h-9 rounded-md border border-line bg-surface-1 px-3 text-[13px] font-semibold hover:bg-surface-2"
        >
          {m.apply}
        </button>
        <Hint className="text-[12.5px]">{m.thresholdHint}</Hint>
      </form>

      <Hint>
        {fmt(candidates.length === 1 ? m.scannedOne : m.scanned, {
          n: candidates.length,
          min: p.min,
          series: live?.n ?? 0,
        })}
      </Hint>

      {candidates.length === 0 ? (
        <Panel>
          <div className="font-body text-[15px] font-bold">{m.empty}</div>
          <Hint className="mt-1">{m.emptyHint}</Hint>
        </Panel>
      ) : null}

      {candidates.map((c) => (
        <CandidatePanel key={`${c.a.id}-${c.b.id}`} candidate={c} />
      ))}
    </>
  )
}

function CandidatePanel({ candidate }: { candidate: DuplicateCandidate }) {
  const { a, b, score, reasons, overlappingChapters } = candidate
  return (
    <Panel>
      <PanelHeader
        title={a.title === b.title ? a.title : `${a.title} · ${b.title}`}
        hint={`/${a.slug} ↔ /${b.slug} · ${
          overlappingChapters.length === 0
            ? m.noOverlap
            : overlappingChapters.length === 1
              ? fmt(m.overlapOne, { n: overlappingChapters[0] ?? 0 })
              : fmt(m.overlap, { n: overlappingChapters.length })
        }`}
        aside={
          <span className="flex items-center gap-2">
            <span className="text-[12px] uppercase tracking-[0.06em]">{m.score}</span>
            <span
              className={cn(
                'font-body text-[20px] font-bold leading-6 tabular-nums',
                score >= 75 ? 'text-danger' : score >= 55 ? 'text-warn' : 'text-fg',
              )}
            >
              {score}
            </span>
          </span>
        }
      />
      <div className="grid items-start gap-3.5 lg:grid-cols-[1fr_1fr_minmax(260px,320px)]">
        <SideCard side={a} />
        <SideCard side={b} />
        <div>
          <div className="mb-1.5 text-[12px] font-semibold uppercase leading-4 tracking-[0.06em] text-fg-muted">
            {m.whyTitle}
          </div>
          <ul className="flex flex-col gap-1.5">
            {reasons.map((r) => (
              <ReasonRow key={`${r.kind}-${r.detail}`} reason={r} />
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={`/admin/series/merge?winner=${a.id}&loser=${b.id}`}
              className="inline-flex h-8 items-center rounded-[9px] bg-brand px-3 text-[13px] font-bold text-brand-ink hover:bg-brand-hover"
            >
              {m.reviewMerge}
            </a>
            <a
              href={`/admin/series/merge?winner=${b.id}&loser=${a.id}`}
              className="inline-flex h-8 items-center rounded-md border border-line px-3 text-[13px] font-semibold hover:bg-surface-2"
            >
              {m.reviewMergeSwapped}
            </a>
          </div>
        </div>
      </div>
    </Panel>
  )
}

function ReasonRow({ reason }: { reason: MatchReason }) {
  const positive = reason.points >= 0
  return (
    <li className="flex items-start gap-2 text-[12.5px] leading-[17px]">
      <span
        className={cn(
          'mt-px w-9 shrink-0 text-right font-semibold tabular-nums',
          positive ? 'text-ok' : 'text-danger',
        )}
      >
        {positive ? '+' : ''}
        {reason.points}
      </span>
      <span className="min-w-0">
        <span className="font-semibold">{m.reasons[reason.kind]}</span>
        <span className="block text-fg-muted">{reason.detail}</span>
      </span>
    </li>
  )
}

function SideCard({ side }: { side: DuplicateSide }) {
  return (
    <div className="flex gap-3 rounded-lg border border-line-soft bg-surface-2/50 p-3">
      <img
        src={coverSrc(side.coverKey, side.coverColor)}
        width={44}
        height={66}
        alt=""
        loading="lazy"
        className="h-[66px] w-11 shrink-0 rounded-sm object-cover"
      />
      <div className="min-w-0 flex-1">
        <a
          href={`/admin/series/${side.id}`}
          className="block truncate font-semibold hover:text-brand-hover"
        >
          {side.title}
        </a>
        <div className="truncate text-[12px] text-fg-subtle">/{side.slug}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Pill>{side.type}</Pill>
          <PubStatePill state={side.state} />
        </div>
        <div className="mt-1 text-[12px] text-fg-muted tabular-nums">
          <Num>{fmt(m.chapters, { n: side.chapterCount })}</Num> ·{' '}
          <Num>{fmt(m.bookmarks, { n: compactNumber(side.bookmarkCount) })}</Num>
        </div>
        <div className="mt-1 truncate text-[12px] text-fg-subtle">
          {m.altTitles}: {side.altTitles.length > 0 ? side.altTitles.join(', ') : m.noAltTitles}
        </div>
      </div>
    </div>
  )
}
