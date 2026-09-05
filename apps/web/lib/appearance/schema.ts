import { z } from 'zod'

/**
 * The appearance document (docs/15): the settings the operator edits. Unknown fields are
 * dropped, missing ones fall back to the shipped Violet Classic defaults, so a partial or
 * older document always resolves.
 */
const hex = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .transform((s) => s.toLowerCase())

/**
 * This document carries the theme — colour, typography, shape — and nothing else. Brand and
 * identity used to have a `brand` block here that nothing read or wrote; it now lives in
 * `settings.brand` and `settings.site`, edited by Appearance → Brand and resolved by
 * `lib/chrome/`. Unknown keys are dropped, so an older stored document still parses.
 */
export const appearanceSchema = z.object({
  version: z.number().int().catch(1),
  color: z.object({
    accent: hex.catch('#7c3aed'),
    secondary: hex.catch('#f5c451'),
    derive_secondary: z.boolean().catch(false),
    surface_tint: z.number().min(0).max(0.08).catch(0.02),
    type: z.object({
      manhwa: hex.catch('#e5484d'),
      manhua: hex.catch('#12a594'),
      manga: hex.catch('#3b82f6'),
      comic: hex.catch('#a78bfa'),
    }),
    status: z.object({
      ongoing: hex.catch('#3b82f6'),
      completed: hex.catch('#22c55e'),
      hiatus: hex.catch('#f59e0b'),
      cancelled: hex.catch('#6f6890'),
    }),
  }),
  theme: z.object({
    default: z.enum(['dark', 'light', 'system']).catch('dark'),
    allow_switch: z.boolean().catch(true),
    reader_background: z.enum(['black', 'dark', 'sepia', 'white']).catch('dark'),
    no_shimmer: z.boolean().catch(false),
  }),
  typography: z.object({
    display: z.string().max(60).catch('Archivo Variable'),
    body: z.string().max(60).catch('Plus Jakarta Sans Variable'),
    base_size: z.union([z.literal(15), z.literal(16), z.literal(17)]).catch(16),
    heading_weight: z.union([z.literal(600), z.literal(700), z.literal(800)]).catch(800),
    pairing: z.string().max(60).catch('Bold condensed + humanist'),
  }),
  shape: z.object({
    radius: z.enum(['sharp', 'soft', 'round']).catch('soft'),
    pill_buttons: z.boolean().catch(false),
    /** Coloured outer glow on pinned rows and featured cards. Off by default: it reads as noise on a dense grid. */
    glow: z.boolean().catch(false),
    card_style: z.enum(['flat', 'bordered', 'elevated']).catch('flat'),
    density: z.enum(['comfortable', 'compact']).catch('comfortable'),
    cover_grid: z.enum(['title-below', 'title-hover', 'title-always']).catch('title-below'),
    cover_aspect: z.enum(['2:3', '3:4']).catch('2:3'),
    badges: z
      .object({
        rating: z.boolean().catch(true),
        type: z.boolean().catch(true),
        new_hours: z.number().int().min(0).catch(24),
      })
      .catch({ rating: true, type: true, new_hours: 24 }),
  }),
  layout: z.record(z.string(), z.unknown()).catch({}),
  reader: z.record(z.string(), z.unknown()).catch({}),
  copy: z.record(z.string(), z.string()).catch({}),
})

export type AppearanceDoc = z.infer<typeof appearanceSchema>

/** Coerce anything stored (or posted) into a full document. */
export const parseAppearance = (raw: unknown): AppearanceDoc => {
  const base = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return appearanceSchema.parse({
    ...base,
    color: {
      type: {},
      status: {},
      ...(typeof base.color === 'object' && base.color ? base.color : {}),
    },
    theme: typeof base.theme === 'object' && base.theme ? base.theme : {},
    typography: typeof base.typography === 'object' && base.typography ? base.typography : {},
    shape: typeof base.shape === 'object' && base.shape ? base.shape : {},
  })
}

export const DEFAULT_APPEARANCE: AppearanceDoc = parseAppearance({})

/** Accent presets from the Theme mockup. */
export const ACCENT_PRESETS = {
  violet: '#8b5cf6',
  indigo: '#6366f1',
  blue: '#3b82f6',
  teal: '#14b8a6',
  green: '#22c55e',
  amber: '#f59e0b',
  rose: '#f43f5e',
  red: '#ef4444',
  mono: '#d4d4d8',
} as const

export const FONT_CHOICES = ['Archivo Variable', 'Plus Jakarta Sans Variable', 'system-ui'] as const

export const PAIRINGS: Record<string, { display: string; body: string }> = {
  'Bold condensed + humanist': { display: 'Archivo Variable', body: 'Plus Jakarta Sans Variable' },
  'Geometric + grotesque': { display: 'Plus Jakarta Sans Variable', body: 'Archivo Variable' },
  Editorial: { display: 'Archivo Variable', body: 'Archivo Variable' },
  'System only': { display: 'system-ui', body: 'system-ui' },
}
