// Editor skeleton block 1 — selection, layers panel, shortcuts, canvas navigation, accepted through REAL mouse and
// keyboard operations in Chromium (dot 1791342752: "按实际操作验收"). The expected behaviour is the mature tools'
// default named in src/selection.ts / src/ui/shortcuts.ts; every write is checked against the document and undo.
import { expect, test, type Page } from '@playwright/test'

async function open(page: Page, query = '') {
  await page.goto(`/${query}`)
  await page.waitForFunction(() => (window as any).__contour && document.querySelector('#modeV'))
}
/** document → page coordinates through the CURRENT viewport transform */
async function toPage(page: Page, p: { x: number; y: number }) {
  const box = (await page.locator('canvas.upper-canvas').boundingBox())!
  const [z, , , , e, f] = await page.evaluate(() => (window as any).__contour.view.canvas.viewportTransform)
  return { x: box.x + e + p.x * z, y: box.y + f + p.y * z }
}
const sel = (page: Page) => page.evaluate(() => (window as any).__contour.selection.get() as string[])
const doc = (page: Page) => page.evaluate(() => JSON.stringify((window as any).__contour.editor.reader.serialize('document')))
const undoLabels = (page: Page) => page.evaluate(() => (window as any).__contour.editor.history.undo as string[])
const click = async (page: Page, p: { x: number; y: number }, modifiers: ('Shift' | 'ControlOrMeta')[] = []) => {
  const q = await toPage(page, p)
  for (const m of modifiers) await page.keyboard.down(m)
  await page.mouse.click(q.x, q.y)
  for (const m of modifiers) await page.keyboard.up(m)
}
async function marquee(page: Page, a: { x: number; y: number }, b: { x: number; y: number }, opts: { pressE?: boolean } = {}) {
  const p = await toPage(page, a), q = await toPage(page, b)
  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  await page.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 3 })
  if (opts.pressE) await page.keyboard.press('e')
  await page.mouse.move(q.x, q.y, { steps: 3 })
  await page.mouse.up()
}

test('KF-4 fixed: a click picks the TOPMOST drawn object (a fill in front hides the line); ⌘ / Ctrl+click selects the one behind', async ({ page }) => {
  await open(page, '?case=P2-fill-layer-in-front')
  await page.keyboard.press('v')
  // the API pick agrees (the old KF-4 reproduction, now in a browser where the fill test runs)
  expect(await page.evaluate(() => {
    const c = (window as any).__contour
    return c.hitTest(c.editor.derived.evaluated(), { x: 40, y: 30 }, { mode: 'V', tolerance: 2 })
  })).toMatchObject({ kind: 'fill', address: 'fill:F' })
  await click(page, { x: 40, y: 30 }) // C runs under F here
  expect(await sel(page)).toEqual(['fill:F'])
  await click(page, { x: 40, y: 30 }, ['ControlOrMeta'])
  expect(await sel(page)).toEqual(['curve:C']) // behind the fill
  await click(page, { x: 40, y: 30 }, ['ControlOrMeta'])
  expect(await sel(page)).toEqual(['curve:C']) // nothing further behind: stays at the bottom
  await click(page, { x: 2, y: 30 }) // C outside the fill: C is the topmost there
  expect(await sel(page)).toEqual(['curve:C'])
})

test('the selection unit is the outermost group below the layer (Illustrator Selection tool); A selects the object itself', async ({ page }) => {
  await open(page, '?case=P3-nested') // L1 = [G = [R]], L2 = [C]
  await page.keyboard.press('v')
  await click(page, { x: 40, y: 5 }) // on R, away from C
  expect(await sel(page)).toEqual(['container:G'])
  await page.keyboard.press('a')
  await click(page, { x: 40, y: 10 })
  expect(await sel(page)).toEqual(['curve:R'])
})

test('marquee: touching selects (default); E while dragging switches to enclosed; Shift adds; locked layers are not selected', async ({ page }) => {
  await open(page)
  await page.keyboard.press('v')
  // the example: L1 = [C1 (0,0)…(60,100), R1 = mirrored ear], L2 (locked) = [F, C2], L3 = [E1 (-30,20)…(-20,50)]
  await marquee(page, { x: -40, y: 10 }, { x: 5, y: 55 }) // touches C1's top end and E1 entirely
  expect([...(await sel(page))].sort()).toEqual(['curve:C1', 'curve:E1'])
  await marquee(page, { x: -40, y: 10 }, { x: 5, y: 55 }, { pressE: true }) // enclosed: only E1 lies completely inside
  expect(await sel(page)).toEqual(['curve:E1'])
  await page.keyboard.down('Shift')
  await marquee(page, { x: 55, y: 95 }, { x: 65, y: 105 }) // C1's lower end (C2's end too, but L2 is locked)
  await page.keyboard.up('Shift')
  expect([...(await sel(page))].sort()).toEqual(['curve:C1', 'curve:E1'])
  await click(page, { x: 80, y: 50 }) // on C2 in the locked layer: not selectable, deselects
  expect(await sel(page)).toEqual([])
})

test('layers panel: rows front first; click / ⌘-click / Shift-click select; eye and lock toggle the layer (one undo step each)', async ({ page }) => {
  await open(page)
  const rows = await page.locator('#layersPanel [role=treeitem]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.id))
  expect(rows).toEqual(['container:L3', 'curve:E1', 'container:L2', 'curve:C2', 'fill:F', 'container:L1', 'reference:R1', 'curve:C1'])
  await page.click('[data-id="curve:E1"]')
  expect(await sel(page)).toEqual(['curve:E1'])
  await page.click('[data-id="curve:C1"]', { modifiers: ['ControlOrMeta'] })
  expect(await sel(page)).toEqual(['curve:E1', 'curve:C1'])
  await page.click('[data-id="container:L2"]')
  await page.click('[data-id="fill:F"]', { modifiers: ['Shift'] })
  expect(await sel(page)).toEqual(['container:L2', 'curve:C2', 'fill:F'])
  await expect(page.locator('#propsPanel')).toContainText('已选 3 个')
  // hide L3: E1 is no longer drawn nor pickable
  const before = await doc(page)
  await page.click('[data-id="container:L3"] [data-flag="visible"]')
  expect(await undoLabels(page)).toEqual(['setContainerFlags'])
  await page.keyboard.press('v')
  await click(page, { x: -25, y: 35 })
  expect(await sel(page)).toEqual([])
  await page.keyboard.press('ControlOrMeta+z')
  expect(await doc(page)).toBe(before)
  await click(page, { x: -25, y: 35 })
  expect(await sel(page)).toEqual(['curve:E1'])
  // the properties panel edits the same flag
  await page.click('[data-id="container:L1"]')
  await page.locator('#propsPanel input[type=checkbox]').nth(1).check() // 锁定
  expect(await page.evaluate(() => (window as any).__contour.editor.reader.get('container:L1').locked)).toBe(true)
})

test('keyboard: arrows nudge 1 / Shift 10 (one undo step each); Delete removes with the content; a refused delete names why; ⌘A / ⇧⌘A', async ({ page }) => {
  await open(page)
  await page.keyboard.press('v')
  await click(page, { x: -25, y: 35 }) // E1
  const e1 = () => page.evaluate(() => (window as any).__contour.editor.reader.get('curve:E1').anchors.e1.p)
  const p0 = await e1()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Shift+ArrowDown')
  expect(await e1()).toEqual({ x: p0.x + 1, y: p0.y + 10 })
  expect(await undoLabels(page)).toEqual(['transformItems', 'transformItems'])
  await page.keyboard.press('ControlOrMeta+z')
  await page.keyboard.press('ControlOrMeta+z')
  expect(await e1()).toEqual(p0)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  expect(await e1()).toEqual({ x: p0.x + 1, y: p0.y })
  // Delete the layer L3 (with its line): one undo step; undo brings both back
  const before = await doc(page)
  await page.click('[data-id="container:L3"]')
  await page.keyboard.press('Delete')
  const s = await page.evaluate(() => (window as any).__contour.view.status)
  // L3 is the source of the reference R1: the delete is refused and says so (nothing written)
  expect(s).toMatch(/reference:R1/)
  expect(await doc(page)).toBe(before)
  await page.click('[data-id="curve:E1"]')
  await page.keyboard.press('Backspace')
  expect(await page.evaluate(() => !!(window as any).__contour.editor.reader.get('curve:E1'))).toBe(false)
  expect(await sel(page)).toEqual([])
  await page.keyboard.press('ControlOrMeta+z')
  expect(await doc(page)).toBe(before)
  // ⌘A: every visible, unlocked object (L2 is locked); ⇧⌘A deselects
  await page.keyboard.press('ControlOrMeta+a')
  expect([...(await sel(page))].sort()).toEqual(['curve:C1', 'curve:E1', 'reference:R1'])
  await page.keyboard.press('ControlOrMeta+Shift+a')
  expect(await sel(page)).toEqual([])
})

test('canvas: ⌘ + wheel zooms at the cursor (the point under it stays); ⌘= / ⌘− / ⌘0; space + drag pans; nothing is written', async ({ page }) => {
  await open(page)
  const before = await doc(page)
  const at = await toPage(page, { x: 30, y: 50 })
  await page.mouse.move(at.x, at.y)
  await page.keyboard.down('ControlOrMeta')
  await page.mouse.wheel(0, -200)
  await page.keyboard.up('ControlOrMeta')
  const z1 = await page.evaluate(() => (window as any).__contour.view.canvas.getZoom())
  expect(z1).toBeGreaterThan(3)
  const still = await toPage(page, { x: 30, y: 50 })
  expect(Math.hypot(still.x - at.x, still.y - at.y)).toBeLessThan(0.5)
  await expect(page.locator('#zoomLabel')).toHaveText(`${Math.round(z1 * 100)}%`)
  await page.keyboard.press('ControlOrMeta+-')
  expect(await page.evaluate(() => (window as any).__contour.view.canvas.getZoom())).toBeCloseTo(z1 / 1.25, 6)
  // space + drag: the hand tool
  const p = await toPage(page, { x: 30, y: 50 })
  await page.keyboard.down(' ')
  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  await page.mouse.move(p.x + 40, p.y + 25, { steps: 4 })
  await page.mouse.up()
  await page.keyboard.up(' ')
  const q = await toPage(page, { x: 30, y: 50 })
  expect(Math.round(q.x - p.x)).toBe(40)
  expect(Math.round(q.y - p.y)).toBe(25)
  await page.keyboard.press('ControlOrMeta+0')
  expect(await doc(page)).toBe(before)
  expect(await undoLabels(page)).toEqual([])
})

test('V: Shift while moving constrains to 45°; Esc cancels a move; the handle box rotates (one transformItems)', async ({ page }) => {
  await open(page)
  await page.keyboard.press('v')
  const c = await toPage(page, { x: -25, y: 35 })
  await page.mouse.click(c.x, c.y)
  await page.mouse.move(c.x, c.y)
  await page.mouse.down()
  await page.keyboard.down('Shift')
  await page.mouse.move(c.x + 30, c.y + 3, { steps: 4 }) // nearly horizontal → horizontal
  await page.keyboard.up('Shift')
  await page.mouse.up()
  const last = await page.evaluate(() => (window as any).__contour.view.log.at(-1).cmd.matrix)
  expect(last.f).toBe(0)
  expect(last.e).toBeGreaterThan(9)
  const before = await doc(page)
  const c2 = await toPage(page, { x: -25 + last.e, y: 35 })
  await page.mouse.move(c2.x, c2.y)
  await page.mouse.down()
  await page.mouse.move(c2.x + 20, c2.y + 20, { steps: 3 })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  expect(await doc(page)).toBe(before)
  // rotate by the handle above the box (Fabric's 'mtr' control)
  const mtr = await page.evaluate(() => {
    const o = (window as any).__contour.view.box
    return { x: o.oCoords.mtr.x, y: o.oCoords.mtr.y }
  })
  const box = (await page.locator('canvas.upper-canvas').boundingBox())!
  await page.mouse.move(box.x + mtr.x, box.y + mtr.y)
  await page.mouse.down()
  await page.mouse.move(box.x + mtr.x + 40, box.y + mtr.y + 10, { steps: 6 })
  await page.mouse.up()
  const rot = await page.evaluate(() => (window as any).__contour.view.log.at(-1).cmd)
  expect(rot.type).toBe('transformItems')
  expect(Math.abs(rot.matrix.b)).toBeGreaterThan(0.05) // rotated
  expect(await undoLabels(page)).toEqual(['transformItems', 'transformItems'])
})
