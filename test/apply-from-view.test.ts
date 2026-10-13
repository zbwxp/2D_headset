// Apply from another view (bowen 1791878160; docs/apply-from-view-checklist.md): the chosen layers'
// shapes in view `from` — positions, widths, handles, profiles, end strokes, arc radii, manual zones —
// written into the edited view; one edit; other layers and views unchanged.
import { describe, it, expect } from 'vitest'
import { Core, type Vec } from '../src'

const P = (x: number, y = 0): Vec => ({ x, y })
const FRONT = 'view:0,0', SIDE = 'view:90,0', UP = 'view:0,45'

/** Layer L: ab and bc joined by an arc at b, an end stroke at a; layer M: mn apart. Then L made different in the side view. */
function doc() {
  const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
  d.edit(e => {
    e.layer('M', 'M')
    e.line('ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(10) })
    e.line('bc', 'b', { id: 'c', layer: 'L', position: P(20, 5) })
    e.line('mn', { id: 'm', layer: 'M', position: P(0, 40) }, { id: 'n', layer: 'M', position: P(10, 40) })
  })
  d.edit(e => {
    e.join('b', 'ab', 'bc', { mode: 'arc', radius: 2 })
    e.lineStroke('ab', { width: 2, widthB: 3, profile: 'uniform' })
    e.endStroke('a', { taper: 1 })
    e.zone('b', 'ab', 'bc', 6)
  })
  d.editIn(SIDE, e => {
    e.move([{ id: 'a', target: P(-5, 9) }, { id: 'c', target: P(30, -7) }, { id: 'm', target: P(3, 44) }])
    e.moveHandle('ab', 'a', P(4, 4))
    e.lineStroke('ab', { width: 5, widthB: 1, profile: 'taper' })
    e.lineStroke('mn', { width: 7, profile: 'taper' })
    e.endStroke('a', { taper: 4 }); e.endStroke('c', { taper: 2 })
    e.join('b', 'ab', 'bc', { mode: 'arc', radius: 4 })
    e.zone('b', 'ab', 'bc', null)
  })
  return d
}
/** What of layer L a view shows: points (position, width, end stroke), lines (handles, stroke), joins (radius, zone). */
const shapeOf = (d: Core, k: string, layer = 'L') => {
  const s = d.in(k).snapshot(), ps = new Set(s.points.filter(p => p.layer === layer).map(p => p.id))
  return {
    points: s.points.filter(p => ps.has(p.id)).map(p => ({ id: p.id, position: p.position, width: p.width, end: p.endStroke })),
    lines: s.lines.filter(l => ps.has(l.a)).map(l => ({ id: l.id, ha: l.ha, hb: l.hb, stroke: l.stroke })),
    joins: s.joins.filter(j => ps.has(j.point)),
  }
}
const every = (d: Core) => JSON.stringify(d.views().map(k => [k, d.in(k).snapshot()]))

describe('apply from another view', () => {
  it('the side view\'s layer L becomes exactly the front\'s; M and every other view are unchanged; one undo step', () => {
    const d = doc()
    expect(shapeOf(d, SIDE)).not.toEqual(shapeOf(d, FRONT))
    const front = shapeOf(d, FRONT), sideM = shapeOf(d, SIDE, 'M')
    const others = JSON.stringify(d.views().filter(k => k !== SIDE).map(k => [k, d.in(k).snapshot()]))
    const before = every(d)
    d.editIn(SIDE, e => e.applyFromView(['L'], FRONT))
    expect(shapeOf(d, SIDE)).toEqual(front)
    expect(d.in(SIDE).geometry().lines.filter(l => l.id !== 'mn')).toEqual(d.in(FRONT).geometry().lines.filter(l => l.id !== 'mn'))
    expect(shapeOf(d, SIDE, 'M')).toEqual(sideM)
    expect(JSON.stringify(d.views().filter(k => k !== SIDE).map(k => [k, d.in(k).snapshot()]))).toBe(others)
    d.undo()
    expect(every(d)).toBe(before)
  })

  it('the other way, into the front: a manual zone and an end stroke absent in the source are cleared', () => {
    const d = doc()
    const side = shapeOf(d, SIDE)
    d.edit(e => e.applyFromView(['L'], SIDE))
    expect(shapeOf(d, FRONT)).toEqual(side)
    expect(shapeOf(d, FRONT).joins[0]!.zone).toBeUndefined()
  })

  it('two layers at once; a view with no lines in the layers, or the view itself, changes nothing', () => {
    const d = doc()
    const want = [shapeOf(d, FRONT), shapeOf(d, FRONT, 'M')]
    d.editIn(SIDE, e => e.applyFromView(['L', 'M'], FRONT))
    expect([shapeOf(d, SIDE), shapeOf(d, SIDE, 'M')]).toEqual(want)
    const before = every(d)
    d.edit(e => e.layer('E', 'E'))
    const withE = every(d)
    d.editIn(UP, e => e.applyFromView(['E'], SIDE))
    d.editIn(SIDE, e => e.applyFromView(['L'], SIDE))
    expect(every(d)).toBe(withE)
    expect(before).not.toBe(withE)
  })

  it('a locked line in a chosen layer: refused, nothing changes', () => {
    const d = doc()
    d.edit(e => e.lineState('bc', { locked: true }))
    const before = every(d)
    expect(() => d.editIn(SIDE, e => e.applyFromView(['L'], FRONT))).toThrow(/Locked lines/)
    expect(every(d)).toBe(before)
  })

  it('a point linked to a point of a layer not chosen pulls it along, as a move does', () => {
    const d = doc()
    d.edit(e => e.link('a', 'm'))
    d.editIn(SIDE, e => e.applyFromView(['L'], FRONT))
    const at = (k: string, p: string) => d.in(k).snapshot().points.find(x => x.id === p)!.position
    expect(at(SIDE, 'a')).toEqual(at(FRONT, 'a'))
    expect(at(SIDE, 'm')).toEqual(at(SIDE, 'a'))
  })

  it('in the front, a mirror partner follows: mirrored shape, the same widths and end strokes', () => {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => {
      e.layer('R', 'R')
      e.line('l', { id: 'p1', layer: 'L', position: P(-10) }, { id: 'p2', layer: 'L', position: P(-20, 5) })
      e.line('r', { id: 'q1', layer: 'R', position: P(10) }, { id: 'q2', layer: 'R', position: P(20, 5) })
    })
    const g = (line: string) => d.snapshot().groups.find(x => x.lines.includes(line))!.id
    // the side view's own values first: off the front a mirror-linked line's stroke cannot be edited
    d.editIn(SIDE, e => { e.move([{ id: 'p2', target: P(-30, 12) }]); e.lineStroke('l', { width: 4, profile: 'taper' }); e.endStroke('p2', { taper: 5 }) })
    d.edit(e => e.mirrorLink([g('l')], [g('r')]))
    expect(d.in(SIDE).snapshot().points.find(x => x.id === 'p2')!.position).toEqual(P(-30, 12))
    d.edit(e => e.applyFromView(['L'], SIDE))
    const pt = (p: string) => d.snapshot().points.find(x => x.id === p)!
    expect(pt('p2').position).toEqual(P(-30, 12))
    expect(pt('q2').position).toEqual(P(30, 12))
    expect([pt('q1').width, pt('q2').width, pt('q2').endStroke]).toEqual([4, 4, { taper: 5 }])
    expect(d.snapshot().lines.find(l => l.id === 'r')!.stroke.profile).toBe('taper')
  })

  it('off the front, only the chosen layer is written: its mirror partner keeps its own values', () => {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => {
      e.layer('R', 'R')
      e.line('l', { id: 'p1', layer: 'L', position: P(-10) }, { id: 'p2', layer: 'L', position: P(-20, 5) })
      e.line('r', { id: 'q1', layer: 'R', position: P(10) }, { id: 'q2', layer: 'R', position: P(20, 5) })
    })
    const g = (line: string) => d.snapshot().groups.find(x => x.lines.includes(line))!.id
    d.edit(e => { e.mirrorLink([g('l')], [g('r')]); e.lineStroke('l', { width: 3, profile: 'taper' }) })
    const r = JSON.stringify(d.in(SIDE).snapshot().points.filter(p => p.layer === 'R'))
    d.editIn(UP, e => e.move([{ id: 'p2', target: P(-25, 30) }]))
    d.editIn(SIDE, e => e.applyFromView(['L'], UP))
    expect(d.in(SIDE).snapshot().points.find(p => p.id === 'p2')!.position).toEqual(P(-25, 30))
    expect(JSON.stringify(d.in(SIDE).snapshot().points.filter(p => p.layer === 'R'))).toBe(r)
  })

  // copied unchanged, or refused (dot 1791878532)
  it('a copy that would merge points (the source has two points of one layer on one spot): refused, nothing changes', () => {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => {
      e.line('ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(10) })
      e.line('cd', { id: 'c', layer: 'L', position: P(20) }, { id: 'd', layer: 'L', position: P(30) })
    })
    // the diagonal draft puts c on b in the corner view without binding there: 20 + (15 − 20) + (15 − 20) = 10
    d.editIn(SIDE, e => e.move([{ id: 'c', target: P(15) }]))
    d.editIn(UP, e => e.move([{ id: 'c', target: P(15) }]))
    d.editIn('view:90,45', e => e.draftCorners([{ kind: 'line', id: 'cd' }]))
    expect(d.in('view:90,45').snapshot().points.find(p => p.id === 'c')!.position).toEqual(P(10))
    const before = every(d)
    expect(() => d.edit(e => e.applyFromView(['L'], 'view:90,45'))).toThrow(/apply-from-not-exact.*merged/)
    expect(every(d)).toBe(before)
  })

  it('in the front, both mirror sides chosen from an asymmetric view: refused whatever the order', () => {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => {
      e.layer('R', 'R')
      e.line('l', { id: 'p1', layer: 'L', position: P(-10) }, { id: 'p2', layer: 'L', position: P(-20, 5) })
      e.line('r', { id: 'q1', layer: 'R', position: P(10) }, { id: 'q2', layer: 'R', position: P(20, 5) })
    })
    const g = (line: string) => d.snapshot().groups.find(x => x.lines.includes(line))!.id
    d.editIn(SIDE, e => e.move([{ id: 'p2', target: P(-30, 12) }])) // q2 stays at (20, 5) there
    d.edit(e => e.mirrorLink([g('l')], [g('r')]))
    const before = every(d)
    expect(() => d.edit(e => e.applyFromView(['L', 'R'], SIDE))).toThrow(/apply-from-not-exact/)
    expect(() => d.edit(e => e.applyFromView(['R', 'L'], SIDE))).toThrow(/apply-from-not-exact/)
    expect(every(d)).toBe(before)
    // one side alone is the exception the mirror link makes: its partner follows
    d.edit(e => e.applyFromView(['L'], SIDE))
    expect(d.snapshot().points.find(p => p.id === 'q2')!.position).toEqual(P(30, 12))
  })

  it('a link that would pull a locked line of a layer not chosen: refused, nothing changes', () => {
    const d = doc()
    d.edit(e => e.link('a', 'm')); d.edit(e => e.lineState('mn', { locked: true }))
    const before = every(d)
    expect(() => d.editIn(SIDE, e => e.applyFromView(['L'], FRONT))).toThrow(/Locked lines would change \(mn\)/)
    expect(every(d)).toBe(before)
  })

  it('applying the values a view already has: no undo step', () => {
    const d = doc()
    d.editIn(SIDE, e => e.applyFromView(['L'], FRONT))
    const after = every(d)
    d.editIn(SIDE, e => e.applyFromView(['L'], FRONT))
    d.undo()
    expect(shapeOf(d, SIDE)).not.toEqual(shapeOf(d, FRONT)) // the one undo goes back past the first apply
    d.redo()
    expect(every(d)).toBe(after)
  })

  it('a view key that is not a view, or a layer that does not exist: an error, nothing changes', () => {
    const d = doc()
    const before = every(d)
    expect(() => d.editIn(SIDE, e => e.applyFromView(['L'], 'view:45,0'))).toThrow(/Not a view key/)
    expect(() => d.editIn(SIDE, e => e.applyFromView(['Z'], FRONT))).toThrow(/No layer Z/)
    expect(every(d)).toBe(before)
  })
})
