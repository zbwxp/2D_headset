// Stage 3c (doc 18 §24.5 last row, acceptance 8): bind and mergeEnds on FAMILY curves (new mode).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { playCharacter } from '../src/character'
import type { Command } from '../src/commands'
import { Editor } from '../src/editor'
import { presetFormsIdOf } from '../src/forms'
import { graphProblems } from '../src/model'
import { schema, type DocRecord, type FormsRecord } from '../src/schema'

const json = (f: string) => JSON.parse(readFileSync(`test/fixtures/${f}`, 'utf8'))
const openRecords = (rs: DocRecord[]) => Editor.open({ store: Object.fromEntries(rs.map((r) => [r.id, r])), schema: schema.serialize() } as any)
const K = 'character:K'
/** the sample without character data on the lids (binding never edits character data) */
const plain = () => {
  const rs = json('stage1-valid.json').records
  const k = rs.find((r: any) => r.id === K)
  k.takeovers = []
  k.exprFixes = []
  return rs
}
const roundTrip = (e: Editor, cmd: Command) => {
  const before = JSON.stringify(e.reader.allRecords())
  const op = e.prepare()
  const pv = op.preview(cmd)
  expect(pv.ok, JSON.stringify(pv)).toBe(true)
  const r = op.commit()
  expect(r.ok && r.written, JSON.stringify(r)).toBe(true)
  expect(graphProblems(e.reader)).toEqual([])
  const after = JSON.stringify(e.reader.allRecords())
  expect(e.undo()).toBe(true)
  expect(JSON.stringify(e.reader.allRecords())).toBe(before)
  expect(e.redo()).toBe(true)
  expect(JSON.stringify(e.reader.allRecords())).toBe(after)
  expect(() => Editor.open(JSON.parse(JSON.stringify(e.save())))).not.toThrow()
}
const refused = (e: Editor, cmd: Command, message: RegExp) => {
  const before = JSON.stringify(e.reader.allRecords())
  const r = e.apply(cmd)
  expect(r.ok, JSON.stringify(r)).toBe(false)
  if (!r.ok) expect(r.error.message).toMatch(message)
  expect(JSON.stringify(e.reader.allRecords())).toBe(before)
}
const leftGap = (e: Editor, yaw: number, blink: number) => {
  const p = e.derived.character(K)
  if (!p.ok) throw new Error(p.problems.join())
  const r = playCharacter(p.grid, { yaw, params: { blink } })
  if (!r.ok) throw new Error(r.problems.join())
  const a = r.shapes['curve:lid'].a.p, c = r.shapes['curve:lowerLid'].c.p
  return Math.hypot(a.x - c.x, a.y - c.y)
}

describe('bind on family curves', () => {
  for (const keep of ['mid', 'first', 'second'] as const)
    it(`binds the left eye corner (${keep}): every preset at every stored state moves both ends to one point; the character plays without a gap`, () => {
      const e = openRecords(plain())
      roundTrip(e, { type: 'bind', a: { curveId: 'curve:lid' as any, anchorId: 'a' }, b: { curveId: 'curve:lowerLid' as any, anchorId: 'c' }, keep, id: 'connection:left' as any })
      for (const p of ['preset:P', 'preset:Q']) {
        const A = e.reader.get(presetFormsIdOf(p, 'curve:lid') as any) as FormsRecord
        const B = e.reader.get(presetFormsIdOf(p, 'curve:lowerLid') as any) as FormsRecord
        expect((A.original as any).a.p).toEqual((B.original as any).c.p)
        for (const k of A.yaw as any[]) expect(k.shape.a.p).toEqual((B.yaw as any[]).find((x) => x.yaw === k.yaw).shape.c.p)
      }
      for (const y of [-120, -60, -10, 0, 30, 45, 60, 90, 120]) for (const b of [0, 0.5, 1]) expect(leftGap(e, y, b)).toBe(0)
    })

  it('the kept side does not move (keep first): the upper lid’s corner keeps its stored positions', () => {
    const before = openRecords(plain())
    const e = openRecords(plain())
    roundTrip(e, { type: 'bind', a: { curveId: 'curve:lid' as any, anchorId: 'a' }, b: { curveId: 'curve:lowerLid' as any, anchorId: 'c' }, keep: 'first' })
    const was = before.reader.get(presetFormsIdOf('preset:P', 'curve:lid') as any) as any
    const now = e.reader.get(presetFormsIdOf('preset:P', 'curve:lid') as any) as any
    expect(now.original.a).toEqual(was.original.a)
    for (const k of was.yaw) expect(now.yaw.find((x: any) => x.yaw === k.yaw).shape.a).toEqual(k.shape.a)
  })

  it('refused: characters with takeovers / expression fixes on these curves, different fine-tune at the two ends, curves of different modes', () => {
    const withData = openRecords(json('stage1-valid.json').records)
    refused(withData, { type: 'bind', a: { curveId: 'curve:lid' as any, anchorId: 'a' }, b: { curveId: 'curve:lowerLid' as any, anchorId: 'c' }, keep: 'mid' }, /holds takeovers \/ expression fixes/)
    const rs = plain()
    rs.find((r: any) => r.id === K).fineTune['curve:lid'].a = { dp: { x: 0.5, y: 0 }, dIn: { x: 0.5, y: 0 }, dOut: { x: 0.5, y: 0 } }
    refused(openRecords(rs), { type: 'bind', a: { curveId: 'curve:lid' as any, anchorId: 'a' }, b: { curveId: 'curve:lowerLid' as any, anchorId: 'c' }, keep: 'mid' }, /fine-tunes the two ends differently/)
  })
})

it('bind refuses when one side has yaw keys and the other only an identity placeholder (no drawn keys are dropped)', () => {
  const e = openRecords(plain())
  const three = { anchors: { p: { id: 'p', p: { x: 0, y: 0 }, hIn: { x: 0, y: 0 }, hOut: { x: 3, y: 0 } }, q: { id: 'q', p: { x: 10, y: 8 }, hIn: { x: -3, y: 0 }, hOut: { x: 0, y: 0 } } }, segments: [{ id: 'k1', from: 'p', to: 'q' }] }
  roundTrip(e, { type: 'createCurve', id: 'curve:brow' as any, parentId: 'container:L1' as any, preset: 'preset:P' as any, ...three }) // Q: identity only
  const before = JSON.stringify(e.reader.get(presetFormsIdOf('preset:Q', 'curve:strand') as any))
  refused(e, { type: 'bind', a: { curveId: 'curve:strand' as any, anchorId: 'w' }, b: { curveId: 'curve:brow' as any, anchorId: 'p' }, keep: 'mid' }, /preset:Q has no shape for curve:brow at yaw 90/)
  expect(JSON.stringify(e.reader.get(presetFormsIdOf('preset:Q', 'curve:strand') as any))).toBe(before)
})

it('bind shifts expression author keys (target AND base) at their own yaw, also between neutral keys (dot, review of 6df337d)', () => {
  const rs = plain()
  rs.find((r: any) => r.id === K).fineTune = {}
  const f = rs.find((r: any) => r.id === presetFormsIdOf('preset:P', 'curve:lid'))
  // the upper lid's corner 2 to the right of the lower lid's in every neutral state, so binding moves it
  for (const sh of [f.original, ...f.yaw.map((k: any) => k.shape)]) for (const h of ['p', 'hIn', 'hOut']) sh.a[h].x += 2
  const yaws = f.yaw.map((k: any) => k.yaw)
  expect(yaws).not.toContain(30)
  const k0 = f.expr.blink.find((k: any) => k.kind === 'author')
  const k30 = { ...structuredClone(k0), yaw: 30 }
  f.expr.blink = [...f.expr.blink, k30].sort((a: any, b: any) => a.yaw - b.yaw)
  const e = openRecords(rs)
  roundTrip(e, { type: 'bind', a: { curveId: 'curve:lid' as any, anchorId: 'a' }, b: { curveId: 'curve:lowerLid' as any, anchorId: 'c' }, keep: 'mid' })
  const now = (e.reader.get(presetFormsIdOf('preset:P', 'curve:lid') as any) as any).expr.blink
  for (const [was, yaw] of [[k0, k0.yaw], [k30, 30]] as const) {
    const k = now.find((x: any) => x.yaw === yaw && x.kind === 'author')
    for (const s of ['target', 'base'] as const) {
      for (const h of ['p', 'hIn', 'hOut'] as const) {
        expect(k[s].a[h].x).toBeCloseTo(was[s].a[h].x - 1, 11) // half of the 2-unit gap, toward the lower lid
        expect(k[s].a[h].y).toBe(was[s].a[h].y)
      }
      expect(k[s].m).toEqual(was[s].m) // other anchors untouched
    }
  }
})

describe('mergeEnds on a family curve', () => {
  const three = { anchors: { p: { id: 'p', p: { x: 0, y: 0 }, hIn: { x: 0, y: 0 }, hOut: { x: 3, y: 0 } }, q: { id: 'q', p: { x: 10, y: 8 }, hIn: { x: -3, y: 0 }, hOut: { x: 3, y: 0 } }, r: { id: 'r', p: { x: 20, y: 2 }, hIn: { x: -3, y: 0 }, hOut: { x: 0, y: 0 } } }, segments: [{ id: 'k1', from: 'p', to: 'q' }, { id: 'k2', from: 'q', to: 'r' }] }

  it('every preset’s forms merge the same way; identity-only presets stay missing; the character still plays', () => {
    const e = openRecords(plain())
    roundTrip(e, { type: 'createCurve', id: 'curve:brow' as any, parentId: 'container:L1' as any, preset: 'preset:P' as any, ...three })
    // give Q a drawing too, so the character (weights on P and Q) can play the new curve
    roundTrip(e, { type: 'setPresetKey', preset: 'preset:Q' as any, curveId: 'curve:brow' as any, yaw: 0, shape: { p: { p: { x: 0, y: 1 }, hIn: { x: 0, y: 1 }, hOut: { x: 3, y: 1 } }, q: { p: { x: 10, y: 9 }, hIn: { x: 7, y: 9 }, hOut: { x: 13, y: 9 } }, r: { p: { x: 20, y: 3 }, hIn: { x: 17, y: 3 }, hOut: { x: 20, y: 3 } } } })
    roundTrip(e, { type: 'mergeEnds', curveId: 'curve:brow' as any, keep: 'mid' })
    const P = (e.reader.get(presetFormsIdOf('preset:P', 'curve:brow') as any) as any).original
    expect(Object.keys(P).sort()).toEqual(['p', 'q'])
    expect(P.p.p).toEqual({ x: 10, y: 1 }) // mid of (0, 0) and (20, 2)
    const Q = e.reader.get(presetFormsIdOf('preset:Q', 'curve:brow') as any) as any
    expect(Object.keys(Q.yaw[0].shape).sort()).toEqual(['p', 'q'])
    expect((e.reader.get('curve:brow' as any) as any).closed).toBe(true)
    expect(e.derived.character(K).ok).toBe(true)
  })

  it('refused when a character holds data on the curve', () => {
    const e = openRecords(plain())
    roundTrip(e, { type: 'createCurve', id: 'curve:brow' as any, parentId: 'container:L1' as any, preset: 'preset:P' as any, ...three })
    roundTrip(e, { type: 'setPresetWeights', character: K as any, weights: { 'preset:P': 1 } })
    roundTrip(e, { type: 'setFineTune', character: K as any, curveId: 'curve:brow' as any, anchorId: 'q', delta: { dp: { x: 0, y: 1 }, dIn: { x: 0, y: 1 }, dOut: { x: 0, y: 1 } } })
    refused(e, { type: 'mergeEnds', curveId: 'curve:brow' as any, keep: 'mid' }, /characters character:K hold data/)
  })
})
