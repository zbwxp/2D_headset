// Preview of ARBITRARY record replacements (dot, review of 8373b9b): changing a reference's sourceId
// kept the old instances in the preview. Generate random single-field replacements of curves and
// references — relationship fields included — and require preview == full evaluation of a document
// that actually contains the replacement (built independently, not through the preview path).
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Editor } from '../src/editor'
import { evaluate } from '../src/evaluate'
import { exampleRecords, ids } from '../src/fixture'
import type { DocRecord } from '../src/schema'

const containers = [ids.L1, ids.L2, ids.L3]
const vec = fc.record({ x: fc.integer({ min: -9, max: 9 }), y: fc.integer({ min: -9, max: 9 }) })
// one changed field per replacement; values are always valid (the relation rules are not under test)
const change = fc.oneof(
  fc.record({ id: fc.constant(ids.R1 as string), field: fc.constant('sourceId'), value: fc.constantFrom<unknown>(...containers) }),
  fc.record({ id: fc.constant(ids.R1 as string), field: fc.constant('parentId'), value: fc.constantFrom<unknown>(...containers) }),
  fc.record({ id: fc.constantFrom(ids.R1 as string, ids.C1, ids.C2, ids.E1), field: fc.constant('index'), value: fc.constantFrom<unknown>('a0', 'a5', 'b1', 'Z') }),
  fc.record({ id: fc.constant(ids.R1 as string), field: fc.constant('transform'), value: fc.record({ a: fc.constantFrom(1, -1), b: fc.constant(0), c: fc.constant(0), d: fc.constant(1), e: fc.integer({ min: -20, max: 20 }), f: fc.integer({ min: -20, max: 20 }) }) as fc.Arbitrary<unknown> }),
  fc.record({ id: fc.constant(ids.R1 as string), field: fc.constant('overrides'), value: vec.map((v) => ({ [`${ids.E1}#e1`]: v })) as fc.Arbitrary<unknown> }),
  fc.record({ id: fc.constantFrom(ids.C1 as string, ids.C2, ids.E1), field: fc.constant('parentId'), value: fc.constantFrom<unknown>(...containers) }),
  fc.record({ id: fc.constantFrom(ids.C1 as string, ids.C2, ids.E1), field: fc.constant('depthOffset'), value: fc.integer({ min: -2, max: 2 }) as fc.Arbitrary<unknown> }),
)

describe('preview of record replacements equals the full evaluation of the replaced document', () => {
  it("dot's minimal case: R1.sourceId L3 → L1", () => {
    const e = new Editor(exampleRecords())
    e.derived.evaluated()
    const replacement = { ...(e.reader.get(ids.R1) as DocRecord), sourceId: ids.L1 } as DocRecord
    const shown = e.derived.preview([replacement])
    const expected = new Editor(exampleRecords().map((r) => (r.id === ids.R1 ? replacement : r)))
    expect(shown).toEqual(evaluate(expected.reader))
  })

  it('random single-field replacements (relationship fields included)', () => {
    fc.assert(
      fc.property(fc.array(change, { minLength: 1, maxLength: 2 }), (changes) => {
        const e = new Editor(exampleRecords())
        e.derived.evaluated()
        const byId = new Map<string, DocRecord>()
        for (const c of changes) byId.set(c.id, { ...(byId.get(c.id) ?? (e.reader.get(c.id as any) as DocRecord)), [c.field]: c.value } as DocRecord)
        const puts = [...byId.values()]
        const shown = e.derived.preview(puts)
        const expected = new Editor(exampleRecords().map((r) => byId.get(r.id) ?? r))
        expect(shown).toEqual(evaluate(expected.reader))
      }),
      { numRuns: 300 },
    )
  })
})
