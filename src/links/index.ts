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
/** A join across a link: line `lines[0]` ends at `a`, `lines[1]` ends at `b` (bowen 1791424493: stored with the link). */
export interface LinkJoin { a: Id; b: Id; lines: [Id, Id]; mode: 'smooth' }
interface Store { pairs: { a: Id; b: Id }[]; joins: LinkJoin[] }
const S = (l: LinksState) => l as unknown as Store
export const create = (): LinksState => ({ pairs: [], joins: [] }) as Store as unknown as LinksState
export const pairs = (l: LinksState): { a: Id; b: Id }[] => S(l).pairs.map(p => ({ a: p.a, b: p.b }))

export const joins = (l: LinksState): LinkJoin[] => S(l).joins.map(x => ({ a: x.a, b: x.b, lines: [x.lines[0], x.lines[1]], mode: x.mode }))

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

const samePair = (x: { a: Id; b: Id }, a: Id, b: Id) => (x.a === a && x.b === b) || (x.a === b && x.b === a)
const endAt = (n: net.NetworkState, line: Id, point: Id): net.End | undefined => {
  if (!net.hasLine(n, line)) return undefined
  const l = net.line(n, line)
  return l.a === point ? 'a' : l.b === point ? 'b' : undefined
}

export function unlink(l: LinksState, a: Id, b: Id) {
  S(l).pairs = S(l).pairs.filter(p => !samePair(p, a, b))
  S(l).joins = S(l).joins.filter(x => !samePair(x, a, b))
}

/**
 * Set a join across the link a–b between line la (ending at a, clicked first) and
 * line lb (ending at b). Only smooth for now: how a cusp or arc across layers is
 * drawn is not decided (asked bowen 1791430797).
 */
export function setJoin(l: LinksState, n: net.NetworkState, a: Id, b: Id, la: Id, lb: Id, opts: { mode: 'smooth' }): { line: Id; end: net.End } {
  if (opts.mode !== 'smooth') throw new Error('Only smooth joins across a link for now (cusp / arc across layers not decided)')
  if (!S(l).pairs.some(p => samePair(p, a, b))) throw new Error(`${a} and ${b} are not linked`)
  const ea = endAt(n, la, a), eb = endAt(n, lb, b)
  if (!ea || !eb) throw new Error('Each line must end at its own linked point')
  S(l).joins = S(l).joins.filter(x => !(samePair(x, a, b) && (x.a === a ? x.lines[0] === la && x.lines[1] === lb : x.lines[0] === lb && x.lines[1] === la)))
  S(l).joins.push({ a, b, lines: [la, lb], mode: 'smooth' })
  return { line: la, end: ea }
}

export function removeJoin(l: LinksState, a: Id, b: Id, la: Id, lb: Id) {
  S(l).joins = S(l).joins.filter(x => !(x.a === a && x.b === b && x.lines[0] === la && x.lines[1] === lb) && !(x.a === b && x.b === a && x.lines[0] === lb && x.lines[1] === la))
}

/** The handle pairs the smooth solver should treat as joined. */
export function smoothPairs(l: LinksState, n: net.NetworkState): { a: { line: Id; end: net.End }; b: { line: Id; end: net.End } }[] {
  return S(l).joins.flatMap(x => {
    const ea = endAt(n, x.lines[0], x.a), eb = endAt(n, x.lines[1], x.b)
    return ea && eb ? [{ a: { line: x.lines[0], end: ea }, b: { line: x.lines[1], end: eb } }] : []
  })
}

/**
 * A deleted point ends its links; the partner is never re-linked to another point.
 * Joins across a link follow splits and disappear when a line no longer ends at its point.
 */
export function update(l: LinksState, n: net.NetworkState, ch: net.Changes) {
  const dead = new Set(ch.deletedPoints)
  S(l).pairs = S(l).pairs.filter(p => !dead.has(p.a) && !dead.has(p.b))
  for (const r of ch.replaced) for (const x of S(l).joins) {
    x.lines = x.lines.map((line, i) => {
      if (line !== r.line) return line
      const point = i === 0 ? x.a : x.b
      return point === r.a ? r.pieces[0] : point === r.b ? r.pieces[1] : line
    }) as [Id, Id]
  }
  S(l).joins = S(l).joins.filter(x => S(l).pairs.some(p => samePair(p, x.a, x.b)) && endAt(n, x.lines[0], x.a) && endAt(n, x.lines[1], x.b))
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
