// Step-3 acceptance (docs/design/architecture/15 §2, §4 risks of route B, §5):
// every mouse operation is logged as a command and replayed through the API on a fresh document;
// both must produce identical author data, errors and undo behaviour. After every gesture the
// Fabric scene must equal a pure re-projection of the document (one authoritative source).
import { expect, test, type Page } from '@playwright/test'

const ZOOM = 3
const OFFSET = { x: 150, y: 60 }

async function open(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__contour)
}

/** Document coordinates → page coordinates (viewport transform [3,0,0,3,150,60]). */
async function toPage(page: Page, p: { x: number; y: number }) {
  const box = (await page.locator('canvas.upper-canvas').boundingBox())!
  return { x: box.x + OFFSET.x + p.x * ZOOM, y: box.y + OFFSET.y + p.y * ZOOM }
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, opts: { escape?: boolean } = {}) {
  const a = await toPage(page, from)
  const b = await toPage(page, to)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 })
  await page.mouse.move(b.x, b.y, { steps: 4 })
  if (opts.escape) await page.keyboard.press('Escape')
  await page.mouse.up()
}

async function state(page: Page) {
  return page.evaluate(() => {
    const c = (window as any).__contour
    return {
      doc: JSON.stringify(c.editor.reader.serialize('document')),
      undo: c.editor.history.undo as string[],
      log: c.view.log as any[],
      status: c.view.status as string,
    }
  })
}

/** Rebuild the document from the initial fixture plus the API replay of every logged UI command. */
async function replayViaApi(page: Page, extra: any[] = []) {
  return page.evaluate(async (extra) => {
    const c = (window as any).__contour
    const load = (path: string) => import(/* @vite-ignore */ path) // resolved by the Vite dev server in the page
    const { Editor } = await load('/src/editor.ts')
    const { exampleRecords } = await load('/src/fixture.ts')
    const { createApi } = await load('/src/api.ts')
    const fresh = new Editor(exampleRecords())
    const api = createApi(fresh)
    const results = [...extra, ...c.view.log.map((l: any) => l.cmd)].map((cmd: any) => {
      const r = api.apply(cmd)
      return { ok: r.ok, written: r.written, code: r.ok ? null : r.error.code, objects: r.ok ? null : r.error.objects }
    })
    return { doc: JSON.stringify(fresh.reader.serialize('document')), results }
  }, extra)
}

/** The Fabric scene must equal what a fresh projection of the document would draw. */
async function sceneIsPureProjection(page: Page) {
  return page.evaluate(() => {
    const c = (window as any).__contour
    const now = JSON.stringify(c.view.canvas.toObject())
    c.view.render()
    return now === JSON.stringify(c.view.canvas.toObject())
  })
}

test('A: mouse drag of an anchor equals the same command through the API', async ({ page }) => {
  await open(page)
  await drag(page, { x: 10, y: 60 }, { x: 20, y: 65 }) // a2 of C1 (L1, unlocked, not linked)
  const s = await state(page)
  expect(s.log).toHaveLength(1)
  expect(s.log[0].cmd).toMatchObject({ type: 'moveAnchors', delta: { x: 10, y: 5 } })
  expect(s.undo).toEqual(['moveAnchors'])
  const r = await replayViaApi(page)
  expect(r.doc).toBe(s.doc)
  expect(await sceneIsPureProjection(page)).toBe(true)
})

test('A: handle drag via mouse equals API', async ({ page }) => {
  await open(page)
  await drag(page, { x: 10, y: 80 }, { x: 16, y: 80 }) // a2.out handle at (10, 80)
  const s = await state(page)
  expect(s.log[0].cmd).toMatchObject({ type: 'moveHandle', handle: 'out', delta: { x: 6, y: 0 } })
  expect((await replayViaApi(page)).doc).toBe(s.doc)
})

test('LOCKED: dragging a3 (linked to b3 in locked L2) is rejected identically by mouse and API', async ({ page }) => {
  await open(page)
  const before = (await state(page)).doc
  await drag(page, { x: 60, y: 100 }, { x: 70, y: 100 })
  const s = await state(page)
  expect(s.doc).toBe(before) // nothing written
  expect(s.undo).toEqual([])
  expect(s.status).toContain('LOCKED')
  expect(s.log[0]).toMatchObject({ ok: false, written: false, error: { code: 'LOCKED' } })
  const r = await replayViaApi(page)
  expect(r.results[0]).toMatchObject({ ok: false, code: 'LOCKED', objects: s.log[0].error.objects })
  expect(r.doc).toBe(before)
})

test('cancel: Escape during a drag leaves no trace', async ({ page }) => {
  await open(page)
  const before = (await state(page)).doc
  await drag(page, { x: 10, y: 60 }, { x: 30, y: 70 }, { escape: true })
  const s = await state(page)
  expect(s.doc).toBe(before)
  expect(s.undo).toEqual([])
  expect(s.log).toEqual([])
  expect(await sceneIsPureProjection(page)).toBe(true)
})

// V mode is the Illustrator Selection tool (selection.ts, editor skeleton block 1): a canvas click selects the object
// (or the outermost group below its layer); a layer is selected from the layers panel. The selection's handle box is
// Fabric's; moving by the body and the marquee are ours. Every gesture is one command, replayed through the API.

test('V: non-uniform scale of layer L1 (selected in the layers panel) through the handle box equals the API command; linked b3 follows', async ({ page }) => {
  await open(page)
  await page.click('#unlock')
  await page.click('#modeV')
  await page.click('[data-id="container:L1"]') // the layers panel row
  const mr = await page.evaluate(() => {
    const c = (window as any).__contour
    const o = c.view.canvas.getActiveObject()
    return o ? { x: o.oCoords.mr.x, y: o.oCoords.mr.y, sel: c.selection.get() } : null
  })
  expect(mr?.sel).toEqual(['container:L1'])
  const box = (await page.locator('canvas.upper-canvas').boundingBox())!
  await page.mouse.move(box.x + mr!.x, box.y + mr!.y)
  await page.mouse.down()
  await page.mouse.move(box.x + mr!.x + 45, box.y + mr!.y, { steps: 6 })
  await page.mouse.up()
  const s = await state(page)
  const t = s.log.at(-1)
  expect(t.cmd.type).toBe('transformItems')
  expect(t.cmd.ids).toEqual(['container:L1'])
  expect(t.ok).toBe(true)
  expect(Math.abs(t.cmd.matrix.a - 1)).toBeGreaterThan(0.05) // non-uniform: x scaled
  expect(t.cmd.matrix.d).toBeCloseTo(1, 3) // y untouched
  expect(s.undo).toEqual(['setContainerFlags', 'transformItems'])
  const unlock = { type: 'setContainerFlags', containerId: 'container:L2', locked: false }
  const r = await replayViaApi(page, [unlock])
  expect(r.doc).toBe(s.doc)
  const pts = await page.evaluate(() => {
    const c = (window as any).__contour
    const g = (id: string) => c.editor.reader.get(id).anchors
    return { a3: g('curve:C1').a3.p, b3: g('curve:C2').b3.p, b2: g('curve:C2').b2.p }
  })
  expect(pts.b3).toEqual(pts.a3) // linked endpoint followed
  expect(pts.b2).toEqual({ x: 80, y: 50 }) // unlinked point in L2 untouched
  expect(await sceneIsPureProjection(page)).toBe(true)
  const reentrant = await page.evaluate(() => (window as any).__contour.view.ignoredReentrantEvents)
  console.log(`[evidence] V scale: re-entrant object:modified ignored = ${reentrant}`)
})

test('V: click + Shift-click selects two objects; moving them by the body = one undo step; clicking empty space deselects and writes nothing', async ({ page }) => {
  await open(page)
  await page.click('#unlock')
  await page.click('#modeV')
  const c1 = await toPage(page, { x: 10, y: 60 }) // on C1 (layer L1)
  const e1 = await toPage(page, { x: -25, y: 35 }) // on E1 (layer L3)
  await page.mouse.click(c1.x, c1.y)
  await page.keyboard.down('Shift')
  await page.mouse.click(e1.x, e1.y)
  await page.keyboard.up('Shift')
  expect(await page.evaluate(() => (window as any).__contour.selection.get())).toEqual(['curve:C1', 'curve:E1'])
  // drag the selection by one of its objects
  await page.mouse.move(c1.x, c1.y)
  await page.mouse.down()
  await page.mouse.move(c1.x + 30, c1.y + 15, { steps: 6 })
  await page.mouse.up()
  const afterMove = await state(page)
  expect(afterMove.undo).toEqual(['setContainerFlags', 'transformItems'])
  expect(afterMove.log.at(-1).cmd).toEqual({ type: 'transformItems', ids: ['curve:C1', 'curve:E1'], matrix: { a: 1, b: 0, c: 0, d: 1, e: 10, f: 5 } })
  const empty = await toPage(page, { x: 140, y: 110 }) // inside the canvas, nothing drawn
  await page.mouse.click(empty.x, empty.y)
  const afterClear = await state(page)
  expect(afterClear.doc).toBe(afterMove.doc)
  expect(await page.evaluate(() => (window as any).__contour.selection.get())).toEqual([])
  expect(await sceneIsPureProjection(page)).toBe(true)
  const r = await replayViaApi(page, [{ type: 'setContainerFlags', containerId: 'container:L2', locked: false }])
  expect(r.doc).toBe(afterMove.doc)
  await page.click('#undo')
  const undone = await state(page)
  expect(undone.undo).toEqual(['setContainerFlags'])
})

// ---- dot's UI review cases (2026-10-07) ----

test('V: moving a selection of CONNECTED objects C1 + C2 moves each linked endpoint once', async ({ page }) => {
  await open(page)
  await page.click('#unlock')
  await page.click('#modeV')
  const l1 = await toPage(page, { x: 10, y: 60 }) // a2 of C1 (L1)
  const l2 = await toPage(page, { x: 80, y: 50 }) // b2 of C2 (L2)
  await page.mouse.click(l1.x, l1.y)
  await page.keyboard.down('Shift')
  await page.mouse.click(l2.x, l2.y)
  await page.keyboard.up('Shift')
  expect(await page.evaluate(() => (window as any).__contour.selection.get())).toEqual(['curve:C1', 'curve:C2'])
  await page.mouse.move(l1.x, l1.y)
  await page.mouse.down()
  await page.mouse.move(l1.x + 15, l1.y + 7.5, { steps: 3 })
  await page.mouse.move(l1.x + 30, l1.y + 15, { steps: 3 })
  await page.mouse.up()
  const pts = await page.evaluate(() => {
    const c = (window as any).__contour
    const g = (id: string) => c.editor.reader.get(id).anchors
    return { a3: g('curve:C1').a3.p, b3: g('curve:C2').b3.p, b2: g('curve:C2').b2.p }
  })
  expect(pts.a3).toEqual({ x: 70, y: 105 })
  expect(pts.b3).toEqual({ x: 70, y: 105 })
  expect(pts.b2).toEqual({ x: 90, y: 55 })
  const s = await state(page)
  expect(s.undo).toEqual(['setContainerFlags', 'transformItems'])
  const r = await replayViaApi(page, [{ type: 'setContainerFlags', containerId: 'container:L2', locked: false }])
  expect(r.doc).toBe(s.doc)
  expect(await sceneIsPureProjection(page)).toBe(true)
})

test('V: Escape during a Fabric transform cancels it; nothing written', async ({ page }) => {
  await open(page)
  await page.click('#unlock')
  await page.click('#modeV')
  const l1 = await toPage(page, { x: 10, y: 60 })
  await page.mouse.click(l1.x, l1.y)
  const before = await state(page)
  await page.mouse.move(l1.x, l1.y)
  await page.mouse.down()
  await page.mouse.move(l1.x + 40, l1.y + 20, { steps: 5 })
  await page.keyboard.press('Escape')
  await page.mouse.move(l1.x + 60, l1.y + 30, { steps: 3 })
  await page.mouse.up()
  await page.waitForTimeout(50)
  const after = await state(page)
  expect(after.doc).toBe(before.doc)
  expect(after.undo).toEqual(before.undo)
  expect(after.log.filter((l: any) => l.cmd.type.startsWith('transform'))).toEqual([])
  expect(await sceneIsPureProjection(page)).toBe(true)
})

test('reference + 改源: dragging right on the mirrored copy moves the placed point right (source moves left)', async ({ page }) => {
  await open(page)
  await page.check('#src')
  // R1/E1#e2 is placed at (90, 50) (mirror of E1 e2 at (-30, 50) around x = 30)
  await drag(page, { x: 90, y: 50 }, { x: 96, y: 50 })
  const pts = await page.evaluate(() => {
    const c = (window as any).__contour
    const ev = c.evaluate(c.editor.reader)
    return {
      placed: ev.curves.find((x: any) => x.address === 'reference:R1/curve:E1').anchors.e2.p,
      source: c.editor.reader.get('curve:E1').anchors.e2.p,
    }
  })
  expect(pts.placed).toEqual({ x: 96, y: 50 }) // follows the mouse on screen
  expect(pts.source).toEqual({ x: -36, y: 50 }) // source moved in its own (mirrored) space
  const s = await state(page)
  expect(s.log[0].cmd).toMatchObject({ type: 'moveAnchors', delta: { x: -6, y: 0 } })
  expect((await replayViaApi(page)).doc).toBe(s.doc)
})

test('reference handle drag without 改源 is rejected explicitly; the source is not written', async ({ page }) => {
  await open(page)
  // give E1/e2 a visible handle through the source first, via the API (not part of the gesture under test)
  await page.evaluate(() => (window as any).__contour.api.apply({ type: 'moveHandle', target: { curveId: 'curve:E1', anchorId: 'e2' }, handle: 'out', delta: { x: -10, y: 0 } }))
  await page.evaluate(() => (window as any).__contour.view.render())
  const before = await state(page)
  // R1 mirrors it: placed handle at x = −(−40) + 60 = 100, y = 50
  await drag(page, { x: 100, y: 50 }, { x: 104, y: 52 })
  const after = await state(page)
  expect(after.doc).toBe(before.doc)
  expect(after.undo).toEqual(before.undo)
  expect(after.status).toContain('INVALID')
  const rej = await page.evaluate(() => (window as any).__contour.view.rejections)
  expect(rej[0].address).toBe('reference:R1/curve:E1#e2.out')
})
