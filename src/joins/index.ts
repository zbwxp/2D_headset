// joins — attributes of a point: the join table (one row per pair of lines at the
// point, mode smooth / cusp / arc; no row = 仅绑定) and the end stroke (Q23, Q27).
// Smooth is a stiff spring toward a straight line; conflicts settle at a
// compromise and are never refused (bowen 1791421304).
import * as net from '../network'
import { angleOf, fromAngle, length } from '../geometry'

type Id = net.Id

export type JoinMode = 'smooth' | 'cusp' | 'arc'
/** A join row as read in one shape layer: an arc carries that layer's radius. */
export interface JoinRow { point: Id; lines: [Id, Id]; mode: JoinMode; radius?: number }
export interface EndStroke { taper?: number; [key: string]: number | string | undefined }
declare const opaque: unique symbol
/** Opaque handle; read through rows / rowsAt / endStroke (copies). */
export type JoinsState = { readonly [opaque]: 'joins' }
/**
 * The modes are shared by every view. Arc radii and end strokes are per shape layer
 * (step 4, docs/step4-per-view-joins.md): stored in the layers through the network
 * handle, under keys this module makes (a radius under its row's key, an end stroke
 * under its point) and keeps valid.
 */
interface Row { point: Id; lines: [Id, Id]; mode: JoinMode }
interface Store { rows: Row[] }
const S = (j: JoinsState) => j as unknown as Store

/** One global stiffness (bowen 1791421988). With only spring forces it scales energy, not the balance. */
export const SMOOTH_STIFFNESS = 1

export const create = (): JoinsState => ({ rows: [] }) as Store as unknown as JoinsState
const pair = (a: Id, b: Id): [Id, Id] => (a < b ? [a, b] : [b, a])
/** The stored key of a row: its point and its two lines in sorted order. */
export const rowKey = (point: Id, l1: Id, l2: Id) => { const p = pair(l1, l2); return JSON.stringify([point, p[0], p[1]]) }
const keyOf = (r: Row) => JSON.stringify([r.point, r.lines[0], r.lines[1]])
// Rows are kept in one canonical order, so the result never depends on the order joins were set.
const sortRows = (j: JoinsState) => { S(j).rows.sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0)) }
const same = (r: Row, point: Id, p: [Id, Id]) => r.point === point && r.lines[0] === p[0] && r.lines[1] === p[1]
const layersOf = (n: net.NetworkState) => net.shapeLayers(n).map(l => ({ ...l, h: net.of(n, l.key) }))

const rowOut = (n: net.NetworkState, r: Row): JoinRow => {
  const radius = r.mode === 'arc' ? net.slot(n, 'radius', keyOf(r)) as number | undefined : undefined
  return { point: r.point, lines: [r.lines[0], r.lines[1]], mode: r.mode, ...(radius !== undefined ? { radius } : {}) }
}
/** Every row, with the radius of the handle's layer. */
export const rows = (j: JoinsState, n: net.NetworkState): JoinRow[] => S(j).rows.map(r => rowOut(n, r))
export const rowsAt = (j: JoinsState, n: net.NetworkState, point: Id): JoinRow[] => S(j).rows.filter(r => r.point === point).map(r => rowOut(n, r))
/** The rows' shared part (point, lines, mode), the same in every layer. */
export const modes = (j: JoinsState): { point: Id; lines: [Id, Id]; mode: JoinMode }[] => S(j).rows.map(r => ({ point: r.point, lines: [r.lines[0], r.lines[1]], mode: r.mode }))
/** The end stroke at a point in the handle's layer. */
export function endStroke(_j: JoinsState, n: net.NetworkState, point: Id): EndStroke | undefined {
  const e = net.slot(n, 'end', point) as Record<string, number | string> | undefined
  return e ? { ...e } : undefined
}

/**
 * Set a join (the mode is shared). An arc's radius goes into the handle's layer; every
 * other view that has none for this row gets the same value (a default, Claude
 * 1791654131); a view that has one keeps it. Expression and record layers are filled by
 * their owners, so while they exist an arc is refused here (dot 1791654154). Any other
 * mode drops the row's radius from every layer.
 */
export function setJoin(j: JoinsState, n: net.NetworkState, point: Id, l1: Id, l2: Id, opts: { mode: JoinMode; radius?: number }) {
  if (opts.mode !== 'smooth' && opts.mode !== 'cusp' && opts.mode !== 'arc') throw new Error(`Unknown join mode ${String(opts.mode)}`)
  if (l1 === l2) throw new Error('A join needs two different lines')
  const at = new Set(net.linesAt(n, point).map(e => e.line.id))
  if (!at.has(l1) || !at.has(l2)) throw new Error(`Both lines must end at ${point}`)
  if (opts.mode === 'arc' && !(typeof opts.radius === 'number' && Number.isFinite(opts.radius) && opts.radius > 0)) throw new Error('An arc join needs a positive radius')
  const p = pair(l1, l2), key = rowKey(point, l1, l2), all = layersOf(n)
  if (opts.mode === 'arc') {
    const owned = all.filter(l => l.kind !== 'view').map(l => l.key)
    if (owned.length) throw new net.Refusal('arc-needs-owner', `arc-needs-owner: the ${owned.join(', ')} layer(s) need their owner to give an arc its radius`)
  }
  S(j).rows = S(j).rows.filter(r => !same(r, point, p))
  S(j).rows.push({ point, lines: p, mode: opts.mode })
  sortRows(j)
  if (opts.mode === 'arc') {
    net.setSlot(n, 'radius', key, opts.radius!)
    for (const l of all) if (l.key !== net.boundLayer(n) && net.slot(l.h, 'radius', key) === undefined) net.setSlot(l.h, 'radius', key, opts.radius!)
  } else net.dropSlot(n, 'radius', key)
}

/** Remove a join: the row, and its radius in every layer. */
export function removeJoin(j: JoinsState, n: net.NetworkState, point: Id, l1: Id, l2: Id) {
  const p = pair(l1, l2)
  S(j).rows = S(j).rows.filter(r => !same(r, point, p))
  net.dropSlot(n, 'radius', rowKey(point, l1, l2))
}

/** The end stroke at a point, in the handle's layer only. */
export function setEndStroke(_j: JoinsState, n: net.NetworkState, point: Id, stroke: EndStroke) {
  net.point(n, point)
  for (const v of Object.values(stroke)) {
    if (typeof v === 'number' ? !Number.isFinite(v) : typeof v !== 'string' && v !== undefined) throw new Error('End stroke values must be finite numbers or strings')
  }
  // its parameters are unordered: stored with sorted keys, so one content has one form (bowen 1791461643)
  net.setSlot(n, 'end', point, Object.fromEntries(Object.keys(stroke).sort().filter(k => stroke[k] !== undefined).map(k => [k, stroke[k]!])))
}

/** Remove a point's end stroke in the handle's layer (it then has none there). */
export function clearEndStroke(_j: JoinsState, n: net.NetworkState, point: Id) { net.dropSlotHere(n, 'end', point) }

/** The joins inside a copied range as plain data: the shared modes, and every layer's radii and end strokes. */
export interface RangeData {
  rows: { point: Id; lines: [Id, Id]; mode: JoinMode }[]
  layers: { key: string; radii: { point: Id; lines: [Id, Id]; radius: number }[]; endStrokes: { point: Id; stroke: EndStroke }[] }[]
}
export function rangeData(j: JoinsState, n: net.NetworkState, lines: ReadonlySet<Id>, points: ReadonlySet<Id>): RangeData {
  const inside = S(j).rows.filter(r => points.has(r.point) && lines.has(r.lines[0]) && lines.has(r.lines[1]))
  return {
    rows: inside.map(r => ({ point: r.point, lines: [r.lines[0], r.lines[1]], mode: r.mode })),
    layers: layersOf(n).map(({ key, h }) => ({
      key,
      radii: inside.filter(r => r.mode === 'arc').map(r => ({ point: r.point, lines: [r.lines[0], r.lines[1]] as [Id, Id], radius: net.slot(h, 'radius', keyOf(r)) as number })),
      endStrokes: [...points].flatMap(p => { const e = endStroke(j, h, p); return e ? [{ point: p, stroke: e }] : [] }),
    })),
  }
}

/**
 * Joins from plain data onto the copied points and lines of `map`: the modes once, and
 * each drawing layer's radii and end strokes from the copy's layer `layerMap` names for
 * it (the same correspondence as the shapes, dot 1791654260).
 */
export function insert(j: JoinsState, n: net.NetworkState, data: RangeData, map: net.CopyMap, layerMap: ReadonlyMap<string, string>) {
  const byKey = new Map(data.layers.map(L => [L.key, L]))
  const plan = layersOf(n).map(l => {
    const src = byKey.get(layerMap.get(l.key) ?? '')
    if (!src) throw new net.Refusal('paste-layer-unmatched', `paste-layer-unmatched: shape layer ${l.key} has no matching layer in the copy`)
    return { ...l, src }
  })
  for (const r of data.rows) {
    const point = map.points.get(r.point), l0 = map.lines.get(r.lines[0]), l1 = map.lines.get(r.lines[1])
    if (!point || !l0 || !l1) continue
    const at = new Set(net.linesAt(n, point).map(e => e.line.id))
    if (r.mode !== 'smooth' && r.mode !== 'cusp' && r.mode !== 'arc') throw new Error(`Unknown join mode ${String(r.mode)}`)
    if (l0 === l1 || !at.has(l0) || !at.has(l1)) throw new Error(`Both lines must end at ${point}`)
    const p = pair(l0, l1)
    S(j).rows = S(j).rows.filter(x => !same(x, point, p))
    S(j).rows.push({ point, lines: p, mode: r.mode })
    const key = rowKey(point, l0, l1)
    for (const { h, src } of plan) {
      if (r.mode !== 'arc') { net.dropSlotHere(h, 'radius', key); continue }
      const v = src.radii.find(x => x.point === r.point && x.lines[0] === r.lines[0] && x.lines[1] === r.lines[1])
      if (!v) throw new Error('An arc join needs a positive radius')
      net.setSlot(h, 'radius', key, v.radius)
    }
  }
  sortRows(j)
  for (const { h, src } of plan) for (const e of src.endStrokes) { const point = map.points.get(e.point); if (point) setEndStroke(j, h, point, e.stroke) }
}

/**
 * Keep references valid after one network operation. The keep / move / drop decisions
 * for rows are the same as ever; each layer's radius follows its row (a split re-keys it,
 * an unbind moves it with the row, a dropped row drops it), and a removed point's end
 * stroke leaves every layer. A bind drops the removed point's joins; they never move to
 * the kept point (dot 1791654260).
 */
export function update(j: JoinsState, n: net.NetworkState, ch: net.Changes) {
  // each row carries its key from before this operation
  const tracked = S(j).rows.map(r => ({ row: { ...r, lines: [r.lines[0], r.lines[1]] as [Id, Id] }, was: keyOf(r) }))
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
  const gone = new Set([...ch.deletedLines, ...ch.collapsedLines])
  const deadPoints = new Set(ch.deletedPoints)
  // Q23: the removed point's joins are dropped with it (a deleted point).
  kept = kept.filter(({ row }) => !deadPoints.has(row.point) && !row.lines.some(l => gone.has(l)))
  // Safety: every row's lines must still end at its point.
  kept = kept.filter(({ row }) => {
    if (!net.hasPoint(n, row.point)) return false
    const at = new Set(net.linesAt(n, row.point).map(e => e.line.id))
    return at.has(row.lines[0]) && at.has(row.lines[1])
  })
  // move every layer's radii: read all old values first, then drop and write, so keys may swap
  const layers = layersOf(n)
  const values = layers.map(({ h }) => new Map(tracked.map(t => [t.was, net.slot(h, 'radius', t.was) as number | undefined])))
  for (const t of tracked) net.dropSlot(n, 'radius', t.was)
  layers.forEach(({ h }, i) => {
    for (const t of kept) if (t.row.mode === 'arc') { const v = values[i]!.get(t.was); if (v !== undefined) net.setSlot(h, 'radius', keyOf(t.row), v) }
  })
  S(j).rows = kept.map(t => t.row)
  for (const p of deadPoints) net.dropSlot(n, 'end', p)
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

/**
 * Joins from saved data, checked: each row on two different lines that both end at its
 * point, with a known mode; then, in every shape layer, a radius for exactly the arc rows
 * (none dangling, none missing) and end strokes only on existing points (dot 1791654260;
 * shapes has checked the values' types and that radii are above zero).
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
    if (m !== 'smooth' && m !== 'cusp' && m !== 'arc') d.fail(`join ${i} has an unknown mode ${m}`)
    if (Object.keys(R).some(k => k !== 'point' && k !== 'lines' && k !== 'mode')) d.fail(`join ${i} carries an extra value`)
    return { point, lines: [l0, l1], mode: m as JoinMode }
  })
  // one stored form: sorted pairs, sorted rows, no repeats (dot 1791512476)
  const st = create()
  S(st).rows = rows.map(r => ({ point: r.point, lines: pair(r.lines[0], r.lines[1]), mode: r.mode }))
  const seen = new Set<string>()
  for (const r of S(st).rows) { if (seen.has(keyOf(r))) d.fail('joins are not in their stored form (a repeat)'); seen.add(keyOf(r)) }
  sortRows(st)
  if (JSON.stringify(S(st).rows) !== JSON.stringify(rows)) d.fail('joins are not in their stored form (a reversed line pair, a repeat, or an extra value)')
  const arcKeys = new Set(S(st).rows.filter(r => r.mode === 'arc').map(keyOf))
  for (const { key, h } of layersOf(n)) {
    const have = new Set(net.slotKeys(h, 'radius'))
    for (const k of arcKeys) if (!have.has(k)) d.fail(`arc join ${k} has no radius in ${key}`)
    for (const k of have) if (!arcKeys.has(k)) d.fail(`radius ${k} in ${key} belongs to no arc join`)
    for (const p of net.slotKeys(h, 'end')) if (!net.hasPoint(n, p)) d.fail(`end stroke in ${key} is on a missing point ${p}`)
  }
  return st
}
