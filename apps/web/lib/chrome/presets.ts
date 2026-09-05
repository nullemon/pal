/**
 * The ten logo directions in `design/logos/` offered as a picker in Appearance → Brand
 * (docs/15 "Logo"), so an operator can choose one without opening a design tool.
 *
 * Client-safe and art-free: this is the catalogue — ids, names and the two facts the renderer
 * needs — while the SVG source lives in `./preset-art.ts`. Keeping them apart means the admin
 * picker and the resolver can name a preset without either of them carrying 13 KB of markup.
 *
 * `ownsContainer` is the one that matters for icons. Three of the marks are drawn *inside*
 * their own brand-coloured tile or disc and must be rendered full-bleed; the other seven are
 * free-standing glyphs on transparent ground, which have to be inset into the maskable safe
 * zone over a background colour or Android will crop them. `design/logos/README.md` records
 * which is which, and why.
 */

export const LOGO_PRESET_IDS = [
  '01-panel-cut',
  '02-dog-ear',
  '03-twin-bookmark',
  '04-panel-grid',
  '05-speed-slash',
  '06-scan-pass',
  '07-bracket-tag',
  '08-balloon-pal',
  '09-stacked-wordmark',
  '10-aperture',
] as const

export type LogoPresetId = (typeof LOGO_PRESET_IDS)[number]

export interface LogoPreset {
  id: LogoPresetId
  name: string
  /** One line from `design/logos/README.md` — what it is, and where it gives out. */
  note: string
  /** True when the mark carries its own coloured tile or disc and must not be inset. */
  ownsContainer: boolean
}

export const LOGO_PRESETS: readonly LogoPreset[] = [
  {
    id: '01-panel-cut',
    name: 'Panel Cut',
    note: 'A geometric P split by a panel gutter. Keeps the site’s existing letter; the gutter is the first detail to vanish at 16px.',
    ownsContainer: true,
  },
  {
    id: '02-dog-ear',
    name: 'Dog-Ear',
    note: 'A page turned down at the corner. The most editorial of the set; the narrowest in a browser tab.',
    ownsContainer: false,
  },
  {
    id: '03-twin-bookmark',
    name: 'Twin Bookmark',
    note: 'Two ribbons at different depths. The most robust at small sizes, and the least distinctive idea.',
    ownsContainer: false,
  },
  {
    id: '04-panel-grid',
    name: 'Panel Grid',
    note: 'A manga page with a raked gutter. Unmistakably comics at full size; a layout icon at 16px.',
    ownsContainer: false,
  },
  {
    id: '05-speed-slash',
    name: 'Speed Slash',
    note: 'Three raked speed lines with a gold accent. The youngest mark here, and the closest to a hamburger menu.',
    ownsContainer: true,
  },
  {
    id: '06-scan-pass',
    name: 'Scan Pass',
    note: 'A page caught mid-scan under a gold beam. The most literal answer to what the site is, and the busiest.',
    ownsContainer: true,
  },
  {
    id: '07-bracket-tag',
    name: 'Bracket Tag',
    note: 'The [Group] release tag with a page inside it. Speaks straight to scanlation readers; opaque to everyone else.',
    ownsContainer: false,
  },
  {
    id: '08-balloon-pal',
    name: 'Balloon Pal',
    note: 'A speech balloon read as a face. The most memorable in an avatar slot; may read as “comments”.',
    ownsContainer: false,
  },
  {
    id: '09-stacked-wordmark',
    name: 'Stacked Wordmark',
    note: 'PAL over SCANS, outlined. The most grown-up option, and the only one that does not survive favicon size.',
    ownsContainer: false,
  },
  {
    id: '10-aperture',
    name: 'Aperture',
    note: 'An octagon whose negative space is a reader’s eye. Holds its shape small; the pupil closes by 20px.',
    ownsContainer: false,
  },
]

const BY_ID = new Map(LOGO_PRESETS.map((p) => [p.id, p]))

export const logoPreset = (id: string | null | undefined): LogoPreset | null =>
  (id && BY_ID.get(id as LogoPresetId)) || null

export const isLogoPresetId = (id: string): id is LogoPresetId => BY_ID.has(id as LogoPresetId)
