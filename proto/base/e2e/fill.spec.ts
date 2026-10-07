// New document and the Live Paint Bucket (doc 18 §30.11) through real clicks in Chromium.
import { expect, test, type Page } from '@playwright/test'

async function open(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__contour && document.querySelector('#modeK'))
}
async function click(page: Page, p: { x: number; y: number }) {
  const box = (await page.locator('canvas.upper-canvas').boundingBox())!
  const [z, , , , e, f] = await page.evaluate(() => (window as any).__contour.view.canvas.viewportTransform)
  await page.mouse.click(box.x + e + p.x * z, box.y + f + p.y * z)
}
const records = (page: Page, type: string) => page.evaluate((t) => (window as any).__contour.editor.reader.allRecords().filter((r: any) => r.typeName === t), type)
const undoLabels = (page: Page) => page.evaluate(() => (window as any).__contour.editor.history.undo as string[])

test('新建 → a blank document with one layer (asks first when there are unsaved changes); draw a closed path, K fills it with the toolbar colour, below the line, one undo step', async ({ page }) => {
  await open(page)
  await page.evaluate(() => (window as any).__contour.api.apply({ type: 'setProps', id: 'container:L1', name: 'x' })) // unsaved change
  page.once('dialog', (d) => d.accept())
  await page.click('#fileNew')
  const layers = await records(page, 'container')
  expect(layers.map((l: any) => l.name)).toEqual(['图层 1'])
  expect(await records(page, 'curve')).toEqual([])
  await expect(page.locator('#fileName')).toHaveText('未命名')
  expect(await undoLabels(page)).toEqual([])
  // a closed triangle with the pen
  await page.keyboard.press('p')
  for (const p of [{ x: 20, y: 10 }, { x: 80, y: 10 }, { x: 50, y: 70 }, { x: 20, y: 10 }]) await click(page, p)
  const [curve] = await records(page, 'curve')
  expect(curve.closed).toBe(true)
  // K with a chosen colour
  await page.locator('#fillColor').fill('#3366cc')
  await page.keyboard.press('k')
  await click(page, { x: 50, y: 30 })
  const [fill] = await records(page, 'fill')
  expect(fill).toMatchObject({ color: '#3366cc', parentId: layers[0].id })
  expect(fill.index < curve.index).toBe(true) // under its line
  expect(await undoLabels(page)).toEqual(['createCurve', 'createFill'])
  // the same area again recolours it (no second fill)
  await page.locator('#fillColor').fill('#cc3333')
  await click(page, { x: 50, y: 30 })
  expect((await records(page, 'fill')).map((f: any) => f.color)).toEqual(['#cc3333'])
  // outside any area: said, nothing written
  await click(page, { x: 120, y: 100 })
  await expect(page.locator('#status')).toContainText('没有被线围起来的区域')
  expect(await undoLabels(page)).toEqual(['createCurve', 'createFill', 'setProps'])
})

test('K on the example jaw: the existing fill F is recoloured (refused while its layer is locked)', async ({ page }) => {
  await open(page)
  await page.keyboard.press('k')
  await click(page, { x: 30, y: 50 })
  await expect(page.locator('#status')).toContainText('LOCKED')
  await page.click('#unlock')
  await page.locator('#fillColor').fill('#00aa00')
  await click(page, { x: 30, y: 50 })
  expect((await records(page, 'fill')).map((f: any) => [f.id, f.color])).toEqual([['fill:F', '#00aa00']])
})
