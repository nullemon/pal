import { getDb, getSetting } from '@palscans/db'
import { unstable_cache } from 'next/cache'
import { z } from 'zod'

/**
 * The two admin rows the reader reads (docs/04 Appearance → Layouts, docs/11):
 * `settings.layouts.reader` and `settings.ads.reader`. Unknown or malformed values fall
 * back to the documented defaults so a bad save never breaks the reader.
 */
export const readerLayoutSchema = z.object({
  default_mode: z.enum(['strip', 'paged']).catch('strip'),
  background: z.enum(['black', 'dark', 'sepia', 'white']).catch('dark'),
})
export type ReaderLayout = z.infer<typeof readerLayoutSchema>

export const readerAdsSchema = z.object({
  skyscrapers: z.boolean().catch(true),
  sky_size: z.enum(['160x600', '300x600']).catch('160x600'),
  mobile_interval: z.union([z.literal(0), z.literal(2), z.literal(4), z.literal(6)]).catch(4),
  end_slot: z.boolean().catch(true),
})
export type ReaderAdsSetting = z.infer<typeof readerAdsSchema>

const slotSchema = z
  .object({ enabled: z.boolean().catch(true), tag: z.string().nullable().catch(null) })
  .catch({ enabled: true, tag: null })

const adsRowSchema = z.object({
  reader: readerAdsSchema.catch(readerAdsSchema.parse({})),
  slots: z
    .object({ reader_sky: slotSchema, reader_instrip: slotSchema, reader_end: slotSchema })
    .partial()
    .catch({}),
})

const layoutsRowSchema = z.object({
  reader: readerLayoutSchema.catch(readerLayoutSchema.parse({})),
})

export interface ReaderSiteSettings {
  layout: ReaderLayout
  ads: ReaderAdsSetting
  /** Ad network tags for the reader's slots, null until Business → Ads is filled in. */
  tags: { sky: string | null; instrip: string | null; end: string | null }
}

export const DEFAULT_READER_SITE_SETTINGS: ReaderSiteSettings = {
  layout: readerLayoutSchema.parse({}),
  ads: readerAdsSchema.parse({}),
  tags: { sky: null, instrip: null, end: null },
}

export const parseReaderSiteSettings = (layouts: unknown, ads: unknown): ReaderSiteSettings => {
  const l = layoutsRowSchema.safeParse(layouts ?? {})
  const a = adsRowSchema.safeParse(ads ?? {})
  return {
    layout: l.success ? l.data.reader : DEFAULT_READER_SITE_SETTINGS.layout,
    ads: a.success ? a.data.reader : DEFAULT_READER_SITE_SETTINGS.ads,
    tags: {
      sky: a.success ? (a.data.slots.reader_sky?.tag ?? null) : null,
      instrip: a.success ? (a.data.slots.reader_instrip?.tag ?? null) : null,
      end: a.success ? (a.data.slots.reader_end?.tag ?? null) : null,
    },
  }
}

/** Cached for 60s and purgeable with `revalidateTag('settings')`, like the discovery pages. */
export const cachedReaderSiteSettings = unstable_cache(
  async (): Promise<ReaderSiteSettings> => {
    const db = await getDb()
    const [layouts, ads] = await Promise.all([
      getSetting<unknown>(db, 'layouts', null),
      getSetting<unknown>(db, 'ads', null),
    ])
    return parseReaderSiteSettings(layouts, ads)
  },
  ['settings', 'reader'],
  { revalidate: 60, tags: ['settings'] },
)
