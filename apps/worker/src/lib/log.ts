const stamp = () => new Date().toISOString()

/**
 * Anything JSON-serialisable: the notification passes hand their own summary interfaces
 * straight in, and an `interface` carries no implicit index signature.
 */
type LogMeta = object

export const log = {
  info: (msg: string, meta?: LogMeta) =>
    console.log(`${stamp()} [worker] ${msg}${meta ? ` ${JSON.stringify(meta)}` : ''}`),
  warn: (msg: string, meta?: LogMeta) =>
    console.warn(`${stamp()} [worker] ${msg}${meta ? ` ${JSON.stringify(meta)}` : ''}`),
  error: (msg: string, err?: unknown) =>
    console.error(`${stamp()} [worker] ${msg}`, err instanceof Error ? err.message : err),
}
