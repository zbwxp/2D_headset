// locks — a locked element cannot be edited (Q29, Q31). This module only compares
// each locked line's protected content before and after an edit; document refuses
// the whole edit on any difference. Locked fills protect their colour, which the
// fills module refuses to change directly; a locked fill may vanish when its loop
// breaks (Q30 甲), so fills need no comparison here.
//
// Rule (bowen 1791460893, 甲): deleting is always allowed; a lock only blocks edits.
// Whatever hung on a line the user deleted goes with it, even on a locked line's
// point (its joins and arcs there, and the end stroke that shows once the end is
// free). Any other change to a locked line's protected content refuses the edit.
//
// Protected content of a line (bowen 1791434101, 1791459836):
// - its own curve: end points (ids and positions) and handles;
// - its stroke (width, profile);
// - at each end, the end stroke that is drawn: the point's end stroke if the end
//   is free (no other line, no link), nothing if it is shared;
// - at each end point, the point's joins (same-point joins and joins across a
//   link) and the arcs drawn there, read from derived. A join is an attribute of
//   the point and the point belongs to the locked line. Binding another line onto
//   the point adds no join, so it stays allowed.
// The line's drawn (trimmed) curve follows from its own curve and the arc joins at
// its ends, so it needs no separate comparison.
// The check is on the result: no line locked when the edit ends may differ from
// before it, and a locked line may not disappear (dot 1791459661).
import * as net from '../network'
import * as joins from '../joins'
import * as links from '../links'
import * as derived from '../derived'
import type { Cubic } from '../geometry'

type Id = net.Id

export interface View { network: net.NetworkState; joins: joins.JoinsState; links: links.LinksState }
interface Content { own: string; stroke: net.Stroke; ends: [string, string]; joins: string; arcs: { key: string; curve: Cubic }[] }

const lockedLines = (v: View) => net.lines(v.network).filter(l => l.state.locked).map(l => l.id)

/**
 * Content of each line, leaving out whatever involves a line the user deleted.
 * `name(line, point)` gives the line's name after the edit, so a neighbour that was
 * only split is still the same neighbour (its piece at that point).
 */
function contents(v: View, ids: Set<Id>, deleted: Set<Id>, name: (line: Id, point: Id) => Id, survives: (point: Id) => boolean): Map<Id, Content> {
  const out = new Map<Id, Content>()
  if (!ids.size) return out
  const drawn = derived.drawn(v.network, v.joins)
  const live = (lines: readonly Id[]) => lines.every(x => !deleted.has(x))
  const pair = (point: Id, lines: readonly Id[]) => lines.map(x => name(x, point)).sort() as [Id, Id]
  const drawnEnd = (line: Id, point: Id) => {
    const others = net.linesAt(v.network, point).filter(e => e.line.id !== line && !deleted.has(name(e.line.id, point)))
    // a link ends only when its partner point disappears; that follows a delete too
    const free = !others.length && !links.partners(v.links, point).filter(survives).length
    // joins stores an end stroke with sorted keys, so equal content compares equal (dot 1791459721)
    return JSON.stringify((free && joins.endStroke(v.joins, point)) || {})
  }
  for (const id of ids) {
    if (!net.hasLine(v.network, id)) continue
    const l = net.line(v.network, id)
    const at = (x: { point: Id }) => x.point === l.a || x.point === l.b
    const pos = (p: Id) => net.point(v.network, p).position
    out.set(id, {
      own: JSON.stringify([l.a, l.b, pos(l.a), pos(l.b), l.ha, l.hb]),
      stroke: l.stroke, ends: [drawnEnd(id, l.a), drawnEnd(id, l.b)],
      joins: JSON.stringify([
        joins.rows(v.joins).filter(at).map(r => ({ ...r, lines: pair(r.point, r.lines) })).filter(r => live(r.lines))
          .sort((x, y) => (JSON.stringify(x) < JSON.stringify(y) ? -1 : 1)),
        links.joins(v.links).filter(x => at({ point: x.a }) || at({ point: x.b }))
          .map(x => ({ ...x, lines: [name(x.lines[0], x.a), name(x.lines[1], x.b)] })).filter(x => live(x.lines)),
      ]),
      // an arc is drawn from its first line to its second; after a split the names may
      // sort the other way, so orient the curve by the pair as named now (dot 1791461356)
      arcs: drawn.arcs.filter(at).map(a => {
        const lines = pair(a.point, a.lines), flipped = name(a.lines[0], a.point) !== lines[0]
        return { key: JSON.stringify([a.point, lines]), lines, curve: flipped ? ([a.curve[3], a.curve[2], a.curve[1], a.curve[0]] as Cubic) : a.curve }
      })
        .filter(a => live(a.lines)).sort((x, y) => (x.key < y.key ? -1 : 1)).map(a => ({ key: a.key, curve: a.curve })),
    })
  }
  return out
}

const near = (a: Cubic, b: Cubic) => a.every((p, i) => Math.abs(p.x - b[i]!.x) < 1e-9 && Math.abs(p.y - b[i]!.y) < 1e-9)
const same = (a: Content, b: Content) =>
  a.own === b.own && a.stroke.width === b.stroke.width && a.stroke.profile === b.stroke.profile && a.ends[0] === b.ends[0] && a.ends[1] === b.ends[1] &&
  a.joins === b.joins && a.arcs.length === b.arcs.length && a.arcs.every((x, i) => x.key === b.arcs[i]!.key && near(x.curve, b.arcs[i]!.curve))

/**
 * Lines locked in the result whose protected content differs from before the
 * edit. A line that did not exist before (drawn, or copied with its lock) has no
 * earlier content to protect; a line locked before and gone now has changed.
 * `ch`: the lines the user deleted in this edit, and the splits made in it.
 */
export function changed(before: View, after: View, ch: Pick<net.Changes, 'deletedLines' | 'replaced'>): Id[] {
  const gone = lockedLines(before).filter(id => !net.hasLine(after.network, id))
  const ids = new Set([...gone, ...lockedLines(after).filter(id => net.hasLine(before.network, id))])
  const deleted = new Set(ch.deletedLines)
  // follow splits: the piece of a split line that still ends at the point
  const forward = (line: Id, point: Id): Id => {
    for (let r = ch.replaced.find(x => x.line === line); r && (r.a === point || r.b === point); r = ch.replaced.find(x => x.line === line)) {
      line = r.a === point ? r.pieces[0] : r.pieces[1]
    }
    return line
  }
  const survives = (point: Id) => net.hasPoint(after.network, point)
  const a = contents(before, ids, deleted, forward, survives), b = contents(after, ids, deleted, (line: Id) => line, survives)
  return [...ids].filter(id => { const x = a.get(id), y = b.get(id); return !x || !y || !same(x, y) }).sort()
}
