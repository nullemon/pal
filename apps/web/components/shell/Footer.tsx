import { messages } from '@palscans/core/messages'
import { buttonClasses } from '@palscans/ui'
import { siteChrome } from '@/lib/chrome/load'
import { FooterRss } from '@/lib/seo/FooterRss'
import { FooterColumn } from './FooterColumn'
import { SocialIcon, SupportIcon } from './SocialIcons'
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

const iconLink =
  'inline-flex size-9 items-center justify-center rounded-md border border-line bg-surface-1 text-fg-muted transition-colors duration-[120ms] hover:bg-surface-2 hover:text-fg'

/**
 * docs/11: the brand block plus up to four operator-named columns on desktop, an accordion on
 * mobile, then the community row (Discord, socials, support links, RSS) and the copyright and
 * attribution lines. Every string here comes from Appearance → Header, footer, menus
 * (docs/15) with the shipped footer as the fallback. Static server markup, identical on
 * every page.
 */
export async function Footer() {
  const chrome = await siteChrome()
  const { community } = chrome
  const columns = chrome.footer.length
  return (
    <footer className="mt-10 border-t border-line bg-bg-deep">
      <div className="container-page py-8">
        <div
          className="footer-grid grid gap-x-8 gap-y-2 md:gap-y-8"
          // The brand block plus one track per column, so removing a column closes the gap
          // rather than leaving a hole. `.footer-grid` in globals.css keeps the mobile stack.
          style={
            {
              '--footer-cols':
                columns > 0 ? `minmax(0,1.6fr) repeat(${columns}, minmax(0,1fr))` : 'minmax(0,1fr)',
            } as React.CSSProperties
          }
        >
          <div className="mb-4 max-w-[320px] md:mb-0">
            <Wordmark size="sm" brand={chrome.brand} />
            <p className="mt-3 text-[13px] leading-[18px] text-fg-muted">{chrome.brand.tagline}</p>
          </div>
          {chrome.footer.map((column, i) => (
            <FooterColumn
              // Position, not title: nothing stops an operator naming two columns the same.
              // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
              key={i}
              column={column}
            />
          ))}
        </div>

        <section aria-label={messages.footer.community} className="mt-8 flex flex-col gap-3">
          {community.discordUrl ? (
            <a
              href={community.discordUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClasses('primary', 'sm', 'self-start')}
            >
              <DiscordIcon />
              {messages.footer.joinDiscord}
            </a>
          ) : null}
          {community.socials.length > 0 || community.support.length > 0 || community.rss ? (
            <ul className="flex flex-wrap gap-1.5">
              {community.socials.map((s) => (
                <li key={s.network}>
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={s.label}
                    className={iconLink}
                  >
                    <SocialIcon network={s.network} />
                  </a>
                </li>
              ))}
              {community.rss ? (
                <li>
                  <FooterRss />
                </li>
              ) : null}
              {community.support.map((s) => (
                <li key={s.network}>
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={s.label}
                    className={iconLink}
                  >
                    <SupportIcon network={s.network} />
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <div className="mt-8 border-t border-line pt-4 text-[13px] text-fg-muted">
          <p>{chrome.copyright}</p>
          {chrome.attribution ? <p className="mt-1">{chrome.attribution}</p> : null}
        </div>
      </div>
    </footer>
  )
}
