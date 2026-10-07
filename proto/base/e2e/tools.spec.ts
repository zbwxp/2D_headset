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

test('Pen on an END of an open path continues that path (one extendCurve); from the start the new anchors go before it; clicking the other end closes (one step)', async ({ page }) => {
  await open(page)
  await page.click('[data-id="container:L1"]')
  const id = await penPath(page, [{ x: 100, y: 10 }, { x: 120, y: 10 }])
  // continue from the last anchor
  await page.keyboard.press('p')
  await click(page, { x: 120, y: 10 })
  await click(page, { x: 140, y: 20 })
  await page.keyboard.press('Enter')
  let c = await rec(page, id)
  expect(c.segments.map((s: any) => [c.anchors[s.from].p, c.anchors[s.to].p])).toEqual([
    [{ x: 100, y: 10 }, { x: 120, y: 10 }],
    [{ x: 120, y: 10 }, { x: 140, y: 20 }],
  ])
  expect((await undoLabels(page)).at(-1)).toBe('extendCurve')
  // continue from the FIRST anchor: the new one is put before it
  await click(page, { x: 100, y: 10 })
  await click(page, { x: 100, y: 40 })
  await page.keyboard.press('Enter')
  c = await rec(page, id)
  expect(c.anchors[c.segments[0].from].p).toEqual({ x: 100, y: 40 })
  expect(c.anchors[c.segments[0].to].p).toEqual({ x: 100, y: 10 })
  // continue from the last end and click the other end: closed, ONE undo step
  const before = await doc(page)
  await click(page, { x: 140, y: 20 })
  await click(page, { x: 140, y: 50 })
  await click(page, { x: 100, y: 40 }) // the other end
  c = await rec(page, id)
  expect(c.closed).toBe(true)
  expect((await undoLabels(page)).at(-1)).toBe('continuePath')
  await page.keyboard.press('ControlOrMeta+z')
  expect(await doc(page)).toBe(before)
})

test('continuation (review of 3ef87db): a dragged outer handle is kept when closing straight away; a layer hidden while drawing is refused, nothing written', async ({ page }) => {
  await open(page)
  await page.keyboard.press('p')
  // E1 runs (-20,20) → (-30,50); drag out of its end, then close onto the other end
  await dragFrom(page, { x: -30, y: 50 }, { x: -24, y: 54 })
  await click(page, { x: -20, y: 20 })
  const e1 = await rec(page, 'curve:E1')
  expect(e1.closed).toBe(true)
  expect(e1.anchors.e2.hOut).toEqual({ x: 6, y: 4 })
  expect((await undoLabels(page)).at(-1)).toBe('continuePath')
  await page.keyboard.press('ControlOrMeta+z')
  // hide the layer during a continuation: Enter refuses
  await click(page, { x: -30, y: 50 })
  await click(page, { x: -20, y: 70 })
  await page.click('[data-id="container:L3"] [data-flag="visible"]')
  const before = await doc(page)
  const history = await undoLabels(page)
  await page.keyboard.press('Enter')
  expect(await doc(page)).toBe(before)
  expect(await undoLabels(page)).toEqual(history)
  expect(await page.evaluate(() => (window as any).__contour.view.status)).toMatch(/已隐藏/)
})

test('handles: dragging a smooth point\'s handle turns the other with it (same line, its own length); ⌥ breaks them; ⇧C click = corner, drag out = smooth, drag a handle = that one only', async ({ page }) => {
  await open(page)
  await page.click('[data-id="container:L1"]')
  await page.keyboard.press('p')
  await click(page, { x: 100, y: 10 })
  await dragFrom(page, { x: 120, y: 30 }, { x: 130, y: 30 }) // smooth: hOut (10, 0), hIn (−10, 0)
  await click(page, { x: 140, y: 10 })
  await page.keyboard.press('Enter')
  const id = (await sel(page))[0]
  await page.keyboard.press('a')
  await dragFrom(page, { x: 130, y: 30 }, { x: 130, y: 40 }) // hOut → (10, 10)
  let a = (await rec(page, id)).anchors.p2
  expect(a.hOut).toEqual({ x: 10, y: 10 })
  expect(a.hIn.x).toBeCloseTo(-7.071, 3)
  expect(a.hIn.y).toBeCloseTo(-7.071, 3)
  expect((await undoLabels(page)).at(-1)).toBe('setHandles')
  // ⌥: only the dragged handle
  const hInBefore = a.hIn
  const h = await toPage(page, { x: 130, y: 40 }), h2 = await toPage(page, { x: 135, y: 40 })
  await page.keyboard.down('Alt')
  await page.mouse.move(h.x, h.y)
  await page.mouse.down()
  await page.mouse.move(h2.x, h2.y, { steps: 4 })
  await page.mouse.up()
  await page.keyboard.up('Alt')
  a = (await rec(page, id)).anchors.p2
  expect(a.hOut).toEqual({ x: 15, y: 10 })
  expect(a.hIn).toEqual(hInBefore)
  expect((await undoLabels(page)).at(-1)).toBe('moveHandle')
  // ⇧C: click the anchor → corner
  await page.keyboard.press('Shift+C')
  await click(page, { x: 120, y: 30 })
  a = (await rec(page, id)).anchors.p2
  expect([a.hIn, a.hOut]).toEqual([{ x: 0, y: 0 }, { x: 0, y: 0 }])
  // drag out of a corner anchor → symmetric handles
  await dragFrom(page, { x: 140, y: 10 }, { x: 150, y: 16 })
  a = (await rec(page, id)).anchors.p3
  expect(a.hOut).toEqual({ x: 10, y: 6 })
  expect(a.hIn).toEqual({ x: -10, y: -6 })
  // drag one handle with ⇧C: that one only
  await dragFrom(page, { x: 130, y: 4 }, { x: 128, y: 0 })
  a = (await rec(page, id)).anchors.p3
  expect(a.hIn).toEqual({ x: -12, y: -10 })
  expect(a.hOut).toEqual({ x: 10, y: 6 })
  expect((await undoLabels(page)).slice(-3)).toEqual(['setHandles', 'setHandles', 'moveHandle'])
})
