import { messages } from '@palscans/core/messages'
import { can } from '@palscans/core/permissions'
import { z } from 'zod'
import { audit } from '@/components/admin/server/audit'
import { purgeCatalog } from '@/components/admin/server/cache'
import { createSeriesFromMetadata, type ImportOutcome } from '@/components/admin/server/metadata'
import { fail, getRateLimiter, ok, parseJson, rateLimited, withPermission } from '@/lib/auth'
import { metadataById } from '@/lib/metadata/anilist'

/**
 * POST /api/admin/metadata/import — create draft series from AniList ids.
 *
 * Needs `series.create` rather than `series.update`: this makes rows, and an uploader who may
 * edit a series should not be able to fill the catalogue from a third party.
 *
 * Each id is fetched fresh by id rather than trusting what the search returned — the picker
 * may have been open for an hour. Ids are processed one at a time and failures are reported
 * per id instead of failing the batch: one title AniList has since removed should not throw
 * away nine good ones.
 */
const body = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(20),
  /**
   * What the new rows start as. Absent means draft, so every existing client keeps the old
   * behaviour and nothing becomes publishable by forgetting a field.
   */
  state: z.enum(['draft', 'published', 'unlisted']).default('draft'),
})

export interface ImportFailure {
  id: number
  reason: 'not_found' | 'unavailable' | 'rate_limited' | 'failed'
}

export const POST = withPermission('series.create', async (request, _ctx, user) => {
  const parsed = await parseJson(request, body)
  if (!parsed.ok) return parsed.response

  /**
   * Creating is `series.create`; putting something straight in front of readers is not.
   *
   * `series.create` exists so an uploader can add a title. Letting that same permission
   * publish an unreviewed third-party match would make the draft default decorative.
   */
  if (parsed.data.state !== 'draft' && !can(user, 'series.update'))
    return fail(403, 'forbidden', messages.errors.forbidden)

  // One batch of 20 is 20 calls to AniList; this is the ceiling on how fast that can happen.
  const hit = await getRateLimiter().hit(`metadata-import:${user.id}`, 10, 300)
  if (!hit.ok) return rateLimited(hit.retryAfterSec)

  const created: ImportOutcome[] = []
  const failed: ImportFailure[] = []
  for (const id of parsed.data.ids) {
    const found = await metadataById(id)
    if (!found.ok) {
      failed.push({ id, reason: found.code })
      // AniList asking us to slow down applies to the whole batch, not just this id.
      if (found.code === 'rate_limited') break
      continue
    }
    try {
      created.push(await createSeriesFromMetadata(found.data, user.id, parsed.data.state))
    } catch {
      failed.push({ id, reason: 'failed' })
    }
  }

  if (created.length === 0 && failed.length > 0) return fail(502, 'source_unavailable')
  if (created.length > 0) {
    // Drafts are invisible to readers, but the panel's own lists are cached too.
    purgeCatalog()
    await audit({
      actorId: user.id,
      action: 'series.import_metadata',
      targetType: 'series',
      after: {
        source: 'anilist',
        state: parsed.data.state,
        created: created.map((c) => ({ id: c.seriesId, slug: c.slug, title: c.title })),
        failed,
      },
    })
  }
  return ok({ created, failed })
})
