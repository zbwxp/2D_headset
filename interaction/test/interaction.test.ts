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
function setup(d = drawing()) {
  let current = d, n = 0, layer = 'L'
  const ix = createInteraction({ core: () => current, newId: p => `${p}${++n}`, layer: () => layer, tolerance: () => 3 })
  return { ix, core: () => current, open: (c: Core) => { current = c; ix.drawingChanged() }, setLayer: (l: string) => { layer = l } }
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
