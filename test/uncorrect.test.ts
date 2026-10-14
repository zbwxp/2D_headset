// Deleting a correction (docs/playback-edit-checklist.md §4): `uncorrect(pose, control)` removes the control's knots at
// the pose's progress on the pose's edge, both axes, for a point's whole link component; a view a correction moved stays.
import { describe, it, expect } from 'vitest'
import { Core, save, open, Refusal, type Vec } from '../src'

const P = (x: number, y = 0): Vec => ({ x, y })
const SIDE = 'view:90,0', E_FS = 'view:0,0>view:90,0'
type Knots = [number, number][]
type Anim = { points: Record<string, Record<string, { x?: Knots; y?: Knots }>>; handles: Record<string, Record<string, Record<string, { x?: Knots; y?: Knots }>>> }
const anim = (d: Core): Anim => JSON.parse(save(d)).document.animation
const pos = (d: Core, pose: { yaw: number; pitch: number }, id: string) => d.atPose(pose).snapshot().points.find(p => p.id === id)!.position
const at = (d: Core, k: string, id: string) => d.in(k).snapshot().points.find(p => p.id === id)!.position
function code(f: () => void): string {
  try { f() } catch (x) { return x instanceof Refusal ? x.code : (x as Error).message }
  return 'no refusal'
}

/** ab, bc in L; b moved in the side view: front (10, 0), side (20, 10); a and c equal in every view. */
function base() {
  const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
  d.edit(e => { e.line('ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(10) }); e.line('bc', 'b', { id: 'c', layer: 'L', position: P(20) }) })
  d.editIn(SIDE, e => e.move([{ id: 'b', target: P(20, 10) }]))
  return d
}
const Y45 = { yaw: 45, pitch: 0 }

describe('uncorrect', () => {
  it('removes both axes at the pose: the drawing there is the linear blend again, the data in normal form; one undo step', () => {
    const d = base(), linear = pos(d, Y45, 'b')
    d.edit(e => e.correct(Y45, { points: [{ id: 'b', position: P(18, 2) }] }))
    const corrected = anim(d)
    expect(corrected.points.b![E_FS]).toBeDefined()
    d.edit(e => e.uncorrect(Y45, { kind: 'point', id: 'b' }))
    expect(anim(d)).toEqual({ points: {}, handles: {} })
    expect(pos(d, Y45, 'b')).toEqual(linear)
    d.undo()
    expect(anim(d)).toEqual(corrected)
  })

  it('a knot at another progress on the same edge is kept', () => {
    const d = base()
    d.edit(e => e.correct({ yaw: 30, pitch: 0 }, { points: [{ id: 'b', position: P(17, 1) }] }))
    d.edit(e => e.correct({ yaw: 60, pitch: 0 }, { points: [{ id: 'b', position: P(19, 4) }] }))
    const at60 = pos(d, { yaw: 60, pitch: 0 }, 'b')
    d.edit(e => e.uncorrect({ yaw: 30, pitch: 0 }, { kind: 'point', id: 'b' }))
    const knots = anim(d).points.b![E_FS]!
    expect([knots.x!.map(k => k[0]), knots.y!.map(k => k[0])]).toEqual([[2 / 3], [2 / 3]])
    expect(pos(d, { yaw: 60, pitch: 0 }, 'b')).toEqual(at60)
  })

  it('a point stands for its link component: the linked member loses the same knots, the sets stay identical and the file opens', () => {
    const d = base()
    d.edit(e => { e.layer('M', 'M'); e.line('mn', { id: 'm', layer: 'M', position: P(10, 0.5) }, { id: 'n', layer: 'M', position: P(10, 30) }) })
    d.edit(e => e.link('b', 'm'))
    d.edit(e => e.correct(Y45, { points: [{ id: 'm', position: P(18, 2) }] }))
    d.edit(e => e.uncorrect(Y45, { kind: 'point', id: 'b' }))
    expect(anim(d).points).toEqual({})
    expect(anim(open(save(d)))).toEqual(anim(d))
  })

  it('a handle: only that end loses its knots', () => {
    const d = base()
    d.editIn(SIDE, e => e.moveHandle('ab', 'a', P(5, 5)))
    d.edit(e => e.correct(Y45, { handles: [{ line: 'ab', end: 'a', vector: P(1, 4) }] }))
    expect(Object.keys(anim(d).handles.ab!)).toEqual(['a'])
    d.edit(e => e.uncorrect(Y45, { kind: 'handle', line: 'ab', end: 'a' }))
    expect(anim(d).handles).toEqual({})
  })

  it('a view the correction moved stays where it is; only the knots go', () => {
    const d = base()
    d.edit(e => e.correct(Y45, { points: [{ id: 'c', position: P(20, 3) }] })) // c equal in both views: the side view moves
    const moved = at(d, SIDE, 'c')
    expect(moved.y).not.toBe(0)
    d.edit(e => e.uncorrect(Y45, { kind: 'point', id: 'c' }))
    expect(anim(d).points).toEqual({})
    expect(at(d, SIDE, 'c')).toEqual(moved)
  })

  it('refused at a view, inside a cell, where there is no knot, and for a missing control; nothing written', () => {
    const d = base()
    d.edit(e => e.correct(Y45, { points: [{ id: 'b', position: P(18, 2) }] }))
    const before = save(d)
    expect(code(() => d.edit(e => e.uncorrect({ yaw: 90, pitch: 0 }, { kind: 'point', id: 'b' })))).toBe('correction-at-view')
    expect(code(() => d.edit(e => e.uncorrect({ yaw: 30, pitch: 20 }, { kind: 'point', id: 'b' })))).toBe('correction-off-edge')
    expect(code(() => d.edit(e => e.uncorrect({ yaw: 30, pitch: 0 }, { kind: 'point', id: 'b' })))).toBe('uncorrect-none')
    expect(code(() => d.edit(e => e.uncorrect(Y45, { kind: 'point', id: 'a' })))).toBe('uncorrect-none')
    expect(code(() => d.edit(e => e.uncorrect(Y45, { kind: 'point', id: 'zz' })))).toBe('correction-bad-target')
    expect(save(d)).toBe(before)
  })
})
