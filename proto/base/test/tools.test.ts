// Editor skeleton block 2 — the core pieces the tools use (the tools themselves are accepted in e2e/tools.spec.ts).
import { describe, expect, it } from 'vitest'
import { Editor } from '../src/editor'
import { exampleRecords, ids } from '../src/fixture'
import { anchorsInRect } from '../src/selection'
import { paintKey } from '../src/evaluate'

const a = (id: string, x: number, y: number) => ({ id, p: { x, y }, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 } })
const cmd = (index?: string) => ({ type: 'createCurve' as const, parentId: ids.L1, ...(index !== undefined ? { index } : {}), anchors: { p1: a('p1', 0, 0), p2: a('p2', 10, 0) }, segments: [{ id: 's1', from: 'p1', to: 'p2' }] })

describe('createCurve index (the Pen puts a new path on top of its layer)', () => {
  it('places the curve at the given index; it paints after its siblings', () => {
    const e = new Editor(exampleRecords())
    const r = e.apply(cmd('a9'))
    expect(r.ok).toBe(true)
    const id = (r as any).affected[0]
    expect((e.reader.get(id) as any).index).toBe('a9')
    const paint = e.derived.evaluated().paint.map((p) => p.item.address)
    expect(paint.indexOf(id)).toBeGreaterThan(paint.indexOf(ids.C1))
    expect(paintKey(e.reader as any, e.reader.get(id) as any) > paintKey(e.reader as any, e.reader.get(ids.C1) as any)).toBe(true)
  })
  it('without an index keeps the record default; an empty or non-string index is refused', () => {
    const e = new Editor(exampleRecords())
    expect(e.apply(cmd()).ok).toBe(true)
    for (const bad of ['', 3 as any]) {
      const r = e.apply(cmd(bad))
      expect(r.ok === false && r.error.code).toBe('INVALID')
    }
  })
})

it('the Direct Selection marquee selects the anchors of directly drawn, visible, unlocked curves inside it', () => {
  const e = new Editor(exampleRecords())
  const ev = e.derived.evaluated()
  expect(anchorsInRect(ev, { x0: -35, y0: 15, x1: 15, y1: 65 }).sort()).toEqual(['curve:C1#a2', 'curve:E1#e1', 'curve:E1#e2'])
  expect(anchorsInRect(ev, { x0: 75, y0: 15, x1: 95, y1: 55 })).toEqual([]) // C2#b2 is in the locked layer; R1's ear is an instance
  e.apply({ type: 'setContainerFlags', containerId: ids.L2, locked: false })
  expect(anchorsInRect(e.derived.evaluated(), { x0: 75, y0: 45, x1: 85, y1: 55 })).toEqual(['curve:C2#b2'])
})

describe('extendCurve (the Pen continues an open path from an end)', () => {
  const pen = () => {
    const e = new Editor(exampleRecords())
    const r = e.apply(cmd('a9'))
    return { e, id: (r as any).affected[0] as string }
  }
  it('at the end: anchors appended in order with new segments; the end anchor\'s outer handle when given; one undo step', () => {
    const { e, id } = pen()
    const r = e.apply({ type: 'extendCurve', curveId: id as any, end: 'end', anchors: [a('x', 20, 0), a('y', 20, 10)], endHandle: { x: 3, y: 0 } })
    expect(r.ok).toBe(true)
    const c = e.reader.get(id as any) as any
    const chain = c.segments.map((s: any) => [s.from, s.to])
    expect(chain.length).toBe(3)
    expect(chain[0]).toEqual(['p1', 'p2'])
    expect(chain[1][0]).toBe('p2')
    expect(chain.flat().every((x: string) => c.anchors[x])).toBe(true)
    expect(c.anchors[chain[2][1]].p).toEqual({ x: 20, y: 10 })
    expect(c.anchors.p2.hOut).toEqual({ x: 3, y: 0 })
    expect(c.anchors.p2.hIn).toEqual({ x: 0, y: 0 })
    expect(e.history.undo.at(-1)).toBe('extendCurve')
  })
  it('at the start: put before the first anchor; the outer handle there is hIn', () => {
    const { e, id } = pen()
    expect(e.apply({ type: 'extendCurve', curveId: id as any, end: 'start', anchors: [a('x', -10, 5)], endHandle: { x: -2, y: 0 } }).ok).toBe(true)
    const c = e.reader.get(id as any) as any
    expect(c.segments[0].to).toBe('p1')
    expect(c.anchors[c.segments[0].from].p).toEqual({ x: -10, y: 5 })
    expect(c.anchors.p1.hIn).toEqual({ x: -2, y: 0 })
  })
  it('refused, with the reason: a closed path; a curve with a head-turn track / preset forms / character data; nothing to add', () => {
    const { e, id } = pen()
    const no = (c: any, re: RegExp) => {
      const r = e.apply(c)
      expect(r.ok === false && r.error.message).toMatch(re)
    }
    no({ type: 'extendCurve', curveId: id, end: 'end', anchors: [] }, /no anchors/)
    no({ type: 'extendCurve', curveId: id, end: 'middle', anchors: [a('x', 1, 1)] }, /end must be/)
    e.apply({ type: 'setPoseKey', curveId: id as any, yaw: 30, offsets: { p1: { x: 1, y: 0 } } })
    no({ type: 'extendCurve', curveId: id, end: 'end', anchors: [a('x', 1, 1)] }, /head-turn track/)
    const f = new Editor(exampleRecords())
    const r = f.apply({ ...cmd('a9'), anchors: { p1: a('p1', 0, 0), p2: a('p2', 10, 0), p3: a('p3', 5, 8) }, segments: [{ id: 's1', from: 'p1', to: 'p2' }, { id: 's2', from: 'p2', to: 'p3' }, { id: 's3', from: 'p3', to: 'p1' }], closed: true })
    const closed = f.apply({ type: 'extendCurve', curveId: (r as any).affected[0], end: 'end', anchors: [a('x', 1, 1)] })
    expect(closed.ok === false && closed.error.message).toMatch(/closed/)
  })
})

it('setHandles writes both handles of one anchor (one step); refused when locked or not finite', async () => {
  const { isSmooth } = await import('../src/view/fabricView')
  const e = new Editor(exampleRecords())
  expect(e.apply({ type: 'setHandles', target: { curveId: ids.C1, anchorId: 'a2' }, hIn: { x: 0, y: -5 }, hOut: { x: 0, y: 5 } }).ok).toBe(true)
  expect((e.reader.get(ids.C1) as any).anchors.a2).toMatchObject({ hIn: { x: 0, y: -5 }, hOut: { x: 0, y: 5 } })
  expect(isSmooth((e.reader.get(ids.C1) as any).anchors.a2)).toBe(true)
  expect(isSmooth({ hIn: { x: 0, y: -5 }, hOut: { x: 5, y: 0 } })).toBe(false)
  expect(isSmooth({ hIn: { x: 0, y: 0 }, hOut: { x: 5, y: 0 } })).toBe(false)
  const bad = e.apply({ type: 'setHandles', target: { curveId: ids.C1, anchorId: 'a2' }, hIn: { x: NaN, y: 0 }, hOut: { x: 0, y: 0 } })
  expect(bad.ok === false && bad.error.code).toBe('INVALID')
  const locked = e.apply({ type: 'setHandles', target: { curveId: ids.C2, anchorId: 'b2' }, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 } })
  expect(locked.ok === false && locked.error.code).toBe('LOCKED')
})
