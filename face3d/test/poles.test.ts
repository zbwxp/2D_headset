// Tracing across the poles (dot 1792490943), validated on closed surfaces with known outlines before the head:
// a sphere and an ellipsoid built through the same loft. An orthographic outline of an ellipsoid is the set of points
// whose (analytic) normal is perpendicular to the view direction — a single closed curve; where it passes over a pole it
// must come out as one closed loop through that pole, not two open chains.
import { describe, expect, it } from 'vitest'
import { type HeadShape, makeHead } from '../src/head'
import { candidates } from '../src/outline'
import { type V3, dot, len, norm, sub, toCamera } from '../src/view'

const ellipsoid = (A: number, B: number, C: number): HeadShape => {
  const ys = Array.from({ length: 2001 }, (_, i) => -B + (2 * B * i) / 2000), r = (y: number) => Math.sqrt(Math.max(0, 1 - (y / B) ** 2))
  return { yMin: -B, yMax: B, a: ys.map(y => ({ y, v: A * r(y) })), f: ys.map(y => ({ y, v: C * r(y) })), b: ys.map(y => ({ y, v: -C * r(y) })), n: [{ y: -B, v: 2 }, { y: B, v: 2 }] }
}
const VIEWS = [{ yaw: 0, pitch: 0 }, { yaw: 0, pitch: 30 }, { yaw: 37, pitch: -20 }, { yaw: 90, pitch: 45 }, { yaw: 60, pitch: -45 }, { yaw: 90, pitch: 0 }]

for (const [name, A, B, C] of [['sphere', 1, 1, 1], ['ellipsoid', 0.9, 1.3, 1.1]] as const) describe(`poles: ${name}`, () => {
  const head = makeHead(ellipsoid(A, B, C))
  const ideal = (p: V3): V3 => norm([p[0] / (A * A), p[1] / (B * B), p[2] / (C * C)])
  it('every view gives one closed loop on the analytic outline, through a pole where the outline crosses one', () => {
    for (const v of VIEWS) {
      const loops = candidates(head, v), d = toCamera(v)
      const big = loops.filter(l => l.pts.length > 20)
      expect([v, big.length, big.every(l => l.closed)]).toEqual([v, 1, true])
      const L = big[0]!.pts
      const off = Math.max(...L.map(q => Math.abs(dot(ideal(q.p), d))))
      expect([v, off < 0.02]).toEqual([v, true])
      // through a pole: when the analytic outline contains (0, ±B, 0), i.e. the view direction has no y component
      if (Math.abs(d[1]) < 1e-9) for (const pole of [[0, B, 0], [0, -B, 0]] as V3[]) expect([v, Math.min(...L.map(q => len(sub(q.p, pole)))) < 0.03]).toEqual([v, true])
    }
  })
  it('the loop has the length of the analytic outline (sphere: 2π)', () => {
    if (name !== 'sphere') return
    for (const v of VIEWS) {
      const L = candidates(head, v).filter(l => l.pts.length > 20)[0]!.pts
      let s = 0
      for (let i = 0; i < L.length; i++) s += len(sub(L[(i + 1) % L.length]!.p, L[i]!.p))
      expect([v, Math.abs(s - 2 * Math.PI) / (2 * Math.PI) < 0.01]).toEqual([v, true])
    }
  })
})
