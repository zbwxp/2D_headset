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

/** Circle-like cubic from p0 to p3 that bends around the corner vertex. */
export function cornerArc(p0: Vec, vertex: Vec, p3: Vec): Cubic {
  const k = 0.5522847498307936
  return [p0, lerp(p0, vertex, k), lerp(p3, vertex, k), p3]
}
