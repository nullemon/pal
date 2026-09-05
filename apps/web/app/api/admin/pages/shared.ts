import { adminMessages } from '@palscans/core/messages/admin'
import type { RichTextJson } from '@palscans/db'
import { isDocEmpty, markdownToDoc } from '@/components/admin/content/markdown'
import { fail } from '@/lib/auth'

/** Shared by the page create and update handlers; `route.ts` may only export handlers. */

export const AUDITED = ['slug', 'title', 'state', 'version'] as const

export type BodyResult = { ok: true; body: RichTextJson } | { ok: false; response: Response }

/** A legal page with an empty body would render as a bare heading — refuse it. */
export const bodyFrom = (markdown: string): BodyResult => {
  const doc = markdownToDoc(markdown)
  if (isDocEmpty(doc))
    return {
      ok: false,
      response: fail(400, 'validation', adminMessages.adminContent.body.required),
    }
  return { ok: true, body: doc as RichTextJson }
}
