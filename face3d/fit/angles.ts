// What angle does each of bowen's hand-tuned bench outlines really show? (bowen 1792511184: the reference drawings
// are right as faces but their angles are only approximate, so the hand tuning at "30" / "60" is at unknown angles;
// 1792511197: compare repeatedly.) Alternating fit, the head only a protractor:
//   1. angles — the head fixed, each drawing's own (yaw, pitch) searched near its nominal one: where the head's outline
//      is closest to the drawing (same cost as bench-fit.ts; the front 0, 0 is the anchor and stays);
//   2. shape — the angles fixed, the symmetric head refitted to all drawings at their found angles;
//   repeated until neither changes much. Drawings: the nine views and the playback-corrected 30 / 60 (the hand tuning).
// Run: FIT_RUN=1 npx vite-node face3d/fit/angles.ts [archive.json]   (writes ref/angles-<out>.json)
import { writeFileSync } from 'node:fs'
import { type View } from '../src/view'
import { type BParams, LV, drawn, poseCost, shapeOfB, smoothB, validB } from './bench-fit'
import fitted from './ref/fit-bench-all.json'

const NOMINAL: View[] = [{ yaw: 0, pitch: 0 }, ...[-90, 30, 60, 90].map(yaw => ({ yaw, pitch: 0 })), ...[-45, 45].flatMap(pitch => [-90, 0, 30, 60, 90].map(yaw => ({ yaw, pitch })))]

if (process.env.FIT_RUN) {
  const file = process.argv[2] ?? '/Users/bowen/Desktop/123.json'
  const D = drawn(file, NOMINAL, 1)
  let p: BParams = JSON.parse(JSON.stringify(fitted)), angles: View[] = NOMINAL.map(v => ({ ...v }))
  const cost = (q: BParams, i: number, v: View) => poseCost(D, shapeOfB(q), i, v).cost
  const total = (q: BParams) => NOMINAL.reduce((s, _, i) => s + cost(q, i, angles[i]!), 0) + smoothB(q)
  const log: string[] = []
  for (let round = 0; round < 4; round++) {
    // 1. angles: a coarse grid then a finer one, per drawing (the front stays the anchor)
    const before = angles.map(a => ({ ...a }))
    NOMINAL.forEach((nv, i) => {
      if (nv.yaw === 0 && nv.pitch === 0) return
      let best = { v: angles[i]!, c: cost(p, i, angles[i]!) }
      for (const [range, step] of [[18, 3], [3, 0.5]] as const) {
        const c0 = best.v
        for (let dy = -range; dy <= range; dy += step) for (let dp = -range; dp <= range; dp += step) {
          const v = { yaw: c0.yaw + dy, pitch: c0.pitch + dp }
          if (Math.abs(v.yaw) > 120 || Math.abs(v.pitch) > 70) continue
          const c = cost(p, i, v)
          if (c < best.c) best = { v, c }
        }
      }
      angles[i] = best.v
    })
    const moved = Math.max(...angles.map((a, i) => Math.hypot(a.yaw - before[i]!.yaw, a.pitch - before[i]!.pitch)))
    // 2. shape: coordinate descent at these angles (a few passes)
    let c = total(p), scale = 0.5
    const groups: [keyof BParams, number][] = [['a', 0.04], ['f', 0.04], ['b', 0.04], ['n', 0.2]]
    while (scale > 0.06) {
      let improved = false
      const tryset = (q: BParams) => { if (!validB(q)) return false; const cq = total(q); if (cq < c - 1e-6) { p = q; c = cq; return true } return false }
      for (const [g, s] of groups) for (let i = 0; i < LV.length; i++) for (const sg of [1, -1]) { const q: BParams = JSON.parse(JSON.stringify(p)); (q[g] as number[])[i]! += sg * s * scale; if (tryset(q)) { improved = true; break } }
      for (const [g, s] of [['yMin', 0.03], ['fChin', 0.04]] as const) for (const sg of [1, -1]) { const q: BParams = { ...p, [g]: p[g] + sg * s * scale }; if (tryset(q)) { improved = true; break } }
      if (!improved) scale /= 2
    }
    const line = `round ${round}: largest angle change ${moved.toFixed(1)}°, cost ${c.toFixed(4)} | ` + NOMINAL.map((nv, i) => `${nv.yaw},${nv.pitch}→${angles[i]!.yaw},${angles[i]!.pitch} (${(cost(p, i, angles[i]!) / 2).toFixed(3)})`).join(' ')
    console.log(line); log.push(line)
    if (round > 0 && moved < 1) break
  }
  writeFileSync(new URL(`./ref/angles-${process.env.OUT ?? '123'}.json`, import.meta.url), JSON.stringify({ nominal: NOMINAL, angles, shape: p, log }, null, 1))
}
