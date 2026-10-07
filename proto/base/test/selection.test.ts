// Editor skeleton block 1 — the selection core (src/selection.ts), transformItems and the layers model, in node.
// Picking through fills needs a canvas (fillContains): that part is accepted in Chromium (e2e/selection.spec.ts).
import { describe, expect, it } from 'vitest'
import { Editor } from '../src/editor'
import { exampleRecords, ids } from '../src/fixture'
import { paintCases } from '../src/paintCases'
import { allUnits, boundsOf, deletionSetOf, layerOf, pickAt, Selection, unitOf, unitsAt, unitsInRect } from '../src/selection'
import { layerRows, rangeOf } from '../src/ui/layerTree'
import { Container, Curve } from '../src/schema'

const anchor = (id: string, x: number, y: number) => ({ id, p: { x, y }, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 } })
/** L1 = [G1 = [G2 = [deep]], top]; L2 = [front] — `front` crosses `top` and `deep` at (50, 50) */
const nested = () => [
  Container.create({ id: Container.createId('L1'), name: 'L1', index: 'a1' }),
  Container.create({ id: Container.createId('L2'), name: 'L2', index: 'a2' }),
  Container.create({ id: Container.createId('G1'), name: 'G1', index: 'a1', parentId: Container.createId('L1') }),
  Container.create({ id: Container.createId('G2'), name: 'G2', index: 'a1', parentId: Container.createId('G1') }),
  Curve.create({ id: Curve.createId('deep'), name: 'deep', parentId: Container.createId('G2'), index: 'a1', anchors: { p: anchor('p', 50, 0), q: anchor('q', 50, 100) }, segments: [{ id: 's', from: 'p', to: 'q' }] }),
  Curve.create({ id: Curve.createId('top'), name: 'top', parentId: Container.createId('L1'), index: 'a2', anchors: { p: anchor('p', 0, 50), q: anchor('q', 100, 50) }, segments: [{ id: 's', from: 'p', to: 'q' }] }),
  Curve.create({ id: Curve.createId('front'), name: 'front', parentId: Container.createId('L2'), index: 'a1', anchors: { p: anchor('p', 0, 0), q: anchor('q', 100, 100) }, segments: [{ id: 's', from: 'p', to: 'q' }] }),
]

describe('selection units and picking (Illustrator Selection tool)', () => {
  it('the unit is the outermost group below the layer; a layer is its own unit; a reference instance is its placement', () => {
    const e = new Editor(nested())
    expect(unitOf(e.reader, 'curve:deep')).toBe('container:G1')
    expect(unitOf(e.reader, 'container:G2')).toBe('container:G1')
    expect(unitOf(e.reader, 'curve:top')).toBe('curve:top')
    expect(unitOf(e.reader, 'container:L1')).toBe('container:L1')
    expect(layerOf(e.reader, 'curve:deep')).toBe('container:L1')
    const x = new Editor(exampleRecords())
    expect(unitsAt(x.reader, x.derived.evaluated(), { x: 85, y: 35 }, 1)).toEqual(['reference:R1']) // the mirrored ear
  })

  it('the stack under a point is front to back in paint order; ⌘-click goes one deeper each time and stops at the bottom', () => {
    const e = new Editor(nested())
    const ev = e.derived.evaluated()
    const at = { x: 50, y: 50 }
    expect(unitsAt(e.reader, ev, at, 1)).toEqual(['curve:front', 'curve:top', 'container:G1'])
    expect(pickAt(e.reader, ev, at, 1)).toBe('curve:front')
    expect(pickAt(e.reader, ev, at, 1, ['curve:front'])).toBe('curve:top')
    expect(pickAt(e.reader, ev, at, 1, ['curve:top'])).toBe('container:G1')
    expect(pickAt(e.reader, ev, at, 1, ['container:G1'])).toBe('container:G1')
    expect(pickAt(e.reader, ev, at, 1, ['curve:elsewhere'])).toBe('curve:front')
    expect(pickAt(e.reader, ev, { x: 300, y: 300 }, 1)).toBe(null)
  })

  it('hidden and locked items are neither picked nor marquee-selected', () => {
    const e = new Editor(nested())
    e.apply({ type: 'setContainerFlags', containerId: 'container:L2' as any, visible: false })
    e.apply({ type: 'setContainerFlags', containerId: 'container:G2' as any, locked: true })
    const ev = e.derived.evaluated()
    expect(unitsAt(e.reader, ev, { x: 50, y: 50 }, 1)).toEqual(['curve:top'])
    expect(unitsInRect(e.reader, ev, { x0: -10, y0: -10, x1: 200, y1: 200 })).toEqual(['curve:top'])
    expect(allUnits(e.reader, ev)).toEqual(['curve:top'])
  })

  it('marquee: touching by default (also a rectangle crossing a line with no sample inside); enclosed = every item completely inside', () => {
    const e = new Editor(nested())
    const ev = e.derived.evaluated()
    // a thin rectangle across `deep` (x = 50) between samples, away from the others
    expect(unitsInRect(e.reader, ev, { x0: 40, y0: 81, x1: 60, y1: 81.5 })).toEqual(['container:G1'])
    expect(unitsInRect(e.reader, ev, { x0: 40, y0: 81, x1: 60, y1: 81.5 }, true)).toEqual([])
    expect(unitsInRect(e.reader, ev, { x0: 40, y0: -1, x1: 60, y1: 101 }, true)).toEqual(['container:G1'])
    expect(unitsInRect(e.reader, ev, { x0: 60, y0: 101, x1: 40, y1: -1 }, true)).toEqual(['container:G1']) // any drag direction
  })

  it('bounds cover the drawn items of the units (a group: everything inside)', () => {
    const e = new Editor(nested())
    const near = (r: any, want: any) => Object.entries(want).forEach(([k, v]) => expect(r[k]).toBeCloseTo(v as number, 9))
    near(boundsOf(e.reader, e.derived.evaluated(), ['container:G1']), { x0: 50, y0: 0, x1: 50, y1: 100 })
    near(boundsOf(e.reader, e.derived.evaluated(), ['curve:top', 'curve:front']), { x0: 0, y0: 0, x1: 100, y1: 100 })
    expect(boundsOf(e.reader, e.derived.evaluated(), [])).toBe(null)
  })

  it('the Selection: set keeps order without duplicates, toggle, add, prune after an undo; it is not an undo step', () => {
    const e = new Editor(nested())
    const s = new Selection()
    s.set(['curve:top', 'curve:front', 'curve:top'])
    expect(s.get()).toEqual(['curve:top', 'curve:front'])
    s.toggle('curve:top')
    s.add(['container:G1'])
    expect(s.get()).toEqual(['curve:front', 'container:G1'])
    expect(e.history.undo).toEqual([])
    e.apply({ type: 'deleteRecords', ids: ['curve:front'] })
    s.prune(e.reader)
    expect(s.get()).toEqual(['container:G1'])
    e.undo()
    s.prune(e.reader)
    expect(s.get()).toEqual(['container:G1']) // undo does not bring back a selection (Inkscape)
  })
})

describe('transformItems (the Selection tool transform)', () => {
  const m = { a: 2, b: 0, c: 0, d: 1, e: 5, f: -3 }
  it('containers: the same result as transformContainers (each anchor once, linked ends follow, references composed)', () => {
    const a = new Editor(exampleRecords()), b = new Editor(exampleRecords())
    for (const e of [a, b]) e.apply({ type: 'setContainerFlags', containerId: ids.L2, locked: false })
    expect(a.apply({ type: 'transformContainers', containerIds: [ids.L1, ids.L3], matrix: m }).ok).toBe(true)
    expect(b.apply({ type: 'transformItems', ids: [ids.L1, ids.L3], matrix: m }).ok).toBe(true)
    expect(b.reader.serialize('document')).toEqual(a.reader.serialize('document'))
    expect(a.history.undo.at(-1)).toBe('transformContainers')
    expect(b.history.undo.at(-1)).toBe('transformItems')
  })
  it('a curve: its anchors; a linked end in another curve follows; a curve in a locked layer is refused', () => {
    const e = new Editor(exampleRecords())
    const r = e.apply({ type: 'transformItems', ids: [ids.C1], matrix: { a: 1, b: 0, c: 0, d: 1, e: 4, f: 0 } })
    expect(r.ok === false && r.error.code).toBe('LOCKED') // a3 is linked to b3 in the locked L2
    e.apply({ type: 'setContainerFlags', containerId: ids.L2, locked: false })
    expect(e.apply({ type: 'transformItems', ids: [ids.C1], matrix: { a: 1, b: 0, c: 0, d: 1, e: 4, f: 0 } }).ok).toBe(true)
    const c1 = (e.reader.get(ids.C1) as any).anchors, c2 = (e.reader.get(ids.C2) as any).anchors
    expect(c1.a2.p).toEqual({ x: 14, y: 60 })
    expect(c2.b3.p).toEqual(c1.a3.p)
    expect(c2.b2.p).toEqual({ x: 80, y: 50 })
  })
  it('a fill moves its boundary curves (project adaptation); a reference composes its placement; one undo step', () => {
    const e = new Editor(exampleRecords())
    e.apply({ type: 'setContainerFlags', containerId: ids.L2, locked: false })
    const before = JSON.stringify(e.reader.serialize('document'))
    expect(e.apply({ type: 'transformItems', ids: [ids.F, ids.R1], matrix: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 2 } }).ok).toBe(true)
    expect((e.reader.get(ids.C1) as any).anchors.a1.p).toEqual({ x: 0, y: 2 })
    expect((e.reader.get(ids.C2) as any).anchors.b2.p).toEqual({ x: 80, y: 52 })
    expect((e.reader.get(ids.R1) as any).transform).toEqual({ a: -1, b: 0, c: 0, d: 1, e: 60, f: 2 })
    e.undo()
    expect(JSON.stringify(e.reader.serialize('document'))).toBe(before)
  })
  it('refuses what has no geometry to transform, a missing id, nothing, or a bad matrix', () => {
    const e = new Editor(exampleRecords())
    const no = (cmd: any, code: string) => {
      const r = e.apply(cmd)
      expect(r.ok === false && r.error.code).toBe(code)
    }
    no({ type: 'transformItems', ids: [ids.J], matrix: m }, 'INVALID')
    no({ type: 'transformItems', ids: ['curve:nope'], matrix: m }, 'NOT_FOUND')
    no({ type: 'transformItems', ids: [], matrix: m }, 'INVALID')
    no({ type: 'transformItems', ids: [ids.E1], matrix: { ...m, a: NaN } }, 'INVALID')
  })
})

describe('layers panel model and Delete', () => {
  it('rows front first at every level, nested with depth; collapsed containers hide their rows; Shift range', () => {
    const e = new Editor(exampleRecords())
    const rows = layerRows(e.reader, () => true)
    expect(rows.map((r) => [r.id, r.depth])).toEqual([
      ['container:L3', 0], ['curve:E1', 1], ['container:L2', 0], ['curve:C2', 1], ['fill:F', 1], ['container:L1', 0], ['reference:R1', 1], ['curve:C1', 1],
    ])
    expect(rows.find((r) => r.id === 'curve:C2')?.lockedBy).toBe('container:L2')
    expect(layerRows(e.reader, (id) => id !== 'container:L2').map((r) => r.id)).toEqual(['container:L3', 'curve:E1', 'container:L2', 'container:L1', 'reference:R1', 'curve:C1'])
    expect(rangeOf(rows, 'fill:F', 'curve:E1')).toEqual(['curve:E1', 'container:L2', 'curve:C2', 'fill:F'])
  })
  it('Delete removes a container with its content and a curve with its connections / track; a dependant elsewhere is refused by name', () => {
    const e = new Editor(exampleRecords())
    expect(deletionSetOf(e.reader, [ids.L3]).sort()).toEqual([ids.E1, ids.L3].sort())
    const c1 = deletionSetOf(e.reader, [ids.C1])
    expect(c1).toEqual(expect.arrayContaining([ids.C1, ids.J, ids.J0]))
    e.apply({ type: 'setContainerFlags', containerId: ids.L2, locked: false })
    const r = e.apply({ type: 'deleteRecords', ids: c1 })
    expect(r.ok === false && r.error.objects).toContain(ids.F) // the fill bounded by C1 still needs it
    expect(e.apply({ type: 'deleteRecords', ids: deletionSetOf(e.reader, [ids.L2]) }).ok).toBe(true) // F and C2 go with their layer
  })
})

it('the paint cases used by the browser acceptance exist with the documented structure', () => {
  const e = new Editor(paintCases['P3-nested'].records())
  expect(unitOf(e.reader, 'curve:R')).toBe('container:G')
})
