'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { headerNav, isActive } from '@/lib/site'

export function NavLinks() {
  const pathname = usePathname()
  return (
    <ul className="flex items-center gap-0.5">
      {headerNav.map((link) => {
        const active = isActive(pathname, link)
        return (
          <li key={link.href}>
            <Link
              href={link.href}
              aria-current={active ? 'page' : undefined}
              className={
                active
                  ? 'block rounded-md bg-surface-2 px-3 py-2 text-sm font-bold text-fg'
                  : 'block rounded-md px-3 py-2 text-sm font-medium text-fg-muted transition-colors duration-[120ms] hover:bg-surface-2 hover:text-fg'
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
