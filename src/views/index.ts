// views — the nine views of a drawing (graph "Views"; docs/architecture-multiview.md §2,
// package 3): their names, yaw −90 / 0 / +90 × pitch −45 / 0 / +45 (pitch ±45 is a
// candidate value, graph row "Views"); a view is a shape layer of kind 'view' whose key
// is `view:<yaw>,<pitch>`. And operations across views: the stroke broadcast.
import * as net from '../network'
import * as joins from '../joins'

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
