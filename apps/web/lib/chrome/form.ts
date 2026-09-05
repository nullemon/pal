import type { SiteChrome } from '@/lib/site'
import type { MenusSetting } from './schema'
import { announcementSchema } from './schema'

/**
 * Turn the resolved chrome back into the document the Menus screen edits.
 *
 * This is what makes the first visit to an unconfigured site sane: without it the form would
 * open empty, and the operator's first save would replace the site's footer with nothing.
 * They see the links the site is showing them, and change those.
 *
 * The announcement is taken from the raw row rather than the resolved chrome, because the
 * resolver drops a bar that is disabled or out of its window — and the operator still needs
 * to see and edit the text and the dates they set.
 */
export const menusFromChrome = (chrome: SiteChrome, raw: unknown): MenusSetting => {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const url = (v: string | null | undefined) => v ?? null
  const social = (network: string) =>
    url(chrome.community.socials.find((s) => s.network === network)?.href)
  const support = (network: string) =>
    url(chrome.community.support.find((s) => s.network === network)?.href)
  return {
    header: chrome.header.map((l) => ({
      label: l.label,
      href: l.href,
      prefix: l.prefix ?? false,
      mobile: l.mobile,
    })),
    primary_button: {
      enabled: !!chrome.primaryButton,
      label: chrome.primaryButton?.label ?? 'Premium',
      href: chrome.primaryButton?.href ?? '/subscribe',
    },
    footer: chrome.footer.map((c) => ({
      title: c.title,
      links: c.links.map((l) => ({ label: l.label, href: l.href })),
    })),
    bottom_nav: chrome.bottomNav.map((i) => i.id),
    community: {
      discord_url: url(chrome.community.discordUrl),
      socials: {
        x: social('x'),
        instagram: social('instagram'),
        reddit: social('reddit'),
        youtube: social('youtube'),
        facebook: social('facebook'),
      },
      support: {
        patreon: support('patreon'),
        kofi: support('kofi'),
        buymeacoffee: support('buymeacoffee'),
      },
      rss: chrome.community.rss,
    },
    copyright: chrome.copyright,
    attribution: chrome.attribution,
    announcement: announcementSchema.parse(
      record.announcement && typeof record.announcement === 'object' ? record.announcement : {},
    ),
  }
}
