// locks — a locked element cannot be edited (Q29, Q31). One idea: decide what a
// locked element protects, then check whether this edit changed it. The only
// exception is what goes with a deleted unlocked element (bowen 1791460893, 甲:
// deleting is always allowed; a lock only blocks edits).
//
// This module checks the indirect effects of an edit at commit, by comparing each
// locked line before and after. The other lock rules act at the operation, each for
// its own reason (dot 1791462523), and are not duplicated here:
// - a locked fill's colour cannot be changed or cleared (fills); a locked fill may
//   vanish with its loop (Q30 甲);
// - a group holding any locked element cannot be cut and pasted (document.moveGroup);
// - batches (group width, layer delete) act on unlocked members only (document).
//
// The comparison has three parts, kept apart below:
// 1. Reference mapping: name the "before" state in "after" terms. A line that was
//    split is its piece at that point; whatever involves a line the user deleted,
//    or a link partner that disappeared, is left out (甲).
// 2. Equal representation: one form for one relation, so a different spelling of
//    the same thing never counts as a change (pairs sorted, arcs oriented by the
//    pair, rows sorted).
// 3. Protected content of a locked line (bowen 1791434101, 1791459836):
//    - its own curve: end points (ids and positions) and handles;
//    - its stroke (width, profile);
//    - at each end, the end stroke that is drawn: the point's end stroke if the end
//      is free (no other line, no link), nothing if it is shared;
//    - at each end point, the joins (same-point and across a link) and the arcs
//      drawn there, read from derived. A join is an attribute of the point, and the
//      point belongs to the line. Binding another line onto the point adds no join.
//    The line's drawn (trimmed) curve follows from its own curve and the arc joins
//    at its ends, so it needs no separate comparison.
// The check is on the result: no line locked when the edit ends may differ from
// before it, and a locked line may not disappear (dot 1791459661).
import * as net from '../network'
import * as joins from '../joins'
import * as links from '../links'
import * as derived from '../derived'
import type { Cubic } from '../geometry'

type Id = net.Id

export interface View { network: net.NetworkState; joins: joins.JoinsState; links: links.LinksState }

// ---- 1. reference mapping ------------------------------------------------

/** How names in one state read in the "after" state. */
interface Mapping {
  /** The line's name after the edit, as seen from the given end point. */
  name(line: Id, point: Id): Id
  /** The user deleted this line (named after the edit) in this edit. */
  deleted(line: Id): boolean
  /** This point still exists after the edit. */
  survives(point: Id): boolean
}

function mappings(after: View, ch: Pick<net.Changes, 'deletedLines' | 'replaced'>): { before: Mapping; after: Mapping } {
  const deleted = new Set(ch.deletedLines)
  const survives = (point: Id) => net.hasPoint(after.network, point)
  // follow splits: the piece of a split line that still ends at the point
  const forward = (line: Id, point: Id): Id => {
    for (let r = ch.replaced.find(x => x.line === line); r && (r.a === point || r.b === point); r = ch.replaced.find(x => x.line === line)) {
      line = r.a === point ? r.pieces[0] : r.pieces[1]
    }
    return line
  }
  const base = { deleted: (line: Id) => deleted.has(line), survives }
  return { before: { ...base, name: forward }, after: { ...base, name: line => line } }
}

// ---- 2. equal representation ---------------------------------------------

const byJson = <T,>(x: T, y: T) => (JSON.stringify(x) < JSON.stringify(y) ? -1 : 1)
const reverse = (c: Cubic): Cubic => [c[3], c[2], c[1], c[0]]
/** The two lines of a join, named after the edit, in one order. */
const linePair = (m: Mapping, point: Id, lines: readonly Id[]) => lines.map(x => m.name(x, point)).sort() as [Id, Id]
/** An arc is drawn from its first line to its second; orient it by the pair as named now (dot 1791461356). */
function arcForm(m: Mapping, arc: { point: Id; lines: [Id, Id]; curve: Cubic }) {
  const lines = linePair(m, arc.point, arc.lines)
  return { point: arc.point, lines, curve: m.name(arc.lines[0], arc.point) === lines[0] ? arc.curve : reverse(arc.curve) }
}

// ---- 3. protected content ------------------------------------------------

interface Content { own: string; stroke: net.Stroke; ends: [string, string]; joins: string; arcs: { lines: [Id, Id]; point: Id; curve: Cubic }[] }

function contents(v: View, ids: Set<Id>, m: Mapping): Map<Id, Content> {
  const out = new Map<Id, Content>()
  if (!ids.size) return out
  const drawn = derived.drawn(v.network, v.joins)
  const kept = (lines: readonly Id[]) => lines.every(x => !m.deleted(x))
  const drawnEnd = (line: Id, point: Id) => {
    const others = net.linesAt(v.network, point).filter(e => e.line.id !== line && !m.deleted(m.name(e.line.id, point)))
    const free = !others.length && !links.partners(v.links, point).filter(m.survives).length
    return JSON.stringify((free && joins.endStroke(v.joins, point)) || {})
  }
  for (const id of ids) {
    if (!net.hasLine(v.network, id)) continue
    const l = net.line(v.network, id)
    const at = (point: Id) => point === l.a || point === l.b
    const pos = (p: Id) => net.point(v.network, p).position
    out.set(id, {
      own: JSON.stringify([l.a, l.b, pos(l.a), pos(l.b), l.ha, l.hb]),
      stroke: l.stroke,
      ends: [drawnEnd(id, l.a), drawnEnd(id, l.b)],
      joins: JSON.stringify([
        joins.rows(v.joins).filter(r => at(r.point)).map(r => ({ ...r, lines: linePair(m, r.point, r.lines) })).filter(r => kept(r.lines)).sort(byJson),
        links.joins(v.links).filter(x => at(x.a) || at(x.b)).map(x => ({ ...x, lines: [m.name(x.lines[0], x.a), m.name(x.lines[1], x.b)] })).filter(x => kept(x.lines)),
      ]),
      arcs: drawn.arcs.filter(a => at(a.point)).map(a => arcForm(m, a)).filter(a => kept(a.lines)).sort((x, y) => byJson([x.point, x.lines], [y.point, y.lines])),
    })
  }
  return out
}

const near = (a: Cubic, b: Cubic) => a.every((p, i) => Math.abs(p.x - b[i]!.x) < 1e-9 && Math.abs(p.y - b[i]!.y) < 1e-9)
const same = (a: Content, b: Content) =>
  a.own === b.own && a.stroke.width === b.stroke.width && a.stroke.profile === b.stroke.profile && a.ends[0] === b.ends[0] && a.ends[1] === b.ends[1] &&
  a.joins === b.joins && a.arcs.length === b.arcs.length &&
  a.arcs.every((x, i) => { const y = b.arcs[i]!; return x.point === y.point && x.lines[0] === y.lines[0] && x.lines[1] === y.lines[1] && near(x.curve, y.curve) })

const lockedLines = (v: View) => net.lines(v.network).filter(l => l.state.locked).map(l => l.id)

/**
 * Lines locked in the result whose protected content differs from before the
 * edit. A line that did not exist before (drawn, or copied with its lock) has no
 * earlier content to protect; a line locked before and gone now has changed.
 * `ch`: the lines the user deleted in this edit, and the splits made in it.
 */
export function changed(before: View, after: View, ch: Pick<net.Changes, 'deletedLines' | 'replaced'>): Id[] {
  const gone = lockedLines(before).filter(id => !net.hasLine(after.network, id))
  const ids = new Set([...gone, ...lockedLines(after).filter(id => net.hasLine(before.network, id))])
  const m = mappings(after, ch)
  const a = contents(before, ids, m.before), b = contents(after, ids, m.after)
  return [...ids].filter(id => { const x = a.get(id), y = b.get(id); return !x || !y || !same(x, y) }).sort()
}
