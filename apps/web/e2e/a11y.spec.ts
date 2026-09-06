import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

/**
 * Automated accessibility checks (docs/06). Axe cannot judge everything — focus order,
 * whether a label reads sensibly, whether the reader is operable by keyboard — so the
 * keyboard tests below cover what a scanner cannot, and the scan covers what a person
 * reading the code would miss.
 *
 * WCAG 2.1 A and AA only: `best-practice` rules are opinions, not the bar being held.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

const PAGES: Array<{ name: string; path: string }> = [
  { name: 'home', path: '/' },
  { name: 'browse', path: '/browse' },
  { name: 'search', path: '/search?q=frost' },
  { name: 'genres', path: '/genres' },
  { name: 'rankings', path: '/rankings' },
  { name: 'series', path: '/series/return-of-the-frost-monarch' },
  { name: 'reader', path: '/series/return-of-the-frost-monarch/chapter-305' },
  { name: 'subscribe', path: '/subscribe' },
  { name: 'login', path: '/login' },
  { name: 'register', path: '/register' },
  { name: 'announcements', path: '/announcements' },
  { name: 'terms', path: '/terms' },
  { name: 'not-found', path: '/no-such-page-here' },
]

for (const { name, path } of PAGES) {
  test(`${name} has no WCAG A/AA violations`, async ({ page }) => {
    await page.goto(path)
    // Islands hydrate after load; scanning too early misses aria the client fills in.
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1200)
    const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
    const summary = violations.map(
      (v) =>
        `${v.id} (${v.impact}) ×${v.nodes.length}: ${v.help}\n    ${v.nodes[0]?.html?.slice(0, 160)}`,
    )
    expect(summary, `${path}\n  ${summary.join('\n  ')}`).toEqual([])
  })
}

const CHAPTER = '/series/return-of-the-frost-monarch/chapter-305'

interface TabStop {
  name: string
  inReader: boolean
}

/**
 * Where Tab actually goes, in order, named the way a screen reader would name it.
 *
 * Counting focusable elements proves nothing: one `<a href>` anywhere in the reader satisfies
 * it, and every control could be a `<div onClick>` with the count unchanged. So this presses
 * the key. `inReader` is load-bearing too — the page renders a breadcrumb nav *outside*
 * `#reader-root` with its own "Previous chapter" and "Next chapter" links, and those must
 * never be mistaken for the reader's own chrome.
 */
const tabOrder = async (page: import('@playwright/test').Page, presses = 40) => {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  const stops: TabStop[] = []
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press('Tab')
    const stop = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      if (!el || el === document.body) return null
      // Every `<select>` here is wrapped in a `<label>` whose first child is the sr-only text;
      // that text is the control's accessible name, and the option list is not.
      const name =
        el.getAttribute('aria-label') ??
        el.closest('label')?.querySelector('.sr-only')?.textContent ??
        el.textContent?.trim().slice(0, 40) ??
        ''
      return { name: name.trim(), inReader: el.closest('#reader-root') !== null }
    })
    if (stop) stops.push(stop)
  }
  return stops
}

/** The Tab stop inside the reader that answers to `re`, failing with the whole order if none. */
const reachable = (stops: TabStop[], re: RegExp, what: string): number => {
  const i = stops.findIndex((s) => s.inReader && re.test(s.name))
  expect(
    i,
    `no Tab stop inside #reader-root for ${what}. Reader stops: ${stops
      .filter((s) => s.inReader)
      .map((s) => s.name)
      .join(' -> ')}`,
  ).toBeGreaterThan(-1)
  return i
}

test('the reader chrome is reachable, in order, by Tab alone', async ({ page }) => {
  await page.goto(CHAPTER)
  await page.waitForTimeout(1800)
  const stops = await tabOrder(page)

  // The top bar, in the order it is drawn.
  const back = reachable(stops, /^Back to /, 'the back-to-series link')
  const settings = reachable(stops, /^Reader settings$/, 'the settings button')
  const comments = reachable(stops, /^Comments$/, 'the comments button')
  expect(back).toBeLessThan(settings)
  expect(settings).toBeLessThan(comments)

  // The chapter nav at the bottom, reached after the chapter itself.
  const prev = reachable(stops, /^Previous chapter/, 'the previous-chapter link')
  const select = reachable(stops, /^Choose chapter$/, 'the chapter select')
  const next = reachable(stops, /^Next chapter/, 'the next-chapter link')
  expect(comments).toBeLessThan(prev)
  expect(prev).toBeLessThan(select)
  expect(select).toBeLessThan(next)
})

test('the reader in paged mode reaches the page jump, and Enter works its buttons', async ({
  page,
  isMobile,
}) => {
  // The admin default is strip mode, which has no page jump: paged is what a reader who chose
  // it gets, and the stored preference is how they get it.
  await page.addInitScript(() =>
    window.localStorage.setItem('palscans.reader.v1', JSON.stringify({ mode: 'single' })),
  )
  await page.goto(CHAPTER)
  await expect(page.locator('#reader-root[data-mode="single"]')).toBeAttached()
  await page.waitForTimeout(1200)
  const stops = await tabOrder(page)

  const settings = reachable(stops, /^Reader settings$/, 'the settings button')
  reachable(stops, /^Choose chapter$/, 'the chapter select')
  reachable(stops, /^Previous page$/, 'the previous-page button')
  reachable(stops, /^Next page$/, 'the next-page button')
  // Both viewports draw the scrubber; only the desktop bar has room for the page `<select>`
  // beside the chapter one, so on a phone the scrubber *is* the page jump.
  reachable(stops, /^Page scrubber$/, 'the page scrubber')
  if (!isMobile) {
    const select = reachable(stops, /^Choose chapter$/, 'the chapter select')
    const jump = reachable(stops, /^Jump to page$/, 'the page jump')
    expect(select).toBeLessThan(jump)
    expect(jump).toBeLessThan(settings)
  }

  // Reachable is half of operable: the control must also *do* something from the keyboard,
  // which a div carrying a click handler never would.
  await page.getByRole('button', { name: 'Reader settings' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
})

test('every page exposes exactly one h1 and the landmark set', async ({ page }) => {
  for (const path of ['/', '/browse', '/series/return-of-the-frost-monarch']) {
    await page.goto(path)
    await page.waitForTimeout(600)
    // More than one h1 is what breaks heading navigation for a screen-reader user.
    await expect(page.locator('h1'), `${path} h1 count`).toHaveCount(1)
    await expect(page.getByRole('banner'), `${path} banner`).toHaveCount(1)
    await expect(page.getByRole('contentinfo'), `${path} contentinfo`).toHaveCount(1)
    await expect(page.getByRole('main'), `${path} main`).toHaveCount(1)
  }
})
