'use client'

/**
 * Tiny fetch wrapper for the comment and series islands. Every route answers `{ data }`
 * or `{ error, message? }` (docs/16), so callers get a discriminated union back.
 */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; message: string }

export async function api<T>(url: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      credentials: 'same-origin',
      ...init,
      headers: {
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    })
    const json = (await res.json().catch(() => ({}))) as {
      data?: T
      error?: string
      message?: string
    }
    if (!res.ok || json.error !== undefined || json.data === undefined) {
      return {
        ok: false,
        status: res.status,
        error: json.error ?? 'error',
        message: json.message ?? '',
      }
    }
    return { ok: true, data: json.data }
  } catch {
    return { ok: false, status: 0, error: 'network', message: '' }
  }
}

export const postJson = <T>(url: string, body: unknown) =>
  api<T>(url, { method: 'POST', body: JSON.stringify(body) })
export const patchJson = <T>(url: string, body: unknown) =>
  api<T>(url, { method: 'PATCH', body: JSON.stringify(body) })
export const putJson = <T>(url: string, body: unknown) =>
  api<T>(url, { method: 'PUT', body: JSON.stringify(body) })
export const del = <T>(url: string) => api<T>(url, { method: 'DELETE' })
