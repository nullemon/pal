import { z } from 'zod'
import { scopeDiscardRoute, scopeDraftRoute } from '@/components/admin/server/appearance-routes'
import { menusSettingSchema } from '@/lib/chrome/schema'

/**
 * `PUT /api/admin/appearance/menus` — Appearance → Header, footer, menus (docs/15): the
 * header links and primary button, the footer columns, the community block, the copyright and
 * attribution lines, the mobile bottom nav and the announcement bar. Saved as a **draft**;
 * `./publish` is what reaches the site.
 *
 * The whole document is replaced rather than merged: the screen edits every field it stores,
 * and a merge would make "remove the last footer column" impossible to express. Unknown keys
 * on the stored row are dropped, which is how the seeded shape from before this screen
 * existed gets normalised on the first save.
 */
export const PUT = scopeDraftRoute('menus', z.object({ settings: menusSettingSchema }))
export const DELETE = scopeDiscardRoute('menus')
