// Tracing across the poles (dot 1792490943 / 1792491357), validated on closed surfaces with known outlines before the
// head: a sphere and an ellipsoid built through the same loft. An orthographic outline of an ellipsoid is the set of
// points whose analytic normal is perpendicular to the view direction — one closed curve; where it passes over a pole
// it must come out as one closed loop through that pole. Checked at near-level pitches (the sensitive case: the
// outline then passes right by the poles) and at three grid sizes, with every loop counted (no size filter).
// Also measured: whether the default head's chin and crown tips are smooth (normals round a shrinking ring converge).
import { describe, expect, it } from 'vitest'
import { defaultShape, type Head, type HeadShape, makeHead } from '../src/head'
import { type Grid, candidates } from '../src/outline'
import { type V3, dot, len, norm, sub, toCamera } from '../src/view'

/** An exact ellipsoid as a Head (analytic positions and normals, same (u, y) parametrisation as the loft): a fixture
 *  built from interpolated knots is wrong inside its last knot interval at each tip (half-width and normal off by up
 *  to 1°), which near-level views turn into spurious outline points — the fixture must not be the thing under test. */
const ellipsoid = (A: number, B: number, C: number): Head => {
  const shape: HeadShape = { yMin: -B, yMax: B, a: [], f: [], b: [], n: [] }
  const r = (y: number) => Math.sqrt(Math.max(0, 1 - (y / B) ** 2))
  const at = (u: number, y: number): V3 => [A * r(y) * Math.sin(u), y, C * r(y) * Math.cos(u)]
  const normal = (u: number, y: number): V3 => {
    if (r(y) < 1e-12) return [0, Math.sign(y), 0]
    const p = at(u, y)
    return norm([p[0] / (A * A), p[1] / (B * B), p[2] / (C * C)])
  }
  return { shape, at, normal, section: y => ({ a: A * r(y), f: C * r(y), b: -C * r(y), n: 2, z0: 0 }) }
}
const VIEWS = [0, 0.1, -0.1, 1, -1, 3, -3, 30, -45].flatMap(pitch => [0, 37, 90].map(yaw => ({ yaw, pitch })))
const GRIDS: Grid[] = [{ nu: 120, ny: 80 }, { nu: 240, ny: 160 }, { nu: 480, ny: 320 }]

for (const [name, A, B, C] of [['sphere', 1, 1, 1], ['ellipsoid', 0.9, 1.3, 1.1]] as const) describe(`poles: ${name}`, () => {
  const head = ellipsoid(A, B, C)
  const ideal = (p: V3): V3 => norm([p[0] / (A * A), p[1] / (B * B), p[2] / (C * C)])
  // the worst |n_ideal · d| over the loop's points, per view and grid
  const worst: Record<string, number[]> = {}
  it('every view and grid: exactly one loop (all loops counted), closed, on the analytic outline', () => {
    const bad: string[] = []
    for (const g of GRIDS) for (const v of VIEWS) {
      const loops = candidates(head, v, g), d = toCamera(v), tag = `${v.yaw},${v.pitch} @${g.nu}x${g.ny}`
      if (loops.length !== 1 || !loops[0]!.closed) { bad.push(`${tag}: ${loops.length} loops [${loops.map(l => l.pts.length + (l.closed ? 'c' : 'o')).join(',')}]`); continue }
      const off = Math.max(...loops[0]!.pts.map(q => Math.abs(dot(ideal(q.p), d))))
      ;(worst[`${v.yaw},${v.pitch}`] ??= []).push(off)
      if (off >= 0.01) bad.push(`${tag}: |n·d| up to ${off.toExponential(2)}`)
      if (Math.abs(d[1]) < 1e-9) for (const pole of [[0, B, 0], [0, -B, 0]] as V3[]) { const m = Math.min(...loops[0]!.pts.map(q => len(sub(q.p, pole)))); if (m >= 0.02) bad.push(`${tag}: misses the pole by ${m.toFixed(3)}`) }
    }
    expect(bad).toEqual([])
  })
  it('positions converge as the grid refines (the worst error at the finest grid is not larger than at the coarsest)', () => {
    const rows = Object.entries(worst).map(([k, w]) => `${k}: ${w.map(x => x.toExponential(2)).join(' → ')}`)
    console.log(`${name} worst |n·d| per grid 120×80 → 240×160 → 480×320:\n${rows.join('\n')}`)
    expect(Object.entries(worst).filter(([, w]) => !(w.length === 3 && w[2]! <= w[0]! * 1.05 + 1e-6)).map(([k, w]) => `${k}: ${w.join(' ')}`)).toEqual([])
  })
  it('the loop has the length of the analytic outline (sphere: 2π, finest grid)', () => {
    if (name !== 'sphere') return
    for (const v of VIEWS.filter(x => x.yaw === 37)) {
      const L = candidates(head, v, GRIDS[2])[0]!.pts
      let s = 0
      for (let i = 0; i < L.length; i++) s += len(sub(L[(i + 1) % L.length]!.p, L[i]!.p))
      expect([v, Math.abs(s - 2 * Math.PI) / (2 * Math.PI) < 0.005]).toEqual([v, true])
    }
  })
})

it('the default head: are the chin and crown tips smooth? (normals round a shrinking ring)', () => {
  const head = makeHead(defaultShape), out: string[] = []
  for (const [tip, y0, s] of [['chin', defaultShape.yMin, 1], ['crown', defaultShape.yMax, -1]] as const) {
    for (const dy of [1e-2, 1e-3, 1e-4]) {
      const ns = Array.from({ length: 72 }, (_, i) => head.normal(-Math.PI + (i / 72) * 2 * Math.PI, y0 + s * dy))
      let spread = 0
      for (const a of ns) for (const b of ns) spread = Math.max(spread, Math.acos(Math.max(-1, Math.min(1, dot(a, b)))))
      out.push(`${tip} ring ${dy}: largest angle between normals round the ring ${(spread * 57.3).toFixed(1)}°`)
    }
  }
  console.log(out.join('\n'))
})
