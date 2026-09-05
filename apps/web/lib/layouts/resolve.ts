import { DIRECTIONS, type Direction } from '@/components/admin/schemas-appearance'

/**
 * The shared half of the layout registry (docs/17 §F). The registries themselves live in
 * `home.ts` and `series.ts`, one per route, and never import each other: a single module
 * holding both would put every series layout's client components (the chapter table, the
 * action islands, the whole comment thread) into the home page's client bundle, and every
 * home layout's into the series page's. It is the same resolution either way — see
 * docs/20 "Front-end budgets".
 */
const isDirection = (v: string): v is Direction => (DIRECTIONS as readonly string[]).includes(v)

export const resolveDirection = <K extends string>(
  registry: Record<K, unknown>,
  selected: string,
  preview: string | undefined,
  fallback: K,
): K => {
  const wanted = preview && isDirection(preview) ? preview : selected
  return wanted in registry ? (wanted as K) : fallback
}
