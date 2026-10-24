// 转头模型: the rules hold at their corners. Run: npx vitest run --dir face3d/turnmodel
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { evaluate, params, bez, atHeight, smoothAt, type ModelData, type Cubic, type V } from './index'

const M = JSON.parse(readFileSync(new URL('../../bench-tasks/转头模型/model.json', import.meta.url), 'utf8')) as ModelData
const dist = (a: V, b: V) => Math.hypot(a[0] - b[0], a[1] - b[1])
/** The distance from q to c (sampled, then refined around the best sample). */
const near = (c: Cubic, q: V) => {
  const d = (t: number) => dist(bez(c, t), q)
  let tb = 0; for (let i = 1; i <= 1000; i++) if (d(i / 1000) < d(tb)) tb = i / 1000
  let lo = Math.max(0, tb - 0.001), hi = Math.min(1, tb + 0.001)
  for (let i = 0; i < 60; i++) { const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3; if (d(a) < d(b)) hi = b; else lo = a }
  return d((lo + hi) / 2)
}

describe('outline and side face', () => {
  it('0 / 45 / 90° are bowen\'s keyframes exactly (points and handles)', () => {
    for (const k of M.outline.keys) {
      const f = evaluate(M, k.yaw)
      for (const [id, v] of Object.entries(k.pts)) expect(dist(f.points[id]!, v)).toBeLessThan(1e-9)
      for (const l of f.outline) { const h = k.handles[l.name]!; expect(dist(l.c[1], [l.c[0][0] + h.ha[0], l.c[0][1] + h.ha[1]])).toBeLessThan(1e-9); expect(dist(l.c[2], [l.c[3][0] + h.hb[0], l.c[3][1] + h.hb[1]])).toBeLessThan(1e-9) }
    }
  })
  it('the side face is rigid: every sheet point at x = d·sin θ, height kept; crown and chin shared with the outline', () => {
    const f = evaluate(M, 30), th = (30 * M.sheet.theta45) / 45
    for (const [id, [d, y]] of Object.entries(M.sheet.pts)) { expect(f.points[id]![0]).toBeCloseTo(d * Math.sin((th * Math.PI) / 180), 9); expect(f.points[id]![1]).toBe(y) }
    const skull = f.outline.find(l => l.name === 'nearSkull')!.c, jaw = f.outline.find(l => l.name === 'nearJaw')!.c
    expect(skull[3]).toEqual(f.points.crown); expect(jaw[3]).toEqual(f.points.chin)
  })
  it('0° is left-right symmetric', () => {
    const f = evaluate(M, 0), sk = f.outline.find(l => l.name === 'nearSkull')!.c, jaw = f.outline.find(l => l.name === 'nearJaw')!.c
    expect(f.points.nearRoot![0]).toBeCloseTo(-f.points.zyg![0], 9)
    for (const c of [sk, jaw]) for (let i = 0; i <= 10; i++) { const q = bez(c, i / 10); expect(near(f.outline.find(l => l.name === 'farSkull')!.c, [-q[0], q[1]]) < 3 || near(f.outline.find(l => l.name === 'farJaw')!.c, [-q[0], q[1]]) < 3 || near(f.outline.find(l => l.name === 'farCheek')!.c, [-q[0], q[1]]) < 3).toBe(true) }
  })
  it('a negative yaw is the mirror of the positive one', () => {
    const a = evaluate(M, 37), b = evaluate(M, -37)
    for (const id of Object.keys(a.points)) { expect(b.points[id]![0]).toBeCloseTo(-a.points[id]![0], 12); expect(b.points[id]![1]).toBeCloseTo(a.points[id]![1], 12) }
  })
  it('turning does not jump: every point moves less than 2 per half degree', () => {
    let prev = evaluate(M, 0)
    for (let y = 0.5; y <= 90; y += 0.5) { const f = evaluate(M, y); for (const id of Object.keys(prev.points)) expect(dist(f.points[id]!, prev.points[id]!)).toBeLessThan(2); prev = f }
  })
  it('smoothAt passes through its keyframes', () => {
    expect(smoothAt([0, 45, 90], [1, 5, 2], 45)).toBeCloseTo(5, 12)
    expect(smoothAt([0, 45, 90], [1, 5, 2], 90)).toBeCloseTo(2, 12)
  })
})

describe('eyes', () => {
  it('0° gives bowen\'s 0° eye back (both eyes, mirrored)', () => {
    const f = evaluate(M, 0), base = M.eyes.base
    base.forEach((c, i) => { const n = f.eyes.near[i]!.pts, fr = f.eyes.far[i]!.pts
      for (let s = 0; s <= 30; s += 5) { const q = bez(c, s / 30); expect(dist(n[s]!, q)).toBeLessThan(0.05); expect(dist(fr[s]!, [-q[0], q[1]])).toBeLessThan(0.05) } })
  })
  it('the near eye widens first, then narrows (it turns to the camera first); the far eye only narrows', () => {
    const w = (y: number, far: boolean) => { const u = evaluate(M, y).eyes[far ? 'far' : 'near'][0]!.pts; return Math.abs(u[30]![0] - u[0]![0]) }
    expect(w(20, false)).toBeGreaterThan(w(0, false))
    expect(w(60, false)).toBeLessThan(w(20, false))
    for (let y = 10; y <= 60; y += 10) expect(w(y, true)).toBeLessThan(w(y - 10, true))
  })
  it('the far eye is no taller than the near one (近大远小)', () => {
    const h = (y: number, far: boolean) => { const ys = evaluate(M, y).eyes[far ? 'far' : 'near'].flatMap(l => l.pts.map(p => p[1])); return Math.max(...ys) - Math.min(...ys) }
    expect(h(45, true)).toBeLessThan(h(45, false))
  })
})

describe('ears', () => {
  it('the near ear points lie on the near outline at their heights, every angle', () => {
    for (let y = 0; y <= 90; y += 7.5) {
      const f = evaluate(M, y), p = params(M)
      expect(near(f.outline.find(l => l.name === 'nearSkull')!.c, f.points.nearEarUp!)).toBeLessThan(1e-3)
      expect(near(f.outline.find(l => l.name === 'nearJaw')!.c, f.points.nearEarLow!)).toBeLessThan(1e-3)
      expect(f.points.nearEarUp![1]).toBeCloseTo(p.earUp, 3); expect(f.points.nearEarLow![1]).toBeCloseTo(p.earLow, 3)
    }
  })
  it('at 90° the near ear is bowen\'s 90° ear on the outline (its shape exactly)', () => {
    const f = evaluate(M, 90), e = M.ear, [up, lo] = f.ears.near
    expect(dist(up!.c[3], [f.points.nearEarUp![0] + e.tip[0] - e.up[0], f.points.nearEarUp![1] + e.tip[1] - e.up[1]])).toBeLessThan(1e-9)
    expect(dist(up!.c[1], [up!.c[0][0] + e.upLine.ha[0], up!.c[0][1] + e.upLine.ha[1]])).toBeLessThan(1e-9)
    expect(dist(lo!.c[2], [lo!.c[3][0] + e.lowLine.hb[0], lo!.c[3][1] + e.lowLine.hb[1]])).toBeLessThan(1e-9)
  })
  it('the far ear at 0° is the near ear\'s mirror; it hangs on the 假线, which shares crown and chin', () => {
    const f = evaluate(M, 0)
    for (const k of ['EarUp', 'EarTip', 'EarLow']) { expect(f.points['far' + k]![0]).toBeCloseTo(-f.points['near' + k]![0], 6); expect(f.points['far' + k]![1]).toBeCloseTo(f.points['near' + k]![1], 6) }
    const g = evaluate(M, 40)
    expect(g.ears.fake[0]!.c[3]).toEqual(g.points.crown); expect(g.ears.fake[1]!.c[3]).toEqual(g.points.chin)
    expect(near(g.ears.fake[0]!.c, g.points.farEarUp!)).toBeLessThan(1e-3)
  })
  it('atHeight finds the crossing', () => {
    const c: Cubic = [[0, 0], [5, 3], [8, 7], [10, 10]]
    expect(atHeight(c, 4)[1]).toBeCloseTo(4, 6)
  })
})
