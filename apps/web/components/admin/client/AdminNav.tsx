'use client'

import { cn } from '@palscans/ui'
import {
  BadgeDollarSign,
  Cpu,
  Files,
  Flag,
  Gauge,
  LayoutTemplate,
  Library,
  ListChecks,
  MessageSquare,
  Palette,
  ScrollText,
  Search,
  Settings,
  ToggleLeft,
  Upload,
  Users,
} from 'lucide-react'
import { usePathname } from 'next/navigation'
import type { ComponentType } from 'react'
import { type AdminIcon, type AdminNavGroup, breadcrumbFor, isNavActive } from '../nav-shared'

const icons: Record<AdminIcon, ComponentType<{ size?: number; className?: string }>> = {
  gauge: Gauge,
  library: Library,
  'file-stack': Files,
  upload: Upload,
  'list-checks': ListChecks,
  'message-square': MessageSquare,
  flag: Flag,
  users: Users,
  'badge-dollar': BadgeDollarSign,
  layout: LayoutTemplate,
  palette: Palette,
  settings: Settings,
  toggle: ToggleLeft,
  cpu: Cpu,
  scroll: ScrollText,
  search: Search,
}

export function AdminNavLinks({ groups }: { groups: AdminNavGroup[] }) {
  const pathname = usePathname()
  return (
    <nav className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-3 pt-3 pb-2">
      {groups.map((g) => (
        <div key={g.label} className="flex flex-col gap-0.5">
          <div className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase leading-[14px] tracking-[0.08em] text-fg-subtle">
            {g.label}
          </div>
          {g.items.map((item) => {
            const Icon = icons[item.icon]
            const active = isNavActive(pathname, item)
            return (
              <a
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-[34px] items-center gap-2.5 rounded-md px-2.5 text-[13.5px] font-medium transition-colors',
                  active
                    ? 'bg-brand-wash font-semibold text-fg shadow-[inset_2px_0_0_var(--color-brand-hover)]'
                    : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
                )}
              >
                <Icon size={16} className="shrink-0" />
                {item.label}
              </a>
            )
          })}
        </div>
      ))}
    </nav>
  )
}

export function Breadcrumb() {
  const pathname = usePathname()
  const { group, page } = breadcrumbFor(pathname)
  return (
    <div className="flex items-center gap-2 text-[14px] leading-[18px]">
      <span className="font-medium text-fg-muted">{group}</span>
      <span className="text-fg-subtle">/</span>
      <span className="font-semibold text-fg">{page}</span>
    </div>
  )
}
