// Pose editing keeps connections (option A, dot, review of 2a48719): one edit computes its linked
// range, checks locks once, commits once; untouched points keep their form; connected ends agree at
// EVERY yaw; evaluation never pulls the other end. Formerly KF-2.
import { describe, expect, it } from 'vitest'
import { createApi } from '../src/api'
import type { Command } from '../src/commands'
import { Editor } from '../src/editor'
import { exampleRecords, ids } from '../src/fixture'
import { graphProblems } from '../src/model'
import { evaluateAtYaw } from '../src/pose'
import { poseIdOf, type FormsRecord } from '../src/schema'
import { legacyKeys } from '../src/pose'

const YAWS = [-90, -60, -45, -10, 0, 7.5, 30, 45, 60, 89, 90]
const unlocked = () => new Editor(exampleRecords().map((r) => (r.id === ids.L2 ? { ...r, locked: false } : r)))
const key = (curveId: any, yaw: number, offsets: Record<string, { x: number; y: number }>): Command => ({ type: 'setPoseKey', curveId, yaw, offsets })
const at = (e: Editor, yaw: number, curve: string, anchor: string) => e.derived.atYaw(yaw).curves.find((c) => c.address === curve)!.anchors[anchor].p
const state = (e: Editor) => ({ doc: JSON.stringify(e.reader.serialize('document')), hist: JSON.stringify(e.history), rev: e.revision })
function joinedEverywhere(e: Editor) {
  for (const y of YAWS) {
    expect(at(e, y, ids.C1, 'a3'), `J @${y}`).toEqual(at(e, y, ids.C2, 'b3'))
    expect(at(e, y, ids.C1, 'a1'), `J0 @${y}`).toEqual(at(e, y, ids.C2, 'b1'))
    const f = e.derived.atYaw(y).fills.find((x) => x.address === ids.F)!
    for (let i = 0; i < f.cubics.length; i++) expect(f.cubics[i][3], `fill closed @${y}`).toEqual(f.cubics[(i + 1) % f.cubics.length][0])
    expect(e.derived.atYaw(y)).toEqual(evaluateAtYaw(e.reader, y))
  }
}

describe('connected anchors under pose edits', () => {
  it("dot's case: the other end is in a locked layer → LOCKED, nothing written", () => {
    const e = new Editor(exampleRecords())
    const before = state(e)
    expect(e.apply(key(ids.C1, 90, { a3: { x: 10, y: 5 } }))).toMatchObject({ ok: false, error: { code: 'LOCKED' } })
    expect(state(e)).toEqual(before)
  })

  it('unlocked: the connected end receives the same offset; ends and the fill stay closed at every yaw', () => {
    const e = unlocked()
    const r = e.apply(key(ids.C1, 90, { a3: { x: 10, y: 5 } }))
    expect(r).toMatchObject({ ok: true, written: true })
    expect(r.ok && r.affected.sort()).toEqual([poseIdOf(ids.C1), poseIdOf(ids.C2)].sort())
    expect(e.history.undo).toEqual(['setPoseKey']) // one edit, one undo step
    expect(at(e, 90, ids.C1, 'a3')).toEqual({ x: 70, y: 105 })
    joinedEverywhere(e)
  })

  it('links through the second connection too (J0: a1 ⟷ b1)', () => {
    const e = unlocked()
    e.apply(key(ids.C2, -90, { b1: { x: -3, y: 2 } }))
    expect(at(e, -90, ids.C1, 'a1')).toEqual({ x: -3, y: 2 })
    joinedEverywhere(e)
  })
})

describe('anchors not named keep their form', () => {
  const sample = (e: Editor, curve: string, anchor: string) => YAWS.map((y) => at(e, y, curve, anchor))
  it('a NEW key captures the current interpolated form of every other anchor', () => {
    const e = unlocked()
    e.apply(key(ids.C1, -90, { a2: { x: -12, y: 2 } }))
    e.apply(key(ids.C1, 90, { a2: { x: 12, y: -2 } }))
    const a2 = sample(e, ids.C1, 'a2')
    e.apply(key(ids.C1, 30, { a1: { x: 1, y: 0 } })) // new key; does not name a2 (nor a3)
    expect(sample(e, ids.C1, 'a2')).toEqual(a2) // a2's form at EVERY yaw unchanged
    joinedEverywhere(e)
  })
  it('updating an EXISTING key keeps the anchors it does not name; an explicit zero sets zero', () => {
    const e = unlocked()
    e.apply(key(ids.C1, 90, { a2: { x: 12, y: -2 }, a1: { x: 4, y: 0 } }))
    e.apply(key(ids.C1, 90, { a1: { x: 6, y: 0 } }))
    const k90 = legacyKeys(e.reader.get(poseIdOf(ids.C1)) as FormsRecord).find((k) => k.yaw === 90)! // stage 1: legacy forms record
    expect(k90.offsets.a2).toEqual({ x: 12, y: -2 })
    expect(k90.offsets.a1).toEqual({ x: 6, y: 0 })
    e.apply(key(ids.C1, 90, { a2: { x: 0, y: 0 } }))
    expect(at(e, 90, ids.C1, 'a2')).toEqual({ x: 10, y: 60 }) // base position: zero offset
    joinedEverywhere(e)
  })
})

describe('different key yaws on connected curves', () => {
  it('connected curves are aligned on each other key yaws first, so the ends agree everywhere and other shapes do not change', () => {
    const e = unlocked()
    e.apply(key(ids.C1, -90, { a2: { x: -12, y: 2 } }))
    e.apply(key(ids.C1, 90, { a2: { x: 12, y: -2 } }))
    e.apply(key(ids.C2, 0, { b2: { x: 0, y: 5 } }))
    const a2 = YAWS.map((y) => at(e, y, ids.C1, 'a2'))
    const b2 = YAWS.map((y) => at(e, y, ids.C2, 'b2'))
    e.apply(key(ids.C1, 90, { a3: { x: 10, y: 5 } }))
    joinedEverywhere(e)
    expect(YAWS.map((y) => at(e, y, ids.C1, 'a2'))).toEqual(a2)
    expect(YAWS.map((y) => at(e, y, ids.C2, 'b2'))).toEqual(b2)
  })
})

describe('undo, redo, reopen and the safety net', () => {
  it('undo restores both poses; redo re-applies; reopen keeps the ends together', () => {
    const e = unlocked()
    const before = state(e)
    e.apply(key(ids.C1, 90, { a3: { x: 10, y: 5 } }))
    const after = state(e)
    e.undo()
    expect(state(e).doc).toBe(before.doc)
    e.redo()
    expect(state(e).doc).toBe(after.doc)
    const o = Editor.open(JSON.parse(JSON.stringify(e.save())))
    expect(graphProblems(o.reader)).toEqual([])
    joinedEverywhere(o)
  })
  it('a document whose poses separate a connection is refused on open (safety net, same rule as writes)', () => {
    const e = unlocked()
    const saved = JSON.parse(JSON.stringify(e.save()))
    // stage 1: an OLD-format file (before the schema-2 migration) carrying a raw pose; opening migrates it
    delete saved.schema.sequences['contour.document']
    const pose = { id: 'pose:C1', typeName: 'pose', curveId: ids.C1, keys: [{ yaw: 90, offsets: { a3: { x: 10, y: 5 } } }] }
    saved.store[pose.id] = pose
    expect(() => Editor.open(saved)).toThrow(/ends separate at yaw 90/)
  })

  it('KF-5 (gate properties-19, seed -457595632, 2026-10-07): a key on one curve gives every joined curve with a track the same key yaws — the joined point is the same number at every yaw, bit for bit', () => {
    const e = new Editor(exampleRecords())
    e.batch('kf5', () => {
      e.apply({ type: 'setContainerFlags', containerId: ids.L2, locked: false })
      e.apply({ type: 'setPoseKey', curveId: ids.C1, yaw: 90, offsets: { a1: { x: 0, y: 0 } } })
      e.apply({ type: 'setPoseKey', curveId: ids.C1, yaw: -90, offsets: { a1: { x: 0, y: 7 } } })
    })
    // a key on C2 alone, naming no anchor: C1 (joined through J0) gets the key yaw 0 too, shapes unchanged
    const at = (y: number) => evaluateAtYaw(e.reader, y)
    const before = [-90, 0, 90, 12.5].map(at)
    expect(e.apply({ type: 'setPoseKey', curveId: ids.C2, yaw: 0, offsets: {} }).ok).toBe(true)
    const yawsOf = (cid: string) => legacyKeys(e.reader.get(poseIdOf(cid) as any) as FormsRecord).map((k) => k.yaw)
    expect(yawsOf(ids.C1)).toEqual(yawsOf(ids.C2))
    const j0 = e.reader.allRecords().find((r) => r.id === 'connection:J0') as any
    for (let y = -90; y <= 90; y += 0.5) {
      const at = e.derived.atYaw(y)
      const ps = j0.ends.map((end: any) => at.curves.find((c) => c.address === end.curveId)!.anchors[end.anchorId].p)
      expect(ps[1], `@${y}`).toEqual(ps[0])
    }
    // the inserted keys carry the current interpolated values: at the key yaws nothing moved, bit for bit; between
    // keys C1 is now computed over the shared keys — the same shape, its last float digit may differ (that is the fix)
    const after = [-90, 0, 90, 12.5].map(at)
    for (let k = 0; k < 3; k++) expect(after[k].curves).toEqual(before[k].curves)
    for (const c of after[3].curves)
      for (const [a, v] of Object.entries(c.anchors)) {
        const was = before[3].curves.find((x) => x.address === c.address)!.anchors[a].p
        expect(Math.abs(v.p.x - was.x) + Math.abs(v.p.y - was.y)).toBeLessThan(1e-12)
      }
  })

  it('KF-5: the joined curve is in a locked layer — the key is refused as a whole (its track would change), nothing written', () => {
    const e = new Editor(exampleRecords())
    e.batch('setup', () => {
      e.apply({ type: 'setContainerFlags', containerId: ids.L2, locked: false })
      e.apply({ type: 'setPoseKey', curveId: ids.C1, yaw: 90, offsets: { a1: { x: 0, y: 0 } } })
    })
    const layerOf = (cid: string) => (e.reader.get(cid as any) as any).parentId
    expect(layerOf(ids.C1)).not.toBe(layerOf(ids.C2)) // C1 in L1, C2 in L2 (fixture)
    e.apply({ type: 'setContainerFlags', containerId: layerOf(ids.C1), locked: true })
    const snap = JSON.stringify(e.reader.allRecords())
    const r = e.apply({ type: 'setPoseKey', curveId: ids.C2, yaw: 0, offsets: {} })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('LOCKED')
    expect(JSON.stringify(e.reader.allRecords())).toBe(snap)
  })
})
