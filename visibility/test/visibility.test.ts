// visibility package 1 (docs/mask-p1-checklist.md §4): masks on plain areas.
import { describe, it, expect } from 'vitest'
import { apply, area, size, type Area, type Cubic } from '..'

const P = (x: number, y: number) => ({ x, y })
const rect = (x0: number, y0: number, x1: number, y1: number): Area => [[P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)]]
const target = rect(0, 0, 10, 10), source = rect(5, 0, 15, 10)

describe('masks on areas', () => {
  it('inverse: the target minus the source; normal: the target within it (exact areas)', () => {
    expect(size(apply(target, [{ mode: 'inverse', sources: [source] }]))).toBeCloseTo(50, 9)
    expect(size(apply(target, [{ mode: 'normal', sources: [source] }]))).toBeCloseTo(50, 9)
  })
  it('several sources of one relation are united', () => {
    const a = rect(0, 0, 3, 10), b = rect(7, 0, 10, 10)
    expect(size(apply(target, [{ mode: 'inverse', sources: [a, b] }]))).toBeCloseTo(40, 9)
    expect(size(apply(target, [{ mode: 'normal', sources: [a, b] }]))).toBeCloseTo(60, 9)
  })
  it('sources winding opposite ways do not cancel: each is a region first, then they are united (dot 1791903159)', () => {
    const cw: Area = [[P(0, 0), P(0, 10), P(10, 10), P(10, 0)]], ccw = target
    expect(apply(target, [{ mode: 'inverse', sources: [ccw, cw] }])).toEqual([]) // coincident, opposite: the whole square
    const shifted: Area = [[P(5, 0), P(5, 10), P(15, 10), P(15, 0)]] // overlapping half, winding the other way
    expect(size(apply(target, [{ mode: 'inverse', sources: [rect(0, 0, 6, 10), shifted] }]))).toBeCloseTo(0, 9)
    expect(size(apply(target, [{ mode: 'normal', sources: [ccw, cw] }]))).toBeCloseTo(100, 9)
  })
  it('a relation whose sources are all off changes nothing — a normal-mode target does not vanish (dot 1791901708)', () => {
    expect(size(apply(target, [{ mode: 'normal', sources: [null, null] }]))).toBeCloseTo(100, 9)
    expect(size(apply(target, [{ mode: 'inverse', sources: [null] }]))).toBeCloseTo(100, 9)
    // one source on, one off: the one that is on acts
    expect(size(apply(target, [{ mode: 'inverse', sources: [null, source] }]))).toBeCloseTo(50, 9)
  })
  it('a source that is on but empty takes part as an empty area — kept apart from every source off (dot 1791902445)', () => {
    expect(size(apply(target, [{ mode: 'inverse', sources: [[]] }]))).toBeCloseTo(100, 9) // nothing removed
    expect(apply(target, [{ mode: 'normal', sources: [[]] }])).toEqual([]) // nothing left — and it stays empty
    expect(size(apply(target, [{ mode: 'normal', sources: [null] }]))).toBeCloseTo(100, 9) // off: skipped
  })
  it('a target cut away entirely stays empty', () => {
    expect(apply(rect(2, 2, 4, 4), [{ mode: 'inverse', sources: [target] }])).toEqual([])
  })
  it('several relations: each only removes, so the order does not matter', () => {
    const r1 = { mode: 'inverse' as const, sources: [rect(0, 0, 4, 10)] }, r2 = { mode: 'normal' as const, sources: [rect(0, 0, 10, 6)] }
    expect(size(apply(target, [r1, r2]))).toBeCloseTo(36, 9)
    expect(size(apply(target, [r2, r1]))).toBeCloseTo(36, 9)
  })
  it('an empty target stays empty; no relation keeps the target as it is', () => {
    expect(apply([], [{ mode: 'normal', sources: [source] }])).toEqual([])
    expect(size(apply(target, []))).toBeCloseTo(100, 9)
  })
})

describe('a fill\'s area', () => {
  it('a straight-sided loop: exactly its polygon', () => {
    const line = (a: { x: number; y: number }, b: { x: number; y: number }): Cubic => [a, P(a.x + (b.x - a.x) / 3, a.y + (b.y - a.y) / 3), P(a.x + 2 * (b.x - a.x) / 3, a.y + 2 * (b.y - a.y) / 3), b]
    const sq = [line(P(0, 0), P(10, 0)), line(P(10, 0), P(10, 10)), line(P(10, 10), P(0, 10)), line(P(0, 10), P(0, 0))]
    expect(size(area(sq))).toBeCloseTo(100, 9)
  })
  it('a circle of four cubics: its area within the tolerance\'s band', () => {
    const k = 0.5522847498, r = 10
    const circle: Cubic[] = [
      [P(r, 0), P(r, k * r), P(k * r, r), P(0, r)], [P(0, r), P(-k * r, r), P(-r, k * r), P(-r, 0)],
      [P(-r, 0), P(-r, -k * r), P(-k * r, -r), P(0, -r)], [P(0, -r), P(k * r, -r), P(r, -k * r), P(r, 0)],
    ]
    const a = size(area(circle, 0.01)), perimeter = 2 * Math.PI * r
    expect(Math.abs(a - Math.PI * r * r)).toBeLessThan(0.01 * perimeter + 0.1) // within the chords' band (and the 4-cubic circle's own error)
  })
  it('a self-crossing loop is read with the non-zero rule, as the canvas draws fills (a v3 fill has no holes)', () => {
    // a figure 8 of straight cubics: two unit-square lobes winding opposite ways — both count under non-zero
    const seg = (a: { x: number; y: number }, b: { x: number; y: number }): Cubic => [a, P(a.x + (b.x - a.x) / 3, a.y + (b.y - a.y) / 3), P(a.x + 2 * (b.x - a.x) / 3, a.y + 2 * (b.y - a.y) / 3), b]
    const eight = [seg(P(0, 0), P(1, 1)), seg(P(1, 1), P(1, 0)), seg(P(1, 0), P(0, 1)), seg(P(0, 1), P(0, 0))]
    expect(size(area(eight))).toBeCloseTo(0.5, 6) // two triangles of ½ · ½ each
    expect(size(apply(rect(0, 0, 1, 1), [{ mode: 'inverse', sources: [area(eight)] }]))).toBeCloseTo(0.5, 6)
  })
  it('a non-finite boundary or tolerance is refused', () => {
    expect(() => area([[P(0, 0), P(NaN, 0), P(1, 1), P(2, 2)]])).toThrow(/not finite/)
    expect(() => area([], 0)).toThrow(/tolerance/)
  })
})
