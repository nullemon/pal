import { revalidateTag } from 'next/cache'
import type { z } from 'zod'
import {
  type BrandDocument,
  missingBrandAssets,
  type ScopeDocument,
  scopeAdapter,
  withoutAssets,
} from '@/lib/appearance/documents'
import type { AppearanceScope } from '@/lib/appearance/scope'
import {
  discardDraft,
  draftDocument,
  publishScope,
  saveDraft,
  versionWithBase,
} from '@/lib/appearance/versions'
import { fail, ok, parseJson, withPermission } from '@/lib/auth'
import { audit } from './audit'
import { purgeAppearance, purgeSettings } from './cache'

/**
 * The route halves of the draft → publish → history workflow, written once for every
 * Appearance screen (docs/15 "Presets, preview, history").
 *
 * Each screen's route file is now three lines: name the scope, name the zod schema for the
 * document it edits, export the handler. The theme's routes kept their paths and their
 * request shapes and go through here as well, so there is one publish implementation, one
 * audit vocabulary and one set of failure codes rather than a second system for the three
 * screens that were missing it.
 *
 * ## What a save costs
 *
 * `PUT` writes one row in `appearance_settings` and purges **nothing**. That is the point of
 * the whole exercise: an operator can be mid-way through rewriting the header and the site
 * is still serving what was published. Only `POST .../publish` writes the live rows and
 * invalidates caches.
 */

const scopeMessages = {
  theme: { action: 'appearance', purge: purgeAppearance },
  brand: { action: 'settings.brand', purge: purgeSettings },
  menus: { action: 'settings.menus', purge: purgeSettings },
  copy: { action: 'settings.copy', purge: purgeSettings },
} as const satisfies Record<AppearanceScope, { action: string; purge: () => void }>

/** `PUT` — save the draft. One row, no cache purge, the live site untouched. */
export const scopeDraftRoute = <S extends AppearanceScope>(
  scope: S,
  schema: z.ZodType<{ settings: unknown }>,
) =>
  withPermission('settings.write', async (request, _ctx, user) => {
    const parsed = await parseJson(request, schema)
    if (!parsed.ok) return parsed.response
    const adapter = scopeAdapter(scope)
    const doc = adapter.parse(parsed.data.settings)
    const id = await saveDraft(scope, doc, user.id)
    await audit({
      actorId: user.id,
      action: `${scopeMessages[scope].action}.draft`,
      targetType: 'appearance',
      targetId: id,
      after: adapter.summary(doc),
      request,
    })
    return ok({ id, settings: doc })
  })

/** `DELETE` — throw the draft away; the screen falls back to what is live. */
export const scopeDiscardRoute = (scope: AppearanceScope) =>
  withPermission('settings.write', async (request, _ctx, user) => {
    const id = await discardDraft(scope)
    if (id === null) return fail(404, 'no_draft')
    await audit({
      actorId: user.id,
      action: `${scopeMessages[scope].action}.draft_discarded`,
      targetType: 'appearance',
      targetId: id,
      request,
    })
    return ok({ id })
  })

export interface PublishBody {
  versionId?: number
  /** Restore anyway, with the slots whose uploads are gone left empty. */
  dropMissingAssets?: boolean
}

/**
 * `POST .../publish` — publish the draft, or revert to a version.
 *
 * The brand scope gets one extra step, and it is the reason "restore" can be trusted: before
 * anything is written, every upload the candidate document points at is checked against
 * storage. A version whose logo is gone is refused with `409 missing_assets` and the list of
 * slots, so the operator finds out here rather than by looking at a hole in the header. They
 * can then restore it deliberately without those images, which is a different request and a
 * different audit row.
 */
export const scopePublishRoute = <S extends AppearanceScope>(
  scope: S,
  schema: z.ZodType<PublishBody>,
) =>
  withPermission('settings.write', async (request, _ctx, user) => {
    const parsed = await parseJson(request, schema)
    if (!parsed.ok) return parsed.response
    const { versionId, dropMissingAssets } = parsed.data
    const adapter = scopeAdapter(scope)

    let transform: ((doc: ScopeDocument<S>) => ScopeDocument<S>) | undefined
    if (scope === 'brand') {
      const candidate = versionId
        ? (await versionWithBase('brand', versionId))?.doc
        : await draftDocument('brand')
      if (!candidate) return fail(versionId ? 404 : 400, versionId ? 'not_found' : 'no_draft')
      const missing = await missingBrandAssets(candidate)
      if (missing.length > 0) {
        if (!dropMissingAssets)
          return Response.json(
            {
              error: 'missing_assets',
              // `message` carries the list too: the admin fetch wrapper only surfaces
              // `error` and `message`, and the operator needs to be told *which* slots.
              message: missing.map((m) => m.slot).join(', '),
              slots: missing.map((m) => m.slot),
            },
            { status: 409 },
          )
        // Narrowed by `scope === 'brand'` above, which TypeScript cannot carry into `S`.
        transform = ((doc: BrandDocument) => withoutAssets(doc, missing)) as unknown as (
          doc: ScopeDocument<S>,
        ) => ScopeDocument<S>
      }
    }

    const result = await publishScope(scope, { versionId, userId: user.id, transform })
    if ('error' in result) return fail(result.error === 'not_found' ? 404 : 400, result.error)

    scopeMessages[scope].purge()
    // A brand publish renames the site, and `<title>` / OpenGraph read that from `seo_settings`.
    if (scope === 'brand') revalidateTag('seo', 'max')

    await audit({
      actorId: user.id,
      action: `${scopeMessages[scope].action}.${versionId ? 'revert' : 'publish'}`,
      targetType: 'appearance',
      targetId: result.id,
      before: adapter.summary(result.previous),
      after: { ...adapter.summary(result.doc), from: versionId ?? null },
      request,
    })
    return ok({ id: result.id, settings: result.doc })
  })
