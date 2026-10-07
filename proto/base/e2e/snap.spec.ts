// Smart Guides (⌘U) through real pointer operations (doc 18 §30.13).
import { expect, test, type Page } from '@playwright/test'

async function open(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__contour && document.querySelector('#snapToggle'))
}
async function toPage(page: Page, p: { x: number; y: number }) {
  const box = (await page.locator('canvas.upper-canvas').boundingBox())!
  const [z, , , , e, f] = await page.evaluate(() => (window as any).__contour.view.canvas.viewportTransform)
  return { x: box.x + e + p.x * z, y: box.y + f + p.y * z }
}
const click = async (page: Page, p: { x: number; y: number }) => {
  const q = await toPage(page, p)
  await page.mouse.click(q.x, q.y)
}
async function drag(page: Page, a: { x: number; y: number }, b: { x: number; y: number }) {
  const p = await toPage(page, a), q = await toPage(page, b)
  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  await page.mouse.move(q.x, q.y, { steps: 5 })
  await page.mouse.up()
}
const rec = (page: Page, id: string) => page.evaluate((id) => (window as any).__contour.editor.reader.get(id), id)
const sel = (page: Page) => page.evaluate(() => (window as any).__contour.selection.get() as string[])

test('pen points snap onto anchors: two lines drawn separately meet exactly, so K fills what they enclose', async ({ page }) => {
  await open(page)
  await page.click('[data-id="container:L1"]')
  await page.keyboard.press('p')
  for (const p of [{ x: 100, y: 10 }, { x: 140, y: 10 }, { x: 140, y: 40 }]) await click(page, p)
  await page.keyboard.press('Enter')
  // a second line: a new start, then points dropped NEAR the first path's anchors (off by < 2 px) land exactly on them
  await page.click('[data-id="container:L1"]')
  await click(page, { x: 100, y: 40 })
  await click(page, { x: 140.4, y: 40.5 })
  await click(page, { x: 100.5, y: 10.3 })
  await page.keyboard.press('Enter')
  const b = (await sel(page))[0]
  expect(Object.values((await rec(page, b)).anchors).map((x: any) => x.p)).toEqual([{ x: 100, y: 40 }, { x: 140, y: 40 }, { x: 100, y: 10 }])
  await page.keyboard.press('k')
  await click(page, { x: 130, y: 18 }) // inside the triangle (100,10) (140,10) (140,40)
  const fills = await page.evaluate(() => (window as any).__contour.editor.reader.allRecords().filter((r: any) => r.typeName === 'fill' && r.id !== 'fill:F'))
  expect(fills.length).toBe(1)
})

test('an anchor dragged near another lands on it; near an x / y it aligns; ⌘U turns snapping off', async ({ page }) => {
  await open(page)
  await page.keyboard.press('a')
  await drag(page, { x: -20, y: 20 }, { x: 9.5, y: 59.6 }) // E1.e1 → near C1.a2 (10, 60)
  expect((await rec(page, 'curve:E1')).anchors.e1.p).toEqual({ x: 10, y: 60 })
  await page.keyboard.press('ControlOrMeta+z')
  await drag(page, { x: -20, y: 20 }, { x: -40, y: 59.5 }) // y aligns with 60
  expect((await rec(page, 'curve:E1')).anchors.e1.p).toEqual({ x: -40, y: 60 })
  await page.keyboard.press('ControlOrMeta+z')
  await page.keyboard.press('ControlOrMeta+u')
  await expect(page.locator('#snapToggle')).not.toHaveClass(/on/)
  await drag(page, { x: -20, y: 20 }, { x: 9.5, y: 59.6 })
  const p = (await rec(page, 'curve:E1')).anchors.e1.p
  expect(Math.abs(p.x - 9.5)).toBeLessThan(0.4)
  expect(Math.abs(p.y - 59.6)).toBeLessThan(0.4)
})

test('V: moving a selection snaps its grabbed anchor onto another anchor', async ({ page }) => {
  await open(page)
  await page.keyboard.press('v')
  await drag(page, { x: -20, y: 20 }, { x: 9.4, y: 60.5 }) // grab E1 at e1, drop near C1.a2
  expect((await rec(page, 'curve:E1')).anchors.e1.p).toEqual({ x: 10, y: 60 })
  expect((await rec(page, 'curve:E1')).anchors.e2.p).toEqual({ x: 0, y: 90 }) // the whole line moved by (30, 40)
})
