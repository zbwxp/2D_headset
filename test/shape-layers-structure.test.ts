// Step 2 of the multi-view framework (architecture §1; scope Claude 1791652727): every
// structural change is decided once and reaches every shape layer in the same call.
// - pen: the drawn shape in every layer; existing end points keep each layer's position
// - split: each layer splits its own curve at the same t (proposal)
// - unbind: each layer's old position + one offset measured in the bound layer (proposal)
// - bind / delete / isolated points: every layer
// - insert (paste): each layer from the clip layer the caller names for it; none → refused
// - pen: view layers only; refused while expression or record layers exist (dot 1791652760)
// The record of added points and lines is complete.
import { describe, it, expect } from 'vitest'
import * as net from '../src/network'
import * as clipboard from '../src/clipboard'
import * as views from '../src/views'
import { Core } from '../src'

const FRONT = { key: views.FRONT, kind: 'view' as const }
const SIDE = 'view:90,0', TOP = 'view:0,45'
type Data = { shapes: { layers: { key: string }[] } }

/** Lines a–b–c in layer L, with three shape layers whose geometry differs (one of them a record). */
function threeLayers(third: { key: string; kind: 'view' | 'record' } = { key: 'base:angle', kind: 'record' }) {
  const n = net.create(FRONT), ch = net.emptyChanges()
  net.addLayer(n, 'L')
  net.addLine(n, ch, 'l1', { id: 'a', layer: 'L', position: { x: 0, y: 0 } }, { id: 'b', layer: 'L', position: { x: 10, y: 0 } })
  net.addLine(n, ch, 'l2', 'b', { id: 'c', layer: 'L', position: { x: 20, y: 5 } })
  net.addShapeLayer(n, SIDE, 'view', views.FRONT)
  net.addShapeLayer(n, third.key, third.kind, views.FRONT)
  const side = net.of(n, SIDE), base = net.of(n, third.key), c = net.emptyChanges()
  net.move(side, c, [{ id: 'a', target: { x: 2, y: 3 } }, { id: 'b', target: { x: 7, y: -4 } }, { id: 'c', target: { x: 9, y: 9 } }])
  net.moveHandle(side, c, 'l1', 'a', { x: 1, y: 5 })
  net.setLineStroke(side, 'l1', { width: 3, profile: 'uniform' })
  net.move(base, c, [{ id: 'b', target: { x: 11, y: 1 } }])
  net.moveHandle(base, c, 'l2', 'b', { x: -2, y: 2 })
  return n
}

/** One layer of a drawing, alone (front-keyed), as an independent single-layer drawing. */
function alone(n: net.NetworkState, key: string): net.NetworkState {
  const d = net.exportData(n) as Data
  d.shapes.layers = d.shapes.layers.filter(l => l.key === key).map(l => ({ ...l, key: views.FRONT }))
  return net.restore(d, views.FRONT)
}
const layerOf = (n: net.NetworkState, key: string) => {
  const h = net.of(n, key)
  return { points: net.points(h).map(p => [p.id, p.position]), lines: net.lines(h).map(l => [l.id, l.a, l.b, l.ha, l.hb, l.stroke]) }
}
const layers = (n: net.NetworkState) => net.shapeLayers(n).map(l => l.key)
/** Every layer holds exactly the structure's points and lines (the saved form checks it). */
const covered = (n: net.NetworkState) => expect(() => net.restore(net.exportData(n), views.FRONT)).not.toThrow()

const VIEWS3 = { key: TOP, kind: 'view' as const }

describe('pen on several layers', () => {
  it('while expression or record layers exist, a new line is refused (their owners initialise them)', () => {
    const n = threeLayers(), before = JSON.stringify(net.exportData(n))
    expect(() => net.addLine(n, net.emptyChanges(), 'l3', 'c', { id: 'd', layer: 'L', position: { x: 1, y: 1 } })).toThrow(/new-line-needs-owner: the base:angle layer/)
    expect(JSON.stringify(net.exportData(n))).toBe(before)
  })

  it('a new line has the drawn shape in every view layer; an existing end keeps each layer\'s position', () => {
    const n = threeLayers(VIEWS3), side = net.of(n, SIDE), ch = net.emptyChanges()
    net.addLine(side, ch, 'l3', 'c', { id: 'd', layer: 'L', position: { x: 30, y: 30 } }, { ha: { x: 1, y: 0 }, hb: { x: 0, y: 1 } })
    for (const key of layers(n)) {
      const h = net.of(n, key)
      expect(net.point(h, 'd').position).toEqual({ x: 30, y: 30 })
      expect(net.line(h, 'l3').ha).toEqual({ x: 1, y: 0 })
      expect(net.line(h, 'l3').hb).toEqual({ x: 0, y: 1 })
      expect(net.line(h, 'l3').stroke).toEqual({ width: 1, profile: 'uniform' })
    }
    expect(net.point(n, 'c').position).toEqual({ x: 20, y: 5 })
    expect(net.point(side, 'c').position).toEqual({ x: 9, y: 9 })
    expect(ch.addedPoints).toEqual(['d'])
    expect(ch.addedLines).toEqual(['l3'])
    covered(n)
  })

  it('default handles are measured in the layer the line is drawn in', () => {
    const n = threeLayers(VIEWS3), side = net.of(n, SIDE)
    net.addLine(side, net.emptyChanges(), 'l3', 'c', { id: 'd', layer: 'L', position: { x: 12, y: 9 } })
    // from c (9, 9) in the side layer to d (12, 9): a straight line there
    for (const key of layers(n)) expect(net.line(net.of(n, key), 'l3').ha).toEqual({ x: 1, y: 0 })
  })
})

describe('split on several layers (same t; proposal)', () => {
  it('each layer equals splitting that layer alone, and no layer\'s drawing changes', () => {
    const n = threeLayers()
    const before = new Map(layers(n).map(k => [k, alone(n, k)]))
    const ch = net.emptyChanges()
    net.splitLine(net.of(n, SIDE), ch, 'l1', 0.3, 'm', 'p1', 'p2')
    for (const key of layers(n)) {
      const single = before.get(key)!
      net.splitLine(single, net.emptyChanges(), 'l1', 0.3, 'm', 'p1', 'p2')
      expect(layerOf(n, key)).toEqual(layerOf(single, views.FRONT))
    }
    // the side layer's stroke went to both pieces there, the front's in the front
    expect(net.line(net.of(n, SIDE), 'p1').stroke.width).toBe(3)
    expect(net.line(n, 'p2').stroke.width).toBe(1)
    expect(ch.addedPoints).toEqual(['m'])
    expect(ch.addedLines).toEqual(['p1', 'p2'])
    covered(n)
  })
})

describe('unbind on several layers (old position + one offset; proposal)', () => {
  it('the offset is measured in the bound layer and added to each layer\'s own old position', () => {
    const n = threeLayers(), side = net.of(n, SIDE)
    const old = new Map(layers(n).map(k => [k, net.point(net.of(n, k), 'b').position]))
    net.unbind(side, net.emptyChanges(), 'b', ['l2'], 'b2')
    const shiftSide = { x: net.point(side, 'b2').position.x - old.get(SIDE)!.x, y: net.point(side, 'b2').position.y - old.get(SIDE)!.y }
    expect(Math.hypot(shiftSide.x, shiftSide.y)).toBeCloseTo(net.UNBIND_OFFSET, 12)
    for (const key of layers(n)) {
      const p = net.point(net.of(n, key), 'b2').position, o = old.get(key)!
      expect(p.x).toBeCloseTo(o.x + shiftSide.x, 12)
      expect(p.y).toBeCloseTo(o.y + shiftSide.y, 12)
      expect(net.point(net.of(n, key), 'b').position).toEqual(o)
      expect(net.line(net.of(n, key), 'l2').a).toBe('b2')
    }
    covered(n)
  })
})

describe('bind and delete on several layers', () => {
  it('each layer equals binding or deleting in that layer alone', () => {
    const n = threeLayers()
    const before = new Map(layers(n).map(k => [k, alone(n, k)]))
    net.bind(n, net.emptyChanges(), 'a', 'c')
    net.deleteLine(n, net.emptyChanges(), 'l1')
    net.removeIsolated(n, net.emptyChanges())
    for (const key of layers(n)) {
      const single = before.get(key)!
      net.bind(single, net.emptyChanges(), 'a', 'c')
      net.deleteLine(single, net.emptyChanges(), 'l1')
      net.removeIsolated(single, net.emptyChanges())
      expect(layerOf(n, key)).toEqual(layerOf(single, views.FRONT))
    }
    covered(n)
  })
})

describe('insert (paste) on several layers', () => {
  it('each drawing layer takes the copy layer the caller names; the offset applies everywhere', () => {
    const src = threeLayers()
    const data = net.linesData(net.of(src, SIDE), ['l1'])
    expect(data.source).toBe(SIDE)
    expect(data.layers.map(l => l.key)).toEqual([views.FRONT, SIDE, 'base:angle'])
    const dst = net.create(FRONT)
    net.addLayer(dst, 'M')
    net.addShapeLayer(dst, SIDE, 'view', views.FRONT)
    net.addShapeLayer(dst, TOP, 'view', views.FRONT)
    const ch = net.emptyChanges()
    const map = net.insertLines(dst, ch, data, 'M', id => `x/${id}`, { x: 100, y: 0 }, new Map([[views.FRONT, views.FRONT], [SIDE, SIDE], [TOP, SIDE]]))
    expect([...map.lines.values()]).toEqual(['x/l1'])
    const at = (key: string, id: string) => net.point(net.of(dst, key), id).position
    expect(at(views.FRONT, 'x/a')).toEqual({ x: 100, y: 0 })
    expect(at(SIDE, 'x/a')).toEqual({ x: 102, y: 3 })
    expect(at(TOP, 'x/a')).toEqual({ x: 102, y: 3 })                  // as the caller named: TOP ← SIDE
    expect(net.line(net.of(dst, TOP), 'x/l1').ha).toEqual({ x: 1, y: 5 })
    expect(net.line(dst, 'x/l1').stroke.width).toBe(1)
    expect(ch.addedPoints.sort()).toEqual(['x/a', 'x/b'])
    expect(ch.addedLines).toEqual(['x/l1'])
    covered(dst)
  })

  it('a drawing layer with no named copy layer refuses the insert, before anything is written', () => {
    const src = threeLayers(), data = net.linesData(src, ['l1'])
    const dst = net.create(FRONT)
    net.addLayer(dst, 'M')
    net.addShapeLayer(dst, TOP, 'view', views.FRONT)
    const before = JSON.stringify(net.exportData(dst))
    expect(() => net.insertLines(dst, net.emptyChanges(), data, 'M', id => `x/${id}`, { x: 0, y: 0 }, new Map([[views.FRONT, views.FRONT]]))).toThrow(/paste-layer-unmatched: shape layer view:0,45/)
    expect(() => net.insertLines(dst, net.emptyChanges(), data, 'M', id => `x/${id}`, { x: 0, y: 0 }, new Map([[views.FRONT, views.FRONT], [TOP, 'view:-90,0']]))).toThrow(/paste-layer-unmatched/)
    expect(JSON.stringify(net.exportData(dst))).toBe(before)
  })

  it('a document paste maps view layers by the same key only; a record layer, or a view layer the clip lacks, is refused', () => {
    const src = threeLayers(), clip = { network: net.linesData(src, ['l1']), joins: { rows: [], endStrokes: [] }, fills: [], names: { lines: [], groups: [] } }
    const parts = (n: net.NetworkState) => ({ network: n }) as unknown as clipboard.Parts
    const viewsOnly = net.create(FRONT); net.addShapeLayer(viewsOnly, SIDE, 'view', views.FRONT)
    expect([...clipboard.viewLayerMap(parts(viewsOnly), clip)]).toEqual([[views.FRONT, views.FRONT], [SIDE, SIDE]])
    const withRecord = net.create(FRONT); net.addShapeLayer(withRecord, 'base:angle', 'record', views.FRONT)
    expect([...clipboard.viewLayerMap(parts(withRecord), clip)]).toEqual([[views.FRONT, views.FRONT]])
    const lacking = net.create(FRONT); net.addShapeLayer(lacking, TOP, 'view', views.FRONT)
    expect([...clipboard.viewLayerMap(parts(lacking), clip)]).toEqual([[views.FRONT, views.FRONT]])
  })

  it('a clip is checked: each shape layer must hold exactly its points and lines', () => {
    const d = Core.newDocument()
    d.edit(e => e.line('l1', { id: 'a', layer: 'layer-1', position: { x: 0, y: 0 } }, { id: 'b', layer: 'layer-1', position: { x: 10, y: 0 } }))
    const clip = d.copy(['l1'])
    expect(() => clipboard.check(clip)).not.toThrow()
    const bad = (f: (c: any) => void) => { const c = structuredClone(clip) as any; f(c); return () => clipboard.check(c) }
    expect(bad(c => { c.network.layers[0].points.pop() })).toThrow(/exactly the clip's points/)
    expect(bad(c => { c.network.layers[0].points.push({ id: 'ghost', position: { x: 0, y: 0 } }) })).toThrow(/exactly the clip's points/)
    expect(bad(c => { c.network.layers[0].lines = [] })).toThrow(/exactly the clip's lines/)
    expect(bad(c => { c.network.layers.push(structuredClone(c.network.layers[0])) })).toThrow(/appears twice/)
    expect(bad(c => { delete c.network.source })).toThrow(/source layer is not text/)
    expect(bad(c => { c.network.layers[0].lines[0].stroke.width = 'wide' })).toThrow(/stroke width is not a finite number/)
  })
})

describe('a refused operation leaves the whole state unchanged (dot 1791652671)', () => {
  it('a refused bind, a refused paste and a refused split publish nothing and add no undo step', () => {
    const d = Core.newDocument()
    d.edit(e => { e.layer('layer-2', 'Layer 2'); e.line('l1', { id: 'a', layer: 'layer-1', position: { x: 0, y: 0 } }, { id: 'b', layer: 'layer-1', position: { x: 10, y: 0 } }) })
    d.edit(e => e.line('k1', { id: 'k', layer: 'layer-2', position: { x: 0, y: 9 } }, { id: 'j', layer: 'layer-2', position: { x: 10, y: 9 } }))
    const saved = () => JSON.stringify([d.snapshot(), d.geometry()])
    const before = saved(), steps = () => { let k = 0; while (d.canUndo) { d.undo(); k++ } ; for (let i = 0; i < k; i++) d.redo(); return k }
    const n = steps()
    expect(() => d.edit(e => e.bind('a', 'k'))).toThrow(/within one layer/)
    const clip = d.copy(['l1']) as any
    clip.network.layers[0].points.pop()
    expect(() => d.edit(e => e.paste(clip, 'layer-1', { x: 5, y: 5 }, 'p'))).toThrow(/exactly the clip's points/)
    expect(() => d.edit(e => { e.move([{ id: 'a', target: { x: 1, y: 1 } }]); e.split('l1', 1.5, 'm', 's1', 's2') })).toThrow(/inside the line/)
    expect(saved()).toBe(before)
    expect(steps()).toBe(n)
  })
})

describe('random structural edits on three layers', () => {
  it('every layer always covers the structure, and split / bind / delete / pen with handles agree with each layer alone', () => {
    let seed = 7
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31 }
    for (let run = 0; run < 25; run++) {
      const n = threeLayers(VIEWS3)
      let k = 0
      for (let step = 0; step < 30; step++) {
        const ls = net.lines(n), ps = net.points(n)
        const before = new Map(layers(n).map(key => [key, alone(n, key)]))
        const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!
        const r = rnd(), id = `${run}-${step}`
        let op: ((h: net.NetworkState) => void) | undefined
        if (r < 0.3 || !ls.length) {
          const from = ps.length && rnd() < 0.6 ? pick(ps).id : { id: `p${id}`, layer: 'L', position: { x: rnd() * 50, y: rnd() * 50 } }
          const to = { id: `q${id}`, layer: 'L', position: { x: rnd() * 50, y: rnd() * 50 } }
          const handles = { ha: { x: rnd() - 0.5, y: rnd() }, hb: { x: rnd(), y: rnd() - 0.5 } }
          op = h => net.addLine(h, net.emptyChanges(), `n${id}`, from, to, handles)
        } else if (r < 0.55) {
          const l = pick(ls).id, t = 0.1 + 0.8 * rnd()
          op = h => net.splitLine(h, net.emptyChanges(), l, t, `m${id}`, `s${id}`, `t${id}`)
        } else if (r < 0.75 && ps.length >= 2) {
          const a = pick(ps).id, b = pick(ps.filter(p => p.id !== a)).id
          op = h => { net.bind(h, net.emptyChanges(), a, b); net.removeIsolated(h, net.emptyChanges()) }
        } else {
          const l = pick(ls).id
          op = h => { net.deleteLine(h, net.emptyChanges(), l); net.removeIsolated(h, net.emptyChanges()) }
        }
        op(net.of(n, pick(layers(n))))
        for (const [key, single] of before) { op(single); expect(layerOf(n, key)).toEqual(layerOf(single, views.FRONT)) }
        covered(n)
        k++
      }
      expect(k).toBe(30)
    }
  })
})
