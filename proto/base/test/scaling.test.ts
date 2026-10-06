// dot's criterion 3: with many unrelated lines added, the work of a continuous drag must grow with
// the AFFECTED range, not with the document. Same edit on a small and a large document; per-drag
// counts must be identical. Times are printed for information only (not asserted: machine-dependent).
import { describe, expect, it } from 'vitest'
import { createApi } from '../src/api'
import type { Command } from '../src/commands'
import { counters, resetCounters, snapshotCounters } from '../src/counters'
import { Editor } from '../src/editor'
import { evaluate } from '../src/evaluate'
import { syntheticRecords } from '../src/synthetic'
import type { CurveRecord } from '../src/schema'

const DRAGS = 20

function drag(curves: number) {
  const e = new Editor(syntheticRecords({ curves, layers: 8, fills: 15 }))
  const api = createApi(e)
  const target = 'curve:S0' as CurveRecord['id']
  const cmd = (dx: number): Command => ({ type: 'moveAnchors', targets: [{ curveId: target, anchorId: 'p1' }], delta: { x: dx, y: 0 } }) // p1 is not connected
  resetCounters()
  e.derived.evaluated() // first build
  api.apply(cmd(1))
  e.derived.evaluated()
  const firstBuild = snapshotCounters()
  resetCounters()
  const t0 = performance.now()
  for (let i = 0; i < DRAGS; i++) {
    api.apply(cmd(0.5))
    e.derived.curve(target) // a per-item consumer (what a renderer that redraws changed items would read)
  }
  const perItemMs = (performance.now() - t0) / DRAGS
  const perItem = snapshotCounters()
  resetCounters()
  const t1 = performance.now()
  for (let i = 0; i < DRAGS; i++) {
    api.apply(cmd(0.5))
    e.derived.evaluated() // a whole-list consumer (what the current Fabric view reads)
  }
  const wholeListMs = (performance.now() - t1) / DRAGS
  const wholeList = snapshotCounters()
  const t2 = performance.now()
  for (let i = 0; i < 5; i++) evaluate(e.reader)
  const fullMs = (performance.now() - t2) / 5
  expect(e.derived.evaluated()).toEqual(evaluate(e.reader))
  return { curves, firstBuild, perItem, wholeList, perItemMs, wholeListMs, fullMs }
}

describe('continuous drag cost does not grow with unrelated content', () => {
  it('per-drag counts are identical for 121 and 3000 curves', () => {
    const small = drag(121)
    const large = drag(3000)
    const perDrag = (c: typeof counters) => ({
      plans: c.plans / DRAGS,
      indexBuilds: c.indexBuilds / DRAGS,
      indexSteps: c.indexSteps / DRAGS,
      indexQueries: c.indexQueries / DRAGS,
      curveEvals: c.curveEvals / DRAGS,
      fillEvals: c.fillEvals / DRAGS,
      instanceEvals: c.instanceEvals / DRAGS,
      fullEvals: c.fullEvals / DRAGS,
    })
    console.log(
      '[scaling]',
      JSON.stringify(
        [small, large].map((r) => ({
          curves: r.curves,
          firstBuild: { indexBuilds: r.firstBuild.indexBuilds, curveEvals: r.firstBuild.curveEvals, fillEvals: r.firstBuild.fillEvals },
          perDrag: perDrag(r.perItem),
          assembledItemsPerDragWholeList: r.wholeList.assembledItems / DRAGS,
          ms: { perItemDrag: +r.perItemMs.toFixed(3), wholeListDrag: +r.wholeListMs.toFixed(3), fullEvaluate: +r.fullMs.toFixed(3) },
        })),
      ),
    )
    // the affected range is the same (one free anchor of one curve), so the work must be too
    expect(perDrag(large.perItem)).toEqual(perDrag(small.perItem))
    expect(perDrag(large.perItem)).toMatchObject({ plans: 1, indexBuilds: 0, curveEvals: 1, fillEvals: 0, instanceEvals: 0, fullEvals: 0 })
    // the first build is proportional to the document, as expected
    expect(large.firstBuild.curveEvals).toBeGreaterThan(small.firstBuild.curveEvals)
    // whole-list consumers still re-collect every item each drag (references only): known, reported
    expect(large.wholeList.curveEvals).toBe(small.wholeList.curveEvals)
  })
})
