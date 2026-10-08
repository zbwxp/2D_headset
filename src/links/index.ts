// links — cross-layer endpoint links (Q25). Both points stay; after every edit the
// points of one link group coincide. The group goes to the average of the raw
// targets of the points this edit directly acted on; the others follow
// (bowen 1791424124, 1791424255, 1791424388; dot 1791424385). Each pair is
// stored once: the two points' copies describe one relation, never two springs.
import * as net from '../network'

type Id = net.Id

declare const opaque: unique symbol
/** Opaque handle; read through pairs / partners (copies). */
export type LinksState = { readonly [opaque]: 'links' }
interface Store { pairs: { a: Id; b: Id }[] }
const S = (l: LinksState) => l as unknown as Store
export const create = (): LinksState => ({ pairs: [] }) as Store as unknown as LinksState
export const pairs = (l: LinksState): { a: Id; b: Id }[] => S(l).pairs.map(p => ({ a: p.a, b: p.b }))

export const partners = (l: LinksState, point: Id): Id[] =>
  S(l).pairs.flatMap(p => (p.a === point ? [p.b] : p.b === point ? [p.a] : []))

/** Create a link (a clicked first). Returns the move that puts b on a. */
export function link(l: LinksState, n: net.NetworkState, a: Id, b: Id): { id: Id; target: { x: number; y: number } } {
  const pa = net.point(n, a), pb = net.point(n, b)
  if (a === b) throw new Error('A link needs two points')
  if (pa.layer === pb.layer) throw new Error('Endpoint links are cross-layer only; bind within a layer')
  if (partners(l, a).includes(b)) throw new Error('Already linked')
  S(l).pairs.push({ a, b })
  return { id: b, target: pa.position }
}

export function unlink(l: LinksState, a: Id, b: Id) {
  S(l).pairs = S(l).pairs.filter(p => !((p.a === a && p.b === b) || (p.a === b && p.b === a)))
}

/** A deleted point ends its links; the partner is never re-linked to another point. */
export function update(l: LinksState, ch: net.Changes) {
  const dead = new Set(ch.deletedPoints)
  S(l).pairs = S(l).pairs.filter(p => !dead.has(p.a) && !dead.has(p.b))
}

/** Positions that make every link group coincide. */
export function align(l: LinksState, n: net.NetworkState, ch: net.Changes): { id: Id; position: { x: number; y: number } }[] {
  const parent = new Map<Id, Id>()
  const find = (x: Id): Id => { while (parent.get(x)! !== x) x = parent.get(x)!; return x }
  for (const p of S(l).pairs) for (const x of [p.a, p.b]) if (!parent.has(x)) parent.set(x, x)
  for (const p of S(l).pairs) { const ra = find(p.a), rb = find(p.b); if (ra !== rb) parent.set(rb, ra) }
  const groups = new Map<Id, Id[]>()
  for (const x of parent.keys()) { const r = find(x); groups.set(r, [...(groups.get(r) ?? []), x]) }
  const out: { id: Id; position: { x: number; y: number } }[] = []
  for (const members of groups.values()) {
    const acted = ch.targets.filter(t => members.includes(t.point))
    if (!acted.length) continue
    const position = {
      x: acted.reduce((s, t) => s + t.target.x, 0) / acted.length,
      y: acted.reduce((s, t) => s + t.target.y, 0) / acted.length,
    }
    for (const id of members) out.push({ id, position })
  }
  return out
}
