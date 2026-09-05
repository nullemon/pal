import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AdSlot } from './AdSlot'
import { AdTag } from './AdTag'
import { Chip } from './Chip'
import { formatRelative } from './RelativeTime'
import { SeriesCard } from './SeriesCard'

describe('SeriesCard', () => {
  it('renders title, type chip, chapter pill and rank', () => {
    render(
      <SeriesCard
        title="Return of the Frost Monarch"
        href="/series/return-of-the-frost-monarch"
        cover={{ src: '/dev-covers/cover-01.svg', width: 400, height: 600 }}
        type="manhwa"
        latestChapter={{ number: 301 }}
        rank={1}
      />,
    )
    expect(screen.getByText('Return of the Frost Monarch')).toBeTruthy()
    expect(screen.getByText('Manhwa')).toBeTruthy()
    expect(screen.getByText('Ch. 301')).toBeTruthy()
    expect(screen.getByText('Rank #1')).toBeTruthy()
    const img = screen.getByRole('presentation', { hidden: true }) as HTMLImageElement
    expect(img.getAttribute('width')).toBe('400')
    expect(img.getAttribute('loading')).toBe('lazy')
  })
})

describe('Chip', () => {
  it('uses the type token colour and a default label', () => {
    const { container } = render(<Chip variant="type" value="manga" />)
    const chip = container.firstElementChild as HTMLElement
    expect(chip.textContent).toBe('Manga')
    expect(chip.className).toContain('text-type-manga')
  })
})

describe('AdSlot', () => {
  it('reserves the box at its final size', () => {
    const { container } = render(<AdSlot slot="home_top" width={320} height={100} />)
    const box = container.firstElementChild as HTMLElement
    expect(box.dataset.adSlot).toBe('home_top')
    // The size is carried as custom properties so one element can be two sizes; globals.css
    // turns them into width/height at the md breakpoint.
    expect(box.style.getPropertyValue('--ad-w')).toBe('320px')
    expect(box.style.getPropertyValue('--ad-h')).toBe('100px')
  })

  it('carries a second size for the desktop breakpoint instead of a second element', () => {
    const { container } = render(
      <AdSlot slot="home_top" width={320} height={100} desktopWidth={970} desktopHeight={90} />,
    )
    // One element per slot: the layouts used to render two (`hidden md:block` plus
    // `md:hidden`), which would request and count the same slot twice once a tag is in.
    expect(container.querySelectorAll('[data-ad-slot="home_top"]')).toHaveLength(1)
    const box = container.firstElementChild as HTMLElement
    expect(box.style.getPropertyValue('--ad-w')).toBe('320px')
    expect(box.style.getPropertyValue('--ad-w-md')).toBe('970px')
    expect(box.style.getPropertyValue('--ad-h-md')).toBe('90px')
  })

  it('renders nothing at all for an ad-free viewer, tag or no tag', () => {
    const { container, rerender } = render(<AdSlot slot="home_top" width={970} height={90} noAds />)
    expect(container.firstElementChild).toBeNull()
    rerender(<AdSlot slot="home_top" width={970} height={90} tag="<script>x()</script>" noAds />)
    expect(container.firstElementChild).toBeNull()
    expect(container.querySelector('[data-ad-tag]')).toBeNull()
  })

  it('drops the placeholder label once a network tag is in the slot', () => {
    const { container, rerender } = render(
      <AdSlot slot="home_top" width={970} height={90} placeholder label="Leaderboard" />,
    )
    expect(container.textContent).toContain('Leaderboard')
    rerender(
      <AdSlot
        slot="home_top"
        width={970}
        height={90}
        placeholder
        label="Leaderboard"
        tag="<div>ad</div>"
      />,
    )
    expect(container.textContent).not.toContain('Leaderboard')
    expect(container.querySelector('[data-ad-tag="home_top"]')).not.toBeNull()
  })
})

/**
 * jsdom leaves injected scripts inert whatever `runScripts` is set to under this runner, so
 * these cover the mechanism — the script is re-created with its attributes and source, which
 * is what lets a browser run it — and the guard against running it twice. That the tag really
 * executes is checked in a real browser (`apps/web/e2e/ads.spec.ts` and the manual probe in
 * docs/18 §7).
 */
describe('AdTag', () => {
  const tag = '<div id="banner">here</div><script src="https://ads.example/t.js" async></script>'

  it('injects the markup and re-creates the script with its attributes', () => {
    const { container } = render(<AdTag slot="home_top" html={tag} />)
    expect(container.querySelector('#banner')?.textContent).toBe('here')
    const script = container.querySelector('script')
    expect(script?.getAttribute('src')).toBe('https://ads.example/t.js')
    expect(script?.hasAttribute('async')).toBe(true)
  })

  it('runs the tag once per mount, not once per render', () => {
    const { container, rerender } = render(<AdTag slot="home_top" html={tag} />)
    rerender(<AdTag slot="home_top" html={tag} />)
    // Two script elements would mean two requests to the network and two impressions.
    expect(container.querySelectorAll('script')).toHaveLength(1)
    expect(container.querySelectorAll('#banner')).toHaveLength(1)
  })

  it('replaces the slot when the operator changes the tag', () => {
    const { container, rerender } = render(<AdTag slot="home_top" html={tag} />)
    rerender(<AdTag slot="home_top" html={'<div id="other">new</div>'} />)
    expect(container.querySelector('#banner')).toBeNull()
    expect(container.querySelector('#other')?.textContent).toBe('new')
  })
})

describe('formatRelative', () => {
  it('formats past times', () => {
    const now = new Date('2026-01-01T12:00:00Z')
    expect(formatRelative('2026-01-01T11:48:00Z', now)).toMatch(/12/)
    expect(formatRelative('2025-12-31T12:00:00Z', now)).toMatch(/1/)
    expect(formatRelative('2026-01-01T11:59:50Z', now)).toBe('just now')
  })
})
