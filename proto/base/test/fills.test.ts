// The Live Paint Bucket's face search (src/fills.ts, doc 18 §30.11).
import { describe, expect, it } from 'vitest'
import { Editor } from '../src/editor'
import { faceAt, outlineOf, sameFill } from '../src/fills'
import { exampleRecords, ids } from '../src/fixture'
import { Container, Curve } from '../src/schema'

const anchor = (id: string, x: number, y: number) => ({ id, p: { x, y }, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 } })
const line = (n: string, x1: number, y1: number, x2: number, y2: number) =>
  Curve.create({ id: Curve.createId(n), name: n, parentId: 'container:L' as any, index: `a${n}`, anchors: { p: anchor('p', x1, y1), q: anchor('q', x2, y2) }, segments: [{ id: 's', from: 'p', to: 'q' }] })
const keys = (f: any) => f.boundary.map((b: any) => ('bridge' in b ? 'bridge' : `${b.curveId}/${b.segmentId}`)).sort()

describe('faceAt', () => {
  it('the jaw: two curves connected at both ends enclose the area the example fill F covers — its four segments', () => {
    const e = new Editor(exampleRecords())
    const f = faceAt(e.reader, e.derived.evaluated(), { x: 30, y: 50 })
    expect('error' in f).toBe(false)
    expect(keys(f)).toEqual(['curve:C1/s1', 'curve:C1/s2', 'curve:C2/s3', 'curve:C2/s4'])
    expect(sameFill(e.reader, (f as any).boundary)).toBe(ids.F)
    expect(e.apply({ type: 'createFill', parentId: ids.L1, boundary: (f as any).boundary }).ok).toBe(true) // a valid boundary
  })
  it('four separate lines whose ends meet at the same places: a square, joined by zero-length bridges', () => {
    const e = new Editor([Container.create({ id: 'container:L' as any, name: 'L', index: 'a1' }), line('1', 0, 0, 10, 0), line('2', 10, 0, 10, 10), line('3', 10, 10, 0, 10), line('4', 0, 10, 0, 0)])
    const f = faceAt(e.reader, e.derived.evaluated(), { x: 5, y: 5 }) as any
    expect(keys(f).filter((k: string) => k !== 'bridge')).toEqual(['curve:1/s', 'curve:2/s', 'curve:3/s', 'curve:4/s'])
    expect(keys(f).filter((k: string) => k === 'bridge').length).toBe(4)
    expect(f.area).toBeCloseTo(100, 6)
    expect(e.apply({ type: 'createFill', parentId: 'container:L' as any, boundary: f.boundary }).ok).toBe(true)
    // outside the square, or lines that only cross: no area
    expect('error' in faceAt(e.reader, e.derived.evaluated(), { x: 20, y: 5 })).toBe(true)
    const x = new Editor([Container.create({ id: 'container:L' as any, name: 'L', index: 'a1' }), line('1', 0, 0, 10, 10), line('2', 10, 0, 0, 10), line('3', 0, 0, 10, 0)])
    expect((faceAt(x.reader, x.derived.evaluated(), { x: 5, y: 2 }) as any).error).toMatch(/交叉不算/)
  })
  it('two areas side by side: the click picks the smaller one that contains it', () => {
    const e = new Editor([Container.create({ id: 'container:L' as any, name: 'L', index: 'a1' }), line('1', 0, 0, 20, 0), line('2', 20, 0, 20, 10), line('3', 20, 10, 0, 10), line('4', 0, 10, 0, 0), line('5', 10, 0, 10, 10)])
    // line 1 / 3 run past x = 10 without an anchor there: the divider 5 only crosses them — one area, the whole box
    const whole = faceAt(e.reader, e.derived.evaluated(), { x: 5, y: 5 }) as any
    expect(whole.area).toBeCloseTo(200, 6)
  })
})

describe('outlineOf (select the outline, make its fill — v103 createFill(curveIds))', () => {
  it('the two jaw curves give F\'s outline; four lines meeting at their ends give the square; open lines are refused', () => {
    const e = new Editor(exampleRecords())
    const f = outlineOf(e.reader, e.derived.evaluated(), [ids.C1, ids.C2]) as any
    expect(keys(f)).toEqual(['curve:C1/s1', 'curve:C1/s2', 'curve:C2/s3', 'curve:C2/s4'])
    expect((outlineOf(e.reader, e.derived.evaluated(), [ids.C1]) as any).error).toMatch(/没有围成闭合轮廓/)
    const q = new Editor([Container.create({ id: 'container:L' as any, name: 'L', index: 'a1' }), line('1', 0, 0, 10, 0), line('2', 10, 0, 10, 10), line('3', 10, 10, 0, 10), line('4', 0, 10, 0, 0), line('5', 0, 0, 10, 10)])
    // with a diagonal through it: the OUTLINE (largest face), not one of the triangles
    expect((outlineOf(q.reader, q.derived.evaluated(), ['curve:1', 'curve:2', 'curve:3', 'curve:4', 'curve:5']) as any).area).toBeCloseTo(100, 6)
    expect((outlineOf(q.reader, q.derived.evaluated(), []) as any).error).toMatch(/先选中/)
  })
})
