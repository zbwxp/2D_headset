// Close / open a path and bind / unbind end nodes (headset-design doc 18 §19.1 items 6–8). STANDALONE, limited,
// same data model as deletePoint (full control points per state and preset; references; fills; connections).
// Every command acts on every state of every preset in one result, or refuses with the dependant named.
//
// 6a addClosingSegment — after Inkscape "join selected end nodes with a new segment" (Alt+J): a new segment from
//    the last anchor to the first. OUR COMMAND SEMANTICS (not claimed to be Inkscape's exact implementation): no
//    existing anchor or handle changes; the new segment uses the stored outer handles of the two ends.
// 6b mergeEnds — Inkscape "join selected nodes" (Shift+J): the two end anchors become one, at their midpoint by
//    default, or at one of them ("you can lock the position of one of the two joined nodes"). Each handle moves
//    with its anchor. The curve becomes a closed loop; the removed anchor must carry no connection.
// 7  removeClosingSegment — the inverse of 6a: a closed loop becomes one open chain starting at the removed
//    segment's end. A reference or fill on that segment is refused (no dangling address).
//    (Opening a merged node = cutting at it: fillBridge.breakAt, already reviewed.)
// 8  bind / unbind — after Inkscape Shift+J between end nodes of two curves: a new connection; positions per
//    state at the midpoint or locked to one end, handles moving with their anchors; unbind removes the
//    connection and leaves positions as they are. An end already in a connection is refused (adding a node to an
//    existing connection group is not supported; moving it would pull its old binding apart).
import { v, type V } from './scenarioE'
import type { Anchor, Curve, Doc, End, Segment } from './deletePoint'

export type Result = { ok: true; doc: Doc } | { ok: false; reason: string }
export type Keep = 'mid' | 'first' | 'second'

const presetsOf = (doc: Doc) => Object.values(doc.presets)
const isClosed = (c: Curve) => c.segments.length > 0 && c.segments[c.segments.length - 1].to === c.segments[0].from
const ends = (c: Curve) => ({ first: c.segments[0].from, last: c.segments[c.segments.length - 1].to })
const shift = (a: Anchor, to: V): Anchor => {
  const dx = to.x - a.p.x, dy = to.y - a.p.y
  return { ...a, p: { ...to }, hIn: v(a.hIn.x + dx, a.hIn.y + dy), hOut: v(a.hOut.x + dx, a.hOut.y + dy) }
}
const target = (a: V, b: V, keep: Keep): V => (keep === 'first' ? { ...a } : keep === 'second' ? { ...b } : v((a.x + b.x) / 2, (a.y + b.y) / 2))
function finite(doc: Doc, curveIds: string[]): string | null {
  for (const [pid, cs] of Object.entries(doc.presets))
    for (const id of curveIds) {
      const c = cs[id]
      if (!c || !c.segments.length) return `curve ${id} missing or empty in preset ${pid}`
      for (const [st, an] of Object.entries(c.states))
        for (const a of Object.values(an)) for (const q of [a.p, a.hIn, a.hOut]) if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) return `non-finite coordinate on ${id}#${a.id} in ${pid}/${st}`
    }
  return null
}
const freshSeg = (doc: Doc, curveId: string, base: string) => {
  const taken = new Set(presetsOf(doc).flatMap((cs) => cs[curveId].segments.map((s) => s.id)))
  let id = base
  let k = 0
  while (taken.has(id)) id = `${base}~${++k}`
  return id
}

export function addClosingSegment(doc: Doc, curveId: string): Result {
  const bad = finite(doc, [curveId])
  if (bad) return { ok: false, reason: bad }
  if (presetsOf(doc).some((cs) => isClosed(cs[curveId]))) return { ok: false, reason: `${curveId} is already closed` }
  const d: Doc = structuredClone(doc)
  const id = freshSeg(d, curveId, 'close')
  for (const cs of presetsOf(d)) {
    const { first, last } = ends(cs[curveId])
    cs[curveId].segments.push({ id, from: last, to: first })
  }
  return { ok: true, doc: d }
}

export function mergeEnds(doc: Doc, curveId: string, keep: Keep = 'mid'): Result {
  const bad = finite(doc, [curveId])
  if (bad) return { ok: false, reason: bad }
  const c0 = presetsOf(doc)[0][curveId]
  if (isClosed(c0)) return { ok: false, reason: `${curveId} is already closed` }
  if (c0.segments.length < 2) return { ok: false, reason: `${curveId} has one segment: merging its ends would make a degenerate loop` }
  const { first, last } = ends(c0)
  // either end in a connection: refused — merging removes the last end and moves the first, which would pull an
  // existing binding apart (dot 1791305159); joining a node into a connection group is not supported here
  const conn = Object.entries(doc.connections).find(([, es]) => es.some((e) => e.curveId === curveId && (e.anchorId === last || e.anchorId === first)))
  if (conn) return { ok: false, reason: `connection ${conn[0]} uses an end of ${curveId}: merging would move or remove it — unbind it first` }
  const d: Doc = structuredClone(doc)
  for (const cs of presetsOf(d)) {
    const c = cs[curveId]
    for (const st of Object.keys(c.states)) {
      const F = c.states[st][first], L = c.states[st][last]
      const at = target(F.p, L.p, keep)
      const f = shift(F, at), l = shift(L, at)
      const merged: Anchor = { id: first, p: at, hIn: l.hIn, hOut: f.hOut } // incoming handle from the last end, outgoing from the first
      const states = { ...c.states[st], [first]: merged }
      delete states[last]
      c.states[st] = states
    }
    c.segments[c.segments.length - 1] = { ...c.segments[c.segments.length - 1], to: first }
  }
  return { ok: true, doc: d }
}

export function removeClosingSegment(doc: Doc, curveId: string, segmentId: string): Result {
  const bad = finite(doc, [curveId])
  if (bad) return { ok: false, reason: bad }
  const c0 = presetsOf(doc)[0][curveId]
  if (!isClosed(c0)) return { ok: false, reason: `${curveId} is not closed` }
  if (!c0.segments.some((s) => s.id === segmentId)) return { ok: false, reason: `segment ${segmentId} not on ${curveId}` }
  if (c0.segments.length < 2) return { ok: false, reason: `${curveId} would be left without segments` }
  const refs = Object.entries(doc.refs).filter(([, r]) => r.curveId === curveId && r.segmentId === segmentId).map(([k]) => k)
  if (refs.length) return { ok: false, reason: `reference ${refs.join(', ')} sits on ${segmentId}: move or remove it first` }
  const fills = Object.entries(doc.fills).filter(([, st]) => st.some((x) => x.curveId === curveId && x.segmentId === segmentId)).map(([k]) => k)
  if (fills.length) return { ok: false, reason: `fill ${fills.join(', ')} uses ${segmentId}: repair or remove it first` }
  const d: Doc = structuredClone(doc)
  for (const cs of presetsOf(d)) {
    const segs = cs[curveId].segments
    const i = segs.findIndex((s) => s.id === segmentId)
    cs[curveId].segments = [...segs.slice(i + 1), ...segs.slice(0, i)] // one open chain starting at the removed segment's end
  }
  return { ok: true, doc: d }
}

export function bind(doc: Doc, a: End, b: End, keep: Keep = 'mid', id = 'k'): Result {
  const bad = finite(doc, [a.curveId, b.curveId])
  if (bad) return { ok: false, reason: bad }
  if (a.curveId === b.curveId) return { ok: false, reason: 'both ends on one curve: use mergeEnds or addClosingSegment' }
  for (const e of [a, b]) {
    const c = presetsOf(doc)[0][e.curveId]
    if (isClosed(c)) return { ok: false, reason: `${e.curveId} is closed: no end node` }
    const { first, last } = ends(c)
    if (e.anchorId !== first && e.anchorId !== last) return { ok: false, reason: `${e.curveId}#${e.anchorId} is not an end node` }
    const conn = Object.entries(doc.connections).find(([, es]) => es.some((x) => x.curveId === e.curveId && x.anchorId === e.anchorId))
    if (conn) return { ok: false, reason: `${e.curveId}#${e.anchorId} is already in connection ${conn[0]}` }
  }
  const stA = Object.keys(presetsOf(doc)[0][a.curveId].states).sort().join()
  const stB = Object.keys(presetsOf(doc)[0][b.curveId].states).sort().join()
  if (stA !== stB) return { ok: false, reason: `${a.curveId} and ${b.curveId} have different state sets: binding needs a position in every state` }
  const d: Doc = structuredClone(doc)
  let cid = id
  for (let k = 1; d.connections[cid]; k++) cid = `${id}~${k}`
  d.connections[cid] = [a, b]
  for (const cs of presetsOf(d))
    for (const st of Object.keys(cs[a.curveId].states)) {
      const A = cs[a.curveId].states[st][a.anchorId], B = cs[b.curveId].states[st][b.anchorId]
      const at = target(A.p, B.p, keep)
      cs[a.curveId].states[st][a.anchorId] = shift(A, at)
      cs[b.curveId].states[st][b.anchorId] = shift(B, at)
    }
  return { ok: true, doc: d }
}

export function unbind(doc: Doc, connectionId: string): Result {
  if (!doc.connections[connectionId]) return { ok: false, reason: `no connection ${connectionId}` }
  const d: Doc = structuredClone(doc)
  delete d.connections[connectionId]
  return { ok: true, doc: d }
}

// ---------- fixture: two open curves U (a → b → c) and W (p → q), two presets × two states ----------
const A = (id: string, x: number, y: number, hi: V, ho: V): Anchor => ({ id, p: v(x, y), hIn: v(x + hi.x, y + hi.y), hOut: v(x + ho.x, y + ho.y) })
export function fixture(): Doc {
  const U = (k: number, dx: number): Curve => ({
    id: 'U',
    segments: [{ id: 's1', from: 'a', to: 'b' }, { id: 's2', from: 'b', to: 'c' }] as Segment[],
    states: {
      front: { a: A('a', -10, 0, v(1, 2), v(2, -3)), b: A('b', 0, -5 * k, v(-4, 0), v(4, 0)), c: A('c', 9, 1, v(-2, -3), v(1, 2.5)) },
      side: { a: A('a', -5 + dx, 0.5, v(0.5, 1), v(1, -2)), b: A('b', dx, -4 * k, v(-2, 0.2), v(2, -0.2)), c: A('c', 4 + dx, 0.8, v(-1, -2), v(0.6, 1.5)) },
    },
  })
  const W = (k: number): Curve => ({
    id: 'W',
    segments: [{ id: 'w1', from: 'p', to: 'q' }],
    states: {
      front: { p: A('p', 11, 3, v(-1, 0), v(2, 2 * k)), q: A('q', 20, 6, v(-2, -1), v(1, 0)) },
      side: { p: A('p', 6, 2, v(-0.5, 0), v(1, 1.5 * k)), q: A('q', 12, 4, v(-1, -1), v(0.5, 0)) },
    },
  })
  return {
    presets: { A: { U: U(1, 0), W: W(1) }, B: { U: U(1.3, 1), W: W(1.2) } },
    refs: { lash: { curveId: 'U', segmentId: 's2', u: 0.5 } },
    fills: {},
    connections: {},
    seq: 0,
  }
}
