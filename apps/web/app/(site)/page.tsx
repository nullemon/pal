import type { Metadata } from 'next'
import { pageMetadata } from '@/components/discovery/metadata'
import { homeLayout } from '@/lib/layouts'
import { loadHomeView } from './home-view'

/**
 * Home. The direction comes from `settings.layouts.home` (Appearance → Layouts) and is
 * resolved through the registry in `lib/layouts.ts`; `?layout=` previews another one. The
 * page personalises (Continue reading, ad-free), so it renders per request; every catalogue
 * query behind it is served from the 60s data cache in components/discovery/cached.ts
 * (docs/06 "static shell + dynamic holes").
 */
export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata('home', {}, { path: '/' })
}

export default async function HomePage({ searchParams }: PageProps<'/'>) {
  const sp = await searchParams
  const { layout, ...view } = await loadHomeView(sp)
  const preview = typeof sp.layout === 'string' ? sp.layout : undefined
  const Layout = homeLayout(layout, preview)
  return <Layout {...view} />
}
