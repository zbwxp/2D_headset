// network — points and lines, and the one-time edits that change them.
// Lines are defined by their two points; a point is shared by every line that
// ends there. Handles are offsets from their own point. Points and lines never
// cross layers (a line's two points share one layer).
//
// Encapsulation (dot 1791427188): the state is opaque outside this module. Reads
// return frozen copies; inputs are copied before they are stored. Only the
// functions below change the network.
//
// Shape layers (docs/architecture-multiview.md §1–2): the structure here is stored
// once; every point's position and every line's handles and stroke live in the shape
// layers of `shapes`. A NetworkState is a handle bound to one drawing and one layer
// (`of`): reads and geometry writes act on that layer. There is no global current
// layer (dot 1791649915). The handle a document keeps in its state is bound to the
// front view; that is the single-view compatibility entry (dot 1791650999).
//
// A structural change is decided once, here, and reaches every shape layer in the same
// call (architecture §1; step 2, Claude 1791652727): a new line has the drawn shape in
// every layer; a split re-expresses each layer's own curve at the same t; an unbind puts
// the new point at each layer's old position + one offset; a bind keeps each layer's
// position of the kept point; deletes leave every layer; an insert takes each layer's
// shape from the clip (or the clip's source layer).
import { type Vec, type Cubic, add, sub, split, scale, length } from '../geometry'
import * as shapes from '../shapes'

export type Id = string
export type End = 'a' | 'b'
export interface Point { readonly id: Id; readonly layer: Id; readonly position: Vec }
/** The state every drawable element (line, fill) carries (bowen 1791433646). */
export interface ElementState { readonly visible: boolean; readonly locked: boolean }
/** A line's own stroke (bowen 1791434322: width lives on each line). */
export interface Stroke { readonly width: number; readonly profile: string }
export interface Line {
  readonly id: Id; readonly a: Id; readonly b: Id; readonly ha: Vec; readonly hb: Vec
  readonly state: ElementState; readonly stroke: Stroke
}
export interface Layer { readonly id: Id; readonly name: string }
export const DEFAULT_STATE: ElementState = Object.freeze({ visible: true, locked: false })
export const DEFAULT_STROKE: Stroke = Object.freeze({ width: 1, profile: 'uniform' })
/** Default unbind offset, in document units (a filled-in default, bowen 1791436858). */
export const UNBIND_OFFSET = 0.5

declare const opaque: unique symbol
/** Opaque handle to a network; read it through the query functions. */
export type NetworkState = { readonly [opaque]: 'network' }

type Mutable<T> = { -readonly [K in keyof T]: T[K] }
/** Structure only: positions, handles and strokes are in the shape layers. */
interface TPoint { id: Id; layer: Id }
interface TLine { id: Id; a: Id; b: Id; state: ElementState }
interface Store {
  /** Bottom → top. */
  layers: Mutable<Layer>[]
  points: TPoint[]
  lines: TLine[]
  /** Every point / line id ever used in this document. Ids are never reused (dot 1791427637). */
  usedPoints: Id[]
  usedLines: Id[]
  shapes: shapes.ShapesState
}
/** A handle: one drawing, one shape layer. */
interface Handle { store: Store; layer: string }
const S = (n: NetworkState) => (n as unknown as Handle).store
const K = (n: NetworkState) => (n as unknown as Handle).layer
const SH = (n: NetworkState) => S(n).shapes
const pos = (n: NetworkState, id: Id) => shapes.position(SH(n), K(n), id)
const setPos = (n: NetworkState, id: Id, v: Vec) => shapes.setPosition(SH(n), K(n), id, v)
const shapeOf = (n: NetworkState, id: Id) => shapes.line(SH(n), K(n), id)
const setH = (n: NetworkState, id: Id, end: End, v: Vec) => shapes.setHandle(SH(n), K(n), id, end, v)

/** What one edit did to the network; attribute modules update their own references from it. */
export interface Changes {
  /** A split: `line` (a→b) became pieces[0] (a→mid) and pieces[1] (mid→b). */
  replaced: { line: Id; a: Id; b: Id; mid: Id; pieces: [Id, Id]; t: number }[]
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
  /** Points moved to another layer with their group (cut and paste) in this edit. */
  relocated: Id[]
  /**
   * Handles aimed at an absolute tip in this edit. At commit the offset is
   * factor × (tip − the point's final position); a split scales the factor exactly as
   * it scales the handle (t on the first piece's a end, 1 − t on the second's b end).
   */
  handleTips: { line: Id; end: End; tip: Vec; factor: number }[]
  /**
   * Lines an apply locked in this edit (it copies the source's lock onto a target it
   * also rewrites). The lock check does not count those locks as protection in this
   * edit; an explicit lock change on the line afterwards removes it from this list.
   */
  appliedLocks: Id[]
  /** Points and lines this edit created (pen, split, unbind, insert): the structural record is complete (dot 1791649528). */
  addedPoints: Id[]
  addedLines: Id[]
}

export const emptyChanges = (): Changes => ({
  replaced: [], deletedLines: [], collapsedLines: [], deletedPoints: [], merged: [], unbound: [], targets: [], held: [], prefer: [], touched: [], relocated: [], handleTips: [], appliedLocks: [], addedPoints: [], addedLines: [],
})

/** A new drawing with one empty shape layer, and a handle bound to it. */
export const create = (first: shapes.LayerInfo): NetworkState =>
  ({ store: { layers: [], points: [], lines: [], usedPoints: [], usedLines: [], shapes: shapes.create(first) }, layer: first.key }) as Handle as unknown as NetworkState

/** The drawing as plain data for saving (structure and every shape layer; not the bound layer). */
export const exportData = (n: NetworkState): unknown => structuredClone(S(n))

/** A handle to the same drawing bound to another shape layer (explicit, never a default). */
export function of(n: NetworkState, layer: string): NetworkState {
  if (!shapes.hasLayer(SH(n), layer)) throw new Error(`No shape layer ${layer}`)
  return { store: S(n), layer } as Handle as unknown as NetworkState
}
/** The shape layer this handle is bound to. */
export const boundLayer = (n: NetworkState): string => K(n)
/** The drawing's shape layers. */
export const shapeLayers = (n: NetworkState): readonly shapes.LayerInfo[] => shapes.layers(SH(n))
/** A new shape layer holding a copy of `from`. */
export function addShapeLayer(n: NetworkState, key: string, kind: shapes.LayerKind, from: string) { shapes.addLayer(SH(n), key, kind, from) }
/** Every shape layer key of the drawing. */
const keys = (n: NetworkState) => shapes.layers(SH(n)).map(l => l.key)

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
    // the intent goes with the split geometry, not only with the ids (dot, review of d5e2704)
    acc.handleTips = acc.handleTips.map(h => (h.line === r.line
      ? { line: h.end === 'a' ? r.pieces[0] : r.pieces[1], end: h.end, tip: h.tip, factor: h.factor * (h.end === 'a' ? r.t : 1 - r.t) }
      : h))
    acc.appliedLocks = acc.appliedLocks.flatMap(x => (x === r.line ? [...r.pieces] : [x]))
  }
}

/**
 * An apply writes the source's element state onto a target at once, so later
 * commands in the same edit see it (dot, review of d5e2704). A lock it copies is
 * recorded, so the commit's lock check judges the target by its protection before
 * the apply (dot 1791473104: handled in the apply flow, not by loosening the lock
 * check). A locked target is refused by the apply itself before anything is written.
 */
export function applyLineState(n: NetworkState, ch: Changes, line: Id, state: ElementState) {
  const wasLocked = rawLine(n, line).state.locked
  setLineState(n, line, state)
  if (state.locked && !wasLocked && !ch.appliedLocks.includes(line)) ch.appliedLocks.push(line)
}
/**
 * An explicit state change. A real unlock ends the protection an apply or a paste started;
 * locking a line that is already locked changes nothing (dot 1791514309).
 */
export function changeLineState(n: NetworkState, ch: Changes, line: Id, state: Partial<ElementState>) {
  const wasLocked = rawLine(n, line).state.locked
  setLineState(n, line, state)
  if (state.locked === false && wasLocked) ch.appliedLocks = ch.appliedLocks.filter(x => x !== line)
}

/**
 * Aim a handle at an absolute tip position (a geometric transform's handle intent).
 * The offset is set from the point's current position now, and measured again from
 * the point's final position at commit (`resolveHandleTips`), so a point that link
 * or mirror alignment moves afterwards does not carry the tip a second time
 * (dot, review of a9cf86e). The handle is held.
 */
export function aimHandle(n: NetworkState, ch: Changes, lineId: Id, end: End, tip: Vec) {
  const l = rawLine(n, lineId), t = vecIn(tip), p = pos(n, end === 'a' ? l.a : l.b)
  setH(n, lineId, end, { x: t.x - p.x, y: t.y - p.y })
  ch.handleTips = ch.handleTips.filter(h => !(h.line === lineId && h.end === end))
  ch.handleTips.push({ line: lineId, end, tip: { x: t.x, y: t.y }, factor: 1 })
  hold(n, ch, lineId, end)
}

/** At commit, after positions are final: every aimed handle's offset = factor × (tip − its point's final position). */
export function resolveHandleTips(n: NetworkState, ch: Changes) {
  for (const h of ch.handleTips) {
    if (!hasLine(n, h.line)) continue
    const l = rawLine(n, h.line), p = pos(n, h.end === 'a' ? l.a : l.b)
    setH(n, h.line, h.end, { x: h.factor * (h.tip.x - p.x), y: h.factor * (h.tip.y - p.y) })
  }
}

// ---- refusals -----------------------------------------------------------------

/** What a refusal is about: a kind and an id, so a point and a line sharing an id are never confused. */
export interface RefusalObject { kind: 'point' | 'line' | 'group' | 'fill' | 'layer'; id: Id }

/**
 * A refusal the user is shown (doc 22 §3.3; docs/interaction-plan.md): a code and the
 * objects involved, besides the message. Core gives the facts; how they are shown is
 * the interaction's (errors as values). Nobody parses the message.
 */
export class Refusal extends Error {
  readonly code: string
  readonly objects: readonly RefusalObject[]
  constructor(code: string, message: string, objects: readonly RefusalObject[] = []) {
    super(message)
    this.name = 'Refusal'
    this.code = code
    this.objects = Object.freeze(objects.map(o => Object.freeze({ kind: o.kind, id: o.id })))
  }
}
export const lineObjects = (ids: readonly Id[]): RefusalObject[] => ids.map(id => ({ kind: 'line', id }))

// ---- reading saved data (archive) -------------------------------------------

/**
 * Type checks for restoring saved data (docs/archive-plan.md): each module checks its own
 * part with these, so a file that reads fine but would break a later edit is refused.
 */
function fail(what: string): never { throw new Error(`open-failed: ${what}`) }
export const data = {
  fail,
  obj(v: unknown, what: string): Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v)) fail(`${what} is not an object`); return v as Record<string, unknown> },
  arr(v: unknown, what: string): unknown[] { if (!Array.isArray(v)) fail(`${what} is not a list`); return v },
  str(v: unknown, what: string): string { if (typeof v !== 'string') fail(`${what} is not text`); return v },
  num(v: unknown, what: string): number { if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${what} is not a finite number`); return v },
  bool(v: unknown, what: string): boolean { if (typeof v !== 'boolean') fail(`${what} is not true / false`); return v },
  vec(v: unknown, what: string): Vec { const o = data.obj(v, what); return { x: data.num(o.x, `${what}.x`), y: data.num(o.y, `${what}.y`) } },
  unique(ids: readonly string[], what: string) { const seen = new Set<string>(); for (const id of ids) { if (seen.has(id)) fail(`${what} ${id} appears twice`); seen.add(id) } },
}

/**
 * The network from saved data, checked: types, unique ids, ends that exist in one layer,
 * ids marked as used, and shape layers that hold every point and line. The handle is
 * bound to `layer`.
 */
export function restore(v: unknown, layer: string): NetworkState {
  const d = data, o = d.obj(v, 'network')
  const layers = d.arr(o.layers, 'layers').map((x, i) => { const L = d.obj(x, `layer ${i}`); const name = d.str(L.name, `layer ${i} name`); if (!name.trim()) d.fail(`layer ${i} has an empty name`); return { id: d.str(L.id, `layer ${i} id`), name } })
  d.unique(layers.map(l => l.id), 'layer')
  const layerIds = new Set(layers.map(l => l.id))
  const points = d.arr(o.points, 'points').map((x, i) => {
    const P = d.obj(x, `point ${i}`), id = d.str(P.id, `point ${i} id`), layer = d.str(P.layer, `point ${id} layer`)
    if (!layerIds.has(layer)) d.fail(`point ${id} is in a missing layer`)
    return { id, layer }
  })
  d.unique(points.map(p => p.id), 'point')
  const layerOf = new Map(points.map(p => [p.id, p.layer]))
  const lines = d.arr(o.lines, 'lines').map((x, i) => {
    const L = d.obj(x, `line ${i}`), id = d.str(L.id, `line ${i} id`), a = d.str(L.a, `line ${id} a`), b = d.str(L.b, `line ${id} b`)
    if (!layerOf.has(a) || !layerOf.has(b)) d.fail(`line ${id} ends at a missing point`)
    if (a === b) d.fail(`line ${id} has both ends on one point`)
    if (layerOf.get(a) !== layerOf.get(b)) d.fail(`line ${id} crosses layers`)
    const st = d.obj(L.state, `line ${id} state`)
    return { id, a, b, state: { visible: d.bool(st.visible, `line ${id} visible`), locked: d.bool(st.locked, `line ${id} locked`) } }
  })
  d.unique(lines.map(l => l.id), 'line')
  const ends = new Set(lines.flatMap(l => [l.a, l.b]))
  for (const p of points) if (!ends.has(p.id)) d.fail(`point ${p.id} is not the end of any line`)
  const usedPoints = d.arr(o.usedPoints, 'usedPoints').map((x, i) => d.str(x, `usedPoints ${i}`))
  const usedLines = d.arr(o.usedLines, 'usedLines').map((x, i) => d.str(x, `usedLines ${i}`))
  d.unique(usedPoints, 'used point id'); d.unique(usedLines, 'used line id')
  const up = new Set(usedPoints), ul = new Set(usedLines)
  for (const p of points) if (!up.has(p.id)) d.fail(`point ${p.id} is not marked as used`)
  for (const l of lines) if (!ul.has(l.id)) d.fail(`line ${l.id} is not marked as used`)
  const sh = shapes.restore(o.shapes, { points: points.map(p => p.id), lines: lines.map(l => l.id) })
  if (!shapes.hasLayer(sh, layer)) d.fail(`there is no shape layer ${layer}`)
  return { store: { layers, points, lines, usedPoints, usedLines, shapes: sh }, layer } as Handle as unknown as NetworkState
}

// ---- copies in and out ---------------------------------------------------

function vecIn(v: Vec): Vec {
  if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) throw new Error('Coordinates must be finite numbers')
  return { x: v.x, y: v.y }
}
const vecOut = (v: Vec): Vec => Object.freeze({ x: v.x, y: v.y })
const pointOut = (n: NetworkState, p: TPoint): Point => Object.freeze({ id: p.id, layer: p.layer, position: pos(n, p.id) })
const lineOut = (n: NetworkState, l: TLine): Line => {
  const s = shapeOf(n, l.id)
  return Object.freeze({ id: l.id, a: l.a, b: l.b, ha: s.ha, hb: s.hb, state: Object.freeze({ ...l.state }), stroke: s.stroke })
}

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

/** Layer ids, bottom → top. */
export const layers = (n: NetworkState): readonly Id[] => Object.freeze(S(n).layers.map(l => l.id))
export const layerRecords = (n: NetworkState): readonly Layer[] => Object.freeze(S(n).layers.map(l => Object.freeze({ ...l })))
export const points = (n: NetworkState): readonly Point[] => Object.freeze(S(n).points.map(p => pointOut(n, p)))
export const lines = (n: NetworkState): readonly Line[] => Object.freeze(S(n).lines.map(l => lineOut(n, l)))
export const point = (n: NetworkState, id: Id): Point => pointOut(n, rawPoint(n, id))
export const line = (n: NetworkState, id: Id): Line => lineOut(n, rawLine(n, id))
export const hasPoint = (n: NetworkState, id: Id) => S(n).points.some(p => p.id === id)
export const hasLine = (n: NetworkState, id: Id) => S(n).lines.some(l => l.id === id)
export const hasLayer = (n: NetworkState, id: Id) => S(n).layers.some(l => l.id === id)
export const layerOfLine = (n: NetworkState, id: Id): Id => rawPoint(n, rawLine(n, id).a).layer
export const handle = (l: Line, end: End): Vec => (end === 'a' ? l.ha : l.hb)

/** Every line end at a point. A line has at most one end at a point (no single-line loops). */
export function linesAt(n: NetworkState, pointId: Id): { line: Line; end: End }[] {
  const out: { line: Line; end: End }[] = []
  for (const l of S(n).lines) {
    if (l.a === pointId) out.push({ line: lineOut(n, l), end: 'a' })
    if (l.b === pointId) out.push({ line: lineOut(n, l), end: 'b' })
  }
  return out
}

/** Absolute control points of a line. */
export function curve(n: NetworkState, id: Id): Cubic {
  const l = rawLine(n, id), a = pos(n, l.a), b = pos(n, l.b), s = shapeOf(n, id)
  return [vecOut(a), vecOut(add(a, s.ha)), vecOut(add(b, s.hb)), vecOut(b)]
}

/** Absolute control points of every line, in line order (one pass; for bulk readers such as derived). */
export function curves(n: NetworkState): Map<Id, Cubic> {
  const at = shapes.positions(SH(n), K(n))
  return new Map(S(n).lines.map(l => {
    const a = at.get(l.a)!, b = at.get(l.b)!, s = shapeOf(n, l.id)
    return [l.id, [vecOut(a), vecOut(add(a, s.ha)), vecOut(add(b, s.hb)), vecOut(b)] as Cubic]
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
  return walkWith(indexOf(n), lineIds)
}

interface Index { lineById: Map<Id, TLine>; layerOf: Map<Id, Id> }
const indexOf = (n: NetworkState): Index => ({
  lineById: new Map(S(n).lines.map(l => [l.id, l])),
  layerOf: new Map(S(n).points.map(p => [p.id, p.layer])),
})

function walkWith({ lineById, layerOf }: Index, lineIds: readonly Id[]): LoopUse[] | null {
  if (lineIds.length < 2 || new Set(lineIds).size !== lineIds.length) return null
  const ls = lineIds.map(id => lineById.get(id))
  if (ls.some(l => !l)) return null
  const lines = ls as TLine[]
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

/** Upper bound on cycle combinations tried inside one block (an implementation bound). */
export const BLOCK_COMBINATION_LIMIT = 1 << 16

/**
 * Every closed curve of every continuous curve, in discovery order, each once.
 *
 * A closed curve can only use lines of cycles, and the lines of one block
 * (biconnected part) never leave it, so the search is split by blocks
 * (dot 1791430851): inside each block, every connected even combination of its
 * fundamental cycles; then pieces of different blocks are joined only where they
 * share a point. Lines that belong to no cycle are never searched, so loops strung
 * together by single lines cost only as much as the loops that exist.
 */
export function closedLoops(n: NetworkState): FoundLoop[] {
  const found: FoundLoop[] = []
  const index = indexOf(n), lineById = index.lineById
  for (const comp of components(n)) {
    if (found.length >= LOOP_LIMIT) break
    const pieces: { block: number; lines: Id[]; points: Set<Id> }[] = []
    blocks(comp.lines.map(id => lineById.get(id)!)).forEach((block, bi) => {
      for (const ids of blockLoops(index, block)) {
        pieces.push({ block: bi, lines: ids, points: new Set(ids.flatMap(id => [lineById.get(id)!.a, lineById.get(id)!.b])) })
      }
    })
    const byPoint = new Map<Id, number[]>()
    pieces.forEach((p, i) => { for (const v of p.points) { if (!byPoint.has(v)) byPoint.set(v, []); byPoint.get(v)!.push(i) } })
    const seen = new Set<string>()
    const queue: { lines: Id[]; blocks: Set<number>; points: Set<Id> }[] = []
    const add = (item: { lines: Id[]; blocks: Set<number>; points: Set<Id> }) => {
      const key = loopKey(item.lines)
      if (seen.has(key) || found.length >= LOOP_LIMIT) return
      seen.add(key)
      queue.push(item)
      found.push({ key, layer: comp.layer, route: walkWith(index, item.lines)! })
    }
    for (const p of pieces) add({ lines: p.lines, blocks: new Set([p.block]), points: p.points })
    // join pieces of other blocks at shared points (a curve through a cut point twice)
    for (let i = 0; i < queue.length && found.length < LOOP_LIMIT; i++) {
      const item = queue[i]!
      for (const v of item.points) for (const pi of byPoint.get(v) ?? []) {
        const p = pieces[pi]!
        if (item.blocks.has(p.block)) continue
        add({ lines: [...item.lines, ...p.lines], blocks: new Set([...item.blocks, p.block]), points: new Set([...item.points, ...p.points]) })
      }
    }
  }
  return found
}

/** Biconnected blocks of a component (Tarjan, on lines so parallel lines count); single-line bridges are dropped. */
function blocks(lines: TLine[]): TLine[][] {
  const adj = new Map<Id, { line: number; other: Id }[]>()
  lines.forEach((l, i) => {
    for (const [p, q] of [[l.a, l.b], [l.b, l.a]] as const) { if (!adj.has(p)) adj.set(p, []); adj.get(p)!.push({ line: i, other: q }) }
  })
  const disc = new Map<Id, number>(), low = new Map<Id, number>()
  const stack: number[] = [], out: TLine[][] = []
  let time = 0
  const visit = (u: Id, viaLine: number) => {
    disc.set(u, time); low.set(u, time); time++
    for (const { line, other } of adj.get(u) ?? []) {
      if (line === viaLine) continue
      if (!disc.has(other)) {
        stack.push(line)
        visit(other, line)
        low.set(u, Math.min(low.get(u)!, low.get(other)!))
        if (low.get(other)! >= disc.get(u)!) {
          const block: number[] = []
          for (let e = stack.pop(); e !== undefined; e = stack.pop()) { block.push(e); if (e === line) break }
          if (block.length > 1) out.push(block.sort((x, y) => x - y).map(i => lines[i]!))
        }
      } else if (disc.get(other)! < disc.get(u)!) {
        stack.push(line)
        low.set(u, Math.min(low.get(u)!, disc.get(other)!))
      }
    }
  }
  if (lines.length) visit(lines[0]!.a, -1)
  return out
}

/** Connected even combinations of one block's fundamental cycles (each a closed curve). */
function blockLoops(index: Index, lines: TLine[]): Id[][] {
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
  const out: Id[][] = []
  const limit = Math.min(2 ** cycles.length, BLOCK_COMBINATION_LIMIT)
  for (let mask = 1; mask < limit; mask++) {
    const set = new Uint8Array(lines.length)
    for (let b = 0; b < cycles.length; b++) if (mask & (1 << b)) for (let i = 0; i < set.length; i++) set[i]! ^= cycles[b]![i]!
    const ids = lines.filter((_, i) => set[i]).map(l => l.id)
    if (walkWith(index, ids)) out.push(ids)
  }
  return out
}

// ---- one-time edits ------------------------------------------------------

function checkName(n: NetworkState, name: string, except?: Id) {
  if (!name.trim()) throw new Error('A layer name cannot be empty')
  if (S(n).layers.some(l => l.name === name && l.id !== except)) throw new Error(`Layer name "${name}" is already used`)
}

/** New empty layer, placed directly above `above` (or on top). Names are unique (bowen 1791435000). */
export function addLayer(n: NetworkState, id: Id, name: string = id, above?: Id) {
  if (hasLayer(n, id)) throw new Error(`Layer ${id} already exists`)
  checkName(n, name)
  const list = S(n).layers
  const at = above === undefined ? list.length : list.findIndex(l => l.id === above) + 1
  if (above !== undefined && at === 0) throw new Error(`No layer ${above}`)
  list.splice(at, 0, { id, name })
}

export function renameLayer(n: NetworkState, id: Id, name: string) {
  const layer = S(n).layers.find(l => l.id === id)
  if (!layer) throw new Error(`No layer ${id}`)
  checkName(n, name, id)
  layer.name = name
}

/** Move a layer to `index` in the bottom → top list (a state change). */
export function reorderLayer(n: NetworkState, id: Id, index: number) {
  if (!Number.isInteger(index)) throw new Error('Order index must be an integer')
  const list = S(n).layers, i = list.findIndex(l => l.id === id)
  if (i < 0) throw new Error(`No layer ${id}`)
  const [layer] = list.splice(i, 1)
  list.splice(Math.max(0, Math.min(index, list.length)), 0, layer!)
}

/** Remove a layer that holds no line; its leftover (isolated) points go with it. */
export function removeLayerIfEmpty(n: NetworkState, ch: Changes, id: Id): boolean {
  if (S(n).lines.some(l => rawPoint(n, l.a).layer === id)) return false
  const gone = S(n).points.filter(p => p.layer === id).map(p => p.id)
  S(n).points = S(n).points.filter(p => p.layer !== id)
  for (const p of gone) shapes.removePoint(SH(n), p)
  ch.deletedPoints.push(...gone)
  S(n).layers = S(n).layers.filter(l => l.id !== id)
  return true
}


/** Element state of a line (a state change; allowed on locked lines). */
export function setLineState(n: NetworkState, id: Id, state: Partial<ElementState>) {
  const l = rawLine(n, id)
  l.state = { visible: state.visible ?? l.state.visible, locked: state.locked ?? l.state.locked }
}

/** A line's own stroke in the bound layer (an edit; strokes are per view, bowen 1791650085). */
export function setLineStroke(n: NetworkState, id: Id, stroke: Stroke) {
  rawLine(n, id)
  shapes.setStroke(SH(n), K(n), id, stroke)
}

/**
 * Cut and paste a whole group to another layer, keeping every id (bowen 1791435958):
 * all of its points (and so its lines) change layer together.
 */
export function moveLinesToLayer(n: NetworkState, ch: Changes, lineIds: readonly Id[], layer: Id) {
  if (!hasLayer(n, layer)) throw new Error(`No layer ${layer}`)
  const pts = new Set(lineIds.flatMap(id => { const l = rawLine(n, id); return [l.a, l.b] }))
  for (const l of S(n).lines) if (!lineIds.includes(l.id) && (pts.has(l.a) || pts.has(l.b))) throw new Error('Only a whole continuous curve can be moved')
  for (const id of pts) { rawPoint(n, id).layer = layer; if (!ch.relocated.includes(id)) ch.relocated.push(id) }
}

/** Old → new ids of a copy. Point ids and line ids are separate ranges, so they have separate maps (dot 1791459462). */
export interface CopyMap { points: Map<Id, Id>; lines: Map<Id, Id> }

/**
 * Copy lines (with their points, handles, state and stroke) into `layer`, using
 * `idOf` for every new point and line id.
 */
/** `read`: where positions and handles are copied from (settled, docs/edit-model.md). */
/** Lines as plain data, with their end points: what a copy carries (docs/clipboard-plan.md). */
export interface LinesData {
  /** The structure: points and lines (one source of truth; their shapes are only in `layers`). */
  points: { id: Id }[]
  lines: { id: Id; a: Id; b: Id; state: ElementState }[]
  /** The shape layer the copy was read in (one of `layers`). */
  source: string
  /** The points' and lines' shapes in every shape layer of the copied drawing. */
  layers: { key: string; points: { id: Id; position: Vec }[]; lines: { id: Id; ha: Vec; hb: Vec; stroke: Stroke }[] }[]
}

/** The given lines and their end points as plain data (copies), read from `read` and from every layer of its drawing. */
export function linesData(read: NetworkState, lineIds: readonly Id[]): LinesData {
  const ids = [...new Set(lineIds)]
  const pointIds: Id[] = []
  for (const id of ids) { const l = rawLine(read, id); for (const p of [l.a, l.b]) if (!pointIds.includes(p)) pointIds.push(p) }
  const layerData = (h: NetworkState) => ({
    points: pointIds.map(id => ({ id, position: { ...pos(h, id) } })),
    lines: ids.map(id => { const s = shapeOf(h, id); return { id, ha: { ...s.ha }, hb: { ...s.hb }, stroke: { ...s.stroke } } }),
  })
  return {
    points: pointIds.map(id => ({ id })),
    lines: ids.map(id => { const l = rawLine(read, id); return { id, a: l.a, b: l.b, state: { ...l.state } } }),
    source: K(read),
    layers: keys(read).map(key => ({ key, ...layerData(of(read, key)) })),
  }
}

/**
 * New points and lines in `layer` from plain data, with new ids from `idOf`, moved by
 * `offset` in every shape layer. Each target layer takes its shapes from the clip's layer
 * of the same key; a layer the clip lacks takes the clip's source layer (a proposal,
 * Claude 1791652727). Clip layers the drawing does not have are ignored.
 */
export function insertLines(n: NetworkState, ch: Changes, data: LinesData, layer: Id, idOf: (old: Id) => Id, offset: Vec = { x: 0, y: 0 }): CopyMap {
  if (!hasLayer(n, layer)) throw new Error(`No layer ${layer}`)
  const off = vecIn(offset)
  const byKey = new Map(data.layers.map(L => [L.key, L]))
  const src = byKey.get(data.source)
  if (!src) throw new Error(`The copy has no shape layer ${data.source}`)
  const from = (key: string) => byKey.get(key) ?? src
  const pointAt = (key: string, id: Id) => { const p = from(key).points.find(x => x.id === id); if (!p) throw new Error(`The copy has no shape for point ${id} in ${key}`); return p.position }
  const shapeAt = (key: string, id: Id) => { const l = from(key).lines.find(x => x.id === id); if (!l) throw new Error(`The copy has no shape for line ${id} in ${key}`); return l }
  const map: CopyMap = { points: new Map(), lines: new Map() }
  for (const p of data.points) {
    const np = idOf(p.id)
    addPoint(n, ch, np, layer, key => { const q = pointAt(key, p.id); return { x: q.x + off.x, y: q.y + off.y } })
    map.points.set(p.id, np)
  }
  for (const l of data.lines) {
    const a = map.points.get(l.a), b = map.points.get(l.b)
    if (!a || !b || a === b) throw new Error(`Line ${l.id} needs two of the given points`)
    const nl = idOf(l.id)
    claimLine(n, nl)
    for (const key of keys(n)) { const s = shapeAt(key, l.id); shapes.putLine(SH(n), key, nl, { ha: s.ha, hb: s.hb, stroke: s.stroke }) }
    S(n).lines.push({ id: nl, a, b, state: { visible: !!l.state.visible, locked: !!l.state.locked } })
    ch.addedLines.push(nl)
    map.lines.set(l.id, nl)
  }
  return map
}

/**
 * Coincident endpoints in one layer (bowen 1791436564: never allowed). For each
 * set of points at exactly one position, which point is kept: the one this edit
 * did not act on; if several or none were acted on, the earlier-created one
 * (bowen 1791436617, 1791458278).
 */
export function overlaps(n: NetworkState, ch: Changes): { keep: Id; remove: Id }[] {
  const acted = new Set([...ch.targets.map(t => t.point), ...ch.relocated])
  const created = new Map(S(n).usedPoints.map((id, i) => [id, i]))
  const byPlace = new Map<string, Id[]>(), at = shapes.positions(SH(n), K(n))
  for (const p of S(n).points) {
    const q = at.get(p.id)!, key = JSON.stringify([p.layer, q.x, q.y])
    byPlace.set(key, [...(byPlace.get(key) ?? []), p.id])
  }
  const out: { keep: Id; remove: Id }[] = []
  for (const ids of byPlace.values()) {
    if (ids.length < 2) continue
    const order = [...ids].sort((x, y) => created.get(x)! - created.get(y)!)
    const still = order.filter(id => !acted.has(id))
    const keep = still.length === 1 ? still[0]! : order[0]!
    for (const id of order) if (id !== keep) out.push({ keep, remove: id })
  }
  return out
}

/**
 * Internal to this module: points are created only with lines (addLine, split, unbind,
 * insert). `at` gives its position in every shape layer (one value: the same everywhere).
 */
function addPoint(n: NetworkState, ch: Changes, id: Id, layer: Id, at: Vec | ((key: string) => Vec)) {
  if (!hasLayer(n, layer)) throw new Error(`No layer ${layer}`)
  const each = keys(n).map(key => [key, vecIn(typeof at === 'function' ? at(key) : at)] as const)
  claimPoint(n, id)
  for (const [key, v] of each) shapes.putPoint(SH(n), key, id, v)
  S(n).points.push({ id, layer })
  ch.addedPoints.push(id)
}

/** A line end: an existing point, or a new point created together with the line. */
export type EndSpec = Id | { id: Id; layer: Id; position: Vec }

/**
 * Pen: a new line from a to b (a is the first-clicked end). Each end is an existing
 * point or a new one created with the line — a point never exists without a line
 * (bowen 1791428375). Default handles make a straight line.
 */
/** `read`: where an existing end point's position is read from for the default handles (settled, docs/edit-model.md). */
export function addLine(n: NetworkState, ch: Changes, id: Id, aSpec: EndSpec, bSpec: EndSpec, handles?: { ha: Vec; hb: Vec }, read: NetworkState = n) {
  const endId = (e: EndSpec) => (typeof e === 'string' ? e : e.id)
  if (endId(aSpec) === endId(bSpec)) throw new Error('A line needs two different points')
  for (const e of [aSpec, bSpec]) if (typeof e !== 'string') addPoint(n, ch, e.id, e.layer, e.position)
  const a = endId(aSpec), b = endId(bSpec)
  const pa = rawPoint(n, a), pb = rawPoint(n, b)
  if (pa.layer !== pb.layer) throw new Error('A line cannot cross layers; use an endpoint link')
  const at = (spec: EndSpec, id: Id) => (typeof spec === 'string' ? pos(read, id) : pos(n, id))
  const d = sub(at(bSpec, b), at(aSpec, a))
  const hIn = handles ? { ha: vecIn(handles.ha), hb: vecIn(handles.hb) } : undefined
  claimLine(n, id)
  ch.prefer.push({ lines: linesAt(n, a).map(e => e.line.id) })
  // the drawn shape in every layer (architecture §1): the handles as drawn, the default stroke
  const shape = { ha: hIn?.ha ?? { x: d.x / 3, y: d.y / 3 }, hb: hIn?.hb ?? { x: -d.x / 3, y: -d.y / 3 }, stroke: DEFAULT_STROKE }
  for (const key of keys(n)) shapes.putLine(SH(n), key, id, shape)
  S(n).lines.push({ id, a, b, state: { ...DEFAULT_STATE } })
  ch.addedLines.push(id)
}

/** Drag points to targets. These points count as directly acted on (last target per point wins). */
export function move(n: NetworkState, ch: Changes, targets: { id: Id; target: Vec }[]) {
  for (const { id, target } of targets) {
    const t = vecIn(target)
    rawPoint(n, id)
    setPos(n, id, t)
    const i = ch.targets.findIndex(x => x.point === id)
    if (i >= 0) ch.targets.splice(i, 1)
    ch.targets.push({ point: id, target: { x: t.x, y: t.y } }) // separate copy: no shared object with the state
  }
}

/** Position updates computed by other modules (links). Not counted as acted on. */
export function setPositions(n: NetworkState, positions: { id: Id; position: Vec }[]) {
  for (const { id, position } of positions) { rawPoint(n, id); setPos(n, id, vecIn(position)) }
}

/** Drag one handle (an offset from its point). The handle is held during this edit. */
export function moveHandle(n: NetworkState, ch: Changes, lineId: Id, end: End, offset: Vec) {
  rawLine(n, lineId)
  setH(n, lineId, end, vecIn(offset))
  // a later direct drag replaces an earlier aimed tip of the same handle in this edit
  ch.handleTips = ch.handleTips.filter(h => !(h.line === lineId && h.end === end))
  hold(n, ch, lineId, end)
}

/** Handle updates computed by other modules (joins). */
export function setHandles(n: NetworkState, updates: { line: Id; end: End; offset: Vec }[]) {
  for (const u of updates) { rawLine(n, u.line); setH(n, u.line, u.end, vecIn(u.offset)) }
}

/** Split / add point: one line becomes two lines meeting at a new point. */
/** `read`: where the curve is read from (the edit so far as settled, docs/edit-model.md); written into `n`. */
export function splitLine(n: NetworkState, ch: Changes, lineId: Id, t: number, mid: Id, first: Id, second: Id, read: NetworkState = n) {
  if (!(t > 0 && t < 1)) throw new Error('Split parameter must be inside the line')
  if (first === second) throw new Error('The two pieces need different ids')
  const l = rawLine(n, lineId)
  // every layer splits its own curve at the same t (a proposal, Claude 1791652727): no layer's drawing changes
  const pieces = new Map(keys(n).map(key => {
    const h = of(read, key)
    return [key, { halves: split(curve(h, lineId), t), stroke: shapeOf(h, lineId).stroke }] as const
  }))
  claimLine(n, first)
  claimLine(n, second)
  addPoint(n, ch, mid, rawPoint(n, l.a).layer, key => pieces.get(key)!.halves[0][3])
  shapes.removeLine(SH(n), lineId)
  for (const [key, { halves: [c1, c2], stroke }] of pieces) {
    shapes.putLine(SH(n), key, first, { ha: sub(c1[1], c1[0]), hb: sub(c1[2], c1[3]), stroke })
    shapes.putLine(SH(n), key, second, { ha: sub(c2[1], c2[0]), hb: sub(c2[2], c2[3]), stroke })
  }
  const all = S(n).lines
  all.splice(all.indexOf(l), 1, { id: first, a: l.a, b: mid, state: { ...l.state } }, { id: second, a: mid, b: l.b, state: { ...l.state } })
  ch.addedLines.push(first, second)
  ch.replaced.push({ line: lineId, a: l.a, b: l.b, mid, pieces: [first, second], t })
}

/** Delete removes the line; an endpoint left with no line is removed at commit (removeIsolated). */
export function deleteLine(n: NetworkState, ch: Changes, id: Id) {
  const l = rawLine(n, id)
  S(n).lines = S(n).lines.filter(x => x.id !== id)
  shapes.removeLine(SH(n), id)
  ch.deletedLines.push(id)
  touch(ch, l.a); touch(ch, l.b) // constraints at its ends changed
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
  for (const id of collapsed) shapes.removeLine(SH(n), id)
  shapes.removePoint(SH(n), remove)
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
  for (const id of isolated) shapes.removePoint(SH(n), id)
  ch.deletedPoints.push(...isolated)
}

/** Unbind: the given lines leave `pointId` for a new point at the same position. */
/** `read`: where the point's position and the lines' handles are read from (settled, docs/edit-model.md). */
export function unbind(n: NetworkState, ch: Changes, pointId: Id, lineIds: Id[], newPoint: Id, read: NetworkState = n) {
  const p = rawPoint(n, pointId), at0 = pos(read, pointId)
  const at = new Set(linesAt(n, pointId).map(e => e.line.id))
  if (!lineIds.length || lineIds.some(id => !at.has(id))) throw new Error(`Unbind: every line must end at ${pointId}`)
  // Offset the split-off point so the two never coincide again (bowen 1791436858):
  // a short fixed distance back along the first moved line (a filled-in default),
  // measured in this layer. Every layer gets its own old position + that same offset
  // (a proposal, Claude 1791652727).
  const firstId = lineIds[0]!, f0 = rawLine(n, firstId), atA = f0.a === pointId, seen = shapeOf(read, firstId)
  const other = pos(read, atA ? f0.b : f0.a)
  const toward = length(atA ? seen.ha : seen.hb) > 1e-12 ? (atA ? seen.ha : seen.hb) : sub(other, at0)
  const dir = length(toward) > 1e-12 ? scale(toward, 1 / length(toward)) : { x: 1, y: 0 }
  const shift = scale(dir, UNBIND_OFFSET)
  addPoint(n, ch, newPoint, p.layer, key => add(pos(of(read, key), pointId), shift))
  for (const id of lineIds) {
    const l = rawLine(n, id)
    if (l.a === pointId) l.a = newPoint
    else l.b = newPoint
  }
  ch.unbound.push({ point: pointId, newPoint, lines: [...lineIds] })
}
