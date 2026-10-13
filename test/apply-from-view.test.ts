// Apply from another view (bowen 1791878160, 1791878923 "only the 4 parameters"; docs/apply-from-view-checklist.md):
// every line of the chosen layers takes its curve in view `from` — end points and handles — in the edited view;
// widths, profiles, end strokes, radii and zones stay; one edit; other layers and views unchanged.
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
/** A layer's curves in a view: points' positions, lines' handles. */
const shapeOf = (d: Core, k: string, layer = 'L') => {
  const s = d.in(k).snapshot(), ps = new Set(s.points.filter(p => p.layer === layer).map(p => p.id))
  return { points: s.points.filter(p => ps.has(p.id)).map(p => ({ id: p.id, position: p.position })), lines: s.lines.filter(l => ps.has(l.a)).map(l => ({ id: l.id, ha: l.ha, hb: l.hb })) }
}
/** Everything else of a layer in a view: widths, end strokes, strokes, joins' radii and zones. */
const restOf = (d: Core, k: string, layer = 'L') => {
  const s = d.in(k).snapshot(), ps = new Set(s.points.filter(p => p.layer === layer).map(p => p.id))
  return { points: s.points.filter(p => ps.has(p.id)).map(p => [p.width, p.endStroke]), lines: s.lines.filter(l => ps.has(l.a)).map(l => l.stroke), joins: s.joins.filter(j => ps.has(j.point)) }
}
const every = (d: Core) => JSON.stringify(d.views().map(k => [k, d.in(k).snapshot()]))

describe('apply from another view', () => {
  it('the side view\'s layer L takes exactly the front\'s curves, and keeps its own widths, strokes, end strokes, radius, zone; M and every other view are unchanged; one undo step', () => {
    const d = doc()
    expect(shapeOf(d, SIDE)).not.toEqual(shapeOf(d, FRONT))
    expect(restOf(d, SIDE)).not.toEqual(restOf(d, FRONT))
    const front = shapeOf(d, FRONT), sideM = shapeOf(d, SIDE, 'M'), rest = restOf(d, SIDE)
    const others = JSON.stringify(d.views().filter(k => k !== SIDE).map(k => [k, d.in(k).snapshot()]))
    const before = every(d)
    d.editIn(SIDE, e => e.applyFromView(['L'], FRONT))
    expect(shapeOf(d, SIDE)).toEqual(front)
    expect(restOf(d, SIDE)).toEqual(rest)
    expect(shapeOf(d, SIDE, 'M')).toEqual(sideM)
    expect(JSON.stringify(d.views().filter(k => k !== SIDE).map(k => [k, d.in(k).snapshot()]))).toBe(others)
    d.undo()
    expect(every(d)).toBe(before)
  })

  it('the other way, into the front: the curves only; the front keeps its manual zone and end strokes', () => {
    const d = doc()
    const side = shapeOf(d, SIDE), rest = restOf(d, FRONT)
    d.edit(e => e.applyFromView(['L'], SIDE))
    expect(shapeOf(d, FRONT)).toEqual(side)
    expect(restOf(d, FRONT)).toEqual(rest)
    expect(restOf(d, FRONT).joins[0]!.zone).toBe(6)
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

  it('in the front, a chosen line whose mirror partner is not chosen: refused before anything changes (dot 1791879211)', () => {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => {
      e.layer('R', 'R')
      e.line('l', { id: 'p1', layer: 'L', position: P(-10) }, { id: 'p2', layer: 'L', position: P(-20, 5) })
      e.line('r', { id: 'q1', layer: 'R', position: P(10) }, { id: 'q2', layer: 'R', position: P(20, 5) })
    })
    const g = (line: string) => d.snapshot().groups.find(x => x.lines.includes(line))!.id
    d.editIn(SIDE, e => e.move([{ id: 'p2', target: P(-30, 12) }, { id: 'q2', target: P(30, 12) }]))
    d.edit(e => e.mirrorLink([g('l')], [g('r')]))
    const before = every(d)
    expect(() => d.edit(e => e.applyFromView(['L'], SIDE))).toThrow(/apply-from-mirror.*\br\b/)
    expect(every(d)).toBe(before)
    // both sides chosen, the source mirrored: allowed, both take the source exactly
    d.edit(e => e.applyFromView(['L', 'R'], SIDE))
    const pt = (p: string) => d.snapshot().points.find(x => x.id === p)!.position
    expect([pt('p2'), pt('q2')]).toEqual([P(-30, 12), P(30, 12)])
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
    // one side alone: refused too, its partner would change
    expect(() => d.edit(e => e.applyFromView(['L'], SIDE))).toThrow(/apply-from-mirror/)
    expect(every(d)).toBe(before)
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
