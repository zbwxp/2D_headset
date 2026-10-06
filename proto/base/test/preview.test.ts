// Drag preview without a store copy (dot, after 375f9e5): the preview of a plan must equal the full
// recompute of the document after that plan is applied; cancelling or a rejected plan changes nothing;
// per-move work must not grow with unrelated content.
import { describe, expect, it } from 'vitest'
import { createApi } from '../src/api'
import type { Command } from '../src/commands'
import { counters, resetCounters, snapshotCounters } from '../src/counters'
import { Editor } from '../src/editor'
import { evaluate } from '../src/evaluate'
import { exampleRecords, ids } from '../src/fixture'
import type { CurveRecord } from '../src/schema'
import { syntheticRecords } from '../src/synthetic'

const unlocked = () => exampleRecords().map((r) => (r.id === ids.L2 ? { ...r, locked: false } : r))
const m = (e: number, f: number) => ({ a: 1, b: 0, c: 0, d: 1, e, f })
const drags: [string, Command][] = [
  ['free anchor', { type: 'moveAnchors', targets: [{ curveId: ids.C1, anchorId: 'a2' }], delta: { x: 3, y: 1 } }],
  ['connected anchor (C1.a3 ↔ C2.b3, fill boundary)', { type: 'moveAnchors', targets: [{ curveId: ids.C1, anchorId: 'a3' }], delta: { x: 2, y: 2 } }],
  ['handle', { type: 'moveHandle', target: { curveId: ids.C2, anchorId: 'b2' }, handle: 'out', delta: { x: -4, y: 1 } }],
  ['reference override', { type: 'moveOverride', referenceId: ids.R1, target: { curveId: ids.E1, anchorId: 'e1' }, delta: { x: 1, y: 1 } }],
  ['reference SOURCE curve (instances follow)', { type: 'moveAnchors', targets: [{ curveId: ids.E1, anchorId: 'e2' }], delta: { x: 5, y: 0 } }],
  ['container with a reference (V move L1)', { type: 'transformContainer', containerId: ids.L1, matrix: m(10, 5) }],
  ['reference source container (V move L3)', { type: 'transformContainer', containerId: ids.L3, matrix: m(-3, 2) }],
  ['two containers, connected (L1+L2)', { type: 'transformContainers', containerIds: [ids.L1, ids.L2], matrix: m(4, -4) }],
]

describe('drag preview equals the full recompute after commit', () => {
  for (const [name, cmd] of drags)
    it(name, () => {
      const e = new Editor(unlocked())
      const before = evaluate(e.reader)
      const pv = e.preview(cmd)
      expect(pv.ok).toBe(true)
      if (!pv.ok) return
      resetCounters()
      const shown = e.derived.preview(pv.puts)
      expect(counters.previewFallbacks).toBe(0)
      expect(counters.snapshotRows).toBe(0)
      // cancel: nothing written, cached result unchanged
      expect(e.derived.evaluated()).toEqual(before)
      expect(createApi(e).apply(cmd)).toMatchObject({ ok: true, written: true })
      expect(shown).toEqual(evaluate(e.reader)) // what the drag showed is what the commit produced
      expect(e.derived.evaluated()).toEqual(shown)
    })

  it('a plan touching containers falls back to a full overlay evaluation, still equal', () => {
    const e = new Editor(unlocked())
    const cmd: Command = { type: 'setContainerFlags', containerId: ids.L2, visible: false }
    const pv = e.preview(cmd)
    if (!pv.ok) throw new Error('expected ok')
    resetCounters()
    const shown = e.derived.preview(pv.puts)
    expect(counters.previewFallbacks).toBe(1)
    createApi(e).apply(cmd)
    expect(shown).toEqual(evaluate(e.reader))
  })

  it('a rejected plan has no preview and changes nothing', () => {
    const e = new Editor(exampleRecords()) // L2 locked: C1.a3 is linked to locked C2.b3
    const before = evaluate(e.reader)
    expect(e.preview({ type: 'moveAnchors', targets: [{ curveId: ids.C1, anchorId: 'a3' }], delta: { x: 1, y: 0 } }).ok).toBe(false)
    expect(e.derived.evaluated()).toEqual(before)
  })
})

describe('per-move preview work does not grow with unrelated content', () => {
  function moves(curves: number) {
    const e = new Editor(syntheticRecords({ curves, layers: 8, fills: 15 }))
    const target = 'curve:S0' as CurveRecord['id']
    e.derived.evaluated()
    e.preview({ type: 'moveAnchors', targets: [{ curveId: target, anchorId: 'p1' }], delta: { x: 0, y: 0 } }) // first build of indexes
    resetCounters()
    for (let i = 1; i <= 20; i++) {
      const pv = e.preview({ type: 'moveAnchors', targets: [{ curveId: target, anchorId: 'p1' }], delta: { x: i, y: 0 } })
      if (!pv.ok) throw new Error('expected ok')
      e.derived.previewChanges(pv.puts)
    }
    return snapshotCounters()
  }
  it('121 vs 3000 curves: identical counts, no snapshot rows', () => {
    const small = moves(121)
    const large = moves(3000)
    const pick = (c: typeof counters) => ({ plans: c.plans, previews: c.previews, previewEvals: c.previewEvals, indexBuilds: c.indexBuilds, indexQueries: c.indexQueries, snapshotRows: c.snapshotRows, fullEvals: c.fullEvals, previewFallbacks: c.previewFallbacks })
    console.log('[preview-moves x20]', JSON.stringify({ small: pick(small), large: pick(large) }))
    expect(pick(large)).toEqual(pick(small))
    expect(pick(large)).toMatchObject({ plans: 20, previews: 20, previewEvals: 20, snapshotRows: 0, fullEvals: 0, previewFallbacks: 0 })
  })
})
