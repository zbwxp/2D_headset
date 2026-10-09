// geometry — cubic Bézier maths. No state. Arc length comes from bezier-js (MIT).
import { Bezier } from 'bezier-js'

export interface Vec { readonly x: number; readonly y: number }
/** Absolute control points: start, handle out, handle in, end. */
export type Cubic = readonly [Vec, Vec, Vec, Vec]

export const vec = (x: number, y: number): Vec => ({ x, y })
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y })
export const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k })
export const length = (a: Vec): number => Math.hypot(a.x, a.y)
export const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
export const angleOf = (a: Vec): number => Math.atan2(a.y, a.x)
export const fromAngle = (angle: number, len: number): Vec => ({ x: Math.cos(angle) * len, y: Math.sin(angle) * len })

export function evaluate(c: Cubic, t: number): Vec {
  const [p0, p1, p2, p3] = c
  const a = lerp(p0, p1, t), b = lerp(p1, p2, t), d = lerp(p2, p3, t)
  return lerp(lerp(a, b, t), lerp(b, d, t), t)
}

/** de Casteljau split at t. */
export function split(c: Cubic, t: number): [Cubic, Cubic] {
  const [p0, p1, p2, p3] = c
  const a = lerp(p0, p1, t), b = lerp(p1, p2, t), d = lerp(p2, p3, t)
  const e = lerp(a, b, t), f = lerp(b, d, t), m = lerp(e, f, t)
  return [[p0, a, e, m], [m, f, d, p3]]
}

/** The part of c between parameters t0 < t1. */
export function subCurve(c: Cubic, t0: number, t1: number): Cubic {
  if (t0 <= 0 && t1 >= 1) return c
  const right = t0 > 0 ? split(c, t0)[1] : c
  if (t1 >= 1) return right
  return split(right, (t1 - t0) / (1 - t0))[0]
}

export function arcLength(c: Cubic): number {
  const [p0, p1, p2, p3] = c
  return new Bezier(p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y).length()
}

/** Parameter t where the arc length from the start equals s (clamped). */
export function tAtLength(c: Cubic, s: number): number {
  const total = arcLength(c)
  if (s <= 0) return 0
  if (s >= total) return 1
  let lo = 0, hi = 1
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (arcLength(split(c, mid)[0]) < s) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

export function flatten(c: Cubic, segments = 16): Vec[] {
  const out: Vec[] = []
  for (let i = 0; i <= segments; i++) out.push(evaluate(c, i / segments))
  return out
}

/** Signed area (positive = counter-clockwise in y-up coordinates). */
export function polygonArea(poly: readonly Vec[]): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!
    s += a.x * b.y - b.x * a.y
  }
  return s / 2
}

/** Even-odd containment. */
export function pointInPolygon(p: Vec, poly: readonly Vec[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** First derivative of the curve at t. */
export function derivative(c: Cubic, t: number): Vec {
  const [p0, p1, p2, p3] = c, u = 1 - t
  const a = scale(sub(p1, p0), 3 * u * u), b = scale(sub(p2, p1), 6 * u * t), d = scale(sub(p3, p2), 3 * t * t)
  return add(add(a, b), d)
}

export function normalize(v: Vec): Vec {
  const l = length(v)
  return l > 0 ? { x: v.x / l, y: v.y / l } : { x: 0, y: 0 }
}

/**
 * Arc from p0 to p3, tangent to `into` at p0 (direction of travel arriving at p0)
 * and to `out` at p3 (direction of travel leaving p3). For a symmetric corner this
 * is the standard cubic approximation of a circular arc: handle length
 * (4/3)·tan(θ/4)·R, with θ the turn angle and R = chord / (2·sin(θ/2)).
 */
export function filletArc(p0: Vec, into: Vec, p3: Vec, out: Vec): Cubic {
  const t0 = normalize(into), t3 = normalize(out)
  const turn = Math.acos(Math.max(-1, Math.min(1, t0.x * t3.x + t0.y * t3.y)))
  const chord = length(sub(p3, p0))
  if (chord < 1e-12) return [p0, p0, p3, p3]
  // Parallel tangents (no turn): keep both ends tangent; the handle length is the θ → 0 limit, chord / 3 (dot 1791428573).
  if (turn < 1e-9) return [p0, add(p0, scale(t0, chord / 3)), sub(p3, scale(t3, chord / 3)), p3]
  const radius = chord / (2 * Math.sin(turn / 2))
  const h = (4 / 3) * Math.tan(turn / 4) * radius
  return [p0, add(p0, scale(t0, h)), sub(p3, scale(t3, h)), p3]
}

/** Exact axis-aligned bounds of a cubic: its end points and the extremes where the derivative is zero. */
export function bounds(c: Cubic): { min: Vec; max: Vec } {
  const ts = [0, 1]
  for (const k of ['x', 'y'] as const) {
    // derivative / 3 = a t² + b t + d, from the control points along one axis
    const p0 = c[0][k], p1 = c[1][k], p2 = c[2][k], p3 = c[3][k]
    const a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), d = p1 - p0
    if (Math.abs(a) < 1e-12) { if (Math.abs(b) > 1e-12) ts.push(-d / b) }
    else {
      const disc = b * b - 4 * a * d
      if (disc >= 0) { const r = Math.sqrt(disc); ts.push((-b + r) / (2 * a), (-b - r) / (2 * a)) }
    }
  }
  const pts = ts.filter(t => t >= 0 && t <= 1).map(t => evaluate(c, t))
  return {
    min: { x: Math.min(...pts.map(p => p.x)), y: Math.min(...pts.map(p => p.y)) },
    max: { x: Math.max(...pts.map(p => p.x)), y: Math.max(...pts.map(p => p.y)) },
  }
}

/** Value of a polynomial (coefficients from the highest power down) at t. */
function poly(cs: readonly number[], t: number): number { let v = 0; for (const k of cs) v = v * t + k; return v }

/**
 * Every real root of a polynomial in [0, 1] (coefficients from the highest power down).
 * The derivative's roots split [0, 1] into stretches where the polynomial only rises or
 * only falls; each stretch with a sign change holds exactly one root, found by bisection.
 * No sampling, so two roots close together are never merged (dot 1791544487).
 */
export function rootsIn01(cs: readonly number[]): number[] {
  const scale = Math.max(...cs.map(Math.abs))
  if (!(scale > 0)) return []
  let k = 0
  while (k < cs.length - 1 && Math.abs(cs[k]!) <= scale * 1e-15) k++
  const c = cs.slice(k), n = c.length - 1
  if (n <= 0) return []
  if (n === 1) { const t = -c[1]! / c[0]!; return t >= 0 && t <= 1 ? [t] : [] }
  const d = c.slice(0, n).map((x, i) => x * (n - i))
  const stops = [0, ...rootsIn01(d), 1]
  const out: number[] = []
  for (let i = 0; i + 1 < stops.length; i++) {
    let lo = stops[i]!, hi = stops[i + 1]!
    const flo = poly(c, lo), fhi = poly(c, hi)
    if (flo === 0) { out.push(lo); continue }
    if (flo * fhi > 0) continue
    for (let it = 0; it < 80 && hi - lo > 1e-16; it++) {
      const m = (lo + hi) / 2, fm = poly(c, m)
      if ((fm < 0) === (flo < 0)) lo = m; else hi = m
    }
    out.push((lo + hi) / 2)
  }
  if (poly(c, 1) === 0) out.push(1)
  return out
}

/**
 * The parameter and distance of the point on `c` nearest to `p`. The candidates are the two
 * ends and every root of (B(t) − p)·B′(t), a quintic, found exactly in [0, 1]: no sampled
 * guess, so a narrow branch next to another one is never missed (dot 1791543988, 1791544487).
 */
export function nearest(c: Cubic, p: Vec): { t: number; distance: number } {
  const [P0, P1, P2, P3] = c
  const A = { x: -P0.x + 3 * P1.x - 3 * P2.x + P3.x, y: -P0.y + 3 * P1.y - 3 * P2.y + P3.y }
  const B = { x: 3 * P0.x - 6 * P1.x + 3 * P2.x, y: 3 * P0.y - 6 * P1.y + 3 * P2.y }
  const C = { x: -3 * P0.x + 3 * P1.x, y: -3 * P0.y + 3 * P1.y }
  const E = { x: P0.x - p.x, y: P0.y - p.y }
  const dot = (u: Vec, v: Vec) => u.x * v.x + u.y * v.y
  // (A t³ + B t² + C t + E) · (3A t² + 2B t + C)
  const roots = rootsIn01([3 * dot(A, A), 5 * dot(A, B), 4 * dot(A, C) + 2 * dot(B, B), 3 * dot(B, C) + 3 * dot(A, E), dot(C, C) + 2 * dot(B, E), dot(C, E)])
  let best = { t: 0, distance: length(sub(evaluate(c, 0), p)) }
  for (const t of [...roots, 1]) { const distance = length(sub(evaluate(c, t), p)); if (distance < best.distance) best = { t, distance } }
  return best
}
