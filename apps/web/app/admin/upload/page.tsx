import { can } from '@palscans/core'
import { adminMessages } from '@palscans/core/messages/admin'
import { getDb, series } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { Uploader } from '@/components/admin/client/Uploader'
import { parseSearch, type SearchParams } from '@/components/admin/server/params'
import { PageHeader } from '@/components/admin/ui'
import { withPermission } from '@/lib/auth'

const schema = z.object({ series: z.coerce.number().int().positive().optional().catch(undefined) })

export default async function UploadPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const user = await withPermission('chapter.create', { returnTo: '/admin/upload' })
  const p = parseSearch(schema, await searchParams)
  let preset: { id: number; title: string; slug: string } | null = null
  if (p.series) {
    const db = await getDb()
    const [row] = await db
      .select({ id: series.id, title: series.title, slug: series.slug })
      .from(series)
      .where(eq(series.id, p.series))
      .limit(1)
    preset = row ?? null
  }
  const m = adminMessages.admin.upload
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <Uploader
        preset={preset}
        canPublish={can(user, 'chapter.publish')}
        canRepair={can(user, 'chapter.repair')}
      />
    </>
  )
}
