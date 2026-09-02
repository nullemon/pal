'use server'

import { fmt, messages } from '@palscans/core/messages'
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

/** docs/07: the notice form writes `reports` with kind = 'dmca' and emails an acknowledgement. */
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
  const v = parsed.data
  try {
    const target = await seriesTargetFor(v.urls)
    const id = await createReport({
      kind: 'dmca',
      targetType: target ? 'series' : 'site',
      targetId: target?.id ?? null,
      reporterEmail: v.email,
      reason: `DMCA notice from ${v.claimant}`,
      detail: `${v.work}\n\nURLs:\n${v.urls.join('\n')}`,
      payload: {
        claimant: v.claimant,
        urls: v.urls,
        work: v.work,
        signature: v.signature,
        good_faith: true,
        accuracy: true,
        series_title: target?.title ?? null,
        received_at: new Date().toISOString(),
      },
    })
    await sendAcknowledgement(
      v.email,
      fmt(messages.legal.dmca.ackSubject, { id }),
      fmt(messages.legal.dmca.ackBody, { id, count: v.urls.length }),
    )
    return { status: 'ok', id, email: v.email }
  } catch {
    return { status: 'error', message: messages.legal.dmca.failed }
  }
}
