import { z } from 'zod'

export const DIRECTIONS = ['A', 'B', 'C', 'D', 'E', 'F'] as const
export type Direction = (typeof DIRECTIONS)[number]

/** Which directions exist as layout implementations today (docs/04: unbuilt cards are disabled). */
export const BUILT_LAYOUTS: Record<'home' | 'series', readonly Direction[]> = {
  home: ['A'],
  series: ['B'],
}

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

export const themeDraftSchema = z.object({ settings: z.record(z.string(), z.unknown()) })
export const themePublishSchema = z.object({ versionId: z.number().int().positive().optional() })
export const presetSchema = z.object({
  name: z.string().trim().min(1).max(60),
  settings: z.record(z.string(), z.unknown()),
})
