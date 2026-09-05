import type { BUILT_LAYOUTS } from '@/components/admin/schemas-appearance'
import { HomeA } from '@/components/home/layouts/HomeA'
import { HomeB } from '@/components/home/layouts/HomeB'
import { HomeC } from '@/components/home/layouts/HomeC'
import { HomeD } from '@/components/home/layouts/HomeD'
import { HomeE } from '@/components/home/layouts/HomeE'
import { HomeF } from '@/components/home/layouts/HomeF'
import type { HomeLayoutComponent } from '@/components/home/layouts/types'
import { resolveDirection } from './resolve'

/**
 * The home layout registry (docs/17 §F). Every direction that is actually built has one
 * entry here; `BUILT_LAYOUTS` in `components/admin/schemas-appearance.ts` is the
 * client-safe copy the admin screen reads, and the `satisfies` clause below fails the
 * typecheck if the two ever drift. Layouts are presentational — `loadHomeView()` does the
 * loading once and every direction consumes the identical props.
 */
type BuiltHome = (typeof BUILT_LAYOUTS)['home'][number]

const HOME_LAYOUTS = {
  A: HomeA,
  B: HomeB,
  C: HomeC,
  D: HomeD,
  E: HomeE,
  F: HomeF,
} satisfies Record<BuiltHome, HomeLayoutComponent>

/** The home layout for `settings.layouts.home`, with `?layout=` for the admin preview links. */
export const homeLayout = (selected: string, preview?: string): HomeLayoutComponent =>
  HOME_LAYOUTS[resolveDirection(HOME_LAYOUTS, selected, preview, 'A')]
