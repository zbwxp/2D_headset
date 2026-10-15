// The sphere frame's field (docs/sphere-frame-checklist.md §1, §4): identity at rest, the anchor fixed, the derivative
// against finite differences, the flat limit, the two refusals at their thresholds, non-finite input refused.
import { describe, it, expect } from 'vitest'
import { sphereField, fitDeformedCubic, type Sphere, type Vec, type Cubic } from '../index'

const rest: Sphere = { anchor: { x: 10, y: 20 }, r: 3, yaw: 0, pitch: 0, roll: 0, scale: 1, offset: { x: 0, y: 0 } }
const near = (a: Vec, b: Vec, eps = 1e-9) => Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps
const grid = (s: Sphere, k = 0.9): Vec[] => {
  const out: Vec[] = []
  for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) { const x = i / 4 * k * s.r / Math.SQRT2, y = j / 4 * k * s.r / Math.SQRT2; out.push({ x: s.anchor.x + x, y: s.anchor.y + y }) }
  return out
}

describe('sphereField', () => {
  it('at rest every point stays where it is, for any r', () => {
    for (const r of [1.01 * 2.2, 3, 50]) {
      const s = { ...rest, r }, f = sphereField(s)
      for (const p of grid({ ...s, r: 2.2 })) expect(near(f.map(p), p)).toBe(true)
    }
  })

  it('the anchor stays fixed under yaw and pitch; offset, scale and roll act about it', () => {
    for (const [yaw, pitch] of [[40, 0], [0, -35], [30, 25], [-60, 10]] as const) {
      expect(near(sphereField({ ...rest, yaw, pitch }).map(rest.anchor), rest.anchor)).toBe(true)
    }
    const f = sphereField({ ...rest, roll: 90, scale: 2, offset: { x: 5, y: -1 } })
    expect(near(f.map(rest.anchor), { x: 15, y: 19 })).toBe(true)
    // a point 1 to the right, at rest otherwise: scaled by 2 and turned 90° in plane (+x → +y), then moved
    expect(near(f.map({ x: 11, y: 20 }), { x: 15, y: 21 }, 1e-12)).toBe(true)
  })

  it('positive yaw turns the +x side away (narrower) and the −x side toward the viewer (wider): not an affine squash', () => {
    const f = sphereField({ ...rest, yaw: 40 })
    const right = f.map({ x: 12, y: 20 }), left = f.map({ x: 8, y: 20 })
    expect(right.x - 10).toBeLessThan(2)
    expect(10 - left.x).toBeGreaterThan(2)
    expect(right.y).toBeCloseTo(20, 12)
    // positive pitch: a point above the anchor (−y) comes closer, as the front turns up
    const g = sphereField({ ...rest, pitch: 30 })
    expect(Math.abs(g.map({ x: 10, y: 18 }).y - 20)).toBeLessThan(2)
  })

  it('the derivative equals finite differences', () => {
    const f = sphereField({ ...rest, yaw: 35, pitch: -20, roll: 15, scale: 1.3, offset: { x: 2, y: 3 } })
    const h = 1e-6
    for (const p of grid(rest, 0.55)) for (const v of [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 0.6, y: -0.8 }]) {
      const a = f.map({ x: p.x - h * v.x, y: p.y - h * v.y }), b = f.map({ x: p.x + h * v.x, y: p.y + h * v.y })
      expect(near(f.vector(p, v), { x: (b.x - a.x) / (2 * h), y: (b.y - a.y) / (2 * h) }, 1e-6)).toBe(true)
    }
  })

  it('a very large r approaches the affine squash cos(yaw) along x', () => {
    const f = sphereField({ ...rest, r: 1e6, yaw: 50 })
    const p = f.map({ x: 13, y: 22 })
    expect(p.x - 10).toBeCloseTo(3 * Math.cos(50 * Math.PI / 180), 4)
    expect(p.y - 20).toBeCloseTo(2, 4)
  })

  it('refuses a point on or beyond the sphere, and a point turned to the back', () => {
    const f = sphereField(rest)
    expect(() => f.map({ x: 13, y: 20 })).toThrow('超出了球面')
    expect(() => f.map({ x: 13.1, y: 20 })).toThrow('超出了球面')
    expect(() => f.map({ x: 12.99, y: 20 })).not.toThrow()
    // at yaw 80 a point on the +x side turns behind: its turned depth −sin80·x + cos80·z falls below 0.05 r
    const g = sphereField({ ...rest, yaw: 80 })
    expect(() => g.map({ x: 12.5, y: 20 })).toThrow('背面')
    expect(() => g.map({ x: 9.8, y: 20 })).not.toThrow()
    expect(() => sphereField({ ...rest, yaw: 90 })).toThrow('小于 90')
    expect(() => sphereField({ ...rest, r: 0 })).toThrow('大于 0')
    expect(() => sphereField({ ...rest, scale: -1 })).toThrow('大于 0')
    expect(() => sphereField({ ...rest, yaw: NaN })).toThrow('有限数')
    expect(() => f.map({ x: Infinity, y: 0 })).toThrow('有限数')
  })

  it('a curve refits with exact end points and a small error', () => {
    const f = sphereField({ ...rest, yaw: 45, pitch: 15 })
    const c: Cubic = [{ x: 8, y: 20 }, { x: 9, y: 18.8 }, { x: 11, y: 18.8 }, { x: 12, y: 20 }]
    const fit = fitDeformedCubic(c, f)
    expect(near(fit.shape[0], f.map(c[0]))).toBe(true)
    expect(near(fit.shape[3], f.map(c[3]))).toBe(true)
    expect(fit.maxError).toBeLessThan(0.02)
  })
})

describe('sphereField with the fit (dot 1792054665 #5)', () => {
  it('a handle off the sphere does not refuse a curve that stays on it', () => {
    const f = sphereField({ ...rest, yaw: 30 })
    // end points well inside (|q| = 1.5 < 3), handles about 3.5 from the anchor; the curve's farthest sample is inside
    const c: Cubic = [{ x: 8.5, y: 20 }, { x: 8.5, y: 16.8 }, { x: 11.5, y: 16.8 }, { x: 11.5, y: 20 }]
    expect(() => f.map(c[1])).toThrow('超出了球面')
    const fit = fitDeformedCubic(c, f)
    expect(near(fit.shape[0], f.map(c[0]))).toBe(true)
    expect(fit.maxError).toBeLessThan(0.1) // 3 wide: under 4 %
  })
  it('a curve that itself leaves the sphere is refused through its samples', () => {
    const f = sphereField({ ...rest, yaw: 30 })
    const c: Cubic = [{ x: 8.5, y: 20 }, { x: 8.5, y: 15 }, { x: 11.5, y: 15 }, { x: 11.5, y: 20 }] // bulges to y ≈ 16.25: |q| ≈ 3.75
    expect(() => fitDeformedCubic(c, f)).toThrow('超出了球面')
  })
  it('a non-finite handle is still refused', () => {
    const f = sphereField(rest)
    expect(() => fitDeformedCubic([{ x: 9, y: 20 }, { x: NaN, y: 20 }, { x: 11, y: 20 }, { x: 11, y: 20 }], f)).toThrow()
  })
})
