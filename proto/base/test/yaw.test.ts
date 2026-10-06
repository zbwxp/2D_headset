// Head-turn evaluation from per-curve pose records (dot: few angle states + bounded angle cache +
// parameter-driven full workload; playing never rewrites author data; 16 §3.0 stroke width fixed).
import { describe, expect, it } from 'vitest'
import { createApi } from '../src/api'
import type { Command } from '../src/commands'
import { counters, resetCounters, snapshotCounters } from '../src/counters'
import { Editor } from '../src/editor'
import { exampleRecords, ids } from '../src/fixture'
import { evaluateAtYaw } from '../src/pose'
import type { CurveRecord } from '../src/schema'
import { onionYaws, syntheticPoses, syntheticRecords } from '../src/synthetic'

const YAWS = [-90, -45, 0, 17.5, 30, 90]
const same = (e: Editor) => {
  for (const y of YAWS) expect(e.derived.atYaw(y), `yaw ${y}`).toEqual(evaluateAtYaw(e.reader, y))
}
const withPoses = () => {
  const e = new Editor(exampleRecords())
  const api = createApi(e)
  api.apply({ type: 'setPoseKey', curveId: ids.C1, yaw: -90, offsets: { a1: { x: -8, y: 0 }, a2: { x: -12, y: 2 }, a3: { x: -6, y: 0 } } })
  api.apply({ type: 'setPoseKey', curveId: ids.C1, yaw: 90, offsets: { a1: { x: 8, y: 0 }, a2: { x: 12, y: -2 }, a3: { x: 6, y: 0 } } })
  api.apply({ type: 'setPoseKey', curveId: ids.E1, yaw: 90, offsets: { e1: { x: 5, y: 1 } } }) // reference source: instances turn too
  return { e, api }
}

describe('cached angle evaluation equals the full recompute', () => {
  it('after edits, pose edits, undo/redo and reopen', () => {
    const { e, api } = withPoses()
    same(e)
    api.apply({ type: 'moveAnchors', targets: [{ curveId: ids.C1, anchorId: 'a2' }], delta: { x: 3, y: 1 } })
    same(e)
    api.apply({ type: 'setPoseKey', curveId: ids.C1, yaw: 90, offsets: { a2: { x: 1, y: 1 } } }) // replace a key
    same(e)
    for (let i = 0; i < 3; i++) (api.undo(), same(e))
    for (let i = 0; i < 3; i++) (api.redo(), same(e))
    const o = Editor.open(JSON.parse(JSON.stringify(e.save())))
    same(o)
    expect(o.derived.atYaw(30)).toEqual(e.derived.atYaw(30))
  })

  it('a pose removed by undo and re-created with the same id is not served from the old cache', () => {
    const e = new Editor(exampleRecords())
    const api = createApi(e)
    api.apply({ type: 'setPoseKey', curveId: ids.C1, yaw: 90, offsets: { a2: { x: 30, y: 0 } } })
    const first = e.derived.atYaw(45)
    api.undo()
    same(e)
    api.apply({ type: 'setPoseKey', curveId: ids.C1, yaw: 90, offsets: { a2: { x: -30, y: 0 } } })
    same(e)
    expect(e.derived.atYaw(45)).not.toEqual(first)
  })

  it('playing angles never writes author data', () => {
    const { e } = withPoses()
    const before = { doc: JSON.stringify(e.reader.serialize('document')), hist: JSON.stringify(e.history), rev: e.revision, dirty: e.isDirty }
    for (let y = -90; y <= 90; y += 0.5) e.derived.atYaw(y)
    expect({ doc: JSON.stringify(e.reader.serialize('document')), hist: JSON.stringify(e.history), rev: e.revision, dirty: e.isDirty }).toEqual(before)
  })

  it('stroke width stays the authored width at every angle (16 §3.0)', () => {
    const { e } = withPoses()
    const authored = new Map((e.reader.allRecords().filter((r) => r.typeName === 'curve') as CurveRecord[]).map((c) => [c.id as string, c.stroke.width]))
    for (const y of YAWS) for (const c of e.derived.atYaw(y).curves) expect(c.stroke.width).toBe(authored.get(c.curveId))
  })

  it('the angle cache is bounded: dragging the angle through 1000 values never exceeds capacity, results stay exact', () => {
    const e = new Editor([...exampleRecords()], { yawCapacity: 50, yawListCapacity: 8 })
    const api = createApi(e)
    api.apply({ type: 'setPoseKey', curveId: ids.C1, yaw: 90, offsets: { a2: { x: 30, y: -6 } } })
    resetCounters()
    for (let i = 0; i < 1000; i++) {
      const y = -90 + (180 * i) / 999
      e.derived.atYaw(y)
      const s = e.derived.yawCacheSize
      expect(s.curves).toBeLessThanOrEqual(50)
      expect(s.fills).toBeLessThanOrEqual(50)
      expect(s.lists).toBeLessThanOrEqual(8)
    }
    expect(counters.yawEvictions).toBeGreaterThan(0)
    for (const y of [-90, -12.3, 45, 90]) expect(e.derived.atYaw(y)).toEqual(evaluateAtYaw(e.reader, y)) // evicted entries recompute correctly
  })
})

describe('drag preview with onion skins', () => {
  it('previewAtYaw equals the full recompute at that yaw after commit', () => {
    const { e, api } = withPoses()
    api.apply({ type: 'setContainerFlags', containerId: ids.L2, locked: false }) // L1's curves are connected to L2's
    const drags: Command[] = [
      { type: 'moveAnchors', targets: [{ curveId: ids.C1, anchorId: 'a2' }], delta: { x: 2, y: 1 } },
      { type: 'moveAnchors', targets: [{ curveId: ids.E1, anchorId: 'e2' }], delta: { x: -3, y: 0 } }, // reference source
      { type: 'transformContainer', containerId: ids.L1, matrix: { a: 1, b: 0, c: 0, d: 1, e: 5, f: 2 } },
    ]
    for (const cmd of drags) {
      const pv = e.preview(cmd)
      if (!pv.ok) throw new Error(pv.error.message)
      const ch = e.derived.previewChanges(pv.puts)
      const shown = YAWS.map((y) => e.derived.previewAtYaw(pv.puts, y, ch))
      api.apply(cmd)
      YAWS.forEach((y, i) => expect(shown[i], `${cmd.type} @${y}`).toEqual(evaluateAtYaw(e.reader, y)))
    }
  })
})

describe('workloads (counts asserted, times and heap informational)', () => {
  function maker(curves: number) {
    const shapes = syntheticRecords({ curves, layers: 8, fills: 15 })
    const e = new Editor([...shapes, ...syntheticPoses(shapes)])
    const api = createApi(e)
    const yaws = onionYaws(19)
    const target = 'curve:S0' as CurveRecord['id']
    const move = (dx: number): Command => ({ type: 'moveAnchors', targets: [{ curveId: target, anchorId: 'p1' }], delta: { x: dx, y: 0 } })
    for (const y of yaws) e.derived.atYaw(y) // first build of the onion
    api.apply(move(0.5))
    for (const y of yaws) e.derived.atYaw(y)
    resetCounters()
    const t0 = performance.now()
    for (let i = 0; i < 10; i++) {
      api.apply(move(0.5))
      for (const y of yaws) e.derived.curveAt(target, y) // per-item consumer
    }
    const ms = (performance.now() - t0) / 10
    return { counts: snapshotCounters(), ms }
  }
  it('maker: an onion drag of one curve re-evaluates that curve at each yaw, independent of document size', () => {
    const small = maker(121)
    const large = maker(3000)
    const pick = (c: typeof counters) => ({ yawCurveEvals: c.yawCurveEvals / 10, yawFillEvals: c.yawFillEvals / 10, curveEvals: c.curveEvals / 10, fullEvals: c.fullEvals, fullYawEvals: c.fullYawEvals })
    console.log('[yaw maker per drag]', JSON.stringify({ small: { ...pick(small.counts), ms: +small.ms.toFixed(3) }, large: { ...pick(large.counts), ms: +large.ms.toFixed(3) } }))
    expect(pick(large.counts)).toEqual(pick(small.counts))
    expect(pick(large.counts)).toMatchObject({ yawCurveEvals: 19, curveEvals: 1, fullEvals: 0, fullYawEvals: 0 })
  })

  function runtime(curves: number) {
    const shapes = syntheticRecords({ curves, layers: 8, fills: 15 })
    const e = new Editor([...shapes, ...syntheticPoses(shapes)], { yawCapacity: 400_000, yawListCapacity: 128 })
    const base = e.derived.evaluated()
    const yaws = Array.from({ length: 60 }, (_, i) => -90 + 3 * i + 0.25) // 60 NEW angles: everything changes each frame
    const heap0 = process.memoryUsage().heapUsed
    resetCounters()
    let t = performance.now()
    for (const y of yaws) e.derived.atYaw(y)
    const cachedFirstMs = (performance.now() - t) / yaws.length
    const evalsPerFrame = (counters.yawCurveEvals + counters.yawFillEvals) / yaws.length
    const heapCachedMB = (process.memoryUsage().heapUsed - heap0) / 1e6
    t = performance.now()
    for (const y of yaws) e.derived.atYaw(y) // replay: everything cached
    const cachedReplayMs = (performance.now() - t) / yaws.length
    t = performance.now()
    for (const y of yaws) evaluateAtYaw(e.reader, y, base) // uncached, sharing one base evaluation
    const fullMs = (performance.now() - t) / yaws.length
    expect(e.derived.atYaw(yaws[7])).toEqual(evaluateAtYaw(e.reader, yaws[7]))
    return { curves, evalsPerFrame, ms: { cachedFirst: +cachedFirstMs.toFixed(2), cachedReplay: +cachedReplayMs.toFixed(3), uncached: +fullMs.toFixed(2) }, heapCachedMB: +heapCachedMB.toFixed(1) }
  }
  it('runtime: parameter-driven angle sweep — every frame changes every curve; no edits, no history', () => {
    const rows = [runtime(121), runtime(1000), runtime(3000)]
    console.log('[yaw runtime per frame]', JSON.stringify(rows))
    for (const r of rows) expect(r.evalsPerFrame).toBe(r.curves + 15 + 15) // all curves + loop curves + fills, once per new angle
  })
})
