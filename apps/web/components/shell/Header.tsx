import { messages } from '@palscans/core/messages'
import { buttonClasses } from '@palscans/ui'
import { Bell, Search, Zap } from 'lucide-react'
import Link from 'next/link'
import { NavLinks } from './NavLinks'
import { Wordmark } from './Wordmark'

const iconButton =
  'relative inline-flex size-[38px] shrink-0 items-center justify-center rounded-[10px] border border-line bg-surface-1 text-fg-muted transition-colors duration-[120ms] hover:bg-surface-2 hover:text-fg'

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur-[14px]">
      <div className="container-page flex h-16 items-center gap-3 md:gap-5">
        <Wordmark />
        <nav aria-label={messages.nav.primary} className="hidden md:block">
          <NavLinks />
        </nav>

        <form
          action="/search"
          method="get"
          className="min-w-0 flex-1 ml-auto hidden w-full max-w-[340px] items-center gap-2 rounded-[10px] border border-line bg-surface-1 pl-3 pr-2 text-fg-muted focus-within:border-brand md:flex"
        >
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            name="q"
            placeholder={messages.nav.searchPlaceholder}
            aria-label={messages.nav.search}
            autoComplete="off"
            className="h-[38px] min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted"
          />
          <kbd className="hidden lg:inline rounded-[5px] border border-line bg-surface-2 px-1.5 py-[3px] font-body text-[11px] font-semibold leading-none text-fg-muted">
            {messages.nav.searchHint}
          </kbd>
        </form>

        <div className="ml-auto flex items-center gap-2 md:ml-0 md:gap-3">
          <Link
            href="/search"
            aria-label={messages.nav.search}
            className={`${iconButton} md:hidden`}
          >
            <Search size={18} />
          </Link>
          <Link
            href="/me/settings#notifications"
            aria-label={messages.nav.notifications}
            className={iconButton}
          >
            <Bell size={18} />
            <span
              aria-hidden="true"
              className="absolute right-[9px] top-2 size-2 rounded-full border-2 border-surface-1 bg-type-manhwa"
            />
          </Link>
          <Link href="/subscribe" className={buttonClasses('primary', 'md', 'rounded-[10px]')}>
            <Zap size={16} aria-hidden="true" />
            {messages.nav.premium}
          </Link>
          <Link
            href="/login"
            aria-label={messages.nav.account}
            className="hidden size-[38px] shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-[13px] font-bold text-fg-muted transition-colors hover:text-fg sm:inline-flex"
          >
            R
          </Link>
        </div>
      </div>
    </header>
  )
}
