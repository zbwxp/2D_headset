// The rough head (PLAN §2): a loft of horizontal superellipse sections from the crown to the chin. Each section at
// height y has half-width a, front f, back b (z values) and roundness n (front half; the back half is an ellipse).
// Surface parameters: u = angle round the section (0 = front, +90° = the x+ side, ±180° = back), y = section height.
import { type V3, cross, norm, sub } from './view'

export interface Knot { readonly y: number; readonly v: number }
export interface HeadShape {
  readonly a: readonly Knot[]
  readonly f: readonly Knot[]
  readonly b: readonly Knot[]
  readonly n: readonly Knot[]
  /** the lowest section (the chin bottom) and the highest (the crown) */
  readonly yMin: number
  readonly yMax: number
  /** height of a rounded cap closing the lowest sections (half-width scaled by √ of the height above the bottom); for a
   *  shape whose bottom is not already a rounded point (the default head's chin). Absent: no cap (a sphere stays one). */
  readonly cap?: number
}

/** Monotone cubic (Fritsch–Carlson) through knots sorted by y; flat outside. */
export function pchip(knots: readonly Knot[]): (y: number) => number {
  const k = [...knots].sort((p, q) => p.y - q.y), n = k.length
  const d = k.slice(0, -1).map((p, i) => (k[i + 1]!.v - p.v) / (k[i + 1]!.y - p.y))
  const m = k.map((_, i) => {
    if (i === 0) return d[0] ?? 0
    if (i === n - 1) return d[n - 2] ?? 0
    const d0 = d[i - 1]!, d1 = d[i]!
    if (d0 * d1 <= 0) return 0
    const h0 = k[i]!.y - k[i - 1]!.y, h1 = k[i + 1]!.y - k[i]!.y
    return (3 * (h0 + h1)) / ((2 * h1 + h0) / d0 + (h1 + 2 * h0) / d1)
  })
  return y => {
    if (y <= k[0]!.y) return k[0]!.v
    if (y >= k[n - 1]!.y) return k[n - 1]!.v
    let i = 0
    while (y > k[i + 1]!.y) i++
    const h = k[i + 1]!.y - k[i]!.y, t = (y - k[i]!.y) / h, t2 = t * t, t3 = t2 * t
    return (2 * t3 - 3 * t2 + 1) * k[i]!.v + (t3 - 2 * t2 + t) * h * m[i]! + (-2 * t3 + 3 * t2) * k[i + 1]!.v + (t3 - t2) * h * m[i + 1]!
  }
}

export interface Head {
  readonly shape: HeadShape
  /** section values at height y */
  section(y: number): { a: number; f: number; b: number; n: number; z0: number }
  /** surface point at (u in radians, y) */
  at(u: number, y: number): V3
  /** outward unit normal at (u, y) */
  normal(u: number, y: number): V3
}

const spow = (x: number, e: number) => Math.sign(x) * Math.abs(x) ** e
/** height of the rounded cap at the chin bottom, head units */
export const CAP = 0.06

export function makeHead(shape: HeadShape): Head {
  const A = pchip(shape.a), F = pchip(shape.f), B = pchip(shape.b), N = pchip(shape.n)
  // the lowest sections close as a rounded cap (half-width ∝ √ of the height above the bottom), not a cone point whose
  // normals are undefined; the same at the crown
  const cap = (y: number) => (shape.cap ? Math.sqrt(Math.min(1, Math.max(0, (y - shape.yMin) / shape.cap))) : 1)
  const section = (y: number) => {
    const a = Math.max(0, A(y)) * cap(y), f = F(y), b = Math.min(B(y), f), n = Math.max(1.2, N(y))
    // the widest point's depth; kept between back and front so the section stays convex
    const z0 = Math.min(Math.max(0, b), f)
    return { a, f, b, n, z0 }
  }
  const at = (u: number, y: number): V3 => {
    const s = section(y), su = Math.sin(u), cu = Math.cos(u)
    const front = cu >= 0, e = 2 / (front ? s.n : 2)
    const x = s.a * spow(su, e)
    const z = front ? s.z0 + (s.f - s.z0) * Math.abs(cu) ** e : s.z0 - (s.z0 - s.b) * Math.abs(cu) ** e
    return [x, y, z]
  }
  const normal = (u: number, y: number): V3 => {
    const h = 1e-4, span = shape.yMax - shape.yMin
    const yy = Math.min(shape.yMax - 2 * h * span, Math.max(shape.yMin + 2 * h * span, y))
    const pu = sub(at(u + h, yy), at(u - h, yy)), py = sub(at(u, yy + h * span), at(u, yy - h * span))
    // pu points along +x at the front, py along +y: (pu × py) points out of the face (+z)
    return norm(cross(pu, py))
  }
  return { shape, section, at, normal }
}

// ---- the default character: level row of the generated sheet (round 5, mouth fixed) ----------------------------------
// Measured in that sheet's pixels (origin: midpoint between the irises, y up, z = depth toward the viewer read off the
// 90° cell), then put in head space: head ball centre (0, 40, −120), radius 155 → unit 1. A hypothesis (dot 1792487307).
export const BALL = { c: [0, 40, -120] as V3, r: 155 }
export const toHead = (p: V3): V3 => [p[0] / BALL.r, (p[1] - BALL.c[1]) / BALL.r, (p[2] - BALL.c[2]) / BALL.r]
const Y = (y: number) => (y - BALL.c[1]) / BALL.r, Z = (z: number) => (z - BALL.c[2]) / BALL.r, X = (x: number) => x / BALL.r
const ball = (ys: number[]) => ys.map(y => ({ y, v: Math.sqrt(Math.max(0, 1 - y * y)) }))

export const CHIN_Y = Y(-161)

export const defaultShape: HeadShape = {
  cap: CAP,
  yMin: CHIN_Y,
  yMax: 1,
  // half-width: the ball above the cheeks; below, the front cell's outline (ear–jaw junction, jaw, chin)
  a: [...ball([1, 0.9, 0.7, 0.5, 0.3, 0, -0.3]), { y: Y(-44), v: X(129) }, { y: Y(-68.5), v: X(121) }, { y: Y(-106), v: X(96) },
    { y: Y(-131), v: X(71) }, { y: CHIN_Y, v: X(8) }],
  // front: the ball over the crown; below, the 90° cell's profile without the nose (forehead → nose root → philtrum →
  // lips → chin)
  f: [...ball([1, 0.9, 0.7, 0.5]), { y: Y(84), v: Z(30) }, { y: Y(40), v: Z(34.5) }, { y: Y(16), v: Z(33) }, { y: Y(-11), v: Z(35) },
    { y: Y(-58), v: Z(40) }, { y: Y(-81), v: Z(44) }, { y: Y(-100), v: Z(32) }, { y: Y(-122), v: Z(26) }, { y: Y(-148), v: Z(8) },
    { y: CHIN_Y, v: Z(-3) }],
  // back: the ball down to the ear; below, it comes forward to the jaw angle and the under-jaw line to the chin
  b: [...ball([1, 0.9, 0.5, 0, -0.5]).map(k => ({ y: k.y, v: -k.v })), { y: -0.7, v: -0.55 }, { y: -0.85, v: -0.25 },
    { y: Y(-101), v: Z(-130) }, { y: Y(-136), v: Z(-91) }, { y: Y(-148), v: Z(-63) }, { y: CHIN_Y, v: Z(-3) }],
  // roundness of the front half: 2 = ellipse; a little squarer through the cheeks
  n: [{ y: 1, v: 2 }, { y: 0, v: 2 }, { y: -0.4, v: 2.3 }, { y: -0.7, v: 2.6 }, { y: -1, v: 2.3 }, { y: CHIN_Y, v: 2 }],
}

export const NECK = { c: [0, Z(-145)] as const, rx: X(62), rz: 68 / BALL.r, top: Y(-100), bottom: Y(-260) }
