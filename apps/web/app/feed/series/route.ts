import { serveFeed } from '@/lib/seo/feed-data'

/** /feed/series — new series. */
export const GET = (request: Request) => serveFeed(request, { kind: 'new-series' })

/** Served per request (settings-driven); never prerendered at build time. */
export const dynamic = 'force-dynamic'
