const stamp = () => new Date().toISOString()

export const log = {
  info: (msg: string, meta?: Record<string, unknown>) =>
    console.log(`${stamp()} [worker] ${msg}${meta ? ` ${JSON.stringify(meta)}` : ''}`),
  warn: (msg: string, meta?: Record<string, unknown>) =>
    console.warn(`${stamp()} [worker] ${msg}${meta ? ` ${JSON.stringify(meta)}` : ''}`),
  error: (msg: string, err?: unknown) =>
    console.error(`${stamp()} [worker] ${msg}`, err instanceof Error ? err.message : err),
}
