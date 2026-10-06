// Drawing-path costs in a REAL mouse drag (dot). Informational: prints per-move averages; asserts only
// that the instrumentation ran. NOT in the gate (slow). One Chromium run on one machine, not a benchmark.
// Main group (closer to real use, dot/bowen): 400 open curves + 100 fill-boundary loop curves + 100 solid
// fills that overlap (occlusion) + 6,000 anchor dots = 6,600 scene objects;
// incremental (option A) vs full rebuild each render. Stress group: curve count only (1000 / 3000).
// Fill MATERIALS (gradient, blur, pattern, transparency stacks) are not implemented: NOT measured here.
import { expect, test, type Page } from '@playwright/test'

const MOVES = 6
const MAIN = 'curves=400&fills=100&fillSize=50&fillSpacing=30&fillCols=10'

async function measure(page: Page, query: string, target: { x: number; y: number }, opts: { fullRebuild?: boolean } = {}) {
  await page.goto(`/?bench&${query}`)
  await page.waitForFunction(() => (window as any).__contour)
  if (opts.fullRebuild) await page.evaluate(() => ((window as any).__contour.view.fullRebuildEachRender = true))
  const box = (await page.locator('canvas.upper-canvas').boundingBox())!
  const vpt: number[] = await page.evaluate(() => [...(window as any).__contour.view.canvas.viewportTransform])
  const at = (p: { x: number; y: number }) => ({ x: box.x + vpt[4] + p.x * vpt[0], y: box.y + vpt[5] + p.y * vpt[3] })
  const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))))
  const start = at(target)
  const grabbed = await page.evaluate(async (t) => {
    const c = (window as any).__contour
    const { hitTest } = await import(/* @vite-ignore */ '/src/evaluate.ts' as string)
    return hitTest(c.editor.derived.evaluated(), t, { mode: 'A', tolerance: 6 / c.view.canvas.getZoom() })?.address ?? null
  }, target)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 2, start.y) // warm-up move
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
  expect(r.timing.moves).toBe(MOVES)
  expect(r.counters.snapshotRows).toBe(0)
  return {
    grabbed,
    zoom: +vpt[0].toFixed(3),
    renders: r.timing.renders,
    msPerMove: {
      plan: per(r.timing.plan),
      previewChanges: per(r.timing.previewChanges),
      assembleLists: per(r.timing.assemble),
      buildObjects: per(r.timing.buildObjects),
      attach: per(r.timing.attach),
      renderAll: r.timing.renders ? +(r.timing.renderAll / r.timing.renders).toFixed(2) : null,
      inputToDrawDone: r.timing.drawsAfterInput ? +(r.timing.inputToDrawDone / r.timing.drawsAfterInput).toFixed(2) : null,
    },
    perMove: { objectsCreated: per(r.counters.fabricObjectsCreated), pathStrings: per(r.counters.pathStrings), rowsScanned: per(r.counters.scannedRows) },
    canvasObjects: r.objects,
  }
}

const FREE = { x: 5, y: 4 } // curve S0 anchor p1 (not connected)
const FILL_EDGE = { x: 50, y: 160 } // loop L0 anchor q1 (= the boundary of fill L0 and under other fills)

for (const onion of [0, 19])
  for (const [name, target] of [['free anchor', FREE], ['fill boundary', FILL_EDGE]] as const)
    for (const fullRebuild of [false, true])
      test(`main 500 curves (400 open + 100 fill loops) + 100 overlapping fills, ${onion} onion, ${name}, ${fullRebuild ? 'full rebuild' : 'incremental (A)'}`, async ({ page }) => {
        test.setTimeout(300_000)
        const row = await measure(page, `${MAIN}&onion=${onion}`, target, { fullRebuild })
        console.log('[drawing-costs main]', JSON.stringify({ onion, drag: name, mode: fullRebuild ? 'full rebuild' : 'A', ...row }))
      })

// Reference drawing path B (same picture, see e2e/renderer-b.spec.ts): same drags, same workloads
for (const onion of [0, 19])
  for (const [name, target] of [['free anchor', FREE], ['fill boundary', FILL_EDGE]] as const)
    test(`main 500 curves (400 open + 100 fill loops) + 100 overlapping fills, ${onion} onion, ${name}, renderer B`, async ({ page }) => {
      test.setTimeout(300_000)
      const row = await measure(page, `${MAIN}&onion=${onion}&renderer=b`, target)
      console.log('[drawing-costs main]', JSON.stringify({ onion, drag: name, mode: 'B', ...row }))
    })
for (const curves of [1000, 3000])
  for (const onion of [0, 19])
    test(`stress ${curves} curves, ${onion} onion, renderer B`, async ({ page }) => {
      test.setTimeout(300_000)
      const row = await measure(page, `curves=${curves}&onion=${onion}&renderer=b`, FREE)
      console.log('[drawing-costs stress]', JSON.stringify({ curves, onion, mode: 'B', ...row }))
    })

for (const curves of [1000, 3000])
  for (const onion of curves === 3000 ? [0] : [0, 19]) // 3000 × 19: the initial full build does not finish (known)
    test(`stress ${curves} curves, ${onion} onion, incremental (A)`, async ({ page }) => {
      test.setTimeout(300_000)
      const row = await measure(page, `curves=${curves}&onion=${onion}`, FREE)
      console.log('[drawing-costs stress]', JSON.stringify({ curves, onion, ...row }))
    })
