import { NotFoundPanel } from '@/components/shell/NotFoundPanel'

/**
 * The 404 for anything inside the site group — a missing series, chapter, genre or list.
 *
 * It draws no header, footer or bottom nav: `(site)/layout.tsx` already provides them, and
 * rendering them again gave every broken link two navbars and two footers. The body is the
 * same component the root 404 uses, so the two pages are identical to a reader.
 */
export default function SiteNotFound() {
  return <NotFoundPanel />
}
