'use client'

import { messages } from '@palscans/core/messages'
import type { RequestItem, Suggestions } from './shared'

/**
 * The board's client-side calls. Same `{ data } | { error }` contract as the rest of the
 * site, with one addition: a 409 from `POST /api/requests` carries the request that already
 * exists, because "somebody already asked for this" is only useful if it comes with the row
 * to upvote.
 */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; message: string; request?: RequestItem }

async function call<T>(url: string, init: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      credentials: 'same-origin',
      ...init,
      headers: {
        accept: 'application/json',
        ...(typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
    })
    const json = (await res.json().catch(() => ({}))) as {
      data?: T
      error?: string
      message?: string
      request?: RequestItem
    }
    if (!res.ok || json.error)
      return {
        ok: false,
        status: res.status,
        error: json.error ?? 'error',
        message: json.message ?? messages.errors.generic,
        request: json.request,
      }
    return { ok: true, data: json.data as T }
  } catch {
    return { ok: false, status: 0, error: 'network', message: messages.errors.network }
  }
}

export const postRequest = (body: unknown) =>
  call<{ request: RequestItem; signedIn: boolean }>('/api/requests', {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const postVote = (id: number, vote: boolean) =>
  call<{ id: number; voted: boolean; voteCount: number }>(`/api/requests/${id}/vote`, {
    method: 'POST',
    body: JSON.stringify({ vote }),
  })

export const fetchSuggestions = (q: string, signal?: AbortSignal) =>
  call<Suggestions>(`/api/requests/suggest?q=${encodeURIComponent(q)}`, { method: 'GET', signal })
