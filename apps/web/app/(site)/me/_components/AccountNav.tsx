'use client'

import { messages } from '@palscans/core/messages'
import { cn } from '@palscans/ui'
import {
  BarChart3,
  Bell,
  Bookmark,
  CreditCard,
  Download,
  History,
  ListOrdered,
  Settings,
  ShieldCheck,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const items = [
  { href: '/me/bookmarks', label: messages.me.nav.bookmarks, icon: Bookmark },
  { href: '/me/lists', label: messages.me.nav.lists, icon: ListOrdered },
  { href: '/me/history', label: messages.me.nav.history, icon: History },
  { href: '/me/stats', label: messages.me.nav.stats, icon: BarChart3 },
  { href: '/me/notifications', label: messages.me.nav.notifications, icon: Bell },
  { href: '/me/downloads', label: messages.me.nav.downloads, icon: Download },
  { href: '/me/settings', label: messages.me.nav.settings, icon: Settings },
  { href: '/me/security', label: messages.me.nav.security, icon: ShieldCheck },
  { href: '/me/billing', label: messages.me.nav.billing, icon: CreditCard },
] as const

export function AccountNav() {
  const pathname = usePathname()
  return (
    <nav
      aria-label={messages.me.title}
      className="-mx-1 flex gap-1 overflow-x-auto px-1 lg:flex-col"
    >
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`)
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex h-10 shrink-0 items-center gap-2.5 rounded-md px-3 text-sm font-semibold transition-colors',
              active ? 'bg-brand-wash text-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
            )}
          >
            <Icon size={16} aria-hidden="true" className={active ? 'text-brand-hover' : ''} />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
