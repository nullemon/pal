import { serveFeed } from '@/lib/seo/feed-data'

/** /announcements/feed */
export const GET = (request: Request) => serveFeed(request, { kind: 'announcements' })

/** Served per request (settings-driven); never prerendered at build time. */
export const dynamic = 'force-dynamic'
