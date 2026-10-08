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

describe('open question for bowen', () => {
  // With nothing held, mutually smooth lines settle at even angles but the whole star's rotation is
  // not fixed by the rule; today it depends on solver order. Asked bowen 1791428957 (proposal: keep the
  // average direction). Turned into a test once decided.
  it.todo('smooth relaxation with nothing held: which overall rotation (bowen 1791428957)')
})
