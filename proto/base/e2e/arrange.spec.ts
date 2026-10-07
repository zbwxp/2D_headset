// Arrange / group / ungroup / new layer (doc 18 §30.6) through real keys and the layers panel in Chromium.
import { expect, test, type Page } from '@playwright/test'

async function open(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__contour && document.querySelector('#newLayer'))
}
async function click(page: Page, p: { x: number; y: number }, shift = false) {
  const box = (await page.locator('canvas.upper-canvas').boundingBox())!
  const [z, , , , e, f] = await page.evaluate(() => (window as any).__contour.view.canvas.viewportTransform)
  if (shift) await page.keyboard.down('Shift')
  await page.mouse.click(box.x + e + p.x * z, box.y + f + p.y * z)
  if (shift) await page.keyboard.up('Shift')
}
const rows = (page: Page) => page.locator('#layersPanel [role=treeitem]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.id))
const sel = (page: Page) => page.evaluate(() => (window as any).__contour.selection.get() as string[])
const undoLabels = (page: Page) => page.evaluate(() => (window as any).__contour.editor.history.undo as string[])

test('⇧⌘] / ⌘[ move an object within its layer (the layers panel follows); geometry unchanged', async ({ page }) => {
  await open(page)
  const before = await page.evaluate(() => JSON.stringify((window as any).__contour.editor.reader.get('curve:C1').anchors))
  await page.click('[data-id="curve:C1"]')
  await page.keyboard.press('ControlOrMeta+Shift+BracketRight')
  expect((await rows(page)).slice(5)).toEqual(['container:L1', 'curve:C1', 'reference:R1'])
  await page.keyboard.press('ControlOrMeta+BracketLeft')
  expect((await rows(page)).slice(5)).toEqual(['container:L1', 'reference:R1', 'curve:C1'])
  expect(await undoLabels(page)).toEqual(['arrange', 'arrange'])
  expect(await page.evaluate(() => JSON.stringify((window as any).__contour.editor.reader.get('curve:C1').anchors))).toBe(before)
})

test('⌘G groups the selection (then a click selects the whole group); ⇧⌘G ungroups and selects the children; one undo step each', async ({ page }) => {
  await open(page)
  await page.keyboard.press('v')
  await click(page, { x: 10, y: 60 }) // C1
  await click(page, { x: 85, y: 35 }, true) // R1 (the mirrored ear)
  await page.keyboard.press('ControlOrMeta+g')
  const [g] = await sel(page)
  expect(await page.evaluate((g) => (window as any).__contour.editor.reader.get(g), g)).toMatchObject({ typeName: 'container', parentId: 'container:L1' })
  expect((await rows(page)).slice(5)).toEqual(['container:L1', g, 'reference:R1', 'curve:C1'])
  await page.keyboard.press('ControlOrMeta+Shift+a')
  await click(page, { x: 10, y: 60 })
  expect(await sel(page)).toEqual([g]) // the group is the selection unit
  await page.keyboard.press('ControlOrMeta+Shift+g')
  expect([...(await sel(page))].sort()).toEqual(['curve:C1', 'reference:R1'])
  expect((await rows(page)).slice(5)).toEqual(['container:L1', 'reference:R1', 'curve:C1'])
  expect(await undoLabels(page)).toEqual(['group', 'ungroup'])
})

test('＋图层 makes a new top layer, selected; the pen then draws into it', async ({ page }) => {
  await open(page)
  await page.click('#newLayer')
  const [layer] = await sel(page)
  expect((await rows(page))[0]).toBe(layer)
  await page.keyboard.press('p')
  await click(page, { x: 100, y: 10 })
  await click(page, { x: 120, y: 10 })
  await page.keyboard.press('Enter')
  const [c] = await sel(page)
  expect(await page.evaluate((c) => (window as any).__contour.editor.reader.get(c).parentId, c)).toBe(layer)
  expect(await undoLabels(page)).toEqual(['createContainer', 'createCurve'])
})
