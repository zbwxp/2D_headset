// bones/coords — the maths of 绑骨 (docs/bone-lines-checklist.md §2): a line attached to a bone follows it by bone
// coordinates. A point is stored as (fraction of the bone's length, distance along the bone's tangent there,
// distance along its normal there); in another view it is placed at the same fraction of that view's bone,
// with both distances scaled by the bones' length ratio (bowen 1792251439: correspondence by fraction of length;
// 1792295122 / 1792295715: the band stays on both sides of the bone). Past a bone end the bone runs on straight
// along its end tangent (dot 1792296347), so the tangential distance carries the rest. Plain maths on plain
// data; no imports. Every public function refuses non-finite input and output.

export interface Vec { readonly x: number; readonly y: number }
export type Cubic = readonly [Vec, Vec, Vec, Vec]

const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y })
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y })
const mul = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s })
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y
const len = (a: Vec) => Math.hypot(a.x, a.y)
const point = (c: Cubic, t: number): Vec => { const u = 1 - t, a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t; return { x: a * c[0].x + b * c[1].x + d * c[2].x + e * c[3].x, y: a * c[0].y + b * c[1].y + d * c[2].y + e * c[3].y } }

/** Why a derivation is refused (the caller turns it into a Refusal naming the bone or the line). */
export class BoneError extends Error {
  constructor(readonly code: 'bone-not-finite' | 'bone-too-short' | 'bone-ambiguous', message: string) { super(message) }
}
const finite = (p: Vec, what: string): Vec => { if (!(p && Number.isFinite(p.x) && Number.isFinite(p.y))) throw new BoneError('bone-not-finite', `${what} is not a finite point`); return p }

/** Samples of the arc-length table; the curve itself is used for points and directions (so the map is smooth). */
const SAMPLES = 512
/** A bone shorter than this (drawing units) cannot carry lines (checklist §2: refused, never a NaN). */
export const MIN_BONE_LENGTH = 1e-3

const deriv = (c: Cubic, t: number): Vec => {
  const u = 1 - t
  return { x: 3 * u * u * (c[1].x - c[0].x) + 6 * u * t * (c[2].x - c[1].x) + 3 * t * t * (c[3].x - c[2].x), y: 3 * u * u * (c[1].y - c[0].y) + 6 * u * t * (c[2].y - c[1].y) + 3 * t * t * (c[3].y - c[2].y) }
}
const deriv2 = (c: Cubic, t: number): Vec => {
  const u = 1 - t
  return { x: 6 * u * (c[2].x - 2 * c[1].x + c[0].x) + 6 * t * (c[3].x - 2 * c[2].x + c[1].x), y: 6 * u * (c[2].y - 2 * c[1].y + c[0].y) + 6 * t * (c[3].y - 2 * c[2].y + c[1].y) }
}

/** A bone and its arc-length table: the frame bone coordinates are measured in. */
export interface BoneFrame {
  readonly bone: Cubic
  /** Curve parameter and cumulative length at each sample (both increasing). */
  readonly ts: readonly number[]
  readonly at: readonly number[]
  readonly length: number
}

/** The frame of a bone; refused when it is not finite or too short (its ends then have no direction). */
export function boneFrame(bone: Cubic): BoneFrame {
  bone.forEach((p, i) => finite(p, `bone control point ${i}`))
  const ts = Array.from({ length: SAMPLES + 1 }, (_, i) => i / SAMPLES), pts = ts.map(t => point(bone, t)), at = [0]
  for (let i = 1; i <= SAMPLES; i++) at.push(at[i - 1]! + len(sub(pts[i]!, pts[i - 1]!)))
  const length = at[SAMPLES]!
  if (!(length >= MIN_BONE_LENGTH)) throw new BoneError('bone-too-short', `the bone is shorter than ${MIN_BONE_LENGTH}`)
  return { bone: bone.map(p => ({ x: p.x, y: p.y })) as unknown as Cubic, ts, at, length }
}

/** A point in bone coordinates: fraction of length `s` in [0, 1], and the tangential and normal distances there. */
export interface BonePoint { readonly s: number; readonly along: number; readonly off: number }

/** Curve parameter → fraction of length, and back (the same piecewise-linear table both ways, so they invert exactly). */
function sOf(f: BoneFrame, t: number): number {
  const x = Math.max(0, Math.min(1, t)) * SAMPLES, i = Math.min(SAMPLES - 1, Math.floor(x))
  return (f.at[i]! + (f.at[i + 1]! - f.at[i]!) * (x - i)) / f.length
}
function tOf(f: BoneFrame, s: number): number {
  const target = Math.max(0, Math.min(1, s)) * f.length
  let lo = 0, hi = SAMPLES
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (f.at[mid]! <= target) lo = mid; else hi = mid }
  const i = Math.min(lo, SAMPLES - 1), seg = f.at[i + 1]! - f.at[i]!
  return (i + (seg > 0 ? (target - f.at[i]!) / seg : 0)) / SAMPLES
}
/** The unit tangent at curve parameter t; where the derivative vanishes (a zero end handle), the curve's next direction. */
function tangent(f: BoneFrame, t: number): Vec {
  let d = deriv(f.bone, t)
  if (len(d) < 1e-12 * Math.max(1, f.length)) d = deriv2(f.bone, t)
  if (len(d) < 1e-12 * Math.max(1, f.length)) d = sub(f.bone[3], f.bone[0])
  const l = len(d)
  if (!(l > 0)) throw new BoneError('bone-too-short', 'the bone has no direction')
  return mul(d, 1 / l)
}
const normal = (t: Vec): Vec => ({ x: -t.y, y: t.x })
const tangentOf = (c: Cubic, t: number): Vec => { const d = deriv(c, t), l = len(d); return l > 0 ? mul(d, 1 / l) : { x: 1, y: 0 } }

/**
 * A point in the bone's coordinates: the nearest point of the bone (or of its straight continuation past an end).
 * Refused as ambiguous when two separate parts of the bone are equally near (a point at the centre of a tight bend):
 * which part it belongs to would be a guess (checklist §2: "choose another bone").
 */
export function toBone(f: BoneFrame, p: Vec): BonePoint {
  finite(p, 'the point')
  const dist = (t: number) => len(sub(point(f.bone, t), p))
  const d = f.ts.map(dist)
  let bi = 0
  for (let i = 1; i <= SAMPLES; i++) if (d[i]! < d[bi]!) bi = i
  // ambiguity: another local minimum (the ends included), far along the bone, as near as the best
  for (let i = 0; i <= SAMPLES; i++) {
    const isMin = (i === 0 || d[i]! <= d[i - 1]!) && (i === SAMPLES || d[i]! <= d[i + 1]!)
    if (isMin && Math.abs(f.at[i]! - f.at[bi]!) > 0.05 * f.length && d[i]! - d[bi]! <= 1e-6 * Math.max(1, d[bi]!)) {
      throw new BoneError('bone-ambiguous', 'two parts of the bone are equally near this point')
    }
  }
  // Newton on (C(t) − p)·C'(t) = 0 from the nearest sample, kept in [0, 1]
  let t = f.ts[bi]!
  for (let k = 0; k < 30; k++) {
    const r = sub(point(f.bone, t), p), c1 = deriv(f.bone, t), c2 = deriv2(f.bone, t), g = dot(r, c1), h = dot(c1, c1) + dot(r, c2)
    if (!(h > 0)) break
    const next = Math.max(0, Math.min(1, t - g / h))
    if (Math.abs(next - t) < 1e-15) { t = next; break }
    t = next
  }
  if (dist(t) > d[bi]!) t = f.ts[bi]!
  const q = point(f.bone, t), T = tangent(f, t), v = sub(p, q)
  return { s: sOf(f, t), along: dot(v, T), off: dot(v, normal(T)) }
}

/** A point from bone coordinates on frame `f`, the distances scaled by `scale`. */
export function fromBone(f: BoneFrame, c: BonePoint, scale = 1): Vec {
  if (![c.s, c.along, c.off, scale].every(Number.isFinite)) throw new BoneError('bone-not-finite', 'bone coordinates are not finite')
  const t = tOf(f, c.s), q = point(f.bone, t), T = tangent(f, t)
  return finite(add(q, add(mul(T, c.along * scale), mul(normal(T), c.off * scale))), 'the placed point')
}

/**
 * The map that carries a point attached to `base` (the bone as it was when the line was attached) onto `bone`:
 * same fraction of length, distances × length ratio × `widthFactor` (an interface only — bowen 1792297720: built
 * if ever needed; 1 today).
 */
export function boneMap(base: Cubic, bone: Cubic, widthFactor = 1): (p: Vec) => Vec {
  if (!Number.isFinite(widthFactor) || widthFactor <= 0) throw new BoneError('bone-not-finite', 'the width factor must be a positive number')
  const from = boneFrame(base), to = boneFrame(bone), scale = (to.length / from.length) * widthFactor
  return p => fromBone(to, toBone(from, p), scale)
}

// ---- a line carried by its bone -----------------------------------------------------------------

/**
 * One cubic through `samples` (in order along the curve): end points exact, end tangent directions exact, the two
 * handle lengths by least squares, the samples' parameters refined by closest-point Newton steps (the classic
 * Schneider fit). The source parameters to start; the refinement lets a curve that runs at another speed be fitted as a
 * shape. Returns the cubic and the largest distance from a sample to it (a shape error, input units).
 */
function fitSamples(samples: readonly Vec[], ta: Vec, tb: Vec): { shape: Cubic; maxError: number } {
  const n = samples.length - 1, a = samples[0]!, b = samples[n]!
  const u = [0]; for (let i = 1; i <= n; i++) u.push(u[i - 1]! + len(sub(samples[i]!, samples[i - 1]!)))
  const total = u[n]! || 1, chord = len(sub(b, a)) || total, floor = 1e-6 * total
  const make = (la: number, lb: number): Cubic => [a, add(a, mul(ta, Math.max(floor, la))), add(b, mul(tb, Math.max(floor, lb))), b]
  // the closest point of the cubic to p: Newton from t0, or first from the nearest of 32 even samples (a strongly curved
  // target has more than one valley)
  const project = (c: Cubic, p: Vec, t0: number, coarse: boolean) => {
    let t = t0, best = len(sub(point(c, t0), p))
    if (coarse) for (let k = 0; k <= 32; k++) { const d = len(sub(point(c, k / 32), p)); if (d < best) { best = d; t = k / 32 } }
    for (let k = 0; k < 4; k++) {
      const r = sub(point(c, t), p), d1 = deriv(c, t), d2 = deriv2(c, t), den = dot(d1, d1) + dot(r, d2)
      if (!(den > 1e-18)) break
      const next = Math.max(0, Math.min(1, t - dot(r, d1) / den))
      if (len(sub(point(c, next), p)) > len(r)) break
      t = next
    }
    return t
  }
  // the source line's own parameters to start (the samples are taken at i / n of it)
  const t = samples.map((_, i) => i / n)
  let shape: Cubic = make(chord / 3, chord / 3)
  const err = () => Math.max(...samples.map((p, i) => len(sub(point(shape, t[i]!), p))))
  // alternate: the two handle lengths by least squares for these parameters, then each sample's parameter by projection
  for (let round = 0; round < 6; round++) {
    let c11 = 0, c12 = 0, c22 = 0, x1 = 0, x2 = 0
    for (let i = 1; i < n; i++) {
      const s = t[i]!, w = 1 - s, B1 = 3 * w * w * s, B2 = 3 * w * s * s, A1 = mul(ta, B1), A2 = mul(tb, B2)
      const r = sub(samples[i]!, add(mul(a, w * w * w + B1), mul(b, B2 + s * s * s)))
      c11 += dot(A1, A1); c12 += dot(A1, A2); c22 += dot(A2, A2); x1 += dot(A1, r); x2 += dot(A2, r)
    }
    const det = c11 * c22 - c12 * c12
    if (Math.abs(det) > 1e-18) shape = make((x1 * c22 - x2 * c12) / det, (c11 * x2 - c12 * x1) / det)
    for (let i = 1; i < n; i++) t[i] = project(shape, samples[i]!, t[i]!, round % 8 === 0)
    if (err() < 1e-7 * Math.max(1, total)) break
  }
  // then Gauss–Newton on the two lengths against the samples' orthogonal distances (each sample projected onto the
  // curve): quadratic near the answer, where the alternation above only creeps
  let la = len(sub(shape[1], a)), lb = len(sub(shape[2], b))
  for (let it = 0; it < 30; it++) {
    for (let i = 1; i < n; i++) t[i] = project(shape, samples[i]!, t[i]!, it % 4 === 0)
    let j11 = 0, j12 = 0, j22 = 0, g1 = 0, g2 = 0, sum = 0
    for (let i = 1; i < n; i++) {
      const s = t[i]!, w = 1 - s, q = point(shape, s), d = sub(q, samples[i]!), dl = len(d)
      sum += dl * dl
      // the direction from the sample to the curve (the curve's normal when the projection is exact)
      const nrm = dl > 1e-15 ? mul(d, 1 / dl) : normal(tangentOf(shape, s))
      const r = dot(d, nrm), J1 = dot(mul(ta, 3 * w * w * s), nrm), J2 = dot(mul(tb, 3 * w * s * s), nrm)
      j11 += J1 * J1; j12 += J1 * J2; j22 += J2 * J2; g1 += J1 * r; g2 += J2 * r
    }
    const det = j11 * j22 - j12 * j12
    if (!(Math.abs(det) > 1e-24)) break
    let d1 = -(g1 * j22 - g2 * j12) / det, d2 = -(j11 * g2 - j12 * g1) / det
    // a step that does not lower the sum is halved (at most a few times)
    const sumAt = (c: Cubic) => { let z = 0; for (let i = 1; i < n; i++) { const tt = project(c, samples[i]!, t[i]!, false); z += len(sub(point(c, tt), samples[i]!)) ** 2 } return z }
    let next = make(la + d1, lb + d2), k = 0
    while (sumAt(next) > sum && k++ < 6) { d1 /= 2; d2 /= 2; next = make(la + d1, lb + d2) }
    if (k > 6) break
    shape = next; la = Math.max(floor, la + d1); lb = Math.max(floor, lb + d2)
    if (Math.hypot(d1, d2) < 1e-10 * chord) break
  }
  for (let i = 1; i < n; i++) t[i] = project(shape, samples[i]!, t[i]!, false)
  const maxError = err()
  shape.forEach((p, i) => finite(p, `fitted control point ${i}`))
  if (!Number.isFinite(maxError)) throw new BoneError('bone-not-finite', 'the fit is not finite')
  return { shape, maxError }
}

/**
 * One attached line in a view: its base shape (at 0,0, when attached) carried by `boneMap(baseBone, bone)` and refit
 * as one cubic (end points exact, end tangents from the carried curve). `ends` moves an end to a target decided
 * elsewhere (a point owned by another bone, checklist §1): the difference is blended linearly along the line, so the
 * rest of the curve still follows this bone. `maxError` is the largest distance from the carried curve's samples to
 * the fitted cubic (a shape error).
 */
export function boneLine(line: Cubic, baseBone: Cubic, bone: Cubic, ends: { a?: Vec; b?: Vec } = {}, widthFactor = 1): { shape: Cubic; maxError: number } {
  line.forEach((p, i) => finite(p, `line control point ${i}`))
  const map = boneMap(baseBone, bone, widthFactor)
  const a0 = map(line[0]), b0 = map(line[3])
  const da = ends.a ? sub(finite(ends.a, 'the start target'), a0) : { x: 0, y: 0 }, db = ends.b ? sub(finite(ends.b, 'the end target'), b0) : { x: 0, y: 0 }
  const at = (t: number) => add(map(point(line, t)), add(mul(da, 1 - t), mul(db, t)))
  const N = 48, samples = Array.from({ length: N + 1 }, (_, i) => at(i / N))
  // end directions from the carried curve: one-sided differences, falling back further in when the end does not move
  const dir = (from: number, step: number) => {
    for (let k = 1; k <= 64; k++) { const d = sub(at(from + step * k), at(from)); if (len(d) > 1e-12 * Math.max(1, len(at(from)))) return mul(d, 1 / len(d)) }
    throw new BoneError('bone-too-short', 'the carried line has no direction at an end')
  }
  return fitSamples(samples, dir(0, 1e-4), dir(1, -1e-4))
}
