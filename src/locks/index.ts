// locks — a lock protects what an element owns alone, wherever a change comes from;
// what it shares with other elements is not under its lock (bowen 1791462692,
// 1791462918). Deleting an unlocked element is always allowed, with whatever goes
// with it (bowen 1791460893, 甲).
//
// What a line owns alone:
// - its shape: the positions of its two end points and its two handles;
// - its stroke (width, profile);
// - the end stroke shown at a free end (no other line, no link: the end is its own).
// Shared, so not under the line's lock: the joins, arcs and joins across a link at
// its end points, which belong to the line and its neighbour together.
//
// This module checks, at commit, every change that reaches a locked line, direct
// or passed on (a dragged shared point, a smooth spring turning its handle, a link
// pulling its end). The other lock rules act at the operation, each for its own
// reason (dot 1791462523):
// - a locked fill's colour cannot be changed or cleared (fills); a locked fill may
//   vanish with its loop (Q30 甲);
// - a group holding any locked element cannot be cut and pasted (document.moveGroup);
// - batches (group width, layer delete) act on unlocked members only (document).
// The check is on the result: no line locked when the edit ends may differ from
// before it, and a locked line may not disappear (dot 1791459661).
import * as net from '../network'
import * as joins from '../joins'
import * as links from '../links'

type Id = net.Id

export interface View { network: net.NetworkState; joins: joins.JoinsState; links: links.LinksState }

/**
 * Whether an end is free must leave out what went with a delete (甲): a neighbour
 * the user deleted (a split neighbour counts by its piece at that point), and a link
 * partner that disappeared.
 */
interface Gone { line(line: Id, point: Id): boolean; partner(point: Id): boolean }

function gone(after: View, ch: Pick<net.Changes, 'deletedLines' | 'replaced'>): Gone {
  const deleted = new Set(ch.deletedLines)
  // follow splits: the piece of a split line that still ends at the point
  const forward = (line: Id, point: Id): Id => {
    for (let r = ch.replaced.find(x => x.line === line); r && (r.a === point || r.b === point); r = ch.replaced.find(x => x.line === line)) {
      line = r.a === point ? r.pieces[0] : r.pieces[1]
    }
    return line
  }
  return { line: (line, point) => deleted.has(forward(line, point)), partner: point => !net.hasPoint(after.network, point) }
}

/** What the line owns alone, in one form. */
function owned(v: View, id: Id, g: Gone): string | undefined {
  if (!net.hasLine(v.network, id)) return undefined
  const l = net.line(v.network, id)
  const freeEnd = (point: Id) => {
    const others = net.linesAt(v.network, point).filter(e => e.line.id !== id && !g.line(e.line.id, point))
    const free = !others.length && !links.partners(v.links, point).filter(p => !g.partner(p)).length
    return free ? joins.endStroke(v.joins, v.network, point) ?? {} : {}
  }
  const pos = (p: Id) => net.point(v.network, p).position
  return JSON.stringify([pos(l.a), pos(l.b), l.ha, l.hb, l.stroke, freeEnd(l.a), freeEnd(l.b)])
}

const lockedLines = (v: View) => net.lines(v.network).filter(l => l.state.locked).map(l => l.id)

/**
 * Lines locked in the result whose own content differs from before the edit. A
 * line that did not exist before (drawn, or copied with its lock) has nothing
 * earlier to protect; a line locked before and gone now has changed.
 * `ch`: the lines the user deleted in this edit, and the splits made in it.
 */
export function changed(
  before: View, after: View, ch: Pick<net.Changes, 'deletedLines' | 'replaced' | 'appliedLocks'>,
  /** For a line an apply locked in this edit: the state right after that apply. */
  appliedFrom: ReadonlyMap<Id, View> = new Map(),
): Id[] {
  // A lock an apply copied protects from the moment of that apply: only the apply's
  // own change is let through, and the target's content is compared with the state
  // right after it (net.applyLineState; dot, review of 44c58b4).
  const applied = new Set(ch.appliedLocks)
  const ids = new Set([
    ...lockedLines(before).filter(id => !net.hasLine(after.network, id)),
    ...lockedLines(after).filter(id => net.hasLine(before.network, id) && !applied.has(id)),
  ])
  const g = gone(after, ch), none: Gone = { line: () => false, partner: () => false }
  const out = [...ids].filter(id => { const x = owned(before, id, g), y = owned(after, id, none); return !x || !y || x !== y })
  // Protected from the moment the lock arrived (an apply or a paste): it may not disappear
  // afterwards, deleted or split, and its own content is compared with the state then.
  // Only a real unlock in this edit ends that protection (dot 1791514309).
  for (const [id, from] of appliedFrom) {
    if (!net.hasLine(after.network, id)) { out.push(id); continue }
    if (!lockedLines(after).includes(id)) continue
    const x = owned(from, id, g), y = owned(after, id, none)
    if (!x || !y || x !== y) out.push(id)
  }
  return [...new Set(out)].sort()
}
