import Link from 'next/link'
import { site } from '@/lib/site'

export function Monogram({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" className="shrink-0">
      <rect width="28" height="28" rx="7" className="fill-brand" />
      <path
        d="M10 20V8h5a3.8 3.8 0 0 1 0 7.6h-5"
        fill="none"
        className="stroke-brand-ink"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Wordmark({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const monogram = size === 'sm' ? 24 : 30
  return (
    <Link
      href="/"
      aria-label={`${site.name} home`}
      className="flex items-center gap-2.5 rounded-md text-fg"
    >
      <Monogram size={monogram} />
      <span
        className={`font-display font-extrabold leading-none tracking-[-0.04em] ${
          size === 'sm' ? 'text-[17px]' : 'text-[21px]'
        }`}
      >
        PAL
        <span className="font-normal tracking-[-0.02em]">Scans</span>
      </span>
    </Link>
  )
}
