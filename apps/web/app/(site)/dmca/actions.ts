'use server'

import { fmt, messages } from '@palscans/core/messages'
import { headers } from 'next/headers'
import { clientIp } from '@/lib/auth'
import { verifyTurnstile } from '@/lib/auth/turnstile'
import {
  createReport,
  dmcaSchema,
  type FormState,
  fieldErrors,
  formRateLimited,
  formValues,
  sendAcknowledgement,
  seriesTargetFor,
} from '@/lib/seo/legal'
import { chapterTargetFor, noticeBodyFor, recordTakedown } from './takedown'

/**
 * docs/07: the notice form records the notice in `takedowns` (the compliance ledger the
 * admin queue works through), files a `reports` row with `kind = 'dmca'` pointing at it so
 * the moderation queue still sees DMCA as its own lane, and emails an acknowledgement.
 *
 * Three gates, all the ones the other public forms use, in the order that costs least:
 * the honeypot inside `dmcaSchema`, then 5 submissions per hour per IP, then Turnstile —
 * which is a network round trip, so it goes last and only for a request that would otherwise
 * be accepted.
 */
export async function submitDmca(_prev: FormState, data: FormData): Promise<FormState> {
  const parsed = dmcaSchema.safeParse(formValues(data))
  if (!parsed.success)
    return {
      status: 'error',
      message: messages.errors.validation,
      fields: fieldErrors(parsed.error),
    }
  if (await formRateLimited('dmca'))
    return { status: 'error', message: messages.errors.rateLimited }
  const token = data.get('turnstile')
  const ip = clientIp(await headers())
  if (!(await verifyTurnstile(typeof token === 'string' ? token : undefined, ip)))
    return { status: 'error', message: messages.takedowns.challengeFailed }
  const v = parsed.data
  try {
    const [target, chapter] = await Promise.all([seriesTargetFor(v.urls), chapterTargetFor(v.urls)])
    const seriesId = target?.id ?? chapter?.seriesId ?? null
    const id = await recordTakedown({
      claimant: v.claimant,
      claimantEmail: v.email,
      noticeBody: noticeBodyFor(v),
      seriesId,
      chapterId: chapter?.id ?? null,
    })
    await createReport({
      kind: 'dmca',
      targetType: seriesId ? 'series' : 'site',
      targetId: seriesId,
      reporterEmail: v.email,
      reason: `DMCA notice from ${v.claimant}`,
      detail: `${v.work}\n\nURLs:\n${v.urls.join('\n')}`,
      payload: {
        takedown_id: id,
        claimant: v.claimant,
        urls: v.urls,
        work: v.work,
        signature: v.signature,
        good_faith: true,
        accuracy: true,
        series_title: target?.title ?? null,
        chapter_id: chapter?.id ?? null,
        received_at: new Date().toISOString(),
      },
    })
    await sendAcknowledgement(
      v.email,
      fmt(messages.legal.dmca.ackSubject, { id }),
      fmt(messages.legal.dmca.ackBody, { id, count: v.urls.length }),
    )
    return { status: 'ok', id, email: v.email }
  } catch (error) {
    console.error('[dmca] notice could not be recorded', error)
    return { status: 'error', message: messages.legal.dmca.failed }
  }
}
