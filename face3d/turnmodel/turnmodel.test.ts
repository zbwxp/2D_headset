// 转头模型: the rules hold at their corners. In the project run (vitest.config.ts)
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { evaluate, params, bez, atHeight, smoothAt, along, withDerivedPitch, ModelRefusal, type ModelData, type Cubic, type V } from './index'

const M = JSON.parse(readFileSync(new URL('../../bench-tasks/转头模型/model.json', import.meta.url), 'utf8')) as ModelData
const dist = (a: V, b: V) => Math.hypot(a[0] - b[0], a[1] - b[1])
/** The distance from q to c (sampled, then refined around the best sample). */
const near = (c: Cubic, q: V) => {
  const d = (t: number) => dist(bez(c, t), q)
  let tb = 0; for (let i = 1; i <= 1000; i++) if (d(i / 1000) < d(tb)) tb = i / 1000
  let lo = Math.max(0, tb - 0.001), hi = Math.min(1, tb + 0.001)
  for (let i = 0; i < 60; i++) { const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3; if (d(a) < d(b)) hi = b; else lo = a }
  return d((lo + hi) / 2)
}

describe('outline and side face', () => {
  it('0 / 45 / 90° are bowen\'s keyframes exactly (points and handles)', () => {
    for (const k of M.outline.keys) {
      const f = evaluate(M, k.yaw)
      for (const [id, v] of Object.entries(k.pts)) expect(dist(f.points[id]!, v)).toBeLessThan(1e-9)
      for (const l of f.outline) { const h = k.handles[l.name]!; expect(dist(l.c[1], [l.c[0][0] + h.ha[0], l.c[0][1] + h.ha[1]])).toBeLessThan(1e-9); expect(dist(l.c[2], [l.c[3][0] + h.hb[0], l.c[3][1] + h.hb[1]])).toBeLessThan(1e-9) }
    }
  })
  it('the side face (脸片) is two keyframes and one speed curve: x = 90° x × the curve, height kept; crown and chin shared with the outline', () => {
    for (const y of [15, 30, 52, 75]) {
      const f = evaluate(M, y), w = along(M.sheet.speed, y)
      for (const [id, [d, h]] of Object.entries(M.sheet.pts)) { expect(f.points[id]![0]).toBeCloseTo(d * w, 9); expect(f.points[id]![1]).toBe(h) }
    }
    expect(along(M.sheet.speed, 0)).toBe(0); expect(along(M.sheet.speed, 90)).toBe(1)
  })
  it('the speed curve is 5 numbers (15 / 30 / 45 / 60 / 75°) and stays within 0.84 of the old rigid sheet (nose tip)', () => {
    expect(M.sheet.speed.map(k => k[0])).toEqual([0, 15, 30, 45, 60, 75, 90])
    const t45 = 43.579, rigid = (a: number) => Math.sin(((a <= 45 ? (a * t45) / 45 : t45 + ((a - 45) * (90 - t45)) / 45) * Math.PI) / 180)
    let worst = 0
    for (let a = 0; a <= 90; a += 0.5) for (const [d] of Object.values(M.sheet.pts)) worst = Math.max(worst, Math.abs(d * (along(M.sheet.speed, a) - rigid(a))))
    expect(worst).toBeLessThan(0.85)
  })
  it('0° is left-right symmetric', () => {
    const f = evaluate(M, 0), sk = f.outline.find(l => l.name === 'nearSkull')!.c, jaw = f.outline.find(l => l.name === 'nearJaw')!.c
    expect(f.points.nearRoot![0]).toBeCloseTo(-f.points.zyg![0], 9)
    for (const c of [sk, jaw]) for (let i = 0; i <= 10; i++) { const q = bez(c, i / 10); expect(near(f.outline.find(l => l.name === 'farSkull')!.c, [-q[0], q[1]]) < 3 || near(f.outline.find(l => l.name === 'farJaw')!.c, [-q[0], q[1]]) < 3 || near(f.outline.find(l => l.name === 'farCheek')!.c, [-q[0], q[1]]) < 3).toBe(true) }
  })
  it('a negative yaw is the mirror of the positive one', () => {
    const a = evaluate(M, 37), b = evaluate(M, -37)
    for (const id of Object.keys(a.points)) { expect(b.points[id]![0]).toBeCloseTo(-a.points[id]![0], 12); expect(b.points[id]![1]).toBeCloseTo(a.points[id]![1], 12) }
  })
  it('turning does not jump: every point moves less than 2 per half degree', () => {
    let prev = evaluate(M, 0)
    for (let y = 0.5; y <= 90; y += 0.5) { const f = evaluate(M, y); for (const id of Object.keys(prev.points)) expect(dist(f.points[id]!, prev.points[id]!)).toBeLessThan(2); prev = f }
  })
  it('smoothAt passes through its keyframes', () => {
    expect(smoothAt([0, 45, 90], [1, 5, 2], 45)).toBeCloseTo(5, 12)
    expect(smoothAt([0, 45, 90], [1, 5, 2], 90)).toBeCloseTo(2, 12)
  })
})

describe('eyes', () => {
  it('0° gives bowen\'s 0° eye back (both eyes, mirrored)', () => {
    const f = evaluate(M, 0), base = M.eyes.base
    base.forEach((c, i) => { const n = f.eyes.near[i]!.pts, fr = f.eyes.far[i]!.pts
      for (let s = 0; s <= 30; s += 5) { const q = bez(c, s / 30); expect(dist(n[s]!, q)).toBeLessThan(0.05); expect(dist(fr[s]!, [-q[0], q[1]])).toBeLessThan(0.05) } })
  })
  it('the near eye widens first, then narrows (it turns to the camera first); the far eye only narrows', () => {
    const w = (y: number, far: boolean) => { const u = evaluate(M, y).eyes[far ? 'far' : 'near'][0]!.pts; return Math.abs(u[30]![0] - u[0]![0]) }
    expect(w(20, false)).toBeGreaterThan(w(0, false))
    expect(w(60, false)).toBeLessThan(w(20, false))
    for (let y = 10; y <= 60; y += 10) expect(w(y, true)).toBeLessThan(w(y - 10, true))
  })
  it('the far eye is no taller than the near one (近大远小)', () => {
    const h = (y: number, far: boolean) => { const ys = evaluate(M, y).eyes[far ? 'far' : 'near'].flatMap(l => l.pts.map(p => p[1])); return Math.max(...ys) - Math.min(...ys) }
    expect(h(45, true)).toBeLessThan(h(45, false))
  })
})

describe('ears', () => {
  it('the near ear points lie on the near outline at their heights, every angle', () => {
    for (let y = 0; y <= 90; y += 7.5) {
      const f = evaluate(M, y), p = params(M)
      expect(near(f.outline.find(l => l.name === 'nearSkull')!.c, f.points.nearEarUp!)).toBeLessThan(1e-3)
      expect(near(f.outline.find(l => l.name === 'nearJaw')!.c, f.points.nearEarLow!)).toBeLessThan(1e-3)
      expect(f.points.nearEarUp![1]).toBeCloseTo(p.earUp, 3); expect(f.points.nearEarLow![1]).toBeCloseTo(p.earLow, 3)
    }
  })
  it('at 90° the near ear has bowen\'s 90° shape exactly (tip offset, handles); its points sit at the fixed heights, not at his drawn place', () => {
    const f = evaluate(M, 90), e = M.ear, [up, lo] = f.ears.near
    expect(dist(up!.c[3], [f.points.nearEarUp![0] + e.tip[0] - e.up[0], f.points.nearEarUp![1] + e.tip[1] - e.up[1]])).toBeLessThan(1e-9)
    expect(dist(up!.c[1], [up!.c[0][0] + e.upLine.ha[0], up!.c[0][1] + e.upLine.ha[1]])).toBeLessThan(1e-9)
    expect(dist(lo!.c[2], [lo!.c[3][0] + e.lowLine.hb[0], lo!.c[3][1] + e.lowLine.hb[1]])).toBeLessThan(1e-9)
  })
  it('the far ear at 0° is the near ear\'s mirror; it hangs on the 假线, which shares crown and chin', () => {
    const f = evaluate(M, 0)
    for (const k of ['EarUp', 'EarTip', 'EarLow']) { expect(f.points['far' + k]![0]).toBeCloseTo(-f.points['near' + k]![0], 6); expect(f.points['far' + k]![1]).toBeCloseTo(f.points['near' + k]![1], 6) }
    const g = evaluate(M, 40)
    expect(g.ears.fake[0]!.c[3]).toEqual(g.points.crown); expect(g.ears.fake[1]!.c[3]).toEqual(g.points.chin)
    expect(near(g.ears.fake[0]!.c, g.points.farEarUp!)).toBeLessThan(1e-3)
  })
  it('atHeight finds the crossing', () => {
    const c: Cubic = [[0, 0], [5, 3], [8, 7], [10, 10]]
    expect(atHeight(c, 4)[1]).toBeCloseTo(4, 6)
  })
})

describe('the same as the old turncheck (its output at nine yaws, fixtures/old-turncheck.json)', () => {
  const OLD = JSON.parse(readFileSync(new URL('./fixtures/old-turncheck.json', import.meta.url), 'utf8')) as Record<string, { bz: { side: boolean; c: V[] }[]; eyes: { near: V[]; far: V[] } }>
  for (const a of Object.keys(OLD).filter(k => !k.startsWith('_'))) it(`${a}°: every outline and side line, the eye corners`, () => {
    const f = evaluate(M, +a), lines = [...f.outline, ...f.side], o = OLD[a]!
    // the side face moved from the rigid sheet to keyframes + a 5-number speed curve (bowen 1793026252): exact at the curve's
    // knots, within its stated 0.84 between them (52°); the outline shares crown and chin with it
    const tol = M.sheet.speed.some(k => k[0] === Math.abs(+a)) ? 2e-4 : 0.85
    for (const q of o.bz) expect(Math.min(...lines.map(l => Math.max(...[0, 1, 2, 3].map(i => dist(l.c[i]!, q.c[i]!)))))).toBeLessThan(tol)
    const s = +a < 0 ? -1 : 1, mx = (p: V): V => [s * p[0], p[1]], n = f.eyes.near[0]!.pts, fr = f.eyes.far[0]!.pts
    expect(dist(n[0]!, mx(o.eyes.near[0]!))).toBeLessThan(2e-4); expect(dist(n[30]!, mx(o.eyes.near[1]!))).toBeLessThan(2e-4)
    expect(dist(fr[0]!, mx(o.eyes.far[0]!))).toBeLessThan(2e-4); expect(dist(fr[30]!, mx(o.eyes.far[1]!))).toBeLessThan(2e-4)
  })
})

describe('parameters with no solution are refused (dot 1792855783)', () => {
  it('an ear height off its line is refused, not moved to the nearest point', () => {
    expect(() => evaluate(M, 30, { ...params(M), earUp: 30 })).toThrow(ModelRefusal)
    expect(() => evaluate(M, 30, { ...params(M), earLow: 80 })).toThrow(ModelRefusal)
  })
  it('an eye facing the 0° eye cannot be unbent from is refused', () => {
    expect(() => evaluate(M, 0, { ...params(M), eyeAlpha: 60 })).toThrow(ModelRefusal)
  })
  it('the defaults solve at every half degree from −90 to 90', () => {
    for (let y = -90; y <= 90; y += 0.5) expect(() => evaluate(M, y)).not.toThrow()
  })
})

describe('inputs must be finite numbers (dot 1792856126)', () => {
  it('NaN or Infinity in the yaw or any parameter is refused', () => {
    expect(() => evaluate(M, NaN)).toThrow(ModelRefusal)
    expect(() => evaluate(M, Infinity)).toThrow(ModelRefusal)
    for (const k of Object.keys(params(M))) for (const bad of [NaN, Infinity, -Infinity]) expect(() => evaluate(M, 30, { ...params(M), [k]: bad })).toThrow(ModelRefusal)
  })
  it('every coordinate of a view is finite', () => {
    const f = evaluate(M, 33.3), all = [...f.outline, ...f.side, ...f.ears.near, ...f.ears.far, ...f.ears.fake].flatMap(l => l.c).concat(f.eyes.near.flatMap(e => e.pts), f.eyes.far.flatMap(e => e.pts), Object.values(f.points))
    expect(all.every(v => Number.isFinite(v[0]) && Number.isFinite(v[1]))).toBe(true)
  })
})

describe('俯仰 (bowen 1793026490): his ±45 keys as a change added to the turn', () => {
  const K = M.pitch.keys, k0 = K.find(k => k.pitch === 0)!
  it('pitch 0 is the turning head exactly', () => {
    for (const y of [0, 30, 52, 90, -45]) expect(evaluate(M, y, undefined, 0)).toEqual({ ...evaluate(M, y), pitch: 0 })
  })
  it('at yaw 0, pitch ±45 moves every outline point and handle by exactly bowen\'s change from his pitch-0 key', () => {
    const f0 = evaluate(M, 0)
    for (const k of K.filter(k => k.pitch)) {
      const f = evaluate(M, 0, undefined, k.pitch)
      for (const id of ['crown', 'chin', 'nearRoot', 'zyg', 'temple']) for (const i of [0, 1]) expect(f.points[id]![i]).toBeCloseTo(f0.points[id]![i] + k.pts[id]![i] - k0.pts[id]![i], 9)
      for (const l of f.outline) { const l0 = f0.outline.find(x => x.name === l.name)!, h = k.handles[l.name]!, h0 = k0.handles[l.name]!
        for (const i of [0, 1]) { expect(l.c[1][i] - l.c[0][i]).toBeCloseTo(l0.c[1][i] - l0.c[0][i] + h.ha[i] - h0.ha[i], 9); expect(l.c[2][i] - l.c[3][i]).toBeCloseTo(l0.c[2][i] - l0.c[3][i] + h.hb[i] - h0.hb[i], 9) } }
    }
  })
  it('front-on, the ear points move by his change in height and stay on the outline', () => {
    const P = params(M)
    for (const k of K.filter(k => k.pitch)) {
      const f = evaluate(M, 0, undefined, k.pitch)
      expect(f.points.nearEarUp![1]).toBeCloseTo(P.earUp + k.pts.earUp![1] - k0.pts.earUp![1], 6)
      expect(f.points.nearEarLow![1]).toBeCloseTo(P.earLow + k.pts.earLow![1] - k0.pts.earLow![1], 6)
      expect(near(f.outline.find(l => l.name === 'nearSkull')!.c, f.points.nearEarUp!)).toBeLessThan(1e-6)
      expect(near(f.outline.find(l => l.name === 'nearJaw')!.c, f.points.nearEarLow!)).toBeLessThan(1e-6)
    }
  })
  it('the eyes: both on one sphere turned about the horizontal axis (looking up bends the eye line up at the outer corners)', () => {
    const corner = (f: ReturnType<typeof evaluate>, i: number) => f.eyes.near[0]!.pts[i]![1]
    const f0 = evaluate(M, 0), up = evaluate(M, 0, undefined, 45), dn = evaluate(M, 0, undefined, -45)
    // inner corner (sample 0) vs outer corner (sample 30) of the upper lid: the outer corner drops relative to the inner one when looking up
    expect((corner(up, 30) - corner(up, 0)) - (corner(f0, 30) - corner(f0, 0))).toBeGreaterThan(0)
    expect((corner(dn, 30) - corner(dn, 0)) - (corner(f0, 30) - corner(f0, 0))).toBeLessThan(0)
    // pitch moves the samples, not what the turn hides
    up.eyes.near.forEach((e, i) => expect(e.seen).toEqual(f0.eyes.near[i]!.seen)); up.eyes.far.forEach((e, i) => expect(e.seen).toEqual(f0.eyes.far[i]!.seen))
  })
  it('side-on (90°), nodding turns the whole 90° view in the picture plane about the near ear by the pitch angle, then moves it up or down so the eye corners keep their height (VRoid, bowen 1793028098 / 1793074250)', () => {
    const f0 = evaluate(M, 90), up = f0.points.nearEarUp!, lo = f0.points.nearEarLow!, o: V = [(up[0] + lo[0]) / 2, (up[1] + lo[1]) / 2], ne = f0.eyes.near[0]!.pts
    for (const pt of [45, -30]) {
      const f = evaluate(M, 90, undefined, pt), c = Math.cos((pt * Math.PI) / 180), sn = Math.sin((pt * Math.PI) / 180)
      const rot = (q: V): V => { const dx = q[0] - o[0], dy = q[1] - o[1]; return [o[0] + c * dx + sn * dy, o[1] - sn * dx + c * dy] }
      const lift = (ne[0]![1] + ne[30]![1]) / 2 - (rot(ne[0]!)[1] + rot(ne[30]!)[1]) / 2
      for (const [k, q] of Object.entries(f0.points)) { const r = rot(q); expect(f.points[k]![0]).toBeCloseTo(r[0], 9); expect(f.points[k]![1]).toBeCloseTo(r[1] + lift, 9) }
      expect(Math.sign(f0.points.noseTip![1] - f.points.noseTip![1])).toBe(Math.sign(pt)) // 仰 brings the nose up, 俯 down
    }
  })
  it('turning with a large pitch does not jump: every point moves less than 2.5 per half degree (bowen 1793029402)', () => {
    for (const pt of [45, -45]) {
      let prev = evaluate(M, 0, undefined, pt)
      for (let y = 0.5; y <= 90; y += 0.5) {
        const f = evaluate(M, y, undefined, pt)
        for (const [k, q] of Object.entries(f.points)) if (prev.points[k]) expect(Math.hypot(q[0] - prev.points[k]![0], q[1] - prev.points[k]![1])).toBeLessThan(2.5)
        prev = f
      }
    }
  })
  it('only −45 … 45 has keys; NaN is refused', () => {
    expect(() => evaluate(M, 0, undefined, 46)).toThrow(ModelRefusal)
    expect(() => evaluate(M, 0, undefined, NaN)).toThrow(ModelRefusal)
  })
  it('every yaw and pitch on a 5° grid solves', () => {
    for (let y = -90; y <= 90; y += 5) for (let p = -45; p <= 45; p += 5) expect(() => evaluate(M, y, undefined, p)).not.toThrow()
  })
})

describe('turn-and-pitch keyframes (bowen 1793073663: his tuned 21 / 31)', () => {
  const C = M.pitch.corners ?? [], M0 = { ...M, pitch: { ...M.pitch, corners: [] } } as ModelData
  it('there are two, one each side of pitch 0', () => { expect(C.length).toBe(2); expect(new Set(C.map(k => Math.sign(k.pitch)))).toEqual(new Set([1, -1])) })
  it('at its own turn and pitch a keyframe gives the rules plus its correction exactly', () => {
    for (const k of C) {
      const f = evaluate(M, k.yaw, undefined, k.pitch), f0 = evaluate(M0, k.yaw, undefined, k.pitch)
      for (const l of f.outline) l.c.forEach((q, j) => { const d = k.lines['outline:' + l.name]![j]!; const o = f0.outline.find(x => x.name === l.name)!.c[j]!; expect(q[0]).toBeCloseTo(o[0] + d[0], 9); expect(q[1]).toBeCloseTo(o[1] + d[1], 9) })
      f.eyes.near[0]!.pts.forEach((q, i) => { const d = k.eyes.near[0]![i]!, o = f0.eyes.near[0]!.pts[i]!; expect(q[0]).toBeCloseTo(o[0] + d[0], 9) })
    }
  })
  it('nothing changes at turn 0, turn 90 or pitch 0', () => {
    for (const [y, pt] of [[0, 30], [90, 30], [90, -30], [40, 0], [0, -40]] as const) expect(evaluate(M, y, undefined, pt)).toEqual(evaluate(M0, y, undefined, pt))
  })
  it('the side face keeps meeting the outline at crown and chin', () => {
    for (const k of C) { const f = evaluate(M, k.yaw, undefined, k.pitch), ends = f.side.flatMap(l => [l.c[0], l.c[3]])
      for (const q of [f.points.crown!, f.points.chin!]) expect(Math.min(...ends.map(e => Math.hypot(e[0] - q[0], e[1] - q[1])))).toBeLessThan(1e-9) }
  })
})

describe('the derived front ±45 (bowen 1793074250: heights from the side view turned 45°)', () => {
  const MD = withDerivedPitch(M)
  it('a turn keeps the heights: crown, nose, chin and the ear at ±45 move less than 6 between 0° and 90°', () => {
    for (const pt of [45, -45]) { const a = evaluate(MD, 0, undefined, pt).points, b = evaluate(MD, 90, undefined, pt).points
      for (const k of ['noseTip', 'chin', 'nearEarUp']) expect(Math.abs(a[k]![1] - b[k]![1])).toBeLessThan(6) }
  })
  it('every turn and pitch on a 5° grid solves', () => { for (let y = 0; y <= 90; y += 5) for (let p = -45; p <= 45; p += 5) expect(() => evaluate(MD, y, undefined, p)).not.toThrow() })
})

