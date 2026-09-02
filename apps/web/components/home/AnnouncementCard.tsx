import { messages } from '@palscans/core/messages'
import { RelativeTime } from '@palscans/ui'
import { Megaphone } from 'lucide-react'
import Link from 'next/link'
import type { AnnouncementSummary } from '@/components/discovery/types'

/** One compact card linking to the full announcement (docs/06) — not a carousel of posts. */
export function AnnouncementCard({ announcement }: { announcement: AnnouncementSummary | null }) {
  if (!announcement) return null
  return (
    <section
      aria-labelledby="announcements-title"
      className="rounded-[10px] border border-line bg-surface-1 px-3 py-2.5"
    >
      <h2
        id="announcements-title"
        className="flex h-4 items-center gap-1.5 font-display text-[12px] font-extrabold uppercase tracking-[0.06em] text-fg"
      >
        <Megaphone size={14} className="text-brand-hover" aria-hidden="true" />
        {messages.home.announcements}
      </h2>
      <p className="mt-1.5 text-[13px] leading-[17px] text-fg-muted">
        <Link href={announcement.href} className="font-semibold text-brand-hover hover:text-fg">
          {announcement.title}
        </Link>
        {announcement.excerpt ? <> — {announcement.excerpt}</> : null}
      </p>
      <p className="mt-1.5 flex items-center justify-between text-[12px] text-fg-subtle">
        {announcement.publishedAt ? <RelativeTime iso={announcement.publishedAt} /> : <span />}
        <Link href="/announcements" className="font-semibold hover:text-fg">
          {messages.home.viewAll}
        </Link>
      </p>
    </section>
  )
}
