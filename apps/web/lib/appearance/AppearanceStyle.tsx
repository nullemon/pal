import { getDb, publishedAppearance } from '@palscans/db'
import { unstable_cache } from 'next/cache'

/**
 * docs/15 step 2: the published token block, inlined in <head> so there is no extra request
 * and no flash of the old theme. Cached and tagged `appearance`; publishing from
 * Appearance → Theme calls `revalidateTag('appearance')`. Empty when the database is
 * unreachable so the shell still renders with the compiled defaults.
 */
export type ThemeDefault = 'dark' | 'light' | 'system'

const themeDefaultOf = (settings: unknown): ThemeDefault => {
  const v = (settings as { theme?: { default?: unknown } } | null)?.theme?.default
  return v === 'light' || v === 'system' ? v : 'dark'
}

export const cachedAppearance = unstable_cache(
  async (): Promise<{ css: string; themeDefault: ThemeDefault }> => {
    try {
      const row = await publishedAppearance(await getDb())
      return { css: row?.resolvedCss ?? '', themeDefault: themeDefaultOf(row?.settings) }
    } catch {
      return { css: '', themeDefault: 'dark' }
    }
  },
  ['appearance', 'css'],
  { revalidate: 300, tags: ['appearance'] },
)

export const cachedAppearanceCss = async (): Promise<string> => (await cachedAppearance()).css

/** Name of the meta tag `components/shell/ThemeScript` reads before first paint. */
export const THEME_DEFAULT_META = 'palscans-theme-default'

export async function AppearanceStyle() {
  const { css, themeDefault } = await cachedAppearance()
  return (
    <>
      {/* docs/15 "Default theme": read by ThemeScript, which must come after this in <head>. */}
      <meta name={THEME_DEFAULT_META} content={themeDefault} />
      {css ? (
        // biome-ignore lint/security/noDangerouslySetInnerHtml: token block from the resolver (validated hex/px values), not user markup
        <style
          id="appearance"
          dangerouslySetInnerHTML={{ __html: css.replace(/<\/style/gi, '') }}
        />
      ) : null}
    </>
  )
}
