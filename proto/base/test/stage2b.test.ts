// Stage 2b (doc 18 §19, §23.2 stage 2): structure commands on the real records, through the real write entry.
// Every committed command is checked through prepared preview → commit → undo → redo → save / reopen.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Command } from '../src/commands'
import { Editor } from '../src/editor'
import { evaluate, type Cubic, type Evaluated } from '../src/evaluate'
import { exampleRecords, ids } from '../src/fixture'
import { presetFormsIdOf, presetNeutral } from '../src/forms'
import { graphProblems } from '../src/model'
import { evaluateAtYaw, legacy3Keys } from '../src/pose'
import { schema, type CurveRecord, type DocRecord, type FillRecord, type FormsRecord } from '../src/schema'

const json = (f: string) => JSON.parse(readFileSync(`test/fixtures/${f}`, 'utf8'))
const unlocked = () => exampleRecords().map((r) => (r.id === ids.L2 ? { ...r, locked: false } : r))
const sample = (): DocRecord[] => json('stage1-valid.json').records
const openRecords = (rs: DocRecord[]) => Editor.open({ store: Object.fromEntries(rs.map((r) => [r.id, r])), schema: schema.serialize() } as any)
const YAWS = [-120, -90, -45, -12.5, 0, 12, 30, 45, 60, 89, 90, 120]
const lerp = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
function split(q: Cubic, u: number): [Cubic, Cubic] {
  const p01 = lerp(q[0], q[1], u), p12 = lerp(q[1], q[2], u), p23 = lerp(q[2], q[3], u), p012 = lerp(p01, p12, u), p123 = lerp(p12, p23, u), m = lerp(p012, p123, u)
  return [[q[0], p01, p012, m], [m, p123, p23, q[3]]]
}
const maxDiff = (a: Cubic[], b: Cubic[]) => Math.max(...a.flatMap((q, i) => q.map((p, j) => Math.hypot(p.x - b[i][j].x, p.y - b[i][j].y))))
const seg = (ev: Evaluated, address: string, id: string) => ev.curves.find((c) => c.address === address)!.segments.find((s) => s.id === id)!.cubic
const curve = (e: Editor, id: string) => e.reader.get(id as any) as CurveRecord

/** prepared preview → commit (preview = committed result) → undo (exact) → redo (exact) → save / reopen */
function roundTrip(e: Editor, cmd: Command) {
  const before = JSON.stringify(e.reader.allRecords())
  const op = e.prepare()
  const pv = op.preview(cmd)
  expect(pv.ok, JSON.stringify(pv)).toBe(true)
  if (!pv.ok) throw new Error('preview')
  const shown = e.derived.preview(pv.puts, e.derived.previewChanges(pv.puts, pv.removals))
  const r = op.commit()
  expect(r.ok && r.written, JSON.stringify(r)).toBe(true)
  if (!r.ok) throw new Error(r.error.message)
  expect(r.affected).toEqual(pv.affected) // same new ids as previewed
  expect(e.derived.evaluated()).toEqual(shown)
  expect(e.derived.evaluated()).toEqual(evaluate(e.reader))
  expect(graphProblems(e.reader)).toEqual([])
  const after = JSON.stringify(e.reader.allRecords())
  expect(e.undo()).toBe(true)
  expect(JSON.stringify(e.reader.allRecords())).toBe(before)
  expect(e.redo()).toBe(true)
  expect(JSON.stringify(e.reader.allRecords())).toBe(after)
  const reopened = Editor.open(JSON.parse(JSON.stringify(e.save())))
  expect(evaluate(reopened.reader)).toEqual(evaluate(e.reader))
  return r
}
const refused = (e: Editor, cmd: Command, message: RegExp) => {
  const before = JSON.stringify(e.reader.allRecords())
  const r = e.apply(cmd)
  expect(r.ok, JSON.stringify(r)).toBe(false)
  if (!r.ok) expect(r.error.message).toMatch(message)
  expect(JSON.stringify(e.reader.allRecords())).toBe(before)
}
/** a legacy document: poses on C1 (connected to C2) and E1 (shown mirrored by R1) at negative / arbitrary yaws */
function legacyDoc() {
  const e = new Editor(unlocked())
  for (const cmd of [
    { type: 'setPoseKey', curveId: ids.C1, yaw: 30, offsets: { a3: { x: 10, y: 0 }, a2: { x: 0.1, y: -0.3 } } },
    { type: 'setPoseKey', curveId: ids.C1, yaw: -45, offsets: { a2: { x: -2.7, y: 1.3 }, a1: { x: 4, y: 8 } } },
    { type: 'setPoseKey', curveId: ids.E1, yaw: 60, offsets: { e1: { x: 1 / 3, y: -2 / 7 }, e2: { x: 0.7, y: 0.1 } } },
  ] as Command[])
    expect(e.apply(cmd).ok).toBe(true)
  return e
}

describe('insertPoint: an exact split in every holder', () => {
  it('legacy curve with a head-turn track, connected ends and a fill: every yaw keeps the shape; the track is promoted', () => {
    const e = legacyDoc()
    const before = Object.fromEntries(YAWS.map((y) => [y, evaluateAtYaw(e.reader, y)]))
    const r = roundTrip(e, { type: 'insertPoint', curveId: ids.C1, segmentId: 's1', u: 0.37 })
    const c = curve(e, ids.C1)
    expect(c.segments.map((s) => s.id)).toEqual(['s1a', 's1b', 's2'])
    const f = e.reader.get('forms:document/curve:C1' as any) as FormsRecord
    expect(f.encoding).toBe('legacy-delta3')
    expect(Object.keys(legacy3Keys(f)[0].offsets).sort()).toEqual(['a1', 'a2', 'a3', 'm'])
    let worst = 0
    for (const y of YAWS) {
      const now = evaluateAtYaw(e.reader, y)
      worst = Math.max(worst, maxDiff(split(seg(before[y], ids.C1, 's1'), 0.37), [seg(now, ids.C1, 's1a'), seg(now, ids.C1, 's1b')]))
      expect(seg(now, ids.C1, 's2')).toEqual(seg(before[y], ids.C1, 's2')) // untouched segment: identical
      expect(now.curves.find((x) => x.address === ids.C2)).toEqual(before[y].curves.find((x) => x.address === ids.C2)) // connected curve: identical
    }
    expect(worst).toBeLessThan(1e-12)
    // the fill reads the two new segments in order; its geometry is the split of the old one
    expect((e.reader.get(ids.F) as FillRecord).boundary.slice(0, 2)).toEqual([{ curveId: ids.C1, segmentId: 's1a', dir: 1 }, { curveId: ids.C1, segmentId: 's1b', dir: 1 }])
    expect(r.affected).toContain(`${ids.C1}#m`)
  })

  it('the source of a mirrored reference: the instance keeps its shape at every yaw too', () => {
    const e = legacyDoc()
    const before = Object.fromEntries(YAWS.map((y) => [y, evaluateAtYaw(e.reader, y)]))
    roundTrip(e, { type: 'insertPoint', curveId: ids.E1, segmentId: 's5', u: 0.5 })
    for (const y of YAWS) {
      const now = evaluateAtYaw(e.reader, y)
      const inst = `${ids.R1}/${ids.E1}`
      expect(maxDiff(split(seg(before[y], inst, 's5'), 0.5), [seg(now, inst, 's5a'), seg(now, inst, 's5b')])).toBeLessThan(1e-12)
    }
  })

  it('new ids never collide; a prepared operation previews and commits the same ids', () => {
    const e = new Editor(unlocked())
    roundTrip(e, { type: 'insertPoint', curveId: ids.C1, segmentId: 's1', u: 0.5 }) // takes m, s1a, s1b
    const r = roundTrip(e, { type: 'insertPoint', curveId: ids.C1, segmentId: 's1a', u: 0.5 })
    const c = curve(e, ids.C1)
    expect(new Set(c.segments.map((s) => s.id)).size).toBe(c.segments.length)
    expect(Object.keys(c.anchors)).toContain('m~1')
    expect(r.affected).toContain(`${ids.C1}#m~1`)
  })

  it('preset forms of a family curve are split in every preset and key (identity-only presets stay missing)', () => {
    const e = openRecords(sample())
    const P = () => e.reader.get(presetFormsIdOf('preset:P', 'curve:strand') as any) as FormsRecord
    const before = (P().yaw[0] as any).shape
    roundTrip(e, { type: 'insertPoint', curveId: 'curve:strand' as any, segmentId: 't1', u: 0.25 })
    const after = (P().yaw[0] as any).shape
    const old: Cubic = [before.u.p, before.u.hOut, before.w.hIn, before.w.p]
    expect(maxDiff(split(old, 0.25), [[after.u.p, after.u.hOut, after.m.hIn, after.m.p], [after.m.p, after.m.hOut, after.w.hIn, after.w.p]])).toBeLessThan(1e-12)
    expect(presetNeutral(e.reader.get(presetFormsIdOf('preset:Q', 'curve:strand') as any) as FormsRecord)).toBeNull()
  })

  it('refused: rule role curve, a curve with reference overrides, u outside (0, 1)', () => {
    refused(openRecords(sample()), { type: 'insertPoint', curveId: 'curve:lid' as any, segmentId: 's1', u: 0.5 }, /role of rule:eye\/blink/)
    const e = new Editor(unlocked())
    expect(e.apply({ type: 'moveOverride', referenceId: ids.R1, target: { curveId: ids.E1, anchorId: 'e1' }, delta: { x: 1, y: 0 } }).ok).toBe(true)
    refused(e, { type: 'insertPoint', curveId: ids.E1, segmentId: 's5', u: 0.5 }, /override its anchors/)
    for (const u of [0, 1, -0.1, Number.NaN]) refused(new Editor(unlocked()), { type: 'insertPoint', curveId: ids.C1, segmentId: 's1', u }, /strictly between 0 and 1/)
  })
})

describe('removeAnchorJoin', () => {
  it('keepHandles: the neighbours keep their handles exactly in the drawing and in every yaw key; the fill follows', () => {
    const e = legacyDoc()
    const old = curve(e, ids.C1)
    roundTrip(e, { type: 'removeAnchorJoin', curveId: ids.C1, anchorId: 'a2', mode: 'keepHandles' })
    const c = curve(e, ids.C1)
    expect(c.anchors.a2).toBeUndefined()
    expect(c.anchors.a1).toEqual(old.anchors.a1)
    expect(c.anchors.a3).toEqual(old.anchors.a3)
    expect((e.reader.get(ids.F) as FillRecord).boundary.slice(0, 1)).toEqual([{ curveId: ids.C1, segmentId: 's1+s2', dir: 1 }])
  })

  it('insert then keepShape-remove the same point restores the curve at every yaw', () => {
    const e = legacyDoc()
    const before = Object.fromEntries(YAWS.map((y) => [y, evaluateAtYaw(e.reader, y)]))
    roundTrip(e, { type: 'insertPoint', curveId: ids.C1, segmentId: 's2', u: 0.4 })
    roundTrip(e, { type: 'removeAnchorJoin', curveId: ids.C1, anchorId: 'm', mode: 'keepShape' })
    for (const y of YAWS) expect(maxDiff([seg(evaluateAtYaw(e.reader, y), ids.C1, 's2a+s2b')], [seg(before[y], ids.C1, 's2')])).toBeLessThan(1e-9)
  })

  it('refused: end node, connected anchor, closed loop, rule role', () => {
    const e = new Editor(unlocked())
    refused(e, { type: 'removeAnchorJoin', curveId: ids.E1, anchorId: 'e1', mode: 'keepShape' }, /end node/)
    refused(e, { type: 'removeAnchorJoin', curveId: ids.C1, anchorId: 'a3', mode: 'keepShape' }, /end node|unbind/)
    refused(openRecords(sample()), { type: 'removeAnchorJoin', curveId: 'curve:lid' as any, anchorId: 'm', mode: 'keepShape' }, /role of rule/)
  })
})

describe('createCurve, deleteAnchorWithSegments, breakAt, closing segments', () => {
  const four = { anchors: { p: { id: 'p', p: { x: 100, y: 0 }, hIn: { x: 0, y: 0 }, hOut: { x: 5, y: 0 } }, q: { id: 'q', p: { x: 120, y: 10 }, hIn: { x: -5, y: 0 }, hOut: { x: 5, y: 0 } }, r: { id: 'r', p: { x: 140, y: 0 }, hIn: { x: -5, y: 0 }, hOut: { x: 5, y: 0 } }, s: { id: 's', p: { x: 160, y: 10 }, hIn: { x: -5, y: 0 }, hOut: { x: 0, y: 0 } } }, segments: [{ id: 'k1', from: 'p', to: 'q' }, { id: 'k2', from: 'q', to: 'r' }, { id: 'k3', from: 'r', to: 's' }] }

  it('createCurve (plain and preset author mode): the family registers it; this preset has the drawing, the others identity only', () => {
    const e = openRecords(sample())
    const r = roundTrip(e, { type: 'createCurve', id: 'curve:brow' as any, parentId: 'container:L1' as any, preset: 'preset:P' as any, ...four })
    expect((e.reader.get('family:eye' as any) as any).curves).toContain('curve:brow')
    expect(presetNeutral(e.reader.get(presetFormsIdOf('preset:P', 'curve:brow') as any) as FormsRecord)?.q.p).toEqual({ x: 120, y: 10 })
    expect((e.reader.get(presetFormsIdOf('preset:Q', 'curve:brow') as any) as FormsRecord).original).toBeNull()
    expect(r.affected).toEqual(['curve:brow'])
    const plain = new Editor(unlocked())
    const p = plain.prepare()
    const pv = p.preview({ type: 'createCurve', parentId: ids.L1, ...four })
    const c = p.commit()
    expect(pv.ok && c.ok && c.affected[0] === pv.affected[0]).toBe(true)
  })

  const five = {
    anchors: { ...four.anchors, s: { id: 's', p: { x: 160, y: 10 }, hIn: { x: -5, y: 0 }, hOut: { x: 5, y: 0 } }, t: { id: 't', p: { x: 180, y: 0 }, hIn: { x: -5, y: 0 }, hOut: { x: 0, y: 0 } } },
    segments: [...four.segments, { id: 'k4', from: 's', to: 't' }],
  }

  it('deleting an interior anchor splits a legacy curve: track, reference overrides, connections and fills follow their anchors', () => {
    const e = new Editor(unlocked())
    roundTrip(e, { type: 'createCurve', id: 'curve:L' as any, parentId: ids.L3, ...five }) // shown by R1 (source L3)
    roundTrip(e, { type: 'createCurve', id: 'curve:T' as any, parentId: ids.L3, anchors: { u: { id: 'u', p: { x: 180, y: 0 }, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 5 } }, w: { id: 'w', p: { x: 180, y: 30 }, hIn: { x: 0, y: -5 }, hOut: { x: 0, y: 0 } } }, segments: [{ id: 'z1', from: 'u', to: 'w' }] })
    roundTrip(e, { type: 'bind', a: { curveId: 'curve:L' as any, anchorId: 't' }, b: { curveId: 'curve:T' as any, anchorId: 'u' }, keep: 'first', id: 'connection:LT' as any })
    expect(e.apply({ type: 'setPoseKey', curveId: 'curve:L' as any, yaw: 40, offsets: { s: { x: 2, y: 1 }, p: { x: -1, y: 0 } } }).ok).toBe(true)
    expect(e.apply({ type: 'moveOverride', referenceId: ids.R1, target: { curveId: 'curve:L' as any, anchorId: 's' }, delta: { x: 0, y: 3 } }).ok).toBe(true)
    const before = Object.fromEntries(YAWS.map((y) => [y, evaluateAtYaw(e.reader, y)]))
    roundTrip(e, { type: 'deleteAnchorWithSegments', curveId: 'curve:L' as any, anchorId: 'r' })
    const left = curve(e, 'curve:L'), right = curve(e, 'curve:L~part')
    expect(left.segments.map((x) => x.id)).toEqual(['k1'])
    expect(right.segments.map((x) => x.id)).toEqual(['k4'])
    expect(e.reader.get('forms:document/curve:L~part' as any)).toBeTruthy() // the track split with its anchors
    expect((e.reader.get(ids.R1) as any).overrides['curve:L~part#s']).toBeTruthy()
    expect((e.reader.get('connection:LT' as any) as any).ends[0]).toEqual({ curveId: 'curve:L~part', anchorId: 't' })
    for (const y of YAWS) {
      const now = evaluateAtYaw(e.reader, y)
      expect(seg(now, 'curve:L~part', 'k4')).toEqual(seg(before[y], 'curve:L', 'k4')) // kept segments: identical, in the instance too
      expect(seg(now, `${ids.R1}/curve:L~part`, 'k4')).toEqual(seg(before[y], `${ids.R1}/curve:L`, 'k4'))
      expect(seg(now, 'curve:L', 'k1')).toEqual(seg(before[y], 'curve:L', 'k1'))
    }
  })

  it('deleting an interior anchor of a family curve registers the new part in the family with forms for every preset', () => {
    const e = openRecords(sample())
    roundTrip(e, { type: 'createCurve', id: 'curve:brow' as any, parentId: 'container:L1' as any, preset: 'preset:P' as any, ...five })
    roundTrip(e, { type: 'deleteAnchorWithSegments', curveId: 'curve:brow' as any, anchorId: 'r' })
    expect((e.reader.get('family:eye' as any) as any).curves).toEqual(expect.arrayContaining(['curve:brow', 'curve:brow~part']))
    expect(Object.keys((presetNeutral(e.reader.get(presetFormsIdOf('preset:P', 'curve:brow~part') as any) as FormsRecord) ?? {}))).toEqual(['s', 't'])
    expect((e.reader.get(presetFormsIdOf('preset:Q', 'curve:brow~part') as any) as FormsRecord).original).toBeNull()
  })

  it('breakAt on a closed filled loop: one open chain, the fill stays closed through a bridge at the cut (same geometry)', () => {
    const e = new Editor(unlocked())
    roundTrip(e, { type: 'createCurve', id: 'curve:O' as any, parentId: ids.L1, ...four })
    roundTrip(e, { type: 'addClosingSegment', curveId: 'curve:O' as any })
    const boundary = ['k1', 'k2', 'k3', 'close'].map((segmentId) => ({ curveId: 'curve:O' as any, segmentId, dir: 1 as const }))
    roundTrip(e, { type: 'createFill', id: 'fill:O' as any, parentId: ids.L1, boundary })
    const cubics = () => e.derived.evaluated().fills.find((f) => f.address === 'fill:O')!.cubics
    const old = cubics()
    roundTrip(e, { type: 'breakAt', curveId: 'curve:O' as any, anchorId: 'r' })
    const c = curve(e, 'curve:O')
    expect(c.closed).toBe(false)
    expect(c.segments.map((x) => x.id)).toEqual(['k3', 'close', 'k1', 'k2'])
    const b = (e.reader.get('fill:O' as any) as FillRecord).boundary
    expect(b.filter((x) => 'bridge' in x).length).toBe(1)
    const now = cubics().filter((q) => !(q[0].x === q[3].x && q[0].y === q[3].y && q[1].x === q[0].x)) // drop the zero-length bridge
    expect(now).toEqual(old)
    // move one side of the cut: the other stays, the bridge follows
    roundTrip(e, { type: 'moveAnchors', targets: [{ curveId: 'curve:O' as any, anchorId: "r'" }], delta: { x: 0, y: 7 } })
    expect(curve(e, 'curve:O').anchors.r.p).toEqual({ x: 140, y: 0 })
  })

  it('removing the closing segment reopens the loop; adding it back restores the record', () => {
    const e = new Editor(unlocked())
    roundTrip(e, { type: 'createCurve', id: 'curve:O' as any, parentId: ids.L1, ...four })
    const open = JSON.stringify(curve(e, 'curve:O'))
    roundTrip(e, { type: 'addClosingSegment', curveId: 'curve:O' as any })
    roundTrip(e, { type: 'removeClosingSegment', curveId: 'curve:O' as any, segmentId: 'close' })
    expect(JSON.stringify(curve(e, 'curve:O'))).toBe(open)
  })

  it('mergeEnds (legacy) keeps the ends together at every yaw; refused on family curves and with connections', () => {
    const e = new Editor(unlocked())
    roundTrip(e, { type: 'createCurve', id: 'curve:O' as any, parentId: ids.L1, ...four })
    expect(e.apply({ type: 'setPoseKey', curveId: 'curve:O' as any, yaw: 50, offsets: { p: { x: 3, y: 0 }, s: { x: -1, y: 2 } } }).ok).toBe(true)
    const before = Object.fromEntries(YAWS.map((y) => [y, evaluateAtYaw(e.reader, y)]))
    roundTrip(e, { type: 'mergeEnds', curveId: 'curve:O' as any, keep: 'mid' })
    for (const y of YAWS) {
      const was = before[y].curves.find((c) => c.address === 'curve:O')!.anchors
      const now = evaluateAtYaw(e.reader, y).curves.find((c) => c.address === 'curve:O')!.anchors
      expect(now.p.p.x).toBeCloseTo((was.p.p.x + was.s.p.x) / 2, 12)
      expect(now.p.p.y).toBeCloseTo((was.p.p.y + was.s.p.y) / 2, 12)
    }
    refused(openRecords(sample()), { type: 'mergeEnds', curveId: 'curve:strand' as any, keep: 'mid' }, /one segment|stage 3/)
  })

  it('bind / unbind (legacy): the ends meet at every yaw (the reopen check passes); refused on family curves', () => {
    const e = legacyDoc()
    roundTrip(e, { type: 'createCurve', id: 'curve:O' as any, parentId: ids.L3, ...four })
    expect(e.apply({ type: 'setPoseKey', curveId: 'curve:O' as any, yaw: -20, offsets: { p: { x: 3, y: 1 } } }).ok).toBe(true)
    roundTrip(e, { type: 'bind', a: { curveId: ids.E1, anchorId: 'e2' }, b: { curveId: 'curve:O' as any, anchorId: 'p' }, keep: 'mid', id: 'connection:EO' as any })
    for (const y of YAWS) {
      const ev = evaluateAtYaw(e.reader, y)
      const a = ev.curves.find((c) => c.address === ids.E1)!.anchors.e2.p, b = ev.curves.find((c) => c.address === 'curve:O')!.anchors.p.p
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-12)
    }
    const positions = JSON.stringify([curve(e, ids.E1), curve(e, 'curve:O')])
    roundTrip(e, { type: 'unbind', connectionId: 'connection:EO' as any })
    expect(JSON.stringify([curve(e, ids.E1), curve(e, 'curve:O')])).toBe(positions)
    refused(openRecords(sample()), { type: 'bind', a: { curveId: 'curve:strand' as any, anchorId: 'u' }, b: { curveId: 'curve:C1' as any, anchorId: 'a1' }, keep: 'mid' }, /override its anchors|across modes is not supported/) // stage 3c: new-mode bind exists; mixed family / legacy is still refused
  })
})

describe('character data, locks, cuts on open chains and the remaining refusals', () => {
  const withCharacterOnStrand = () => {
    const rs: any[] = structuredClone(sample())
    const k = rs.find((r) => r.id === 'character:K')
    const P90 = rs.find((r) => r.id === 'forms:preset:P/curve:strand').yaw[0].shape
    k.fineTune['curve:strand'] = { w: { dp: { x: 1, y: 2 }, dIn: { x: 1, y: 2 }, dOut: { x: 1, y: 2 } } }
    k.takeovers.push({ kind: 'line', id: 'takeover:strand@90', curveId: 'curve:strand', state: { yaw: 90 }, direction: { from: 0, to: 90 }, target: P90, basisFront: P90, L: [1, 0.25, -0.5, 2] })
    return openRecords(rs)
  }

  it('insertPoint splits a character’s fine-tune offsets and frozen takeover shapes linearly; the frozen L is kept', () => {
    const e = withCharacterOnStrand()
    roundTrip(e, { type: 'insertPoint', curveId: 'curve:strand' as any, segmentId: 't1', u: 0.5 })
    const k = e.reader.get('character:K' as any) as any
    expect(k.fineTune['curve:strand'].m.dp).toEqual({ x: 0.5, y: 1 }) // half of w's offset at u = 0.5, u's offset 0
    const t = k.takeovers.find((x: any) => x.id === 'takeover:strand@90')
    expect(Object.keys(t.target).sort()).toEqual(['m', 'u', 'w'])
    expect(t.L).toEqual([1, 0.25, -0.5, 2])
  })

  it('join, delete and cut are refused on curves with character data', () => {
    const e = withCharacterOnStrand()
    roundTrip(e, { type: 'insertPoint', curveId: 'curve:strand' as any, segmentId: 't1', u: 0.5 })
    refused(e, { type: 'removeAnchorJoin', curveId: 'curve:strand' as any, anchorId: 'm', mode: 'keepHandles' }, /characters character:K hold data/)
    refused(e, { type: 'deleteAnchorWithSegments', curveId: 'curve:strand' as any, anchorId: 'm' }, /characters character:K hold data/)
    refused(e, { type: 'breakAt', curveId: 'curve:strand' as any, anchorId: 'm' }, /characters character:K hold data/)
  })

  it('a curve in a locked container is not edited (LOCKED)', () => {
    const e = new Editor(exampleRecords()) // L2 locked: C2
    const r = e.apply({ type: 'insertPoint', curveId: ids.C2, segmentId: 's3', u: 0.5 })
    expect(r.ok === false && r.error.code).toBe('LOCKED')
  })

  it('breakAt at an interior anchor of an open chain: two curves; a fill through the cut gets a bridge between them', () => {
    const e = new Editor(unlocked())
    const before = e.derived.evaluated().fills.find((f) => f.address === ids.F)!.cubics
    refused(e, { type: 'breakAt', curveId: ids.C1, anchorId: 'a3' }, /end node/)
    roundTrip(e, { type: 'breakAt', curveId: ids.C1, anchorId: 'a2' })
    expect(curve(e, ids.C1).segments.map((s) => s.id)).toEqual(['s1'])
    expect(curve(e, 'curve:C1~part').segments.map((s) => s.id)).toEqual(['s2'])
    const b = (e.reader.get(ids.F) as FillRecord).boundary
    expect(b[1]).toEqual({ bridge: { from: { curveId: ids.C1, anchorId: "a2'" }, to: { curveId: 'curve:C1~part', anchorId: 'a2' } } })
    const now = e.derived.evaluated().fills.find((f) => f.address === ids.F)!.cubics
    expect([now[0], ...now.slice(2)]).toEqual(before) // same geometry plus one zero-length bridge
  })

  it('refused: cutting at a connected anchor, deleting what a connection or fill still uses, removing a used closing segment, malformed new curves', () => {
    const e = new Editor(unlocked())
    refused(e, { type: 'deleteAnchorWithSegments', curveId: ids.C1, anchorId: 'a3' }, /connection .* uses curve:C1#a3/)
    refused(e, { type: 'deleteAnchorWithSegments', curveId: ids.C2, anchorId: 'b2' }, /without segments/)
    refused(e, { type: 'createCurve', parentId: ids.L1, anchors: { a: { id: 'a', p: { x: 0, y: 0 }, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 } } }, segments: [] }, /at least one segment/)
    refused(e, { type: 'createCurve', parentId: ids.L1, anchors: {}, segments: [{ id: 'x', from: 'a', to: 'b' }] }, /every segment end must be an anchor/)
    refused(e, { type: 'createCurve', parentId: 'container:nope' as any, anchors: {}, segments: [{ id: 'x', from: 'a', to: 'b' }] }, /no container/)
    const o = new Editor(unlocked())
    const four = { anchors: { p: { id: 'p', p: { x: 0, y: 0 }, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 } }, q: { id: 'q', p: { x: 9, y: 0 }, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 } }, r: { id: 'r', p: { x: 9, y: 9 }, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 } } }, segments: [{ id: 'k1', from: 'p', to: 'q' }, { id: 'k2', from: 'q', to: 'r' }] }
    roundTrip(o, { type: 'createCurve', id: 'curve:O' as any, parentId: ids.L1, ...four })
    roundTrip(o, { type: 'addClosingSegment', curveId: 'curve:O' as any })
    roundTrip(o, { type: 'createFill', id: 'fill:O' as any, parentId: ids.L1, boundary: ['k1', 'k2', 'close'].map((segmentId) => ({ curveId: 'curve:O' as any, segmentId, dir: 1 as const })) })
    refused(o, { type: 'removeClosingSegment', curveId: 'curve:O' as any, segmentId: 'close' }, /fill fill:O uses close/)
    refused(o, { type: 'removeAnchorJoin', curveId: 'curve:O' as any, anchorId: 'q', mode: 'keepShape' }, /closed loop/)
  })
})

it('a cut where the boundary meets an EXISTING bridge re-points that bridge (no duplicate), geometry unchanged', () => {
  const e = new Editor(unlocked())
  const three = { anchors: { p: { id: 'p', p: { x: 0, y: 0 }, hIn: { x: 0, y: 0 }, hOut: { x: 3, y: 0 } }, q: { id: 'q', p: { x: 30, y: 0 }, hIn: { x: -3, y: 0 }, hOut: { x: 0, y: 3 } }, r: { id: 'r', p: { x: 30, y: 30 }, hIn: { x: 0, y: -3 }, hOut: { x: 0, y: 0 } } }, segments: [{ id: 'k1', from: 'p', to: 'q' }, { id: 'k2', from: 'q', to: 'r' }] }
  roundTrip(e, { type: 'createCurve', id: 'curve:O' as any, parentId: ids.L1, ...three })
  // boundary: k1 (p → q), then an existing bridge q → p
  roundTrip(e, { type: 'createFill', id: 'fill:G' as any, parentId: ids.L1, boundary: [{ curveId: 'curve:O' as any, segmentId: 'k1', dir: 1 }, { bridge: { from: { curveId: 'curve:O' as any, anchorId: 'q' }, to: { curveId: 'curve:O' as any, anchorId: 'p' } } }] })
  const before = e.derived.evaluated().fills.find((f) => f.address === 'fill:G')!.cubics
  roundTrip(e, { type: 'breakAt', curveId: 'curve:O' as any, anchorId: 'q' })
  const b = (e.reader.get('fill:G' as any) as FillRecord).boundary
  expect(b.filter((x) => 'bridge' in x).length).toBe(1) // re-pointed, not duplicated
  expect(b[1]).toEqual({ bridge: { from: { curveId: 'curve:O', anchorId: "q'" }, to: { curveId: 'curve:O', anchorId: 'p' } } })
  expect(e.derived.evaluated().fills.find((f) => f.address === 'fill:G')!.cubics).toEqual(before)
})

describe('review of 56ede93 (dot): sparse promoted tracks, segment identity, operation target binding', () => {
  it('insertPoint on a sparse legal delta3 track (missing anchor = 0) works and keeps the shape at every yaw', () => {
    const recs = exampleRecords().map((r) => (r.id === ids.L2 ? { ...r, locked: false } : r)) as DocRecord[]
    // E1 has no connections; only e1 has offsets (e2 missing = 0)
    recs.push({ typeName: 'forms', id: 'forms:document/curve:E1', curveId: ids.E1, owner: { kind: 'document' }, encoding: 'legacy-delta3', original: 'curve', expr: {},
      yaw: [{ yaw: 0, offsets: { e1: { dp: { x: 2, y: 1 }, dIn: { x: 3, y: 4 }, dOut: { x: 5, y: 6 } } } }, { yaw: 40, offsets: {} }] } as any)
    const e = Editor.open({ store: Object.fromEntries(recs.map((r) => [r.id, r])), schema: schema.serialize() } as any)
    const before = Object.fromEntries([-10, 0, 20, 40, 70].map((y) => [y, evaluateAtYaw(e.reader, y)]))
    roundTrip(e, { type: 'insertPoint', curveId: ids.E1, segmentId: 's5', u: 0.4 })
    for (const y of [-10, 0, 20, 40, 70]) expect(maxDiff(split(seg(before[y], ids.E1, 's5'), 0.4), [seg(evaluateAtYaw(e.reader, y), ids.E1, 's5a'), seg(evaluateAtYaw(e.reader, y), ids.E1, 's5b')])).toBeLessThan(1e-12)
  })

  it('a segment id twice, or a segment from an anchor to itself, is refused (createCurve and open)', () => {
    const e = new Editor(unlocked())
    const anchors = { a: { id: 'a', p: { x: 0, y: 0 }, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 } }, b: { id: 'b', p: { x: 9, y: 0 }, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 } }, c: { id: 'c', p: { x: 9, y: 9 }, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 } } }
    refused(e, { type: 'createCurve', parentId: ids.L1, anchors, segments: [{ id: 's0', from: 'a', to: 'b' }, { id: 's0', from: 'b', to: 'c' }] }, /segment ids must be unique/)
    const file = JSON.parse(JSON.stringify(e.save()))
    file.store[ids.C1].segments[1] = { id: 's2', from: 'a3', to: 'a3' }
    expect(() => Editor.open(file)).toThrow(/invalid document: .*goes from a3 to itself/)
  })

  it('a prepared operation re-aimed at another target never reuses its ids there (no self loop)', () => {
    const e = new Editor(unlocked())
    const B = { anchors: { x: { id: 'x', p: { x: 0, y: 0 }, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 } }, m: { id: 'm', p: { x: 9, y: 0 }, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 } }, z: { id: 'z', p: { x: 9, y: 9 }, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 } } }, segments: [{ id: 's0', from: 'x', to: 'm' }, { id: 's1', from: 'm', to: 'z' }] }
    roundTrip(e, { type: 'createCurve', id: 'curve:B' as any, parentId: ids.L1, ...B })
    const op = e.prepare()
    expect(op.preview({ type: 'insertPoint', curveId: ids.E1, segmentId: 's5', u: 0.3 }).ok).toBe(true) // allocates m on E1
    const r = op.commit({ type: 'insertPoint', curveId: 'curve:B' as any, segmentId: 's0', u: 0.6 })
    expect(r.ok && r.written).toBe(true)
    const c = curve(e, 'curve:B')
    expect(Object.keys(c.anchors).length).toBe(4)
    expect(c.segments.every((s) => s.from !== s.to)).toBe(true)
    expect(graphProblems(e.reader)).toEqual([])
  })
})
