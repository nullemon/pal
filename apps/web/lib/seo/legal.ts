import { getDb, pages, reports, series } from '@palscans/db'
import { and, eq, isNull } from 'drizzle-orm'
import { unstable_cache } from 'next/cache'
import { headers } from 'next/headers'
import { z } from 'zod'
import { clientIp, getRateLimiter, ipKey } from '@/lib/auth/rate-limit'
import { getMailer } from '@/lib/email'

/**
 * Legal / contact pages (docs/13 "Legal and compliance", docs/07 DMCA): rich text from the
 * `pages` table, and the notice / contact forms that land in the reports queue.
 */

export type LegalSlug = 'dmca' | 'terms' | 'privacy' | 'contact'

export interface LegalPage {
  slug: string
  title: string
  body: unknown
  version: number
  /** ISO string: unstable_cache serialises Dates. */
  updatedAt: string
}

export const loadLegalPage = unstable_cache(
  async (slug: LegalSlug): Promise<LegalPage | null> => {
    const db = await getDb()
    const [row] = await db
      .select({
        slug: pages.slug,
        title: pages.title,
        body: pages.body,
        version: pages.version,
        updatedAt: pages.updatedAt,
      })
      .from(pages)
      .where(and(eq(pages.slug, slug), eq(pages.state, 'published')))
      .limit(1)
    return row
      ? { ...row, version: Number(row.version), updatedAt: row.updatedAt.toISOString() }
      : null
  },
  ['legal_pages'],
  { revalidate: 300, tags: ['settings', 'pages'] },
)

/** The designated agent details shown on /dmca (docs/07) — edited with the site settings later. */
export const DMCA_AGENT = {
  name: 'PALScans DMCA Agent',
  email: 'dmca@palscans.org',
  responseTime: '48 hours',
} as const

export { type FormState, IDLE } from './form-state'

const email = z.string().trim().toLowerCase().email().max(254)
const urlLines = z
  .string()
  .trim()
  .min(1)
  .max(5000)
  .transform((v) =>
    v
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().url().max(2048)).min(1).max(100))

export const dmcaSchema = z.object({
  claimant: z.string().trim().min(2).max(200),
  email,
  urls: urlLines,
  work: z.string().trim().min(10).max(5000),
  signature: z.string().trim().min(2).max(200),
  goodFaith: z.literal('on'),
  accuracy: z.literal('on'),
  /** Honeypot — must stay empty. */
  website: z.string().max(0).optional(),
})

export const contactSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email,
  topic: z.enum(['general', 'billing', 'broken', 'partnership', 'press']),
  subject: z.string().trim().min(2).max(200),
  message: z.string().trim().min(10).max(5000),
  website: z.string().max(0).optional(),
})

/** First zod issue per field, for inline errors. */
export const fieldErrors = (error: z.ZodError): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '')
    if (key && !out[key]) out[key] = issue.message
  }
  return out
}

export const formValues = (data: FormData): Record<string, string> => {
  const out: Record<string, string> = {}
  data.forEach((v, k) => {
    if (typeof v === 'string') out[k] = v
  })
  return out
}

/**
 * 5 submissions per hour per IP for either form (the address is keyed, never stored raw).
 * With no trusted proxy the address is unknown and the form is not pooled into one bucket.
 */
export const formRateLimited = async (form: 'dmca' | 'contact'): Promise<boolean> => {
  const ip = ipKey(clientIp(await headers()))
  if (!ip) return false
  const result = await getRateLimiter().hit(`${form}:ip:${ip}`, 5, 3600)
  return !result.ok
}

/** `/series/<slug>` in a notice URL → the series row, so the ticket targets it. */
export async function seriesTargetFor(urls: readonly string[]) {
  const db = await getDb()
  for (const raw of urls) {
    const m = /\/series\/([a-z0-9-]+)/i.exec(raw)
    if (!m?.[1]) continue
    const [row] = await db
      .select({ id: series.id, title: series.title })
      .from(series)
      .where(and(eq(series.slug, m[1].toLowerCase()), isNull(series.deletedAt)))
      .limit(1)
    if (row) return row
  }
  return null
}

export interface ReportInput {
  kind: 'dmca' | 'contact'
  targetType: string
  targetId: number | null
  reporterEmail: string
  reason: string
  detail: string
  payload: Record<string, unknown>
}

export async function createReport(input: ReportInput): Promise<number> {
  const db = await getDb()
  const [row] = await db
    .insert(reports)
    .values({
      kind: input.kind,
      targetType: input.targetType,
      targetId: input.targetId,
      reporterEmail: input.reporterEmail,
      reason: input.reason,
      detail: input.detail,
      payload: input.payload,
    })
    .returning({ id: reports.id })
  return row?.id ?? 0
}

/** Acknowledgement email — console locally, Resend in production; failures never block the form. */
export async function sendAcknowledgement(
  to: string,
  subject: string,
  text: string,
): Promise<void> {
  try {
    await getMailer().send({ to, subject, text })
  } catch {
    // best-effort
  }
}
