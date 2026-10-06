// dot's production-mode review of d533b08 (four mechanisms, 7 cases). Run also with
// NODE_ENV=production: @tldraw/store's devFreeze is off there, so only our own freezing protects us.
import { describe, expect, it } from 'vitest'
import { createApi } from '../src/api'
import { Editor } from '../src/editor'
import { exampleRecords, ids } from '../src/fixture'
import type { CurveRecord, FillRecord } from '../src/schema'

const setup = () => {
  const e = new Editor(exampleRecords())
  return { e, a: createApi(e) }
}
const snap = (e: Editor) => JSON.stringify(e.reader.serialize('document'))
const tryMutate = (fn: () => void) => {
  try {
    fn()
  } catch {
    /* frozen objects throw in strict mode — that is the desired outcome */
  }
}

describe('1. read-only entry points never hand out mutable document objects', () => {
  it('reader.get', () => {
    const { e } = setup()
    const before = snap(e)
    tryMutate(() => ((e.reader.get(ids.C1) as CurveRecord).anchors.a2.p.x = 999))
    expect(snap(e)).toBe(before)
  })
  it('inspect tags', () => {
    const { e, a } = setup()
    const before = snap(e)
    tryMutate(() => a.inspect().nodes.find((n) => n.address === ids.C1)!.tags.push('hacked'))
    expect(snap(e)).toBe(before)
  })
  it('preview puts', () => {
    const { e, a } = setup()
    const before = snap(e)
    const pv = a.preview({ type: 'moveOverride', referenceId: ids.R1, target: { curveId: ids.E1, anchorId: 'e2' }, delta: { x: 1, y: 0 } })
    if (pv.ok) tryMutate(() => ((pv.puts[0] as any).transform.e = 999))
    expect(snap(e)).toBe(before)
  })
  it('save result', () => {
    const { e } = setup()
    const before = snap(e)
    const saved = e.save() as any
    tryMutate(() => (saved.store[ids.C1].anchors.a1.p.x = 999))
    expect(snap(e)).toBe(before)
  })
})

describe('2. a batch whose net effect is nothing leaves history and redo alone', () => {
  it('+1 then −1', () => {
    const { e, a } = setup()
    a.apply({ type: 'moveHandle', target: { curveId: ids.C1, anchorId: 'a2' }, handle: 'in', delta: { x: 5, y: 0 } })
    e.undo()
    const before = e.history
    a.applyBatch('net zero', [
      { type: 'moveHandle', target: { curveId: ids.C1, anchorId: 'a2' }, handle: 'in', delta: { x: 1, y: 0 } },
      { type: 'moveHandle', target: { curveId: ids.C1, anchorId: 'a2' }, handle: 'in', delta: { x: -1, y: 0 } },
    ])
    expect(e.history).toEqual(before)
  })
})

describe('3. creating with an existing id is a conflict, not an overwrite', () => {
  it('createFill(id = F) into L1 is rejected and F stays in locked L2', () => {
    const { e, a } = setup()
    const before = snap(e)
    const f = e.reader.get(ids.F) as FillRecord
    const r = a.apply({ type: 'createFill', id: ids.F, parentId: ids.L1, boundary: f.boundary })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('ID_CONFLICT')
    expect(snap(e)).toBe(before)
  })
})

describe('4. open checks the TYPE of referenced records', () => {
  it('a curve that is its own parent is rejected', () => {
    const { e } = setup()
    const s = JSON.parse(JSON.stringify(e.save()))
    s.store[ids.C1].parentId = ids.C1
    expect(() => Editor.open(s)).toThrow(/not a container/)
  })
  it('a reference whose source is a curve is rejected', () => {
    const { e } = setup()
    const s = JSON.parse(JSON.stringify(e.save()))
    s.store[ids.R1].sourceId = ids.E1
    expect(() => Editor.open(s)).toThrow(/not a container/)
  })
})
