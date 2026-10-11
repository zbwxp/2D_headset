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
