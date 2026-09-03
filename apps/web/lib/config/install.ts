import 'server-only'
import { installCredentialResolver } from './resolver'
import { installStorageResolver, refreshConfigSnapshot } from './snapshot'

/**
 * Installs the config resolvers **from inside the app's own module graph**.
 *
 * `instrumentation.ts` is the obvious place for this and it does not work: Next bundles it
 * separately, so module-level state written there — the storage resolver in
 * `@palscans/core/storage`, the mirror in `./mirror` — is invisible to request handlers.
 * Verified rather than assumed: with the resolver installed only from instrumentation, a
 * request read `driver: "fs"` while the panel held `s3`, which would have sent uploads to
 * local disk instead of the operator's bucket.
 *
 * So installation happens as an import side effect of this module, and the modules that
 * actually need it import this one. That puts it in the same graph as the code that reads it.
 */

let installed = false
if (!installed) {
  installStorageResolver()
  // The credential slot in @palscans/core, for the modules the web app shares with the
  // worker (notifications, Discord, mail). Same reasoning, same failure if it is installed
  // from instrumentation instead: the slot stays empty and those modules quietly read the
  // environment, ignoring anything typed into the panel.
  installCredentialResolver()
  installed = true
}

/**
 * Warm the synchronous mirror before building storage URLs.
 *
 * The URL helpers (`mediaUrl`, `storageSrc`, …) are synchronous, so they cannot await the
 * store themselves. Every one of them is reached from an async loader, and those await this
 * first — which is what makes a CDN hostname set in the panel appear in the very first
 * render rather than the second.
 *
 * Not memoised per request on purpose: the read underneath is already an `unstable_cache`
 * entry, so calling this on every loader costs a map lookup, and React's `cache()` is not
 * reliably available inside an `unstable_cache` callback, which is exactly where several of
 * these loaders run.
 */
export const ensureConfig = async (): Promise<void> => {
  await refreshConfigSnapshot()
}
