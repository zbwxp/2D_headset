// bowen's bench face outline (fit/ref/outline-123.json) as 2D controls at a pose, and its mirror image — browser-safe,
// shared by the snapshot builder (fit/snapshots.ts) and the VTuber-style viewer (viewer/vtuber.ts).
import { type Model, type Pose, evaluate } from '../../../headset-core/src/evaluate/index'
import data from './ref/outline-123.json'

export type V = { x: number; y: number }
export type Controls = { points: Record<string, V>; lines: Record<string, { ha: V; hb: V }> }
const strip = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.replaceAll('view:', ''), v]))
const model = {
  views: data.views.map(v => { const [yaw, pitch] = v.key.slice('view:'.length).split(',').map(Number); return { yaw: yaw!, pitch: pitch!, points: v.points, lines: v.lines } }),
  responses: { points: Object.fromEntries(Object.entries(data.responses.points).map(([k, v]) => [k, strip(v as Record<string, unknown>)])), handles: Object.fromEntries(Object.entries(data.responses.handles).map(([k, v]) => [k, Object.fromEntries(Object.entries(v as Record<string, Record<string, unknown>>).map(([e, r]) => [e, strip(r)]))])) },
} as unknown as Model
export const LINES = data.lines
const partnerLine: Record<string, string> = {}
for (const l of LINES) { const m = /^([左右])(.*)$/.exec(l.name); const o = m ? LINES.find(x => x.name === (m[1] === '左' ? '右' : '左') + m[2]) : undefined; partnerLine[l.id] = o ? o.id : l.id }
const partnerPoint: Record<string, string> = {}
for (const l of LINES) { const o = LINES.find(x => x.id === partnerLine[l.id])!; partnerPoint[l.a] = o.a; partnerPoint[l.b] = o.b }

export const controlsAt = (pose: Pose): Controls => { const g = evaluate(model, pose); return { points: g.points, lines: g.lines } }
/** the mirror image: x negated, left and right exchanged (a line's handles go with its partner line) */
export const mirror = (c: Controls): Controls => ({
  points: Object.fromEntries(Object.keys(c.points).map(p => [p, { x: -c.points[partnerPoint[p] ?? p]!.x, y: c.points[partnerPoint[p] ?? p]!.y }])),
  lines: Object.fromEntries(Object.keys(c.lines).map(l => { const o = c.lines[partnerLine[l] ?? l]!; return [l, { ha: { x: -o.ha.x, y: o.ha.y }, hb: { x: -o.hb.x, y: o.hb.y } }] })),
})
export const avg = (a: Controls, b: Controls): Controls => ({
  points: Object.fromEntries(Object.keys(a.points).map(p => [p, { x: (a.points[p]!.x + b.points[p]!.x) / 2, y: (a.points[p]!.y + b.points[p]!.y) / 2 }])),
  lines: Object.fromEntries(Object.keys(a.lines).map(l => [l, { ha: { x: (a.lines[l]!.ha.x + b.lines[l]!.ha.x) / 2, y: (a.lines[l]!.ha.y + b.lines[l]!.ha.y) / 2 }, hb: { x: (a.lines[l]!.hb.x + b.lines[l]!.hb.x) / 2, y: (a.lines[l]!.hb.y + b.lines[l]!.hb.y) / 2 } }])),
})
export const flat = (c: Controls) => [...Object.keys(c.points).sort().flatMap(p => [c.points[p]!.x, c.points[p]!.y]), ...Object.keys(c.lines).sort().flatMap(l => [c.lines[l]!.ha.x, c.lines[l]!.ha.y, c.lines[l]!.hb.x, c.lines[l]!.hb.y])]
export const unflat = (like: Controls, v: number[]): Controls => {
  let k = 0; const points: Record<string, V> = {}, lines: Record<string, { ha: V; hb: V }> = {}
  for (const p of Object.keys(like.points).sort()) points[p] = { x: v[k++]!, y: v[k++]! }
  for (const l of Object.keys(like.lines).sort()) lines[l] = { ha: { x: v[k++]!, y: v[k++]! }, hb: { x: v[k++]!, y: v[k++]! } }
  return { points, lines }
}

export const cubicsOf = (c: Controls) => LINES.map(l => { const A = c.points[l.a]!, B = c.points[l.b]!, h = c.lines[l.id]!; return [A, { x: A.x + h.ha.x, y: A.y + h.ha.y }, { x: B.x + h.hb.x, y: B.y + h.hb.y }, B] as [V, V, V, V] })
export const sample = (q: [V, V, V, V], n = 40) => Array.from({ length: n + 1 }, (_, k) => { const t = k / n, u = 1 - t; return { x: u * u * u * q[0].x + 3 * u * u * t * q[1].x + 3 * u * t * t * q[2].x + t * t * t * q[3].x, y: u * u * u * q[0].y + 3 * u * u * t * q[1].y + 3 * u * t * t * q[2].y + t * t * t * q[3].y } })
/** the symmetric outline at a pose: the pose and its −yaw mirror averaged */
export const symmetricAt = (pose: Pose): Controls => avg(controlsAt(pose), mirror(controlsAt({ yaw: -pose.yaw, pitch: pose.pitch })))
