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

  it('only smooth across a link until bowen decides how cusp / arc across layers are drawn', () => {
    const d = setup()
    expect(() => d.edit(e => e.linkJoin('a', 'b', 'la', 'lb', { mode: 'arc' as 'smooth' }))).toThrow(/Only smooth/)
    expect(() => d.edit(e => e.linkJoin('a', 'b', 'lb', 'la', { mode: 'smooth' }))).toThrow(/own linked point/)
  })
})
