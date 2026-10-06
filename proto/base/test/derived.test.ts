// Incremental evaluation (derived.ts) vs the independent full recompute (evaluate.ts), and the cache
// cases dot asked to be TESTED rather than inferred: undo/redo, reopen (new store), the same id
// pointing at a new record, relation/flag changes.
import { describe, expect, it } from 'vitest'
import { createApi } from '../src/api'
import type { Command } from '../src/commands'
import { counters, resetCounters } from '../src/counters'
import { Editor } from '../src/editor'
import { evaluate } from '../src/evaluate'
import { exampleRecords, ids } from '../src/fixture'
import type { FillRecord, SegmentStep } from '../src/schema'

const same = (e: Editor) => expect(e.derived.evaluated()).toEqual(evaluate(e.reader))
const move = (dx: number): Command => ({ type: 'moveAnchors', targets: [{ curveId: ids.C1, anchorId: 'a2' }], delta: { x: dx, y: 0 } })

describe('incremental evaluation equals the full recompute', () => {
  it('after edits, undo, redo and a batch', () => {
    const e = new Editor(exampleRecords())
    const api = createApi(e)
    same(e)
    api.apply(move(5))
    same(e)
    api.apply({ type: 'transformContainer', containerId: ids.L3, matrix: { a: 1, b: 0, c: 0, d: 1, e: 3, f: 4 } }) // reference source moves
    same(e)
    api.applyBatch('two', [move(1), move(2)])
    same(e)
    for (let i = 0; i < 3; i++) {
      e.undo()
      same(e)
    }
    for (let i = 0; i < 3; i++) {
      e.redo()
      same(e)
    }
  })

  it('reopen: a new store gets its own caches and the same results', () => {
    const e = new Editor(exampleRecords())
    createApi(e).apply(move(7))
    e.derived.evaluated() // warm the old caches
    const o = Editor.open(JSON.parse(JSON.stringify(e.save())))
    same(o)
    expect(o.derived.evaluated()).toEqual(e.derived.evaluated())
    createApi(o).apply(move(1)) // editing the reopened copy must not touch the old one's caches
    same(o)
    same(e)
    expect(o.derived.evaluated()).not.toEqual(e.derived.evaluated())
  })

  it('the same id pointing at a NEW record after undo is not served from the old cache', () => {
    const e = new Editor(exampleRecords())
    const api = createApi(e)
    api.apply({ type: 'setContainerFlags', containerId: ids.L2, locked: false })
    const F = (exampleRecords().find((r) => r.id === ids.F) as FillRecord).boundary
    const id = 'fill:same' as FillRecord['id']
    expect(api.apply({ type: 'createFill', id, parentId: ids.L1, boundary: F }).ok).toBe(true)
    const first = e.derived.fill(id)!.cubics
    same(e)
    e.undo() // the fill is removed
    same(e)
    expect(e.derived.fill(id)).toBeUndefined()
    const reversed = [...F].reverse().map((s) => s as SegmentStep).map((s) => ({ ...s, dir: (s.dir === 1 ? -1 : 1) as 1 | -1 }))
    expect(api.apply({ type: 'createFill', id, parentId: ids.L1, boundary: reversed }).ok).toBe(true) // same id, new record
    same(e)
    expect(e.derived.fill(id)!.cubics).not.toEqual(first)
  })

  it('flag and relation changes reach dependent items (container chain, fill boundary, reference)', () => {
    const e = new Editor(exampleRecords())
    const api = createApi(e)
    e.derived.evaluated()
    api.apply({ type: 'setContainerFlags', containerId: ids.L2, visible: false })
    expect(e.derived.curve(ids.C2)!.visible).toBe(false)
    expect(e.derived.fill(ids.F)!.visible).toBe(false)
    same(e)
    api.apply({ type: 'setContainerFlags', containerId: ids.L2, visible: true, locked: false })
    api.apply({ type: 'moveAnchors', targets: [{ curveId: ids.C2, anchorId: 'b2' }], delta: { x: 4, y: 0 } }) // a fill boundary curve
    same(e)
    api.apply({ type: 'moveHandle', target: { curveId: ids.E1, anchorId: 'e1' }, handle: 'out', delta: { x: 1, y: 1 } }) // reference source
    same(e)
  })
})

describe('only affected items are re-evaluated', () => {
  it('first build: indexes are built once, on first use', () => {
    const e = new Editor(exampleRecords())
    const api = createApi(e)
    resetCounters()
    e.derived.evaluated()
    api.apply(move(1)) // first plan uses the connection index
    const first = counters.indexBuilds
    expect(first).toBeGreaterThan(0)
    for (let i = 0; i < 5; i++) api.apply(move(1))
    e.derived.evaluated()
    expect(counters.indexBuilds).toBe(first) // continuous edits never rebuild
  })

  it('continuous drag: moving one free anchor re-evaluates that curve and the fill reading it — nothing else', () => {
    const e = new Editor(exampleRecords())
    const api = createApi(e)
    e.derived.evaluated()
    api.apply(move(1)) // warm-up: first build of the indexes the plan uses
    e.derived.evaluated()
    resetCounters()
    api.apply(move(1))
    e.derived.evaluated()
    expect(counters.curveEvals).toBe(1) // C1 only
    expect(counters.fillEvals).toBe(1) // F reads C1
    expect(counters.instanceEvals).toBe(0) // R1 shows E1, untouched
    expect(counters.indexBuilds).toBe(0)
    expect(counters.plans).toBe(1)
    expect(counters.fullEvals).toBe(0)
  })

  it('asking twice without a change costs nothing', () => {
    const e = new Editor(exampleRecords())
    e.derived.evaluated()
    resetCounters()
    e.derived.evaluated()
    expect(counters).toMatchObject({ curveEvals: 0, fillEvals: 0, instanceEvals: 0, assembledItems: 0 })
  })
})
