// S2 pre-check (not in the gate): same stroke operation as an inverse mask, Canvas2D and Fabric.
import { expect, test } from '@playwright/test'
test('own-ink inverse mask excludes exactly the stroke ink (butt ends, mitres, limit, curves)', async ({ page }) => {
  await page.goto('/ownink.html')
  await page.waitForFunction(() => (window as any).__ownInk)
  const r = await page.evaluate(() => (window as any).__ownInk)
  console.log('OWN_INK', JSON.stringify(r, null, 1))
  console.log('OWN_INK_COST', JSON.stringify(await page.evaluate(() => (window as any).__ownInkCost)))
  for (const c of r) {
    // reported, not asserted as correct: Fabric clipPath (draws clip paths without their stroke) and the
    // fill's own object cache (cut shifted ~1 px against the main canvas)
    expect(c.fabric.holes + c.fabric.ateStroke).toBeGreaterThan(0)
    expect(c.fabricOwnInkCache.holes + c.fabricOwnInkCache.ateStroke).toBeGreaterThan(0)
    for (const k of ['canvas2d', 'fabricOwnInkScratch']) {
      expect(c[k].ateStroke, `${c.case} ${k}: fill painted over full-ink stroke pixels`).toBe(0)
      expect(c[k].holes, `${c.case} ${k}: holes where the stroke has no ink`).toBe(0)
    }
    // the check itself can fail: without protection the fill eats the stroke
    expect(c.canvas2dUnprotected.ateStroke).toBeGreaterThan(0)
    expect(c.fabricUnprotected.ateStroke).toBeGreaterThan(0)
  }
})
