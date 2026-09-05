import { z } from 'zod'

/**
 * zod shapes shared by the announcement / page editors and their `/api/admin` route
 * handlers (same split as `components/admin/schemas.ts`). Client-safe: no database imports.
 *
 * `body` travels as the Markdown subset from `./markdown.ts`; the route converts it to the
 * stored rich-text JSON, so the wire format is what the operator actually typed.
 */

export const contentStateSchema = z.enum(['draft', 'scheduled', 'published', 'unlisted', 'removed'])
export type ContentState = z.infer<typeof contentStateSchema>

/** The states an operator picks from: `removed` is reached by deleting, never by a dropdown. */
export const EDITABLE_STATES: readonly ContentState[] = [
  'draft',
  'scheduled',
  'published',
  'unlisted',
]

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** `MAX_JSON_BYTES` is 64 KB for the whole request, so the body itself stops short of it. */
export const MAX_BODY_CHARS = 40_000

const slugField = z.string().trim().toLowerCase().min(1).max(80).regex(SLUG_PATTERN)

const bodyField = z.string().max(MAX_BODY_CHARS)

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? null : s))
    .nullable()

export const announcementDocSchema = z.object({
  title: z.string().trim().min(1).max(200),
  slug: slugField,
  body: bodyField,
  excerpt: nullableText(300),
  coverKey: nullableText(300),
  tags: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .min(1)
        .max(30)
        .regex(/^[a-z0-9][a-z0-9-]*$/),
    )
    .max(10),
  state: contentStateSchema,
  /** ISO timestamp; empty means "now" when the state is `published`. */
  publishedAt: z.string().datetime({ offset: true }).nullable(),
})
export type AnnouncementDoc = z.infer<typeof announcementDocSchema>

export const pageDocSchema = z.object({
  title: z.string().trim().min(1).max(200),
  slug: slugField,
  body: bodyField,
  state: contentStateSchema,
})
export type PageDoc = z.infer<typeof pageDocSchema>

export const EMPTY_ANNOUNCEMENT: AnnouncementDoc = {
  title: '',
  slug: '',
  body: '',
  excerpt: null,
  coverKey: null,
  tags: [],
  state: 'draft',
  publishedAt: null,
}

export const EMPTY_PAGE: PageDoc = { title: '', slug: '', body: '', state: 'published' }

/**
 * The slugs with a route of their own (`apps/web/app/(site)/{dmca,terms,privacy}` and the
 * contact form). Every *other* published page is served by the `[slug]` catch-all, so the
 * distinction is now only about which template renders — not about whether the page exists.
 */
export const RENDERED_PAGE_SLUGS: readonly string[] = ['dmca', 'terms', 'privacy', 'contact']

/**
 * Where a page shows on the site. Every slug has a path now: `app/(site)/[slug]` picks up
 * anything without a dedicated route, so a page created in the panel is reachable without a
 * deploy. Null only for a slug that could never be a page.
 */
export const publicPagePath = (slug: string): string | null =>
  slug && !slug.startsWith('_') && !slug.startsWith('api') ? `/${slug}` : null

/** `changelog, release` → `['changelog', 'release']`, deduped, in the order typed. */
export const parseTags = (input: string): string[] => {
  const out: string[] = []
  for (const raw of input.split(/[,\n]/)) {
    const tag = raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
    if (tag && !out.includes(tag)) out.push(tag)
  }
  return out.slice(0, 10)
}

/** `<input type="datetime-local">` ⇄ ISO. Both sides work in the browser's own zone. */
export const toLocalInput = (iso: string | null): string => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const fromLocalInput = (value: string): string | null => {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
