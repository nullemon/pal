import { messages } from '@palscans/core/messages'
import { z } from 'zod'
import { ModerationQueue } from '@/components/admin/client/ModerationQueue'
import { loadModerationCounts, loadModerationQueue } from '@/components/admin/server/moderation'
import { pageSchema, parseSearch, type SearchParams } from '@/components/admin/server/params'
import { Kbd, PageHeader, Pagination } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'

const schema = z.object({
  tab: z.enum(['pending', 'reported', 'flagged', 'all']).catch('pending'),
  page: pageSchema,
})

export default async function CommentsQueuePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  await withPermission('comment.moderate', { returnTo: '/admin/comments' })
  const p = parseSearch(schema, await searchParams)
  const [queue, counts] = await Promise.all([
    loadModerationQueue(p.tab, p.page),
    loadModerationCounts(),
  ])
  const m = messages.admin.moderation
  return (
    <>
      <PageHeader
        title={m.title}
        subtitle={m.subtitle}
        actions={
          <div className="flex items-center gap-3 text-[13px]">
            <span className="hidden items-center gap-1 text-fg-subtle md:flex">
              <Kbd>j</Kbd>
              <Kbd>k</Kbd>
              <Kbd>a</Kbd>
              <Kbd>r</Kbd>
              <Kbd>d</Kbd>
              <Kbd>b</Kbd>
            </span>
            <a href="/admin/comments/images" className="text-fg-muted hover:text-fg">
              {m.imagesLink}
            </a>
            <a href="/admin/comments/settings" className="text-fg-muted hover:text-fg">
              {m.settingsLink}
            </a>
          </div>
        }
      />
      <ModerationQueue tab={p.tab} counts={counts} items={queue.items} />
      <Pagination
        page={p.page}
        pages={queue.pages}
        hrefFor={(n) => `/admin/comments?tab=${p.tab}&page=${n}`}
      />
    </>
  )
}
