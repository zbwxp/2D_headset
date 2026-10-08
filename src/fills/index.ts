// fills — a fill is an attribute of a closed loop (Q18). Loops are found from
// shared points; a filled loop keeps its identity and boundary lines through
// splits and binds, and its fill disappears when the boundary is no longer one
// closed walk in one layer (Q21: one principle, no per-operation special cases).
// Fill order: bottom → top; a new fill goes on top (Q24 D).
import * as net from '../network'

type Id = net.Id

export interface FilledLoop { id: Id; layer: Id; lines: Id[]; color: string; visible: boolean }
declare const opaque: unique symbol
/** Opaque handle; read through discover / order (copies). */
export type FillsState = { readonly [opaque]: 'fills' }
interface Store { loops: FilledLoop[]; order: Id[] }
const S = (f: FillsState) => f as unknown as Store
export interface LoopView { id: Id; layer: Id; route: net.LoopUse[]; filled: boolean; color?: string; visible?: boolean }

export const create = (): FillsState => ({ loops: [], order: [] }) as Store as unknown as FillsState
export const order = (f: FillsState): Id[] => [...S(f).order]

function find(f: FillsState, id: Id): FilledLoop {
  const l = S(f).loops.find(x => x.id === id)
  if (!l) throw new Error(`No filled loop ${id}`)
  return l
}

/**
 * Every closed curve, in discovery order, filled or not — clearing a fill never
 * hides a loop (bowen 1791430259). A filled loop keeps its stored id and colour.
 */
export function discover(f: FillsState, n: net.NetworkState): LoopView[] {
  const filledByKey = new Map(S(f).loops.map(l => [net.loopKey(l.lines), l]))
  const views: LoopView[] = []
  const shown = new Set<Id>()
  for (const found of net.closedLoops(n)) {
    const stored = filledByKey.get(found.key)
    if (stored) {
      views.push({ id: stored.id, layer: stored.layer, route: found.route, filled: true, color: stored.color, visible: stored.visible })
      shown.add(stored.id)
    } else views.push({ id: found.key, layer: found.layer, route: found.route, filled: false })
  }
  // A filled loop beyond the enumeration limit is still listed.
  for (const l of S(f).loops) if (!shown.has(l.id)) views.push({ id: l.id, layer: l.layer, route: net.closedWalk(n, l.lines)!, filled: true, color: l.color, visible: l.visible })
  return views
}

/** Fill a loop (by id from discover). A new fill goes on top. */
export function fill(f: FillsState, n: net.NetworkState, id: Id, color: string) {
  const existing = S(f).loops.find(l => l.id === id)
  if (existing) { existing.color = color; return }
  const found = net.closedLoops(n).find(l => l.key === id)
  if (!found) throw new Error(`No loop ${id}`)
  S(f).loops.push({ id, layer: found.layer, lines: found.route.map(u => u.line), color, visible: true })
  S(f).order.push(id)
}

export function clearFill(f: FillsState, id: Id) {
  find(f, id)
  S(f).loops = S(f).loops.filter(l => l.id !== id)
  S(f).order = S(f).order.filter(x => x !== id)
}

export function setVisible(f: FillsState, id: Id, visible: boolean) { find(f, id).visible = visible }

/**
 * Move a fill to `index` among the fills of its own continuous curve (bottom → top).
 * Fills of other groups keep their places (dot 1791427693).
 */
export function reorder(f: FillsState, n: net.NetworkState, id: Id, index: number) {
  if (!Number.isInteger(index)) throw new Error('Order index must be an integer')
  const loop = find(f, id)
  const comp = net.components(n).find(c => c.lines.includes(loop.lines[0]!))
  const inGroup = new Set(comp?.lines ?? [])
  const same = (x: Id) => find(f, x).lines.some(l => inGroup.has(l))
  const slots = S(f).order.flatMap((x, i) => (same(x) ? [i] : []))
  const members = slots.map(i => S(f).order[i]!).filter(x => x !== id)
  members.splice(Math.max(0, Math.min(index, members.length)), 0, id)
  slots.forEach((slot, k) => { S(f).order[slot] = members[k]! })
}

/** Keep boundary references after one network operation. */
export function update(f: FillsState, ch: net.Changes) {
  for (const r of ch.replaced) for (const l of S(f).loops) l.lines = l.lines.flatMap(x => (x === r.line ? [...r.pieces] : [x]))
  const collapsed = new Set(ch.collapsedLines)
  for (const l of S(f).loops) l.lines = l.lines.filter(x => !collapsed.has(x))
  const deleted = new Set(ch.deletedLines)
  drop(f, S(f).loops.filter(l => l.lines.some(x => deleted.has(x))).map(l => l.id))
}

/** Drop every fill whose boundary is no longer one closed walk in one layer. */
export function validate(f: FillsState, n: net.NetworkState) {
  drop(f, S(f).loops.filter(l => !net.closedWalk(n, l.lines) || l.lines.some(x => net.layerOfLine(n, x) !== l.layer)).map(l => l.id))
}

function drop(f: FillsState, ids: Id[]) {
  if (!ids.length) return
  const gone = new Set(ids)
  S(f).loops = S(f).loops.filter(l => !gone.has(l.id))
  S(f).order = S(f).order.filter(x => !gone.has(x))
}
