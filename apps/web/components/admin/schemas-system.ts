import { z } from 'zod'

export const AD_SLOTS = [
  'home_top',
  'home_sidebar',
  'home_infeed',
  'series_top',
  'series_sidebar',
  'reader_end',
  'mobile_anchor',
] as const
export type AdSlotId = (typeof AD_SLOTS)[number]

export const AD_SLOT_SIZES: Record<AdSlotId, { desktop: string; mobile: string }> = {
  home_top: { desktop: '970×90', mobile: '320×100' },
  home_sidebar: { desktop: '300×250', mobile: '—' },
  home_infeed: { desktop: 'native card', mobile: 'native card' },
  series_top: { desktop: '728×90', mobile: '320×100' },
  series_sidebar: { desktop: '300×250', mobile: '300×250' },
  reader_end: { desktop: '336×280', mobile: '300×250' },
  mobile_anchor: { desktop: '—', mobile: '320×50' },
}

const slot = z.object({ enabled: z.boolean(), tag: z.string().max(20_000).nullable() })

export const adsSettingSchema = z.object({
  slots: z.object(
    Object.fromEntries(AD_SLOTS.map((s) => [s, slot])) as Record<AdSlotId, typeof slot>,
  ),
  ads_txt: z.string().max(100_000),
})
export type AdsSetting = z.infer<typeof adsSettingSchema>

export const siteSettingSchema = z.object({
  name: z.string().trim().min(1).max(60),
  tagline: z.string().trim().max(200),
  url: z.string().trim().url(),
  discord_url: z.string().trim().url().or(z.literal('')),
  registration: z.enum(['open', 'invite', 'closed']),
  maintenance: z.object({ enabled: z.boolean(), eta: z.string().trim().max(120).nullable() }),
})
export type SiteSetting = z.infer<typeof siteSettingSchema>

export const flagSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z0-9_.-]{2,60}$/),
  enabled: z.enum(['off', 'on', 'percentage']),
  percentage: z.number().int().min(0).max(100),
  description: z.string().trim().max(200).nullable(),
})
