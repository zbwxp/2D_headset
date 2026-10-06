// dot's round-2 production-mode cases against d533b08 (Slack file F0C6U5538VB), unmodified apart
// from formatting. Run: NODE_ENV=production npm test -- test/contour-d533b08-production-review.test.ts
import { describe, expect, it } from 'vitest'
import { Editor } from '../src/editor'
import { createApi } from '../src/api'
import { exampleRecords, ids } from '../src/fixture'
import type { CurveRecord, FillRecord } from '../src/schema'
function setup() { const e = new Editor(exampleRecords()); return { e, a: createApi(e) } }
const handle = (x: number) => ({ type: 'moveHandle' as const, target: { curveId: ids.C1, anchorId: 'a2' }, handle: 'in' as const, delta: { x, y: 0 } })
const snapshot = (e: Editor) => JSON.stringify(e.reader.serialize('document'))
describe('independent review round 2 of d533b08', () => {
  it('net-zero batch must preserve redo and author revision', () => { const { e, a } = setup(); a.apply(handle(1)); e.undo(); const before = e.history; const rev = e.revision; a.applyBatch('round trip', [handle(1), handle(-1)]); expect(e.history).toEqual(before); expect(e.revision).toBe(rev) })
  it('create cannot overwrite an existing fill in a locked layer', () => { const { e, a } = setup(); const before = snapshot(e); const f = e.reader.get(ids.F) as FillRecord; expect(a.apply({ type: 'createFill', id: ids.F, parentId: ids.L1, boundary: f.boundary }).ok).toBe(false); expect(snapshot(e)).toBe(before) })
  it('open rejects curve-as-parent before traversal can loop', () => { const { e } = setup(); const s = JSON.parse(JSON.stringify(e.save())); s.store[ids.C1].parentId = ids.C1; expect(() => Editor.open(s)).toThrow() })
  it('reader does not permit record mutation even in production', () => { const { e } = setup(); const before = snapshot(e); try { (e.reader.get(ids.C2) as CurveRecord).anchors.b3.p.x = 999 } catch { /* frozen */ } expect(snapshot(e)).toBe(before) })
  it('API inspection tags do not alias author arrays', () => { const { e, a } = setup(); const before = snapshot(e); try { a.find({ tag: '下颌' })[0].tags.push('unauthorized-change') } catch { /* frozen */ } expect(snapshot(e)).toBe(before) })
  it('preview records do not leak mutable original anchor positions', () => { const { e } = setup(); const before = snapshot(e); const p = e.preview(handle(1)); if (p.ok) { try { (p.puts[0] as CurveRecord).anchors.a2.p.x = 999 } catch { /* frozen */ } } expect(snapshot(e)).toBe(before) })
  it('save results cannot mutate the live author document', () => { const { e } = setup(); const before = snapshot(e); const s = e.save(); try { (s.store[ids.C2] as CurveRecord).anchors.b3.p.x = 999 } catch { /* frozen */ } expect(snapshot(e)).toBe(before) })
})
