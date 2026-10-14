// Stage 3b, package 2 (docs/stage3b-pkg2-responses.md; dot 1791689721): responses as data,
// evaluate with responses, responses through structural edits, the clip and the file. No user
// operation writes knots in this package, so responses come from an opened file.
import { describe, it, expect } from 'vitest'
import { Core, save, open, Refusal, type Vec } from '../src'
import { evaluate, type Model, type ViewShape } from '../src/evaluate'

const P = (x: number, y = 0): Vec => ({ x, y })
const FRONT = 'view:0,0', SIDE = 'view:90,0'
const E_FS = 'view:0,0>view:90,0'
type Knots = [number, number][]
type Doc = { animation: { points: Record<string, unknown>; handles: Record<string, unknown> } } & Record<string, unknown>

/** A document opened from `d`'s file after `f` has edited its document part (the only way to get responses here). */
function edited(d: Core, f: (doc: Doc) => void): Core {
  const file = JSON.parse(save(d))
  f(file.document)
  return open(JSON.stringify(file))
}
const put = (rec: Record<string, unknown>, k: string, v: unknown) => Object.defineProperty(rec, k, { value: v, enumerable: true, writable: true, configurable: true })
const pointR = (doc: Doc, id: string, edge: string, axes: { x?: Knots; y?: Knots }) => {
  const c = (Object.hasOwn(doc.animation.points, id) ? doc.animation.points[id] : put(doc.animation.points, id, {}) && doc.animation.points[id]) as Record<string, unknown>
  put(c, edge, axes)
}
const responses = (d: Core) => (JSON.parse(save(d)).document as Doc).animation
const at = (d: Core, k: string, id: string) => d.in(k).snapshot().points.find(p => p.id === id)!.position

/** ab, bc in L; b moved in the side view so the edge front → side has a span on x and y. */
function base() {
  const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
  d.edit(e => { e.line('ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(10) }); e.line('bc', 'b', { id: 'c', layer: 'L', position: P(20) }) })
  d.editIn(SIDE, e => e.move([{ id: 'b', target: P(20, 10) }]))
  return d
}

describe('the data', () => {
  it('a file round-trips its responses; empty parts are not kept; a knot on the diagonal is kept (a protected target)', () => {
    const d = edited(base(), doc => {
      pointR(doc, 'b', E_FS, { x: [[0.3, 0.3], [0.6, 0.9]] })
      put(doc.animation.points, 'c', {})
      put(doc.animation.handles, 'ab', { a: { [E_FS]: { y: [] } } })
    })
    expect(responses(d)).toEqual({ points: { b: { [E_FS]: { x: [[0.3, 0.3], [0.6, 0.9]] } } }, handles: {} })
    expect(responses(open(save(d)))).toEqual(responses(d))
  })

  it('any legal id is an ordinary key: points named constructor, toString and __proto__ carry responses; a key with no such point is refused', () => {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => { e.line('toString', { id: 'constructor', layer: 'L', position: P(0) }, { id: '__proto__', layer: 'L', position: P(10) }) })
    d.editIn(SIDE, e => e.move([{ id: '__proto__', target: P(20, 10) }]))
    const r = edited(d, doc => { pointR(doc, '__proto__', E_FS, { x: [[0.5, 0.8]] }); pointR(doc, 'constructor', E_FS, { y: [[0.5, 0.1]] }) })
    const saved = JSON.parse(save(r)).document.animation.points
    expect(Object.hasOwn(saved, '__proto__') && Object.hasOwn(saved, 'constructor')).toBe(true)
    expect(at(open(save(r)), FRONT, '__proto__')).toEqual(P(10))
    // the response acts: x at the edge's midpoint is 10 + 0.8 · (20 − 10)
    expect(r.atPose({ yaw: 45, pitch: 0 }).snapshot().points.find(p => p.id === '__proto__')!.position.x).toBeCloseTo(18, 12)
    expect(() => edited(base(), doc => pointR(doc, 'constructor', E_FS, { x: [[0.5, 0.8]] }))).toThrow(/open-failed: animation: no point "constructor"/)
  })
})

describe('evaluate with responses', () => {
  // a pure model: one point p, x and y differ in every view, so every edge has a span
  const f = (yaw: number, pitch: number, k: number) => 10 * k + yaw / 9 + pitch / 4.5 + (yaw * pitch) / 400
  const view = (yaw: number, pitch: number): ViewShape => ({
    yaw, pitch,
    points: { p: P(f(yaw, pitch, 1), f(yaw, pitch, 2)), q: P(f(yaw, pitch, 3), f(yaw, pitch, 4)) },
    lines: { pq: { ha: P(1, f(yaw, pitch, 5)), hb: P(-1, 0), stroke: { width: 1 + Math.abs(yaw) / 90, profile: `w${yaw},${pitch}` } } },
    ends: yaw === 0 && pitch === 0 ? { p: { taper: 2 } } : {},
  })
  const views = [-90, 0, 90].flatMap(y => [-45, 0, 45].map(p => view(y, p)))
  const model = (responses?: Model['responses']): Model => ({ views, ...(responses ? { responses } : {}) })
  const EDGES = [
    ...[-45, 0, 45].flatMap(p => [-90, 90].map(y => ({ key: `0,${p}>${y},${p}`, from: [0, p], to: [y, p] }))),
    ...[-90, 0, 90].flatMap(y => [-45, 45].map(p => ({ key: `${y},0>${y},${p}`, from: [y, 0], to: [y, p] }))),
  ]
  const val = (yaw: number, pitch: number) => views.find(v => v.yaw === yaw && v.pitch === pitch)!.points.p!.x

  it('with no responses, results are bit for bit those of 3a; a control without responses is untouched by another\'s', () => {
    const plain = model(), withQ = model({ points: { q: { [EDGES[1]!.key]: { x: [[0.5, 0.9]] } } }, handles: {} })
    for (const pose of [{ yaw: 30, pitch: 0 }, { yaw: -60, pitch: 20 }, { yaw: 90, pitch: -45 }, { yaw: 12.5, pitch: 44 }]) {
      const a = evaluate(plain, pose), b = evaluate(model({ points: {}, handles: {} }), pose), c = evaluate(withQ, pose)
      expect(Object.is(a.points.p!.x, b.points.p!.x) && Object.is(a.points.p!.y, b.points.p!.y)).toBe(true)
      expect(Object.is(a.points.p!.x, c.points.p!.x) && Object.is(a.lines.pq!.ha.y, c.lines.pq!.ha.y)).toBe(true)
    }
  })

  it('every one of the 12 edges: on the edge, exactly A + r(t)(B − A); the cells beside it change, the others do not', () => {
    for (const e of EDGES) {
      const m = model({ points: { p: { [e.key]: { x: [[0.5, 0.8]] } } }, handles: {} })
      const mid = { yaw: (e.from[0]! + e.to[0]!) / 2, pitch: (e.from[1]! + e.to[1]!) / 2 }
      const A = val(e.from[0]!, e.from[1]!), B = val(e.to[0]!, e.to[1]!)
      // the edge rule A + r(t)(B − A), computed as the weights (1 − r)·A + r·B
      expect(evaluate(m, mid).points.p!.x, e.key).toBe((1 - 0.8) * A + 0.8 * B)
      expect(evaluate(m, mid).points.p!.x, e.key).toBeCloseTo(A + 0.8 * (B - A), 12)
      expect(evaluate(m, mid).points.p!.y).toBe(evaluate(model(), mid).points.p!.y) // the other axis is untouched
      // inside every cell: changed only in the cells that have this edge
      for (const sy of [-1, 1]) for (const sp of [-1, 1]) {
        const inCell = { yaw: sy * 45, pitch: sp * 22.5 }, Y = sy * 90, Pp = sp * 45
        const cellEdges = [`0,0>${Y},0`, `0,${Pp}>${Y},${Pp}`, `0,0>0,${Pp}`, `${Y},0>${Y},${Pp}`]
        const moved = evaluate(m, inCell).points.p!.x !== evaluate(model(), inCell).points.p!.x
        expect([e.key, inCell, moved]).toEqual([e.key, inCell, cellEdges.includes(e.key)])
      }
    }
    // an inner edge borders two cells, an outer one cell
    const cellsOf = (k: string) => [-1, 1].flatMap(sy => [-1, 1].map(sp => [`0,0>${sy * 90},0`, `0,${sp * 45}>${sy * 90},${sp * 45}`, `0,0>0,${sp * 45}`, `${sy * 90},0>${sy * 90},${sp * 45}`])).filter(c => c.includes(k)).length
    expect(EDGES.map(e => cellsOf(e.key)).sort()).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2])
  })

  it('extrapolation keeps negative weights: values 10 and 20, response −0.5 → 5; a response above 1 likewise', () => {
    const two = (a: number, b: number): Model => ({ views: views.map(v => ({ ...v, points: { ...v.points, p: P(v.yaw === 90 && v.pitch === 0 ? b : a, 0) } })) })
    const m = (value: number) => ({ ...two(10, 20), responses: { points: { p: { '0,0>90,0': { x: [[0.5, value]] as [number, number][] } } }, handles: {} } })
    expect(evaluate(m(-0.5), { yaw: 45, pitch: 0 }).points.p!.x).toBe(5)
    expect(evaluate(m(1.5), { yaw: 45, pitch: 0 }).points.p!.x).toBe(25)
  })

  it('inside a cell: the u\' / v\' formula; the nine views stay exact; appearance and radii keep the geometric weights', () => {
    const r = { points: { p: { '0,0>90,0': { x: [[0.5, 0.9]] }, '0,45>90,45': { x: [[0.5, 0.2]] }, '0,0>0,45': { x: [[0.4, 0.1]] }, '90,0>90,45': { x: [[0.6, 0.7]] } } }, handles: {} } as Model['responses']
    const m = model(r), pose = { yaw: 30, pitch: 15 }, u = 30 / 90, v = 15 / 45
    const lin = (k: [number, number][], t: number) => { const pts = [[0, 0], ...k, [1, 1]]; for (let i = 1; i < pts.length; i++) if (t <= pts[i]![0]!) { const [p0, v0] = pts[i - 1]!, [p1, v1] = pts[i]!; return v0! + ((t - p0!) * (v1! - v0!)) / (p1! - p0!) } return 1 }
    const u2 = (1 - v) * lin([[0.5, 0.9]], u) + v * lin([[0.5, 0.2]], u), v2 = (1 - u) * lin([[0.4, 0.1]], v) + u * lin([[0.6, 0.7]], v)
    const expected = (1 - u2) * (1 - v2) * val(0, 0) + u2 * (1 - v2) * val(90, 0) + (1 - u2) * v2 * val(0, 45) + u2 * v2 * val(90, 45)
    expect(evaluate(m, pose).points.p!.x).toBeCloseTo(expected, 12)
    for (const vw of views) expect(evaluate(m, { yaw: vw.yaw, pitch: vw.pitch }).points.p).toEqual(vw.points.p)
    const plain = evaluate(model(), pose), withR = evaluate(m, pose)
    expect([withR.lines.pq!.stroke, withR.ends]).toEqual([plain.lines.pq!.stroke, plain.ends])
  })

  it('continuous across cell borders and across 0° with responses', () => {
    const m = model({ points: { p: Object.fromEntries(EDGES.map((e, i) => [e.key, { x: [[0.3, 0.1 + i / 20]] as [number, number][], y: [[0.7, 0.95]] as [number, number][] }])) }, handles: {} })
    const eps = 1e-7
    for (const [a, b] of [[{ yaw: -eps, pitch: 20 }, { yaw: eps, pitch: 20 }], [{ yaw: 40, pitch: -eps }, { yaw: 40, pitch: eps }]] as const) {
      const pa = evaluate(m, a).points.p!, pb = evaluate(m, b).points.p!
      expect(Math.hypot(pa.x - pb.x, pa.y - pb.y)).toBeLessThan(1e-4)
    }
  })

  it('a malformed response in the model is refused, naming the control', () => {
    for (const bad of [[[0.5, 0.2], [0.4, 0.3]], [[0, 0.2]], [[0.5, NaN]], [[1, 0.5]]]) {
      expect(() => evaluate(model({ points: { p: { '0,0>90,0': { x: bad as [number, number][] } } }, handles: {} }), { yaw: 30, pitch: 0 })).toThrow(/model-incomplete: malformed response of position of p on 0,0>90,0, axis x/)
    }
  })
})

describe('responses through structural edits (follow)', () => {
  /** b and c have responses; ab's a-end handle too. */
  const doc = () => edited(base(), d => {
    pointR(d, 'b', E_FS, { x: [[0.5, 0.8]] }); pointR(d, 'c', E_FS, { y: [[0.25, 0.5]] })
    put(d.animation.handles, 'ab', { a: { [E_FS]: { x: [[0.5, 0.6]] } } })
  })
  const has = (d: Core, id: string) => Object.hasOwn(responses(d).points, id)

  it('deleting a line drops its handle entries (and its isolated end points\' entries with the points)', () => {
    const d = doc()
    d.edit(e => e.deleteLine('ab'))
    expect([Object.hasOwn(responses(d).handles, 'ab'), has(d, 'b')]).toEqual([false, true])
    d.edit(e => e.deleteLine('bc'))
    expect([has(d, 'b'), has(d, 'c')]).toEqual([false, false])
  })

  it('deleting the selection or a layer drops what goes', () => {
    const d = doc()
    d.edit(e => e.deleteSelection([{ kind: 'line', id: 'bc' }]))
    expect(has(d, 'c')).toBe(false)
    const e2 = doc()
    e2.edit(e => e.deleteLayer('L'))
    expect(responses(e2)).toEqual({ points: {}, handles: {} })
  })

  it('bind keeps the kept point\'s own and drops the removed one\'s; auto-bind by a move does the same', () => {
    const d = doc()
    d.edit(e => e.line('xy', { id: 'x', layer: 'L', position: P(50) }, { id: 'y', layer: 'L', position: P(60) }))
    d.edit(e => e.bind('x', 'c')) // c (with a response) is removed
    expect([has(d, 'x'), has(d, 'c')]).toEqual([false, false])
    const e2 = doc()
    e2.edit(e => e.line('xy', { id: 'x', layer: 'L', position: P(50) }, { id: 'y', layer: 'L', position: P(60) }))
    e2.edit(e => e.move([{ id: 'c', target: P(50) }])) // c lands on x: auto-bind in the front
    expect(e2.snapshot().points.some(p => p.id === 'c') && e2.snapshot().points.some(p => p.id === 'x')).toBe(false)
    expect(responses(e2).points).toEqual(Object.fromEntries(e2.snapshot().points.filter(p => p.id === 'b').map(p => [p.id, responses(doc()).points.b])))
  })

  it('unbind: the new point copies the old point\'s responses (not cleared by "new point")', () => {
    const d = doc()
    d.edit(e => e.unbind('b', ['bc'], 'b2'))
    expect(responses(d).points.b2).toEqual(responses(d).points.b)
  })

  it('a pen line from an existing end point keeps that point\'s responses; its new point and handles have none', () => {
    const d = doc()
    d.edit(e => e.line('cd', 'c', { id: 'dd', layer: 'L', position: P(30) }))
    expect([has(d, 'c'), has(d, 'dd'), Object.hasOwn(responses(d).handles, 'cd')]).toEqual([true, false, false])
  })

  it('moving a group to another layer keeps its responses (ids unchanged)', () => {
    const d = doc()
    d.edit(e => e.layer('M', 'M'))
    d.edit(e => e.moveGroup(d.snapshot().groups[0]!.id, 'M'))
    expect(responses(d)).toEqual(responses(doc()))
  })

  it('undo restores responses with everything else', () => {
    const d = doc(), before = responses(d)
    d.edit(e => e.deleteLine('bc'))
    d.undo()
    expect(responses(d)).toEqual(before)
  })
})

describe('refusals: split and link', () => {
  it('a split of a line whose ends or handles have responses is refused; without responses it goes through', () => {
    const viaEnd = edited(base(), d => pointR(d, 'b', E_FS, { x: [[0.5, 0.8]] }))
    expect(() => viaEnd.edit(e => e.split('bc', 0.5, 'm', 'p1', 'p2'))).toThrow(/split-has-responses: line bc/)
    const viaHandle = edited(base(), d => put(d.animation.handles, 'bc', { b: { [E_FS]: { y: [[0.5, 0.1]] } } }))
    expect(() => viaHandle.edit(e => e.split('bc', 0.5, 'm', 'p1', 'p2'))).toThrow(/split-has-responses/)
    const plain = base()
    plain.edit(e => e.split('bc', 0.5, 'm', 'p1', 'p2'))
    expect(plain.snapshot().points.some(p => p.id === 'm')).toBe(true)
  })

  it('a mirror-paired split is refused when the counterpart line has responses', () => {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => { e.line('l', { id: 'l1', layer: 'L', position: P(-20) }, { id: 'l2', layer: 'L', position: P(-10) }); e.line('r', { id: 'r1', layer: 'L', position: P(20) }, { id: 'r2', layer: 'L', position: P(10) }) })
    d.edit(e => e.mirrorLink([d.snapshot().groups[0]!.id], [d.snapshot().groups[1]!.id]))
    const m = edited(d, doc => pointR(doc, 'r2', E_FS, { x: [[0.5, 0.8]] }))
    expect(() => m.edit(e => e.split('l', 0.5, 'm', 'p1', 'p2'))).toThrow(/split-has-responses: line r/)
  })

  /** a (L) and q (M), unlinked; their responses set by `f`. */
  const pair = (f: (doc: Doc) => void) => {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => { e.layer('M', 'M'); e.line('ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(10) }); e.line('qr', { id: 'q', layer: 'M', position: P(0, 5) }, { id: 'r', layer: 'M', position: P(10, 5) }) })
    return edited(d, f)
  }

  it('a link is refused when the two responses differ at any union knot, by as little as one ulp', () => {
    const v = 0.8, ulp = 0.8000000000000002
    const d = pair(doc => { pointR(doc, 'a', E_FS, { x: [[0.5, v]] }); pointR(doc, 'q', E_FS, { x: [[0.5, ulp]] }) })
    expect(() => d.edit(e => e.link('a', 'q'))).toThrow(/link-responses-differ: points a and q respond differently on view:0,0>view:90,0, axis x, at progress 0.5/)
    const none = pair(doc => pointR(doc, 'a', E_FS, { x: [[0.5, 0.8]] }))
    expect(() => none.edit(e => e.link('a', 'q'))).toThrow(/link-responses-differ/)
  })

  it('a 30° knot on the linear line against no response is accepted, and the merged response keeps the knot on both points', () => {
    const d = pair(doc => pointR(doc, 'q', E_FS, { y: [[1 / 3, 1 / 3]] }))
    d.edit(e => e.link('a', 'q'))
    expect(responses(d).points).toEqual({ a: { [E_FS]: { y: [[1 / 3, 1 / 3]] } }, q: { [E_FS]: { y: [[1 / 3, 1 / 3]] } } })
  })

  it('the merge keeps the union of both sides\' knots, written to every member of both components; linked points evaluate bit-identically', () => {
    // a–s already linked (a component of two) with knots at 0.25; q–t linked with knots at 0.75, the same function (diagonal)
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => {
      e.layer('M', 'M'); e.layer('K', 'K'); e.layer('N', 'N')
      e.line('ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(10) })
      e.line('st', { id: 's', layer: 'K', position: P(0) }, { id: 't', layer: 'K', position: P(10) })
      e.line('qr', { id: 'q', layer: 'M', position: P(0, 5) }, { id: 'r', layer: 'M', position: P(10, 5) })
      e.line('uv', { id: 'u', layer: 'N', position: P(0, 5) }, { id: 'w', layer: 'N', position: P(10, 5) })
    })
    d.edit(e => { e.link('a', 's'); e.link('q', 'u') })
    const m = edited(d, doc => {
      for (const id of ['a', 's']) pointR(doc, id, E_FS, { x: [[0.25, 0.25]] })
      for (const id of ['q', 'u']) pointR(doc, id, E_FS, { x: [[0.75, 0.75]] })
    })
    m.editIn(SIDE, e => e.move([{ id: 'a', target: P(30, 7) }]))
    m.edit(e => e.link('a', 'q'))
    const merged = { [E_FS]: { x: [[0.25, 0.25], [0.75, 0.75]] } }
    expect(responses(m).points).toEqual({ a: merged, s: merged, q: merged, u: merged })
    for (const pose of [{ yaw: 20, pitch: 0 }, { yaw: 70, pitch: 30 }, { yaw: -40, pitch: -10 }]) {
      const pts = m.atPose(pose).snapshot().points, pa = pts.find(p => p.id === 'a')!.position
      for (const id of ['s', 'q', 'u']) { const pq = pts.find(p => p.id === id)!.position; expect(Object.is(pa.x, pq.x) && Object.is(pa.y, pq.y)).toBe(true) }
    }
  })

  it('a merge of more than 256 knots is refused', () => {
    // diagonal knots at odd and at even multiples of 1/512: each side is exact at the other's knots
    // (midpoints of dyadic neighbours), so the merge is accepted as equal and only the count refuses
    const at = (first: number, count: number): Knots => Array.from({ length: count }, (_, i) => [(first + 2 * i) / 512, (first + 2 * i) / 512] as [number, number])
    const d = pair(doc => { pointR(doc, 'a', E_FS, { x: at(1, 256) }); pointR(doc, 'q', E_FS, { x: at(2, 255) }) })
    expect(() => d.edit(e => e.link('a', 'q'))).toThrow(/link-responses-too-many: linking a and q would give 511 knots/)
  })

  it('a file whose linked points hold different responses is refused', () => {
    const d = pair(() => {})
    d.edit(e => e.link('a', 'q'))
    expect(() => edited(d, doc => pointR(doc, 'q', E_FS, { x: [[0.5, 0.5]] }))).toThrow(/open-failed: linked points a and q hold different responses/)
  })
})

describe('the clip and the file', () => {
  const doc = () => edited(base(), d => { pointR(d, 'b', E_FS, { x: [[0.5, 0.8]] }); put(d.animation.handles, 'bc', { a: { [E_FS]: { y: [[0.5, 0.1]] } } }) })

  it('paste carries responses to the new ids; a partial copy only what was copied; a clip survives JSON', () => {
    const d = doc()
    const clip = JSON.parse(JSON.stringify(d.copy(['bc'])))
    d.edit(e => e.paste(clip, 'L', P(0, 100), 'p'))
    const r = responses(d)
    expect([r.points['p/b'], (r.handles as Record<string, unknown>)['p/bc']]).toEqual([r.points.b, (r.handles as Record<string, unknown>).bc])
    const part = d.copy(['ab'])
    expect(part.animation).toEqual({ points: { b: r.points.b }, handles: {} })
  })

  it('copying a layer carries responses, including one a point inherited earlier in the same edit', () => {
    const d = doc()
    d.edit(e => { e.unbind('b', ['bc'], 'b2'); e.copyLayer('L', 'L2') })
    const r = responses(d)
    expect([r.points['L2/b2'], r.points['L2/b']]).toEqual([r.points.b, r.points.b])
  })

  it('a clip without the part pastes no responses; a clip whose part is bad refuses the paste; a clip id named constructor is carried', () => {
    const d = doc()
    const old = d.copy(['bc']) as unknown as Record<string, unknown>
    delete old.animation
    d.edit(e => e.paste(old as never, 'L', P(0, 100), 'p'))
    expect(Object.keys(responses(d).points).filter(k => k.startsWith('p/'))).toEqual([])
    const bad = (f: (a: Record<string, Record<string, unknown>>) => void) => { const c = JSON.parse(JSON.stringify(d.copy(['bc']))); f(c.animation); return c }
    for (const [clip, why] of [
      [bad(a => { put(a.points!, 'nowhere', { [E_FS]: { x: [[0.5, 0.5]] } }) }), /clip-invalid: clip responses: no point "nowhere"/],
      [bad(a => { put(a.points!, 'b', { 'view:0,0>view:90,45': { x: [[0.5, 0.5]] } }) }), /is not an edge between neighbouring views/],
      [bad(a => { put(a.points!, 'b', { [E_FS]: { x: [[0.7, 0.5], [0.6, 0.5]] } }) }), /knot progress must increase strictly inside/],
      [bad(a => { put(a.points!, 'constructor', { [E_FS]: { x: [[0.5, 0.5]] } }) }), /no point "constructor"/],
    ] as const) {
      let err: unknown
      try { d.edit(e => e.paste(clip, 'L', P(0, 200), 'q')) } catch (x) { err = x }
      expect((err as Refusal).code).toBe('clip-invalid')
      expect((err as Error).message).toMatch(why)
    }
    const c = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    c.edit(e => e.line('ln', { id: 'constructor', layer: 'L', position: P(0) }, { id: 'z', layer: 'L', position: P(10) }))
    const cc = edited(c, doc2 => pointR(doc2, 'constructor', E_FS, { x: [[0.5, 0.5]] }))
    const lnClip = cc.copy(['ln'])
    cc.edit(e => e.paste(lnClip, 'L', P(0, 50), 'k'))
    expect(responses(cc).points['k/constructor']).toEqual(responses(cc).points.constructor)
  })

  it('open refuses a bad response: unknown id or edge, knot order, outside (0, 1), not finite, more than 256 knots', () => {
    const cases: [(doc: Doc) => void, RegExp][] = [
      [doc => pointR(doc, 'zz', E_FS, { x: [[0.5, 0.5]] }), /no point "zz"/],
      [doc => put(doc.animation.handles, 'zz', { a: { [E_FS]: { x: [[0.5, 0.5]] } } }), /no line "zz"/],
      [doc => pointR(doc, 'b', 'view:0,0>view:0,0', { x: [[0.5, 0.5]] }), /is not an edge/],
      [doc => pointR(doc, 'b', E_FS, { x: [[0.6, 0.1], [0.5, 0.2]] }), /increase strictly/],
      [doc => pointR(doc, 'b', E_FS, { x: [[1, 0.1]] }), /increase strictly inside \(0, 1\)/],
      [doc => pointR(doc, 'b', E_FS, { x: [[0.5, 'x' as unknown as number]] }), /two finite numbers/],
      [doc => pointR(doc, 'b', E_FS, { x: Array.from({ length: 257 }, (_, i) => [(i + 1) / 300, 0] as [number, number]) }), /more than 256 knots/],
    ]
    for (const [f, why] of cases) expect(() => edited(base(), f)).toThrow(why)
  })
})

describe('bad response data: missing is linear, present but broken is refused, at both entries (dot 1791690497)', () => {
  it('a file or a clip whose points or handles are lists, not objects, is refused (an empty list is not "no responses")', () => {
    expect(() => edited(base(), doc => { doc.animation.points = [] as never })).toThrow(/open-failed: animation: points and handles must be objects/)
    expect(() => edited(base(), doc => { doc.animation.handles = [] as never })).toThrow(/points and handles must be objects/)
    const d = base(), clip = d.copy(['ab']) as unknown as { animation: Record<string, unknown> }
    clip.animation.points = []
    let err: unknown
    try { d.edit(e => e.paste(clip as never, 'L', P(0, 50), 'p')) } catch (x) { err = x }
    expect((err as Refusal).code).toBe('clip-invalid')
  })

  it('a sparse knot list (an empty slot) is refused in a clip, not skipped; a null knot in a file likewise', () => {
    const d = base(), clip = d.copy(['ab']) as unknown as { animation: { points: Record<string, unknown> } }
    clip.animation.points = { b: { [E_FS]: { x: new Array(1) } } }
    let err: unknown
    try { d.edit(e => e.paste(clip as never, 'L', P(0, 50), 'p')) } catch (x) { err = x }
    expect((err as Refusal).code).toBe('clip-invalid')
    expect((err as Error).message).toMatch(/knot 0 is missing \(an empty slot\)/)
    expect(() => edited(base(), doc => pointR(doc, 'b', E_FS, { x: [null as unknown as [number, number]] }))).toThrow(/knot 0 must be two finite numbers/)
    expect(() => edited(base(), doc => pointR(doc, 'b', E_FS, { x: [[0.5] as unknown as [number, number]] }))).toThrow(/knot 0 must be two finite numbers/)
  })

  it('evaluate: a broken control, axes or knot list is refused; a missing one, or an inherited axis, is linear', () => {
    const views = [-90, 0, 90].flatMap(yaw => [-45, 0, 45].map(pitch => ({ yaw, pitch, points: { p: P(yaw, pitch) }, lines: { l: { ha: P(1, yaw), hb: P(-1, pitch), stroke: { width: 1, profile: 'u' } } }, radii: {}, ends: {} })))
    const run = (responses: unknown) => evaluate({ views, responses: responses as Model['responses'] }, { yaw: 30, pitch: 0 })
    const plain = run(undefined)
    for (const [bad, why] of [
      [{ points: { p: null }, handles: {} }, /malformed responses of position of p/],
      [{ points: { p: { '0,0>90,0': null } }, handles: {} }, /malformed response of position of p on 0,0>90,0/],
      [{ points: { p: { '0,0>90,0': { x: null } } }, handles: {} }, /knots must be a list/],
      [{ points: { p: { '0,0>90,0': { x: 0 } } }, handles: {} }, /knots must be a list/],
      [{ points: { p: { '0,0>90,0': { x: {} } } }, handles: {} }, /knots must be a list/],
      [{ points: { p: { '0,0>90,0': { x: new Array(1) } } }, handles: {} }, /knot 0 is missing/],
      [{ points: { p: { '0,0>90,0': { x: Array.from({ length: 257 }, (_, i) => [(i + 1) / 300, 0]) } } }, handles: {} }, /more than 256 knots/],
      [{ points: {}, handles: { l: [] } }, /malformed responses of handles of l/],
      [{ points: {}, handles: { l: { a: 7 } } }, /malformed responses of handle a of l/],
    ] as const) expect(() => run(bad)).toThrow(why)
    // missing parts and an axis only inherited (not own) are linear: the same numbers as no responses
    for (const missing of [{ points: {}, handles: {} }, { points: { p: {} }, handles: { l: {} } }, { points: { p: { '0,0>90,0': Object.create({ x: [[0.5, 0.9]] }) } }, handles: {} }, { points: { p: Object.create({ '0,0>90,0': { x: [[0.5, 0.9]] } }) }, handles: {} }]) {
      expect(run(missing).points.p).toEqual(plain.points.p)
    }
  })
})

describe('extreme finite values (dot 1791690525)', () => {
  const views = [-90, 0, 90].flatMap(yaw => [-45, 0, 45].map(pitch => ({ yaw, pitch, points: { p: P(10 + yaw / 9, 5 + pitch / 9) }, lines: {}, radii: {}, ends: {} })))
  const run = (responses: unknown, pose: { yaw: number; pitch: number }) => evaluate({ views, responses: responses as Model['responses'] }, pose)
  it('interpolation does not overflow: knots 1e308 and −1e308 give 0 halfway between them', async () => {
    const { respond } = await import('../src/evaluate')
    expect(respond([[0.25, 1e308], [0.75, -1e308]], 0.5)).toBe(0)
    expect(Number.isFinite(respond([[0.5, 1.7e308]], 0.9))).toBe(true)
  })

  it('a response on an edge the pose is not on cannot reach the result, however extreme', () => {
    const top = { points: { p: { '0,45>90,45': { x: [[0.5, 1e308]] }, '90,0>90,45': { x: [[0.5, -1e308]] } } }, handles: {} }
    for (const pose of [{ yaw: 45, pitch: 0 }, { yaw: 0, pitch: 20 }]) expect(run(top, pose).points.p).toEqual(run(undefined, pose).points.p)
  })

  it('finite responses that would give a non-finite position are refused, never published as Infinity or NaN', () => {
    const huge = { points: { p: { '0,0>90,0': { x: [[0.5, 1e308]] } } }, handles: {} }
    expect(() => run(huge, { yaw: 45, pitch: 0 })).toThrow(/pose-not-finite: position of p is not a finite number at this pose/)
    const weights = { points: { p: { '0,0>90,0': { x: [[0.5, 1e200]] }, '0,0>0,45': { x: [[0.5, 1e200]] } } }, handles: {} }
    expect(() => run(weights, { yaw: 45, pitch: 22.5 })).toThrow(/pose-not-finite/)
  })
})

