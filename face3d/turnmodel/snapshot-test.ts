// 快照 vs 转头模型 (bowen 1792857964): snapshots every S° with the core's way in between (each control point and handle
// end linear between the two neighbouring snapshots), against the model evaluated at that angle. Max deviation per part,
// curves compared at 21 samples each (same parameter; eyes at their 31 samples), plus the cost per frame.
import { readFileSync } from 'node:fs'
import { evaluate, bez, type ModelData, type Frame, type Cubic, type V } from './index'
const M = JSON.parse(readFileSync(new URL('../../bench-tasks/转头模型/model.json', import.meta.url), 'utf8')) as ModelData
type Parts = Record<string, V[][]>   // part → curves as control points (outline / side / ears) or samples (eyes)
const parts = (f: Frame): Parts => ({
  outline: f.outline.map(l => l.c), side: f.side.map(l => l.c), eyes: [...f.eyes.near, ...f.eyes.far].map(e => e.pts),
  ears: [...f.ears.near, ...f.ears.far].map(l => l.c), fake: f.ears.fake.map(l => l.c) })
const lerp = (a: Parts, b: Parts, t: number): Parts => Object.fromEntries(Object.entries(a).map(([k, cs]) => [k, cs.map((c, i) => c.map((p, j) => [p[0] + (b[k]![i]![j]![0] - p[0]) * t, p[1] + (b[k]![i]![j]![1] - p[1]) * t] as V))]))
const samples = (k: string, c: V[]): V[] => k === 'eyes' ? c : Array.from({ length: 21 }, (_, i) => bez(c as Cubic, i / 20))
const dev = (a: Parts, b: Parts) => Object.fromEntries(Object.keys(a).map(k => [k, Math.max(...a[k]!.map((c, i) => { const sa = samples(k, c), sb = samples(k, b[k]![i]!); return Math.max(...sa.map((p, j) => Math.hypot(p[0] - sb[j]![0], p[1] - sb[j]![1]))) }))]))
const exact: Record<string, Parts> = {}
for (let y = 0; y <= 90; y += 0.5) exact[y] = parts(evaluate(M, y))
for (const S of [30, 15, 10, 5]) {
  const snap = (y: number) => exact[y]!
  const worst: Record<string, { d: number; at: number }> = {}
  for (let y = 0; y <= 90; y += 0.5) {
    const a = Math.floor(y / S) * S, b = Math.min(90, a + S), t = b === a ? 0 : (y - a) / (b - a)
    const d = dev(exact[y]!, lerp(snap(a), snap(b), t))
    for (const [k, v] of Object.entries(d)) if (!worst[k] || v > worst[k]!.d) worst[k] = { d: v, at: y }
  }
  console.log(`every ${S}°:`, Object.entries(worst).map(([k, v]) => `${k} ${v.d.toFixed(2)} (at ${v.at}°)`).join(' · '))
}
// cost per frame
const t0 = performance.now(); let n = 0; for (let k = 0; k < 20; k++) for (let y = 0; y <= 90; y += 0.5) { evaluate(M, y); n++ }
const t1 = performance.now(); const a = exact[15]!, b = exact[30]!; let m = 0; for (let k = 0; k < 20000; k++) { lerp(a, b, 0.37); m++ }
const t2 = performance.now()
console.log(`model: ${((t1 - t0) / n).toFixed(3)} ms per frame · snapshot lerp: ${((t2 - t1) / m * 1000).toFixed(2)} µs per frame`)
