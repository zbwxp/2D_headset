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

/** One control's value on one axis on an edge at progress t, summed as evaluate sums it there (zero weights left out). */
function edgeValue(knots: readonly Knot[] | undefined, t: number, A: number, B: number): number {
  const r = respond(knots, t)
  let s: number | undefined
  for (const [w, x] of [[1 - r, A], [r, B]] as const) if (w !== 0) s = s === undefined ? w * x : s + w * x
  return s ?? 0
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

/**
 * `correct(pose, targets)` (docs/stage3b-pkg3-correct.md §1–§5): the explicit targets are checked;
 * each point stands for its link component (the target set: link-expanded points, explicit
 * handles); locks and the axis cases run on the whole set; the knots are solved from the state as
 * read before any write and written in one step; then the final check. `posed` evaluates the
 * drawing (with the current responses) at the pose.
 */
export function correct(a: ResponsesState, n: net.NetworkState, l: links.LinksState, pose: evaluate.Pose, targets: CorrectionTargets, posed: () => evaluate.Posed) {
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
  // 3. the axis cases, and 4. one solve from the state as read before any write
  const s = R(a), inner = net.of(n, edge.inner), outer = net.of(n, edge.outer), before = posed()
  const writes: { control: Control; axis: 'x' | 'y'; knots: Knot[] }[] = []
  for (const { control: c, q } of set) for (const axis of AXES) {
    const A = inView(inner, c)[axis], B = inView(outer, c)[axis], p = atPose(before, c)[axis]
    if (q[axis] === p) continue // already met: nothing written (dot 1791687532)
    if (A === B) throw new net.Refusal('correction-axis-fixed', `correction-axis-fixed: ${nameOf(c)}, axis ${axis}, is equal in both views of ${edge.key}; a response cannot move it (moving the outer view is package 4)`, objectsOf(c))
    // solved without intermediate overflow; whether it reaches q is decided by the final check (dot 1791691300)
    const sc = Math.max(Math.abs(A), Math.abs(B), Math.abs(q[axis]))
    const w = (q[axis] / sc - A / sc) / (B / sc - A / sc)
    if (!Number.isFinite(w)) throw new net.Refusal('correction-not-finite', `correction-not-finite: ${nameOf(c)}, axis ${axis}, on ${edge.key}: the views are too close for this target`, objectsOf(c))
    const knots = [...(knotsOf(s, c, edge.key, axis) ?? []).filter(k => k[0] !== t), [t, w] as Knot].sort((x, y) => x[0] - y[0])
    if (knots.length > MAX_KNOTS) throw new net.Refusal('correction-too-many-knots', `correction-too-many-knots: ${nameOf(c)}, axis ${axis}, on ${edge.key} would have ${knots.length} knots (at most ${MAX_KNOTS})`, objectsOf(c))
    writes.push({ control: c, axis, knots })
  }
  // linked points must hold identical response sets (package 2). Open allows linked points up to
  // 1e-9 apart, so each member's own solve can differ: the sets as they would be after the write are
  // compared, members that write nothing included; any difference refuses the whole step (dot 1791693096)
  const proposed: RStore = { points: {}, handles: {} }
  for (const id of points.keys()) put(proposed.points, id, structuredClone(own(s.points, id) ?? {}))
  for (const w of writes) if (w.control.kind === 'point') setKnots(proposed, w.control, edge.key, w.axis, w.knots)
  for (const id of given.keys()) for (const m of component(l, id)) if (canon(own(proposed.points, m)) !== canon(own(proposed.points, id))) {
    throw new net.Refusal('correction-link-differs', `correction-link-differs: linked points ${id} and ${m} would hold different responses after this correction (their views differ slightly); nothing was written`, [{ kind: 'point', id }, { kind: 'point', id: m }])
  }
  if (!writes.length) return
  // the protected targets on this edge, as they stand before the write: every knot of every control there
  const controls: Control[] = [
    ...Object.keys(s.points).map(id => ({ kind: 'point', id }) as Control),
    ...Object.keys(s.handles).flatMap(line => (['a', 'b'] as const).map(end => ({ kind: 'handle', line, end }) as Control)),
  ]
  const protectedBefore = controls.flatMap(c => AXES.flatMap(axis => {
    const knots = knotsOf(s, c, edge.key, axis)
    const written = writes.some(w => w.axis === axis && keyOf(w.control) === keyOf(c))
    return (knots ?? []).filter(k => !(written && k[0] === t)).map(k => ({ c, axis, t: k[0], v: edgeValue(knots, k[0], inView(inner, c)[axis], inView(outer, c)[axis]) }))
  }))
  for (const w of writes) setKnots(s, w.control, edge.key, w.axis, w.knots)
  // 5. the final check
  const after = posed()
  const notReproduced = (c: Control, why: string): never => { throw new net.Refusal('correction-not-reproduced', `correction-not-reproduced: ${nameOf(c)} ${why}`, objectsOf(c)) }
  for (const { control: c, q } of set) for (const axis of AXES) {
    const got = atPose(after, c)[axis]
    if (!(Math.abs(got - q[axis]) <= 1e-9 * Math.max(1, Math.abs(q[axis])))) notReproduced(c, `shows ${got} on axis ${axis} at this pose, not its target ${q[axis]}`)
  }
  const inSet = new Set(set.map(x => keyOf(x.control)))
  for (const id of Object.keys(before.points)) {
    const c: Control = { kind: 'point', id }
    if (!inSet.has(keyOf(c)) && !sameVec(before.points[id]!, after.points[id]!)) notReproduced(c, 'is outside the targets but changed at this pose')
  }
  for (const line of Object.keys(before.lines)) for (const end of ['a', 'b'] as const) {
    const c: Control = { kind: 'handle', line, end }
    if (!inSet.has(keyOf(c)) && !sameVec(atPose(before, c), atPose(after, c))) notReproduced(c, 'is outside the targets but changed at this pose')
  }
  // protected targets at their recorded progress, never through a pose (dot 1791691388)
  for (const k of protectedBefore) {
    if (edgeValue(knotsOf(s, k.c, edge.key, k.axis), k.t, inView(inner, k.c)[k.axis], inView(outer, k.c)[k.axis]) !== k.v) notReproduced(k.c, `lost its protected target at progress ${k.t} on ${edge.key}, axis ${k.axis}`)
  }
}
const sameVec = (p: Vec, q: Vec) => p.x === q.x && p.y === q.y
