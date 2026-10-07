// B draws only A-mode scenes (dot 0264deb review): after A→V its canvas is hidden and a frame queued in
// A mode is not drawn after the switch; after V→A B shows the A picture again, identical to before.
import { expect, test, type Page } from '@playwright/test'

const frames = (p: Page) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))))

test('A→V hides B and drops its queued frame; V→A restores the identical B picture', async ({ page }) => {
  await page.goto('/?renderer=b')
  await page.waitForFunction(() => (window as any).__contour)
  await frames(page)
  const initial = await page.evaluate(() => (window as any).__contour.view.refCanvas.toDataURL())
  // queue a B frame for a changed document, then switch to V in the same task: the frame must not draw
  const queued = await page.evaluate(() => {
    const c = (window as any).__contour
    const r = c.api.apply({ type: 'moveAnchors', targets: [{ curveId: 'curve:C1', anchorId: 'a2' }], delta: { x: 20, y: 0 } })
    c.view.render()
    c.view.setMode('V')
    return { ok: r.ok, pixels: c.view.refCanvas.toDataURL() }
  })
  expect(queued.ok).toBe(true) // the queued frame would have drawn a different picture
  await frames(page)
  const inV = await page.evaluate(() => {
    const v = (window as any).__contour.view
    return { display: getComputedStyle(v.refCanvas).display, pixels: v.refCanvas.toDataURL(), drawn: v.canvas.getObjects().filter((x: any) => x.type === 'path').length }
  })
  expect(inV.display).toBe('none')
  expect(inV.pixels).toBe(queued.pixels) // no A frame drawn after the switch
  expect(inV.drawn).toBeGreaterThan(0) // V is drawn by Fabric (the paint list as paths)
  await page.evaluate(() => {
    const c = (window as any).__contour
    c.editor.undo()
    c.view.setMode('A')
  })
  await frames(page)
  const back = await page.evaluate(() => {
    const v = (window as any).__contour.view
    return { display: getComputedStyle(v.refCanvas).display, pixels: v.refCanvas.toDataURL(), fabricObjects: v.canvas.getObjects().length }
  })
  expect(back.display).not.toBe('none')
  expect(back.fabricObjects).toBe(0)
  expect(back.pixels).toBe(initial)
})
