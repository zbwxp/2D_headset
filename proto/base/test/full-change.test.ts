// BATCH-EDIT workload: a whole-scene transform through the author-data write entry (plan, validation,
// undo history) every frame, then evaluation. It is NOT the runtime workload: playing an angle or an
// expression is an evaluation input, not an edit, and must not be measured through the write entry or
// undo history (dot). A parameter-driven full-evaluation workload, with memory reported separately,
// is still to be added; no runtime caching decision rests on these numbers.
// Informational numbers, printed not asserted (machine-dependent); correctness IS asserted.
import { describe, expect, it } from 'vitest'
import { createApi } from '../src/api'
import { counters, resetCounters } from '../src/counters'
import { Editor } from '../src/editor'
import { evaluate } from '../src/evaluate'
import { syntheticRecords } from '../src/synthetic'
import type { ContainerRecord } from '../src/schema'

const FRAMES = 10
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

function run(curves: number) {
  const layers = 8
  const e = new Editor(syntheticRecords({ curves, layers, fills: 15 }))
  const api = createApi(e)
  const all = Array.from({ length: layers }, (_, i) => `container:S${i}` as ContainerRecord['id'])
  e.derived.evaluated()
  const plan: number[] = []
  const incr: number[] = []
  const full: number[] = []
  global.gc?.()
  const heap0 = process.memoryUsage().heapUsed
  resetCounters()
  for (let f = 0; f < FRAMES; f++) {
    let t = performance.now()
    const r = api.apply({ type: 'transformContainers', containerIds: all, matrix: { a: 1, b: 0, c: 0, d: 1, e: 0.5, f: 0.25 } }) // every curve moves
    plan.push(performance.now() - t)
    expect(r.ok && r.written).toBe(true)
    t = performance.now()
    e.derived.evaluated()
    incr.push(performance.now() - t)
    t = performance.now()
    evaluate(e.reader)
    full.push(performance.now() - t)
  }
  const heapMB = (process.memoryUsage().heapUsed - heap0) / 1e6
  const evalsPerFrame = (counters.curveEvals + counters.fillEvals) / FRAMES
  expect(e.derived.evaluated()).toEqual(evaluate(e.reader))
  return { curves, evalsPerFrame, ms: { applyIncludingPlan: +median(plan).toFixed(2), incremental: +median(incr).toFixed(2), full: +median(full).toFixed(2) }, heapGrowthMB: +heapMB.toFixed(1) }
}

describe('batch-edit full-change workload (not runtime playback)', () => {
  it('everything changes every frame: incremental re-evaluates everything, and must still be correct', () => {
    const rows = [run(121), run(1000), run(3000)]
    console.log('[full-change]', JSON.stringify(rows))
    for (const r of rows) expect(r.evalsPerFrame).toBe(r.curves + 15 + 15) // all curves + loop curves + fills
  })
})
