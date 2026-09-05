#!/usr/bin/env node
/**
 * Deployment preflight — everything that can be checked before the first boot (docs/18 §3½).
 *
 * Run it on the target box after you have written `.env` and started Postgres and Valkey, and
 * *before* `docker compose up -d web worker`. It reads the same values the app will read,
 * connects to the same services, and prints a numbered list of what is not ready. It only
 * reports: it never writes a setting, never fixes anything, and never touches the database
 * beyond `select`.
 *
 * Run it in the web image, so the `postgres` / `valkey` hostnames in .env resolve the way they
 * will for the app (from the host they do not resolve at all):
 *
 *   docker compose --env-file .env -f infra/docker-compose.yml \
 *     run --rm --no-deps -w /repo web node apps/web/scripts/preflight.mjs --host palscans.org
 *
 * On the host it needs only Node 22 and `pnpm install`, but then DATABASE_URL and REDIS_URL
 * have to point at 127.0.0.1, which is where compose publishes them:
 *
 *   node apps/web/scripts/preflight.mjs --host palscans.org
 *
 * Flags:
 *   --env PATH        the file to read (default: `.env` at the repo root). `--env-file` is
 *                     accepted too, but note that Node itself scans argv for that exact
 *                     spelling and exits with its own terse `not found` before this script
 *                     runs if the path does not exist — `--env` gives you this script's
 *                     message instead.
 *   --host NAME       the hostname you are deploying on; SITE_URL must match it
 *   --offline         skip every check that needs the network (DNS, the bucket, the CDN)
 *   --write           also write/read/delete one small object in the bucket, like the panel's
 *                     Storage **Test** does. Off by default: a preflight should not need
 *                     write access to prove the credentials are right.
 *   --json            machine-readable output
 *
 * Exit code is 0 when nothing failed (warnings do not fail the run) and 1 otherwise.
 *
 * Deliberately plain Node with no build step of its own, because it has to run on a box where
 * nothing has been started yet. The three clients it does need — postgres.js, ioredis and the
 * S3 SDK — are the ones the application already depends on, resolved from the workspace so
 * this script cannot drift onto a different version than the server will use.
 */
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import dns from 'node:dns/promises'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..', '..')
const DRIZZLE_DIR = path.join(REPO_ROOT, 'packages', 'db', 'drizzle')

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? fallback : argv[i + 1]
}
const has = (name) => argv.includes(`--${name}`)

const ENV_FILE = path.resolve(flag('env', flag('env-file', path.join(REPO_ROOT, '.env'))))
const EXPECTED_HOST = flag('host', null)
const OFFLINE = has('offline')
const PROBE_WRITE = has('write')
const JSON_OUT = has('json')

// --------------------------------------------------------------------- report

/** One finding. `fix` is mandatory on a failure: "what is wrong" without "what to do" is noise. */
const results = []
const record = (section, name, status, detail, fix) =>
  results.push({ section, name, status, detail, fix })
const pass = (s, n, d) => record(s, n, 'pass', d)
const warn = (s, n, d, fix) => record(s, n, 'warn', d, fix)
const fail = (s, n, d, fix) => record(s, n, 'fail', d, fix)
const skip = (s, n, d) => record(s, n, 'skip', d)

// ------------------------------------------------------------------ the env

/**
 * Read a `.env` file the way the deployment does — which is to say, *not* as a shell script.
 * Neither Docker Compose, nor Node's `--env-file`, nor `@next/env` performs substitution, so
 * neither does this. A value of `$(openssl rand -base64 32)` is 26 literal characters here
 * exactly as it is there, and the checks below are what catch it.
 */
const parseEnvFile = (text) => {
  const out = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line
      .slice(0, eq)
      .replace(/^export\s+/, '')
      .trim()
    let value = line.slice(eq + 1).trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    )
      value = value.slice(1, -1)
    if (key) out[key] = value
  }
  return out
}

const fileVars = existsSync(ENV_FILE) ? parseEnvFile(readFileSync(ENV_FILE, 'utf8')) : null
/** Real environment wins over the file, the same precedence `@next/env` applies. */
const env = { ...(fileVars ?? {}) }
const sources = {}
for (const key of Object.keys(fileVars ?? {})) sources[key] = path.basename(ENV_FILE)
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined && value !== '') {
    env[key] = value
    sources[key] = 'environment'
  }
}
const get = (key) => (env[key] ?? '').trim()

// --------------------------------------------------------------- 1 · secrets

const SECTION_ENV = '1 · Environment'

/** Shannon entropy of the string itself, in bits. Crude, and enough to catch `aaaa…`. */
const entropyBits = (value) => {
  const counts = new Map()
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  let h = 0
  for (const n of counts.values()) {
    const p = n / value.length
    h -= p * Math.log2(p)
  }
  return Math.round(h * value.length)
}

const PLACEHOLDER = /change-me|placeholder|example|palscans|password|secret-here|todo|xxxx/i
/** `$(…)`, `${…}` or backticks: the file was written expecting a shell to expand it. */
const UNEXPANDED = /\$\(|\$\{|`/

/**
 * The three bootstrap secrets, checked the same way. `minLength` is 32 for all of them even
 * though the application only enforces it on `SESSION_SECRET`: docs/18 §3 records the exact
 * accident this exists to catch — `CREDENTIALS_KEY=$(openssl rand -base64 32)` written
 * literally into `.env` is a 26-character string, and 26 clears the 16-character floor in
 * `packages/core/src/secrets.ts`, so the panel reports *Sealed with CREDENTIALS_KEY* and
 * every credential typed in afterwards is encrypted with a string printed in the docs.
 */
const checkSecret = (key, { required, minLength = 32, note }) => {
  const value = get(key)
  const where = sources[key] ? ` (from ${sources[key]})` : ''
  if (!value) {
    const message = `${key} is not set${note ? ` — ${note}` : ''}`
    const remedy =
      `Run this in the shell, from the repo root, so the shell does the substitution and only ` +
      `the result reaches the file:\n` +
      `        echo "${key}=$(openssl rand -base64 32)" >> ${path.basename(ENV_FILE)}\n` +
      `        Then read it back — grep '^${key}=' ${path.basename(ENV_FILE)} — and check it is ` +
      `44 base64 characters with no '$' in it.`
    return required
      ? fail(SECTION_ENV, key, message, remedy)
      : warn(SECTION_ENV, key, message, remedy)
  }
  if (UNEXPANDED.test(value))
    return fail(
      SECTION_ENV,
      key,
      `${key} contains an unexpanded shell substitution${where}: ${JSON.stringify(value.slice(0, 40))} (${value.length} characters)`,
      `A .env file is not a shell script — nothing expands it, so this is the literal value, ` +
        `identical on every deployment that copied it out of docs/18 §3.\n` +
        `        Delete the line and regenerate it *in the shell*:\n` +
        `        sed -i '/^${key}=/d' ${path.basename(ENV_FILE)}\n` +
        `        echo "${key}=$(openssl rand -base64 32)" >> ${path.basename(ENV_FILE)}\n` +
        `        If credentials were already saved in the panel with this key, re-enter them ` +
        `afterwards (Admin → System → Integrations): there is no re-key command.`,
    )
  if (PLACEHOLDER.test(value))
    return fail(
      SECTION_ENV,
      key,
      `${key} looks like a placeholder${where}: ${JSON.stringify(value.slice(0, 24))}…`,
      `Replace it with a random value: sed -i '/^${key}=/d' ${path.basename(ENV_FILE)} && ` +
        `echo "${key}=$(openssl rand -base64 32)" >> ${path.basename(ENV_FILE)}`,
    )
  if (value.length < minLength)
    return fail(
      SECTION_ENV,
      key,
      `${key} is ${value.length} characters${where}; ${minLength} is the minimum`,
      `Regenerate it: sed -i '/^${key}=/d' ${path.basename(ENV_FILE)} && ` +
        `echo "${key}=$(openssl rand -base64 32)" >> ${path.basename(ENV_FILE)} ` +
        `(44 base64 characters).`,
    )
  const bits = entropyBits(value)
  const distinct = new Set(value).size
  if (bits < 128 || distinct < 12)
    return fail(
      SECTION_ENV,
      key,
      `${key} is ${value.length} characters but only ~${bits} bits of entropy over ${distinct} distinct characters${where}`,
      `It is long enough and still guessable. Replace it with output from ` +
        `\`openssl rand -base64 32\` rather than a typed passphrase.`,
    )
  return pass(SECTION_ENV, key, `${value.length} chars, ~${bits} bits${where}`)
}

const checkSecrets = () => {
  checkSecret('SESSION_SECRET', { required: true })
  checkSecret('INTERNAL_API_SECRET', {
    required: true,
    note:
      'the worker cannot ask the web app to revalidate its caches without it, and ' +
      'apps/web/lib/env.ts refuses to boot in production when it is missing',
  })
  checkSecret('CREDENTIALS_KEY', {
    required: false,
    note:
      'it falls back to SESSION_SECRET, so rotating sessions later makes every stored ' +
      'credential unreadable and they must all be re-entered (docs/19)',
  })

  // Distinctness. Reusing one value everywhere means one rotation breaks three things.
  const pairs = [
    ['SESSION_SECRET', 'CREDENTIALS_KEY'],
    ['SESSION_SECRET', 'INTERNAL_API_SECRET'],
    ['CREDENTIALS_KEY', 'INTERNAL_API_SECRET'],
  ]
  const same = pairs.filter(([a, b]) => get(a) && get(a) === get(b))
  if (same.length)
    warn(
      SECTION_ENV,
      'secret reuse',
      same.map(([a, b]) => `${a} and ${b} are the same value`).join('; '),
      'Give each one its own `openssl rand -base64 32`. They are separate variables so that ' +
        'rotating one does not invalidate the others.',
    )
  else if (results.every((r) => r.section !== SECTION_ENV || r.status !== 'fail'))
    // Only worth saying once each secret is otherwise sound; three broken values that happen
    // to differ is not a passing check.
    pass(SECTION_ENV, 'secret reuse', 'all three bootstrap secrets differ')
}

// ------------------------------------------------------- 2 · the rest of .env

const checkEnvFile = () => {
  if (fileVars === null)
    return warn(
      SECTION_ENV,
      ENV_FILE,
      'no env file at this path; only the process environment was checked',
      `If you meant to check a file, pass --env PATH. On the server it is ` +
        `\`cp .env.example .env\` in the checkout, per docs/18 §3.`,
    )
  pass(SECTION_ENV, path.basename(ENV_FILE), `${Object.keys(fileVars).length} values read`)
}

const checkDatabaseUrl = () => {
  const url = get('DATABASE_URL')
  if (!url)
    return fail(
      SECTION_ENV,
      'DATABASE_URL',
      'not set',
      'Set it in .env to match POSTGRES_PASSWORD, e.g. ' +
        'DATABASE_URL=postgres://pal:<password>@postgres:5432/palscans (the host is the ' +
        'compose service name, not localhost).',
    )
  if (url.startsWith('pglite://'))
    return fail(
      SECTION_ENV,
      'DATABASE_URL',
      `is PGlite (${url}) — the embedded development database`,
      'PGlite is a single-process file database: it cannot be shared by the web app and the ' +
        'worker, and it is not what infra/docker-compose.yml starts. Point DATABASE_URL at ' +
        'the compose Postgres: postgres://pal:<POSTGRES_PASSWORD>@postgres:5432/palscans',
    )
  if (!/^postgres(ql)?:\/\//.test(url))
    return fail(
      SECTION_ENV,
      'DATABASE_URL',
      `does not look like a Postgres URL (${url.slice(0, 16)}…)`,
      'It must start with postgres:// — see packages/db/src/client.ts.',
    )
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return fail(
      SECTION_ENV,
      'DATABASE_URL',
      'is not a valid URL',
      'Check for stray quotes or spaces in .env.',
    )
  }
  const password = decodeURIComponent(parsed.password ?? '')
  if (!password)
    warn(
      SECTION_ENV,
      'DATABASE_URL',
      'has no password',
      'Set POSTGRES_PASSWORD and put the same value in DATABASE_URL. The compose Postgres ' +
        'is bound to 127.0.0.1 only, but the password is also what protects it from every ' +
        'other container on the same network.',
    )
  else if (['pal', 'postgres', 'password', 'changeme'].includes(password.toLowerCase()))
    fail(
      SECTION_ENV,
      'DATABASE_URL',
      `uses the well-known password "${password}"`,
      'Set POSTGRES_PASSWORD to something random (`openssl rand -base64 24`) and use the ' +
        'same value in DATABASE_URL. Both live in .env; compose reads them from there.',
    )
  else
    pass(
      SECTION_ENV,
      'DATABASE_URL',
      `postgres://${parsed.username}:***@${parsed.host}${parsed.pathname}`,
    )
  if (UNEXPANDED.test(url))
    fail(
      SECTION_ENV,
      'DATABASE_URL',
      'contains an unexpanded shell substitution',
      'Nothing expands a .env file. Write the password into the URL literally.',
    )
}

const checkSiteUrl = async () => {
  const raw = get('SITE_URL')
  if (!raw)
    return fail(
      SECTION_ENV,
      'SITE_URL',
      'not set',
      'Set SITE_URL to the origin readers will type, with no trailing slash: ' +
        'SITE_URL=https://palscans.org. It is read while issuing cookies, before any ' +
        'request is authenticated, so it cannot come from the admin panel (docs/19).',
    )
  let url
  try {
    url = new URL(raw)
  } catch {
    return fail(
      SECTION_ENV,
      'SITE_URL',
      `is not a valid URL (${raw})`,
      'Write it as https://palscans.org',
    )
  }
  if (url.protocol !== 'https:')
    fail(
      SECTION_ENV,
      'SITE_URL',
      `is ${url.protocol}// — the session, OAuth and MFA cookies are Secure`,
      'Use https://. Caddy terminates TLS on the origin, so the app must issue cookies for ' +
        'the https origin even though it listens on plain HTTP behind the proxy. ' +
        'apps/web/lib/env.ts refuses to boot otherwise.',
    )
  else if (raw !== url.origin)
    warn(
      SECTION_ENV,
      'SITE_URL',
      `has a path or trailing slash (${raw})`,
      `Use the bare origin: SITE_URL=${url.origin}`,
    )
  else pass(SECTION_ENV, 'SITE_URL', url.origin)

  if (url.hostname.startsWith('www.'))
    warn(
      SECTION_ENV,
      'SITE_URL',
      'is the www. host',
      'The Caddyfile and the proxy both 301 www. → apex, so the canonical origin should be ' +
        'the apex: SITE_URL=https://' +
        url.hostname.slice(4),
    )

  if (EXPECTED_HOST && url.hostname !== EXPECTED_HOST)
    fail(
      SECTION_ENV,
      'SITE_URL host',
      `is ${url.hostname}, but you passed --host ${EXPECTED_HOST}`,
      `Set SITE_URL=https://${EXPECTED_HOST}. Every canonical link, sitemap entry, OAuth ` +
        `redirect and cookie domain comes from this value; a mismatch is invisible until ` +
        `sign-in silently fails.`,
    )
  else if (EXPECTED_HOST) pass(SECTION_ENV, 'SITE_URL host', `matches --host ${EXPECTED_HOST}`)

  if (OFFLINE) return skip(SECTION_ENV, 'SITE_URL dns', 'skipped (--offline)')
  if (['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname))
    return warn(
      SECTION_ENV,
      'SITE_URL dns',
      'is a loopback address — this is a local verification run, not a deployment',
      'On the server, SITE_URL is the public hostname from docs/18 §1.',
    )
  try {
    const addrs = await dns.resolve4(url.hostname).catch(() => dns.resolve6(url.hostname))
    pass(SECTION_ENV, 'SITE_URL dns', `${url.hostname} → ${addrs.slice(0, 3).join(', ')}`)
  } catch (error) {
    warn(
      SECTION_ENV,
      'SITE_URL dns',
      `${url.hostname} does not resolve (${error.code ?? error.message})`,
      'Create the A record from docs/18 §1 (apex → your server IP, proxied) before you ' +
        'announce the site. Until DNS resolves, verification mail links and OAuth redirects ' +
        'point at a name that does not exist.',
    )
  }
}

const checkTrustedProxy = () => {
  const value = get('TRUSTED_PROXY')
  if (!value || value === 'none')
    return fail(
      SECTION_ENV,
      'TRUSTED_PROXY',
      value ? 'is "none"' : 'is not set (defaults to "none")',
      'Set TRUSTED_PROXY=cloudflare when Cloudflare proxies the origin (the orange cloud in ' +
        'docs/18 §1), or TRUSTED_PROXY=xff when only Caddy is in front. Left unset, every ' +
        'visitor shares one rate-limit bucket, no IP is ever hashed, and the address recorded ' +
        "on sessions, comments and the audit log is the proxy's. It is not cosmetic and the " +
        'app refuses to boot in production without it.',
    )
  if (!['xff', 'cloudflare'].includes(value))
    return fail(
      SECTION_ENV,
      'TRUSTED_PROXY',
      `is "${value}", which is not a valid mode`,
      'The only production values are `cloudflare` and `xff` (apps/web/lib/env.ts).',
    )
  const hops = get('TRUSTED_PROXY_HOPS')
  if (value === 'xff' && hops && !/^[1-9]\d?$/.test(hops))
    fail(
      SECTION_ENV,
      'TRUSTED_PROXY_HOPS',
      `is "${hops}"`,
      'It must be a small positive integer: how many trusted proxies append to ' +
        'X-Forwarded-For. With Caddy alone that is 1.',
    )
  pass(
    SECTION_ENV,
    'TRUSTED_PROXY',
    value === 'cloudflare' ? 'cloudflare (CF-Connecting-IP)' : `xff, ${hops || 1} hop(s)`,
  )
}

const CADDYFILE = path.join(REPO_ROOT, 'infra', 'Caddyfile')
const CF_IP_LISTS = ['https://www.cloudflare.com/ips-v4', 'https://www.cloudflare.com/ips-v6']

/**
 * The finding this exists for, in one sentence: with `TRUSTED_PROXY=cloudflare` the app
 * takes the client address from `CF-Connecting-IP`, which is exactly right for a request
 * that came through Cloudflare and is a text field for anyone who reaches the origin
 * directly. A pre-launch audit used it to walk through the panel's IP allowlist and to give
 * itself a fresh bucket for every per-IP rate limit on the site.
 *
 * Only the operator can finish the fix — Cloudflare has to be the only thing that can reach
 * port 443 — so this checks the parts that are in the repository and then names the part
 * that is not. Three findings, in the order they bite:
 *
 *   1. `infra/Caddyfile` strips the CF-* headers from peers outside Cloudflare's ranges.
 *      Without it, forging the header works and everything downstream is decoration.
 *   2. The origin refuses non-Cloudflare peers outright (`abort @direct`). Stripping makes
 *      forgery useless; this makes the origin unreachable, which also takes it out of reach
 *      of a flood. It ships commented out because it is wrong for a `xff` deployment.
 *   3. Cloudflare's published ranges have not moved since the list in the file was written.
 *      A stale list is not a security hole — the missing ranges are treated as direct — but
 *      it silently turns real visitors into "unknown address", which loses their rate-limit
 *      bucket and, with the lockdown on, locks them out entirely.
 */
const checkOriginLockdown = async () => {
  const mode = get('TRUSTED_PROXY')
  if (mode !== 'cloudflare')
    return skip(
      SECTION_ENV,
      'origin lockdown',
      `not applicable with TRUSTED_PROXY=${mode || 'none'}`,
    )
  if (!existsSync(CADDYFILE))
    return warn(
      SECTION_ENV,
      'origin lockdown',
      'infra/Caddyfile is not here, so nothing could be checked',
      'You are running behind something other than the shipped Caddy config. Whatever it ' +
        'is must delete CF-Connecting-IP, CF-IPCountry, CF-IPCity and True-Client-IP from ' +
        "any request whose peer is not a Cloudflare edge address, or the app's client IP is " +
        'whatever the caller typed.',
    )

  const caddyfile = readFileSync(CADDYFILE, 'utf8')
  const live = caddyfile
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n')
  const strips = /header_up\s+-CF-Connecting-IP/i.test(live)
  const matcher = /@direct\s+not\s+remote_ip\s+\S/.test(live)
  if (!strips || !matcher)
    fail(
      SECTION_ENV,
      'CF header stripping',
      `infra/Caddyfile ${[
        strips ? null : 'does not delete CF-Connecting-IP',
        matcher ? null : 'has no @direct remote_ip matcher',
      ]
        .filter(Boolean)
        .join(' and ')}`,
      'Restore the "client address" block in infra/Caddyfile. Until it is there, anyone who ' +
        'can reach this server on 443 without going through Cloudflare picks their own ' +
        'client IP with one header: the panel IP allowlist admits them, and every per-IP ' +
        'rate limit on the site (login, register, comments, the reader) gives them a fresh ' +
        'bucket per request.',
    )
  else pass(SECTION_ENV, 'CF header stripping', 'non-Cloudflare peers lose CF-* (infra/Caddyfile)')

  if (/^\s*abort\s+@direct\s*$/m.test(live))
    pass(SECTION_ENV, 'origin lockdown', 'origin refuses non-Cloudflare peers')
  else
    warn(
      SECTION_ENV,
      'origin lockdown',
      'the origin still answers requests that did not come through Cloudflare',
      'Header stripping means a forged CF-Connecting-IP no longer works, which closes the ' +
        'audit finding. Closing the door as well is one line: uncomment `abort @direct` in ' +
        'infra/Caddyfile (docs/18 §3 "Lock the origin down"), and back it with a host ' +
        'firewall that only admits Cloudflare on 443 — Caddy cannot refuse a packet that ' +
        'arrives before it. Do it with a way in that does not go through Caddy already open.',
    )

  if (OFFLINE) return skip(SECTION_ENV, 'Cloudflare ranges', 'skipped (--offline)')
  const declared = new Set(
    (live.match(/@direct\s+not\s+remote_ip([^\n]*)/)?.[1] ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean),
  )
  let published = []
  try {
    const bodies = await Promise.all(
      CF_IP_LISTS.map(async (u) => {
        const res = await fetch(u, { signal: AbortSignal.timeout(10_000) })
        if (!res.ok) throw new Error(`${u} → ${res.status}`)
        return res.text()
      }),
    )
    published = bodies
      .join('\n')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  } catch (error) {
    return warn(
      SECTION_ENV,
      'Cloudflare ranges',
      `could not be fetched (${error.message})`,
      `Compare by hand: curl -s ${CF_IP_LISTS.join(' ')} against the @direct matcher in ` +
        'infra/Caddyfile.',
    )
  }
  const missing = published.filter((r) => !declared.has(r))
  if (missing.length === 0)
    pass(SECTION_ENV, 'Cloudflare ranges', `${published.length} published ranges, all listed`)
  else
    warn(
      SECTION_ENV,
      'Cloudflare ranges',
      `infra/Caddyfile is missing ${missing.length}: ${missing.join(' ')}`,
      'Cloudflare has published ranges this file does not know about. Requests from them ' +
        'are treated as direct: their CF-* headers are dropped, so those visitors are ' +
        'rate-limited as the edge rather than as themselves — and if `abort @direct` is on, ' +
        'they are refused outright. Add them to the @direct matcher in infra/Caddyfile and ' +
        'reload Caddy.',
    )
}

const checkWebConcurrency = () => {
  const raw = get('WEB_CONCURRENCY')
  if (!raw) return pass(SECTION_ENV, 'WEB_CONCURRENCY', 'unset — one web process per core')
  // `auto` and `0` both mean "one per core", the same two spellings scripts/serve.mjs accepts.
  if (raw === 'auto' || raw === '0')
    return pass(SECTION_ENV, 'WEB_CONCURRENCY', `${raw} — one web process per core`)
  if (!/^\d+$/.test(raw) || Number(raw) < 1)
    return fail(
      SECTION_ENV,
      'WEB_CONCURRENCY',
      `is "${raw}"`,
      'It must be a positive integer or `auto`. apps/web/scripts/serve.mjs refuses to start ' +
        'rather than silently serving on one core.',
    )
  if (Number(raw) === 1)
    warn(
      SECTION_ENV,
      'WEB_CONCURRENCY',
      '1 — the site will serve on a single core',
      'One process is ~30 reader pages a second no matter how many cores the box has ' +
        '(docs/20). Leave WEB_CONCURRENCY unset to use all of them; set 1 only to reproduce ' +
        'the single-process baseline.',
    )
  else pass(SECTION_ENV, 'WEB_CONCURRENCY', `${raw} web processes`)
}

// -------------------------------------------------------------- 3 · database

const SECTION_DB = '2 · Database'
const requireFrom = (pkgDir) => createRequire(path.join(REPO_ROOT, pkgDir, 'preflight.cjs'))

/** Shared with the storage and admin checks so the database is opened exactly once. */
let sql = null

const openDatabase = async () => {
  const url = get('DATABASE_URL')
  if (!url || !/^postgres(ql)?:\/\//.test(url))
    return skip(SECTION_DB, 'connection', 'skipped — DATABASE_URL is not usable (see above)')
  let postgres
  try {
    postgres = requireFrom('packages/db')('postgres')
  } catch {
    return skip(
      SECTION_DB,
      'connection',
      'skipped — the postgres.js driver is not installed. Run `pnpm install` in the checkout, ' +
        'or run this script inside the web container where dependencies are already present.',
    )
  }
  try {
    sql = postgres(url, { max: 1, prepare: false, onnotice: () => {}, connect_timeout: 10 })
    const [row] = await sql`select version() as version, current_database() as db`
    pass(SECTION_DB, 'connection', `${row.version.split(',')[0]} · ${row.db}`)
  } catch (error) {
    sql = null
    fail(
      SECTION_DB,
      'connection',
      `cannot connect: ${error.message}`,
      'Start the database first — `docker compose --env-file .env -f infra/docker-compose.yml ' +
        "up -d postgres valkey` — and check that DATABASE_URL's host matches how you are " +
        'running this. From the host it is 127.0.0.1:5432; from inside a container it is the ' +
        'service name `postgres`.',
    )
  }
}

/**
 * Migrations. drizzle records one row per applied file in `drizzle.__drizzle_migrations`,
 * keyed by the SHA-256 of the file's contents, so three different things are distinguishable:
 * files not applied yet, files applied but since edited, and a database ahead of this
 * checkout. All three matter on a first deploy — docs/18 §4 records that a site whose
 * migrations never ran still answers `/api/health` with `ok`.
 */
const checkMigrations = async () => {
  if (!sql) return skip(SECTION_DB, 'migrations', 'skipped — no database connection')
  const journalPath = path.join(DRIZZLE_DIR, 'meta', '_journal.json')
  if (!existsSync(journalPath))
    return skip(SECTION_DB, 'migrations', `skipped — no migrations folder at ${DRIZZLE_DIR}`)
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'))
  const expected = journal.entries.map((entry) => ({
    tag: entry.tag,
    when: entry.when,
    hash: createHash('sha256')
      .update(readFileSync(path.join(DRIZZLE_DIR, `${entry.tag}.sql`), 'utf8'))
      .digest('hex'),
  }))

  let applied
  try {
    applied = await sql`
      select hash, created_at from drizzle.__drizzle_migrations order by created_at asc`
  } catch {
    return fail(
      SECTION_DB,
      'migrations',
      `no migrations have been applied (${expected.length} pending)`,
      'Apply them before first boot:\n' +
        '        docker compose --env-file .env -f infra/docker-compose.yml exec -w /repo web pnpm db:migrate\n' +
        '        The `-w /repo` is required: db:migrate is a root-package script and the ' +
        "image's working directory is /repo/apps/web. Without it the site boots against an " +
        'empty database while /api/health still answers ok.',
    )
  }

  const appliedHashes = new Set(applied.map((row) => row.hash))
  const pending = expected.filter((entry) => !appliedHashes.has(entry.hash))
  const expectedHashes = new Set(expected.map((entry) => entry.hash))
  const extra = applied.filter((row) => !expectedHashes.has(row.hash))

  // A row whose timestamp matches a known migration but whose hash does not: the .sql file
  // was edited after it ran, so the database and the repository disagree about what is in it.
  const byWhen = new Map(applied.map((row) => [Number(row.created_at), row.hash]))
  const edited = expected.filter(
    (entry) => byWhen.has(entry.when) && byWhen.get(entry.when) !== entry.hash,
  )

  if (edited.length)
    fail(
      SECTION_DB,
      'migrations',
      `${edited.length} applied migration(s) have been edited since: ${edited.map((e) => e.tag).join(', ')}`,
      'The database contains a different version of these files than the checkout does. Do ' +
        'not edit an applied migration — add a new one. If this is a fresh database, drop it ' +
        'and migrate again; if it is not, reconcile by hand before deploying.',
    )
  if (pending.length && !edited.length)
    fail(
      SECTION_DB,
      'migrations',
      `${pending.length} migration(s) not applied: ${pending.map((e) => e.tag).join(', ')}`,
      'Apply them before first boot:\n' +
        '        docker compose --env-file .env -f infra/docker-compose.yml exec -w /repo web pnpm db:migrate\n' +
        '        There are no down migrations; the undo for a bad one is the pre-deploy dump ' +
        '(infra/RUNBOOK.md → Roll back a deploy).',
    )
  if (extra.length)
    warn(
      SECTION_DB,
      'migrations',
      `the database has ${extra.length} migration(s) this checkout does not`,
      'The database is ahead of the code you are about to deploy. Deploy the matching ' +
        'revision, or you will run an older application against a newer schema.',
    )
  if (!pending.length && !edited.length)
    pass(SECTION_DB, 'migrations', `${applied.length} applied, up to date with the checkout`)
}

/**
 * Connection budget. postgres.js opens its own pool **per process** (`DATABASE_POOL_MAX`,
 * default 10 — packages/db/src/client.ts), so the web tier now wants `WEB_CONCURRENCY × pool`
 * connections and the worker another pool on top. Get it wrong and the failure is ugly and
 * late: `FATAL: sorry, too many clients already` from whichever request happens to need a
 * connection, during the first traffic spike rather than at boot. Measured, not theorised —
 * it is what four web processes did to a Postgres already carrying other clients.
 */
const checkConnectionBudget = async () => {
  if (!sql) return skip(SECTION_DB, 'connection budget', 'skipped — no database connection')
  let max
  let reserved
  try {
    const [a] = await sql`show max_connections`
    const [b] = await sql`show superuser_reserved_connections`
    max = Number(a.max_connections)
    reserved = Number(b.superuser_reserved_connections)
  } catch {
    return skip(SECTION_DB, 'connection budget', 'skipped — could not read max_connections')
  }
  const raw = get('WEB_CONCURRENCY')
  // An unusable WEB_CONCURRENCY is already its own failure; budget against the default rather
  // than printing NaN on top of it.
  const stated = /^[1-9]\d*$/.test(raw) ? Number(raw) : null
  const webProcs = stated ?? os.availableParallelism()
  const pool = Number(get('DATABASE_POOL_MAX')) || 10
  // +1 pool for the worker, +2 for a `psql` and a migration running while the site is up.
  const needed = webProcs * pool + pool + 2
  const usable = max - reserved
  const detail =
    `${webProcs}${stated ? '' : ' (default)'} web × ${pool} + worker ${pool} + 2 = ${needed} ` +
    `of ${usable} usable (max_connections ${max}, ${reserved} reserved)`
  if (needed > usable)
    fail(
      SECTION_DB,
      'connection budget',
      `${detail} — the pools can exhaust Postgres`,
      'Pick one: raise max_connections on the postgres service (its `command:` in ' +
        'infra/docker-compose.yml sets it explicitly, and each connection costs a few MB of ' +
        'server memory), set DATABASE_POOL_MAX to something smaller in .env, or lower ' +
        'WEB_CONCURRENCY. The symptom otherwise is `FATAL: sorry, too many clients already` ' +
        'on a random request under load, not a boot failure you would catch here.',
    )
  else if (needed > usable * 0.8)
    warn(
      SECTION_DB,
      'connection budget',
      `${detail} — over 80% of what Postgres allows`,
      'It fits today and will not survive a bigger box: WEB_CONCURRENCY follows the core ' +
        'count, so moving to 8 cores doubles the demand. Set DATABASE_POOL_MAX explicitly, or ' +
        'raise max_connections now.',
    )
  else pass(SECTION_DB, 'connection budget', detail)
}

/** `pg_dump`/`pg_restore`: the nightly backup shells out to them (docs/18 §9). */
const checkPgTools = async () => {
  const serverMajor = await (async () => {
    if (!sql) return null
    try {
      const [row] = await sql`show server_version`
      return Number.parseInt(row.server_version, 10)
    } catch {
      return null
    }
  })()

  for (const [name, override] of [
    ['pg_dump', get('PG_DUMP')],
    ['pg_restore', get('PG_RESTORE')],
  ]) {
    const binary = override || name
    let version
    try {
      version = execFileSync(binary, ['--version'], { encoding: 'utf8', timeout: 10_000 }).trim()
    } catch {
      fail(
        SECTION_DB,
        name,
        `${binary} is not on PATH here`,
        `The backup job runs inside the worker container, which installs postgresql-client ` +
          `(infra/Dockerfile). Check it there rather than on the host:\n` +
          `        docker compose --env-file .env -f infra/docker-compose.yml run --rm --no-deps worker ${name} --version\n` +
          `        Without it every run of \`db.backup\` fails and Admin → System → Backup says so.`,
      )
      continue
    }
    const clientMajor = Number.parseInt(version.match(/(\d+)\./)?.[1] ?? '', 10)
    if (serverMajor && clientMajor && clientMajor < serverMajor)
      fail(
        SECTION_DB,
        name,
        `${version} is older than the server (Postgres ${serverMajor})`,
        `pg_dump refuses to dump a server newer than itself. Upgrade the client — in the ` +
          `worker image that is \`apk add --no-cache postgresql-client\` against an Alpine ` +
          `release new enough for Postgres ${serverMajor} — or set PG_DUMP/PG_RESTORE to a ` +
          `newer binary. A newer client against an older server is the supported direction.`,
      )
    else
      pass(
        SECTION_DB,
        name,
        `${version}${serverMajor ? ` (server ${serverMajor}: ${clientMajor >= serverMajor ? 'compatible' : 'unknown'})` : ''}`,
      )
  }
}

// ----------------------------------------------------------------- 4 · redis

const SECTION_REDIS = '3 · Redis / Valkey'

/**
 * What is lost without Redis, stated in full because "optional locally" in `.env.example` is
 * about a single-process development box and does not carry to a deployment.
 */
const REDIS_DEGRADATION =
  'Without REDIS_URL the app falls back to in-process substitutes, and in the shipped ' +
  'two-container deployment that is not a degradation but a silent breakage:\n' +
  '        · the job queue becomes a MemoryQueue inside whichever process enqueued the job ' +
  '(packages/core/src/queue/index.ts), so the worker never sees chapter processing, imports, ' +
  'notifications or the nightly backup — nothing errors, the jobs simply never run;\n' +
  '        · rate limits (login 5/min, register 3/hour, the 40/min view budget) fall back to ' +
  'a per-process Map, so with N web processes every limit is effectively N times looser;\n' +
  "        · the per-viewer view dedupe falls back to the same per-process map — view_events' " +
  'primary key still prevents double counting, but every worker asks the database instead;\n' +
  '        · sessions are unaffected: they are cookie plus Postgres.'

const checkRedis = async () => {
  const url = get('REDIS_URL')
  if (!url)
    return fail(
      SECTION_REDIS,
      'REDIS_URL',
      'is not set',
      `Set REDIS_URL=redis://valkey:6379 — infra/docker-compose.yml already starts it.\n        ${REDIS_DEGRADATION}`,
    )
  if (OFFLINE) return skip(SECTION_REDIS, 'connection', 'skipped (--offline)')
  let Redis
  try {
    const mod = requireFrom('apps/web')('ioredis')
    Redis = mod.Redis ?? mod.default ?? mod
  } catch {
    return skip(
      SECTION_REDIS,
      'connection',
      'skipped — ioredis is not installed here. Run `pnpm install`, or run this inside the ' +
        'web container.',
    )
  }
  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    connectTimeout: 5000,
  })
  client.on('error', () => {})
  try {
    await client.connect()
    const pong = await client.ping()
    const info = await client.info('server').catch(() => '')
    const version = info.match(/redis_version:([^\r\n]+)/)?.[1] ?? 'unknown'
    pass(
      SECTION_REDIS,
      'connection',
      `${pong} · ${url.replace(/\/\/[^@]*@/, '//***@')} · v${version}`,
    )

    // BullMQ requires that its keys are never evicted: under an LRU policy the server drops
    // job hashes and the wait/active lists under memory pressure and queued work disappears
    // with no error. infra/docker-compose.yml sets `noeviction` for exactly this reason.
    const policy = await client
      .config('GET', 'maxmemory-policy')
      .then((r) => (Array.isArray(r) ? r[1] : null))
      .catch(() => null)
    if (policy === null)
      warn(
        SECTION_REDIS,
        'maxmemory-policy',
        'could not be read (CONFIG GET is restricted on this server)',
        'Confirm by hand that the policy is `noeviction`. BullMQ stores each job as a hash ' +
          'plus entries in the wait/active lists; an eviction policy drops them silently and ' +
          'import.run, notify.new_chapter and notify.comment have no database safety net.',
      )
    else if (policy !== 'noeviction')
      fail(
        SECTION_REDIS,
        'maxmemory-policy',
        `is "${policy}", which evicts keys`,
        'Set it to noeviction — the shipped `valkey` service already does ' +
          '(`--maxmemory-policy noeviction` in infra/docker-compose.yml). This instance also ' +
          'backs BullMQ, and an evicted job hash is queued work that disappears with no error.',
      )
    else pass(SECTION_REDIS, 'maxmemory-policy', 'noeviction — BullMQ keys will not be evicted')
  } catch (error) {
    fail(
      SECTION_REDIS,
      'connection',
      `cannot connect to ${url.replace(/\/\/[^@]*@/, '//***@')}: ${error.message}`,
      `Start it — \`docker compose --env-file .env -f infra/docker-compose.yml up -d valkey\` ` +
        `— and check the host in REDIS_URL: from inside a container it is the service name ` +
        `\`valkey\`, from the host it is 127.0.0.1.\n        ${REDIS_DEGRADATION}`,
    )
  } finally {
    client.disconnect()
  }
}

// --------------------------------------------------------------- 5 · storage

const SECTION_STORAGE = '4 · Object storage'

const bucketOf = (prefix) => get(`${prefix}S3_BUCKET`)
const endpointOf = (prefix) => get(`${prefix}S3_ENDPOINT`) || get('S3_ENDPOINT')

const checkStorage = async () => {
  const driver = get('STORAGE_DRIVER') || 'fs'
  if (driver === 'fs') {
    fail(
      SECTION_STORAGE,
      'STORAGE_DRIVER',
      'is `fs` — uploads are written into the container filesystem',
      'Set STORAGE_DRIVER=s3 and fill in the R2 values. An unnoticed `fs` driver writes ' +
        'every cover, page and avatar inside the web container and loses them on the next ' +
        'deploy, with no error at any point. The bucket is docs/18 §2.',
    )
    return
  }
  if (driver !== 's3')
    return fail(
      SECTION_STORAGE,
      'STORAGE_DRIVER',
      `is "${driver}"`,
      'The only drivers are `fs` and `s3` (packages/core/src/storage/index.ts).',
    )

  const missing = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].filter(
    (key) => !get(key),
  )
  if (missing.length)
    return fail(
      SECTION_STORAGE,
      'S3 settings',
      `missing ${missing.join(', ')}`,
      'These are the environment *fallbacks*. Either fill them in .env, or leave them empty ' +
        'and enter the same values in Admin → System → Integrations → Storage after first ' +
        'boot (docs/18 §6) — but then the first boot has no storage at all, so at minimum ' +
        'set them before uploading anything.',
    )
  pass(SECTION_STORAGE, 'STORAGE_DRIVER', `s3 · ${get('S3_BUCKET')} @ ${get('S3_ENDPOINT')}`)

  if (OFFLINE) return skip(SECTION_STORAGE, 'bucket', 'skipped (--offline)')
  let sdk
  try {
    sdk = requireFrom('packages/core')('@aws-sdk/client-s3')
  } catch {
    return skip(
      SECTION_STORAGE,
      'bucket',
      'skipped — @aws-sdk/client-s3 is not installed here. Run `pnpm install`, or run this ' +
        'inside the web container.',
    )
  }
  const client = new sdk.S3Client({
    region: get('S3_REGION') || 'auto',
    endpoint: get('S3_ENDPOINT'),
    forcePathStyle: /^(1|true|yes)$/i.test(get('S3_FORCE_PATH_STYLE')),
    credentials: {
      accessKeyId: get('S3_ACCESS_KEY_ID'),
      secretAccessKey: get('S3_SECRET_ACCESS_KEY'),
    },
  })
  const bucket = get('S3_BUCKET')
  try {
    await client.send(new sdk.HeadBucketCommand({ Bucket: bucket }))
    await client.send(new sdk.ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }))
    pass(SECTION_STORAGE, 'bucket', `${bucket} reachable and listable`)
  } catch (error) {
    const code = error.name ?? error.Code ?? 'error'
    return fail(
      SECTION_STORAGE,
      'bucket',
      `${bucket} is not reachable with these credentials (${code}: ${error.message})`,
      code === 'NotFound' || code === 'NoSuchBucket'
        ? `The bucket does not exist at this endpoint. Create it in R2 and check S3_BUCKET ` +
            `and S3_ENDPOINT (the endpoint is https://<account-id>.r2.cloudflarestorage.com, ` +
            `with no bucket name in it).`
        : `Check the API token is scoped to this bucket with read and write, and that ` +
            `S3_REGION is \`auto\` for R2. The same values go into Admin → System → ` +
            `Integrations → Storage, where the **Test** button does this round trip for you.`,
    )
  }

  if (!PROBE_WRITE) return
  const key = `_healthcheck/preflight-${randomBytes(6).toString('hex')}`
  try {
    const body = randomBytes(32)
    await client.send(new sdk.PutObjectCommand({ Bucket: bucket, Key: key, Body: body }))
    const got = await client.send(new sdk.GetObjectCommand({ Bucket: bucket, Key: key }))
    const back = Buffer.from(await got.Body.transformToByteArray())
    await client.send(new sdk.DeleteObjectCommand({ Bucket: bucket, Key: key }))
    if (!back.equals(body))
      fail(
        SECTION_STORAGE,
        'bucket write',
        'the bytes read back did not match the bytes written',
        'Something between the app and the bucket is rewriting objects. Check for a proxy or ' +
          'a CDN rule on the S3 endpoint (the endpoint must not be the cdn. hostname).',
      )
    else pass(SECTION_STORAGE, 'bucket write', `wrote, read and deleted ${key}`)
  } catch (error) {
    fail(
      SECTION_STORAGE,
      'bucket write',
      `write/read/delete failed (${error.name ?? 'error'}: ${error.message})`,
      'The token can reach the bucket but cannot write to it. Give it Object Read & Write ' +
        'on this bucket — the app writes covers, pages, avatars and raw uploads.',
    )
  }
}

/**
 * The backup destination must not be the bucket the CDN hostname is attached to. A dump holds
 * every user row, every session and the sealed `app_credentials` table; the public bucket is
 * one WAF-rule mistake away from serving it (docs/18 §2, §9).
 */
const checkBackupDestination = () => {
  const appBucket = bucketOf('')
  const backupBucket = bucketOf('BACKUP_')
  const backupDir = get('BACKUP_DIR')

  if (!backupBucket && !backupDir)
    return warn(
      SECTION_STORAGE,
      'backup destination',
      'not configured — Admin → System → Backup will read "not configured"',
      'Create the second R2 bucket from docs/18 §2 (never connect a domain to it) and set ' +
        'BACKUP_S3_BUCKET=palscans-backups in .env, or set BACKUP_DIR to a mounted ' +
        'directory. Nothing else backs the database up: the nightly `db.backup` job is the ' +
        'only one there is.',
    )

  if (backupBucket) {
    const sameEndpoint = endpointOf('BACKUP_') === endpointOf('')
    if (backupBucket === appBucket && sameEndpoint)
      fail(
        SECTION_STORAGE,
        'backup destination',
        `BACKUP_S3_BUCKET is "${backupBucket}" — the same bucket the app serves from`,
        'Point it at the *second* bucket from docs/18 §2, the one with no custom domain: ' +
          `BACKUP_S3_BUCKET=palscans-backups. \`${backupBucket}\` is the bucket ` +
          `${(() => {
            try {
              return new URL(get('PUBLIC_CDN_URL')).hostname
            } catch {
              return 'your CDN hostname'
            }
          })()} serves, so a database dump — every user row, every session, the sealed ` +
          'app_credentials table — would sit behind a public hostname whose only protection ' +
          'is one WAF rule. The job itself refuses this destination, so backups would simply ' +
          'never run.',
      )
    else if (backupBucket === appBucket)
      warn(
        SECTION_STORAGE,
        'backup destination',
        `BACKUP_S3_BUCKET has the same name as S3_BUCKET ("${backupBucket}") but a different endpoint`,
        'Check this is deliberate — a different account or provider with the same bucket name ' +
          'is fine, the same bucket is not.',
      )
    else {
      // The other way the two can be the same bucket: the CDN hostname is serving it.
      const cdn = get('PUBLIC_CDN_URL')
      let cdnHost = ''
      try {
        cdnHost = cdn ? new URL(cdn).hostname : ''
      } catch {}
      if (cdnHost && cdnHost.split('.')[0] === backupBucket)
        warn(
          SECTION_STORAGE,
          'backup destination',
          `PUBLIC_CDN_URL (${cdnHost}) looks like it points at the backup bucket`,
          'The backups bucket must have no custom domain at all. Check R2 → ' +
            backupBucket +
            ' → Settings → Public access reads "not allowed".',
        )
      else
        pass(
          SECTION_STORAGE,
          'backup destination',
          `${backupBucket} (separate from ${appBucket || 'the app bucket'})`,
        )
    }
    if (!get('BACKUP_S3_ACCESS_KEY_ID') && !get('S3_ACCESS_KEY_ID'))
      fail(
        SECTION_STORAGE,
        'backup credentials',
        'no key for the backups bucket',
        'Set BACKUP_S3_ACCESS_KEY_ID / BACKUP_S3_SECRET_ACCESS_KEY, or an account-wide ' +
          'S3_ACCESS_KEY_ID the backup job can fall back to. An R2 token scoped to ' +
          '`palscans` cannot write to `palscans-backups`.',
      )
  }

  if (backupDir) {
    const fsRoot = get('STORAGE_FS_ROOT')
    if (fsRoot && path.resolve(backupDir).startsWith(path.resolve(fsRoot)))
      fail(
        SECTION_STORAGE,
        'BACKUP_DIR',
        `${backupDir} is inside STORAGE_FS_ROOT (${fsRoot})`,
        'Dumps would be served by the storage host. Put BACKUP_DIR somewhere the app never ' +
          'serves, e.g. /var/backups/palscans on a mounted volume.',
      )
    else pass(SECTION_STORAGE, 'BACKUP_DIR', backupDir)
  }

  const retention = get('BACKUP_RETENTION_DAYS')
  if (retention && (!/^\d+$/.test(retention) || Number(retention) < 1))
    fail(
      SECTION_STORAGE,
      'BACKUP_RETENTION_DAYS',
      `is "${retention}"`,
      'It must be a positive integer (days). The default is 14.',
    )
}

/**
 * The docs/18 §9 exposure check, automated: an *unprotected* bucket answers 404 for a key
 * that does not exist, while the WAF rule answers 403 before R2 is asked. So 403 is the pass
 * and 404 means the rule is not matching and the raw uploads are readable by anyone.
 */
const checkCdnExposure = async () => {
  const cdn = get('PUBLIC_CDN_URL')
  if (!cdn)
    return fail(
      SECTION_STORAGE,
      'PUBLIC_CDN_URL',
      'is not set',
      "Set PUBLIC_CDN_URL=https://cdn.palscans.org — the bucket's custom domain from " +
        'docs/18 §2. Without it every image URL the app builds points back at the app host.',
    )
  let url
  try {
    url = new URL(cdn)
  } catch {
    return fail(
      SECTION_STORAGE,
      'PUBLIC_CDN_URL',
      `is not a valid URL (${cdn})`,
      'Write it as https://cdn.palscans.org',
    )
  }
  let siteHost = ''
  try {
    siteHost = new URL(get('SITE_URL')).hostname
  } catch {}
  if (siteHost && url.hostname === siteHost)
    warn(
      SECTION_STORAGE,
      'PUBLIC_CDN_URL',
      `is the app host (${url.hostname})`,
      "Page images should come from the bucket's own hostname, not through your server: " +
        'that is the whole reason docs/08 chose R2 (zero egress) and it is the largest ' +
        'traffic the site has.',
    )
  else if (url.protocol !== 'https:')
    warn(
      SECTION_STORAGE,
      'PUBLIC_CDN_URL',
      `is ${url.protocol}//`,
      'A https:// page cannot load http:// images; browsers block them as mixed content.',
    )
  else pass(SECTION_STORAGE, 'PUBLIC_CDN_URL', url.origin)

  if (OFFLINE) return skip(SECTION_STORAGE, 'CDN exposure', 'skipped (--offline)')
  const probe = `${url.origin}/uploads/preflight-${randomBytes(4).toString('hex')}`
  let status
  try {
    const res = await fetch(probe, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    })
    status = res.status
  } catch (error) {
    return warn(
      SECTION_STORAGE,
      'CDN exposure',
      `could not reach ${url.origin} (${error.message})`,
      "Re-run this once DNS and the bucket's custom domain are live, or walk the check by " +
        'hand from docs/18 §2 → "Verify it". It is the one that costs you if it is wrong.',
    )
  }
  if (status === 403)
    pass(SECTION_STORAGE, 'CDN exposure', `${probe.replace(/preflight-\w+/, 'preflight-…')} → 403`)
  else if (status === 404)
    fail(
      SECTION_STORAGE,
      'CDN exposure',
      `a missing key under /uploads/ answers 404, not 403 — the bucket is open`,
      'The WAF custom rule from docs/18 §2 is not live or not matching. 404 means R2 was ' +
        'asked and had nothing; 403 means the rule blocked the request before R2 was asked. ' +
        'Until it is fixed, every raw upload — the un-re-encoded original of every page of ' +
        'every chapter, premium included — is world-readable at ' +
        `${url.origin}/uploads/… . Add the rule (Security → WAF → Custom rules, edited as an ` +
        'expression), then re-run this. Also confirm Public access → Public Development URL ' +
        'reads "Not allowed": the r2.dev hostname is outside your zone and no rule applies to it.',
    )
  else
    warn(
      SECTION_STORAGE,
      'CDN exposure',
      `a missing key under /uploads/ answers ${status}`,
      'Expected 403 (blocked by the WAF rule). Anything else means something other than the ' +
        'rule is answering — check for a redirect, a page rule, or a proxy in front. Walk ' +
        'docs/18 §2 → "Verify it" by hand.',
    )
}

// ------------------------------------------------------------------ 6 · admin

const SECTION_ADMIN = '5 · Admin account'

const checkAdmin = async () => {
  if (!sql) return skip(SECTION_ADMIN, 'admin account', 'skipped — no database connection')
  let admins
  try {
    admins = await sql`
      select id, email, totp_enabled_at, email_verified_at
      from users where role = 'admin' and deleted_at is null order by id asc`
  } catch (error) {
    return skip(SECTION_ADMIN, 'admin account', `skipped — ${error.message}`)
  }
  if (admins.length === 0)
    return fail(
      SECTION_ADMIN,
      'admin account',
      'no account has the admin role',
      'There is no bootstrap flow by design (docs/18 §5): register at ' +
        `${get('SITE_URL') || 'https://your-site'}/register like any reader, then promote ` +
        'yourself once —\n' +
        '        docker compose --env-file .env -f infra/docker-compose.yml exec postgres \\\n' +
        "          psql -U pal -d palscans -c \"update users set role = 'admin', " +
        "email_verified_at = now() where email = 'you@example.com'\"\n" +
        '        Have your authenticator app open before you run it: the moment it lands you ' +
        'are an admin, and an admin without TOTP cannot open the panel at all.',
    )

  const enrolled = admins.filter((row) => row.totp_enabled_at !== null)
  if (enrolled.length === 0)
    fail(
      SECTION_ADMIN,
      'admin TOTP',
      `${admins.length} admin account(s), none with TOTP enrolled (${admins.map((a) => a.email).join(', ')})`,
      'The panel is unreachable until one of them enrols: /admin redirects to ' +
        '/me/security?totp=required and every admin API route answers 403 totp_required, ' +
        'reads included. Sign in, then Two-factor authentication → Set up two-factor, scan ' +
        'the QR code, enter the six-digit code, Turn on. There are no recovery codes in this ' +
        'build — enrol on a device whose backups you trust, or add the same secret to a ' +
        'second authenticator while the QR code is on screen.',
    )
  else
    pass(
      SECTION_ADMIN,
      'admin TOTP',
      `${enrolled.length} of ${admins.length} admin account(s) enrolled (${enrolled.map((a) => a.email).join(', ')})`,
    )

  const unverified = admins.filter((row) => row.email_verified_at === null)
  if (unverified.length)
    warn(
      SECTION_ADMIN,
      'admin email',
      `${unverified.map((a) => a.email).join(', ')} not marked verified`,
      'Set email_verified_at with the same UPDATE as above if mail is not working yet, or ' +
        'complete the verification mail once Integrations → Email is configured.',
    )
}

/**
 * The docs/19 restore trap: sealed rows that the current key cannot open are treated as
 * *absent*, so every integration silently falls back to the environment, /api/health still
 * answers ok, and the panel still shows the green "Sealed with CREDENTIALS_KEY" banner —
 * because it reports where the key came from, not whether it opens anything.
 */
const checkSealedCredentials = async () => {
  if (!sql) return skip(SECTION_ADMIN, 'stored credentials', 'skipped — no database connection')
  let rows
  try {
    rows = await sql`select key, sealed from app_credentials`
  } catch {
    return skip(SECTION_ADMIN, 'stored credentials', 'skipped — app_credentials does not exist yet')
  }
  if (rows.length === 0)
    return pass(
      SECTION_ADMIN,
      'stored credentials',
      'none stored yet — they go into Admin → System → Integrations after first boot',
    )
  let core
  try {
    core = await import(pathToFileURL(requireFrom('apps/web').resolve('@palscans/core')).href)
  } catch {
    return skip(
      SECTION_ADMIN,
      'stored credentials',
      `${rows.length} stored, but @palscans/core is not built here so they could not be ` +
        'opened. Run `pnpm build`, or run this inside the web container.',
    )
  }
  const source = { CREDENTIALS_KEY: get('CREDENTIALS_KEY'), SESSION_SECRET: get('SESSION_SECRET') }
  const unreadable = rows.filter((row) => core.open(new Uint8Array(row.sealed), source) === null)
  if (unreadable.length === rows.length)
    fail(
      SECTION_ADMIN,
      'stored credentials',
      `none of the ${rows.length} stored credentials can be opened with this ${core.sealingKeySource(source) ?? 'key'}`,
      'The sealing key does not match the one they were saved with — the classic symptom of ' +
        'restoring a dump onto a host with a different CREDENTIALS_KEY. Nothing will fail ' +
        'loudly: every integration falls back to the (empty) environment, the panel still ' +
        'shows a green "Sealed" banner, and storage, mail, OAuth, Stripe, Turnstile, push and ' +
        'Discord are all silently off. Restore the original CREDENTIALS_KEY from your ' +
        'password manager (infra/RUNBOOK.md makes that step 0 of any restore), or re-enter ' +
        'every credential in the panel.',
    )
  else if (unreadable.length)
    fail(
      SECTION_ADMIN,
      'stored credentials',
      `${unreadable.length} of ${rows.length} stored credentials cannot be opened: ${unreadable.map((r) => r.key).join(', ')}`,
      'Those rows are treated as absent, so those integrations fall back to the environment ' +
        'with no error. Re-enter them in Admin → System → Integrations.',
    )
  else
    pass(
      SECTION_ADMIN,
      'stored credentials',
      `${rows.length} stored, all readable with ${core.sealingKeySource(source)}`,
    )
}

// -------------------------------------------------------------------- output

const ICON = { pass: '✔', warn: '!', fail: '✖', skip: '·' }

const report = () => {
  const failures = results.filter((r) => r.status === 'fail')
  const warnings = results.filter((r) => r.status === 'warn')

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          envFile: ENV_FILE,
          offline: OFFLINE,
          results,
          failed: failures.length,
          warned: warnings.length,
        },
        null,
        2,
      ),
    )
    return failures.length ? 1 : 0
  }

  console.log(`PALScans deployment preflight`)
  console.log(`env       ${ENV_FILE}${fileVars === null ? ' (not found)' : ''}`)
  console.log(`checks    production${OFFLINE ? ' · offline (network checks skipped)' : ''}`)
  console.log('')
  let section = null
  const width = Math.max(...results.map((r) => r.name.length)) + 2
  for (const r of results) {
    if (r.section !== section) {
      section = r.section
      console.log(section)
    }
    console.log(`  ${ICON[r.status]} ${r.name.padEnd(width)}${r.detail}`)
  }
  console.log('')

  if (warnings.length) {
    console.log(`${warnings.length} warning(s) — the site will run, but read these:`)
    warnings.forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.name}: ${r.detail}`)
      if (r.fix) console.log(`     → ${r.fix}`)
    })
    console.log('')
  }

  if (failures.length === 0) {
    console.log('Nothing blocking. Continue with docs/18 §4 (first boot).')
    return 0
  }
  console.log(`Fix these ${failures.length} thing(s) before first boot:`)
  failures.forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.name}: ${r.detail}`)
    console.log(`     → ${r.fix}`)
  })
  console.log('')
  return 1
}

// ----------------------------------------------------------------------- run

try {
  checkEnvFile()
  checkSecrets()
  checkDatabaseUrl()
  await checkSiteUrl()
  checkTrustedProxy()
  await checkOriginLockdown()
  checkWebConcurrency()

  await openDatabase()
  await checkMigrations()
  await checkConnectionBudget()
  await checkPgTools()

  await checkRedis()

  await checkStorage()
  checkBackupDestination()
  await checkCdnExposure()

  await checkAdmin()
  await checkSealedCredentials()
} finally {
  if (sql) await sql.end({ timeout: 5 }).catch(() => {})
}

process.exit(report())
