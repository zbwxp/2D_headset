// Read entries for playback batches (docs/playback-tools-checklist.md §1, §3): `previewAt(pose, fn)` is the edit's draft
// read at the pose — equal to the drawing at the pose after the same edit, nothing published; `PoseReader.linesInRect`.
import { describe, it, expect } from 'vitest'
import { Core, save, Refusal, type Vec } from '../src'

const P = (x: number, y = 0): Vec => ({ x, y })
const SIDE = 'view:90,0'
/** ab, bc in L; b at (10, 0) in front, (20, 10) in the side; m in M linked to b. */
function base() {
  const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
  d.edit(e => { e.line('ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(10) }); e.line('bc', 'b', { id: 'c', layer: 'L', position: P(20) }) })
  d.editIn(SIDE, e => e.move([{ id: 'b', target: P(20, 10) }]))
  d.edit(e => { e.layer('M', 'M'); e.line('mn', { id: 'm', layer: 'M', position: P(10, 0.5) }, { id: 'n', layer: 'M', position: P(10, 30) }) })
  d.edit(e => e.link('b', 'm'))
  return d
}
const pose = { yaw: 30, pitch: 0 }

describe('Core.previewAt', () => {
  it('a correction\'s draft read at the pose equals the drawing at the pose after the same edit, linked members included; nothing is published', () => {
    const d = base(), before = save(d)
    const op = (e: Parameters<Parameters<Core['edit']>[0]>[0]) => e.correct(pose, { points: [{ id: 'b', position: P(15, 6) }] })
    const shown = d.previewAt(pose, op)!
    expect(save(d)).toBe(before)
    d.edit(op)
    const after = d.atPose(pose)
    expect(shown.snapshot().points).toEqual(after.snapshot().points)
    expect(shown.geometry().lines).toEqual(after.geometry().lines)
    expect(shown.snapshot().points.find(p => p.id === 'm')!.position).toEqual(shown.snapshot().points.find(p => p.id === 'b')!.position)
  })

  it('throws as the edit would; the drawing untouched', () => {
    const d = base(), before = save(d)
    let err: unknown
    try { d.previewAt({ yaw: 30, pitch: 20 }, e => e.correct({ yaw: 30, pitch: 20 }, { points: [{ id: 'b', position: P(1, 1) }] })) } catch (x) { err = x }
    expect((err as Refusal).code).toBe('correction-off-edge')
    expect(save(d)).toBe(before)
  })
})

describe('PoseReader.linesInRect', () => {
  it('reads the pose\'s geometry: at the side view b\'s lines lie where the side has them', () => {
    const d = base(), r = d.atPose({ yaw: 90, pitch: 0 })
    expect(r.linesInRect(P(15, 5), P(25, 15), false).sort()).toEqual(['ab', 'bc', 'mn']) // m is linked to b
    expect(r.linesInRect(P(-5, -5), P(25, 15), true).sort()).toEqual(['ab', 'bc'])
    expect(d.atPose({ yaw: 0, pitch: 0 }).linesInRect(P(15, 5), P(25, 15), false)).toEqual([])
  })
})
