// `clearCorrections(controls)` (docs/correction-cleanup-checklist.md §2; bowen 1791993161): every knot of the given
// controls, on every edge and both axes, removed in one undo step; a point stands for its link component; a view that
// a correction moved stays; other controls keep theirs.
import { describe, it, expect } from 'vitest'
import { Core, save, open, Refusal, type Vec } from '../src'

const P = (x: number, y = 0): Vec => ({ x, y })
const SIDE = 'view:90,0', UP = 'view:0,45'
type Anim = { points: Record<string, Record<string, unknown>>; handles: Record<string, Record<string, Record<string, unknown>>> }
const anim = (d: Core): Anim => JSON.parse(save(d)).document.animation
function code(f: () => void): string {
  try { f() } catch (x) { return x instanceof Refusal ? x.code : (x as Error).message }
  return 'no refusal'
}

/** ab, bc in L; b and c moved in the side and upper views so every edge from the front has a span. */
function base() {
  const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
  d.edit(e => { e.line('ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(10) }); e.line('bc', 'b', { id: 'c', layer: 'L', position: P(20) }) })
  d.editIn(SIDE, e => { e.move([{ id: 'b', target: P(20, 10) }, { id: 'c', target: P(30, 5) }]); e.moveHandle('ab', 'a', P(5, 5)) })
  d.editIn(UP, e => e.move([{ id: 'b', target: P(12, -8) }, { id: 'c', target: P(25, -6) }]))
  // b corrected on two edges (yaw and pitch), c on one, ab's handle on one
  d.edit(e => e.correct({ yaw: 30, pitch: 0 }, { points: [{ id: 'b', position: P(17, 2) }] }))
  d.edit(e => e.correct({ yaw: 60, pitch: 0 }, { points: [{ id: 'b', position: P(19, 6) }] }))
  d.edit(e => e.correct({ yaw: 0, pitch: 15 }, { points: [{ id: 'b', position: P(11, -1) }] }))
  d.edit(e => e.correct({ yaw: 30, pitch: 0 }, { points: [{ id: 'c', position: P(24, 1) }] }))
  d.edit(e => e.correct({ yaw: 30, pitch: 0 }, { handles: [{ line: 'ab', end: 'a', vector: P(1, 3) }] }))
  return d
}

describe('clearCorrections', () => {
  it('a point loses every knot on every edge and axis; other controls keep theirs; one undo step brings them back', () => {
    const d = base(), before = anim(d)
    expect(Object.keys(before.points.b!).length).toBeGreaterThan(1)
    d.edit(e => e.clearCorrections([{ kind: 'point', id: 'b' }]))
    const after = anim(d)
    expect(after.points.b).toBeUndefined()
    expect([after.points.c, after.handles.ab]).toEqual([before.points.c, before.handles.ab])
    d.undo()
    expect(anim(d)).toEqual(before)
  })

  it('a curve\'s controls at once (points and handle ends): all gone; the file opens; views a correction moved stay', () => {
    const d = base(), side = d.in(SIDE).snapshot()
    d.edit(e => e.clearCorrections([{ kind: 'point', id: 'a' }, { kind: 'point', id: 'b' }, { kind: 'point', id: 'c' }, { kind: 'handle', line: 'ab', end: 'a' }, { kind: 'handle', line: 'ab', end: 'b' }, { kind: 'handle', line: 'bc', end: 'a' }, { kind: 'handle', line: 'bc', end: 'b' }]))
    expect(anim(d)).toEqual({ points: {}, handles: {} })
    expect(d.in(SIDE).snapshot().points).toEqual(side.points)
    expect(anim(open(save(d)))).toEqual(anim(d))
  })

  it('a point stands for its link component: the linked member loses the same knots, the sets stay identical', () => {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => { e.line('ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(10) }); e.layer('M', 'M'); e.line('mn', { id: 'm', layer: 'M', position: P(10, 0.5) }, { id: 'n', layer: 'M', position: P(10, 30) }) })
    d.edit(e => e.link('b', 'm'))
    d.editIn(SIDE, e => e.move([{ id: 'b', target: P(20, 10) }]))
    d.edit(e => e.correct({ yaw: 30, pitch: 0 }, { points: [{ id: 'b', position: P(17, 2) }] }))
    expect(anim(d).points.m).toEqual(anim(d).points.b)
    expect(anim(d).points.b).toBeDefined()
    d.edit(e => e.clearCorrections([{ kind: 'point', id: 'm' }]))
    expect([anim(d).points.b, anim(d).points.m]).toEqual([undefined, undefined])
    expect(anim(open(save(d)))).toEqual(anim(d))
  })

  it('refused: nothing to remove, an unknown point, line or end, not a list; nothing written', () => {
    const d = base(), before = save(d)
    expect(code(() => d.edit(e => e.clearCorrections([{ kind: 'point', id: 'a' }])))).toBe('uncorrect-none')
    expect(code(() => d.edit(e => e.clearCorrections([])))).toBe('uncorrect-none')
    expect(code(() => d.edit(e => e.clearCorrections([{ kind: 'point', id: 'zz' }])))).toBe('correction-bad-target')
    expect(code(() => d.edit(e => e.clearCorrections([{ kind: 'handle', line: 'zz', end: 'a' }])))).toBe('correction-bad-target')
    expect(code(() => d.edit(e => e.clearCorrections([{ kind: 'handle', line: 'ab', end: 'c' as 'a' }])))).toBe('correction-bad-target')
    expect(code(() => d.edit(e => e.clearCorrections('b' as never)))).toBe('correction-bad-target')
    expect(save(d)).toBe(before)
  })
})
