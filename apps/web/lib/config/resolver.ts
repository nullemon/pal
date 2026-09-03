import 'server-only'
import { configureCredentials } from '@palscans/core'
import { resolveConfig } from './store'

/**
 * Hand the store to the modules the web app shares with the worker (docs/19).
 *
 * `lib/notifications/config.ts` and `lib/discord/client.ts` are imported by both apps, so
 * neither may import `./store` — it is `server-only` and reads through Next's cache, and the
 * worker has neither. They read through `@palscans/core`'s credential slot instead, and this
 * is the web half of that: `lib/config/install.ts` points the slot
 * at `resolveConfig()`, which is tagged and purged on every admin save, so a VAPID key or a
 * bot token typed into the panel is live on the next request.
 *
 * Web-only consumers — OAuth, Stripe, the mailer, Turnstile — skip the slot and call
 * `configValue()` directly; there is nothing to inject when there is only one implementation.
 *
 * Without this call (unit tests, `next build`) the slot stays empty and every one of those
 * modules falls back to the environment, which is exactly the behaviour they had before.
 */
export const installCredentialResolver = (): void => {
  configureCredentials(async () => (await resolveConfig()).values)
}
