// Editor skeleton block 2 (doc 18 §30.2) — Pen, Add / Delete Anchor Point, Scissors, Direct Selection of anchors, Join /
// connect / disconnect, accepted through real mouse and keyboard operations in Chromium. Behaviour = Illustrator's
// defaults (src/view/fabricView.ts, src/ui/shortcuts.ts); every write is checked in the document and in undo.
import { expect, test, type Page } from '@playwright/test'

async function open(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__contour && document.querySelector('#modeP'))
}
async function toPage(page: Page, p: { x: number; y: number }) {
  const box = (await page.locator('canvas.upper-canvas').boundingBox())!
  const [z, , , , e, f] = await page.evaluate(() => (window as any).__contour.view.canvas.viewportTransform)
  return { x: box.x + e + p.x * z, y: box.y + f + p.y * z }
}
const doc = (page: Page) => page.evaluate(() => JSON.stringify((window as any).__contour.editor.reader.serialize('document')))
const undoLabels = (page: Page) => page.evaluate(() => (window as any).__contour.editor.history.undo as string[])
const rec = (page: Page, id: string) => page.evaluate((id) => (window as any).__contour.editor.reader.get(id), id)
const sel = (page: Page) => page.evaluate(() => (window as any).__contour.selection.get() as string[])
const anchorsSel = (page: Page) => page.evaluate(() => (window as any).__contour.selection.getAnchors() as string[])
const click = async (page: Page, p: { x: number; y: number }, shift = false) => {
  const q = await toPage(page, p)
  if (shift) await page.keyboard.down('Shift')
  await page.mouse.click(q.x, q.y)
  if (shift) await page.keyboard.up('Shift')
}
async function dragFrom(page: Page, a: { x: number; y: number }, b: { x: number; y: number }) {
  const p = await toPage(page, a), q = await toPage(page, b)
  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  await page.mouse.move(q.x, q.y, { steps: 5 })
  await page.mouse.up()
}
/** draw an open pen path through the points (clicks), ended with Enter; returns the new curve id */
async function penPath(page: Page, pts: { x: number; y: number }[]) {
  await page.keyboard.press('p')
  for (const p of pts) await click(page, p)
  await page.keyboard.press('Enter')
  return (await sel(page))[0]
}

test('Pen: clicks = corner anchors, a drag = smooth anchor with symmetric handles, clicking the first anchor closes; one createCurve in the selected layer, on top, selected; one undo removes it', async ({ page }) => {
  await open(page)
  await page.click('[data-id="container:L1"]') // the current layer
  await page.keyboard.press('p')
  const before = await doc(page)
  await click(page, { x: 100, y: 10 })
  await click(page, { x: 130, y: 10 })
  await dragFrom(page, { x: 130, y: 40 }, { x: 140, y: 40 }) // smooth anchor, handle out to the right
  await click(page, { x: 100, y: 10 }) // the first anchor: close
  const id = (await sel(page))[0]
  const c = await rec(page, id)
  expect(c.parentId).toBe('container:L1')
  expect(c.closed).toBe(true)
  expect(Object.values(c.anchors).map((a: any) => [a.p.x, a.p.y])).toEqual([[100, 10], [130, 10], [130, 40]])
  expect(c.anchors.p3.hOut).toEqual({ x: 10, y: 0 })
  expect(c.anchors.p3.hIn).toEqual({ x: -10, y: 0 })
  expect(c.segments.map((s: any) => `${s.from}>${s.to}`)).toEqual(['p1>p2', 'p2>p3', 'p3>p1'])
  const siblings = await page.evaluate(() => ['curve:C1', 'reference:R1'].map((x) => (window as any).__contour.editor.reader.get(x).index))
  expect(siblings.every((i: string) => i < c.index)).toBe(true) // on top of the layer
  expect(await undoLabels(page)).toEqual(['createCurve'])
  await expect(page.locator('#layersPanel [role=treeitem]').nth(6)).toHaveAttribute('data-id', id) // the first row inside L1 (row 5 is L1 itself)
  await page.keyboard.press('ControlOrMeta+z')
  expect(await doc(page)).toBe(before)
})

test('Pen: Enter ends an open path; ⌘Z while drawing removes the last anchor (nothing written); a locked layer is refused by name', async ({ page }) => {
  await open(page)
  await page.click('[data-id="container:L3"]')
  await page.keyboard.press('p')
  const before = await doc(page)
  await click(page, { x: 100, y: 10 })
  await click(page, { x: 120, y: 10 })
  await click(page, { x: 140, y: 30 })
  await page.keyboard.press('ControlOrMeta+z') // drops (140, 30), not a document undo
  expect(await doc(page)).toBe(before)
  await page.keyboard.press('Enter')
  const c = await rec(page, (await sel(page))[0])
  expect(c.closed).toBe(false)
  expect(Object.values(c.anchors).map((a: any) => [a.p.x, a.p.y])).toEqual([[100, 10], [120, 10]])
  // a locked layer: refused with the layer's name, nothing written
  await page.click('[data-id="container:L2"]')
  await page.keyboard.press('p')
  const now = await doc(page)
  await click(page, { x: 100, y: 60 })
  await click(page, { x: 120, y: 60 })
  await page.keyboard.press('Enter')
  expect(await page.evaluate(() => (window as any).__contour.view.status)).toMatch(/阴影.*锁定/)
  expect(await doc(page)).toBe(now)
})

test('Pen over the SELECTED path adds an anchor on a segment and deletes an inner anchor (auto add / delete); + and − tools do the same on any path', async ({ page }) => {
  await open(page)
  await page.keyboard.press('v')
  await click(page, { x: -25, y: 35 }) // select E1
  await page.keyboard.press('p')
  await click(page, { x: -25, y: 35 }) // on its segment
  let e1 = await rec(page, 'curve:E1')
  expect(Object.keys(e1.anchors).length).toBe(3)
  const mid = Object.keys(e1.anchors).find((k) => k !== 'e1' && k !== 'e2')!
  const at = e1.anchors[mid].p
  await click(page, at) // on the new inner anchor
  e1 = await rec(page, 'curve:E1')
  expect(Object.keys(e1.anchors)).toEqual(['e1', 'e2'])
  expect(await undoLabels(page)).toEqual(['insertPoint', 'removeAnchorJoin'])
  // + / − on a path that is NOT selected
  await page.keyboard.press('Escape')
  await page.keyboard.press('ControlOrMeta+Shift+a')
  await page.keyboard.press('+')
  await click(page, { x: -25, y: 35 })
  expect(Object.keys((await rec(page, 'curve:E1')).anchors).length).toBe(3)
  await page.keyboard.press('-')
  const m2 = Object.entries((await rec(page, 'curve:E1')).anchors).find(([k]) => k !== 'e1' && k !== 'e2')![1] as any
  await click(page, m2.p)
  expect(Object.keys((await rec(page, 'curve:E1')).anchors)).toEqual(['e1', 'e2'])
  expect(await undoLabels(page)).toEqual(['insertPoint', 'removeAnchorJoin', 'insertPoint', 'removeAnchorJoin'])
})

test('Scissors: on a segment = add an anchor there and cut (ONE undo step); on an inner anchor = cut; a refusal says why and writes nothing', async ({ page }) => {
  await open(page)
  await page.click('[data-id="container:L1"]')
  const id = await penPath(page, [{ x: 100, y: 10 }, { x: 130, y: 10 }, { x: 160, y: 10 }])
  await page.keyboard.press('c')
  const before = await doc(page)
  await click(page, { x: 115, y: 10 }) // on the first segment
  expect(await undoLabels(page)).toEqual(['createCurve', 'scissors'])
  const curves = await page.evaluate(() => (window as any).__contour.editor.reader.allRecords().filter((r: any) => r.typeName === 'curve' && r.parentId === 'container:L1').length)
  expect(curves).toBe(3) // C1 + the two pieces
  await page.keyboard.press('ControlOrMeta+z')
  expect(await doc(page)).toBe(before)
  await click(page, { x: 130, y: 10 }) // the inner anchor p2
  expect(await undoLabels(page)).toEqual(['createCurve', 'breakAt'])
  expect(Object.keys((await rec(page, id)).anchors).length).toBe(2)
  // an end anchor: nothing to cut — refused, said, not written
  const now = await doc(page)
  await click(page, { x: 100, y: 10 })
  expect(await page.evaluate(() => (window as any).__contour.view.status)).toMatch(/end node/)
  expect(await doc(page)).toBe(now)
})

test('Direct Selection: click / Shift-click / marquee select anchors; dragging one moves every selected anchor (one moveAnchors); Delete removes them with their segments (one undo step)', async ({ page }) => {
  await open(page)
  await page.click('[data-id="container:L1"]')
  // (the canvas shows x up to ≈ 163 at this zoom)
  const id = await penPath(page, [{ x: 95, y: 10 }, { x: 115, y: 10 }, { x: 135, y: 10 }, { x: 155, y: 10 }])
  await page.keyboard.press('a')
  await click(page, { x: 115, y: 10 })
  await click(page, { x: 135, y: 10 }, true)
  expect(await anchorsSel(page)).toEqual([`${id}#p2`, `${id}#p3`])
  await expect(page.locator('#anchorsSection')).toContainText('锚点（2）')
  await dragFrom(page, { x: 135, y: 10 }, { x: 135, y: 25 })
  const c = await rec(page, id)
  expect([c.anchors.p2.p, c.anchors.p3.p]).toEqual([{ x: 115, y: 25 }, { x: 135, y: 25 }])
  expect(c.anchors.p1.p).toEqual({ x: 95, y: 10 })
  expect((await undoLabels(page)).at(-1)).toBe('moveAnchors')
  // marquee over p1 only (empty space start)
  await dragFrom(page, { x: 90, y: 5 }, { x: 100, y: 15 })
  expect(await anchorsSel(page)).toEqual([`${id}#p1`])
  await click(page, { x: 155, y: 10 }, true)
  const before = await doc(page)
  await page.keyboard.press('Delete')
  const after = await rec(page, id)
  expect(Object.keys(after?.anchors ?? {})).toEqual(['p2', 'p3'])
  expect((await undoLabels(page)).at(-1)).toBe('deleteAnchors')
  await page.keyboard.press('ControlOrMeta+z')
  expect(await doc(page)).toBe(before)
})

test('Join (⌘J): end anchors of two paths connect at their midpoint (a shared node), shown with 断开 in the properties; 断开 removes it; two ends of one path close it; V-selected open path closes', async ({ page }) => {
  await open(page)
  await page.click('[data-id="container:L1"]')
  const a = await penPath(page, [{ x: 100, y: 10 }, { x: 130, y: 10 }])
  await page.click('[data-id="container:L1"]')
  const b = await penPath(page, [{ x: 134, y: 14 }, { x: 160, y: 40 }])
  await page.keyboard.press('a')
  await click(page, { x: 130, y: 10 })
  await click(page, { x: 134, y: 14 }, true)
  await page.keyboard.press('ControlOrMeta+j')
  expect((await undoLabels(page)).at(-1)).toBe('bind')
  const [pa, pb] = [(await rec(page, a)).anchors.p2.p, (await rec(page, b)).anchors.p1.p]
  expect(pa).toEqual({ x: 132, y: 12 })
  expect(pb).toEqual(pa)
  await expect(page.locator('#anchorsSection .conn').first()).toContainText('连着')
  await page.locator('#anchorsSection [data-unbind]').first().click()
  expect((await undoLabels(page)).at(-1)).toBe('unbind')
  // two ends of one open path: Join closes it with a segment
  await page.click('[data-id="container:L1"]')
  const c = await penPath(page, [{ x: 100, y: 60 }, { x: 130, y: 60 }, { x: 130, y: 90 }])
  await page.keyboard.press('a')
  await click(page, { x: 100, y: 60 })
  await click(page, { x: 130, y: 90 }, true)
  expect(await anchorsSel(page)).toEqual([`${c}#p1`, `${c}#p3`])
  await page.keyboard.press('ControlOrMeta+j')
  expect((await rec(page, c)).closed).toBe(true)
  expect((await undoLabels(page)).at(-1)).toBe('addClosingSegment')
  // V: an open path selected → Join closes it
  await page.click('[data-id="container:L1"]')
  const d = await penPath(page, [{ x: 100, y: 100 }, { x: 120, y: 100 }, { x: 120, y: 115 }])
  await page.keyboard.press('ControlOrMeta+Shift+a')
  await page.keyboard.press('v')
  await click(page, { x: 110, y: 100 })
  expect(await sel(page)).toEqual([d])
  await page.keyboard.press('ControlOrMeta+j')
  expect((await rec(page, d)).closed).toBe(true)
  expect((await undoLabels(page)).at(-1)).toBe('addClosingSegment')
})
