/** `/series/slug/chapter-12.5` — the canonical chapter URL every direction links to. */
export const chapterHref = (slug: string, n: number) =>
  `/series/${slug}/chapter-${Number.parseFloat(n.toFixed(3))}`
