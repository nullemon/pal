'use client'

import { messages } from '@palscans/core/messages'

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; message: string; status: number }

/** JSON call to an /api/me route; normalises `{ data } | { error }`. */
export async function api<T>(url: string, body?: unknown, method = 'POST'): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    })
    const json = (await res.json().catch(() => ({}))) as {
      data?: T
      error?: string
      message?: string
    }
    if (!res.ok || json.error)
      return {
        ok: false,
        status: res.status,
        error: json.error ?? 'error',
        message: json.message ?? messages.errors.generic,
      }
    return { ok: true, data: json.data as T }
  } catch {
    return { ok: false, status: 0, error: 'network', message: messages.errors.network }
  }
}

export const inputClasses =
  'h-10 w-full rounded-md border border-line bg-surface-2 px-3 text-sm text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-brand disabled:opacity-60'
export const labelClasses = 'text-[13px] font-semibold text-fg'
export const selectClasses =
  'h-9 rounded-md border border-line bg-surface-2 px-2 text-[13px] font-semibold text-fg outline-none focus:border-brand'
