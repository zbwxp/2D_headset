// One-off breakdown of the FabricView drag path (what scope B pays per pointermove). Prints only.
import { test } from '@playwright/test'
test('breakdown of one A-mode preview frame (onion 0 and 19)', async ({ page }) => {
  for (const onion of [0, 19]) {
    await page.goto(`/?bench&onion=${onion}`)
    await page.waitForFunction(() => (window as any).__contour)
    const r = await page.evaluate(async () => {
      const c = (window as any).__contour
      const { withPuts } = await import(/* @vite-ignore */ '/src/view/fabricView.ts' as string)
      const t: Record<string, number[]> = { preview: [], withPuts: [], evaluate: [], project: [], renderAll: [] }
      const id = c.editor.reader.allRecords().find((r: any) => r.typeName === 'curve' && r.anchors.p1).id
      for (let i = 0; i < 24; i++) {
        let a = performance.now()
        const pv = c.editor.preview({ type: 'moveAnchors', targets: [{ curveId: id, anchorId: 'p1' }], delta: { x: i * 0.1, y: 0 } })
        let b = performance.now(); t.preview.push(b - a); a = b
        const tmp = withPuts(c.editor, pv.puts)
        b = performance.now(); t.withPuts.push(b - a); a = b
        const ev = c.evaluate(tmp)
        b = performance.now(); t.evaluate.push(b - a); a = b
        c.view.render(ev, tmp)
        b = performance.now(); t.project.push(b - a); a = b
        c.view.canvas.renderAll()
        b = performance.now(); t.renderAll.push(b - a)
      }
      const med = (xs: number[]) => +[...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)].toFixed(2)
      return { objects: c.view.canvas.getObjects().length, ...Object.fromEntries(Object.entries(t).map(([k, v]) => [k, med(v)])) }
    })
    console.log(`[breakdown] onion=${onion}`, JSON.stringify(r))
  }
})
