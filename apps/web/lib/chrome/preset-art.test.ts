import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MONOGRAM_LETTER, MONOGRAM_TAIL } from './monogram'
import { LOGO_PRESET_ART } from './preset-art'
import { LOGO_PRESET_IDS, LOGO_PRESETS } from './presets'

/**
 * `preset-art.ts` is a copy of the SVGs in `design/logos/`, made by
 * `design/logos/emit-preset-art.mjs` because the app cannot read `design/` at runtime. A copy
 * is a thing that drifts, so this is the guard: edit a mark, forget to regenerate, and the
 * suite says so instead of the site quietly rendering last month's logo.
 */
const DESIGN = join(import.meta.dirname, '../../../../design/logos')

const svgFiles = () =>
  readdirSync(DESIGN)
    .filter((f) => /^\d\d-.*\.svg$/.test(f))
    .sort()

describe('logo preset art', () => {
  it('has one entry per SVG in design/logos, and no others', () => {
    expect(svgFiles().map((f) => f.replace(/\.svg$/, ''))).toEqual([...LOGO_PRESET_IDS])
    expect(Object.keys(LOGO_PRESET_ART).sort()).toEqual([...LOGO_PRESET_IDS].sort())
  })

  it('matches the design source byte for byte', () => {
    for (const file of svgFiles()) {
      const id = file.replace(/\.svg$/, '') as (typeof LOGO_PRESET_IDS)[number]
      expect(LOGO_PRESET_ART[id], `${file} — run node design/logos/emit-preset-art.mjs`).toBe(
        readFileSync(join(DESIGN, file), 'utf8').trimEnd(),
      )
    }
  })

  it('describes every mark in the catalogue', () => {
    expect(LOGO_PRESETS.map((p) => p.id)).toEqual([...LOGO_PRESET_IDS])
    for (const preset of LOGO_PRESETS) {
      expect(preset.name.length, preset.id).toBeGreaterThan(2)
      expect(preset.note.length, preset.id).toBeGreaterThan(40)
    }
  })

  /**
   * The four that draw their own tile or disc must not be inset into the maskable safe zone,
   * and the seven free-standing glyphs must be. `design/logos/README.md` is the record; this
   * checks the flag against the markup rather than against the prose.
   */
  it('flags exactly the marks that paint their own container', () => {
    for (const preset of LOGO_PRESETS) {
      const art = LOGO_PRESET_ART[preset.id]
      const fillsFrame =
        /<rect width="512" height="512"/.test(art) || /<circle cx="256" cy="256" r="24\d"/.test(art)
      expect(fillsFrame, preset.id).toBe(preset.ownsContainer)
    }
    expect(LOGO_PRESETS.filter((p) => p.ownsContainer).map((p) => p.id)).toEqual([
      '01-panel-cut',
      '05-speed-slash',
      '06-scan-pass',
      '11-balloon-p',
    ])
  })

  /**
   * `11-balloon-p` is the site's built-in mark as well as a preset, and the header, the admin
   * sidebar and the OG card each redraw it with their own colours from `lib/chrome/monogram`.
   * That is four copies of one geometry; this is what stops the design file and the code from
   * describing different logos. Whitespace is collapsed because the SVG wraps its `d` across
   * two lines for legibility and the constant does not.
   */
  it('draws the built-in monogram from the same paths the app renders', () => {
    const art = LOGO_PRESET_ART['11-balloon-p'].replace(/\s+/g, ' ')
    expect(art, 'design/logos/11-balloon-p.svg vs lib/chrome/monogram.ts').toContain(
      MONOGRAM_LETTER,
    )
    expect(art).toContain(MONOGRAM_TAIL)
  })

  it('carries no script, event handler or external reference', () => {
    for (const [id, art] of Object.entries(LOGO_PRESET_ART)) {
      expect(/<script|\son[a-z]+=|href=|xlink:/i.test(art), id).toBe(false)
    }
  })
})
