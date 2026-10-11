// views — the nine views of a drawing (graph "Views"; docs/architecture-multiview.md §2,
// package 3): their names, yaw −90 / 0 / +90 × pitch −45 / 0 / +45 (pitch ±45 is a
// candidate value, graph row "Views"); a view is a shape layer of kind 'view' whose key
// is `view:<yaw>,<pitch>`. And operations across views: the stroke broadcast.
import * as net from '../network'
import * as joins from '../joins'
import { add, sub } from '../geometry'

export type Yaw = -90 | 0 | 90
export type Pitch = -45 | 0 | 45
export const YAWS: readonly Yaw[] = Object.freeze([-90, 0, 90])
export const PITCHES: readonly Pitch[] = Object.freeze([-45, 0, 45])

export const key = (yaw: Yaw, pitch: Pitch): string => {
  if (!YAWS.includes(yaw) || !PITCHES.includes(pitch)) throw new Error(`No view at yaw ${yaw}, pitch ${pitch}`)
  return `view:${yaw},${pitch}`
}
/** The front view, 0,0. */
export const FRONT = key(0, 0)
/** All nine view keys, yaw-major. */
export const ALL: readonly string[] = Object.freeze(YAWS.flatMap(y => PITCHES.map(p => key(y, p))))
export const isView = (k: string) => ALL.includes(k)
/**
 * Open's integrity check (dot 1791685305): the view layers of a file are exactly the nine view
 * keys, none missing, none extra, none renamed. Layers of other kinds are not limited here.
 */
export function checkViews(n: net.NetworkState) {
  const have = net.shapeLayers(n).filter(l => l.kind === 'view').map(l => l.key)
  const missing = ALL.filter(k => !have.includes(k)), extra = have.filter(k => !ALL.includes(k))
  if (missing.length || extra.length) {
    throw new Error(`open-failed: the view layers must be the nine views${missing.length ? `; missing ${missing.join(', ')}` : ''}${extra.length ? `; not a view key: ${extra.join(', ')}` : ''}`)
  }
}

/** The yaw and pitch of a view key (stage 3a: the angles evaluate places the views at). */
export function angle(k: string): { yaw: Yaw; pitch: Pitch } {
  const i = ALL.indexOf(k)
  if (i < 0) throw new Error(`Not a view key: ${String(k)}`)
  return { yaw: YAWS[Math.floor(i / PITCHES.length)]!, pitch: PITCHES[i % PITCHES.length]! }
}

/**
 * Stroke broadcast (bowen 1791650085, 1791650171, 1791650206; docs/step6-stroke-broadcast.md,
 * dot 1791655825): the chosen lines' own strokes, and the end strokes at their end points
 * (once per point), read in the view `from` is bound to and assigned to every other view
 * layer. A point without an end stroke there is cleared elsewhere (an assignment). Every
 * source value is read before anything is written; the source view is not written;
 * expression and record layers are not written. Shapes, radii, joins, links and fills
 * are untouched.
 */
export function broadcastStroke(from: net.NetworkState, j: joins.JoinsState, lines: readonly net.Id[]) {
  const ids = [...new Set(lines)]
  const points = [...new Set(ids.flatMap(id => { const l = net.line(from, id); return [l.a, l.b] }))]
  const strokes = ids.map(id => [id, net.line(from, id).stroke] as const)
  const ends = points.map(p => [p, joins.endStroke(j, from, p)] as const)
  for (const { key, kind } of net.shapeLayers(from)) {
    if (kind !== 'view' || key === net.boundLayer(from)) continue
    const to = net.of(from, key)
    for (const [id, stroke] of strokes) net.setLineStroke(to, id, stroke)
    for (const [p, e] of ends) { if (e) joins.setEndStroke(j, to, p, e); else joins.clearEndStroke(j, to, p) }
  }
}

/** The four corner views (yaw ±90 × pitch ±45) with the yaw and pitch views each is drafted from. */
export const CORNERS: readonly { key: string; yaw: string; pitch: string }[] = Object.freeze(
  ([-90, 90] as const).flatMap(y => ([-45, 45] as const).map(p => Object.freeze({ key: key(y, p), yaw: key(y, 0), pitch: key(0, p) }))))

/**
 * Diagonal draft (graph "Diagonal view"; bowen 1791639688; docs/stage2-plan.md rule 6): for
 * the chosen lines, each corner view gets front + (yaw view − front) + (pitch view − front),
 * per point (once) and per handle vector, read from the draft. Only the four corners change,
 * written through each corner's own move / moveHandle so its links and springs settle there.
 * Per corner, all or nothing: a corner already equal everywhere gets no write; otherwise every
 * chosen point and handle is written, so all are held (dot 1791681518). The baseline is not touched.
 */
export function draftCorners(n: net.NetworkState, ch: net.Changes, lines: readonly net.Id[]) {
  const front = net.of(n, FRONT)
  const ids = [...new Set(lines)]
  const points = [...new Set(ids.flatMap(id => { const l = net.line(front, id); return [l.a, l.b] }))]
  const pos = (h: net.NetworkState, p: net.Id) => net.point(h, p).position
  const hv = (h: net.NetworkState, id: net.Id, end: 'a' | 'b') => net.handle(net.line(h, id), end)
  // every value read before anything is written
  const plans = CORNERS.map(c => {
    const y = net.of(n, c.yaw), pt = net.of(n, c.pitch), to = net.of(n, c.key)
    const sum = (f: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => add(f, add(sub(a, f), sub(b, f)))
    const moves = points.map(p => ({ id: p, target: sum(pos(front, p), pos(y, p), pos(pt, p)) }))
    const handles = ids.flatMap(id => (['a', 'b'] as const).map(end => ({ id, end, v: sum(hv(front, id, end), hv(y, id, end), hv(pt, id, end)) })))
    const differs = (a: { x: number; y: number }, b: { x: number; y: number }) => a.x !== b.x || a.y !== b.y
    // a corner already equal everywhere is left alone; otherwise every chosen point and handle is
    // written, so all of them are held at settling, equal ones included (dot 1791681518)
    const due = moves.some(m => differs(pos(to, m.id), m.target)) || handles.some(h => differs(hv(to, h.id, h.end), h.v))
    return { to, due, moves, handles }
  })
  for (const { to, due, moves, handles } of plans) {
    if (!due) continue
    net.move(to, ch, moves)
    for (const h of handles) net.moveHandle(to, ch, h.id, h.end, h.v)
  }
}
