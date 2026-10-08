// Order-independence probes (bowen 1791428827): results that should not depend on
// incidental order. A failure here is a question for bowen, not a silent patch.
import { describe, it, expect } from 'vitest'
import { Core, type Vec } from '../src'
import { sk } from './sketch'

const P = (x: number, y = 0): Vec => ({ x, y })

function threeLayers() {
  const d = new Core()
  d.edit(e => {
    for (const [id, layer, x] of [['a', 'A', 0], ['b', 'B', 10], ['c', 'C', 20]] as const) {
      e.layer(layer); sk(e).point(id, layer, P(x)); sk(e).point(id + '2', layer, P(x, 5)); sk(e).line(id + 'l', id, id + '2')
    }
    e.link('a', 'b'); e.link('b', 'c')
  })
  return d
}

describe('results do not depend on incidental order', () => {
  it('link alignment: the order of move targets does not matter', () => {
    const targets = [{ id: 'a', target: P(3, 1) }, { id: 'c', target: P(9, 7) }, { id: 'b', target: P(-2, 4) }]
    const results = [targets, [...targets].reverse(), [targets[1]!, targets[2]!, targets[0]!]].map(t => {
      const d = threeLayers()
      d.edit(e => e.move(t))
      return d.snapshot().points
    })
    expect(results[1]).toEqual(results[0])
    expect(results[2]).toEqual(results[0])
  })

  it('arc joins: the order in which joins are set does not change the geometry', () => {
    const build = (order: string[]) => {
      const d = new Core()
      d.edit(e => {
        e.layer('L')
        sk(e).point('o', 'L', P(0)); for (const [id, x, y] of [['p', 10, 0], ['q', 0, 10], ['r', -10, -3]] as const) { sk(e).point(id, 'L', P(x, y)); sk(e).line('o' + id, 'o', id) }
      })
      d.edit(e => { for (const k of order) { const [l1, l2] = k.split('-'); e.join('o', l1!, l2!, { mode: 'arc', radius: 2 }) } })
      return d.geometry()
    }
    expect(build(['oq-or', 'op-oq'])).toEqual(build(['op-oq', 'oq-or']))
  })

  it('fills: loop ids do not depend on the order lines were drawn in', () => {
    const ids = (edges: [string, string, string][]) => {
      const d = new Core()
      d.edit(e => { e.layer('L'); for (const [id, x, y] of [['a', 0, 0], ['b', 10, 0], ['c', 5, 9], ['m', 5, 3]] as const) sk(e).point(id, 'L', P(x, y)); for (const [id, a, b] of edges) sk(e).line(id, a, b) })
      return d.snapshot().loops.map(l => l.id).sort()
    }
    const edges: [string, string, string][] = [['ab', 'a', 'b'], ['bc', 'b', 'c'], ['ca', 'c', 'a'], ['am', 'a', 'm'], ['mc', 'm', 'c']]
    expect(ids([...edges].reverse())).toEqual(ids(edges))
  })
})

describe('smooth springs with curve springs (bowen 1791429195)', () => {
  function star(order: [number, number][]) {
    const d = new Core()
    d.edit(e => {
      e.layer('L'); sk(e).point('o', 'L', P(0))
      ;[0, 1.9, 4.0].forEach((a, i) => { sk(e).point('p' + i, 'L', P(10 * Math.cos(a), 10 * Math.sin(a))); sk(e).line('l' + i, 'o', 'p' + i) })
    })
    d.edit(e => { for (const [i, j] of order) e.join('o', 'l' + i, 'l' + j, { mode: 'smooth' }) })
    return d
  }
  const angles = (d: Core) => d.snapshot().lines.map(l => Math.atan2(l.ha.y, l.ha.x))
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

  it('with nothing held the star spreads to 120° without spinning: the mean turning is zero, so the result is unique', () => {
    const results = ([[[0, 1], [0, 2], [1, 2]], [[0, 2], [0, 1], [1, 2]]] as [number, number][][]).map(order => {
      const d = star(order), before = angles(d)
      d.edit(e => e.move([{ id: 'o', target: P(0) }]))
      const after = angles(d)
      const mean = after.reduce((s, a, i) => s + wrap(a - before[i]!), 0) / after.length
      expect(Math.abs(mean)).toBeLessThan(1e-9)
      return after
    })
    results[1]!.forEach((a, i) => expect(a).toBeCloseTo(results[0]![i]!, 9))
  })

  it('turning one handle of a 120° star turns the whole star with it', () => {
    const d = star([[0, 1], [0, 2], [1, 2]])
    d.edit(e => e.move([{ id: 'o', target: P(0) }])) // settle at 120°
    const h = d.snapshot().lines.find(l => l.id === 'l0')!.ha, len = Math.hypot(h.x, h.y)
    const turned = Math.atan2(h.y, h.x) + 0.7
    d.edit(e => e.moveHandle('l0', 'a', { x: len * Math.cos(turned), y: len * Math.sin(turned) }))
    const a = angles(d)
    expect(a[0]).toBeCloseTo(turned, 9)
    expect(Math.abs(wrap(a[1]! - a[0]!))).toBeCloseTo(2 * Math.PI / 3, 6)
    expect(Math.abs(wrap(a[2]! - a[0]!))).toBeCloseTo(2 * Math.PI / 3, 6)
  })
})

describe('zero-length handles (dot 1791431206)', () => {
  it('two smooth pairs joined only through a zero-length handle are solved as separate groups', () => {
    // At o: lines s0, z, s3; joins z–s0 and z–s3; z's handle at o has zero length, so it links nothing.
    const d = new Core()
    d.edit(e => {
      e.layer('L'); sk(e).point('o', 'L', P(0))
      sk(e).point('p0', 'L', P(10, 0)); sk(e).line('s0', 'o', 'p0')
      sk(e).point('pz', 'L', P(0, 10)); sk(e).line('z', 'o', 'pz', { ha: P(0, 0), hb: P(0, -3) })
      sk(e).point('p3', 'L', P(-7, 7)); sk(e).line('s3', 'o', 'p3')
    })
    d.edit(e => { e.join('o', 'z', 's0', { mode: 'smooth' }); e.join('o', 'z', 's3', { mode: 'smooth' }) })
    const before = d.snapshot().lines.find(l => l.id === 's3')!.ha
    d.edit(e => e.moveHandle('s0', 'a', P(0, 3)))
    // s0 and s3 are not connected through any live constraint: s3 must not turn.
    expect(d.snapshot().lines.find(l => l.id === 's3')!.ha).toEqual(before)
  })
})
