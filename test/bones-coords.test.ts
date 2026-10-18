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
