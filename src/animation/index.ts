// animation — angle and expression making (docs/architecture-multiview.md package 4;
// docs/stage2-plan.md). Stage 2, package 1: the angle baseline record layer. It owns the
// meaning of `base:angle` and the role rules that differ from views: a new line's new
// points and handles, a new arc's radius and a paste take the drawn (front) values there
// (declared as copyNew on the layer); split, delete, bind and unbind follow the
// kind-independent rules (step 2). Package 2: broadcast, fit and the pending mark.
import * as net from '../network'
import * as views from '../views'
import * as links from '../links'
import { add, sub, type Vec } from '../geometry'
import { respond } from '../evaluate'

type Id = net.Id

/** The hidden front baseline for angle broadcast (graph "Hidden baseline"; bowen 1791647843). */
export const ANGLE = 'base:angle'
/** The record layers this module owns. */
export const RECORDS: readonly string[] = Object.freeze([ANGLE])

/** Give a drawing its angle baseline: a record layer equal to the front (nothing pending). */
export function addRecords(n: net.NetworkState) { net.addShapeLayer(n, ANGLE, 'record', views.FRONT, true) }

/**
 * At open: the drawing has this module's record layers, of kind record and owned (copyNew);
 * and no other layer claims copyNew. The flag is saved, but only an owner may grant it, so a
 * file cannot mark an unknown layer copyNew and bypass "no owner rule yet: refused" (dot 1791680650).
 */
export function checkRecords(n: net.NetworkState) {
  const layers = net.shapeLayers(n)
  for (const l of layers) if (l.copyNew && !RECORDS.includes(l.key)) throw new Error(`open-failed: shape layer ${l.key} claims copyNew but has no owner that grants it`)
  for (const key of RECORDS) {
    const l = layers.find(x => x.key === key)
    if (!l) throw new Error(`open-failed: there is no record layer ${key} (a file from before stage 2)`)
    if (l.kind !== 'record' || !l.copyNew) throw new Error(`open-failed: ${key} is not an owned record layer`)
  }
}

// ---- broadcast, fit, the pending mark (stage 2 package 2; docs/stage2-plan.md rules 3–5) ----

const same = (a: Vec, b: Vec) => a.x === b.x && a.y === b.y
const zero = (v: Vec) => v.x === 0 && v.y === 0

/**
 * The points and line ends of the chosen lines, read from the draft (front and baseline),
 * with linked end points checked: a chosen point's link partner must be an end of a chosen
 * line (`<what>-link-incomplete`), so a link never pulls an unbroadcast side along and a
 * later broadcast never pushes it twice (dot 1791680195, 1791680315).
 */
function scope(n: net.NetworkState, l: links.LinksState, lines: readonly Id[], what: 'broadcast' | 'fit') {
  const front = net.of(n, views.FRONT), base = net.of(n, ANGLE)
  const ids = [...new Set(lines)]
  const points = [...new Set(ids.flatMap(id => { const x = net.line(front, id); return [x.a, x.b] }))]
  const pointSet = new Set(points)
  for (const p of points) for (const q of links.partners(l, p)) {
    if (!pointSet.has(q)) throw new net.Refusal(`${what}-link-incomplete`, `${what}-link-incomplete: point ${p} is linked to ${q}, whose line is not chosen; choose both linked lines`, [{ kind: 'point', id: p }, { kind: 'point', id: q }])
  }
  const d = new Map(points.map(p => [p, sub(net.point(front, p).position, net.point(base, p).position)] as const))
  const handles = ids.flatMap(id => (['a', 'b'] as const).map(end => {
    const f = net.handle(net.line(front, id), end), b = net.handle(net.line(base, id), end)
    return { line: id, end, d: sub(f, b) }
  }))
  return { front, base, ids, points, d, handles }
}

/**
 * Broadcast (rule 3): for the chosen lines, each point once and each handle vector, the
 * difference "front − baseline" read from the draft is added in every other view through
 * that view's own move / moveHandle (so links and springs there see it), then the baseline
 * takes the front. Linked points must be chosen together and have the same difference
 * (`broadcast-link-mismatch`). Zero differences write nothing, so an all-zero broadcast
 * changes nothing (dot 1791680326); a zero item may still follow a link or a spring moved
 * by another item of the same broadcast.
 */
export function broadcast(n: net.NetworkState, l: links.LinksState, ch: net.Changes, lines: readonly Id[]) {
  const { front, base, points, d, handles } = scope(n, l, lines, 'broadcast')
  for (const p of points) for (const q of links.partners(l, p)) {
    const dp = d.get(p)!, dq = d.get(q)!
    if (Math.abs(dp.x - dq.x) > 1e-9 || Math.abs(dp.y - dq.y) > 1e-9) throw new net.Refusal('broadcast-link-mismatch', `broadcast-link-mismatch: linked points ${p} and ${q} have different pending changes; fit them first`, [{ kind: 'point', id: p }, { kind: 'point', id: q }])
  }
  const moving = points.filter(p => !zero(d.get(p)!)), turning = handles.filter(h => !zero(h.d))
  if (!moving.length && !turning.length) return
  for (const { key, kind } of net.shapeLayers(n)) {
    if (kind !== 'view' || key === views.FRONT) continue
    const h = net.of(n, key)
    if (moving.length) net.move(h, ch, moving.map(p => ({ id: p, target: add(net.point(h, p).position, d.get(p)!) })))
    for (const t of turning) net.moveHandle(h, ch, t.line, t.end, add(net.handle(net.line(h, t.line), t.end), t.d))
  }
  // the baseline takes the front for exactly these points and handles (records are never settled)
  net.setPositions(base, moving.map(p => ({ id: p, position: net.point(front, p).position })))
  net.setHandles(base, turning.map(t => ({ line: t.line, end: t.end, offset: net.handle(net.line(front, t.line), t.end) })))
}

/** Fit (rule 4): the baseline takes the front for the chosen lines' points and handles; no view changes. */
export function fit(n: net.NetworkState, l: links.LinksState, lines: readonly Id[]) {
  const { front, base, points, handles } = scope(n, l, lines, 'fit')
  net.setPositions(base, points.map(p => ({ id: p, position: net.point(front, p).position })))
  net.setHandles(base, handles.map(t => ({ line: t.line, end: t.end, offset: net.handle(net.line(front, t.line), t.end) })))
}

/** The pending mark (rule 5): lines whose points or handles differ between the front and the baseline. */
export function pending(n: net.NetworkState): Id[] {
  const front = net.of(n, views.FRONT), base = net.of(n, ANGLE)
  return net.lines(front).filter(x => {
    const b = net.line(base, x.id)
    return !same(net.point(front, x.a).position, net.point(base, x.a).position) || !same(net.point(front, x.b).position, net.point(base, x.b).position)
      || !same(x.ha, b.ha) || !same(x.hb, b.hb)
  }).map(x => x.id)
}

// ---- responses (stage 3b package 2; docs/stage3b-pkg2-responses.md) ----
// Per control (a point's position, or one end's handle vector), per edge between neighbouring
// views, per axis: a piecewise-linear response through (0,0), its knots, (1,1). Each knot is a
// correction the user made at that angle: a protected target, kept even when it is linear.
// Ids are ordinary keys: own-property records, read with hasOwn, written with defineProperty,
// so `constructor` or `__proto__` work as any id (as in shapes).

export type Knot = readonly [number, number]
export type Axes = { readonly x?: readonly Knot[]; readonly y?: readonly Knot[] }
/** Edge key → axes. */
export type ControlResponses = Readonly<Record<string, Axes>>
/** The responses as plain data (model, clip, file). */
export interface ResponsesData {
  readonly points: Readonly<Record<Id, ControlResponses>>
  readonly handles: Readonly<Record<Id, { readonly a?: ControlResponses; readonly b?: ControlResponses }>>
}
declare const opaqueResponses: unique symbol
export type ResponsesState = { readonly [opaqueResponses]: 'responses' }
type Rec<T> = Record<string, T>
interface RStore { points: Rec<Rec<{ x?: Knot[]; y?: Knot[] }>>; handles: Rec<{ a?: Rec<{ x?: Knot[]; y?: Knot[] }>; b?: Rec<{ x?: Knot[]; y?: Knot[] }> }> }
const R = (a: ResponsesState) => a as unknown as RStore
const own = <T>(rec: Readonly<Rec<T>>, k: string): T | undefined => (Object.hasOwn(rec, k) ? rec[k] : undefined)
const put = <T>(rec: Rec<T>, k: string, v: T) => { Object.defineProperty(rec, k, { value: v, enumerable: true, writable: true, configurable: true }) }
const AXES = ['x', 'y'] as const
export const MAX_KNOTS = 256

export const createResponses = (): ResponsesState => ({ points: {}, handles: {} }) as RStore as unknown as ResponsesState

/** A copy as plain data. */
export const responsesData = (a: ResponsesState): ResponsesData => structuredClone(R(a))

/** Check one control's responses as plain data (`what` names it); a copy in normal form, or undefined when empty. */
function checkControl(v: unknown, what: string): Rec<{ x?: Knot[]; y?: Knot[] }> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${what}: responses must be an object`)
  const out: Rec<{ x?: Knot[]; y?: Knot[] }> = {}
  for (const edge of Object.keys(v)) {
    if (!views.isEdge(edge)) throw new Error(`${what}: ${JSON.stringify(edge)} is not an edge between neighbouring views`)
    const ax = (v as Rec<unknown>)[edge]
    if (!ax || typeof ax !== 'object' || Array.isArray(ax)) throw new Error(`${what} on ${edge}: axes must be an object`)
    const axes: { x?: Knot[]; y?: Knot[] } = {}
    for (const k of Object.keys(ax)) {
      if (k !== 'x' && k !== 'y') throw new Error(`${what} on ${edge}: unknown axis ${JSON.stringify(k)}`)
      const list = (ax as Rec<unknown>)[k]
      if (!Array.isArray(list)) throw new Error(`${what} on ${edge} ${k}: knots must be a list`)
      if (list.length > MAX_KNOTS) throw new Error(`${what} on ${edge} ${k}: more than ${MAX_KNOTS} knots`)
      let last = 0
      const knots = list.map((kn, i) => {
        if (!Array.isArray(kn) || kn.length !== 2 || typeof kn[0] !== 'number' || typeof kn[1] !== 'number' || !Number.isFinite(kn[0]) || !Number.isFinite(kn[1])) throw new Error(`${what} on ${edge} ${k}: knot ${i} must be two finite numbers`)
        if (!(kn[0] > last && kn[0] < 1)) throw new Error(`${what} on ${edge} ${k}: knot progress must increase strictly inside (0, 1)`)
        last = kn[0]
        return [kn[0], kn[1]] as Knot
      })
      if (knots.length) axes[k] = knots
    }
    if (axes.x || axes.y) put(out, edge, axes)
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * Check responses as plain data against the ids that may carry them (own properties only;
 * any legal id, `constructor` included, is an ordinary key). A copy in normal form: empty
 * parts dropped, every knot kept. Used for a clip and for a file.
 */
export function checkResponses(v: unknown, points: ReadonlySet<Id>, lines: ReadonlySet<Id>, what: string): ResponsesData {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${what}: responses must be an object`)
  const o = v as Rec<unknown>
  const out: RStore = { points: {}, handles: {} }
  const ps = own(o, 'points'), hs = own(o, 'handles')
  if (!ps || typeof ps !== 'object' || !hs || typeof hs !== 'object') throw new Error(`${what}: points and handles are required`)
  for (const id of Object.keys(ps)) {
    if (!points.has(id)) throw new Error(`${what}: no point ${JSON.stringify(id)}`)
    const c = checkControl((ps as Rec<unknown>)[id], `${what} of point ${id}`)
    if (c) put(out.points, id, c)
  }
  for (const id of Object.keys(hs)) {
    if (!lines.has(id)) throw new Error(`${what}: no line ${JSON.stringify(id)}`)
    const ends = (hs as Rec<unknown>)[id]
    if (!ends || typeof ends !== 'object' || Array.isArray(ends)) throw new Error(`${what} of line ${id}: ends must be an object`)
    const e: { a?: Rec<{ x?: Knot[]; y?: Knot[] }>; b?: Rec<{ x?: Knot[]; y?: Knot[] }> } = {}
    for (const end of Object.keys(ends)) {
      if (end !== 'a' && end !== 'b') throw new Error(`${what} of line ${id}: unknown end ${JSON.stringify(end)}`)
      const c = checkControl((ends as Rec<unknown>)[end], `${what} of line ${id} end ${end}`)
      if (c) e[end] = c
    }
    if (e.a || e.b) put(out.handles, id, e)
  }
  return out
}

/** The entries of exactly these points and lines, as plain data (a clip's part). */
export function extract(a: ResponsesState, points: Iterable<Id>, lines: Iterable<Id>): ResponsesData {
  const s = R(a), out: RStore = { points: {}, handles: {} }
  for (const p of points) { const c = own(s.points, p); if (c) put(out.points, p, structuredClone(c)) }
  for (const l of lines) { const c = own(s.handles, l); if (c) put(out.handles, l, structuredClone(c)) }
  return out
}

/** A clip's (checked) part, written to the new ids through the actual copy map. */
export function insert(a: ResponsesState, data: ResponsesData, map: net.CopyMap) {
  const s = R(a)
  for (const [from, to] of map.points) { const c = own(data.points, from); if (c) put(s.points, to, structuredClone(c) as Rec<{ x?: Knot[]; y?: Knot[] }>) }
  for (const [from, to] of map.lines) { const c = own(data.handles, from); if (c) put(s.handles, to, structuredClone(c) as RStore['handles'][string]) }
}

/**
 * Follow one structural record (docs/stage3b-pkg2-responses.md §3): deletions first, then
 * unbind copies. Added points and lines write nothing (no entry is no response), so nothing
 * clears what another rule wrote.
 */
export function follow(a: ResponsesState, ch: net.Changes) {
  const s = R(a)
  for (const p of ch.deletedPoints) delete s.points[p]
  for (const l of [...ch.deletedLines, ...ch.collapsedLines]) delete s.handles[l]
  for (const u of ch.unbound) { const c = own(s.points, u.point); if (c) put(s.points, u.newPoint, structuredClone(c)) }
}

/** Whether a split of this line is refused: its end points or its handles have responses. */
export function splitBlocked(a: ResponsesState, n: net.NetworkState, line: Id): boolean {
  const s = R(a), l = net.line(n, line)
  return own(s.points, l.a) !== undefined || own(s.points, l.b) !== undefined || own(s.handles, line) !== undefined
}

/** The link component of a point (itself and every point reachable through links). */
function component(l: links.LinksState, p: Id): Id[] {
  const seen = new Set([p]), todo = [p]
  while (todo.length) for (const q of links.partners(l, todo.pop()!)) if (!seen.has(q)) { seen.add(q); todo.push(q) }
  return [...seen]
}

/**
 * A new link between a and b merges the two components' response sets (§1, dot 1791689586):
 * for every edge and axis, both are evaluated at the union of their knot progresses and must
 * be exactly equal (a missing response is the identity), else `link-responses-differ`; the
 * merged response keeps the union of knots (each a protected target), more than 256 refuses
 * (`link-responses-too-many`); the merged set is written to every member of both components.
 * Call before the link is made (the components are still separate).
 */
export function mergeForLink(a: ResponsesState, l: links.LinksState, p: Id, q: Id) {
  const s = R(a), left = component(l, p), right = component(l, q)
  const A = own(s.points, p) ?? {}, B = own(s.points, q) ?? {}
  const merged: Rec<{ x?: Knot[]; y?: Knot[] }> = {}
  for (const edge of [...new Set([...Object.keys(A), ...Object.keys(B)])]) {
    const axes: { x?: Knot[]; y?: Knot[] } = {}
    for (const ax of AXES) {
      const ka = own(A, edge)?.[ax], kb = own(B, edge)?.[ax]
      if (!ka?.length && !kb?.length) continue
      const at = [...new Set([...(ka ?? []), ...(kb ?? [])].map(k => k[0]))].sort((x, y) => x - y)
      const knots = at.map(t => [t, respond(ka, t), respond(kb, t)] as const)
      const bad = knots.find(k => k[1] !== k[2])
      if (bad) throw new net.Refusal('link-responses-differ', `link-responses-differ: points ${p} and ${q} respond differently on ${edge}, axis ${ax}, at progress ${bad[0]} (${bad[1]} and ${bad[2]})`, [{ kind: 'point', id: p }, { kind: 'point', id: q }])
      if (knots.length > MAX_KNOTS) throw new net.Refusal('link-responses-too-many', `link-responses-too-many: linking ${p} and ${q} would give ${knots.length} knots on ${edge}, axis ${ax} (at most ${MAX_KNOTS})`, [{ kind: 'point', id: p }, { kind: 'point', id: q }])
      axes[ax] = knots.map(k => [k[0], k[1]] as Knot)
    }
    if (axes.x || axes.y) put(merged, edge, axes)
  }
  for (const m of [...left, ...right]) {
    if (Object.keys(merged).length) put(s.points, m, structuredClone(merged))
    else delete s.points[m]
  }
}

/** A comparison form independent of key order (lists keep their order). */
const canon = (v: unknown): string => (Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canon((v as Rec<unknown>)[k])}`).join(',')}}` : JSON.stringify(v))

/** At open: responses checked against the drawing, and every link component holding identical sets. */
export function restoreResponses(v: unknown, n: net.NetworkState, l: links.LinksState): ResponsesState {
  const data = checkResponses(v, new Set(net.points(n).map(p => p.id)), new Set(net.lines(n).map(x => x.id)), 'open-failed: animation')
  for (const { a, b } of links.pairs(l)) {
    if (canon(own(data.points, a) ?? null) !== canon(own(data.points, b) ?? null)) throw new Error(`open-failed: linked points ${a} and ${b} hold different responses`)
  }
  return structuredClone(data) as RStore as unknown as ResponsesState
}
