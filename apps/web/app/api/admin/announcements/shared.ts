import { messages } from '@palscans/core/messages'
import type { RichTextJson } from '@palscans/db'
import { isDocEmpty, markdownToDoc } from '@/components/admin/content/markdown'
import type { AnnouncementDoc } from '@/components/admin/content/schemas'
import { fail } from '@/lib/auth'

/**
 * What the announcement create and update handlers share: the Markdown → rich-text step and
 * the publish-time rule. Kept out of `route.ts` so Next only exports handlers from there.
 */

export const AUDITED = [
  'slug',
  'title',
  'excerpt',
  'coverKey',
  'state',
  'tags',
  'publishedAt',
] as const

export type BodyResult = { ok: true; body: RichTextJson } | { ok: false; response: Response }

/** An empty body would render as a blank page on the site, so it is refused on save. */
export const bodyFrom = (markdown: string): BodyResult => {
  const doc = markdownToDoc(markdown)
  if (isDocEmpty(doc))
    return { ok: false, response: fail(400, 'validation', messages.adminContent.body.required) }
  return { ok: true, body: doc as RichTextJson }
}

/**
 * The date field is the source of truth. Publishing with it empty stamps now, but editing an
 * already published post keeps its original date so it does not jump back up the feed.
 */
export const publishAt = (doc: AnnouncementDoc, existing: Date | null): Date | null => {
  if (doc.publishedAt) return new Date(doc.publishedAt)
  return doc.state === 'published' ? (existing ?? new Date()) : null
}
