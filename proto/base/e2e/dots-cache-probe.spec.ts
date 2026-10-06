// Measurement probe (dot, reuse review; not in the gate): what do Fabric's default object caches of the
// 6,000 anchor dots cost in renderAll on the main workload? Fabric A, fitted view, 0 onion, DPR 1.
// Variants on the SAME scene: dots cached (Fabric default, today), dots uncached, dots removed.
// renderAll is timed synchronously (draw call done, not on screen); first render after a change is
// reported separately (cache building), then the median of 7 steady renders.
import { test } from '@playwright/test'

test('anchor-dot object cache cost, main workload, Fabric A', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('/?bench&curves=400&fills=100&fillSize=50&fillSpacing=30&fillCols=10') // = drawing-costs MAIN
  await page.waitForFunction(() => (window as any).__contour)
  const r = await page.evaluate(() => {
    const { view } = (window as any).__contour
    const c = view.canvas
    const dots = c.getObjects().filter((o: any) => o.type === 'circle')
    const time = () => {
      const t = performance.now()
      c.renderAll()
      return performance.now() - t
    }
    const measure = () => {
      const first = time()
      const xs = Array.from({ length: 7 }, time).sort((a, b) => a - b)
      return { firstMs: +first.toFixed(1), medianMs: +xs[3].toFixed(1) }
    }
    const out: any = { objects: c.getObjects().length, dots: dots.length, cachedByDefault: dots.every((d: any) => d.objectCaching) }
    out.dotsCached = measure()
    dots.forEach((d: any) => d.set({ objectCaching: false }))
    out.dotsUncached = measure()
    c.remove(...dots)
    out.dotsRemoved = measure()
    return out
  })
  console.log('DOTS_CACHE', JSON.stringify(r))
})
