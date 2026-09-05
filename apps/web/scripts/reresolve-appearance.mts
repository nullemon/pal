/**
 * Re-derive `appearance_settings.resolved_css` for every stored row with the current
 * resolver, and report the contrast of the text tokens it produced.
 *
 * The published row stores the CSS it was resolved with, so changing a derivation rule in
 * `lib/appearance/resolve.ts` has no effect on a live site until the row is re-resolved.
 * Publishing from the panel does it for one row; this does it for all of them, which is what
 * an upgrade needs.
 *
 *   pnpm --filter @palscans/web appearance:reresolve
 */
import { appearanceSettings, getDb } from '@palscans/db'
import { eq } from 'drizzle-orm'
import { contrast, resolveAppearance } from '../lib/appearance/resolve.js'
import { parseAppearance } from '../lib/appearance/schema.js'

const db = await getDb()
const rows = await db
  .select({
    id: appearanceSettings.id,
    settings: appearanceSettings.settings,
    status: appearanceSettings.status,
  })
  .from(appearanceSettings)

if (rows.length === 0) {
  console.log('no appearance rows — nothing to re-resolve')
  process.exit(0)
}

for (const row of rows) {
  const doc = parseAppearance(row.settings)
  const resolved = resolveAppearance(doc)
  await db
    .update(appearanceSettings)
    .set({ resolvedCss: resolved.css })
    .where(eq(appearanceSettings.id, row.id))

  const t = resolved.dark
  const surface2 = t['--color-surface-2'] ?? '#1f1a2c'
  const check = (name: string) => {
    const value = t[name]
    if (!value) return `${name}: missing`
    const ratio = contrast(value, surface2)
    return `${name} ${value} ${ratio}:1 ${ratio >= 4.5 ? 'PASS' : 'FAIL'}`
  }
  console.log(`#${row.id} (${row.status}) on ${surface2}`)
  for (const name of ['--color-fg-muted', '--color-fg-subtle', '--color-brand-hover'])
    console.log(`   ${check(name)}`)
}
process.exit(0)
