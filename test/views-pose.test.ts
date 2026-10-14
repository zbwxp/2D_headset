// Stage 3a, package 2 (docs/stage3a-playback-plan.md, "From pose values to drawn geometry";
// dot 1791683897, 1791684079): Core.model() and Core.atPose(). The posed parameters reach the
// drawn geometry through the same reads as any view, so arcs and fills come from `derived`.
import { describe, it, expect } from 'vitest'
import { Core, save, open, Refusal, type Vec } from '../src'
import { evaluate } from '../src/evaluate'

const P = (x: number, y = 0): Vec => ({ x, y })
const FRONT = 'view:0,0'
const angle = (k: string) => { const [yaw, pitch] = k.slice(5).split(',').map(Number); return { yaw: yaw!, pitch: pitch! } }

/** A square a b c d with a fill, an arc join at b whose radius differs per view, shapes that differ per view, an end stroke at the front only. */
function doc() {
  const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
  d.edit(e => {
    e.line('ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(10) })
    e.line('bc', 'b', { id: 'c', layer: 'L', position: P(10, 10) })
    e.line('cd', 'c', { id: 'd', layer: 'L', position: P(0, 10) })
    e.line('da', 'd', 'a')
  })
  d.edit(e => e.fill(d.snapshot().loops[0]!.id, '#f2c94c'))
  d.edit(e => { e.join('b', 'ab', 'bc', { mode: 'arc', radius: 2 }); e.endStroke('a', { taper: 3, cap: 'round' }) })
  d.views().forEach((k, i) => {
    if (k === FRONT) return
    d.editIn(k, e => {
      e.move([{ id: 'c', target: P(10 + i, 10 - i / 2) }, { id: 'd', target: P(-i / 3, 10 + i) }])
      e.moveHandle('ab', 'b', P(-2 - i / 4, i / 5))
      e.join('b', 'ab', 'bc', { mode: 'arc', radius: 1 + i / 4 })
      e.lineStroke('cd', { width: 1 + i, profile: `p${i}` })
    })
  })
  return d
}

/** The oracle: a file whose front layer holds exactly `evaluate`'s parameters, opened and read as the front. */
function oracle(d: Core, pose: { yaw: number; pitch: number }) {
  const posed = evaluate(d.model(), pose)
  const file = JSON.parse(save(d))
  const front = (file.document.network.shapes.layers as { key: string; points: unknown; lines: unknown; radius: unknown; zone?: unknown; end?: unknown }[]).find(l => l.key === FRONT)!
  front.points = posed.points
  // the posed strokes as stored: the profile on each line, the widths on the points (bowen 1791820396)
  const ends = new Map((file.document.network.lines as { id: string; a: string; b: string }[]).map(l => [l.id, l] as const))
  const widthAt = (line: string, point: string) => { const st = posed.lines[line]!.stroke; return ends.get(line)!.b === point && st.widthB !== undefined ? st.widthB : st.width }
  front.lines = Object.fromEntries(Object.entries(posed.lines).map(([id, l]) => [id, { ha: l.ha, hb: l.hb, stroke: { profile: l.stroke.profile } }]))
  ;(front as { widths?: unknown }).widths = Object.fromEntries(Object.keys(posed.points).map(p => {
    const l = [...ends.values()].find(x => x.a === p || x.b === p)
    return [p, l ? widthAt(l.id, p) : 1]
  }))
  front.radius = posed.radii
  // a posed zone equal to the automatic length of the posed widths stays automatic (J1)
  front.zone = Object.fromEntries(Object.entries(posed.zones).filter(([k, z]) => {
    const [p, l0, l1] = JSON.parse(k) as [string, string, string], w0 = widthAt(l0, p), w1 = widthAt(l1, p)
    const auto = Math.max(w0, w1) ** 2 / Math.min(w0, w1)
    return Math.abs(z - auto) > 1e-12 * Math.max(1, auto)
  }))
  front.end = posed.ends
  return open(JSON.stringify(file)).in(FRONT)
}

describe('atPose: parameters and drawn geometry', () => {
  it('at each of the nine views, both the parameters and the drawn geometry equal that view (with an arc join and a fill)', () => {
    const d = doc()
    const g0 = d.in(FRONT).geometry()
    expect([g0.arcs.length, g0.fills.length]).toEqual([1, 1])
    for (const k of d.views()) {
      const at = d.atPose(angle(k))
      expect(at.snapshot()).toEqual(d.in(k).snapshot())
      expect(at.geometry()).toEqual(d.in(k).geometry())
    }
  })

  it('between views, the drawn geometry is what the posed parameters give through derived; the arc and the fill move with the pose', () => {
    const d = doc()
    for (const pose of [{ yaw: 30, pitch: -20 }, { yaw: -75, pitch: 40 }, { yaw: 12.5, pitch: 0 }]) {
      const at = d.atPose(pose), ref = oracle(d, pose)
      // the oracle went through a file, where −0 is written as 0: both compared as written
      const asFile = (x: unknown) => JSON.parse(JSON.stringify(x))
      expect(asFile(at.geometry())).toEqual(asFile(ref.geometry()))
      expect(asFile(at.snapshot())).toEqual(asFile(ref.snapshot()))
      const g = at.geometry()
      for (const k of d.views()) {
        const gk = d.in(k).geometry()
        expect(g.arcs[0]!.curve).not.toEqual(gk.arcs[0]!.curve)
        expect(g.fills[0]!.parts).not.toEqual(gk.fills[0]!.parts)
      }
    }
  })

  it('end strokes come from the posed result only: the front\'s is not left standing where the result has none', () => {
    const d = doc()
    const a = (pose: { yaw: number; pitch: number }) => d.atPose(pose).snapshot().points.find(p => p.id === 'a')!
    expect(a({ yaw: 0, pitch: 0 }).endStroke).toEqual({ cap: 'round', taper: 3 })
    expect(a({ yaw: 80, pitch: 0 }).endStroke).toBeUndefined() // the side view dominates and has none
    // the other way: none at the front, one in the dominant view → set at the pose
    d.editIn('view:-90,45', e => e.endStroke('c', { taper: 1 }))
    expect(d.atPose({ yaw: -80, pitch: 40 }).snapshot().points.find(p => p.id === 'c')!.endStroke).toEqual({ taper: 1 })
    expect(d.atPose({ yaw: -10, pitch: 5 }).snapshot().points.find(p => p.id === 'c')!.endStroke).toBeUndefined()
  })

  it('points and lines named like inherited properties (constructor, toString) keep "no end stroke" at all nine views (dot 1791685237)', () => {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => {
      e.line('toString', { id: 'constructor', layer: 'L', position: P(0) }, { id: 'toString', layer: 'L', position: P(10) })
      e.line('constructor', 'toString', { id: 'hasOwnProperty', layer: 'L', position: P(10, 10) })
    })
    d.edit(e => e.join('toString', 'toString', 'constructor', { mode: 'arc', radius: 2 }))
    d.editIn('view:90,45', e => e.move([{ id: 'hasOwnProperty', target: P(12, 9) }]))
    const before = save(d)
    for (const k of d.views()) {
      const s = d.atPose(angle(k)).snapshot()
      expect(s).toEqual(d.in(k).snapshot())
      for (const id of ['constructor', 'toString', 'hasOwnProperty']) expect(s.points.find(p => p.id === id)!.endStroke).toBeUndefined()
      expect(d.atPose(angle(k)).geometry()).toEqual(d.in(k).geometry())
    }
    expect(d.atPose({ yaw: 45, pitch: 22.5 }).snapshot().points.every(p => p.endStroke === undefined)).toBe(true)
    expect(save(d)).toBe(before)
  })
})
describe('atPose: read only', () => {
  it('changes nothing: the saved file and the undo history are the same; the scratch layer is never a view', () => {
    const d = doc()
    const before = save(d), views = d.views()
    let steps = 0; while (d.canUndo) { d.undo(); steps++ } ; for (let i = 0; i < steps; i++) d.redo()
    d.atPose({ yaw: 33, pitch: 21 }).geometry(); d.atPose({ yaw: -90, pitch: -45 }).snapshot()
    expect(save(d)).toBe(before)
    expect(d.views()).toEqual(views)
    let after = 0; while (d.canUndo) { d.undo(); after++ } ; for (let i = 0; i < after; i++) d.redo()
    expect(after).toBe(steps)
  })

  it('a file that already has a layer keyed `pose` poses correctly, and that layer is untouched', () => {
    const d = doc()
    const file = JSON.parse(save(d))
    const ls = file.document.network.shapes.layers as { key: string; kind: string }[]
    ls.push({ ...structuredClone(ls.find(l => l.key === 'view:90,0')!), key: 'pose', kind: 'expression' })
    const jl = file.document.joins.layers as { key: string }[] | undefined
    if (jl) jl.push({ ...structuredClone(jl.find(l => l.key === 'view:90,0')!), key: 'pose' })
    // and with `pose~1` taken too
    ls.push({ ...structuredClone(ls.find(l => l.key === 'view:90,0')!), key: 'pose~1', kind: 'expression' })
    if (jl) jl.push({ ...structuredClone(jl.find(l => l.key === 'view:90,0')!), key: 'pose~1' })
    const e = open(JSON.stringify(file)), saved = save(e)
    for (const pose of [{ yaw: 0, pitch: 0 }, { yaw: 40, pitch: 10 }]) expect(e.atPose(pose).geometry()).toEqual(d.atPose(pose).geometry())
    expect(save(e)).toBe(saved)
  })

  it('a pose outside the domain is a refusal; the model is a copy; the reader offers only reads: snapshot, geometry and the joins\' zones (J1b)', () => {
    const d = doc()
    // the edges: just past each bound, not a number, infinite; the bounds themselves and −0 are inside
    for (const pose of [{ yaw: 90.0001, pitch: 0 }, { yaw: -90.0001, pitch: 0 }, { yaw: 0, pitch: 45.0001 }, { yaw: 0, pitch: -45.0001 }, { yaw: NaN, pitch: 0 }, { yaw: 0, pitch: NaN }, { yaw: Infinity, pitch: 0 }, { yaw: 0, pitch: -Infinity }]) {
      let err: unknown
      try { d.atPose(pose) } catch (x) { err = x }
      expect(err).toBeInstanceOf(Refusal)
      expect((err as Refusal).code).toBe('pose-out-of-range')
    }
    for (const pose of [{ yaw: 90, pitch: 45 }, { yaw: -90, pitch: -45 }, { yaw: -0, pitch: -0 }]) expect(() => d.atPose(pose)).not.toThrow()
    const m = d.model()
    ;(m.views[0]!.points.a as { x: number }).x = 999
    expect(d.model().views[0]!.points.a!.x).not.toBe(999)
    const r = d.atPose({ yaw: 10, pitch: 10 })
    // linesInRect: a read for playback's box (docs/playback-tools-checklist.md §1)
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(r)).sort()).toEqual(['constructor', 'geometry', 'linesInRect', 'snapshot', 'zones'])
  })
})

describe('joins.setRadiusHere (the scratch layer\'s radius writer)', () => {
  it('writes the bound layer only; refuses a missing row, a row that is not an arc, a radius that is not positive', async () => {
    const joins = await import('../src/joins')
    const net = await import('../src/network')
    const d = doc()
    const file = JSON.parse(save(d))
    const before = (k: string) => (file.document.network.shapes.layers as { key: string; radius: Record<string, number> }[]).find(l => l.key === k)!.radius
    // through the public read: change one view's radius by hand on a private state is not exposed, so check the function on a copy
    const s = (d as unknown as { state: { network: unknown; joins: unknown } }).state
    const c = structuredClone(s)
    const n = net.of(c.network as never, 'view:90,0')
    joins.setRadiusHere(c.joins as never, n, 'b', 'bc', 'ab', 7)
    const read = (k: string) => joins.rows(c.joins as never, net.of(c.network as never, k)).find(r => r.point === 'b')!.radius
    expect(read('view:90,0')).toBe(7)
    for (const k of d.views().filter(k => k !== 'view:90,0')) expect(read(k)).toBe(Object.values(before(k))[0])
    expect(() => joins.setRadiusHere(c.joins as never, n, 'c', 'bc', 'cd', 1)).toThrow(/No arc join at c/)
    expect(() => joins.setRadiusHere(c.joins as never, n, 'b', 'ab', 'bc', 0)).toThrow(/positive radius/)
    expect(() => joins.setRadiusHere(c.joins as never, n, 'b', 'ab', 'bc', NaN)).toThrow(/positive radius/)
    joins.setJoin(c.joins as never, n, 'b', 'ab', 'bc', { mode: 'cusp' })
    expect(() => joins.setRadiusHere(c.joins as never, n, 'b', 'ab', 'bc', 1)).toThrow(/No arc join at b/)
  })
})

describe('open checks the nine views (dot 1791685305)', () => {
  type L = { key: string; kind: string }
  const edited = (f: (layers: L[], joinLayers: L[] | undefined) => void) => {
    const file = JSON.parse(save(doc()))
    f(file.document.network.shapes.layers, file.document.joins.layers)
    return JSON.stringify(file)
  }
  it('a file missing a view, with a view renamed, or with an extra view layer is refused; extra expression or record layers are not', () => {
    expect(() => open(edited(ls => { ls.splice(ls.findIndex(l => l.key === 'view:90,45'), 1) }))).toThrow(/open-failed: the view layers must be the nine views; missing view:90,45/)
    expect(() => open(edited(ls => { ls.find(l => l.key === 'view:-90,0')!.key = 'side' }))).toThrow(/missing view:-90,0; not a view key: side/)
    expect(() => open(edited(ls => { ls.find(l => l.key === 'view:0,45')!.key = 'view:30,0' }))).toThrow(/missing view:0,45; not a view key: view:30,0/)
    expect(() => open(edited(ls => { ls.push({ ...structuredClone(ls.find(l => l.key === 'view:90,0')!), key: 'view:extra' }) }))).toThrow(/not a view key: view:extra/)
    expect(() => open(edited(ls => { ls.push({ ...structuredClone(ls.find(l => l.key === 'view:90,0')!), key: 'pose', kind: 'expression' }) }))).not.toThrow()
  })
})

