// Stage 2, package 2 (docs/stage2-plan.md rules 0, 3–5; plan approved by dot 1791680403):
// shape broadcast from the front, fit, the pending mark, and the stage boundary. Each test
// names the plan's test item it covers.
import { describe, it, expect } from 'vitest'
import { Core, save, open, type Vec } from '../src'

const P = (x: number, y = 0): Vec => ({ x, y })
const FRONT = 'view:0,0', SIDE = 'view:90,0', UP = 'view:0,45', CORNER = 'view:90,45'
type Layer = { key: string; points: Record<string, Vec>; lines: Record<string, { ha: Vec; hb: Vec }> }
const layerOf = (d: Core, key: string): Layer => (JSON.parse(save(d)).document.network.shapes.layers as Layer[]).find(l => l.key === key)!
const at = (d: Core, k: string, id: string) => d.in(k).snapshot().points.find(p => p.id === id)!.position
const lineIn = (d: Core, k: string, id: string) => d.in(k).snapshot().lines.find(l => l.id === id)!
const all = (d: Core) => JSON.stringify([d.views().map(k => [k, d.in(k).snapshot(), d.in(k).geometry()]), layerOf(d, 'base:angle')])
const sel = (...ids: string[]) => ids.map(id => ({ kind: 'line' as const, id }))

/** ab, bc in L; the side view hand-adjusted (b moved there). */
function doc() {
  const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
  d.edit(e => { e.line('ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(10) }); e.line('bc', 'b', { id: 'c', layer: 'L', position: P(20, 5) }) })
  d.editIn(SIDE, e => e.move([{ id: 'b', target: P(7, 4) }]))
  return d
}

describe('broadcast (plan tests: broadcast)', () => {
  it('a front move broadcast moves the point by the same difference in all eight other views, hand-adjusted ones included; the baseline takes the front', () => {
    const d = doc()
    const before = new Map(d.views().map(k => [k, at(d, k, 'b')]))
    d.edit(e => e.move([{ id: 'b', target: P(13, 2) }]))
    expect(d.pendingLines().sort()).toEqual(['ab', 'bc'])
    d.edit(e => e.broadcastShape(sel('ab', 'bc')))
    for (const k of d.views()) if (k !== FRONT) { const p = at(d, k, 'b'), q = before.get(k)!; expect([p.x - q.x, p.y - q.y]).toEqual([3, 2]) }
    expect(at(d, SIDE, 'b')).toEqual(P(10, 6)) // the hand-adjusted side view also received it
    expect(layerOf(d, 'base:angle').points.b).toEqual(P(13, 2))
    expect(d.pendingLines()).toEqual([])
  })

  it('a second broadcast moves nothing and adds no undo step; undo restores the views and the baseline together', () => {
    const d = doc()
    d.edit(e => e.move([{ id: 'b', target: P(13, 2) }]))
    const pendingState = all(d)
    d.edit(e => e.broadcastShape(sel('ab')))
    const once = all(d)
    let steps = 0; while (d.canUndo) { d.undo(); steps++ } ; for (let i = 0; i < steps; i++) d.redo()
    d.edit(e => e.broadcastShape(sel('ab')))
    expect(all(d)).toBe(once)
    let after = 0; while (d.canUndo) { d.undo(); after++ } ; for (let i = 0; i < after; i++) d.redo()
    expect(after).toBe(steps)
    d.undo()
    expect(all(d)).toBe(pendingState)
  })

  it('a shared end point of two chosen lines moves once; an unchosen neighbour\'s end follows its point, its handle vector kept', () => {
    const d = doc()
    d.edit(e => e.move([{ id: 'b', target: P(13, 2) }]))
    const sideBc = lineIn(d, SIDE, 'bc')
    d.edit(e => e.broadcastShape(sel('ab'))) // bc shares b, not chosen
    expect(at(d, SIDE, 'b')).toEqual(P(10, 6))
    expect(lineIn(d, SIDE, 'bc').ha).toEqual(sideBc.ha)
    // and chosen together, b still moves once
    const e2 = doc()
    e2.edit(e => e.move([{ id: 'b', target: P(13, 2) }]))
    e2.edit(e => e.broadcastShape(sel('ab', 'bc')))
    expect(at(e2, SIDE, 'b')).toEqual(P(10, 6))
  })

  it('handle differences are vectors from their end point', () => {
    const d = doc()
    d.edit(e => e.moveHandle('ab', 'a', P(4, 4)))
    const side = lineIn(d, SIDE, 'ab').ha
    d.edit(e => e.broadcastShape(sel('ab')))
    const front0 = { x: 10 / 3, y: 0 }
    expect(lineIn(d, SIDE, 'ab').ha).toEqual({ x: side.x + 4 - front0.x, y: side.y + 4 - front0.y })
  })

  it('is refused off the front, and refused whole for a locked line in any view', () => {
    const d = doc()
    d.edit(e => e.move([{ id: 'b', target: P(13, 2) }]))
    expect(() => d.editIn(SIDE, e => e.broadcastShape(sel('ab')))).toThrow(/broadcast-from-front/)
    d.edit(e => e.lineState('bc', { locked: true }))
    const before = all(d)
    expect(() => d.edit(e => e.broadcastShape(sel('ab')))).toThrow(/Locked lines would change \(bc\)/) // b is bc's end too
    expect(all(d)).toBe(before)
  })
})

describe('fit (plan tests: fit)', () => {
  it('the picture is unchanged, the mark clears, and undo brings back the pending difference', () => {
    const d = doc()
    d.edit(e => e.move([{ id: 'b', target: P(13, 2) }]))
    const pictures = JSON.stringify(d.views().map(k => [d.in(k).snapshot(), d.in(k).geometry()]))
    d.edit(e => e.fit(sel('ab', 'bc')))
    expect(JSON.stringify(d.views().map(k => [d.in(k).snapshot(), d.in(k).geometry()]))).toBe(pictures)
    expect(d.pendingLines()).toEqual([])
    d.undo()
    expect(d.pendingLines().sort()).toEqual(['ab', 'bc'])
  })

  it('keeps a legal coincidence: a fit-only edit settles nothing', () => {
    const d = doc()
    d.editIn(SIDE, e => e.move([{ id: 'c', target: P(50, 50) }]))
    d.edit(e => e.line('xy', { id: 'x', layer: 'L', position: P(50, 50) }, { id: 'y', layer: 'L', position: P(60, 60) }))
    d.editIn(SIDE, e => e.fit(sel('xy')))
    expect(d.in(SIDE).snapshot().points.map(p => p.id).sort()).toEqual(['a', 'b', 'c', 'x', 'y'])
  })
})

describe('the stage boundary (plan tests: stage boundary; dot 1791680403)', () => {
  it('with a move or a structural edit, or two of them, refused whole; with selections, allowed', () => {
    const d = doc()
    d.edit(e => e.move([{ id: 'b', target: P(13, 2) }]))
    const before = all(d)
    expect(() => d.edit(e => { e.move([{ id: 'a', target: P(1, 1) }]); e.broadcastShape(sel('ab')) })).toThrow(/stage2-alone/)
    expect(() => d.edit(e => { e.broadcastShape(sel('ab')); e.split('bc', 0.5, 'm', 'p1', 'p2') })).toThrow(/stage2-alone/)
    expect(() => d.edit(e => { e.fit(sel('ab')); e.broadcastShape(sel('bc')) })).toThrow(/stage2-alone/)
    expect(() => d.edit(e => { e.broadcastShape(sel('ab')); e.broadcastShape(sel('ab')) })).toThrow(/stage2-alone/) // counted by calls
    expect(all(d)).toBe(before)
    d.edit(e => { e.select(sel('ab')); e.broadcastShape() })
    // bc's only pending change was its shared end b, which the broadcast carried to every view
    expect(d.pendingLines()).toEqual([])
  })
})

describe('linked end points (plan tests: links)', () => {
  /** ab in L, qr in M; a and q linked; both moved at the front, so both pending. */
  function linked() {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => { e.layer('M', 'M'); e.line('ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(10) }); e.line('qr', { id: 'q', layer: 'M', position: P(0) }, { id: 'r', layer: 'M', position: P(10, 30) }) })
    d.edit(e => e.link('a', 'q'))
    d.edit(e => e.fit(sel('ab', 'qr')))
    d.edit(e => e.move([{ id: 'a', target: P(0, 10) }])) // the link moves q with it at the front
    return d
  }

  it('broadcasting one of two linked lines alone is refused; so is a fit of one side; both together move both by the same difference and consume both baselines', () => {
    const d = linked()
    expect(d.pendingLines().sort()).toEqual(['ab', 'qr'])
    expect(() => d.edit(e => e.broadcastShape(sel('ab')))).toThrow(/broadcast-link-incomplete: point a is linked to q/)
    expect(() => d.edit(e => e.broadcastShape(sel('qr')))).toThrow(/broadcast-link-incomplete/)
    expect(() => d.edit(e => e.fit(sel('ab')))).toThrow(/fit-link-incomplete/)
    d.edit(e => e.broadcastShape(sel('ab', 'qr')))
    for (const k of d.views()) { expect(at(d, k, 'a')).toEqual(at(d, k, 'q')) ; expect(at(d, k, 'a').y).toBe(at(d, FRONT, 'a').y) }
    expect(d.pendingLines()).toEqual([])
    const once = all(d)
    d.edit(e => e.broadcastShape(sel('ab', 'qr')))
    expect(all(d)).toBe(once)
  })

  it('linked points with different pending changes are refused, naming both', () => {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => { e.layer('M', 'M'); e.line('ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(10) }); e.line('qr', { id: 'q', layer: 'M', position: P(0, 40) }, { id: 'r', layer: 'M', position: P(10, 40) }) })
    d.edit(e => e.link('a', 'q')) // q moved onto a in every view, not in the baseline
    expect(() => d.edit(e => e.broadcastShape(sel('ab', 'qr')))).toThrow(/broadcast-link-mismatch: linked points a and q/)
  })
})

describe('springs and zero differences (plan tests: springs; zero difference, dot 1791680326)', () => {
  it('broadcasting one line whose end has a smooth join with an unchosen line settles that join in each target view', () => {
    const d = doc()
    d.edit(e => e.join('b', 'ab', 'bc', { mode: 'smooth' }))
    d.edit(e => e.fit(sel('ab', 'bc')))
    d.edit(e => e.moveHandle('ab', 'b', P(-3, 3)))
    d.edit(e => e.fit(sel('bc')))
    d.edit(e => e.broadcastShape(sel('ab')))
    for (const k of d.views()) {
      const ab = lineIn(d, k, 'ab'), bc = lineIn(d, k, 'bc')
      expect(Math.abs(ab.hb.x * bc.ha.y - ab.hb.y * bc.ha.x)).toBeLessThan(1e-6)
    }
  })

  it('an all-zero broadcast changes no view and adds no undo step, even over a non-aligned held smooth join', () => {
    const d = doc()
    d.editIn(UP, e => { e.join('b', 'ab', 'bc', { mode: 'smooth' }); e.moveHandle('ab', 'b', P(-2, 5)); e.moveHandle('bc', 'a', P(4, 4)) })
    d.edit(e => e.fit(sel('ab', 'bc')))
    const before = all(d), canUndo = d.canUndo
    let steps = 0; while (d.canUndo) { d.undo(); steps++ } ; for (let i = 0; i < steps; i++) d.redo()
    d.edit(e => e.broadcastShape(sel('ab')))
    expect(all(d)).toBe(before)
    let after = 0; while (d.canUndo) { d.undo(); after++ } ; for (let i = 0; i < after; i++) d.redo()
    expect([after, d.canUndo]).toEqual([steps, canUndo])
  })
})

describe('the mark and save / open (plan tests: mark; save, dot 1791680810)', () => {
  it('the mark lists exactly the pending lines', () => {
    const d = doc()
    expect(d.pendingLines()).toEqual([])
    d.edit(e => e.moveHandle('bc', 'b', P(1, 1)))
    expect(d.pendingLines()).toEqual(['bc'])
    d.editIn(SIDE, e => e.move([{ id: 'a', target: P(-9, 9) }])) // a side-view edit is not pending
    expect(d.pendingLines()).toEqual(['bc'])
  })

  it('reopening keeps the baseline value by value, and a broadcast after reopening gives the same result', () => {
    const d = doc()
    d.edit(e => e.move([{ id: 'b', target: P(13, 2) }]))
    const o = open(save(d))
    expect(layerOf(o, 'base:angle')).toEqual(layerOf(d, 'base:angle'))
    expect(o.pendingLines()).toEqual(d.pendingLines())
    for (const x of [d, o]) x.edit(e => e.broadcastShape(sel('ab', 'bc')))
    expect(d.views().map(k => JSON.stringify(o.in(k).snapshot().points))).toEqual(d.views().map(k => JSON.stringify(d.in(k).snapshot().points)))
    expect(layerOf(o, 'base:angle')).toEqual(layerOf(d, 'base:angle'))
    void CORNER
  })
})
