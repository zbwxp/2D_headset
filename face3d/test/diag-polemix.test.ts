// Diagnostic (dot 1792492402): at yaw 45 / pitch 15, x+ side, the first chin samples — each key's (u, y) and 3D point,
// the (u, y)-mixed point and the plain 3D mean, and their distance (on screen) to the head's own outline there.
import { it } from 'vitest'
import { type Side, mixContour, traceKey, weights } from '../src/contour'
import { makeModel } from '../src/model'
import { type V3, rotate } from '../src/view'

it('pole samples under (u, y) mixing vs a 3D mean, yaw 45 / pitch 15 and 75 / 15', () => {
  const m = makeModel(), head = m.head
  for (const v of [{ yaw: 45, pitch: 15 }, { yaw: 75, pitch: 15 }]) {
    const W = weights(v.yaw, v.pitch), side: Side = 'pos'
    const near = [...W].sort((a, b) => b.w - a.w)[0]!, nk = m.table.at(near.yaw, near.pitch), ref: Partial<Record<Side, V3>> = {}
    for (const s of ['pos', 'neg'] as const) { const q = nk[s][0]!.samples[0]!; ref[s] = head.at(q.u, q.y) }
    const t = traceKey(head, v, ref), target = (t[side][0] ?? []).map(q => rotate(head.at(q.u, q.y), v))
    const toTarget = (p: V3) => { const r = rotate(p, v); return Math.min(...target.map(q => Math.hypot(q[0] - r[0], q[1] - r[1]))) }
    const mixed = mixContour(head, m.table, v).find(l => l.side === side)!
    console.log(`view ${v.yaw},${v.pitch}: weights ${W.map(w => `${w.yaw},${w.pitch}:${w.w.toFixed(2)}`).join(' ')}`)
    for (let i = 0; i < 5; i++) {
      const ks = W.map(w => { const q = m.table.at(w.yaw, w.pitch)[side][0]!.samples[i]!; return { w: w.w, q, p: head.at(q.u, q.y) } })
      const mean: V3 = [0, 1, 2].map(k => ks.reduce((a, x) => a + x.w * x.p[k]!, 0)) as unknown as V3
      console.log(`  sample ${i}: keys ${ks.map(x => `(u ${(x.q.u * 57.3).toFixed(0)}°, y ${x.q.y.toFixed(3)})`).join(' ')}\n     (u,y)-mix → to outline ${toTarget(mixed.pts[i]!).toFixed(3)} R;  3D mean → to outline ${toTarget(mean).toFixed(3)} R`)
    }
  }
})
