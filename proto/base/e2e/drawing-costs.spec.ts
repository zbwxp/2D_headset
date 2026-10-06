// Drawing-path cost inventory (dot, after 53d9fc0): in a REAL mouse drag, where does the time go once
// the evaluation is incremental? Same synthetic workload at several sizes, with and without 19 onion
// yaws. Informational: prints per-move averages; asserts only that the instrumentation ran. NOT in
// the gate (slow by design). Timings are one Chromium run on one machine, not a benchmark.
import { expect, test } from '@playwright/test'

const SIZES = [121, 1000, 3000]
const ONIONS = [0, 19]
const MOVES = 6

for (const curves of SIZES)
  for (const onion of ONIONS)
    test(`drag costs: ${curves} curves, ${onion} onion yaws`, async ({ page }) => {
      test.setTimeout(300_000)
      await page.goto(`/?bench&curves=${curves}&onion=${onion}`)
      await page.waitForFunction(() => (window as any).__contour)
      const box = (await page.locator('canvas.upper-canvas').boundingBox())!
      const at = (p: { x: number; y: number }) => ({ x: box.x + 150 + p.x * 3, y: box.y + 60 + p.y * 3 })
      const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))))
      const start = at({ x: 5, y: 4 }) // curve S0, anchor p1 (not connected)
      await page.mouse.move(start.x, start.y)
      await page.mouse.down()
      await page.mouse.move(start.x + 2, start.y) // first move: warms caches and indexes
      await frame()
      await page.evaluate(() => {
        const c = (window as any).__contour
        c.resetCounters()
        c.view.resetTiming()
      })
      for (let i = 1; i <= MOVES; i++) {
        await page.mouse.move(start.x + 2 + i * 3, start.y + i)
        await frame()
      }
      const r = await page.evaluate(() => {
        const c = (window as any).__contour
        return { timing: { ...c.view.timing }, counters: { ...c.counters }, objects: c.view.canvas.getObjects().length }
      })
      await page.mouse.up()
      const per = (x: number) => +(x / MOVES).toFixed(2)
      const row = {
        curves,
        onion,
        moves: r.timing.moves,
        renders: r.timing.renders,
        msPerMove: {
          plan: per(r.timing.plan),
          previewChanges: per(r.timing.previewChanges),
          assembleLists: per(r.timing.assemble),
          containerScan: per(r.timing.containerScan),
          buildObjects: per(r.timing.buildObjects),
          attach: per(r.timing.attach),
          renderAll: r.timing.renders ? +(r.timing.renderAll / r.timing.renders).toFixed(2) : null,
          inputToPaint: r.timing.paintsAfterInput ? +(r.timing.inputToPaint / r.timing.paintsAfterInput).toFixed(2) : null,
        },
        perMove: {
          previewEvals: per(r.counters.previewEvals),
          previewItems: per(r.counters.previewItems),
          scannedRows: per(r.counters.scannedRows),
          pathStrings: per(r.counters.pathStrings),
          fabricObjectsCreated: per(r.counters.fabricObjectsCreated),
          fullEvals: per(r.counters.fullEvals),
          snapshotRows: per(r.counters.snapshotRows),
        },
        canvasObjects: r.objects,
      }
      console.log('[drawing-costs]', JSON.stringify(row))
      expect(r.timing.moves).toBe(MOVES)
      expect(r.counters.snapshotRows).toBe(0)
    })
