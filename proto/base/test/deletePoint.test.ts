// Point deletion (doc 18 §19 items 4a / 4b). Expected values come from the stored data (anchors, handles by id),
// not from the functions under test where avoidable; approximation errors are REPORTED, not hidden.
import { describe, expect, it } from 'vitest'
import { bez, deleteAnchorWithSegments, deviation, fixture, isCusp, removeAnchorJoin, segCubic, Session, type Cubic, type Doc, type Result } from '../src/experiments/deletePoint'

const report: Record<string, unknown>[] = []
const ok = (r: Result) => {
  if (!r.ok) throw new Error(r.reason)
  return r
}
const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === 'object') {
    Object.values(o).forEach(deepFreeze)
    Object.freeze(o)
  }
  return o
}
const each = (d: Doc) => Object.entries(d.presets).flatMap(([pid, cs]) => Object.keys(cs.U.states).map((st) => [pid, st] as const))

describe('4a remove anchor and join', () => {
  it('smooth node: one segment replaces two in every preset and state; untouched data identical; error reported', () => {
    const d0 = fixture()
    const r = ok(removeAnchorJoin(d0, 'U', 'b'))
    for (const [pid, st] of each(r.doc)) {
      const c = r.doc.presets[pid].U
      const o = d0.presets[pid].U.states[st]
      expect(c.states[st].b).toBeUndefined()
      expect(c.segments.map((s) => s.id)).toEqual(['s1+s2', 's3', 's4'])
      // end positions and their far handles kept; c, d, e untouched
      expect(c.states[st].a.p).toEqual(o.a.p)
      expect(c.states[st].a.hIn).toEqual(o.a.hIn)
      expect(c.states[st].c.p).toEqual(o.c.p)
      expect(c.states[st].c.hOut).toEqual(o.c.hOut)
      for (const id of ['d', 'e']) expect(c.states[st][id]).toEqual(o[id])
      // smooth fit keeps both end tangent directions
      const cross = (p: { x: number; y: number }, q: { x: number; y: number }) => p.x * q.y - p.y * q.x
      const sub = (p: { x: number; y: number }, q: { x: number; y: number }) => ({ x: p.x - q.x, y: p.y - q.y })
      expect(Math.abs(cross(sub(c.states[st].a.hOut, o.a.p), sub(o.a.hOut, o.a.p)))).toBeLessThan(1e-9)
      expect(Math.abs(cross(sub(c.states[st].c.hIn, o.c.p), sub(o.c.hIn, o.c.p)))).toBeLessThan(1e-9)
      // compare with simply keeping the old neighbour handles
      const old: Cubic[] = [segCubic(d0.presets[pid].U, st, 's1'), segCubic(d0.presets[pid].U, st, 's2')]
      const naive = deviation(old, [o.a.p, o.a.hOut, o.c.hIn, o.c.p])
      expect(r.errors[`${pid}/${st}`]).toBeLessThanOrEqual(naive + 1e-9)
      report.push({ case: '4a smooth b', at: `${pid}/${st}`, fitError: +r.errors[`${pid}/${st}`].toFixed(4), keepHandlesError: +naive.toFixed(4) })
    }
  })

  it('smooth node created by an exact split is removed back to the original curve', () => {
    // split s3 of the front state at u = 0.37 by de Casteljau by hand, then remove the new anchor
    const d0 = fixture()
    const d = structuredClone(d0)
    for (const [pid, st] of each(d)) {
      const c = d.presets[pid].U
      const [p0, p1, p2, p3] = segCubic(d0.presets[pid].U, st, 's3')
      const L = (a: typeof p0, b: typeof p0, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      const u = 0.37
      const p01 = L(p0, p1, u), p12 = L(p1, p2, u), p23 = L(p2, p3, u), p012 = L(p01, p12, u), p123 = L(p12, p23, u), m = L(p012, p123, u)
      c.states[st] = { ...c.states[st], c: { ...c.states[st].c, hOut: p01 }, m: { id: 'm', hIn: p012, p: m, hOut: p123 }, d: { ...c.states[st].d, hIn: p23 } }
    }
    for (const cs of Object.values(d.presets)) cs.U.segments.splice(2, 1, { id: 's3a', from: 'c', to: 'm' }, { id: 's3b', from: 'm', to: 'd' })
    const r = ok(removeAnchorJoin(d, 'U', 'm'))
    let worstHandle = 0
    for (const [pid, st] of each(r.doc)) {
      const o = d0.presets[pid].U.states[st]
      const n = r.doc.presets[pid].U.states[st]
      worstHandle = Math.max(worstHandle, Math.hypot(n.c.hOut.x - o.c.hOut.x, n.c.hOut.y - o.c.hOut.y), Math.hypot(n.d.hIn.x - o.d.hIn.x, n.d.hIn.y - o.d.hIn.y))
    }
    const worstShape = Math.max(...Object.values(r.errors))
    report.push({ case: '4a split-then-remove', worstHandleDrift: worstHandle, worstShapeError: worstShape })
    expect(worstShape).toBeLessThan(1e-9)
    expect(worstHandle).toBeLessThan(1e-9)
  })

  it('sharp corner keeps the neighbouring handles exactly; straight variant gives a straight segment', () => {
    const d0 = fixture()
    const sharp = ok(removeAnchorJoin(d0, 'U', 'c'))
    const straight = ok(removeAnchorJoin(d0, 'U', 'b', 'straight'))
    const cuspIn: string[] = []
    for (const [pid, st] of each(d0)) {
      const o = d0.presets[pid].U.states[st]
      // node type is not stored (§17: deferred to rendering), so sharpness is read from each state's geometry
      if (isCusp(o.c)) {
        cuspIn.push(`${pid}/${st}`)
        expect(sharp.doc.presets[pid].U.states[st].b.hOut).toEqual(o.b.hOut)
        expect(sharp.doc.presets[pid].U.states[st].d.hIn).toEqual(o.d.hIn)
      }
      const q = segCubic(straight.doc.presets[pid].U, st, 's1+s2')
      for (let i = 0; i <= 10; i++) {
        const p = bez(q, i / 10)
        expect(Math.abs((p.x - o.a.p.x) * (o.c.p.y - o.a.p.y) - (p.y - o.a.p.y) * (o.c.p.x - o.a.p.x))).toBeLessThan(1e-9)
      }
    }
    report.push({ case: '4a sharp c', cuspIn, worstError: +Math.max(...Object.values(sharp.errors)).toFixed(4) }, { case: '4a straight b', worstError: +Math.max(...Object.values(straight.errors)).toFixed(4) })
  })

  it('references on either removed segment move onto the joined one (movement reported); others untouched', () => {
    const r = ok(removeAnchorJoin(fixture(), 'U', 'b'))
    expect(r.doc.refs.intervalStart.segmentId).toBe('s1+s2')
    expect(r.doc.refs.lash.segmentId).toBe('s1+s2')
    expect(r.doc.refs.intervalStart.u).toBeLessThan(r.doc.refs.lash.u) // order along the curve kept
    expect(r.doc.refs.intervalEnd).toEqual(fixture().refs.intervalEnd)
    report.push({ case: '4a refs', moves: Object.fromEntries(Object.entries(r.refMoves).map(([k, x]) => [k, +x.toFixed(4)])) })
  })

  it('fills: forward, reversed and wrap-around boundaries get the joined segment in order; partial use refused', () => {
    const base = fixture()
    const F = (ids: string[], dir: 1 | -1) => ids.map((segmentId) => ({ curveId: 'U', segmentId, dir }))
    base.fills = { fwd: F(['s1', 's2', 's3', 's4'], 1), rev: F(['s4', 's3', 's2', 's1'], -1), wrap: F(['s2', 's3', 's4', 's1'], 1) }
    const r = ok(removeAnchorJoin(base, 'U', 'b'))
    const ids = (k: string) => r.doc.fills[k].map((s) => `${s.segmentId}${s.dir === 1 ? '+' : '-'}`)
    expect(ids('fwd')).toEqual(['s1+s2+', 's3+', 's4+'])
    expect(ids('rev')).toEqual(['s4-', 's3-', 's1+s2-'])
    expect(ids('wrap')).toEqual(['s3+', 's4+', 's1+s2+']) // same cyclic order as s1 s2 s3 s4
    const partial = fixture()
    partial.fills = { part: F(['s2', 's3'], 1) }
    const rr = removeAnchorJoin(partial, 'U', 'b')
    expect(rr.ok).toBe(false)
    if (!rr.ok) expect(rr.reason).toContain('fill part')
    report.push({ case: '4a fills', fwd: ids('fwd'), rev: ids('rev'), wrap: ids('wrap'), partialRefused: !rr.ok })
  })

  it('refusals: end node, connection on the anchor, missing curve / anchor, non-finite data; input unchanged', () => {
    const d = fixture()
    d.connections = { k1: [{ curveId: 'U', anchorId: 'b' }, { curveId: 'X', anchorId: 'q' }] }
    deepFreeze(d)
    const before = JSON.stringify(d)
    const cases = {
      end: removeAnchorJoin(d, 'U', 'a'),
      connection: removeAnchorJoin(d, 'U', 'b'),
      noCurve: removeAnchorJoin(d, 'Z', 'b'),
      noAnchor: removeAnchorJoin(d, 'U', 'zz'),
    }
    const nan = structuredClone(d)
    nan.presets.B.U.states['90|open'].e.hIn.x = Number.NaN
    const all = { ...cases, nonFinite: removeAnchorJoin(nan, 'U', 'c') }
    for (const r of Object.values(all)) expect(r.ok).toBe(false)
    expect(all.connection.ok === false && all.connection.reason).toContain('connection k1')
    expect(JSON.stringify(d)).toBe(before)
    // a frozen input still works for a legal deletion
    expect(removeAnchorJoin(d, 'U', 'c').ok).toBe(true)
    report.push({ case: '4a refusals', reasons: Object.fromEntries(Object.entries(all).map(([k, r]) => [k, r.ok ? 'ok' : r.reason])) })
  })
})

describe('4b delete anchor with its segments', () => {
  it('interior anchor: two open curves, anchors partitioned, data identical; refs / fills / connections follow', () => {
    const d0 = fixture()
    delete d0.refs.lash // a reference on a removed segment is refused (tested below)
    d0.connections = { tail: [{ curveId: 'U', anchorId: 'e' }, { curveId: 'X', anchorId: 'q' }] }
    d0.fills = { tailFill: [{ curveId: 'U', segmentId: 's4', dir: 1 }] }
    const r = ok(deleteAnchorWithSegments(d0, 'U', 'c'))
    expect(r.doc.seq).toBe(1)
    for (const [pid, st] of each(d0)) {
      const U = r.doc.presets[pid].U
      const V2 = r.doc.presets[pid]['U~1']
      expect(U.segments.map((s) => s.id)).toEqual(['s1'])
      expect(V2.segments.map((s) => s.id)).toEqual(['s4'])
      expect(Object.keys(U.states[st]).sort()).toEqual(['a', 'b'])
      expect(Object.keys(V2.states[st]).sort()).toEqual(['d', 'e'])
      for (const id of ['a', 'b']) expect(U.states[st][id]).toEqual(d0.presets[pid].U.states[st][id])
      for (const id of ['d', 'e']) expect(V2.states[st][id]).toEqual(d0.presets[pid].U.states[st][id])
    }
    expect(r.doc.refs.intervalStart.curveId).toBe('U')
    expect(r.doc.refs.intervalEnd.curveId).toBe('U~1')
    expect(r.doc.fills.tailFill[0].curveId).toBe('U~1')
    expect(r.doc.connections.tail[0].curveId).toBe('U~1')
    report.push({ case: '4b interior c', curves: Object.keys(r.doc.presets.A), refs: r.doc.refs, conn: r.doc.connections.tail[0] })
  })

  it('end anchor shortens the curve without a new curve; last segment refused', () => {
    const d0 = fixture()
    delete d0.refs.intervalStart
    const r = ok(deleteAnchorWithSegments(d0, 'U', 'a'))
    expect(r.doc.seq).toBe(0)
    expect(Object.keys(r.doc.presets.A)).toEqual(['U'])
    expect(r.doc.presets.A.U.segments.map((s) => s.id)).toEqual(['s2', 's3', 's4'])
    const single = structuredClone(r.doc)
    for (const cs of Object.values(single.presets)) cs.U.segments = cs.U.segments.slice(0, 1)
    single.refs = {}
    const rr = deleteAnchorWithSegments(single, 'U', 'b')
    expect(rr.ok).toBe(false)
    report.push({ case: '4b end a', segments: r.doc.presets.A.U.segments.map((s) => s.id), lastSegmentRefused: !rr.ok })
  })

  it('refusals name the dependant: reference, fill, connection on the anchor or on an orphaned end', () => {
    const d = deepFreeze(fixture())
    const ref = deleteAnchorWithSegments(d, 'U', 'c')
    const f = structuredClone(d)
    delete f.refs.lash
    f.fills = { G: [{ curveId: 'U', segmentId: 's3', dir: 1 }] }
    const fill = deleteAnchorWithSegments(f, 'U', 'c')
    const c = structuredClone(d)
    c.refs = {}
    c.connections = { k: [{ curveId: 'U', anchorId: 'c' }, { curveId: 'X', anchorId: 'q' }] }
    const conn = deleteAnchorWithSegments(c, 'U', 'c')
    // deleting b with both its segments leaves a without segments: a connection on a would dangle
    const o = structuredClone(d)
    o.refs = {}
    o.connections = { k: [{ curveId: 'U', anchorId: 'a' }, { curveId: 'X', anchorId: 'q' }] }
    const orphan = deleteAnchorWithSegments(o, 'U', 'b')
    const reasons = { ref, fill, conn, orphan }
    for (const r of Object.values(reasons)) expect(r.ok).toBe(false)
    expect(!ref.ok && ref.reason).toContain('lash')
    expect(!fill.ok && fill.reason).toContain('fill G')
    expect(!conn.ok && conn.reason).toContain('connection k')
    expect(!orphan.ok && orphan.reason).toContain('connection k')
    report.push({ case: '4b refusals', reasons: Object.fromEntries(Object.entries(reasons).map(([k, r]) => [k, r.ok ? 'ok' : r.reason])) })
  })
})

describe('session', () => {
  it('direct edits undo / redo exactly and survive JSON save / reopen', () => {
    const s = new Session(fixture())
    const start = JSON.stringify(s.doc)
    expect(s.apply(removeAnchorJoin(s.doc, 'U', 'b'))).toBe(true)
    const d2 = structuredClone(s.doc)
    delete d2.refs.intervalEnd
    expect(s.apply({ ok: true, doc: d2, errors: {}, refMoves: {} })).toBe(true) // the user removes a reference first
    expect(s.apply(deleteAnchorWithSegments(s.doc, 'U', 'd'))).toBe(true)
    const end = JSON.stringify(s.doc)
    expect(s.apply(removeAnchorJoin(s.doc, 'U', 'a'))).toBe(false) // refused: nothing recorded
    expect(s.undo()).toBe(true)
    expect(s.undo()).toBe(true)
    expect(s.undo()).toBe(true)
    expect(s.undo()).toBe(false)
    expect(JSON.stringify(s.doc)).toBe(start)
    expect(s.redo()).toBe(true)
    expect(s.redo()).toBe(true)
    expect(s.redo()).toBe(true)
    expect(JSON.stringify(s.doc)).toBe(end)
    expect(JSON.parse(end)).toEqual(s.doc)
  })

  it('prints the table', () => {
    console.log('[deletePoint]\n' + report.map((r) => JSON.stringify(r)).join('\n'))
  })
})
