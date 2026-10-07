// setProps — the properties panel and the layer rename (doc 18 §30.4).
import { expect, it } from 'vitest'
import { Editor } from '../src/editor'
import { exampleRecords, ids } from '../src/fixture'

it('name / stroke / fill colour: only the given fields change, one undo step each; refusals write nothing', () => {
  const e = new Editor(exampleRecords())
  const get = (id: string) => e.reader.get(id as any) as any
  expect(e.apply({ type: 'setProps', id: ids.L3, name: '  耳 ' }).ok).toBe(true)
  expect(get(ids.L3).name).toBe('耳')
  expect(e.apply({ type: 'setProps', id: ids.E1, stroke: { width: 6 } }).ok).toBe(true)
  expect(get(ids.E1).stroke).toEqual({ ...(exampleRecords().find((r) => r.id === ids.E1) as any).stroke, width: 6 })
  expect(e.apply({ type: 'setProps', id: ids.E1, stroke: { color: '#ff0000' } }).ok).toBe(true)
  expect(get(ids.E1).stroke).toEqual({ color: '#ff0000', width: 6 })
  e.apply({ type: 'setContainerFlags', containerId: ids.L2, locked: false })
  expect(e.apply({ type: 'setProps', id: ids.F, color: '#00ff00' }).ok).toBe(true)
  expect(get(ids.F).color).toBe('#00ff00')
  expect(e.history.undo).toEqual(['setProps', 'setProps', 'setProps', 'setContainerFlags', 'setProps'])
  const before = JSON.stringify(e.reader.serialize('document'))
  const no = (cmd: any, code: string, msg: RegExp) => {
    const r = e.apply(cmd)
    expect(r.ok === false && r.error.code).toBe(code)
    expect(r.ok === false && r.error.message).toMatch(msg)
  }
  no({ type: 'setProps', id: ids.E1, name: '   ' }, 'INVALID', /must not be empty/)
  no({ type: 'setProps', id: ids.E1, stroke: { color: 'red' } }, 'INVALID', /#rgb or #rrggbb/)
  no({ type: 'setProps', id: ids.E1, stroke: { width: 0 } }, 'INVALID', /positive/)
  no({ type: 'setProps', id: ids.F, stroke: { width: 2 } }, 'INVALID', /has no stroke/)
  no({ type: 'setProps', id: ids.E1, color: '#000' }, 'INVALID', /no fill colour/)
  no({ type: 'setProps', id: 'curve:none', name: 'x' }, 'NOT_FOUND', /no record/)
  e.apply({ type: 'setContainerFlags', containerId: ids.L2, locked: true })
  no({ type: 'setProps', id: ids.C2, name: 'x' }, 'LOCKED', /locked/) // an object in a locked layer is not edited
  expect(e.apply({ type: 'setProps', id: ids.L2, name: '阴影层' }).ok).toBe(true) // a locked layer can be renamed (Illustrator)
  e.undo()
  e.undo()
  expect(JSON.stringify(e.reader.serialize('document'))).toBe(before)
})
