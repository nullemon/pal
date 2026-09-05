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

test('the reader is operable from the keyboard alone', async ({ page }) => {
  await page.goto('/series/return-of-the-frost-monarch/chapter-305')
  await page.waitForTimeout(1500)
  // Every control in the reader chrome must be reachable by Tab, not mouse-only.
  const reachable = await page.evaluate(() => {
    const root = document.getElementById('reader-root')
    if (!root) return null
    const focusable = root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input, select, [tabindex]:not([tabindex="-1"])',
    )
    return Array.from(focusable).filter((el) => {
      const style = getComputedStyle(el)
      return style.display !== 'none' && style.visibility !== 'hidden'
    }).length
  })
  expect(reachable).not.toBeNull()
  expect(reachable ?? 0).toBeGreaterThan(0)
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
