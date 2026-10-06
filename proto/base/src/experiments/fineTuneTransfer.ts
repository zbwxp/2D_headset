// Fine-tune transfer experiment (headset-design doc 18 §10.3d, bowen 1791292828 / 1791292953).
// STANDALONE: not wired into the editor, the store or the drawing chain.
//
// A fine-tune keeps the curve's identity and adds an offset on the FRONT view. Given
//   abcd   — a curve's 4 control points on the front view (original)
//   abcd1  — the same curve after the fine-tune (front)
//   abcd′  — the original curve recorded at a side angle
// the candidate rule is, per curve:
//   L      = linear part of the least-squares affine map abcd → abcd′
//   abcd1′ = abcd′ + L·(abcd1 − abcd)
// With no fine-tune (abcd1 = abcd) the result is EXACTLY the recording. If abcd′ really is an
// affine image of abcd the transfer is exact; otherwise it is an explicit approximation.
// Checks named in doc 18: near-collinear control points (straight segments), and shared
// endpoints of adjacent curves carried to different places when each curve has its own L.
import { PART, v, type A, type V } from './scenarioE'

export type Cubic = [V, V, V, V]
export type Mat2 = [number, number, number, number] // x' = a x + c y, y' = b x + d y
const add = (a: V, b: V): V => v(a.x + b.x, a.y + b.y)
const sub = (a: V, b: V): V => v(a.x - b.x, a.y - b.y)
const mul = (a: V, k: number): V => v(a.x * k, a.y * k)
export const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y)
const applyM = (m: Mat2, p: V): V => v(m[0] * p.x + m[2] * p.y, m[1] * p.x + m[3] * p.y)

/** Curves of the eye part: two lids, two cubic segments each; corners and the lid middles are shared anchors. */
export type CurveId = 'U0' | 'U1' | 'L0' | 'L1'
export const curveIds: CurveId[] = ['U0', 'U1', 'L0', 'L1']
export type Eye = Record<CurveId, Cubic>
const seg = (l: A[], i: number): Cubic => [l[i].p, l[i].hOut, l[i + 1].hIn, l[i + 1].p]
export const frontEye = (): Eye => ({ U0: seg(PART.upper, 0), U1: seg(PART.upper, 1), L0: seg(PART.lower, 0), L1: seg(PART.lower, 1) })
export const mapEye = (e: Eye, f: (p: V) => V): Eye => Object.fromEntries(curveIds.map((id) => [id, e[id].map(f)])) as Eye

/** Shared anchors (curve, control index) that must coincide: corners of both lids, and each lid's middle. */
export const SHARED: [CurveId, number][][] = [
  [['U0', 0], ['L0', 0]], // left corner
  [['U1', 3], ['L1', 3]], // right corner
  [['U0', 3], ['U1', 0]], // upper middle
  [['L0', 3], ['L1', 0]], // lower middle
]

/**
 * Least-squares affine fit p → q over the given pairs, in centred coordinates (same formulation as
 * v103 poseInference.layerTrend). Returns the linear part and the condition (smaller singular value
 * ratio of the source spread): near 0 = near-collinear source points, the fit is undetermined across.
 */
export function fitLinear(ps: V[], qs: V[]): { L: Mat2; spread: number } {
  const mean = (xs: V[]) => mul(xs.reduce(add, v(0, 0)), 1 / xs.length)
  const a = mean(ps)
  const b = mean(qs)
  let xx = 0, xy = 0, yy = 0, xu = 0, xv = 0, yu = 0, yv = 0
  ps.forEach((p, i) => {
    const [x, y] = [p.x - a.x, p.y - a.y]
    const [u, w] = [qs[i].x - b.x, qs[i].y - b.y]
    xx += x * x; xy += x * y; yy += y * y; xu += x * u; xv += x * w; yu += y * u; yv += y * w
  })
  const det = xx * yy - xy * xy
  const tr = xx + yy
  // eigenvalues of the 2x2 scatter; spread = smaller / larger (0 = collinear)
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det))
  const lo = tr / 2 - disc
  const hi = tr / 2 + disc
  const spread = hi > 0 ? lo / hi : 0
  if (Math.abs(det) < 1e-12) return { L: [Number.NaN, Number.NaN, Number.NaN, Number.NaN], spread }
  // solve [xx xy; xy yy] [m0 m2]^T rows for u and w
  const a0 = (xu * yy - yu * xy) / det // ∂u/∂x
  const c0 = (yu * xx - xu * xy) / det // ∂u/∂y
  const b0 = (xv * yy - yv * xy) / det // ∂w/∂x
  const d0 = (yv * xx - xv * xy) / det // ∂w/∂y
  return { L: [a0, b0, c0, d0], spread }
}

export const MIN_SPREAD = 0.02 // below this the curve's own control points are treated as near-collinear

export type Transfer = {
  eye: Eye
  /** per curve: the spread of its own control points, and where L came from */
  perCurve: Record<CurveId, { spread: number; source: 'own' | 'with-neighbours' | 'undetermined-additive' }>
}

/**
 * Per-curve local affine transfer. A near-collinear curve borrows the control points of the curves
 * that share an anchor with it (explicit fallback, reported); it never falls back silently.
 */
export function transferPerCurve(front: Eye, tuned: Eye, side: Eye): Transfer {
  const out = {} as Eye
  const perCurve = {} as Transfer['perCurve']
  for (const id of curveIds) {
    let fit = fitLinear(front[id], side[id])
    let source: Transfer['perCurve'][CurveId]['source'] = 'own'
    if (fit.spread < MIN_SPREAD) {
      const neighbours = new Set<CurveId>([id])
      for (const group of SHARED) if (group.some(([c]) => c === id)) for (const [c] of group) neighbours.add(c)
      const ps = [...neighbours].flatMap((c) => front[c])
      const qs = [...neighbours].flatMap((c) => side[c])
      fit = { ...fitLinear(ps, qs), spread: fit.spread }
      source = 'with-neighbours'
    }
    if (!fit.L.every(Number.isFinite)) {
      // still undetermined with the neighbours: reported, and the offset is added as-is (T1)
      out[id] = side[id].map((q, i) => add(q, sub(tuned[id][i], front[id][i]))) as Cubic
      perCurve[id] = { spread: fit.spread, source: 'undetermined-additive' }
      continue
    }
    out[id] = side[id].map((q, i) => add(q, applyM(fit.L, sub(tuned[id][i], front[id][i])))) as Cubic
    perCurve[id] = { spread: fit.spread, source }
  }
  return { eye: out, perCurve }
}

/** T1 for comparison: the front offset added as-is (proto pose.ts semantics). */
export const transferAdditive = (front: Eye, tuned: Eye, side: Eye): Eye =>
  Object.fromEntries(curveIds.map((id) => [id, side[id].map((q, i) => add(q, sub(tuned[id][i], front[id][i])))])) as Eye

/** Largest distance between control points that must coincide (shared anchors). */
export const sharedGap = (e: Eye) => Math.max(...SHARED.map((g) => dist(e[g[0][0]][g[0][1]], e[g[1][0]][g[1][1]])))

/**
 * One explicit reconcile rule for shared anchors (candidate, reported separately): each shared
 * anchor goes to the mean of its transferred positions; the adjacent handles move with it.
 */
export function reconcileShared(e: Eye): Eye {
  const out = Object.fromEntries(curveIds.map((id) => [id, e[id].map((p) => ({ ...p }))])) as Eye
  for (const group of SHARED) {
    const m = mul(group.map(([c, i]) => e[c][i]).reduce(add, v(0, 0)), 1 / group.length)
    for (const [c, i] of group) {
      const d = sub(m, e[c][i])
      out[c][i] = m
      const h = i === 0 ? 1 : 2 // the handle attached to this end
      out[c][h] = add(e[c][h], d)
    }
  }
  return out
}

// ---------- test inputs (synthetic; stated as such) ----------
/** Fine-tune: upper lid middle raised by 1.5 (anchor and both handles), right corner moved out by 0.8. */
export function fineTune(front: Eye): Eye {
  const e = Object.fromEntries(curveIds.map((id) => [id, front[id].map((p) => ({ ...p }))])) as Eye
  const up = v(0, -1.5)
  e.U0[3] = add(e.U0[3], up); e.U0[2] = add(e.U0[2], up); e.U1[0] = add(e.U1[0], up); e.U1[1] = add(e.U1[1], up)
  const out = v(0.8, 0)
  for (const id of ['U1', 'L1'] as CurveId[]) { e[id][3] = add(e[id][3], out); e[id][2] = add(e[id][2], out) }
  return e
}

/** Side views. 'affine': an affine image of the front (transfer should be exact).
 *  'warped': a non-affine image (squeeze growing toward the far side, sag, tilt) — the ideal fine-tuned
 *  side view is then known: the same map applied to the fine-tuned front.
 *  'redrawn': the warped view plus independent hand-like edits to the recorded control points — no
 *  ideal exists; only pictures can be judged. */
export const sideMaps = {
  affine: (p: V) => v(0.45 * p.x + 0.12 * p.y + 2, -0.05 * p.x + 0.95 * p.y),
  warped: (p: V) => {
    const th = (8 * Math.PI) / 180
    const x = 0.45 * p.x + 0.012 * p.x * p.x
    const y = p.y * (1 + 0.02 * p.x) + 0.015 * p.x * p.x
    return v(Math.cos(th) * x - Math.sin(th) * y + 2, Math.sin(th) * x + Math.cos(th) * y)
  },
}
/** A large fine-tune (bowen 1791293646): upper-lid middle raised by 4, right corner moved out by 3. */
export function fineTuneLarge(front: Eye): Eye {
  const e = Object.fromEntries(curveIds.map((id) => [id, front[id].map((p) => ({ ...p }))])) as Eye
  const up = v(0, -4)
  e.U0[3] = add(e.U0[3], up); e.U0[2] = add(e.U0[2], up); e.U1[0] = add(e.U1[0], up); e.U1[1] = add(e.U1[1], up)
  const out = v(3, 0)
  for (const id of ['U1', 'L1'] as CurveId[]) { e[id][3] = add(e[id][3], out); e[id][2] = add(e[id][2], out) }
  return e
}
/** A strong AFFINE side view (dot 1791293701): squeezed to 0.3, tilted 30° — the transfer must be exact here. */
export const strongAffineSide = (p: V) => {
  const th = (30 * Math.PI) / 180
  const x = 0.3 * p.x
  const y = p.y
  return v(Math.cos(th) * x - Math.sin(th) * y + 2, Math.sin(th) * x + Math.cos(th) * y)
}
/** A strong side view: squeezed to about a third, tilted 25°, slightly stretched vertically, with a sag. */
export const strongSide = (p: V) => {
  const th = (25 * Math.PI) / 180
  const x = 0.33 * p.x + 0.01 * p.x * p.x
  const y = 1.1 * p.y * (1 + 0.025 * p.x) + 0.02 * p.x * p.x
  return v(Math.cos(th) * x - Math.sin(th) * y + 2, Math.sin(th) * x + Math.cos(th) * y)
}
export function redrawn(side: Eye): Eye {
  const e = Object.fromEntries(curveIds.map((id) => [id, side[id].map((p) => ({ ...p }))])) as Eye
  // independent edits an artist might make when redrawing the side view (handles only, ends kept shared)
  e.U0[1] = add(e.U0[1], v(0.6, -0.4)); e.U1[2] = add(e.U1[2], v(-0.3, -0.7)); e.L0[2] = add(e.L0[2], v(0.4, 0.5))
  return e
}
