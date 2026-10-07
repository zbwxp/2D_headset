// Export PNG / SVG (doc 18 §30.15): every case of the paint-order and mask contract (src/paintCases.ts) is exported both
// ways, decoded in Chromium, and its expected pixels checked — the same oracle as the screen (e2e/paint-order, masks).
import { expect, test, type Page } from '@playwright/test'

const CASES = ['P1-fill-after-line', 'P1-line-after-fill', 'P2-fill-layer-in-front', 'P2-line-layer-in-front', 'P3-nested', 'P6-own-boundary', 'P6-cross-layer', 'P6-third-party-between', 'M1-mask-outside', 'M2-mask-inside', 'M3-mask-fill-and-stroke', 'M4-mask-hidden-source', 'M5-mask-disabled', 'M6-mask-own-boundary']
const close = (a: number[], b: number[], tol: number) => a.every((x, i) => Math.abs(x - b[i]) <= tol)

async function exported(page: Page, kind: 'png' | 'svg') {
  return page.evaluate(async (kind) => {
    const { view, editor, paintCase } = (window as any).__contour
    const load = (path: string) => import(/* @vite-ignore */ path) // resolved by the Vite dev server in the page
    const { drawingBounds } = await load('/src/export.ts')
    const box = drawingBounds(editor.derived.evaluated())
    const scale = 2
    const blob: Blob = await view.exportBlob(kind, scale)
    const c = document.createElement('canvas')
    c.width = Math.ceil(box.w * scale)
    c.height = Math.ceil(box.h * scale)
    const ctx = c.getContext('2d')!
    if (kind === 'png') ctx.drawImage(await createImageBitmap(blob), 0, 0)
    else {
      const img = new Image()
      img.src = URL.createObjectURL(blob)
      await img.decode()
      ctx.drawImage(img, 0, 0, c.width, c.height)
    }
    return paintCase.expect.map((x: any) => ({ what: x.what, want: x.rgba, got: Array.from(ctx.getImageData(Math.floor((x.at.x - box.x) * scale), Math.floor((x.at.y - box.y) * scale), 1, 1).data) }))
  }, kind)
}

for (const name of CASES)
  for (const kind of ['png', 'svg'] as const)
    test(`export ${kind.toUpperCase()}: ${name}`, async ({ page }) => {
      await page.goto(`/?case=${name}`)
      await page.waitForFunction(() => (window as any).__contour)
      const points = await exported(page, kind)
      for (const p of points) expect(close(p.got, p.want, 2), `${p.what}: want ${p.want} got ${p.got}`).toBe(true)
    })

test('the export buttons write separate files (download) and leave the document\'s own name and saved state alone', async ({ page }) => {
  await page.addInitScript(() => { delete (window as any).showOpenFilePicker; delete (window as any).showSaveFilePicker })
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__contour && document.querySelector('#exportPng'))
  await page.evaluate(() => (window as any).__contour.api.apply({ type: 'setProps', id: 'container:L1', name: 'x' }))
  const [png] = await Promise.all([page.waitForEvent('download'), page.click('#exportPng')])
  expect(png.suggestedFilename()).toBe('未命名.png')
  const [svg] = await Promise.all([page.waitForEvent('download'), page.click('#exportSvg')])
  expect(svg.suggestedFilename()).toBe('未命名.svg')
  await expect(page.locator('#fileName')).toHaveText('● 未命名') // still unsaved, no file name
})
