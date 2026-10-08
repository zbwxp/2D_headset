// Module-level checks for the two densest parts: group identity and fill outlines.
import { describe, it, expect } from 'vitest'
import { Core, type Vec } from '../src'
import { sk } from './sketch'

const P = (x: number, y = 0): Vec => ({ x, y })

describe('groups: identity through merge and split', () => {
  it('a new line joining two groups keeps the group of its first point, in that group’s slot', () => {
    const d = new Core()
    d.edit(e => {
      e.layer('L')
      for (const [id, x] of [['a', 0], ['b', 1], ['c', 5], ['d', 6]] as const) sk(e).point(id, 'L', P(x))
      sk(e).line('x', 'a', 'b'); sk(e).line('y', 'c', 'd')
    })
    const [gx, gy] = d.snapshot().groups
    d.edit(e => sk(e).line('bridge', 'c', 'b')) // first point c → y's group wins
    const groups = d.snapshot().groups
    expect(groups.map(g => g.id)).toEqual([gy!.id])
    expect(groups[0]!.lines.sort()).toEqual(['bridge', 'x', 'y'])
    expect(gx!.id).not.toBe(gy!.id)
  })

  it('a hub split three ways: the earliest line keeps the id, the others follow it in order with its stroke', () => {
    const d = new Core()
    d.edit(e => {
      e.layer('L'); sk(e).point('o', 'L', P(0))
      for (let i = 1; i <= 3; i++) { sk(e).point('p' + i, 'L', P(i, i)); sk(e).line('l' + i, 'o', 'p' + i) }
      sk(e).point('q', 'L', P(9)); sk(e).point('r', 'L', P(10)); sk(e).line('top', 'q', 'r')
    })
    const [hub, top] = d.snapshot().groups
    d.edit(e => e.stroke(hub!.id, { width: 3, profile: 'x' }))
    d.edit(e => { e.unbind('o', ['l2'], 'o2'); e.unbind('o', ['l3'], 'o3') })
    const groups = d.snapshot().groups
    // Rule (Q24 B): split-offs go right after the original. Their order among
    // themselves is not specified by the graph, so only adjacency is checked.
    expect(groups[0]!.lines).toEqual(['l1'])
    expect(groups.slice(1, 3).map(g => g.lines[0]).sort()).toEqual(['l2', 'l3'])
    expect(groups[3]!.lines).toEqual(['top'])
    expect(groups[0]!.id).toBe(hub!.id)
    expect(groups[3]!.id).toBe(top!.id)
    expect(groups.slice(0, 3).every(g => g.stroke.width === 3)).toBe(true)
  })

  it('a group whose lines are all deleted leaves the order', () => {
    const d = new Core()
    d.edit(e => { e.layer('L'); sk(e).point('a', 'L', P(0)); sk(e).point('b', 'L', P(1)); sk(e).line('x', 'a', 'b') })
    d.edit(e => e.deleteLine('x'))
    expect(d.snapshot().groups).toEqual([])
  })
})

describe('derived: fill outlines', () => {
  // Square a(0,0) b(10,0) c(10,10) d(0,10) with a diagonal a–c: three loops.
  function square() {
    const d = new Core()
    d.edit(e => {
      e.layer('L')
      sk(e).point('a', 'L', P(0)); sk(e).point('b', 'L', P(10)); sk(e).point('c', 'L', P(10, 10)); sk(e).point('d', 'L', P(0, 10))
      sk(e).line('ab', 'a', 'b'); sk(e).line('bc', 'b', 'c'); sk(e).line('cd', 'c', 'd'); sk(e).line('da', 'd', 'a'); sk(e).line('ac', 'a', 'c')
    })
    return d
  }
  const loopWith = (d: Core, lines: string[]) =>
    d.snapshot().loops.find(l => l.route.length === lines.length && lines.every(x => l.route.some(u => u.line === x)))!.id

  it('every fill outline is continuous: each part starts where the previous ended', () => {
    const d = square()
    d.edit(e => { for (const l of d.snapshot().loops) e.fill(l.id, 'red'); e.join('a', 'ab', 'da', { mode: 'arc', radius: 2 }) })
    for (const f of d.geometry().fills) {
      f.parts.forEach((p, i) => {
        const next = f.parts[(i + 1) % f.parts.length]!
        expect(Math.hypot(p.curve[3].x - next.curve[0].x, p.curve[3].y - next.curve[0].y)).toBeLessThan(1e-9)
      })
    }
  })

  it('at a fork, only the loop through the arc’s pair uses the arc; the other keeps the corner', () => {
    const d = square()
    const outer = loopWith(d, ['ab', 'bc', 'cd', 'da']), lower = loopWith(d, ['ab', 'bc', 'ac'])
    d.edit(e => { e.fill(outer, 'red'); e.fill(lower, 'blue'); e.join('a', 'ab', 'da', { mode: 'arc', radius: 2 }) })
    const g = d.geometry(), arc = g.arcs[0]!.key
    expect(g.fills.find(f => f.id === outer)!.parts.some(p => p.key === arc)).toBe(true)
    const lowerParts = g.fills.find(f => f.id === lower)!.parts
    expect(lowerParts.some(p => p.key === arc)).toBe(false)
    expect(lowerParts.some(p => p.key === 'line:ab:fill')).toBe(true) // ab untrimmed at a for this loop
  })

  it('canvas pick returns the smallest loop containing the point', () => {
    const d = square()
    const lower = loopWith(d, ['ab', 'bc', 'ac'])
    expect(d.pickLoop(P(8, 2))).toBe(lower)
    expect(d.pickLoop(P(20, 2))).toBeUndefined()
  })
})
