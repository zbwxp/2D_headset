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
interface Store { layers: Id[]; points: Mutable<Point>[]; lines: Mutable<Line>[] }
const S = (n: NetworkState) => n as unknown as Store

/** What one edit did to the network; attribute modules update their own references from it. */
export interface Changes {
  /** A split: `line` (a→b) became pieces[0] (a→mid) and pieces[1] (mid→b). */
  replaced: { line: Id; a: Id; b: Id; mid: Id; pieces: [Id, Id] }[]
  /** Lines the user deleted. */
  deletedLines: Id[]
  /** Lines removed by binding because both ends landed on one point. */
  collapsedLines: Id[]
  /** Points removed (only binding removes points). */
  deletedPoints: Id[]
  merged: { keep: Id; remove: Id }[]
  unbound: { point: Id; newPoint: Id; lines: Id[] }[]
  /** Points directly acted on in this edit, with their raw targets. */
  targets: { point: Id; target: Vec }[]
  /** Handles directly dragged in this edit. */
  held: { line: Id; end: End }[]
  /** Lines whose group wins a merge (the first-clicked side), latest last. */
  prefer: { lines: Id[] }[]
}

export const emptyChanges = (): Changes => ({
  replaced: [], deletedLines: [], collapsedLines: [], deletedPoints: [], merged: [], unbound: [], targets: [], held: [], prefer: [],
})

export const create = (): NetworkState => ({ layers: [], points: [], lines: [] }) as Store as unknown as NetworkState

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
  const byRoot = new Map<Id, { layer: Id; lines: Id[] }>()
  for (const l of S(n).lines) {
    const r = find(l.a)
    if (!byRoot.has(r)) byRoot.set(r, { layer: rawPoint(n, l.a).layer, lines: [] })
    byRoot.get(r)!.lines.push(l.id)
  }
  return [...byRoot.values()]
}

export interface LoopUse { line: Id; reversed: boolean }
export interface FoundLoop { key: string; layer: Id; route: LoopUse[] }
export const loopKey = (ids: Iterable<Id>) => 'loop:' + [...ids].sort().join('|')

/** Upper bound on enumerated loops (bowen: a layer never holds very complex networks). */
export const LOOP_LIMIT = 10000

/** Every simple loop (no point visited twice), per layer. Parallel lines form 2-line loops. */
export function simpleLoops(n: NetworkState): FoundLoop[] {
  const found = new Map<string, FoundLoop>()
  const store = S(n)
  const order = new Map(store.points.map((p, i) => [p.id, i]))
  const adj = new Map<Id, { line: Id; other: Id; reversed: boolean }[]>()
  for (const l of store.lines) {
    if (!adj.has(l.a)) adj.set(l.a, [])
    if (!adj.has(l.b)) adj.set(l.b, [])
    adj.get(l.a)!.push({ line: l.id, other: l.b, reversed: false })
    adj.get(l.b)!.push({ line: l.id, other: l.a, reversed: true })
  }
  for (const s of store.points) {
    if (found.size >= LOOP_LIMIT) break
    const start = order.get(s.id)!
    const visited = new Set<Id>([s.id])
    const path: LoopUse[] = []
    const walk = (v: Id) => {
      for (const e of adj.get(v) ?? []) {
        if (found.size >= LOOP_LIMIT) return
        if (path.some(u => u.line === e.line)) continue
        if (e.other === s.id) {
          const route = [...path, { line: e.line, reversed: e.reversed }]
          const key = loopKey(route.map(u => u.line))
          if (!found.has(key)) found.set(key, { key, layer: s.layer, route })
        } else if (order.get(e.other)! > start && !visited.has(e.other)) {
          visited.add(e.other)
          path.push({ line: e.line, reversed: e.reversed })
          walk(e.other)
          path.pop()
          visited.delete(e.other)
        }
      }
    }
    walk(s.id)
  }
  return [...found.values()]
}

// ---- one-time edits ------------------------------------------------------

export function addLayer(n: NetworkState, id: Id) {
  if (!S(n).layers.includes(id)) S(n).layers.push(id)
}

export function addPoint(n: NetworkState, id: Id, layer: Id, position: Vec) {
  if (hasPoint(n, id)) throw new Error(`Point ${id} already exists`)
  if (!hasLayer(n, layer)) throw new Error(`No layer ${layer}`)
  S(n).points.push({ id, layer, position: vecIn(position) })
}

/** Pen: a new line from a to b (a is the first-clicked end). Default handles make a straight line. */
export function addLine(n: NetworkState, ch: Changes, id: Id, a: Id, b: Id, handles?: { ha: Vec; hb: Vec }) {
  if (hasLine(n, id)) throw new Error(`Line ${id} already exists`)
  if (a === b) throw new Error('A line needs two different points')
  const pa = rawPoint(n, a), pb = rawPoint(n, b)
  if (pa.layer !== pb.layer) throw new Error('A line cannot cross layers; use an endpoint link')
  const d = sub(pb.position, pa.position)
  ch.prefer.push({ lines: linesAt(n, a).map(e => e.line.id) })
  S(n).lines.push({
    id, a, b,
    ha: handles ? vecIn(handles.ha) : { x: d.x / 3, y: d.y / 3 },
    hb: handles ? vecIn(handles.hb) : { x: -d.x / 3, y: -d.y / 3 },
  })
}

/** Drag points to targets. These points count as directly acted on (last target per point wins). */
export function move(n: NetworkState, ch: Changes, targets: { id: Id; target: Vec }[]) {
  for (const { id, target } of targets) {
    const t = vecIn(target)
    rawPoint(n, id).position = t
    const i = ch.targets.findIndex(x => x.point === id)
    if (i >= 0) ch.targets.splice(i, 1)
    ch.targets.push({ point: id, target: t })
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
  if (!ch.held.some(h => h.line === lineId && h.end === end)) ch.held.push({ line: lineId, end })
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
  for (const id of [first, second]) if (hasLine(n, id)) throw new Error(`Line ${id} already exists`)
  if (first === second) throw new Error('The two pieces need different ids')
  const l = rawLine(n, lineId)
  const [c1, c2] = split(curve(n, lineId), t)
  addPoint(n, mid, rawPoint(n, l.a).layer, c1[3])
  const all = S(n).lines
  all.splice(all.indexOf(l), 1,
    { id: first, a: l.a, b: mid, ha: sub(c1[1], c1[0]), hb: sub(c1[2], c1[3]) },
    { id: second, a: mid, b: l.b, ha: sub(c2[1], c2[0]), hb: sub(c2[2], c2[3]) })
  ch.replaced.push({ line: lineId, a: l.a, b: l.b, mid, pieces: [first, second] })
}

/** Delete removes lines only; endpoints are removed only by binding (graph, bowen 1791392558). */
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
