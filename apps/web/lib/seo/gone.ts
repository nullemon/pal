import { messages } from '@palscans/core/messages'

/**
 * 410 Gone for removed series (docs/12 §10) — served straight from the proxy, before any
 * route runs, so it cannot pull in the app shell. Self-contained markup with the docs/16
 * dark tokens inlined (the shell's stylesheet is not available at this layer).
 */
export function goneHtml(siteName: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>410 · ${esc(siteName)}</title>
<style>
:root{--bg:#100d17;--surface:#181423;--line:#2c2540;--fg:#ece9f4;--muted:#9e97b8;--brand:#7c3aed;--brand-hover:#8b5cf6}
html,body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 "Plus Jakarta Sans",ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{min-height:100dvh;display:grid;place-items:center;padding:24px}
.card{max-width:520px;width:100%;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:32px}
.code{font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
h1{margin:8px 0 6px;font-size:28px;line-height:1.15;letter-spacing:-.02em}
p{margin:0 0 20px;color:var(--muted)}
.row{display:flex;gap:10px;flex-wrap:wrap}
a{display:inline-flex;align-items:center;height:38px;padding:0 16px;border-radius:8px;font-weight:600;font-size:14px;text-decoration:none;color:var(--fg);border:1px solid var(--line)}
a.primary{background:var(--brand);border-color:var(--brand);color:#fff}
a.primary:hover{background:var(--brand-hover)}
</style>
</head>
<body>
<main>
<div class="card">
<div class="code">410 · Gone</div>
<h1>${esc(messages.errors.gone)}</h1>
<p>${esc(messages.seo.goneHint)}</p>
<div class="row"><a class="primary" href="/">${esc(messages.nav.home)}</a><a href="/browse">${esc(messages.nav.browse)}</a></div>
</div>
</main>
</body>
</html>
`
}
