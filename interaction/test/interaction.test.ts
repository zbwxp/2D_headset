// The interaction module (graph "Interaction"; docs/interaction-plan.md acceptance 1–21).
// Scripted input against a real Core; checks the drawing, the history and the preview data.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Core, save, type Vec } from '../../src'
import { createInteraction, type Interaction } from '../index'

const P = (x: number, y: number): Vec => ({ x, y })

/** Two layers: an open curve a–b–c (lines h, v) in L, a line x–y (m) in K. */
function drawing() {
  const d = new Core()
  d.edit(e => {
    e.layer('L'); e.layer('K')
    e.line('h', { id: 'a', layer: 'L', position: P(0, 0) }, { id: 'b', layer: 'L', position: P(100, 0) })
    e.line('v', 'b', { id: 'c', layer: 'L', position: P(100, 100) })
    e.line('m', { id: 'x', layer: 'K', position: P(0, 200) }, { id: 'y', layer: 'K', position: P(100, 200) })
  })
  return d
}
/** Current layer L; every layer selected unless `setLayers` says otherwise (layer scope: docs/layer-scope-plan.md). */
function setup(d = drawing()) {
  let current = d, n = 0, layer = 'L', selected: string[] | null = null
  const ix = createInteraction({ core: () => current, newId: p => `${p}${++n}`, layer: () => layer, layers: () => selected ?? current.snapshot().layers.map(l => l.id), pixel: () => 0.3 })
  return { ix, core: () => current, open: (c: Core) => { current = c; ix.drawingChanged() }, setLayer: (l: string) => { layer = l }, setLayers: (ls: string[]) => { selected = ls } }
}
/** What the history looks like from outside: can undo / redo, and the document one undo away. */
function history(d: Core) {
  const now = save(d), can = [d.canUndo, d.canRedo]
  let back = ''
  if (d.canUndo) { d.undo(); back = save(d); d.redo() }
  return JSON.stringify({ now, can, back })
}
const pos = (d: Core, id: string) => d.snapshot().points.find(p => p.id === id)!.position
const sel = (d: Core) => d.snapshot().selection.map(u => (u.kind === 'handle' ? `h:${u.line}.${u.end}` : `${u.kind}:${u.id}`))

describe('state owners (graph row 1)', () => {
  it('1. interaction keeps no copy of the drawing: every read goes to the current core', () => {
    const { ix, core } = setup()
    ix.setTool('V')
    ix.pointerDown(P(50, 0))
    // change the drawing behind its back: interaction sees the change at once
    core().edit(e => e.move([{ id: 'c', target: P(100, 150) }]))
    expect(ix.preview().drag?.units).toEqual([{ kind: 'line', id: 'h' }, { kind: 'line', id: 'v' }])
  })

  it('2. interaction imports only the core package root (and its own files), and core never imports interaction', () => {
    const dir = join(__dirname, '..')
    const own = readdirSync(dir, { recursive: true }).map(String).filter(f => f.endsWith('.ts') && !f.startsWith('test'))
    expect(own.sort()).toEqual(['base.ts', 'feedback.ts', 'flows/clipboard.ts', 'flows/mirror.ts', 'flows/pen.ts', 'flows/select-transform.ts', 'flows/steps.ts', 'index.ts'])
    for (const f of own) {
      const specs = [...readFileSync(join(dir, f), 'utf8').matchAll(/from '([^']+)'/g)].map(m => m[1]!)
      const root = f.includes('/') ? '../../src' : '../src'
      expect(specs.filter(x => x !== root && !x.startsWith('./') && !(f.includes('/') && x.startsWith('../') && !x.startsWith('../../')))).toEqual([])
    }
    const src = join(__dirname, '..', '..', 'src')
    const all = readdirSync(src, { recursive: true }).filter(f => String(f).endsWith('.ts')).map(f => readFileSync(join(src, String(f)), 'utf8'))
    expect(all.some(t => /interaction/.test(t.match(/from '[^']+'/g)?.join(' ') ?? ''))).toBe(false)
  })
})

describe('cancellable, atomic commit (graph row 2)', () => {
  it('3. a V drag: one select at press, preview only while moving, one translate on release; undo goes back to the selection', () => {
    const { ix, core } = setup(), d = core()
    const edit = vi.spyOn(d, 'edit')
    ix.setTool('V')
    ix.pointerDown(P(50, 0))
    expect(edit).toHaveBeenCalledTimes(1)
    expect(sel(d)).toEqual(['line:h', 'line:v'])
    const afterSelect = save(d)
    ix.pointerMove(P(60, 10)); ix.pointerMove(P(70, 20))
    expect(save(d)).toBe(afterSelect)
    expect(ix.preview().drag?.offset).toEqual(P(20, 20))
    ix.pointerUp(P(70, 20))
    expect(edit).toHaveBeenCalledTimes(2)
    expect(pos(d, 'a')).toEqual(P(20, 20))
    d.undo()
    expect(save(d)).toBe(afterSelect)
  })

  it('4. Esc during a drag: no edit, the selection made at press stays, the history untouched', () => {
    const { ix, core } = setup(), d = core()
    ix.setTool('V')
    ix.pointerDown(P(50, 0))
    const before = history(d)
    ix.pointerMove(P(80, 30))
    ix.key('Escape')
    ix.pointerUp(P(80, 30))
    expect(history(d)).toBe(before)
    expect(sel(d)).toEqual(['line:h', 'line:v'])
    expect(ix.preview().drag).toBeUndefined()
  })

  it('5. a drag the browser cancels is a cancel', () => {
    const { ix, core } = setup(), d = core()
    ix.setTool('V'); ix.pointerDown(P(50, 0))
    const before = history(d)
    ix.pointerMove(P(80, 30)); ix.pointerCancel(); ix.pointerUp(P(80, 30))
    expect(history(d)).toBe(before)
  })

  it('6. a drag refused by a lock: nothing changes, the refusal names the locked line, the drag has ended', () => {
    const { ix, core } = setup(), d = core()
    d.edit(e => e.lineState('v', { locked: true }))
    ix.setTool('A')
    ix.pointerDown(P(0, 0)) // point a, on h only
    ix.pointerUp(P(0, 0))
    ix.pointerDown(P(100, 0)) // point b, shared with the locked v
    const before = history(d)
    ix.pointerMove(P(110, 10)); ix.pointerUp(P(110, 10))
    expect(history(d)).toBe(before)
    expect(ix.preview().refusal).toMatchObject({ code: 'locked', objects: [{ kind: 'line', id: 'v' }] })
    expect(ix.preview().drag).toBeUndefined()
  })

  it('7. previews never write: many moves, the drawing and history unchanged until release', () => {
    const { ix, core } = setup(), d = core()
    ix.setTool('V'); ix.pointerDown(P(50, 0))
    const before = history(d)
    for (let i = 0; i < 20; i++) ix.pointerMove(P(50 + i, i))
    expect(history(d)).toBe(before)
  })

  it('19. a repeated release commits once', () => {
    const { ix, core } = setup(), d = core()
    ix.setTool('V'); ix.pointerDown(P(50, 0)); ix.pointerMove(P(60, 0))
    const edit = vi.spyOn(d, 'edit')
    ix.pointerUp(P(60, 0)); ix.pointerUp(P(60, 0)); ix.pointerCancel()
    expect(edit).toHaveBeenCalledTimes(1)
    expect(pos(d, 'a')).toEqual(P(10, 0))
  })
})

describe('explicit targets (graph row 3)', () => {
  it('8. bind: the first pick is held through a selection change; the call binds first and second', () => {
    const { ix, core } = setup(), d = core()
    d.edit(e => e.line('w', { id: 'p', layer: 'L', position: P(0, 50) }, { id: 'q', layer: 'L', position: P(40, 50) }))
    ix.setTool('bind')
    ix.pointerDown(P(0, 0))
    expect(ix.preview().pick).toEqual({ kind: 'point', id: 'a' })
    d.edit(e => e.select([{ kind: 'line', id: 'm' }])) // from a panel
    ix.pointerDown(P(0, 50))
    expect(d.snapshot().points.some(p => p.id === 'p')).toBe(false)
    expect(d.snapshot().lines.find(l => l.id === 'w')!.a).toBe('a')
  })

  it('9. pending cut: copy ends it; a refused paste keeps it; a retry after unlocking moves it; a drawing change ends it', () => {
    const { ix, core, setLayer, open } = setup(), d = core()
    ix.setTool('V'); ix.pointerDown(P(50, 0)); ix.pointerUp(P(50, 0))
    ix.cut()
    expect(ix.preview().cut).toHaveLength(1)
    ix.pointerDown(P(50, 200)); ix.pointerUp(P(50, 200)) // select m
    ix.copy()
    expect(ix.preview().cut).toEqual([])
    ix.paste()
    expect(pos(d, 'a')).toEqual(P(0, 0)) // the curve did not move; a copy of m was pasted
    // a refused paste keeps the cut
    ix.pointerDown(P(50, 0)); ix.pointerUp(P(50, 0))
    d.edit(e => e.lineState('h', { locked: true }))
    ix.cut(); setLayer('K'); ix.paste()
    expect(ix.preview().refusal?.code).toBe('locked')
    expect(ix.preview().cut).toHaveLength(1)
    d.edit(e => e.lineState('h', { locked: false }))
    ix.paste()
    expect(d.snapshot().points.find(p => p.id === 'a')!.layer).toBe('K')
    // a drawing change ends a pending cut
    ix.cut()
    open(drawing())
    expect(ix.preview().cut).toEqual([])
  })

  it('10. a drag of A while the selection becomes B moves A only; B stays selected', () => {
    const { ix, core } = setup(), d = core()
    ix.setTool('V'); ix.pointerDown(P(50, 0)); ix.pointerMove(P(50, 30))
    d.edit(e => e.select([{ kind: 'line', id: 'm' }])) // a panel changes the selection mid-drag
    ix.pointerUp(P(50, 30))
    expect(pos(d, 'a')).toEqual(P(0, 30))
    expect(pos(d, 'x')).toEqual(P(0, 200))
    expect(sel(d)).toEqual(['line:m'])
  })

  it('17. a first pick that is gone (undone away) never binds anything else; historyChanged ends it', () => {
    const { ix, core } = setup(), d = core()
    d.edit(e => e.line('w', { id: 'p', layer: 'L', position: P(0, 50) }, { id: 'q', layer: 'L', position: P(40, 50) }))
    ix.setTool('bind')
    ix.pointerDown(P(0, 50)) // first pick p
    ix.undo() // w and its points are gone
    expect(ix.preview().pick).toBeUndefined()
    const before = history(d)
    ix.pointerDown(P(100, 0))
    expect(history(d)).toBe(before) // b is only a new first pick
    expect(ix.preview().pick).toEqual({ kind: 'point', id: 'b' })
  })

  it('18. opening another drawing that fails keeps the current one and its unfinished operations', () => {
    const { ix } = setup()
    ix.setTool('bind'); ix.pointerDown(P(0, 0))
    // the app calls drawingChanged only after a successful open; a failed open calls nothing
    expect(ix.preview().pick).toEqual({ kind: 'point', id: 'a' })
  })

  it('20. an operation belongs to its Core: after switching to a drawing with the same ids, it never lands there', () => {
    const { ix, core, open } = setup()
    ix.setTool('V'); ix.pointerDown(P(50, 0)); ix.pointerMove(P(50, 40))
    const other = drawing(), before = save(other)
    open(other)
    ix.pointerUp(P(50, 40))
    expect(save(core())).toBe(before)
  })

  it('21. a pending cut whose curve changed members ends with a hint, and never takes the new members', () => {
    const { ix, core, setLayer } = setup(), d = core()
    ix.setTool('V'); ix.pointerDown(P(50, 0)); ix.pointerUp(P(50, 0))
    ix.cut()
    d.edit(e => e.split('h', 0.5, 'mid', 'h1', 'h2')) // same group id, new members
    setLayer('K'); ix.paste()
    expect(ix.preview().refusal?.code).toBe('cut-changed')
    expect(d.snapshot().points.find(p => p.id === 'a')!.layer).toBe('L')
    expect(ix.preview().cut).toEqual([])
  })
})

describe('lifecycle calls', () => {
  it('11. a tool change ends the old tool’s pick and pen chain and cancels a drag; the pending cut stays', () => {
    const { ix } = setup()
    ix.setTool('V'); ix.pointerDown(P(50, 0)); ix.pointerUp(P(50, 0)); ix.cut()
    ix.setTool('bind'); ix.pointerDown(P(0, 0))
    ix.setTool('pen')
    expect(ix.preview().pick).toBeUndefined()
    expect(ix.preview().cut).toHaveLength(1)
  })

  it('12. historyChanged ends a drag; a pending cut whose curve is gone ends', () => {
    const { ix, core } = setup(), d = core()
    ix.setTool('V'); ix.pointerDown(P(50, 200)); ix.pointerUp(P(50, 200)); ix.cut()
    d.edit(e => e.deleteLine('m')); ix.historyChanged()
    expect(ix.preview().cut).toEqual([])
    ix.pointerDown(P(50, 0)); ix.pointerMove(P(50, 10)); ix.historyChanged()
    expect(ix.preview().drag).toBeUndefined()
  })

  it('13. drawingChanged ends everything tied to the old drawing; the clip stays', () => {
    const { ix, core, open, setLayer } = setup()
    ix.setTool('V'); ix.pointerDown(P(50, 200)); ix.pointerUp(P(50, 200)); ix.copy()
    const other = Core.newDocument()
    open(other); setLayer('layer-1')
    ix.paste()
    expect(core().snapshot().lines).toHaveLength(1)
  })

  it('14. Esc cancels the innermost first: drag, then a pick, then the pending cut', () => {
    const { ix } = setup()
    ix.setTool('V'); ix.pointerDown(P(50, 0)); ix.pointerUp(P(50, 0)); ix.cut()
    ix.setTool('bind'); ix.pointerDown(P(0, 200))
    ix.key('Escape')
    expect([ix.preview().pick, ix.preview().cut.length]).toEqual([undefined, 1])
    ix.key('Escape')
    expect(ix.preview().cut).toEqual([])
  })
})

describe('clipboard', () => {
  it('15. copy reads a clip from core; each paste goes one step further', () => {
    const { ix, core } = setup(), d = core()
    ix.setTool('V'); ix.pointerDown(P(50, 200)); ix.pointerUp(P(50, 200))
    ix.copy(); ix.paste(); ix.paste()
    const ys = d.snapshot().points.filter(p => p.id.includes('/')).map(p => p.position.y).sort((a, b) => a - b)
    expect(ys).toEqual([220, 220, 240, 240])
  })

  it('16. cut then paste moves the curves in one edit with their ids; later pastes copy', () => {
    const { ix, core, setLayer } = setup(), d = core()
    ix.setTool('V'); ix.pointerDown(P(50, 0)); ix.pointerUp(P(50, 0)); ix.cut()
    setLayer('K')
    const edit = vi.spyOn(d, 'edit')
    ix.paste()
    expect(edit).toHaveBeenCalledTimes(1)
    expect(['a', 'b', 'c'].map(id => d.snapshot().points.find(p => p.id === id)!.layer)).toEqual(['K', 'K', 'K'])
    ix.paste()
    expect(d.snapshot().lines.length).toBe(5)
  })
})

describe('tools (each through core’s public operations)', () => {
  it('pen: a chain of clicks makes lines; clicking an existing point connects to it', () => {
    const { ix, core } = setup(), d = core()
    ix.setTool('pen')
    ix.pointerDown(P(0, 300)); ix.pointerDown(P(50, 300)); ix.pointerDown(P(100, 0))
    const added = d.snapshot().lines.filter(l => !['h', 'v', 'm'].includes(l.id))
    expect(added).toHaveLength(2)
    expect(added[1]!.b).toBe('b')
  })

  it('join: two lines in click order; the second turns to the first; alt removes', () => {
    const { ix, core } = setup(), d = core()
    ix.setTool('join'); ix.setOptions({ joinMode: 'arc', radius: 6 })
    ix.pointerDown(P(50, 0)); ix.pointerDown(P(100, 50))
    expect(d.snapshot().joins).toEqual([{ point: 'b', lines: ['h', 'v'], mode: 'arc', radius: 6 }])
    ix.pointerDown(P(50, 0)); ix.pointerDown(P(100, 50), { alt: true })
    expect(d.snapshot().joins).toEqual([])
  })

  it('split, unbind and fill', () => {
    const { ix, core } = setup(), d = core()
    ix.setTool('split'); ix.pointerDown(P(30, 0))
    expect(d.snapshot().lines.some(l => l.id === 'h')).toBe(false)
    ix.setTool('unbind'); ix.pointerDown(P(100, 5))
    expect(d.snapshot().lines.find(l => l.id === 'v')!.b).toBe('c')
    expect(d.snapshot().lines.find(l => l.id === 'v')!.a).not.toBe('b')
    const loop = Core.newDocument()
    loop.edit(e => { e.line('t1', { id: 'u', layer: 'layer-1', position: P(0, 0) }, { id: 'w', layer: 'layer-1', position: P(40, 0) }); e.line('t2', 'w', { id: 'z', layer: 'layer-1', position: P(20, 40) }); e.line('t3', 'z', 'u') })
    const s2 = setup(loop)
    s2.ix.setTool('fill'); s2.ix.pointerDown(P(20, 10))
    expect(loop.snapshot().loops.filter(l => l.filled)).toHaveLength(1)
  })

  it('mirror: source first, then the selection as target; refused without a source', () => {
    const d = new Core({ axis: 0 })
    d.edit(e => {
      e.layer('L')
      e.line('s', { id: 's1', layer: 'L', position: P(-30, 0) }, { id: 's2', layer: 'L', position: P(-10, 5) })
      e.line('t', { id: 't1', layer: 'L', position: P(12, 1) }, { id: 't2', layer: 'L', position: P(28, 2) })
    })
    const { ix } = setup(d)
    ix.mirrorLink()
    expect(ix.preview().refusal?.code).toBe('no-mirror-source')
    ix.setTool('V'); ix.pointerDown(P(-20, 2.5)); ix.pointerUp(P(-20, 2.5)); ix.setMirrorSource()
    ix.pointerDown(P(20, 1.5)); ix.pointerUp(P(20, 1.5)); ix.mirrorLink()
    expect(d.snapshot().mirrorPairs).toHaveLength(1)
    expect(ix.preview().mirrorSource).toEqual([])
  })

  it('keys: tool letters, Delete, ⌘C / ⌘X / ⌘V, ⌘Z / ⇧⌘Z (undo also ends stale picks)', () => {
    const { ix, core } = setup(), d = core()
    expect(ix.key('v')).toBe(true); expect(ix.tool).toBe('V')
    ix.pointerDown(P(50, 200)); ix.pointerUp(P(50, 200))
    ix.key('Delete')
    expect(d.snapshot().lines.some(l => l.id === 'm')).toBe(false)
    ix.key('z', { meta: true })
    expect(d.snapshot().lines.some(l => l.id === 'm')).toBe(true)
    ix.key('z', { meta: true, shift: true })
    expect(d.snapshot().lines.some(l => l.id === 'm')).toBe(false)
  })
})

describe('review cases (dot 1791544469)', () => {
  function mirrorScene() {
    const d = new Core({ axis: 0 })
    d.edit(e => {
      e.layer('L')
      e.line('s1', { id: 'a', layer: 'L', position: P(-40, 0) }, { id: 'b', layer: 'L', position: P(-20, 10) })
      e.line('t1', { id: 'c', layer: 'L', position: P(20, 10) }, { id: 'e', layer: 'L', position: P(40, 0) })
      e.line('t2', 'e', { id: 'f', layer: 'L', position: P(60, 30) })
    })
    return d
  }

  it('a mirror source that gains a member after it was picked is not widened: the link is refused and asks to pick again', () => {
    const d = mirrorScene(), { ix } = setup(d)
    d.edit(e => e.select([{ kind: 'line', id: 's1' }])); ix.setMirrorSource()
    d.edit(e => e.line('s2', 'b', { id: 'g', layer: 'L', position: P(-5, 30) })) // s2 joins s1's curve
    d.edit(e => e.selectGroup('t1')); const before = save(d)
    ix.mirrorLink()
    expect(ix.preview().refusal?.code).toBe('mirror-source-not-whole')
    expect(save(d)).toBe(before)
  })

  it('a mirror target that is only part of a curve is refused, never filled up with the rest', () => {
    const d = mirrorScene(), { ix } = setup(d)
    d.edit(e => e.select([{ kind: 'line', id: 's1' }])); ix.setMirrorSource()
    d.edit(e => e.select([{ kind: 'line', id: 't1' }])); const before = save(d)
    ix.mirrorLink()
    expect(ix.preview().refusal?.code).toBe('mirror-target-not-whole')
    expect(save(d)).toBe(before)
  })

  it('the pen copies a position in: changing the caller’s Vec afterwards does not move the pending start', () => {
    const { ix, core } = setup(), d = core()
    const v = { x: 0, y: 300 }
    ix.setTool('pen'); ix.pointerDown(v)
    v.x = 999; v.y = 999
    ix.pointerDown(P(50, 300))
    const added = d.snapshot().lines.find(l => !['h', 'v', 'm'].includes(l.id))!
    expect(d.snapshot().points.find(p => p.id === added.a)!.position).toEqual(P(0, 300))
  })

  it('a drag copies its press position in: changing the caller’s Vec afterwards does not change the offset', () => {
    const { ix, core } = setup(), d = core()
    const v = { x: 50, y: 0 }
    ix.setTool('V'); ix.pointerDown(v)
    v.x = -500
    ix.pointerMove(P(60, 0)); ix.pointerUp(P(60, 0))
    expect(pos(d, 'a')).toEqual(P(10, 0))
  })
})

describe('review cases (dot 1791544530)', () => {
  it('Delete during a drag deletes the lines and ends the drag: no preview refers to them, release commits nothing', () => {
    const { ix, core } = setup(), d = core()
    ix.setTool('V'); ix.pointerDown(P(50, 0)); ix.pointerMove(P(60, 10))
    ix.key('Delete')
    expect(d.snapshot().lines.some(l => l.id === 'h')).toBe(false)
    expect(ix.preview().drag).toBeUndefined()
    const before = save(d)
    ix.pointerUp(P(60, 10))
    expect(save(d)).toBe(before)
  })
})

describe('one owner of feedback (dot 1791551067)', () => {
  it('the last action’s outcome is shown, whichever path it took: canvas, panel, canvas', () => {
    const { ix, core } = setup(), d = core()
    ix.key('Delete') // nothing selected
    expect(ix.preview().refusal?.code).toBe('select-lines-to-delete')
    // a panel rename onto a taken name, run by the app and reported
    try { d.edit(e => e.renameLayer('K', 'L')) } catch (err) { ix.outcome(err) }
    expect(ix.preview().refusal?.code).toBe('name-taken')
    // a panel rename that works clears it
    d.edit(e => e.renameLayer('K', 'K2')); ix.outcome()
    expect(ix.preview().refusal).toBeUndefined()
    // a panel refusal, then a canvas action that works: the old panel refusal is gone
    try { d.edit(e => e.renameLayer('K', 'L')) } catch (err) { ix.outcome(err) }
    ix.setTool('V'); ix.pointerDown(P(50, 0)); ix.pointerUp(P(50, 0))
    expect(ix.preview().refusal).toBeUndefined()
  })
})

describe('reach and order (bowen 1791551877; dot 1791551915)', () => {
  function straight(pixel: number) {
    const d = new Core()
    d.edit(e => { e.layer('L'); e.line('s', { id: 'a', layer: 'L', position: P(0, 0) }, { id: 'b', layer: 'L', position: P(90, 0) }) })
    // a pen line is straight: its handles lie on it, at (30, 0) and (60, 0)
    const ix = createInteraction({ core: () => d, newId: p => p, layer: () => 'L', pixel: () => pixel })
    return { d, ix }
  }

  it('a handle lying on its straight line is picked with A, at its tip or a little off it', () => {
    const { d, ix } = straight(1)
    d.edit(e => e.select([{ kind: 'line', id: 's' }])) // handles show for the selected line
    ix.setTool('A')
    ix.pointerDown(P(30, 0)); ix.pointerUp(P(30, 0))
    expect(d.snapshot().selection).toEqual([{ kind: 'handle', line: 's', end: 'a' }])
    d.edit(e => e.select([{ kind: 'line', id: 's' }]))
    ix.pointerDown(P(33, 2)); ix.pointerUp(P(33, 2))
    expect(d.snapshot().selection).toEqual([{ kind: 'handle', line: 's', end: 'a' }])
  })

  it('a press inside a point’s reach picks the point, even though the line is nearer', () => {
    const { d, ix } = straight(1)
    ix.setTool('A')
    ix.pointerDown(P(6, 0.5)); ix.pointerUp(P(6, 0.5)) // 6 px from point a, 0.5 px from the line
    expect(d.snapshot().selection).toEqual([{ kind: 'point', id: 'a' }])
  })

  it('the reach is in screen pixels: the same screen distance picks the same thing at any zoom', () => {
    for (const pixel of [0.1, 1, 10]) {
      const { d, ix } = straight(pixel)
      ix.setTool('V')
      ix.pointerDown(P(45, 7 * pixel)); ix.pointerUp(P(45, 7 * pixel)) // 7 screen px from the line: within 8
      expect(d.snapshot().selection.length).toBe(1)
      d.edit(e => e.select([]))
      ix.pointerDown(P(45, 9 * pixel)); ix.pointerUp(P(45, 9 * pixel)) // 9 screen px: out of reach
      expect(d.snapshot().selection).toEqual([])
    }
  })
})

describe('A shows every handle of the selected layers, and what is shown is what can be picked (bowen 1791553510, 1791553331, 1791555800)', () => {
  const tip = (d: Core, line: string, end: 'a' | 'b') => {
    const l = d.snapshot().lines.find(x => x.id === line)!, p = pos(d, l[end]), h = end === 'a' ? l.ha : l.hb
    return P(p.x + h.x, p.y + h.y)
  }
  const keys = (ix: Interaction) => ix.preview().handles.map(h => `${h.line}.${h.end}`).sort()
  const ALL = [['h', 'a'], ['h', 'b'], ['v', 'a'], ['v', 'b'], ['m', 'a'], ['m', 'b']] as const

  it('with nothing selected: both handles of every visible line in the selected layers, none of another layer', () => {
    const { ix, setLayers } = setup()
    ix.setTool('A')
    setLayers(['L'])
    expect(keys(ix)).toEqual(['h.a', 'h.b', 'v.a', 'v.b'])
    setLayers(['K'])
    expect(keys(ix)).toEqual(['m.a', 'm.b'])
    setLayers(['L', 'K'])
    expect(keys(ix)).toEqual(['h.a', 'h.b', 'm.a', 'm.b', 'v.a', 'v.b'])
  })

  it('V, or no current layer: no handles', () => {
    const d = drawing()
    const ix = createInteraction({ core: () => d, newId: p => p, layer: () => undefined, pixel: () => 0.3 })
    ix.setTool('A')
    expect(ix.preview().handles).toEqual([])
    const { ix: ix2 } = setup()
    ix2.setTool('V')
    expect(ix2.preview().handles).toEqual([])
  })

  it('a hidden line’s handles are not shown', () => {
    const { ix, core, setLayers } = setup()
    setLayers(['L'])
    core().edit(e => e.lineState('v', { visible: false }))
    ix.setTool('A')
    expect(keys(ix)).toEqual(['h.a', 'h.b'])
  })

  for (const prior of ['nothing', 'line h', 'point c'] as const) {
    it(`with ${prior} selected: a press on a handle tip picks that handle exactly when it is shown`, () => {
      for (const [line, end] of ALL) {
        const { ix, core, setLayers } = setup()
        setLayers(['L'])
        const d = core()
        d.edit(e => e.select(prior === 'line h' ? [{ kind: 'line', id: 'h' }] : prior === 'point c' ? [{ kind: 'point', id: 'c' }] : []))
        ix.setTool('A')
        const shown = keys(ix).includes(`${line}.${end}`)
        const at = tip(d, line, end)
        ix.pointerDown(at); ix.pointerUp(at)
        expect([line, end, sel(d).includes(`h:${line}.${end}`)]).toEqual([line, end, shown])
      }
    })
  }

  it('a closed four-sided curve, one side selected: a neighbour’s shown handle is picked, not the neighbour line (bowen 1791553275)', () => {
    const d = new Core()
    d.edit(e => {
      e.layer('L')
      e.line('s1', { id: 'p1', layer: 'L', position: P(0, 0) }, { id: 'p2', layer: 'L', position: P(90, 0) })
      e.line('s2', 'p2', { id: 'p3', layer: 'L', position: P(90, 90) })
      e.line('s3', 'p3', { id: 'p4', layer: 'L', position: P(0, 90) })
      e.line('s4', 'p4', 'p1')
    })
    const { ix } = setup(d)
    d.edit(e => e.select([{ kind: 'line', id: 's1' }]))
    ix.setTool('A')
    expect(keys(ix)).toEqual(['s1.a', 's1.b', 's2.a', 's2.b', 's3.a', 's3.b', 's4.a', 's4.b'])
    const at = tip(d, 's2', 'a')
    ix.pointerDown(at); ix.pointerUp(at)
    expect(sel(d)).toEqual(['h:s2.a'])
  })
})

describe('layer scope: each tool reaches its layers, and shows exactly what it can hit (bowen 1791555800; docs/layer-scope-plan.md)', () => {
  /** Every point, handle tip and line midpoint of the drawing, with what a press there should pick. */
  function targets(d: Core) {
    const s = d.snapshot(), pos = (id: string) => s.points.find(p => p.id === id)!.position
    const out: { key: string; at: Vec }[] = []
    for (const p of s.points) out.push({ key: `point:${p.id}`, at: p.position })
    for (const l of s.lines) {
      for (const end of ['a', 'b'] as const) { const p = pos(l[end]), h = end === 'a' ? l.ha : l.hb; out.push({ key: `h:${l.id}.${end}`, at: P(p.x + h.x, p.y + h.y) }) }
      const a = pos(l.a), b = pos(l.b)
      out.push({ key: `line:${l.id}`, at: P((a.x + b.x) / 2, (a.y + b.y) / 2) })
    }
    return out
  }
  const layerOfKey = (d: Core, key: string) => {
    const s = d.snapshot(), pl = (id: string) => s.points.find(p => p.id === id)!.layer
    const [kind, rest] = key.split(':') as [string, string]
    if (kind === 'point') return pl(rest)
    const line = kind === 'h' ? rest.split('.')[0]! : rest
    return pl(s.lines.find(l => l.id === line)!.a)
  }

  for (const selected of [['L'], ['K'], ['L', 'K']]) {
    it(`V and A with ${selected.join('+')} selected: a press picks only in those layers; A shows those layers' points and handles`, () => {
      for (const tool of ['V', 'A'] as const) {
        for (const t of targets(drawing())) {
          const { ix, core, setLayers } = setup()
          setLayers(selected)
          ix.setTool(tool)
          const shown = new Set([...ix.preview().points.map(p => `point:${p}`), ...ix.preview().handles.map(h => `h:${h.line}.${h.end}`)])
          ix.pointerDown(t.at); ix.pointerUp(t.at)
          const got = sel(core())
          const inScope = selected.includes(layerOfKey(core(), t.key))
          // out of scope: nothing picked; in scope: something of that layer is picked
          expect([tool, t.key, got.length > 0]).toEqual([tool, t.key, inScope])
          if (tool === 'A' && t.key.startsWith('h:')) expect([t.key, shown.has(t.key)]).toEqual([t.key, inScope])
          if (tool === 'A' && t.key.startsWith('point:')) expect([t.key, shown.has(t.key)]).toEqual([t.key, inScope])
        }
      }
    })
  }

  it('bind shows and hits only the selected layers’ points; merge and link reach every layer', () => {
    const { ix, setLayers } = setup()
    setLayers(['L'])
    ix.setTool('bind')
    expect(ix.preview().points.sort()).toEqual(['a', 'b', 'c'])
    ix.pointerDown(P(0, 200)) // x, in K
    expect(ix.preview().pick).toBeUndefined()
    for (const tool of ['merge', 'link'] as const) {
      ix.setTool(tool)
      expect(ix.preview().points.sort()).toEqual(['a', 'b', 'c', 'x', 'y'])
      ix.pointerDown(P(0, 200))
      expect(ix.preview().pick).toEqual({ kind: 'point', id: 'x' })
      ix.cancel()
    }
  })

  it('link across layers still works with one layer selected (its scope is every layer)', () => {
    const { ix, core, setLayers } = setup()
    setLayers(['L'])
    ix.setTool('link')
    ix.pointerDown(P(0, 0)); ix.pointerDown(P(0, 200))
    expect(core().snapshot().points.find(p => p.id === 'a')!.links).toEqual(['x'])
  })

  it('pen connects only to points of the current layer; on another layer’s point it starts a new point there', () => {
    const { ix, core, setLayers } = setup()
    setLayers(['L', 'K']) // pen's scope is the current layer, whatever is selected
    ix.setTool('pen')
    expect(ix.preview().points.sort()).toEqual(['a', 'b', 'c'])
    ix.pointerDown(P(100, 100)) // c, in L
    ix.pointerDown(P(0, 200)) // x is in K: a new point in L at the same place
    const s = core().snapshot(), line = s.lines.at(-1)! // the line the pen just made
    expect(line.a).toBe('c')
    expect(line.b).not.toBe('x')
    expect(s.points.find(p => p.id === line.b)!.layer).toBe('L')
  })

  it('split, unbind and join reach only the selected layers', () => {
    for (const tool of ['split', 'unbind'] as const) {
      const { ix, core, setLayers } = setup()
      setLayers(['L'])
      ix.setTool(tool)
      const before = JSON.stringify(core().snapshot().lines)
      ix.pointerDown(P(50, 200)) // m, in K
      expect([tool, JSON.stringify(core().snapshot().lines)]).toEqual([tool, before])
      setLayers(['K'])
      ix.pointerDown(P(50, 200))
      expect([tool, JSON.stringify(core().snapshot().lines) !== before]).toEqual([tool, true])
    }
    const { ix, setLayers } = setup()
    setLayers(['K'])
    ix.setTool('join')
    ix.pointerDown(P(50, 0)) // h, in L
    expect(ix.preview().pick).toBeUndefined()
  })

  it('fill picks only loops in scope', () => {
    const d = new Core()
    d.edit(e => {
      e.layer('L'); e.layer('K')
      e.line('t1', { id: 'u', layer: 'K', position: P(0, 0) }, { id: 'w', layer: 'K', position: P(40, 0) }); e.line('t2', 'w', { id: 'z', layer: 'K', position: P(20, 40) }); e.line('t3', 'z', 'u')
    })
    const { ix, setLayers } = setup(d)
    setLayers(['L'])
    ix.setTool('fill'); ix.pointerDown(P(20, 10))
    expect(d.snapshot().loops.filter(l => l.filled)).toHaveLength(0)
    setLayers(['K'])
    ix.pointerDown(P(20, 10))
    expect(d.snapshot().loops.filter(l => l.filled)).toHaveLength(1)
  })

  it('a hidden layer shows nothing and is hit by nothing, even when selected', () => {
    const { ix, core, setLayers } = setup()
    core().edit(e => e.layerState('K', { visible: false }))
    setLayers(['K'])
    ix.setTool('A')
    expect([ix.preview().points, ix.preview().handles]).toEqual([[], []])
    ix.pointerDown(P(0, 200)); ix.pointerUp(P(0, 200))
    expect(sel(core())).toEqual([])
  })

  it('V across two selected layers, then mirror source and apply / link across layers (dot 1791555418)', () => {
    const d = new Core({ axis: 0 })
    d.edit(e => {
      e.layer('U'); e.layer('D')
      // upper lid in U, lower lid in D, both on the left; the right side is a copy to receive them
      e.line('ul', { id: 'u1', layer: 'U', position: P(-60, 0) }, { id: 'u2', layer: 'U', position: P(-20, 0) })
      e.line('dl', { id: 'd1', layer: 'D', position: P(-60, 20) }, { id: 'd2', layer: 'D', position: P(-20, 20) })
      e.line('ur', { id: 'r1', layer: 'U', position: P(60, 5) }, { id: 'r2', layer: 'U', position: P(20, 5) })
      e.line('dr', { id: 's1', layer: 'D', position: P(60, 25) }, { id: 's2', layer: 'D', position: P(20, 25) })
    })
    const { ix, setLayers } = setup(d)
    setLayers(['U', 'D'])
    ix.setTool('V')
    ix.pointerDown(P(-40, 0)); ix.pointerUp(P(-40, 0))
    ix.pointerDown(P(-40, 20), { shift: true }); ix.pointerUp(P(-40, 20))
    expect(sel(d).sort()).toEqual(['line:dl', 'line:ul'])
    ix.setMirrorSource()
    ix.pointerDown(P(40, 5)); ix.pointerUp(P(40, 5))
    ix.pointerDown(P(40, 25), { shift: true }); ix.pointerUp(P(40, 25))
    ix.mirrorLink()
    expect(ix.preview().refusal).toBeUndefined()
    const at = (id: string) => d.snapshot().points.find(p => p.id === id)!.position
    expect([at('r1'), at('s1')]).toEqual([P(60, 0), P(60, 20)])
  })
})

describe('focus: the selection on the selected layers, and what survives a focus change (dot 1791556023, 1791556061, 1791556088)', () => {
  it('a drag moves only the selection on the selected layers', () => {
    const { ix, core, setLayers } = setup(), d = core()
    d.edit(e => e.select([{ kind: 'line', id: 'h' }, { kind: 'line', id: 'm' }]))
    setLayers(['L'])
    expect(ix.selection()).toEqual([{ kind: 'line', id: 'h' }])
    ix.setTool('V'); ix.pointerDown(P(50, 0)); ix.pointerUp(P(50, 30))
    expect([pos(d, 'a').y, pos(d, 'x').y]).toEqual([30, 200])
  })

  it('Delete and copy take only the selection on the selected layers; none there is refused', () => {
    const { ix, core, setLayers } = setup(), d = core()
    d.edit(e => e.select([{ kind: 'line', id: 'm' }]))
    setLayers(['L'])
    ix.deleteSelection()
    expect([ix.preview().refusal?.code, d.snapshot().lines.some(l => l.id === 'm')]).toEqual(['select-lines-to-delete', true])
    ix.copy()
    expect(ix.preview().refusal?.code).toBe('select-lines-to-copy')
  })

  it('fill: a small loop of another layer inside a loop of the focus does not hide it', () => {
    const d = new Core()
    d.edit(e => {
      e.layer('L'); e.layer('K')
      e.line('b1', { id: 'b1', layer: 'L', position: P(0, 0) }, { id: 'b2', layer: 'L', position: P(100, 0) }); e.line('b2', 'b2', { id: 'b3', layer: 'L', position: P(50, 100) }); e.line('b3', 'b3', 'b1')
      e.line('s1', { id: 's1', layer: 'K', position: P(40, 20) }, { id: 's2', layer: 'K', position: P(60, 20) }); e.line('s2', 's2', { id: 's3', layer: 'K', position: P(50, 40) }); e.line('s3', 's3', 's1')
    })
    const { ix, setLayers } = setup(d)
    setLayers(['L'])
    ix.setTool('fill'); ix.pointerDown(P(50, 28)) // inside both: K's loop is the smaller
    const filled = d.snapshot().loops.filter(l => l.filled)
    expect(filled.map(l => l.route.map(u => u.line).sort())).toEqual([['b1', 'b2', 'b3']])
  })

  it('a mirror source and a pending cut stay through a focus change; the paste goes to the new current layer', () => {
    const { ix, core, setLayers, setLayer } = setup(), d = core()
    setLayers(['L'])
    ix.setTool('V'); ix.pointerDown(P(50, 0)); ix.pointerUp(P(50, 0))
    ix.setMirrorSource()
    ix.cut()
    setLayers(['K']); setLayer('K')
    expect([ix.preview().mirrorSource.sort(), ix.preview().cut.length]).toEqual([['h', 'v'], 1])
    ix.paste()
    expect(d.snapshot().points.find(p => p.id === 'a')!.layer).toBe('K')
  })
})

describe('S, the selection box (bowen 1791558733, 1791558844)', () => {
  // drawing(): L has h a(0,0)–b(100,0) and v b–c(100,100); K has m x(0,200)–y(100,200); current layer L
  const drag = (ix: Interaction, from: Vec, to: Vec, mods = {}) => { ix.pointerDown(from, mods); ix.pointerMove(to); ix.pointerUp(to) }

  it('the s key; dragged right: only lines wholly inside', () => {
    const { ix, core } = setup()
    ix.key('s')
    expect(ix.tool).toBe('S')
    drag(ix, P(-10, -10), P(110, 50)) // h wholly inside, v only partly
    expect(sel(core())).toEqual(['line:h'])
  })

  it('dragged left: every line it touches', () => {
    const { ix, core } = setup()
    ix.setTool('S')
    drag(ix, P(110, 50), P(-10, -10)) // touches h and v
    expect(sel(core()).sort()).toEqual(['line:h', 'line:v'])
  })

  it('its focus is the current layer only, whatever else is selected', () => {
    const { ix, core, setLayers, setLayer } = setup()
    setLayers(['L', 'K'])
    ix.setTool('S')
    drag(ix, P(-10, -10), P(110, 210))
    expect(sel(core()).sort()).toEqual(['line:h', 'line:v'])
    setLayer('K')
    drag(ix, P(-10, -10), P(110, 210))
    expect(sel(core())).toEqual(['line:m'])
  })

  it('a press on a line still starts a box; Shift adds, Alt removes, a click clears, Esc drops the box', () => {
    const { ix, core } = setup()
    ix.setTool('S')
    drag(ix, P(50, 0), P(-10, 10)) // starts on h: still a box, touching h
    expect(sel(core())).toEqual(['line:h'])
    drag(ix, P(90, -10), P(110, 110), { shift: true })
    expect(sel(core()).sort()).toEqual(['line:h', 'line:v'])
    drag(ix, P(-10, -10), P(110, 50), { alt: true })
    expect(sel(core())).toEqual(['line:v'])
    ix.pointerDown(P(-10, -10)); ix.pointerMove(P(110, 50))
    expect(ix.preview().box).toEqual({ from: P(-10, -10), to: P(110, 50), whole: true })
    ix.key('Escape'); ix.pointerUp(P(110, 50))
    expect([ix.preview().box, sel(core())]).toEqual([undefined, ['line:v']])
    ix.pointerDown(P(300, 300)); ix.pointerUp(P(300, 300))
    expect(sel(core())).toEqual([])
  })

  it('with V or A a press on nothing only clears, as before', () => {
    const { ix, core } = setup()
    core().edit(e => e.select([{ kind: 'line', id: 'h' }]))
    ix.setTool('V')
    expect(ix.pointerDown(P(300, 300))).toBe(false)
    expect([sel(core()), ix.preview().box]).toEqual([[], undefined])
  })
})
