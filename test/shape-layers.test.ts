// Step 1 of the multi-view framework (docs/architecture-multiview.md §5; dot 1791652021):
// view definitions, shape layers by kind, and a handle bound to one drawing and one layer.
// Acceptance: the old front behaviour does not regress (the whole existing suite), layers
// never share data, drawings and trial copies never share data, a failed edit rolls back
// whole.
import { describe, it, expect } from 'vitest'
import * as net from '../src/network'
import * as views from '../src/views'
import { Core } from '../src'

const FRONT = { key: views.FRONT, kind: 'view' as const }

/** Two lines a–b–c in layer L, on one shape layer. */
function drawing() {
  const n = net.create(FRONT), ch = net.emptyChanges()
  net.addLayer(n, 'L')
  net.addLine(n, ch, 'l1', { id: 'a', layer: 'L', position: { x: 0, y: 0 } }, { id: 'b', layer: 'L', position: { x: 10, y: 0 } })
  net.addLine(n, ch, 'l2', 'b', { id: 'c', layer: 'L', position: { x: 20, y: 5 } })
  return n
}

describe('views', () => {
  it('nine distinct keys; the front is 0,0; anything else is refused', () => {
    expect(views.ALL).toHaveLength(9)
    expect(new Set(views.ALL).size).toBe(9)
    expect(views.FRONT).toBe('view:0,0')
    expect(views.key(-90, 45)).toBe('view:-90,45')
    expect(() => views.key(30 as views.Yaw, 0)).toThrow(/No view/)
  })
})

describe('shape layers never share data', () => {
  it('a geometry write in one layer leaves every other layer as it was', () => {
    const n = drawing(), ch = net.emptyChanges()
    net.addShapeLayer(n, 'view:90,0', 'view', views.FRONT)
    const side = net.of(n, 'view:90,0')
    net.move(side, ch, [{ id: 'b', target: { x: 3, y: 7 } }])
    net.moveHandle(side, ch, 'l1', 'a', { x: 1, y: 2 })
    net.setLineStroke(side, 'l2', { width: 4, profile: 'uniform' })
    expect(net.point(n, 'b').position).toEqual({ x: 10, y: 0 })
    expect(net.line(n, 'l1').ha).toEqual({ x: 10 / 3, y: 0 })
    expect(net.line(n, 'l2').stroke.width).toBe(1)
    expect(net.point(side, 'b').position).toEqual({ x: 3, y: 7 })
    expect(net.line(side, 'l1').ha).toEqual({ x: 1, y: 2 })
    expect(net.line(side, 'l2').stroke.width).toBe(4)
    // curves read the bound layer only
    expect(net.curve(n, 'l1')[3]).toEqual({ x: 10, y: 0 })
    expect(net.curve(side, 'l1')[3]).toEqual({ x: 3, y: 7 })
    expect(net.curves(side).get('l2')![0]).toEqual({ x: 3, y: 7 })
  })

  it('a new layer is a copy, not an alias, of the layer it starts from', () => {
    const n = drawing(), ch = net.emptyChanges()
    net.addShapeLayer(n, 'view:90,0', 'view', views.FRONT)
    net.move(n, ch, [{ id: 'a', target: { x: -5, y: -5 } }])
    expect(net.point(net.of(n, 'view:90,0'), 'a').position).toEqual({ x: 0, y: 0 })
  })

  it('structure is shared: deleting a line removes it from every layer, and isolated points go everywhere', () => {
    const n = drawing(), ch = net.emptyChanges()
    net.addShapeLayer(n, 'base:angle', 'record', views.FRONT)
    net.deleteLine(n, ch, 'l2')
    net.removeIsolated(n, ch)
    const rec = net.of(n, 'base:angle')
    expect(net.lines(rec).map(l => l.id)).toEqual(['l1'])
    expect(net.points(rec).map(p => p.id).sort()).toEqual(['a', 'b'])
    // saving holds exactly the same points and lines in every layer
    const again = net.restore(net.exportData(n), views.FRONT)
    expect(net.points(net.of(again, 'base:angle')).map(p => p.id).sort()).toEqual(['a', 'b'])
  })

  it('a bind removes the merged point and collapsed lines from every layer', () => {
    const n = drawing(), ch = net.emptyChanges()
    net.addShapeLayer(n, 'view:90,0', 'view', views.FRONT)
    net.bind(n, ch, 'a', 'c')
    const side = net.of(n, 'view:90,0')
    expect(net.points(side).map(p => p.id).sort()).toEqual(['a', 'b'])
    expect(() => net.restore(net.exportData(n), views.FRONT)).not.toThrow()
  })

  it('stage 1: structural changes that create geometry wait for stage 2 when there are several layers', () => {
    const n = drawing(), ch = net.emptyChanges()
    net.addShapeLayer(n, 'view:90,0', 'view', views.FRONT)
    expect(() => net.addLine(n, ch, 'l3', 'c', { id: 'd', layer: 'L', position: { x: 30, y: 0 } })).toThrow(/stage 2/)
    expect(() => net.splitLine(n, ch, 'l1', 0.5, 'm', 'p1', 'p2')).toThrow(/stage 2/)
    expect(() => net.unbind(n, ch, 'b', ['l2'], 'b2')).toThrow(/stage 2/)
    expect(() => net.insertLines(n, net.linesData(n, ['l1']), 'L', id => `x/${id}`)).toThrow(/stage 2/)
  })

  it('a handle names its layer explicitly: unknown layers and duplicate or unknown kinds are refused', () => {
    const n = drawing()
    expect(net.boundLayer(n)).toBe(views.FRONT)
    expect(() => net.of(n, 'view:9,9')).toThrow(/No shape layer/)
    net.addShapeLayer(n, 'expr:blink', 'expression', views.FRONT)
    expect(() => net.addShapeLayer(n, 'expr:blink', 'expression', views.FRONT)).toThrow(/already exists/)
    expect(() => net.addShapeLayer(n, 'x', 'magic' as never, views.FRONT)).toThrow(/Unknown shape layer kind/)
    expect(net.shapeLayers(n).map(l => [l.key, l.kind])).toEqual([[views.FRONT, 'view'], ['expr:blink', 'expression']])
  })

  it('ids named like object internals are ordinary keys in every layer', () => {
    const n = net.create(FRONT), ch = net.emptyChanges()
    net.addLayer(n, 'L')
    net.addLine(n, ch, '__proto__', { id: 'constructor', layer: 'L', position: { x: 1, y: 2 } }, { id: '__proto__', layer: 'L', position: { x: 3, y: 4 } })
    net.addShapeLayer(n, 'view:90,0', 'view', views.FRONT)
    net.move(net.of(n, 'view:90,0'), ch, [{ id: '__proto__', target: { x: 9, y: 9 } }])
    expect(net.point(n, '__proto__').position).toEqual({ x: 3, y: 4 })
    expect(net.point(net.of(n, 'view:90,0'), '__proto__').position).toEqual({ x: 9, y: 9 })
    expect(net.line(n, '__proto__').ha).toEqual({ x: 2 / 3, y: 2 / 3 })
    const again = net.restore(net.exportData(n), views.FRONT)
    expect(net.point(net.of(again, 'view:90,0'), '__proto__').position).toEqual({ x: 9, y: 9 })
  })

  it('reads are frozen copies; writing through them never reaches a layer', () => {
    const n = drawing()
    const p = net.point(n, 'a'), l = net.line(n, 'l1')
    expect(Object.isFrozen(p.position) && Object.isFrozen(l.ha) && Object.isFrozen(l.stroke)).toBe(true)
    const v = { x: 1, y: 1 }
    net.move(n, net.emptyChanges(), [{ id: 'a', target: v }])
    v.x = 99
    expect(net.point(n, 'a').position).toEqual({ x: 1, y: 1 })
  })
})

describe('drawings and trial copies never share data', () => {
  it('a copy of a drawing is independent in every layer', () => {
    const n = drawing()
    net.addShapeLayer(n, 'view:90,0', 'view', views.FRONT)
    const copy = net.restore(net.exportData(n), views.FRONT)
    net.move(net.of(copy, 'view:90,0'), net.emptyChanges(), [{ id: 'a', target: { x: 5, y: 5 } }])
    net.move(copy, net.emptyChanges(), [{ id: 'b', target: { x: 6, y: 6 } }])
    expect(net.point(net.of(n, 'view:90,0'), 'a').position).toEqual({ x: 0, y: 0 })
    expect(net.point(n, 'b').position).toEqual({ x: 10, y: 0 })
  })

  it('two handles of one drawing see the same layer data; handles of two drawings never do', () => {
    const n = drawing(), m = drawing()
    const n2 = net.of(n, views.FRONT)
    net.move(n2, net.emptyChanges(), [{ id: 'a', target: { x: 2, y: 2 } }])
    expect(net.point(n, 'a').position).toEqual({ x: 2, y: 2 })
    expect(net.point(m, 'a').position).toEqual({ x: 0, y: 0 })
  })

  it('two documents never share shape data, and an edit\'s trial copy publishes nothing until it commits', () => {
    const A = Core.newDocument(), B = Core.newDocument()
    A.edit(e => e.line('l1', { id: 'a', layer: 'layer-1', position: { x: 0, y: 0 } }, { id: 'b', layer: 'layer-1', position: { x: 10, y: 0 } }))
    B.edit(e => e.line('l1', { id: 'a', layer: 'layer-1', position: { x: 0, y: 0 } }, { id: 'b', layer: 'layer-1', position: { x: 10, y: 0 } }))
    A.edit(e => e.move([{ id: 'a', target: { x: 4, y: 4 } }]))
    expect(B.snapshot().points.find(p => p.id === 'a')!.position).toEqual({ x: 0, y: 0 })
    const before = JSON.stringify(A.snapshot())
    A.edit(e => { e.move([{ id: 'b', target: { x: 50, y: 50 } }]); e.cancel() })
    expect(JSON.stringify(A.snapshot())).toBe(before)
  })
})

describe('a failed edit rolls back whole', () => {
  it('geometry, stroke and structure written before the failure are all undone, and no undo step is added', () => {
    const d = Core.newDocument()
    d.edit(e => e.line('l1', { id: 'a', layer: 'layer-1', position: { x: 0, y: 0 } }, { id: 'b', layer: 'layer-1', position: { x: 10, y: 0 } }))
    const before = JSON.stringify([d.snapshot(), d.geometry()])
    expect(() => d.edit(e => {
      e.move([{ id: 'a', target: { x: 3, y: 3 } }])
      e.lineStroke('l1', { width: 7, profile: 'uniform' })
      e.line('l2', 'b', { id: 'c', layer: 'layer-1', position: { x: 20, y: 0 } })
      e.move([{ id: 'nowhere', target: { x: 0, y: 0 } }])
    })).toThrow()
    expect(JSON.stringify([d.snapshot(), d.geometry()])).toBe(before)
    d.undo()
    expect(d.snapshot().lines).toHaveLength(0)
  })
})
