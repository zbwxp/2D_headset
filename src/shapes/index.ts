// shapes — shape layers (docs/architecture-multiview.md §1). One layer holds, for every
// point its position, and for every line its two handles and its stroke. A drawing has
// one structure (network) and several shape layers over it: the nine views, and later
// the hidden baselines and the expression shapes. This module stores the layers and
// their kinds; it knows nothing of views, baselines or expressions beyond the kind.
//
// Encapsulation (as network, dot 1791427188): the state is opaque outside this module.
// Reads return frozen copies; inputs are copied before they are stored. Ids are kept
// in own-property records, read with hasOwn and written with defineProperty, so an id
// such as "__proto__" is an ordinary key.
import type { Vec } from '../geometry'

export type Id = string
/** view: an editable view; expression: an editable expression shape; record: a hidden baseline. */
export type LayerKind = 'view' | 'expression' | 'record'
export const KINDS: readonly LayerKind[] = Object.freeze(['view', 'expression', 'record'])
export interface Stroke { readonly width: number; readonly profile: string }
export interface LineShape { readonly ha: Vec; readonly hb: Vec; readonly stroke: Stroke }
export interface LayerInfo { readonly key: string; readonly kind: LayerKind }

declare const opaque: unique symbol
/** Opaque handle to the shape layers of one drawing. */
export type ShapesState = { readonly [opaque]: 'shapes' }

type Mutable<T> = { -readonly [K in keyof T]: T[K] }
/** Per-layer values keyed by their owner (joins: a radius under its join row's key, an end stroke under its point). */
export type Slot = 'radius' | 'end'
export type EndValue = Readonly<Record<string, number | string>>
interface LayerData {
  key: string
  kind: LayerKind
  points: Record<Id, Vec>
  lines: Record<Id, { ha: Vec; hb: Vec; stroke: Mutable<Stroke> }>
  /** Values owned by other modules, stored per layer (step 4, dot 1791654260): shapes only stores them. */
  radius: Record<string, number>
  end: Record<string, Record<string, number | string>>
}
interface Store { layers: LayerData[] }
const S = (s: ShapesState) => s as unknown as Store

const own = <T>(r: Record<string, T>, id: string): T | undefined => (Object.hasOwn(r, id) ? r[id] : undefined)
const put = <T>(r: Record<string, T>, id: string, v: T) => { Object.defineProperty(r, id, { value: v, writable: true, enumerable: true, configurable: true }) }
const drop = (r: Record<string, unknown>, id: string) => { if (Object.hasOwn(r, id)) delete r[id] }

function vecIn(v: Vec): Vec {
  if (!v || !Number.isFinite(v.x) || !Number.isFinite(v.y)) throw new Error('Coordinates must be finite numbers')
  return { x: v.x, y: v.y }
}
function strokeIn(s: Stroke): Mutable<Stroke> {
  if (!s || !(s.width > 0) || !Number.isFinite(s.width)) throw new Error('Stroke width must be a positive number')
  return { width: s.width, profile: String(s.profile) }
}
const vecOut = (v: Vec): Vec => Object.freeze({ x: v.x, y: v.y })

function kindIn(kind: LayerKind): LayerKind {
  if (!KINDS.includes(kind)) throw new Error(`Unknown shape layer kind ${String(kind)}`)
  return kind
}
function layer(s: ShapesState, key: string): LayerData {
  const L = S(s).layers.find(l => l.key === key)
  if (!L) throw new Error(`No shape layer ${key}`)
  return L
}

/** A drawing's shapes with one empty first layer. */
export function create(first: LayerInfo): ShapesState {
  if (typeof first.key !== 'string' || !first.key) throw new Error('A shape layer needs a key')
  return { layers: [{ key: first.key, kind: kindIn(first.kind), points: {}, lines: {}, radius: {}, end: {} }] } as Store as unknown as ShapesState
}

/** A new layer holding a copy of `from` (every point and line has a shape in every layer). */
export function addLayer(s: ShapesState, key: string, kind: LayerKind, from: string) {
  if (typeof key !== 'string' || !key) throw new Error('A shape layer needs a key')
  if (S(s).layers.some(l => l.key === key)) throw new Error(`Shape layer ${key} already exists`)
  const src = layer(s, from)
  S(s).layers.push({ key, kind: kindIn(kind), points: structuredClone(src.points), lines: structuredClone(src.lines), radius: structuredClone(src.radius), end: structuredClone(src.end) })
}

export const layers = (s: ShapesState): readonly LayerInfo[] => Object.freeze(S(s).layers.map(l => Object.freeze({ key: l.key, kind: l.kind })))
export const hasLayer = (s: ShapesState, key: string) => S(s).layers.some(l => l.key === key)
export const kind = (s: ShapesState, key: string): LayerKind => layer(s, key).kind

// ---- one layer ----------------------------------------------------------

export function position(s: ShapesState, key: string, point: Id): Vec {
  const v = own(layer(s, key).points, point)
  if (!v) throw new Error(`No point ${point} in shape layer ${key}`)
  return vecOut(v)
}
export function line(s: ShapesState, key: string, id: Id): LineShape {
  const l = own(layer(s, key).lines, id)
  if (!l) throw new Error(`No line ${id} in shape layer ${key}`)
  return Object.freeze({ ha: vecOut(l.ha), hb: vecOut(l.hb), stroke: Object.freeze({ ...l.stroke }) })
}
/** Every point position of one layer (one pass, for bulk readers). */
export function positions(s: ShapesState, key: string): ReadonlyMap<Id, Vec> {
  const pts = layer(s, key).points
  return new Map(Object.keys(pts).map(id => [id, vecOut(pts[id]!)]))
}

export function setPosition(s: ShapesState, key: string, point: Id, v: Vec) {
  const L = layer(s, key)
  if (!own(L.points, point)) throw new Error(`No point ${point} in shape layer ${key}`)
  put(L.points, point, vecIn(v))
}
export function setHandle(s: ShapesState, key: string, id: Id, end: 'a' | 'b', v: Vec) {
  const l = own(layer(s, key).lines, id)
  if (!l) throw new Error(`No line ${id} in shape layer ${key}`)
  if (end === 'a') l.ha = vecIn(v)
  else l.hb = vecIn(v)
}
export function setStroke(s: ShapesState, key: string, id: Id, stroke: Stroke) {
  const l = own(layer(s, key).lines, id)
  if (!l) throw new Error(`No line ${id} in shape layer ${key}`)
  l.stroke = strokeIn(stroke)
}

// ---- per-layer values owned by other modules -----------------------------------

function slotIn(slot: Slot, v: unknown): number | Record<string, number | string> {
  if (slot === 'radius') {
    if (typeof v !== 'number' || !Number.isFinite(v) || !(v > 0)) throw new Error('A radius must be a finite number above zero')
    return v
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('An end stroke must be an object')
  const o = v as Record<string, unknown>, out: Record<string, number | string> = {}
  for (const k of Object.keys(o).sort()) {
    const x = o[k]
    if (x === undefined) continue
    if (typeof x === 'number' ? !Number.isFinite(x) : typeof x !== 'string') throw new Error('End stroke values must be finite numbers or strings')
    put(out, k, x)
  }
  return out
}
const slotOut = (v: number | Record<string, number | string>) => (typeof v === 'number' ? v : Object.freeze({ ...v }))

/** A value in one layer, or undefined. */
export function slotGet(s: ShapesState, key: string, slot: Slot, id: string): number | EndValue | undefined {
  const v = own(layer(s, key)[slot] as Record<string, number | Record<string, number | string>>, id)
  return v === undefined ? undefined : slotOut(v)
}
/** Write a value in one layer (copied in; end strokes stored with sorted keys, one form per content). */
export function slotSet(s: ShapesState, key: string, slot: Slot, id: string, v: number | EndValue) {
  put(layer(s, key)[slot] as Record<string, unknown>, id, slotIn(slot, v))
}
/** Remove a value from one layer. */
export function slotDropIn(s: ShapesState, key: string, slot: Slot, id: string) { drop(layer(s, key)[slot], id) }
/** Remove a value from every layer. */
export function slotDrop(s: ShapesState, slot: Slot, id: string) { for (const L of S(s).layers) drop(L[slot], id) }
/** Every key holding a value in one layer. */
export const slotKeys = (s: ShapesState, key: string, slot: Slot): string[] => Object.keys(layer(s, key)[slot])

// ---- structure follows (called by network only) ----------------------------

/**
 * A new point or line gets its shape in one layer. Every layer must end up holding
 * every point and line; network checks that before a structural change completes.
 */
export function putPoint(s: ShapesState, key: string, point: Id, v: Vec) { put(layer(s, key).points, point, vecIn(v)) }
export function putLine(s: ShapesState, key: string, id: Id, shape: { ha: Vec; hb: Vec; stroke: Stroke }) {
  put(layer(s, key).lines, id, { ha: vecIn(shape.ha), hb: vecIn(shape.hb), stroke: strokeIn(shape.stroke) })
}
/** A point or line removed from the structure leaves every layer. */
export function removePoint(s: ShapesState, point: Id) { for (const L of S(s).layers) drop(L.points, point) }
export function removeLine(s: ShapesState, id: Id) { for (const L of S(s).layers) drop(L.lines, id) }

/** Every layer holds exactly these points and lines (an internal consistency check). */
export function covers(s: ShapesState, points: readonly Id[], lines: readonly Id[]): boolean {
  for (const L of S(s).layers) {
    const p = Object.keys(L.points), l = Object.keys(L.lines)
    if (p.length !== points.length || l.length !== lines.length) return false
    if (points.some(id => !Object.hasOwn(L.points, id)) || lines.some(id => !Object.hasOwn(L.lines, id))) return false
  }
  return true
}

// ---- saved data ------------------------------------------------------------

function fail(what: string): never { throw new Error(`open-failed: ${what}`) }
const obj = (v: unknown, what: string): Record<string, unknown> => { if (!v || typeof v !== 'object' || Array.isArray(v)) fail(`${what} is not an object`); return v as Record<string, unknown> }
const num = (v: unknown, what: string): number => { if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${what} is not a finite number`); return v }
const vec = (v: unknown, what: string): Vec => { const o = obj(v, what); return { x: num(o.x, `${what}.x`), y: num(o.y, `${what}.y`) } }

/**
 * Shape layers from saved data, checked: known kinds, unique keys, and every layer holds
 * a finite shape for exactly the given points and lines (a positive stroke width).
 */
export function restore(v: unknown, ids: { points: readonly Id[]; lines: readonly Id[] }): ShapesState {
  const o = obj(v, 'shapes')
  if (!Array.isArray(o.layers) || !o.layers.length) fail('shapes has no layers')
  const keys = new Set<string>()
  const layers: LayerData[] = o.layers.map((x, i) => {
    const L = obj(x, `shape layer ${i}`)
    if (typeof L.key !== 'string' || !L.key) fail(`shape layer ${i} has no key`)
    if (keys.has(L.key)) fail(`shape layer ${L.key} appears twice`)
    keys.add(L.key)
    if (!KINDS.includes(L.kind as LayerKind)) fail(`shape layer ${L.key} has an unknown kind`)
    const P = obj(L.points, `shape layer ${L.key} points`), Ls = obj(L.lines, `shape layer ${L.key} lines`)
    const points: Record<Id, Vec> = {}, lines: LayerData['lines'] = {}
    for (const id of ids.points) { if (!Object.hasOwn(P, id)) fail(`shape layer ${L.key} has no position for point ${id}`); put(points, id, vec(P[id], `point ${id} in ${L.key}`)) }
    for (const id of ids.lines) {
      if (!Object.hasOwn(Ls, id)) fail(`shape layer ${L.key} has no shape for line ${id}`)
      const s = obj(Ls[id], `line ${id} in ${L.key}`), k = obj(s.stroke, `line ${id} stroke in ${L.key}`)
      const width = num(k.width, `line ${id} stroke width in ${L.key}`)
      if (!(width > 0)) fail(`line ${id} has a stroke width that is not positive in ${L.key}`)
      if (typeof k.profile !== 'string') fail(`line ${id} stroke profile in ${L.key} is not text`)
      put(lines, id, { ha: vec(s.ha, `line ${id} ha in ${L.key}`), hb: vec(s.hb, `line ${id} hb in ${L.key}`), stroke: { width, profile: k.profile } })
    }
    if (Object.keys(P).length !== ids.points.length) fail(`shape layer ${L.key} has positions for points that do not exist`)
    if (Object.keys(Ls).length !== ids.lines.length) fail(`shape layer ${L.key} has shapes for lines that do not exist`)
    // values of other modules: types here; their keys are checked by their owners (joins)
    const R = obj(L.radius, `shape layer ${L.key} radius`), E = obj(L.end, `shape layer ${L.key} end strokes`)
    const radius: Record<string, number> = {}, end: Record<string, Record<string, number | string>> = {}
    for (const k of Object.keys(R)) { const r = num(R[k], `radius ${k} in ${L.key}`); if (!(r > 0)) fail(`radius ${k} in ${L.key} is not above zero`); put(radius, k, r) }
    for (const k of Object.keys(E)) {
      const e = obj(E[k], `end stroke ${k} in ${L.key}`)
      for (const f of Object.keys(e)) { const x = e[f]; if (typeof x !== 'string') num(x, `end stroke ${k} ${f} in ${L.key}`) }
      // compared with the writer's own normal form, not with a sort: integer-like keys
      // enumerate in numeric order whatever the insertion order (dot 1791654767)
      const kept = slotIn('end', e) as Record<string, number | string>
      if (JSON.stringify(kept) !== JSON.stringify(e)) fail(`end stroke ${k} in ${L.key} is not in its stored form`)
      put(end, k, kept)
    }
    return { key: L.key, kind: L.kind as LayerKind, points, lines, radius, end }
  })
  return { layers } as Store as unknown as ShapesState
}
