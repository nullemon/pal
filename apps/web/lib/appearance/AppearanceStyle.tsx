import { cachedAppearance } from './published'

/**
 * docs/15 step 2: the published token block, inlined in <head> so there is no extra request
 * and no flash of the old theme.
 *
 * **This renders on every route, `/admin` included** — it is mounted by the root layout,
 * which the panel shares with the public site. That is why it emits only the resolved token
 * block, built by `lib/appearance/resolve.ts` out of validated hex and px values, and never
 * the operator's own CSS or snippets: those are public-site-only and live in
 * `components/shell/CustomCode.tsx`, mounted by `app/(site)/layout.tsx`. Moving either of
 * them into this component would put operator-authored markup inside the admin panel, which
 * is the one thing this feature must not be able to do.
 */
export { cachedAppearance, cachedAppearanceCss, type ThemeDefault } from './published'

/** Name of the meta tag `components/shell/ThemeScript` reads before first paint. */
export const THEME_DEFAULT_META = 'palscans-theme-default'

export async function AppearanceStyle() {
  const { css, themeDefault } = await cachedAppearance()
  return (
    <>
      {/* docs/15 "Default theme": read by ThemeScript, which must come after this in <head>. */}
      <meta name={THEME_DEFAULT_META} content={themeDefault} />
      {css ? (
        <style
          id="appearance"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: token block built by lib/appearance/resolve.ts from validated hex and px values, never user markup
          dangerouslySetInnerHTML={{ __html: css.replace(/<\/style/gi, '') }}
        />
      ) : null}
    </>
  )
}
