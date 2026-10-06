// Scope-A benchmark: the old report's measurement scope reproduced as closely as we can —
// "target construction + synchronous display" for a single-handle edit, p50/p95, with the three parts
// timed separately (dot): numeric compute, stroke/path generation, drawing. NOT included: input
// dispatch, the committing transaction, inverse solving, compositor/raster beyond Fabric's renderAll.
// Absolute numbers only; the workload differs from the old 121-curve face (15 §5).
import { Path, StaticCanvas } from 'fabric'
import type { Editor } from './editor'
import { cubicsToPath, evaluate, type Evaluated } from './evaluate'
import { evaluateAtYaw } from './pose'
import { withPuts } from './view/fabricView'

const pct = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return +s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(2)
}
const stats = (xs: number[]) => ({ p50: pct(xs, 0.5), p95: pct(xs, 0.95), n: xs.length })

/** The OLD report's scope (store copy + full evaluation per move), kept as the baseline measurement. */
export function runScopeA(editor: Editor, yaws: number[], samples = 48) {
  const el = document.createElement('canvas')
  el.width = 640
  el.height = 420
  const canvas = new StaticCanvas(el, { renderOnAddRemove: false })
  const curveIds = editor.reader.allRecords().filter((r) => r.typeName === 'curve' && 'p1' in (r as any).anchors).map((r) => r.id)
  const compute: number[] = []
  const paths: number[] = []
  const draw: number[] = []
  const total: number[] = []
  for (let i = 0; i < samples + 4; i++) {
    const cmd = { type: 'moveHandle' as const, target: { curveId: curveIds[i % curveIds.length] as any, anchorId: 'p1' }, handle: 'out' as const, delta: { x: 0.1 * (i + 1), y: 0 } }
    const t0 = performance.now()
    const pv = editor.preview(cmd)
    if (!pv.ok) throw new Error(pv.error.message)
    const tmp = withPuts(editor, pv.puts)
    const ev = evaluate(tmp)
    const onions: Evaluated[] = yaws.map((y) => evaluateAtYaw(tmp, y, ev))
    const t1 = performance.now()
    const objs: Path[] = []
    for (const e of [ev, ...onions]) {
      for (const f of e.fills) objs.push(new Path(cubicsToPath(f.cubics, true), { fill: f.color, objectCaching: false }))
      for (const c of e.curves) objs.push(new Path(cubicsToPath(c.segments.map((s) => s.cubic)), { fill: '', stroke: '#222', strokeWidth: 0.5, objectCaching: false }))
    }
    const t2 = performance.now()
    canvas.remove(...canvas.getObjects())
    canvas.add(...objs)
    canvas.renderAll()
    const t3 = performance.now()
    if (i < 4) continue // warm-up
    compute.push(t1 - t0)
    paths.push(t2 - t1)
    draw.push(t3 - t2)
    total.push(t3 - t0)
  }
  canvas.dispose()
  return { compute: stats(compute), paths: stats(paths), draw: stats(draw), total: stats(total) }
}
