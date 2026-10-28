import { normaliseLanguage } from '@palscans/core/languages'
import { messages } from '@palscans/core/messages'
import { can } from '@palscans/core/permissions'
import { z } from 'zod'
import { audit } from '@/components/admin/server/audit'
import {
  checkManifestSourceNow,
  followManifest,
  forgetManifestSource,
  listManifestSources,
  setManifestSourceActive,
} from '@/components/admin/server/manifest-sources'
import { idParam } from '@/components/admin/server/params'
import { fail, notFound, ok, parseJson, withPermission } from '@/lib/auth'

/**
 * /api/admin/series/:id/manifest-sources — the manifest links this series follows
 * (docs/03 "Keeping a manifest in sync").
 *
 * GET lists them, POST follows one (or updates the terms of one already followed), PATCH
 * pauses / resumes / asks for a check now, DELETE stops following. The checking is the
 * worker's job; everything here is bookkeeping plus one enqueue.
 *
 * `chapter.create` throughout: following a manifest is a standing instruction to create
 * chapters, so it is the same gate as creating one by hand. Setting it to publish on its own
 * additionally needs `chapter.publish` — otherwise an uploader could arrange for a third
 * party's file to publish here, which is precisely the permission they do not have.
 */

const followBody = z.object({
  url: z.string().min(1).max(500),
  language: z.string().max(16).optional(),
  store: z.enum(['remote', 'storage']).default('remote'),
  /**
   * Absent means "whatever this operator is allowed to do", not "draft".
   *
   * The point of following a file is that releases appear without anybody being awake, so
   * defaulting to draft made the feature do half its job until somebody found the toggle.
   * Left optional rather than defaulted in the schema because the guard below is about an
   * *explicit* request: asking to publish without the permission is refused, while not
   * asking falls back to what the permission allows.
   */
  publishMode: z.enum(['ready', 'publish']).optional(),
  isPremium: z.boolean().optional(),
  /** Which group's version to take when the file offers several. */
  group: z.string().max(120).nullish(),
})

const patchBody = z.object({
  id: z.number().int().positive(),
  active: z.boolean().optional(),
  /** Ask the worker to check this source now rather than waiting for the interval. */
  check: z.boolean().optional(),
})

const deleteBody = z.object({ id: z.number().int().positive() })

export const GET = withPermission<{ id: string }>('chapter.read', async (_request, ctx) => {
  const id = idParam.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  return ok({ sources: await listManifestSources(id.data) })
})

export const POST = withPermission<{ id: string }>('chapter.create', async (request, ctx, user) => {
  const id = idParam.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  const parsed = await parseJson(request, followBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  if (body.publishMode === 'publish' && !can(user, 'chapter.publish'))
    return fail(403, 'forbidden', messages.errors.forbidden)
  const publishMode = body.publishMode ?? (can(user, 'chapter.publish') ? 'publish' : 'ready')
  const source = await followManifest({
    seriesId: id.data,
    url: body.url.trim(),
    language: normaliseLanguage(body.language),
    store: body.store,
    publishMode,
    isPremium: body.isPremium ?? false,
    groupName: body.group?.trim() || null,
    userId: user.id,
  })
  if (!source) return fail(500, 'insert_failed', messages.errors.generic)
  await audit({
    actorId: user.id,
    action: 'series.follow_manifest',
    targetType: 'series',
    targetId: id.data,
    after: { url: source.url, language: source.language, publishMode: source.publishMode },
  })
  return ok({ source })
})

export const PATCH = withPermission<{ id: string }>(
  'chapter.create',
  async (request, ctx, user) => {
    const id = idParam.safeParse((await ctx.params).id)
    if (!id.success) return notFound()
    const parsed = await parseJson(request, patchBody)
    if (!parsed.ok) return parsed.response
    const { id: sourceId, active, check } = parsed.data
    // Scoped to this series' own sources, so the id in the body cannot reach another series'.
    const mine = (await listManifestSources(id.data)).find((s) => s.id === sourceId)
    if (!mine) return notFound()
    const source = active === undefined ? mine : await setManifestSourceActive(sourceId, active)
    const queued = check === true ? await checkManifestSourceNow(sourceId) : false
    await audit({
      actorId: user.id,
      action: 'series.manifest_source',
      targetType: 'series',
      targetId: id.data,
      after: { sourceId, active, checked: queued },
    })
    return ok({ source: source ?? mine, queued })
  },
)

export const DELETE = withPermission<{ id: string }>(
  'chapter.create',
  async (request, ctx, user) => {
    const id = idParam.safeParse((await ctx.params).id)
    if (!id.success) return notFound()
    const parsed = await parseJson(request, deleteBody)
    if (!parsed.ok) return parsed.response
    const removed = await forgetManifestSource(parsed.data.id, id.data)
    if (!removed) return notFound()
    await audit({
      actorId: user.id,
      action: 'series.unfollow_manifest',
      targetType: 'series',
      targetId: id.data,
      after: { sourceId: parsed.data.id },
    })
    return ok({ removed })
  },
)
