// Independent regression cases written by dot against 11ca75d (Slack file F0C7339FLGL), adapted only
// in `setup` / accessors for the tightened write entry (Editor(initialRecords), read-only `reader`).
// Plus three cases from dot's static review: source propagation through a reference, the store not
// being writable from outside, and overflow of large finite deltas.
import { describe, expect, it } from 'vitest'
import { Editor } from '../src/editor'
import { createApi } from '../src/api'
import { evaluate } from '../src/evaluate'
import { exampleRecords, ids } from '../src/fixture'
import type { FillRecord, ReferenceRecord } from '../src/schema'
function setup() { const e = new Editor(exampleRecords()); return { e, a: createApi(e) } }
const handle = (x: number) => ({ type: 'moveHandle' as const, target: { curveId: ids.C1, anchorId: 'a2' }, handle: 'in' as const, delta: { x, y: 0 } })
const snap = (e: Editor) => JSON.stringify(e.reader.serialize('document'))

describe('independent adversarial review of 11ca75d (dot)', () => {
  it('different edit after undo cannot reuse saved revision identity', () => { const { e, a } = setup(); a.apply(handle(1)); e.save(); e.undo(); a.apply(handle(2)); expect(e.isDirty).toBe(true) })
  it('caught nested batch failure must not resurrect on redo', () => {
    const { e } = setup()
    e.batch('outer', () => { e.apply(handle(1)); try { e.batch('inner', () => { e.apply(handle(10)); throw new Error('reject inner') }) } catch { /* rejected */ } })
    const committed = snap(e); e.undo(); e.redo(); expect(snap(e)).toBe(committed)
  })
  it('zero delta must preserve redo and leave history unchanged', () => { const { e, a } = setup(); a.apply(handle(1)); e.undo(); const before = e.history; const r = a.apply(handle(0)); expect(e.history).toEqual(before); expect(r.written).toBe(false) })
  it('whole L1 translation must include its child reference placement', () => { const { e, a } = setup(); a.apply({ type: 'setContainerFlags', containerId: ids.L2, locked: false }); a.apply({ type: 'transformContainer', containerId: ids.L1, matrix: { a: 1, b: 0, c: 0, d: 1, e: 10, f: 0 } }); expect((e.reader.get(ids.R1) as ReferenceRecord).transform.e).toBe(70) })
  it('cannot create fill in locked L2', () => { const { e, a } = setup(); const before = snap(e); const f = e.reader.get(ids.F) as FillRecord; const r = a.apply({ type: 'createFill', parentId: ids.L2, boundary: f.boundary }); expect(r.ok).toBe(false); expect(snap(e)).toBe(before) })
  it('reference override rejects an anchor outside source subtree', () => { const { a } = setup(); expect(a.apply({ type: 'moveOverride', referenceId: ids.R1, target: { curveId: ids.C1, anchorId: 'a2' }, delta: { x: 1, y: 0 } }).ok).toBe(false) })
  it('nonfinite reference override must be rejected without writing', () => { const { e, a } = setup(); const before = snap(e); const r = a.apply({ type: 'moveOverride', referenceId: ids.R1, target: { curveId: ids.E1, anchorId: 'e2' }, delta: { x: Infinity, y: 0 } }); expect(r.ok).toBe(false); expect(snap(e)).toBe(before) })
  it('preview rejects empty fill boundary before commit', () => { const { a } = setup(); expect(a.preview({ type: 'createFill', parentId: ids.L1, boundary: [] }).ok).toBe(false) })
  it('open rejects a cyclic container graph before any inspect loop', () => { const { e } = setup(); const s = JSON.parse(JSON.stringify(e.save())); s.store[ids.L1].parentId = ids.L1; expect(() => Editor.open(s)).toThrow() })
  it('container transform reports missing target instead of successful no-op', () => { const { a } = setup(); expect(a.apply({ type: 'transformContainer', containerId: 'container:missing' as any, matrix: { a: 1, b: 0, c: 0, d: 1, e: 1, f: 0 } }).ok).toBe(false) })
})

describe('further cases from dot’s static review', () => {
  it('a source edit is visible through the reference (propagation, not just isolation)', () => {
    const { e, a } = setup()
    expect(a.apply({ type: 'moveAnchors', targets: [{ curveId: ids.E1, anchorId: 'e1' }], delta: { x: 2, y: 0 } }).ok).toBe(true)
    const placed = evaluate(e.reader).curves.find((c) => c.address === `${ids.R1}/${ids.E1}`)!
    expect(placed.anchors.e1.p).toEqual({ x: 78, y: 20 }) // mirrored: −(−18) + 60
  })
  it('the store cannot be written from outside the editor', () => {
    const { e } = setup()
    expect((e as any).store).toBeUndefined()
    expect((e.reader as any).put).toBeUndefined()
  })
  it('two large finite deltas that overflow are rejected without writing', () => {
    const { e, a } = setup()
    a.apply({ type: 'moveHandle', target: { curveId: ids.C1, anchorId: 'a2' }, handle: 'in', delta: { x: Number.MAX_VALUE, y: 0 } })
    const before = snap(e)
    const r = a.apply({ type: 'moveHandle', target: { curveId: ids.C1, anchorId: 'a2' }, handle: 'in', delta: { x: Number.MAX_VALUE, y: 0 } })
    expect(r.ok).toBe(false)
    expect(snap(e)).toBe(before)
  })
})
