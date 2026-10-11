// Stage 3b, package 5: `correctionEdge`, the pure query the bench reads (dot 1791696958). It
// answers with core's own rule (`edgeAt`), so it agrees with what `correct` does at that pose.
import { describe, it, expect } from 'vitest'
import { Core, correctionEdge, Refusal } from '../src'

describe('correctionEdge', () => {
  it('on a line: the edge, its views and t; at a view, inside a cell, out of range: the refusal correct would give', () => {
    expect(correctionEdge({ yaw: 30, pitch: 0 })).toEqual({ edge: 'view:0,0>view:90,0', inner: 'view:0,0', outer: 'view:90,0', t: 30 / 90 })
    expect(correctionEdge({ yaw: -90, pitch: 9 })).toEqual({ edge: 'view:-90,0>view:-90,45', inner: 'view:-90,0', outer: 'view:-90,45', t: 0.2 })
    expect(correctionEdge({ yaw: 90, pitch: 45 })).toMatchObject({ code: 'correction-at-view' })
    expect(correctionEdge({ yaw: 30, pitch: 20 })).toMatchObject({ code: 'correction-off-edge' })
    expect(correctionEdge({ yaw: 45, pitch: Number.MIN_VALUE * 45 })).toMatchObject({ code: 'correction-off-edge' })
    expect(correctionEdge({ yaw: NaN, pitch: 0 })).toMatchObject({ code: 'pose-out-of-range' })
  })

  it('agrees with correct: where it answers an edge, correct runs; where it answers a refusal, correct refuses with the same code', () => {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => e.line('ab', { id: 'a', layer: 'L', position: { x: 0, y: 0 } }, { id: 'b', layer: 'L', position: { x: 10, y: 0 } }))
    for (const pose of [{ yaw: 30, pitch: 0 }, { yaw: 0, pitch: -20 }, { yaw: 0, pitch: 0 }, { yaw: 30, pitch: 20 }, { yaw: 100, pitch: 0 }]) {
      const q = correctionEdge(pose)
      let code: string | undefined
      try { d.edit(e => e.correct(pose, { points: [] })) } catch (x) { code = (x as Refusal).code }
      expect([pose, 'code' in q ? q.code : undefined]).toEqual([pose, code])
    }
  })
})
