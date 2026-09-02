import { messages } from '@palscans/core/messages'
import { buttonClasses } from '@palscans/ui'
import { footerColumns, site, socialLinks } from '@/lib/site'
import { FooterColumn } from './FooterColumn'
import { SocialIcon } from './SocialIcons'
import { Wordmark } from './Wordmark'

function DiscordIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 6c1.3-.6 2.6-1 4-1s2.7.4 4 1l3 8-2 3-3-1.5c-1.3.4-2.7.4-4 0L7 17l-2-3z" />
      <circle cx="9.5" cy="12" r="1" />
      <circle cx="14.5" cy="12" r="1" />
    </svg>
  )
}

/**
 * docs/11: four columns on desktop (brand · Browse · Account · Legal), an accordion on
 * mobile, then the Discord button and the social icon row under the grid, then copyright.
 * Static server markup, identical on every page.
 */
export function Footer() {
  return (
    <footer className="mt-10 border-t border-line bg-bg-deep">
      <div className="container-page py-8">
        <div className="grid gap-x-8 gap-y-2 md:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))] md:gap-y-8">
          <div className="mb-4 max-w-[320px] md:mb-0">
            <Wordmark size="sm" />
            <p className="mt-3 text-[13px] leading-[18px] text-fg-muted">{site.tagline}</p>
          </div>
          {footerColumns.map((column) => (
            <FooterColumn key={column.title} column={column} />
          ))}
        </div>

        <section aria-label={messages.footer.community} className="mt-8 flex flex-col gap-3">
          <a
            href={site.discordUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClasses('primary', 'sm', 'self-start')}
          >
            <DiscordIcon />
            {messages.footer.joinDiscord}
          </a>
          <ul className="flex gap-1.5">
            {socialLinks.map((s) => (
              <li key={s.network}>
                <a
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={s.label}
                  className="inline-flex size-9 items-center justify-center rounded-md border border-line bg-surface-1 text-fg-muted transition-colors duration-[120ms] hover:bg-surface-2 hover:text-fg"
                >
                  <SocialIcon network={s.network} />
                </a>
              </li>
            ))}
          </ul>
        </section>

        <p className="mt-8 border-t border-line pt-4 text-[13px] text-fg-muted">{site.copyright}</p>
      </div>
    </footer>
  )
}
