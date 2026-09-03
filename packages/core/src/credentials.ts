/**
 * Where operator-entered credentials come from, for code that runs in **both** the web app
 * and the worker (docs/19).
 *
 * `apps/web/lib/config/store.ts` is the web's resolver: it reads the sealed `app_credentials`
 * rows through Next's tagged cache, so a value typed into the admin panel is live on the next
 * request. The worker has no Next cache and cannot import that module, so it installs its own
 * TTL-cached reader (`apps/worker/src/lib/config.ts`).
 *
 * Modules shared by the two — `lib/notifications/config.ts`, `lib/discord/client.ts` — must
 * not know which of those is underneath, so they read through the slot registered here. It
 * is injected rather than imported for the same reason `configureStorage` is: this package
 * must not depend on the database.
 *
 * Precedence is **panel over environment**, and it is the same everywhere: a stored value
 * wins, an unset one falls back to the environment variable that already works today, and a
 * resolver that throws (no database yet, or it is down) degrades to the environment rather
 * than taking the feature down.
 */

/** Registry id → stored value. Ids not stored may be absent or empty; both mean "unset". */
export type CredentialResolver = () => Promise<Readonly<Record<string, string>>>

let resolver: CredentialResolver | undefined

/** Register the process's reader. Passing `undefined` goes back to environment-only. */
export const configureCredentials = (next: CredentialResolver | undefined): void => {
  resolver = next
}

/** Whether a reader is installed — the panel path is live only when one is. */
export const credentialsInstalled = (): boolean => resolver !== undefined

/** The stored values, or `{}` when there is no resolver or it failed. Never throws. */
export const storedCredentials = async (): Promise<Readonly<Record<string, string>>> => {
  if (!resolver) return {}
  try {
    return await resolver()
  } catch {
    return {}
  }
}

const pick = (
  stored: Readonly<Record<string, string>>,
  id: string,
  envVar: string,
  env: Record<string, string | undefined>,
): string => (stored[id] ?? '').trim() || (env[envVar] ?? '').trim()

/** One credential: the stored value, else the environment variable, else `''`. */
export const credentialValue = async (
  id: string,
  envVar: string,
  env: Record<string, string | undefined> = process.env,
): Promise<string> => pick(await storedCredentials(), id, envVar, env)

/**
 * Several credentials in one read of the store — `{ token: ['discord.bot_token',
 * 'DISCORD_BOT_TOKEN'], … }` in, the resolved values out. Prefer this over repeated
 * `credentialValue` calls so a status panel sees one consistent snapshot.
 */
export const credentialValues = async <K extends string>(
  spec: Readonly<Record<K, readonly [id: string, envVar: string]>>,
  env: Record<string, string | undefined> = process.env,
): Promise<Record<K, string>> => {
  const stored = await storedCredentials()
  const out = {} as Record<K, string>
  for (const [key, entry] of Object.entries(spec) as [K, readonly [string, string]][]) {
    out[key] = pick(stored, entry[0], entry[1], env)
  }
  return out
}
