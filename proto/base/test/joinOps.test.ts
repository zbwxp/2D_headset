// Close / open / bind / unbind (doc 18 §19.1 items 6–8). Expected values come from the stored data.
import { describe, expect, it } from 'vitest'
import { addClosingSegment, bind, fixture, mergeEnds, removeClosingSegment, unbind, type Result } from '../src/experiments/joinOps'
import { segCubic, type Doc } from '../src/experiments/deletePoint'

const report: Record<string, unknown>[] = []
const ok = (r: Result) => {
  if (!r.ok) throw new Error(r.reason)
  return r.doc
}
const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === 'object') {
    Object.values(o).forEach(deepFreeze)
    Object.freeze(o)
  }
  return o
}
const each = (d: Doc, curve: string) => Object.entries(d.presets).flatMap(([pid, cs]) => Object.keys(cs[curve].states).map((st) => [pid, st] as const))
const sub = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: a.x - b.x, y: a.y - b.y })
const close = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-12

describe('close / open', () => {
  it('add closing segment: c → a in every preset and state, nothing else changes; removing it restores the document', () => {
    const d0 = deepFreeze(fixture())
    const d = ok(addClosingSegment(d0, 'U'))
    for (const cs of Object.values(d.presets)) expect(cs.U.segments.map((s) => `${s.id}:${s.from}>${s.to}`)).toEqual(['s1:a>b', 's2:b>c', 'close:c>a'])
    for (const [pid, st] of each(d, 'U')) expect(d.presets[pid].U.states[st]).toEqual(d0.presets[pid].U.states[st])
    expect(d.refs).toEqual(d0.refs)
    expect(addClosingSegment(d, 'U').ok).toBe(false) // already closed
    expect(JSON.stringify(ok(removeClosingSegment(d, 'U', 'close')))).toBe(JSON.stringify(d0))
    report.push({ case: 'add closing segment', segments: d.presets.A.U.segments.map((s) => s.id) })
  })

  it('remove a segment of a loop: one open chain starting at its end; reference / fill on it refused', () => {
    const loop = ok(addClosingSegment(fixture(), 'U'))
    const open = ok(removeClosingSegment(loop, 'U', 's1'))
    expect(open.presets.B.U.segments.map((s) => s.id)).toEqual(['s2', 'close']) // starts at b, ends at a
    expect(open.refs.lash).toEqual(loop.refs.lash)
    const withRef = removeClosingSegment(loop, 'U', 's2')
    expect(withRef.ok === false && withRef.reason).toContain('lash')
    const f = structuredClone(loop)
    f.fills = { F: [{ curveId: 'U', segmentId: 's1', dir: 1 }] }
    const withFill = removeClosingSegment(f, 'U', 's1')
    expect(withFill.ok === false && withFill.reason).toContain('fill F')
    expect(removeClosingSegment(fixture(), 'U', 's1').ok).toBe(false) // not closed
    report.push({ case: 'open loop', chain: open.presets.B.U.segments.map((s) => s.id) })
  })

  it('merge ends: one anchor at the midpoint (or locked to one end), handles move with their anchors, the loop is closed', () => {
    const d0 = fixture()
    const mid = ok(mergeEnds(d0, 'U'))
    for (const [pid, st] of each(d0, 'U')) {
      const o = d0.presets[pid].U.states[st]
      const n = mid.presets[pid].U.states[st]
      const at = { x: (o.a.p.x + o.c.p.x) / 2, y: (o.a.p.y + o.c.p.y) / 2 }
      expect(n.c).toBeUndefined()
      expect(close(n.a.p, at)).toBe(true)
      expect(close(sub(n.a.hOut, n.a.p), sub(o.a.hOut, o.a.p))).toBe(true) // outgoing handle from the first end, same offset
      expect(close(sub(n.a.hIn, n.a.p), sub(o.c.hIn, o.c.p))).toBe(true) // incoming handle from the last end, same offset
      expect(n.b).toEqual(o.b)
      const s2 = segCubic(mid.presets[pid].U, st, 's2')
      expect(s2[1]).toEqual(o.b.hOut)
      expect(close(s2[3], at)).toBe(true)
    }
    expect(mid.presets.A.U.segments.at(-1)!.to).toBe('a')
    const first = ok(mergeEnds(d0, 'U', 'first'))
    for (const [pid, st] of each(d0, 'U')) {
      expect(first.presets[pid].U.states[st].a.p).toEqual(d0.presets[pid].U.states[st].a.p)
      expect(first.presets[pid].U.states[st].a.hOut).toEqual(d0.presets[pid].U.states[st].a.hOut)
    }
    expect(mergeEnds(mid, 'U').ok).toBe(false) // already closed
    expect(mergeEnds(d0, 'W').ok).toBe(false) // one segment
    const c = structuredClone(d0)
    c.connections = { k: [{ curveId: 'U', anchorId: 'c' }, { curveId: 'W', anchorId: 'p' }] }
    const r = mergeEnds(c, 'U')
    expect(r.ok === false && r.reason).toContain('connection k')
    // the FIRST end bound elsewhere: merging would move it and pull the binding apart → refused, for every keep mode
    const f = structuredClone(d0)
    f.connections = { k2: [{ curveId: 'U', anchorId: 'a' }, { curveId: 'W', anchorId: 'q' }] }
    for (const keep of ['mid', 'first', 'second'] as const) expect(mergeEnds(f, 'U', keep).ok).toBe(false)
    report.push({ case: 'merge ends', refusedOnConnection: !r.ok })
  })
})

describe('bind / unbind', () => {
  it('bind: both ends meet at the midpoint in every preset and state, handles follow; locking keeps one end exactly; unbind keeps positions', () => {
    const d0 = deepFreeze(fixture())
    const a = { curveId: 'U', anchorId: 'c' }, b = { curveId: 'W', anchorId: 'p' }
    const m = ok(bind(d0, a, b))
    expect(m.connections.k).toEqual([a, b])
    let worst = 0
    for (const [pid, st] of each(d0, 'U')) {
      const oc = d0.presets[pid].U.states[st].c, op = d0.presets[pid].W.states[st].p
      const nc = m.presets[pid].U.states[st].c, np = m.presets[pid].W.states[st].p
      const at = { x: (oc.p.x + op.p.x) / 2, y: (oc.p.y + op.p.y) / 2 }
      expect(close(nc.p, at) && close(np.p, at)).toBe(true)
      for (const [n, o] of [[nc, oc], [np, op]] as const) {
        expect(close(sub(n.hIn, n.p), sub(o.hIn, o.p))).toBe(true)
        expect(close(sub(n.hOut, n.p), sub(o.hOut, o.p))).toBe(true)
      }
      expect(m.presets[pid].U.states[st].a).toEqual(d0.presets[pid].U.states[st].a)
      expect(m.presets[pid].W.states[st].q).toEqual(d0.presets[pid].W.states[st].q)
      worst = Math.max(worst, Math.hypot(nc.p.x - np.p.x, nc.p.y - np.p.y))
    }
    const locked = ok(bind(d0, a, b, 'second'))
    for (const [pid, st] of each(d0, 'W')) expect(locked.presets[pid].W.states[st]).toEqual(d0.presets[pid].W.states[st]) // W untouched
    // the stored addresses are copies: mutating the caller's arguments afterwards does not touch the document
    const a2 = { curveId: 'U', anchorId: 'c' }, b2 = { curveId: 'W', anchorId: 'p' }
    const m2 = ok(bind(d0, a2, b2))
    a2.anchorId = 'a'
    b2.curveId = 'X'
    expect(m2.connections.k).toEqual([{ curveId: 'U', anchorId: 'c' }, { curveId: 'W', anchorId: 'p' }])
    const un = ok(unbind(m, 'k'))
    expect(un.connections).toEqual({})
    expect(un.presets).toEqual(m.presets)
    report.push({ case: 'bind', worstGap: worst })
  })

  it('refusals: interior node, same curve, already bound, missing connection, non-finite; input unchanged', () => {
    const d = deepFreeze(fixture())
    const before = JSON.stringify(d)
    const bound = ok(bind(d, { curveId: 'U', anchorId: 'c' }, { curveId: 'W', anchorId: 'p' }))
    const nan = structuredClone(d)
    nan.presets.B.W.states.side.q.hIn.y = Number.POSITIVE_INFINITY
    const cases = {
      interior: bind(d, { curveId: 'U', anchorId: 'b' }, { curveId: 'W', anchorId: 'p' }),
      sameCurve: bind(d, { curveId: 'U', anchorId: 'a' }, { curveId: 'U', anchorId: 'c' }),
      alreadyBound: bind(bound, { curveId: 'U', anchorId: 'c' }, { curveId: 'W', anchorId: 'q' }),
      otherEndBound: bind(bound, { curveId: 'W', anchorId: 'q' }, { curveId: 'U', anchorId: 'a' }), // fine: neither is bound
      partnerBound: bind(bound, { curveId: 'U', anchorId: 'a' }, { curveId: 'W', anchorId: 'p' }), // W#p already bound
      noConnection: unbind(d, 'zz'),
      nonFinite: bind(nan, { curveId: 'U', anchorId: 'c' }, { curveId: 'W', anchorId: 'p' }),
    }
    const { otherEndBound, ...refused } = cases
    expect(otherEndBound.ok).toBe(true)
    if (otherEndBound.ok) expect(otherEndBound.doc.presets.A.U.states.front.c).toEqual(bound.presets.A.U.states.front.c) // old binding not pulled apart
    for (const r of Object.values(refused)) expect(r.ok).toBe(false)
    expect(JSON.stringify(d)).toBe(before)
    report.push({ case: 'refusals', reasons: Object.fromEntries(Object.entries(cases).map(([k, r]) => [k, r.ok ? 'ok' : r.reason])) })
  })

  it('prints the table', () => {
    console.log('[joinOps]\n' + report.map((r) => JSON.stringify(r)).join('\n'))
  })
})
