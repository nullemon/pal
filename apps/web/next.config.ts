import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnvConfig } from '@next/env'
import type { NextConfig } from 'next'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../..')

// The single .env lives at the repo root; load it for every workspace.
loadEnvConfig(repoRoot, process.env.NODE_ENV !== 'production')

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@palscans/ui'],
  outputFileTracingRoot: repoRoot,
  images: {
    // Covers and pages are pre-encoded by the worker (AVIF/WebP, four widths) and served
    // from the CDN / local storage host, so the Next optimizer has nothing to add.
    unoptimized: true,
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
