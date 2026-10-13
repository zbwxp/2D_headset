// Package 3 of the 四角 / 曲边 deform (docs/deform-p3-checklist.md §4): the tool's session on a real Core —
// start, the frame's controls, preview = commit, one undo step per release, no accumulated fit, Esc, reset,
// and the session's end (and no return).
import { describe, it, expect } from 'vitest'
import { Core, save, open, type Vec } from '../../src'
import { deformField, neutralBend, rectQuad, type Quad } from '../../deform'
import { createInteraction } from '../index'
import { deformOp, dragFrame, frameOf } from '../flows/deform'

const P = (x: number, y: number): Vec => ({ x, y })
const FRONT = 'view:0,0', SIDE = 'view:90,0'

function setup(select = true) {
  const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
  d.edit(e => {
    e.layer('M', 'M')
    e.line('ab', { id: 'a', layer: 'L', position: P(0, 0) }, { id: 'b', layer: 'L', position: P(50, 40) }, { ha: P(10, 20), hb: P(-15, 0) })
    e.line('bc', 'b', { id: 'c', layer: 'L', position: P(100, 20) }, { ha: P(15, 0), hb: P(-10, 15) })
    e.line('mn', { id: 'm', layer: 'M', position: P(0, 100) }, { id: 'n', layer: 'M', position: P(100, 100) })
  })
  if (select) d.edit(e => e.select([{ kind: 'line', id: 'ab' }, { kind: 'line', id: 'bc' }]))
  let view = FRONT
  const ix = createInteraction({ view: () => view, core: () => d, newId: p => `${p}${Math.random()}`, layer: () => 'L', layers: () => ['L', 'M'], pixel: () => 1 })
  const drag = (from: Vec, to: Vec, release = true) => { ix.pointerDown(from); ix.pointerMove(to); if (release) ix.pointerUp(to) }
  const frame = () => ix.preview().deform?.frame
  return { d, ix, drag, frame, setView: (k: string) => { view = k; ix.viewChanged() } }
}
const every = (d: Core) => JSON.stringify(d.views().map(k => d.in(k).snapshot()))
/** The drawing a single deform of the original curves to `quad` (and `bend`) gives, from a copy of `start`. */
function expected(start: string, rect: { min: Vec; max: Vec }, quad: Quad, bend = neutralBend()) {
  const c = open(start)
  c.edit(deformOp(c, FRONT, ['ab', 'bc'], rect, quad, bend).run)
  return c.snapshot()
}

describe('the deform tool (package 3)', () => {
  it('starts on the selected lines: the frame is their bounds, four corners, eight handles, four midpoints; nothing selected → a note, no frame', () => {
    const t = setup()
    t.ix.setTool('deform')
    const f = t.frame()!, b = t.d.in(FRONT).selectionBounds([{ kind: 'line', id: 'ab' }, { kind: 'line', id: 'bc' }])!
    expect(f.corners).toEqual(rectQuad(b))
    expect([f.corners.length, f.handles.length, f.midpoints.length, f.edges.length, f.grid.length]).toEqual([4, 8, 4, 4, 6])
    const u = setup(false)
    u.ix.setTool('deform')
    expect(u.frame()).toBeUndefined()
    expect(u.ix.preview().refusal?.code).toBe('deform-select-lines')
  })

  it('a corner drag: preview = commit, one undo step; the drawing equals one deform of the original curves', () => {
    const t = setup(), start = save(t.d)
    t.ix.setTool('deform')
    const rect = { min: t.frame()!.corners[0]!, max: t.frame()!.corners[2]! }, c2 = t.frame()!.corners[2]!
    t.drag(c2, P(c2.x + 12, c2.y + 7), false)
    const shown = t.ix.preview().deform!.lines!
    expect(t.ix.preview().deform!.dragging).toBe(true)
    expect(save(t.d)).toBe(start) // a preview writes nothing
    t.ix.pointerUp(P(c2.x + 12, c2.y + 7))
    const quad = rectQuad(rect).map((p, i) => (i === 2 ? P(c2.x + 12, c2.y + 7) : p)) as unknown as Quad
    expect(t.d.snapshot().points).toEqual(expected(start, rect, quad).points)
    expect(t.d.geometry().lines.filter(l => l.id !== 'mn').map(l => ({ id: l.id, curve: [...l.curve] }))).toEqual(shown)
    expect(t.frame()!.corners[2]).toEqual(P(c2.x + 12, c2.y + 7)) // the frame stays for the next drag
    t.ix.undo()
    expect(save(t.d)).toBe(start)
  })

  it('two releases are computed from the original curves: the same as one release straight to the final frame', () => {
    const t = setup(), start = save(t.d)
    t.ix.setTool('deform')
    const [c0, , c2] = t.frame()!.corners, rect = { min: c0!, max: c2! }
    t.drag(c2!, P(c2!.x + 10, c2!.y + 5))
    t.drag(c0!, P(c0!.x - 6, c0!.y + 3))
    const quad = rectQuad(rect).map((p, i) => (i === 2 ? P(c2!.x + 10, c2!.y + 5) : i === 0 ? P(c0!.x - 6, c0!.y + 3) : p)) as unknown as Quad
    expect(t.d.snapshot().points).toEqual(expected(start, rect, quad).points)
    const handles = (lines: { id: string; ha: Vec; hb: Vec }[]) => lines.filter(l => l.id !== 'mn').map(l => [l.id, l.ha, l.hb])
    expect(handles(t.d.snapshot().lines)).toEqual(handles(expected(start, rect, quad).lines))
  })

  it('an edge handle moves through the inverse homography; a midpoint moves both handles by 4/3, so the edge\'s middle follows the pointer', () => {
    const rect = { min: P(0, 0), max: P(100, 50) }, quad = rectQuad(rect), bend = neutralBend()
    const h = frameOf(rect, quad, bend).handles.find(x => x.edge === 2 && x.handle === 0)!
    const moved = dragFrame(rect, quad, bend, { edge: 2, handle: 0 }, h.at, P(h.at.x + 10, h.at.y + 5))
    expect(moved.bend.handles[2][0]).toEqual(P(bend.handles[2][0].x + 0.1, bend.handles[2][0].y + 0.1))
    const m = frameOf(rect, quad, bend).midpoints[2]!.at, to = P(m.x + 3, m.y + 8)
    const bent = dragFrame(rect, quad, bend, { edge: 2, handle: 2 }, m, to)
    const after = frameOf(rect, quad, bent.bend).midpoints[2]!.at
    expect(Math.hypot(after.x - to.x, after.y - to.y)).toBeLessThan(1e-9)
  })

  it('an invalid frame keeps the last valid one, with the refusal shown; a release then writes nothing', () => {
    const t = setup(), start = save(t.d)
    t.ix.setTool('deform')
    const [c0, , c2] = t.frame()!.corners
    t.drag(c0!, P(c2!.x + 5, c2!.y + 5), false) // corner 0 dragged past corner 2: crossed
    expect(t.frame()!.corners[0]).toEqual(c0)
    expect(t.ix.preview().refusal?.message).toMatch(/四角不能交叉或压扁/)
    t.ix.pointerUp(P(c2!.x + 5, c2!.y + 5))
    expect(save(t.d)).toBe(start)
  })

  it('Esc while dragging: the frame back where the drag began, nothing written, the session goes on; Esc again ends it', () => {
    const t = setup(), start = save(t.d)
    t.ix.setTool('deform')
    const c2 = t.frame()!.corners[2]!
    t.drag(c2, P(c2.x + 20, c2.y + 20), false)
    t.ix.key('Escape')
    expect([t.frame()!.corners[2], save(t.d), t.ix.preview().deform!.dragging]).toEqual([c2, start, false])
    t.ix.key('Escape')
    expect(t.frame()).toBeUndefined()
  })

  it('reset: the frame back to the rest rect and the original curves restored exactly, one undo step', () => {
    const t = setup(), start = t.d.snapshot()
    t.ix.setTool('deform')
    const c2 = t.frame()!.corners[2]!, rest = t.frame()!.corners
    t.drag(c2, P(c2.x + 15, c2.y - 4))
    const deformed = t.d.snapshot()
    t.ix.deformReset()
    expect(t.d.snapshot().points).toEqual(start.points)
    expect(t.d.snapshot().lines.map(l => [l.ha, l.hb])).toEqual(start.lines.map(l => [l.ha, l.hb]))
    expect(t.frame()!.corners).toEqual(rest)
    t.ix.undo()
    expect(t.d.snapshot().points).toEqual(deformed.points)
  })

  it('the session ends — and does not come back — on an undo, a panel edit, another drawing, another view and back, 完成, leaving the tool', () => {
    const ends: [string, (t: ReturnType<typeof setup>) => void][] = [
      ['undo', t => t.ix.undo()],
      ['a panel edit', t => { t.d.edit(e => e.renameLine('mn', 'x')); t.ix.outcome() }],
      ['another drawing', t => t.ix.drawingChanged()],
      ['another view and back', t => { t.setView(SIDE); t.setView(FRONT) }],
      ['完成', t => t.ix.deformDone()],
      ['the tool left and the view kept', t => { t.ix.setTool('V') }],
    ]
    for (const [name, end] of ends) {
      const t = setup()
      t.ix.setTool('deform')
      const c2 = t.frame()!.corners[2]!
      t.drag(c2, P(c2.x + 10, c2.y + 5))
      end(t)
      expect(t.frame(), name).toBeUndefined()
      // still in the tool: a press on the old corner takes nothing (with V it is V's own press)
      if (t.ix.tool === 'deform') expect(t.ix.pointerDown(P(c2.x + 10, c2.y + 5)), name).toBe(false)
    }
  })

  it('a change to its lines that interaction was not told of ends the session at the next look', () => {
    const t = setup()
    t.ix.setTool('deform')
    t.d.edit(e => e.move([{ id: 'c', target: P(110, 30) }])) // behind interaction's back
    expect(t.frame()).toBeUndefined()
  })

  it('choosing the tool again starts a new session from the drawing as it is', () => {
    const t = setup()
    t.ix.setTool('deform')
    const c2 = t.frame()!.corners[2]!
    t.drag(c2, P(c2.x + 30, c2.y + 30))
    t.ix.setTool('V'); t.ix.setTool('deform')
    const b = t.d.in(FRONT).selectionBounds([{ kind: 'line', id: 'ab' }, { kind: 'line', id: 'bc' }])!
    expect(t.frame()!.corners).toEqual(rectQuad(b))
  })

  it('a lock reached by the release: the preview shows the refusal and the release writes nothing', () => {
    const t = setup()
    t.d.edit(e => e.line('cx', 'c', { id: 'x', layer: 'L', position: P(120, 60) }))
    t.d.edit(e => e.lineState('cx', { locked: true }))
    t.d.edit(e => e.select([{ kind: 'line', id: 'ab' }, { kind: 'line', id: 'bc' }]))
    const start = save(t.d)
    t.ix.setTool('deform')
    const c2 = t.frame()!.corners[2]!
    t.drag(c2, P(c2.x + 10, c2.y + 5), false)
    expect(t.ix.preview().deform!.refused).toMatch(/Locked lines would change/)
    t.ix.pointerUp(P(c2.x + 10, c2.y + 5))
    expect(save(t.d)).toBe(start)
    expect(t.ix.preview().refusal?.code).toBe('deform-refused')
  })

  // dot 1791893524
  it('its own release binds an end onto another point: the session ends; no further drag or reset acts on void targets', () => {
    const t = setup()
    const rect = t.d.in(FRONT).selectionBounds([{ kind: 'line', id: 'ab' }, { kind: 'line', id: 'bc' }])!, c0 = rectQuad(rect)[0]
    // where a lands when corner 0 is dragged by (-7, 4): put another point of L exactly there first
    const quad = rectQuad(rect).map((p, i) => (i === 0 ? P(p.x - 7, p.y + 4) : p)) as unknown as Quad
    const land = deformField(rect, quad, neutralBend()).map(P(0, 0))
    t.d.edit(e => e.line('loose', { id: 'u', layer: 'L', position: P(-40, 80) }, { id: 'w', layer: 'L', position: land }))
    t.d.edit(e => e.select([{ kind: 'line', id: 'ab' }, { kind: 'line', id: 'bc' }]))
    t.ix.setTool('deform')
    t.drag(c0, P(c0.x - 7, c0.y + 4))
    expect(t.d.snapshot().lines.find(l => l.id === 'ab')!.a).not.toBe('a') // merged at commit
    expect(t.frame()).toBeUndefined()
    const after = save(t.d)
    t.ix.deformReset(); expect(t.ix.pointerDown(P(c0.x - 7, c0.y + 4))).toBe(false)
    expect(save(t.d)).toBe(after)
  })

  it('a reset under a link: a normal commit, the linked point following; the frame back on the rest rect', () => {
    const t = setup()
    t.d.edit(e => e.link('a', 'm'))
    t.d.edit(e => e.select([{ kind: 'line', id: 'ab' }, { kind: 'line', id: 'bc' }]))
    const before = t.d.snapshot().points.find(p => p.id === 'a')!.position
    t.ix.setTool('deform')
    const c0 = t.frame()!.corners[0]!, rest = t.frame()!.corners
    t.drag(c0, P(c0.x - 10, c0.y + 5))
    t.ix.deformReset()
    const at = (id: string) => t.d.snapshot().points.find(p => p.id === id)!.position
    expect([at('a'), at('m')]).toEqual([before, before])
    expect(t.frame()!.corners).toEqual(rest)
  })

  it('a view change or playback during a drag ends the session; nothing written', () => {
    for (const stop of [(t: ReturnType<typeof setup>) => t.setView(SIDE), (t: ReturnType<typeof setup>) => t.ix.cancelAll()]) {
      const t = setup(), start = save(t.d)
      t.ix.setTool('deform')
      const c2 = t.frame()!.corners[2]!
      t.drag(c2, P(c2.x + 10, c2.y + 5), false)
      stop(t)
      t.ix.pointerUp(P(c2.x + 10, c2.y + 5))
      expect([t.frame(), save(t.d)]).toEqual([undefined, start])
    }
  })

  it('a click without moving, or a drag back to its start, records no step', () => {
    const t = setup()
    t.ix.setTool('deform')
    const c2 = t.frame()!.corners[2]!
    t.drag(c2, c2)
    t.drag(c2, P(c2.x + 9, c2.y), false); t.ix.pointerMove(c2); t.ix.pointerUp(c2)
    expect(t.frame()).toBeDefined()
    t.d.undo() // the one step before is the selection: undone, nothing of the deform in between
    expect(t.d.snapshot().selection).toEqual([])
  })

  it('a release on an invalid frame commits the drag\'s last valid preview', () => {
    const t = setup()
    t.ix.setTool('deform')
    const [c0, , c2] = t.frame()!.corners
    t.ix.pointerDown(c0!); t.ix.pointerMove(P(c0!.x - 5, c0!.y + 2))
    const valid = t.ix.preview().deform!.lines
    t.ix.pointerMove(P(c2!.x + 5, c2!.y + 5)) // crossed: kept at the last valid frame
    t.ix.pointerUp(P(c2!.x + 5, c2!.y + 5))
    expect(t.d.geometry().lines.filter(l => l.id !== 'mn').map(l => ({ id: l.id, curve: [...l.curve] }))).toEqual(valid)
    expect(t.frame()!.corners[0]).toEqual(P(c0!.x - 5, c0!.y + 2))
  })
})
