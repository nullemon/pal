import { z } from 'zod'
import { scopeDiscardRoute, scopeDraftRoute } from '@/components/admin/server/appearance-routes'
import { brandDocumentSchema } from '@/lib/appearance/documents'

/**
 * `PUT /api/admin/appearance/brand` — Appearance → Brand (docs/15 "Brand and identity"),
 * saved as a **draft**. Uploads have their own route under `./asset`, and they land in the
 * same draft.
 *
 * This used to write `settings.site`, `settings.brand` and `seo_settings.identity` straight
 * through, so a half-finished rename was live the moment it was typed. It still writes all
 * three — but on publish, from `lib/appearance/documents.ts`, where the rule that
 * `settings.site` is System → Settings' row (and only `name` and `tagline` may be replaced
 * in it) lives next to the rest of the document's shape.
 */
export const PUT = scopeDraftRoute('brand', z.object({ settings: brandDocumentSchema }))
export const DELETE = scopeDiscardRoute('brand')
