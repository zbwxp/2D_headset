// Stage 2, package 3 (docs/stage2-plan.md rule 6; dot 1791681179): the diagonal draft. Each
// corner view of the chosen lines = front + (yaw view − front) + (pitch view − front); only
// the four corners change; the baseline is untouched; it stands alone in its edit.
import { describe, it, expect } from 'vitest'
import { Core, save, type Vec } from '../src'

const P = (x: number, y = 0): Vec => ({ x, y })
const FRONT = 'view:0,0'
const at = (d: Core, k: string, id: string) => d.in(k).snapshot().points.find(p => p.id === id)!.position
const lineIn = (d: Core, k: string, id: string) => d.in(k).snapshot().lines.find(l => l.id === id)!
const base = (d: Core) => JSON.stringify((JSON.parse(save(d)).document.network.shapes.layers as { key: string }[]).find(l => l.key === 'base:angle'))
const sel = (...ids: string[]) => ids.map(id => ({ kind: 'line' as const, id }))
const CORNERS = [['view:-90,-45', 'view:-90,0', 'view:0,-45'], ['view:-90,45', 'view:-90,0', 'view:0,45'], ['view:90,-45', 'view:90,0', 'view:0,-45'], ['view:90,45', 'view:90,0', 'view:0,45']] as const

/** ab in L; the yaw and pitch views adjusted by hand. */
function doc() {
  const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
  d.edit(e => e.line('ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(10) }))
  d.editIn('view:90,0', e => { e.move([{ id: 'b', target: P(6, 0) }]); e.moveHandle('ab', 'a', P(1, 2)) })
  d.editIn('view:-90,0', e => e.move([{ id: 'b', target: P(14, 0) }]))
  d.editIn('view:0,45', e => e.move([{ id: 'b', target: P(10, -3) }]))
  d.editIn('view:0,-45', e => e.move([{ id: 'b', target: P(10, 4) }]))
  return d
}

describe('diagonal draft', () => {
  it('each corner = front + yaw change + pitch change, per point and per handle vector; other views and the baseline stay', () => {
    const d = doc()
    const others = d.views().filter(k => !CORNERS.some(c => c[0] === k)).map(k => JSON.stringify(d.in(k).snapshot()))
    const b0 = base(d)
    d.edit(e => e.draftCorners(sel('ab')))
    for (const [c, y, p] of CORNERS) {
      const f = at(d, FRONT, 'b'), yb = at(d, y, 'b'), pb = at(d, p, 'b')
      expect(at(d, c, 'b')).toEqual({ x: f.x + (yb.x - f.x) + (pb.x - f.x), y: f.y + (yb.y - f.y) + (pb.y - f.y) })
      const fh = lineIn(d, FRONT, 'ab').ha, yh = lineIn(d, y, 'ab').ha, ph = lineIn(d, p, 'ab').ha
      const h = lineIn(d, c, 'ab').ha
      expect(h.x).toBeCloseTo(fh.x + (yh.x - fh.x) + (ph.x - fh.x), 12); expect(h.y).toBeCloseTo(fh.y + (yh.y - fh.y) + (ph.y - fh.y), 12)
    }
    expect(at(d, 'view:90,45', 'b')).toEqual(P(6, -3))
    expect(d.views().filter(k => !CORNERS.some(c => c[0] === k)).map(k => JSON.stringify(d.in(k).snapshot()))).toEqual(others)
    expect(base(d)).toBe(b0)
  })

  it('stands alone in its edit; a locked line refuses it; with nothing chosen it is refused', () => {
    const d = doc()
    expect(() => d.edit(e => { e.move([{ id: 'a', target: P(1, 1) }]); e.draftCorners(sel('ab')) })).toThrow(/stage2-alone/)
    expect(() => d.edit(e => { e.draftCorners(sel('ab')); e.broadcastShape(sel('ab')) })).toThrow(/stage2-alone/)
    expect(() => d.edit(e => e.draftCorners())).toThrow(/select-lines-to-draft/)
    d.edit(e => e.lineState('ab', { locked: true }))
    expect(() => d.edit(e => e.draftCorners(sel('ab')))).toThrow(/Locked lines would change \(ab\)/)
  })

  it('a second draft writes nothing and adds no undo step; one undo restores the corners', () => {
    const d = doc()
    const before = JSON.stringify(d.views().map(k => d.in(k).snapshot()))
    d.edit(e => e.draftCorners(sel('ab')))
    const once = JSON.stringify(d.views().map(k => d.in(k).snapshot()))
    let steps = 0; while (d.canUndo) { d.undo(); steps++ } ; for (let i = 0; i < steps; i++) d.redo()
    d.edit(e => e.draftCorners(sel('ab')))
    let after = 0; while (d.canUndo) { d.undo(); after++ } ; for (let i = 0; i < after; i++) d.redo()
    expect([after, JSON.stringify(d.views().map(k => d.in(k).snapshot()))]).toEqual([steps, once])
    d.undo()
    expect(JSON.stringify(d.views().map(k => d.in(k).snapshot()))).toBe(before)
  })

  it('two smooth lines drafted together: every chosen handle keeps the drafted value, and a repeat changes nothing (dot 1791681518)', () => {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => { e.line('ab', { id: 'a', layer: 'L', position: P(-10) }, { id: 'b', layer: 'L', position: P(0) }); e.line('bc', 'b', { id: 'c', layer: 'L', position: P(10) }) })
    d.edit(e => { e.moveHandle('ab', 'b', P(-1, 0)); e.moveHandle('bc', 'a', P(1, 0)) })
    d.edit(e => e.join('b', 'ab', 'bc', { mode: 'smooth' }))
    d.editIn('view:90,0', e => { e.moveHandle('bc', 'a', P(1, 1)); e.moveHandle('ab', 'b', P(-2, -2)) })
    d.editIn('view:0,45', e => { e.moveHandle('bc', 'a', P(1, -1)); e.moveHandle('ab', 'b', P(-3, 3)) })
    const corner = 'view:90,45'
    d.editIn(corner, e => { e.moveHandle('bc', 'a', P(1, 0)); e.moveHandle('ab', 'b', P(-1, 0)) }) // the corner starts as the front
    expect([lineIn(d, corner, 'bc').ha, lineIn(d, corner, 'ab').hb]).toEqual([P(1, 0), P(-1, 0)])
    d.edit(e => e.draftCorners(sel('ab', 'bc')))
    expect(lineIn(d, corner, 'bc').ha).toEqual(P(1, 0))
    expect(lineIn(d, corner, 'ab').hb).toEqual(P(-4, 1))
    const once = JSON.stringify(d.views().map(k => d.in(k).snapshot()))
    let steps = 0; while (d.canUndo) { d.undo(); steps++ } ; for (let i = 0; i < steps; i++) d.redo()
    for (let r = 0; r < 3; r++) d.edit(e => e.draftCorners(sel('ab', 'bc')))
    let after = 0; while (d.canUndo) { d.undo(); after++ } ; for (let i = 0; i < after; i++) d.redo()
    expect([after, JSON.stringify(d.views().map(k => d.in(k).snapshot()))]).toEqual([steps, once])
  })

  it('a corner already equal to the draft gets no write, so an unchosen non-aligned smooth neighbour there stays (dot 1791681518)', () => {
    const d = doc(), corner = 'view:90,45'
    d.edit(e => e.line('bc', 'b', { id: 'c', layer: 'L', position: P(20, 5) }))
    // the corner b where the draft puts it, and a non-aligned smooth join there (both handles held when set)
    d.editIn(corner, e => { e.move([{ id: 'b', target: P(6, -3) }]); e.join('b', 'ab', 'bc', { mode: 'smooth' }); e.moveHandle('ab', 'a', P(1, 2)); e.moveHandle('ab', 'b', P(-2, 5)); e.moveHandle('bc', 'a', P(4, 4)) })
    expect([lineIn(d, corner, 'ab').hb, lineIn(d, corner, 'bc').ha]).toEqual([P(-2, 5), P(4, 4)])
    for (const k of [FRONT, 'view:90,0', 'view:0,45']) d.editIn(k, e => e.moveHandle('ab', 'b', P(-2, 5)))
    const before = JSON.stringify(d.in(corner).snapshot())
    let steps = 0; while (d.canUndo) { d.undo(); steps++ } ; for (let i = 0; i < steps; i++) d.redo()
    d.edit(e => e.draftCorners(sel('ab')))
    expect(JSON.stringify(d.in(corner).snapshot())).toBe(before)
    expect(lineIn(d, corner, 'bc').ha).toEqual(P(4, 4))
    let after = 0; while (d.canUndo) { d.undo(); after++ } ; for (let i = 0; i < after; i++) d.redo()
    expect(after).toBe(steps + 1) // the other three corners did change
  })
})

