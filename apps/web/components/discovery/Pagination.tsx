import { fmt, messages } from '@palscans/core/messages'
import { cn } from '@palscans/ui'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'

export interface PaginationProps {
  page: number
  totalPages: number
  /** URL for a page number — real `?page=` links (docs/06, docs/12 §10). */
  href: (page: number) => string
  className?: string
}

const box =
  'inline-flex size-9 items-center justify-center rounded-md text-sm font-semibold transition-colors duration-[120ms]'
const quiet = 'border border-line bg-surface-1 text-fg-muted hover:bg-surface-2 hover:text-fg'

/** Numbered pagination: prev · up to five numbers around the current page · next. */
export function Pagination({ page, totalPages, href, className }: PaginationProps) {
  if (totalPages <= 1) return null
  const start = Math.max(1, Math.min(page - 2, totalPages - 4))
  const end = Math.min(totalPages, start + 4)
  const numbers: number[] = []
  for (let n = start; n <= end; n++) numbers.push(n)
  return (
    <nav
      aria-label={messages.discovery.pagination}
      className={cn('flex h-9 items-center justify-center gap-1.5', className)}
    >
      {page > 1 ? (
        <Link
          href={href(page - 1)}
          rel="prev"
          aria-label={messages.discovery.prevPage}
          className={cn(box, quiet)}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </Link>
      ) : (
        <span aria-hidden="true" className={cn(box, quiet, 'opacity-40')}>
          <ChevronLeft size={16} />
        </span>
      )}
      {numbers.map((n) =>
        n === page ? (
          <span key={n} aria-current="page" className={cn(box, 'bg-brand text-brand-ink')}>
            {n}
          </span>
        ) : (
          <Link
            key={n}
            href={href(n)}
            aria-label={fmt(messages.home.page, { n })}
            className={cn(box, quiet)}
          >
            {n}
          </Link>
        ),
      )}
      {page < totalPages ? (
        <Link
          href={href(page + 1)}
          rel="next"
          aria-label={messages.discovery.nextPage}
          className={cn(box, quiet)}
        >
          <ChevronRight size={16} aria-hidden="true" />
        </Link>
      ) : (
        <span aria-hidden="true" className={cn(box, quiet, 'opacity-40')}>
          <ChevronRight size={16} />
        </span>
      )}
    </nav>
  )
}
