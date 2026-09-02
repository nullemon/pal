import { clampChroma, converter, formatHex, formatRgb, wcagContrast } from 'culori'
import type { AppearanceDoc } from './schema'

/**
 * docs/15 "How it works": the appearance document → the full CSS custom-property block for
 * dark and light. Colours are derived in OKLCH from the accent (brand, hover, dim, wash, ink,
 * glow), the light accent is darkened until it passes contrast on white, and the neutral
 * ramp carries the accent hue at the chosen chroma ("surface tint"). Pure: safe to run in
 * the Theme screen's live preview as well as on the server.
 */
const toOklch = converter('oklch')

export interface Oklch {
  l: number
  c: number
  h: number
}

export const oklch = (hex: string): Oklch => {
  const c = toOklch(hex)
  return { l: c?.l ?? 0.5, c: c?.c ?? 0, h: c?.h ?? 0 }
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

export const hexOf = (c: Oklch): string =>
  formatHex(clampChroma({ mode: 'oklch', l: clamp01(c.l), c: Math.max(0, c.c), h: c.h }, 'oklch'))

const rgbAlpha = (c: Oklch, alpha: number): string => {
  const rgb = formatRgb(
    clampChroma({ mode: 'oklch', l: clamp01(c.l), c: Math.max(0, c.c), h: c.h }, 'oklch'),
  )
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(rgb)
  return m ? `rgb(${m[1]} ${m[2]} ${m[3]} / ${alpha})` : rgb
}

export const contrast = (fg: string, bg: string): number =>
  Math.round(wcagContrast(fg, bg) * 10) / 10

/** Step the lightness down (or up) until `fg` on `bg` reaches the target ratio. */
const adjustFor = (
  c: Oklch,
  bg: string,
  target: number,
  direction: -1 | 1,
  limit: number,
): Oklch => {
  let cur = { ...c }
  for (let i = 0; i < 40; i++) {
    if (contrast(hexOf(cur), bg) >= target) return cur
    const next = cur.l + direction * 0.02
    if ((direction < 0 && next < limit) || (direction > 0 && next > limit)) break
    cur = { ...cur, l: next }
  }
  return cur
}

export interface ContrastCheck {
  id: 'brandOnPage' | 'textOnBrand' | 'linksOnSurface'
  ratio: number
  target: number
  pass: boolean
}

export interface ResolvedAppearance {
  dark: Record<string, string>
  light: Record<string, string>
  css: string
  contrast: { dark: ContrastCheck[]; light: ContrastCheck[] }
  ramp: { brand: string; hover: string; dim: string; wash: string; ink: string; glow: string }
}

const RADII: Record<AppearanceDoc['shape']['radius'], [string, string, string]> = {
  sharp: ['2px', '4px', '6px'],
  soft: ['4px', '8px', '14px'],
  round: ['8px', '14px', '22px'],
}

const fontStack = (name: string) =>
  name === 'system-ui'
    ? 'ui-sans-serif, system-ui, sans-serif'
    : `"${name}", ui-sans-serif, system-ui, sans-serif`

const neutral = (l: number, tint: number, h: number, scale: number): string =>
  hexOf({ l, c: tint * scale, h })

export const resolveAppearance = (doc: AppearanceDoc): ResolvedAppearance => {
  const accent = oklch(doc.color.accent)
  const h = accent.c < 0.02 ? 300 : accent.h
  const tint = doc.color.surface_tint

  // ---- dark ---------------------------------------------------------------------------
  const darkBg = neutral(0.16, tint, h, 1.2)
  const darkSurface1 = neutral(0.19, tint, h, 1.2)
  let brand = { ...accent, h }
  brand = adjustFor(brand, darkBg, 3, 1, 0.9)
  const hover = { ...brand, l: Math.min(0.95, brand.l + 0.08) }
  const dim = { ...brand, l: Math.max(0.2, brand.l - 0.18), c: brand.c * 0.9 }
  const brandHex = hexOf(brand)
  const ink = contrast('#ffffff', brandHex) >= contrast('#100d17', brandHex) ? '#ffffff' : '#100d17'
  const secondaryDark = doc.color.derive_secondary
    ? hexOf({ l: 0.85, c: 0.15, h: (h + 60) % 360 })
    : doc.color.secondary

  const dark: Record<string, string> = {
    '--color-bg': darkBg,
    '--color-bg-deep': neutral(0.13, tint, h, 1.2),
    '--color-surface-1': darkSurface1,
    '--color-surface-2': neutral(0.22, tint, h, 1.2),
    '--color-surface-3': neutral(0.26, tint, h, 1.2),
    '--color-line': neutral(0.3, tint, h, 1.3),
    '--color-line-soft': neutral(0.25, tint, h, 1.3),
    '--color-fg': neutral(0.94, tint, h, 0.4),
    '--color-fg-muted': neutral(0.68, tint, h, 1.5),
    '--color-fg-subtle': neutral(0.52, tint, h, 1.8),
    '--color-brand': brandHex,
    '--color-brand-hover': hexOf(hover),
    '--color-brand-dim': hexOf(dim),
    '--color-brand-wash': rgbAlpha(brand, 0.14),
    '--color-brand-ink': ink,
    '--color-gold': secondaryDark,
    '--color-type-manhwa': doc.color.type.manhwa,
    '--color-type-manhua': doc.color.type.manhua,
    '--color-type-manga': doc.color.type.manga,
    '--color-type-comic': doc.color.type.comic,
    '--color-status-ongoing': doc.color.status.ongoing,
    '--color-status-completed': doc.color.status.completed,
    '--color-status-hiatus': doc.color.status.hiatus,
    '--color-status-cancelled': doc.color.status.cancelled,
    '--glow-brand': `0 0 0 1px ${hexOf(dim)}, 0 6px 24px -10px ${brandHex}`,
  }

  // ---- light --------------------------------------------------------------------------
  const lightBg = neutral(0.985, tint, h, 0.2)
  const lightSurface1 = '#ffffff'
  let brandLight = adjustFor({ ...brand, l: Math.min(brand.l, 0.6) }, lightSurface1, 3, -1, 0.3)
  if (contrast('#ffffff', hexOf(brandLight)) < 4.5)
    brandLight = adjustFor(brandLight, '#ffffff', 4.5, -1, 0.3)
  const brandLightHex = hexOf(brandLight)
  const inkLight =
    contrast('#ffffff', brandLightHex) >= contrast('#100d17', brandLightHex) ? '#ffffff' : '#100d17'
  const darkenFor = (hexIn: string) => hexOf(adjustFor(oklch(hexIn), '#ffffff', 3, -1, 0.3))
  const light: Record<string, string> = {
    '--color-bg': lightBg,
    '--color-bg-deep': neutral(0.968, tint, h, 0.3),
    '--color-surface-1': lightSurface1,
    '--color-surface-2': neutral(0.968, tint, h, 0.3),
    '--color-surface-3': neutral(0.94, tint, h, 0.5),
    '--color-line': neutral(0.89, tint, h, 0.6),
    '--color-line-soft': neutral(0.935, tint, h, 0.4),
    '--color-fg': neutral(0.2, tint, h, 1),
    '--color-fg-muted': neutral(0.45, tint, h, 1.1),
    '--color-fg-subtle': neutral(0.58, tint, h, 1),
    '--color-brand': brandLightHex,
    '--color-brand-hover': hexOf({ ...brandLight, l: Math.max(0.25, brandLight.l - 0.06) }),
    '--color-brand-dim': hexOf({
      ...brandLight,
      l: Math.min(0.9, brandLight.l + 0.25),
      c: brandLight.c * 0.6,
    }),
    '--color-brand-wash': hexOf({ l: 0.96, c: Math.min(0.04, brandLight.c * 0.2), h }),
    '--color-brand-ink': inkLight,
    '--color-gold': darkenFor(secondaryDark),
    '--color-type-manhwa': darkenFor(doc.color.type.manhwa),
    '--color-type-manhua': darkenFor(doc.color.type.manhua),
    '--color-type-manga': darkenFor(doc.color.type.manga),
    '--color-type-comic': darkenFor(doc.color.type.comic),
    '--color-status-ongoing': darkenFor(doc.color.status.ongoing),
    '--color-status-completed': darkenFor(doc.color.status.completed),
    '--color-status-hiatus': darkenFor(doc.color.status.hiatus),
    '--color-status-cancelled': darkenFor(doc.color.status.cancelled),
    '--shadow-1': '0 1px 2px rgb(0 0 0 / 0.08)',
    '--shadow-2': '0 10px 30px -12px rgb(0 0 0 / 0.2)',
    '--glow-brand': `0 0 0 1px ${hexOf({ ...brandLight, l: 0.8, c: brandLight.c * 0.5 })}, 0 6px 24px -10px ${brandLightHex}`,
  }

  // ---- shared (typography, shape) -------------------------------------------------------
  const [rs, rm, rl] = RADII[doc.shape.radius]
  const shared: Record<string, string> = {
    '--font-display': fontStack(doc.typography.display),
    '--font-body': fontStack(doc.typography.body),
    '--font-size-base': `${doc.typography.base_size}px`,
    '--font-weight-heading': String(doc.typography.heading_weight),
    '--radius-sm': rs,
    '--radius-md': rm,
    '--radius-lg': rl,
    '--radius-button': doc.shape.pill_buttons ? '999px' : rm,
    '--card-border': doc.shape.card_style === 'flat' ? '0px' : '1px',
    '--card-shadow': doc.shape.card_style === 'elevated' ? 'var(--shadow-2)' : 'none',
    '--density-row': doc.shape.density === 'compact' ? '40px' : '48px',
  }
  Object.assign(dark, shared)

  const check = (id: ContrastCheck['id'], ratio: number, target: number): ContrastCheck => ({
    id,
    ratio,
    target,
    pass: ratio >= target,
  })
  const checks = (t: Record<string, string>, linkColor: string): ContrastCheck[] => [
    check('brandOnPage', contrast(t['--color-brand'] ?? '#000', t['--color-bg'] ?? '#fff'), 3),
    check(
      'textOnBrand',
      contrast(t['--color-brand-ink'] ?? '#fff', t['--color-brand'] ?? '#000'),
      4.5,
    ),
    check('linksOnSurface', contrast(linkColor, t['--color-surface-1'] ?? '#000'), 4.5),
  ]

  const block = (selector: string, tokens: Record<string, string>) =>
    `${selector}{${Object.entries(tokens)
      .map(([k, v]) => `${k}:${v}`)
      .join(';')}}`
  const css = `${block(':root', dark)}\n${block(':root[data-theme="light"]', light)}`

  return {
    dark,
    light,
    css,
    contrast: {
      dark: checks(dark, dark['--color-brand-hover'] ?? brandHex),
      light: checks(light, brandLightHex),
    },
    ramp: {
      brand: brandHex,
      hover: hexOf(hover),
      dim: hexOf(dim),
      wash: dark['--color-brand-wash'] ?? '',
      ink,
      glow: brandHex,
    },
  }
}
