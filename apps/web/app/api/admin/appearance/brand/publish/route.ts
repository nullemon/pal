import { appearancePublishSchema } from '@/components/admin/schemas-appearance'
import { scopePublishRoute } from '@/components/admin/server/appearance-routes'

/**
 * `POST /api/admin/appearance/brand/publish { versionId?, dropMissingAssets? }` — make the
 * brand draft live, or restore an earlier version.
 *
 * The only publish route with a preflight: a brand version points at uploaded objects, and
 * one whose logo is no longer in storage is refused with `409 missing_assets` rather than
 * restored into a broken mark. See `missingBrandAssets` in `lib/appearance/documents.ts` for
 * why that case is rare and what makes it possible at all.
 */
export const POST = scopePublishRoute('brand', appearancePublishSchema)
