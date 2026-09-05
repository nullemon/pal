'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { isActive, type NavLink } from '@/lib/site'

/**
 * The header's link row. Client only because the active link depends on the pathname; the
 * links themselves arrive as props from the server, which is what keeps the resolved chrome
 * (and the zod schemas behind it) out of the reader's bundle — docs/20.
 */
export function NavLinks({
  links,
  className = 'flex items-center gap-0.5',
}: {
  links: readonly NavLink[]
  className?: string
}) {
  const pathname = usePathname()
  return (
    <ul className={className}>
      {links.map((link) => {
        const active = isActive(pathname, link)
        return (
          <li key={`${link.href}:${link.label}`}>
            <Link
              href={link.href}
              aria-current={active ? 'page' : undefined}
              className={
                active
                  ? 'block whitespace-nowrap rounded-md bg-surface-2 px-3 py-2 text-sm font-bold text-fg'
                  : 'block whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-fg-muted transition-colors duration-[120ms] hover:bg-surface-2 hover:text-fg'
              }
            >
              {link.label}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
