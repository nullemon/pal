import type { SocialNetwork, SupportNetwork } from '@/lib/site'

const paths: Record<SocialNetwork, React.ReactNode> = {
  x: (
    <>
      <path d="M4 4l16 16" />
      <path d="M20 4L4 20" />
    </>
  ),
  instagram: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <circle cx="12" cy="12" r="3.5" />
      <circle cx="17" cy="7" r="0.6" />
    </>
  ),
  reddit: (
    <>
      <ellipse cx="12" cy="14" rx="8" ry="5.5" />
      <circle cx="9" cy="14" r="1" />
      <circle cx="15" cy="14" r="1" />
      <path d="M12 8.5l1.5-4 3.5 1" />
    </>
  ),
  youtube: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="4" />
      <path d="M10 9.5v5l4.5-2.5z" />
    </>
  ),
  facebook: <path d="M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8z" />,
}

/**
 * The support links (docs/15 "support links — Patreon · Ko-fi · Buy me a coffee"). Drawn in
 * the same 24px stroked grid as the socials rather than lifted from each brand's asset kit:
 * a stroked glyph inherits `currentColor` and so passes contrast in both themes, and nobody's
 * trademark is being redistributed. Each one is labelled — never an icon alone.
 */
const supportPaths: Record<SupportNetwork, React.ReactNode> = {
  // A circle with a bar: the Patreon "P" reduced to its two marks.
  patreon: (
    <>
      <circle cx="14.5" cy="10" r="5.5" />
      <path d="M5 4v16" />
    </>
  ),
  // A cup with a handle and rising steam — Ko-fi.
  kofi: (
    <>
      <path d="M4 8h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" />
      <path d="M16 9.5h1.5a2.5 2.5 0 0 1 0 5H16" />
      <path d="M8 4.5v1.5M12 4.5v1.5" />
    </>
  ),
  // A takeaway cup with a lid — Buy me a coffee.
  buymeacoffee: (
    <>
      <path d="M5 7h14l-1.5 12a2 2 0 0 1-2 1.8H8.5a2 2 0 0 1-2-1.8z" />
      <path d="M4 7h16" />
      <path d="M9 3.5v1.5M15 3.5v1.5" />
    </>
  ),
}

function Glyph({ size, children }: { size: number; children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function SocialIcon({ network, size = 20 }: { network: SocialNetwork; size?: number }) {
  return <Glyph size={size}>{paths[network]}</Glyph>
}

export function SupportIcon({ network, size = 18 }: { network: SupportNetwork; size?: number }) {
  return <Glyph size={size}>{supportPaths[network]}</Glyph>
}
