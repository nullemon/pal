import { messages } from '@palscans/core/messages'
import { Rss } from 'lucide-react'
import { feedHref } from './SeoHead'

/**
 * The footer RSS icon (docs/11 footer, docs/12 §6): points at the custom feed URL when one
 * is set and renders nothing when feeds are disabled. Drop it into the social icon row of
 * components/shell/Footer.tsx (F1's file) — it is a server component and needs no props.
 */
export async function FooterRss() {
  const href = await feedHref()
  if (!href) return null
  return (
    <a
      href={href}
      aria-label={messages.footer.rss}
      className="inline-flex size-9 items-center justify-center rounded-md border border-line bg-surface-1 text-fg-muted transition-colors duration-[120ms] hover:bg-surface-2 hover:text-fg"
    >
      <Rss size={16} aria-hidden="true" />
    </a>
  )
}
