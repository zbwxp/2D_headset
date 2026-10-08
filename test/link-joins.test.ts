// Smooth joins across an endpoint link (bowen 1791424493: stored with the link, one relation).
import { describe, it, expect } from 'vitest'
import { Core, type Vec } from '../src'
import { sk } from './sketch'

const P = (x: number, y = 0): Vec => ({ x, y })
const angle = (v: Vec) => Math.atan2(v.y, v.x)

// Layer A: line la from a (0,0) to (-10, 3). Layer B: line lb from b (10,0 → moves onto a) to (10, 8).
function setup() {
  const d = new Core()
  d.edit(e => {
    e.layer('A'); e.layer('B')
    sk(e).point('a', 'A', P(0)); sk(e).point('a1', 'A', P(-10, 3)); sk(e).line('la', 'a', 'a1')
    sk(e).point('b', 'B', P(10)); sk(e).point('b1', 'B', P(10, 8)); sk(e).line('lb', 'b', 'b1')
    e.link('a', 'b')
  })
  return d
}
const line = (d: Core, id: string) => d.snapshot().lines.find(l => l.id === id)!

describe('smooth joins across a link', () => {
  it('setting one turns the second-clicked line to the first; it is stored once', () => {
    const d = setup(), before = line(d, 'la').ha
    d.edit(e => e.linkJoin('a', 'b', 'la', 'lb', { mode: 'smooth' }))
    expect(line(d, 'la').ha).toEqual(before)
    expect(angle(line(d, 'lb').ha)).toBeCloseTo(angle({ x: -before.x, y: -before.y }), 9)
    expect(d.snapshot().linkJoins).toEqual([{ a: 'a', b: 'b', lines: ['la', 'lb'], mode: 'smooth' }])
  })

  it('dragging a handle on one side turns the other side, through a chain with a same-point join', () => {
    const d = setup()
    d.edit(e => { sk(e).point('a2', 'A', P(3, -9)); sk(e).line('la2', 'a', 'a2') })
    d.edit(e => { e.join('a', 'la', 'la2', { mode: 'smooth' }); e.linkJoin('a', 'b', 'la', 'lb', { mode: 'smooth' }) })
    d.edit(e => e.moveHandle('lb', 'a', P(0, 4)))
    expect(angle(line(d, 'la').ha)).toBeCloseTo(-Math.PI / 2, 6) // opposite lb
    expect(angle(line(d, 'la2').ha)).toBeCloseTo(Math.PI / 2, 6) // opposite la, same as lb
  })

  it('follows a split, and ends when binding removes a linked point', () => {
    const d = setup()
    d.edit(e => e.linkJoin('a', 'b', 'la', 'lb', { mode: 'smooth' }))
    d.edit(e => e.split('la', 0.5, 'm', 'la1', 'la2'))
    expect(d.snapshot().linkJoins[0]!.lines).toEqual(['la1', 'lb'])
    d.edit(e => { sk(e).point('c', 'B', P(10, -8)); sk(e).line('lc', 'c', 'b1') })
    d.edit(e => e.bind('b1', 'b')) // b merged away: link and its join end
    expect(d.snapshot().links).toEqual([])
    expect(d.snapshot().linkJoins).toEqual([])
  })

  it('cusp / arc across a link are not implemented yet (undecided, not forbidden)', () => {
    const d = setup()
    expect(() => d.edit(e => e.linkJoin('a', 'b', 'la', 'lb', { mode: 'arc' as 'smooth' }))).toThrow(/Not implemented yet/)
    expect(() => d.edit(e => e.linkJoin('a', 'b', 'lb', 'la', { mode: 'smooth' }))).toThrow(/own linked point/)
  })
})

describe('constraint changes re-solve the affected parts (dot 1791431139)', () => {
  function triangleOfLinks() {
    const d = new Core()
    d.edit(e => {
      for (const [id, layer, ang] of [['a', 'A', 0], ['b', 'B', 2.1], ['c', 'C', 4.2]] as const) {
        e.layer(layer); sk(e).point(id, layer, P(0)); sk(e).point(id + '1', layer, P(10 * Math.cos(ang), 10 * Math.sin(ang))); sk(e).line('l' + id, id, id + '1')
      }
      e.link('a', 'b'); e.link('b', 'c'); e.link('c', 'a')
    })
    d.edit(e => { e.linkJoin('a', 'b', 'la', 'lb', { mode: 'smooth' }); e.linkJoin('b', 'c', 'lb', 'lc', { mode: 'smooth' }); e.linkJoin('c', 'a', 'lc', 'la', { mode: 'smooth' }) })
    d.edit(e => e.move([{ id: 'a', target: P(0) }])) // settle at 120°
    return d
  }
  const ang = (d: Core, id: string) => { const h = d.snapshot().lines.find(l => l.id === id)!.ha; return Math.atan2(h.y, h.x) }
  const gap = (x: number, y: number) => Math.abs(Math.atan2(Math.sin(x - y), Math.cos(x - y)))

  it('unlinking re-solves at once: the two remaining pairs become straight', () => {
    const d = triangleOfLinks()
    expect(gap(ang(d, 'la'), ang(d, 'lb'))).toBeCloseTo(2 * Math.PI / 3, 6)
    d.edit(e => e.unlink('a', 'b'))
    expect(gap(ang(d, 'lb'), ang(d, 'lc'))).toBeCloseTo(Math.PI, 6)
    expect(gap(ang(d, 'lc'), ang(d, 'la'))).toBeCloseTo(Math.PI, 6)
  })

  it('deleting a line of a smooth star re-solves the rest at once', () => {
    const d = new Core()
    d.edit(e => {
      e.layer('L'); sk(e).point('o', 'L', P(0))
      for (let i = 0; i < 3; i++) { sk(e).point('p' + i, 'L', P(10 * Math.cos(i * 2.1), 10 * Math.sin(i * 2.1))); sk(e).line('s' + i, 'o', 'p' + i) }
      for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) e.join('o', 's' + i, 's' + j, { mode: 'smooth' })
    })
    d.edit(e => e.move([{ id: 'o', target: P(0) }]))
    d.edit(e => e.deleteLine('s2'))
    expect(gap(ang(d, 's0'), ang(d, 's1'))).toBeCloseTo(Math.PI, 6)
  })
})
