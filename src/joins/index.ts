// joins — attributes of a point: the join table (one row per pair of lines at the
// point, mode bound / smooth / cusp / arc; no row = the lines only share the point) and the
// end stroke (Q23, Q27). 'bound' (仅绑定) is a join like the others (bowen 1791808359 /
// 1791808493): made by the step that connects two lines as one (a pen continuing, a bind of two
// free ends, a split — docs/j1-joins-checklist.md §2), it constrains nothing in the shape.
// A point's rows form an ordered list, top first: the order is the precedence when joins share
// a line end (bowen 1791810865 / 1791810907); a new pair goes on top.
// Smooth is a stiff spring toward a straight line; conflicts settle at a
// compromise and are never refused (bowen 1791421304).
import * as net from '../network'
import { angleOf, fromAngle, length } from '../geometry'

type Id = net.Id

export type JoinMode = 'bound' | 'smooth' | 'cusp' | 'arc'
const isMode = (m: unknown): m is JoinMode => m === 'bound' || m === 'smooth' || m === 'cusp' || m === 'arc'
/**
 * A join row: an arc carries its radius (bowen 1791985326); any join may carry a manual
 * transition-zone length (absent = automatic, from the two widths — principle §4). Both are one
 * value for every view (bowen 1792057731).
 */
export interface JoinRow { point: Id; lines: [Id, Id]; mode: JoinMode; radius?: number; zone?: number }
/**
 * A point's end stroke as stored and read: an open dictionary of finite numbers and text, no undefined
 * value (ledger row 10 closed); `taper` is a number, 0 or more.
 */
export type EndStroke = { [key: string]: number | string }
/** An end stroke as given: an undefined value is left out. */
export type EndStrokeIn = { [key: string]: number | string | undefined }
declare const opaque: unique symbol
/** Opaque handle; read through rows / rowsAt / endStroke (copies). */
export type JoinsState = { readonly [opaque]: 'joins' }
/**
 * Everything here is shared by every view, the same at every view and pose: the modes, an arc's
 * radius (bowen 1791985326; docs/arc-radius-shared-checklist.md), a manual zone in its row and the
 * points' end strokes (bowen 1792057731; docs/shared-strokes-checklist.md, replacing step 4's
 * per-layer zones and end strokes).
 */
interface Row { point: Id; lines: [Id, Id]; mode: JoinMode; radius?: number; zone?: number }
interface Store { rows: Row[]; ends: Record<Id, Record<string, number | string>> }
const S = (j: JoinsState) => j as unknown as Store

/** One global stiffness (bowen 1791421988). With only spring forces it scales energy, not the balance. */
export const SMOOTH_STIFFNESS = 1

export const create = (): JoinsState => ({ rows: [], ends: {} }) as Store as unknown as JoinsState
const pair = (a: Id, b: Id): [Id, Id] => (a < b ? [a, b] : [b, a])
/** The stored key of a row: its point and its two lines in sorted order. */
export const rowKey = (point: Id, l1: Id, l2: Id) => { const p = pair(l1, l2); return JSON.stringify([point, p[0], p[1]]) }
const keyOf = (r: Row) => JSON.stringify([r.point, r.lines[0], r.lines[1]])
// The rows' order is state: each point's rows, in array order, are its join list (top first).
// Readers that must not depend on it (the smooth solve) use a canonical copy.
const canonical = (rows: readonly Row[]) => [...rows].sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0))
/** Insert a row on top of its point's list. */
const putOnTop = (list: Row[], item: Row) => {
  const i = list.findIndex(x => x.point === item.point)
  if (i < 0) list.push(item)
  else list.splice(i, 0, item)
}
const same = (r: Row, point: Id, p: [Id, Id]) => r.point === point && r.lines[0] === p[0] && r.lines[1] === p[1]
const own = <T>(r: Record<string, T>, id: string): T | undefined => (Object.hasOwn(r, id) ? r[id] : undefined)
const put = <T>(r: Record<string, T>, id: string, v: T) => { Object.defineProperty(r, id, { value: v, writable: true, enumerable: true, configurable: true }) }

const rowOut = (r: Row): JoinRow => {
  const radius = r.mode === 'arc' ? r.radius : undefined
  return { point: r.point, lines: [r.lines[0], r.lines[1]], mode: r.mode, ...(radius !== undefined ? { radius } : {}), ...(r.zone !== undefined ? { zone: r.zone } : {}) }
}
/** Every row, with its radius and zone; each point's rows in list order (top first). */
export const rows = (j: JoinsState, _n?: net.NetworkState): JoinRow[] => S(j).rows.map(rowOut)
/** A point's join list, top first. */
export const rowsAt = (j: JoinsState, _n: net.NetworkState | undefined, point: Id): JoinRow[] => S(j).rows.filter(r => r.point === point).map(rowOut)
/** The join that governs a line's end at a point: the topmost row there containing the line (principle §2.3), or undefined. */
export function governing(j: JoinsState, _n: net.NetworkState | undefined, point: Id, line: Id): JoinRow | undefined {
  const r = S(j).rows.find(x => x.point === point && (x.lines[0] === line || x.lines[1] === line))
  return r ? rowOut(r) : undefined
}
/** The rows' shared part (point, lines, mode), the same in every layer. */
export const modes = (j: JoinsState): { point: Id; lines: [Id, Id]; mode: JoinMode }[] => S(j).rows.map(r => ({ point: r.point, lines: [r.lines[0], r.lines[1]], mode: r.mode }))
/** The end stroke at a point, one for every view. */
export function endStroke(j: JoinsState, _n: net.NetworkState | undefined, point: Id): EndStroke | undefined {
  const e = own(S(j).ends, point)
  return e ? { ...e } : undefined
}
/** Every point that has an end stroke. */
export const endPoints = (j: JoinsState): Id[] => Object.keys(S(j).ends)

/**
 * Set a join. The mode and an arc's radius belong to the row, so they are set for every view at
 * once, from whichever view (bowen 1791985326). Any other mode drops the radius.
 */
export function setJoin(j: JoinsState, n: net.NetworkState, point: Id, l1: Id, l2: Id, opts: { mode: JoinMode; radius?: number }) {
  if (!isMode(opts.mode)) throw new Error(`Unknown join mode ${String(opts.mode)}`)
  if (l1 === l2) throw new Error('A join needs two different lines')
  const at = new Set(net.linesAt(n, point).map(e => e.line.id))
  if (!at.has(l1) || !at.has(l2)) throw new Error(`Both lines must end at ${point}`)
  if (opts.mode === 'arc' && !(typeof opts.radius === 'number' && Number.isFinite(opts.radius) && opts.radius > 0)) throw new Error('An arc join needs a positive radius')
  const p = pair(l1, l2), i = S(j).rows.findIndex(r => same(r, point, p))
  // the zone belongs to every mode, so changing the mode keeps it (dot 1791811393)
  const zone = i >= 0 ? S(j).rows[i]!.zone : undefined
  const next: Row = { point, lines: p, mode: opts.mode, ...(opts.mode === 'arc' ? { radius: opts.radius! } : {}), ...(zone !== undefined ? { zone } : {}) }
  // a pair that has a row changes in place (its place in the list stays); a new pair goes on top
  if (i >= 0) S(j).rows[i] = next
  else putOnTop(S(j).rows, next)
}

/**
 * Reorder a point's join list (bowen drags it, 1791810865): `pairs` lists exactly that point's
 * joins, top first. Only their order changes.
 */
export function orderJoins(j: JoinsState, point: Id, pairs: readonly (readonly [Id, Id])[]) {
  const at = S(j).rows.map((r, i) => ({ r, i })).filter(x => x.r.point === point)
  const want = pairs.map(([a, b]) => pair(a, b))
  const keys = new Set(want.map(p => JSON.stringify(p)))
  if (want.length !== at.length || keys.size !== want.length || !at.every(x => keys.has(JSON.stringify(x.r.lines)))) throw new Error(`The order must list exactly the joins at ${point}`)
  const byKey = new Map(at.map(x => [JSON.stringify(x.r.lines), x.r]))
  want.forEach((p, k) => { S(j).rows[at[k]!.i] = byKey.get(JSON.stringify(p))! })
}

/**
 * The automatic transition-zone length for the two lines' full widths: wider² / narrower (bowen
 * 1791809660, a default he can change). The desired length; the ink limits it by the lines' lengths.
 */
export function autoZone(a: number, b: number): number {
  const wide = Math.max(a, b), narrow = Math.min(a, b)
  return wide * wide / narrow
}

/**
 * A join's manual transition-zone length, one for every view (bowen 1792057731, replacing the per-view
 * zone of bowen 1791810585); null sets it automatic. The zone belongs to every mode, so changing the
 * mode keeps it (dot 1791811393).
 */
export function setZone(j: JoinsState, point: Id, l1: Id, l2: Id, length: number | null) {
  const p = pair(l1, l2), r = S(j).rows.find(r => same(r, point, p))
  if (!r) throw new Error(`No join at ${point} between ${l1} and ${l2}`)
  if (length === null) { delete r.zone; return }
  if (typeof length !== 'number' || !Number.isFinite(length) || !(length > 0)) throw new Error('A transition-zone length must be a finite number above zero')
  r.zone = length
}

/** Remove a join: the row, its radius and zone with it. */
export function removeJoin(j: JoinsState, point: Id, l1: Id, l2: Id) {
  const p = pair(l1, l2)
  S(j).rows = S(j).rows.filter(r => !same(r, point, p))
}

/**
 * An end stroke in its stored form, checked: finite numbers or text, `taper` a number 0 or more (a
 * multiple of the end width, bowen 1791853511); undefined values left out; keys sorted, so one content
 * has one form (bowen 1791461643).
 */
export function endIn(stroke: EndStrokeIn): Record<string, number | string> {
  if (!stroke || typeof stroke !== 'object' || Array.isArray(stroke)) throw new Error('An end stroke must be an object')
  const out: Record<string, number | string> = {}
  for (const k of Object.keys(stroke).sort()) {
    const x = stroke[k]
    if (x === undefined) continue
    if (typeof x === 'number' ? !Number.isFinite(x) : typeof x !== 'string') throw new Error('End stroke values must be finite numbers or strings')
    if (k === 'taper' && (typeof x !== 'number' || x < 0)) throw new Error('An end taper must be a number, 0 or more (a multiple of the end width)')
    put(out, k, x)
  }
  return out
}

/** The end stroke at a point, one for every view (bowen 1792057731). */
export function setEndStroke(j: JoinsState, n: net.NetworkState, point: Id, stroke: EndStrokeIn) {
  net.point(n, point)
  put(S(j).ends, point, endIn(stroke))
}

/** Remove a point's end stroke (it then has none, in every view). */
export function clearEndStroke(j: JoinsState, point: Id) { if (Object.hasOwn(S(j).ends, point)) delete S(j).ends[point] }

/** The joins inside a copied range as plain data: the rows (modes, radii, zones) and the points' end strokes, all shared by every view. */
export interface RangeData {
  rows: { point: Id; lines: [Id, Id]; mode: JoinMode; radius?: number; zone?: number }[]
  endStrokes: { point: Id; stroke: EndStroke }[]
}
export function rangeData(j: JoinsState, lines: ReadonlySet<Id>, points: ReadonlySet<Id>): RangeData {
  const inside = S(j).rows.filter(r => points.has(r.point) && lines.has(r.lines[0]) && lines.has(r.lines[1]))
  return {
    rows: inside.map(r => ({ point: r.point, lines: [r.lines[0], r.lines[1]], mode: r.mode, ...(r.radius !== undefined ? { radius: r.radius } : {}), ...(r.zone !== undefined ? { zone: r.zone } : {}) })),
    endStrokes: [...points].flatMap(p => { const e = endStroke(j, undefined, p); return e ? [{ point: p, stroke: e }] : [] }),
  }
}

/** Joins from plain data onto the copied points and lines of `map`: rows with their radii and zones, and the end strokes. */
export function insert(j: JoinsState, n: net.NetworkState, data: RangeData, map: net.CopyMap) {
  for (const r of data.rows) {
    const point = map.points.get(r.point), l0 = map.lines.get(r.lines[0]), l1 = map.lines.get(r.lines[1])
    if (!point || !l0 || !l1) continue
    const at = new Set(net.linesAt(n, point).map(e => e.line.id))
    if (!isMode(r.mode)) throw new Error(`Unknown join mode ${String(r.mode)}`)
    if (l0 === l1 || !at.has(l0) || !at.has(l1)) throw new Error(`Both lines must end at ${point}`)
    if (r.mode === 'arc' ? !(typeof r.radius === 'number' && Number.isFinite(r.radius) && r.radius > 0) : r.radius !== undefined) throw new Error('An arc join needs a positive radius; other joins have none')
    if (r.zone !== undefined && !(typeof r.zone === 'number' && Number.isFinite(r.zone) && r.zone > 0)) throw new Error('A transition-zone length must be a finite number above zero')
    const p = pair(l0, l1)
    // the copy's rows arrive in their list order: appended, they keep it at the new points
    S(j).rows = S(j).rows.filter(x => !same(x, point, p))
    S(j).rows.push({ point, lines: p, mode: r.mode, ...(r.mode === 'arc' ? { radius: r.radius! } : {}), ...(r.zone !== undefined ? { zone: r.zone } : {}) })
  }
  for (const e of data.endStrokes) { const point = map.points.get(e.point); if (point) setEndStroke(j, n, point, e.stroke) }
}

/**
 * Keep references valid after one network operation, keeping each point's list order. A radius and
 * a zone are part of their row (a split re-keys it, an unbind or a bind moves it with the row, a
 * dropped row drops it), and a removed point's end stroke goes. A bind keeps the
 * removed point's joins: they move to the kept point, below its own (principle §2.1, replacing
 * dot 1791654260's drop). Pairs the operation connected (`connected`) get a 'bound' row on top
 * of their point's list when they have none (checklist §2).
 */
export function update(j: JoinsState, n: net.NetworkState, ch: net.Changes) {
  const tracked = S(j).rows.map(r => ({ row: { ...r, lines: [r.lines[0], r.lines[1]] as [Id, Id] } }))
  for (const r of ch.replaced) {
    for (const { row } of tracked) {
      if (row.point === r.a) row.lines = pair(...row.lines.map(l => (l === r.line ? r.pieces[0] : l)) as [Id, Id])
      if (row.point === r.b) row.lines = pair(...row.lines.map(l => (l === r.line ? r.pieces[1] : l)) as [Id, Id])
    }
  }
  let kept = tracked
  for (const u of ch.unbound) {
    const moved = new Set(u.lines)
    kept = kept.flatMap(t => {
      if (t.row.point !== u.point) return [t]
      const m = t.row.lines.filter(l => moved.has(l)).length
      return m === 0 ? [t] : m === 2 ? [{ ...t, row: { ...t.row, point: u.newPoint } }] : []
    })
  }
  for (const m of ch.merged) {
    const moved = kept.filter(t => t.row.point === m.remove).map(t => ({ ...t, row: { ...t.row, point: m.keep } }))
    if (!moved.length) continue
    kept = kept.filter(t => t.row.point !== m.remove)
    const last = kept.map(t => t.row.point).lastIndexOf(m.keep)
    kept.splice(last < 0 ? kept.length : last + 1, 0, ...moved)
  }
  const gone = new Set([...ch.deletedLines, ...ch.collapsedLines])
  const deadPoints = new Set(ch.deletedPoints)
  // Q23: a deleted point's joins are dropped with it (a bind's removed point has handed its joins on above).
  kept = kept.filter(({ row }) => !deadPoints.has(row.point) && !row.lines.some(l => gone.has(l)))
  // Safety: every row's lines must still end at its point.
  kept = kept.filter(({ row }) => {
    if (!net.hasPoint(n, row.point)) return false
    const at = new Set(net.linesAt(n, row.point).map(e => e.line.id))
    return at.has(row.lines[0]) && at.has(row.lines[1])
  })
  // one row per pair at a point: a repeat (never expected) keeps the higher one
  const seen = new Set<string>()
  kept = kept.filter(t => { const k = keyOf(t.row); if (seen.has(k)) return false; seen.add(k); return true })
  // what the operation connected as one line: a 'bound' row on top, where the pair has none
  for (const c of ch.connected) {
    const p = pair(c.lines[0], c.lines[1])
    if (p[0] === p[1] || !net.hasPoint(n, c.point)) continue
    const at = new Set(net.linesAt(n, c.point).map(e => e.line.id))
    if (!at.has(p[0]) || !at.has(p[1]) || kept.some(t => same(t.row, c.point, p))) continue
    const top = kept.findIndex(t => t.row.point === c.point), item = { row: { point: c.point, lines: p, mode: 'bound' as JoinMode } }
    if (top < 0) kept.push(item)
    else kept.splice(top, 0, item)
  }
  // a zone is part of its row: it moves and goes with it
  S(j).rows = kept.map(t => t.row)
  for (const p of deadPoints) clearEndStroke(j, p)
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
  // a canonical copy: the springs' balance never depends on the join lists' order
  for (const r of canonical(S(j).rows)) if (r.mode === 'smooth') {
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

/**
 * Joins from saved data, checked: each row on two different lines that both end at its
 * point, with a known mode, a radius above zero exactly when it is an arc, and a zone above zero
 * if any; end strokes only on existing points, in their stored form (archive 14).
 */
export function restore(v: unknown, n: net.NetworkState): JoinsState {
  const d = net.data, o = d.obj(v, 'joins')
  const rows = d.arr(o.rows, 'join rows').map((x, i): Row => {
    const R = d.obj(x, `join ${i}`), point = d.str(R.point, `join ${i} point`)
    const ls = d.arr(R.lines, `join ${i} lines`)
    if (ls.length !== 2) d.fail(`join ${i} does not have two lines`)
    const l0 = d.str(ls[0], `join ${i} line`), l1 = d.str(ls[1], `join ${i} line`)
    if (l0 === l1) d.fail(`join ${i} uses one line twice`)
    for (const l of [l0, l1]) { if (!net.hasLine(n, l)) d.fail(`join ${i} uses a missing line ${l}`); const x2 = net.line(n, l); if (x2.a !== point && x2.b !== point) d.fail(`join ${i}: line ${l} does not end at ${point}`) }
    const m = d.str(R.mode, `join ${i} mode`)
    if (!isMode(m)) d.fail(`join ${i} has an unknown mode ${m}`)
    if (Object.keys(R).some(k => k !== 'point' && k !== 'lines' && k !== 'mode' && k !== 'radius' && k !== 'zone')) d.fail(`join ${i} carries an extra value`)
    let zone: number | undefined
    if (Object.hasOwn(R, 'zone')) { zone = d.num(R.zone, `join ${i} zone`); if (!(zone > 0)) d.fail(`join ${i} has a zone that is not above zero`) }
    const z = zone !== undefined ? { zone } : {}
    if (m !== 'arc') {
      if (Object.hasOwn(R, 'radius')) d.fail(`join ${i} is not an arc but has a radius`)
      return { point, lines: [l0, l1], mode: m as JoinMode, ...z }
    }
    if (!Object.hasOwn(R, 'radius')) d.fail(`arc join ${i} has no radius`)
    const radius = d.num(R.radius, `join ${i} radius`)
    if (!(radius > 0)) d.fail(`arc join ${i} has a radius that is not above zero`)
    return { point, lines: [l0, l1], mode: m as JoinMode, radius, ...z }
  })
  // one stored form: sorted pairs, no repeats (dot 1791512476); the rows' order is the join lists' order, kept as stored
  const st = create()
  S(st).rows = rows.map(r => ({ point: r.point, lines: pair(r.lines[0], r.lines[1]), mode: r.mode, ...(r.radius !== undefined ? { radius: r.radius } : {}), ...(r.zone !== undefined ? { zone: r.zone } : {}) }))
  const seen = new Set<string>()
  for (const r of S(st).rows) { if (seen.has(keyOf(r))) d.fail('joins are not in their stored form (a repeat)'); seen.add(keyOf(r)) }
  if (JSON.stringify(S(st).rows) !== JSON.stringify(rows)) d.fail('joins are not in their stored form (a reversed line pair or an extra value)')
  const E = d.obj(o.ends, 'end strokes')
  for (const p of Object.keys(E)) {
    if (!net.hasPoint(n, p)) d.fail(`end stroke on a missing point ${p}`)
    const e = d.obj(E[p], `end stroke ${p}`)
    let kept: Record<string, number | string> = {}
    try { kept = endIn(e as EndStrokeIn) } catch (err) { d.fail(`end stroke ${p}: ${(err as Error).message}`) }
    // compared with the writer's own normal form, not with a sort: integer-like keys
    // enumerate in numeric order whatever the insertion order (dot 1791654767)
    if (JSON.stringify(kept) !== JSON.stringify(e)) d.fail(`end stroke ${p} is not in its stored form`)
    put(S(st).ends, p, kept)
  }
  if (Object.keys(o).some(k => k !== 'rows' && k !== 'ends')) d.fail('joins carry an extra value')
  return st
}
