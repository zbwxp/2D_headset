// Editor skeleton block 3 (doc 18 §30.3) — copy / paste and real files, through real keys and real browser file flows in
// Chromium. The File System Access dialogs cannot be driven by a test, so the page runs browser-fs-access's other path
// (file input / download) by hiding the API before load; that path is what browsers without the API use.
import { expect, test, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'

async function open(page: Page, legacyFiles = false) {
  if (legacyFiles) await page.addInitScript(() => { delete (window as any).showOpenFilePicker; delete (window as any).showSaveFilePicker })
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__contour && document.querySelector('#fileSave'))
}
async function toPage(page: Page, p: { x: number; y: number }) {
  const box = (await page.locator('canvas.upper-canvas').boundingBox())!
  const [z, , , , e, f] = await page.evaluate(() => (window as any).__contour.view.canvas.viewportTransform)
  return { x: box.x + e + p.x * z, y: box.y + f + p.y * z }
}
const doc = (page: Page) => page.evaluate(() => JSON.stringify((window as any).__contour.editor.reader.serialize('document')))
const undoLabels = (page: Page) => page.evaluate(() => (window as any).__contour.editor.history.undo as string[])
const sel = (page: Page) => page.evaluate(() => (window as any).__contour.selection.get() as string[])
const rec = (page: Page, id: string) => page.evaluate((id) => (window as any).__contour.editor.reader.get(id), id)
const settle = (page: Page) => page.evaluate(() => new Promise((r) => setTimeout(r, 50)))

test('⌘C / ⌘V pastes a copy at the centre of the view into the current layer (selected, one undo step); ⇧⌘V in place; ⌘X cuts', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await open(page)
  await page.keyboard.press('v')
  const e1 = await toPage(page, { x: -25, y: 35 })
  await page.mouse.click(e1.x, e1.y)
  await page.keyboard.press('ControlOrMeta+c')
  await settle(page)
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('"kind":"contour/content"')
  await page.keyboard.press('ControlOrMeta+v')
  await settle(page)
  const [pasted] = await sel(page)
  expect(pasted).not.toBe('curve:E1')
  const p = await rec(page, pasted)
  expect(p.parentId).toBe('container:L3') // the layer of the selection
  // at the centre of the view: the canvas centre in document coordinates
  const centre = await page.evaluate(() => {
    const v = (window as any).__contour.view.canvas
    const [z, , , , e, f] = v.viewportTransform
    return { x: (v.getWidth() / 2 - e) / z, y: (v.getHeight() / 2 - f) / z }
  })
  const mid = { x: (p.anchors.e1.p.x + p.anchors.e2.p.x) / 2, y: (p.anchors.e1.p.y + p.anchors.e2.p.y) / 2 }
  expect(Math.abs(mid.x - centre.x)).toBeLessThan(0.01)
  expect(Math.abs(mid.y - centre.y)).toBeLessThan(0.01)
  expect(await undoLabels(page)).toEqual(['pasteContent'])
  await page.keyboard.press('ControlOrMeta+Shift+v') // in place
  await settle(page)
  const inPlace = await rec(page, (await sel(page))[0])
  expect(inPlace.anchors.e1.p).toEqual({ x: -20, y: 20 })
  // cut: copy + delete (the delete is the undo step); paste brings it back as a copy
  await page.keyboard.press('ControlOrMeta+x')
  await settle(page)
  expect(await rec(page, inPlace.id)).toBeUndefined()
  expect((await undoLabels(page)).at(-1)).toBe('deleteRecords')
  await page.keyboard.press('ControlOrMeta+Shift+v')
  await settle(page)
  expect((await rec(page, (await sel(page))[0])).anchors.e1.p).toEqual({ x: -20, y: 20 })
})

test('paste works after a reload (the system clipboard holds content, not ids); a fill without its curves is not copied and says why', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await open(page)
  await page.click('[data-id="container:L3"]')
  await page.keyboard.press('ControlOrMeta+c')
  await settle(page)
  await page.reload()
  await page.waitForFunction(() => (window as any).__contour && document.querySelector('#fileSave'))
  await page.click('[data-id="container:L1"]')
  await page.keyboard.press('ControlOrMeta+Shift+v')
  await settle(page)
  const [pasted] = await sel(page)
  const c = await rec(page, pasted)
  expect(c.typeName).toBe('container') // the copied layer, as a group inside L1
  expect(c.parentId).toBe('container:L1')
  await page.click('[data-id="fill:F"]')
  await page.keyboard.press('ControlOrMeta+c')
  await settle(page)
  expect(await page.evaluate(() => (window as any).__contour.view.status)).toMatch(/fill:F reads curve:C1, curve:C2/)
})

test('files: an edit marks the document unsaved; ⌘S writes the file and clears the mark; a fresh page opens it (⌘O) to the same document, history empty', async ({ page, context }, info) => {
  await open(page, true)
  await expect(page.locator('#fileName')).toHaveText('未命名')
  await page.keyboard.press('v')
  const e1 = await toPage(page, { x: -25, y: 35 })
  await page.mouse.click(e1.x, e1.y)
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('#fileName')).toHaveText('● 未命名')
  expect(await page.title()).toMatch(/^● /)
  const saved = await doc(page)
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('ControlOrMeta+s')])
  const file = info.outputPath('saved.contour.json')
  await download.saveAs(file)
  await expect(page.locator('#fileName')).toHaveText(/^未命名\.contour\.json$/)
  expect(JSON.parse(readFileSync(file, 'utf8')).store['curve:E1'].anchors.e1.p).toEqual({ x: -19, y: 20 })
  // a fresh page (the example document), then open the file
  const fresh = await context.newPage()
  await open(fresh, true)
  const [chooser] = await Promise.all([fresh.waitForEvent('filechooser'), fresh.click('#fileOpen')])
  await chooser.setFiles(file)
  await expect(fresh.locator('#fileName')).toHaveText('saved.contour.json')
  expect(await doc(fresh)).toBe(saved)
  expect(await undoLabels(fresh)).toEqual([])
  expect(await fresh.evaluate(() => (window as any).__contour.editor.isDirty)).toBe(false)
})

test('files: opening over unsaved changes asks first (cancel keeps everything); a bad file changes nothing and says why', async ({ page }, info) => {
  await open(page, true)
  await page.keyboard.press('v')
  const e1 = await toPage(page, { x: -25, y: 35 })
  await page.mouse.click(e1.x, e1.y)
  await page.keyboard.press('ArrowRight')
  const before = await doc(page)
  page.once('dialog', (d) => d.dismiss())
  await page.click('#fileOpen')
  await settle(page)
  expect(await doc(page)).toBe(before)
  // a file that is not a valid document
  const bad = info.outputPath('bad.contour.json')
  writeFileSync(bad, JSON.stringify({ store: { 'curve:x': { typeName: 'curve', id: 'curve:x' } }, schema: {} }))
  page.once('dialog', (d) => d.accept())
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#fileOpen')])
  await chooser.setFiles(bad)
  await expect(page.locator('#status')).toContainText('打开失败')
  expect(await doc(page)).toBe(before)
  expect(await page.evaluate(() => (window as any).__contour.editor.isDirty)).toBe(true)
})
