import { adminMessages } from '@palscans/core/messages/admin'
import { Eye } from 'lucide-react'
import { previewScopes } from '@/lib/appearance/preview'
import { previewStopHref } from '@/lib/appearance/scope'

/**
 * "You are looking at a draft" — the bar a staff previewer sees on the live site
 * (docs/15 "Preview").
 *
 * Three things it has to get right:
 *
 * - **It renders for nobody else.** `previewScopes()` is empty for every anonymous visitor
 *   and during every prerender, so this is `null` in the prerendered HTML and adds nothing
 *   to a reader's page. It is a server component with no client half, so it adds nothing to
 *   any route's JavaScript either.
 * - **It names what is being previewed.** Brand and Menus publish separately but render into
 *   the same header, so "which of these am I looking at" is a real question; the bar answers
 *   it by listing the scopes rather than saying "preview" and leaving the operator to guess.
 * - **It sits at the bottom.** The thing being previewed is usually the header; a banner
 *   pinned over it would hide the change. Above the mobile bottom nav, clear of the safe
 *   area, and it never covers the page's own content because the layout reserves that space
 *   already.
 *
 * Not colour alone: an icon, the word "Draft preview", and a text link out.
 */
export async function PreviewBar() {
  const scopes = await previewScopes()
  if (scopes.length === 0) return null
  const m = adminMessages.appearanceVersions
  const names = scopes.map((s) => m.scopes[s]).join(' · ')
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-3 md:bottom-4"
    >
      <div className="pointer-events-auto flex max-w-full items-center gap-2.5 rounded-full border border-warn bg-surface-1 px-3.5 py-2 text-[13px] leading-5 shadow-2">
        <Eye size={15} aria-hidden="true" className="shrink-0 text-warn" />
        <span className="truncate font-semibold">{m.previewBanner}</span>
        <span className="truncate text-fg-muted">{names}</span>
        <a
          href={previewStopHref('/')}
          className="shrink-0 rounded-full border border-line px-2.5 py-0.5 font-semibold text-fg hover:bg-surface-2"
        >
          {m.exitPreview}
        </a>
      </div>
    </div>
  )
}
