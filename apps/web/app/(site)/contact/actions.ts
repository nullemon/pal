'use server'

import { messages } from '@palscans/core/messages'
import { verifyTurnstile } from '@/lib/auth/turnstile'
import {
  contactSchema,
  createReport,
  type FormState,
  fieldErrors,
  formRateLimited,
  formValues,
} from '@/lib/seo/legal'

/**
 * docs/13 "Contact page: form → reports queue" (kind = 'contact').
 *
 * The same three gates as `/dmca`, in the same order and for the same reason: the honeypot
 * inside `contactSchema`, then 5 submissions per hour per IP, then Turnstile — a network
 * round trip, so it goes last and only for a request that would otherwise be accepted.
 * This form was the one public form without the challenge, and it is the one that mails an
 * acknowledgement to an address the submitter types: an open form that sends mail on demand
 * is a spam relay pointed at whoever is typed into it.
 */
export async function submitContact(_prev: FormState, data: FormData): Promise<FormState> {
  const parsed = contactSchema.safeParse(formValues(data))
  if (!parsed.success)
    return {
      status: 'error',
      message: messages.errors.validation,
      fields: fieldErrors(parsed.error),
    }
  if (await formRateLimited('contact'))
    return { status: 'error', message: messages.errors.rateLimited }
  const token = data.get('turnstile')
  if (!(await verifyTurnstile(typeof token === 'string' ? token : undefined)))
    return { status: 'error', message: messages.legal.contact.challengeFailed }
  const v = parsed.data
  try {
    const id = await createReport({
      kind: 'contact',
      targetType: 'site',
      targetId: null,
      reporterEmail: v.email,
      reason: `[${v.topic}] ${v.subject}`,
      detail: v.message,
      payload: { name: v.name, topic: v.topic, received_at: new Date().toISOString() },
    })
    return { status: 'ok', id, email: v.email }
  } catch {
    return { status: 'error', message: messages.legal.contact.failed }
  }
}
