import { ChevronDown } from 'lucide-react'
import Link from 'next/link'
import type { FooterColumn as FooterColumnConfig } from '@/lib/site'

const heading = 'text-[11px] font-extrabold uppercase tracking-[0.12em] text-fg-muted'

function Links({ column }: { column: FooterColumnConfig }) {
  return (
    <ul className="flex flex-col gap-1 text-[13px]">
      {column.links.map((link) => (
        <li key={link.label}>
          <Link
            href={link.href}
            className="inline-flex min-h-8 items-center text-fg-muted transition-colors duration-[120ms] hover:text-fg md:min-h-0"
          >
            {link.label}
          </Link>
        </li>
      ))}
    </ul>
  )
}

/**
 * One footer link column (docs/11): a plain heading + list from `md` up, a native
 * `<details>` accordion below it. Both are static markup — no client JS — so the footer
 * still caches with the shell; the inactive variant is `display: none` and out of the
 * accessibility tree.
 */
export function FooterColumn({ column }: { column: FooterColumnConfig }) {
  return (
    <div>
      <details className="group border-b border-line-soft py-2 md:hidden">
        <summary
          className={`flex min-h-10 cursor-pointer list-none items-center justify-between ${heading} [&::-webkit-details-marker]:hidden`}
        >
          {column.title}
          <ChevronDown
            size={16}
            aria-hidden="true"
            className="transition-transform duration-[120ms] group-open:rotate-180"
          />
        </summary>
        <div className="pb-2">
          <Links column={column} />
        </div>
      </details>
      <div className="hidden md:block">
        <h3 className={`mb-2 ${heading}`}>{column.title}</h3>
        <Links column={column} />
      </div>
    </div>
  )
}
