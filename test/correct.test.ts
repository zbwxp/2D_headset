// Stage 3b, package 3 (docs/stage3b-pkg3-correct.md; rules accepted by dot 1791691453, edges-only
// scope confirmed by bowen 1791692031): `correct(pose, targets)` on an edge between neighbouring
// views. A drag at the pose becomes one knot per dragged control and axis; no view moves.
import { describe, it, expect } from 'vitest'
import { Core, save, open, Refusal, type Vec } from '../src'
import { EDGES, angle } from '../src/views'

const P = (x: number, y = 0): Vec => ({ x, y })
const FRONT = 'view:0,0', SIDE = 'view:90,0'
const E_FS = 'view:0,0>view:90,0'
type Pose = { yaw: number; pitch: number }
type Knots = [number, number][]
type Anim = { points: Record<string, Record<string, { x?: Knots; y?: Knots }>>; handles: Record<string, Record<string, Record<string, { x?: Knots; y?: Knots }>>> }

const anim = (d: Core): Anim => JSON.parse(save(d)).document.animation
const pos = (d: Core, pose: Pose, id: string) => d.atPose(pose).snapshot().points.find(p => p.id === id)!.position
const line = (d: Core, pose: Pose, id: string) => d.atPose(pose).snapshot().lines.find(l => l.id === id)!
const at = (d: Core, k: string, id: string) => d.in(k).snapshot().points.find(p => p.id === id)!.position
/** The refusal code (or the message) of a failed call. */
function code(f: () => void): string {
  try { f() } catch (x) { return x instanceof Refusal ? x.code : (x as Error).message }
  return 'no refusal'
}
/** Within the final check's tolerance: 1e-9 · max(1, |q|). */
const near = (got: number, q: number) => Math.abs(got - q) <= 1e-9 * Math.max(1, Math.abs(q))
/** A document opened from `d`'s file after `f` has edited its responses. */
function withResponses(d: Core, f: (a: Anim) => void): Core {
  const file = JSON.parse(save(d))
  f(file.document.animation)
  return open(JSON.stringify(file))
}
/** Everything but the responses (views, records, structure). */
const rest = (d: Core) => { const doc = JSON.parse(save(d)).document; delete doc.animation; return JSON.stringify(doc) }

/** ab, bc in L; b moved in the side view: front (10, 0), side (20, 10). */
function base() {
  const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
  d.edit(e => { e.line('ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(10) }); e.line('bc', 'b', { id: 'c', layer: 'L', position: P(20) }) })
  d.editIn(SIDE, e => e.move([{ id: 'b', target: P(20, 10) }]))
  return d
}

/** b at a different place in every view, on both axes, so every edge has a span. */
function everywhere() {
  const d = base()
  for (const e of EDGES) for (const k of [e.inner, e.outer]) {
    const { yaw, pitch } = angle(k)
    d.editIn(k, x => x.move([{ id: 'b', target: P(10 + yaw / 9 + pitch / 4.5 + (yaw * pitch) / 400, 50 + yaw / 6 + pitch / 3) }]))
  }
  return d
}
/** The pose at progress 0.25 along an edge. */
function quarter(e: { inner: string; outer: string }): Pose {
  const i = angle(e.inner), o = angle(e.outer)
  return i.yaw !== o.yaw ? { yaw: o.yaw * 0.25, pitch: i.pitch } : { yaw: i.yaw, pitch: o.pitch * 0.25 }
}

describe('the pose', () => {
  it('each of the 12 edges: the drag is reached at the pose, one knot per axis at t = 0.25 on that edge only, and every other edge is unchanged', () => {
    for (const e of EDGES) {
      const d = everywhere(), pose = quarter(e)
      const others = EDGES.filter(x => x !== e).map(x => [quarter(x), pos(d, quarter(x), 'b')] as const)
      const q = { x: pos(d, pose, 'b').x + 1, y: pos(d, pose, 'b').y - 2 }
      d.edit(x => x.correct(pose, { points: [{ id: 'b', position: q }] }))
      const got = pos(d, pose, 'b')
      expect([e.key, near(got.x, q.x), near(got.y, q.y)]).toEqual([e.key, true, true])
      const r = anim(d).points.b!
      expect(Object.keys(r)).toEqual([e.key])
      expect([r[e.key]!.x!.map(k => k[0]), r[e.key]!.y!.map(k => k[0])]).toEqual([[0.25], [0.25]])
      for (const [p, v] of others) expect([e.key, p, pos(d, p, 'b')]).toEqual([e.key, p, v])
    }
  })

  it('at a view: correction-at-view; inside a cell: correction-off-edge; outside the domain: pose-out-of-range', () => {
    const d = base(), t = { points: [{ id: 'b', position: P(1, 1) }] }
    for (const pose of [{ yaw: 0, pitch: 0 }, { yaw: 90, pitch: 45 }, { yaw: -90, pitch: 0 }, { yaw: -0, pitch: -45 }]) expect(code(() => d.edit(e => e.correct(pose, t)))).toBe('correction-at-view')
    for (const pose of [{ yaw: 30, pitch: 20 }, { yaw: -89, pitch: 1 }]) expect(code(() => d.edit(e => e.correct(pose, t)))).toBe('correction-off-edge')
    for (const pose of [{ yaw: 91, pitch: 0 }, { yaw: 0, pitch: -46 }, { yaw: NaN, pitch: 0 }, { yaw: Infinity, pitch: 0 }]) expect(code(() => d.edit(e => e.correct(pose, t)))).toBe('pose-out-of-range')
  })

  it('a pose read as a view by evaluate is a view here too: a pitch so small that |pitch| / 45 is 0 is the yaw-0 view', () => {
    const d = base()
    expect(code(() => d.edit(e => e.correct({ yaw: 0, pitch: 5e-324 }, { points: [{ id: 'b', position: P(1, 1) }] })))).toBe('correction-at-view')
  })
})

describe('per control and axis', () => {
  it('already met writes nothing: the same position, or an axis not dragged (also where both views are equal on it)', () => {
    const d = base(), before = save(d), pose = { yaw: 45, pitch: 0 }
    d.edit(e => e.correct(pose, { points: [{ id: 'b', position: pos(d, pose, 'b') }] }))
    expect(save(d)).toBe(before)
    // c is equal on both axes in both views; given with its own position, nothing is refused
    d.edit(e => e.correct(pose, { points: [{ id: 'b', position: { x: 18, y: pos(d, pose, 'b').y } }, { id: 'c', position: P(20) }] }))
    expect(anim(d).points).toEqual({ b: { [E_FS]: { x: [[0.5, 0.8]] } } })
  })

  it('reachable: the knot is the blend that shows the target, and the pose shows it', () => {
    const d = base(), pose = { yaw: 45, pitch: 0 }
    d.edit(e => e.correct(pose, { points: [{ id: 'b', position: P(18, 2) }] }))
    expect(anim(d).points.b).toEqual({ [E_FS]: { x: [[0.5, 0.8]], y: [[0.5, 0.2]] } })
    expect(pos(d, pose, 'b')).toEqual(P(18, 2))
    // the views are not moved
    expect([at(d, FRONT, 'b'), at(d, SIDE, 'b')]).toEqual([P(10), P(20, 10)])
  })

  it('a second correction at another t keeps the first one\'s coordinate exactly; one at the same t replaces its knot', () => {
    const d = base()
    d.edit(e => e.correct({ yaw: 22.5, pitch: 0 }, { points: [{ id: 'b', position: P(17, 1) }] }))
    const first = pos(d, { yaw: 22.5, pitch: 0 }, 'b')
    d.edit(e => e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'b', position: P(12, 9) }] }))
    expect(pos(d, { yaw: 22.5, pitch: 0 }, 'b')).toEqual(first)
    expect(anim(d).points.b![E_FS]!.x!.map(k => k[0])).toEqual([0.25, 0.5])
    d.edit(e => e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'b', position: P(15, 5) }] }))
    expect(anim(d).points.b![E_FS]).toEqual({ x: [[0.25, 0.7], [0.5, 0.5]], y: [[0.25, 0.1], [0.5, 0.5]] })
    expect(pos(d, { yaw: 22.5, pitch: 0 }, 'b')).toEqual(first)
  })

  it('an axis equal in both views and dragged: correction-axis-fixed, naming the control, axis and edge', () => {
    const d = base(), before = save(d)
    expect(() => d.edit(e => e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'c', position: P(20, 3) }] }))).toThrow(/correction-axis-fixed: point c, axis y, is equal in both views of view:0,0>view:90,0/)
    expect(save(d)).toBe(before)
  })

  it('a span too small for the target gives a non-finite knot: correction-not-finite', () => {
    const d = base()
    d.edit(e => e.line('zw', { id: 'z', layer: 'L', position: P(0, 50) }, { id: 'w', layer: 'L', position: P(5, 60) }))
    d.editIn(SIDE, e => e.move([{ id: 'z', target: P(5e-324, 50) }]))
    expect(code(() => d.edit(e => e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'z', position: P(1e308, 50) }] })))).toBe('correction-not-finite')
  })

  it('256 knots and one more: correction-too-many-knots; at an existing knot\'s t it replaces and goes through', () => {
    const knots: Knots = Array.from({ length: 256 }, (_, i) => [(i + 1) / 512, (i + 1) / 512])
    const d = withResponses(base(), a => { a.points.b = { [E_FS]: { x: knots } } })
    expect(code(() => d.edit(e => e.correct({ yaw: 67.5, pitch: 0 }, { points: [{ id: 'b', position: P(19, pos(d, { yaw: 67.5, pitch: 0 }, 'b').y) }] })))).toBe('correction-too-many-knots')
    // t = 0.25 is knot 128 (dyadic, so 22.5 / 90 is exactly 128 / 512)
    d.edit(e => e.correct({ yaw: 22.5, pitch: 0 }, { points: [{ id: 'b', position: P(15, pos(d, { yaw: 22.5, pitch: 0 }, 'b').y) }] }))
    expect(anim(d).points.b![E_FS]!.x!.length).toBe(256)
    expect(anim(d).points.b![E_FS]!.x![127]).toEqual([0.25, 0.5])
  })
})

describe('handles', () => {
  it('a handle vector target, at both ends; the end points do not move at the pose', () => {
    const d = base()
    d.editIn(SIDE, e => { e.moveHandle('bc', 'a', P(4, 4)); e.moveHandle('bc', 'b', P(-2, 6)) })
    const pose = { yaw: 45, pitch: 0 }, b = pos(d, pose, 'b'), c = pos(d, pose, 'c')
    d.edit(e => e.correct(pose, { handles: [{ line: 'bc', end: 'a', vector: P(3, 1) }, { line: 'bc', end: 'b', vector: P(-1, 1) }] }))
    const l = line(d, pose, 'bc')
    expect([near(l.ha.x, 3), near(l.ha.y, 1), near(l.hb.x, -1), near(l.hb.y, 1)]).toEqual([true, true, true, true])
    expect([pos(d, pose, 'b'), pos(d, pose, 'c')]).toEqual([b, c])
    expect(anim(d).points).toEqual({})
    expect(Object.keys(anim(d).handles.bc!).sort()).toEqual(['a', 'b'])
  })
})

describe('numbers (dot 1791691300, 1791691388)', () => {
  it('views at −1e308 and 1e308: at t = 0.25 (the pose shows −5e307) the target 0 is solved as 0.5, and the pose shows exactly 0', () => {
    const d = base()
    d.edit(e => e.line('zw', { id: 'z', layer: 'L', position: P(-1e308, 50) }, { id: 'w', layer: 'L', position: P(5, 60) }))
    d.editIn(SIDE, e => e.move([{ id: 'z', target: P(1e308, 50) }]))
    const pose = { yaw: 22.5, pitch: 0 }
    expect(pos(d, pose, 'z').x).toBeLessThan(-4e307) // −5e307 up to rounding: the solve really runs
    d.edit(e => e.correct(pose, { points: [{ id: 'z', position: P(0, 50) }] }))
    expect(anim(d).points.z).toEqual({ [E_FS]: { x: [[0.25, 0.5]] } })
    expect(pos(d, pose, 'z').x).toBe(0)
  })

  it('views at −1e12 and 1e12, target 1e-5: the knot rounds to 0.5, the pose stays at 0, so the drag is refused (correction-not-reproduced), the state unchanged', () => {
    const d = base()
    d.edit(e => e.line('zw', { id: 'z', layer: 'L', position: P(-1e12, 50) }, { id: 'w', layer: 'L', position: P(5, 60) }))
    d.editIn(SIDE, e => e.move([{ id: 'z', target: P(1e12, 50) }]))
    const before = save(d)
    expect(() => d.edit(e => e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'z', position: P(1e-5, 50) }] }))).toThrow(/correction-not-reproduced: point z shows 0 on axis x at this pose, not its target 0.00001/)
    expect(save(d)).toBe(before)
  })

  it('the tolerance follows the target, not the views: 1e3 next to ±1e12 is refused, the same drag between 0 and 2e3 goes through', () => {
    const big = base()
    big.edit(e => e.line('zw', { id: 'z', layer: 'L', position: P(-1e12, 50) }, { id: 'w', layer: 'L', position: P(5, 60) }))
    big.editIn(SIDE, e => e.move([{ id: 'z', target: P(1e12, 50) }]))
    expect(code(() => big.edit(e => e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'z', position: P(1000.3, 50) }] })))).toBe('correction-not-reproduced')
    const small = base()
    small.edit(e => e.line('zw', { id: 'z', layer: 'L', position: P(0, 50) }, { id: 'w', layer: 'L', position: P(5, 60) }))
    small.editIn(SIDE, e => e.move([{ id: 'z', target: P(2000, 50) }]))
    small.edit(e => e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'z', position: P(1000.3, 50) }] }))
    expect(near(pos(small, { yaw: 45, pitch: 0 }, 'z').x, 1000.3)).toBe(true)
  })
})

describe('linked points', () => {
  /** b in L linked to m in M (both at b's place in every view). */
  function linked() {
    const d = base()
    d.edit(e => { e.layer('M', 'M'); e.line('mn', { id: 'm', layer: 'M', position: P(10, 0.5) }, { id: 'n', layer: 'M', position: P(10, 30) }) })
    d.edit(e => e.link('b', 'm'))
    return d
  }

  it('a target on one member writes every member identically; they evaluate bit-identically; the member reached by the link is a target, not "unchanged"', () => {
    const d = linked(), pose = { yaw: 45, pitch: 0 }
    expect(pos(d, pose, 'm')).toEqual(pos(d, pose, 'b'))
    d.edit(e => e.correct(pose, { points: [{ id: 'm', position: P(18, 2) }] }))
    const a = anim(d)
    expect(a.points.b).toEqual({ [E_FS]: { x: [[0.5, 0.8]], y: [[0.5, 0.2]] } })
    expect(a.points.m).toEqual(a.points.b)
    for (const yaw of [10, 45, 80]) expect(pos(d, { yaw, pitch: 0 }, 'm')).toEqual(pos(d, { yaw, pitch: 0 }, 'b'))
    // a file with these responses opens (linked points hold identical sets)
    expect(anim(open(save(d)))).toEqual(a)
  })

  it('only one member given, the other ending a locked line: locked, naming that line', () => {
    const d = linked()
    d.edit(e => e.lineState('mn', { locked: true }))
    let err: unknown
    try { d.edit(e => e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'b', position: P(18, 2) }] })) } catch (x) { err = x }
    expect([(err as Refusal).code, (err as Refusal).objects]).toEqual(['locked', [{ kind: 'line', id: 'mn' }]])
  })

  it('members given different targets: correction-link-conflict; the same target twice is accepted', () => {
    const d = linked(), pose = { yaw: 45, pitch: 0 }
    expect(code(() => d.edit(e => e.correct(pose, { points: [{ id: 'b', position: P(18, 2) }, { id: 'm', position: P(18, 3) }] })))).toBe('correction-link-conflict')
    d.edit(e => e.correct(pose, { points: [{ id: 'b', position: P(18, 2) }, { id: 'm', position: P(18, 2) }] }))
    expect(pos(d, pose, 'm')).toEqual(P(18, 2))
  })

  it('points not reached and handle vectors not given stay exactly as they were, at the pose and on every edge', () => {
    const d = linked()
    d.editIn(SIDE, e => { e.moveHandle('ab', 'b', P(-3, 3)); e.move([{ id: 'n', target: P(14, 40) }]) })
    const poses = [{ yaw: 45, pitch: 0 }, { yaw: 20, pitch: 0 }, { yaw: 0, pitch: 20 }]
    const keep = poses.map(p => [pos(d, p, 'a'), pos(d, p, 'c'), pos(d, p, 'n'), line(d, p, 'ab'), line(d, p, 'bc'), line(d, p, 'mn')])
    d.edit(e => e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'b', position: P(18, 2) }] }))
    expect(poses.map(p => [pos(d, p, 'a'), pos(d, p, 'c'), pos(d, p, 'n'), line(d, p, 'ab'), line(d, p, 'bc'), line(d, p, 'mn')])).toEqual(keep)
  })
})

describe('locks', () => {
  it('a target on a locked line, through a point or through a handle: locked; nothing is written', () => {
    const d = base()
    d.editIn(SIDE, e => e.moveHandle('ab', 'a', P(2, 2)))
    d.edit(e => e.lineState('ab', { locked: true }))
    const before = save(d)
    expect(code(() => d.edit(e => e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'b', position: P(18, 2) }] })))).toBe('locked')
    expect(code(() => d.edit(e => e.correct({ yaw: 45, pitch: 0 }, { handles: [{ line: 'ab', end: 'a', vector: P(1, 2) }] })))).toBe('locked')
    expect(save(d)).toBe(before)
    // a line not locked is corrected as usual
    d.editIn(SIDE, e => e.move([{ id: 'c', target: P(30, 4) }]))
    d.edit(e => e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'c', position: P(24, 3) }] }))
  })
})

describe('the final check', () => {
  it('a non-dyadic knot is kept exactly: [0.79, 0] stays at its recorded t when [0.9, 0.25] is added', () => {
    const d0 = base()
    d0.edit(e => e.line('zw', { id: 'z', layer: 'L', position: P(0, 50) }, { id: 'w', layer: 'L', position: P(5, 60) }))
    d0.editIn(SIDE, e => e.move([{ id: 'z', target: P(1, 50) }]))
    const d = withResponses(d0, a => { a.points.z = { [E_FS]: { x: [[0.79, 0]] } } })
    d.edit(e => e.correct({ yaw: 81, pitch: 0 }, { points: [{ id: 'z', position: P(0.25, 50) }] }))
    expect(anim(d).points.z).toEqual({ [E_FS]: { x: [[0.79, 0], [0.9, 0.25]] } })
    expect(pos(d, { yaw: 81, pitch: 0 }, 'z').x).toBe(0.25)
  })
})

describe('the transaction', () => {
  it('it stands alone: with a move, stage2-alone; with a select, allowed', () => {
    const d = base()
    expect(code(() => d.edit(e => { e.move([{ id: 'a', target: P(-1) }]); e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'b', position: P(18, 2) }] }) }))).toBe('stage2-alone')
    expect(code(() => d.edit(e => { e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'b', position: P(18, 2) }] }); e.correct({ yaw: 20, pitch: 0 }, { points: [{ id: 'b', position: P(13, 1) }] }) }))).toBe('stage2-alone')
    d.edit(e => { e.select([{ kind: 'line', id: 'ab' }]); e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'b', position: P(18, 2) }] }) })
    expect(d.snapshot().selection).toEqual([{ kind: 'line', id: 'ab' }])
    expect(pos(d, { yaw: 45, pitch: 0 }, 'b')).toEqual(P(18, 2))
  })

  it('one undo step restores the responses; redo brings them back; nothing else changes (views, records, structure)', () => {
    const d = base(), before = save(d), others = rest(d)
    d.edit(e => e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'b', position: P(18, 2) }] }))
    expect(rest(d)).toBe(others)
    const after = save(d)
    d.undo()
    expect(save(d)).toBe(before)
    d.redo()
    expect(save(d)).toBe(after)
  })
})

describe('ids', () => {
  it('points and lines named __proto__, constructor and toString are ordinary controls', () => {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => e.line('constructor', { id: '__proto__', layer: 'L', position: P(0) }, { id: 'toString', layer: 'L', position: P(10) }))
    d.editIn(SIDE, e => { e.move([{ id: 'toString', target: P(20, 10) }]); e.moveHandle('constructor', 'a', P(4, 4)) })
    const pose = { yaw: 45, pitch: 0 }
    d.edit(e => e.correct(pose, { points: [{ id: 'toString', position: P(18, 2) }], handles: [{ line: 'constructor', end: 'a', vector: P(3, 3.5) }] }))
    const a = anim(d)
    expect(Object.hasOwn(a.points, 'toString') && Object.hasOwn(a.handles, 'constructor') && !Object.hasOwn(a.points, '__proto__')).toBe(true)
    expect(pos(d, pose, 'toString')).toEqual(P(18, 2))
    expect(pos(d, pose, '__proto__')).toEqual(P(0))
    expect(code(() => d.edit(e => e.correct(pose, { points: [{ id: 'hasOwnProperty', position: P(1) }] })))).toBe('correction-bad-target')
    expect(anim(open(save(d)))).toEqual(a)
  })
})

describe('bad targets', () => {
  it('an unknown point or line, a duplicate, an end other than a / b, a non-finite number: correction-bad-target', () => {
    const d = base(), before = save(d), pose = { yaw: 45, pitch: 0 }
    const bad: unknown[] = [
      { points: [{ id: 'nope', position: P(1) }] },
      { points: [{ id: 'b', position: P(18, 2) }, { id: 'b', position: P(18, 2) }] },
      { points: [{ id: 'b', position: P(NaN, 2) }] },
      { points: [{ id: 'b', position: { x: 1 } }] },
      { handles: [{ line: 'nope', end: 'a', vector: P(1) }] },
      { handles: [{ line: 'ab', end: 'c', vector: P(1) }] },
      { handles: [{ line: 'ab', end: 'a', vector: P(1) }, { line: 'ab', end: 'a', vector: P(1) }] },
      { handles: [{ line: 'ab', end: 'b', vector: P(Infinity) }] },
      { points: {} },
    ]
    for (const t of bad) expect([t, code(() => d.edit(e => e.correct(pose, t as never)))]).toEqual([t, 'correction-bad-target'])
    expect(save(d)).toBe(before)
  })
})
