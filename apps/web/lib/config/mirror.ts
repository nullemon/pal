/**
 * The two settings that must be readable synchronously (docs/19): the storage driver and the
 * public CDN hostname. Image URLs are built inside plain sync functions all over the render
 * tree, so these cannot be awaited without turning most of it async for no benefit.
 *
 * Deliberately dependency-free — no database, no `server-only` — so it is safe to import from
 * anywhere. `lib/config/snapshot.ts` owns filling it in; this module only holds the value and
 * seeds it from the environment so the site renders correctly before the first database read.
 */

export interface ConfigMirror {
  driver: 'fs' | 's3'
  cdnUrl: string
}

const seed = (): ConfigMirror => ({
  driver: process.env.STORAGE_DRIVER === 's3' ? 's3' : 'fs',
  cdnUrl: (process.env.PUBLIC_CDN_URL ?? '').trim(),
})

let current: ConfigMirror | undefined

/** The current values. Never throws, never blocks. */
export const configMirror = (): ConfigMirror => (current ??= seed())

export const setConfigMirror = (next: ConfigMirror): void => {
  current = next
}

/** The CDN base with any trailing slashes removed — every caller wanted that. */
export const cdnBase = (): string => configMirror().cdnUrl.replace(/\/+$/, '')
