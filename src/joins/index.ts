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
 * A join row as read in one shape layer: an arc carries that layer's radius; any join may carry that
 * layer's manual transition-zone length (absent = automatic, from the two widths — principle §4).
 */
export interface JoinRow { point: Id; lines: [Id, Id]; mode: JoinMode; radius?: number; zone?: number }
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
const layersOf = (n: net.NetworkState) => net.shapeLayers(n).map(l => ({ ...l, h: net.of(n, l.key) }))

const rowOut = (n: net.NetworkState, r: Row): JoinRow => {
  const radius = r.mode === 'arc' ? net.slot(n, 'radius', keyOf(r)) as number | undefined : undefined
  const zone = net.slot(n, 'zone', keyOf(r)) as number | undefined
  return { point: r.point, lines: [r.lines[0], r.lines[1]], mode: r.mode, ...(radius !== undefined ? { radius } : {}), ...(zone !== undefined ? { zone } : {}) }
}
/** Every row, with the radius of the handle's layer; each point's rows in list order (top first). */
export const rows = (j: JoinsState, n: net.NetworkState): JoinRow[] => S(j).rows.map(r => rowOut(n, r))
/** A point's join list, top first. */
export const rowsAt = (j: JoinsState, n: net.NetworkState, point: Id): JoinRow[] => S(j).rows.filter(r => r.point === point).map(r => rowOut(n, r))
/** The join that governs a line's end at a point: the topmost row there containing the line (principle §2.3), or undefined. */
export function governing(j: JoinsState, n: net.NetworkState, point: Id, line: Id): JoinRow | undefined {
  const r = S(j).rows.find(x => x.point === point && (x.lines[0] === line || x.lines[1] === line))
  return r ? rowOut(n, r) : undefined
}
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
  if (!isMode(opts.mode)) throw new Error(`Unknown join mode ${String(opts.mode)}`)
  if (l1 === l2) throw new Error('A join needs two different lines')
  const at = new Set(net.linesAt(n, point).map(e => e.line.id))
  if (!at.has(l1) || !at.has(l2)) throw new Error(`Both lines must end at ${point}`)
  if (opts.mode === 'arc' && !(typeof opts.radius === 'number' && Number.isFinite(opts.radius) && opts.radius > 0)) throw new Error('An arc join needs a positive radius')
  const p = pair(l1, l2), key = rowKey(point, l1, l2), all = layersOf(n)
  if (opts.mode === 'arc') {
    const owned = all.filter(l => l.kind !== 'view' && !l.copyNew).map(l => l.key)
    if (owned.length) throw new net.Refusal('arc-needs-owner', `arc-needs-owner: the ${owned.join(', ')} layer(s) need their owner to give an arc its radius`)
  }
  // a pair that has a row changes its mode in place (its place in the list stays); a new pair goes on top
  const existing = S(j).rows.find(r => same(r, point, p))
  if (existing) existing.mode = opts.mode
  else putOnTop(S(j).rows, { point, lines: p, mode: opts.mode })
  if (opts.mode === 'arc') {
    net.setSlot(n, 'radius', key, opts.radius!)
    for (const l of all) if (l.key !== net.boundLayer(n) && net.slot(l.h, 'radius', key) === undefined) net.setSlot(l.h, 'radius', key, opts.radius!)
  } else net.dropSlot(n, 'radius', key)
}

/**
 * An arc row's radius in the handle's layer only; no other layer, no row change (stage 3a: a
 * scratch layer takes its posed radius). The row must exist and be an arc.
 */
export function setRadiusHere(j: JoinsState, n: net.NetworkState, point: Id, l1: Id, l2: Id, radius: number) {
  const p = pair(l1, l2)
  if (!S(j).rows.some(r => same(r, point, p) && r.mode === 'arc')) throw new Error(`No arc join at ${point} between ${l1} and ${l2}`)
  if (!(Number.isFinite(radius) && radius > 0)) throw new Error('An arc join needs a positive radius')
  net.setSlot(n, 'radius', rowKey(point, l1, l2), radius)
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
 * A join's manual transition-zone length in the handle's layer only (bowen 1791810585: per view, not
 * broadcast); null sets it automatic there. The zone belongs to every mode, so changing the mode keeps
 * it (dot 1791811393).
 */
export function setZoneHere(j: JoinsState, n: net.NetworkState, point: Id, l1: Id, l2: Id, length: number | null) {
  const p = pair(l1, l2)
  if (!S(j).rows.some(r => same(r, point, p))) throw new Error(`No join at ${point} between ${l1} and ${l2}`)
  if (length === null) net.dropSlotHere(n, 'zone', rowKey(point, l1, l2))
  else net.setSlot(n, 'zone', rowKey(point, l1, l2), length)
}

/** Remove a join: the row, and its radius and zone in every layer. */
export function removeJoin(j: JoinsState, n: net.NetworkState, point: Id, l1: Id, l2: Id) {
  const p = pair(l1, l2)
  S(j).rows = S(j).rows.filter(r => !same(r, point, p))
  net.dropSlot(n, 'radius', rowKey(point, l1, l2))
  net.dropSlot(n, 'zone', rowKey(point, l1, l2))
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
  layers: { key: string; radii: { point: Id; lines: [Id, Id]; radius: number }[]; zones: { point: Id; lines: [Id, Id]; zone: number }[]; endStrokes: { point: Id; stroke: EndStroke }[] }[]
}
export function rangeData(j: JoinsState, n: net.NetworkState, lines: ReadonlySet<Id>, points: ReadonlySet<Id>): RangeData {
  const inside = S(j).rows.filter(r => points.has(r.point) && lines.has(r.lines[0]) && lines.has(r.lines[1]))
  return {
    rows: inside.map(r => ({ point: r.point, lines: [r.lines[0], r.lines[1]], mode: r.mode })),
    layers: layersOf(n).map(({ key, h }) => ({
      key,
      radii: inside.filter(r => r.mode === 'arc').map(r => ({ point: r.point, lines: [r.lines[0], r.lines[1]] as [Id, Id], radius: net.slot(h, 'radius', keyOf(r)) as number })),
      zones: inside.flatMap(r => { const z = net.slot(h, 'zone', keyOf(r)) as number | undefined; return z === undefined ? [] : [{ point: r.point, lines: [r.lines[0], r.lines[1]] as [Id, Id], zone: z }] }),
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
    if (!isMode(r.mode)) throw new Error(`Unknown join mode ${String(r.mode)}`)
    if (l0 === l1 || !at.has(l0) || !at.has(l1)) throw new Error(`Both lines must end at ${point}`)
    const p = pair(l0, l1)
    // the copy's rows arrive in their list order: appended, they keep it at the new points
    S(j).rows = S(j).rows.filter(x => !same(x, point, p))
    S(j).rows.push({ point, lines: p, mode: r.mode })
    const key = rowKey(point, l0, l1)
    for (const { h, src } of plan) {
      const z = src.zones.find(x => x.point === r.point && x.lines[0] === r.lines[0] && x.lines[1] === r.lines[1])
      if (z) net.setSlot(h, 'zone', key, z.zone)
      else net.dropSlotHere(h, 'zone', key)
      if (r.mode !== 'arc') { net.dropSlotHere(h, 'radius', key); continue }
      const v = src.radii.find(x => x.point === r.point && x.lines[0] === r.lines[0] && x.lines[1] === r.lines[1])
      if (!v) throw new Error('An arc join needs a positive radius')
      net.setSlot(h, 'radius', key, v.radius)
    }
  }
  for (const { h, src } of plan) for (const e of src.endStrokes) { const point = map.points.get(e.point); if (point) setEndStroke(j, h, point, e.stroke) }
}

/**
 * Keep references valid after one network operation, keeping each point's list order. Each
 * layer's radius follows its row (a split re-keys it, an unbind or a bind moves it with the row,
 * a dropped row drops it), and a removed point's end stroke leaves every layer. A bind keeps the
 * removed point's joins: they move to the kept point, below its own (principle §2.1, replacing
 * dot 1791654260's drop). Pairs the operation connected (`connected`) get a 'bound' row on top
 * of their point's list when they have none (checklist §2).
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
    const top = kept.findIndex(t => t.row.point === c.point), item = { row: { point: c.point, lines: p, mode: 'bound' as JoinMode }, was: '' }
    if (top < 0) kept.push(item)
    else kept.splice(top, 0, item)
  }
  // move every layer's radii and zones: read all old values first, then drop and write, so keys may swap
  const layers = layersOf(n)
  const values = layers.map(({ h }) => new Map(tracked.map(t => [t.was, net.slot(h, 'radius', t.was) as number | undefined])))
  const zones = layers.map(({ h }) => new Map(tracked.map(t => [t.was, net.slot(h, 'zone', t.was) as number | undefined])))
  for (const t of tracked) { net.dropSlot(n, 'radius', t.was); net.dropSlot(n, 'zone', t.was) }
  layers.forEach(({ h }, i) => {
    for (const t of kept) {
      if (t.row.mode === 'arc') { const v = values[i]!.get(t.was); if (v !== undefined) net.setSlot(h, 'radius', keyOf(t.row), v) }
      const z = zones[i]!.get(t.was); if (z !== undefined) net.setSlot(h, 'zone', keyOf(t.row), z)
    }
  })
  S(j).rows = kept.map(t => t.row)
  for (const p of deadPoints) net.dropSlot(n, 'end', p)
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
    if (!isMode(m)) d.fail(`join ${i} has an unknown mode ${m}`)
    if (Object.keys(R).some(k => k !== 'point' && k !== 'lines' && k !== 'mode')) d.fail(`join ${i} carries an extra value`)
    return { point, lines: [l0, l1], mode: m as JoinMode }
  })
  // one stored form: sorted pairs, no repeats (dot 1791512476); the rows' order is the join lists' order, kept as stored
  const st = create()
  S(st).rows = rows.map(r => ({ point: r.point, lines: pair(r.lines[0], r.lines[1]), mode: r.mode }))
  const seen = new Set<string>()
  for (const r of S(st).rows) { if (seen.has(keyOf(r))) d.fail('joins are not in their stored form (a repeat)'); seen.add(keyOf(r)) }
  if (JSON.stringify(S(st).rows) !== JSON.stringify(rows)) d.fail('joins are not in their stored form (a reversed line pair or an extra value)')
  const arcKeys = new Set(S(st).rows.filter(r => r.mode === 'arc').map(keyOf)), rowKeys = new Set(S(st).rows.map(keyOf))
  for (const { key, h } of layersOf(n)) {
    const have = new Set(net.slotKeys(h, 'radius'))
    for (const k of arcKeys) if (!have.has(k)) d.fail(`arc join ${k} has no radius in ${key}`)
    for (const k of have) if (!arcKeys.has(k)) d.fail(`radius ${k} in ${key} belongs to no arc join`)
    for (const k of net.slotKeys(h, 'zone')) if (!rowKeys.has(k)) d.fail(`zone ${k} in ${key} belongs to no join`)
    for (const p of net.slotKeys(h, 'end')) if (!net.hasPoint(n, p)) d.fail(`end stroke in ${key} is on a missing point ${p}`)
  }
  return st
}
