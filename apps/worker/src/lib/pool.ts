/** Bounded-concurrency map (the `p-limit` shape from docs/03, without the dependency). */
export const pool = async <T, R>(
  items: readonly T[],
  width: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(width, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++
      const item = items[i]
      if (item !== undefined) results[i] = await fn(item, i)
    }
  })
  await Promise.all(workers)
  return results
}
