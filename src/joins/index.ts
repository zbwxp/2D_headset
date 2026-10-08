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
  S(j).endStrokes.push({ point, stroke: { ...stroke } })
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
 * Physically each handle is also held by its own curve, a soft spring toward its
 * direction before the edit (bowen 1791429195). With the smooth springs far
 * stiffer, the result is the limit: first the smooth balance (coordinate
 * descent), then a group with no held handle is turned as a whole so that the
 * squared turning of its handles is least — it spreads but does not spin.
 * Returns handle updates.
 */
export function solve(j: JoinsState, n: net.NetworkState, ch: net.Changes): { line: Id; end: net.End; offset: { x: number; y: number } }[] {
  const out: { line: Id; end: net.End; offset: { x: number; y: number } }[] = []
  const affected = net.affectedPoints(n, ch)
  const points = [...new Set(S(j).rows.filter(r => r.mode === 'smooth').map(r => r.point))].filter(p => affected.has(p))
  for (const p of points) {
    const ends = new Map(net.linesAt(n, p).map(e => [e.line.id, e]))
    const rows = rowsAt(j, p).filter(r => r.mode === 'smooth')
    const ids = [...new Set(rows.flatMap(r => r.lines))].filter(id => length(net.handle(ends.get(id)!.line, ends.get(id)!.end)) > 1e-9)
    if (ids.length < 2) continue
    const theta = new Map(ids.map(id => [id, angleOf(net.handle(ends.get(id)!.line, ends.get(id)!.end))]))
    const before = new Map(theta)
    const held = new Set(ch.held.filter(h => ends.get(h.line)?.end === h.end).map(h => h.line))
    const neighbours = new Map(ids.map(id => [id, rows.filter(r => r.lines.includes(id)).map(r => (r.lines[0] === id ? r.lines[1] : r.lines[0])).filter(o => theta.has(o))]))
    const free = ids.filter(id => !held.has(id))
    for (let sweep = 0; sweep < 2000; sweep++) {
      let change = 0
      for (const id of free) {
        const nb = neighbours.get(id)!
        if (!nb.length) continue
        const t = theta.get(id)!
        const step = nb.reduce((s, o) => s + wrap(theta.get(o)! + Math.PI - t), 0) / nb.length
        theta.set(id, t + step)
        change = Math.max(change, Math.abs(step))
      }
      if (change < 1e-13) break
    }
    // Curve springs in the stiff-smooth limit: a group with nothing held keeps zero mean turning.
    for (const group of smoothGroups(ids, neighbours)) {
      if (group.some(id => held.has(id))) continue
      const mean = group.reduce((s, id) => s + wrap(theta.get(id)! - before.get(id)!), 0) / group.length
      for (const id of group) theta.set(id, theta.get(id)! - mean)
    }
    for (const id of free) {
      const e = ends.get(id)!, h = net.handle(e.line, e.end)
      const next = fromAngle(theta.get(id)!, length(h))
      if (Math.abs(next.x - h.x) > 1e-12 || Math.abs(next.y - h.y) > 1e-12) out.push({ line: id, end: e.end, offset: next })
    }
  }
  return out
}

/** Handles linked by smooth rows, as connected groups. */
function smoothGroups(ids: Id[], neighbours: Map<Id, Id[]>): Id[][] {
  const seen = new Set<Id>(), groups: Id[][] = []
  for (const start of ids) {
    if (seen.has(start)) continue
    const group: Id[] = [], stack = [start]
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

