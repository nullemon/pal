import { siteChrome } from '@/lib/chrome/load'
import { BottomNavBar } from './BottomNavBar'

/**
 * The mobile tab bar's server half: it reads which four items Appearance → Header, footer,
 * menus put there (docs/15) and hands them to the client component, which needs `usePathname`
 * for the active tab and nothing else. Keeping the settings read on this side is what stops
 * the resolver and its zod schemas reaching the reader's bundle (docs/20).
 */
export async function BottomNav() {
  const { bottomNav } = await siteChrome()
  return <BottomNavBar items={bottomNav} />
}
