// derived — the final geometric outline (Q27): centre lines after joins (an arc
// join trims both lines and inserts an arc). Lines and fills read the same
// result, so they cannot disagree. Stroke width, taper, blur and show/hide never
// change it. How a fill joins at a fork where an arc sits on another pair of
// lines is still open (dot 1791425335); here such a line end is left untrimmed
// for that fill.
import * as net from '../network'
import * as joins from '../joins'
import * as fills from '../fills'
import { type Cubic, type Vec, arcLength, tAtLength, subCurve, cornerArc, flatten, polygonArea, pointInPolygon } from '../geometry'

type Id = net.Id

export interface Part { key: string; curve: Cubic }
export interface Geometry {
  lines: { id: Id; key: string; curve: Cubic }[]
  arcs: { key: string; point: Id; lines: [Id, Id]; curve: Cubic }[]
  fills: { id: Id; color: string; visible: boolean; parts: Part[] }[]
}

const reverse = (c: Cubic): Cubic => [c[3], c[2], c[1], c[0]]
const arcKey = (point: Id, lines: [Id, Id]) => `arc:${point}:${lines[0]}|${lines[1]}`

interface Outline {
  n: net.NetworkState
  /** Trim distance at a line end, `${line}:${end}`; set only where an arc join sits. */
  trim: Map<string, number>
  /** A line's curve with the given trims at its a and b ends. */
  piece: (line: Id, ta: number, tb: number) => Cubic
  /** The drawn (fully trimmed) curve of each line. */
  drawn: Map<Id, Cubic>
  arcByKey: Map<string, Geometry['arcs'][number]>
}

export function derive(n: net.NetworkState, j: joins.JoinsState, f: fills.FillsState): Geometry {
  const o = outline(n, j)
  const lines = n.lines.map(l => ({ id: l.id, key: `line:${l.id}`, curve: o.drawn.get(l.id)! }))
  const fillGeometry = fills.discover(f, n).filter(v => v.filled)
    .map(v => ({ id: v.id, color: v.color!, visible: v.visible!, parts: fillParts(o, v.route) }))
  return { lines, arcs: [...o.arcByKey.values()], fills: fillGeometry }
}

/** Trims and arcs from the arc joins; the drawn curve of every line. */
function outline(n: net.NetworkState, j: joins.JoinsState): Outline {
  const full = new Map(n.lines.map(l => [l.id, net.curve(n, l.id)]))
  const len = new Map(n.lines.map(l => [l.id, arcLength(full.get(l.id)!)]))
  const endAt = (line: Id, point: Id): net.End => (net.line(n, line).a === point ? 'a' : 'b')
  const arcRows = j.rows.filter(r => r.mode === 'arc')
  // The trim at a line end is the largest arc radius there, at most 45% of the line.
  const trim = new Map<string, number>()
  for (const r of arcRows) for (const l of r.lines) {
    const key = `${l}:${endAt(l, r.point)}`
    trim.set(key, Math.min(Math.max(trim.get(key) ?? 0, r.radius!), 0.45 * len.get(l)!))
  }
  const piece = (id: Id, ta: number, tb: number): Cubic => {
    const c = full.get(id)!, L = len.get(id)!
    return subCurve(c, ta > 0 ? tAtLength(c, ta) : 0, tb > 0 ? tAtLength(c, L - tb) : 1)
  }
  const drawn = new Map(n.lines.map(l => [l.id, piece(l.id, trim.get(`${l.id}:a`) ?? 0, trim.get(`${l.id}:b`) ?? 0)]))
  const endPoint = (id: Id, end: net.End) => (end === 'a' ? drawn.get(id)![0] : drawn.get(id)![3])
  const arcByKey = new Map(arcRows.map(r => {
    const [l1, l2] = r.lines
    const curve = cornerArc(endPoint(l1, endAt(l1, r.point)), net.point(n, r.point).position, endPoint(l2, endAt(l2, r.point)))
    return [arcKey(r.point, r.lines), { key: arcKey(r.point, r.lines), point: r.point, lines: r.lines, curve }] as const
  }))
  return { n, trim, piece, drawn, arcByKey }
}

/**
 * A filled loop's boundary, walking its route. Between two consecutive lines, if
 * an arc join sits on exactly that pair, the arc is part of the boundary. A line
 * uses its drawn curve when its trims match the arcs this loop passes through;
 * otherwise (an arc on another pair at a fork) that end is left untrimmed.
 */
function fillParts(o: Outline, route: net.LoopUse[]): Part[] {
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
    const trimA = o.trim.get(`${u.line}:a`) ?? 0, trimB = o.trim.get(`${u.line}:b`) ?? 0
    const matchesDrawn = (trimA > 0) === roundA && (trimB > 0) === roundB
    const curve = matchesDrawn ? o.drawn.get(u.line)! : o.piece(u.line, roundA ? trimA : 0, roundB ? trimB : 0)
    const lineEnd = u.reversed ? curve[0] : curve[3]
    parts.push({ key: matchesDrawn ? `line:${u.line}` : `line:${u.line}:fill`, curve: u.reversed ? reverse(curve) : curve })
    if (after) parts.push({ key: after.key, curve: same(after.curve[0], lineEnd) ? after.curve : reverse(after.curve) })
  })
  return parts
}

const same = (a: Vec, b: Vec) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9

/** Canvas fill pick: the smallest loop containing the point (bowen 1791390533). */
export function pickLoop(n: net.NetworkState, j: joins.JoinsState, f: fills.FillsState, at: Vec): Id | undefined {
  const g = derive(n, j, f)
  const outline = (parts: Part[]) => parts.flatMap(p => flatten(p.curve).slice(0, -1))
  const candidates: { id: Id; area: number }[] = []
  for (const v of fills.discover(f, n)) {
    const filled = g.fills.find(x => x.id === v.id)
    const poly = filled ? outline(filled.parts) : outline(v.route.map(u => {
      const c = g.lines.find(l => l.id === u.line)!.curve
      return { key: '', curve: u.reversed ? reverse(c) : c }
    }))
    if (pointInPolygon(at, poly)) candidates.push({ id: v.id, area: Math.abs(polygonArea(poly)) })
  }
  return candidates.sort((a, b) => a.area - b.area)[0]?.id
}
