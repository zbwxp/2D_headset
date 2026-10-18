// Bone coordinates (docs/bone-lines-checklist.md §2): identity when the bone does not move, exact under a move / turn /
// uniform scale of the bone, points past the ends kept, the band on both sides of the bone kept, refusals.
import { describe, it, expect } from 'vitest'
import { boneFrame, toBone, fromBone, boneMap, boneLine, BoneError, type Cubic, type Vec } from '../src/bones/coords'
import { readFileSync } from 'node:fs'

const P = (x: number, y: number): Vec => ({ x, y })
const near = (a: Vec, b: Vec, eps = 1e-9) => Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps
const at = (c: Cubic, t: number): Vec => { const u = 1 - t; return P(u * u * u * c[0].x + 3 * u * u * t * c[1].x + 3 * u * t * t * c[2].x + t * t * t * c[3].x, u * u * u * c[0].y + 3 * u * u * t * c[1].y + 3 * u * t * t * c[2].y + t * t * t * c[3].y) }
// a similarity: turn by `a`, scale by `k`, then move by `d`
const sim = (a: number, k: number, d: Vec) => (p: Vec) => P(k * (Math.cos(a) * p.x - Math.sin(a) * p.y) + d.x, k * (Math.sin(a) * p.x + Math.cos(a) * p.y) + d.y)
const bone: Cubic = [P(0, 0), P(10, -8), P(30, -8), P(40, 0)]
const probes: Vec[] = [P(5, 2), P(20, -9), P(20, -3), P(35, 1), P(-4, 1), P(44, -2), P(-3, -6), P(46, 5), P(20, -12)]
const err = (f: () => unknown) => { try { f(); return undefined } catch (e) { return e } }
/** The largest distance from a point of `a` to the curve `b` (each sample projected onto `b` by Newton steps) — not to `b`'s samples, whose spacing would set a floor. */
const shapeDistance = (a: Cubic, b: Cubic) => {
  const d1 = (c: Cubic, t: number) => { const u = 1 - t; return P(3 * u * u * (c[1].x - c[0].x) + 6 * u * t * (c[2].x - c[1].x) + 3 * t * t * (c[3].x - c[2].x), 3 * u * u * (c[1].y - c[0].y) + 6 * u * t * (c[2].y - c[1].y) + 3 * t * t * (c[3].y - c[2].y)) }
  let worst = 0
  for (let i = 0; i <= 200; i++) {
    const p = at(a, i / 200)
    let t = 0, best = Infinity
    for (let k = 0; k <= 200; k++) { const d = Math.hypot(at(b, k / 200).x - p.x, at(b, k / 200).y - p.y); if (d < best) { best = d; t = k / 200 } }
    for (let k = 0; k < 20; k++) { const q = at(b, t), d = d1(b, t), g = (q.x - p.x) * d.x + (q.y - p.y) * d.y, h = d.x * d.x + d.y * d.y; if (h < 1e-18) break; t = Math.max(0, Math.min(1, t - g / h)) }
    worst = Math.max(worst, Math.min(best, Math.hypot(at(b, t).x - p.x, at(b, t).y - p.y)))
  }
  return worst
}

describe('bone coordinates', () => {
  it('the bone not moved: every point maps to itself, past the ends included', () => {
    const m = boneMap(bone, bone)
    for (const p of probes) expect(near(m(p), p)).toBe(true)
  })

  it('a moved, turned, uniformly scaled bone carries every point by the same similarity', () => {
    for (const [a, k, d] of [[0.7, 1, P(3, -5)], [-1.2, 1.5, P(-10, 4)], [0.3, 0.4, P(0, 0)]] as const) {
      const T = sim(a, k, d), moved = bone.map(T) as unknown as Cubic, m = boneMap(bone, moved)
      for (const p of probes) expect(near(m(p), T(p), 1e-9)).toBe(true)
    }
  })

  it('distances from the bone scale with its length; the fraction along it is kept', () => {
    // the same bone stretched to twice its length by a non-uniform change of shape
    const long: Cubic = [P(0, 0), P(20, -16), P(60, -16), P(80, 0)]
    const from = boneFrame(bone), to = boneFrame(long), ratio = to.length / from.length
    for (const p of [P(20, -3), P(20, -12)]) {
      const c = toBone(from, p), q = boneMap(bone, long)(p), back = toBone(to, q)
      expect(back.s).toBeCloseTo(c.s, 9)
      expect(back.off).toBeCloseTo(c.off * ratio, 9)
    }
  })

  it('a band drawn on both sides of the bone stays on both sides after the bone bends (bowen 1792295122)', () => {
    const above = P(20, -9), below = P(20, -3), bent: Cubic = [P(0, 0), P(10, -14), P(30, -14), P(40, 0)]
    const m = boneMap(bone, bent), f = boneFrame(bent)
    expect(Math.sign(toBone(f, m(above)).off)).toBe(Math.sign(toBone(boneFrame(bone), above).off))
    expect(Math.sign(toBone(f, m(below)).off)).toBe(Math.sign(toBone(boneFrame(bone), below).off))
  })

  it('refuses: a bone too short, non-finite input, an ambiguous point at the centre of a tight bend, a bad width factor', () => {
    expect((err(() => boneFrame([P(1, 1), P(1, 1), P(1, 1), P(1.0001, 1)])) as BoneError).code).toBe('bone-too-short')
    expect((err(() => boneFrame([P(0, 0), P(NaN, 0), P(1, 0), P(2, 0)])) as BoneError).code).toBe('bone-not-finite')
    expect((err(() => toBone(boneFrame(bone), P(Infinity, 0))) as BoneError).code).toBe('bone-not-finite')
    // a symmetric arch: its centre point is equally near both legs
    const arch: Cubic = [P(-10, 0), P(-10, -27), P(10, -27), P(10, 0)]
    expect((err(() => toBone(boneFrame(arch), P(0, 0))) as BoneError).code).toBe('bone-ambiguous')
    expect((err(() => boneMap(bone, bone, 0)) as BoneError).code).toBe('bone-not-finite')
  })
})

describe('a line carried by its bone', () => {
  const line: Cubic = [P(2, -1), P(12, -10), P(28, -10), P(38, -1)]

  it('the bone not moved: the line comes back as it was (the fit, not bit-equal — the caller skips it)', () => {
    const r = boneLine(line, bone, bone)
    for (let i = 0; i <= 16; i++) expect(near(at(r.shape, i / 16), at(line, i / 16), 1e-3)).toBe(true)
  })

  it('a moved, turned, scaled bone: the line follows by the same similarity', () => {
    const T = sim(0.5, 1.3, P(7, 2)), r = boneLine(line, bone, bone.map(T) as unknown as Cubic)
    for (let i = 0; i <= 16; i++) expect(near(at(r.shape, i / 16), T(at(line, i / 16)), 1e-3)).toBe(true)
    expect(r.maxError).toBeLessThan(1e-3)
  })

  it('an end owned by another bone lands exactly on its target', () => {
    const r = boneLine(line, bone, bone, { b: P(39, 0.5) })
    expect(near(r.shape[3], P(39, 0.5), 1e-12)).toBe(true)
    expect(near(r.shape[0], line[0], 1e-9)).toBe(true)
  })
})

describe('标准tmp (bowen 165.json left eye, a test fixture only)', () => {
  const eye = JSON.parse(readFileSync(new URL('./fixtures/eye-standard-tmp.json', import.meta.url), 'utf8'))
  const lineIn = (v: string, name: string): Cubic => {
    const l = eye.lines.find((x: { name: string }) => x.name === name), V = eye.views[v], a = P(...(V.points[l.a] as [number, number])), b = P(...(V.points[l.b] as [number, number])), h = V.handles[l.id]
    return [a, P(a.x + h.ha[0], a.y + h.ha[1]), P(b.x + h.hb[0], b.y + h.hb[1]), b]
  }
  it('the upper lid line carried by its own shape as the bone, in every view: it follows that view\'s drawing', () => {
    // the drawn top lid line as its own bone: carried, it must land on itself in every view
    for (const v of Object.keys(eye.views)) {
      const r = boneLine(lineIn('view:0,0', '上眼睑上'), lineIn('view:0,0', '上眼睑上'), lineIn(v, '上眼睑上'))
      // compared as shapes (the fit may run along the curve at another speed): both ways, point to curve
      expect(Math.max(shapeDistance(r.shape, lineIn(v, '上眼睑上')), shapeDistance(lineIn(v, '上眼睑上'), r.shape))).toBeLessThan(0.02)
    }
  })
})

describe('dot 1792299449', () => {
  it('a straight bone with zero end handles maps like the same bone with handles at a third: the end direction is not reversed', () => {
    const zero: Cubic = [P(0, 0), P(0, 0), P(100, 0), P(100, 0)], thirds: Cubic = [P(0, 0), P(100 / 3, 0), P(200 / 3, 0), P(100, 0)]
    const m = boneMap(zero, thirds)
    for (const p of [P(100, 5), P(110, 5), P(-10, 5), P(50, 5), P(0, -3)]) expect(near(m(p), p, 1e-6)).toBe(true)
    expect(near(boneMap(thirds, zero)(P(110, 5)), P(110, 5), 1e-6)).toBe(true)
  })
  it('a fit that loops out between its samples is not reported as good: the error is measured both ways', () => {
    // a line across the end of a zero-handle straight bone, carried onto the thirds bone (the identity): any fit must
    // come back near the line itself, and whatever error it reports must cover the whole fitted curve
    const zero: Cubic = [P(0, 0), P(0, 0), P(100, 0), P(100, 0)], thirds: Cubic = [P(0, 0), P(100 / 3, 0), P(200 / 3, 0), P(100, 0)]
    const line: Cubic = [P(90, 5), P(95, 5), P(105, 5), P(110, 5)]
    const r = boneLine(line, zero, thirds)
    expect(Math.max(...r.shape.map(p => Math.abs(p.x)))).toBeLessThan(200)
    expect(Math.max(shapeDistance(r.shape, line), shapeDistance(line, r.shape))).toBeLessThanOrEqual(Math.max(r.maxError, 1e-3) + 1e-9)
  })
})

describe('dot 1792299544', () => {
  it('a self-crossing bone: the crossing point is equally near two parts of it — ambiguous, refused', () => {
    const b: Cubic = [P(0, 0), P(136.4102564102564, 176.9230769230769), P(-20, 100), P(100, 0)], f = boneFrame(b)
    expect((err(() => toBone(f, at(b, 0.2))) as BoneError).code).toBe('bone-ambiguous')
  })
})

describe('dot 1792299571: a fit with ordinary handles that loops far off the carried curve', () => {
  it('is reported with an error that covers the loop (so the derivation refuses it as bone-fit)', () => {
    const base: Cubic = [P(0, 0), P(100 / 3, 0), P(200 / 3, 0), P(100, 0)]
    const line: Cubic = [P(3, -21), P(3 + 104 / 3, -21), P(3 + 208 / 3, -21), P(107, -21)]
    const bone: Cubic = [P(0, 0), P(-78, 145), P(47, -85), P(60, -53)]
    const r = boneLine(line, base, bone)
    // the carried curve, densely: the fitted cubic's farthest point from it must not exceed the reported error
    const m = boneMap(base, bone), carried = Array.from({ length: 2001 }, (_, i) => m(at(line, i / 2000)))
    let far = 0
    for (let k = 0; k <= 400; k++) { const q = at(r.shape, k / 400); far = Math.max(far, Math.min(...carried.map(c => Math.hypot(c.x - q.x, c.y - q.y)))) }
    expect(far).toBeLessThanOrEqual(r.maxError + 0.05)
    expect(r.maxError).toBeGreaterThan(2.08) // above the line's fit limit (2 % of its 104 length; the bone is 100)
  })
})

describe('ordinary lines are not refused (dot 1792299544)', () => {
  it('标准tmp: every line of the upper lid, lash and crease on the upper bone (the lid band\'s fitted middle), in every view: a fit within its limit', () => {
    const eye = JSON.parse(readFileSync(new URL('./fixtures/eye-standard-tmp.json', import.meta.url), 'utf8'))
    const lineIn = (v: string, name: string): Cubic => { const l = eye.lines.find((x: { name: string }) => x.name === name), V = eye.views[v], a = P(...(V.points[l.a] as [number, number])), b = P(...(V.points[l.b] as [number, number])), h = V.handles[l.id]; return [a, P(a.x + h.ha[0], a.y + h.ha[1]), P(b.x + h.hb[0], b.y + h.hb[1]), b] }
    const atLen = (c: Cubic, s: number) => { const n = 400, pts = Array.from({ length: n + 1 }, (_, i) => at(c, i / n)), L = [0]; for (let i = 1; i <= n; i++) L.push(L[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y)); const w = s * L[n]!, i = L.findIndex(l => l >= w); if (i <= 0) return pts[0]!; const t = (w - L[i - 1]!) / (L[i]! - L[i - 1]!); return P(pts[i - 1]!.x + (pts[i]!.x - pts[i - 1]!.x) * t, pts[i - 1]!.y + (pts[i]!.y - pts[i - 1]!.y) * t) }
    // the experiments' upper bone: midpoints of the band by fraction of length, one cubic with fixed ends by least squares
    const fixedFit = (A0: Vec, A3: Vec, ps: Vec[]): Cubic => {
      const L = [0]; for (let i = 1; i < ps.length; i++) L.push(L[i - 1]! + Math.hypot(ps[i]!.x - ps[i - 1]!.x, ps[i]!.y - ps[i - 1]!.y))
      let c11 = 0, c12 = 0, c22 = 0, x1 = P(0, 0), x2 = P(0, 0)
      L.map(l => l / L[L.length - 1]!).forEach((u, i) => { const b0 = (1 - u) ** 3, b1 = 3 * u * (1 - u) ** 2, b2 = 3 * u * u * (1 - u), b3 = u ** 3, r = P(ps[i]!.x - A0.x * b0 - A3.x * b3, ps[i]!.y - A0.y * b0 - A3.y * b3); c11 += b1 * b1; c12 += b1 * b2; c22 += b2 * b2; x1 = P(x1.x + r.x * b1, x1.y + r.y * b1); x2 = P(x2.x + r.x * b2, x2.y + r.y * b2) })
      const det = c11 * c22 - c12 * c12
      return [A0, P((x1.x * c22 - x2.x * c12) / det, (x1.y * c22 - x2.y * c12) / det), P((x2.x * c11 - x1.x * c12) / det, (x2.y * c11 - x1.y * c12) / det), A3]
    }
    const bone = (v: string): Cubic => { const up = lineIn(v, '上眼睑上'), lo = lineIn(v, '上眼睑下'), e = P((up[3].x + lo[0].x) / 2, (up[3].y + lo[0].y) / 2); return fixedFit(up[0], e, [up[0], ...Array.from({ length: 39 }, (_, i) => { const s = (i + 1) / 40, p = atLen(up, s), q = atLen(lo, 1 - s); return P((p.x + q.x) / 2, (p.y + q.y) / 2) }), e]) }
    const length = (c: Cubic) => { let L = 0; for (let i = 1; i <= 32; i++) { const p = at(c, (i - 1) / 32), q = at(c, i / 32); L += Math.hypot(q.x - p.x, q.y - p.y) } return L }
    // the lower lid (底眼睑) belongs to the lower bone, not this one
    for (const name of eye.lines.map((l: { name: string }) => l.name).filter((n: string) => n !== '底眼睑')) for (const v of Object.keys(eye.views)) {
      const base = lineIn('view:0,0', name), r = boneLine(base, bone('view:0,0'), bone(v))
      expect([name, v, r.maxError <= 0.02 * Math.max(length(base), length(bone('view:0,0')))]).toEqual([name, v, true])
    }
  })
})

describe('a tight hook (标准tmp 上眼睑上 at 90,45: chord ≈ 9, handles ≈ 11 and 17)', () => {
  it('the 0,0 lid lifted by 1 / 3, carried onto the hook: the fit reaches the best single cubic (a brute-force search over the two lengths: 0.20 / 0.60), not a loop', () => {
    const eye = JSON.parse(readFileSync(new URL('./fixtures/eye-standard-tmp.json', import.meta.url), 'utf8'))
    const top = eye.lines.find((l: { name: string }) => l.name === '上眼睑上')
    const cub = (v: string): Cubic => { const V = eye.views[v], a = P(...(V.points[top.a] as [number, number])), b = P(...(V.points[top.b] as [number, number])), h = V.handles[top.id]; return [a, P(a.x + h.ha[0], a.y + h.ha[1]), P(b.x + h.hb[0], b.y + h.hb[1]), b] }
    const s0 = cub('view:0,0'), sv = cub('view:90,45')
    for (const [k, best] of [[1, 0.202], [3, 0.602]] as const) {
      const now: Cubic = [s0[0], P(s0[1].x, s0[1].y - k), P(s0[2].x, s0[2].y - k), s0[3]]
      // with the refusal limit (2 % of the 0,0 bone, as the derivation passes it): searched again; without: as before
      expect(boneLine(now, s0, sv, {}, 1, 0.77).maxError).toBeLessThan(best + 0.02)
      expect(boneLine(now, s0, sv).maxError).toBeGreaterThan(1)
    }
  })
})
