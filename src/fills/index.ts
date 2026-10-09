// fills — a fill is an attribute of a closed loop (Q18). Loops are found from
// shared points; a filled loop keeps its identity and boundary lines through
// splits and binds, and its fill disappears when the boundary is no longer one
// closed walk in one layer (Q21: one principle, no per-operation special cases).
// Fill order: bottom → top; a new fill goes on top (Q24 D).
// A fill's layer is not stored: it is always read from its boundary lines, so every
// later operation in the same edit sees where the fill really is (dot 1791459521).
import * as net from '../network'

type Id = net.Id

interface FilledLoop { id: Id; lines: Id[]; color: string; visible: boolean; locked: boolean }
declare const opaque: unique symbol
/** Opaque handle; read through discover / order (copies). */
export type FillsState = { readonly [opaque]: 'fills' }
interface Store { loops: FilledLoop[]; order: Id[] }
const S = (f: FillsState) => f as unknown as Store
export interface LoopView { id: Id; layer: Id; route: net.LoopUse[]; filled: boolean; color?: string; visible?: boolean; locked?: boolean }

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
      views.push({ id: stored.id, layer: found.layer, route: found.route, filled: true, color: stored.color, visible: stored.visible, locked: stored.locked })
      shown.add(stored.id)
    } else views.push({ id: found.key, layer: found.layer, route: found.route, filled: false })
  }
  // A filled loop beyond the enumeration limit is still listed. One whose boundary
  // is not closed right now (broken earlier in this edit; dropped at commit) is not
  // a closed curve, so it is not listed (dot 1791459721).
  for (const l of S(f).loops) {
    if (shown.has(l.id)) continue
    const route = net.closedWalk(n, l.lines)
    if (route) views.push({ id: l.id, layer: layerOf(n, l)!, route, filled: true, color: l.color, visible: l.visible, locked: l.locked })
  }
  return views
}

/** Fill a loop (by id from discover). A new fill goes on top. */
// A locked fill's colour is its protected content (Q29 C): changing or clearing it is
// refused. Its fill may still vanish when its loop breaks (Q30 甲).
const unlocked = (l: FilledLoop) => { if (l.locked) throw new Error(`Fill ${l.id} is locked`); return l }

export function fill(f: FillsState, n: net.NetworkState, id: Id, color: string) {
  const existing = S(f).loops.find(l => l.id === id)
  if (existing) { unlocked(existing).color = color; return }
  const found = net.closedLoops(n).find(l => l.key === id)
  if (!found) throw new Error(`No loop ${id}`)
  S(f).loops.push({ id, lines: found.route.map(u => u.line), color, visible: true, locked: false })
  S(f).order.push(id)
}

export function clearFill(f: FillsState, id: Id) {
  unlocked(find(f, id))
  S(f).loops = S(f).loops.filter(l => l.id !== id)
  S(f).order = S(f).order.filter(x => x !== id)
}

/** Element state of a fill (a state change; allowed on locked fills). */
export function setState(f: FillsState, id: Id, state: { visible?: boolean; locked?: boolean }) {
  const l = find(f, id)
  if (state.visible !== undefined) l.visible = state.visible
  if (state.locked !== undefined) l.locked = state.locked
}
export const setVisible = (f: FillsState, id: Id, visible: boolean) => setState(f, id, { visible })

/** Delete a fill as part of a batch (layer delete); locked fills are left alone. */
export function clearUnlocked(f: FillsState, ids: readonly Id[]) {
  drop(f, ids.filter(id => !find(f, id).locked))
}

/** The layer of a fill's boundary lines, read from the network now; none if no boundary line is left. */
function layerOf(n: net.NetworkState, l: FilledLoop): Id | undefined {
  const line = l.lines.find(x => net.hasLine(n, x))
  return line === undefined ? undefined : net.layerOfLine(n, line)
}

/** Fill ids whose loops lie in a layer. */
export const inLayer = (f: FillsState, n: net.NetworkState, layer: Id): Id[] => S(f).loops.filter(l => layerOf(n, l) === layer).map(l => l.id)

/**
 * Copy fills whose every boundary line was copied (map old → new ids). New fill
 * ids come from `idOf`; colour and state are kept; the copies go on top, in the
 * originals' order.
 */
/** Filled loops as plain data, in fill order. */
export interface FillData { id: Id; lines: Id[]; color: string; visible: boolean; locked: boolean }

/** The filled loops whose boundary lines are all in the range, in fill order. */
export function rangeData(f: FillsState, lines: ReadonlySet<Id>): FillData[] {
  return S(f).order.map(id => find(f, id)).filter(l => l.lines.every(x => lines.has(x))).map(l => ({ ...l, lines: [...l.lines] }))
}

/** Filled loops from plain data onto copied lines, on top of the fill order. */
export function insert(f: FillsState, n: net.NetworkState, data: readonly FillData[], map: net.CopyMap, idOf: (old: Id) => Id) {
  for (const l of data) {
    if (!l.lines.every(x => map.lines.has(x))) continue
    const id = idOf(l.id)
    if (S(f).loops.some(x => x.id === id)) throw new Error(`Fill ${id} already exists`)
    if (typeof l.color !== 'string') throw new Error(`Fill ${l.id} has no colour`)
    // the boundary must be a closed curve of the inserted lines: a bad clip is refused, not cleaned up later (dot 1791514309)
    const mapped = l.lines.map(x => map.lines.get(x)!)
    if (!net.closedWalk(n, mapped)) throw new Error(`Fill ${l.id}: its lines are not a closed curve`) // the same test validate uses (dot 1791514536)
    S(f).loops.push({ id, lines: l.lines.map(x => map.lines.get(x)!), color: l.color, visible: !!l.visible, locked: !!l.locked })
    S(f).order.push(id)
  }
}

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
  drop(f, S(f).loops.filter(l => !net.closedWalk(n, l.lines)).map(l => l.id))
}

function drop(f: FillsState, ids: Id[]) {
  if (!ids.length) return
  const gone = new Set(ids)
  S(f).loops = S(f).loops.filter(l => !gone.has(l.id))
  S(f).order = S(f).order.filter(x => !gone.has(x))
}

/** Fills from saved data, checked: each filled loop on existing lines, with a colour and its state; the order lists each filled loop once. Whether a loop still closes is checked by settling. */
export function restore(v: unknown, n: net.NetworkState): FillsState {
  const d = net.data, o = d.obj(v, 'fills')
  const loops = d.arr(o.loops, 'fills').map((x, i): FilledLoop => {
    const L = d.obj(x, `fill ${i}`), id = d.str(L.id, `fill ${i} id`)
    const lines = d.arr(L.lines, `fill ${id} lines`).map((l, k) => d.str(l, `fill ${id} line ${k}`))
    if (!lines.length) d.fail(`fill ${id} has no lines`)
    for (const l of lines) if (!net.hasLine(n, l)) d.fail(`fill ${id} uses a missing line ${l}`)
    return { id, lines, color: d.str(L.color, `fill ${id} colour`), visible: d.bool(L.visible, `fill ${id} visible`), locked: d.bool(L.locked, `fill ${id} locked`) }
  })
  d.unique(loops.map(l => l.id), 'fill')
  const order = d.arr(o.order, 'fill order').map((x, i) => d.str(x, `fill order ${i}`))
  d.unique(order, 'fill in the order')
  if (order.length !== loops.length || loops.some(l => !order.includes(l.id))) d.fail('the fill order does not list every fill once')
  return { loops, order } as Store as unknown as FillsState
}
