import { THEME_DEFAULT_META } from '@/lib/appearance/AppearanceStyle'
import { THEME_COOKIE } from '@/lib/theme'

/**
 * Runs before first paint and sets `<html data-theme>`: the `theme` cookie wins (a reader's
 * explicit choice); otherwise the admin's "Default theme" from Appearance → Theme (docs/15),
 * read from the meta tag AppearanceStyle renders just before this script; and only when that
 * default is "system" does `prefers-color-scheme` decide. Doing this on the client keeps the
 * root layout free of `cookies()`, so `/` and the ISR pages can be prerendered (docs/06).
 * The server always emits `data-theme="dark"`; `suppressHydrationWarning` on `<html>` covers
 * the attribute this script may change.
 */
const script = `(function(){try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(dark|light)(?:;|$)/);var d=document.querySelector('meta[name="${THEME_DEFAULT_META}"]');var p=d&&d.getAttribute('content');var t=m?m[1]:(p==='light'?'light':p==='system'?(window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):'dark');document.documentElement.dataset.theme=t}catch(e){}})()`

export function ThemeScript() {
  // React serialises string children of <script> verbatim (only `<` in `</script` is escaped).
  return <script id="theme-script">{script}</script>
}
