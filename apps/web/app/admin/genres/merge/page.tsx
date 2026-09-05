import { fmt } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { adminGenres, type GenreBrief, getDb, previewGenreMerge } from '@palscans/db'
import { cn } from '@palscans/ui'
import { AlertTriangle, ArrowRight, Link2, ScrollText, XCircle } from 'lucide-react'
import { z } from 'zod'
import { parseSearch, type SearchParams } from '@/components/admin/server/params'
import { Hint, Num, PageHeader, Panel, PanelHeader, Pill } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'
import { GenreMergeConfirm } from './GenreMergeConfirm'
import { GenrePicker } from './GenrePicker'

/**
 * `Admin → Content → Genres → Merge`.
 *
 * Permission: **`series.delete`**, matching `/admin/series/merge`. Folding one genre into
 * another retires a row, rewrites every series that carried it and repoints a public URL —
 * the same class of irreversible catalogue change as merging two series.
 *
 * The whole page is the preview, rendered fresh on every load from `previewGenreMerge` — the
 * same function the transaction re-runs under a row lock before it writes. What is on screen
 * is what will happen, or the merge does not happen.
 */

const schema = z.object({
  winner: z.coerce.number().int().positive().optional().catch(undefined),
  loser: z.coerce.number().int().positive().optional().catch(undefined),
})

const m = adminMessages.genreAdmin

export default async function GenreMergePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  await withPermission('series.delete', { returnTo: '/admin/genres/merge' })
  const p = parseSearch(schema, await searchParams)
  const db = await getDb()

  if (!p.winner || !p.loser || p.winner === p.loser) {
    const all = (await adminGenres(db)).filter((g) => g.deletedAt === null)
    return (
      <>
        <PageHeader title={m.mergeTitle} subtitle={m.mergeHint} />
        <Panel>
          <PanelHeader title={m.mergePick} />
          <GenrePicker
            genres={all.map((g) => ({
              id: g.id,
              name: g.name,
              slug: g.slug,
              kind: g.kind,
              seriesCount: g.seriesCount,
            }))}
            loser={p.loser ?? null}
            winner={p.winner ?? null}
            sameGenre={!!p.winner && p.winner === p.loser}
          />
        </Panel>
      </>
    )
  }

  const preview = await previewGenreMerge(db, p.winner, p.loser)
  const blocked = preview.refusals.length > 0

  return (
    <>
      <PageHeader
        title={m.mergeTitle}
        subtitle={fmt(m.mergeReview, { loser: preview.loser.name, winner: preview.winner.name })}
        actions={
          <a
            href={`/admin/genres/merge?winner=${p.loser}&loser=${p.winner}`}
            className="inline-flex h-9 items-center rounded-md border border-line px-3 text-[13px] font-semibold hover:bg-surface-2"
          >
            {m.mergeSwap}
          </a>
        }
      />

      <div className="grid gap-3.5 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
        <Side side={preview.winner} winner />
        <ArrowRight
          size={22}
          aria-hidden="true"
          className="mx-auto hidden shrink-0 rotate-180 text-fg-subtle lg:block"
        />
        <Side side={preview.loser} />
      </div>

      {blocked ? (
        <Panel className="border-danger/50">
          <PanelHeader title={m.mergeRefusedTitle} hint={m.mergeRefusedHint} />
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
          <PanelHeader title={m.mergeWarningsTitle} />
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

      <div className="grid gap-3.5 xl:grid-cols-2">
        <Panel>
          <PanelHeader title={m.mergeMovesTitle} />
          <ul className="flex flex-col gap-1.5 text-[13.5px] leading-5">
            {preview.move + preview.merge === 0 ? (
              <li className="text-fg-muted">
                {fmt(m.mergeNothing, { loser: preview.loser.name })}
              </li>
            ) : null}
            {preview.move > 0 ? (
              <li className="tabular-nums">
                {fmt(m.mergeMove, {
                  n: preview.move,
                  winner: preview.winner.name,
                  loser: preview.loser.name,
                })}
              </li>
            ) : null}
            {preview.merge > 0 ? (
              <li className="tabular-nums text-warn">{fmt(m.mergeFold, { n: preview.merge })}</li>
            ) : null}
          </ul>
        </Panel>
        <div className="flex flex-col gap-3.5">
          <Panel>
            <PanelHeader title={m.mergeUrlTitle} />
            <ul className="flex flex-col gap-1.5">
              {[
                fmt(m.mergeUrlRedirect, {
                  from: preview.redirect.fromPath,
                  to: preview.redirect.toPath,
                }),
                fmt(m.mergeUrlHistory, { from: preview.redirect.fromPath }),
                fmt(m.mergeUrlTombstone, { slug: `/genres/${preview.tombstoneSlug}` }),
                m.mergeUrlCache,
              ].map((line) => (
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
          <Panel>
            <PanelHeader title={m.mergeAuditTitle} />
            <p className="flex items-start gap-2 text-[13px] leading-[18px] text-fg-muted">
              <ScrollText size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              {m.mergeAuditHint}
            </p>
          </Panel>
        </div>
      </div>

      <GenreMergeConfirm
        winnerId={preview.winner.id}
        loserId={preview.loser.id}
        loserSlug={preview.loser.slug}
        winnerName={preview.winner.name}
        blocked={blocked}
      />
    </>
  )
}

function Side({ side, winner }: { side: GenreBrief; winner?: boolean }) {
  return (
    <Panel className={cn(winner ? 'border-ok/40' : 'border-line')}>
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            'text-[12px] font-semibold uppercase leading-4 tracking-[0.06em]',
            winner ? 'text-ok' : 'text-fg-muted',
          )}
        >
          {winner ? m.mergeWinner : m.mergeLoser}
        </span>
        <Pill>{m.kindNames[side.kind as 'genre' | 'theme' | 'format'] ?? side.kind}</Pill>
      </div>
      <div className="mt-2">
        <div className="font-body text-[16px] font-bold">{side.name}</div>
        <div className="truncate font-mono text-[12.5px] text-fg-subtle">/genres/{side.slug}</div>
        <div className="mt-1 text-[12.5px] text-fg-muted tabular-nums">
          <Num>{side.seriesCount}</Num> series tagged
        </div>
      </div>
      <Hint className="mt-2 text-[12.5px]">{winner ? m.mergeWinnerHint : m.mergeLoserHint}</Hint>
    </Panel>
  )
}
