import { fmt, messages } from '@palscans/core/messages'
import type { RejectCode } from './pipeline'

/** HTTP status and reader-facing copy for every pipeline rejection. */
export const rejectResponse = (
  code: RejectCode,
  extra: { maxMentions?: number; retryAfterSec?: number } = {},
): { status: number; message: string } => {
  const t = messages.commentThread
  switch (code) {
    case 'disabled':
      return { status: 403, message: t.disabled }
    case 'unverified':
      return { status: 403, message: messages.comments.verifyToComment }
    case 'banned':
      return { status: 403, message: t.banned }
    case 'too_new':
      return { status: 403, message: t.accountTooNew }
    case 'rate_limited':
      return { status: 429, message: messages.comments.rateLimited }
    case 'turnstile':
      return { status: 403, message: t.challengeFailed }
    case 'too_long':
      return { status: 400, message: t.tooLong }
    case 'empty':
      return { status: 400, message: messages.errors.validation }
    case 'too_many_mentions':
      return { status: 400, message: fmt(t.tooManyMentions, { n: extra.maxMentions ?? 5 }) }
    case 'blocked_words':
      return { status: 422, message: t.blockedWords }
    case 'misleading_link':
      return { status: 400, message: t.misleadingLink }
    case 'invalid_image':
      return { status: 400, message: messages.errors.validation }
    case 'not_found':
      return { status: 404, message: t.notFound }
    case 'locked':
      return { status: 403, message: t.repliesClosed }
  }
}
