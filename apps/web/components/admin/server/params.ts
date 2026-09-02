import { z } from 'zod'

/**
 * Admin tables keep filters, sort and page in the URL (docs/04 interaction rules). The page
 * is capped so `?page=1e15` cannot become a petabyte OFFSET.
 */
export const pageSchema = z.coerce.number().int().min(1).max(10_000).catch(1)

export const idParam = z.coerce.number().int().positive()

export type SearchParams = Record<string, string | string[] | undefined>

export const first = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v

export const parseSearch = <T>(schema: z.ZodType<T>, params: SearchParams): T => {
  const flat: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(params)) flat[k] = first(v)
  return schema.parse(flat)
}

export const PAGE_SIZE = 25
