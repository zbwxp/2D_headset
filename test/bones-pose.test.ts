// 骨线 at a pose, P0 (docs/bone-poses-checklist.md): reached only through atPose(pose, { followBones: true }); off, the
// pose is what it was. At a view: the stored shapes. Between: attached lines generated from the bone at that pose; a
// 30° bone correction carries them; poses near a view converge to it; a bone collapsing between two valid views sends
// the whole connected group back to the plain blend, reported, with finite numbers.
import { describe, it, expect } from 'vitest'
import { Core, type Vec } from '../src'
import { boneLine, type Cubic } from '../src/bones/coords'

const P = (x: number, y = 0): Vec => ({ x, y })
const SIDE = 'view:90,0'
type Reader = ReturnType<Core['atPose']>
const cubicIn = (r: { snapshot(): ReturnType<Reader['snapshot']> }, id: string): Cubic => {
  const s = r.snapshot(), l = s.lines.find(x => x.id === id)!, pos = (p: string) => s.points.find(x => x.id === p)!.position
  const a = pos(l.a), b = pos(l.b)
  return [a, P(a.x + l.ha.x, a.y + l.ha.y), P(b.x + l.hb.x, b.y + l.hb.y), b]
}
const at = (c: Cubic, t: number): Vec => { const u = 1 - t; return P(u * u * u * c[0].x + 3 * u * u * t * c[1].x + 3 * u * t * t * c[2].x + t * t * t * c[3].x, u * u * u * c[0].y + 3 * u * u * t * c[1].y + 3 * u * t * t * c[2].y + t * t * t * c[3].y) }
/** Both ways, 400 samples on each curve (dot 1792475485: independent of the fit's own samples). */
const shapeDistance = (a: Cubic, b: Cubic) => {
  const one = (p: Cubic, q: Cubic) => { let w = 0; for (let i = 0; i <= 400; i++) { const x = at(p, i / 400); let m = Infinity; for (let k = 0; k <= 400; k++) { const y = at(q, k / 400); m = Math.min(m, Math.hypot(x.x - y.x, x.y - y.y)) } w = Math.max(w, m) } return w }
  return Math.max(one(a, b), one(b, a))
}

/** A bone B whose 90,0 view is drawn by hand; lines up (and its neighbour up2, sharing u1) attached; f ordinary. */
function scene() {
  const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
  d.edit(e => {
    e.line('B', { id: 'b0', layer: 'L', position: P(0, 0) }, { id: 'b1', layer: 'L', position: P(40, 0) }, { ha: P(10, -10), hb: P(-10, -10) })
    e.line('up', { id: 'u0', layer: 'L', position: P(2, -2) }, { id: 'u1', layer: 'L', position: P(20, -9) }, { ha: P(6, -5), hb: P(-6, 0) })
    e.line('up2', 'u1', { id: 'u2', layer: 'L', position: P(38, -2) }, { ha: P(6, 0), hb: P(-6, -5) })
    e.line('f', { id: 'f0', layer: 'L', position: P(100, 0) }, { id: 'f1', layer: 'L', position: P(110, 0) })
  })
  d.edit(e => e.markBone(['B']))
  d.editIn(SIDE, e => { e.move([{ id: 'b0', target: P(-4, 2) }, { id: 'b1', target: P(30, 6) }]); e.moveHandle('B', 'a', P(8, -12)) })
  d.edit(e => e.attach(['up', 'up2'], 'B'))
  return d
}
const json = (x: unknown) => JSON.stringify(x)

describe('P0: attached lines at a pose follow their bone (docs/bone-poses-checklist.md)', () => {
  it('off by default: the pose is exactly what it was; at a view, on or off, the stored shapes', () => {
    const d = scene(), pose = { yaw: 30, pitch: 0 }
    expect(json(d.atPose(pose).snapshot())).toBe(json(d.atPose(pose, {}).snapshot()))
    for (const yaw of [-90, 0, 90]) for (const pitch of [-45, 0, 45]) {
      expect(json(d.atPose({ yaw, pitch }, { followBones: true }).snapshot())).toBe(json(d.atPose({ yaw, pitch }).snapshot()))
    }
  })
  it('between the views: each attached line is its base carried by the bone at that pose; ordinary lines as blended', () => {
    const d = scene(), base = d.snapshot().attachments
    void base
    const pose = { yaw: 30, pitch: 0 }, on = d.atPose(pose, { followBones: true }), off = d.atPose(pose)
    expect(on.boneFallback()).toEqual([])
    const bone = cubicIn(on, 'B'), front = (id: string) => cubicIn(d.atPose({ yaw: 0, pitch: 0 }), id)
    for (const id of ['up', 'up2']) {
      const want = boneLine(front(id), front('B'), bone).shape
      expect(shapeDistance(cubicIn(on, id), want)).toBeLessThan(0.05)
    }
    expect(json(cubicIn(on, 'f'))).toBe(json(cubicIn(off, 'f')))
    expect(json(cubicIn(on, 'B'))).toBe(json(cubicIn(off, 'B')))
  })
  it('a 30° correction on the bone carries its lines there (off, they stay)', () => {
    const d = scene(), pose = { yaw: 30, pitch: 0 }
    const before = cubicIn(d.atPose(pose, { followBones: true }), 'up'), b1 = d.atPose(pose).snapshot().points.find(p => p.id === 'b1')!.position
    d.edit(e => e.correct(pose, { points: [{ id: 'b1', position: P(b1.x + 3, b1.y + 2) }] }))
    expect(json(cubicIn(d.atPose(pose), 'up'))).toBe(json(cubicIn(d.atPose(pose), 'up'))) // deterministic
    expect(shapeDistance(cubicIn(d.atPose(pose, { followBones: true }), 'up'), before)).toBeGreaterThan(0.1)
  })
  it('poses approaching a view from both sides converge to its stored shapes (no jump at the grid)', () => {
    const d = scene()
    for (const [view, near] of [[{ yaw: 0, pitch: 0 }, [1e-3, 1e-6, 1e-9]], [{ yaw: 90, pitch: 0 }, [90 - 1e-3, 90 - 1e-6, 90 - 1e-9]]] as const) {
      const stored = cubicIn(d.atPose(view), 'up')
      const gaps = near.map(yaw => shapeDistance(cubicIn(d.atPose({ yaw, pitch: 0 }, { followBones: true }), 'up'), stored))
      // down to the fit's own stopping tolerance (a few millionths of a unit), not further
      expect(gaps[gaps.length - 1]!).toBeLessThan(1e-5)
      expect(gaps[0]!).toBeLessThan(0.5)
    }
    for (const pitch of [1e-9, -1e-9]) expect(shapeDistance(cubicIn(d.atPose({ yaw: 0, pitch }, { followBones: true }), 'up'), cubicIn(d.atPose({ yaw: 0, pitch: 0 }), 'up'))).toBeLessThan(1e-5)
  })
  it('a bone collapsing between two valid views: the whole connected group falls back to the plain blend, reported, finite', () => {
    const d = scene()
    // at 90,0 the bone reversed end for end: half way between, its ends meet
    d.editIn(SIDE, e => { e.move([{ id: 'b0', target: P(40, 0) }, { id: 'b1', target: P(0, 0) }]); e.moveHandle('B', 'a', P(-10, 10)); e.moveHandle('B', 'b', P(10, 10)) })
    const pose = { yaw: 45, pitch: 0 }, on = d.atPose(pose, { followBones: true }), off = d.atPose(pose)
    expect(on.boneFallback().map(f => f.lines)).toEqual([['up', 'up2']])
    expect(on.boneFallback()[0]!.reason).toMatch(/bone|short|direction|fit/i)
    for (const id of ['up', 'up2', 'B', 'f']) expect(json(cubicIn(on, id))).toBe(json(cubicIn(off, id)))
    for (const p of on.snapshot().points) expect(Number.isFinite(p.position.x) && Number.isFinite(p.position.y)).toBe(true)
  })
})
