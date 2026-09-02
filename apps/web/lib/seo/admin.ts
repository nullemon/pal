import { DEFAULT_SEO_TEMPLATES } from '@palscans/core'
import { z } from 'zod'
import { SITEMAP_SECTIONS } from './settings'

/**
 * Strict input shapes for the admin SEO API (docs/12 §8). The read-side schemas in
 * ./settings.ts fall back silently; saves must fail loudly with the offending field.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v ? v : null))

const optionalUrl = z
  .string()
  .trim()
  .max(2000)
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^https?:\/\/[^\s]+$/i.test(v), 'Must be an absolute URL')

const template = z.object({
  title: z.string().trim().max(300),
  description: z.string().trim().max(600),
})

export const strictSeoSchemas = {
  identity: z.object({
    site_name: z.string().trim().min(1).max(80),
    separator: z.enum(['·', '—', '|']),
    default_description: z.string().trim().max(400),
    default_og_image_key: optionalText(500),
    logo_key: optionalText(500),
    x_handle: optionalText(40).transform((v) => (v && !v.startsWith('@') ? `@${v}` : v)),
    same_as: z.array(z.string().trim().url()).max(12),
  }),
  templates: z.object({
    home: template,
    series: template,
    chapter: template,
    genre: template,
    rankings: template,
    announcement: template,
  }),
  sitemap: z.object({
    enabled: z.boolean(),
    custom_url: optionalUrl,
    sections: z.array(z.enum(SITEMAP_SECTIONS)),
    include_unlisted: z.boolean(),
    chapters_per_file: z.number().int().min(100).max(50_000),
    indexnow_key: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9-]{8,128}$/, '8–128 letters, digits or dashes')
      .nullable()
      .or(z.literal('').transform(() => null)),
  }),
  feeds: z.object({
    enabled: z.boolean(),
    custom_url: optionalUrl,
    items: z.number().int().min(5).max(200),
    include_early_access: z.boolean(),
  }),
  indexing: z.object({
    site: z.boolean(),
    chapters: z.boolean(),
    profiles: z.boolean(),
    browse_filters: z.boolean(),
  }),
  verification: z.object({
    google: optionalText(200),
    bing: optionalText(200),
    yandex: optionalText(200),
    pinterest: optionalText(200),
  }),
  robots: z.object({
    custom: z
      .string()
      .max(20_000)
      .nullable()
      .transform((v) => (v?.trim() ? v : null)),
    disallow_ai: z.boolean(),
  }),
} as const

export const seoSaveSchema = z.discriminatedUnion('key', [
  z.object({ key: z.literal('identity'), value: strictSeoSchemas.identity }),
  z.object({ key: z.literal('templates'), value: strictSeoSchemas.templates }),
  z.object({ key: z.literal('sitemap'), value: strictSeoSchemas.sitemap }),
  z.object({ key: z.literal('feeds'), value: strictSeoSchemas.feeds }),
  z.object({ key: z.literal('indexing'), value: strictSeoSchemas.indexing }),
  z.object({ key: z.literal('verification'), value: strictSeoSchemas.verification }),
  z.object({ key: z.literal('robots'), value: strictSeoSchemas.robots }),
])
export type SeoSaveInput = z.infer<typeof seoSaveSchema>

export const TEMPLATE_DEFAULTS = DEFAULT_SEO_TEMPLATES

// ---- redirects -------------------------------------------------------------------------

const sitePath = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((v) => v.startsWith('/') && !v.startsWith('//'), 'Must be a site path starting with /')
  .transform((v) => (v.length > 1 ? v.replace(/\/+$/, '') : v))

export const redirectInputSchema = z.object({
  from: sitePath,
  to: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .refine(
      (v) => (v.startsWith('/') && !v.startsWith('//')) || /^https?:\/\/[^\s]+$/i.test(v),
      'Must be a site path or an absolute URL',
    ),
  status: z.union([z.literal(301), z.literal(302)]).default(301),
})
export type RedirectInput = z.infer<typeof redirectInputSchema>

export const redirectsCsvSchema = z.object({ csv: z.string().min(1).max(2_000_000) })

/** `from,to[,status]` per line; a header row is skipped; quotes are tolerated. */
export function parseRedirectsCsv(text: string): {
  rows: RedirectInput[]
  errors: { line: number; message: string }[]
} {
  const rows: RedirectInput[] = []
  const errors: { line: number; message: string }[] = []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  lines.forEach((raw, i) => {
    const line = raw.trim()
    if (!line || line.startsWith('#')) return
    const cells = line.split(',').map((c) => c.trim().replace(/^"(.*)"$/, '$1'))
    if (i === 0 && /^from$/i.test(cells[0] ?? '')) return
    const [from, to, status] = cells
    const parsed = redirectInputSchema.safeParse({
      from,
      to,
      status: status ? Number(status) : 301,
    })
    if (parsed.success) rows.push(parsed.data)
    else errors.push({ line: i + 1, message: parsed.error.issues[0]?.message ?? 'invalid' })
  })
  return { rows, errors }
}

export const validateUrlSchema = z.object({ url: z.string().trim().min(1).max(2048) })

export const previewSchema = z.object({
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{0,199}$/i)
    .optional(),
  templates: strictSeoSchemas.templates.partial().optional(),
})
