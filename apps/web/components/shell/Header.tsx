import { messages } from '@palscans/core/messages'
import { buttonClasses } from '@palscans/ui'
import { Bell, Search, Shuffle, Zap } from 'lucide-react'
import Link from 'next/link'
import { RequestTrigger } from '@/components/requests/RequestTrigger'
import { siteChrome } from '@/lib/chrome/load'
import { randomLink } from '@/lib/site'
import { AccountButton } from './AccountButton'
import { NavLinks } from './NavLinks'
import { Wordmark } from './Wordmark'

const iconButton =
  'relative inline-flex size-[38px] shrink-0 items-center justify-center rounded-[10px] border border-line bg-surface-1 text-fg-muted transition-colors duration-[120ms] hover:bg-surface-2 hover:text-fg'

/**
 * The site header (docs/11). Links, the primary button and the wordmark all come from
 * Appearance → Header, footer, menus (docs/15) through `siteChrome()`, which is a cached
 * settings read and not a per-request query — see the note in `lib/chrome/load.ts` for why
 * this leaves `/` and the series pages prerendered.
 */
export async function Header() {
  const chrome = await siteChrome()
  const mobileLinks = chrome.header.filter((l) => l.mobile)
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur-[14px]">
      <div className="container-page flex h-16 min-w-0 items-center gap-2 sm:gap-3 md:gap-5">
        <Wordmark brand={chrome.brand} compact />
        {chrome.header.length > 0 ? (
          <nav aria-label={messages.nav.primary} className="hidden min-w-0 lg:block">
            <NavLinks links={chrome.header} />
          </nav>
        ) : null}

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
          <kbd className="hidden xl:inline rounded-[5px] border border-line bg-surface-2 px-1.5 py-[3px] font-body text-[11px] font-semibold leading-none text-fg-muted">
            {messages.nav.searchHint}
          </kbd>
        </form>

        <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2 md:ml-0 md:gap-3">
          <Link
            href="/search"
            aria-label={messages.nav.search}
            className={`${iconButton} md:hidden`}
          >
            <Search size={18} />
          </Link>
          {/* The doorway for a reader with nothing to read (docs/13 "Random series"). Never
              prefetched: `/random` redirects, and a prefetch spends a roll nobody asked for. */}
          <Link
            href={randomLink.href}
            prefetch={false}
            aria-label={randomLink.hint}
            title={randomLink.label}
            className={`${iconButton} hidden sm:inline-flex`}
          >
            <Shuffle size={18} />
          </Link>
          {/* "Request a series" opens a modal in place rather than navigating: a reader
              forty chapters into something should not lose their place to ask for a title.
              The board itself is /requests, linked from the modal and the footer. */}
          <RequestTrigger className="hidden sm:inline-flex" />
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
          {chrome.primaryButton ? (
            <Link
              href={chrome.primaryButton.href}
              aria-label={chrome.primaryButton.label}
              className={buttonClasses('primary', 'md', 'rounded-[10px] px-3 sm:px-4')}
            >
              <Zap size={16} aria-hidden="true" />
              <span className="hidden sm:inline">{chrome.primaryButton.label}</span>
            </Link>
          ) : null}
          <AccountButton />
        </div>
      </div>

      {/*
        docs/15 "Header links … and 'show on mobile' flags". The desktop row is `hidden
        md:block`, so before this there was nowhere for a header link to appear on a phone.
        Flagged links get a scrollable strip under the bar; with none flagged — the shipped
        default — nothing renders and the header is exactly the height it always was.
      */}
      {mobileLinks.length > 0 ? (
        <nav aria-label={messages.nav.menu} className="border-t border-line-soft md:hidden">
          <div className="container-page overflow-x-auto py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {/* `w-max` so a long list scrolls instead of squashing every label. */}
            <NavLinks links={mobileLinks} className="flex w-max items-center gap-0.5" />
          </div>
        </nav>
      ) : null}
    </header>
  )
}
