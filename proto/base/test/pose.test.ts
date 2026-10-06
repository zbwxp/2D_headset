// Thin 0°/90°/30° check (15 §5): forms are offsets on top of the base drawing; 0° is its own form.
import { describe, expect, it } from 'vitest'
import { Editor } from '../src/editor'
import { evaluate } from '../src/evaluate'
import { exampleRecords, ids } from '../src/fixture'
import { evaluateAtYaw, type PoseTrack } from '../src/pose'

function setup() {
  const editor = new Editor(exampleRecords())
  return editor
}
const a2 = `${ids.C1}#a2`

describe('0° / 90° forms and the 30° result', () => {
  it('30° is interpolated from the 0° and 90° forms; fill reads the same moved segment', () => {
    const editor = setup()
    const track: PoseTrack = [
      { yaw: 0, offsets: {} },
      { yaw: 90, offsets: { [a2]: { x: 30, y: -6 } } },
    ]
    const at30 = evaluateAtYaw(editor.reader, track, 30)
    const c1 = at30.curves.find((c) => c.address === ids.C1)!
    expect(c1.anchors.a2.p.x).toBeCloseTo(20, 9)
    expect(c1.anchors.a2.p.y).toBeCloseTo(58, 9)
    const fill = at30.fills.find((f) => f.address === ids.F)!
    expect(fill.cubics[0][3]).toEqual(c1.anchors.a2.p) // s1 ends at the moved a2
  })

  it('the 0° form is a separate form: a non-zero 0° offset does not change the base drawing', () => {
    const editor = setup()
    const track: PoseTrack = [
      { yaw: 0, offsets: { [a2]: { x: 2, y: 0 } } },
      { yaw: 90, offsets: {} },
    ]
    expect(evaluateAtYaw(editor.reader, track, 0).curves.find((c) => c.address === ids.C1)!.anchors.a2.p).toEqual({ x: 12, y: 60 })
    expect(evaluate(editor.reader).curves.find((c) => c.address === ids.C1)!.anchors.a2.p).toEqual({ x: 10, y: 60 })
  })

  it('editing the base drawing propagates to every angle (offset semantics, option 甲)', () => {
    const editor = setup()
    const track: PoseTrack = [{ yaw: 0, offsets: {} }, { yaw: 90, offsets: { [a2]: { x: 30, y: -6 } } }]
    editor.apply({ type: 'moveAnchors', targets: [{ curveId: ids.C1, anchorId: 'a2' }], delta: { x: 1, y: 1 } })
    const p90 = evaluateAtYaw(editor.reader, track, 90).curves.find((c) => c.address === ids.C1)!.anchors.a2.p
    expect(p90).toEqual({ x: 41, y: 55 })
  })
})
