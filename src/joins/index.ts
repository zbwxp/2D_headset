// joins — attributes of a point: the join table (one row per pair of lines at the
// point, mode smooth / cusp / arc; no row = 仅绑定) and the end stroke (Q23, Q27).
// Smooth is a stiff spring toward a straight line; conflicts settle at a
// compromise and are never refused (bowen 1791421304).
import * as net from '../network'
import { angleOf, fromAngle, length } from '../geometry'

type Id = net.Id

export type JoinMode = 'smooth' | 'cusp' | 'arc'
export interface JoinRow { point: Id; lines: [Id, Id]; mode: JoinMode; radius?: number }
export interface EndStroke { taper?: number; [key: string]: number | string | undefined }
declare const opaque: unique symbol
/** Opaque handle; read through rows / rowsAt / endStroke (copies). */
export type JoinsState = { readonly [opaque]: 'joins' }
interface Store { rows: JoinRow[]; endStrokes: { point: Id; stroke: EndStroke }[] }
const S = (j: JoinsState) => j as unknown as Store
const rowCopy = (r: JoinRow): JoinRow => ({ point: r.point, lines: [r.lines[0], r.lines[1]], mode: r.mode, ...(r.radius !== undefined ? { radius: r.radius } : {}) })

/** One global stiffness (bowen 1791421988). With only spring forces it scales energy, not the balance. */
export const SMOOTH_STIFFNESS = 1

export const create = (): JoinsState => ({ rows: [], endStrokes: [] }) as Store as unknown as JoinsState
const pair = (a: Id, b: Id): [Id, Id] => (a < b ? [a, b] : [b, a])
// Rows are kept in one canonical order, so the result never depends on the order joins were set.
const rowKey = (r: JoinRow) => JSON.stringify([r.point, r.lines[0], r.lines[1]])
const sortRows = (j: JoinsState) => { S(j).rows.sort((a, b) => (rowKey(a) < rowKey(b) ? -1 : rowKey(a) > rowKey(b) ? 1 : 0)) }
const same = (r: JoinRow, point: Id, p: [Id, Id]) => r.point === point && r.lines[0] === p[0] && r.lines[1] === p[1]

export const rows = (j: JoinsState): JoinRow[] => S(j).rows.map(rowCopy)
export const rowsAt = (j: JoinsState, point: Id): JoinRow[] => S(j).rows.filter(r => r.point === point).map(rowCopy)
export function endStroke(j: JoinsState, point: Id): EndStroke | undefined {
  const e = S(j).endStrokes.find(x => x.point === point)
  return e ? { ...e.stroke } : undefined
}

export function setJoin(j: JoinsState, n: net.NetworkState, point: Id, l1: Id, l2: Id, opts: { mode: JoinMode; radius?: number }) {
  if (opts.mode !== 'smooth' && opts.mode !== 'cusp' && opts.mode !== 'arc') throw new Error(`Unknown join mode ${String(opts.mode)}`)
  if (l1 === l2) throw new Error('A join needs two different lines')
  const at = new Set(net.linesAt(n, point).map(e => e.line.id))
  if (!at.has(l1) || !at.has(l2)) throw new Error(`Both lines must end at ${point}`)
  if (opts.mode === 'arc' && !(opts.radius && opts.radius > 0)) throw new Error('An arc join needs a positive radius')
  const p = pair(l1, l2)
  S(j).rows = S(j).rows.filter(r => !same(r, point, p))
  S(j).rows.push({ point, lines: p, mode: opts.mode, ...(opts.mode === 'arc' ? { radius: opts.radius } : {}) })
  sortRows(j)
}

export function removeJoin(j: JoinsState, point: Id, l1: Id, l2: Id) {
  const p = pair(l1, l2)
  S(j).rows = S(j).rows.filter(r => !same(r, point, p))
}

export function setEndStroke(j: JoinsState, n: net.NetworkState, point: Id, stroke: EndStroke) {
  net.point(n, point)
  for (const v of Object.values(stroke)) {
    if (typeof v === 'number' ? !Number.isFinite(v) : typeof v !== 'string' && v !== undefined) throw new Error('End stroke values must be finite numbers or strings')
  }
  S(j).endStrokes = S(j).endStrokes.filter(e => e.point !== point)
  // its parameters are unordered: stored with sorted keys, so one content has one form (bowen 1791461643)
  S(j).endStrokes.push({ point, stroke: Object.fromEntries(Object.keys(stroke).sort().map(k => [k, stroke[k]])) as EndStroke })
}

/** Remove a point's end stroke (it then has none). */
export function clearEndStroke(j: JoinsState, point: Id) {
  S(j).endStrokes = S(j).endStrokes.filter(e => e.point !== point)
}

/** The joins and end strokes inside a copied range, as plain data. */
export function rangeData(j: JoinsState, lines: ReadonlySet<Id>, points: ReadonlySet<Id>): { rows: JoinRow[]; endStrokes: { point: Id; stroke: EndStroke }[] } {
  return {
    rows: S(j).rows.filter(r => points.has(r.point) && lines.has(r.lines[0]) && lines.has(r.lines[1])).map(rowCopy),
    endStrokes: S(j).endStrokes.filter(e => points.has(e.point)).map(e => ({ point: e.point, stroke: { ...e.stroke } })),
  }
}

/** Joins and end strokes from plain data, onto the copied points and lines of `map`. */
export function insert(j: JoinsState, n: net.NetworkState, data: { rows: JoinRow[]; endStrokes: { point: Id; stroke: EndStroke }[] }, map: net.CopyMap) {
  // through the normal writers, so a clip from outside gets the same checks and stored form
  for (const r of data.rows) {
    const point = map.points.get(r.point), l0 = map.lines.get(r.lines[0]), l1 = map.lines.get(r.lines[1])
    if (point && l0 && l1) setJoin(j, n, point, l0, l1, { mode: r.mode, ...(r.radius !== undefined ? { radius: r.radius } : {}) })
  }
  for (const e of data.endStrokes) { const point = map.points.get(e.point); if (point) setEndStroke(j, n, point, e.stroke) }
}

/** Keep references valid after one network operation. */
export function update(j: JoinsState, n: net.NetworkState, ch: net.Changes) {
  for (const r of ch.replaced) {
    for (const row of S(j).rows) {
      if (row.point === r.a) row.lines = pair(...row.lines.map(l => (l === r.line ? r.pieces[0] : l)) as [Id, Id])
      if (row.point === r.b) row.lines = pair(...row.lines.map(l => (l === r.line ? r.pieces[1] : l)) as [Id, Id])
    }
  }
  for (const u of ch.unbound) {
    const moved = new Set(u.lines)
    S(j).rows = S(j).rows.flatMap(row => {
      if (row.point !== u.point) return [row]
      const m = row.lines.filter(l => moved.has(l)).length
      return m === 0 ? [row] : m === 2 ? [{ ...row, point: u.newPoint }] : []
    })
  }
  const gone = new Set([...ch.deletedLines, ...ch.collapsedLines])
  const deadPoints = new Set(ch.deletedPoints)
  // Q23: the removed point's joins are dropped with it (a deleted point).
  S(j).rows = S(j).rows.filter(row => !deadPoints.has(row.point) && !row.lines.some(l => gone.has(l)))
  S(j).endStrokes = S(j).endStrokes.filter(e => !deadPoints.has(e.point))
  // Safety: every row's lines must still end at its point.
  S(j).rows = S(j).rows.filter(row => {
    if (!net.hasPoint(n, row.point)) return false
    const at = new Set(net.linesAt(n, row.point).map(e => e.line.id))
    return at.has(row.lines[0]) && at.has(row.lines[1])
  })
  sortRows(j)
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/**
 * Smooth springs. Energy per smooth pair = (deviation of the two handle
 * directions from straight-opposite)², angles only, lengths kept. Solved only at
 * the points this edit acted on, so an unrelated edit never turns anything.
 * Held handles (dragged in this edit, or the first-clicked side of a new join)
 * keep their direction.
 *
 * Rule: smooth first, then least turning (bowen 1791429291). First the smooth
 * balance (coordinate descent); then a group with no held handle is turned as a
 * whole so the squared turning of its handles is least — it spreads but does not
 * spin. This approximates bowen's picture of each handle also held by its own
 * curve (1791429195); it is a chosen rule, not a claim of physical necessity.
 * Returns handle updates.
 */
/** One handle: the end of a line. */
export interface HandleRef { line: Id; end: net.End }

export function solve(
  j: JoinsState, n: net.NetworkState, ch: net.Changes,
  /** Smooth pairs that are not on one point (joins across an endpoint link), from the links module. */
  extra: { a: HandleRef; b: HandleRef }[] = [],
): { line: Id; end: net.End; offset: { x: number; y: number } }[] {
  const lines = new Map(net.lines(n).map(l => [l.id, l]))
  const key = (h: HandleRef) => JSON.stringify([h.line, h.end])
  const refs = new Map<string, HandleRef>()
  const neighbours = new Map<string, string[]>()
  const connect = (a: HandleRef, b: HandleRef) => {
    for (const h of [a, b]) { refs.set(key(h), h); if (!neighbours.has(key(h))) neighbours.set(key(h), []) }
    neighbours.get(key(a))!.push(key(b)); neighbours.get(key(b))!.push(key(a))
  }
  for (const r of S(j).rows) if (r.mode === 'smooth') {
    const ends = r.lines.map(l => ({ line: l, end: (lines.get(l)!.a === r.point ? 'a' : 'b') as net.End }))
    connect(ends[0]!, ends[1]!)
  }
  for (const p of extra) connect(p.a, p.b)
  const handleOf = (h: HandleRef) => net.handle(lines.get(h.line)!, h.end)
  const pointOf = (h: HandleRef) => (h.end === 'a' ? lines.get(h.line)!.a : lines.get(h.line)!.b)
  const affected = net.affectedPoints(n, ch)
  const heldKeys = new Set(net.heldIn(ch, n).filter(h => lines.has(h.line)).map(h => key(h)))
  const out: { line: Id; end: net.End; offset: { x: number; y: number } }[] = []
  // Zero-length handles have no direction and take no part; groups are formed only
  // from the constraints that actually take part (dot 1791431206).
  const live = [...refs.keys()].filter(k => length(handleOf(refs.get(k)!)) > 1e-9)
  const liveSet = new Set(live)
  const liveNeighbours = new Map(live.map(k => [k, neighbours.get(k)!.filter(o => liveSet.has(o))]))
  for (const ids of smoothGroups(live, liveNeighbours)) {
    if (!ids.some(k => affected.has(pointOf(refs.get(k)!)))) continue // only where this edit acted
    if (ids.length < 2) continue
    const theta = new Map(ids.map(k => [k, angleOf(handleOf(refs.get(k)!))]))
    const before = new Map(theta)
    const free = ids.filter(k => !heldKeys.has(k))
    for (let sweep = 0; sweep < 2000; sweep++) {
      let change = 0
      for (const k of free) {
        const nb = liveNeighbours.get(k)!
        if (!nb.length) continue
        const t = theta.get(k)!
        const step = nb.reduce((s, o) => s + wrap(theta.get(o)! + Math.PI - t), 0) / nb.length
        theta.set(k, t + step)
        change = Math.max(change, Math.abs(step))
      }
      if (change < 1e-13) break
    }
    // Least turning: a group with nothing held keeps zero mean turning.
    if (!ids.some(k => heldKeys.has(k))) {
      const mean = ids.reduce((s, k) => s + wrap(theta.get(k)! - before.get(k)!), 0) / ids.length
      for (const k of ids) theta.set(k, theta.get(k)! - mean)
    }
    for (const k of free) {
      const ref = refs.get(k)!, h = handleOf(ref)
      const next = fromAngle(theta.get(k)!, length(h))
      if (Math.abs(next.x - h.x) > 1e-12 || Math.abs(next.y - h.y) > 1e-12) out.push({ line: ref.line, end: ref.end, offset: next })
    }
  }
  return out
}

/** Handles linked by smooth rows, as connected groups. */
function smoothGroups(ids: string[], neighbours: Map<string, string[]>): string[][] {
  const seen = new Set<string>(), groups: string[][] = []
  for (const start of ids) {
    if (seen.has(start)) continue
    const group: string[] = [], stack = [start]
    seen.add(start)
    while (stack.length) {
      const id = stack.pop()!
      group.push(id)
      for (const o of neighbours.get(id) ?? []) if (!seen.has(o)) { seen.add(o); stack.push(o) }
    }
    groups.push(group)
  }
  return groups
}

/** Joins from saved data, checked: each row on two different lines that both end at its point, a known mode, a positive radius for an arc; end strokes on existing points. */
export function restore(v: unknown, n: net.NetworkState): JoinsState {
  const d = net.data, o = d.obj(v, 'joins')
  const rows = d.arr(o.rows, 'join rows').map((x, i): JoinRow => {
    const R = d.obj(x, `join ${i}`), point = d.str(R.point, `join ${i} point`)
    const ls = d.arr(R.lines, `join ${i} lines`)
    if (ls.length !== 2) d.fail(`join ${i} does not have two lines`)
    const l0 = d.str(ls[0], `join ${i} line`), l1 = d.str(ls[1], `join ${i} line`)
    if (l0 === l1) d.fail(`join ${i} uses one line twice`)
    for (const l of [l0, l1]) { if (!net.hasLine(n, l)) d.fail(`join ${i} uses a missing line ${l}`); const x2 = net.line(n, l); if (x2.a !== point && x2.b !== point) d.fail(`join ${i}: line ${l} does not end at ${point}`) }
    const m = d.str(R.mode, `join ${i} mode`)
    if (m !== 'smooth' && m !== 'cusp' && m !== 'arc') d.fail(`join ${i} has an unknown mode ${m}`)
    const mode = m as JoinMode
    const radius = R.radius === undefined ? undefined : d.num(R.radius, `join ${i} radius`)
    if (radius !== undefined && !(radius > 0)) d.fail(`join ${i} radius is not positive`)
    return { point, lines: [l0, l1], mode, ...(radius !== undefined ? { radius } : {}) }
  })
  const endStrokes = d.arr(o.endStrokes, 'end strokes').map((x, i) => {
    const E = d.obj(x, `end stroke ${i}`), point = d.str(E.point, `end stroke ${i} point`)
    if (!net.hasPoint(n, point)) d.fail(`end stroke ${i} is on a missing point`)
    const stroke = d.obj(E.stroke, `end stroke ${i} stroke`)
    for (const [k, val] of Object.entries(stroke)) if (typeof val !== 'string') d.num(val, `end stroke ${i} ${k}`)
    return { point, stroke: stroke as EndStroke }
  })
  // Written again through the normal writers, so restoring shares their parameter checks and
  // their one stored form; the result must equal the file, or the file holds a reversed pair,
  // a repeat, or a value the writers would not accept (dot 1791512476).
  const st = create()
  try {
    for (const r of rows) setJoin(st, n, r.point, r.lines[0], r.lines[1], { mode: r.mode, ...(r.radius !== undefined ? { radius: r.radius } : {}) })
    for (const e of endStrokes) setEndStroke(st, n, e.point, e.stroke)
  } catch (err) { d.fail(`joins: ${(err as Error).message}`) }
  if (JSON.stringify(S(st)) !== JSON.stringify({ rows, endStrokes })) d.fail('joins are not in their stored form (a reversed line pair, a repeat, or an extra value)')
  return st
}
