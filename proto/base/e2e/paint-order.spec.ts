// Paint-order contract (PAINT-ORDER.md §2): independent expected pictures. Each case is a small
// document whose expected colour at named world points comes from the written rule (src/paintCases.ts),
// checked in Fabric (A) and in B separately — A is never the expectation for B.
// Known failures (today's code violates the rule) are marked test.fail and listed by the gate; if one
// starts passing, Playwright reports it, so it cannot silently stay listed.
import { expect, test, type Page } from '@playwright/test'

/** Cases whose counterexample in today's code is documented in PAINT-ORDER.md §2. */
const KNOWN: Record<string, string> = {}

const frames = (p: Page) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))))
const close = (a: number[], b: number[], tol: number) => a.every((x, i) => Math.abs(x - b[i]) <= tol)

async function sample(page: Page, name: string, renderer: 'A' | 'B' | 'V', vpt?: number[]) {
  await page.goto(`/?case=${name}${renderer === 'B' ? '&renderer=b' : ''}`)
  await page.waitForFunction(() => (window as any).__contour)
  if (renderer === 'V') await page.click('#modeV') // Fabric's V mode (groups per top-level layer)
  if (vpt)
    await page.evaluate((vpt) => {
      const { view } = (window as any).__contour
      view.canvas.setViewportTransform(vpt)
      view.render()
    }, vpt)
  await frames(page)
  return page.evaluate((renderer) => {
    const { view, paintCase } = (window as any).__contour
    const el: HTMLCanvasElement = renderer === 'B' ? view.refCanvas : view.canvas.lowerCanvasEl // A and V: Fabric
    const ctx = el.getContext('2d')!
    const [z, , , , e, f] = view.canvas.viewportTransform
    const dpr = view.canvas.getRetinaScaling()
    return paintCase.expect.map((x: any) => ({
      ...x,
      got: Array.from(ctx.getImageData(Math.floor((e + x.at.x * z) * dpr), Math.floor((f + x.at.y * z) * dpr), 1, 1).data),
    }))
  }, renderer)
}

const names = ['P1-fill-after-line', 'P1-line-after-fill', 'P2-fill-layer-in-front', 'P2-line-layer-in-front', 'P3-nested', 'P4-index-bytes', 'P6-own-boundary', 'P6-cross-layer', 'P6-semi-fill', 'P6-third-party-between', 'P7-others', 'P10-shown-parent', 'P10-hidden-parent', 'H1-butt-end-inside', 'H2-acute-inward-mitre']
for (const name of names)
  for (const renderer of ['A', 'B', 'V'] as const)
    test(`${KNOWN[name] ? `KF ${name}` : name} [${renderer}]`, async ({ page }) => {
      if (KNOWN[name]) test.fail(true, KNOWN[name])
      const points = await sample(page, name, renderer)
      console.log('PAINT', name, renderer, JSON.stringify(points.map((p: any) => ({ what: p.what, want: p.rgba, got: p.got }))))
      for (const p of points) expect(close(p.got, p.rgba, 2), `${p.what}: want ${p.rgba} got ${p.got}`).toBe(true)
    })

// The own-ink cases again at a fractional pan / zoom and DPR 2 (dot: the cut must stay aligned).
const OWN = ['P6-own-boundary', 'P6-cross-layer', 'P6-semi-fill', 'P6-third-party-between', 'P7-others']
test.describe('own ink at a fractional pan / zoom, DPR 2', () => {
  test.use({ deviceScaleFactor: 2 })
  for (const name of OWN)
    for (const renderer of ['A', 'B', 'V'] as const)
      test(`${name} [${renderer}] pan/zoom DPR2`, async ({ page }) => {
        const points = await sample(page, name, renderer, [2.7, 0, 0, 2.7, 13.37, 21.6])
        console.log('PAINT-DPR2', name, renderer, JSON.stringify(points.map((p: any) => ({ want: p.rgba, got: p.got }))))
        for (const p of points) expect(close(p.got, p.rgba, 2), `${p.what}: want ${p.rgba} got ${p.got}`).toBe(true)
      })
})

// Picking agrees with the picture (dot, S2): for every device pixel inside the fill that the picture
// shows as pure fill colour or pure stroke colour, picking the fill (V mode, zero segment tolerance so
// only the fill rule decides) must say "fill" exactly where the fill colour shows. Anti-aliased pixels
// are skipped. Uses the B picture (same routine as Fabric).
for (const name of ['P6-own-boundary', 'P6-cross-layer', 'H1-butt-end-inside', 'H2-acute-inward-mitre'])
  test(`picking agrees with the picture: ${name}`, async ({ page }) => {
    await page.goto(`/?case=${name}&renderer=b`)
    await page.waitForFunction(() => (window as any).__contour)
    await frames(page)
    const r = await page.evaluate(() => {
      const { view, editor, hitTest } = (window as any).__contour
      const ev = editor.derived.evaluated()
      const fillEntry = ev.paint.find((p: any) => p.kind === 'fill')
      const el: HTMLCanvasElement = view.refCanvas
      const px = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data
      const [z, , , , e, f] = view.canvas.viewportTransform
      const dpr = view.canvas.getRetinaScaling()
      const probe = new OffscreenCanvas(1, 1).getContext('2d')!
      const fillPath = new Path2D()
      const cs = fillEntry.item.cubics
      fillPath.moveTo(cs[0][0].x, cs[0][0].y)
      for (const [, c1, c2, p3] of cs) fillPath.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p3.x, p3.y)
      fillPath.closePath()
      let fillPx = 0, inkPx = 0, disagree = 0
      const examples: any[] = []
      for (let y = 0; y < el.height; y++)
        for (let x = 0; x < el.width; x++) {
          const w = { x: ((x + 0.5) / dpr - e) / z, y: ((y + 0.5) / dpr - f) / z }
          if (!probe.isPointInPath(fillPath, w.x, w.y)) continue
          const i = (y * el.width + x) * 4
          const isFill = px[i] >= 253 && px[i + 1] <= 2 && px[i + 2] <= 2 && px[i + 3] >= 253
          const isInk = px[i] <= 2 && px[i + 1] <= 2 && px[i + 2] >= 253 && px[i + 3] >= 253
          if (!isFill && !isInk) continue
          isFill ? fillPx++ : inkPx++
          const hit = hitTest(ev, w, { mode: 'V', tolerance: 0 })
          const pickedFill = hit?.kind === 'fill'
          if (pickedFill !== isFill) {
            disagree++
            if (examples.length < 5) examples.push({ w, picture: isFill ? 'fill' : 'ink', hit: hit?.kind ?? null })
          }
        }
      return { fillPx, inkPx, disagree, examples }
    })
    console.log('PICK_VS_PICTURE', name, JSON.stringify(r))
    expect(r.fillPx).toBeGreaterThan(0)
    expect(r.inkPx).toBeGreaterThan(0)
    expect(r.disagree).toBe(0)
  })
