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

for (const dpr of [1, 2])
  test.describe(`pan / zoom at DPR ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr })
    test(`own-ink cut stays aligned under a fractional pan and zoom (DPR ${dpr})`, async ({ page }) => {
      await page.goto('/ownink.html')
      await page.waitForFunction(() => (window as any).__ownInkViews)
      const r = await page.evaluate(() => (window as any).__ownInkViews)
      expect(r.dpr).toBe(dpr)
      console.log('OWN_INK_VIEWS', dpr, JSON.stringify(r.results.map((x: any) => ({ view: x.view, case: x.case, c2d: x.canvas2d, c2dOff: x.canvas2dUnprotected.ateStroke, fabric: x.fabricScratch }))))
      for (const x of r.results) {
        for (const k of ['canvas2d', 'fabricScratch']) {
          expect(x[k].ateStroke, `${x.case} ${JSON.stringify(x.view)} ${k}: stroke eaten`).toBe(0)
          expect(x[k].holes, `${x.case} ${JSON.stringify(x.view)} ${k}: holes`).toBe(0)
        }
        expect(x.canvas2dUnprotected.ateStroke).toBeGreaterThan(0)
        // KNOWN (reported, not passed off as fine): the exact cut leaves see-through pixels along the
        // stroke's inner anti-aliased edge (stroke a behind, fill 1-a in front → alpha 1-a+a², 0.75 at
        // a = 0.5) — a faint seam. Asserted to still exist so a fix is noticed.
        expect(x.canvas2d.seams).toBeGreaterThan(0)
      }
    })
  })
