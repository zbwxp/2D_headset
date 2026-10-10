// apply — the third kind of action, beside edit and state change (graph: Editing
// "Apply", Mirror table). Mirror apply writes a reflected source into a different,
// existing target; a mirror link stores the line pairs so later changes happen in
// pairs. This module owns the document's symmetry axis and the mirror-link pairs.
import * as net from '../network'
import * as joins from '../joins'
import * as links from '../links'
import * as fills from '../fills'
import * as groups from '../groups'
import { type Vec, add, sub } from '../geometry'

type Id = net.Id

/** One mirror-linked pair of lines. `reversed`: a of one corresponds to b of the other. Stored with a < b (symmetric relation). */
export interface Pair { a: Id; b: Id; reversed: boolean }

declare const opaque: unique symbol
/** Opaque handle; read through `axis` / `pairs` (copies). */
export type ApplyState = { readonly [opaque]: 'apply' }
interface Store { axis: number; pairs: Pair[] }
const S = (s: ApplyState) => s as unknown as Store

/** The axis is a fixed document setting (graph "Symmetry axis"; dot, review of 070477e). */
export function create(axis = 0): ApplyState {
  if (!Number.isFinite(axis)) throw new Error('The symmetry axis must be a finite number')
  return { axis, pairs: [] } as Store as unknown as ApplyState
}
export const axis = (s: ApplyState): number => S(s).axis
export const pairs = (s: ApplyState): Pair[] => S(s).pairs.map(p => ({ ...p }))

const reflect = (ax: number, p: Vec): Vec => ({ x: 2 * ax - p.x, y: p.y })
const reflectOffset = (v: Vec): Vec => ({ x: -v.x, y: v.y })

// ---- correspondence ------------------------------------------------------

/** Source line → target line and orientation; source point → target point. */
export interface Match { lines: Map<Id, { to: Id; reversed: boolean }>; points: Map<Id, Id> }

/** Search bound: an implementation limit, not a graph rule. */
export const MATCH_STEP_LIMIT = 200000

/**
 * The mirror correspondence (graph "Mirror correspondence"): a bijection between
 * source and target lines, each with an orientation, that keeps which end points
 * are shared and which points are endpoint-linked inside the selection (two separate
 * relations). Among all such bijections, the one whose reflected source controls lie
 * nearest the target controls (least total squared distance) wins; ties keep the
 * first in a stable search order (bowen 1791470303).
 */
export function match(n: net.NetworkState, l: links.LinksState, ax: number, source: readonly Id[], target: readonly Id[]): Match {
  const src = [...new Set(source)].sort(), tgt = [...new Set(target)].sort()
  if (src.some(id => tgt.includes(id))) throw new Error('Mirror apply: source and target must be different lines')
  for (const id of [...src, ...tgt]) net.line(n, id)
  const mismatch = () => new net.Refusal('topology-mismatch', 'topology-mismatch: source and target do not have the same structure', net.lineObjects(tgt))
  if (src.length !== tgt.length || !src.length) throw mismatch()
  const ends = (id: Id) => { const x = net.line(n, id); return [x.a, x.b] as const }
  const pointsOf = (ids: Id[]) => new Set(ids.flatMap(id => ends(id)))
  const srcPoints = pointsOf(src), tgtPoints = pointsOf(tgt)
  if (srcPoints.size !== tgtPoints.size) throw mismatch()
  const linkKey = (a: Id, b: Id) => JSON.stringify(a < b ? [a, b] : [b, a])
  const inSetLinks = (pts: Set<Id>) => new Set(links.pairs(l).filter(p => pts.has(p.a) && pts.has(p.b)).map(p => linkKey(p.a, p.b)))
  const srcLinks = inSetLinks(srcPoints), tgtLinks = inSetLinks(tgtPoints)
  if (srcLinks.size !== tgtLinks.size) throw mismatch()
  const controls = (id: Id) => {
    const x = net.line(n, id), pa = net.point(n, x.a).position, pb = net.point(n, x.b).position
    return [pa, add(pa, x.ha), add(pb, x.hb), pb] as const
  }
  const cost = (s: Id, t: Id, reversed: boolean) => {
    const cs = controls(s).map(p => reflect(ax, p)), ct = controls(t)
    const order = reversed ? [3, 2, 1, 0] : [0, 1, 2, 3]
    return order.reduce((sum, k, i) => { const d = sub(cs[k]!, ct[i]!); return sum + d.x * d.x + d.y * d.y }, 0)
  }
  // Pruning that keeps the exact least-change optimum (dot 1791480800, a 19-line eye):
  // - source lines are visited along shared points, so each next line is mostly fixed by those before it;
  // - a point may only map to one with the same number of selected lines and in-selection links;
  // - a link is checked as soon as both its ends are mapped;
  // - candidates are tried cheapest first, and a branch stops when its cost plus a lower
  //   bound for the lines still open cannot beat the best found.
  const deg = (ids: Id[]) => { const m = new Map<Id, number>(); for (const id of ids) for (const p of ends(id)) m.set(p, (m.get(p) ?? 0) + 1); return m }
  const srcDeg = deg(src), tgtDeg = deg(tgt)
  const partners = (keys: Set<string>) => {
    const m = new Map<Id, Id[]>()
    for (const k of keys) { const [a, b] = JSON.parse(k) as [Id, Id]; m.set(a, [...(m.get(a) ?? []), b]); m.set(b, [...(m.get(b) ?? []), a]) }
    return m
  }
  const srcPartners = partners(srcLinks), tgtPartners = partners(tgtLinks)
  const fits = (p: Id, q: Id) =>
    srcDeg.get(p) === tgtDeg.get(q) && (srcPartners.get(p)?.length ?? 0) === (tgtPartners.get(q)?.length ?? 0) &&
    (srcPartners.get(p) ?? []).every(r => { const mr = pointMap.get(r); return mr === undefined || tgtLinks.has(linkKey(q, mr)) })
  // visiting order: along shared points, components in id order
  const order: Id[] = [], seen = new Set<Id>()
  for (const root of src) {
    if (seen.has(root)) continue
    const queue = [root]; seen.add(root)
    while (queue.length) {
      const id = queue.shift()!; order.push(id)
      const at = new Set(ends(id))
      for (const o of src) if (!seen.has(o) && ends(o).some(p => at.has(p))) { seen.add(o); queue.push(o) }
    }
  }
  const costs = new Map(order.map(sid => [sid, tgt.flatMap(t => [false, true].map(reversed => ({ t, reversed, c: cost(sid, t, reversed) })))
    .sort((x, y) => x.c - y.c || (x.t < y.t ? -1 : x.t > y.t ? 1 : 0) || Number(x.reversed) - Number(y.reversed))]))
  const rest: number[] = new Array(order.length + 1).fill(0)
  for (let i = order.length - 1; i >= 0; i--) rest[i] = rest[i + 1]! + costs.get(order[i]!)![0]!.c
  let best: { cost: number; lines: Map<Id, { to: Id; reversed: boolean }>; points: Map<Id, Id> } | undefined
  const lineMap = new Map<Id, { to: Id; reversed: boolean }>(), pointMap = new Map<Id, Id>(), usedPoints = new Map<Id, Id>(), usedLines = new Set<Id>()
  let steps = 0
  const linksHold = () => [...srcLinks].every(k => { const [a, b] = JSON.parse(k) as [Id, Id]; return tgtLinks.has(linkKey(pointMap.get(a)!, pointMap.get(b)!)) })
  const search = (i: number, sofar: number) => {
    if (++steps > MATCH_STEP_LIMIT) throw new Error('Mirror apply: the correspondence search is too large')
    if (best && sofar + rest[i]! >= best.cost) return // a later tie never replaces the first found
    if (i === order.length) {
      if (!linksHold()) return
      best = { cost: sofar, lines: new Map(lineMap), points: new Map(pointMap) }
      return
    }
    const s = order[i]!, [sa, sb] = ends(s)
    for (const { t, reversed, c } of costs.get(s)!) {
      if (usedLines.has(t)) continue
      const [ta, tb] = ends(t)
      const want: [Id, Id][] = reversed ? [[sa, tb], [sb, ta]] : [[sa, ta], [sb, tb]]
      const added: Id[] = []
      let ok = true
      for (const [p, q] of want) {
        const have = pointMap.get(p)
        if (have !== undefined) { if (have !== q) ok = false; continue }
        if (usedPoints.has(q) || !fits(p, q)) { ok = false; continue }
        pointMap.set(p, q); usedPoints.set(q, p); added.push(p)
      }
      if (ok) {
        lineMap.set(s, { to: t, reversed }); usedLines.add(t)
        search(i + 1, sofar + c)
        lineMap.delete(s); usedLines.delete(t)
      }
      for (const p of added) { usedPoints.delete(pointMap.get(p)!); pointMap.delete(p) }
    }
  }
  search(0, 0)
  if (!best) throw mismatch()
  return { lines: best.lines, points: best.points }
}

// ---- mirror apply --------------------------------------------------------

export interface Doc { network: net.NetworkState; joins: joins.JoinsState; links: links.LinksState; fills: fills.FillsState }

/**
 * Mirror apply (graph "Mirror apply"): the source's geometry reflected across the
 * axis, and its stroke, element state, end strokes, joins, fill colour and fill
 * state, written into the target. The target keeps its ids and layer; its outside
 * links are not copied or rewritten. A point in both sets gets both intents averaged,
 * so a point that corresponds to itself lands on the axis. Show/hide intervals are
 * not covered yet (no data model). Returns the correspondence used.
 */
export function mirrorApply(s: ApplyState, d: Doc, ch: net.Changes, source: readonly Id[], target: readonly Id[], read: Doc = d): Match {
  // geometry is read from `read` (the edit so far as settled, docs/edit-model.md); everything is written into `d`
  const n = d.network, rn = read.network, ax = S(s).axis
  const m = match(rn, read.links, ax, source, target)
  // A locked target refuses an apply (graph "Apply"), checked before anything is
  // written, so copying the source's unlocked state can never open it (dot, review of 070477e).
  const lockedLines = [...m.lines.values()].map(x => x.to).filter(id => net.line(n, id).state.locked)
  if (lockedLines.length) throw new net.Refusal('locked', `Locked target: ${lockedLines.join(', ')} is locked; apply refused`, net.lineObjects(lockedLines))
  const srcLines = [...m.lines.keys()], tgtLines = new Set([...m.lines.values()].map(x => x.to))
  const srcPoints = new Set(m.points.keys())
  // read everything from the source first, then write
  const before = new Map([...m.points.keys(), ...m.points.values()].map(p => [p, net.point(rn, p).position]))
  const moves = [...m.points].map(([sp, tp]) => {
    const r = reflect(ax, before.get(sp)!)
    const target = srcPoints.has(tp) ? { x: (r.x + before.get(tp)!.x) / 2, y: (r.y + before.get(tp)!.y) / 2 } : r
    return { id: tp, target }
  })
  const lineData = srcLines.map(id => ({ id, line: net.line(rn, id), to: m.lines.get(id)! }))
  const endData = [...m.points].map(([sp, tp]) => ({ tp, stroke: joins.endStroke(d.joins, sp) }))
  const joinRows = [...m.points].map(([sp, tp]) => ({
    tp,
    old: joins.rowsAt(d.joins, tp).filter(r => tgtLines.has(r.lines[0]) && tgtLines.has(r.lines[1])),
    add: joins.rowsAt(d.joins, sp).filter(r => m.lines.has(r.lines[0]) && m.lines.has(r.lines[1])),
  }))
  // joins across an endpoint link inside the selection (dot, review of d5e2704)
  const srcPts = new Set(m.points.keys()), tgtPts = new Set(m.points.values())
  const linkJoinsOld = links.joins(d.links).filter(x => tgtPts.has(x.a) && tgtPts.has(x.b) && tgtLines.has(x.lines[0]) && tgtLines.has(x.lines[1]))
  const linkJoinsNew = links.joins(d.links).filter(x => srcPts.has(x.a) && srcPts.has(x.b) && m.lines.has(x.lines[0]) && m.lines.has(x.lines[1]))
  const views = fills.discover(d.fills, n)
  const lineSet = (v: fills.LoopView) => JSON.stringify(v.route.map(u => u.line).sort())
  const byLines = new Map(views.map(v => [lineSet(v), v]))
  const fillData = views.filter(v => v.route.every(u => m.lines.has(u.line))).map(v => ({
    from: v, to: byLines.get(JSON.stringify(v.route.map(u => m.lines.get(u.line)!.to).sort())),
  }))

  net.move(n, ch, moves)
  for (const { line, to } of lineData) {
    const ha = reflectOffset(line.ha), hb = reflectOffset(line.hb)
    net.moveHandle(n, ch, to.to, 'a', to.reversed ? hb : ha)
    net.moveHandle(n, ch, to.to, 'b', to.reversed ? ha : hb)
    net.setLineStroke(n, to.to, line.stroke)
    net.applyLineState(n, ch, to.to, line.state)
  }
  for (const { tp, stroke } of endData) {
    if (stroke) joins.setEndStroke(d.joins, n, tp, stroke)
    else joins.clearEndStroke(d.joins, tp)
  }
  for (const { tp, old, add: rows } of joinRows) {
    for (const r of old) joins.removeJoin(d.joins, tp, r.lines[0], r.lines[1])
    for (const r of rows) {
      joins.setJoin(d.joins, n, tp, m.lines.get(r.lines[0])!.to, m.lines.get(r.lines[1])!.to, { mode: r.mode, ...(r.radius !== undefined ? { radius: r.radius } : {}) })
    }
    net.touch(ch, tp)
  }
  for (const x of linkJoinsOld) links.removeJoin(d.links, x.a, x.b, x.lines[0], x.lines[1])
  for (const x of linkJoinsNew) {
    links.setJoin(d.links, n, m.points.get(x.a)!, m.points.get(x.b)!, m.lines.get(x.lines[0])!.to, m.lines.get(x.lines[1])!.to, { mode: x.mode })
    net.touch(ch, m.points.get(x.a)!); net.touch(ch, m.points.get(x.b)!)
  }
  const lockedFills = fillData.filter(x => x.to?.locked).map(x => x.to!.id)
  if (lockedFills.length) throw new net.Refusal('locked', `Locked target: fill ${lockedFills.join(', ')} is locked; apply refused`, lockedFills.map(id => ({ kind: 'fill' as const, id })))
  for (const { from, to } of fillData) {
    if (!to) continue
    if (from.filled) {
      fills.fill(d.fills, n, to.id, from.color!)
      const id = fills.discover(d.fills, n).find(v => lineSet(v) === lineSet(to))!.id
      fills.setState(d.fills, id, { visible: from.visible, locked: from.locked })
    } else if (to.filled) fills.clearFill(d.fills, to.id)
  }
  return m
}

// ---- mirror links --------------------------------------------------------

/** Every line of the given first-level elements (whole continuous curves). */
export function groupLines(g: groups.GroupsState, ids: readonly Id[]): Id[] {
  return ids.flatMap(id => groups.get(g, id).lines)
}

/**
 * Mirror link (graph "Mirror link"): source and target are each one or more whole
 * first-level elements and share none; a mirror apply, then the pairs are stored.
 * A line already in a mirror link cannot join a second one.
 */
export function mirrorLink(s: ApplyState, d: Doc, g: groups.GroupsState, ch: net.Changes, sourceGroups: readonly Id[], targetGroups: readonly Id[], read: Doc = d) {
  if (sourceGroups.some(id => targetGroups.includes(id))) throw new Error('Mirror link: source and target must be different elements')
  const src = groupLines(g, sourceGroups), tgt = groupLines(g, targetGroups)
  const linked = new Set(S(s).pairs.flatMap(p => [p.a, p.b]))
  const already = [...src, ...tgt].filter(id => linked.has(id))
  if (already.length) throw new Error(`Mirror link: already mirror-linked (${already.join(', ')})`)
  const m = mirrorApply(s, d, ch, src, tgt, read)
  for (const [a, { to, reversed }] of m.lines) S(s).pairs.push(a < to ? { a, b: to, reversed } : { a: to, b: a, reversed })
  sortPairs(s)
}

const sortPairs = (s: ApplyState) => S(s).pairs.sort((x, y) => (x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : 1))

/** Remove the mirror link of these lines; geometry stays (graph "Mirror link can be removed"). */
export function unmirror(s: ApplyState, lines: readonly Id[]) {
  const set = new Set(lines)
  S(s).pairs = S(s).pairs.filter(p => !set.has(p.a) && !set.has(p.b))
}

/** The counterpart of a mirror-linked line. */
export function counterpartLine(s: ApplyState, id: Id): { id: Id; reversed: boolean } | undefined {
  const p = S(s).pairs.find(x => x.a === id || x.b === id)
  return p && { id: p.a === id ? p.b : p.a, reversed: p.reversed }
}
/** The counterpart end of a line end. */
export function counterpartEnd(s: ApplyState, line: Id, end: net.End): { line: Id; end: net.End } | undefined {
  const c = counterpartLine(s, line)
  return c && { line: c.id, end: c.reversed ? (end === 'a' ? 'b' : 'a') : end }
}
/** The counterpart of a point that is an end of a mirror-linked line. */
export function counterpartPoint(s: ApplyState, n: net.NetworkState, point: Id): Id | undefined {
  for (const { line, end } of net.linesAt(n, point)) {
    const c = counterpartEnd(s, line.id, end)
    if (c) { const other = net.line(n, c.line); return c.end === 'a' ? other.a : other.b }
  }
  return undefined
}
/** Mirror-linked point pairs, for solving positions together with endpoint links. */
export function pointPairs(s: ApplyState, n: net.NetworkState): { a: Id; b: Id }[] {
  const seen = new Set<string>(), out: { a: Id; b: Id }[] = []
  for (const p of S(s).pairs) {
    if (!net.hasLine(n, p.a) || !net.hasLine(n, p.b)) continue
    const la = net.line(n, p.a), lb = net.line(n, p.b)
    for (const [x, y] of (p.reversed ? [[la.a, lb.b], [la.b, lb.a]] : [[la.a, lb.a], [la.b, lb.b]]) as [Id, Id][]) {
      const k = JSON.stringify(x < y ? [x, y] : [y, x])
      if (!seen.has(k)) { seen.add(k); out.push(x < y ? { a: x, b: y } : { a: y, b: x }) }
    }
  }
  return out
}

/**
 * Keep pairs valid after one network operation: a deleted or collapsed line ends its
 * pair; when both lines of a pair were split in this operation, the pieces pair up
 * (crossed on a reversed pair); a pair with only one side split ends.
 */
export function update(s: ApplyState, ch: net.Changes) {
  const gone = new Set([...ch.deletedLines, ...ch.collapsedLines])
  const split = new Map(ch.replaced.map(r => [r.line, r.pieces]))
  const next: Pair[] = []
  for (const p of S(s).pairs) {
    if (gone.has(p.a) || gone.has(p.b)) continue
    const pa = split.get(p.a), pb = split.get(p.b)
    if (!pa && !pb) { next.push(p); continue }
    if (!pa || !pb) continue
    const pieces: [Id, Id][] = p.reversed ? [[pa[0], pb[1]], [pa[1], pb[0]]] : [[pa[0], pb[0]], [pa[1], pb[1]]]
    for (const [x, y] of pieces) next.push(x < y ? { a: x, b: y, reversed: p.reversed } : { a: y, b: x, reversed: p.reversed })
  }
  S(s).pairs = next
  sortPairs(s)
}

// ---- paired execution: what each operation acts on (graph "Mirror link") ----------
// Document only runs the operation on every item these plans list; the pairing rules
// live here (dot, review of d5e2704). The counterpart operation is dropped only when it
// is the very same operation (same point and same lines), never just because the
// point is its own counterpart: after two mirrored ends bind on the axis, the point is
// shared but the two lines are still different (dot, review of 1fa7462).
const sameOp = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y)

/** Suffix of the ids a paired operation gives the counterpart's new lines and points. */
export const PRIME = '\u2032'

/** A line and its live counterpart. */
export function pairedLines(s: ApplyState, n: net.NetworkState, line: Id): Id[] {
  const c = counterpartLine(s, line)
  return c && net.hasLine(n, c.id) ? [line, c.id] : [line]
}
/** A point and its counterpart (a point that is its own counterpart, on the axis, once). */
export function pairedPoints(s: ApplyState, n: net.NetworkState, point: Id): Id[] {
  const c = counterpartPoint(s, n, point)
  return c && c !== point ? [point, c] : [point]
}
/** A filled loop and the loop of its counterpart lines, when every boundary line has one. */
export function pairedLoops(s: ApplyState, f: fills.FillsState, n: net.NetworkState, loop: Id): Id[] {
  const views = fills.discover(f, n), v = views.find(x => x.id === loop)
  if (!v) return [loop]
  const mapped = v.route.map(u => counterpartLine(s, u.line)?.id)
  if (mapped.some(x => !x)) return [loop]
  const key = JSON.stringify([...mapped].sort())
  const other = views.find(x => JSON.stringify(x.route.map(u => u.line).sort()) === key)
  return other && other.id !== loop ? [loop, other.id] : [loop]
}
/**
 * A two-point operation (bind, endpoint link) and its mirrored pair. Refused when only
 * one point has a counterpart: what the other side should connect to is not defined
 * (graph "Mirror link protects"). Two points that are each other's counterparts act once.
 */
export function pairedPointPairs(s: ApplyState, n: net.NetworkState, a: Id, b: Id): [Id, Id][] {
  const ca = counterpartPoint(s, n, a), cb = counterpartPoint(s, n, b)
  if (!ca && !cb) return [[a, b]]
  if (!ca || !cb) throw new net.Refusal('mirror-no-counterpart', 'mirror-no-counterpart: one point is mirror-linked and the other has no mirror counterpart', [{ kind: 'point', id: ca ? b : a }])
  const same = (ca === a && cb === b) || (ca === b && cb === a)
  return same ? [[a, b]] : [[a, b], [ca, cb]]
}
/**
 * A bind and its mirrored bind, as point merges. Merges compose whatever their order,
 * so when both binds remove the point the two sides share on the axis (M), the result
 * is one point made of M, K and K′; the user's first-clicked K is kept, the mirrored
 * half then binds K′ into K. That point is its own counterpart, so it is aimed at its
 * current position and the mirror solve puts it on the axis; lines that end up with
 * both ends on it go by the bind rule (bowen 1791474920: derived from the rules).
 */
export function pairedBinds(s: ApplyState, n: net.NetworkState, keep: Id, remove: Id): { binds: [Id, Id][]; settle: Id[] } {
  const ops = pairedPointPairs(s, n, keep, remove)
  if (ops.length === 2 && ops[1]!.includes(remove)) {
    const other = ops[1]![0] === remove ? ops[1]![1] : ops[1]![0]
    return { binds: [[keep, remove], [keep, other]], settle: [keep] }
  }
  return { binds: ops, settle: [] }
}

/** A join at a point and, when every part has a counterpart, its mirrored join. */
export function pairedJoins(s: ApplyState, n: net.NetworkState, point: Id, l1: Id, l2: Id): [Id, Id, Id][] {
  const cp = counterpartPoint(s, n, point), c1 = counterpartLine(s, l1), c2 = counterpartLine(s, l2)
  if (!cp || !c1 || !c2) return [[point, l1, l2]]
  const key = (p: Id, a: Id, b: Id) => [p, ...[a, b].sort()]
  return sameOp(key(point, l1, l2), key(cp, c1.id, c2.id)) ? [[point, l1, l2]] : [[point, l1, l2], [cp, c1.id, c2.id]]
}
/** A join across a link and, when every part has a counterpart, its mirrored one. */
export function pairedLinkJoins(s: ApplyState, n: net.NetworkState, a: Id, b: Id, la: Id, lb: Id): [Id, Id, Id, Id][] {
  const ca = counterpartPoint(s, n, a), cb = counterpartPoint(s, n, b), cla = counterpartLine(s, la), clb = counterpartLine(s, lb)
  if (!ca && !cb) return [[a, b, la, lb]]
  if (!ca || !cb) throw new net.Refusal('mirror-no-counterpart', 'mirror-no-counterpart: one point is mirror-linked and the other has no mirror counterpart', [{ kind: 'point', id: ca ? b : a }])
  if (!cla || !clb) return [[a, b, la, lb]]
  const key = (x: Id, y: Id, lx: Id, ly: Id) => (x < y ? [x, y, lx, ly] : [y, x, ly, lx])
  return sameOp(key(a, b, la, lb), key(ca, cb, cla.id, clb.id)) ? [[a, b, la, lb]] : [[a, b, la, lb], [ca, cb, cla.id, clb.id]]
}
/** A split and the counterpart's: at t, or 1 − t on a reversed pair with the pieces crossed; ids + ′. */
export function pairedSplits(s: ApplyState, line: Id, t: number, mid: Id, first: Id, second: Id) {
  const own = { line, t, mid, first, second }, c = counterpartLine(s, line)
  if (!c) return [own]
  return [own, c.reversed
    ? { line: c.id, t: 1 - t, mid: mid + PRIME, first: second + PRIME, second: first + PRIME }
    : { line: c.id, t, mid: mid + PRIME, first: first + PRIME, second: second + PRIME }]
}
/** An unbind and the counterpart's: the counterpart lines leave the counterpart point, to a point with id + ′. */
export function pairedUnbinds(s: ApplyState, n: net.NetworkState, point: Id, lines: Id[], newPoint: Id) {
  const own = { point, lines, newPoint }
  const cp = counterpartPoint(s, n, point)
  // counterpart lines not already moved by this same unbind (on the axis the point is shared)
  const cl = lines.flatMap(l => { const c = counterpartLine(s, l); return c && !lines.includes(c.id) ? [c.id] : [] })
  return cp && cl.length ? [own, { point: cp, lines: cl, newPoint: newPoint + PRIME }] : [own]
}

/**
 * Handles of mirror-linked lines at commit: a held handle gives its counterpart the
 * reflected offset (held too); if both are held, their reflected values are averaged.
 */
export function mirroredHandles(s: ApplyState, n: net.NetworkState, ch: net.Changes): { line: Id; end: net.End; offset: Vec }[] {
  const heldHere = net.heldIn(ch, n)
  const held = new Set(heldHere.map(h => JSON.stringify([h.line, h.end])))
  const out: { line: Id; end: net.End; offset: Vec }[] = [], done = new Set<string>()
  for (const h of heldHere) {
    if (!net.hasLine(n, h.line)) continue
    const c = counterpartEnd(s, h.line, h.end)
    if (!c || !net.hasLine(n, c.line)) continue
    const k = JSON.stringify([h.line, h.end]), kc = JSON.stringify([c.line, c.end])
    if (done.has(k)) continue
    done.add(k); done.add(kc)
    const mine = net.handle(net.line(n, h.line), h.end)
    if (held.has(kc)) {
      const theirs = reflectOffset(net.handle(net.line(n, c.line), c.end))
      const avg = { x: (mine.x + theirs.x) / 2, y: (mine.y + theirs.y) / 2 }
      out.push({ line: h.line, end: h.end, offset: avg }, { line: c.line, end: c.end, offset: reflectOffset(avg) })
    } else out.push({ line: c.line, end: c.end, offset: reflectOffset(mine) })
  }
  return out
}

/** Mirror state from saved data, checked: a finite axis; pairs of two different existing lines, each line in at most one pair. */
export function restore(v: unknown, n: net.NetworkState): ApplyState {
  const d = net.data, o = d.obj(v, 'mirror')
  const axis = d.num(o.axis, 'mirror axis')
  const pairs = d.arr(o.pairs, 'mirror pairs').map((x, i): Pair => {
    const P = d.obj(x, `mirror pair ${i}`), a = d.str(P.a, `mirror pair ${i} a`), b = d.str(P.b, `mirror pair ${i} b`)
    if (a === b) d.fail(`mirror pair ${i} pairs a line with itself`)
    if (!net.hasLine(n, a) || !net.hasLine(n, b)) d.fail(`mirror pair ${i} uses a missing line`)
    return { a, b, reversed: d.bool(P.reversed, `mirror pair ${i} reversed`) }
  })
  d.unique(pairs.flatMap(p => [p.a, p.b]), 'mirror-paired line')
  // the one stored form the writers keep: the smaller id first, pairs sorted (dot 1791512476)
  const st = { axis, pairs: pairs.map(p => (p.a < p.b ? { ...p } : { a: p.b, b: p.a, reversed: p.reversed })) } as Store as unknown as ApplyState
  sortPairs(st)
  if (JSON.stringify(S(st).pairs) !== JSON.stringify(pairs)) d.fail('mirror pairs are not in their stored form')
  return st
}
