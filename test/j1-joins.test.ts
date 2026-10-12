// J1 — joins in the core (docs/j1-joins-checklist.md; principle docs/ink-joins-principle.md §2): binding
// is a join ('bound'), made in the step that connects two lines as one; each point's joins are an
// ordered list (new on top, a re-set pair keeps its place, reorderable); a bind keeps the removed
// point's joins; old files gain 'bound' at two-line points.
import { describe, it, expect } from 'vitest'
import { Core, save, open, type Vec } from '../src'

const P = (x: number, y = 0): Vec => ({ x, y })
const at = (id: string, x: number, y = 0) => ({ id, layer: 'L', position: P(x, y) })
const doc = () => Core.newDocument({ layer: { id: 'L', name: 'L' } })
const joinsOf = (d: Core) => d.snapshot().joins.map(j => [j.point, ...j.lines, j.mode])
const listAt = (d: Core, p: string) => d.snapshot().joins.filter(j => j.point === p).map(j => [...j.lines, j.mode])

describe('bound joins are made by the step that connects', () => {
  it('pen: a chain is bound at each joint; from a free end → bound; from a fork → none; onto a free end → bound', () => {
    const d = doc()
    d.edit(e => { e.line('l1', at('a', 0), at('b', 10)); e.line('l2', 'b', at('c', 20)); e.line('l3', 'c', at('d', 30)) })
    expect(joinsOf(d)).toEqual([['b', 'l1', 'l2', 'bound'], ['c', 'l2', 'l3', 'bound']])
    d.edit(e => e.line('l0', 'a', at('z', -10)))
    expect(listAt(d, 'a')).toEqual([['l0', 'l1', 'bound']])
    d.edit(e => e.line('fork', 'b', at('f', 10, 10)))
    expect(listAt(d, 'b')).toEqual([['l1', 'l2', 'bound']])
    d.edit(e => e.line('close', at('w', 40), 'd'))
    expect(listAt(d, 'd')).toEqual([['close', 'l3', 'bound']])
  })
  it('split: the two pieces are bound; a split line in a chain keeps its joins on the pieces', () => {
    const d = doc()
    d.edit(e => { e.line('l1', at('a', 0), at('b', 10)); e.line('l2', 'b', at('c', 20)) })
    d.edit(e => e.split('l2', 0.5, 'm', 'p', 'q'))
    expect(joinsOf(d).sort()).toEqual([['b', 'l1', 'p', 'bound'], ['m', 'p', 'q', 'bound']])
  })
  it('bind two free ends → bound; bind onto a point with two lines → none; a point carrying a pair moves its pair below the kept point\'s', () => {
    const d = doc()
    d.edit(e => { e.line('x', at('x0', 0), at('x1', 10)); e.line('y', at('y0', 20), at('y1', 30)) })
    d.edit(e => e.bind('x1', 'y0'))
    expect(joinsOf(d)).toEqual([['x1', 'x', 'y', 'bound']])
    d.edit(e => e.line('z', at('z0', 0, 20), at('z1', 10, 20)))
    d.edit(e => e.bind('x1', 'z1'))
    expect(listAt(d, 'x1')).toEqual([['x', 'y', 'bound']])
    // a second chain u–v bound at v0; binding x1 (two joins' worth of lines) and v0
    d.edit(e => { e.line('u', at('u0', 50), at('v0', 60)); e.line('v', 'v0', at('v1', 70)); e.join('x1', 'x', 'z', { mode: 'cusp' }) })
    expect(listAt(d, 'x1')).toEqual([['x', 'z', 'cusp'], ['x', 'y', 'bound']])
    d.edit(e => e.bind('x1', 'v0'))
    expect(listAt(d, 'x1')).toEqual([['x', 'z', 'cusp'], ['x', 'y', 'bound'], ['u', 'v', 'bound']])
  })
  it('unbind: a pair moved together keeps its row; a pair separated loses it; nothing is made', () => {
    const d = doc()
    d.edit(e => { e.line('l1', at('a', 0), at('b', 10)); e.line('l2', 'b', at('c', 20)); e.line('l3', 'b', at('e', 10, 10)) })
    expect(joinsOf(d)).toEqual([['b', 'l1', 'l2', 'bound']])
    d.edit(e => e.unbind('b', ['l1', 'l2'], 'b2'))
    expect(joinsOf(d)).toEqual([['b2', 'l1', 'l2', 'bound']])
    const two = doc()
    two.edit(e => { e.line('l1', at('a', 0), at('b', 10)); e.line('l2', 'b', at('c', 20)) })
    two.edit(e => e.unbind('b', ['l2'], 'b2'))
    expect(joinsOf(two)).toEqual([])
  })
  it('copy / paste copies the rows in their order and makes none', () => {
    const d = doc()
    d.edit(e => { e.line('l1', at('a', 0), at('b', 10)); e.line('l2', 'b', at('c', 20)); e.line('l3', 'b', at('e', 10, 10)); e.join('b', 'l1', 'l3', { mode: 'smooth' }) })
    expect(listAt(d, 'b')).toEqual([['l1', 'l3', 'smooth'], ['l1', 'l2', 'bound']])
    const clip = d.copy(['l1', 'l2', 'l3'])
    d.edit(e => e.paste(clip, 'L', P(0, 100), 'k'))
    expect(listAt(d, 'k/b')).toEqual([['k/l1', 'k/l3', 'smooth'], ['k/l1', 'k/l2', 'bound']])
    expect(d.snapshot().joins.filter(j => j.point.startsWith('k/'))).toHaveLength(2)
  })
})

describe('the join list', () => {
  const fork = () => {
    const d = doc()
    d.edit(e => { e.line('a', at('p0', 0), at('p', 10)); e.line('b', 'p', at('p1', 20)); e.line('c', 'p', at('p2', 10, 10)) })
    return d
  }
  it('a new pair goes on top; re-setting a pair keeps its place; governing reads the top', () => {
    const d = fork()
    expect(listAt(d, 'p')).toEqual([['a', 'b', 'bound']])
    d.edit(e => e.join('p', 'a', 'c', { mode: 'smooth' }))
    expect(listAt(d, 'p')).toEqual([['a', 'c', 'smooth'], ['a', 'b', 'bound']])
    d.edit(e => e.join('p', 'a', 'b', { mode: 'cusp' }))
    expect(listAt(d, 'p')).toEqual([['a', 'c', 'smooth'], ['a', 'b', 'cusp']])
  })
  it('reordering: exactly the point\'s joins, top first; undo / redo restore the order; every view shares it', () => {
    const d = fork()
    d.edit(e => e.join('p', 'a', 'c', { mode: 'smooth' }))
    d.edit(e => e.joinOrder('p', [['a', 'b'], ['c', 'a']]))
    expect(listAt(d, 'p')).toEqual([['a', 'b', 'bound'], ['a', 'c', 'smooth']])
    for (const k of d.views()) expect(d.in(k).snapshot().joins.map(j => j.lines.join())).toEqual(['a,b', 'a,c'])
    expect(() => d.edit(e => e.joinOrder('p', [['a', 'b']]))).toThrow(/exactly the joins at p/)
    d.undo()
    expect(listAt(d, 'p')).toEqual([['a', 'c', 'smooth'], ['a', 'b', 'bound']])
    d.redo()
    expect(listAt(d, 'p')).toEqual([['a', 'b', 'bound'], ['a', 'c', 'smooth']])
  })
  it('the smooth springs do not depend on the order', () => {
    const handles = (order: [string, string][]) => {
      const d = fork()
      d.edit(e => { e.join('p', 'a', 'b', { mode: 'smooth' }); e.join('p', 'a', 'c', { mode: 'smooth' }) })
      d.edit(e => e.joinOrder('p', order))
      d.edit(e => e.moveHandle('b', 'a', P(3, 4)))
      return d.snapshot().lines.map(l => [l.id, l.ha, l.hb])
    }
    expect(handles([['a', 'b'], ['a', 'c']])).toEqual(handles([['a', 'c'], ['a', 'b']]))
  })
})

describe('save and open', () => {
  it('version 7 keeps the list order exactly; a two-line point left without a join stays without one', () => {
    const d = doc()
    d.edit(e => { e.line('a', at('p0', 0), at('p', 10)); e.line('b', 'p', at('p1', 20)); e.line('c', 'p', at('p2', 10, 10)); e.join('p', 'a', 'c', { mode: 'smooth' }) })
    d.edit(e => e.removeJoin('p', 'a', 'c'))
    d.edit(e => e.deleteLine('c'))
    d.edit(e => e.removeJoin('p', 'a', 'b'))
    expect(d.snapshot().joins).toEqual([])
    expect(open(save(d)).snapshot().joins).toEqual([])
    const f = doc()
    f.edit(e => { e.line('a', at('p0', 0), at('p', 10)); e.line('b', 'p', at('p1', 20)); e.line('c', 'p', at('p2', 10, 10)); e.join('p', 'a', 'c', { mode: 'cusp' }) })
    f.edit(e => e.joinOrder('p', [['a', 'b'], ['a', 'c']]))
    expect(open(save(f)).snapshot().joins).toEqual(f.snapshot().joins)
  })
  it('a version 6 file gains a bound join at each point with exactly two line ends and no join; forks gain none', () => {
    const d = doc()
    d.edit(e => { e.line('a', at('p0', 0), at('p', 10)); e.line('b', 'p', at('p1', 20)); e.line('c', 'p1', at('p2', 30)); e.line('f', 'p1', at('p3', 20, 10)) })
    const v6 = JSON.parse(save(d))
    v6.version = 6
    v6.document.joins.rows = []
    const opened = open(JSON.stringify(v6))
    expect(joinsOf(opened)).toEqual([['p', 'a', 'b', 'bound']])
  })
})

describe('a join\'s transition zone: per view, kept through mode changes and structure', () => {
  const SIDE = 'view:90,0'
  const zoneAt = (d: Core, k: string, p: string) => d.in(k).snapshot().joins.find(j => j.point === p)?.zone
  const chain = () => {
    const d = doc()
    d.edit(e => { e.line('l1', at('a', 0), at('b', 10)); e.line('l2', 'b', at('c', 20)) })
    return d
  }
  it('set in one view, automatic in the others; kept when the mode changes; null makes it automatic; removing the join drops it', () => {
    const d = chain()
    d.editIn(SIDE, e => e.zone('b', 'l1', 'l2', 12))
    expect(zoneAt(d, SIDE, 'b')).toBe(12)
    for (const k of d.views()) if (k !== SIDE) expect(zoneAt(d, k, 'b')).toBeUndefined()
    d.edit(e => e.join('b', 'l1', 'l2', { mode: 'smooth' }))
    expect(zoneAt(d, SIDE, 'b')).toBe(12)
    d.editIn(SIDE, e => e.zone('b', 'l1', 'l2', null))
    expect(zoneAt(d, SIDE, 'b')).toBeUndefined()
    d.editIn(SIDE, e => e.zone('b', 'l1', 'l2', 7))
    d.edit(e => e.removeJoin('b', 'l1', 'l2'))
    for (const k of d.views()) expect(d.in(k).snapshot().joins).toEqual([])
  })
  it('follows a split and a bind with the row; a paste carries it; save / open keeps it', () => {
    const d = chain()
    d.editIn(SIDE, e => e.zone('b', 'l1', 'l2', 9))
    d.edit(e => e.split('l2', 0.5, 'm', 'p', 'q'))
    expect(d.in(SIDE).snapshot().joins.find(j => j.point === 'b')).toMatchObject({ lines: ['l1', 'p'], zone: 9 })
    d.edit(e => { e.line('x', at('x0', 0, 30), at('x1', 10, 30)); e.line('y', at('y0', 20, 30), at('y1', 30, 30)) })
    d.edit(e => e.bind('x1', 'b'))
    expect(d.in(SIDE).snapshot().joins.find(j => j.lines.join() === 'l1,p')).toMatchObject({ point: 'x1', zone: 9 })
    const clip = d.copy(['l1', 'p', 'q', 'x'])
    d.edit(e => e.paste(clip, 'L', P(0, 100), 'k'))
    expect(d.in(SIDE).snapshot().joins.find(j => j.lines.join() === 'k/l1,k/p')?.zone).toBe(9)
    expect(open(save(d)).in(SIDE).snapshot().joins).toEqual(d.in(SIDE).snapshot().joins)
  })
  it('at a pose the zone is blended from each view\'s effective length — manual, else automatic from that view\'s widths, never 0 (dot 1791812073)', () => {
    const d = chain()
    d.editIn(SIDE, e => e.zone('b', 'l1', 'l2', 12))
    // front: automatic, widths 1 and 1 → 1² / 1 = 1; side: 12; on the yaw axis the blend is (1 − u)·1 + u·12
    for (const yaw of [20, 80]) expect(d.atPose({ yaw, pitch: 0 }).snapshot().joins.find(j => j.point === 'b')?.zone).toBeCloseTo(1 + 11 * yaw / 90, 12)
    // a new width changes the automatic length (4² / 1 = 16) in the blend; at the front, which is automatic, it reads automatic
    d.edit(e => e.lineStroke('l2', { width: 4, profile: 'uniform' }))
    expect(d.model().views.find(v => v.yaw === 0 && v.pitch === 0)!.zones![JSON.stringify(['b', 'l1', 'l2'])]).toBe(16)
    expect(d.atPose({ yaw: 0, pitch: 0 }).snapshot().joins.find(j => j.point === 'b')?.zone).toBeUndefined()
  })
})

describe('J1b: the zones read (desired and after the short-line limit)', () => {
  it('between two lines: 2·min(desired/2, L/3); the same at every view through the view reader and the pose reader', () => {
    const d = doc()
    d.edit(e => { e.line('l1', at('a', 0), at('b', 30)); e.line('l2', 'b', at('c', 36)) })
    d.edit(e => e.lineStroke('l2', { width: 4, profile: 'uniform' }))
    // desired 4² / 1 = 16; the shorter line is 6 long → each side at most 2 → limited 4
    const z = d.in('view:0,0').zones()
    expect(z).toMatchObject([{ point: 'b', lines: ['l1', 'l2'], desired: 16, manual: false }])
    expect(z[0]!.limited).toBeCloseTo(4, 9) // the drawn length is a numeric arc length
    d.editIn('view:90,0', e => e.zone('b', 'l1', 'l2', 3))
    expect(d.in('view:90,0').zones()[0]).toMatchObject({ desired: 3, manual: true })
    expect(d.in('view:90,0').zones()[0]!.limited).toBeCloseTo(3, 9)
    for (const k of d.views()) {
      const [yaw, pitch] = k.slice(5).split(',').map(Number)
      expect(d.atPose({ yaw: yaw!, pitch: pitch! }).zones()).toEqual(d.in(k).zones())
    }
  })
})
