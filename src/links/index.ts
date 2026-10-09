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
/** `read`: where a's position is read from (the edit so far as settled, docs/edit-model.md). */
export function link(l: LinksState, n: net.NetworkState, a: Id, b: Id, read: net.NetworkState = n): { id: Id; target: { x: number; y: number } } {
  const pa = net.point(read, a), pb = net.point(n, b)
  if (a === b) throw new Error('A link needs two points')
  if (pa.layer === pb.layer) throw new Error('Endpoint links are cross-layer only; bind within a layer')
  if (partners(l, a).includes(b)) throw new Error('Already linked')
  // A link is symmetric (bowen 1791461460): only creation has an order (b moves to a);
  // the stored pair has one form, the smaller id first, and the list is sorted.
  S(l).pairs.push(a < b ? { a, b } : { a: b, b: a })
  S(l).pairs.sort((x, y) => (JSON.stringify([x.a, x.b]) < JSON.stringify([y.a, y.b]) ? -1 : 1))
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
 * line lb (ending at b). Only smooth is implemented: cusp and arc across a link
 * are not implemented yet, because how their geometry is shared between the two
 * layers is undecided (asked bowen 1791430797). Not a product prohibition.
 */
export function setJoin(l: LinksState, n: net.NetworkState, a: Id, b: Id, la: Id, lb: Id, opts: { mode: 'smooth' }): { line: Id; end: net.End } {
  if (opts.mode !== 'smooth') throw new Error('Not implemented yet: cusp and arc joins across a link (how they are drawn across layers is undecided)')
  if (!S(l).pairs.some(p => samePair(p, a, b))) throw new Error(`${a} and ${b} are not linked`)
  const ea = endAt(n, la, a), eb = endAt(n, lb, b)
  if (!ea || !eb) throw new Error('Each line must end at its own linked point')
  S(l).joins = S(l).joins.filter(x => !(samePair(x, a, b) && (x.a === a ? x.lines[0] === la && x.lines[1] === lb : x.lines[0] === lb && x.lines[1] === la)))
  // One stored form for one relation (dot 1791461144): the smaller point id first, rows
  // sorted, so setting A–B or B–A gives the same record. Which side was clicked first
  // only decides which handle is held in this edit (returned).
  S(l).joins.push(a < b ? { a, b, lines: [la, lb], mode: 'smooth' } : { a: b, b: a, lines: [lb, la], mode: 'smooth' })
  S(l).joins.sort((x, y) => (JSON.stringify([x.a, x.b, x.lines]) < JSON.stringify([y.a, y.b, y.lines]) ? -1 : 1))
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
  // a link that ends is a constraint change at the surviving partner (dot 1791431139)
  for (const p of S(l).pairs) if (dead.has(p.a) || dead.has(p.b)) for (const x of [p.a, p.b]) if (!dead.has(x)) net.touch(ch, x)
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

/**
 * Positions after link alignment. Endpoint links keep points coincident; mirror
 * point pairs (from the apply module, optional) keep points reflected across the
 * vertical axis x = `mirror.axis`. Both are solved in one step (dot 1791470434, the
 * position part only): a group joins points through links (same frame) and mirror
 * pairs (reflected frame); the targets of the points this edit acted on are taken
 * into the group's frame and averaged, and every member gets the result in its own
 * frame. A group that needs a point to equal its own reflection is placed on the
 * axis. Groups with no acted-on member are left as they are.
 */
export function align(
  l: LinksState, n: net.NetworkState, ch: net.Changes,
  mirror?: { axis: number; pairs: { a: Id; b: Id }[] },
): { id: Id; position: { x: number; y: number } }[] {
  type Edge = { a: Id; b: Id; flip: boolean }
  const edges: Edge[] = [...S(l).pairs.map(p => ({ a: p.a, b: p.b, flip: false })), ...(mirror?.pairs ?? []).map(p => ({ a: p.a, b: p.b, flip: true }))]
  const next = new Map<Id, { to: Id; flip: boolean }[]>()
  for (const e of edges) for (const [x, y] of [[e.a, e.b], [e.b, e.a]] as const) next.set(x, [...(next.get(x) ?? []), { to: y, flip: e.flip }])
  const reflect = (p: { x: number; y: number }) => (mirror ? { x: 2 * mirror.axis - p.x, y: p.y } : p)
  const parity = new Map<Id, boolean>()
  const out: { id: Id; position: { x: number; y: number } }[] = []
  for (const start of [...next.keys()].sort()) {
    if (parity.has(start)) continue
    // walk the group; parity = whether a member is in the reflected frame of `start`
    const members: Id[] = [], stack = [start]
    let onAxis = false
    parity.set(start, false)
    while (stack.length) {
      const x = stack.pop()!
      members.push(x)
      for (const { to, flip } of next.get(x)!) {
        const want = parity.get(x)! !== flip
        if (!parity.has(to)) { parity.set(to, want); stack.push(to) } else if (parity.get(to) !== want) onAxis = true
      }
    }
    const acted = ch.targets.filter(t => parity.has(t.point) && members.includes(t.point))
    if (!acted.length) continue
    const inFrame = acted.map(t => (parity.get(t.point) ? reflect(t.target) : t.target))
    const avg = { x: inFrame.reduce((s, p) => s + p.x, 0) / inFrame.length, y: inFrame.reduce((s, p) => s + p.y, 0) / inFrame.length }
    const position = onAxis && mirror ? { x: mirror.axis, y: avg.y } : avg
    for (const id of members) out.push({ id, position: parity.get(id) ? reflect(position) : position })
  }
  return out
}

/** Links from saved data, checked: pairs of existing points in different layers, each pair once; link joins on an existing pair, each line ending at its point. */
export function restore(v: unknown, n: net.NetworkState): LinksState {
  const d = net.data, o = d.obj(v, 'links')
  const pairs = d.arr(o.pairs, 'link pairs').map((x, i) => {
    const P = d.obj(x, `link ${i}`), a = d.str(P.a, `link ${i} a`), b = d.str(P.b, `link ${i} b`)
    if (!net.hasPoint(n, a) || !net.hasPoint(n, b)) d.fail(`link ${i} uses a missing point`)
    if (net.point(n, a).layer === net.point(n, b).layer) d.fail(`link ${a}-${b} is inside one layer`)
    return { a, b }
  })
  const pk = (a: Id, b: Id) => JSON.stringify(a < b ? [a, b] : [b, a])
  d.unique(pairs.map(p => pk(p.a, p.b)), 'link')
  const joins = d.arr(o.joins, 'link joins').map((x, i): LinkJoin => {
    const J = d.obj(x, `link join ${i}`), a = d.str(J.a, `link join ${i} a`), b = d.str(J.b, `link join ${i} b`)
    const ls = d.arr(J.lines, `link join ${i} lines`)
    if (ls.length !== 2) d.fail(`link join ${i} does not have two lines`)
    const la = d.str(ls[0], `link join ${i} line`), lb = d.str(ls[1], `link join ${i} line`)
    if (!pairs.some(p => pk(p.a, p.b) === pk(a, b))) d.fail(`link join ${i} has no link ${a}-${b}`)
    if (!endAt(n, la, a) || !endAt(n, lb, b)) d.fail(`link join ${i}: a line does not end at its point`)
    if (J.mode !== 'smooth') d.fail(`link join ${i} has an unknown mode`)
    return { a, b, lines: [la, lb], mode: 'smooth' }
  })
  d.unique(joins.map(j => JSON.stringify([j.a, j.b, j.lines])), 'link join')
  return { pairs, joins } as Store as unknown as LinksState
}
