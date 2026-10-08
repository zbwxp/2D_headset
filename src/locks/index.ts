// locks — a locked element cannot be edited (Q29, Q31). This module only compares
// each locked line's protected content before and after an edit; document refuses
// the whole edit on any difference. Locked fills protect their colour, which the
// fills module refuses to change directly; a locked fill may vanish when its loop
// breaks (Q30 甲), so fills need no comparison here.
//
// Protected content of a line (bowen 1791434101, dot after f9c4109):
// - its drawn curve, as derived computes it (so an arc join that reshapes it counts);
// - its stroke (width, profile);
// - at each end, the end stroke that is actually drawn: the point's end stroke if
//   the end is free (no other line, no link), nothing if it is shared. The
//   free/shared flag itself is not compared;
// - at each end point, the point's joins and the arcs drawn there. A join is an
//   attribute of the point and the point belongs to the locked line, so a locked
//   line locks them too (bowen 1791459836). Binding another line onto the point
//   adds no join and changes none, so it stays allowed.
// The check is on the result: no line that is locked when the edit ends may differ
// from before it, and a locked line may not disappear. Unlocking and then editing in
// one edit is allowed (dot 1791459661: no extra two-step rule).
import * as net from '../network'
import * as joins from '../joins'
import * as links from '../links'
import * as derived from '../derived'
import type { Cubic } from '../geometry'

type Id = net.Id

export interface View { network: net.NetworkState; joins: joins.JoinsState; links: links.LinksState }
interface Content { curve: Cubic; stroke: net.Stroke; ends: [string, string]; joins: string; arcs: { key: string; curve: Cubic }[] }

const lockedLines = (v: View) => net.lines(v.network).filter(l => l.state.locked).map(l => l.id)

function contents(v: View, ids: Set<Id>): Map<Id, Content> {
  const out = new Map<Id, Content>()
  if (!ids.size) return out
  const drawn = derived.drawn(v.network, v.joins)
  const drawnEnd = (point: Id) => {
    const free = net.linesAt(v.network, point).length === 1 && !links.partners(v.links, point).length
    // compared by content, not by the order of its keys (dot 1791459721)
    const stroke = (free && joins.endStroke(v.joins, point)) || {}
    return JSON.stringify(Object.keys(stroke).sort().map(k => [k, stroke[k]]))
  }
  for (const id of ids) {
    if (!net.hasLine(v.network, id)) continue
    const l = net.line(v.network, id)
    const at = (x: { point: Id }) => x.point === l.a || x.point === l.b
    out.set(id, {
      curve: drawn.lines.get(id)!, stroke: l.stroke, ends: [drawnEnd(l.a), drawnEnd(l.b)],
      joins: JSON.stringify(joins.rows(v.joins).filter(at)),
      arcs: drawn.arcs.filter(at).map(a => ({ key: a.key, curve: a.curve })),
    })
  }
  return out
}

const near = (a: Cubic, b: Cubic) => a.every((p, i) => Math.abs(p.x - b[i]!.x) < 1e-9 && Math.abs(p.y - b[i]!.y) < 1e-9)
const same = (a: Content, b: Content) =>
  near(a.curve, b.curve) && a.stroke.width === b.stroke.width && a.stroke.profile === b.stroke.profile && a.ends[0] === b.ends[0] && a.ends[1] === b.ends[1] &&
  a.joins === b.joins && a.arcs.length === b.arcs.length && a.arcs.every((x, i) => x.key === b.arcs[i]!.key && near(x.curve, b.arcs[i]!.curve))

/**
 * Lines locked in the result whose protected content differs from before the
 * edit. A line that did not exist before (drawn, or copied with its lock) has no
 * earlier content to protect; a line locked before and gone now has changed.
 */
export function changed(before: View, after: View): Id[] {
  const gone = lockedLines(before).filter(id => !net.hasLine(after.network, id))
  const ids = new Set([...gone, ...lockedLines(after).filter(id => net.hasLine(before.network, id))])
  const a = contents(before, ids), b = contents(after, ids)
  return [...ids].filter(id => { const x = a.get(id), y = b.get(id); return !x || !y || !same(x, y) }).sort()
}
