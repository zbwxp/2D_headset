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
