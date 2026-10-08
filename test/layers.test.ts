// Acceptance cases for the layer / element batch (docs/layer-batch-plan.md,
// graph rows Q29–Q31). Numbers follow the plan.
import { describe, it, expect } from 'vitest'
import { Core, type Vec } from '../src'
import { sk } from './sketch'

const P = (x: number, y = 0): Vec => ({ x, y })

/** Triangle a(0,0) b(10,0) c(5,10) in `layer`, lines ab bc ca; ids prefixed by `p`. */
function triangle(d: Core, layer: string, p = '', at = P(0)) {
  d.edit(e => {
    sk(e).point(p + 'a', layer, P(at.x, at.y)); sk(e).point(p + 'b', layer, P(at.x + 10, at.y)); sk(e).point(p + 'c', layer, P(at.x + 5, at.y + 10))
    sk(e).line(p + 'ab', p + 'a', p + 'b'); sk(e).line(p + 'bc', p + 'b', p + 'c'); sk(e).line(p + 'ca', p + 'c', p + 'a')
  })
}
function doc(...layers: string[]) {
  const d = new Core()
  d.edit(e => { for (const l of layers) e.layer(l) })
  return d
}
const s = (d: Core) => d.snapshot()
const line = (d: Core, id: string) => s(d).lines.find(l => l.id === id)
const point = (d: Core, id: string) => s(d).points.find(p => p.id === id)
const groupOf = (d: Core, lineId: string) => s(d).groups.find(g => g.lines.includes(lineId))!
const layerIds = (d: Core) => s(d).layers.map(l => l.id)
const fillFirst = (d: Core, color = 'red') => { const id = s(d).loops[0]!.id; d.edit(e => e.fill(id, color)); return id }

describe('layers', () => {
  it('0. a new document has one empty layer and nothing to undo; the bare model may hold zero layers (dot 1791459600)', () => {
    const d = Core.newDocument()
    expect(s(d).layers).toEqual([{ id: 'layer-1', name: 'Layer 1' }])
    expect(s(d).lines).toEqual([])
    expect(d.canUndo).toBe(false)
    expect(new Core().snapshot().layers).toEqual([])
    d.edit(e => e.deleteLayer('layer-1'))
    expect(s(d).layers).toEqual([])
  })

  it('0b. the lock check is on the result: unlocking then editing in one edit is allowed; ending the edit locked with a change is refused', () => {
    const d = doc('A'); triangle(d, 'A')
    d.edit(e => e.lineState('ab', { locked: true }))
    d.edit(e => { e.lineState('ab', { locked: false }); e.lineStroke('ab', { width: 3, profile: 'uniform' }) })
    expect(line(d, 'ab')!.stroke.width).toBe(3)
    expect(() => d.edit(e => { e.lineStroke('bc', { width: 3, profile: 'uniform' }); e.lineState('bc', { locked: true }) })).toThrow(/Locked lines would change \(bc\)/)
  })

  it('1. a new layer is empty, sits above the given layer, and needs a unique non-empty name', () => {
    const d = doc('A', 'C')
    d.edit(e => e.layer('B', 'Bee', 'A'))
    expect(s(d).layers).toEqual([{ id: 'A', name: 'A' }, { id: 'B', name: 'Bee' }, { id: 'C', name: 'C' }])
    expect(() => d.edit(e => e.layer('D', 'Bee'))).toThrow(/already used/)
    expect(() => d.edit(e => e.layer('D', '  '))).toThrow(/empty/)
    expect(() => d.edit(e => e.layer('B'))).toThrow(/already exists/)
  })

  it('2. renaming to a name in use is refused', () => {
    const d = doc('A', 'B')
    expect(() => d.edit(e => e.renameLayer('B', 'A'))).toThrow(/already used/)
    d.edit(e => e.renameLayer('B', 'Back'))
    expect(s(d).layers[1]!.name).toBe('Back')
  })

  it('3. reordering layers is one undo step', () => {
    const d = doc('A', 'B', 'C')
    d.edit(e => e.reorderLayer('C', 0))
    expect(layerIds(d)).toEqual(['C', 'A', 'B'])
    d.undo()
    expect(layerIds(d)).toEqual(['A', 'B', 'C'])
  })
})

describe('copying a layer', () => {
  it('4. gives new ids with the same shape, joins and fill colours, directly above the original', () => {
    const d = doc('A', 'B'); triangle(d, 'A')
    const fill = fillFirst(d)
    d.edit(e => { e.join('a', 'ab', 'ca', { mode: 'smooth' }); e.endStroke('b', { taper: 2 }) })
    d.edit(e => e.copyLayer('A', 'A2'))
    expect(layerIds(d)).toEqual(['A', 'A2', 'B'])
    for (const id of ['ab', 'bc', 'ca']) {
      const a = line(d, id)!, b = line(d, 'A2/' + id)!
      expect([b.a, b.b]).toEqual(['A2/' + a.a, 'A2/' + a.b])
      expect([b.ha, b.hb]).toEqual([a.ha, a.hb])
    }
    for (const id of ['a', 'b', 'c']) expect(point(d, 'A2/' + id)!.position).toEqual(point(d, id)!.position)
    expect(s(d).joins.filter(j => j.point === 'A2/a').map(j => j.lines)).toEqual([['A2/ab', 'A2/ca']])
    expect(point(d, 'A2/b')!.endStroke).toEqual({ taper: 2 })
    const copied = s(d).loops.filter(l => l.layer === 'A2')
    expect(copied.map(l => [l.id, l.color])).toEqual([['A2/' + fill, 'red']])
    expect(s(d).loops.find(l => l.id === fill)!.color).toBe('red')
  })

  it('5. element states are kept', () => {
    const d = doc('A'); triangle(d, 'A')
    const fill = fillFirst(d)
    d.edit(e => { e.lineState('ab', { locked: true }); e.lineState('bc', { visible: false }); e.fillState(fill, { locked: true }) })
    d.edit(e => e.copyLayer('A', 'A2'))
    expect(line(d, 'A2/ab')!.state).toEqual({ visible: true, locked: true })
    expect(line(d, 'A2/bc')!.state).toEqual({ visible: false, locked: false })
    expect(s(d).loops.find(l => l.id === 'A2/' + fill)!.locked).toBe(true)
  })

  it('6. links are not copied; the original link stays', () => {
    const d = doc('A', 'B'); triangle(d, 'A'); triangle(d, 'B', 'q', P(20))
    d.edit(e => e.link('qa', 'a'))
    d.edit(e => e.copyLayer('A', 'A2'))
    expect(s(d).links).toEqual([{ a: 'qa', b: 'a' }])
    expect(point(d, 'A2/a')!.links).toEqual([])
  })

  it('4b. a line and a point with the same id are copied as two different things (dot 1791459462)', () => {
    const d = doc('A')
    d.edit(e => {
      sk(e).point('a', 'A', P(0)); sk(e).point('b', 'A', P(10)); sk(e).line('p', 'a', 'b')
      sk(e).point('p', 'A', P(20)); sk(e).point('c', 'A', P(30)); sk(e).line('q', 'p', 'c')
      e.endStroke('p', { taper: 1 })
    })
    d.edit(e => e.copyLayer('A', 'Copy'))
    expect(line(d, 'Copy/q')).toMatchObject({ a: 'Copy/p', b: 'Copy/c' })
    expect(point(d, 'Copy/p')).toMatchObject({ position: P(20), endStroke: { taper: 1 } })
    expect(line(d, 'Copy/p')).toMatchObject({ a: 'Copy/a', b: 'Copy/b' })
    expect(() => d.geometry()).not.toThrow()
  })

  it('7. the copy name is unique', () => {
    const d = doc('A'); triangle(d, 'A')
    d.edit(e => { e.copyLayer('A', 'A2'); e.copyLayer('A', 'A3') })
    expect(s(d).layers.map(l => l.name)).toEqual(['A', 'A · 3', 'A · 2'])
  })

  it('29. copying a locked group gives a locked copy', () => {
    const d = doc('A'); triangle(d, 'A')
    d.edit(e => e.groupState(groupOf(d, 'ab').id, { locked: true }))
    d.edit(e => e.copyLayer('A', 'A2'))
    expect(['ab', 'bc', 'ca'].every(id => line(d, 'A2/' + id)!.state.locked)).toBe(true)
  })
})

describe('deleting a layer', () => {
  it('8. with unlocked elements only, the layer goes and its links end', () => {
    const d = doc('A', 'B'); triangle(d, 'A'); triangle(d, 'B', 'q', P(20))
    d.edit(e => e.link('qa', 'a'))
    d.edit(e => e.deleteLayer('A'))
    expect(layerIds(d)).toEqual(['B'])
    expect(s(d).links).toEqual([])
    expect(point(d, 'qa')!.links).toEqual([])
    d.undo()
    expect(layerIds(d)).toEqual(['A', 'B'])
  })

  it('9. a locked line and its layer stay; the unlocked lines go', () => {
    const d = doc('A'); triangle(d, 'A')
    d.edit(e => e.lineState('ab', { locked: true }))
    d.edit(e => e.deleteLayer('A'))
    expect(layerIds(d)).toEqual(['A'])
    expect(s(d).lines.map(l => l.id)).toEqual(['ab'])
  })

  it('10. a locked fill whose boundary lines are unlocked vanishes with its loop (甲)', () => {
    const d = doc('A'); triangle(d, 'A')
    const fill = fillFirst(d)
    d.edit(e => e.fillState(fill, { locked: true }))
    d.edit(e => e.deleteLayer('A'))
    expect(s(d).loops).toEqual([])
    expect(layerIds(d)).toEqual([])
  })

  it('10b. an unlocked fill on locked lines is deleted; the lines stay', () => {
    const d = doc('A'); triangle(d, 'A')
    fillFirst(d)
    d.edit(e => e.groupState(groupOf(d, 'ab').id, { locked: true }))
    const fill = s(d).loops[0]!.id
    d.edit(e => e.fillState(fill, { locked: false }))
    d.edit(e => e.deleteLayer('A'))
    expect(s(d).lines).toHaveLength(3)
    expect(s(d).loops[0]!.color).toBeUndefined()
  })

  it('11. deleting is always allowed (bowen 1791460893 甲): a locked line whose shared end turns free shows its end stroke', () => {
    const d = doc('A'); triangle(d, 'A')
    d.edit(e => { e.lineState('ab', { locked: true }); e.endStroke('b', { taper: 2 }) })
    d.edit(e => e.deleteLayer('A'))
    expect(s(d).lines.map(l => l.id)).toEqual(['ab'])
    expect(point(d, 'b')!.endStroke).toEqual({ taper: 2 })
  })
})

describe('state changes and locks', () => {
  it('12. hiding a layer hides every element; showing shows every element', () => {
    const d = doc('A'); triangle(d, 'A')
    const fill = fillFirst(d)
    d.edit(e => e.layerState('A', { visible: false }))
    expect(s(d).lines.every(l => !l.state.visible)).toBe(true)
    expect(s(d).loops.find(l => l.id === fill)!.visible).toBe(false)
    d.edit(e => e.layerState('A', { visible: true }))
    expect(s(d).lines.every(l => l.state.visible)).toBe(true)
    expect(s(d).loops.find(l => l.id === fill)!.visible).toBe(true)
  })

  it('12c. hiding a continuous curve is a batch over its lines only; its fills keep their own switch (bowen 1791433646)', () => {
    const d = doc('A'); triangle(d, 'A')
    const fill = fillFirst(d)
    d.edit(e => e.groupState(groupOf(d, 'ab').id, { visible: false }))
    expect(s(d).lines.every(l => !l.state.visible)).toBe(true)
    expect(s(d).loops.find(l => l.id === fill)!.visible).toBe(true)
  })

  it('12b. the fill toggle of a layer touches fills only', () => {
    const d = doc('A'); triangle(d, 'A')
    const fill = fillFirst(d)
    d.edit(e => e.layerFills('A', { visible: false }))
    expect(s(d).loops.find(l => l.id === fill)!.visible).toBe(false)
    expect(s(d).lines.every(l => l.state.visible)).toBe(true)
  })

  it('13. a locked element can still be hidden and unlocked', () => {
    const d = doc('A'); triangle(d, 'A')
    const fill = fillFirst(d)
    d.edit(e => { e.lineState('ab', { locked: true }); e.fillState(fill, { locked: true }) })
    d.edit(e => { e.lineState('ab', { visible: false }); e.fillState(fill, { visible: false }) })
    expect(line(d, 'ab')!.state).toEqual({ visible: false, locked: true })
    d.edit(e => e.lineState('ab', { locked: false }))
    expect(line(d, 'ab')!.state.locked).toBe(false)
  })

  it('13b. a locked fill’s colour cannot be changed or cleared', () => {
    const d = doc('A'); triangle(d, 'A')
    const fill = fillFirst(d)
    d.edit(e => e.fillState(fill, { locked: true }))
    expect(() => d.edit(e => e.fill(fill, 'blue'))).toThrow(/locked/)
    expect(() => d.edit(e => e.clearFill(fill))).toThrow(/locked/)
  })

  it('14. every state change is one undo step', () => {
    const d = doc('A'); triangle(d, 'A')
    d.edit(e => e.lineState('ab', { locked: true }))
    d.edit(e => e.layerState('A', { visible: false }))
    d.undo()
    expect(s(d).lines.every(l => l.state.visible)).toBe(true)
    expect(line(d, 'ab')!.state.locked).toBe(true)
    d.undo()
    expect(line(d, 'ab')!.state.locked).toBe(false)
  })
})

describe('line width and locks', () => {
  it('15. a group width change skips locked lines', () => {
    const d = doc('A'); triangle(d, 'A')
    d.edit(e => e.lineState('ab', { locked: true }))
    d.edit(e => e.stroke(groupOf(d, 'ab').id, { width: 4, profile: 'uniform' }))
    expect(s(d).lines.map(l => [l.id, l.stroke.width])).toEqual([['ab', 1], ['bc', 4], ['ca', 4]])
    expect(() => d.edit(e => e.lineStroke('ab', { width: 4, profile: 'uniform' }))).toThrow(/Locked/)
  })

  it('16. dragging a point shared with a locked line is refused', () => {
    const d = doc('A'); triangle(d, 'A')
    d.edit(e => e.lineState('ab', { locked: true }))
    expect(() => d.edit(e => e.move([{ id: 'b', target: P(12) }]))).toThrow(/Locked lines would change \(ab\)/)
    d.edit(e => e.move([{ id: 'c', target: P(5, 12) }])) // c is not on ab
    expect(point(d, 'c')!.position).toEqual(P(5, 12))
  })

  it('17. a smooth spring that would turn a locked handle is refused', () => {
    const d = doc('A'); triangle(d, 'A')
    d.edit(e => e.join('b', 'ab', 'bc', { mode: 'smooth' }))
    d.edit(e => e.lineState('ab', { locked: true }))
    // dragging bc's handle at b would make the spring turn ab's handle
    expect(() => d.edit(e => e.moveHandle('bc', 'a', P(-3, 3)))).toThrow(/Locked lines would change \(ab\)/)
    // setting a join at a locked line's end is itself refused: the join is the point's, and the point is locked (bowen 1791459836)
    expect(() => d.edit(e => e.join('a', 'ab', 'ca', { mode: 'smooth' }))).toThrow(/Locked/)
  })

  it('18 / 29b. binding onto a locked line’s shared end is allowed when nothing on it changes', () => {
    const d = doc('A'); triangle(d, 'A')
    d.edit(e => { sk(e).point('x', 'A', P(30)); sk(e).point('y', 'A', P(40)); sk(e).line('xy', 'x', 'y') })
    d.edit(e => e.lineState('ab', { locked: true }))
    d.edit(e => e.bind('b', 'x'))
    expect(line(d, 'xy')!.a).toBe('b')
  })

  it('19. binding onto a locked line’s free end that has an end stroke is refused; without one it is allowed', () => {
    const d = doc('A')
    d.edit(e => {
      sk(e).point('a', 'A', P(0)); sk(e).point('b', 'A', P(10)); sk(e).line('ab', 'a', 'b')
      sk(e).point('x', 'A', P(30)); sk(e).point('y', 'A', P(40)); sk(e).line('xy', 'x', 'y')
      e.lineState('ab', { locked: true }); e.endStroke('a', { taper: 1 })
    })
    expect(() => d.edit(e => e.bind('a', 'x'))).toThrow(/Locked lines would change \(ab\)/)
    d.edit(e => e.bind('b', 'x'))
    expect(line(d, 'xy')!.a).toBe('b')
  })

  it('29c. a locked line locks the joins and arcs at its end points (bowen 1791459836)', () => {
    const d = doc('A'); triangle(d, 'A')
    d.edit(e => e.join('b', 'ab', 'bc', { mode: 'arc', radius: 2 }))
    d.edit(e => e.lineState('ab', { locked: true }))
    // moving c reshapes bc, which bends the arc at b
    expect(() => d.edit(e => e.move([{ id: 'c', target: P(5, 14) }]))).toThrow(/Locked lines would change \(ab\)/)
    expect(() => d.edit(e => e.removeJoin('b', 'ab', 'bc'))).toThrow(/Locked/)
    expect(() => d.edit(e => e.join('a', 'ab', 'ca', { mode: 'cusp' }))).toThrow(/Locked/)
    // width and state of the neighbour are not part of the arc
    d.edit(e => e.lineStroke('bc', { width: 5, profile: 'uniform' }))
    // a join at c (not an end of ab) is free to change
    d.edit(e => e.join('c', 'bc', 'ca', { mode: 'cusp' }))
  })

  it('29d. joins across a link at a locked line’s end are protected the same way (dot 1791460421)', () => {
    const d = doc('A', 'B'); triangle(d, 'A'); triangle(d, 'B', 'q', P(20))
    d.edit(e => e.link('a', 'qa'))
    d.edit(e => e.lineState('ab', { locked: true }))
    expect(() => d.edit(e => e.linkJoin('a', 'qa', 'ab', 'qab', { mode: 'smooth' }))).toThrow(/Locked/)
    d.edit(e => e.lineState('ab', { locked: false }))
    d.edit(e => e.linkJoin('a', 'qa', 'ab', 'qab', { mode: 'smooth' }))
    d.edit(e => e.lineState('ab', { locked: true }))
    expect(() => d.edit(e => e.removeLinkJoin('a', 'qa', 'ab', 'qab'))).toThrow(/Locked/)
  })

  it('29e. deleting an unlocked neighbour is allowed; its joins with the locked line go with it (bowen 1791460893 甲)', () => {
    const d = doc('A'); triangle(d, 'A')
    d.edit(e => { e.join('b', 'ab', 'bc', { mode: 'arc', radius: 2 }); e.join('a', 'ab', 'ca', { mode: 'smooth' }) })
    d.edit(e => e.lineState('ab', { locked: true }))
    const trimmed = d.geometry().lines.find(l => l.id === 'ab')!.curve
    d.edit(e => e.deleteLine('bc'))
    expect(s(d).joins.map(j => j.point)).toEqual(['a'])
    expect(d.geometry().arcs).toEqual([])
    // the arc's trim on ab is gone with the arc: ab is drawn to its end point again
    expect(d.geometry().lines.find(l => l.id === 'ab')!.curve[3]).toEqual(P(10))
    expect(trimmed[3]).not.toEqual(P(10))
    d.edit(e => e.deleteLayer('A'))
    expect(s(d).lines.map(l => l.id)).toEqual(['ab'])
  })

  it('29f. splitting an unlocked neighbour keeps the join on the piece and is allowed; deleting that piece is a delete', () => {
    const d = doc('A'); triangle(d, 'A')
    d.edit(e => e.join('b', 'ab', 'bc', { mode: 'smooth' }))
    d.edit(e => e.lineState('ab', { locked: true }))
    d.edit(e => e.split('bc', 0.5, 'm', 'bc1', 'bc2'))
    expect(s(d).joins).toEqual([{ point: 'b', lines: ['ab', 'bc1'], mode: 'smooth' }])
    d.edit(e => { e.split('ca', 0.5, 'n', 'ca1', 'ca2'); e.deleteLine('bc1') })
    expect(s(d).joins).toEqual([])
  })

  it('29h. deleting a linked partner’s line ends the link; the locked end turning free is allowed (bowen 1791460893 甲)', () => {
    const d = doc('A', 'B')
    d.edit(e => {
      sk(e).point('a', 'A', P(0)); sk(e).point('b', 'A', P(10)); sk(e).line('ab', 'a', 'b')
      sk(e).point('q', 'B', P(0)); sk(e).point('r', 'B', P(0, 10)); sk(e).line('qr', 'q', 'r')
      e.link('a', 'q'); e.endStroke('a', { taper: 1 })
    })
    d.edit(e => e.lineState('ab', { locked: true }))
    d.edit(e => e.deleteLine('qr'))
    expect(s(d).links).toEqual([])
    expect(line(d, 'ab')).toBeDefined()
  })

  it('29g. editing still is refused: removing the join, or unbinding the neighbour from the locked point', () => {
    const d = doc('A'); triangle(d, 'A')
    d.edit(e => e.join('b', 'ab', 'bc', { mode: 'smooth' }))
    d.edit(e => e.lineState('ab', { locked: true }))
    expect(() => d.edit(e => e.removeJoin('b', 'ab', 'bc'))).toThrow(/Locked/)
    expect(() => d.edit(e => e.unbind('b', ['bc'], 'b2'))).toThrow(/Locked/)
  })

  it('29a. an arc join that reshapes a locked line is refused', () => {
    const d = doc('A'); triangle(d, 'A')
    d.edit(e => e.lineState('ab', { locked: true }))
    expect(() => d.edit(e => e.join('b', 'ab', 'bc', { mode: 'arc', radius: 2 }))).toThrow(/Locked/)
    d.edit(e => e.join('c', 'bc', 'ca', { mode: 'arc', radius: 2 })) // not on ab
  })
})

describe('overlapping endpoints in one layer (Q31)', () => {
  it('20. a pen line drawn to an existing point’s exact position is bound to it', () => {
    const d = doc('A'); triangle(d, 'A')
    d.edit(e => e.line('bx', { id: 'n', layer: 'A', position: P(10) }, { id: 'x', layer: 'A', position: P(20) }))
    expect(point(d, 'n')).toBeUndefined()
    expect(line(d, 'bx')!.a).toBe('b')
    expect(s(d).groups).toHaveLength(1)
  })

  it('20b. the same position in another layer does not bind', () => {
    const d = doc('A', 'B'); triangle(d, 'A')
    d.edit(e => e.line('bx', { id: 'n', layer: 'B', position: P(10) }, { id: 'x', layer: 'B', position: P(20) }))
    expect(point(d, 'n')).toBeDefined()
  })

  it('21. a point dragged onto another binds to it, keeping the one that stood still', () => {
    const d = doc('A'); triangle(d, 'A')
    d.edit(e => { sk(e).point('x', 'A', P(30)); sk(e).point('y', 'A', P(40)); sk(e).line('xy', 'x', 'y') })
    d.edit(e => e.move([{ id: 'x', target: P(5, 10) }]))
    expect(point(d, 'x')).toBeUndefined()
    expect(line(d, 'xy')!.a).toBe('c')
  })

  it('21b. when both points were moved onto one place, the earlier-created point is kept', () => {
    const d = doc('A')
    d.edit(e => {
      sk(e).point('a', 'A', P(0)); sk(e).point('b', 'A', P(10)); sk(e).line('ab', 'a', 'b')
      sk(e).point('x', 'A', P(30)); sk(e).point('y', 'A', P(40)); sk(e).line('xy', 'x', 'y')
    })
    d.edit(e => e.move([{ id: 'x', target: P(20) }, { id: 'b', target: P(20) }]))
    expect(s(d).points.map(p => p.id).sort()).toEqual(['a', 'b', 'y'])
  })

  it('22. merge position within one layer is a bind', () => {
    const d = doc('A'); triangle(d, 'A')
    d.edit(e => { sk(e).point('x', 'A', P(30)); sk(e).point('y', 'A', P(40)); sk(e).line('xy', 'x', 'y') })
    d.edit(e => e.mergePosition('c', 'x'))
    expect(point(d, 'x')).toBeUndefined()
    expect(line(d, 'xy')!.a).toBe('c')
  })

  it('23. dragging a line’s end onto its own other end deletes the line', () => {
    const d = doc('A')
    d.edit(e => { sk(e).point('a', 'A', P(0)); sk(e).point('b', 'A', P(10)); sk(e).line('ab', 'a', 'b') })
    d.edit(e => e.move([{ id: 'b', target: P(0) }]))
    expect(s(d).lines).toEqual([])
    expect(s(d).points).toEqual([])
  })

  it('23b. a link that pulls a point onto another point of its layer binds them', () => {
    const d = doc('A', 'B'); triangle(d, 'A'); triangle(d, 'B', 'q', P(20))
    d.edit(e => { sk(e).point('x', 'A', P(30, 30)); sk(e).point('y', 'A', P(40, 30)); sk(e).line('xy', 'x', 'y'); e.link('x', 'qa') })
    // moving qa onto a's position drags the linked x there too, where it meets a
    d.edit(e => e.move([{ id: 'qa', target: P(0) }]))
    expect(point(d, 'x')).toBeUndefined()
    expect(line(d, 'xy')!.a).toBe('a')
    expect(s(d).links).toEqual([])
  })

  it('23c. links align before overlaps bind: A→10 and B→15 average away from C at 10, so nothing binds (dot, after f9c4109)', () => {
    const d = doc('A', 'B')
    d.edit(e => {
      sk(e).point('a', 'A', P(0)); sk(e).point('a2', 'A', P(0, 30)); sk(e).line('aa', 'a', 'a2')
      sk(e).point('c', 'A', P(10)); sk(e).point('c2', 'A', P(10, -30)); sk(e).line('cc', 'c', 'c2')
      sk(e).point('b', 'B', P(0)); sk(e).point('b2', 'B', P(0, 30)); sk(e).line('bb', 'b', 'b2')
      e.link('a', 'b')
    })
    // a alone would land on c; the link average puts a and b at 15
    d.edit(e => e.move([{ id: 'a', target: P(10) }, { id: 'b', target: P(20) }]))
    expect(point(d, 'a')!.position).toEqual(P(15))
    expect(point(d, 'c')!.position).toEqual(P(10))
    expect(s(d).links).toEqual([{ a: 'a', b: 'b' }])
    expect(s(d).groups).toHaveLength(3)
  })
})

describe('later operations in one edit read where things are now (dot 1791459521)', () => {
  it('moving a filled group to B and deleting the emptied A in one edit keeps the fill', () => {
    const d = doc('A', 'B'); triangle(d, 'A')
    const fill = fillFirst(d)
    d.edit(e => { e.moveGroup(groupOf(d, 'ab').id, 'B'); e.deleteLayer('A') })
    expect(layerIds(d)).toEqual(['B'])
    expect(s(d).loops.find(l => l.id === fill)).toMatchObject({ layer: 'B', color: 'red' })
  })

  it('a fill copied in this edit is already in its new layer for the next operation', () => {
    const d = doc('A'); triangle(d, 'A')
    const fill = fillFirst(d)
    d.edit(e => { e.copyLayer('A', 'A2'); e.layerFills('A2', { visible: false }) })
    expect(s(d).loops.find(l => l.id === 'A2/' + fill)!.visible).toBe(false)
    expect(s(d).loops.find(l => l.id === fill)!.visible).toBe(true)
  })

  it('a layer copied and deleted in one edit leaves nothing behind', () => {
    const d = doc('A'); triangle(d, 'A')
    fillFirst(d)
    d.edit(e => { e.lineState('ab', { locked: true }); e.copyLayer('A', 'A2'); e.lineState('A2/ab', { locked: false }); e.deleteLayer('A2') })
    expect(layerIds(d)).toEqual(['A'])
    expect(s(d).loops).toHaveLength(1)
    expect(s(d).fillOrder).toHaveLength(1)
  })
})

describe('queries inside an edit see only valid loops (dot 1791459721)', () => {
  it('a locked fill broken earlier in the same edit does not crash a later moveGroup; it vanishes at commit (甲)', () => {
    const d = doc('A', 'B'); triangle(d, 'A')
    const fill = fillFirst(d)
    d.edit(e => e.fillState(fill, { locked: true }))
    d.edit(e => { e.unbind('a', ['ab'], 'a2'); e.moveGroup(groupOf(d, 'ab').id, 'B') })
    expect(s(d).loops).toEqual([])
    expect(s(d).groups.map(g => g.layer)).toEqual(['B'])
  })

  it('an end stroke with the same values in another key order is not a change to a locked line', () => {
    const d = doc('A')
    d.edit(e => {
      sk(e).point('a', 'A', P(0)); sk(e).point('b', 'A', P(10)); sk(e).line('ab', 'a', 'b')
      e.endStroke('a', { taper: 1, shape: 'round' }); e.lineState('ab', { locked: true })
    })
    d.edit(e => e.endStroke('a', { shape: 'round', taper: 1 }))
    expect(() => d.edit(e => e.endStroke('a', { shape: 'round', taper: 2 }))).toThrow(/Locked/)
  })
})

describe('unbind', () => {
  it('24. unbind leaves the two points apart and does not rebind', () => {
    const d = doc('A'); triangle(d, 'A')
    d.edit(e => e.unbind('a', ['ab'], 'a2'))
    expect(line(d, 'ab')!.a).toBe('a2')
    expect(point(d, 'a2')!.position).not.toEqual(point(d, 'a')!.position)
    expect(Math.hypot(point(d, 'a2')!.position.x, point(d, 'a2')!.position.y)).toBeCloseTo(0.5)
  })
})

describe('moving a group (cut and paste, Q31)', () => {
  it('25. keeps every id; fills and joins follow; the group lands on top of the target layer', () => {
    const d = doc('A', 'B'); triangle(d, 'A'); triangle(d, 'B', 'q', P(20))
    const fill = fillFirst(d)
    d.edit(e => e.join('a', 'ab', 'ca', { mode: 'cusp' }))
    const g = groupOf(d, 'ab'), q = groupOf(d, 'qab')
    d.edit(e => e.moveGroup(g.id, 'B'))
    expect(s(d).groups.map(x => [x.id, x.layer])).toEqual([[q.id, 'B'], [g.id, 'B']])
    expect(s(d).points.filter(p => ['a', 'b', 'c'].includes(p.id)).every(p => p.layer === 'B')).toBe(true)
    expect(s(d).loops.find(l => l.id === fill)).toMatchObject({ layer: 'B', color: 'red' })
    expect(s(d).joins).toHaveLength(1)
  })

  it('26. a group holding a locked line or a locked fill cannot be moved', () => {
    const d = doc('A', 'B'); triangle(d, 'A')
    const fill = fillFirst(d)
    d.edit(e => e.fillState(fill, { locked: true }))
    expect(() => d.edit(e => e.moveGroup(groupOf(d, 'ab').id, 'B'))).toThrow(/locked/)
    d.edit(e => { e.fillState(fill, { locked: false }); e.lineState('bc', { locked: true }) })
    expect(() => d.edit(e => e.moveGroup(groupOf(d, 'ab').id, 'B'))).toThrow(/locked/)
  })

  it('27. moving a group into its link partner’s layer binds the linked points and the link ends', () => {
    const d = doc('A', 'B', 'C'); triangle(d, 'A'); triangle(d, 'B', 'q', P(20))
    d.edit(e => e.link('qa', 'a')) // a moves onto qa
    d.edit(e => e.moveGroup(groupOf(d, 'ab').id, 'B'))
    expect(point(d, 'a')).toBeUndefined() // a was the one moved: qa is kept
    expect(line(d, 'ab')!.a).toBe('qa')
    expect(s(d).links).toEqual([])
    expect(s(d).groups).toHaveLength(1)
  })

  it('27b. moving both linked groups into one third layer also binds', () => {
    const d = doc('A', 'B', 'C'); triangle(d, 'A'); triangle(d, 'B', 'q', P(20))
    d.edit(e => e.link('qa', 'a'))
    d.edit(e => { e.moveGroup(groupOf(d, 'ab').id, 'C'); e.moveGroup(groupOf(d, 'qab').id, 'C') })
    expect(s(d).links).toEqual([])
    expect(s(d).groups).toHaveLength(1)
    expect(point(d, 'a')).toBeDefined() // both moved: the earlier-created point is kept
    expect(point(d, 'qa')).toBeUndefined()
  })

  it('28. moving two linked groups into two different layers keeps the link', () => {
    const d = doc('A', 'B', 'C', 'D'); triangle(d, 'A'); triangle(d, 'B', 'q', P(20))
    d.edit(e => e.link('qa', 'a'))
    d.edit(e => { e.moveGroup(groupOf(d, 'ab').id, 'C'); e.moveGroup(groupOf(d, 'qab').id, 'D') })
    expect(s(d).links).toEqual([{ a: 'qa', b: 'a' }])
  })
})
