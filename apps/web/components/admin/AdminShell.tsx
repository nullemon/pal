import type { SessionUser } from '@palscans/core'
import { adminMessages } from '@palscans/core/messages/admin'
import { ToastProvider } from '@palscans/ui'
import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { siteChrome } from '@/lib/chrome/load'
import { MONOGRAM_LETTER, MONOGRAM_RADIUS, MONOGRAM_TAIL } from '@/lib/chrome/monogram'
import { AdminNavLinks, Breadcrumb } from './client/AdminNav'
import { ZodJitless } from './client/ZodJitless'
import { navForUser } from './nav'

/**
 * The admin frame from design/mockups/admin: a 240px nav (logo, grouped links, user
 * footer), a 60px top bar with the breadcrumb and an action slot the page fills through
 * <TopBarActions>, and the content column.
 */
export async function AdminShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const groups = navForUser(user)
  const { brand } = await siteChrome()
  const initial = (user.username ?? user.email ?? '?').slice(0, 1).toUpperCase()
  return (
    <ToastProvider>
      {/* Renders nothing: it is here so the panel's chunk turns zod's JIT off before any
          schema is built under a CSP without 'unsafe-eval'. See ZodJitless. */}
      <ZodJitless />
      <div className="flex min-h-dvh bg-bg-deep text-fg">
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-bg/95 md:flex">
          <div className="flex h-[60px] shrink-0 items-center gap-2.5 border-b border-line px-4">
            {/* The site's mark on the panel's lighter tile — geometry shared with the
                header and the share card, colours its own. */}
            <svg width="28" height="28" viewBox="0 0 512 512" aria-hidden="true">
              <rect width="512" height="512" rx={MONOGRAM_RADIUS} className="fill-brand-hover" />
              <path d={MONOGRAM_LETTER} fillRule="evenodd" className="fill-brand-ink" />
              <path d={MONOGRAM_TAIL} className="fill-gold" />
            </svg>
            <div className="text-[17px] leading-5 tracking-[-0.01em]">
              <span className="font-extrabold">PAL</span>
              <span className="font-normal">Scans</span>
            </div>
            <span className="ml-auto rounded-full border border-line px-[7px] py-[3px] text-[10px] font-bold uppercase leading-3 tracking-[0.08em] text-fg-muted">
              {adminMessages.admin.badge}
            </span>
          </div>
          <AdminNavLinks groups={groups} />
          <div className="flex shrink-0 items-center gap-2.5 border-t border-line px-3.5 py-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--color-brand-hover),var(--color-gold))] text-[12px] font-bold text-white">
              {initial}
            </div>
            <div className="flex min-w-0 flex-col gap-px">
              <div className="truncate text-[13px] font-semibold leading-[17px]">
                {user.username ?? user.email}
              </div>
              <div className="flex items-center gap-1.5 text-[12px] leading-4 text-fg-muted">
                <span className="size-1.5 rounded-full bg-brand-hover" aria-hidden="true" />
                {adminMessages.admin.footerStatus.replace('{site}', brand.name.toLowerCase())}
              </div>
            </div>
            <a
              href="/"
              className="ml-auto inline-flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg"
              title={adminMessages.admin.nav.backToSite}
              aria-label={adminMessages.admin.nav.backToSite}
            >
              <ArrowLeft size={14} />
            </a>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-[60px] shrink-0 items-center gap-3 border-b border-line bg-bg/95 px-4 backdrop-blur md:px-7">
            <a href="/admin" className="shrink-0 text-[13px] font-semibold text-fg-muted md:hidden">
              {adminMessages.admin.badge}
            </a>
            <Breadcrumb />
            <div id="admin-topbar-actions" className="ml-auto flex shrink-0 items-center gap-2.5" />
          </header>
          <main className="flex flex-1 flex-col gap-3.5 px-4 pt-5 pb-7 md:px-7">{children}</main>
        </div>
      </div>
    </ToastProvider>
  )
}
