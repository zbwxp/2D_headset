// bowen's drawn face outline from a bench archive (bowen 1792503785: "用我的bench的脸轮廓的30，60，90"), at any
// pose: the archive's nine views and its playback responses evaluated by headset-core's own `evaluate` (the 30° / 60°
// shapes are corrections on the 0° → 90° edges, not views of their own). Read-only; canvas px, y down.
import { readFileSync } from 'node:fs'
import { type Model, type Pose, evaluate } from '../../../headset-core/src/evaluate/index'

type V = { x: number; y: number }
export type P2 = [number, number]
export interface BenchOutline { model: Model; lines: { id: string; name: string; a: string; b: string }[] }

export function readBench(file: string, layerName: string): BenchOutline {
  const doc = JSON.parse(readFileSync(file, 'utf8')).document
  const layer = doc.network.layers.find((l: { name: string }) => l.name === layerName)
  if (!layer) throw new Error(`no layer ${layerName}`)
  const pts = new Set(doc.network.points.filter((p: { layer: string }) => p.layer === layer.id).map((p: { id: string }) => p.id))
  const names: Record<string, string> = Object.fromEntries(doc.names.line)
  const lines = doc.network.lines.filter((l: { a: string; b: string }) => pts.has(l.a) && pts.has(l.b)).map((l: { id: string; a: string; b: string }) => ({ id: l.id, name: names[l.id] ?? l.id, a: l.a, b: l.b }))
  const views = doc.network.shapes.layers.filter((s: { kind: string }) => s.kind === 'view').map((s: { key: string; points: Record<string, V>; lines: Record<string, { ha: V; hb: V }> }) => {
    const [yaw, pitch] = s.key.slice('view:'.length).split(',').map(Number)
    return { yaw: yaw!, pitch: pitch!, points: s.points, lines: s.lines }
  })
  // archive edge keys are `view:a,b>view:c,d`; evaluate's are `a,b>c,d`
  const strip = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.replaceAll('view:', ''), v]))
  const responses = { points: Object.fromEntries(Object.entries(doc.animation.points as Record<string, Record<string, unknown>>).map(([k, v]) => [k, strip(v)])), handles: Object.fromEntries(Object.entries(doc.animation.handles as Record<string, Record<string, Record<string, unknown>>>).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([e, r]) => [e, strip(r)]))])) }
  return { model: { views, responses } as unknown as Model, lines }
}

/** the outline at a pose: each line a cubic (a, a + ha, b + hb, b) sampled at n + 1 points, canvas px */
export function outlineAt(b: BenchOutline, pose: Pose, n = 40): { name: string; pts: P2[] }[] {
  const g = evaluate(b.model, pose)
  return b.lines.map(l => {
    const A = g.points[l.a]!, B = g.points[l.b]!, h = g.lines[l.id] ?? { ha: { x: 0, y: 0 }, hb: { x: 0, y: 0 } }
    const P = [A, { x: A.x + h.ha.x, y: A.y + h.ha.y }, { x: B.x + h.hb.x, y: B.y + h.hb.y }, B]
    const pts: P2[] = []
    for (let k = 0; k <= n; k++) { const t = k / n, u = 1 - t; pts.push([u * u * u * P[0]!.x + 3 * u * u * t * P[1]!.x + 3 * u * t * t * P[2]!.x + t * t * t * P[3]!.x, u * u * u * P[0]!.y + 3 * u * u * t * P[1]!.y + 3 * u * t * t * P[2]!.y + t * t * t * P[3]!.y]) }
    return { name: l.name, pts }
  })
}
