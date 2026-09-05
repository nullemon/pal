import { messages } from '@palscans/core/messages'
import { Info, Megaphone, TriangleAlert, X } from 'lucide-react'
import Link from 'next/link'
import { SIGNED_IN_HINT_COOKIE } from '@/lib/auth/hint'
import { type InlineNode, parseInline } from '@/lib/chrome/inline'
import { siteChrome } from '@/lib/chrome/load'
import type { AnnouncementTone } from '@/lib/site'

const tones: Record<AnnouncementTone, { className: string; Icon: typeof Info; label: string }> = {
  // Colour is never the only signal (docs/15 accessibility): each tone carries its own icon
  // and a visually-hidden word, so the difference survives greyscale and a screen reader.
  info: {
    className: 'bg-brand-wash text-fg border-b border-brand/40',
    Icon: Info,
    label: messages.announcementBar.info,
  },
  warning: {
    className: 'bg-warn/15 text-fg border-b border-warn/50',
    Icon: TriangleAlert,
    label: messages.announcementBar.warning,
  },
  promo: {
    className: 'bg-brand text-brand-ink border-b border-brand',
    Icon: Megaphone,
    label: messages.announcementBar.promo,
  },
}

function Inline({ nodes }: { nodes: InlineNode[] }) {
  return (
    <>
      {nodes.map((node, i) => {
        // Index keys: the nodes are positional and the list never reorders.
        const key = `${node.kind}-${i}`
        if (node.kind === 'strong') return <strong key={key}>{node.text}</strong>
        if (node.kind === 'em') return <em key={key}>{node.text}</em>
        if (node.kind === 'link') {
          return node.external ? (
            <a
              key={key}
              href={node.href}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:no-underline"
            >
              {node.text}
            </a>
          ) : (
            <Link
              key={key}
              href={node.href}
              className="underline underline-offset-2 hover:no-underline"
            >
              {node.text}
            </Link>
          )
        }
        return <span key={key}>{node.text}</span>
      })}
    </>
  )
}

/**
 * Hides a bar the reader already dismissed, and applies the audience.
 *
 * Inline and synchronous, in the ThemeScript style, for two reasons: a dismissed bar must be
 * gone before first paint rather than flashing, and a React island in the site layout would
 * put client JavaScript on every route for a strip of text (docs/20).
 *
 * The audience check reads `pal_in`, a non-secret marker the session layer writes next to the
 * HttpOnly `sid` cookie. It says only "this browser signed in", which the browser already
 * knows. A bar for everyone — the default — is rendered visible on the server and needs none
 * of this, so it works with JavaScript off.
 */
const script = (id: string, audience: string, dismissible: boolean) => {
  const key = JSON.stringify(id)
  const parts = [`var e=document.getElementById('announcement-bar');if(!e)return;var s=true;`]
  if (dismissible) parts.push(`try{if(localStorage.getItem('pal.ann')===${key})s=false}catch(_){}`)
  if (audience !== 'everyone')
    parts.push(
      `var i=/(?:^|; )${SIGNED_IN_HINT_COOKIE}=1(?:;|$)/.test(document.cookie);`,
      audience === 'members' ? `if(!i)s=false;` : `if(i)s=false;`,
    )
  parts.push(`e.hidden=!s;`)
  if (dismissible)
    parts.push(
      `var b=e.querySelector('[data-ann-dismiss]');`,
      `if(b)b.addEventListener('click',function(){e.hidden=true;try{localStorage.setItem('pal.ann',${key})}catch(_){}});`,
    )
  return `(function(){try{${parts.join('')}}catch(_){}})()`
}

/**
 * The announcement bar (docs/15 "rich text, colour (info · warning · promo), schedule,
 * audience, dismissible"). Renders nothing when it is off, empty, or outside its schedule —
 * the schedule is applied in `lib/chrome/resolve.ts` when the settings entry is built, so a
 * start or end time takes effect within that entry's 60s window.
 *
 * The text is never HTML: it goes through the restricted inline grammar in
 * `lib/chrome/inline.ts` and comes out as React elements.
 */
export async function AnnouncementBar() {
  const { announcement } = await siteChrome()
  if (!announcement) return null
  const tone = tones[announcement.tone]
  const targeted = announcement.audience !== 'everyone'
  const needsScript = targeted || announcement.dismissible
  return (
    <>
      <div
        id="announcement-bar"
        data-ann-audience={announcement.audience}
        // A targeted bar starts hidden and the script reveals it to the right reader; a bar
        // for everyone is visible from the server so it survives JavaScript being off.
        hidden={targeted}
        className={tone.className}
      >
        <div className="container-page flex min-h-10 items-center gap-2.5 py-1.5 text-[13px] leading-[18px]">
          <tone.Icon size={16} aria-hidden="true" className="shrink-0" />
          <span className="sr-only">{tone.label}:</span>
          <p className="min-w-0 flex-1">
            <Inline nodes={parseInline(announcement.text)} />
          </p>
          {announcement.dismissible ? (
            <button
              type="button"
              data-ann-dismiss=""
              aria-label={messages.announcementBar.dismiss}
              className="-mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md opacity-80 transition-opacity hover:opacity-100"
            >
              <X size={16} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>
      {needsScript ? (
        // React serialises a string child of <script> verbatim; the body below is built from
        // literals and a JSON-encoded id, never from the operator's text.
        <script id="announcement-script">
          {script(announcement.id, announcement.audience, announcement.dismissible)}
        </script>
      ) : null}
    </>
  )
}
