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

export function derive(n: net.NetworkState, j: joins.JoinsState, f: fills.FillsState): Geometry {
  const arcRows = j.rows.filter(r => r.mode === 'arc')
  // Trim distance at each line end = the largest arc radius on that end (clamped).
  const trim = new Map<string, number>() // `${line}:${end}`
  const full = new Map(n.lines.map(l => [l.id, net.curve(n, l.id)]))
  const len = new Map(n.lines.map(l => [l.id, arcLength(full.get(l.id)!)]))
  const endAt = (line: Id, point: Id): net.End => (net.line(n, line).a === point ? 'a' : 'b')
  for (const r of arcRows) for (const l of r.lines) {
    const key = `${l}:${endAt(l, r.point)}`
    trim.set(key, Math.min(Math.max(trim.get(key) ?? 0, r.radius!), 0.45 * len.get(l)!))
  }
  const piece = (id: Id, ta: number, tb: number): Cubic => {
    const c = full.get(id)!, L = len.get(id)!
    return subCurve(c, ta > 0 ? tAtLength(c, ta) : 0, tb > 0 ? tAtLength(c, L - tb) : 1)
  }
  const lines = n.lines.map(l => ({ id: l.id, key: `line:${l.id}`, curve: piece(l.id, trim.get(`${l.id}:a`) ?? 0, trim.get(`${l.id}:b`) ?? 0) }))
  const drawn = new Map(lines.map(l => [l.id, l.curve]))
  const endPoint = (id: Id, end: net.End) => (end === 'a' ? drawn.get(id)![0] : drawn.get(id)![3])
  const arcs = arcRows.map(r => {
    const [l1, l2] = r.lines
    const curve = cornerArc(endPoint(l1, endAt(l1, r.point)), net.point(n, r.point).position, endPoint(l2, endAt(l2, r.point)))
    return { key: arcKey(r.point, r.lines), point: r.point, lines: r.lines, curve }
  })
  const arcByKey = new Map(arcs.map(a => [a.key, a]))

  const fillGeometry = fills.discover(f, n).filter(v => v.filled).map(v => {
    const route = v.route, parts: Part[] = []
    const atStart = (u: net.LoopUse) => { const l = net.line(n, u.line); return u.reversed ? l.b : l.a }
    const usesArc = (i: number) => { // arc between route[i] and route[i+1]
      const u = route[i]!, w = route[(i + 1) % route.length]!
      const point = atStart(w)
      const ls: [Id, Id] = u.line < w.line ? [u.line, w.line] : [w.line, u.line]
      return arcByKey.get(arcKey(point, ls))
    }
    route.forEach((u, i) => {
      const before = usesArc((i - 1 + route.length) % route.length), after = usesArc(i)
      const startEnd: net.End = u.reversed ? 'b' : 'a', finishEnd: net.End = u.reversed ? 'a' : 'b'
      const trimmedStart = (trim.get(`${u.line}:${startEnd}`) ?? 0) > 0, trimmedFinish = (trim.get(`${u.line}:${finishEnd}`) ?? 0) > 0
      let curve: Cubic, key: string
      if (trimmedStart === !!before && trimmedFinish === !!after) {
        curve = drawn.get(u.line)!; key = `line:${u.line}`
      } else {
        const ta = (u.reversed ? !!after : !!before) ? trim.get(`${u.line}:a`) ?? 0 : 0
        const tb = (u.reversed ? !!before : !!after) ? trim.get(`${u.line}:b`) ?? 0 : 0
        curve = piece(u.line, ta, tb); key = `line:${u.line}:fill`
      }
      parts.push({ key, curve: u.reversed ? reverse(curve) : curve })
      if (after) {
        const forward = after.lines[0] === u.line ? after.curve : reverse(after.curve)
        // arc stored l1→l2 (sorted ids); orient it from u to the next line
        const fromU = endPoint(u.line, finishEnd)
        parts.push({ key: after.key, curve: same(forward[0], fromU) ? forward : reverse(forward) })
      }
    })
    return { id: v.id, color: v.color!, visible: v.visible!, parts }
  })
  return { lines, arcs, fills: fillGeometry }
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
