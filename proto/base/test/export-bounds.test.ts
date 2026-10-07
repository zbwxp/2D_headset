// Export bounds (src/export.ts drawingBounds / strokeBox; review of 9291848, dot 1791365700 E1): exact cubic extremes,
// the ink's half width, the miter tip of a join — never a sampled estimate.
import { describe, expect, it } from 'vitest'
import { Editor } from '../src/editor'
import { drawingBounds } from '../src/export'
import { Container, Curve, type DocRecord } from '../src/schema'

const a = (id: string, x: number, y: number, hOut = { x: 0, y: 0 }, hIn = { x: 0, y: 0 }) => ({ id, p: { x, y }, hIn, hOut })
const layer = Container.create({ id: 'container:L' as any, name: 'L', index: 'a1' })
const curve = (anchors: Record<string, any>, segs: [string, string][], width = 3) =>
  Curve.create({ id: Curve.createId('c'), name: 'c', parentId: 'container:L' as any, index: 'a1', anchors, segments: segs.map(([f, t], i) => ({ id: `s${i}`, from: f, to: t })), stroke: { color: '#ff0000', width } })
const boundsOf = (...recs: DocRecord[]) => drawingBounds(new Editor([layer, ...recs]).derived.evaluated(), 0)!

describe('drawingBounds', () => {
  it("dot's E1 cubic: (-30,-10) with a handle of 10000 up to (10,-10) — the exact top -4454.444… (at t = 1/3), minus the half ink width", () => {
    const b = boundsOf(curve({ p: a('p', -30, -10, { x: 0, y: -10000 }), q: a('q', 10, -10) }, [['p', 'q']]))
    const top = -10 - 10000 * (4 / 9) // y(t) = -10 − 10000·3(1−t)²t, largest at t = 1/3
    const half = 3 / 3 / 2 // ink width = stroke width / 3 (inkStyle)
    expect(b.y).toBeCloseTo(top - half, 9)
    expect(b.y + b.h).toBeCloseTo(-10 + half, 9)
    // the sampled estimate this replaces was 7.29 units short at the top (dot's measurement)
    expect(b.y).toBeLessThan(-4447.15234375 - 7)
  })

  it('every point of the ink outline (centre line ± half the width along the normal) of random cubics lies inside (exactness at an interior extreme: the E1 case above)', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 400 - 200
    for (let k = 0; k < 40; k++) {
      const P = [0, 1, 2, 3].map(() => ({ x: rnd(), y: rnd() }))
      const c = curve({ p: a('p', P[0].x, P[0].y, { x: P[1].x - P[0].x, y: P[1].y - P[0].y }), q: a('q', P[3].x, P[3].y, {x:0,y:0}, { x: P[2].x - P[3].x, y: P[2].y - P[3].y }) }, [['p', 'q']], 6)
      const b = boundsOf(c)
      const half = 1
      const outside: string[] = []
      for (let i = 0; i <= 4000; i++) {
        const t = i / 4000, u = 1 - t
        const x = u * u * u * P[0].x + 3 * u * u * t * P[1].x + 3 * u * t * t * P[2].x + t * t * t * P[3].x
        const y = u * u * u * P[0].y + 3 * u * u * t * P[1].y + 3 * u * t * t * P[2].y + t * t * t * P[3].y
        const dx = 3 * u * u * (P[1].x - P[0].x) + 6 * u * t * (P[2].x - P[1].x) + 3 * t * t * (P[3].x - P[2].x)
        const dy = 3 * u * u * (P[1].y - P[0].y) + 6 * u * t * (P[2].y - P[1].y) + 3 * t * t * (P[3].y - P[2].y)
        const d = Math.hypot(dx, dy) || 1
        for (const s of [-1, 1]) {
          const qx = x + (s * half * -dy) / d, qy = y + (s * half * dx) / d
          if (qx < b.x - 1e-9 || qx > b.x + b.w + 1e-9 || qy < b.y - 1e-9 || qy > b.y + b.h + 1e-9) outside.push(`${k}@${t}: (${qx}, ${qy})`)
        }
      }
      expect(outside).toEqual([])
    }
  })

  it('a mitred join reaches its miter tip; a join sharper than the limit is bevelled and stays within half the width', () => {
    // a right angle at (10, 10): outer side downward, miter = half · √2
    const v = boundsOf(curve({ p: a('p', 0, 0), q: a('q', 10, 10), r: a('r', 20, 0) }, [['p', 'q'], ['q', 'r']]))
    expect(v.y + v.h).toBeCloseTo(10 + 0.5 * Math.SQRT2, 9)
    // 2·atan(10/100) ≈ 11.4°: 1 / sin(5.7°) ≈ 10 > 4 → bevel: the lowest ink is the box of the centre line + half
    const sharp = boundsOf(curve({ p: a('p', 0, 0), q: a('q', 10, 100), r: a('r', 20, 0) }, [['p', 'q'], ['q', 'r']]))
    expect(sharp.y + sharp.h).toBeCloseTo(100 + 0.5, 9)
  })

  it("E1b (dot 1791366809): a zero-length segment between two others leaves their join — dot's right angle reaches its miter tip 20·√2", () => {
    // dot's sample: (-100,-100) → (0,0) → [zero length at (0,0)] → (100,-100); stroke 120 → ink 40, half 20
    const zeroMid = curve({ a0: a('a0', -100, -100), a1: a('a1', 0, 0), a2: a('a2', 0, 0), a3: a('a3', 100, -100) }, [['a0', 'a1'], ['a1', 'a2'], ['a2', 'a3']], 120)
    expect(boundsOf(zeroMid).y + boundsOf(zeroMid).h).toBeCloseTo(20 * Math.SQRT2, 9)
    // the same without the zero-length segment: the same bounds
    const plain = curve({ a0: a('a0', -100, -100), a1: a('a1', 0, 0), a3: a('a3', 100, -100) }, [['a0', 'a1'], ['a1', 'a3']], 120)
    expect(boundsOf(zeroMid)).toEqual(boundsOf(plain))
    // several zero-length segments in a row: still the one join
    const zeros = curve({ a0: a('a0', -100, -100), a1: a('a1', 0, 0), a2: a('a2', 0, 0), b: a('b', 0, 0), a3: a('a3', 100, -100) }, [['a0', 'a1'], ['a1', 'a2'], ['a2', 'b'], ['b', 'a3']], 120)
    expect(boundsOf(zeros)).toEqual(boundsOf(plain))
  })

  it('E1b: zero-length segments at the start or the end, and at the seam of a closed loop (drawn as an open run: caps, no join there)', () => {
    const plain = curve({ a0: a('a0', -100, -100), a1: a('a1', 0, 0), a3: a('a3', 100, -100) }, [['a0', 'a1'], ['a1', 'a3']], 120)
    const atStart = curve({ s: a('s', -100, -100), a0: a('a0', -100, -100), a1: a('a1', 0, 0), a3: a('a3', 100, -100) }, [['s', 'a0'], ['a0', 'a1'], ['a1', 'a3']], 120)
    const atEnd = curve({ a0: a('a0', -100, -100), a1: a('a1', 0, 0), a3: a('a3', 100, -100), e: a('e', 100, -100) }, [['a0', 'a1'], ['a1', 'a3'], ['a3', 'e']], 120)
    expect(boundsOf(atStart)).toEqual(boundsOf(plain))
    expect(boundsOf(atEnd)).toEqual(boundsOf(plain))
    // a closed triangle whose closing segment is zero length at the seam: the inner corners keep their miters
    const tri = Curve.create({ id: Curve.createId('tri'), name: 'tri', parentId: 'container:L' as any, index: 'a1', closed: true, stroke: { color: '#f00', width: 120 },
      anchors: { p: a('p', -100, -100), q: a('q', 0, 0), r: a('r', 100, -100), z: a('z', -100, -100) },
      segments: [{ id: 's1', from: 'p', to: 'q' }, { id: 's2', from: 'q', to: 'r' }, { id: 's3', from: 'r', to: 'z' }, { id: 's4', from: 'z', to: 'p' }] })
    const b = boundsOf(tri)
    expect(b.y + b.h).toBeCloseTo(20 * Math.SQRT2, 9) // the corner at (0, 0)
  })

  it('fills: the exact bounds of their outline, no ink', () => {
    const e = new Editor([layer, curve({ p: a('p', 0, 0, { x: 0, y: -100 }), q: a('q', 10, 0) }, [['p', 'q']])])
    const c = e.reader.allRecords().find((r) => r.typeName === 'curve')!
    const r = e.apply({ type: 'paintRegion', boundary: [{ curveId: c.id as any, segmentId: 's0', dir: 1 }, { bridge: { from: { curveId: c.id as any, anchorId: 'q' }, to: { curveId: c.id as any, anchorId: 'p' } } }], color: '#00ff00' })
    expect(r.ok).toBe(true)
    // the fill's outline top is the curve's: y(1/3) = −100·(4/9); the line drawn there adds half its ink
    const b = drawingBounds(e.derived.evaluated(), 0)!
    expect(b.y).toBeCloseTo(-100 * (4 / 9) - 0.5, 9)
  })
})
