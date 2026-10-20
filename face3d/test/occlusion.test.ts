// Occlusion on the fine mesh (dot 1792490143 / 1792490326). Regression from the diagnostic at yaw 0 / pitch −45, x+
// side: the stretch the old spur pruning cut (40 points: 29 hidden, 11 visible by a ray test) must be classified like a
// ray test on a finer mesh; and the fine-mesh test converges (360 × 240 vs 720 × 480 agree on nearly every point).
import { describe, expect, it } from 'vitest'
import { walk } from '../src/contour'
import { CHIN_Y, defaultShape, makeHead } from '../src/head'
import { candidates, hiddenOn, occluder } from '../src/outline'
import { type V3, add, cross, dot, len, rotate, scale, sub, toCamera } from '../src/view'

const head = makeHead(defaultShape)

/** reference: a ray toward the camera against a fine triangle mesh, hits beyond a small start gap */
function rayHidden(p: V3, n: V3, d: V3, tris: [V3, V3, V3][]): boolean {
  const s0 = add(p, scale(n, 1e-4))
  for (const [a, b, c] of tris) {
    const e1 = sub(b, a), e2 = sub(c, a), h = cross(d, e2), det = dot(e1, h)
    if (Math.abs(det) < 1e-12) continue
    const f = 1 / det, s = sub(s0, a), u = f * dot(s, h)
    if (u < 0 || u > 1) continue
    const q = cross(s, e1), v = f * dot(d, q)
    if (v < 0 || u + v > 1) continue
    if (f * dot(e2, q) > 1e-3) return true
  }
  return false
}
const mesh = (NU: number, NY: number) => {
  const tris: [V3, V3, V3][] = [], P = (i: number, j: number) => head.at(-Math.PI + (i / NU) * 2 * Math.PI, head.shape.yMax - (j / NY) * (head.shape.yMax - head.shape.yMin))
  for (let j = 0; j < NY; j++) for (let i = 0; i < NU; i++) { const a = P(i, j), b = P(i + 1, j), c = P(i, j + 1), e = P(i + 1, j + 1); tris.push([a, b, e], [a, e, c]) }
  return tris
}

describe('occlusion', () => {
  it('regression: the stretch the old pruning cut at yaw 0 / pitch −45 is classified like a fine ray test', () => {
    const view = { yaw: 0, pitch: -45 }, d = toCamera(view), chin = head.at(0, CHIN_Y)
    const extent = (l: { pts: { p: V3 }[] }) => Math.max(...[0, 1, 2].map(k => Math.max(...l.pts.map(q => q.p[k]!)) - Math.min(...l.pts.map(q => q.p[k]!))))
    const loops = candidates(head, view).filter(l => extent(l) >= 0.15)
    const near = loops.flatMap((l, li) => l.pts.map((q, i) => ({ li, i, d: len(sub(q.p, chin)) }))).sort((a, b) => a.d - b.d)
    let path: ReturnType<typeof walk> = []
    for (const c of near.slice(0, 80)) {
      const w = [walk(loops[c.li]!, c.i, 1), walk(loops[c.li]!, c.i, -1)].find(x => x.length > 8 && rotate(x[8]!.p, view)[0] - rotate(x[0]!.p, view)[0] > 0.01)
      if (w) { path = w; break }
    }
    // the stretch from the diagnostic: points 43 … 88 of this walk (cut were 46 … 85)
    const stretch = path.slice(43, 89), tris = mesh(720, 480), occ = occluder(head, view)
    const ref = stretch.map(q => rayHidden(q.p, head.normal(q.u, q.y), d, tris)), got = stretch.map(q => hiddenOn(occ, q.p, q.u, q.y))
    const hiddenRef = ref.filter(Boolean).length
    console.log(`stretch ${stretch.length}: reference hidden ${hiddenRef}, fine-mesh test hidden ${got.filter(Boolean).length}, disagree ${ref.filter((r, i) => r !== got[i]).length}`)
    expect(hiddenRef).toBeGreaterThanOrEqual(25) // the hidden branch is there
    expect(got.map((g, i) => (g === ref[i] ? '.' : g ? 'H' : 'V')).join('')).toBe('.'.repeat(stretch.length))
  }, 120000)
  it('convergence: 360 × 240 and 720 × 480 agree on (nearly) every candidate outline point', () => {
    let n = 0, diff = 0
    for (const view of [{ yaw: 0, pitch: -45 }, { yaw: 30, pitch: 0 }, { yaw: 60, pitch: 30 }, { yaw: 45, pitch: -30 }, { yaw: 90, pitch: 45 }]) {
      const a = occluder(head, view), b = occluder(head, view, { nu: 720, ny: 480 })
      for (const l of candidates(head, view)) for (const q of l.pts) { n++; if (hiddenOn(a, q.p, q.u, q.y) !== hiddenOn(b, q.p, q.u, q.y)) diff++ }
    }
    console.log(`convergence: ${diff} of ${n} candidate points differ (${((100 * diff) / n).toFixed(2)} %)`)
    expect(diff / n).toBeLessThan(0.01)
  }, 120000)
})
