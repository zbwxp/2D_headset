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
import * as evaluate from '../evaluate'
import { respond, checkKnots, MAX_KNOTS } from '../evaluate'

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
      // the one knot check, index by index (no empty slot skipped), shared with evaluate (dot 1791690497)
      const knots = checkKnots((ax as Rec<unknown>)[k], `${what} on ${edge} ${k}`)
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
  // objects, not lists: an empty list is a format error, never read as "no responses" (dot 1791690497)
  if (!ps || typeof ps !== 'object' || Array.isArray(ps) || !hs || typeof hs !== 'object' || Array.isArray(hs)) throw new Error(`${what}: points and handles must be objects`)
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

// ---- the correction on an edge (stage 3b package 3; docs/stage3b-pkg3-correct.md) ----
// A drag at a pose on an edge between two neighbouring views becomes one knot per dragged
// control and axis on that edge's response; no view moves (the 90° move is package 4).

export interface CorrectionTargets {
  readonly points?: readonly { readonly id: Id; readonly position: Vec }[]
  readonly handles?: readonly { readonly line: Id; readonly end: net.End; readonly vector: Vec }[]
}
type Control = { readonly kind: 'point'; readonly id: Id } | { readonly kind: 'handle'; readonly line: Id; readonly end: net.End }
const objectsOf = (c: Control): net.RefusalObject[] => (c.kind === 'point' ? [{ kind: 'point', id: c.id }] : net.lineObjects([c.line]))
/** A control's key: unambiguous for any id (the prefix and the one-letter end come first). */
const keyOf = (c: Control) => (c.kind === 'point' ? `p:${c.id}` : `h:${c.end}:${c.line}`)
const nameOf = (c: Control) => (c.kind === 'point' ? `point ${c.id}` : `handle ${c.end} of line ${c.line}`)

/**
 * The edge a pose lies on and the progress t along it (inner → outer), read as evaluate reads a
 * pose: u = |yaw| / 90, v = |pitch| / 45, so a pose evaluate shows as a view is a view here too.
 */
export function edgeAt(pose: evaluate.Pose): { edge: views.Edge; t: number } {
  if (!evaluate.inRange(pose)) throw new net.Refusal('pose-out-of-range', `pose-out-of-range: yaw ${pose.yaw}, pitch ${pose.pitch} (yaw within ±${evaluate.YAW_LIMIT}, pitch within ±${evaluate.PITCH_LIMIT})`)
  const u = Math.abs(pose.yaw) / evaluate.YAW_LIMIT, v = Math.abs(pose.pitch) / evaluate.PITCH_LIMIT
  const atEnd = (x: number) => x === 0 || x === 1
  if (atEnd(u) && atEnd(v)) throw new net.Refusal('correction-at-view', `correction-at-view: yaw ${pose.yaw}, pitch ${pose.pitch} is a view; edit the view itself`)
  const Y = pose.yaw < 0 ? -90 : 90, P = pose.pitch < 0 ? -45 : 45
  let inner: string, outer: string, t: number
  if (atEnd(v)) { inner = views.key(0, v ? P : 0); outer = views.key(Y, v ? P : 0); t = u }
  else if (atEnd(u)) { inner = views.key(u ? Y : 0, 0); outer = views.key(u ? Y : 0, P); t = v }
  else throw new net.Refusal('correction-off-edge', `correction-off-edge: yaw ${pose.yaw}, pitch ${pose.pitch} is inside a cell; this round corrects on the edges between neighbouring views only (bowen 1791692031)`)
  return { edge: views.EDGES.find(e => e.inner === inner && e.outer === outer)!, t }
}

function knotsOf(s: RStore, c: Control, edge: string, axis: 'x' | 'y'): Knot[] | undefined {
  const rec = c.kind === 'point' ? own(s.points, c.id) : own(s.handles, c.line)?.[c.end]
  return rec ? own(rec, edge)?.[axis] : undefined
}
function setKnots(s: RStore, c: Control, edge: string, axis: 'x' | 'y', knots: Knot[]) {
  let rec: Rec<{ x?: Knot[]; y?: Knot[] }>
  if (c.kind === 'point') {
    if (!own(s.points, c.id)) put(s.points, c.id, {})
    rec = s.points[c.id]!
  } else {
    if (!own(s.handles, c.line)) put(s.handles, c.line, {})
    rec = (s.handles[c.line]![c.end] ??= {})
  }
  if (!own(rec, edge)) put(rec, edge, {})
  rec[edge]![axis] = knots
}

/** A control's value in a view, and in the drawing at a pose. */
const inView = (h: net.NetworkState, c: Control): Vec => (c.kind === 'point' ? net.point(h, c.id).position : net.handle(net.line(h, c.line), c.end))
const atPose = (p: evaluate.Posed, c: Control): Vec => (c.kind === 'point' ? p.points[c.id]! : p.lines[c.line]![c.end === 'a' ? 'ha' : 'hb'])

const finiteVec = (v: unknown): v is Vec => !!v && typeof v === 'object' && Number.isFinite((v as Vec).x) && Number.isFinite((v as Vec).y)
/** The knot value that makes an edge from P0 to P1 show v, without intermediate overflow (dot 1791691300). */
const inverse = (v: number, P0: number, P1: number) => { const sc = Math.max(Math.abs(P0), Math.abs(P1), Math.abs(v)); return (v / sc - P0 / sc) / (P1 / sc - P0 / sc) }
const near = (got: number, want: number) => Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want))

// ---- the outer view's minimal move (stage 3b package 4; docs/stage3b-pkg4-move.md §2) ----

/** The cost's constants, from v103 (7205381 `boundedBasisInverse.ts`, `surfaceBasisFallback.ts`): tuning values kept in one place. */
export const MOVE_COST = Object.freeze({ point: 16, handle: 1, response: 0.005, scaleFloor: 1e-6 })

/** z³(z − ρ) ≥ 1, decided without forming z³ (no ∞ · 0 for a huge ρ); z = 0 counts as below. */
const above = (z: number, rho: number) => z !== 0 && Math.sign(z) * ((z - rho) - 1 / z / z / z) >= 0
/** The scaled cost φ(z) = 1/z² + (z − ρ)². */
const phi = (z: number, rho: number) => 1 / z / z + (z - rho) * (z - rho)

/**
 * The scaled root (§2): on the branch given by `positive` (the sign of the original r, which the
 * scaling can lose: a strictly negative r may scale to −0; dot 1791696097), the z with
 * z³(z − ρ) = 1, by halving a width-2 bracket from its inner end (test fails) to its outer end
 * (test holds) until the ends are adjacent doubles; then the end with the smaller φ, ties to the
 * end nearer ρ, then to the larger |z|. Undefined only if ρ is not finite or the bracket is invalid
 * (which the plan shows cannot happen for a finite ρ).
 */
export function solveScaled(rho: number, positive: boolean): number | undefined {
  if (!Number.isFinite(rho)) return undefined
  let inner = positive ? Math.max(rho, 0) : Math.min(rho, 0)
  let outer = positive ? inner + 2 : inner - 2
  if (inner === outer) return inner
  if (above(inner, rho) || !above(outer, rho)) return undefined
  for (;;) {
    const mid = inner + (outer - inner) / 2
    if (mid === inner || mid === outer) break
    if (above(mid, rho)) outer = mid
    else inner = mid
  }
  const ends = [inner, outer].filter(z => z !== 0)
  ends.sort((p, q) => phi(p, rho) - phi(q, rho) || Math.abs(p - rho) - Math.abs(q - rho) || Math.abs(q) - Math.abs(p))
  return ends[0]
}

/**
 * The knot value w for one control and axis in the move case (§2): minimises
 * k · (c / (S·w))² + λ · (w − r)². Undefined when a number on the way is not finite or w is 0.
 */
export function solveMove(c: number, r: number, k: number, S: number): number | undefined {
  const a = Math.abs(c) / S * Math.sqrt(k / MOVE_COST.response)
  if (!(a > 0) || !Number.isFinite(a)) return undefined
  const sa = Math.sqrt(a)
  if (!(sa > 0)) return undefined
  const rho = r / sa
  // the branch follows r itself: r > 0 or r = ±0 positive, r < 0 negative, even when r / √a rounds to −0
  const z = solveScaled(rho, !(r < 0))
  if (z === undefined) return undefined
  // the response that should stay is kept as it is, never rebuilt through the scaling (dot 1791694943)
  const w = z === rho ? r : sa * z
  return Number.isFinite(w) && w !== 0 ? w : undefined
}

/** A composite key with no separator to confuse: any legal id, `|` or `:` included (dot 1791696205). */
const ckey = (...parts: string[]) => JSON.stringify(parts)
/** Every point position and handle vector scalar of every shape layer, as structured entries. */
interface Scalar { readonly layer: string; readonly control: Control; readonly axis: 'x' | 'y'; readonly value: number }
function scalars(n: net.NetworkState): Map<string, Scalar> {
  const out = new Map<string, Scalar>()
  const add = (layer: string, control: Control, v: Vec) => { for (const axis of AXES) out.set(ckey(layer, keyOf(control), axis), { layer, control, axis, value: v[axis] }) }
  for (const { key } of net.shapeLayers(n)) {
    const h = net.of(n, key)
    for (const p of net.points(h)) add(key, { kind: 'point', id: p.id }, p.position)
    for (const l of net.lines(h)) for (const end of ['a', 'b'] as const) add(key, { kind: 'handle', line: l.id, end }, net.handle(l, end))
  }
  return out
}

/**
 * What `correct` needs from the document (ledger row 13, docs/stage3b-pkg4-move.md §7a): the
 * model assembly and the settle are the document's, so they are handed in; `correct` evaluates.
 */
export interface CorrectionWorld {
  /** The draft as `evaluate` reads it. */
  model(): evaluate.Model
  /** The draft settled as the commit will settle it: its network (every shape layer) and its model. */
  settled(): { network: net.NetworkState; model: evaluate.Model }
}

const posedAt = (model: evaluate.Model, pose: evaluate.Pose, after: boolean): evaluate.Posed => {
  try { return evaluate.evaluate(model, pose) } catch (err) {
    if (!(err instanceof evaluate.PoseNotFinite)) throw err
    // before any write the drawing already has no value here; after the write, this correction caused it
    throw after
      ? new net.Refusal('correction-not-finite', `correction-not-finite: ${err.what} would not be a finite number at this pose`)
      : new net.Refusal('pose-not-finite', err.message)
  }
}

/**
 * `correct(pose, targets)` (docs/stage3b-pkg3-correct.md, docs/stage3b-pkg4-move.md): the explicit
 * targets are checked; each point stands for its link component (the target set); locks and the
 * axis cases run on the whole set; on an edge from the front, an axis equal in both views moves the
 * outer view O by the minimal-move cost; the old knots on O's edges are re-solved against O as the
 * settle leaves it; every knot is written in one step; then the final check against the draft on
 * entry. `ch` records O's moves as this edit's intents.
 */
export function correct(a: ResponsesState, n: net.NetworkState, l: links.LinksState, ch: net.Changes, pose: evaluate.Pose, targets: CorrectionTargets, world: CorrectionWorld) {
  const { edge, t } = edgeAt(pose)
  const bad = (why: string): never => { throw new net.Refusal('correction-bad-target', `correction-bad-target: ${why}`) }
  // 1. the explicit targets
  const ps = targets?.points ?? [], hs = targets?.handles ?? []
  if (!Array.isArray(ps) || !Array.isArray(hs)) bad('points and handles must be lists')
  const given = new Map<Id, Vec>(), handles = new Map<string, { control: Control; q: Vec }>()
  for (const p of ps) {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !net.hasPoint(n, p.id)) bad(`no point ${JSON.stringify(p?.id)}`)
    if (given.has(p.id)) bad(`point ${p.id} is given twice`)
    if (!finiteVec(p.position)) bad(`the position of point ${p.id} is not two finite numbers`)
    given.set(p.id, { x: p.position.x, y: p.position.y })
  }
  for (const h of hs) {
    if (!h || typeof h !== 'object' || typeof h.line !== 'string' || !net.hasLine(n, h.line)) bad(`no line ${JSON.stringify(h?.line)}`)
    if (h.end !== 'a' && h.end !== 'b') bad(`line ${h.line} has no end ${JSON.stringify(h.end)}`)
    const control: Control = { kind: 'handle', line: h.line, end: h.end }, k = keyOf(control)
    if (handles.has(k)) bad(`handle ${h.end} of line ${h.line} is given twice`)
    if (!finiteVec(h.vector)) bad(`the vector of handle ${h.end} of line ${h.line} is not two finite numbers`)
    handles.set(k, { control, q: { x: h.vector.x, y: h.vector.y } })
  }
  // 2. link expansion: every member of a touched component joins the target set with the same target
  const points = new Map<Id, Vec>()
  for (const [id, q] of given) for (const m of component(l, id)) {
    const had = points.get(m)
    if (had && (had.x !== q.x || had.y !== q.y)) throw new net.Refusal('correction-link-conflict', `correction-link-conflict: linked points ${m} and ${id} are given different targets`, [{ kind: 'point', id: m }, { kind: 'point', id }])
    points.set(m, q)
  }
  const set: { control: Control; q: Vec }[] = [...[...points].map(([id, q]) => ({ control: { kind: 'point', id } as Control, q })), ...handles.values()]
  // 3. locks on the whole target set: a correction changes the in-between shape of every line it touches
  for (const { control: c } of set) {
    const locked = c.kind === 'point' ? net.linesAt(n, c.id).map(x => x.line).filter(x => x.state.locked).map(x => x.id) : net.line(n, c.line).state.locked ? [c.line] : []
    if (locked.length) throw new net.Refusal('locked', `Line ${locked[0]} is locked; a correction of ${nameOf(c)} would change its in-between shape`, net.lineObjects(locked))
  }
  // 3. the axis cases, and 4. one solve from the draft as entered
  const s = R(a), inner = net.of(n, edge.inner), outer = net.of(n, edge.outer)
  const entry = scalars(n), before = posedAt(world.model(), pose, false)
  /** A control's value in a layer as the draft held it on entry (O is moved later). */
  const was = (layer: string, c: Control, axis: 'x' | 'y') => entry.get(ckey(layer, keyOf(c), axis))!.value
  // an edge from the front may move its outer view O; S is read once, before any move, for every control (dot 1791694500)
  const O = edge.inner === views.FRONT ? edge.outer : undefined
  const S = O === undefined ? 1 : Math.max(MOVE_COST.scaleFloor, ...AXES.map(axis => {
    const xs = [inner, outer].flatMap(h => net.points(h).map(p => p.position[axis]))
    return xs.length ? Math.max(...xs) - Math.min(...xs) : 0
  }))
  const lists = new Map<string, { control: Control; edge: string; axis: 'x' | 'y'; knots: Knot[] }>()
  const listKey = (c: Control, e: string, axis: 'x' | 'y') => ckey(keyOf(c), e, axis)
  const moves: { control: Control; axis: 'x' | 'y'; to: number }[] = []
  for (const { control: c, q } of set) for (const axis of AXES) {
    const A = inView(inner, c)[axis], B = inView(outer, c)[axis], p = atPose(before, c)[axis]
    if (q[axis] === p) continue // already met: nothing written (dot 1791687532)
    const notFinite = (why: string): never => { throw new net.Refusal('correction-not-finite', `correction-not-finite: ${nameOf(c)}, axis ${axis}, on ${edge.key}: ${why}`, objectsOf(c)) }
    let w: number, shownWith = B
    if (A !== B) w = inverse(q[axis], A, B) // the response alone (package 3)
    else if (O === undefined) throw new net.Refusal('correction-axis-fixed', `correction-axis-fixed: ${nameOf(c)}, axis ${axis}, is equal in both views of ${edge.key}, which does not start at the front; neither view may move`, objectsOf(c))
    else if (q[axis] === A) w = 0 // the knot [t, 0] shows A exactly; nothing moves (§1)
    else {
      // the move case (§1, §2): O takes B' = A + c / w
      const cDelta = q[axis] - A
      const solved = solveMove(cDelta, respond(knotsOf(s, c, edge.key, axis), t), c.kind === 'point' ? MOVE_COST.point : MOVE_COST.handle, S)
      if (solved === undefined) notFinite('the minimal move has no finite solution for this target')
      w = solved!
      shownWith = A + cDelta / w
      if (!Number.isFinite(shownWith)) notFinite('the outer view would move to a non-finite value')
      moves.push({ control: c, axis, to: shownWith })
    }
    if (!Number.isFinite(w)) notFinite('the views are too close for this target')
    const knots = [...(knotsOf(s, c, edge.key, axis) ?? []).filter(k => k[0] !== t), [t, w] as Knot].sort((x, y) => x[0] - y[0])
    // a finite knot can still overflow the blend (dot 1791693222)
    if (!Number.isFinite(evaluate.onEdge(knots, t, A, shownWith))) notFinite('the target cannot be shown at this pose without overflow')
    if (knots.length > MAX_KNOTS) throw new net.Refusal('correction-too-many-knots', `correction-too-many-knots: ${nameOf(c)}, axis ${axis}, on ${edge.key} would have ${knots.length} knots (at most ${MAX_KNOTS})`, objectsOf(c))
    lists.set(listKey(c, edge.key, axis), { control: c, edge: edge.key, axis, knots })
  }
  if (!lists.size) return
  // the protected targets: every knot on the edges whose views this correction can change (this edge;
  // with a move, also O's edges to its corners), recorded at its own t before anything is written
  const touched = O === undefined || !moves.length ? [edge] : [edge, ...views.EDGES.filter(e => e.inner === O)]
  const controls: Control[] = [
    ...Object.keys(s.points).map(id => ({ kind: 'point', id }) as Control),
    ...Object.keys(s.handles).flatMap(line => (['a', 'b'] as const).map(end => ({ kind: 'handle', line, end }) as Control)),
  ]
  const protectedBefore = touched.flatMap(e => controls.flatMap(c => AXES.flatMap(axis => {
    const knots = knotsOf(s, c, e.key, axis)
    if (!knots) return []
    const i0 = was(e.inner, c, axis), o0 = was(e.outer, c, axis)
    const written = e === edge && lists.has(listKey(c, e.key, axis))
    return knots.filter(k => !(written && k[0] === t)).map(k => ({ c, e, axis, t: k[0], v: evaluate.onEdge(knots, k[0], i0, o0) }))
  })))
  // 5. O's moves, through O's own operations so its links and springs settle them; a moved point's other axis keeps its value
  const mask = new Map(moves.map(m => [ckey(keyOf(m.control), m.axis), m.to]))
  if (O !== undefined && moves.length) {
    const h = net.of(n, O)
    for (const c of new Map(moves.map(m => [keyOf(m.control), m.control])).values()) {
      const now = inView(h, c), to = { x: mask.get(ckey(keyOf(c), 'x')) ?? now.x, y: mask.get(ckey(keyOf(c), 'y')) ?? now.y }
      if (c.kind === 'point') net.move(h, ch, [{ id: c.id, target: to }])
      else net.moveHandle(h, ch, c.line, c.end, to)
    }
    // the old knots on O's edges, re-solved against O as the settle leaves it (§4): front → O
    // (other knots of a moved axis) and O → its corners
    const settledO = net.of(world.settled().network, O)
    const resolve = (c: Control, e: views.Edge, axis: 'x' | 'y', knots: readonly Knot[], skip?: number): Knot[] => {
      // the value each knot showed is read with the views as they were on entry, O before its move
      const i0 = was(e.inner, c, axis), o0 = was(e.outer, c, axis)
      const i1 = e.inner === O ? inView(settledO, c)[axis] : i0, o1 = e.outer === O ? inView(settledO, c)[axis] : o0
      return knots.map(k => {
        if (k[0] === skip) return k
        const v = evaluate.onEdge(knots, k[0], i0, o0)
        if (i1 === o1) {
          if (v === i1) return k // still met whatever its value
          throw new net.Refusal('correction-breaks-target', `correction-breaks-target: ${nameOf(c)}, axis ${axis}, on ${e.key} at progress ${k[0]}: both views become ${i1}, so its earlier target ${v} cannot be kept`, objectsOf(c))
        }
        const w = inverse(v, i1, o1)
        if (!Number.isFinite(w)) throw new net.Refusal('correction-not-finite', `correction-not-finite: ${nameOf(c)}, axis ${axis}, on ${e.key} at progress ${k[0]}: its earlier target cannot be kept after the move`, objectsOf(c))
        return [k[0], w] as Knot
      })
    }
    for (const m of moves) {
      const here = lists.get(listKey(m.control, edge.key, m.axis))!
      here.knots = resolve(m.control, edge, m.axis, here.knots, t)
      for (const e of touched) if (e !== edge) {
        const knots = knotsOf(s, m.control, e.key, m.axis)
        if (knots) lists.set(listKey(m.control, e.key, m.axis), { control: m.control, edge: e.key, axis: m.axis, knots: resolve(m.control, e, m.axis, knots) })
      }
    }
    // every re-solved knot must show a number
    for (const li of lists.values()) {
      const e = views.EDGES.find(x => x.key === li.edge)!
      const i1 = e.inner === O ? inView(settledO, li.control)[li.axis] : was(e.inner, li.control, li.axis)
      const o1 = e.outer === O ? inView(settledO, li.control)[li.axis] : was(e.outer, li.control, li.axis)
      for (const k of li.knots) if (!Number.isFinite(evaluate.onEdge(li.knots, k[0], i1, o1))) throw new net.Refusal('correction-not-finite', `correction-not-finite: ${nameOf(li.control)}, axis ${li.axis}, on ${li.edge} at progress ${k[0]}: its earlier target cannot be shown after the move`, objectsOf(li.control))
    }
  }
  // linked points must hold identical response sets (package 2). Open allows linked points up to
  // 1e-9 apart in every view, so each member's own solve or re-solve can differ: the sets as they
  // would be after the write are compared, members that write nothing included; any difference
  // refuses the whole step (dot 1791693096)
  const proposed: RStore = { points: {}, handles: {} }
  for (const id of points.keys()) put(proposed.points, id, structuredClone(own(s.points, id) ?? {}))
  for (const li of lists.values()) if (li.control.kind === 'point') setKnots(proposed, li.control, li.edge, li.axis, li.knots)
  for (const id of given.keys()) for (const m of component(l, id)) if (canon(own(proposed.points, m)) !== canon(own(proposed.points, id))) {
    throw new net.Refusal('correction-link-differs', `correction-link-differs: linked points ${id} and ${m} would hold different responses after this correction (their views differ slightly); nothing was written`, [{ kind: 'point', id }, { kind: 'point', id: m }])
  }
  for (const li of lists.values()) setKnots(s, li.control, li.edge, li.axis, li.knots)
  // 6. the final check, on the draft as the commit will settle it, against the draft on entry (§5)
  const trial = world.settled(), after = posedAt(trial.model, pose, true)
  const notReproduced = (c: Control, why: string): never => { throw new net.Refusal('correction-not-reproduced', `correction-not-reproduced: ${nameOf(c)} ${why}`, objectsOf(c)) }
  for (const { control: c, q } of set) for (const axis of AXES) {
    const got = atPose(after, c)[axis]
    if (!near(got, q[axis])) notReproduced(c, `shows ${got} on axis ${axis} at this pose, not its target ${q[axis]}`)
  }
  const inSet = new Set(set.map(x => keyOf(x.control)))
  for (const id of Object.keys(before.points)) {
    const c: Control = { kind: 'point', id }
    if (!inSet.has(keyOf(c))) for (const axis of AXES) if (before.points[id]![axis] !== after.points[id]![axis]) notReproduced(c, `is outside the targets but changed on axis ${axis} at this pose`)
  }
  for (const line of Object.keys(before.lines)) for (const end of ['a', 'b'] as const) {
    const c: Control = { kind: 'handle', line, end }
    if (!inSet.has(keyOf(c))) for (const axis of AXES) if (atPose(before, c)[axis] !== atPose(after, c)[axis]) notReproduced(c, `is outside the targets but changed on axis ${axis} at this pose`)
  }
  // every point position and handle vector of every shape layer: O's moved (control, axis) near its
  // new value, every other scalar exactly as on entry, a moved point's other axis included (dot 1791694560)
  const now = scalars(trial.network)
  for (const [k, { layer, control: c, axis, value: was0 }] of entry) {
    const got = now.get(k)!.value, moved = layer === O ? mask.get(ckey(keyOf(c), axis)) : undefined
    if (moved !== undefined ? !near(got, moved) : got !== was0) notReproduced(c, moved !== undefined ? `is ${got} on axis ${axis} in ${layer}, not its move ${moved}` : `changed on axis ${axis} in ${layer} (${was0} → ${got}), outside this correction's moves`)
  }
  // the protected targets at their recorded progress, never through a pose (dot 1791691388): exactly
  // where nothing was re-solved, within the tolerance where a knot was re-solved
  for (const k of protectedBefore) {
    const knots = knotsOf(s, k.c, k.e.key, k.axis)
    const resolved = moves.some(m => m.axis === k.axis && keyOf(m.control) === keyOf(k.c))
    const got = evaluate.onEdge(knots, k.t, inView(net.of(trial.network, k.e.inner), k.c)[k.axis], inView(net.of(trial.network, k.e.outer), k.c)[k.axis])
    if (resolved ? !near(got, k.v) : got !== k.v) notReproduced(k.c, `lost its earlier target at progress ${k.t} on ${k.e.key}, axis ${k.axis} (${k.v} → ${got})`)
  }
}
