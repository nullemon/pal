import { messages } from '@palscans/core/messages'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { LegalArticle } from './LegalPage'
import { type LegalSlug, loadLegalPage } from './legal'
import { buildMetadata } from './metadata'
import { cachedSeoSettings } from './settings'

/** One generateMetadata + renderer for the four legal routes. */
export async function legalMetadata(slug: string): Promise<Metadata> {
  const page = await loadLegalPage(slug)
  return buildMetadata('page', {
    path: `/${slug}`,
    override: {
      title: page?.title ?? messages.legal.pages[slug as LegalSlug] ?? messages.errors.notFound,
    },
  })
}

export async function renderLegal(
  slug: string,
  extra?: { aside?: ReactNode; children?: ReactNode },
) {
  const [page, settings] = await Promise.all([loadLegalPage(slug), cachedSeoSettings()])
  if (!page) notFound()
  return (
    <LegalArticle
      page={page}
      path={`/${slug}`}
      siteName={settings.identity.site_name}
      aside={extra?.aside}
    >
      {extra?.children}
    </LegalArticle>
  )
}
