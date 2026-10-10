// Step 4 of the multi-view framework: arc radii and end strokes per view
// (docs/step4-per-view-joins.md; checked by dot 1791654260). Join modes stay shared.
// Acceptance uses different values per view: mirror apply keeps the other views' radii,
// unbind and split carry each view's radius, copy / paste and save / open carry them all.
import { describe, it, expect } from 'vitest'
import { Core, save, open, type Vec } from '../src'
import * as net from '../src/network'
import * as joins from '../src/joins'
import * as views from '../src/views'

const P = (x: number, y = 0): Vec => ({ x, y })
const FRONT = views.FRONT, SIDE = 'view:90,0', UP = 'view:0,45'
const radiusAt = (d: Core, layer: string, point: string) => d.in(layer).snapshot().joins.find(r => r.point === point && r.mode === 'arc')?.radius
const endAt = (d: Core, layer: string, point: string) => d.in(layer).snapshot().points.find(p => p.id === point)?.endStroke

/** ab and bc meeting at b, in layer L. */
function corner() {
  const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
  d.edit(e => { e.line('ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(10) }); e.line('bc', 'b', { id: 'c', layer: 'L', position: P(10, 10) }) })
  return d
}

describe('arc radius per view', () => {
  it('set in a side view: that view gets it, views without one get a copy; later changes stay in their view', () => {
    const d = corner()
    d.editIn(SIDE, e => e.join('b', 'ab', 'bc', { mode: 'arc', radius: 3 }))
    for (const k of d.views()) expect(radiusAt(d, k, 'b')).toBe(3)
    d.edit(e => e.join('b', 'ab', 'bc', { mode: 'arc', radius: 1 }))
    d.editIn(UP, e => e.join('b', 'ab', 'bc', { mode: 'arc', radius: 2 }))
    expect(radiusAt(d, FRONT, 'b')).toBe(1)
    expect(radiusAt(d, SIDE, 'b')).toBe(3)
    expect(radiusAt(d, UP, 'b')).toBe(2)
    // each view draws its own arc
    const arc = (k: string) => d.in(k).geometry().arcs[0]!
    expect(JSON.stringify(arc(FRONT))).not.toBe(JSON.stringify(arc(SIDE)))
  })

  it('another mode (shared) drops the radius from every view; setting the arc again starts from the new value', () => {
    const d = corner()
    d.editIn(SIDE, e => e.join('b', 'ab', 'bc', { mode: 'arc', radius: 3 }))
    d.edit(e => e.join('b', 'ab', 'bc', { mode: 'arc', radius: 1 }))
    d.editIn(SIDE, e => e.join('b', 'ab', 'bc', { mode: 'cusp' }))
    for (const k of d.views()) expect(radiusAt(d, k, 'b')).toBeUndefined()
    d.edit(e => e.join('b', 'ab', 'bc', { mode: 'arc', radius: 4 }))
    for (const k of d.views()) expect(radiusAt(d, k, 'b')).toBe(4)
  })

  it('while expression or record layers exist, an arc is refused (their owners give it a radius)', () => {
    const n = net.create({ key: FRONT, kind: 'view' }), ch = net.emptyChanges(), j = joins.create()
    net.addLayer(n, 'L')
    net.addLine(n, ch, 'ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(10) })
    net.addLine(n, ch, 'bc', 'b', { id: 'c', layer: 'L', position: P(10, 10) })
    net.addShapeLayer(n, 'base:angle', 'record', FRONT)
    expect(() => joins.setJoin(j, n, 'b', 'ab', 'bc', { mode: 'arc', radius: 2 })).toThrow(/arc-needs-owner/)
    joins.setJoin(j, n, 'b', 'ab', 'bc', { mode: 'smooth' })
    expect(joins.modes(j)).toHaveLength(1)
  })
})

describe('end strokes per view', () => {
  it('set or cleared in one view only', () => {
    const d = corner()
    d.editIn(SIDE, e => e.endStroke('a', { taper: 2 }))
    expect(endAt(d, SIDE, 'a')).toEqual({ taper: 2 })
    expect(endAt(d, FRONT, 'a')).toBeUndefined()
    d.edit(e => e.endStroke('a', { taper: 1 }))
    expect(endAt(d, SIDE, 'a')).toEqual({ taper: 2 })
    expect(endAt(d, FRONT, 'a')).toEqual({ taper: 1 })
  })

  it('a locked line\'s free-end end stroke is protected in the view that has it', () => {
    const d = corner()
    d.editIn(SIDE, e => e.endStroke('a', { taper: 2 }))
    d.edit(e => { e.lineState('ab', { locked: true }); e.line('xy', { id: 'x', layer: 'L', position: P(-20) }, { id: 'y', layer: 'L', position: P(-30) }) })
    // binding x onto a: a is no longer free, so ab's end stroke there would stop showing in the side view
    expect(() => d.edit(e => e.bind('a', 'x'))).toThrow(/Locked lines would change \(ab\)/)
  })
})

describe('structural changes carry each view\'s values', () => {
  it('a split re-keys the arc row (its lines change order) and keeps every view\'s radius', () => {
    const d = corner()
    d.edit(e => e.join('b', 'ab', 'bc', { mode: 'arc', radius: 1 }))
    d.editIn(SIDE, e => e.join('b', 'ab', 'bc', { mode: 'arc', radius: 3 }))
    // ab → pieces "aa1" (a…m) and "zz2" (m…b): the row at b was [ab, bc] and becomes [bc, zz2] (dot 1791654767)
    d.edit(e => e.split('ab', 0.5, 'm', 'aa1', 'zz2'))
    const row = d.snapshot().joins.find(r => r.point === 'b')!
    expect(row.lines).toEqual(['bc', 'zz2'])
    expect(radiusAt(d, FRONT, 'b')).toBe(1)
    expect(radiusAt(d, SIDE, 'b')).toBe(3)
  })

  it('an unbind that takes both lines moves the row with each view\'s radius; a bind drops the removed point\'s joins', () => {
    const d = corner()
    d.edit(e => e.line('bd', 'b', { id: 'dd', layer: 'L', position: P(20) }))
    d.edit(e => e.join('b', 'ab', 'bc', { mode: 'arc', radius: 1 }))
    d.editIn(SIDE, e => e.join('b', 'ab', 'bc', { mode: 'arc', radius: 3 }))
    d.edit(e => e.unbind('b', ['ab', 'bc'], 'b2'))
    expect(radiusAt(d, FRONT, 'b2')).toBe(1)
    expect(radiusAt(d, SIDE, 'b2')).toBe(3)
    expect(radiusAt(d, SIDE, 'b')).toBeUndefined()
    // binding b2 into dd's end point b: b2 is kept, so its row stays; binding the other way drops it
    const e2 = corner()
    e2.edit(e => { e.line('xy', { id: 'x', layer: 'L', position: P(40) }, { id: 'y', layer: 'L', position: P(50) }); e.join('b', 'ab', 'bc', { mode: 'arc', radius: 2 }) })
    e2.edit(e => e.bind('x', 'b'))
    for (const k of e2.views()) expect(e2.in(k).snapshot().joins).toEqual([])
  })
})

describe('mirror apply keeps the other views\' radii (dot 1791654260)', () => {
  it('re-applying at the front writes the front radius only; a side view keeps its own', () => {
    const d = new Core({ axis: 0 })
    d.edit(e => {
      e.layer('L', 'L')
      e.line('l1', { id: 'p', layer: 'L', position: P(-20) }, { id: 'q', layer: 'L', position: P(-10, 5) }); e.line('l2', 'q', { id: 'r', layer: 'L', position: P(-5, 15) })
      e.line('m1', { id: 's', layer: 'L', position: P(20) }, { id: 't', layer: 'L', position: P(10, 5) }); e.line('m2', 't', { id: 'u', layer: 'L', position: P(5, 15) })
      e.join('q', 'l1', 'l2', { mode: 'arc', radius: 2 }); e.join('t', 'm1', 'm2', { mode: 'arc', radius: 2 })
    })
    d.editIn(SIDE, e => e.join('t', 'm1', 'm2', { mode: 'arc', radius: 5 }))
    d.edit(e => e.join('q', 'l1', 'l2', { mode: 'arc', radius: 1 }))
    d.edit(e => e.mirrorApply(['l1', 'l2'], ['m1', 'm2']))
    expect(radiusAt(d, FRONT, 't')).toBe(1)
    expect(radiusAt(d, SIDE, 't')).toBe(5)
  })
})

describe('copy / paste and save / open carry every view\'s values', () => {
  it('a paste writes each view\'s own radius and end stroke', () => {
    const d = corner()
    d.edit(e => { e.join('b', 'ab', 'bc', { mode: 'arc', radius: 1 }); e.endStroke('a', { taper: 1 }) })
    d.editIn(SIDE, e => { e.join('b', 'ab', 'bc', { mode: 'arc', radius: 3 }); e.endStroke('a', { taper: 3 }) })
    const clip = d.in(SIDE).copy(['ab', 'bc'])
    d.edit(e => e.paste(clip, 'L', P(0, 100), 'p'))
    expect(radiusAt(d, FRONT, 'p/b')).toBe(1)
    expect(radiusAt(d, SIDE, 'p/b')).toBe(3)
    expect(endAt(d, FRONT, 'p/a')).toEqual({ taper: 1 })
    expect(endAt(d, SIDE, 'p/a')).toEqual({ taper: 3 })
  })

  it('an end stroke with integer-like parameter names is set, saved and opened (dot 1791654767)', () => {
    const d = corner()
    d.editIn(SIDE, e => e.endStroke('a', { '2': 1, '10': 2, taper: 3 }))
    const again = open(save(d))
    expect(endAt(again, SIDE, 'a')).toEqual({ '2': 1, '10': 2, taper: 3 })
  })

  it('save and open keep every view\'s radii and end strokes', () => {
    const d = corner()
    d.edit(e => { e.join('b', 'ab', 'bc', { mode: 'arc', radius: 1 }); e.endStroke('c', { taper: 1 }) })
    d.editIn(SIDE, e => { e.join('b', 'ab', 'bc', { mode: 'arc', radius: 3 }); e.endStroke('c', { taper: 3 }) })
    const again = open(save(d))
    for (const k of d.views()) {
      expect(radiusAt(again, k, 'b')).toBe(radiusAt(d, k, 'b'))
      expect(endAt(again, k, 'c')).toEqual(endAt(d, k, 'c'))
    }
  })
})
