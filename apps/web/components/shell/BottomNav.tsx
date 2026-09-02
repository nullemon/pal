'use client'

import { Compass, House, Library, UserRound } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type BottomNavIcon, bottomNav, isActive } from '@/lib/site'

const icons: Record<BottomNavIcon, typeof House> = {
  home: House,
  browse: Compass,
  library: Library,
  profile: UserRound,
}

/** Mobile tab bar, hidden at md and above. The reader hides it with its own layout. */
export function BottomNav() {
  const pathname = usePathname()
  return (
    <nav
      aria-label="Primary, mobile"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface-2/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-[14px] md:hidden"
    >
      <ul className="grid h-16 grid-cols-4">
        {bottomNav.map((item) => {
          const Icon = icons[item.icon]
          const active = isActive(pathname, item)
          return (
            <li key={item.href} className="min-w-0">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex h-full min-h-11 flex-col items-center justify-center gap-1 text-[11px] font-semibold ${
                  active ? 'text-brand-hover' : 'text-fg-muted'
                }`}
              >
                <Icon size={22} strokeWidth={active ? 2.4 : 2} aria-hidden="true" />
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
