import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AdSlot } from './AdSlot'
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
  it('reserves the box and renders nothing for ad-free viewers', () => {
    const { container, rerender } = render(<AdSlot slot="home_top" width={970} height={90} />)
    const box = container.firstElementChild as HTMLElement
    expect(box.dataset.adSlot).toBe('home_top')
    expect(box.style.height).toBe('90px')
    rerender(<AdSlot slot="home_top" width={970} height={90} noAds />)
    expect(container.firstElementChild).toBeNull()
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
