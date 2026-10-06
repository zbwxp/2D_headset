// dot's review of fd12a14: an accepted write must never produce a document the editor refuses to open.
// The relation rules (model.recordProblems) are shared by `plan` (before publishing) and `Editor.open`.
import { describe, expect, it } from 'vitest'
import { createApi } from '../src/api'
import { Editor } from '../src/editor'
import { exampleRecords, ids } from '../src/fixture'
import type { FillRecord } from '../src/schema'

const F = () => (exampleRecords().find((r) => r.id === ids.F) as FillRecord).boundary

describe('relation rules are the same for writing and opening (dot, fd12a14)', () => {
  it('createFill with a curve as parent is rejected with a structured error, and nothing is written', () => {
    const e = new Editor(exampleRecords())
    const api = createApi(e)
    const before = JSON.stringify(e.reader.serialize('document'))
    const r = api.apply({ type: 'createFill', parentId: ids.C1 as any, boundary: F() })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('NOT_FOUND')
    expect(r.error.objects).toEqual([ids.C1])
    expect(r.error.message).toContain('(curve)') // says what the id actually is
    expect(JSON.stringify(e.reader.serialize('document'))).toBe(before)
    expect(() => Editor.open(JSON.parse(JSON.stringify(e.save())))).not.toThrow()
  })

  it('wrong-typed ids in any command give structured errors, never exceptions', () => {
    const api = createApi(new Editor(exampleRecords()))
    const bad = [
      { type: 'moveAnchors', targets: [{ curveId: ids.L1, anchorId: 'a1' }], delta: { x: 1, y: 0 } },
      { type: 'moveHandle', target: { curveId: ids.F, anchorId: 'a1' }, handle: 'in', delta: { x: 1, y: 0 } },
      { type: 'moveOverride', referenceId: ids.R1, target: { curveId: ids.L1, anchorId: 'a1' }, delta: { x: 1, y: 0 } },
      { type: 'moveOverride', referenceId: ids.C1, target: { curveId: ids.E1, anchorId: 'e1' }, delta: { x: 1, y: 0 } },
      { type: 'transformContainer', containerId: ids.C1, matrix: { a: 1, b: 0, c: 0, d: 1, e: 1, f: 0 } },
      { type: 'createFill', parentId: ids.L1, boundary: [{ curveId: ids.L1, segmentId: 's1', dir: 1 }] },
      { type: 'setContainerFlags', containerId: ids.F, locked: false },
    ] as any[]
    for (const cmd of bad) {
      const r = api.apply(cmd)
      expect(r.ok, cmd.type).toBe(false)
      if (!r.ok) expect(['NOT_FOUND', 'FILL_NOT_CLOSED'], `${cmd.type}: ${r.error.code} ${r.error.message}`).toContain(r.error.code)
    }
  })
})
