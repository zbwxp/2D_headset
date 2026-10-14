// Handle follow and Straight (docs/handle-follow-checklist.md §3): a move's lines keep their shape along their chords;
// S puts a line's handles on its chord at 1/3 and 2/3.
import { describe, it, expect } from 'vitest'
import { Core, type Vec } from '../../src'
import { createInteraction } from '../index'

const P = (x: number, y: number): Vec => ({ x, y })
/** Triangle a(0,0) b(100,0) c(50,80), every line bent. */
function setup() {
  const d = new Core()
  d.edit(e => {
    e.layer('L')
    e.line('ab', { id: 'a', layer: 'L', position: P(0, 0) }, { id: 'b', layer: 'L', position: P(100, 0) }, { ha: P(30, -20), hb: P(-30, -20) })
    e.line('bc', 'b', { id: 'c', layer: 'L', position: P(50, 80) }, { ha: P(0, 30), hb: P(25, -5) })
    e.line('ca', 'c', 'a', { ha: P(-30, 0), hb: P(10, 30) })
  })
  let n = 0
  const ix = createInteraction({ view: () => 'view:0,0', core: () => d, newId: p => `${p}${++n}`, layer: () => 'L', layers: () => ['L'], pixel: () => 0.3 })
  const line = (id: string) => d.snapshot().lines.find(l => l.id === id)!
  const drag = (from: Vec, to: Vec) => { ix.pointerDown(from); ix.pointerMove(to); ix.pointerUp(to) }
  return { d, ix, line, drag }
}
/** z · h for z = new chord / old chord (complex): rotation and length ratio. */
function follow(oldChord: Vec, newChord: Vec, h: Vec): Vec {
  const den = oldChord.x * oldChord.x + oldChord.y * oldChord.y
  const zr = (newChord.x * oldChord.x + newChord.y * oldChord.y) / den, zi = (newChord.y * oldChord.x - newChord.x * oldChord.y) / den
  return { x: zr * h.x - zi * h.y, y: zr * h.y + zi * h.x }
}
const close = (a: Vec, b: Vec) => { expect(a.x).toBeCloseTo(b.x, 9); expect(a.y).toBeCloseTo(b.y, 9) }

describe('handle follow', () => {
  it('a corner dragged with A: its two lines keep their shape along their chords, the third line is untouched, one undo step', () => {
    const t = setup(), before = { ab: t.line('ab'), bc: t.line('bc'), ca: t.line('ca') }
    t.ix.setTool('A'); t.drag(P(0, 0), P(10, 20))
    close(t.line('ab').ha, follow(P(100, 0), P(90, -20), before.ab.ha))
    close(t.line('ab').hb, follow(P(100, 0), P(90, -20), before.ab.hb))
    close(t.line('ca').ha, follow(P(-50, -80), P(-40, -60), before.ca.ha))
    close(t.line('ca').hb, follow(P(-50, -80), P(-40, -60), before.ca.hb))
    expect([t.line('bc').ha, t.line('bc').hb]).toEqual([before.bc.ha, before.bc.hb])
    t.d.undo()
    expect([t.line('ab'), t.line('ca')]).toEqual([before.ab, before.ca])
  })

  it('both ends of a line moved together: that line unchanged, the other two follow', () => {
    const t = setup(), ab0 = t.line('ab'), bc0 = t.line('bc')
    t.ix.setTool('A')
    t.d.edit(e => e.select([{ kind: 'point', id: 'a' }, { kind: 'point', id: 'b' }]))
    t.drag(P(0, 0), P(0, 10))
    expect([t.line('ab').ha, t.line('ab').hb]).toEqual([ab0.ha, ab0.hb])
    close(t.line('bc').ha, follow(P(-50, 80), P(-50, 70), bc0.ha))
  })

  it('switched off: the handles stay as they were (today\'s behaviour)', () => {
    const t = setup(), ab0 = t.line('ab')
    t.ix.setOptions({ follow: false }); t.ix.setTool('A'); t.drag(P(0, 0), P(10, 20))
    expect([t.line('ab').ha, t.line('ab').hb]).toEqual([ab0.ha, ab0.hb])
  })

  it('a handle the move takes moves with it as today; an arrow nudge follows too', () => {
    const t = setup(), ab0 = t.line('ab')
    t.ix.setTool('A')
    t.d.edit(e => e.select([{ kind: 'point', id: 'a' }, { kind: 'handle', line: 'ab', end: 'a' }]))
    t.ix.key('ArrowRight', { shift: true }); t.ix.keyUp('ArrowRight')
    expect(t.d.snapshot().points.find(p => p.id === 'a')!.position).toEqual(P(10, 0))
    expect(t.line('ab').ha).toEqual(ab0.ha) // taken by the move: offset kept
    close(t.line('ab').hb, follow(P(100, 0), P(90, 0), ab0.hb))
  })

  it('a smooth join stays smooth: the two ends there turn together', () => {
    const t = setup()
    t.d.edit(e => e.join('a', 'ab', 'ca', { mode: 'smooth' }))
    t.ix.setTool('A'); t.drag(P(100, 0), P(130, 40)) // b: ab turns, ca does not move; the join at a sees one turning line
    t.drag(P(50, 80), P(20, 90)) // c: both bc and ca turn; a's join has ab (still) and ca (turning)
    const ha = t.line('ab').ha, hb = t.line('ca').hb
    expect(Math.abs(ha.x * hb.y - ha.y * hb.x)).toBeLessThan(1e-6) // collinear
    expect(ha.x * hb.x + ha.y * hb.y).toBeLessThan(0) // opposite
  })

  it('the drag preview carries the same handle offsets the release writes', () => {
    const t = setup()
    t.ix.setTool('A'); t.ix.pointerDown(P(0, 0)); t.ix.pointerMove(P(10, 20))
    const shown = t.ix.preview().drag!.handles
    t.ix.pointerUp(P(10, 20))
    for (const h of shown) close((h.end === 'a' ? t.line(h.line).ha : t.line(h.line).hb), h.offset)
    expect(shown.map(h => `${h.line}:${h.end}`).sort()).toEqual(['ab:a', 'ab:b', 'ca:a', 'ca:b'])
  })
})

describe('Straight (S)', () => {
  it('the selected lines: handles on the chord at 1/3 and 2/3, one undo step', () => {
    const t = setup()
    t.d.edit(e => e.select([{ kind: 'line', id: 'ab' }, { kind: 'line', id: 'bc' }]))
    t.ix.setTool('V'); t.ix.key('s')
    expect([t.line('ab').ha, t.line('ab').hb]).toEqual([P(100 / 3, 0), P(-100 / 3, -0)])
    close(t.line('bc').ha, P(-50 / 3, 80 / 3)); close(t.line('bc').hb, P(50 / 3, -80 / 3))
    t.d.undo()
    expect(t.line('ab').ha).toEqual(P(30, -20))
  })

  it('nothing selected: the message, nothing written; S no longer picks Split', () => {
    const t = setup(), before = JSON.stringify(t.d.snapshot().lines)
    t.ix.setTool('V'); t.ix.key('s')
    expect(t.ix.preview().refusal?.code).toBe('straight-select-lines')
    expect(t.ix.tool).toBe('V')
    expect(JSON.stringify(t.d.snapshot().lines)).toBe(before)
  })
})
