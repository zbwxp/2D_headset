// Head-turn forms as per-curve pose records (15 §5 thin check, now in the document): offsets on top of
// the base drawing; 0° is its own form; editing the base propagates to every angle.
import { describe, expect, it } from 'vitest'
import { createApi } from '../src/api'
import { Editor } from '../src/editor'
import { evaluate } from '../src/evaluate'
import { exampleRecords, ids } from '../src/fixture'
import { evaluateAtYaw } from '../src/pose'

const setup = () => {
  const editor = new Editor(exampleRecords())
  return { editor, api: createApi(editor) }
}
const key = (api: ReturnType<typeof createApi>, yaw: number, a2: { x: number; y: number } | null) =>
  expect(api.apply({ type: 'setPoseKey', curveId: ids.C1, yaw, offsets: a2 ? { a2 } : {} })).toMatchObject({ ok: true, written: true })

describe('0° / 90° forms and the 30° result', () => {
  it('30° is interpolated from the 0° and 90° forms; fill reads the same moved segment', () => {
    const { editor, api } = setup()
    key(api, 0, null)
    key(api, 90, { x: 30, y: -6 })
    const at30 = evaluateAtYaw(editor.reader, 30)
    const c1 = at30.curves.find((c) => c.address === ids.C1)!
    expect(c1.anchors.a2.p.x).toBeCloseTo(20, 9)
    expect(c1.anchors.a2.p.y).toBeCloseTo(58, 9)
    const fill = at30.fills.find((f) => f.address === ids.F)!
    expect(fill.cubics[0][3]).toEqual(c1.anchors.a2.p) // s1 ends at the moved a2
  })

  it('the 0° form is a separate form: a non-zero 0° offset does not change the base drawing', () => {
    const { editor, api } = setup()
    key(api, 0, { x: 2, y: 0 })
    key(api, 90, null)
    expect(evaluateAtYaw(editor.reader, 0).curves.find((c) => c.address === ids.C1)!.anchors.a2.p).toEqual({ x: 12, y: 60 })
    expect(evaluate(editor.reader).curves.find((c) => c.address === ids.C1)!.anchors.a2.p).toEqual({ x: 10, y: 60 })
  })

  it('editing the base drawing propagates to every angle (offset semantics, option 甲)', () => {
    const { editor, api } = setup()
    key(api, 0, null)
    key(api, 90, { x: 30, y: -6 })
    api.apply({ type: 'moveAnchors', targets: [{ curveId: ids.C1, anchorId: 'a2' }], delta: { x: 1, y: 1 } })
    expect(evaluateAtYaw(editor.reader, 90).curves.find((c) => c.address === ids.C1)!.anchors.a2.p).toEqual({ x: 41, y: 55 })
  })

  it('pose keys are author edits: undoable, lock-checked, validated', () => {
    const { editor, api } = setup()
    key(api, 90, { x: 30, y: -6 })
    expect(editor.history.undo).toEqual(['setPoseKey'])
    api.undo()
    expect(editor.reader.allRecords().some((r) => r.typeName === 'forms')).toBe(false) // stage 1: the head-turn track is the legacy forms record
    // C2 lives in locked L2: its pose cannot be created
    expect(api.apply({ type: 'setPoseKey', curveId: ids.C2, yaw: 90, offsets: { b2: { x: 1, y: 0 } } })).toMatchObject({ ok: false, error: { code: 'LOCKED' } })
    expect(api.apply({ type: 'setPoseKey', curveId: ids.C1, yaw: 90, offsets: { zz: { x: 1, y: 0 } } })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect(api.apply({ type: 'setPoseKey', curveId: ids.C1, yaw: Number.NaN, offsets: {} })).toMatchObject({ ok: false, error: { code: 'INVALID' } })
  })
})
