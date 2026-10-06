// Option A, PIXELS (dot): at a fixed viewport, the main canvas drawn by the incremental scene must be
// pixel-identical to a full rebuild — fills occluding curves, a reference instance, control points,
// onion skins. Reported separately from object-property equality (scene-incremental.spec.ts).
import { expect, test, type Page } from '@playwright/test'

test.use({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1 })
const frame = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))))
/** Hash of the main canvas pixels (FNV-1a over RGBA), plus size; the ImageData is kept for diffing. */
const pixels = (page: Page, slot: string) =>
  page.evaluate((slot) => {
    const c = (window as any).__contour.view.canvas
    const el = c.lowerCanvasEl as HTMLCanvasElement
    const data = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data
    ;(window as any)[slot] = data
    let h = 0x811c9dc5
    for (let i = 0; i < data.length; i++) h = Math.imul(h ^ data[i], 0x01000193) >>> 0
    let ink = 0
    for (let i = 3; i < data.length; i += 4) if (data[i]) ink++
    return { w: el.width, h: el.height, hash: h, ink }
  }, slot)
const diffCount = (page: Page) =>
  page.evaluate(() => {
    const a = (window as any).incremental as Uint8ClampedArray
    const b = (window as any).full as Uint8ClampedArray
    let n = 0
    for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) n++
    return n
  })

async function dragCompare(page: Page, from: { x: number; y: number }, to: { x: number; y: number }[], label: string) {
  const box = (await page.locator('canvas.upper-canvas').boundingBox())!
  const vpt: number[] = await page.evaluate(() => [...(window as any).__contour.view.canvas.viewportTransform])
  const at = (p: { x: number; y: number }) => ({ x: box.x + vpt[4] + p.x * vpt[0], y: box.y + vpt[5] + p.y * vpt[3] })
  const a = at(from)
  const undoBefore = await page.evaluate(() => (window as any).__contour.editor.history.undo.length)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  const results: { step: string; ink: number; diffPixels: number }[] = []
  for (const [i, p] of to.entries()) {
    const b = at(p)
    await page.mouse.move(b.x, b.y)
    await frame(page)
    const inc = await pixels(page, 'incremental')
    expect(await page.evaluate(() => (window as any).__contour.view.scene !== null)).toBe(true)
    await page.evaluate(() => ((window as any).__contour.view.scene = null))
    await page.mouse.move(b.x + 0.001, b.y) // same preview, rebuilt fully
    await frame(page)
    const full = await pixels(page, 'full')
    results.push({ step: `${label} move ${i + 1}`, ink: inc.ink, diffPixels: inc.hash === full.hash ? 0 : await diffCount(page) })
  }
  await page.mouse.up()
  await frame(page)
  // the drag really grabbed the point and committed one edit (otherwise "identical" proves nothing)
  expect(await page.evaluate(() => (window as any).__contour.editor.history.undo.length), `${label}: one committed edit`).toBe(undoBefore + 1)
  const inc = await pixels(page, 'incremental')
  await page.evaluate(() => (window as any).__contour.view.forceFullRender())
  await frame(page)
  const full = await pixels(page, 'full')
  results.push({ step: `${label} commit`, ink: inc.ink, diffPixels: inc.hash === full.hash ? 0 : await diffCount(page) })
  return results
}

test('example document: fill under curves, reference instance, control points — pixel-identical', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__contour)
  await page.click('#unlock')
  await frame(page)
  const r = [
    ...(await dragCompare(page, { x: 60, y: 100 }, [{ x: 64, y: 103 }, { x: 70, y: 106 }], 'connected anchor a3/b3 (fill F)')),
    ...(await dragCompare(page, { x: -30, y: 50 }, [{ x: -33, y: 52 }, { x: -36, y: 55 }], 'reference source E1.e2 (R1)')),
  ]
  console.log('[scene-pixels example]', JSON.stringify(r))
  for (const x of r) {
    expect(x.ink, x.step).toBeGreaterThan(0)
    expect(x.diffPixels, x.step).toBe(0)
  }
})

test('main workload: 400 curves + 100 overlapping fills + 19 onion yaws — pixel-identical', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/?bench&curves=400&fills=100&fillSize=50&fillSpacing=30&fillCols=10&onion=19')
  await page.waitForFunction(() => (window as any).__contour)
  const r = [
    ...(await dragCompare(page, { x: 5, y: 4 }, [{ x: 8, y: 5 }], 'free anchor')),
    ...(await dragCompare(page, { x: 50, y: 160 }, [{ x: 53, y: 162 }], 'fill boundary (under other fills)')),
  ]
  console.log('[scene-pixels main]', JSON.stringify(r))
  for (const x of r) {
    expect(x.ink, x.step).toBeGreaterThan(0)
    expect(x.diffPixels, x.step).toBe(0)
  }
})
