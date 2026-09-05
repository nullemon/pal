'use client'

import { config } from 'zod/v4/core'

/**
 * Turns zod's JIT off **in the browser, in the admin panel only**.
 *
 * `lib/security/csp.ts` sends `script-src` without `'unsafe-eval'`. Zod compiles object
 * schemas with `new Function` when the environment allows it (`$ZodObjectJIT`) and probes
 * for that ability the first time a schema is constructed. Under this policy the probe is
 * refused, zod catches it and falls back to the interpreted parser — nothing breaks — but
 * the browser still files a `securitypolicyviolation`, which Chrome surfaces as a DevTools
 * issue. Seven panel screens did that on every load, measured. A CSP report that is always
 * there is a CSP report nobody reads.
 *
 * `config({ jitless: true })` skips the probe (zod ships a regression test for exactly this,
 * `jitless-allows-eval`). It has to run before the first schema is built, which is why this
 * hangs off the admin *layout* rather than any one schema module: the layout's client chunk
 * is evaluated before the page's.
 *
 * **Why not `instrumentation-client.ts`.** That is the textbook place for an app-entry hook,
 * and it was measured: pulling `zod/v4/core` into the global client entry cost ~6.5 KB
 * gzipped on *every* route, home and reader included, taking the home page from 171 KB to
 * 177.5 KB against the 180 KB ceiling `scripts/perf-budget.mjs` enforces. Six and a half
 * kilobytes on every reader's first paint to tidy a console message on an admin screen is
 * the wrong way round (docs/20). Here it is in the panel's chunk, which readers never load.
 *
 * The module body runs on import; the component renders nothing and exists only to give the
 * layout something to mount. The server keeps the JIT — there is no CSP there and it is a
 * real parsing speed-up on every request.
 */
config({ jitless: true })

export function ZodJitless() {
  return null
}
