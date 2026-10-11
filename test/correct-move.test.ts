// Stage 3b, package 4 (docs/stage3b-pkg4-move.md; rules accepted by dot 1791694943 at ac7a315):
// on an edge from the front, an axis equal in both views moves the outer view O minimally; the old
// knots on O's edges are re-solved; the final check runs on the settled trial against the draft on
// entry, per axis. The numeric cases are fixed inputs, reproducible (dot 1791694943).
import { describe, it, expect } from 'vitest'
import { Core, save, open, Refusal, type Vec } from '../src'
import { solveMove, solveScaled, MOVE_COST } from '../src/animation'
import { onEdge, evaluate, type Model } from '../src/evaluate'

const P = (x: number, y = 0): Vec => ({ x, y })
const FRONT = 'view:0,0', SIDE = 'view:90,0', UP = 'view:0,45', CORNER = 'view:90,45'
const E_FS = 'view:0,0>view:90,0', E_SC = 'view:90,0>view:90,45'
type Knots = [number, number][]
type Doc = {
  network: { shapes: { layers: { key: string; points: Record<string, Vec>; lines: Record<string, { ha: Vec; hb: Vec }> }[] } }
  animation: { points: Record<string, Record<string, { x?: Knots; y?: Knots }>>; handles: Record<string, unknown> }
}

const anim = (d: Core) => JSON.parse(save(d)).document.animation as Doc['animation']
const pos = (d: Core, pose: { yaw: number; pitch: number }, id: string) => d.atPose(pose).snapshot().points.find(p => p.id === id)!.position
const at = (d: Core, k: string, id: string) => d.in(k).snapshot().points.find(p => p.id === id)!.position
const handleIn = (d: Core, k: string, line: string, end: 'a' | 'b') => { const l = d.in(k).snapshot().lines.find(x => x.id === line)!; return end === 'a' ? l.ha : l.hb }
const near = (got: number, q: number) => Math.abs(got - q) <= 1e-9 * Math.max(1, Math.abs(q))
function refusal(f: () => void): Refusal {
  try { f() } catch (x) { if (x instanceof Refusal) return x; throw x }
  throw new Error('no refusal')
}
/** A document opened from `d`'s file after `f` has edited its document part. */
function viaFile(d: Core, f: (doc: Doc) => void): Core {
  const file = JSON.parse(save(d))
  f(file.document)
  return open(JSON.stringify(file))
}
const layer = (doc: Doc, k: string) => doc.network.shapes.layers.find(l => l.key === k)!
/** Every view's snapshot except `skip`, and the angle record, as text. */
const others = (d: Core, skip: string) => JSON.stringify(d.views().filter(k => k !== skip).map(k => d.in(k).snapshot().points.map(p => [p.id, p.position])))

/** ab, bc in L: a (0, 0), b (10, 0), c (20, 0); b at (20, 10) in the side view. c is equal in every view. */
function base() {
  const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
  d.edit(e => { e.line('ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(10) }); e.line('bc', 'b', { id: 'c', layer: 'L', position: P(20) }) })
  d.editIn(SIDE, e => e.move([{ id: 'b', target: P(20, 10) }]))
  return d
}
/** The scale S of a correction on front → side in `base()`: x extent 20, y extent 10. */
const S_BASE = 20

describe('the move case: O moves, by the cost', () => {
  it('a yaw edge: c dragged in y at yaw 45 moves the side view to A + c / w, w the solver\'s; x and every other scalar stay exactly; one knot', () => {
    const d = base(), pose = { yaw: 45, pitch: 0 }, frontBefore = others(d, SIDE), sideB = at(d, SIDE, 'b')
    const w = solveMove(3, 0.5, MOVE_COST.point, S_BASE)!
    d.edit(e => e.correct(pose, { points: [{ id: 'c', position: P(20, 3) }] }))
    expect(at(d, SIDE, 'c')).toEqual(P(20, 3 / w))
    expect(anim(d).points.c).toEqual({ [E_FS]: { y: [[0.5, w]] } })
    const got = pos(d, pose, 'c')
    expect([got.x, near(got.y, 3)]).toEqual([20, true])
    expect(others(d, SIDE)).toBe(frontBefore)
    expect(at(d, SIDE, 'b')).toEqual(sideB)
    // the independent root check: w = √a · z with z³(z − ρ) = 1
    const sa = Math.sqrt(3 / S_BASE * Math.sqrt(MOVE_COST.point / MOVE_COST.response)), z = w / sa, rho = 0.5 / sa
    expect(Math.abs(z ** 3 * (z - rho) - 1)).toBeLessThan(1e-12)
    // one undo step reverts the knot and the side view
    d.undo()
    expect([at(d, SIDE, 'c'), anim(d).points]).toEqual([P(20), {}])
  })

  it('a pitch edge: front → (0, 45) moves the up view', () => {
    const d = base(), pose = { yaw: 0, pitch: 22.5 }, rest = others(d, UP)
    d.edit(e => e.correct(pose, { points: [{ id: 'c', position: P(20, 3) }] }))
    expect(at(d, UP, 'c').y).toBeGreaterThan(0)
    expect(at(d, UP, 'c').x).toBe(20)
    expect(near(pos(d, pose, 'c').y, 3)).toBe(true)
    expect(others(d, UP)).toBe(rest)
    expect(Object.keys(anim(d).points.c!)).toEqual(['view:0,0>view:0,45'])
  })

  it('end points cost more than handles: the same drag moves a point less than a handle', () => {
    const d1 = base(), d2 = base(), pose = { yaw: 45, pitch: 0 }
    d1.edit(e => e.correct(pose, { points: [{ id: 'c', position: P(20, 2) }] }))
    const hv = handleIn(d2, FRONT, 'bc', 'b')
    d2.edit(e => e.correct(pose, { handles: [{ line: 'bc', end: 'b', vector: { x: hv.x, y: hv.y + 2 } }] }))
    const pointMove = at(d1, SIDE, 'c').y, handleMove = handleIn(d2, SIDE, 'bc', 'b').y - hv.y
    expect(pointMove).toBeGreaterThan(0)
    expect(handleMove).toBeGreaterThan(pointMove)
  })

  it('S is read from the front and O together: the side view\'s larger extent sets it', () => {
    const d = base()
    d.editIn(SIDE, e => e.move([{ id: 'b', target: P(60, 10) }])) // x extent: front 20, side 60
    d.edit(e => e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'c', position: P(20, 3) }] }))
    expect(anim(d).points.c![E_FS]!.y![0]![1]).toBe(solveMove(3, 0.5, MOVE_COST.point, 60))
  })

  it('S has its floor: a drawing whose front and side span 1e-8 is solved with S = 1e-6', () => {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => e.line('ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(1e-8) }))
    d.edit(e => e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'b', position: P(1e-8, 1e-9) }] }))
    expect(anim(d).points.b!['view:0,0>view:90,0']!.y![0]![1]).toBe(solveMove(1e-9, 0.5, MOVE_COST.point, MOVE_COST.scaleFloor))
  })

  it('an A ≠ B axis never moves O; an equal axis on an edge not from the front is refused', () => {
    const d = base(), sideBefore = d.in(SIDE).snapshot()
    d.edit(e => e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'b', position: P(18, 2) }] }))
    expect(d.in(SIDE).snapshot()).toEqual(sideBefore)
    expect(refusal(() => d.edit(e => e.correct({ yaw: 90, pitch: 22.5 }, { points: [{ id: 'c', position: P(20, 3) }] }))).code).toBe('correction-axis-fixed')
  })

  it('the target equal to A itself (c = 0) where the pose shows A only up to rounding: the knot [t, 0], nothing moves', () => {
    // A = 0.1 in both views, an earlier knot r with (1 − r)·0.1 + r·0.1 ≠ 0.1
    const r = [0.3, 0.7, 0.9, 0.15, 0.45].find(x => (1 - x) * 0.1 + x * 0.1 !== 0.1)!
    const d0 = base()
    d0.edit(e => e.line('zw', { id: 'z', layer: 'L', position: P(0.1, 0.1) }, { id: 'w', layer: 'L', position: P(5, 60) }))
    const d = viaFile(d0, doc => { doc.animation.points.z = { [E_FS]: { y: [[0.5, r]] } } })
    const pose = { yaw: 45, pitch: 0 }
    expect(pos(d, pose, 'z').y).not.toBe(0.1)
    d.edit(e => e.correct(pose, { points: [{ id: 'z', position: P(pos(d, pose, 'z').x, 0.1) }] }))
    expect(anim(d).points.z).toEqual({ [E_FS]: { y: [[0.5, 0]] } })
    expect([pos(d, pose, 'z').y, at(d, SIDE, 'z')]).toEqual([0.1, P(0.1, 0.1)])
  })
})

describe('the solver (fixed inputs, reproducible; dot 1791694778, 1791694943)', () => {
  const phi = (z: number, rho: number) => 1 / z / z + (z - rho) * (z - rho)

  it('ρ = r = 2⁵³ with √a = 1: the candidate is r, and its cost is compared with r + 2\'s', () => {
    const rho = 2 ** 53, z = solveScaled(rho)!
    expect(z).toBe(rho)
    expect(phi(z, rho)).toBeLessThan(phi(rho + 2, rho))
    expect(phi(rho + 2, rho)).toBeGreaterThan(3.9)
  })

  it('the branch follows r\'s sign: a tiny negative r takes the negative branch; 0 and −0 the positive one', () => {
    expect(solveMove(3, -1e-300, 16, 1)!).toBeLessThan(0)
    expect(solveMove(3, 0, 16, 1)!).toBeGreaterThan(0)
    expect(solveMove(3, -0, 16, 1)!).toBeGreaterThan(0)
    expect(solveMove(-3, 0.5, 16, 1)!).toBeGreaterThan(0) // the drag's sign is in c / w, not in w
  })

  it('K would underflow (c = 1e-200, S = 1, r = 0): a finite move; a overflows: no solution; |ρ| > 2⁵³: w = r exactly', () => {
    const w = solveMove(1e-200, 0, 16, 1)!
    expect(Number.isFinite(w) && w > 0).toBe(true)
    expect(Number.isFinite(1e-200 / w)).toBe(true)
    expect(solveMove(1e308, 0.5, 16, 1e-6)).toBeUndefined()
    expect(solveMove(1e-10, 1e20, 16, 1)).toBe(1e20)
  })

  it('every ρ of a fixed grid has a candidate that solves z³(z − ρ) = 1 within rounding, and not worse than the other end of its bracket', () => {
    const grid = [0, -0, 5e-324, -5e-324, 1e-300, -1e-300, 1e-16, -1e-16, 1.0678e-16, 0.5, -0.5, 1, -1, 3, -3, 1e15, -1e15, 2 ** 53, -(2 ** 53), 2 ** 60, 1e300, -1e300, 1.7e308, -1.7e308,
      ...Array.from({ length: 61 }, (_, i) => 10 ** (i - 30)), ...Array.from({ length: 61 }, (_, i) => -(10 ** (i - 30)))]
    for (const rho of grid) {
      const z = solveScaled(rho)
      expect([rho, z !== undefined && z !== 0]).toEqual([rho, true])
      if (Math.abs(z!) < 1e70 && Math.abs(z!) > 1e-70 && Math.abs(rho) < 1e15) expect([rho, Math.abs(z! ** 3 * (z! - rho) - 1) < 1e-12 * Math.max(1, Math.abs(z!) ** 4)]).toEqual([rho, true])
    }
  })

  it('scaling the whole drawing by 2 keeps w above the floor of S; below it, it does not', () => {
    expect(solveMove(6, 0.5, 16, 40)).toBe(solveMove(3, 0.5, 16, 20))
    const floor = MOVE_COST.scaleFloor
    // a drawing of extent 1e-7 sits on the floor: S stays 1e-6 when scaled, so c / S doubles
    expect(solveMove(2e-8, 0.5, 16, Math.max(floor, 2e-7))).not.toBe(solveMove(1e-8, 0.5, 16, Math.max(floor, 1e-7)))
  })
})

describe('old targets (protected knots)', () => {
  it('a knot on O → corner keeps its value after O moves (re-solved, within 1e-9)', () => {
    const d0 = base()
    d0.editIn(CORNER, e => e.move([{ id: 'c', target: P(20, 10) }]))
    const d = viaFile(d0, doc => { doc.animation.points.c = { [E_SC]: { y: [[0.5, 0.3]] } } })
    const kept = pos(d, { yaw: 90, pitch: 22.5 }, 'c').y
    expect(near(kept, 3)).toBe(true)
    d.edit(e => e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'c', position: P(20, 3) }] }))
    expect(at(d, SIDE, 'c').y).toBeGreaterThan(0)
    expect(near(pos(d, { yaw: 90, pitch: 22.5 }, 'c').y, kept)).toBe(true)
    expect(anim(d).points.c![E_SC]!.y![0]![1]).not.toBe(0.3)
  })

  it('the corner equal to O\'s new value: an old target equal to it is kept, a different one refuses correction-breaks-target', () => {
    const w = solveMove(3, 0.5, MOVE_COST.point, S_BASE)!, moved = 0 + 3 / w
    const setup = (r: number) => {
      const d0 = base()
      d0.editIn(CORNER, e => e.move([{ id: 'c', target: P(20, moved) }]))
      return viaFile(d0, doc => { doc.animation.points.c = { [E_SC]: { y: [[0.5, r]] } } })
    }
    const keep = setup(1) // shows the corner's value, moved, exactly
    keep.edit(e => e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'c', position: P(20, 3) }] }))
    expect(anim(keep).points.c![E_SC]).toEqual({ y: [[0.5, 1]] })
    const breaks = setup(0.5)
    const before = save(breaks)
    expect(refusal(() => breaks.edit(e => e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'c', position: P(20, 3) }] }))).code).toBe('correction-breaks-target')
    expect(save(breaks)).toBe(before)
  })

  it('front → O\'s other knots keep the value they showed, not A: A = B = 1 and r = 1e16 show 0, and still show 0 (dot 1791694396)', () => {
    const d0 = base()
    d0.edit(e => e.line('zw', { id: 'z', layer: 'L', position: P(30, 1) }, { id: 'w', layer: 'L', position: P(40, 60) }))
    const d = viaFile(d0, doc => { doc.animation.points.z = { [E_FS]: { y: [[0.25, 1e16]] } } })
    const shown = pos(d, { yaw: 22.5, pitch: 0 }, 'z').y
    expect(shown).toBe(onEdge([[0.25, 1e16]], 0.25, 1, 1))
    d.edit(e => e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'z', position: P(30, 2) }] }))
    expect(at(d, SIDE, 'z').y).not.toBe(1)
    expect(near(pos(d, { yaw: 22.5, pitch: 0 }, 'z').y, shown)).toBe(true)
  })
})

describe('the final check, per axis, against the draft on entry', () => {
  /** b in L linked to m in M, both at b's place; then the file moves m by `dm` in the front and in the side. */
  function linked(dFront: Vec, dSide: Vec) {
    const d0 = base()
    d0.edit(e => { e.layer('M', 'M'); e.line('mn', { id: 'm', layer: 'M', position: P(10, 0.5) }, { id: 'n', layer: 'M', position: P(10, 30) }) })
    d0.edit(e => e.link('b', 'm'))
    return viaFile(d0, doc => {
      for (const [k, dv] of [[FRONT, dFront], [SIDE, dSide]] as const) { const p = layer(doc, k).points; p.m = { x: p.m!.x + dv.x, y: p.m!.y + dv.y } }
    })
  }

  it('dot\'s linked b / m (x 0 / +1e-10 in the front, 0 / −1e-10 in O; y corrected): the settle averages x, outside the mask → refused naming the x axis (dot 1791694560)', () => {
    // b at x 0 in both views, so that b and m share y = 0 at both ends and only y is dragged
    const d0 = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d0.edit(e => { e.layer('M', 'M'); e.line('ab', { id: 'a', layer: 'L', position: P(-10, -10) }, { id: 'b', layer: 'L', position: P(0) }); e.line('mn', { id: 'm', layer: 'M', position: P(0, 0.5) }, { id: 'n', layer: 'M', position: P(10, 30) }) })
    d0.edit(e => e.link('b', 'm'))
    const d = viaFile(d0, doc => { layer(doc, FRONT).points.m = P(1e-10); layer(doc, SIDE).points.m = P(-1e-10) })
    const before = save(d), r = refusal(() => d.edit(e => e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'b', position: P(pos(d, { yaw: 45, pitch: 0 }, 'b').x, 3) }] })))
    expect([r.code, r.message]).toEqual(['correction-not-reproduced', expect.stringMatching(/changed on axis x in view:90,0/)])
    expect(save(d)).toBe(before)
  })

  it('linked members a hair apart on the moved axis get different knots: correction-link-differs, the state unchanged, the file still opens (I4)', () => {
    const d = linked(P(0, 1e-10), P(0, 1e-10)), before = save(d)
    expect(refusal(() => d.edit(e => e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'm', position: P(pos(d, { yaw: 45, pitch: 0 }, 'm').x, 3) }] }))).code).toBe('correction-link-differs')
    expect(save(d)).toBe(before)
    expect(save(open(save(d)))).toBe(before)
  })

  it('exactly linked members move together: the same knot, the same new side position', () => {
    const d = linked(P(0), P(0))
    d.edit(e => e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'c', position: P(20, 3) }] }))
    // b and m are equal on y in front and side (0 and 10): not a move case for them; c moves
    expect(at(d, SIDE, 'm')).toEqual(at(d, SIDE, 'b'))
  })

  it('states a file may hold: unaligned smooth handles and nearly coincident linked points elsewhere stay exactly; the same join at the moved point refuses (I5)', () => {
    const d0 = base()
    d0.edit(e => { e.layer('M', 'M'); e.line('pq', { id: 'p', layer: 'L', position: P(50, 50) }, { id: 'q', layer: 'L', position: P(60, 50) }); e.line('qs', 'q', { id: 's', layer: 'L', position: P(70, 60) }); e.line('uv', { id: 'u', layer: 'M', position: P(60, 50) }, { id: 'v', layer: 'M', position: P(80, 80) }) })
    d0.edit(e => { e.join('q', 'pq', 'qs', { mode: 'smooth' }); e.link('q', 'u') })
    d0.edit(e => { e.line('cd', 'c', { id: 'g', layer: 'L', position: P(30, -10) }) })
    d0.edit(e => e.join('c', 'bc', 'cd', { mode: 'smooth' }))
    const d = viaFile(d0, doc => {
      const side = layer(doc, SIDE)
      side.lines.pq!.hb = P(-3, 1) // q's smooth handles no longer aligned
      side.points.u = { x: side.points.u!.x + 1e-10, y: side.points.u!.y } // u a hair off q
      side.lines.cd!.ha = P(2, 5) // c's smooth handles no longer aligned
    })
    const keep = JSON.stringify([d.in(SIDE).snapshot().lines.find(l => l.id === 'pq'), at(d, SIDE, 'u')])
    d.edit(e => e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'a', position: P(0, 2) }] }))
    expect(JSON.stringify([d.in(SIDE).snapshot().lines.find(l => l.id === 'pq'), at(d, SIDE, 'u')])).toBe(keep)
    // moving c makes its spring re-solve the unaligned handles: refused, not published
    const before = save(d)
    expect(refusal(() => d.edit(e => e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'c', position: P(20, 3) }] }))).code).toBe('correction-not-reproduced')
    // a handle at that join, equal in front and side, dragged: the side view's handle is held and its spring turns cd's: refused
    const hv = handleIn(d, FRONT, 'bc', 'b')
    expect(handleIn(d, SIDE, 'bc', 'b')).toEqual(hv)
    expect(refusal(() => d.edit(e => e.correct({ yaw: 45, pitch: 0 }, { handles: [{ line: 'bc', end: 'b', vector: { x: hv.x, y: hv.y + 2 } }] }))).code).toBe('correction-not-reproduced')
    expect(save(d)).toBe(before)
  })
})

describe('numbers through the operation', () => {
  it('a drag whose scaled size overflows: correction-not-finite naming the control', () => {
    const d = base()
    const r = refusal(() => d.edit(e => e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'c', position: P(20, 1.7e308) }] })))
    expect([r.code, r.objects]).toEqual(['correction-not-finite', [{ kind: 'point', id: 'c' }]])
  })

  it('a tiny S (all points of front and side within 1e-7): a finite move or a refusal, never a bare error', () => {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => e.line('ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(1e-7) }))
    try { d.edit(e => e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'b', position: P(1e-7, 1e-8) }] })) } catch (x) { expect(x).toBeInstanceOf(Refusal) }
  })

  it('a drawing that already has no value at the pose, through a file: pose-not-finite, a refusal', () => {
    const d0 = base()
    d0.edit(e => e.line('zw', { id: 'z', layer: 'L', position: P(-1e308, 50) }, { id: 'w', layer: 'L', position: P(5, 60) }))
    d0.editIn(SIDE, e => e.move([{ id: 'z', target: P(1e308, 50) }]))
    const d = viaFile(d0, doc => { doc.animation.points.z = { [E_FS]: { x: [[0.5, 5]] } } })
    expect(refusal(() => d.edit(e => e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'c', position: P(20, 3) }] }))).code).toBe('pose-not-finite')
    expect(refusal(() => d.atPose({ yaw: 45, pitch: 0 })).code).toBe('pose-not-finite')
  })

  it('the settle overflowing inside correct (two linked points at x = 1e308 moved in y): coordinates-not-finite, rolled back', () => {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => { e.layer('M', 'M'); e.line('ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(1e308, 10) }); e.line('mn', { id: 'm', layer: 'M', position: P(1e308, 10) }, { id: 'n', layer: 'M', position: P(0, 50) }) })
    d.edit(e => e.link('b', 'm'))
    const before = save(d)
    expect(refusal(() => d.edit(e => e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'b', position: P(1e308, 20) }] }))).code).toBe('coordinates-not-finite')
    expect(save(d)).toBe(before)
  })
})

describe('the settle overflowing inside correct, through a spring (a file holds the huge handle)', () => {
  it('moving c in the side view makes its smooth join re-solve a handle whose length overflows: coordinates-not-finite, rolled back', () => {
    const d0 = base()
    d0.edit(e => e.line('cd', 'c', { id: 'g', layer: 'L', position: P(30, -10) }))
    d0.edit(e => e.join('c', 'bc', 'cd', { mode: 'smooth' }))
    const d = viaFile(d0, doc => { layer(doc, SIDE).lines.cd!.ha = P(1.5e308, 1.5e308) })
    const before = save(d)
    expect(refusal(() => d.edit(e => e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'c', position: P(20, 3) }] }))).code).toBe('coordinates-not-finite')
    expect(save(d)).toBe(before)
  })
})

describe('companions in the same edit (dot 1791694523)', () => {
  it('a stroke broadcast before and one after a move case: both go through, the strokes kept', () => {
    for (const order of ['before', 'after'] as const) {
      const d = base(), stroke = { width: 4, profile: 'uniform' }
      d.edit(e => e.lineStroke('bc', stroke)) // the front's stroke, not yet broadcast
      d.edit(e => {
        if (order === 'before') e.broadcastStroke([{ kind: 'line', id: 'bc' }])
        e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'c', position: P(20, 3) }] })
        if (order === 'after') e.broadcastStroke([{ kind: 'line', id: 'bc' }])
      })
      expect([order, d.in(SIDE).snapshot().lines.find(l => l.id === 'bc')!.stroke, near(pos(d, { yaw: 45, pitch: 0 }, 'c').y, 3)]).toEqual([order, stroke, true])
    }
  })
})

describe('evaluate on an edge is onEdge, bit for bit (ledger row 14)', () => {
  it('every edge, dyadic t, varied knots and values', () => {
    const val = (yaw: number, pitch: number, k: number) => 10 * k + yaw / 7 + pitch / 3.3 + (yaw * pitch) / 401
    const views = [-90, 0, 90].flatMap(yaw => [-45, 0, 45].map(pitch => ({ yaw, pitch, points: { p: P(val(yaw, pitch, 1), val(yaw, pitch, 2)) }, lines: {}, radii: {}, ends: {} })))
    const edges = [
      ...[-45, 0, 45].flatMap(p => [-90, 90].map(y => ({ key: `0,${p}>${y},${p}`, from: [0, p], to: [y, p] }))),
      ...[-90, 0, 90].flatMap(y => [-45, 45].map(p => ({ key: `${y},0>${y},${p}`, from: [y, 0], to: [y, p] }))),
    ]
    const knotSets: (Knots | undefined)[] = [undefined, [[0.5, 0.8]], [[0.25, -0.5], [0.75, 1.7]], [[0.125, 3], [0.5, 1e-3], [0.875, 0.2]]]
    for (const e of edges) for (const knots of knotSets) for (const t of [0.125, 0.25, 0.5, 0.75, 0.875]) {
      const model: Model = { views, responses: { points: knots ? { p: { [e.key]: { x: knots, y: knots } } } : {}, handles: {} } }
      const pose = e.from[0] !== e.to[0] ? { yaw: e.to[0]! * t, pitch: e.from[1]! } : { yaw: e.from[0]!, pitch: e.to[1]! * t }
      const got = evaluate(model, pose).points.p!
      const A = views.find(v => v.yaw === e.from[0] && v.pitch === e.from[1])!.points.p, B = views.find(v => v.yaw === e.to[0] && v.pitch === e.to[1])!.points.p
      expect([e.key, t, got.x, got.y]).toEqual([e.key, t, onEdge(knots, t, A.x, B.x), onEdge(knots, t, A.y, B.y)])
    }
  })
})
