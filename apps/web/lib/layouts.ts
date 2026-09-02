import { BUILT_LAYOUTS, DIRECTIONS, type Direction } from '@/components/admin/schemas-appearance'
import { HomeA } from '@/components/home/layouts/HomeA'
import { HomeC } from '@/components/home/layouts/HomeC'
import { HomeD } from '@/components/home/layouts/HomeD'
import { HomeE } from '@/components/home/layouts/HomeE'
import { HomeF } from '@/components/home/layouts/HomeF'
import type { HomeLayoutComponent } from '@/components/home/layouts/types'
import { SeriesB } from '@/components/series/layouts/SeriesB'
import { SeriesC } from '@/components/series/layouts/SeriesC'
import { SeriesD } from '@/components/series/layouts/SeriesD'
import { SeriesE } from '@/components/series/layouts/SeriesE'
import { SeriesF } from '@/components/series/layouts/SeriesF'
import type { SeriesLayoutComponent } from '@/components/series/layouts/types'

/**
 * The layout registry (docs/17 §F). Every direction that is actually built has one entry
 * here; `BUILT_LAYOUTS` in `components/admin/schemas-appearance.ts` is the client-safe copy
 * the admin screen reads, and the `satisfies` clauses below fail the typecheck if the two
 * ever drift. Layouts are presentational — `loadHomeView()` / `loadSeriesView()` do the
 * loading once and every direction consumes the identical props.
 */
type BuiltHome = (typeof BUILT_LAYOUTS)['home'][number]
type BuiltSeries = (typeof BUILT_LAYOUTS)['series'][number]

const HOME_LAYOUTS = {
  A: HomeA,
  C: HomeC,
  D: HomeD,
  E: HomeE,
  F: HomeF,
} satisfies Record<BuiltHome, HomeLayoutComponent>

const SERIES_LAYOUTS = {
  B: SeriesB,
  C: SeriesC,
  D: SeriesD,
  E: SeriesE,
  F: SeriesF,
} satisfies Record<BuiltSeries, SeriesLayoutComponent>

const isDirection = (v: string): v is Direction => (DIRECTIONS as readonly string[]).includes(v)

const resolve = <K extends string>(
  registry: Record<K, unknown>,
  selected: string,
  preview: string | undefined,
  fallback: K,
): K => {
  const wanted = preview && isDirection(preview) ? preview : selected
  return wanted in registry ? (wanted as K) : fallback
}

/** The home layout for `settings.layouts.home`, with `?layout=` for the admin preview links. */
export const homeLayout = (selected: string, preview?: string): HomeLayoutComponent =>
  HOME_LAYOUTS[resolve(HOME_LAYOUTS, selected, preview, 'A')]

/** The series layout for `settings.layouts.series`, with `?layout=` for the preview links. */
export const seriesLayout = (selected: string, preview?: string): SeriesLayoutComponent =>
  SERIES_LAYOUTS[resolve(SERIES_LAYOUTS, selected, preview, 'B')]

export { BUILT_LAYOUTS }
