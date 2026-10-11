// Core's preview and selectionBounds (docs/selection-box-plan.md §1, §3; dot 1791735216, 1791735431): the very
// pipeline of editIn on a copy, read only, with editIn's guarantees and an independent result; the exact
// bounds of what is selected, explicit handle tips only.
import { describe, it, expect } from 'vitest'
import { Core, save, open, type Vec } from '../src'

const P = (x: number, y = 0): Vec => ({ x, y })
const V = 'view:0,0'
/** Triangles l (l1 l2 l3, an arc join at B1, filled) and r (r1 r2 r3); la–lb linked at P2–P3 with a smooth link join. */
function scene() {
  const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
  const at = (id: string, layer: string, x: number, y = 0) => ({ id, layer, position: P(x, y) })
  d.edit(e => {
    e.layer('M', 'M')
    e.line('l1', at('A1', 'L', -30), at('B1', 'L', -20)); e.line('l2', 'B1', at('C1', 'L', -25, 10)); e.line('l3', 'C1', 'A1')
    e.line('r1', at('A2', 'L', 30), at('B2', 'L', 20)); e.line('r2', 'B2', at('C2', 'L', 25, 10)); e.line('r3', 'C2', 'A2')
    e.line('la', at('P1', 'L', -60, -20), at('P2', 'L', -50, -20)); e.line('lb', at('P3', 'M', -50, -20), at('P4', 'M', -40, -20))
  })
  d.edit(e => e.join('B1', 'l1', 'l2', { mode: 'arc', radius: 2 }))
  d.edit(e => e.fill(d.snapshot().loops.find(l => l.route.some(u => u.line === 'l1'))!.id, '#0a0'))
  d.edit(e => e.link('P2', 'P3'))
  d.edit(e => e.linkJoin('P2', 'P3', 'la', 'lb', { mode: 'smooth' }))
  return d
}
const copy = (d: Core) => open(save(d))
const drawn = (r: { snapshot(): unknown; geometry(): unknown }) => JSON.stringify({ s: r.snapshot(), g: r.geometry() })
/** The document and what undo and redo would give from it — restored afterwards. */
function history(d: Core) {
  const now = save(d), can = [d.canUndo, d.canRedo]
  let undone = '', redone = ''
  if (d.canUndo) { d.undo(); undone = save(d); d.redo() }
  if (d.canRedo) { d.redo(); redone = save(d); d.undo() }
  return JSON.stringify({ now, can, undone, redone })
}

describe('preview: what editIn would publish', () => {
  const cases: [string, (e: import('../src').Editor) => void][] = [
    ['an end point alone, scaled: its neighbouring curves and the arc join follow', e => e.scale(P(-25, 5), 1.5, 1.5, [{ kind: 'point', id: 'B1' }])],
    ['a linked point moved: its partner follows', e => e.translate(3, 4, [{ kind: 'point', id: 'P2' }])],
    ['a curve rotated across a smooth link join', e => e.rotate(P(-50, -20), 0.4, [{ kind: 'line', id: 'la' }])],
    ['the filled triangle scaled about a corner, one axis', e => e.scale(P(-30, 0), 1.8, 1, [{ kind: 'line', id: 'l1' }, { kind: 'line', id: 'l2' }, { kind: 'line', id: 'l3' }])],
  ]
  for (const [name, op] of cases) it(name, () => {
    const d = scene(), a = copy(d), b = copy(d)
    const r = a.preview(V, op)!
    b.editIn(V, op)
    expect(drawn(r)).toBe(drawn(b.in(V)))
    expect(drawn(r)).not.toBe(drawn(a.in(V))) // it did change something
  })
})

describe('preview is read only, with editIn\'s guarantees', () => {
  function withHistory() {
    const d = scene()
    d.edit(e => e.translate(1, 0, [{ kind: 'line', id: 'r1' }]))
    d.edit(e => e.translate(0, 1, [{ kind: 'line', id: 'r2' }]))
    d.undo() // a redo is waiting
    return d
  }
  it('after a success, a cancel and a failure: the document, can-undo / can-redo and what undo and redo give are unchanged', () => {
    const d = withHistory(), before = history(d)
    expect(d.preview(V, e => e.translate(5, 5, [{ kind: 'line', id: 'l1' }]))).not.toBeNull()
    expect(history(d)).toBe(before)
    expect(d.preview(V, e => { e.translate(5, 5, [{ kind: 'line', id: 'l1' }]); e.cancel() })).toBeNull()
    expect(history(d)).toBe(before)
    expect(() => d.preview(V, e => e.translate(5, 5, [{ kind: 'line', id: 'nope' }]))).toThrow()
    expect(history(d)).toBe(before)
  })
  it('an async callback is refused; a nested write into the original is refused; a kept Editor cannot write; a caught error still fails it', async () => {
    const d = withHistory(), before = history(d)
    expect(() => d.preview(V, (async () => {}) as never)).toThrow(/synchronous/)
    expect(() => d.preview(V, () => d.edit(e => e.translate(1, 1, [{ kind: 'line', id: 'l1' }])))).toThrow(/in progress/)
    expect(() => d.preview(V, () => { d.preview(V, () => {}) })).toThrow(/in progress/)
    let kept: import('../src').Editor | undefined
    d.preview(V, e => { kept = e })
    expect(() => kept!.translate(9, 9, [{ kind: 'line', id: 'l1' }])).toThrow()
    expect(() => d.preview(V, e => { try { e.translate(1, 1, [{ kind: 'line', id: 'nope' }]) } catch { /* caught */ } })).toThrow(/failed/)
    expect(history(d)).toBe(before)
  })
  it('a failure never returns an earlier success: it throws', () => {
    const d = scene()
    const ok = d.preview(V, e => e.translate(5, 0, [{ kind: 'line', id: 'l1' }]))
    expect(ok).not.toBeNull()
    let got: unknown = 'none'
    expect(() => { got = d.preview(V, e => e.translate(5, 0, [{ kind: 'line', id: 'gone' }])) }).toThrow()
    expect(got).toBe('none')
  })
  it('the result is its own: changing a returned snapshot changes nothing; a later edit of the document leaves it as it was', () => {
    const d = scene(), r = d.preview(V, e => e.translate(5, 0, [{ kind: 'line', id: 'l1' }]))!
    const shown = drawn(r), doc = save(d)
    ;(r.snapshot().points[0] as { position: Vec }).position = P(999, 999)
    expect([drawn(r), save(d)]).toEqual([shown, doc])
    d.edit(e => e.translate(0, 7, [{ kind: 'line', id: 'l1' }]))
    expect(drawn(r)).toBe(shown)
  })
})

describe('selectionBounds: exactly what is selected', () => {
  function bent() {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    // handles reaching 100 up from both ends: the curve itself reaches 75 (0.75 of the handles)
    d.edit(e => e.line('arc', { id: 'a', layer: 'L', position: P(0, 0) }, { id: 'b', layer: 'L', position: P(100, 0) }, { ha: P(0, -100), hb: P(0, -100) }))
    d.edit(e => e.line('flat', { id: 'c', layer: 'L', position: P(200, 0) }, { id: 'f', layer: 'L', position: P(300, 0) }))
    return d
  }
  it('a line by its curve\'s exact extremes, not its control points; its own handles do not count', () => {
    const b = bent().in(V).selectionBounds([{ kind: 'line', id: 'arc' }])!
    expect(b.min.x).toBeCloseTo(0, 9); expect(b.max.x).toBeCloseTo(100, 9)
    expect(b.min.y).toBeCloseTo(-75, 9); expect(b.max.y).toBeCloseTo(0, 9)
  })
  it('a handle selected explicitly counts by its tip; a point by its position; units naming nothing are skipped; nothing → null', () => {
    const r = bent().in(V)
    const b = r.selectionBounds([{ kind: 'line', id: 'arc' }, { kind: 'handle', line: 'arc', end: 'a' }, { kind: 'point', id: 'f' }, { kind: 'line', id: 'gone' }])!
    expect([b.min.y, b.max.x]).toEqual([-100, 300])
    expect([r.selectionBounds([]), r.selectionBounds([{ kind: 'point', id: 'gone' }])]).toEqual([null, null])
  })
  it('a hidden selected line counts; a fill counts by its loop\'s curves; nothing grows into the whole curve', () => {
    const d = scene()
    d.edit(e => e.lineState('l3', { visible: false }))
    const r = d.in(V)
    expect(r.selectionBounds([{ kind: 'line', id: 'l3' }])).not.toBeNull()
    const fill = d.snapshot().loops.find(l => l.route.some(u => u.line === 'l1'))!.id
    const all = r.selectionBounds([{ kind: 'fill', id: fill }])!, one = r.selectionBounds([{ kind: 'line', id: 'l1' }])!
    expect(all.max.y).toBeGreaterThan(one.max.y) // the loop reaches C1's height; l1 alone does not
  })
})
