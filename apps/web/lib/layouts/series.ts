import type { BUILT_LAYOUTS } from '@/components/admin/schemas-appearance'
import { SeriesA } from '@/components/series/layouts/SeriesA'
import { SeriesB } from '@/components/series/layouts/SeriesB'
import { SeriesC } from '@/components/series/layouts/SeriesC'
import { SeriesD } from '@/components/series/layouts/SeriesD'
import { SeriesE } from '@/components/series/layouts/SeriesE'
import { SeriesF } from '@/components/series/layouts/SeriesF'
import type { SeriesLayoutComponent } from '@/components/series/layouts/types'
import { resolveDirection } from './resolve'

/**
 * The series layout registry — the counterpart to `home.ts`, kept apart from it so neither
 * page ships the other's client components (see `resolve.ts`). `BUILT_LAYOUTS` is the
 * client-safe copy the admin screen reads; the `satisfies` clause fails the typecheck if
 * the two ever drift.
 */
type BuiltSeries = (typeof BUILT_LAYOUTS)['series'][number]

const SERIES_LAYOUTS = {
  A: SeriesA,
  B: SeriesB,
  C: SeriesC,
  D: SeriesD,
  E: SeriesE,
  F: SeriesF,
} satisfies Record<BuiltSeries, SeriesLayoutComponent>

/** The series layout for `settings.layouts.series`, with `?layout=` for the preview links. */
export const seriesLayout = (selected: string, preview?: string): SeriesLayoutComponent =>
  SERIES_LAYOUTS[resolveDirection(SERIES_LAYOUTS, selected, preview, 'B')]
