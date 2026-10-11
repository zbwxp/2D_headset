// The selection box (docs/selection-box-plan.md; bowen 1791733125, 1791734097; dot 1791735216, 1791735431,
// 1791735873): its handles, the press order, the formulas, preview = commit, one operation per drag.
import { describe, it, expect } from 'vitest'
import { Core, save, type Vec } from '../../src'
import { createInteraction } from '../index'
import { handlesOf, hitBox, opAt, startHandleDrag, BOX, type Bounds } from '../flows/selection-box'

const P = (x: number, y: number): Vec => ({ x, y })
const B = (x0: number, y0: number, x1: number, y1: number): Bounds => ({ min: P(x0, y0), max: P(x1, y1) })

describe('the box\'s maths', () => {
  it('handles: a full box has 4 corners, 4 edges and the rotation handle; zero height keeps only the left / right edges; zero width only top / bottom; a point none', () => {
    const ids = (b: Bounds) => handlesOf(b, 1).map(h => h.id).sort()
    expect(ids(B(0, 0, 100, 50))).toEqual(['e', 'n', 'ne', 'nw', 'rotate', 's', 'se', 'sw', 'w'])
    expect(ids(B(0, 0, 100, 0))).toEqual(['e', 'rotate', 'w'])
    expect(ids(B(0, 0, 0, 100))).toEqual(['n', 'rotate', 's'])
    expect(ids(B(5, 5, 5, 5))).toEqual([])
    expect(handlesOf(B(0, 0, 100, 50), 2).find(h => h.id === 'rotate')!.at).toEqual(P(50, -BOX.stem * 2))
  })
  it('hits: a handle within its reach, the inside with its margin — both in screen pixels, the same at any zoom', () => {
    for (const px of [0.5, 4]) {
      const b = B(0, 0, 100 * px, 50 * px)
      expect([px, hitBox(b, P(100 * px + 5 * px, 0), px), hitBox(b, P(50 * px, 25 * px), px), hitBox(b, P(-5 * px, 25 * px), px), hitBox(b, P(-9 * px, 25 * px), px)])
        .toEqual([px, 'ne', 'inside', 'w', null])
    }
  })
  it('a corner: s = ((H − A)·(H0 − A)) / |H0 − A|² about the opposite corner; Option about the centre; a press off the handle does not jump', () => {
    const b = B(0, 0, 100, 50)
    const d = startHandleDrag('se', b, P(103, 52), 1) // pressed 3, 2 off the corner
    expect(opAt(d, P(103, 52), {})).toEqual({ kind: 'scale', anchor: P(0, 0), sx: 1, sy: 1 })
    expect(opAt(d, P(203, 102), {})).toEqual({ kind: 'scale', anchor: P(0, 0), sx: 2, sy: 2 })
    expect(opAt(d, P(153, 77), { alt: true })).toEqual({ kind: 'scale', anchor: P(50, 25), sx: 2, sy: 2 })
  })
  it('an edge: one axis about the opposite edge; through the anchor it mirrors that axis; a corner through it turns 180° (both factors negative)', () => {
    const b = B(0, 0, 100, 50)
    expect(opAt(startHandleDrag('e', b, P(100, 25), 1), P(150, 99), {})).toEqual({ kind: 'scale', anchor: P(0, 25), sx: 1.5, sy: 1 })
    expect(opAt(startHandleDrag('n', b, P(50, 0), 1), P(0, -50), {})).toEqual({ kind: 'scale', anchor: P(50, 50), sx: 1, sy: 2 })
    expect(opAt(startHandleDrag('e', b, P(100, 25), 1), P(-50, 25), {})).toMatchObject({ sx: -0.5, sy: 1 })
    const turn = opAt(startHandleDrag('se', b, P(100, 50), 1), P(-100, -50), {}) as { sx: number; sy: number }
    expect([turn.sx, turn.sy]).toEqual([-1, -1])
  })
  it('near zero: held at one pixel of the box (both sides for a corner) with its sign; exactly 0 takes the last sign it had, + at the start', () => {
    const b = B(0, 0, 100, 50)
    const d = startHandleDrag('se', b, P(100, 50), 1)
    expect((opAt(d, P(0, 0), {}) as { sx: number }).sx).toBeCloseTo(1 / 50, 12) // 0 at the start: +, the narrower side's pixel
    expect((opAt(d, P(-10, -5), {}) as { sx: number }).sx).toBeCloseTo(-0.1, 12)
    expect((opAt(d, P(0, 0), {}) as { sx: number }).sx).toBeCloseTo(-1 / 50, 12) // 0 after a negative frame: −
    const e = startHandleDrag('e', b, P(100, 25), 1)
    expect((opAt(e, P(0.3, 25), {}) as { sx: number }).sx).toBeCloseTo(1 / 100, 12)
  })
  it('rotation: about the centre, continuous past ±180°, Shift in 15° steps, the last angle kept at the centre', () => {
    const b = B(-50, -50, 50, 50)
    const d = startHandleDrag('rotate', b, P(0, -50 - BOX.stem), 1)
    let op = opAt(d, P(80, 0), {}) as { angle: number }
    expect(op.angle).toBeCloseTo(Math.PI / 2, 9)
    op = opAt(d, P(0, 80), {}) as { angle: number }; op = opAt(d, P(-80, 0), {}) as { angle: number }; op = opAt(d, P(0, -80), {}) as { angle: number }
    op = opAt(d, P(80, 0), {}) as { angle: number }
    expect(op.angle).toBeCloseTo(2.5 * Math.PI, 9) // a full turn and a quarter: not wrapped back
    expect((opAt(d, P(0.2, 0.2), {}) as { angle: number }).angle).toBeCloseTo(2.5 * Math.PI, 9) // at the centre: kept
    const e = startHandleDrag('rotate', b, P(0, -80), 1)
    expect((opAt(e, P(Math.cos(-Math.PI / 2 + 0.3) * 80, Math.sin(-Math.PI / 2 + 0.3) * 80), { shift: true }) as { angle: number }).angle).toBeCloseTo(Math.PI / 12, 9)
  })
})

/** Curve h–v (L): (0,0)–(100,0)–(100,100); a line m (K) at y = 200. */
function setup(pixel = 0.3) {
  const d = new Core()
  d.edit(e => {
    e.layer('L'); e.layer('K')
    e.line('h', { id: 'a', layer: 'L', position: P(0, 0) }, { id: 'b', layer: 'L', position: P(100, 0) })
    e.line('v', 'b', { id: 'c', layer: 'L', position: P(100, 100) })
    e.line('m', { id: 'x', layer: 'K', position: P(0, 200) }, { id: 'y', layer: 'K', position: P(100, 200) })
  })
  let px = pixel
  const ix = createInteraction({ view: () => 'view:0,0', core: () => d, newId: p => `${p}${Math.random()}`, layer: () => 'L', layers: () => ['L', 'K'], pixel: () => px })
  const press = (at: Vec, mods = {}) => { ix.pointerDown(at, mods); ix.pointerUp(at, mods) }
  const drag = (from: Vec, to: Vec, mods = {}, release = true) => { ix.pointerDown(from, mods); ix.pointerMove(to, mods); if (release) ix.pointerUp(to, mods) }
  const pos = (id: string) => d.snapshot().points.find(p => p.id === id)!.position
  return { d, ix, press, drag, pos, setPixel: (p: number) => { px = p } }
}

describe('the box in interaction', () => {
  it('with V / A and a selection that transforms; not for the pen; a fill alone has none; a line with a far fill gets the line\'s box only', () => {
    const t = setup()
    t.ix.setTool('V'); t.press(P(50, 0))
    expect(t.ix.preview().selectionBox).toMatchObject({ min: P(0, 0), max: P(100, 100) })
    t.ix.setTool('pen')
    expect(t.ix.preview().selectionBox).toBeUndefined()
    const f = setup()
    f.d.edit(e => { e.line('q', { id: 'q1', layer: 'L', position: P(500, 500) }, { id: 'q2', layer: 'L', position: P(600, 500) }); e.line('q3', 'q2', { id: 'q4', layer: 'L', position: P(550, 600) }); e.line('q5', 'q4', 'q1') })
    f.d.edit(e => e.fill(f.d.snapshot().loops.find(l => l.route.some(u => u.line === 'q'))!.id, '#0a0'))
    const loop = f.d.snapshot().loops.find(l => l.filled && l.route.some(u => u.line === 'q'))!.id
    f.d.edit(e => e.select([{ kind: 'fill', id: loop }]))
    f.ix.setTool('V')
    expect(f.ix.preview().selectionBox).toBeUndefined()
    f.d.edit(e => e.select([{ kind: 'fill', id: loop }, { kind: 'line', id: 'h' }]))
    expect(f.ix.preview().selectionBox).toMatchObject({ min: P(0, 0), max: P(100, 0) })
  })

  it('a corner drag: one scale, previewed by core exactly as committed, nothing written before the release, one undo step', () => {
    const t = setup()
    t.ix.setTool('V'); t.press(P(50, 0))
    const before = save(t.d)
    t.drag(P(100, 100), P(150, 150), {}, false)
    const shown = t.ix.preview().transform!
    expect([save(t.d), shown.lines.map(l => l.id).sort()]).toEqual([before, ['h', 'v']])
    t.ix.pointerUp(P(150, 150))
    expect([t.pos('a'), t.pos('b'), t.pos('c')]).toEqual([P(0, 0), P(150, 0), P(150, 150)])
    expect(JSON.stringify(shown.lines.map(l => l.curve))).toBe(JSON.stringify(t.d.geometry().lines.filter(l => l.id !== 'm').map(l => l.curve)))
    t.d.undo()
    expect(save(t.d)).toBe(before)
  })

  it('Option is read live: pressed during the drag, the release about the centre decides', () => {
    const t = setup()
    t.ix.setTool('V'); t.press(P(50, 0))
    t.ix.pointerDown(P(100, 100), {}); t.ix.pointerMove(P(150, 150), {})
    t.ix.pointerUp(P(150, 150), { alt: true })
    expect([t.pos('a'), t.pos('c')]).toEqual([P(-50, -50), P(150, 150)])
  })

  it('A on an end point under a box handle edits the point; V on the same place takes the handle', () => {
    const t = setup()
    t.ix.setTool('A'); t.press(P(50, 0)) // the line h: its box (0,0)–(100,0) has its edge handles on a and b
    t.drag(P(100, 0), P(120, 10))
    expect([t.pos('b'), t.pos('a')]).toEqual([P(120, 10), P(0, 0)]) // the point moved, not a scale of h
    const v = setup()
    v.ix.setTool('V'); v.press(P(50, 0)) // the curve h–v: a corner at (100, 0)
    v.drag(P(100, 0), P(150, -50))
    expect(v.pos('c')).toEqual(P(150, 100)) // a corner scale about the opposite corner (0, 100) moved c too
  })

  it('the inside grabs the whole selection; Shift or Option there starts the marquee instead', () => {
    const t = setup()
    t.ix.setTool('V'); t.press(P(50, 0))
    t.drag(P(40, 60), P(50, 70)) // inside the box, on nothing
    expect([t.pos('a'), t.pos('c')]).toEqual([P(10, 10), P(110, 110)])
    t.ix.pointerDown(P(40, 60), { shift: true }); t.ix.pointerMove(P(45, 65), { shift: true })
    expect(t.ix.preview().box).toBeDefined()
    t.ix.pointerUp(P(45, 65), { shift: true })
    expect([t.pos('a'), t.pos('c')]).toEqual([P(10, 10), P(110, 110)])
  })

  it('Esc during a handle drag writes nothing and the late release writes nothing; undo during it waits', () => {
    const t = setup()
    t.ix.setTool('V'); t.press(P(50, 0))
    const before = save(t.d)
    t.drag(P(100, 100), P(150, 150), {}, false)
    t.ix.undo()
    expect(save(t.d)).toBe(before) // undo waits during a mouse drag
    t.ix.key('Escape')
    t.ix.pointerUp(P(150, 150))
    expect(save(t.d)).toBe(before)
  })

  it('hover: what the pointer is over, by the same rule as the press; it reports a change once', () => {
    const t = setup()
    t.ix.setTool('V'); t.press(P(50, 0))
    let calls = 0
    t.ix.subscribe(() => { calls++ })
    t.ix.pointerHover(P(101, 101)); t.ix.pointerHover(P(100.5, 100.5))
    expect([t.ix.preview().selectionBox!.hot, calls]).toEqual(['se', 1])
    t.ix.pointerHover(P(50, 50))
    expect(t.ix.preview().selectionBox!.hot).toBe('inside')
  })

  it('the rotation handle: one rotate about the box\'s centre; Shift in 15° steps', () => {
    const t = setup()
    t.ix.setTool('V'); t.press(P(50, 0))
    const top = t.ix.preview().selectionBox!.handles.find(h => h.id === 'rotate')!.at
    t.drag(top, P(50 + 200 * Math.sin(0.3), 50 - 200 * Math.cos(0.3)), { shift: true })
    const a = t.pos('a'), c = P(50, 50), r = Math.hypot(a.x - c.x, a.y - c.y)
    expect(Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(-50, -50)).toBeCloseTo(Math.PI / 12, 9)
    expect(r).toBeCloseTo(Math.hypot(50, 50), 9)
  })
})
