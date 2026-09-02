import { describe, expect, it } from 'vitest'
import { contrast, resolveAppearance } from './resolve'
import { DEFAULT_APPEARANCE, parseAppearance } from './schema'

describe('appearance resolver', () => {
  it('emits the dark and light token blocks with the default accent', () => {
    const r = resolveAppearance(DEFAULT_APPEARANCE)
    expect(r.dark['--color-brand']).toBe('#7c3aed')
    expect(r.css).toContain(':root{--color-bg:')
    expect(r.css).toContain(':root[data-theme="light"]{')
    expect(r.dark['--color-brand-wash']).toMatch(/^rgb\(\d+ \d+ \d+ \/ 0\.14\)$/)
    expect(r.dark['--radius-md']).toBe('8px')
  })

  it('darkens the light accent until it passes 3:1 on white and 4.5:1 for ink', () => {
    const r = resolveAppearance(parseAppearance({ color: { accent: '#f59e0b' } }))
    const brand = r.light['--color-brand'] ?? ''
    expect(contrast(brand, '#ffffff')).toBeGreaterThanOrEqual(3)
    expect(contrast(r.light['--color-brand-ink'] ?? '', brand)).toBeGreaterThanOrEqual(4.5)
    expect(r.contrast.light.every((c) => c.pass)).toBe(true)
  })

  it('reports failing contrast as a warning, not a block', () => {
    const r = resolveAppearance(parseAppearance({ color: { accent: '#3b3050' } }))
    expect(r.contrast.dark.find((c) => c.id === 'brandOnPage')?.ratio).toBeGreaterThanOrEqual(3)
    expect(r.css.length).toBeGreaterThan(100)
  })

  it('tints the neutral ramp with the accent hue', () => {
    const plain = resolveAppearance(
      parseAppearance({ color: { accent: '#22c55e', surface_tint: 0 } }),
    )
    const tinted = resolveAppearance(
      parseAppearance({ color: { accent: '#22c55e', surface_tint: 0.08 } }),
    )
    expect(plain.dark['--color-bg']).not.toBe(tinted.dark['--color-bg'])
  })

  it('maps shape settings to radii and pill buttons', () => {
    const r = resolveAppearance(parseAppearance({ shape: { radius: 'round', pill_buttons: true } }))
    expect(r.dark['--radius-lg']).toBe('22px')
    expect(r.dark['--radius-button']).toBe('999px')
  })
})
