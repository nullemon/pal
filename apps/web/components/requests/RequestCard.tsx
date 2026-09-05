'use client'

import { fmt, messages } from '@palscans/core/messages'
import { cn, RelativeTime } from '@palscans/ui'
import { BookOpen, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import type { RequestItem, RequestStatusValue } from './shared'
import { VoteButton } from './VoteButton'

const m = messages.requests

const statusClasses: Record<RequestStatusValue, string> = {
  open: 'bg-surface-3 text-fg-muted',
  planned: 'bg-gold/15 text-gold',
  added: 'bg-ok/15 text-ok',
  declined: 'bg-surface-3 text-fg-subtle',
  exists: 'bg-brand-wash text-brand-hover',
}

export function StatusPill({ status }: { status: RequestStatusValue }) {
  return (
    <span
      className={cn(
        'inline-flex h-[18px] shrink-0 items-center whitespace-nowrap rounded-full px-1.5 text-[10px] font-bold uppercase leading-none tracking-[0.08em]',
        statusClasses[status],
      )}
    >
      {m.statuses[status]}
    </span>
  )
}

export interface RequestCardProps {
  item: RequestItem
  onChange?: (next: RequestItem) => void
  compact?: boolean
}

/**
 * One row of the board — the same component in the modal's "already requested" list and on
 * `/requests`, so an upvote looks and behaves identically wherever a reader meets it.
 *
 * A fulfilled row is the point of the whole feature: it links to the series. Somebody who
 * asked for a title six weeks ago and finds it here, added, with a link, is somebody who
 * comes back and asks for the next one.
 */
export function RequestCard({ item, onChange, compact = false }: RequestCardProps) {
  return (
    <li
      className={cn(
        'flex items-start gap-3 rounded-lg border border-line bg-surface-1',
        compact ? 'p-2.5' : 'p-3',
      )}
    >
      <VoteButton
        id={item.id}
        title={item.title}
        voteCount={item.voteCount}
        voted={item.voted}
        size={compact ? 'sm' : 'md'}
        onChange={(next) => onChange?.({ ...item, ...next })}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={cn(
              'min-w-0 break-words font-display font-extrabold text-fg',
              compact ? 'text-[14px]' : 'text-[15px]',
            )}
          >
            {item.title}
          </span>
          <StatusPill status={item.status} />
          {item.type ? (
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-subtle">
              {item.type}
            </span>
          ) : null}
        </div>

        {item.altTitles.length > 0 && !compact ? (
          <p className="mt-0.5 line-clamp-1 text-[12px] text-fg-subtle">
            {fmt(m.alsoKnownAs, { titles: item.altTitles.join(' · ') })}
          </p>
        ) : null}

        {item.status === 'declined' && item.declineReason ? (
          <p className="mt-1 text-[12.5px] leading-5 text-fg-muted">
            {fmt(m.declinedBecause, { reason: item.declineReason })}
          </p>
        ) : null}

        {!compact && item.note ? (
          <p className="mt-1 line-clamp-2 text-[12.5px] leading-5 text-fg-muted">{item.note}</p>
        ) : null}

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-subtle">
          <span>
            {m.asked} <RelativeTime iso={item.createdAt} />
          </span>
          <span>{item.voteCount === 1 ? m.voteOne : fmt(m.votes, { n: item.voteCount })}</span>
          {item.link && !compact ? (
            <a
              href={item.link}
              target="_blank"
              rel="noreferrer nofollow ugc"
              className="inline-flex items-center gap-1 hover:text-fg-muted"
            >
              <ExternalLink size={11} aria-hidden="true" />
              {m.sourceLink}
            </a>
          ) : null}
        </div>
      </div>

      {item.seriesHref ? (
        <Link
          href={item.seriesHref}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 self-center rounded-md border border-line bg-surface-2 px-3 text-[13px] font-semibold text-fg hover:border-brand"
        >
          <BookOpen size={14} aria-hidden="true" />
          {m.readIt}
        </Link>
      ) : null}
    </li>
  )
}
