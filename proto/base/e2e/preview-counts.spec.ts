// A REAL mouse drag in the browser (dot): the preview must not copy the store or run full evaluations,
// and the committed result must equal the full recompute. The canvas still rebuilds every object per
// render (drawing layer unchanged) — that count is reported, not asserted.
import { expect, test } from '@playwright/test'

test('A-mode anchor drag: incremental previews, no snapshot copy, commit = full recompute', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__contour)
  const box = (await page.locator('canvas.upper-canvas').boundingBox())!
  const at = (p: { x: number; y: number }) => ({ x: box.x + 150 + p.x * 3, y: box.y + 60 + p.y * 3 })
  const a = at({ x: 10, y: 60 })
  const b = at({ x: 20, y: 65 })
  await page.evaluate(() => (window as any).__contour.resetCounters())
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 8 })
  await page.mouse.up()
  const r = await page.evaluate(() => {
    const c = (window as any).__contour
    const counters = { ...c.counters }
    const same = JSON.stringify(c.editor.derived.evaluated()) === JSON.stringify(c.evaluate(c.editor.reader))
    return { counters, same, undo: c.editor.history.undo, a2: c.editor.reader.get('curve:C1').anchors.a2.p }
  })
  console.log('[browser drag counters]', JSON.stringify(r.counters))
  expect(r.a2).toEqual({ x: 20, y: 65 })
  expect(r.undo).toEqual(['moveAnchors'])
  expect(r.same).toBe(true)
  expect(r.counters.previews).toBeGreaterThanOrEqual(8)
  expect(r.counters.snapshotRows).toBe(0)
  expect(r.counters.previewFallbacks).toBe(0)
  expect(r.counters.fullEvals).toBe(0) // counters were copied before the check's evaluate: none during the drag
  expect(r.counters.previewEvals).toBe(2 * r.counters.previews) // per move: the curve + the fill reading it
})
