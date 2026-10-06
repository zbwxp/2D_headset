// Exact point insertion (doc 18 §19 item 3). Expected values are computed independently in this file
// (own de Casteljau, own arithmetic); the module's functions are only the thing under test.
import { describe, expect, it } from 'vitest'
import { bez, fixture, insertPoint, segCubic, transfer, type Anchor, type Cubic, type Doc } from '../src/experiments/insertPoint'
import type { V } from '../src/experiments/scenarioE'

const P = (x: number, y: number): V => ({ x, y })
const L = (a: V, b: V, t: number) => P(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
/** independent de Casteljau: the point at t on the cubic */
const at = (q: Cubic, t: number): V => {
  const a = L(q[0], q[1], t), b = L(q[1], q[2], t), c = L(q[2], q[3], t)
  return L(L(a, b, t), L(b, c, t), t)
}
const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y)
const US = 0.4
const report: Record<string, unknown>[] = []

describe('exact point insertion', () => {
  const before = fixture()
  const after = insertPoint(before, 's1', US)

  it('every state of every preset keeps its shape (old s1 at t == new s1a / s1b)', () => {
    let worst = 0
    for (const [pid, c] of Object.entries(before.presets))
      for (const st of Object.keys(c.states)) {
        const old = segCubic(c, st, 's1')
        const na = segCubic(after.presets[pid], st, 's1a')
        const nb = segCubic(after.presets[pid], st, 's1b')
        for (let i = 0; i <= 100; i++) {
          const t = i / 100
          const got = t <= US ? bez(na, t / US) : bez(nb, (t - US) / (1 - US))
          worst = Math.max(worst, dist(got, at(old, t)))
        }
        // s2 untouched
        expect(segCubic(after.presets[pid], st, 's2')).toEqual(segCubic(c, st, 's2'))
      }
    report.push({ check: 'shape unchanged', worst })
    expect(worst).toBeLessThan(1e-12)
  })

  it("dot's example: ends offset 0 and 8 (handles following) → the new node's hIn / anchor / hOut offsets are 2 / 4 / 6 at u = 0.5", () => {
    const mk = (off: number): Record<string, Anchor> => ({
      a: { id: 'a', p: P(0, 0), hIn: P(0, 0), hOut: P(3, 0) },
      b: { id: 'b', p: P(10, off), hIn: P(7, off), hOut: P(10, off) },
    })
    const doc: Doc = {
      presets: { A: { id: 'U', order: ['a', 'b'], segments: [{ id: 's', from: 'a', to: 'b' }], states: { s0: mk(0), s1: { a: mk(0).a, b: mk(8).b } } } },
      refs: {},
      fill: [],
      takeover: null,
      seq: 0,
    }
    const r = insertPoint(doc, 's', 0.5)
    const m = Object.keys(r.presets.A.states.s0).find((k) => k.startsWith('m'))!
    const o = (k: 'hIn' | 'p' | 'hOut') => r.presets.A.states.s1[m][k].y - r.presets.A.states.s0[m][k].y
    report.push({ check: '0 / 8 example', hIn: o('hIn'), p: o('p'), hOut: o('hOut') })
    expect([o('hIn'), o('p'), o('hOut')]).toEqual([2, 4, 6])
  })

  it('(segment, u) references keep their position in every state', () => {
    let worst = 0
    for (const [k, ref] of Object.entries(before.refs)) {
      const nr = after.refs[k]
      for (const st of Object.keys(before.presets.A.states)) {
        const p0 = at(segCubic(before.presets.A, st, ref.segmentId), ref.u)
        const p1 = bez(segCubic(after.presets.A, st, nr.segmentId), nr.u)
        worst = Math.max(worst, dist(p0, p1))
      }
    }
    report.push({ check: 'references', worst, refs: after.refs })
    expect(worst).toBeLessThan(1e-12)
  })

  it('fill boundary: s1 replaced by s1a, s1b in order (forward) and s1b, s1a (reverse)', () => {
    expect(after.fill).toEqual([{ segmentId: 's1a', dir: 1 }, { segmentId: 's1b', dir: 1 }, { segmentId: 's2', dir: 1 }])
    const rev = insertPoint({ ...before, fill: [{ segmentId: 's2', dir: -1 }, { segmentId: 's1', dir: -1 }] }, 's1', US)
    expect(rev.fill).toEqual([{ segmentId: 's2', dir: -1 }, { segmentId: 's1b', dir: -1 }, { segmentId: 's1a', dir: -1 }])
  })

  it('frozen takeover: split geometrically, L kept; a later fine-tune transfers exactly as before the split', () => {
    expect(after.takeover!.L).toEqual(before.takeover!.L)
    // a fine-tune on the front: anchor b raised by 1.5 with its handles
    const tune = (rec: Record<string, Anchor>) => ({ ...rec, b: { ...rec.b, p: P(rec.b.p.x, rec.b.p.y - 1.5), hIn: P(rec.b.hIn.x, rec.b.hIn.y - 1.5), hOut: P(rec.b.hOut.x, rec.b.hOut.y - 1.5) } })
    const frontBefore = tune(before.presets.A.states['0|open'])
    const resBefore = transfer(before.takeover!, frontBefore)
    // the same fine-tuned front after the split: split it ourselves (independent de Casteljau)
    const m = Object.keys(after.presets.A.states['0|open']).find((k) => k.startsWith('m'))!
    const splitRec = (rec: Record<string, Anchor>) => {
      const q: Cubic = [rec.a.p, rec.a.hOut, rec.b.hIn, rec.b.p]
      const p01 = L(q[0], q[1], US), p12 = L(q[1], q[2], US), p23 = L(q[2], q[3], US), p012 = L(p01, p12, US), p123 = L(p12, p23, US)
      return { ...rec, a: { ...rec.a, hOut: p01 }, [m]: { id: m, hIn: p012, p: L(p012, p123, US), hOut: p123 }, b: { ...rec.b, hIn: p23 } }
    }
    const resAfter = transfer(after.takeover!, splitRec(frontBefore))
    const want = splitRec(resBefore)
    let worst = 0
    for (const id of Object.keys(want)) for (const k of ['p', 'hIn', 'hOut'] as const) worst = Math.max(worst, dist(resAfter[id][k], want[id][k]))
    report.push({ check: 'frozen takeover transfer', worst })
    expect(worst).toBeLessThan(1e-12)
  })

  it('structure identical across presets; undo (= the old doc) and JSON reopen exact', () => {
    expect(after.presets.A.segments).toEqual(after.presets.B.segments)
    expect(after.presets.A.order).toEqual(after.presets.B.order)
    expect(JSON.stringify(JSON.parse(JSON.stringify(after)))).toBe(JSON.stringify(after))
    expect(JSON.stringify(before)).toBe(JSON.stringify(fixture())) // the input was not mutated (undo = keep the old doc)
  })

  it('new ids never collide with existing ones (review of f9d344b: a document that already has s1a)', () => {
    const d0 = fixture()
    for (const c of Object.values(d0.presets)) {
      c.segments[1].id = 's1a'
    }
    d0.refs.lash.segmentId = 's1a'
    d0.fill[1].segmentId = 's1a'
    const lashBefore = Object.fromEntries(Object.entries(d0.presets).flatMap(([pid, c]) => Object.keys(c.states).map((st) => [`${pid}/${st}`, bez(segCubic(c, st, 's1a'), 0.5)])))
    const d = insertPoint(d0, 's1', 0.4)
    for (const [pid, c] of Object.entries(d.presets)) {
      const ids = c.segments.map((x) => x.id)
      expect(new Set(ids).size).toBe(ids.length)
      expect(ids[2]).toBe('s1a') // the untouched old segment keeps its id
      for (const st of Object.keys(c.states)) expect(bez(segCubic(c, st, d.refs.lash.segmentId), d.refs.lash.u)).toEqual(lashBefore[`${pid}/${st}`])
    }
    expect(Object.values(d.presets).map((c) => c.segments.map((x) => x.id).join())).toEqual(Array(2).fill(d.presets.A.segments.map((x) => x.id).join()))
    expect(d.fill.map((f) => f.segmentId)).toEqual([...d.presets.A.segments.slice(0, 2).map((x) => x.id), 's1a'])
    report.push({ case: 'id collision', segments: d.presets.A.segments.map((x) => x.id) })
  })

  it('prints the table', () => {
    console.log('[insertPoint]\n' + report.map((r) => JSON.stringify(r)).join('\n'))
  })
})
