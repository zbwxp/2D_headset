// Acceptance cases from the walkthrough (Q20–Q27). The first block is ported
// from dot's draft (Documents/Codex/2026-10-08/task/core-v1/test/acceptance.test.mjs,
// dot 1791426280); the rest are added from the relationship graph.
import { describe, it, expect } from 'vitest'
import { Core, type Vec } from '../src'

const P = (x: number, y = 0): Vec => ({ x, y })

function graph(edges: [string, string, string][], positions: Record<string, Vec> = { a: P(0), b: P(10), c: P(5, 10) }) {
  const d = new Core()
  d.edit(e => {
    e.layer('L')
    for (const [id, p] of Object.entries(positions)) e.point(id, 'L', p)
    for (const [id, a, b] of edges) e.line(id, a, b)
  })
  return d
}
const tri = () => graph([['ab', 'a', 'b'], ['bc', 'b', 'c'], ['ca', 'c', 'a']])
function paint(d: Core, color = 'red') {
  const id = d.snapshot().loops[0]!.id
  d.edit(e => e.fill(id, color))
  return id
}
const loop = (d: Core, id: string) => d.snapshot().loops.find(l => l.id === id)

describe('dot draft: binding, loops and fills', () => {
  it('triangle bind keeps the lemon with identity and colour; binding the lemon removes everything', () => {
    const d = tri(), id = paint(d)
    d.edit(e => e.bind('a', 'b'))
    expect(d.snapshot().lines).toHaveLength(2)
    expect(loop(d, id)?.color).toBe('red')
    d.edit(e => e.bind('a', 'c'))
    expect(d.snapshot().lines).toHaveLength(0)
    expect(d.snapshot().loops).toHaveLength(0)
  })

  it('minimal θ lists three loops, stores three lines once, and disappears on binding', () => {
    const d = graph([['x', 'a', 'b'], ['y', 'a', 'b'], ['z', 'a', 'b']])
    expect(d.snapshot().loops).toHaveLength(3)
    expect(d.geometry().lines).toHaveLength(3)
    d.edit(e => e.bind('a', 'b'))
    expect(d.snapshot().loops).toHaveLength(0)
  })

  it('θ with an intermediate point survives binding as a lemon', () => {
    const d = graph([['x', 'a', 'b'], ['y', 'a', 'b'], ['u', 'a', 'c'], ['v', 'c', 'b']])
    d.edit(e => e.bind('a', 'b'))
    expect(d.snapshot().lines).toHaveLength(2)
    expect(d.snapshot().loops).toHaveLength(1)
  })

  it('split keeps the loop id and colour and replaces the boundary references', () => {
    const d = tri(), id = paint(d)
    d.edit(e => e.split('ab', 0.4, 'm', 'am', 'mb'))
    const l = loop(d, id)!
    expect(l.color).toBe('red')
    expect(l.route).toHaveLength(4)
    expect(l.route.some(u => u.line === 'ab')).toBe(false)
  })

  it('a chord does not repartition the outer fill', () => {
    const d = tri(), id = paint(d)
    d.edit(e => { e.split('ab', 0.5, 'm', 'am', 'mb'); e.line('mc', 'm', 'c') })
    expect(d.snapshot().loops).toHaveLength(3)
    expect(loop(d, id)?.color).toBe('red')
  })

  it('deleting a shared edge affects only the loops through it', () => {
    const d = graph([['x', 'a', 'b'], ['y', 'a', 'b'], ['z', 'a', 'b']])
    const keep = d.snapshot().loops.find(l => !l.route.some(u => u.line === 'x'))!.id
    d.edit(e => { for (const l of d.snapshot().loops) e.fill(l.id, 'red'); e.deleteLine('x') })
    expect(d.snapshot().loops).toHaveLength(1)
    expect(d.snapshot().loops[0]!.id).toBe(keep)
    expect(d.snapshot().loops[0]!.color).toBe('red')
  })

  it('unbind breaks the fill; undo, redo and cancel are atomic', () => {
    const d = tri(); paint(d)
    const before = d.snapshot()
    d.edit(e => e.unbind('a', ['ab'], 'a2'))
    expect(d.snapshot().loops).toHaveLength(0)
    d.undo(); expect(d.snapshot()).toEqual(before)
    d.redo(); expect(d.snapshot().loops).toHaveLength(0)
    const after = d.snapshot()
    d.edit(e => { e.deleteLine('bc'); e.cancel() })
    expect(d.snapshot()).toEqual(after)
    expect(() => d.edit(e => { e.deleteLine('bc'); e.line('bad', 'missing', 'a') })).toThrow()
    expect(d.snapshot()).toEqual(after)
  })
})

function linked() {
  const d = new Core()
  d.edit(e => {
    e.layer('A'); e.layer('B'); e.layer('C')
    e.point('a', 'A', P(0)); e.point('b', 'B', P(10)); e.point('c', 'C', P(20))
    e.link('a', 'b'); e.link('b', 'c')
  })
  return d
}

describe('dot draft: links, smooth springs, arcs, groups', () => {
  it('links: one side follows; both acted-on targets average (an unchanged one included); a chain moves once', () => {
    const d = linked()
    expect(d.snapshot().points.every(p => p.position.x === 0)).toBe(true) // second point moves to the first
    d.edit(e => e.move([{ id: 'a', target: P(10) }]))
    expect(d.snapshot().points.every(p => p.position.x === 10)).toBe(true)
    d.edit(e => e.move([{ id: 'a', target: P(10) }, { id: 'b', target: P(0) }, { id: 'b', target: P(0) }]))
    expect(d.snapshot().points.every(p => p.position.x === 5)).toBe(true)
    expect(d.snapshot().links).toHaveLength(2)
    d.edit(e => e.move([{ id: 'a', target: P(15) }, { id: 'b', target: P(15) }]))
    expect(d.snapshot().points.every(p => p.position.x === 15)).toBe(true)
  })

  for (const n of [3, 4]) {
    it(`${n} mutually smooth lines settle evenly (${360 / n}°) with finite non-zero handles`, () => {
      const d = new Core()
      d.edit(e => {
        e.layer('L'); e.point('o', 'L', P(0))
        for (let i = 0; i < n; i++) {
          // start off-symmetric so the solver has to work
          const a = 2 * Math.PI * i / n + (i === 1 ? 0.4 : 0)
          e.point('p' + i, 'L', P(10 * Math.cos(a), 10 * Math.sin(a)))
          e.line('l' + i, 'o', 'p' + i)
        }
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) e.join('o', 'l' + i, 'l' + j, { mode: 'smooth' })
      })
      const angles = d.snapshot().lines.map(l => Math.atan2(l.ha.y, l.ha.x)).sort((a, b) => a - b)
      for (let i = 0; i < n; i++) {
        const delta = (angles[(i + 1) % n]! - angles[i]! + 2 * Math.PI) % (2 * Math.PI)
        expect(Math.abs(delta - 2 * Math.PI / n)).toBeLessThan(0.02)
      }
      expect(d.snapshot().lines.every(l => Math.hypot(l.ha.x, l.ha.y) > 1)).toBe(true)
    })
  }

  it('an arc is shared by line and fill geometry; width and taper do not change geometry', () => {
    const d = tri(); paint(d)
    d.edit(e => e.join('a', 'ab', 'ca', { mode: 'arc', radius: 1 }))
    const g = d.geometry()
    expect(g.arcs).toHaveLength(1)
    expect(g.fills[0]!.parts.some(p => p.key === g.arcs[0]!.key)).toBe(true)
    d.edit(e => { e.stroke(d.snapshot().groups[0]!.id, { width: 20, profile: 'round' }); e.endStroke('a', { taper: 1 }) })
    expect(d.geometry()).toEqual(g)
  })

  it('binding group A (first) to group C keeps A’s stroke and slot, with B unchanged', () => {
    const d = graph([['x', 'a', 'b'], ['y', 'c', 'd'], ['z', 'e', 'f']], { a: P(0), b: P(1), c: P(3), d: P(4), e: P(6), f: P(7) })
    const [a, b, c] = d.snapshot().groups
    d.edit(e => { e.stroke(a!.id, { width: 7, profile: 'first' }); e.stroke(c!.id, { width: 2, profile: 'last' }); e.bind('a', 'e') })
    const groups = d.snapshot().groups
    expect(groups).toHaveLength(2)
    expect(groups[0]!.id).toBe(a!.id)
    expect(groups[0]!.stroke.width).toBe(7)
    expect(groups[1]!.id).toBe(b!.id)
  })
})

describe('graph rules added by Claude', () => {
  it('a dragged handle is held: its smooth partner turns exactly opposite', () => {
    const d = graph([['ab', 'a', 'b'], ['bc', 'b', 'c']])
    d.edit(e => e.join('b', 'ab', 'bc', { mode: 'smooth' }))
    d.edit(e => e.moveHandle('ab', 'b', P(0, 4)))
    const s = d.snapshot(), ab = s.lines.find(l => l.id === 'ab')!, bc = s.lines.find(l => l.id === 'bc')!
    expect(ab.hb).toEqual(P(0, 4))
    expect(Math.atan2(bc.ha.y, bc.ha.x)).toBeCloseTo(-Math.PI / 2, 6)
  })

  it('cusp keeps handles free and does not change fill geometry', () => {
    const d = tri(); paint(d)
    const before = d.geometry()
    d.edit(e => e.join('a', 'ab', 'ca', { mode: 'cusp' }))
    expect(d.geometry()).toEqual(before)
  })

  it('bind and lines stay in one layer; links are cross-layer only', () => {
    const d = new Core()
    d.edit(e => { e.layer('A'); e.layer('B'); e.point('a', 'A', P(0)); e.point('b', 'B', P(1)); e.point('c', 'A', P(2)) })
    expect(() => d.edit(e => e.line('x', 'a', 'b'))).toThrow()
    expect(() => d.edit(e => e.bind('a', 'b'))).toThrow()
    expect(() => d.edit(e => e.link('a', 'c'))).toThrow()
  })

  it('deleting a line removes points left with no line; a link ends with its point and never re-links', () => {
    const d = new Core()
    d.edit(e => {
      e.layer('A'); e.layer('B')
      e.point('a', 'A', P(0)); e.point('b', 'A', P(10)); e.line('ab', 'a', 'b')
      e.point('q', 'B', P(0)); e.link('q', 'b')
    })
    expect(d.snapshot().links).toHaveLength(1)
    d.edit(e => e.deleteLine('ab'))
    expect(d.snapshot().points.map(p => p.id)).toEqual(['q'])
    expect(d.snapshot().links).toHaveLength(0)
    expect(d.snapshot().points[0]!.links).toEqual([])
  })

  it('binding drops the removed point’s joins; the kept point’s joins stay', () => {
    const d = graph([['pa', 'p', 'a'], ['pb', 'p', 'b'], ['qc', 'q', 'c'], ['qd', 'q', 'd']],
      { p: P(0), a: P(-5, 0), b: P(5, 1), q: P(0, 10), c: P(-5, 10), d: P(5, 11) })
    d.edit(e => { e.join('p', 'pa', 'pb', { mode: 'cusp' }); e.join('q', 'qc', 'qd', { mode: 'cusp' }) })
    d.edit(e => e.bind('p', 'q'))
    expect(d.snapshot().joins).toEqual([{ point: 'p', lines: ['pa', 'pb'], mode: 'cusp' }])
  })

  it('a new fill goes on top; clearing a fill keeps the loop discoverable', () => {
    const d = graph([['x', 'a', 'b'], ['y', 'a', 'b'], ['z', 'a', 'b']])
    const [l1, l2] = d.snapshot().loops
    d.edit(e => { e.fill(l1!.id, 'red'); e.fill(l2!.id, 'blue') })
    expect(d.snapshot().fillOrder).toEqual([l1!.id, l2!.id])
    d.edit(e => e.clearFill(l1!.id))
    expect(d.snapshot().loops.find(l => l.id === l1!.id)?.color).toBeUndefined()
    expect(d.snapshot().loops).toHaveLength(3)
  })

  it('a group split by unbinding: the new group goes right after the original', () => {
    const d = graph([['x', 'a', 'b'], ['y', 'b', 'c']], { a: P(0), b: P(1), c: P(2) })
    d.edit(e => { e.layer('L'); e.point('d', 'L', P(5)); e.point('f', 'L', P(6)); e.line('w', 'd', 'f') })
    const [g1, g2] = d.snapshot().groups
    d.edit(e => e.unbind('b', ['y'], 'b2'))
    const groups = d.snapshot().groups
    expect(groups.map(g => g.id)[0]).toBe(g1!.id)
    expect(groups[2]!.id).toBe(g2!.id)
    expect(groups[1]!.lines).toEqual(['y'])
  })

  it('stroke width never moves a fill boundary', () => {
    const d = tri(); paint(d)
    const g = d.geometry()
    d.edit(e => e.stroke(d.snapshot().groups[0]!.id, { width: 50, profile: 'uniform' }))
    expect(d.geometry().fills).toEqual(g.fills)
  })
})
