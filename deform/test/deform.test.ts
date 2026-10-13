// deform package 1 (docs/deform-p1-checklist.md): the port against a frozen copy of v103 (7205381) on random
// inputs, then the maths cases of v103's tests (drawing-deform, drawing-curved-deform, drawing-deform-kernel,
// drawing-curved-cage) and corner cases.
import { describe, it, expect } from 'vitest'
import * as D from '..'
import * as H from './v103/deformation/cageField'
import * as C from './v103/deformation/coons'
import * as F from './v103/deformation/cubicDeformation'
import type { Point2, Cubic as TCubic } from './v103/drawing/model'

const P = (x: number, y: number): D.Vec => ({ x, y })
const T = (p: D.Vec): Point2 => [p.x, p.y]
const O = (p: Point2): D.Vec => ({ x: p[0], y: p[1] })
/** A seeded generator, so a failure repeats. */
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 } }
/** Both throw, or both return; the value of each when they return. */
function both<A, B>(a: () => A, b: () => B): { a: A; b: B } | 'threw' {
  let ea: unknown, eb: unknown, ra: A | undefined, rb: B | undefined
  try { ra = a() } catch (e) { ea = e }
  try { rb = b() } catch (e) { eb = e }
  expect(!!ea).toBe(!!eb)
  if (ea) { expect(String(eb)).toBe(String(ea)); return 'threw' }
  return { a: ra!, b: rb! }
}
const close = (x: number, y: number, tol = 1e-9) => Math.abs(x - y) <= tol * Math.max(1, Math.abs(x), Math.abs(y))
const closeVec = (p: D.Vec, q: Point2) => close(p.x, q[0]) && close(p.y, q[1])

function randomCase(r: () => number) {
  const min = P(r() * 200 - 100, r() * 200 - 100), rect = { min, max: P(min.x + 10 + r() * 150, min.y + 10 + r() * 150) }
  const w = rect.max.x - rect.min.x, h = rect.max.y - rect.min.y, k = r() < 0.2 ? 0 : r() * 0.45
  const quad = D.rectQuad(rect).map(p => P(p.x + (r() - 0.5) * w * k, p.y + (r() - 0.5) * h * k)) as unknown as D.Quad
  const bend: D.Bend | undefined = r() < 0.25 ? undefined : { enabled: r() > 0.1, handles: D.neutralHandles().map(e => e.map(p => P(p.x + (r() - 0.5) * 0.5, p.y + (r() - 0.5) * 0.5))) as unknown as D.BendHandles }
  const inside = () => P(rect.min.x + r() * w, rect.min.y + r() * h)
  const cubic = [inside(), inside(), inside(), inside()] as unknown as D.Cubic
  return { rect, quad, bend, cubic }
}
const tRect = (r: D.Rect) => ({ min: T(r.min), max: T(r.max) })
const tBend = (b: D.Bend) => ({ enabled: b.enabled, handles: b.handles.map(e => e.map(T)) as unknown as C.BendHandles })

describe('the port equals v103 on random inputs (to 1e-9)', () => {
  it('300 cases: the homography, the composed field, the fitted cubic, its parameters and maxError; the same refusals', () => {
    const r = rng(1791891109)
    let compared = 0, refused = 0, fitted = 0
    for (let n = 0; n < 300; n++) {
      const { rect, quad, bend, cubic } = randomCase(r)
      const res = both(() => D.deformField(rect, quad, bend), () => H.drawingDeformProjection(tRect(rect), quad.map(T) as H.Quad, bend && tBend(bend)))
      if (res === 'threw') { refused++; continue }
      const { a: f, b: g } = res
      expect(f.affine).toBe(g.affine)
      for (let i = 0; i < 5; i++) {
        const p = P(rect.min.x + r() * (rect.max.x - rect.min.x), rect.min.y + r() * (rect.max.y - rect.min.y)), v = P(r() - 0.5, r() - 0.5)
        const m = both(() => f.map(p), () => g.map(T(p)))
        if (m !== 'threw') expect(closeVec(m.a, m.b)).toBe(true)
        const d = both(() => f.vector(p, v), () => g.vector(T(p), T(v)))
        if (d !== 'threw') expect(closeVec(d.a, d.b)).toBe(true)
        expect(close(f.denominator(p), g.denominator(T(p)))).toBe(true)
        compared++
      }
      const fit = both(() => D.fitDeformedCubic(cubic, f), () => F.fitDeformedCubic(cubic.map(T) as TCubic, g))
      if (fit === 'threw') continue
      fitted++
      fit.a.shape.forEach((p, i) => expect(closeVec(p, fit.b.shape[i]!)).toBe(true))
      expect(fit.a.parameters.values.length).toBe(fit.b.parameters.values.length)
      fit.a.parameters.values.forEach((t, i) => expect(close(t, fit.b.parameters.values[i]!)).toBe(true))
      expect(close(fit.a.maxError, fit.b.maxError)).toBe(true)
    }
    // the cases cover every branch: refusals, plain fields and fitted cubics
    expect([compared > 500, refused > 0, fitted > 150]).toEqual([true, true, true])
  })

  it('the bend alone: points, derivatives, inverse and the fold guard agree', () => {
    const r = rng(7)
    for (let n = 0; n < 100; n++) {
      const b: D.Bend = { enabled: true, handles: D.neutralHandles().map(e => e.map(p => P(p.x + (r() - 0.5) * 1.2, p.y + (r() - 0.5) * 1.2))) as unknown as D.BendHandles }
      both(() => D.assertBend(b), () => C.assertBend(tBend(b)))
      const p = P(r(), r()), v = P(r() - 0.5, r() - 0.5)
      expect(closeVec(D.bendPoint(b, p), C.bendPoint(tBend(b), T(p)))).toBe(true)
      expect(closeVec(D.bendVector(b, p, v), C.bendVector(tBend(b), T(p), T(v)))).toBe(true)
      const inv = both(() => D.inverseBend(b, p), () => C.inverseBend(tBend(b), T(p)))
      if (inv !== 'threw') expect(closeVec(inv.a, inv.b)).toBe(true)
    }
  })
})

describe('the maths (v103 cases)', () => {
  const rect = { min: P(0, 0), max: P(100, 50) }
  const quad: D.Quad = [P(-10, 5), P(120, -8), P(90, 70), P(15, 55)]

  it('the homography hits the four corners exactly; an affine quad is exact; crossing and flattening are refused', () => {
    const f = D.quadProjection(rect, quad)
    D.rectQuad(rect).forEach((c, i) => { const m = f.map(c); expect(Math.hypot(m.x - quad[i]!.x, m.y - quad[i]!.y)).toBeLessThan(1e-9) })
    const affine = D.quadProjection(rect, [P(0, 0), P(200, 0), P(200, 100), P(0, 100)])
    expect(affine.affine).toBe(true)
    expect(affine.map(P(30, 20))).toEqual(P(60, 40))
    expect(() => D.quadProjection(rect, [P(0, 0), P(100, 50), P(100, 0), P(0, 50)])).toThrow(/四角不能交叉或压扁/)
    expect(() => D.quadProjection(rect, [P(0, 0), P(50, 0), P(100, 0), P(0, 50)])).toThrow(/四角不能交叉或压扁/)
  })

  it('a point past the projective horizon is refused (v103 drawing-deform.test.ts:18, its frame and quad)', () => {
    const f = D.quadProjection({ min: P(-1, -1), max: P(1, 1) }, [P(-1, -1), P(1, -1), P(0.5, 1), P(-0.5, 1)])
    expect(() => f.map(P(0, -100))).toThrow(/四角不能交叉或压扁/)
  })

  it('a neutral or disabled bend gives the homography itself', () => {
    const plain = D.quadProjection(rect, quad), p = P(37, 21)
    expect(D.deformField(rect, quad, D.neutralBend()).map(p)).toEqual(plain.map(p))
    expect(D.deformField(rect, quad, { ...D.neutralBend(), enabled: false }).map(p)).toEqual(plain.map(p))
  })

  it('a curved field is the Coons bend followed by the homography; its derivative matches finite differences', () => {
    const handles = D.neutralHandles().map((e, i) => e.map(p => (i === 2 ? P(p.x, p.y + 0.15) : p))) as unknown as D.BendHandles
    const bend = { handles, enabled: true }, f = D.deformField(rect, quad, bend), plain = D.quadProjection(rect, quad)
    const p = P(40, 30), q = D.bendPoint(bend, P(0.4, 0.6))
    expect(f.map(p)).toEqual(plain.map(P(q.x * 100, q.y * 50)))
    const v = P(1, 0.5), h = 1e-6, a = f.map(p), b = f.map(P(p.x + v.x * h, p.y + v.y * h)), d = f.vector(p, v)
    expect(Math.hypot((b.x - a.x) / h - d.x, (b.y - a.y) / h - d.y)).toBeLessThan(1e-4)
  })

  it('one cubic per source: end points exact, tangent rays along the field\'s derivative, handles not point-mapped', () => {
    const f = D.deformField(rect, quad, { enabled: true, handles: D.neutralHandles().map((e, i) => e.map(p => (i === 0 ? P(p.x, p.y - 0.1) : p))) as unknown as D.BendHandles })
    const c: D.Cubic = [P(10, 10), P(30, 40), P(70, 5), P(90, 35)], { shape, maxError } = D.fitDeformedCubic(c, f)
    expect(shape[0]).toEqual(f.map(c[0])); expect(shape[3]).toEqual(f.map(c[3]))
    const ray = (h: D.Vec, end: D.Vec, dir: D.Vec) => { const u = P(h.x - end.x, h.y - end.y); return (u.x * dir.y - u.y * dir.x) / (Math.hypot(u.x, u.y) * Math.hypot(dir.x, dir.y)) }
    expect(Math.abs(ray(shape[1], shape[0], f.vector(c[0], P(c[1].x - c[0].x, c[1].y - c[0].y))))).toBeLessThan(1e-9)
    expect(Math.abs(ray(shape[2], shape[3], f.vector(c[3], P(c[2].x - c[3].x, c[2].y - c[3].y))))).toBeLessThan(1e-9)
    expect(shape[1]).not.toEqual(f.map(c[1]))
    // v103 drawing-curved-deform.test.ts:52 holds its fit under 0.02 in a frame of size 2 (1 %); the same share here
    expect(maxError).toBeGreaterThan(0); expect(maxError).toBeLessThan(0.01 * 100)
  })

  it('an affine field maps the control points exactly (the fast path)', () => {
    const f = D.quadProjection(rect, [P(10, 10), P(210, 10), P(210, 110), P(10, 110)]), c: D.Cubic = [P(0, 0), P(20, 40), P(60, 0), P(100, 50)]
    const { shape, maxError } = D.fitDeformedCubic(c, f)
    expect(shape).toEqual(c.map(f.map)); expect(maxError).toBeLessThan(1e-9)
  })

  it('a folded bend is refused, and so is one beyond ±8', () => {
    const fold = D.neutralHandles().map((e, i) => e.map(p => (i === 0 ? P(p.x, p.y + 1.5) : p))) as unknown as D.BendHandles
    expect(() => D.assertBend({ enabled: true, handles: fold })).toThrow(/折叠或压扁/)
    const far = D.neutralHandles().map((e, i) => e.map(p => (i === 1 ? P(9, p.y) : p))) as unknown as D.BendHandles
    expect(() => D.assertBend({ enabled: true, handles: far })).toThrow(/参数无效/)
  })

  it('moving both handles of an edge by 4/3 · d moves that edge\'s midpoint by d (the frame\'s midpoint drag)', () => {
    const d = P(0, 0.1), handles = D.neutralHandles().map((e, i) => e.map(p => (i === 2 ? P(p.x + d.x * 4 / 3, p.y + d.y * 4 / 3) : p))) as unknown as D.BendHandles
    const mid = (c: D.Cubic) => P((c[0].x + 3 * c[1].x + 3 * c[2].x + c[3].x) / 8, (c[0].y + 3 * c[1].y + 3 * c[2].y + c[3].y) / 8)
    const before = mid(D.bendEdges(D.neutralBend())[2]!), after = mid(D.bendEdges({ enabled: true, handles })[2]!)
    expect(after.x - before.x).toBeCloseTo(d.x, 12); expect(after.y - before.y).toBeCloseTo(d.y, 12)
  })
})

describe('corner cases', () => {
  const rect = { min: P(0, 0), max: P(100, 50) }, quad: D.Quad = [P(0, 0), P(110, 10), P(95, 60), P(5, 50)]
  it('a frame with no width or no height is refused', () => {
    expect(() => D.quadProjection({ min: P(0, 0), max: P(0, 50) }, quad)).toThrow(/四角不能交叉或压扁/)
    expect(() => D.quadProjection({ min: P(0, 0), max: P(100, 0) }, quad)).toThrow(/四角不能交叉或压扁/)
  })
  it('a cubic with a zero-length handle keeps it zero (no end tangent to define), finite, its other end exact', () => {
    const f = D.quadProjection(rect, quad), c: D.Cubic = [P(10, 10), P(10, 10), P(60, 40), P(90, 20)], { shape } = D.fitDeformedCubic(c, f)
    expect(shape.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
    expect(shape[0]).toEqual(f.map(c[0])); expect(shape[1]).toEqual(shape[0]); expect(shape[3]).toEqual(f.map(c[3]))
  })
  it('a non-finite frame, quad or cubic is refused (the frame beyond v103)', () => {
    const f = D.quadProjection(rect, quad)
    expect(() => D.quadProjection({ min: P(NaN, 0), max: P(100, 50) }, quad)).toThrow(/四角不能交叉或压扁/)
    expect(() => D.quadProjection({ min: P(0, 0), max: P(Infinity, 50) }, quad)).toThrow(/四角不能交叉或压扁/)
    expect(() => D.quadProjection(rect, [P(0, 0), P(110, NaN), P(95, 60), P(5, 50)])).toThrow(/四角不能交叉或压扁/)
    expect(() => f.map(P(NaN, 3))).toThrow(/四角不能交叉或压扁/)
    expect(() => D.fitDeformedCubic([P(10, 10), P(NaN, 10), P(60, 40), P(90, 20)], f)).toThrow()
  })
  it('a control point outside the frame is mapped as it is, not clamped into the frame', () => {
    const f = D.quadProjection(rect, quad), c: D.Cubic = [P(10, 10), P(-30, 80), P(140, -20), P(90, 20)]
    const affine = D.quadProjection(rect, [P(0, 0), P(200, 0), P(200, 100), P(0, 100)])
    expect(D.fitDeformedCubic(c, affine).shape[1]).toEqual(P(-60, 160))
    expect(D.fitDeformedCubic(c, f).shape.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
  })
  it('a reversed cubic fits to the reverse of the same curve (within the fit\'s error)', () => {
    const f = D.quadProjection(rect, quad), c: D.Cubic = [P(10, 10), P(30, 45), P(70, 5), P(90, 35)]
    const a = D.fitDeformedCubic(c, f).shape, b = D.fitDeformedCubic([c[3], c[2], c[1], c[0]], f).shape
    const at = (s: D.Cubic, t: number) => { const u = 1 - t; return P(u ** 3 * s[0].x + 3 * u * u * t * s[1].x + 3 * u * t * t * s[2].x + t ** 3 * s[3].x, u ** 3 * s[0].y + 3 * u * u * t * s[1].y + 3 * u * t * t * s[2].y + t ** 3 * s[3].y) }
    for (const t of [0, 0.25, 0.5, 0.75, 1]) { const p = at(a, t), q = at(b, 1 - t); expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeLessThan(0.05) }
  })
})
