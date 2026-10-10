// Step 6: stroke broadcast (docs/step6-stroke-broadcast.md; dot 1791655825). The chosen
// lines' own strokes and their end points' end strokes, as in the edited view, assigned
// to every other view; a batch edit; auto-bind only for coincidences this edit made.
import { describe, it, expect } from 'vitest'
import { Core, type Vec } from '../src'

const P = (x: number, y = 0): Vec => ({ x, y })
const FRONT = 'view:0,0', SIDE = 'view:90,0', UP = 'view:0,45'
const strokeIn = (d: Core, k: string, id: string) => d.in(k).snapshot().lines.find(l => l.id === id)!.stroke
const endIn = (d: Core, k: string, p: string) => d.in(k).snapshot().points.find(x => x.id === p)!.endStroke
const all = (d: Core) => JSON.stringify(d.views().map(k => [k, d.in(k).snapshot(), d.in(k).geometry()]))

/** ab and bc meeting at b; cd apart, in layer L. */
function doc() {
  const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
  d.edit(e => {
    e.line('ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(10) })
    e.line('bc', 'b', { id: 'c', layer: 'L', position: P(20, 5) })
    e.line('cd', { id: 'x', layer: 'L', position: P(0, 40) }, { id: 'y', layer: 'L', position: P(10, 40) })
  })
  // different values per view
  d.edit(e => { e.lineStroke('ab', { width: 1, profile: 'uniform' }); e.endStroke('a', { taper: 1 }) })
  d.editIn(SIDE, e => { e.lineStroke('ab', { width: 3, profile: 'taper' }); e.endStroke('a', { taper: 3 }); e.endStroke('b', { taper: 9 }) })
  d.editIn(UP, e => { e.lineStroke('ab', { width: 5, profile: 'uniform' }); e.lineStroke('bc', { width: 7, profile: 'uniform' }) })
  return d
}

describe('stroke broadcast', () => {
  it('from a side view: the chosen lines and their end points equal the side view in every view; nothing else changes', () => {
    const d = doc()
    const shapes = d.views().map(k => JSON.stringify(d.in(k).snapshot().points.map(p => p.position)))
    const bcBefore = d.views().map(k => strokeIn(d, k, 'bc'))
    d.editIn(SIDE, e => e.broadcastStroke([{ kind: 'line', id: 'ab' }]))
    for (const k of d.views()) {
      expect(strokeIn(d, k, 'ab')).toEqual({ width: 3, profile: 'taper' })
      expect(endIn(d, k, 'a')).toEqual({ taper: 3 })
      expect(endIn(d, k, 'b')).toEqual({ taper: 9 }) // b is shared with bc: its end stroke is assigned too
    }
    // the unchosen line keeps its own stroke in every view; shapes are untouched
    expect(d.views().map(k => strokeIn(d, k, 'bc'))).toEqual(bcBefore)
    expect(d.views().map(k => JSON.stringify(d.in(k).snapshot().points.map(p => p.position)))).toEqual(shapes)
  })

  it('an end stroke absent in the edited view is cleared elsewhere', () => {
    const d = doc()
    d.editIn(UP, e => e.broadcastStroke([{ kind: 'line', id: 'ab' }]))
    for (const k of d.views()) { expect(endIn(d, k, 'a')).toBeUndefined(); expect(strokeIn(d, k, 'ab').width).toBe(5) }
  })

  it('is one undo step; a locked line refuses the whole broadcast and writes nothing; no line chosen is refused', () => {
    const d = doc(), before = all(d)
    d.editIn(SIDE, e => e.broadcastStroke([{ kind: 'line', id: 'ab' }, { kind: 'line', id: 'bc' }]))
    d.undo()
    expect(all(d)).toBe(before)
    d.edit(e => e.lineState('bc', { locked: true }))
    const locked = all(d)
    expect(() => d.editIn(SIDE, e => e.broadcastStroke([{ kind: 'line', id: 'ab' }, { kind: 'line', id: 'bc' }]))).toThrow(/Locked lines would change \(bc\)/)
    expect(all(d)).toBe(locked)
    expect(() => d.editIn(SIDE, e => e.broadcastStroke([{ kind: 'point', id: 'a' }]))).toThrow(/select-lines-to-broadcast/)
    expect(() => d.editIn(SIDE, e => e.broadcastStroke())).toThrow(/select-lines-to-broadcast/)
    // the selection is the default target
    d.editIn(SIDE, e => { e.select([{ kind: 'line', id: 'ab' }]); e.broadcastStroke() })
    expect(strokeIn(d, FRONT, 'ab').width).toBe(3)
  })
})

describe('auto-bind only binds coincidences this edit made (dot 1791655825)', () => {
  /** A legal coincidence in the side view: c drawn in the front where b is in the side view. */
  function coincident() {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => e.line('ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(10) }))
    d.editIn(SIDE, e => e.move([{ id: 'b', target: P(50, 50) }]))
    d.edit(e => e.line('cd', { id: 'c', layer: 'L', position: P(50, 50) }, { id: 'e', layer: 'L', position: P(60, 60) }))
    d.edit(e => e.line('fg', { id: 'f', layer: 'L', position: P(0, 80) }, { id: 'g', layer: 'L', position: P(10, 80) }))
    return d
  }
  const ids = (d: Core) => d.in(SIDE).snapshot().points.map(p => p.id).sort()

  it('a stroke broadcast in that view keeps the two points and their connections', () => {
    const d = coincident()
    d.editIn(SIDE, e => e.broadcastStroke([{ kind: 'line', id: 'ab' }]))
    expect(ids(d)).toEqual(['a', 'b', 'c', 'e', 'f', 'g'])
    expect(d.in(SIDE).snapshot().lines.find(l => l.id === 'cd')!.a).toBe('c')
  })

  it('moving an unrelated point there keeps them; moving one of the two there binds them', () => {
    const d = coincident()
    d.editIn(SIDE, e => e.move([{ id: 'f', target: P(1, 81) }]))
    expect(ids(d)).toEqual(['a', 'b', 'c', 'e', 'f', 'g'])
    d.editIn(SIDE, e => e.move([{ id: 'c', target: P(50, 50) }]))
    expect(ids(d)).toEqual(['a', 'b', 'e', 'f', 'g'])
  })

  it('a broadcast together with a move in one edit: the move still binds what it made', () => {
    const d = coincident()
    d.editIn(SIDE, e => { e.broadcastStroke([{ kind: 'line', id: 'ab' }]); e.move([{ id: 'g', target: d.in(SIDE).snapshot().points.find(p => p.id === 'e')!.position }]) })
    expect(ids(d)).toEqual(['a', 'b', 'c', 'e', 'f'])
  })
})
