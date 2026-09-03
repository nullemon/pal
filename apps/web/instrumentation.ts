/**
 * Process startup (Next.js `register`). Runs once per server process, before the first
 * request.
 *
 * Its job is to point the storage adapter at the operator's stored credentials (docs/19) so
 * an R2 key typed into the admin panel is used instead of the environment. Guarded by
 * runtime: the edge bundle has neither the database nor `node:crypto`.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { installStorageResolver, refreshConfigSnapshot } = await import('./lib/config/snapshot')
  const { installCredentialResolver } = await import('./lib/config/resolver')
  installStorageResolver()
  // The same store, handed to the modules the worker also imports (notifications, Discord).
  installCredentialResolver()
  // Warm the mirrored values so the very first render already has the stored CDN hostname
  // rather than the environment's. A failure here is not fatal — the seed is the environment.
  await refreshConfigSnapshot()
}
