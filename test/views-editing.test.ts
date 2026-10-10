// Step 3 of the multi-view framework: the document edits in a chosen view
// (scope Claude 1791653309, completed per dot 1791653374):
// - a document has its nine view layers from creation;
// - `editIn(layer, fn)` names a view; `edit(fn)` is the front compatibility entry;
// - the edited view is settled fully (auto-bind only here, Q2); every other view by
//   positions only; trial, afterApply, commit and open use the same per-layer rules;
// - mirror links act at 0,0 only: off the front, anything that would touch a pair's
//   structure (explicitly or by auto-bind) or act on both sides is refused;
// - linking moves the second point onto the first in every view;
// - locks are compared in every view.
import { describe, it, expect } from 'vitest'
import { Core, save, open, type Vec } from '../src'
import * as views from '../src/views'

const P = (x: number, y = 0): Vec => ({ x, y })
const FRONT = views.FRONT, SIDE = 'view:90,0', UP = 'view:0,45'
const at = (d: Core, layer: string, id: string) => d.in(layer).snapshot().points.find(p => p.id === id)?.position
const lineIn = (d: Core, layer: string, id: string) => d.in(layer).snapshot().lines.find(l => l.id === id)
const all = (d: Core) => JSON.stringify(d.views().map(k => [k, d.in(k).snapshot(), d.in(k).geometry()]))

/** Layer L with a line ab: a(0,0) b(10,0). */
function doc() {
  const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
  d.edit(e => e.line('ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(10) }))
  return d
}

describe('nine views from creation; edits name their view', () => {
  it('a new document has the nine views; editIn takes only a view of this document', () => {
    const d = Core.newDocument()
    expect([...d.views()].sort()).toEqual([...views.ALL].sort())
    expect(d.views()[0]).toBe(FRONT)
    expect(new Core().views()).toHaveLength(9)
    expect(() => d.editIn('base:angle', () => {})).toThrow(/not-a-view/)
    expect(() => d.editIn('view:9,9', () => {})).toThrow(/not-a-view/)
    expect(() => d.in('nowhere')).toThrow(/not-a-view/)
  })

  it('a move in one view changes that view only', () => {
    const d = doc()
    d.editIn(SIDE, e => e.move([{ id: 'b', target: P(4, 7) }]))
    expect(at(d, SIDE, 'b')).toEqual(P(4, 7))
    for (const k of d.views()) if (k !== SIDE) expect(at(d, k, 'b')).toEqual(P(10))
    expect(d.snapshot().points.find(p => p.id === 'b')!.position).toEqual(P(10)) // the compatibility reads are the front
  })

  it('a line drawn in a side view appears in all nine at the drawn place', () => {
    const d = doc()
    d.editIn(SIDE, e => e.move([{ id: 'b', target: P(4, 7) }]))
    d.editIn(SIDE, e => e.line('bc', 'b', { id: 'c', layer: 'L', position: P(20, 20) }))
    for (const k of d.views()) {
      expect(at(d, k, 'c')).toEqual(P(20, 20))
      expect(lineIn(d, k, 'bc')).toBeDefined()
    }
    // drawn from b where b is in the side view: the handles are the side view's straight line
    expect(lineIn(d, FRONT, 'bc')!.ha).toEqual(lineIn(d, SIDE, 'bc')!.ha)
    expect(lineIn(d, SIDE, 'bc')!.ha).toEqual({ x: 16 / 3, y: 13 / 3 })
  })

  it('a pure split in a side view leaves every view\'s drawing as it was', () => {
    const d = doc()
    d.editIn(SIDE, e => { e.move([{ id: 'b', target: P(4, 7) }]); e.moveHandle('ab', 'a', P(1, 5)) })
    const before = d.views().map(k => lineIn(d, k, 'ab'))
    d.editIn(SIDE, e => e.split('ab', 0.25, 'm', 'p1', 'p2'))
    d.views().forEach((k, i) => {
      const old = before[i] as { ha: Vec; hb: Vec }, a = at(d, k, 'a')!, b = at(d, k, 'b')!, m = at(d, k, 'm')!
      // the new point lies on that view's own curve at t = 0.25
      const c = [a, { x: a.x + old.ha.x, y: a.y + old.ha.y }, { x: b.x + old.hb.x, y: b.y + old.hb.y }, b]
      const t = 0.25, u = 1 - t
      const x = u ** 3 * c[0]!.x + 3 * u * u * t * c[1]!.x + 3 * u * t * t * c[2]!.x + t ** 3 * c[3]!.x
      const y = u ** 3 * c[0]!.y + 3 * u * u * t * c[1]!.y + 3 * u * t * t * c[2]!.y + t ** 3 * c[3]!.y
      expect(m.x).toBeCloseTo(x, 9); expect(m.y).toBeCloseTo(y, 9)
    })
  })

  it('unbind in a side view: the offset follows the side view\'s own tangent, and every view gets that same offset (dot 1791652671)', () => {
    const d = doc()
    d.edit(e => e.line('bc', 'b', { id: 'c', layer: 'L', position: P(20) }))
    // in the side view bc leaves b straight up; in the front it leaves to the right
    d.editIn(SIDE, e => { e.move([{ id: 'c', target: P(10, 30) }]); e.moveHandle('bc', 'a', P(0, 10)) })
    d.editIn(SIDE, e => e.unbind('b', ['bc'], 'b2'))
    const off = (k: string) => { const p = at(d, k, 'b2')!, q = at(d, k, 'b')!; return { x: p.x - q.x, y: p.y - q.y } }
    expect(off(SIDE).x).toBeCloseTo(0, 12)
    expect(off(SIDE).y).toBeGreaterThan(0)
    for (const k of d.views()) { expect(off(k).x).toBeCloseTo(off(SIDE).x, 12); expect(off(k).y).toBeCloseTo(off(SIDE).y, 12) }
  })
})

describe('auto-bind is judged in the edited view only (Q2)', () => {
  it('a coincidence made in a view nobody edited stays two points, through save and open', () => {
    const d = doc()
    d.editIn(SIDE, e => e.move([{ id: 'b', target: P(50, 50) }]))
    // drawn in the front at (50,50): apart from b there, but on b in the side view
    d.edit(e => e.line('cd', { id: 'c', layer: 'L', position: P(50, 50) }, { id: 'd', layer: 'L', position: P(60, 60) }))
    expect(at(d, SIDE, 'c')).toEqual(at(d, SIDE, 'b'))
    expect(d.in(SIDE).snapshot().points.map(p => p.id).sort()).toEqual(['a', 'b', 'c', 'd'])
    const again = open(save(d))
    expect(again.in(SIDE).snapshot().points.map(p => p.id).sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('a coincidence made in the edited view binds, in every view', () => {
    const d = doc()
    d.edit(e => e.line('cd', { id: 'c', layer: 'L', position: P(50, 50) }, { id: 'd', layer: 'L', position: P(60, 60) }))
    d.editIn(SIDE, e => e.move([{ id: 'c', target: P(10) }]))
    for (const k of d.views()) expect(d.in(k).snapshot().points.map(p => p.id).sort()).toEqual(['a', 'b', 'd'])
    expect(lineIn(d, FRONT, 'cd')!.a).toBe('b')
  })
})

describe('one undo step; refused edits write no layer', () => {
  it('undo restores every view at once', () => {
    const d = doc(), before = all(d)
    d.editIn(SIDE, e => { e.move([{ id: 'a', target: P(-5, 5) }]); e.split('ab', 0.5, 'm', 'p1', 'p2'); e.line('mx', 'm', { id: 'x', layer: 'L', position: P(5, 20) }) })
    d.undo()
    expect(all(d)).toBe(before)
  })

  it('a locked line is protected in every view; a refused edit in a side view changes nothing anywhere', () => {
    const d = doc()
    d.edit(e => e.lineState('ab', { locked: true }))
    const before = all(d)
    expect(() => d.editIn(SIDE, e => e.move([{ id: 'b', target: P(3, 3) }]))).toThrow(/Locked lines would change \(ab\)/)
    expect(all(d)).toBe(before)
  })
})

describe('shared constraints settle in every view', () => {
  it('a smooth join set in the front lines up the handles at that point in every view', () => {
    const d = doc()
    d.edit(e => e.line('bc', 'b', { id: 'c', layer: 'L', position: P(20) }))
    d.editIn(UP, e => { e.move([{ id: 'c', target: P(15, 10) }]); e.moveHandle('bc', 'a', P(3, 4)) })
    d.edit(e => e.join('b', 'ab', 'bc', { mode: 'smooth' }))
    for (const k of d.views()) {
      const ab = lineIn(d, k, 'ab')!, bc = lineIn(d, k, 'bc')!
      const cross = ab.hb.x * bc.ha.y - ab.hb.y * bc.ha.x
      expect(Math.abs(cross)).toBeLessThan(1e-6)
      expect(ab.hb.x * bc.ha.x + ab.hb.y * bc.ha.y).toBeLessThan(0) // opposite directions: a smooth pass
    }
  })

  it('linking moves the second point onto the first in every view', () => {
    const d = doc()
    d.edit(e => { e.layer('M', 'M'); e.line('qr', { id: 'q', layer: 'M', position: P(0, 20) }, { id: 'r', layer: 'M', position: P(10, 20) }) })
    d.editIn(SIDE, e => e.move([{ id: 'a', target: P(-7, 3) }]))
    d.edit(e => e.link('a', 'q'))
    for (const k of d.views()) expect(at(d, k, 'q')).toEqual(at(d, k, 'a'))
    expect(at(d, SIDE, 'q')).toEqual(P(-7, 3))
  })
})

describe('mirror links act at 0,0 only', () => {
  function mirrored() {
    const d = new Core({ axis: 0 })
    d.edit(e => {
      e.layer('L', 'L')
      e.line('l', { id: 'p', layer: 'L', position: P(-20, 0) }, { id: 'q', layer: 'L', position: P(-10, 5) })
      e.line('r', { id: 's', layer: 'L', position: P(20, 0) }, { id: 't', layer: 'L', position: P(10, 5) })
    })
    const gl = d.snapshot().groups.find(g => g.lines.includes('l'))!.id, gr = d.snapshot().groups.find(g => g.lines.includes('r'))!.id
    d.edit(e => e.mirrorLink([gl], [gr]))
    return d
  }

  it('in a side view a geometric edit does not mirror; structural or paired edits are refused', () => {
    const d = mirrored()
    d.editIn(SIDE, e => e.move([{ id: 'p', target: P(-30, 9) }]))
    expect(at(d, SIDE, 's')).toEqual(P(20, 0))
    const before = all(d)
    expect(() => d.editIn(SIDE, e => e.split('l', 0.5, 'm', 'x1', 'x2'))).toThrow(/mirror-front-only/)
    expect(() => d.editIn(SIDE, e => e.lineStroke('l', { width: 3, profile: 'uniform' }))).toThrow(/mirror-front-only/)
    expect(() => d.editIn(SIDE, e => e.mirrorApply(['l'], ['r']))).toThrow(/mirror-front-only/)
    expect(() => d.editIn(SIDE, e => e.unmirror(['l']))).toThrow(/mirror-front-only/)
    expect(all(d)).toBe(before)
    // in the front the same split runs paired, as before
    d.edit(e => e.split('l', 0.5, 'm', 'x1', 'x2'))
    expect(d.snapshot().lines.map(l => l.id).sort()).toHaveLength(4)
  })

  it('an auto-bind in a side view that would change a mirror-linked line is refused', () => {
    const d = mirrored()
    d.edit(e => e.line('u', { id: 'u1', layer: 'L', position: P(0, 40) }, { id: 'u2', layer: 'L', position: P(5, 40) }))
    const before = all(d)
    expect(() => d.editIn(SIDE, e => e.move([{ id: 'u1', target: at(d, SIDE, 'q')! }]))).toThrow(/mirror-front-only/)
    expect(all(d)).toBe(before)
  })
})

describe('arc radii and end strokes are still shared storage (dot 1791653388)', () => {
  it('setting them from a side view is refused and writes nothing; from the front it works; other join modes are shared and allowed', () => {
    const d = doc()
    d.edit(e => e.line('bc', 'b', { id: 'c', layer: 'L', position: P(20, 10) }))
    const before = all(d)
    expect(() => d.editIn(SIDE, e => e.join('b', 'ab', 'bc', { mode: 'arc', radius: 2 }))).toThrow(/per-view-storage-pending/)
    expect(() => d.editIn(SIDE, e => e.endStroke('a', { taper: 1 }))).toThrow(/per-view-storage-pending/)
    expect(all(d)).toBe(before)
    d.editIn(SIDE, e => e.join('b', 'ab', 'bc', { mode: 'cusp' }))
    d.edit(e => { e.join('b', 'ab', 'bc', { mode: 'arc', radius: 2 }); e.endStroke('a', { taper: 1 }) })
    expect(d.snapshot().joins.find(r => r.point === 'b')!.mode).toBe('arc')
  })
})

describe('the trial reads of an edit are settled in every view (dot 1791653958)', () => {
  it('1. a smooth join then a split in one front edit: every view splits its settled curve', () => {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => { e.line('ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(10) }); e.line('bc', 'b', { id: 'c', layer: 'L', position: P(10, 10) }) })
    d.edit(e => { e.join('b', 'ab', 'bc', { mode: 'smooth' }); e.split('bc', 0.5, 'm', 'p1', 'p2') })
    const front = at(d, FRONT, 'm')!
    expect(front.x).toBeCloseTo(11.25, 9); expect(front.y).toBeCloseTo(3.75, 9)
    for (const k of d.views()) { expect(at(d, k, 'm')!.x).toBeCloseTo(front.x, 9); expect(at(d, k, 'm')!.y).toBeCloseTo(front.y, 9) }
  })

  it('2. two links in one edit: the second reads the first one\'s settled result in every view', () => {
    const d = Core.newDocument({ layer: { id: 'A', name: 'A' } })
    d.edit(e => {
      e.layer('B', 'B'); e.layer('X', 'X'); e.layer('C', 'C')
      e.line('a1', { id: 'a', layer: 'A', position: P(0) }, { id: 'a2', layer: 'A', position: P(0, 30) })
      e.line('b1', { id: 'b', layer: 'B', position: P(0, 1) }, { id: 'b2', layer: 'B', position: P(0, 40) })
      e.line('x1', { id: 'x', layer: 'X', position: P(10) }, { id: 'x2', layer: 'X', position: P(10, 50) })
      e.line('c1', { id: 'c', layer: 'C', position: P(20) }, { id: 'c2', layer: 'C', position: P(20, 60) })
    })
    d.edit(e => e.link('a', 'b'))
    d.edit(e => { e.link('x', 'a'); e.link('b', 'c') })
    for (const k of d.views()) for (const id of ['a', 'b', 'c', 'x']) expect(at(d, k, id)).toEqual(P(10))
  })

  it('3. a locked line pasted in a side view is protected in that view for the rest of the edit', () => {
    const d = doc()
    d.edit(e => e.lineState('ab', { locked: true }))
    const clip = d.copy(['ab'])
    expect(() => d.editIn(SIDE, e => { e.paste(clip, 'L', P(0, 50), 'p'); e.move([{ id: 'p/a', target: P(-9, 99) }]) })).toThrow(/Locked lines would change \(p\/ab\)/)
  })
})

describe('open checks every view', () => {
  it('a file whose linked points are apart in a side view is refused', () => {
    const d = doc()
    d.edit(e => { e.layer('M', 'M'); e.line('qr', { id: 'q', layer: 'M', position: P(0, 20) }, { id: 'r', layer: 'M', position: P(10, 20) }) })
    d.edit(e => e.link('a', 'q'))
    const f = JSON.parse(save(d))
    const side = f.document.network.shapes.layers.find((l: { key: string }) => l.key === SIDE)
    side.points.q = { x: 3, y: 3 }
    expect(() => open(JSON.stringify(f))).toThrow(/linked points .* are apart in view:90,0/)
    expect(() => open(save(d))).not.toThrow()
  })
})
