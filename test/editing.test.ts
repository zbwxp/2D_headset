// Acceptance for the editing module (docs/editing-apply-plan.md, Phase E; graph Editing table).
import { describe, it, expect } from 'vitest'
import { Core, type Vec } from '../src'
import { sk } from './sketch'

const P = (x: number, y = 0): Vec => ({ x, y })
const s = (d: Core) => d.snapshot()
const line = (d: Core, id: string) => s(d).lines.find(l => l.id === id)!
const point = (d: Core, id: string) => s(d).points.find(p => p.id === id)!
const close = (a: Vec, b: Vec) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9

/** a(0,0) —ab— b(10,0) —bc— c(10,10); line ab and bc share b. */
function corner() {
  const d = new Core()
  d.edit(e => {
    e.layer('A')
    sk(e).point('a', 'A', P(0)); sk(e).point('b', 'A', P(10)); sk(e).point('c', 'A', P(10, 10))
    sk(e).line('ab', 'a', 'b'); sk(e).line('bc', 'b', 'c')
  })
  return d
}

describe('selection is a pre-edit', () => {
  it('E1. select, add and remove are one undo step each; reselecting the same set adds no step', () => {
    const d = corner()
    d.edit(e => e.select([{ kind: 'line', id: 'ab' }]))
    d.edit(e => e.select([{ kind: 'line', id: 'bc' }], 'add'))
    expect(s(d).selection).toEqual([{ kind: 'line', id: 'ab' }, { kind: 'line', id: 'bc' }])
    d.edit(e => e.select([{ kind: 'line', id: 'ab' }], 'remove'))
    expect(s(d).selection).toEqual([{ kind: 'line', id: 'bc' }])
    d.edit(e => e.select([{ kind: 'line', id: 'bc' }])) // same set: no step
    d.undo()
    expect(s(d).selection).toEqual([{ kind: 'line', id: 'ab' }, { kind: 'line', id: 'bc' }])
    d.undo(); d.undo()
    expect(s(d).selection).toEqual([])
  })

  it('E1b. V selects the whole continuous curve, hidden lines included', () => {
    const d = corner()
    d.edit(e => e.lineState('bc', { visible: false }))
    d.edit(e => e.selectGroup('ab'))
    expect(s(d).selection).toEqual([{ kind: 'line', id: 'ab' }, { kind: 'line', id: 'bc' }])
  })

  it('E2. deleting a selected line drops it from the selection in the same step; undo restores both', () => {
    const d = corner()
    d.edit(e => e.select([{ kind: 'line', id: 'ab' }, { kind: 'point', id: 'c' }]))
    d.edit(e => e.deleteSelection())
    expect(s(d).lines.map(l => l.id)).toEqual(['bc'])
    expect(s(d).selection).toEqual([{ kind: 'point', id: 'c' }])
    d.undo()
    expect(s(d).lines).toHaveLength(2)
    expect(s(d).selection).toEqual([{ kind: 'line', id: 'ab' }, { kind: 'point', id: 'c' }])
  })

  it('E2b. selecting something that does not exist is refused', () => {
    const d = corner()
    expect(() => d.edit(e => e.select([{ kind: 'line', id: 'nope' }]))).toThrow(/Nothing to select/)
  })
})

describe('transforms act on what the selection expands to', () => {
  it('E3. moving a selected line moves its points and handles; the unselected neighbour follows, its handle keeping direction and length', () => {
    const d = corner()
    const bcHa = line(d, 'bc').ha
    d.edit(e => { e.select([{ kind: 'line', id: 'ab' }]); e.translate(0, 5) })
    expect(point(d, 'a').position).toEqual(P(0, 5))
    expect(point(d, 'b').position).toEqual(P(10, 5))
    expect(point(d, 'c').position).toEqual(P(10, 10))
    expect(line(d, 'bc').ha).toEqual(bcHa)
  })

  it('E4. rotating a line turns its own handles; with a smooth join the spring turns the neighbour, with a cusp it does not', () => {
    for (const mode of ['smooth', 'cusp'] as const) {
      const d = corner()
      d.edit(e => e.join('b', 'ab', 'bc', { mode }))
      const before = line(d, 'bc').ha
      d.edit(e => { e.select([{ kind: 'line', id: 'ab' }]); e.rotate(P(10), Math.PI / 8) })
      const ab = line(d, 'ab'), bc = line(d, 'bc')
      if (mode === 'cusp') expect(bc.ha).toEqual(before)
      else expect(Math.abs(ab.hb.x * bc.ha.y - ab.hb.y * bc.ha.x)).toBeLessThan(1e-6) // collinear: smooth
    }
  })

  it('E5. two selected lines sharing a point move it once', () => {
    const d = corner()
    d.edit(e => { e.select([{ kind: 'line', id: 'ab' }, { kind: 'line', id: 'bc' }]); e.translate(3, 0) })
    expect(point(d, 'b').position).toEqual(P(13))
  })

  it('E6. scaling never changes line width (bowen 1791471538)', () => {
    const d = corner()
    d.edit(e => e.lineStroke('ab', { width: 4, profile: 'uniform' }))
    d.edit(e => { e.select([{ kind: 'line', id: 'ab' }]); e.scale(P(0), 3, 3) })
    expect(line(d, 'ab').stroke.width).toBe(4)
    expect(point(d, 'b').position).toEqual(P(30))
  })

  it('E7. flip reflects about the selection’s own centre, keeps ids, and twice returns the original', () => {
    const d = corner()
    const original = JSON.stringify(s(d).lines)
    d.edit(e => { e.selectGroup('ab'); e.flip() })
    // the curve bounds are x 0..10, so the centre is x = 5
    expect(point(d, 'a').position).toEqual(P(10))
    expect(point(d, 'c').position).toEqual(P(0, 10))
    expect(s(d).lines.map(l => l.id)).toEqual(['ab', 'bc'])
    d.edit(e => e.flip())
    for (const l of s(d).lines) {
      const o = JSON.parse(original).find((x: { id: string }) => x.id === l.id)
      expect(close(l.ha, o.ha) && close(l.hb, o.hb)).toBe(true)
    }
    expect(close(point(d, 'a').position, P(0))).toBe(true)
  })

  it('E8. transforming a locked line is refused; a locked line can still be selected', () => {
    const d = corner()
    d.edit(e => e.lineState('ab', { locked: true }))
    d.edit(e => e.select([{ kind: 'line', id: 'ab' }]))
    expect(() => d.edit(e => e.translate(1, 0))).toThrow(/Locked/)
  })

  it('E9. deleting with only points selected is refused', () => {
    const d = corner()
    d.edit(e => e.select([{ kind: 'point', id: 'b' }]))
    expect(() => d.edit(e => e.deleteSelection())).toThrow(/select-lines-to-delete/)
  })

  it('E10. a linked point in another layer follows a transformed point', () => {
    const d = corner()
    d.edit(e => { e.layer('B'); sk(e).point('q', 'B', P(10)); sk(e).point('r', 'B', P(20, 20)); sk(e).line('qr', 'q', 'r'); e.link('b', 'q') })
    d.edit(e => { e.select([{ kind: 'point', id: 'b' }]); e.translate(0, -4) })
    expect(point(d, 'q').position).toEqual(P(10, -4))
  })

  it('E12. a zero scale is refused', () => {
    const d = corner()
    d.edit(e => e.select([{ kind: 'line', id: 'ab' }]))
    expect(() => d.edit(e => e.scale(P(0), 0, 1))).toThrow(/zero scale/)
  })

  it('E13. a selected fill moves its boundary lines; deleting it clears the fill', () => {
    const d = new Core()
    d.edit(e => {
      e.layer('A')
      sk(e).point('a', 'A', P(0)); sk(e).point('b', 'A', P(10)); sk(e).point('c', 'A', P(5, 10))
      sk(e).line('ab', 'a', 'b'); sk(e).line('bc', 'b', 'c'); sk(e).line('ca', 'c', 'a')
    })
    const loop = s(d).loops[0]!.id
    d.edit(e => e.fill(loop, 'red'))
    d.edit(e => { e.select([{ kind: 'fill', id: loop }]); e.translate(1, 1) })
    expect(point(d, 'c').position).toEqual(P(6, 11))
    d.edit(e => e.deleteSelection())
    expect(s(d).loops[0]!.color).toBeUndefined()
    expect(s(d).lines).toHaveLength(3)
  })
})
