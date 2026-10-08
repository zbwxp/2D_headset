// editing — the selection and geometric transforms (graph: Editing table).
// The selection is a pre-edit: it is part of the document state, so changing it is
// one undoable step, and an unchanged selection adds no step (bowen 1791465011).
// A geometric transform acts on the points and handles the selection expands to;
// it never splits points or lines and never changes ids (dot 1791463963, 1791465219).
import * as net from '../network'
import * as groups from '../groups'
import * as fills from '../fills'
import { type Vec, type Cubic, add, sub, bounds } from '../geometry'

type Id = net.Id

/** A selectable unit: a point, a handle (a line's end), a line, or a fill (graph: "Selectable units"). */
export type Unit =
  | { kind: 'point'; id: Id }
  | { kind: 'handle'; line: Id; end: net.End }
  | { kind: 'line'; id: Id }
  | { kind: 'fill'; id: Id }
export type Mode = 'replace' | 'add' | 'remove'

declare const opaque: unique symbol
/** Opaque handle; read through `units` (copies). */
export type SelectionState = { readonly [opaque]: 'selection' }
interface Store { units: Unit[] }
const S = (s: SelectionState) => s as unknown as Store

// A selection is a set: one stored form, sorted, so equal selections compare equal.
const key = (u: Unit) => JSON.stringify(u.kind === 'handle' ? [u.kind, u.line, u.end] : [u.kind, u.id])
const unitCopy = (u: Unit): Unit => (u.kind === 'handle' ? { kind: 'handle', line: u.line, end: u.end } : { kind: u.kind, id: u.id })
function normal(units: readonly Unit[]): Unit[] {
  const byKey = new Map(units.map(u => [key(u), unitCopy(u)]))
  return [...byKey.keys()].sort().map(k => byKey.get(k)!)
}

export const create = (): SelectionState => ({ units: [] }) as Store as unknown as SelectionState
export const units = (s: SelectionState): Unit[] => S(s).units.map(unitCopy)

const exists = (n: net.NetworkState, f: fills.FillsState, u: Unit) =>
  u.kind === 'point' ? net.hasPoint(n, u.id) : u.kind === 'fill' ? fills.order(f).includes(u.id) : net.hasLine(n, u.kind === 'line' ? u.id : u.line)

export function select(s: SelectionState, n: net.NetworkState, f: fills.FillsState, picked: readonly Unit[], mode: Mode = 'replace') {
  for (const u of picked) if (!exists(n, f, u)) throw new Error(`Nothing to select: ${key(u)}`)
  const remove = new Set(picked.map(key))
  S(s).units = normal(mode === 'replace' ? picked : mode === 'add' ? [...S(s).units, ...picked] : S(s).units.filter(u => !remove.has(key(u))))
}

/** V: every line of the continuous curve the line belongs to, hidden ones included. */
export function groupUnits(g: groups.GroupsState, n: net.NetworkState, line: Id): Unit[] {
  const group = groups.list(g, n).find(x => x.lines.includes(line))
  if (!group) throw new Error(`No line ${line}`)
  return group.lines.map(id => ({ kind: 'line', id }))
}

/** Drop what no longer exists (in the same step as the edit that removed it). */
export function clean(s: SelectionState, n: net.NetworkState, f: fills.FillsState) {
  S(s).units = S(s).units.filter(u => exists(n, f, u))
}

/**
 * What a geometric transform acts on: a point is itself, a handle is itself, a line
 * is its two end points and two handles. A shared point counts once. A selected fill
 * is not geometry and adds nothing: what transforming or deleting a fill selection
 * should do is not decided (dot, review of 070477e).
 */
export function expand(s: SelectionState, n: net.NetworkState, f: fills.FillsState): { points: Id[]; handles: { line: Id; end: net.End }[] } {
  const points = new Set<Id>(), handles = new Map<string, { line: Id; end: net.End }>()
  const addLine = (id: Id) => {
    const l = net.line(n, id)
    points.add(l.a); points.add(l.b)
    for (const end of ['a', 'b'] as const) handles.set(JSON.stringify([id, end]), { line: id, end })
  }
  for (const u of S(s).units) {
    if (u.kind === 'point') points.add(u.id)
    else if (u.kind === 'handle') handles.set(JSON.stringify([u.line, u.end]), { line: u.line, end: u.end })
    else if (u.kind === 'line') addLine(u.id)
  }
  return { points: [...points].sort(), handles: [...handles.keys()].sort().map(k => handles.get(k)!) }
}

/** x' = a·x + c·y + e, y' = b·x + d·y + f */
export interface Affine { a: number; b: number; c: number; d: number; e: number; f: number }
const apply = (m: Affine, p: Vec): Vec => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f })

export const translation = (dx: number, dy: number): Affine => ({ a: 1, b: 0, c: 0, d: 1, e: dx, f: dy })
export function rotation(centre: Vec, angle: number): Affine {
  const cos = Math.cos(angle), sin = Math.sin(angle)
  return { a: cos, b: sin, c: -sin, d: cos, e: centre.x - cos * centre.x + sin * centre.y, f: centre.y - sin * centre.x - cos * centre.y }
}
export function scaling(centre: Vec, sx: number, sy: number): Affine {
  return { a: sx, b: 0, c: 0, d: sy, e: centre.x * (1 - sx), f: centre.y * (1 - sy) }
}

/**
 * The moves a transform makes: expanded points go to M·p. An expanded handle's tip
 * (its absolute position) goes to M·tip, and its new offset is measured from where
 * its point ends up, so a handle selected alone moves too (dot, review of 070477e).
 * Every other handle keeps its offset, so it moves with its point without turning
 * (graph: "Geometric transform keeps"). Line width is untouched.
 */
export function transformPlan(s: SelectionState, n: net.NetworkState, f: fills.FillsState, m: Affine) {
  if (![m.a, m.b, m.c, m.d, m.e, m.f].every(Number.isFinite)) throw new Error('A transform needs finite numbers')
  if (Math.abs(m.a * m.d - m.b * m.c) < 1e-12) throw new Error('A transform must not collapse the selection (zero scale)')
  const { points, handles } = expand(s, n, f)
  const moved = new Set(points)
  const at = (id: Id) => net.point(n, id).position
  const after = (id: Id) => (moved.has(id) ? apply(m, at(id)) : at(id))
  return {
    moves: points.map(id => ({ id, target: apply(m, at(id)) })),
    handles: handles.map(h => {
      const l = net.line(n, h.line), p = h.end === 'a' ? l.a : l.b, tip = add(at(p), net.handle(l, h.end))
      return { ...h, offset: sub(apply(m, tip), after(p)) }
    }),
  }
}

/** The centre of the selection's own curve bounds (for a flip about its own centre, bowen 1791471111). */
export function centre(s: SelectionState, n: net.NetworkState, f: fills.FillsState): Vec {
  const { points } = expand(s, n, f)
  const lineIds = new Set(S(s).units.flatMap(u => (u.kind === 'line' ? [u.id] : [])))
  const boxes = [...lineIds].map(id => bounds(net.curve(n, id) as Cubic))
  const pts = points.map(id => net.point(n, id).position)
  const xs = [...boxes.flatMap(b => [b.min.x, b.max.x]), ...pts.map(p => p.x)]
  const ys = [...boxes.flatMap(b => [b.min.y, b.max.y]), ...pts.map(p => p.y)]
  if (!xs.length) throw new Error('Nothing selected')
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
}

/** Delete removes lines only (bowen 1791392558, 1791465011). */
export function deletion(s: SelectionState): Id[] {
  const lines = S(s).units.flatMap(u => (u.kind === 'line' ? [u.id] : []))
  if (!lines.length) throw new Error('select-lines-to-delete: delete removes lines only; select lines to delete')
  return lines
}
