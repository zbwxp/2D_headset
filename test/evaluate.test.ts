// Stage 3a, package 1 (docs/stage3a-playback-plan.md; dot 1791684410): `evaluate`, pure.
// Bilinear geometry in each quadrant; slot B (joins after the blend) with its placeholder.
// Strokes are not blended: one per meta-curve (bowen 1792057731; docs/shared-strokes-checklist.md),
// so the model holds positions and handles only and slot A went.
import { describe, it, expect } from 'vitest'
import { evaluate, weights, inRange, type Model, type ViewShape, type Pose } from '../src/evaluate'

const YAWS = [-90, 0, 90], PITCHES = [-45, 0, 45]
const V = (x: number, y: number) => ({ x, y })
/** A distinct, deterministic value per view and slot. */
const f = (yaw: number, pitch: number, k: number) => Math.sin(yaw * 0.37 + pitch * 1.13 + k * 2.71) * 10 + k

function view(yaw: number, pitch: number, over: Partial<ViewShape> = {}): ViewShape {
  return {
    yaw, pitch,
    points: { a: V(f(yaw, pitch, 1), f(yaw, pitch, 2)), b: V(f(yaw, pitch, 3), f(yaw, pitch, 4)), q: V(f(yaw, pitch, 1), f(yaw, pitch, 2)) },
    lines: { ab: { ha: V(f(yaw, pitch, 5), f(yaw, pitch, 6)), hb: V(f(yaw, pitch, 7), f(yaw, pitch, 8)) } },
    ...over,
  }
}
const model = (over: (yaw: number, pitch: number) => Partial<ViewShape> = () => ({})): Model =>
  ({ views: YAWS.flatMap(y => PITCHES.map(p => view(y, p, over(y, p)))) })
const viewOf = (m: Model, yaw: number, pitch: number) => m.views.find(v => v.yaw === yaw && v.pitch === pitch)!
const close = (a: { x: number; y: number }, b: { x: number; y: number }) => { expect(a.x).toBeCloseTo(b.x, 12); expect(a.y).toBeCloseTo(b.y, 12) }
const mix = (...terms: [number, { x: number; y: number }][]) => ({ x: terms.reduce((s, [w, p]) => s + w * p.x, 0), y: terms.reduce((s, [w, p]) => s + w * p.y, 0) })

describe('evaluate: the nine views and the axes', () => {
  it('at each of the nine views it gives that view exactly: positions and handles, nothing else', () => {
    const m = model()
    for (const v of m.views) {
      const r = evaluate(m, { yaw: v.yaw, pitch: v.pitch })
      expect(r).toEqual({ points: v.points, lines: v.lines })
    }
  })

  it('on an axis every geometric value is the linear blend of the two views on it; the other views have no effect', () => {
    const m = model(), pose = { yaw: 30, pitch: 0 }, u = 30 / 90
    const F = viewOf(m, 0, 0), Y = viewOf(m, 90, 0)
    const r = evaluate(m, pose)
    close(r.points.a!, mix([1 - u, F.points.a!], [u, Y.points.a!]))
    close(r.lines.ab!.hb, mix([1 - u, F.lines.ab!.hb], [u, Y.lines.ab!.hb]))
    // every other view changed: the result on this axis stays the same
    const m2 = model((yaw, pitch) => (pitch !== 0 || yaw === -90 ? { points: { a: V(999, 999), b: V(999, 999), q: V(999, 999) } } : {}))
    expect(evaluate(m2, pose).points).toEqual(r.points)
  })

  it('in a cell it is the bilinear formula; a corner exactly as drafted gives front + u·yaw change + v·pitch change', () => {
    const m = model(), pose = { yaw: -60, pitch: 15 }, u = 60 / 90, v = 15 / 45
    const F = viewOf(m, 0, 0), Y = viewOf(m, -90, 0), P = viewOf(m, 0, 45), C = viewOf(m, -90, 45)
    close(evaluate(m, pose).points.b!, mix([(1 - u) * (1 - v), F.points.b!], [u * (1 - v), Y.points.b!], [(1 - u) * v, P.points.b!], [u * v, C.points.b!]))
    // the corner drafted as F + (Y − F) + (P − F)
    const drafted = { ...C, points: { ...C.points, b: V(Y.points.b!.x + P.points.b!.x - F.points.b!.x, Y.points.b!.y + P.points.b!.y - F.points.b!.y) } }
    const m2: Model = { views: m.views.map(x => (x === C ? drafted : x)) }
    const fb = F.points.b!, yb = Y.points.b!, pb = P.points.b!
    close(evaluate(m2, pose).points.b!, V(fb.x + u * (yb.x - fb.x) + v * (pb.x - fb.x), fb.y + u * (yb.y - fb.y) + v * (pb.y - fb.y)))
  })

  it('blended geometry is continuous across the quadrant borders, 0° included', () => {
    const m = model(), e = 1e-7
    for (const [p, q] of [[{ yaw: -e, pitch: 20 }, { yaw: e, pitch: 20 }], [{ yaw: 50, pitch: -e }, { yaw: 50, pitch: e }], [{ yaw: -e, pitch: -e }, { yaw: e, pitch: e }]] as [Pose, Pose][]) {
      const a = evaluate(m, p), b = evaluate(m, q)
      for (const id of ['a', 'b']) expect(Math.hypot(a.points[id]!.x - b.points[id]!.x, a.points[id]!.y - b.points[id]!.y)).toBeLessThan(1e-4)
      expect(Math.hypot(a.lines.ab!.ha.x - b.lines.ab!.ha.x, a.lines.ab!.ha.y - b.lines.ab!.ha.y)).toBeLessThan(1e-4)
    }
  })

  it('points that coincide in every view (linked points) coincide at every pose', () => {
    const m = model()
    for (const pose of [{ yaw: 17, pitch: -33 }, { yaw: -88, pitch: 44 }, { yaw: 45, pitch: 22.5 }]) {
      const r = evaluate(m, pose)
      expect(r.points.q).toEqual(r.points.a)
    }
  })
})

describe('evaluate: slots and refusals', () => {
  it('slot B placeholder: handles are exactly the blended vectors (nothing re-aligned)', () => {
    const m = model(), pose = { yaw: 20, pitch: 30 }
    const ws = weights(m, pose)
    const expected = ws.reduce((s, w) => ({ x: s.x + w.weight * w.view.lines.ab!.ha.x, y: s.y + w.weight * w.view.lines.ab!.ha.y }), { x: 0, y: 0 })
    expect(evaluate(m, pose).lines.ab!.ha).toEqual(expected)
  })

  it('a pose outside the domain, or not a number, is refused, never clamped; a model missing a view or a value is refused', () => {
    const m = model()
    for (const pose of [{ yaw: 91, pitch: 0 }, { yaw: 0, pitch: -46 }, { yaw: NaN, pitch: 0 }, { yaw: 0, pitch: Infinity }]) {
      expect(inRange(pose)).toBe(false)
      expect(() => evaluate(m, pose)).toThrow(/pose-out-of-range/)
    }
    expect(() => evaluate({ views: m.views.filter(v => !(v.yaw === 90 && v.pitch === 45)) }, { yaw: 10, pitch: 10 })).toThrow(/model-incomplete: 0 views at yaw 90, pitch 45/)
    const noLineAt90 = model((yaw, pitch) => (yaw === 90 && pitch === 0 ? { lines: {} } : {}))
    expect(() => evaluate(noLineAt90, { yaw: 10, pitch: 0 })).toThrow(/model-incomplete: no handle a of ab in view 90,0/)
    expect(() => evaluate(noLineAt90, { yaw: 0, pitch: 10 })).not.toThrow() // that view does not contribute there
    // a key missing in the first contributing view, or in a later one, is refused either way (dot 1791684670)
    const without = (yaw: number, pitch: number, cut: (v: ViewShape) => Partial<ViewShape>) => model((y, p) => (y === yaw && p === pitch ? cut(view(y, p)) : {}))
    const noPoint = (v: ViewShape) => ({ points: { a: v.points.a!, q: v.points.q! } })
    const noLine = () => ({ lines: {} })
    // a key named like an inherited property (constructor, toString) is missing where it is not an own key (dot 1791684959)
    const inherited = (name: string) => model((y, p) => (y === 0 && p === 0
      ? { points: { ...view(y, p).points, [name]: V(1, 1) }, lines: { ...view(y, p).lines, [name]: { ha: V(1, 0), hb: V(-1, 0) } } }
      : {}))
    for (const name of ['constructor', 'toString']) {
      expect(() => evaluate(inherited(name), { yaw: 45, pitch: 0 })).toThrow(new RegExp(`model-incomplete: no position of ${name} in view 90,0`))
      const linesOnly = model((y, p) => (y === 0 && p === 0 ? { lines: { ...view(y, p).lines, [name]: { ha: V(1, 0), hb: V(-1, 0) } } } : {}))
      expect(() => evaluate(linesOnly, { yaw: 45, pitch: 0 })).toThrow(new RegExp(`model-incomplete: no handle a of ${name} in view 90,0`))
    }
    for (const [cut, what] of [[noPoint, 'position of b'], [noLine, 'handle a of ab']] as const) {
      expect(() => evaluate(without(0, 0, cut), { yaw: 45, pitch: 0 })).toThrow(new RegExp(`model-incomplete: no ${what} in view 0,0`))
      expect(() => evaluate(without(90, 0, cut), { yaw: 45, pitch: 0 })).toThrow(new RegExp(`model-incomplete: no ${what} in view 90,0`))
    }
  })

  it('pure: the model is not changed, the same input gives the same result, and the result shares nothing with the model', () => {
    const m = model()
    const deepFreeze = (o: unknown): void => { if (o && typeof o === 'object') { Object.freeze(o); Object.values(o).forEach(deepFreeze) } }
    const before = JSON.stringify(m)
    deepFreeze(m)
    const a = evaluate(m, { yaw: 0, pitch: 0 }), b = evaluate(m, { yaw: 0, pitch: 0 })
    expect(a).toEqual(b)
    // changed in place: a result object shared with the (frozen) model would throw here or show in it
    ;(a.points.a as { x: number }).x = 0; (a.lines.ab!.ha as { x: number }).x = 0
    expect(JSON.stringify(m)).toBe(before)
    expect(evaluate(m, { yaw: 0, pitch: 0 })).toEqual(b)
  })
})
