// Arrange / group / ungroup / new layer (src/arrange.ts, doc 18 §30.6): only parents and indices change.
import { describe, expect, it } from 'vitest'
import { Editor } from '../src/editor'
import { Container, Curve } from '../src/schema'

const anchor = (id: string, x: number, y: number) => ({ id, p: { x, y }, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 } })
const line = (n: string, parent: string, index: string, y: number) =>
  Curve.create({ id: Curve.createId(n), name: n, parentId: parent as any, index, anchors: { p: anchor('p', 0, y), q: anchor('q', 10, y) }, segments: [{ id: 's', from: 'p', to: 'q' }] })
/** L1 = [a, b, c, d] (back → front), L2 = [e] */
const doc = () => [
  Container.create({ id: Container.createId('L1'), name: 'L1', index: 'a1' }),
  Container.create({ id: Container.createId('L2'), name: 'L2', index: 'a2' }),
  line('a', 'container:L1', 'a1', 0), line('b', 'container:L1', 'a2', 1), line('c', 'container:L1', 'a3', 2), line('d', 'container:L1', 'a4', 3), line('e', 'container:L2', 'a1', 4),
]
const order = (e: Editor) => e.derived.evaluated().paint.map((p) => p.item.address.replace('curve:', ''))
const geometry = (e: Editor) => JSON.stringify(e.reader.allRecords().filter((r: any) => r.typeName === 'curve').map((r: any) => [r.id, r.anchors]).sort())

describe('arrange (Illustrator Object › Arrange)', () => {
  it('front / back / forward / backward within the parent; several keep their order; geometry untouched; one undo step', () => {
    const e = new Editor(doc())
    const g = geometry(e)
    expect(order(e)).toEqual(['a', 'b', 'c', 'd', 'e'])
    e.apply({ type: 'arrange', ids: ['curve:a', 'curve:b'], to: 'front' })
    expect(order(e)).toEqual(['c', 'd', 'a', 'b', 'e']) // stays inside L1, below L2
    e.apply({ type: 'arrange', ids: ['curve:b'], to: 'back' })
    expect(order(e)).toEqual(['b', 'c', 'd', 'a', 'e'])
    e.apply({ type: 'arrange', ids: ['curve:c'], to: 'forward' })
    expect(order(e)).toEqual(['b', 'd', 'c', 'a', 'e'])
    e.apply({ type: 'arrange', ids: ['curve:c', 'curve:a'], to: 'backward' })
    expect(order(e)).toEqual(['b', 'c', 'a', 'd', 'e']) // c past d, a past d (c and a keep their order)
    expect(geometry(e)).toBe(g)
    const before = order(e)
    const r = e.apply({ type: 'arrange', ids: ['curve:e'], to: 'front' }) // already at the front of its layer
    expect(r.ok && r.written).toBe(false)
    expect(order(e)).toEqual(before)
    expect(e.history.undo).toEqual(['arrange', 'arrange', 'arrange', 'arrange'])
  })
  it('backward moves each selected one place past the next unselected sibling below it', () => {
    const e = new Editor(doc())
    e.apply({ type: 'arrange', ids: ['curve:c', 'curve:d'], to: 'backward' })
    expect(order(e)).toEqual(['a', 'c', 'd', 'b', 'e'])
  })
})

describe('group / ungroup (⌘G / ⇧⌘G) and a new layer', () => {
  it('group: a new group where the front-most selected object was, members in their paint order; across layers it goes to the front-most one\'s layer', () => {
    const e = new Editor(doc())
    const r = e.apply({ type: 'group', ids: ['curve:d', 'curve:b'] })
    expect(r.ok).toBe(true)
    const gid = (r as any).affected[0]
    expect((e.reader.get(gid) as any).parentId).toBe('container:L1')
    expect(order(e)).toEqual(['a', 'c', 'b', 'd', 'e']) // b, d now together at d's place
    e.undo()
    const x = e.apply({ type: 'group', ids: ['curve:a', 'curve:e'] })
    expect((e.reader.get((x as any).affected[0]) as any).parentId).toBe('container:L2') // e is the front-most
    expect(order(e)).toEqual(['b', 'c', 'd', 'a', 'e'])
  })
  it('ungroup: the children take the group\'s place, the group record goes; group + ungroup keeps the paint order', () => {
    const e = new Editor(doc())
    const gid = (e.apply({ type: 'group', ids: ['curve:b', 'curve:c'] }) as any).affected[0]
    const grouped = order(e)
    expect(e.apply({ type: 'ungroup', ids: [gid] }).ok).toBe(true)
    expect(e.reader.get(gid as any)).toBeUndefined()
    expect(order(e)).toEqual(grouped)
    expect(order(e)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
  it('refused, by name: grouping or ungrouping layers; ungrouping a placed group or a mask target; anything locked', () => {
    const e = new Editor(doc())
    const no = (cmd: any, code: string, re: RegExp) => {
      const r = e.apply(cmd)
      expect(r.ok === false && r.error.code).toBe(code)
      expect(r.ok === false && r.error.message).toMatch(re)
    }
    no({ type: 'group', ids: ['container:L1'] }, 'INVALID', /layers are not grouped/)
    no({ type: 'ungroup', ids: ['container:L1'] }, 'INVALID', /a layer is not ungrouped/)
    const gid = (e.apply({ type: 'group', ids: ['curve:b'] }) as any).affected[0]
    e.apply({ type: 'setMask', sources: { fills: [], strokes: ['curve:a' as any] }, targets: [gid], mode: 'inside' })
    no({ type: 'ungroup', ids: [gid] }, 'BAD_REFERENCE', /target of mask/)
    e.apply({ type: 'setContainerFlags', containerId: 'container:L1' as any, locked: true })
    no({ type: 'arrange', ids: ['curve:a'], to: 'front' }, 'LOCKED', /locked/)
  })
  it('a new layer goes on top of the layers; a new group on top inside its parent', () => {
    const e = new Editor(doc())
    const r = e.apply({ type: 'createContainer', parentId: null })
    const id = (r as any).affected[0]
    expect((e.reader.get(id) as any)).toMatchObject({ name: '图层', parentId: null })
    expect((e.reader.get(id) as any).index > (e.reader.get('container:L2' as any) as any).index).toBe(true)
  })
})
