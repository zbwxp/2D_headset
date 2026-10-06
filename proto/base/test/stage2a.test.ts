// Stage 2a (doc 18 §23.2 stage 2): fill-only closing edges (bridges) in the real fill records and every
// consumer; promotion of legacy head-turn tracks to one offset per control point (legacy-delta3).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { findGap, type Command } from '../src/commands'
import { Editor } from '../src/editor'
import { evaluate } from '../src/evaluate'
import { exampleRecords, ids } from '../src/fixture'
import { fillsUsing } from '../src/indexes'
import { evaluateAtYaw, promoteLegacy } from '../src/pose'
import { evaluateSaved } from '../src/runtime'
import type { BoundaryStep, CurveRecord, DocRecord, FormsRecord } from '../src/schema'

const json = (f: string) => JSON.parse(readFileSync(`test/fixtures/${f}`, 'utf8'))
const same = (a: unknown, b: unknown) => expect(JSON.stringify(a)).toBe(JSON.stringify(b))
const unlocked = () => exampleRecords().map((r) => (r.id === ids.L2 ? { ...r, locked: false } : r))
const G = 'fill:G' as any
// C1: a1 (0,0) → a2 (10,60) → a3 (60,100); E1: e1 (-20,20) → e2 (-30,50). E1 enters G ONLY through bridges.
const bridged: BoundaryStep[] = [
  { curveId: ids.C1, segmentId: 's1', dir: 1 },
  { curveId: ids.C1, segmentId: 's2', dir: 1 },
  { bridge: { from: { curveId: ids.C1, anchorId: 'a3' }, to: { curveId: ids.E1, anchorId: 'e2' } } },
  { bridge: { from: { curveId: ids.E1, anchorId: 'e2' }, to: { curveId: ids.C1, anchorId: 'a1' } } },
]
const withG = () => {
  const e = new Editor(unlocked())
  const r = e.apply({ type: 'createFill', id: G, parentId: ids.L1, boundary: bridged })
  expect(r.ok && r.written, JSON.stringify(r)).toBe(true)
  return e
}
const anchorP = (e: Editor, c: string, a: string) => (e.reader.get(c as any) as CurveRecord).anchors[a].p

describe('bridges are real fill boundary steps, read by every consumer', () => {
  it('a boundary closed only through bridges is accepted; the bridges are straight lines between the current anchors', () => {
    const e = withG()
    expect(findGap(e.reader, bridged)).toBeNull()
    const g = e.derived.evaluated().fills.find((f) => f.address === G)!
    const [b1, b2] = [g.cubics[2], g.cubics[3]]
    same([b1[0], b1[3]], [anchorP(e, ids.C1, 'a3'), anchorP(e, ids.E1, 'e2')])
    same([b2[0], b2[3]], [anchorP(e, ids.E1, 'e2'), anchorP(e, ids.C1, 'a1')])
    expect(b1[1].x).toBeCloseTo(b1[0].x + (b1[3].x - b1[0].x) / 3, 12)
    // own ink = segments only: bridges are never strokes
    expect(g.boundaryRefs).toEqual([{ curve: ids.C1, segments: ['s1', 's2'] }])
    expect(e.derived.evaluated()).toEqual(evaluate(e.reader))
  })

  it('a curve reached only through bridges is a dependency: moving its anchor updates the fill (preview = commit = full recompute)', () => {
    const e = withG()
    expect(fillsUsing(e.reader, ids.E1)).toContain(G)
    const cmd: Command = { type: 'moveAnchors', targets: [{ curveId: ids.E1, anchorId: 'e2' }], delta: { x: -7, y: 3 } }
    const pv = e.preview(cmd)
    expect(pv.ok).toBe(true)
    if (!pv.ok) return
    const shown = e.derived.preview(pv.puts, e.derived.previewChanges(pv.puts, pv.removals))
    expect(e.apply(cmd).ok).toBe(true)
    expect(e.derived.evaluated()).toEqual(shown)
    expect(e.derived.evaluated()).toEqual(evaluate(e.reader))
    const g = e.derived.evaluated().fills.find((f) => f.address === G)!
    same(g.cubics[2][3], anchorP(e, ids.E1, 'e2'))
  })

  it('at a yaw the bridge follows the turned anchors (full, cached and runtime agree)', () => {
    const e = withG()
    expect(e.apply({ type: 'setPoseKey', curveId: ids.E1, yaw: 90, offsets: { e2: { x: 5, y: -4 } } }).ok).toBe(true)
    const full = evaluateAtYaw(e.reader, 90)
    same(e.derived.atYaw(90), full)
    same(evaluateSaved(e.reader.allRecords(), { yaw: 90 }), full)
    const g = full.fills.find((f) => f.address === G)!
    const e2 = full.curves.find((c) => c.address === ids.E1)!.anchors.e2.p
    same(g.cubics[2][3], e2)
    same(e2, { x: -30 + 5, y: 50 - 4 })
  })

  it('a bridge end cannot disappear: deleting its curve is refused; a file with a dangling bridge does not open', () => {
    const e = withG()
    const r = e.apply({ type: 'deleteRecords', ids: [ids.E1] })
    expect(r.ok === false && r.error.message).toContain('fill:G.boundary[2].bridge.to.curveId: curve:E1 is not a curve')
    const file = JSON.stringify(e.save())
    const dangling = JSON.parse(file)
    dangling.store[G].boundary[2].bridge.to.anchorId = 'zz'
    expect(() => Editor.open(dangling)).toThrow(/invalid document: .*bridge end curve:E1#zz missing/)
    const malformed = JSON.parse(file)
    malformed.store[G].boundary[2] = { bridge: { from: { curveId: ids.C1 } } }
    expect(() => Editor.open(malformed)).toThrow(/invalid document: fill fill:G boundary step 2/)
  })

  it('a boundary whose bridge does not meet its neighbours is not closed', () => {
    const e = new Editor(unlocked())
    const open: BoundaryStep[] = [bridged[0], bridged[1], { bridge: { from: { curveId: ids.C1, anchorId: 'a2' }, to: { curveId: ids.C1, anchorId: 'a1' } } }]
    const r = e.apply({ type: 'createFill', parentId: ids.L1, boundary: open })
    expect(r.ok === false && r.error.code).toBe('FILL_NOT_CLOSED')
  })
})

describe('legacy-delta3: promoted head-turn tracks', () => {
  const golden = json('legacy-v1-golden.json')
  const yaws = Object.keys(golden.atYaw).map(Number)
  const promotedRecords = () => {
    const e = Editor.open(json('legacy-v1-snapshot.json'))
    return e.reader.allRecords().map((r) => (r.typeName === 'forms' ? promoteLegacy(r as FormsRecord, Object.keys((e.reader.get((r as FormsRecord).curveId) as CurveRecord).anchors)) : r)) as DocRecord[]
  }

  it('promotion fills every anchor with dp = dIn = dOut = the old offset (0 where missing)', () => {
    const recs = promotedRecords()
    const f = recs.find((r) => r.id === 'forms:document/curve:C1') as any
    expect(f.encoding).toBe('legacy-delta3')
    for (const k of f.yaw) for (const a of ['a1', 'a2', 'a3']) {
      expect(k.offsets[a].dp).toEqual(k.offsets[a].dIn)
      expect(k.offsets[a].dp).toEqual(k.offsets[a].dOut)
    }
    const old = json('legacy-v1-snapshot.json').store['pose:C1']
    const k30 = old.keys.find((k: any) => k.yaw === 30)
    expect(f.yaw.find((k: any) => k.yaw === 30).offsets.a1.dp).toEqual(k30.offsets.a1 ?? { x: 0, y: 0 })
  })

  it('a promoted, otherwise unchanged document gives exactly the old numbers (base, every yaw, cached, runtime; mirrored reference)', () => {
    const recs = promotedRecords()
    const e = new Editor(recs)
    same(evaluate(e.reader), golden.base)
    for (const y of yaws) {
      same(evaluateAtYaw(e.reader, y), golden.atYaw[y])
      same(e.derived.atYaw(y), golden.derived[y])
      same(evaluateSaved(recs, { yaw: y }), golden.runtime[y])
    }
    expect(() => Editor.open(JSON.parse(JSON.stringify(e.save())))).not.toThrow()
  })

  it('setPoseKey on a promoted track does exactly what it does on the old track (connected ends follow)', () => {
    const a = Editor.open(json('legacy-v1-snapshot.json'))
    const b = new Editor(promotedRecords())
    for (const ed of [a, b]) {
      expect(ed.apply({ type: 'setPoseKey', curveId: ids.C1, yaw: 12, offsets: { a3: { x: -3, y: 2 } } }).ok).toBe(true)
      expect(ed.apply({ type: 'setPoseKey', curveId: ids.E1, yaw: -12.5, offsets: { e1: { x: 0.25, y: 1 } } }).ok).toBe(true)
    }
    for (const y of [...yaws, 12, -12.5]) same(evaluateAtYaw(b.reader, y), evaluateAtYaw(a.reader, y))
    expect(() => Editor.open(JSON.parse(JSON.stringify(b.save())))).not.toThrow()
  })

  it('a promoted track whose connected ends separate is refused on open (the connection check reads dp)', () => {
    const recs = promotedRecords().map((r) => {
      if (r.id !== 'forms:document/curve:C1') return r
      const f = structuredClone(r) as any
      f.yaw[f.yaw.length - 1].offsets.a3.dp = { x: 99, y: 0 }
      return f
    })
    const schemaNow = (new Editor().save() as any).schema
    expect(() => Editor.open({ store: Object.fromEntries(recs.map((r) => [r.id, r])), schema: schemaNow } as any)).toThrow(/ends separate/)
  })
})

it('Editor.open never freezes or changes the caller snapshot', () => {
  const snap = JSON.parse(JSON.stringify(new Editor(exampleRecords()).save()))
  const before = JSON.stringify(snap)
  Editor.open(snap)
  expect(Object.isFrozen(snap.store[ids.C1])).toBe(false)
  expect(JSON.stringify(snap)).toBe(before)
})
