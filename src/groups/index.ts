// groups — identity of continuous curves, their order in each layer, and the
// line stroke that belongs to the whole group (Q24 C). Membership itself is
// derived from shared points (network.components); this module only keeps
// identity, order and stroke stable through topology changes.
import * as net from '../network'

type Id = net.Id

export interface Stroke { width: number; profile: string }
export interface Group { id: Id; layer: Id; lines: Id[]; stroke: Stroke }
export interface GroupsState {
  groups: Group[]
  /** Per layer, group ids bottom → top. */
  order: Record<Id, Id[]>
  next: number
}

export const DEFAULT_STROKE: Stroke = { width: 1, profile: 'uniform' }
export const create = (): GroupsState => ({ groups: [], order: {}, next: 1 })

export function get(g: GroupsState, id: Id): Group {
  const group = g.groups.find(x => x.id === id)
  if (!group) throw new Error(`No group ${id}`)
  return group
}

/** Groups in drawing order: layers in network order, each bottom → top. */
export function list(g: GroupsState, n: net.NetworkState): Group[] {
  return n.layers.flatMap(layer => (g.order[layer] ?? []).map(id => get(g, id)))
}

export function setStroke(g: GroupsState, id: Id, stroke: Stroke) {
  get(g, id).stroke = { ...stroke }
}

export function reorder(g: GroupsState, id: Id, index: number) {
  const group = get(g, id), order = g.order[group.layer]!
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
  const owner = new Map<Id, Id>()
  for (const group of g.groups) for (const line of group.lines) owner.set(line, group.id)
  for (const r of ch.replaced) {
    const o = owner.get(r.line)
    if (o) for (const piece of r.pieces) if (!owner.has(piece)) owner.set(piece, o)
  }
  const old = new Map(g.groups.map(x => [x.id, x]))
  const slot = (id: Id) => { const x = old.get(id)!; return (g.order[x.layer] ?? []).indexOf(id) }

  const comps = net.components(n)
  const claims = new Map<Id, number[]>() // old group → component indexes
  const winners: (Id | undefined)[] = comps.map((comp, i) => {
    const candidates = [...new Set(comp.lines.map(l => owner.get(l)).filter((x): x is Id => !!x))]
    if (!candidates.length) return undefined
    let winner: Id | undefined
    for (let k = ch.prefer.length - 1; k >= 0 && !winner; k--) {
      const hit = ch.prefer[k]!.lines.map(l => owner.get(l)).find(o => o && candidates.includes(o))
      if (hit) winner = hit
    }
    winner ??= [...candidates].sort((a, b) => slot(a) - slot(b))[0]!
    for (const c of candidates) if (c === winner) claims.set(c, [...(claims.get(c) ?? []), i])
    return winner
  })

  // An old group claimed by several components (a split): earliest surviving line keeps the id.
  const lineIndex = new Map(n.lines.map((l, i) => [l.id, i]))
  const keeps = new Map<Id, number>()
  for (const [id, idxs] of claims) {
    const best = [...idxs].sort((a, b) => Math.min(...comps[a]!.lines.map(l => lineIndex.get(l)!)) - Math.min(...comps[b]!.lines.map(l => lineIndex.get(l)!)))[0]!
    keeps.set(id, best)
  }

  const groups: Group[] = []
  const order: Record<Id, Id[]> = {}
  for (const layer of n.layers) order[layer] = [...(g.order[layer] ?? [])].filter(id => keeps.has(id))
  const after = new Map<Id, Id[]>() // split-offs to insert right after their origin
  comps.forEach((comp, i) => {
    const w = winners[i]
    if (w && keeps.get(w) === i) {
      groups.push({ ...old.get(w)!, layer: comp.layer, lines: comp.lines })
    } else {
      const id = `g${g.next++}`
      const stroke = w ? { ...old.get(w)!.stroke } : { ...DEFAULT_STROKE }
      groups.push({ id, layer: comp.layer, lines: comp.lines, stroke })
      if (w) after.set(w, [...(after.get(w) ?? []), id])
      else (order[comp.layer] ??= []).push(id)
    }
  })
  for (const [origin, ids] of after) {
    const layer = old.get(origin)!.layer, list = order[layer]!
    list.splice(list.indexOf(origin) + 1, 0, ...ids)
  }
  g.groups = groups
  g.order = order
}
