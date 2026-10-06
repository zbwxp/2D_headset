// Reference drawing path B (dot): the same picture as Fabric's A-mode scene. Same document state, same
// canvas size, DPR and viewport; pixels of Fabric's main canvas vs B's canvas. Exact equality is NOT
// achieved (anti-aliasing of two drawing paths differs at stroke edges); the numbers are reported and
// bounded: total coverage, and visible per-pixel differences at a zoom where strokes are several px.
import { expect, test, type Page } from '@playwright/test'

test.use({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1 })
const frame = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))))
const read = (page: Page, which: 'fabric' | 'b') =>
  page.evaluate((which) => {
    const v = (window as any).__contour.view
    const el: HTMLCanvasElement = which === 'b' ? v.refCanvas : v.canvas.lowerCanvasEl
    return { w: el.width, h: el.height, data: Array.from(el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data) }
  }, which)

async function compare(page: Page, url: string, zoom?: number) {
  const load = async (u: string) => {
    await page.goto(u)
    await page.waitForFunction(() => (window as any).__contour)
    if (zoom)
      await page.evaluate((z) => {
        const v = (window as any).__contour.view
        v.canvas.setViewportTransform([z, 0, 0, z, 20, 20 - 150 * z])
        v.scene = null
        v.render()
      }, zoom)
    await frame(page)
  }
  await load(url)
  const f = await read(page, 'fabric')
  await load(url + (url.includes('?') ? '&' : '?') + 'renderer=b')
  const b = await read(page, 'b')
  expect([b.w, b.h]).toEqual([f.w, f.h])
  let any = 0, visible = 0, max = 0, ink = 0
  for (let i = 0; i < f.data.length; i += 4) {
    const d = Math.max(Math.abs(f.data[i] - b.data[i]), Math.abs(f.data[i + 1] - b.data[i + 1]), Math.abs(f.data[i + 2] - b.data[i + 2]), Math.abs(f.data[i + 3] - b.data[i + 3]))
    if (f.data[i + 3] || b.data[i + 3]) ink++
    if (d > 0) any++
    if (d > 32) visible++
    max = Math.max(max, d)
  }
  // Coarser "same picture" measures, robust to sub-pixel anti-aliasing of ~0.5 px lines (where the
  // per-pixel differences concentrate): mean |diff| per 8×8 block, and total alpha coverage.
  const B = 8
  let worstBlock = 0, blocksOver5 = 0, blocks = 0, covF = 0, covB = 0
  for (let by = 0; by < f.h; by += B)
    for (let bx = 0; bx < f.w; bx += B) {
      let sum = 0, n = 0
      for (let y = by; y < Math.min(by + B, f.h); y++)
        for (let x = bx; x < Math.min(bx + B, f.w); x++) {
          const i = (y * f.w + x) * 4
          for (let k = 0; k < 4; k++) sum += Math.abs(f.data[i + k] - b.data[i + k])
          n += 4
        }
      const mean = sum / n / 255
      worstBlock = Math.max(worstBlock, mean)
      if (mean > 0.05) blocksOver5++
      blocks++
    }
  for (let i = 3; i < f.data.length; i += 4) (covF += f.data[i]), (covB += b.data[i])
  return {
    pixels: f.data.length / 4,
    inkPixels: ink,
    perPixel: { differing: any, differingBy32: visible, maxChannelDiff: max },
    blocks8: { worstMeanDiff: +worstBlock.toFixed(4), blocksOver5pct: blocksOver5, of: blocks },
    coverage: { fabric: covF, b: covB, relDiff: +(Math.abs(covF - covB) / Math.max(1, covF)).toFixed(4) },
  }
}

test('example document (fill, curves, reference, control points): Fabric vs B', async ({ page }) => {
  const r = await compare(page, '/')
  console.log('[renderer-b example]', JSON.stringify(r))
  expect(r.inkPixels).toBeGreaterThan(1000)
  expect(r.coverage.relDiff).toBeLessThan(0.01)
  expect(r.perPixel.differingBy32 / r.inkPixels).toBeLessThan(0.02)
})

const MAIN = '/?bench&curves=400&fills=100&fillSize=50&fillSpacing=30&fillCols=10&onion=19'
test('main workload 400 curves + 100 overlapping fills + 19 onion yaws: Fabric vs B (fitted, and zoom 3 / 6)', async ({ page }) => {
  test.setTimeout(180_000)
  // NOT pixel-identical: differences are anti-aliasing of thin strokes / tiny dots at edges — their share
  // falls as lines get thicker (zoom), crops at zoom 6 are visually identical, total coverage agrees.
  const fitted = await compare(page, MAIN)
  const z3 = await compare(page, MAIN, 3)
  const z6 = await compare(page, MAIN, 6)
  console.log('[renderer-b main]', JSON.stringify({ fitted, z3, z6 }))
  expect(fitted.inkPixels).toBeGreaterThan(1000)
  expect(fitted.coverage.relDiff).toBeLessThan(0.01)
  expect(z6.perPixel.differingBy32 / z6.inkPixels).toBeLessThan(0.03)
})
