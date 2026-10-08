// groups — identity of continuous curves, their order in each layer, and the
// line stroke that belongs to the whole group (Q24 C). Membership itself is
// derived from shared points (network.components); this module only keeps
// identity, order and stroke stable through topology changes.
import * as net from '../network'

type Id = net.Id

export interface Stroke { width: number; profile: string }
export interface Group { id: Id; layer: Id; lines: Id[]; stroke: Stroke }

declare const opaque: unique symbol
/** Opaque handle; read through list / get (copies). */
export type GroupsState = { readonly [opaque]: 'groups' }
interface Store {
  groups: Group[]
  /** Per layer, group ids bottom → top. */
  order: Record<Id, Id[]>
  next: number
}
const S = (g: GroupsState) => g as unknown as Store

export const DEFAULT_STROKE: Readonly<Stroke> = Object.freeze({ width: 1, profile: 'uniform' })
export const create = (): GroupsState => ({ groups: [], order: {}, next: 1 }) as Store as unknown as GroupsState

function raw(g: GroupsState, id: Id): Group {
  const group = S(g).groups.find(x => x.id === id)
  if (!group) throw new Error(`No group ${id}`)
  return group
}
const copy = (x: Group): Group => ({ id: x.id, layer: x.layer, lines: [...x.lines], stroke: { ...x.stroke } })

export const get = (g: GroupsState, id: Id): Group => copy(raw(g, id))

/** Groups in drawing order: layers in network order, each bottom → top. */
export function list(g: GroupsState, n: net.NetworkState): Group[] {
  return net.layers(n).flatMap(layer => (S(g).order[layer] ?? []).map(id => copy(raw(g, id))))
}

export function setStroke(g: GroupsState, id: Id, stroke: Stroke) {
  if (!(stroke.width > 0)) throw new Error('Stroke width must be positive')
  raw(g, id).stroke = { width: stroke.width, profile: stroke.profile }
}

export function reorder(g: GroupsState, id: Id, index: number) {
  const group = raw(g, id), order = S(g).order[group.layer]!
  order.splice(order.indexOf(id), 1)
  order.splice(Math.max(0, Math.min(index, order.length)), 0, id)
}

/**
 * Re-derive membership from the network and keep identities stable:
 * - a component touching no old group is a new group, on top of its layer;
 * - a component joining several old groups keeps the first-clicked side's group
 *   (its id, slot and stroke); the others are removed (Q23, Q24 B);
 * - an old group split into several components keeps its id on the component with
 *   its earliest surviving line; the others become new groups right after it,
 *   with the same stroke (Q24 B).
 */
export function reconcile(g: GroupsState, n: net.NetworkState, ch: net.Changes) {
  const st = S(g)
  const owner = previousOwners(g, ch)
  const old = new Map(st.groups.map(x => [x.id, x]))
  const comps = net.components(n)
  const winners = comps.map(comp => winnerOf(g, comp, owner, ch))
  const keeps = keeperComponents(n, comps, winners)

  const groups: Group[] = []
  const order: Record<Id, Id[]> = {}
  for (const layer of net.layers(n)) order[layer] = (st.order[layer] ?? []).filter(id => keeps.has(id))
  const splitOffs = new Map<Id, Id[]>() // origin → new ids, inserted right after the origin
  comps.forEach((comp, i) => {
    const w = winners[i]
    if (w && keeps.get(w) === i) {
      groups.push({ ...old.get(w)!, layer: comp.layer, lines: comp.lines })
      return
    }
    const id = `g${st.next++}`
    groups.push({ id, layer: comp.layer, lines: comp.lines, stroke: { ...(w ? old.get(w)!.stroke : DEFAULT_STROKE) } })
    if (w) splitOffs.set(w, [...(splitOffs.get(w) ?? []), id])
    else (order[comp.layer] ??= []).push(id)
  })
  for (const [origin, ids] of splitOffs) {
    const list = order[old.get(origin)!.layer]!
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
  const slot = (id: Id) => { const x = raw(g, id); return (S(g).order[x.layer] ?? []).indexOf(id) }
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
