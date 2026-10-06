// Step-1 acceptance for the route-B slice (docs/design/architecture/15 §2, §5; 11 §1, §5, §6).
import { describe, expect, it } from 'vitest'
import { createApi } from '../src/api'
import { Editor } from '../src/editor'
import { exampleRecords, ids } from '../src/fixture'
import type { CurveRecord, ReferenceRecord } from '../src/schema'

function setup() {
  const editor = new Editor(exampleRecords())
  return { editor, api: createApi(editor) }
}
const curve = (e: Editor, id: CurveRecord['id']) => e.reader.get(id) as CurveRecord
const snapshot = (e: Editor) => JSON.stringify(e.reader.serialize('document'))

describe('lock + linkage rule (same for every entry point)', () => {
  it('dragging a3 is rejected as a whole when the linked b3 is in locked L2; nothing is written', () => {
    const { editor, api } = setup()
    const before = snapshot(editor)
    const r = api.apply({ type: 'moveAnchors', targets: [{ curveId: ids.C1, anchorId: 'a3' }], delta: { x: 5, y: 0 } })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('LOCKED')
      expect(r.error.objects).toContain(`${ids.C2}#b3`)
      expect(r.error.objects).toContain(ids.J)
      expect(r.written).toBe(false)
    }
    expect(snapshot(editor)).toBe(before)
    expect(editor.history.undo).toEqual([])
  })

  it('moving the whole layer L1 hits the same check (no bypass)', () => {
    const { editor, api } = setup()
    const r = api.apply({ type: 'transformContainer', containerId: ids.L1, matrix: { a: 1, b: 0, c: 0, d: 1, e: 10, f: 0 } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('LOCKED')
    expect(editor.history.undo).toEqual([])
  })

  it('after unlocking, a3 and b3 move together and one undo restores both', () => {
    const { editor, api } = setup()
    expect(api.apply({ type: 'setContainerFlags', containerId: ids.L2, locked: false }).ok).toBe(true)
    const before = snapshot(editor)
    const r = api.apply({ type: 'moveAnchors', targets: [{ curveId: ids.C1, anchorId: 'a3' }], delta: { x: 5, y: -2 } })
    expect(r.ok && r.written).toBe(true)
    expect(curve(editor, ids.C1).anchors.a3.p).toEqual({ x: 65, y: 98 })
    expect(curve(editor, ids.C2).anchors.b3.p).toEqual({ x: 65, y: 98 })
    editor.undo()
    expect(snapshot(editor)).toBe(before)
    editor.redo()
    expect(curve(editor, ids.C2).anchors.b3.p).toEqual({ x: 65, y: 98 })
  })
})

describe('V group transform (non-uniform scale) paired with A handle drag', () => {
  it('non-uniform scale of L1 bakes into anchors and handles; linked anchors in L2 follow', () => {
    const { editor, api } = setup()
    api.apply({ type: 'setContainerFlags', containerId: ids.L2, locked: false })
    const r = api.apply({ type: 'transformContainer', containerId: ids.L1, matrix: { a: 2, b: 0, c: 0, d: 0.5, e: 0, f: 0 } })
    expect(r.ok && r.written).toBe(true)
    const c1 = curve(editor, ids.C1)
    expect(c1.anchors.a2.p).toEqual({ x: 20, y: 30 })
    expect(c1.anchors.a2.hOut).toEqual({ x: 0, y: 10 }) // handle scaled by the linear part
    expect(curve(editor, ids.C2).anchors.b3.p).toEqual({ x: 120, y: 50 }) // follows a3
    expect(curve(editor, ids.C2).anchors.b2.p).toEqual({ x: 80, y: 50 }) // not linked → unchanged
    expect(editor.history.undo).toHaveLength(2)
  })

  it('A drag of a handle changes only that handle', () => {
    const { editor, api } = setup()
    const r = api.apply({ type: 'moveHandle', target: { curveId: ids.C1, anchorId: 'a2' }, handle: 'out', delta: { x: 3, y: 0 } })
    expect(r.ok && r.written).toBe(true)
    expect(curve(editor, ids.C1).anchors.a2.hOut).toEqual({ x: 3, y: 20 })
    expect(curve(editor, ids.C1).anchors.a2.p).toEqual({ x: 10, y: 60 })
  })
})

describe('fill closure', () => {
  it('a boundary closed by real connections is accepted', () => {
    const { api } = setup()
    const r = api.preview({
      type: 'createFill',
      parentId: ids.L1,
      boundary: [
        { curveId: ids.C1, segmentId: 's1', dir: 1 },
        { curveId: ids.C1, segmentId: 's2', dir: 1 },
        { curveId: ids.C2, segmentId: 's4', dir: -1 },
        { curveId: ids.C2, segmentId: 's3', dir: -1 },
      ],
    })
    expect(r.ok).toBe(true)
  })

  it('a gap is reported as FILL_NOT_CLOSED with the two anchors, never bridged silently', () => {
    const { api } = setup()
    const r = api.apply({
      type: 'createFill',
      parentId: ids.L1,
      boundary: [
        { curveId: ids.C1, segmentId: 's1', dir: 1 },
        { curveId: ids.C1, segmentId: 's2', dir: 1 },
        { curveId: ids.C2, segmentId: 's4', dir: -1 }, // missing s3 → ends at b2, not b1/a1
      ],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('FILL_NOT_CLOSED')
      expect(r.error.objects).toEqual([`${ids.C2}#b2`, `${ids.C1}#a1`])
    }
  })
})

describe('reference placed twice: source edit vs override', () => {
  it('override changes only the reference; source edit is visible through it', () => {
    const { editor, api } = setup()
    const r = api.apply({ type: 'moveOverride', referenceId: ids.R1, target: { curveId: ids.E1, anchorId: 'e2' }, delta: { x: 0, y: 4 } })
    expect(r.ok).toBe(true)
    const ref = editor.reader.get(ids.R1) as ReferenceRecord
    expect(ref.overrides[`${ids.E1}#e2`]).toEqual({ x: -30, y: 54 })
    expect(curve(editor, ids.E1).anchors.e2.p).toEqual({ x: -30, y: 50 }) // source untouched
  })
})

describe('preview, batch, save/reopen', () => {
  it('preview writes nothing', () => {
    const { editor, api } = setup()
    const before = snapshot(editor)
    api.preview({ type: 'moveHandle', target: { curveId: ids.C1, anchorId: 'a2' }, handle: 'in', delta: { x: 9, y: 9 } })
    expect(snapshot(editor)).toBe(before)
  })

  it('a batch is one undo step; a failing batch leaves nothing written', () => {
    const { editor, api } = setup()
    const before = snapshot(editor)
    const ok = api.applyBatch('two handles', [
      { type: 'moveHandle', target: { curveId: ids.C1, anchorId: 'a2' }, handle: 'in', delta: { x: 1, y: 0 } },
      { type: 'moveHandle', target: { curveId: ids.C1, anchorId: 'a2' }, handle: 'out', delta: { x: 1, y: 0 } },
    ])
    expect(Array.isArray(ok)).toBe(true)
    expect(editor.history.undo).toEqual(['two handles'])
    editor.undo()
    expect(snapshot(editor)).toBe(before)

    const bad = api.applyBatch('handle then locked anchor', [
      { type: 'moveHandle', target: { curveId: ids.C1, anchorId: 'a2' }, handle: 'in', delta: { x: 1, y: 0 } },
      { type: 'moveAnchors', targets: [{ curveId: ids.C1, anchorId: 'a3' }], delta: { x: 1, y: 0 } }, // LOCKED via J
    ])
    expect(Array.isArray(bad)).toBe(false)
    expect(snapshot(editor)).toBe(before)
    expect(editor.history.undo).toEqual([])
  })

  it('save → reopen gives the same author data; undo back to the save point clears dirty', () => {
    const { editor, api } = setup()
    api.apply({ type: 'moveHandle', target: { curveId: ids.C1, anchorId: 'a2' }, handle: 'in', delta: { x: 2, y: 0 } })
    const saved = editor.save()
    expect(editor.isDirty).toBe(false)
    const reopened = Editor.open(JSON.parse(JSON.stringify(saved)))
    expect(snapshot(reopened)).toBe(snapshot(editor))
    api.apply({ type: 'moveHandle', target: { curveId: ids.C1, anchorId: 'a2' }, handle: 'in', delta: { x: 2, y: 0 } })
    expect(editor.isDirty).toBe(true)
    editor.undo()
    expect(editor.isDirty).toBe(false)
  })
})

describe('AI inspect / find', () => {
  it('returns stable address, semantic name, tags, and effective lock', () => {
    const { api } = setup()
    const hits = api.find({ tag: '下颌' })
    expect(hits.map((h) => h.name).sort()).toEqual(['右片·外下颌', '左片·外下颌'])
    const right = hits.find((h) => h.name === '右片·外下颌')!
    expect(right.address).toBe(ids.C2)
    expect(right.locked).toBe(true)
    expect(right.connections).toEqual([ids.J, ids.J0])
    expect(api.find({ tag: '不存在的标签' })).toEqual([])
  })
})
