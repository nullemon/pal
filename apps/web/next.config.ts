import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnvConfig } from '@next/env'
import type { NextConfig } from 'next'
import { securityHeaders } from './lib/security/csp'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../..')

// The single .env lives at the repo root; load it for every workspace. Next has already
// called loadEnvConfig for apps/web (which has no .env) and @next/env memoises the result,
// so the repo-root call must force a reload or `next start` never sees DATABASE_URL.
loadEnvConfig(repoRoot, process.env.NODE_ENV !== 'production', undefined, true)

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `X-Powered-By: Next.js` names the framework and its major version on every response —
  // free reconnaissance, no benefit to anyone running the site.
  poweredByHeader: false,
  transpilePackages: ['@palscans/ui'],
  // Native / WASM database drivers are loaded from node_modules at runtime rather than
  // bundled (PGlite ships a WASM binary, postgres-js opens sockets). Workspace packages
  // cannot be listed here — Next always bundles local packages.
  serverExternalPackages: ['drizzle-orm', 'postgres', '@electric-sql/pglite'],
  outputFileTracingRoot: repoRoot,
  images: {
    // Covers and pages are pre-encoded by the worker (AVIF/WebP, four widths) and served
    // from the CDN / local storage host, so the Next optimizer has nothing to add.
    unoptimized: true,
  },
  /**
   * Content-Security-Policy (docs/08 "Security baseline"). Defined here rather than in
   * `infra/Caddyfile` or `proxy.ts` for two reasons: the proxy's matcher deliberately does
   * not run on `/` or the API, so a policy set there would miss the home page; and headers
   * declared here also apply to `next start` on its own, so a deployment without Caddy in
   * front is not silently unprotected. `lib/security/csp.ts` carries the policies and, more
   * importantly, the reasoning about what they do not cover.
   */
  async headers() {
    return securityHeaders()
  },
  async rewrites() {
    return [
      // `_`-prefixed app folders are private in the App Router, so the dev storage handler
      // lives at /api/storage and is exposed at the URL the fs storage driver uses.
      { source: '/_storage/:path*', destination: '/api/storage/:path*' },
    ]
  },
}

export default nextConfig
