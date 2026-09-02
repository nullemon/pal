import { fmt, messages } from '@palscans/core/messages'
import { ArrowRight } from 'lucide-react'

export interface NovelCardProps {
  title: string
  slug: string
  author: string | null
  className?: string
}

/** "Read the novel" cross-sell when `linked_series_id` points at a novel (docs/06). */
export function NovelCard({ title: rawTitle, slug, author, className }: NovelCardProps) {
  const title = rawTitle.replace(/\s*\((?:novel|light novel|web novel)\)\s*$/i, '')
  return (
    <div className={className}>
      <div className="flex min-w-0 flex-col items-start gap-5 rounded-[16px] border border-line bg-[linear-gradient(135deg,var(--color-brand-wash),transparent)] bg-surface-1 p-5 transition-colors hover:border-brand-dim sm:flex-row sm:items-center sm:gap-6 sm:p-6">
        <div className="flex h-[178px] w-[124px] shrink-0 flex-col justify-between rounded-[6px_12px_12px_6px] border border-fg/8 bg-linear-to-br from-brand-dim to-surface-2 px-3.5 py-4 shadow-2 [box-shadow:inset_3px_0_0_rgb(255_255_255/0.06)]">
          <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-brand-hover">
            {messages.seriesDetail.novelLabel}
          </span>
          <span className="font-display text-[15px] font-bold leading-[19px] tracking-[-0.01em]">
            {title}
          </span>
          <span className="text-[10px] text-fg-muted">{author ?? ''}</span>
        </div>
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-brand-hover">
            {messages.seriesDetail.alsoOn}
          </div>
          <div className="mt-1.5 font-display text-[22px] font-bold leading-7 tracking-[-0.01em]">
            {messages.series.readTheNovel}
          </div>
          <p className="m-0 mt-2 text-sm leading-[22px] text-fg-muted">
            {fmt(messages.seriesDetail.novelBlurb, { title, author: author ?? messages.site.name })}
          </p>
          <a
            href={`/series/${slug}`}
            className="mt-4 inline-flex h-10 items-center gap-2 rounded-[10px] bg-brand px-[18px] text-sm font-bold text-brand-ink hover:bg-brand-hover"
          >
            {messages.seriesDetail.startReading}
            <ArrowRight size={16} aria-hidden="true" />
          </a>
        </div>
      </div>
    </div>
  )
}
