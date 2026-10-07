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

test('新建 → a blank document with one layer (asks first when there are unsaved changes); draw a closed path, K makes it a shape with a face in the toolbar colour, below the line, one undo step; the panels; clear; ungroup refused', async ({ page }) => {
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
  // the line becomes a shape group (doc 18 §30.22) holding it and its face; the shape is selected
  const [fill] = await records(page, 'fill')
  const shape = (await records(page, 'container')).find((c: any) => c.shape)
  expect(shape).toMatchObject({ name: '形状', parentId: layers[0].id })
  expect(fill).toMatchObject({ color: '#3366cc', parentId: shape.id })
  expect((await records(page, 'curve'))[0]).toMatchObject({ id: curve.id, parentId: shape.id })
  expect(await page.evaluate(() => (window as any).__contour.selection.get())).toEqual([shape.id])
  const order = await page.evaluate(() => (window as any).__contour.editor.derived.evaluated().paint.map((p: any) => p.item.address))
  expect(order).toEqual([fill.id, curve.id]) // the face under its line
  expect(await undoLabels(page)).toEqual(['createCurve', 'paintRegion'])
  // the same area again recolours it (no second fill)
  await page.locator('#fillColor').fill('#cc3333')
  await click(page, { x: 50, y: 30 })
  expect((await records(page, 'fill')).map((f: any) => f.color)).toEqual(['#cc3333'])
  // outside any area: said, nothing written
  await click(page, { x: 120, y: 100 })
  await expect(page.locator('#status')).toContainText('没有被线围起来的区域')
  expect(await undoLabels(page)).toEqual(['createCurve', 'paintRegion', 'paintRegion'])
  // the layers panel: a 形状 row holding the line, no separate face row; the properties list the face
  await expect(page.locator(`[data-id="${shape.id}"] .kind`)).toHaveAttribute('title', '形状')
  await expect(page.locator(`[data-id="${fill.id}"]`)).toHaveCount(0)
  await expect(page.locator(`[data-id="${curve.id}"]`)).toHaveCount(1)
  await expect(page.locator(`#propsPanel [data-face="${fill.id}"]`)).toHaveCount(1)
  // 清除: the face goes, the shape group and its line stay; ⌘Z brings it back
  await page.click(`#propsPanel [data-face="${fill.id}"] [data-face-clear]`)
  expect(await records(page, 'fill')).toEqual([])
  expect((await records(page, 'curve'))[0].parentId).toBe(shape.id)
  await expect(page.locator('#propsPanel')).toContainText('没有颜色')
  await page.keyboard.press('Meta+z')
  expect((await records(page, 'fill')).map((f: any) => f.id)).toEqual([fill.id])
  // ungroup is refused while the shape has a face (Illustrator: a Live Paint group is not simply ungrouped)
  await page.click(`[data-id="${shape.id}"]`)
  await page.click('#ungroupSel')
  await expect(page.locator('#status')).toContainText('先在属性里清除')
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

test('select a closed line, 建立填充 in the properties panel: its fill in the toolbar colour, under the line, one step; an open line is refused with the reason', async ({ page }) => {
  await open(page)
  await page.click('[data-id="container:L1"]')
  await page.keyboard.press('p')
  for (const p of [{ x: 100, y: 10 }, { x: 140, y: 10 }, { x: 120, y: 40 }, { x: 100, y: 10 }]) await click(page, p)
  const [curve] = await page.evaluate(() => (window as any).__contour.selection.get())
  await page.locator('#fillColor').fill('#123456')
  await page.click('#propsPanel #makeFill')
  const fill = (await records(page, 'fill')).find((f: any) => f.id !== 'fill:F')
  const shape = (await records(page, 'container')).find((c: any) => c.shape)
  expect(shape).toMatchObject({ parentId: 'container:L1' })
  expect(fill).toMatchObject({ color: '#123456', parentId: shape.id })
  expect(fill.boundary.map((b: any) => b.curveId)).toEqual([curve, curve, curve])
  expect((await undoLabels(page)).at(-1)).toBe('paintRegion')
  await page.click('[data-id="curve:E1"]') // an open line
  await page.click('#propsPanel #makeFill')
  await expect(page.locator('#status')).toContainText('没有围成闭合轮廓')
})
