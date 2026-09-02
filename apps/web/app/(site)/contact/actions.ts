'use server'

import { messages } from '@palscans/core/messages'
import {
  contactSchema,
  createReport,
  type FormState,
  fieldErrors,
  formRateLimited,
  formValues,
} from '@/lib/seo/legal'

/** docs/13 "Contact page: form → reports queue" (kind = 'contact'). */
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
