// groups — identity of continuous curves and their order in each layer.
// Membership is derived from shared points (network.components); this module only
// keeps identity and order stable through topology changes. Line stroke lives on
// each line (bowen 1791434322); a group's width change is a batch done by document.
import * as net from '../network'

type Id = net.Id

export interface Group { id: Id; layer: Id; lines: Id[] }

declare const opaque: unique symbol
/** Opaque handle; read through list / get (copies). */
export type GroupsState = { readonly [opaque]: 'groups' }
interface Store {
  groups: Group[]
  /** Per layer, group ids bottom → top. An array of entries, not an object keyed by
   *  layer id, so any string is a safe id (dot 1791427693: 'constructor'). */
  order: Order
  next: number
}
const S = (g: GroupsState) => g as unknown as Store
type Order = { layer: Id; ids: Id[] }[]
const idsOf = (order: Order, layer: Id): Id[] => order.find(o => o.layer === layer)?.ids ?? []
function ensure(order: Order, layer: Id): Id[] {
  let entry = order.find(o => o.layer === layer)
  if (!entry) { entry = { layer, ids: [] }; order.push(entry) }
  return entry.ids
}

export const create = (): GroupsState => ({ groups: [], order: [], next: 1 }) as Store as unknown as GroupsState

function raw(g: GroupsState, id: Id): Group {
  const group = S(g).groups.find(x => x.id === id)
  if (!group) throw new Error(`No group ${id}`)
  return group
}
const copy = (x: Group): Group => ({ id: x.id, layer: x.layer, lines: [...x.lines] })

export const get = (g: GroupsState, id: Id): Group => copy(raw(g, id))

/** Groups in drawing order: layers in network order, each bottom → top. */
export function list(g: GroupsState, n: net.NetworkState): Group[] {
  return net.layers(n).flatMap(layer => idsOf(S(g).order, layer).map(id => copy(raw(g, id))))
}


export function reorder(g: GroupsState, id: Id, index: number) {
  if (!Number.isInteger(index)) throw new Error('Order index must be an integer')
  const group = raw(g, id), order = ensure(S(g).order, group.layer)
  order.splice(order.indexOf(id), 1)
  order.splice(Math.max(0, Math.min(index, order.length)), 0, id)
}

/**
 * Re-derive membership from the network and keep identities stable:
 * - a component touching no old group is a new group, on top of its layer;
 * - a component joining several old groups keeps the first-clicked side's group
 *   (its id and slot); the others are removed (Q23, Q24 B);
 * - an old group split into several components keeps its id on the component with
 *   its earliest surviving line; the others become new groups right after it (Q24 B);
 * - a group moved to another layer as a whole goes on top of that layer (Q31).
 */
export function reconcile(g: GroupsState, n: net.NetworkState, ch: net.Changes) {
  const st = S(g)
  const owner = previousOwners(g, ch)
  const old = new Map(st.groups.map(x => [x.id, x]))
  const comps = net.components(n)
  const winners = comps.map(comp => winnerOf(g, comp, owner, ch))
  const keeps = keeperComponents(n, comps, winners)

  const groups: Group[] = []
  const order: Order = net.layers(n).map(layer => ({ layer, ids: idsOf(st.order, layer).filter(id => keeps.has(id)) }))
  const splitOffs = new Map<Id, Id[]>() // origin → new ids, inserted right after the origin
  comps.forEach((comp, i) => {
    const w = winners[i]
    if (w && keeps.get(w) === i) {
      const before = old.get(w)!
      if (before.layer !== comp.layer) {
        for (const entry of order) entry.ids = entry.ids.filter(x => x !== w)
        ensure(order, comp.layer).push(w)
      }
      groups.push({ id: w, layer: comp.layer, lines: comp.lines })
      return
    }
    const id = `g${st.next++}`
    groups.push({ id, layer: comp.layer, lines: comp.lines })
    if (w) splitOffs.set(w, [...(splitOffs.get(w) ?? []), id])
    else ensure(order, comp.layer).push(id)
  })
  for (const [origin, ids] of splitOffs) {
    const list = ensure(order, groups.find(x => x.id === origin)!.layer)
    list.splice(list.indexOf(origin) + 1, 0, ...ids)
  }
  st.groups = groups
  st.order = order
}

/** Line → the group it belonged to before this operation (split pieces inherit). */
function previousOwners(g: GroupsState, ch: net.Changes): Map<Id, Id> {
  const owner = new Map<Id, Id>()
  for (const group of S(g).groups) for (const line of group.lines) owner.set(line, group.id)
  for (const r of ch.replaced) {
    const o = owner.get(r.line)
    if (o) for (const piece of r.pieces) if (!owner.has(piece)) owner.set(piece, o)
  }
  return owner
}

/** The old group a component continues: the first-clicked side if it merged several; none if all new. */
function winnerOf(g: GroupsState, comp: { lines: Id[] }, owner: Map<Id, Id>, ch: net.Changes): Id | undefined {
  const candidates = [...new Set(comp.lines.map(l => owner.get(l)).filter((x): x is Id => !!x))]
  if (candidates.length <= 1) return candidates[0]
  for (let k = ch.prefer.length - 1; k >= 0; k--) {
    const hit = ch.prefer[k]!.lines.map(l => owner.get(l)).find(o => o && candidates.includes(o))
    if (hit) return hit
  }
  const slot = (id: Id) => { const x = raw(g, id); return idsOf(S(g).order, x.layer).indexOf(id) }
  return [...candidates].sort((a, b) => slot(a) - slot(b))[0]
}

/** For each surviving old group, the one component that keeps its id: the one with its earliest line. */
function keeperComponents(n: net.NetworkState, comps: { lines: Id[] }[], winners: (Id | undefined)[]): Map<Id, number> {
  const lineIndex = new Map(net.lines(n).map((l, i) => [l.id, i]))
  const first = (i: number) => Math.min(...comps[i]!.lines.map(l => lineIndex.get(l)!))
  const keeps = new Map<Id, number>()
  winners.forEach((w, i) => {
    if (!w) return
    const current = keeps.get(w)
    if (current === undefined || first(i) < first(current)) keeps.set(w, i)
  })
  return keeps
}
