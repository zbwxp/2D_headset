// Picking in the browser, where fill containment is native isPointInPath with the drawing's fill rule
// (moved here from test/evaluate.test.ts, which has no canvas).
import { expect, test } from '@playwright/test'

test('V mode hits the fill interior once its layer is unlocked; a locked fill is not hittable', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__contour)
  const r = await page.evaluate(() => {
    const { editor, api, hitTest, ids } = (window as any).__contour
    const locked = hitTest(editor.derived.evaluated(), { x: 40, y: 50 }, { mode: 'V', tolerance: 2 })
    api.apply({ type: 'setContainerFlags', containerId: ids.L2, locked: false })
    const unlocked = hitTest(editor.derived.evaluated(), { x: 40, y: 50 }, { mode: 'V', tolerance: 2 })
    const outside = hitTest(editor.derived.evaluated(), { x: 200, y: 200 }, { mode: 'V', tolerance: 2 })
    return { locked, unlocked, outside, F: ids.F }
  })
  expect(r.locked).toBeNull()
  expect(r.unlocked).toMatchObject({ kind: 'fill', address: r.F })
  expect(r.outside).toBeNull()
})

test('V mode picks a fill closed only by bridges (fill-only closing edges): native picking reads the bridge', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__contour)
  const r = await page.evaluate(() => {
    const { editor, api, hitTest, ids } = (window as any).__contour
    // C1: a1 (0,0) → a2 (10,60) → a3 (60,100); the straight bridge a3 → a1 closes it
    const created = api.apply({
      type: 'createFill',
      id: 'fill:bridged',
      parentId: ids.L1,
      boundary: [
        { curveId: ids.C1, segmentId: 's1', dir: 1 },
        { curveId: ids.C1, segmentId: 's2', dir: 1 },
        { bridge: { from: { curveId: ids.C1, anchorId: 'a3' }, to: { curveId: ids.C1, anchorId: 'a1' } } },
      ],
    })
    const ev = editor.derived.evaluated()
    const g = ev.fills.find((f: any) => f.address === 'fill:bridged')
    const inside = hitTest(ev, { x: 20, y: 55 }, { mode: 'V', tolerance: 1 }) // between the curve and the chord
    const beyond = hitTest(ev, { x: 45, y: 40 }, { mode: 'V', tolerance: 1 }) // on the other side of the chord
    return { created: created.ok && created.written, bridge: g?.cubics[2], inside, beyond }
  })
  expect(r.created).toBe(true)
  expect(r.bridge[0]).toEqual({ x: 60, y: 100 })
  expect(r.bridge[3]).toEqual({ x: 0, y: 0 })
  expect(r.inside).toMatchObject({ kind: 'fill', address: 'fill:bridged' })
  expect(r.beyond?.address).not.toBe('fill:bridged')
})
