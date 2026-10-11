// evaluate — the drawing at any head angle from its nine views (docs/stage3a-playback-plan.md;
// docs/architecture-multiview.md §3, package 5). Pure: plain data in a type of its own, no
// state, no edit, no drawing. Geometry is blended bilinearly in each quadrant (rule 2, dot
// 1791684410); appearance and joins after the blend are two slots with placeholders (rule 5,
// bowen 1791684302) that may be filled later.
import { type Vec } from '../geometry'

type Id = string
/** A line's stroke, as a view stores it. */
export interface Stroke { readonly width: number; readonly profile: string }
/** A point's end stroke, as a view stores it: an open dictionary. */
export type EndStroke = Readonly<Record<string, number | string>>

/** One view: its angle and its shapes. Handles are vectors from their point. */
export interface ViewShape {
  readonly yaw: number
  readonly pitch: number
  readonly points: Readonly<Record<Id, Vec>>
  readonly lines: Readonly<Record<Id, { readonly ha: Vec; readonly hb: Vec; readonly stroke: Stroke }>>
  /** Arc radius per arc row key. */
  readonly radii: Readonly<Record<string, number>>
  /** End strokes of the points that have one. */
  readonly ends: Readonly<Record<Id, EndStroke>>
}
/** One response: knots [progress, value], progress strictly increasing inside (0, 1); through (0,0) and (1,1). */
export type Knots = readonly (readonly [number, number])[]
/** A control's responses: edge key → axes. An edge key is `yaw,pitch>yaw,pitch`, inner view first (e.g. `0,0>90,0`). */
export type ControlResponses = Readonly<Record<string, { readonly x?: Knots; readonly y?: Knots }>>
/** Responses per control (stage 3b package 2): a point's position, or one end's handle vector. */
export interface Responses {
  readonly points: Readonly<Record<Id, ControlResponses>>
  readonly handles: Readonly<Record<Id, { readonly a?: ControlResponses; readonly b?: ControlResponses }>>
}
/** The nine views of a drawing (yaw −90 / 0 / 90 × pitch −45 / 0 / 45), each once, and the responses (none: linear). */
export interface Model { readonly views: readonly ViewShape[]; readonly responses?: Responses }
export interface Pose { readonly yaw: number; readonly pitch: number }
/** The shapes at one pose, in the same kinds as a view. */
export interface Posed {
  points: Record<Id, Vec>
  lines: Record<Id, { ha: Vec; hb: Vec; stroke: Stroke }>
  radii: Record<string, number>
  ends: Record<Id, EndStroke>
}

export const YAW_LIMIT = 90
export const PITCH_LIMIT = 45

/** Whether a pose is inside the domain (rule 1). Outside is refused by the caller, never clamped. */
export const inRange = (p: Pose): boolean =>
  Number.isFinite(p.yaw) && Number.isFinite(p.pitch) && Math.abs(p.yaw) <= YAW_LIMIT && Math.abs(p.pitch) <= PITCH_LIMIT

/** A view and its weight at a pose. */
export interface Weighted { readonly view: ViewShape; readonly weight: number }

/**
 * The views that contribute at a pose and their weights (rule 2): in the quadrant of the
 * pose, front F, yaw view Y, pitch view P, corner C, with u = |yaw| / 90, v = |pitch| / 45,
 * weights (1−u)(1−v), u(1−v), (1−u)v, uv. Zero weights are left out, so a view is
 * reproduced exactly. Listed in the tie order of the dominant view: F, Y, P, C.
 */
export function weights(model: Model, pose: Pose): Weighted[] {
  if (!inRange(pose)) throw new Error(`pose-out-of-range: yaw ${pose.yaw}, pitch ${pose.pitch}`)
  const at = (yaw: number, pitch: number) => {
    const found = model.views.filter(v => v.yaw === yaw && v.pitch === pitch)
    if (found.length !== 1) throw new Error(`model-incomplete: ${found.length} views at yaw ${yaw}, pitch ${pitch}`)
    return found[0]!
  }
  const sy = pose.yaw < 0 ? -1 : 1, sp = pose.pitch < 0 ? -1 : 1
  const u = Math.abs(pose.yaw) / YAW_LIMIT, v = Math.abs(pose.pitch) / PITCH_LIMIT
  return [
    { view: at(0, 0), weight: (1 - u) * (1 - v) },
    { view: at(sy * YAW_LIMIT, 0), weight: u * (1 - v) },
    { view: at(0, sp * PITCH_LIMIT), weight: (1 - u) * v },
    { view: at(sy * YAW_LIMIT, sp * PITCH_LIMIT), weight: u * v },
  ].filter(w => w.weight > 0)
}

/** The drawing at a pose: blended geometry, then slot B, then slot A's appearance. */
export function evaluate(model: Model, pose: Pose): Posed {
  const ws = weights(model, pose)
  const look = appearance(ws)
  const geometry = afterBlend(blend(ws, responded(model, pose), model.responses))
  return {
    points: geometry.points,
    lines: Object.fromEntries(Object.entries(geometry.lines).map(([id, l]) => [id, { ...l, stroke: look.strokes[id]! }])),
    radii: geometry.radii,
    ends: look.ends,
  }
}

/** Blended geometry (rules 2, 3): positions, handle vectors and arc radii. */
export interface Geometry {
  points: Record<Id, Vec>
  lines: Record<Id, { ha: Vec; hb: Vec }>
  radii: Record<string, number>
}

/**
 * Responded weights for one scalar (stage 3b package 2, docs/stage3b-pkg2-responses.md §2): in the
 * pose's quadrant, `u' = (1 − v)·r_bottom(u) + v·r_top(u)`, `v' = (1 − u)·s_left(v) + u·s_right(v)`,
 * then the bilinear weights of u', v'. Weights may be negative or above 1 (a response may
 * extrapolate); only weights exactly 0 are left out, so a view stays exact. Returns undefined for a
 * control with no response on any of the four edges, which then takes the geometric weights (3a).
 */
type ScalarWeights = (control: ControlResponses | undefined, axis: 'x' | 'y', what: string) => Weighted[] | undefined
function responded(model: Model, pose: Pose): ScalarWeights {
  const at = (yaw: number, pitch: number) => model.views.find(v => v.yaw === yaw && v.pitch === pitch)!
  const sy = pose.yaw < 0 ? -1 : 1, sp = pose.pitch < 0 ? -1 : 1
  const u = Math.abs(pose.yaw) / YAW_LIMIT, v = Math.abs(pose.pitch) / PITCH_LIMIT
  const Y = sy * YAW_LIMIT, P = sp * PITCH_LIMIT
  const edge = (a: [number, number], b: [number, number]) => `${a[0]},${a[1]}>${b[0]},${b[1]}`
  const bottom = edge([0, 0], [Y, 0]), top = edge([0, P], [Y, P]), left = edge([0, 0], [0, P]), right = edge([Y, 0], [Y, P])
  const views = [at(0, 0), at(Y, 0), at(0, P), at(Y, P)]
  return (control, axis, what) => {
    if (!control) return undefined
    // missing (no own edge, no own axis) is linear; present but broken is refused, never read as missing
    const k = (e: string): Knots | undefined => {
      if (!Object.hasOwn(control, e)) return undefined
      const axes: unknown = control[e]
      if (!isRecord(axes)) throw new Error(`model-incomplete: malformed response of ${what} on ${e}`)
      if (!Object.hasOwn(axes, axis)) return undefined
      try { return checkKnots(axes[axis], `${what} on ${e}, axis ${axis}`) } catch (err) { throw new Error(`model-incomplete: malformed response of ${(err as Error).message}`) }
    }
    const rb = k(bottom), rt = k(top), sl = k(left), sr = k(right)
    if (!rb && !rt && !sl && !sr) return undefined
    // every response is pinned at 0 and 1, so u = 0 gives u' = 0 and u = 1 gives (1 − v)·1 + v·1,
    // which rounds to exactly 1 (the error of 1 − v is at most half an ulp of 1): views stay exact.
    // A response is always finite (a convex combination of finite knots), so an edge the pose is
    // not on enters with weight 0 and adds exactly 0 (dot 1791690525); a result that still comes
    // out non-finite is refused where the scalar is summed
    const u2 = (1 - v) * respond(rb, u) + v * respond(rt, u)
    const v2 = (1 - u) * respond(sl, v) + u * respond(sr, v)
    return [(1 - u2) * (1 - v2), u2 * (1 - v2), (1 - u2) * v2, u2 * v2].map((weight, i) => ({ view: views[i]!, weight })).filter(w => w.weight !== 0)
  }
}
const own = <T>(rec: Readonly<Record<string, T>>, k: string): T | undefined => (Object.hasOwn(rec, k) ? rec[k] : undefined)
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export const MAX_KNOTS = 256
/**
 * The one check of a knot list, for the model here and for a clip or a file (animation): a
 * list, at most 256 knots, every index present (an empty slot of a sparse list is an error,
 * not skipped), each knot two finite numbers, progress strictly increasing inside (0, 1).
 * A copy; throws naming `what` (dot 1791690497).
 */
export function checkKnots(v: unknown, what: string): [number, number][] {
  if (!Array.isArray(v)) throw new Error(`${what}: knots must be a list`)
  if (v.length > MAX_KNOTS) throw new Error(`${what}: more than ${MAX_KNOTS} knots`)
  const out: [number, number][] = []
  let last = 0
  for (let i = 0; i < v.length; i++) {
    if (!Object.hasOwn(v, i)) throw new Error(`${what}: knot ${i} is missing (an empty slot)`)
    const kn: unknown = v[i]
    if (!Array.isArray(kn) || kn.length !== 2 || !Object.hasOwn(kn, 0) || !Object.hasOwn(kn, 1) || typeof kn[0] !== 'number' || typeof kn[1] !== 'number' || !Number.isFinite(kn[0]) || !Number.isFinite(kn[1])) throw new Error(`${what}: knot ${i} must be two finite numbers`)
    if (!(kn[0] > last && kn[0] < 1)) throw new Error(`${what}: knot progress must increase strictly inside (0, 1)`)
    last = kn[0]
    out.push([kn[0], kn[1]])
  }
  return out
}
/** A control's responses read from the model: absent → undefined; present but not an object → refused. */
function control(rec: unknown, id: string, what: string): ControlResponses | undefined {
  if (!isRecord(rec) || !Object.hasOwn(rec, id)) return undefined
  const c = rec[id]
  if (!isRecord(c)) throw new Error(`model-incomplete: malformed responses of ${what}`)
  return c as ControlResponses
}
/**
 * One response at progress t: piecewise linear through (0,0), the knots, (1,1). Interpolated as
 * the convex combination v0·(1 − s) + v·s, never v0 + s·(v − v0): the difference of two finite
 * extreme values can overflow (1e308 and −1e308), the combination of finite values cannot, so a
 * finite response is finite everywhere (dot 1791690525).
 */
export function respond(knots: Knots | undefined, t: number): number {
  if (!knots?.length || t === 0 || t === 1) return t
  let p0 = 0, v0 = 0
  for (const [p, v] of knots) {
    if (t <= p) return t === p ? v : v0 * (1 - (t - p0) / (p - p0)) + v * ((t - p0) / (p - p0))
    p0 = p; v0 = v
  }
  const s = (t - p0) / (1 - p0)
  return v0 * (1 - s) + s
}

/**
 * The drawing has no finite value at this pose: `what` names the scalar (e.g. `position of b`).
 * A type of its own, so callers turn exactly this into a refusal and nothing else (dot 1791693222).
 */
export class PoseNotFinite extends Error {
  constructor(readonly what: string) { super(`pose-not-finite: ${what} is not a finite number at this pose`); this.name = 'PoseNotFinite' }
}

/** One term of a blend added to the sum so far, summed from the first term so a single weight 1 gives the value exactly. */
const addTerm = (s: number | undefined, weight: number, x: number): number => (s === undefined ? weight * x : s + weight * x)

/**
 * One control's value on one axis on an edge at progress t, from the inner view's value A and the
 * outer view's B: the blend `evaluate` computes there, weights 1 − r(t) and r(t), zero weights
 * left out, summed by the same step (ledger row 14). Not checked for finiteness.
 */
export function onEdge(knots: Knots | undefined, t: number, A: number, B: number): number {
  const r = respond(knots, t)
  let s: number | undefined
  for (const [w, x] of [[1 - r, A], [r, B]] as const) if (w !== 0) s = addTerm(s, w, x)
  return s ?? 0
}

function blend(ws: readonly Weighted[], scalar: ScalarWeights, responses?: Responses): Geometry {
  // the keys of every contributing view, not of the first one: a key missing in any of them is
  // refused below (model-incomplete), never dropped (dot 1791684670)
  const keys = (pick: (v: ViewShape) => object) => [...new Set(ws.flatMap(w => Object.keys(pick(w.view))))]
  // own properties only: `constructor` and the like on a record that lacks the key are missing, not inherited (dot 1791684959)
  const num = (get: (v: ViewShape) => number | undefined, what: string, list: readonly Weighted[] = ws) => {
    // summed from the first term, so a single weight 1 gives the view's value exactly (even −0)
    let s: number | undefined
    for (const w of list) {
      const x = get(w.view)
      if (x === undefined) throw new Error(`model-incomplete: no ${what} in view ${w.view.yaw},${w.view.pitch}`)
      s = addTerm(s, w.weight, x)
    }
    // finite views and finite responses must not silently give a non-finite drawing (dot 1791690525)
    if (!Number.isFinite(s)) throw new PoseNotFinite(what)
    return s!
  }
  // a control with a response on one of the quadrant's edges blends that axis with its own weights
  const vec = (get: (v: ViewShape) => Vec | undefined, what: string, control?: ControlResponses): Vec =>
    ({ x: num(v => get(v)?.x, what, scalar(control, 'x', what) ?? ws), y: num(v => get(v)?.y, what, scalar(control, 'y', what) ?? ws) })
  return {
    points: Object.fromEntries(keys(v => v.points).map(p => [p, vec(v => own(v.points, p), `position of ${p}`, control(responses?.points, p, `position of ${p}`))])),
    lines: Object.fromEntries(keys(v => v.lines).map(l => [l, {
      ha: vec(v => own(v.lines, l)?.ha, `handle a of ${l}`, control(control(responses?.handles, l, `handles of ${l}`), 'a', `handle a of ${l}`)),
      hb: vec(v => own(v.lines, l)?.hb, `handle b of ${l}`, control(control(responses?.handles, l, `handles of ${l}`), 'b', `handle b of ${l}`)),
    }])),
    radii: Object.fromEntries(keys(v => v.radii).map(k => [k, num(v => own(v.radii, k), `radius of ${k}`)])),
  }
}

/**
 * Slot A, appearance at a pose (rule 5). Placeholder: everything from the dominant view,
 * the largest weight, ties to F, then Y, then P; an end stroke whole, present or absent as
 * there. Nothing is blended and nothing is invented. To be filled when bowen takes up
 * playback rendering (ledger row 9); its inputs may have to grow.
 */
export function appearance(ws: readonly Weighted[]): { strokes: Record<Id, Stroke>; ends: Record<Id, EndStroke> } {
  const dominant = ws.reduce((best, w) => (w.weight > best.weight ? w : best)).view
  return {
    strokes: Object.fromEntries(Object.entries(dominant.lines).map(([id, l]) => [id, { ...l.stroke }])),
    ends: Object.fromEntries(Object.entries(dominant.ends).map(([id, e]) => [id, { ...e }])),
  }
}

/**
 * Slot B, joins after the blend (rule 5). Placeholder: nothing changes, so a smooth join
 * blended from aligned views may bend; the bend is not measured. To be filled later
 * (ledger row 9); its inputs may have to grow.
 */
export function afterBlend(g: Geometry): Geometry { return g }
