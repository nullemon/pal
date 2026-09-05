'use client'

import { messages } from '@palscans/core/messages'
import { Clock, Compass, House, Library, Search, Tags, Trophy, UserRound } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type BottomNavId, type BottomNavItem, isActive } from '@/lib/site'

/**
 * The icon for each id in the bottom-nav vocabulary (`BOTTOM_NAV_IDS`).
 *
 * This map is why the vocabulary is a closed list rather than free-form links: every entry
 * here ships in the reader's bundle whether or not the operator uses it, and `lucide-react`
 * arrives as individual modules of a few hundred bytes each (docs/20). Eight ids is a couple
 * of kilobytes; a picker over the whole icon set would not be.
 */
const icons: Record<BottomNavId, typeof House> = {
  home: House,
  browse: Compass,
  rankings: Trophy,
  genres: Tags,
  bookmarks: Library,
  history: Clock,
  profile: UserRound,
  search: Search,
}

/** Mobile tab bar, hidden at md and above. The reader hides it with its own layout. */
export function BottomNavBar({ items }: { items: readonly BottomNavItem[] }) {
  const pathname = usePathname()
  if (items.length === 0) return null
  return (
    <nav
      aria-label={messages.nav.primaryMobile}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface-2/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-[14px] md:hidden"
    >
      <ul
        className="grid h-16"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {items.map((item) => {
          const Icon = icons[item.id]
          const active = isActive(pathname, item)
          return (
            <li key={item.id} className="min-w-0">
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
