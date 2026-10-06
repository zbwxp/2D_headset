// Option A (dot): the incremental scene must be the SAME display as a full rebuild — every canvas
// object identical (type, path commands, position, size, colours, line width) and in the same order.
import { expect, test, type Page } from '@playwright/test'

const snapshot = (page: Page) =>
  page.evaluate(() => {
    const v = (window as any).__contour.view
    const r = (n: number) => Math.round(n * 1e6) / 1e6
    return v.canvas.getObjects().map((o: any) => ({
      type: o.type,
      path: o.path ? JSON.stringify(o.path) : null,
      left: r(o.left),
      top: r(o.top),
      width: r(o.width),
      height: r(o.height),
      radius: o.radius ?? null,
      fill: o.fill,
      stroke: o.stroke,
      strokeWidth: o.strokeWidth,
      visible: o.visible,
    }))
  })
const frame = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))))

async function dragAndCompare(page: Page, from: { x: number; y: number }, steps: { x: number; y: number }[]) {
  const box = (await page.locator('canvas.upper-canvas').boundingBox())!
  const at = (p: { x: number; y: number }) => ({ x: box.x + 150 + p.x * 3, y: box.y + 60 + p.y * 3 })
  const a = at(from)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  for (const s of steps) {
    const b = at(s)
    await page.mouse.move(b.x, b.y)
    await frame(page)
    // DURING the drag (preview scene): incremental == full rebuild of the same preview
    const incremental = await snapshot(page)
    expect(await page.evaluate(() => (window as any).__contour.view.scene !== null)).toBe(true)
    await page.evaluate(() => {
      const v = (window as any).__contour.view
      v.scene = null // force the next projection to rebuild everything
    })
    await page.mouse.move(b.x + 0.001, b.y) // same preview, re-projected fully
    await frame(page)
    expect(await snapshot(page)).toEqual(incremental)
  }
  await page.mouse.up()
  await frame(page)
  const committed = await snapshot(page)
  await page.evaluate(() => (window as any).__contour.view.forceFullRender())
  await frame(page)
  expect(await snapshot(page)).toEqual(committed) // after commit too
}

test('example document: connected anchor (fill, connection) and a reference source anchor', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__contour)
  await page.click('#unlock')
  await dragAndCompare(page, { x: 60, y: 100 }, [{ x: 64, y: 103 }, { x: 70, y: 106 }]) // a3 ⟷ b3, fill F
  await dragAndCompare(page, { x: -30, y: 50 }, [{ x: -33, y: 52 }, { x: -36, y: 55 }]) // E1.e2, shown by R1
  await page.click('#undo')
  await frame(page)
  const afterUndo = await snapshot(page)
  await page.evaluate(() => (window as any).__contour.view.forceFullRender())
  await frame(page)
  expect(await snapshot(page)).toEqual(afterUndo)
})

test('synthetic 121 curves with 19 onion yaws: incremental onion updates equal a full rebuild', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/?bench&curves=121&onion=19')
  await page.waitForFunction(() => (window as any).__contour)
  await dragAndCompare(page, { x: 5, y: 4 }, [{ x: 8, y: 5 }, { x: 12, y: 7 }])
})
