import { THEME_COOKIE } from '@/lib/theme'

/**
 * Runs before first paint and sets `<html data-theme>` from the `theme` cookie, falling back
 * to `prefers-color-scheme` on a first visit (docs/05). Doing this on the client keeps the
 * root layout free of `cookies()`, so `/` and the ISR pages can be prerendered (docs/06).
 * The server always emits `data-theme="dark"`; `suppressHydrationWarning` on `<html>` covers
 * the attribute this script may change.
 */
const script = `(function(){try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(dark|light)(?:;|$)/);var t=m?m[1]:(window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');document.documentElement.dataset.theme=t}catch(e){}})()`

export function ThemeScript() {
  // React serialises string children of <script> verbatim (only `<` in `</script` is escaped).
  return <script id="theme-script">{script}</script>
}
