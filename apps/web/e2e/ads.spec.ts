import { expect, test } from '@playwright/test'

/**
 * Ad slots (docs/11). The property worth protecting is that a slot is *one* element: the
 * layouts used to render two — `hidden md:block` and `md:hidden` — so a network tag placed
 * in that slot would have been requested and counted twice.
 */
test('a slot is one element, sized for the viewport', async ({ page, isMobile }) => {
  await page.goto('/')
  const slot = page.locator('[data-ad-slot="home_top"]')
  await expect(slot).toHaveCount(1)
  const box = await slot.boundingBox()
  expect(box).not.toBeNull()
  // 970×90 above the md breakpoint, 320×100 below it.
  expect(Math.round(box?.width ?? 0)).toBe(isMobile ? 320 : 970)
  expect(Math.round(box?.height ?? 0)).toBe(isMobile ? 100 : 90)
})

test('every rendered slot is unique in the DOM', async ({ page }) => {
  for (const path of ['/', '/series/return-of-the-frost-monarch']) {
    await page.goto(path)
    const ids = await page
      .locator('[data-ad-slot]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-ad-slot') ?? ''))
    // A page with no slots at all satisfies "no slot appears twice" — and would have gone on
    // satisfying it if the slots stopped rendering entirely. Say what must be there first.
    // The seed tags `home_top` and `series_top`; an untagged slot renders nothing by design.
    expect(ids.length, `${path} renders no ad slots at all`).toBeGreaterThan(0)
    expect(new Set(ids).size, `${path} renders a slot twice: ${ids.join(', ')}`).toBe(ids.length)
  }
})
