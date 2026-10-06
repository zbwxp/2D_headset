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
      doc: JSON.stringify(c.editor.store.serialize('document')),
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
    const { loadExample } = await load('/src/fixture.ts')
    const { createApi } = await load('/src/api.ts')
    const fresh = new Editor()
    loadExample(fresh.store)
    const api = createApi(fresh)
    const results = [...extra, ...c.view.log.map((l: any) => l.cmd)].map((cmd: any) => {
      const r = api.apply(cmd)
      return { ok: r.ok, written: r.written, code: r.ok ? null : r.error.code, objects: r.ok ? null : r.error.objects }
    })
    return { doc: JSON.stringify(fresh.store.serialize('document')), results }
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

test('V: non-uniform scale of L1 through Fabric controls equals the API command; linked b3 follows', async ({ page }) => {
  await open(page)
  await page.click('#unlock')
  await page.click('#modeV')
  await page.mouse.click(...Object.values(await toPage(page, { x: 10, y: 60 })) as [number, number]) // select L1 group
  const mr = await page.evaluate(() => {
    const c = (window as any).__contour
    const o = c.view.canvas.getActiveObject()
    return o ? { x: o.oCoords.mr.x, y: o.oCoords.mr.y, id: o.containerId } : null
  })
  expect(mr?.id).toBe('container:L1')
  const box = (await page.locator('canvas.upper-canvas').boundingBox())!
  await page.mouse.move(box.x + mr!.x, box.y + mr!.y)
  await page.mouse.down()
  await page.mouse.move(box.x + mr!.x + 45, box.y + mr!.y, { steps: 6 })
  await page.mouse.up()
  const s = await state(page)
  const t = s.log.at(-1)
  expect(t.cmd.type).toBe('transformContainer')
  expect(t.ok).toBe(true)
  expect(Math.abs(t.cmd.matrix.a - 1)).toBeGreaterThan(0.05) // non-uniform: x scaled
  expect(t.cmd.matrix.d).toBeCloseTo(1, 3) // y untouched
  const unlock = { type: 'setContainerFlags', containerId: 'container:L2', locked: false }
  const r = await replayViaApi(page, [unlock])
  expect(r.doc).toBe(s.doc)
  const pts = await page.evaluate(() => {
    const c = (window as any).__contour
    const g = (id: string) => c.editor.store.get(id).anchors
    return { a3: g('curve:C1').a3.p, b3: g('curve:C2').b3.p, b2: g('curve:C2').b2.p }
  })
  expect(pts.b3).toEqual(pts.a3) // linked endpoint followed
  expect(pts.b2).toEqual({ x: 80, y: 50 }) // unlinked point in L2 untouched
  expect(await sceneIsPureProjection(page)).toBe(true)
  const reentrant = await page.evaluate(() => (window as any).__contour.view.ignoredReentrantEvents)
  console.log(`[evidence] V scale: re-entrant object:modified ignored = ${reentrant}`)
})

test('V: ActiveSelection move of two groups = one undo step; ending the selection writes nothing', async ({ page }) => {
  await open(page)
  await page.click('#unlock')
  await page.click('#modeV')
  const l1 = await toPage(page, { x: 10, y: 60 })
  const l3 = await toPage(page, { x: -25, y: 35 })
  await page.mouse.click(l1.x, l1.y)
  await page.keyboard.down('Shift')
  await page.mouse.click(l3.x, l3.y)
  await page.keyboard.up('Shift')
  const kind = await page.evaluate(() => (window as any).__contour.view.canvas.getActiveObject()?.type)
  expect(kind).toBe('activeselection')
  // drag the selection by its body
  await page.mouse.move(l1.x, l1.y)
  await page.mouse.down()
  await page.mouse.move(l1.x + 30, l1.y + 15, { steps: 6 })
  await page.mouse.up()
  const afterMove = await state(page)
  expect(afterMove.undo.at(-1)).toBe('V transform')
  // end the multi-selection: Fabric bakes its transform into members; our document must not change
  const empty = await toPage(page, { x: 140, y: 120 })
  await page.mouse.click(empty.x, empty.y)
  const afterClear = await state(page)
  expect(afterClear.doc).toBe(afterMove.doc)
  expect(await sceneIsPureProjection(page)).toBe(true)
  const reentrant = await page.evaluate(() => (window as any).__contour.view.ignoredReentrantEvents)
  console.log(`[evidence] ActiveSelection: re-entrant object:modified ignored = ${reentrant}`)
  await page.click('#undo')
  const undone = await state(page)
  expect(undone.undo).toEqual(['setContainerFlags'])
})
