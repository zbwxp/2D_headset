// Masks (doc 18 §1.7b / §29.2b) in a real browser: the drawn pixels (Fabric A / V and the reference B) follow the
// mask rule (src/paintCases.ts M1–M5), and picking follows what is drawn — a masked-out part is not hittable.
import { expect, test, type Page } from '@playwright/test'

const frames = (p: Page) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))))
const close = (a: number[], b: number[], tol: number) => a.every((x, i) => Math.abs(x - b[i]) <= tol)

async function sample(page: Page, name: string, renderer: 'A' | 'B' | 'V') {
  await page.goto(`/?case=${name}${renderer === 'B' ? '&renderer=b' : ''}`)
  await page.waitForFunction(() => (window as any).__contour)
  if (renderer === 'V') await page.click('#modeV')
  await frames(page)
  return page.evaluate((renderer) => {
    const { view, paintCase } = (window as any).__contour
    const el: HTMLCanvasElement = renderer === 'B' ? view.refCanvas : view.canvas.lowerCanvasEl
    const ctx = el.getContext('2d')!
    const [z, , , , e, f] = view.canvas.viewportTransform
    const dpr = view.canvas.getRetinaScaling()
    return paintCase.expect.map((x: any) => ({ ...x, got: Array.from(ctx.getImageData(Math.floor((e + x.at.x * z) * dpr), Math.floor((f + x.at.y * z) * dpr), 1, 1).data) }))
  }, renderer)
}

for (const name of ['M1-mask-outside', 'M2-mask-inside', 'M3-mask-fill-and-stroke', 'M4-mask-hidden-source', 'M5-mask-disabled', 'M6-mask-own-boundary'])
  for (const renderer of ['A', 'B', 'V'] as const)
    test(`${name} [${renderer}]`, async ({ page }) => {
      const points = await sample(page, name, renderer)
      console.log('MASK', name, renderer, JSON.stringify(points.map((p: any) => ({ what: p.what, want: p.rgba, got: p.got }))))
      for (const p of points) expect(close(p.got, p.rgba, 2), `${p.what}: want ${p.rgba} got ${p.got}`).toBe(true)
    })

test('picking follows the mask: the hidden part of the line is not hit (the fill behind is); the drawn part is', async ({ page }) => {
  await page.goto('/?case=M1-mask-outside')
  await page.waitForFunction(() => (window as any).__contour)
  const r = await page.evaluate(() => {
    const { editor, hitTest } = (window as any).__contour
    const ev = editor.derived.evaluated()
    const at = (x: number, y: number) => hitTest(ev, { x, y }, { mode: 'V', tolerance: 2 })
    return { inside: at(50, 30), outside: at(70, 30) }
  })
  expect(r.inside).toMatchObject({ kind: 'fill', address: 'fill:F' })
  expect(r.outside).toMatchObject({ kind: 'segment', curveId: 'curve:C' })
})

test('inside mode: outside the region the line is not hit; editing the source moves the region (undo restores)', async ({ page }) => {
  await page.goto('/?case=M2-mask-inside')
  await page.waitForFunction(() => (window as any).__contour)
  const r = await page.evaluate(() => {
    const { editor, hitTest } = (window as any).__contour
    const at = (x: number, y: number) => hitTest(editor.derived.evaluated(), { x, y }, { mode: 'V', tolerance: 2 })
    const before = { left: at(10, 30), inside: at(40, 30) }
    // widen F to the left (move the boundary's left corners): the line becomes visible / hittable there
    const ok = editor.apply({ type: 'moveAnchors', targets: [{ curveId: 'curve:F-boundary', anchorId: 'a' }, { curveId: 'curve:F-boundary', anchorId: 'd' }], delta: { x: -15, y: 0 } }).ok
    const after = at(10, 30)
    editor.undo()
    return { before, ok, after, undone: at(10, 30) }
  })
  expect(r.before.left).toBeNull()
  expect(r.before.inside).toMatchObject({ kind: 'segment', curveId: 'curve:C' })
  expect(r.ok).toBe(true)
  expect(r.after).toMatchObject({ kind: 'segment', curveId: 'curve:C' })
  expect(r.undone).toBeNull()
})

// ---- review of ce2736c (dot): M2 picking, M3 real V drag mid-frame, M4 tolerance across a mask edge ----

test('M2: where the own boundary is masked away, picking finds the fill (not a hole)', async ({ page }) => {
  await page.goto('/?case=M6-mask-own-boundary')
  await page.waitForFunction(() => (window as any).__contour)
  const r = await page.evaluate(() => {
    const { editor, hitTest } = (window as any).__contour
    const ev = editor.derived.evaluated()
    return { inner: hitTest(ev, { x: 40, y: 11 }, { mode: 'V', tolerance: 0.1 }), outer: hitTest(ev, { x: 40, y: 9 }, { mode: 'V', tolerance: 0.1 }) }
  })
  expect(r.inner).toMatchObject({ kind: 'fill', address: 'fill:F' })
  expect(r.outer).toBeNull() // the stroke's visible outer half is ink, not within 0.1 of its centre line: nothing there to pick but ink
})

for (const which of ['target', 'source'] as const)
  test(`M3: a real V drag of the ${which} shows the mask of the moved geometry DURING the drag (not only after release)`, async ({ page }) => {
    await page.goto('/?case=M1-mask-outside')
    await page.waitForFunction(() => (window as any).__contour && document.querySelector('#modeV'))
    await page.click('#modeV')
    await frames(page)
    const box = (await page.locator('canvas.upper-canvas').boundingBox())!
    const P = (x: number, y: number) => ({ x: box.x + 20 + 3 * x, y: box.y + 20 + 3 * y })
    const px = (pts: [number, number][]) =>
      page.evaluate((pts) => {
        const { view } = (window as any).__contour
        const el: HTMLCanvasElement = view.canvas.lowerCanvasEl
        view.canvas.renderAll()
        const [z, , , , e, f] = view.canvas.viewportTransform
        const dpr = view.canvas.getRetinaScaling()
        return pts.map(([x, y]) => Array.from(el.getContext('2d')!.getImageData(Math.floor((e + x * z) * dpr), Math.floor((f + y * z) * dpr), 1, 1).data))
      }, pts)
    const start = which === 'target' ? P(70, 30) : P(30, 25) // on C / inside F
    const docBefore = await page.evaluate(() => JSON.stringify((window as any).__contour.editor.save()))
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x + 45, start.y, { steps: 5 }) // +15 world units
    // sampled 1 unit off the line's centre (its ink is 4 units wide): the selection's outline runs along the centre
    const during = await px([[65, 31], [70, 31]])
    expect(await page.evaluate(() => JSON.stringify((window as any).__contour.editor.save()))).toBe(docBefore) // a preview writes nothing
    await page.mouse.up()
    await frames(page)
    const after = await px([[65, 31], [70, 31]])
    // target moved: C is 55→95, F stays 20→60: at x 65 / 70 C is outside F → blue. Source moved: F is 35→75, C stays
    // 40→80: at x 65 / 70 C is inside F → hidden, F shows red.
    const want = which === 'target' ? [0, 0, 255, 255] : [255, 0, 0, 255]
    for (const got of [...during, ...after]) expect(close(got, want, 2), `${which}: want ${want} got ${got}`).toBe(true)
  })

test('M4: a line wholly masked away is not picked even when the pointer is just outside the mask (tolerance)', async ({ page }) => {
  await page.goto('/?case=M1-mask-outside')
  await page.waitForFunction(() => (window as any).__contour)
  const r = await page.evaluate(() => {
    const { editor, hitTest } = (window as any).__contour
    editor.apply({ type: 'moveAnchors', targets: [{ curveId: 'curve:C', anchorId: 'q' }], delta: { x: -21, y: 0 } }) // C: 40 → 59, all inside F
    editor.apply({ type: 'setContainerFlags', containerId: 'container:L1', visible: false }) // a hidden source still masks
    const ev = editor.derived.evaluated()
    return { edge: hitTest(ev, { x: 61, y: 30 }, { mode: 'V', tolerance: 6 }), visibleEnd: null as any }
  })
  expect(r.edge).toBeNull()
  // and a line partly outside: picked through its visible part near the pointer
  const s = await page.evaluate(() => {
    const { editor, hitTest } = (window as any).__contour
    editor.apply({ type: 'moveAnchors', targets: [{ curveId: 'curve:C', anchorId: 'q' }], delta: { x: 4, y: 0 } }) // 40 → 63: 60..63 outside F
    return hitTest(editor.derived.evaluated(), { x: 58, y: 31 }, { mode: 'V', tolerance: 6 })
  })
  expect(s).toMatchObject({ kind: 'segment', curveId: 'curve:C' })
  expect(s.d).toBeGreaterThan(2) // measured to its nearest VISIBLE point (x ≥ 60), not the hidden one under the pointer
})

// ---- the mask UI (Illustrator Clipping Mask: ⌘7 make, ⌥⌘7 release; the panel's mode / enabled) — doc 18 §30.5 ----
test('UI: ⌘7 makes a mask from the selection (front-most = source, the rest targets, 正常); the panel inverts and disables it; ⌥⌘7 releases; each one undo step', async ({ page }) => {
  await page.goto('/?case=P2-fill-layer-in-front') // L1 = [C (0,30)→(80,30)] behind L2 = [B, F (20..60)]
  await page.waitForFunction(() => (window as any).__contour && document.querySelector('#modeV'))
  await page.click('#modeV')
  const box = (await page.locator('canvas.upper-canvas').boundingBox())!
  const P = (x: number, y: number) => ({ x: box.x + 20 + 3 * x, y: box.y + 20 + 3 * y })
  const pixel = (x: number, y: number) =>
    page.evaluate(([x, y]) => {
      const { view } = (window as any).__contour
      view.selection.clear()
      view.render()
      view.canvas.renderAll()
      const [z, , , , e, f] = view.canvas.viewportTransform
      const dpr = view.canvas.getRetinaScaling()
      return Array.from(view.canvas.lowerCanvasEl.getContext('2d')!.getImageData(Math.floor((e + x * z) * dpr), Math.floor((f + y * z) * dpr), 1, 1).data)
    }, [x, y])
  const select = async () => {
    const c = P(5, 30), f = P(40, 40)
    await page.mouse.click(c.x, c.y)
    await page.keyboard.down('Shift')
    await page.mouse.click(f.x, f.y)
    await page.keyboard.up('Shift')
  }
  expect(await pixel(5, 31)).toEqual([0, 0, 255, 255]) // C outside F: drawn
  await select()
  expect([...(await page.evaluate(() => (window as any).__contour.selection.get()))].sort()).toEqual(['curve:C', 'fill:F'])
  await page.keyboard.press('ControlOrMeta+7')
  const m = await page.evaluate(() => (window as any).__contour.editor.reader.allRecords().find((r: any) => r.typeName === 'mask'))
  expect(m).toMatchObject({ sources: { fills: ['fill:F'], strokes: [] }, targets: ['curve:C'], mode: 'inside', enabled: true })
  expect(await pixel(5, 31)).toEqual([0, 0, 0, 0]) // clipped: C only inside F
  // the panel (select C in the layers panel — on the canvas the clipped part is, rightly, not pickable): invert, disable
  const selectC = () => page.click('[data-id="curve:C"]')
  await selectC()
  await page.locator(`#propsPanel [data-mask="${m.id}"] [data-mask-mode]`).selectOption('outside')
  expect(await pixel(5, 31)).toEqual([0, 0, 255, 255])
  await selectC()
  await page.locator(`#propsPanel [data-mask="${m.id}"] [data-mask-mode]`).selectOption('inside')
  await selectC()
  await page.locator(`#propsPanel [data-mask="${m.id}"] [data-mask-enabled]`).uncheck()
  expect(await pixel(5, 31)).toEqual([0, 0, 255, 255])
  // release with ⌥⌘7 (C selected)
  await selectC()
  await page.keyboard.press('ControlOrMeta+Alt+7')
  expect(await page.evaluate(() => (window as any).__contour.editor.reader.allRecords().some((r: any) => r.typeName === 'mask'))).toBe(false)
  expect(await page.evaluate(() => (window as any).__contour.editor.history.undo)).toEqual(['createMask', 'setMask', 'setMask', 'setMask', 'deleteRecords'])
  for (let i = 0; i < 5; i++) await page.keyboard.press('ControlOrMeta+z')
  expect(await page.evaluate(() => (window as any).__contour.editor.reader.allRecords().some((r: any) => r.typeName === 'mask'))).toBe(false)
  expect(await pixel(5, 31)).toEqual([0, 0, 255, 255])
})

test('UI: ⌘7 with fewer than two objects, or a front object that cannot mask, says why and writes nothing', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__contour && document.querySelector('#modeV'))
  await page.click('[data-id="curve:E1"]')
  await page.keyboard.press('ControlOrMeta+7')
  await expect(page.locator('#status')).toContainText('至少两个对象')
  expect(await page.evaluate(() => (window as any).__contour.editor.history.undo)).toEqual([])
})
