/**
 * "2d 4h" · "4h 12m" · "9:58" — the same shape as core's `countdown()`, except that under an
 * hour it counts in minutes *and seconds*.
 *
 * Core's floors at "1m", which is right for a release schedule days out and wrong for the
 * early-access window: a ten-minute countdown that reads "1m" for its last sixty seconds looks
 * broken exactly when the reader is watching it. Kept here rather than in `@palscans/core` so
 * the client islands that use it (the chapter list, the locked-chapter gate) pull one function
 * instead of the package barrel.
 */
export const countdownSeconds = (until: Date | string | number, nowMs: number): string => {
  const target = until instanceof Date ? until.getTime() : new Date(until).getTime()
  const diff = Math.max(0, Math.round((target - nowMs) / 1000))
  const d = Math.floor(diff / 86400)
  const h = Math.floor((diff % 86400) / 3600)
  const m = Math.floor((diff % 3600) / 60)
  const s = diff % 60
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  return `${m}:${String(s).padStart(2, '0')}`
}
