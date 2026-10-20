// Tracing across the poles (dot 1792490943 / 1792491357 / 1792492222), validated on closed surfaces with known outlines
// before the head: an exact sphere and an exact ellipsoid (analytic positions and normals in the loft's (u, y)
// parametrisation — a fixture built from interpolated knots is wrong inside its last knot interval at each tip and
// itself made spurious near-pole points). The orthographic outline of an ellipsoid is one closed curve, analytically
// known; it must come out as one closed loop at every view and grid, converging to the analytic curve in position
// (two-way distance), not only in the n · d residual. Near-level pitches are the sensitive case (the outline then
// skims past the poles). Then the production path on the real head: tip normals and the outline across grids.
import { describe, expect, it } from 'vitest'
import { defaultShape, type Head, type HeadShape, makeHead } from '../src/head'
import { type Grid, candidates } from '../src/outline'
import { type V3, cross, dot, len, norm, sub, toCamera } from '../src/view'

const ellipsoid = (A: number, B: number, C: number): Head => {
  const shape: HeadShape = { yMin: -B, yMax: B, a: [], f: [], b: [], n: [] }
  const r = (y: number) => Math.sqrt(Math.max(0, 1 - (y / B) ** 2))
  const at = (u: number, y: number): V3 => [A * r(y) * Math.sin(u), y, C * r(y) * Math.cos(u)]
  const normal = (u: number, y: number): V3 => { if (r(y) < 1e-12) return [0, Math.sign(y), 0]; const p = at(u, y); return norm([p[0] / (A * A), p[1] / (B * B), p[2] / (C * C)]) }
  return { shape, at, normal, section: y => ({ a: A * r(y), f: C * r(y), b: -C * r(y), n: 2, z0: 0 }) }
}
/** the analytic outline of the ellipsoid at a view, densely sampled: in scaled coordinates q = (x/A, y/B, z/C) it is the
 *  great circle of the unit sphere perpendicular to (dx/A, dy/B, dz/C) */
const analyticOutline = (A: number, B: number, C: number, d: V3, n = 20000): V3[] => {
  const m = norm([d[0] / A, d[1] / B, d[2] / C]), t: V3 = Math.abs(m[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const e1 = norm(cross(m, t)), e2 = cross(m, e1)
  return Array.from({ length: n }, (_, i) => { const a = (2 * Math.PI * i) / n, c = Math.cos(a), s = Math.sin(a); return [A * (e1[0] * c + e2[0] * s), B * (e1[1] * c + e2[1] * s), C * (e1[2] * c + e2[2] * s)] as V3 })
}
const VIEWS = [0, 0.1, -0.1, 1, -1, 3, -3, 30, -45].flatMap(pitch => [0, 37, 90].map(yaw => ({ yaw, pitch })))
const GRIDS: Grid[] = [{ nu: 120, ny: 80 }, { nu: 240, ny: 160 }, { nu: 480, ny: 320 }]
const nearest = (p: V3, Q: V3[]) => { let m = Infinity; for (const q of Q) { const d = len(sub(p, q)); if (d < m) m = d } return m }
/** distance from p to a traced loop as a polyline (its segments), so the measure is position, not point spacing */
const toLoops = (p: V3, loops: { pts: { p: V3 }[]; closed: boolean }[]) => {
  let m = Infinity
  for (const l of loops) { const P = l.pts, n = P.length; for (let i = 0; i < (l.closed ? n : n - 1); i++) {
    const a = P[i]!.p, b = P[(i + 1) % n]!.p, ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / Math.max(1e-30, dot(ab, ab))))
    const d = len(sub(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t])); if (d < m) m = d } }
  return m
}

for (const [name, A, B, C] of [['sphere', 1, 1, 1], ['ellipsoid', 0.9, 1.3, 1.1]] as const) describe(`poles: ${name}`, () => {
  const head = ellipsoid(A, B, C)
  it('every view and grid: exactly one closed loop (all loops counted); positions converge to the analytic outline', () => {
    // the data is made here (dot: the check must not rely on another test having filled it)
    const rows: { view: string; grid: string; loops: number; closed: boolean; dist: number }[] = []
    for (const g of GRIDS) for (const v of VIEWS) {
      const loops = candidates(head, v, g), ana = analyticOutline(A, B, C, toCamera(v))
      const pts = loops.flatMap(l => l.pts.map(q => q.p))
      // two-way: traced points → the dense analytic curve (no stray point) and analytic samples → the traced polyline
      // (no missing stretch; every 50th sample)
      const d1 = pts.length ? Math.max(...pts.map(p => nearest(p, ana))) : Infinity
      const d2 = pts.length ? Math.max(...ana.filter((_, i) => i % 50 === 0).map(p => toLoops(p, loops))) : Infinity
      rows.push({ view: `${v.yaw},${v.pitch}`, grid: `${g.nu}x${g.ny}`, loops: loops.length, closed: loops.every(l => l.closed), dist: Math.max(d1, d2) })
    }
    expect(rows.length).toBe(VIEWS.length * GRIDS.length)
    console.log(`${name}: two-way distance to the analytic outline, grids ${GRIDS.map(g => `${g.nu}x${g.ny}`).join(' → ')}\n` +
      VIEWS.map(v => `${v.yaw},${v.pitch}: ${rows.filter(r => r.view === `${v.yaw},${v.pitch}`).map(r => r.dist.toExponential(2)).join(' → ')}`).join('\n'))
    expect(rows.filter(r => r.loops !== 1 || !r.closed).map(r => `${r.view} @${r.grid}: ${r.loops} loops`)).toEqual([])
    const bad = VIEWS.map(v => `${v.yaw},${v.pitch}`).filter(k => { const w = rows.filter(r => r.view === k).map(r => r.dist); return !(w.length === 3 && w[2]! < 2e-3 && w[2]! <= w[0]! * 1.05 + 1e-9) })
    expect(bad).toEqual([])
  }, 600000)
})

describe('the default head through the production path', () => {
  const head = makeHead(defaultShape)
  it('tip normals: the production normal agrees with small one-sided steps, so the reading is the surface, not the step', () => {
    const out: string[] = []
    const oneSided = (u: number, y: number, k: number, away: number): V3 => {
      const dist = Math.abs(y - (away > 0 ? defaultShape.yMin : defaultShape.yMax)), hy = k * dist, hu = 1e-5
      const pu = sub(head.at(u + hu, y), head.at(u - hu, y)), py = away > 0 ? sub(head.at(u, y + hy), head.at(u, y)) : sub(head.at(u, y), head.at(u, y - hy))
      return norm(cross(pu, py))
    }
    const us = Array.from({ length: 72 }, (_, i) => -Math.PI + (i / 72) * 2 * Math.PI)
    const spread = (f: (u: number) => V3) => { const ns = us.map(f); let s = 0; for (const a of ns) for (const b of ns) s = Math.max(s, Math.acos(Math.max(-1, Math.min(1, dot(a, b))))); return s * 57.3 }
    for (const [tip, y0, away] of [['chin', defaultShape.yMin, 1], ['crown', defaultShape.yMax, -1]] as const) for (const dy of [1e-2, 1e-3, 1e-4, 1e-5, 1e-6]) {
      const y = y0 + away * dy
      const prod = spread(u => head.normal(u, y)), one1 = spread(u => oneSided(u, y, 0.1, away)), one2 = spread(u => oneSided(u, y, 0.01, away))
      out.push(`${tip} ring ${dy}: spread of normals round the ring — production ${prod.toFixed(1)}°, one-sided 0.1·d ${one1.toFixed(1)}°, 0.01·d ${one2.toFixed(1)}°`)
      expect([tip, dy, Math.abs(prod - one2) < 2]).toEqual([tip, dy, true])
    }
    console.log(out.join('\n'))
  })
  it('the outline across grids: loop count, closedness, two-way position distance to the finest grid', () => {
    const views = [{ yaw: 0, pitch: 0 }, { yaw: 0, pitch: 1 }, { yaw: 0, pitch: -1 }, { yaw: 45, pitch: 15 }, { yaw: 75, pitch: 15 }, { yaw: 45, pitch: 38 }, { yaw: 0, pitch: -45 }, { yaw: 90, pitch: 30 }]
    const rows: string[] = []
    for (const v of views) {
      const per = GRIDS.map(g => candidates(head, v, g)), fine = per[2]!.flatMap(l => l.pts.map(q => q.p))
      rows.push(`${v.yaw},${v.pitch}: ` + per.map((L, i) => {
        const pts = L.flatMap(l => l.pts.map(q => q.p))
        const d = i === 2 ? 0 : Math.max(Math.max(...pts.map(p => toLoops(p, per[2]!))), Math.max(...fine.filter((_, k) => k % 7 === 0).map(p => toLoops(p, L))))
        return `${GRIDS[i]!.nu}x${GRIDS[i]!.ny}: ${L.length} loops [${L.map(l => l.pts.length + (l.closed ? 'c' : 'o')).join(',')}]${i === 2 ? '' : ` dist→finest ${d.toFixed(4)}`}`
      }).join(' | '))
    }
    console.log(rows.join('\n'))
    expect(rows.length).toBe(views.length)
  }, 600000)
})
