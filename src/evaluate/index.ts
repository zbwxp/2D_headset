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
/** The nine views of a drawing (yaw −90 / 0 / 90 × pitch −45 / 0 / 45), each once. */
export interface Model { readonly views: readonly ViewShape[] }
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
  const geometry = afterBlend(blend(ws))
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

function blend(ws: readonly Weighted[]): Geometry {
  // the keys of every contributing view, not of the first one: a key missing in any of them is
  // refused below (model-incomplete), never dropped (dot 1791684670)
  const keys = (pick: (v: ViewShape) => object) => [...new Set(ws.flatMap(w => Object.keys(pick(w.view))))]
  const num = (get: (v: ViewShape) => number | undefined, what: string) => {
    // summed from the first term, so a single weight 1 gives the view's value exactly (even −0)
    let s: number | undefined
    for (const w of ws) {
      const x = get(w.view)
      if (x === undefined) throw new Error(`model-incomplete: no ${what} in view ${w.view.yaw},${w.view.pitch}`)
      s = s === undefined ? w.weight * x : s + w.weight * x
    }
    return s!
  }
  const vec = (get: (v: ViewShape) => Vec | undefined, what: string): Vec =>
    ({ x: num(v => get(v)?.x, what), y: num(v => get(v)?.y, what) })
  return {
    points: Object.fromEntries(keys(v => v.points).map(p => [p, vec(v => v.points[p], `position of ${p}`)])),
    lines: Object.fromEntries(keys(v => v.lines).map(l => [l, {
      ha: vec(v => v.lines[l]?.ha, `handle a of ${l}`),
      hb: vec(v => v.lines[l]?.hb, `handle b of ${l}`),
    }])),
    radii: Object.fromEntries(keys(v => v.radii).map(k => [k, num(v => v.radii[k], `radius of ${k}`)])),
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
