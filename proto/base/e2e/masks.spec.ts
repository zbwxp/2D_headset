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

for (const name of ['M1-mask-outside', 'M2-mask-inside', 'M3-mask-fill-and-stroke', 'M4-mask-hidden-source', 'M5-mask-disabled'])
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
