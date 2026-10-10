// Step 5: name scope and meta (docs/step5-names-meta.md; dot 1791654857, 1791655027,
// 1791655111, 1791655253). Kept: a rename never changes identity (only the lookup key
// follows); copying a 元组件 keeps its inner names; meta keeps no second state.
import { describe, it, expect } from 'vitest'
import { Core, save, open, type Vec } from '../src'

const P = (x: number, y = 0): Vec => ({ x, y })
const SIDE = 'view:90,0'
const lineName = (d: Core, id: string) => d.snapshot().lines.find(l => l.id === id)?.name
const groupOf = (d: Core, line: string) => d.snapshot().groups.find(g => g.lines.includes(line))!

function doc() {
  const d = Core.newDocument({ layer: { id: 'L', name: '眼睛1' } })
  d.edit(e => { e.layer('M', '眼睛2'); e.line('l1', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(10) }) })
  return d
}

describe('rename keeps identity; the lookup key follows', () => {
  it('a renamed line keeps its id and every view\'s shape; lineByName finds it by the new name only', () => {
    const d = doc()
    d.editIn(SIDE, e => e.move([{ id: 'b', target: P(4, 7) }]))
    const before = d.views().map(k => JSON.stringify(d.in(k).snapshot().lines.find(l => l.id === 'l1')))
    expect(d.lineByName('L', '曲线1')).toBe('l1')
    d.edit(e => e.renameLine('l1', '上眼皮'))
    expect(d.lineByName('L', '上眼皮')).toBe('l1')
    expect(d.lineByName('L', '曲线1')).toBeUndefined()
    expect(d.lineByName('M', '上眼皮')).toBeUndefined()
    d.views().forEach((k, i) => expect(JSON.stringify({ ...d.in(k).snapshot().lines.find(l => l.id === 'l1'), name: '曲线1' })).toBe(before[i]))
  })
})

describe('copying a 元组件 keeps its inner names and its type', () => {
  it('the layer is "<name>副本"; lines and curves keep their names; the type is copied', () => {
    const d = doc()
    d.edit(e => { e.renameLine('l1', '上眼皮'); e.layerType('L', '眼睛') })
    d.edit(e => e.copyLayer('L', 'C'))
    const layer = d.snapshot().layers.find(l => l.id === 'C')!
    expect(layer).toEqual({ id: 'C', name: '眼睛1副本', type: '眼睛' })
    expect(lineName(d, 'C/l1')).toBe('上眼皮')
    expect(d.lineByName('C', '上眼皮')).toBe('C/l1')
  })
})

describe('paste names are decided by the target layer', () => {
  it('kept where free, 副本 where taken; back into the source layer the originals hold the names', () => {
    const d = doc()
    d.edit(e => e.renameLine('l1', '上眼皮'))
    const clip = d.copy(['l1'])
    d.edit(e => e.paste(clip, 'M', P(0, 50), 'p1'))
    d.edit(e => e.paste(clip, 'L', P(0, 50), 'p2'))
    expect(lineName(d, 'p1/l1')).toBe('上眼皮')
    expect(lineName(d, 'p2/l1')).toBe('上眼皮副本')
  })

  it('after the original is deleted or renamed, pasting back into its layer keeps the name (dot 1791655111)', () => {
    const d = doc()
    d.edit(e => e.renameLine('l1', '上眼皮'))
    const clip = d.copy(['l1'])
    d.edit(e => e.deleteLine('l1'))
    d.edit(e => e.paste(clip, 'L', P(0, 50), 'p1'))
    expect(lineName(d, 'p1/l1')).toBe('上眼皮')
    d.edit(e => e.renameLine('p1/l1', '下眼皮'))
    d.edit(e => e.paste(clip, 'L', P(0, 90), 'p2'))
    expect(lineName(d, 'p2/l1')).toBe('上眼皮')
  })

  it('the defaults given while pasting never push out a name that could be kept', () => {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => {
      e.layer('M', 'M')
      e.line('x', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(10) })
      e.line('y', { id: 'c', layer: 'L', position: P(0, 20) }, { id: 'e', layer: 'L', position: P(10, 20) })
    })
    // x is 曲线1, y is 曲线2 (defaults). Copied as [y, x], the pasted y gets 曲线1 and the
    // pasted x 曲线2 for a moment; neither may push the other out of its own name
    expect([lineName(d, 'x'), lineName(d, 'y')]).toEqual(['曲线1', '曲线2'])
    const clip = d.copy(['y', 'x'])
    d.edit(e => e.paste(clip, 'M', P(0, 100), 'p'))
    expect(lineName(d, 'p/x')).toBe('曲线1')
    expect(lineName(d, 'p/y')).toBe('曲线2')
  })
})

describe('moving a curve to another layer (cut and paste keeping ids)', () => {
  it('default names that collide get 副本; ids and every view stay; one undo restores all (dot 1791655253)', () => {
    const d = doc()
    d.edit(e => e.line('m1', { id: 'x', layer: 'M', position: P(0, 40) }, { id: 'y', layer: 'M', position: P(10, 40) }))
    d.editIn(SIDE, e => e.move([{ id: 'a', target: P(-3, 3) }]))
    expect(lineName(d, 'l1')).toBe('曲线1'); expect(lineName(d, 'm1')).toBe('曲线1')
    const g = groupOf(d, 'l1').id, before = JSON.stringify(d.views().map(k => [d.in(k).snapshot(), d.in(k).geometry()]))
    d.edit(e => e.moveGroup(g, 'M'))
    expect(lineName(d, 'l1')).toBe('曲线1副本')
    expect(groupOf(d, 'l1').name).toBe('连续曲线1副本')
    expect(groupOf(d, 'l1').id).toBe(g)
    expect(d.in(SIDE).snapshot().points.find(p => p.id === 'a')!.position).toEqual(P(-3, 3))
    d.undo()
    expect(JSON.stringify(d.views().map(k => [d.in(k).snapshot(), d.in(k).geometry()]))).toBe(before)
  })

  it('names free in the target are reserved for the whole batch before any 副本 is given', () => {
    const d = doc()
    d.edit(e => {
      e.line('l2', 'b', { id: 'c', layer: 'L', position: P(20) })
      e.line('m1', { id: 'x', layer: 'M', position: P(0, 40) }, { id: 'y', layer: 'M', position: P(10, 40) })
    })
    // moving lines named 曲线1 (taken in M) and 曲线1副本 (free in M)
    d.edit(e => e.renameLine('l2', '曲线1副本'))
    d.edit(e => e.moveGroup(groupOf(d, 'l1').id, 'M'))
    expect(lineName(d, 'l2')).toBe('曲线1副本')
    expect(lineName(d, 'l1')).toBe('曲线1副本2')
  })
})

describe('meta: the 元组件 type is part of the one document state', () => {
  it('setting a type is one undo step; save / open keep it; a removed layer takes it along', () => {
    const d = doc()
    d.edit(e => e.layerType('L', '眼睛'))
    expect(d.snapshot().layers.find(l => l.id === 'L')!.type).toBe('眼睛')
    d.undo()
    expect(d.snapshot().layers.find(l => l.id === 'L')!.type).toBeUndefined()
    d.redo()
    expect(open(save(d)).snapshot().layers.find(l => l.id === 'L')!.type).toBe('眼睛')
    d.edit(e => e.layerType('M', '嘴'))
    d.edit(e => e.deleteLayer('M'))
    expect(JSON.stringify(save(d))).not.toContain('嘴')
    expect(() => d.edit(e => e.layerType('nowhere', 'x'))).toThrow(/No layer nowhere/)
  })

  it('a type on a missing layer, or out of its stored order, is refused at open', () => {
    const d = doc()
    d.edit(e => { e.layerType('L', '眼睛'); e.layerType('M', '嘴') })
    const f = JSON.parse(save(d))
    const bad = (g: (x: any) => void) => { const x = structuredClone(f); g(x); return JSON.stringify(x) }
    expect(() => open(bad(x => { x.document.meta.types[0][0] = 'gone' }))).toThrow(/missing layer gone/)
    expect(() => open(bad(x => { x.document.meta.types.reverse() }))).toThrow(/stored order/)
    expect(() => open(bad(x => { x.document.meta.types[0][1] = '' }))).toThrow(/empty/)
  })
})
