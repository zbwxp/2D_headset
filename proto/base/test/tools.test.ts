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
