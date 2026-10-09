// derived — the final geometric outline (Q27): centre lines after joins (an arc
// join trims both lines and inserts an arc tangent to both). Lines, fills and fill
// picking all read this same result, so they cannot disagree. Stroke width,
// taper, blur and show/hide never change it. How a fill joins at a fork where an
// arc sits on another pair of lines is still open (dot 1791425335); here such a
// line end is left untrimmed for that fill.
import * as net from '../network'
import * as joins from '../joins'
import * as fills from '../fills'
import {
  type Cubic, type Vec, arcLength, tAtLength, subCurve, filletArc, derivative, scale,
  flatten, polygonArea, pointInPolygon, nearest, length, add,
} from '../geometry'

type Id = net.Id

export interface Part { key: string; curve: Cubic }
export interface Geometry {
  lines: { id: Id; key: string; curve: Cubic }[]
  arcs: { key: string; point: Id; lines: [Id, Id]; curve: Cubic }[]
  fills: { id: Id; color: string; visible: boolean; parts: Part[] }[]
}

const reverse = (c: Cubic): Cubic => [c[3], c[2], c[1], c[0]]
// Keys use JSON encoding so no id can collide through a separator (dot 1791427637).
const arcKey = (point: Id, lines: [Id, Id]) => 'arc:' + JSON.stringify([point, lines[0], lines[1]])
const endKey = (line: Id, end: net.End) => JSON.stringify([line, end])
const same = (a: Vec, b: Vec) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9

interface Outline {
  n: net.NetworkState
  /** Trim distance at a line end (only where an arc join sits). */
  trim: Map<string, number>
  /** A line's curve with the given trims (arc-length) at its a and b ends. */
  piece: (line: Id, ta: number, tb: number) => Cubic
  /** The drawn (fully trimmed) curve of each line. */
  drawn: Map<Id, Cubic>
  /** For each line, the parameter range [t0, t1] on its own curve that the drawn curve is cut from. */
  range: Map<Id, [number, number]>
  arcByKey: Map<string, Geometry['arcs'][number]>
}

export function derive(n: net.NetworkState, j: joins.JoinsState, f: fills.FillsState): Geometry {
  const o = outline(n, j)
  const lines = net.lines(n).map(l => ({ id: l.id, key: `line:${l.id}`, curve: o.drawn.get(l.id)! }))
  // Drawing order is the fill order (bottom → top), not the discovery order of the loop list (dot 1791430851).
  const drawOrder = new Map(fills.order(f).map((id, i) => [id, i]))
  const fillGeometry = fills.discover(f, n).filter(v => v.filled)
    .sort((a, b) => drawOrder.get(a.id)! - drawOrder.get(b.id)!)
    .map(v => ({ id: v.id, color: v.color!, visible: v.visible!, parts: loopParts(o, v.route) }))
  return { lines, arcs: [...o.arcByKey.values()], fills: fillGeometry }
}

/** Trims and arcs from the arc joins; the drawn curve of every line. */
function outline(n: net.NetworkState, j: joins.JoinsState): Outline {
  const all = net.lines(n)
  const full = net.curves(n)
  const len = new Map(all.map(l => [l.id, arcLength(full.get(l.id)!)]))
  const endAt = (line: Id, point: Id): net.End => (net.line(n, line).a === point ? 'a' : 'b')
  const arcRows = joins.rows(j).filter(r => r.mode === 'arc')
  // The trim at a line end is the largest arc radius there, at most 45% of the line.
  const trim = new Map<string, number>()
  for (const r of arcRows) for (const l of r.lines) {
    const key = endKey(l, endAt(l, r.point))
    trim.set(key, Math.min(Math.max(trim.get(key) ?? 0, r.radius!), 0.45 * len.get(l)!))
  }
  // Parameter on the full curve where each trimmed end now stops.
  const tAt = (line: Id, end: net.End): number => {
    const d = trim.get(endKey(line, end)) ?? 0, c = full.get(line)!
    if (d <= 0) return end === 'a' ? 0 : 1
    return end === 'a' ? tAtLength(c, d) : tAtLength(c, len.get(line)! - d)
  }
  const piece = (id: Id, ta: number, tb: number): Cubic => {
    const c = full.get(id)!, L = len.get(id)!
    return subCurve(c, ta > 0 ? tAtLength(c, ta) : 0, tb > 0 ? tAtLength(c, L - tb) : 1)
  }
  // the drawn curve is cut from its own curve at [t0, t1]; that range is kept, so a position on
  // the drawn curve maps back to the line's own parameter without searching again (dot 1791544391)
  const range = new Map(all.map(l => [l.id, [tAt(l.id, 'a'), tAt(l.id, 'b')] as [number, number]]))
  const drawn = new Map(all.map(l => { const [t0, t1] = range.get(l.id)!; return [l.id, subCurve(full.get(l.id)!, t0, t1)] }))
  // Direction of travel along a line toward (or away from) the given end, at its trim point.
  const towardEnd = (line: Id, end: net.End): Vec => {
    const d = derivative(full.get(line)!, tAt(line, end))
    return end === 'b' ? d : scale(d, -1)
  }
  const endPoint = (id: Id, end: net.End) => (end === 'a' ? drawn.get(id)![0] : drawn.get(id)![3])
  const arcByKey = new Map(arcRows.map(r => {
    const [l1, l2] = r.lines, e1 = endAt(l1, r.point), e2 = endAt(l2, r.point)
    // arrive along l1 toward the point, leave along l2 away from it
    const curve = filletArc(endPoint(l1, e1), towardEnd(l1, e1), endPoint(l2, e2), scale(towardEnd(l2, e2), -1))
    const key = arcKey(r.point, r.lines)
    return [key, { key, point: r.point, lines: r.lines, curve }] as const
  }))
  return { n, trim, piece, drawn, range, arcByKey }
}

/**
 * The outline of a loop route (filled or not — fills and picking use the same
 * one). Between two consecutive lines, if an arc join sits on exactly that pair,
 * the arc is part of the outline. A line uses its drawn curve when its trims match
 * the arcs this loop passes through; otherwise (an arc on another pair at a fork)
 * that end is left untrimmed.
 */
function loopParts(o: Outline, route: net.LoopUse[]): Part[] {
  const parts: Part[] = []
  const startPoint = (u: net.LoopUse) => { const l = net.line(o.n, u.line); return u.reversed ? l.b : l.a }
  const arcAfter = (i: number) => {
    const u = route[i]!, w = route[(i + 1) % route.length]!
    return o.arcByKey.get(arcKey(startPoint(w), u.line < w.line ? [u.line, w.line] : [w.line, u.line]))
  }
  route.forEach((u, i) => {
    const before = arcAfter((i - 1 + route.length) % route.length), after = arcAfter(i)
    // which of the line's own ends (a / b) the loop rounds with an arc
    const roundA = u.reversed ? !!after : !!before, roundB = u.reversed ? !!before : !!after
    const trimA = o.trim.get(endKey(u.line, 'a')) ?? 0, trimB = o.trim.get(endKey(u.line, 'b')) ?? 0
    const matchesDrawn = (trimA > 0) === roundA && (trimB > 0) === roundB
    const curve = matchesDrawn ? o.drawn.get(u.line)! : o.piece(u.line, roundA ? trimA : 0, roundB ? trimB : 0)
    const lineEnd = u.reversed ? curve[0] : curve[3]
    parts.push({ key: matchesDrawn ? `line:${u.line}` : `line:${u.line}:fill`, curve: u.reversed ? reverse(curve) : curve })
    if (after) parts.push({ key: after.key, curve: same(after.curve[0], lineEnd) ? after.curve : reverse(after.curve) })
  })
  return parts
}

const polygon = (parts: Part[]) => parts.flatMap(p => flatten(p.curve).slice(0, -1))

/**
 * Area of a closed walk. A walk that passes a point twice is split there into
 * simple sub-walks and their areas are added, so two lobes never cancel
 * (dot 1791427693).
 */
function walkArea(o: Outline, route: net.LoopUse[]): number {
  const startPoint = (u: net.LoopUse) => { const l = net.line(o.n, u.line); return u.reversed ? l.b : l.a }
  const starts = route.map(startPoint)
  for (let i = 0; i < starts.length; i++) {
    const k = starts.indexOf(starts[i]!, i + 1)
    if (k > i) return walkArea(o, route.slice(i, k)) + walkArea(o, [...route.slice(k), ...route.slice(0, i)])
  }
  return Math.abs(polygonArea(polygon(loopParts(o, route))))
}

/** Every loop containing the point, filled or not, smallest first; the canvas fill pick takes the first in its scope (bowen 1791390533). */
export function loopsAt(n: net.NetworkState, j: joins.JoinsState, f: fills.FillsState, at: Vec): Id[] {
  const o = outline(n, j)
  const candidates: { id: Id; area: number }[] = []
  for (const v of fills.discover(f, n)) {
    if (pointInPolygon(at, polygon(loopParts(o, v.route)))) candidates.push({ id: v.id, area: walkArea(o, v.route) })
  }
  return candidates.sort((a, b) => a.area - b.area).map(c => c.id)
}

/**
 * The lines, as drawn, that a box from `a` to `b` takes: with `whole`, those lying entirely inside it;
 * otherwise those it touches at all (read-only, like `nearby`; which lines a tool keeps is the
 * interaction's). Curves are checked as fine polylines.
 */
export function linesInRect(n: net.NetworkState, j: joins.JoinsState, a: Vec, b: Vec, whole: boolean): Id[] {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y)
  const inside = (p: Vec) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1
  // a segment meets the box (Liang–Barsky clip)
  const meets = (p: Vec, q: Vec) => {
    let t0 = 0, t1 = 1
    const dx = q.x - p.x, dy = q.y - p.y
    for (const [pk, qk] of [[-dx, p.x - x0], [dx, x1 - p.x], [-dy, p.y - y0], [dy, y1 - p.y]] as const) {
      if (pk === 0) { if (qk < 0) return false; continue }
      const r = qk / pk
      if (pk < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r)
      if (t0 > t1) return false
    }
    return true
  }
  const o = outline(n, j)
  return net.lines(n).filter(l => {
    const pts = flatten(o.drawn.get(l.id)!, 32)
    return whole ? pts.every(inside) : pts.some((p, i) => i > 0 && meets(pts[i - 1]!, p))
  }).map(l => l.id)
}

/** One thing near a position (doc 22 §3.1): what it is, how far, and whether it is shown. */
export type Nearby =
  | { kind: 'point'; id: Id; distance: number; visible: boolean }
  | { kind: 'handle'; line: Id; end: net.End; distance: number; visible: boolean }
  /** `t`: the parameter on the line's own (untrimmed) curve, the one `split` takes (dot 1791543988). */
  | { kind: 'line'; id: Id; distance: number; t: number; visible: boolean }

/**
 * Everything within `radius` of `at`, nearest first (equal distances: points, then handles,
 * then lines): end points, handle tips, and lines
 * as drawn (an arc join's trim included). A line's `t` is on its own curve, for `split`. A read-only query
 * of geometry core already owns; which kind a tool picks, the tolerance and the order
 * among candidates are the interaction's (dot 1791543266). A point is shown when one
 * of its lines is.
 */
export function nearby(n: net.NetworkState, j: joins.JoinsState, at: Vec, radius: number): Nearby[] {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y) || !(radius >= 0)) throw new Error('nearby needs a finite position and a radius ≥ 0')
  const o = outline(n, j), out: Nearby[] = []
  const lines = net.lines(n), shown = new Map<Id, boolean>()
  for (const l of lines) for (const p of [l.a, l.b]) shown.set(p, (shown.get(p) ?? false) || l.state.visible)
  for (const p of net.points(n)) {
    const distance = length({ x: p.position.x - at.x, y: p.position.y - at.y })
    if (distance <= radius) out.push({ kind: 'point', id: p.id, distance, visible: shown.get(p.id) ?? false })
  }
  for (const l of lines) {
    for (const end of ['a', 'b'] as const) {
      const tip = add(net.point(n, end === 'a' ? l.a : l.b).position, end === 'a' ? l.ha : l.hb)
      const distance = length({ x: tip.x - at.x, y: tip.y - at.y })
      if (distance <= radius) out.push({ kind: 'handle', line: l.id, end, distance, visible: l.state.visible })
    }
    // distance to the line as drawn; the parameter is read back on its own curve, so a tool
    // can split there without knowing how an arc join trims it
    const near = nearest(o.drawn.get(l.id)!, at)
    if (near.distance <= radius) {
      const [t0, t1] = o.range.get(l.id)!
      out.push({ kind: 'line', id: l.id, distance: near.distance, t: t0 + near.t * (t1 - t0), visible: l.state.visible })
    }
  }
  return out.sort((x, y) => x.distance - y.distance)
}
