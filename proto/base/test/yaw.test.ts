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

  it('geometric forms do not change the authored stroke width at any angle (16 §3.0)', () => {
    const { e } = withPoses()
    const authored = new Map((e.reader.allRecords().filter((r) => r.typeName === 'curve') as CurveRecord[]).map((c) => [c.id as string, c.stroke.width]))
    for (const y of YAWS) for (const c of e.derived.atYaw(y).curves) expect(c.stroke.width).toBe(authored.get(c.curveId))
  })

  it('the angle caches share ONE budget: through 1000 angles the results they hold never exceed it, results stay exact', () => {
    const e = new Editor([...exampleRecords()], { yawRetainedItems: 50 })
    const api = createApi(e)
    api.apply({ type: 'setPoseKey', curveId: ids.C1, yaw: 90, offsets: { a2: { x: 30, y: -6 } } })
    resetCounters()
    for (let i = 0; i < 1000; i++) {
      const y = -90 + (180 * i) / 999
      e.derived.atYaw(y)
      expect(e.derived.yawCacheSize.budgetUsed).toBeLessThanOrEqual(50)
      // the distinct result objects actually held by item caches AND cached lists (dot: lists retain results)
      expect(e.derived.yawRetainedItems.retainedObjects().size).toBeLessThanOrEqual(50)
      expect(e.derived.yawRetainedItems.consistent()).toBe(true)
    }
    expect(counters.yawEvictions).toBeGreaterThan(0)
    // -90 was visited first, so it has been evicted: asking again must RECOMPUTE (counted) and be exact
    resetCounters()
    expect(e.derived.atYaw(-90)).toEqual(evaluateAtYaw(e.reader, -90))
    expect(counters.yawCurveEvals).toBeGreaterThan(0)
    for (const y of [-12.3, 45, 90]) expect(e.derived.atYaw(y)).toEqual(evaluateAtYaw(e.reader, y))
  })
})

describe('a pose belongs to its source curve: reference instances carry it through their transform', () => {
  it("dot's case: mirrored reference R1 (x → 60 − x) mirrors the source's pose offset", () => {
    const e = new Editor(exampleRecords())
    createApi(e).apply({ type: 'setPoseKey', curveId: ids.E1, yaw: 90, offsets: { e1: { x: 5, y: 1 } } })
    const at90 = e.derived.atYaw(90)
    const source = at90.curves.find((c) => c.address === ids.E1)!.anchors.e1.p
    const mirrored = at90.curves.find((c) => c.address === `${ids.R1}/${ids.E1}`)!.anchors.e1.p
    expect(source).toEqual({ x: -15, y: 21 }) // (−20, 20) + (5, 1)
    expect(mirrored).toEqual({ x: 75, y: 21 }) // 60 − (−15), not 60 − (−20) + 5 = 85
    expect(evaluateAtYaw(e.reader, 90)).toEqual(at90)
  })
  it('every instance at every yaw = its placement applied to the source curve at that yaw (no overrides)', () => {
    const { e } = withPoses()
    const placement = (e.reader.get(ids.R1) as any).transform
    const tp = (p: { x: number; y: number }) => ({ x: placement.a * p.x + placement.c * p.y + placement.e, y: placement.b * p.x + placement.d * p.y + placement.f })
    for (const y of YAWS) {
      const ev = e.derived.atYaw(y)
      const src = ev.curves.find((c) => c.address === ids.E1)!
      const inst = ev.curves.find((c) => c.address === `${ids.R1}/${ids.E1}`)!
      for (const id of Object.keys(src.anchors))
        for (const k of ['p', 'hIn', 'hOut'] as const) {
          const want = tp(src.anchors[id][k])
          expect(inst.anchors[id][k].x).toBeCloseTo(want.x, 9)
          expect(inst.anchors[id][k].y).toBeCloseTo(want.y, 9)
        }
    }
  })
})

describe('retained result items when the document grows (dot)', () => {
  it('lists are re-weighed when the document gains items, and the limit still holds', () => {
    const e = new Editor(exampleRecords().map((r) => (r.id === ids.L2 ? { ...r, locked: false } : r)), { yawRetainedItems: 12 })
    const api = createApi(e)
    api.apply({ type: 'setPoseKey', curveId: ids.C1, yaw: 90, offsets: { a2: { x: 4, y: 0 } } })
    for (const y of [0, 30, 60]) e.derived.atYaw(y)
    const boundary = (e.reader.get(ids.F) as any).boundary
    for (let i = 0; i < 3; i++) api.apply({ type: 'createFill', parentId: ids.L1, boundary }) // the document grows
    resetCounters()
    for (const y of [0, 30, 60, 90]) {
      expect(e.derived.atYaw(y)).toEqual(evaluateAtYaw(e.reader, y))
      expect(e.derived.yawRetainedItems.retainedObjects().size).toBeLessThanOrEqual(12)
      expect(e.derived.yawRetainedItems.consistent()).toBe(true) // no orphaned (weighed but unmapped) entries
      expect(e.derived.yawCacheSize.budgetUsed).toBeLessThanOrEqual(12)
    }
    expect(counters.yawEvictions).toBeGreaterThan(0)
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
  function makerDependents(curves: number, cmd: Command) {
    const shapes = syntheticRecords({ curves, layers: 8, fills: 15 })
    const e = new Editor([...shapes, ...syntheticPoses(shapes)])
    const api = createApi(e)
    const yaws = onionYaws(19)
    for (const y of yaws) e.derived.atYaw(y)
    api.apply(cmd)
    for (const y of yaws) e.derived.atYaw(y)
    resetCounters()
    api.apply(cmd)
    for (const y of yaws) e.derived.atYaw(y) // whole onion lists: dependents included
    const c = snapshotCounters()
    for (const y of [yaws[0], yaws[9], yaws[18]]) expect(e.derived.atYaw(y)).toEqual(evaluateAtYaw(e.reader, y))
    return { yawCurveEvals: c.yawCurveEvals, yawFillEvals: c.yawFillEvals, curveEvals: c.curveEvals, fillEvals: c.fillEvals }
  }
  it('maker: a CONNECTED anchor re-evaluates both connected curves at each yaw; a fill-boundary anchor also re-evaluates the fill', () => {
    const connected: Command = { type: 'moveAnchors', targets: [{ curveId: 'curve:S0' as CurveRecord['id'], anchorId: 'p3' }], delta: { x: 0.5, y: 0 } } // S0.p3 ⟷ S8.p0
    const boundary: Command = { type: 'moveAnchors', targets: [{ curveId: 'curve:L0' as CurveRecord['id'], anchorId: 'q1' }], delta: { x: 0.5, y: 0 } } // loop of fill L0
    const rows = { connected: [makerDependents(121, connected), makerDependents(3000, connected)], boundary: [makerDependents(121, boundary), makerDependents(3000, boundary)] }
    console.log('[yaw maker dependents per drag]', JSON.stringify(rows))
    expect(rows.connected[1]).toEqual(rows.connected[0])
    expect(rows.connected[0]).toMatchObject({ yawCurveEvals: 2 * 19, curveEvals: 2, yawFillEvals: 0, fillEvals: 0 })
    expect(rows.boundary[1]).toEqual(rows.boundary[0])
    expect(rows.boundary[0]).toMatchObject({ yawCurveEvals: 19, curveEvals: 1, yawFillEvals: 19, fillEvals: 1 })
  })

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
    const e = new Editor([...shapes, ...syntheticPoses(shapes)], { yawRetainedItems: 1_000_000 })
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
