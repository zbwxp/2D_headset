// A2 controlled comparison (dot): the SAME main scene, only the anchor dots' objectCaching toggled.
// Checks: pixels of Fabric's main canvas, cache canvases allocated, renderAll timing. Picking and
// dragging do not involve the dots (not evented; picking is ours) and are covered by the gate's e2e.
import { expect, test } from '@playwright/test'

test('A2: anchor dots cached vs uncached — same pixels, cache memory, timing', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('/?bench&curves=400&fills=100&fillSize=50&fillSpacing=30&fillCols=10')
  await page.waitForFunction(() => (window as any).__contour)
  const r = await page.evaluate(() => {
    const { view } = (window as any).__contour
    const c = view.canvas
    const dots = c.getObjects().filter((o: any) => o.type === 'circle')
    const snap = () => {
      c.renderAll()
      const el: HTMLCanvasElement = c.lowerCanvasEl
      return el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data
    }
    const caches = () => {
      let n = 0
      let px = 0
      for (const o of c.getObjects()) {
        const cc = (o as any)._cacheCanvas as HTMLCanvasElement | undefined
        if (cc) n++, (px += cc.width * cc.height)
      }
      return { canvases: n, mib: +((px * 4) / 2 ** 20).toFixed(1) }
    }
    const time = () => {
      const xs = Array.from({ length: 7 }, () => {
        const t = performance.now()
        c.renderAll()
        return performance.now() - t
      }).sort((a, b) => a - b)
      return +xs[3].toFixed(1)
    }
    dots.forEach((d: any) => d.set({ objectCaching: false })) // as shipped now
    const uncachedPx = snap()
    const uncached = { caches: caches(), medianMs: time() }
    dots.forEach((d: any) => d.set({ objectCaching: true, dirty: true })) // Fabric default
    const cachedPx = snap()
    const cached = { caches: caches(), medianMs: time() }
    let diff = 0
    let maxDelta = 0
    // where are the differences? mark device pixels within (radius·zoom + 2 px) of any dot centre
    const el: HTMLCanvasElement = c.lowerCanvasEl
    const W = el.width
    const H = el.height
    const near = new Uint8Array(W * H)
    const vpt = c.viewportTransform
    const dpr = c.getRetinaScaling()
    for (const d of dots) {
      const cx = (vpt[0] * d.left + vpt[4]) * dpr
      const cy = (vpt[3] * d.top + vpt[5]) * dpr
      const rr = d.radius * vpt[0] * dpr + 2
      for (let y = Math.max(0, Math.floor(cy - rr)); y <= Math.min(H - 1, Math.ceil(cy + rr)); y++)
        for (let x = Math.max(0, Math.floor(cx - rr)); x <= Math.min(W - 1, Math.ceil(cx + rr)); x++) near[y * W + x] = 1
    }
    let diffPx = 0
    let diffPxAwayFromDots = 0
    for (let i = 0; i < cachedPx.length; i += 4) {
      let any = false
      for (let k = 0; k < 4; k++) {
        const d = Math.abs(cachedPx[i + k] - uncachedPx[i + k])
        if (d) diff++, (maxDelta = Math.max(maxDelta, d)), (any = true)
      }
      if (any) diffPx++, near[i / 4] || diffPxAwayFromDots++
    }
    return { dots: dots.length, uncached, cached, channelsDiffering: diff, maxDelta, totalChannels: cachedPx.length, pixelsDiffering: diffPx, pixelsDifferingAwayFromDots: diffPxAwayFromDots }
  })
  console.log('A2_DOTS', JSON.stringify(r))
  expect(r.dots).toBe(6000)
  expect(r.pixelsDifferingAwayFromDots).toBe(0) // only the dots themselves change
})
