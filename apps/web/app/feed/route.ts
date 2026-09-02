import { serveFeed } from '@/lib/seo/feed-data'

/** /feed — latest chapters site-wide. RSS by default, `?format=atom` for Atom (docs/12 §6). */
export const GET = (request: Request) => serveFeed(request, { kind: 'site' })

/** Served per request (settings-driven); never prerendered at build time. */
export const dynamic = 'force-dynamic'
