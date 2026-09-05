import { watermarkSettingSchema } from '@palscans/core/watermark'
import { z } from 'zod'
import { LOGO_PRESET_IDS } from '@/lib/chrome/presets'
import { BRAND_SLOTS, type BrandSlot } from '@/lib/chrome/schema'

/**
 * Appearance -> Watermark. The schema lives in `@palscans/core/watermark` so the admin
 * screen, the API route and the worker that burns the mark in all validate one definition;
 * that module pulls in nothing but zod, which is what keeps this file client-safe.
 */
export { BRAND_SLOTS, type BrandSlot, watermarkSettingSchema }
export type WatermarkSetting = z.infer<typeof watermarkSettingSchema>

export const DIRECTIONS = ['A', 'B', 'C', 'D', 'E', 'F'] as const
export type Direction = (typeof DIRECTIONS)[number]

/**
 * Which directions exist as layout implementations today (docs/04: unbuilt cards are
 * disabled). Client-safe on purpose — `lib/layouts/` holds the components and their
 * `satisfies` clauses fail the typecheck if this list and the registry disagree.
 */
export const BUILT_LAYOUTS = {
  home: ['A', 'B', 'C', 'D', 'E', 'F'],
  series: ['A', 'B', 'C', 'D', 'E', 'F'],
} as const satisfies Record<'home' | 'series', readonly Direction[]>

export const layoutsSettingSchema = z.object({
  home: z.enum(DIRECTIONS),
  series: z.enum(DIRECTIONS),
  reader: z.object({ default_mode: z.enum(['strip', 'paged']) }),
  ads: z.object({
    skyscrapers: z.boolean(),
    sky_size: z.enum(['160x600', '300x600']),
    mobile_interval: z.union([z.literal(0), z.literal(2), z.literal(4), z.literal(6)]),
    end_slot: z.boolean(),
  }),
})
export type LayoutsSetting = z.infer<typeof layoutsSettingSchema>

/**
 * Appearance → Brand (docs/15). The document itself lives in `lib/chrome/schema.ts`, next to
 * the resolver that reads it; these are the shapes the *screen* posts — the text fields, and
 * the three steps of an upload.
 */
export const brandFormSchema = z.object({
  name: z.string().trim().min(1).max(60),
  tagline: z.string().trim().max(200),
  wordmark: z.enum(['logo', 'logo+name', 'name']),
  /** One of the ten directions in `design/logos/`, or null for "use my own". */
  logo_preset: z.enum(LOGO_PRESET_IDS).nullable(),
  monogram_bg: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .transform((s) => s.toLowerCase()),
})
export type BrandForm = z.infer<typeof brandFormSchema>

export const brandAssetSlotSchema = z.object({ slot: z.enum(BRAND_SLOTS) })

/** SVG is allowed here and nowhere else — docs/15 prefers it for a logo. */
export const BRAND_UPLOAD_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
  'image/svg+xml',
] as const

export const brandAssetIntentSchema = z.object({
  slot: z.enum(BRAND_SLOTS),
  name: z.string().min(1).max(200),
  bytes: z
    .number()
    .int()
    .positive()
    .max(2 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  type: z.enum(BRAND_UPLOAD_TYPES),
})

export const brandAssetConfirmSchema = z.object({
  slot: z.enum(BRAND_SLOTS),
  key: z.string().min(1).max(300),
})

export const themeDraftSchema = z.object({ settings: z.record(z.string(), z.unknown()) })
export const themePublishSchema = z.object({ versionId: z.number().int().positive().optional() })
export const presetSchema = z.object({
  name: z.string().trim().min(1).max(60),
  settings: z.record(z.string(), z.unknown()),
})
