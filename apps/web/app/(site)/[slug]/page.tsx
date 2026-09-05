import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { legalMetadata, renderLegal } from '@/lib/seo/legal-page'

export const revalidate = 300

interface PageProps {
  params: Promise<{ slug: string }>
}

/**
 * Any other published row in `pages`, at its own slug (docs/13).
 *
 * Next matches static segments before a dynamic one, so this never shadows `/browse`,
 * `/terms` or any other real route — it only picks up single-segment paths nothing else
 * claims. Without it an operator could create a page in the panel that had nowhere to
 * render, which is what the admin list used to warn about.
 *
 * A slug with no published row falls through to the normal 404.
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  return legalMetadata(slug)
}

export default async function ContentPage({ params }: PageProps) {
  const { slug } = await params
  // Reserved words that must stay a 404 rather than become an operator-editable page.
  if (slug.startsWith('_') || slug.startsWith('api')) notFound()
  return renderLegal(slug)
}
