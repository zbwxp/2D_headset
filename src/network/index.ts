// network — points and lines, and the one-time edits that change them.
// Lines are defined by their two points; a point is shared by every line that
// ends there. Handles are offsets from their own point. Points and lines never
// cross layers (a line's two points share one layer).
//
// Encapsulation (dot 1791427188): the state is opaque outside this module. Reads
// return frozen copies; inputs are copied before they are stored. Only the
// functions below change the network.
import { type Vec, type Cubic, add, sub, split } from '../geometry'

export type Id = string
export type End = 'a' | 'b'
export interface Point { readonly id: Id; readonly layer: Id; readonly position: Vec }
export interface Line { readonly id: Id; readonly a: Id; readonly b: Id; readonly ha: Vec; readonly hb: Vec }

declare const opaque: unique symbol
/** Opaque handle to a network; read it through the query functions. */
export type NetworkState = { readonly [opaque]: 'network' }

type Mutable<T> = { -readonly [K in keyof T]: T[K] }
interface Store {
  layers: Id[]
  points: Mutable<Point>[]
  lines: Mutable<Line>[]
  /** Every point / line id ever used in this document. Ids are never reused (dot 1791427637). */
  usedPoints: Id[]
  usedLines: Id[]
}
const S = (n: NetworkState) => n as unknown as Store

/** What one edit did to the network; attribute modules update their own references from it. */
export interface Changes {
  /** A split: `line` (a→b) became pieces[0] (a→mid) and pieces[1] (mid→b). */
  replaced: { line: Id; a: Id; b: Id; mid: Id; pieces: [Id, Id] }[]
  /** Lines the user deleted. */
  deletedLines: Id[]
  /** Lines removed by binding because both ends landed on one point. */
  collapsedLines: Id[]
  /** Points removed: merged by binding, or isolated (no line). */
  deletedPoints: Id[]
  merged: { keep: Id; remove: Id }[]
  unbound: { point: Id; newPoint: Id; lines: Id[] }[]
  /** Points directly acted on in this edit, with their raw targets. */
  targets: { point: Id; target: Vec }[]
  /** Handles directly dragged in this edit. */
  held: { line: Id; end: End }[]
  /** Lines whose group wins a merge (the first-clicked side), latest last. */
  prefer: { lines: Id[] }[]
  /** Points whose attributes were edited in this edit (e.g. a join was set). */
  touched: Id[]
}

export const emptyChanges = (): Changes => ({
  replaced: [], deletedLines: [], collapsedLines: [], deletedPoints: [], merged: [], unbound: [], targets: [], held: [], prefer: [], touched: [],
})

export const create = (): NetworkState =>
  ({ layers: [], points: [], lines: [], usedPoints: [], usedLines: [] }) as Store as unknown as NetworkState

function claimPoint(n: NetworkState, id: Id) {
  if (S(n).usedPoints.includes(id)) throw new Error(`Point id ${id} was already used in this document; ids are never reused`)
  S(n).usedPoints.push(id)
}
function claimLine(n: NetworkState, id: Id) {
  if (S(n).usedLines.includes(id)) throw new Error(`Line id ${id} was already used in this document; ids are never reused`)
  S(n).usedLines.push(id)
}

/** Mark a handle as held for this edit without moving it (the first-clicked side of a join, bowen 1791428722). */
export function hold(n: NetworkState, ch: Changes, lineId: Id, end: End) {
  rawLine(n, lineId)
  if (!ch.held.some(h => h.line === lineId && h.end === end)) ch.held.push({ line: lineId, end })
}

/** Record that a point's attributes changed in this edit. */
export function touch(ch: Changes, point: Id) {
  if (!ch.touched.includes(point)) ch.touched.push(point)
}

/** Points this edit acted on: moved, touched, held handles' points, and points of topology changes. */
export function affectedPoints(n: NetworkState, ch: Changes): Set<Id> {
  const out = new Set<Id>([...ch.targets.map(t => t.point), ...ch.touched])
  for (const h of ch.held) if (hasLine(n, h.line)) { const l = rawLine(n, h.line); out.add(h.end === 'a' ? l.a : l.b) }
  for (const m of ch.merged) out.add(m.keep)
  for (const r of ch.replaced) for (const p of [r.a, r.b, r.mid]) out.add(p)
  for (const u of ch.unbound) { out.add(u.point); out.add(u.newPoint) }
  return out
}

/**
 * Keep the edit's accumulated direct-action intent valid after one operation:
 * a held handle on a split line now belongs to the matching piece (dot 1791427693).
 */
export function followReplacements(acc: Changes, op: Changes) {
  for (const r of op.replaced) {
    acc.held = acc.held.map(h => (h.line === r.line ? { line: h.end === 'a' ? r.pieces[0] : r.pieces[1], end: h.end } : h))
  }
}

// ---- copies in and out ---------------------------------------------------

function vecIn(v: Vec): Vec {
  if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) throw new Error('Coordinates must be finite numbers')
  return { x: v.x, y: v.y }
}
const vecOut = (v: Vec): Vec => Object.freeze({ x: v.x, y: v.y })
const pointOut = (p: Point): Point => Object.freeze({ id: p.id, layer: p.layer, position: vecOut(p.position) })
const lineOut = (l: Line): Line => Object.freeze({ id: l.id, a: l.a, b: l.b, ha: vecOut(l.ha), hb: vecOut(l.hb) })

function rawPoint(n: NetworkState, id: Id) {
  const p = S(n).points.find(p => p.id === id)
  if (!p) throw new Error(`No point ${id}`)
  return p
}
function rawLine(n: NetworkState, id: Id) {
  const l = S(n).lines.find(l => l.id === id)
  if (!l) throw new Error(`No line ${id}`)
  return l
}

// ---- queries (all return copies) -----------------------------------------

export const layers = (n: NetworkState): readonly Id[] => Object.freeze([...S(n).layers])
export const points = (n: NetworkState): readonly Point[] => Object.freeze(S(n).points.map(pointOut))
export const lines = (n: NetworkState): readonly Line[] => Object.freeze(S(n).lines.map(lineOut))
export const point = (n: NetworkState, id: Id): Point => pointOut(rawPoint(n, id))
export const line = (n: NetworkState, id: Id): Line => lineOut(rawLine(n, id))
export const hasPoint = (n: NetworkState, id: Id) => S(n).points.some(p => p.id === id)
export const hasLine = (n: NetworkState, id: Id) => S(n).lines.some(l => l.id === id)
export const hasLayer = (n: NetworkState, id: Id) => S(n).layers.includes(id)
export const layerOfLine = (n: NetworkState, id: Id): Id => rawPoint(n, rawLine(n, id).a).layer
export const handle = (l: Line, end: End): Vec => (end === 'a' ? l.ha : l.hb)

/** Every line end at a point. A line has at most one end at a point (no single-line loops). */
export function linesAt(n: NetworkState, pointId: Id): { line: Line; end: End }[] {
  const out: { line: Line; end: End }[] = []
  for (const l of S(n).lines) {
    if (l.a === pointId) out.push({ line: lineOut(l), end: 'a' })
    if (l.b === pointId) out.push({ line: lineOut(l), end: 'b' })
  }
  return out
}

/** Absolute control points of a line. */
export function curve(n: NetworkState, id: Id): Cubic {
  const l = rawLine(n, id), a = rawPoint(n, l.a).position, b = rawPoint(n, l.b).position
  return [vecOut(a), vecOut(add(a, l.ha)), vecOut(add(b, l.hb)), vecOut(b)]
}

/** Absolute control points of every line, in line order (one pass; for bulk readers such as derived). */
export function curves(n: NetworkState): Map<Id, Cubic> {
  const pos = new Map(S(n).points.map(p => [p.id, p.position]))
  return new Map(S(n).lines.map(l => {
    const a = pos.get(l.a)!, b = pos.get(l.b)!
    return [l.id, [vecOut(a), vecOut(add(a, l.ha)), vecOut(add(b, l.hb)), vecOut(b)] as Cubic]
  }))
}

/** Continuous curves: lines connected through shared points, per layer, in line order. */
export function components(n: NetworkState): { layer: Id; lines: Id[] }[] {
  const parent = new Map<Id, Id>()
  const find = (x: Id): Id => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r)!
    parent.set(x, r)
    return r
  }
  for (const l of S(n).lines) {
    for (const p of [l.a, l.b]) if (!parent.has(p)) parent.set(p, p)
    const ra = find(l.a), rb = find(l.b)
    if (ra !== rb) parent.set(rb, ra)
  }
  const layerOf = new Map(S(n).points.map(p => [p.id, p.layer]))
  const byRoot = new Map<Id, { layer: Id; lines: Id[] }>()
  for (const l of S(n).lines) {
    const r = find(l.a)
    if (!byRoot.has(r)) byRoot.set(r, { layer: layerOf.get(l.a)!, lines: [] })
    byRoot.get(r)!.lines.push(l.id)
  }
  return [...byRoot.values()]
}

export interface LoopUse { line: Id; reversed: boolean }
export interface FoundLoop { key: string; layer: Id; route: LoopUse[] }
/** Boundary key of a set of lines (collision-free encoding). It is a query key, not a fill identity. */
export const loopKey = (ids: Iterable<Id>) => 'loop:' + JSON.stringify([...ids].sort())

/** Upper bound on enumerated loops per document (an implementation bound; bowen: a layer never holds very complex networks). */
export const LOOP_LIMIT = 10000

/**
 * The one definition of a closed curve (bowen 1791430259, option 甲): a closed path
 * that uses each of its lines once, connected, in one layer — it may pass a point
 * more than once. As an edge set this is a connected set of lines where every
 * point has an even number of them. Returns an ordered, oriented route, or null.
 * Used both to find closed curves and to check that a filled one still holds.
 */
export function closedWalk(n: NetworkState, lineIds: readonly Id[]): LoopUse[] | null {
  if (lineIds.length < 2 || new Set(lineIds).size !== lineIds.length) return null
  const byId = new Map(S(n).lines.map(l => [l.id, l]))
  const ls = lineIds.map(id => byId.get(id))
  if (ls.some(l => !l)) return null
  const lines = ls as Mutable<Line>[]
  const layerOf = new Map(S(n).points.map(p => [p.id, p.layer]))
  if (new Set(lines.map(l => layerOf.get(l.a))).size !== 1) return null
  const degree = new Map<Id, number>()
  for (const l of lines) for (const p of [l.a, l.b]) degree.set(p, (degree.get(p) ?? 0) + 1)
  if ([...degree.values()].some(d => d % 2)) return null
  // Hierholzer from the first line's start; leftovers mean the lines are not connected.
  const unused = new Set(lineIds)
  const stack: { point: Id; use?: LoopUse }[] = [{ point: lines[0]!.a }]
  const out: LoopUse[] = []
  while (stack.length) {
    const top = stack[stack.length - 1]!
    const next = lines.find(l => unused.has(l.id) && (l.a === top.point || l.b === top.point))
    if (next) {
      unused.delete(next.id)
      const reversed = next.a !== top.point
      stack.push({ point: reversed ? next.a : next.b, use: { line: next.id, reversed } })
    } else {
      const done = stack.pop()!
      if (done.use) out.push(done.use)
    }
  }
  return unused.size ? null : out.reverse()
}

/**
 * Every closed curve of every continuous curve, in discovery order. Each one is a
 * connected, non-empty combination of the component's fundamental cycles (the
 * even-degree line sets), so all of them — simple or passing a point twice — are
 * found, each once.
 */
export function closedLoops(n: NetworkState): FoundLoop[] {
  const found: FoundLoop[] = []
  const layerOf = new Map(S(n).points.map(p => [p.id, p.layer]))
  for (const comp of components(n)) {
    if (found.length >= LOOP_LIMIT) break
    const lines = comp.lines.map(id => S(n).lines.find(l => l.id === id)!)
    // spanning tree by BFS; each non-tree line closes one fundamental cycle
    const adj = new Map<Id, { line: number; other: Id }[]>()
    lines.forEach((l, i) => {
      for (const [p, q] of [[l.a, l.b], [l.b, l.a]] as const) { if (!adj.has(p)) adj.set(p, []); adj.get(p)!.push({ line: i, other: q }) }
    })
    const root = lines[0]!.a
    const parent = new Map<Id, { via: number; from: Id } | null>([[root, null]])
    const queue = [root]
    const inTree = new Set<number>()
    while (queue.length) {
      const v = queue.shift()!
      for (const e of adj.get(v) ?? []) if (!parent.has(e.other)) { parent.set(e.other, { via: e.line, from: v }); inTree.add(e.line); queue.push(e.other) }
    }
    const pathToRoot = (v: Id) => { const out: number[] = []; for (let x = parent.get(v); x; x = parent.get(x.from)) out.push(x.via); return out }
    const cycles: Uint8Array[] = []
    lines.forEach((l, i) => {
      if (inTree.has(i)) return
      const c = new Uint8Array(lines.length)
      c[i] = 1
      for (const t of [...pathToRoot(l.a), ...pathToRoot(l.b)]) c[t]! ^= 1
      cycles.push(c)
    })
    const k = cycles.length
    for (let mask = 1; mask < 2 ** k && found.length < LOOP_LIMIT; mask++) {
      const set = new Uint8Array(lines.length)
      for (let b = 0; b < k; b++) if (mask & (1 << b)) for (let i = 0; i < set.length; i++) set[i]! ^= cycles[b]![i]!
      const ids = lines.filter((_, i) => set[i]).map(l => l.id)
      const route = closedWalk(n, ids)
      if (route) found.push({ key: loopKey(ids), layer: layerOf.get(lines[0]!.a)!, route })
    }
  }
  return found
}

// ---- one-time edits ------------------------------------------------------

export function addLayer(n: NetworkState, id: Id) {
  if (!S(n).layers.includes(id)) S(n).layers.push(id)
}

/** Internal to this module: points are created only with lines (addLine, split, unbind). */
function addPoint(n: NetworkState, id: Id, layer: Id, position: Vec) {
  if (!hasLayer(n, layer)) throw new Error(`No layer ${layer}`)
  const position_ = vecIn(position)
  claimPoint(n, id)
  S(n).points.push({ id, layer, position: position_ })
}

/** A line end: an existing point, or a new point created together with the line. */
export type EndSpec = Id | { id: Id; layer: Id; position: Vec }

/**
 * Pen: a new line from a to b (a is the first-clicked end). Each end is an existing
 * point or a new one created with the line — a point never exists without a line
 * (bowen 1791428375). Default handles make a straight line.
 */
export function addLine(n: NetworkState, ch: Changes, id: Id, aSpec: EndSpec, bSpec: EndSpec, handles?: { ha: Vec; hb: Vec }) {
  const endId = (e: EndSpec) => (typeof e === 'string' ? e : e.id)
  if (endId(aSpec) === endId(bSpec)) throw new Error('A line needs two different points')
  for (const e of [aSpec, bSpec]) if (typeof e !== 'string') addPoint(n, e.id, e.layer, e.position)
  const a = endId(aSpec), b = endId(bSpec)
  const pa = rawPoint(n, a), pb = rawPoint(n, b)
  if (pa.layer !== pb.layer) throw new Error('A line cannot cross layers; use an endpoint link')
  const d = sub(pb.position, pa.position)
  const hIn = handles ? { ha: vecIn(handles.ha), hb: vecIn(handles.hb) } : undefined
  claimLine(n, id)
  ch.prefer.push({ lines: linesAt(n, a).map(e => e.line.id) })
  S(n).lines.push({
    id, a, b,
    ha: hIn?.ha ?? { x: d.x / 3, y: d.y / 3 },
    hb: hIn?.hb ?? { x: -d.x / 3, y: -d.y / 3 },
  })
}

/** Drag points to targets. These points count as directly acted on (last target per point wins). */
export function move(n: NetworkState, ch: Changes, targets: { id: Id; target: Vec }[]) {
  for (const { id, target } of targets) {
    const t = vecIn(target)
    rawPoint(n, id).position = t
    const i = ch.targets.findIndex(x => x.point === id)
    if (i >= 0) ch.targets.splice(i, 1)
    ch.targets.push({ point: id, target: { x: t.x, y: t.y } }) // separate copy: no shared object with the state
  }
}

/** Position updates computed by other modules (links). Not counted as acted on. */
export function setPositions(n: NetworkState, positions: { id: Id; position: Vec }[]) {
  for (const { id, position } of positions) rawPoint(n, id).position = vecIn(position)
}

/** Drag one handle (an offset from its point). The handle is held during this edit. */
export function moveHandle(n: NetworkState, ch: Changes, lineId: Id, end: End, offset: Vec) {
  const l = rawLine(n, lineId)
  if (end === 'a') l.ha = vecIn(offset)
  else l.hb = vecIn(offset)
  hold(n, ch, lineId, end)
}

/** Handle updates computed by other modules (joins). */
export function setHandles(n: NetworkState, updates: { line: Id; end: End; offset: Vec }[]) {
  for (const u of updates) {
    const l = rawLine(n, u.line)
    if (u.end === 'a') l.ha = vecIn(u.offset)
    else l.hb = vecIn(u.offset)
  }
}

/** Split / add point: one line becomes two lines meeting at a new point. */
export function splitLine(n: NetworkState, ch: Changes, lineId: Id, t: number, mid: Id, first: Id, second: Id) {
  if (!(t > 0 && t < 1)) throw new Error('Split parameter must be inside the line')
  if (first === second) throw new Error('The two pieces need different ids')
  const l = rawLine(n, lineId)
  claimLine(n, first)
  claimLine(n, second)
  const [c1, c2] = split(curve(n, lineId), t)
  addPoint(n, mid, rawPoint(n, l.a).layer, c1[3])
  const all = S(n).lines
  all.splice(all.indexOf(l), 1,
    { id: first, a: l.a, b: mid, ha: sub(c1[1], c1[0]), hb: sub(c1[2], c1[3]) },
    { id: second, a: mid, b: l.b, ha: sub(c2[1], c2[0]), hb: sub(c2[2], c2[3]) })
  ch.replaced.push({ line: lineId, a: l.a, b: l.b, mid, pieces: [first, second] })
}

/** Delete removes the line; an endpoint left with no line is removed at commit (removeIsolated). */
export function deleteLine(n: NetworkState, ch: Changes, id: Id) {
  rawLine(n, id)
  S(n).lines = S(n).lines.filter(x => x.id !== id)
  ch.deletedLines.push(id)
}

/**
 * Bind: `remove` (clicked second) merges into `keep` (clicked first) and is deleted.
 * Every line that ended at `remove` now ends at `keep`; a line whose two ends land
 * on the same point is deleted (Q22). Same layer only.
 */
export function bind(n: NetworkState, ch: Changes, keep: Id, remove: Id) {
  if (keep === remove) throw new Error('Bind needs two different points')
  const pk = rawPoint(n, keep), pr = rawPoint(n, remove)
  if (pk.layer !== pr.layer) throw new Error('Binding is within one layer; use an endpoint link across layers')
  ch.prefer.push({ lines: linesAt(n, keep).map(e => e.line.id) })
  const collapsed: Id[] = []
  for (const l of S(n).lines) {
    if (l.a !== remove && l.b !== remove) continue
    if (l.a === remove) l.a = keep
    if (l.b === remove) l.b = keep
    if (l.a === l.b) collapsed.push(l.id)
  }
  S(n).lines = S(n).lines.filter(l => !collapsed.includes(l.id))
  S(n).points = S(n).points.filter(p => p.id !== remove)
  ch.collapsedLines.push(...collapsed)
  ch.deletedPoints.push(remove)
  ch.merged.push({ keep, remove })
}

/**
 * A point exists only as an endpoint of lines. A point is removed in exactly two
 * ways: merged away by binding, or isolated (no line) — checked once per edit,
 * however it became isolated (bowen 1791428195).
 */
export function removeIsolated(n: NetworkState, ch: Changes) {
  const used = new Set(S(n).lines.flatMap(l => [l.a, l.b]))
  const isolated = S(n).points.filter(p => !used.has(p.id)).map(p => p.id)
  if (!isolated.length) return
  S(n).points = S(n).points.filter(p => used.has(p.id))
  ch.deletedPoints.push(...isolated)
}

/** Unbind: the given lines leave `pointId` for a new point at the same position. */
export function unbind(n: NetworkState, ch: Changes, pointId: Id, lineIds: Id[], newPoint: Id) {
  const p = rawPoint(n, pointId)
  const at = new Set(linesAt(n, pointId).map(e => e.line.id))
  if (!lineIds.length || lineIds.some(id => !at.has(id))) throw new Error(`Unbind: every line must end at ${pointId}`)
  addPoint(n, newPoint, p.layer, p.position)
  for (const id of lineIds) {
    const l = rawLine(n, id)
    if (l.a === pointId) l.a = newPoint
    else l.b = newPoint
  }
  ch.unbound.push({ point: pointId, newPoint, lines: [...lineIds] })
}
