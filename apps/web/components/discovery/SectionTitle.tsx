import { cn } from '@palscans/ui'
import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

export interface SectionTitleProps {
  id: string
  title: string
  icon?: ReactNode
  /** Right-hand link, e.g. "Rankings ›". */
  link?: { href: string; label: string }
  /** Anything else on the right (tabs). */
  children?: ReactNode
  as?: 'h1' | 'h2'
  className?: string
}

/** The mockup's section header: uppercase Archivo title with a violet icon, action on the right. */
export function SectionTitle({
  id,
  title,
  icon,
  link,
  children,
  as: Tag = 'h2',
  className,
}: SectionTitleProps) {
  return (
    <div className={cn('flex h-[22px] items-center justify-between gap-3', className)}>
      <Tag id={id} className="section-title flex items-center gap-2 text-[18px] leading-[22px]">
        {icon ? (
          <span className="text-brand-hover" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        {title}
      </Tag>
      {link ? (
        <Link
          href={link.href}
          className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-hover hover:text-fg"
        >
          {link.label}
          <ChevronRight size={14} aria-hidden="true" />
        </Link>
      ) : (
        children
      )}
    </div>
  )
}
