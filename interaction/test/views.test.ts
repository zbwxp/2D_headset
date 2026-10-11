// Step 7: interaction in a chosen view (docs/step7-view-picker.md; dot 1791656400).
// Every read and commit is in env.view(); a drag, picks, the pen chain and the mirror source
// belong to a Core and a view; a pending cut to its Core only; a selection-only edit changes
// only the selection.
import { describe, it, expect, vi } from 'vitest'
import { Core, type Vec } from '../../src'
import { createInteraction } from '../index'

const P = (x: number, y = 0): Vec => ({ x, y })
const FRONT = 'view:0,0', SIDE = 'view:90,0'

/** Lines ab and bc in L; in the side view b is at (50, 50). */
function drawing() {
  const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
  d.edit(e => { e.layer('K', 'K'); e.line('ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(100) }); e.line('bc', 'b', { id: 'c', layer: 'L', position: P(100, 100) }) })
  d.editIn(SIDE, e => e.move([{ id: 'b', target: P(50, 50) }]))
  return d
}
function setup(d = drawing()) {
  let current = d, view = FRONT, n = 0
  const ix = createInteraction({ core: () => current, view: () => view, newId: p => `${p}${++n}`, layer: () => 'L', pixel: () => 0.3 })
  return { ix, core: () => current, setView: (v: string) => { view = v; ix.viewChanged() }, open: (c: Core) => { current = c; ix.drawingChanged() } }
}
const at = (d: Core, k: string, id: string) => d.in(k).snapshot().points.find(p => p.id === id)!.position

describe('interaction reads and commits in the current view', () => {
  it('a drag in the side view moves the point there only', () => {
    const { ix, core, setView } = setup()
    setView(SIDE)
    ix.setTool('A')
    expect(ix.pointerDown(P(50, 50))).toBe(true)
    ix.pointerMove(P(60, 50)); ix.pointerUp(P(60, 50))
    expect(at(core(), SIDE, 'b')).toEqual(P(60, 50))
    expect(at(core(), FRONT, 'b')).toEqual(P(100))
  })

  it('hit-testing uses the current view\'s positions', () => {
    const { ix, setView } = setup()
    setView(SIDE)
    ix.setTool('A')
    ix.pointerDown(P(100, 0)); ix.pointerUp(P(100, 0)) // b's front position: nothing there in the side view
    expect(ix.selection().some(u => u.kind === 'point' && u.id === 'b')).toBe(false)
    ix.pointerDown(P(50, 50)); ix.pointerUp(P(50, 50))
    expect(ix.selection()).toEqual([{ kind: 'point', id: 'b' }])
  })

  it('a box select uses the current view', () => {
    const { ix, setView } = setup()
    setView(SIDE)
    ix.setTool('V')
    // a box around the side-view ab (0,0)–(50,50), dragged right: lines wholly inside
    ix.pointerDown(P(-10, -10)); ix.pointerMove(P(70, 70)); ix.pointerUp(P(70, 70))
    expect(ix.selection().filter(u => u.kind === 'line').map(u => (u as { id: string }).id)).toContain('ab')
  })
})

describe('switching the view', () => {
  it('mid-drag: the drag ends and nothing is committed', () => {
    const { ix, core, setView } = setup()
    ix.setTool('A')
    ix.pointerDown(P(100, 0)); ix.pointerMove(P(120, 0))
    const edit = vi.spyOn(core(), 'editIn')
    setView(SIDE)
    ix.pointerUp(P(120, 0))
    expect(edit).not.toHaveBeenCalled()
    expect(ix.preview().drag).toBeUndefined()
    expect(at(core(), FRONT, 'b')).toEqual(P(100))
  })

  it('ends the pen chain and a two-click pick; keeps the selection', () => {
    const { ix, setView } = setup()
    ix.setTool('pen'); ix.pointerDown(P(300, 300)); ix.pointerUp(P(300, 300))
    expect(ix.preview().pen).toBeDefined()
    setView(SIDE)
    expect(ix.preview().pen).toBeUndefined()
    ix.setTool('bind'); ix.pointerDown(P(0, 0)); ix.pointerUp(P(0, 0))
    expect(ix.preview().pick).toBeDefined()
    setView(FRONT)
    expect(ix.preview().pick).toBeUndefined()
    ix.setTool('V'); ix.pointerDown(P(0, 0)); ix.pointerUp(P(0, 0))
    const selected = ix.selection()
    setView(SIDE)
    expect(ix.selection()).toEqual(selected)
  })

  it('a pending cut survives a view switch and is pasted there; another Core ends it', () => {
    const { ix, core, setView, open } = setup()
    ix.setTool('V'); ix.pointerDown(P(50, 0)); ix.pointerUp(P(50, 0))
    ix.cut()
    expect(ix.preview().cut.length).toBe(1)
    setView(SIDE)
    expect(ix.preview().cut.length).toBe(1)
    ix.paste()
    expect(core().snapshot().groups.length).toBe(1)
    // paste moved the curve with its ids into the current layer (L): ab still there
    expect(core().snapshot().lines.map(l => l.id).sort()).toEqual(['ab', 'bc'])
    ix.pointerDown(P(0, 0)); ix.pointerUp(P(0, 0)); ix.cut()
    open(drawing())
    expect(ix.preview().cut).toEqual([])
  })

  it('switching is not an edit', () => {
    const { ix, core, setView } = setup()
    const could = core().canUndo
    setView(SIDE); setView(FRONT)
    expect(core().canUndo).toBe(could)
    expect(ix.preview().refusal).toBeUndefined()
  })
})

describe('refusals and new actions', () => {
  it('mirror apply off the front shows mirror-front-only', () => {
    const d = drawing()
    d.edit(e => { e.line('s1', { id: 's', layer: 'L', position: P(-200, 300) }, { id: 't', layer: 'L', position: P(-150, 300) }); e.line('u1', { id: 'u', layer: 'L', position: P(150, 300) }, { id: 'w', layer: 'L', position: P(200, 300) }) })
    const { ix, core, setView } = setup(d)
    setView(SIDE)
    ix.setTool('V')
    ix.pointerDown(P(-175, 300)); ix.pointerUp(P(-175, 300)); ix.setMirrorSource()
    ix.pointerDown(P(175, 300)); ix.pointerUp(P(175, 300))
    const before = JSON.stringify(core().in(SIDE).snapshot().points)
    ix.mirrorApply()
    expect(ix.preview().refusal?.code).toBe('mirror-front-only')
    expect(JSON.stringify(core().in(SIDE).snapshot().points)).toBe(before)
  })

  it('broadcastStroke takes the selected lines\' strokes from the current view to the others', () => {
    const { ix, core, setView } = setup()
    core().editIn(SIDE, e => e.lineStroke('ab', { width: 4, profile: 'uniform' }))
    setView(SIDE)
    ix.setTool('V'); ix.pointerDown(P(25, 25)); ix.pointerUp(P(25, 25))
    ix.broadcastStroke()
    expect(core().in(FRONT).snapshot().lines.find(l => l.id === 'ab')!.stroke.width).toBe(4)
  })
})

describe('a selection-only edit changes only the selection (dot 1791656400)', () => {
  /** A legal coincidence in the side view: c drawn in the front where b is in the side view. */
  function coincident() {
    const d = drawing()
    d.edit(e => e.line('cd', { id: 'q', layer: 'L', position: P(50, 50) }, { id: 'r', layer: 'L', position: P(70, 90) }))
    return d
  }
  const ids = (d: Core) => d.in(SIDE).snapshot().points.map(p => p.id).sort()

  it('a click and a box select there keep the two points and their connections', () => {
    const { ix, core, setView } = setup(coincident())
    expect(ids(core())).toEqual(['a', 'b', 'c', 'q', 'r'])
    setView(SIDE)
    ix.setTool('V'); ix.pointerDown(P(60, 70)); ix.pointerUp(P(60, 70))
    ix.pointerDown(P(-20, -20)); ix.pointerMove(P(200, 200)); ix.pointerUp(P(200, 200))
    expect(ix.selection().length).toBeGreaterThan(0)
    expect(ids(core())).toEqual(['a', 'b', 'c', 'q', 'r'])
    expect(core().in(SIDE).snapshot().lines.find(l => l.id === 'cd')!.a).toBe('q')
  })
})

describe('stage 2 actions (shape broadcast, fit, draft) and their refusals', () => {
  it('shape broadcast from the front clears the pending change; off the front it is refused with its reason', () => {
    const { ix, core, setView } = setup()
    ix.setTool('A'); ix.pointerDown(P(0, 0)); ix.pointerMove(P(0, 10)); ix.pointerUp(P(0, 10)) // a moved at the front: pending
    expect(core().pendingLines()).toContain('ab')
    ix.setTool('V'); ix.pointerDown(P(50, 5)); ix.pointerUp(P(50, 5))
    setView(SIDE)
    ix.broadcastShape()
    expect(ix.preview().refusal?.code).toBe('broadcast-from-front')
    setView(FRONT)
    ix.broadcastShape()
    expect(ix.preview().refusal).toBeUndefined()
    expect(core().pendingLines()).not.toContain('ab')
    expect(at(core(), SIDE, 'a')).toEqual(P(0, 10))
  })

  it('an incomplete link scope is refused, naming the partner, so the panel can say why', () => {
    const d = drawing()
    d.edit(e => { e.line('qr', { id: 'q', layer: 'K', position: P(0, 0) }, { id: 'r', layer: 'K', position: P(-50, -50) }); e.link('a', 'q') })
    const { ix } = setup(d)
    ix.setTool('V'); ix.pointerDown(P(50, 0)); ix.pointerUp(P(50, 0))
    ix.fit()
    expect(ix.preview().refusal?.code).toBe('fit-link-incomplete')
    expect(ix.preview().refusal?.message).toContain('q')
  })

  it('fit and the corner draft run on the selection', () => {
    const { ix, core } = setup()
    ix.setTool('A'); ix.pointerDown(P(0, 0)); ix.pointerMove(P(0, 10)); ix.pointerUp(P(0, 10))
    ix.setTool('V'); ix.pointerDown(P(50, 5)); ix.pointerUp(P(50, 5))
    ix.fit()
    expect(core().pendingLines()).not.toContain('ab')
    ix.draftCorners()
    expect(ix.preview().refusal).toBeUndefined()
  })
})
